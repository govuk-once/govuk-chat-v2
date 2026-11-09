# Store thread messages as turns

**Date:** 2026-11-04

**Status:** accepted

## Problem

All messages are stored as one ElectroDB `Message` entity, with `role` and
`content` as plain strings (`services/chat-api/src/persistence/service.ts`).
That works while every message is text from the user or the assistant, but
AG-UI message types hold different things:

- an assistant message can have tool calls and no text
- a tool message has the id of the tool call it answers
- an activity message has an activity type and structured content rather than
  text

One answer can also be several AG-UI messages. An answer that says something,
calls a tool and says more is an assistant message with the tool call, a tool
message and a second assistant message. Stored one item per message, a page
of history can end part way through an answer. A page that starts at a tool
result has no tool call to attach it to.

The user and the assistant sides of a run are already handled differently.
The user message comes from the client and is checked for a duplicate id
before the run starts. The assistant's output comes from the agent and is
written when the run finishes, joined into one string under the run id.

This comes before the work to store each AG-UI message the agent streams,
which will build on this storage.

Versions referred to below: `@ag-ui/core` 1.0.2, the
[AG-UI 1.0 spec](https://docs.ag-ui.com/spec/1.0/basic), Zod 4.6.7 and
ElectroDB 3.9.3.

## Goals

- A run is stored as turns: one holding the user's message, and one holding
  everything the agent sent back.
- A turn's messages are AG-UI message objects, checked against `@ag-ui/core`'s
  schemas before they are written.
- `GET /v1/threads/{threadId}/messages` pages by turns, so a page holds whole
  runs, and paging still works as it does today.
- Reusing a message id in a thread still returns `409`.
- Adding a message type doesn't change the keys or stored turns.

## Non-goals

- Building messages from the event stream, including reopened messages and
  merging metadata. That is later work, which builds on these turns.
- Changing the messages response. That is part of the same later work.
- Storing tool, activity or reasoning messages. This spec only shows how they
  fit (see [Adding other message types](#adding-other-message-types)).
- Deciding which AG-UI message types we expose.
- Accepting anything other than text from the user.
- Storing turns over DynamoDB's 400 KB item limit (see [Risks](#risks)).
- Migrating existing messages. They are discarded.

## Requirements

1. **R1:** Every finished run stores a user turn, holding the user's message,
   and an assistant turn, holding the messages the agent sent back. When the
   agent sends no text, the assistant turn's list is empty.
2. **R2:** Turns are stored as a `turn` entity, which replaces `Message`, under
   the primary key `THREAD#${systemThreadId}`, `TURN#${turnId}`. A user turn's
   id is the user message's id. An assistant turn's id is the run id. Each turn
   has a `role` of `user` or `assistant`.
3. **R3:** A turn's `messages` attribute holds AG-UI message objects. Writing a
   turn fails unless its messages are exactly one user message, or any number
   of assistant messages, each matching its `@ag-ui/core` schema with no other
   fields.
4. **R4:** Reusing a user message id in a thread returns `409`. An expired turn
   doesn't block its id.
5. **R5:** `GET /v1/threads/{threadId}/messages` returns each turn's messages in
   the order they are stored in the turn, with turns ordered by `createdAt`,
   then by turn id.
6. **R6:** The pagination spec's requirements still hold, with turns in place of
   messages. A page reads at most 101 turns and returns the messages of up to
   50 whole runs, which is 100 turns. The response body doesn't change, and
   each message's `createdAt` is its turn's.
7. **R7:** A user turn's `createdAt` is the time the run was claimed. An
   assistant turn's `createdAt` is the time the run finished.
8. **R8:** A cursor holds `createdAt` and `turnId` in place of `createdAt` and
   `messageId`.
9. **R9:** Messages stored before this change aren't returned or migrated.
10. **R10:** Adding a message type means adding its `@ag-ui/core` schema to
    what an assistant turn accepts. Keys and stored turns don't change.

## Design

All of this is in `services/chat-api`. Using the answer from the problem, a run
is stored as two turns:

```
user turn       [user message]
assistant turn  [assistant message with tool call,
                 tool message,
                 assistant message]
```

Only text is stored today, so an assistant turn holds one assistant message,
with the run id as its id and the joined text as its content, as `finishRun`
writes now. When the agent sends no text, the assistant turn is still written,
with an empty list (R1).

### The turn entity

`turn` replaces `Message` (R2). Its `messages` attribute holds the AG-UI
objects as a DynamoDB list. ElectroDB's `CustomAttributeType` gives it the type
the schema infers, so code reading a turn gets typed messages:

```ts
const Turn = new Entity({
  model: { service: 'chat-api', entity: 'turn', version: '1' },
  attributes: {
    systemThreadId: { type: 'string', required: true },
    turnId: { type: 'string', required: true },
    role: { type: ['user', 'assistant'] as const, required: true },
    runId: { type: 'string', required: true },
    messages: {
      type: CustomAttributeType<TurnMessages>('any'),
      required: true,
      validate: (messages: unknown) => {
        TurnMessagesSchema.parse(messages);
        return true;
      },
    },
    createdAt: { type: 'string', required: true, readOnly: true },
    expiresAt: { type: 'number', required: true },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: ['systemThreadId'],
        template: 'THREAD#${systemThreadId}',
        casing: 'none',
      },
      sk: {
        field: 'sk',
        composite: ['turnId'],
        template: 'TURN#${turnId}',
        casing: 'none',
      },
    },
    byCreatedAt: {
      index: 'gsi1',
      pk: { field: 'gsi1pk', composite: ['systemThreadId'] },
      sk: { field: 'gsi1sk', composite: ['createdAt', 'turnId'] },
    },
  },
});
```

`role` says whose turn it is. The
[feedback spec](./2026-10-19-store-end-user-feedback-on-answers.md) checks that
a message's `role` is `assistant` in the same transaction as it writes a
reaction, so `role` is an attribute on the item. That check moves to the
assistant turn, whose id is the run id. The run id is also the id of the
assistant message returned today. The API returns each message's own `role`
from its AG-UI object.

### Checking messages

`@ag-ui/core/schemas` exports a Zod schema for each AG-UI message type.
`src/schemas/turn-messages.ts` builds what a turn may hold from them (R3):

```ts
export const TurnMessagesSchema = z.union([
  z.tuple([UserMessageSchema.strict()]),
  z.array(AssistantMessageSchema.strict()),
]);

export type TurnMessages = z.infer<typeof TurnMessagesSchema>;
```

AG-UI's schemas let unknown fields through, so a user message with
`toolCalls` would pass. `.strict()` rejects any field the message type doesn't
have.

ElectroDB runs `validate` whenever it builds a write, including inside
`finishRun`'s transaction. `parse` throws on a mismatch, and ElectroDB puts
Zod's issues in its validation error, so the write fails before it reaches
DynamoDB. `finishRun` already treats a failed write as a failed run.

Everything AG-UI defines on a message is kept, including `metadata`, where
ag_ui_strands puts citations. Nothing writes `metadata` until messages are
built from events.

### Keys and order

`gsi1` keeps its fields and ElectroDB's default key format. The entity name is
part of that format, so sort keys start `$turn_1#` rather than `$message_1#`.
A query on the index only matches turns, and messages stored before this
change aren't read (R9).

Turns sort by `createdAt`, then by turn id (R5). Within an assistant turn, the
list keeps the order the messages arrived in, which is AG-UI's order. That
order doesn't depend on a clock, so messages processed in the same
millisecond, such as the results of a parallel tool batch, stay in order.

### Reading a page

`getMessagePage` queries `turn` on `byCreatedAt` with the same `limit` and
`count` as today, and returns turns. The messages handler lists each turn's
messages in order, with the turn's `createdAt`, so the response body doesn't
change (R6).

A page holds up to 100 turns. Every finished run has two turns, written in one
transaction, and the run lock means the next run's turns sort after them. So
a page edge always falls between runs, and a page never separates a question
from its answer (R1, R6). A failed run stores neither turn, so it doesn't
change this.

While an assistant turn holds one message, a page holds up to 100 messages.
Once answers hold several messages, a page can return more.

### Cursors

A cursor holds `direction`, `createdAt` and `turnId`, because these are the sort
key (R8). A turn id is the user's message id or the run id, both from the
client's own request, so the pagination spec's R6 still holds. The run id is
also the id of the assistant message returned today.

### Duplicate message ids

`beginRun` checks for a turn at `TURN#${messageId}`, using the user message's
id, in the same transaction as today (R4). Its cancellation handling doesn't
change. A user message id that matches an earlier run id also returns `409`, as
it does today. Ids of messages inside an assistant turn aren't keys, so they
don't block a user message id.

`MessageInput` and `StoredMessage` become `TurnInput` and `StoredTurn`.
Repositories still don't expose ElectroDB types, as
[ADR 0003](../adr/0003-use-dynamodb-via-electrodb-for-chat-api-persistence.md)
requires.

### Timestamps

No AG-UI message type has a timestamp, and the AG-UI spec says a consumer "MUST
NOT use" event timestamps to order events
([basic types](https://docs.ag-ui.com/spec/1.0/basic)). So `createdAt` is
ours, from chat-api's clock.

The user turn's time moves from after the agent call is accepted to just after
`beginRun` claims the run, in `src/handlers/threads/invoke.ts` (R7). The run
lock means a run can only be claimed once the previous run's turns are
written. So a question always sorts after the answer before it. A time taken
earlier, when the request arrived, could sort before that answer if the
request came in while the answer was being written.

The assistant turn's time stays as it is, the time the run finished.

### Adding other message types

None of this is built now. A new type is its `@ag-ui/core` schema added to the
assistant turn's list (R10). For tool results:

```ts
z.array(
  z.discriminatedUnion('role', [
    AssistantMessageSchema.strict(),
    ToolMessageSchema.strict(),
  ]),
);
```

- **Tool calls** aren't a message type in AG-UI. They are a field on the
  assistant message, which its schema already allows.
- **Activity and reasoning messages** are added the same way as tool results.
- **Turns over 400 KB.** An S3 pointer would be an optional attribute on the
  turn. The keys don't change.

### Security

This doesn't change who can read or write a turn. Messages come from the
client and the agent, so they are treated as untrusted data, and they aren't
logged. The schemas limit a message to the fields AG-UI defines. `metadata` is
`Record<string, any>` in AG-UI, so its shape isn't checked, and it counts
towards the item size.

## Alternatives considered

- **One item per AG-UI message, with an entity per message type.** ElectroDB
  would check each type's attributes, and each message would have its own
  400 KB. Not chosen because a page could split an answer, and order inside a
  run would need a stored position. Reading several entities in one query
  also needs a clustered ElectroDB collection. In ElectroDB 3.9.3 a collection
  query ignores `count` and reads the whole index, and with the default key
  format a forward page repeats the message at the cursor.
- **An entity per kind of turn**, `userTurn` and `assistantTurn`. Reading both
  in one query needs the same collection. One entity whose messages are
  checked by schema doesn't.
- **One item per run**, holding the user's message and the answer. The
  duplicate check looks up the user message by id, so it needs to be a key.
- **Migrate existing messages.** They are in short-lived dev stacks, so it
  isn't worth the code.

## Implementation plan

One pull request in `services/chat-api`. The steps depend on each other and
the whole change is small. No CDK changes are needed.

1. Take the user message's time just after the run is claimed (R7).
2. Add `TurnMessagesSchema` (R3, R10).
3. Replace `Message` with `turn`, and update `beginRun`, `finishRun`,
   `getMessagePage`, the cursor and the messages handler (R1, R2, R4, R5, R6,
   R8, R9).
4. Mark this spec implemented.

### Testing

- `src/schemas/turn-messages.test.ts`: one user message, a list of assistant
  messages and an empty list pass. A mixed list, two user messages and a
  message with a field its type doesn't have fail (R3).
- `src/persistence/runs.test.ts`:
  - `finishRun` writes a user turn under the user message's id and an
    assistant turn under the run id, each with its `role` (R1, R2)
  - `finishRun` writes an assistant turn with an empty list when the agent
    sent no text (R1)
  - `finishRun` rejects a turn whose messages fail the schema, without
    sending the write (R3)
  - `beginRun`'s check uses the turn key, and a failed check is
    `duplicate-message` (R4)
- `src/persistence/messages.test.ts`: the existing tests stay, with turn
  fixtures and `$turn_1` sort keys (R6, R8, R9).
- `src/handlers/threads/messages.test.ts`: a page of turns becomes a list of
  their messages in order, each with its turn's `createdAt` (R5, R6).
- `src/schemas/message-cursor.test.ts`: the existing tests stay, with `turnId`
  (R8).
- `src/handlers/threads/invoke.test.ts`: the user turn's `createdAt` is the time
  the claim returned, using fake timers (R7).
- Run `scripts/dev-checks.sh` in `services/chat-api`.
- Manual check in a dev environment, using the pagination spec's steps: build a
  thread of more than 100 turns, page back until `earlierMessagesUrl` is
  absent, then forwards until `laterMessagesUrl` is absent, and check that no
  message is repeated or missing. Then reuse a message id and check for `409`.

### Rollout

No infrastructure changes, because `gsi1` keeps its fields. Existing messages
stop being returned (R9). They stay in the table until they expire or the
stack is deleted, and their ids no longer return `409`. Cursors from before
this change return `422`, and no client pages yet. Threads carry on, and the
agent still remembers them through AgentCore memory. Every stack is a
short-lived dev stack.

## Risks

- **Turns over 400 KB.** An assistant turn's messages share one item. Text
  answers are a few kilobytes, and tool results are the likely way to reach
  the limit. A turn over it fails `finishRun`, so the run ends with
  `RUN_ERROR` and stores nothing. A page of large turns could also pass
  Lambda's 6 MB response limit. Both wait until tools are planned, and an S3
  pointer would fit without changing keys.
- **Clocks decide the order of turns.** Turns sort by `createdAt`, which
  depends on Lambda clocks, as today. Order within a turn doesn't depend on a
  clock.
- **A reload can briefly show a question without its answer.** `finishRun`
  writes both turns in one transaction, but DynamoDB copies them to `gsi1`
  separately, usually within a fraction of a second. A reload straight after a
  run can show the user turn and not yet the assistant turn. The pagination
  spec accepts the same gap for a run's messages, as clients show the answer
  from the stream.
- **Feedback once messages keep the agent's ids.** Feedback attaches to the
  assistant turn, so an answer gets one reaction. The feedback endpoint takes
  a message id, which today is the run id and so the assistant turn's id. Once
  messages are built from events, each keeps the agent's id, so that work
  points the endpoint at the turn id instead. The server builds
  `feedbackUrl`, so clients don't change.
