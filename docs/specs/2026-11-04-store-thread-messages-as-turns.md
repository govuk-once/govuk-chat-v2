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
- The endpoint returns turns, each holding its AG-UI messages.
- Reusing a message id in a thread still returns `409`.
- Adding a message type doesn't change the keys or stored turns.

## Non-goals

- Building messages from the event stream, including reopened messages and
  merging metadata. That is later work, which builds on these turns.
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
2. **R2:** Turns are stored as `userTurn` and `assistantTurn` entities, which
   replace `Message`, keyed by `systemThreadId` and `turnId`. A user turn's id
   is the user message's id. An assistant turn's id is the run id. Each entity
   has a fixed `sender` of `user` or `assistant`.
3. **R3:** A turn's `messages` attribute holds AG-UI message objects. Writing a
   turn fails unless its messages match its entity: exactly one user message
   in a user turn, or any number of assistant messages in an assistant turn.
   Each must match its `@ag-ui/core` schema with no other fields.
4. **R4:** Reusing a user message id in a thread returns `409`. An expired turn
   doesn't block its id.
5. **R5:** `GET /v1/threads/{threadId}/messages` returns turns ordered by
   `createdAt`, then by turn id. Each turn has its id, `sender`, `createdAt`
   and messages, in the order they are stored in the turn. An assistant turn
   also has `feedback` or `feedbackUrl`.
6. **R6:** The pagination spec's requirements still hold, with turns in place of
   messages. A page reads at most 101 turns and returns up to 50 whole runs,
   which is 100 turns. The response keeps `earlierMessagesUrl` and
   `laterMessagesUrl`.
7. **R7:** A user turn's `createdAt` is the time the run was claimed. An
   assistant turn's `createdAt` is the time the run finished. An assistant
   turn's `firstOutputAt` is the time chat-api received the agent's first
   message, and is the same as `createdAt` when the agent sent none.
8. **R8:** A cursor holds `createdAt` and `turnId` in place of `createdAt` and
   `messageId`.
9. **R9:** Messages stored before this change aren't returned or migrated.
10. **R10:** Adding a message type means adding its `@ag-ui/core` schema to
    what a turn accepts. Keys and stored turns don't change.

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

### The turn entities

`userTurn` and `assistantTurn` replace `Message` (R2). The two kinds of turn
hold different messages and have different fields, so each entity only
accepts its own. Their `messages` attribute holds the AG-UI objects as a
DynamoDB list. ElectroDB's `CustomAttributeType` gives it the type the
entity's schema infers, so code reading a turn gets typed messages:

```ts
const AssistantTurn = new Entity({
  model: { service: 'chat-api', entity: 'assistantTurn', version: '1' },
  attributes: {
    systemThreadId: { type: 'string', required: true },
    turnId: { type: 'string', required: true },
    sender: { type: ['assistant'] as const, required: true },
    runId: { type: 'string', required: true },
    messages: {
      type: CustomAttributeType<AssistantTurnMessages>('any'),
      required: true,
    },
    createdAt: { type: 'string', required: true, readOnly: true },
    firstOutputAt: { type: 'string', required: true, readOnly: true },
    expiresAt: { type: 'number', required: true },
  },
  indexes: {
    primary: {
      pk: { field: 'pk', composite: ['systemThreadId'] },
      sk: { field: 'sk', composite: ['turnId'] },
    },
    byCreatedAt: {
      index: 'gsi1',
      collection: 'threadTurns',
      type: 'clustered',
      pk: { field: 'gsi1pk', composite: ['systemThreadId'] },
      sk: { field: 'gsi1sk', composite: ['createdAt', 'turnId'] },
    },
  },
});
```

`userTurn` has the same indexes and base attributes, with these differences:

- `entity` is `userTurn`
- `sender` only allows `user`
- `messages` is typed as `UserTurnMessages`
- it has no `firstOutputAt`

ElectroDB 3.9.3 rejects a `userTurn` with a `sender` of `assistant`, and an
`assistantTurn` without `firstOutputAt`. It drops
`firstOutputAt` from a `userTurn`, as the entity doesn't have it.

The keys use ElectroDB's default format, like the feedback entity's. The
entity name is part of the sort key, so a user turn and an assistant turn
with the same id are separate items.

`sender` says which side of the run a turn's messages came from: the client's
request, or the agent's output. It is named apart from AG-UI's `role`, which
each message keeps. The two can differ. A tool message has the role `tool`
whichever side ran the tool (see the [appendix](#appendix-ag-ui-scenarios)).
The API returns each message's own `role` from its AG-UI object.

The [feedback spec](./2026-10-19-store-end-user-feedback-on-answers.md) checks
that a message's `role` is `assistant` in the same transaction as it writes a
reaction. That check moves to the assistant turn, as a check on
`assistantTurn` that its `sender` is `assistant`. The assistant turn's id is
the run id, which is also the id of the assistant message returned today.

### Checking messages

`@ag-ui/core/schemas` exports a Zod schema for each AG-UI message type.
`src/schemas/turn-messages.ts` builds what each kind of turn may hold from
them (R3):

```ts
export const UserTurnMessagesSchema = z.tuple([UserMessageSchema.strict()]);

export const AssistantTurnMessagesSchema = z.array(
  AssistantMessageSchema.strict(),
);

export type UserTurnMessages = z.infer<typeof UserTurnMessagesSchema>;
export type AssistantTurnMessages = z.infer<typeof AssistantTurnMessagesSchema>;
```

AG-UI's schemas let unknown fields through, so a user message with
`toolCalls` would pass. `.strict()` rejects any field the message type doesn't
have.

`finishRun` parses each turn's `messages` with its entity's schema before it
builds the transaction. `parse` throws on a mismatch, so nothing reaches
DynamoDB. `finishRun` already treats a failed write as a failed run.

Everything AG-UI defines on a message is kept, including `metadata`, where
ag_ui_strands puts citations. Nothing writes `metadata` until messages are
built from events.

### Keys and order

`gsi1` keeps its fields and ElectroDB's default key format. Both entities
join the clustered collection `threadTurns` on it, so one query reads both
kinds of turn (R5). Sort keys on the index start `$threadturns#` rather than
`$message_1#`. A query on the collection only matches turns, and messages
stored before this change aren't read (R9).

Turns sort by `createdAt`, then by turn id (R5). Within an assistant turn, the
list keeps the order the messages arrived in, which is AG-UI's order. That
order doesn't depend on a clock, so messages processed in the same
millisecond, such as the results of a parallel tool batch, stay in order.

### Reading a page

`getMessagePage` queries the `threadTurns` collection with the same `limit`
as today, and no `count`. In ElectroDB 3.9.3 a collection query ignores
`count` and reads the whole index. DynamoDB can return fewer items than
`limit` when a page passes 1 MB, so `getMessagePage` queries again from the
returned cursor until it has 101 turns or there are none left.

In ElectroDB 3.9.3, `gt` on a clustered collection also returns the turn at
the cursor. A clustered key ends with the entity name, which the bound
leaves out, so the cursor's own key sorts after the bound. `lt` doesn't
return it. `getMessagePage` drops the cursor's turn from a forward page.

A collection query returns turns grouped by entity, as
`{ userTurn: [...], assistantTurn: [...] }`. `getMessagePage` merges the two
lists by `createdAt`, then turn id, and returns turns.

A page holds up to 100 turns. Every finished run has two turns, written in one
transaction, and the run lock means the next run's turns sort after them. So
a page edge always falls between runs, and a page never separates a question
from its answer (R1, R6). A failed run stores neither turn, so it doesn't
change this.

While an assistant turn holds one message, a page holds up to 100 messages.
Once answers hold several messages, a page can return more.

### The messages response

The messages handler returns the page's turns in place of a flat list of
messages (R5, R6):

```json
{
  "turns": [
    {
      "id": "b0000000-0000-4000-8000-000000000001",
      "sender": "user",
      "createdAt": "2026-11-09T10:00:00.040Z",
      "messages": [
        {
          "id": "b0000000-0000-4000-8000-000000000001",
          "role": "user",
          "content": "How do I renew my passport?"
        }
      ]
    },
    {
      "id": "a0000000-0000-4000-8000-000000000001",
      "sender": "assistant",
      "createdAt": "2026-11-09T10:00:03.500Z",
      "messages": [
        {
          "id": "a0000000-0000-4000-8000-000000000001",
          "role": "assistant",
          "content": "You can renew your passport online on GOV.UK."
        }
      ],
      "feedbackUrl": "/v1/threads/…/messages/a0000000-0000-4000-8000-000000000001/feedback"
    }
  ],
  "earlierMessagesUrl": "/v1/threads/…/messages?cursor=…",
  "laterMessagesUrl": "/v1/threads/…/messages?cursor=…"
}
```

`createdAt` and `sender` belong to the turn, and no AG-UI message type has
them. Returning turns keeps each message as the AG-UI object that was stored.
A client that restores history as AG-UI messages lists each turn's messages
in order. demo-ui's messages route does this, so its browser code doesn't
change.

The [feedback spec](./2026-10-19-store-end-user-feedback-on-answers.md) put
`feedback` or `feedbackUrl` on each assistant message. They move to the
assistant turn, as feedback attaches to the turn. `getMessagePage` still
reads the reactions with `readFeedback`, using the assistant turns' ids,
which are their messages' ids today.

### Cursors

A cursor holds `direction`, `createdAt` and `turnId`, because these are the sort
key (R8). A turn id is the user's message id or the run id, both from the
client's own request, so the pagination spec's R6 still holds. The run id is
also the id of the assistant message returned today.

### Duplicate message ids

`beginRun` checks for a `userTurn` and an `assistantTurn` with the user
message's id, in the same transaction as today (R4). It needs both, as the
two entities' keys differ. A failed check on either is a duplicate message.
A user message id that matches an earlier run id also returns `409`, as it
does today. Ids of messages inside an assistant turn aren't keys, so they
don't block a user message id. While each turn holds one message, that
message's id is the turn's id, so every stored message id is checked.

Once messages are built from events, an assistant turn holds several
messages with the agent's ids, and those aren't keys or checked. AG-UI lets
a producer reopen a message, or restate it in a `MESSAGES_SNAPSHOT`, by its
id. Our agent does neither. ag_ui_strands 0.2.4 gives every message a new
UUID, and agui-agent turns snapshots off
(`services/agui-agent/src/agui_agent/main.py`). If an agent did repeat ids,
a pointer item per message at `MESSAGE#${messageId}`, holding the turn id,
would let `finishRun` reject or find them.

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

The assistant turn's `createdAt` stays as it is, the time the run finished.
An answer arrives over a period of time, so one time doesn't describe it. The
assistant turn also stores `firstOutputAt`, the time chat-api received the
agent's first message. `MessageAccumulator` records it on the first
`TEXT_MESSAGE_START`, and `invoke` passes it to `finishRun`. When the agent
sends no messages, `finishRun` uses the finish time, so it is the same as
`createdAt`. It is stored but not returned.

### Adding other message types

None of this is built now. A new type is its `@ag-ui/core` schema added to a
turn's list (R10). For tool results the agent runs:

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
- **Several messages in an assistant turn.** Their ids aren't keys, so
  nothing checks them (see [Duplicate message ids](#duplicate-message-ids)).

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
- **One entity for both kinds of turn**, with a `sender` of `user` or
  `assistant`. `getMessagePage` would keep `count` and need no merge.
  Not chosen because the fields that differ, such as `firstOutputAt`, would
  be optional on every turn, and nothing would stop the wrong mix.
- **A query per entity, merged, with no collection.** Each query would read
  a page of its own entity's turns. Which turns made up the merged page would
  rely on every run having one turn of each kind, which
  [example 4](#example-4-a-tool-that-needs-the-users-approval) doesn't.
- **One item per run**, holding the user's message and the answer. The
  duplicate check looks up the user message by id, so it needs to be a key.
- **Migrate existing messages.** They are in short-lived dev stacks, so it
  isn't worth the code.

## Implementation plan

One pull request in `services/chat-api`, with small changes in
`services/demo-ui` and `cloud-tests`. The steps depend on each other and the
whole change is small. No CDK changes are needed.

1. Take the user message's time just after the run is claimed (R7).
2. Record the time of the agent's first message in `MessageAccumulator` (R7).
3. Add `UserTurnMessagesSchema` and `AssistantTurnMessagesSchema` (R3, R10).
4. Replace `Message` with `userTurn` and `assistantTurn`, and update
   `beginRun`, `finishRun`, `getMessagePage`, the cursor and the messages
   handler (R1, R2, R4, R5, R6, R7, R8, R9).
5. Read turns from the messages response in demo-ui's messages route and in
   cloud-tests (R5).
6. Mark this spec implemented.

### Testing

- `src/schemas/turn-messages.test.ts`: one user message for a user turn, and
  a list of assistant messages or an empty list for an assistant turn, pass.
  An assistant message for a user turn, a user message for an assistant turn,
  two user messages and a message with a field its type doesn't have fail
  (R3).
- `src/streaming/message-accumulator.test.ts`: the first output time is the
  time of the first `TEXT_MESSAGE_START`, and is absent before one (R7).
- `src/persistence/runs.test.ts`:
  - `finishRun` writes a `userTurn` under the user message's id and an
    `assistantTurn` under the run id (R1, R2)
  - `finishRun` writes an assistant turn with an empty list, and
    `firstOutputAt` equal to `createdAt`, when the agent sent no text (R1,
    R7)
  - `finishRun` rejects a turn whose messages don't match its entity's
    schema, without sending the write (R3)
  - `beginRun` checks both turn entities for the user message's id, and a
    failed check on either is `duplicate-message` (R4)
- `src/persistence/messages.test.ts`: the existing tests stay, with turn
  fixtures and `$threadturns` sort keys (R6, R8, R9). New tests check that a
  page merges user and assistant turns in `createdAt` order, then turn id,
  that a short response is followed by another query from its cursor, and
  that a forward page leaves out the cursor's turn (R5, R6).
- `src/handlers/threads/messages.test.ts`: a page of turns is returned in
  order, each with its id, `sender`, `createdAt` and messages. The feedback
  tests move from assistant messages to assistant turns (R5, R6).
- `src/schemas/message-cursor.test.ts`: the existing tests stay, with `turnId`
  (R8).
- `src/handlers/threads/invoke.test.ts`: the user turn's `createdAt` is the time
  the claim returned, using fake timers (R7).
- `services/demo-ui/src/app/api/chat/messages/route.test.ts`: the route
  returns each turn's messages in order (R5).
- `cloud-tests/src/api/thread-journey.test.ts`: a run stores a user turn and
  an assistant turn (R1, R5). It runs against a deployed environment.
- Run `scripts/dev-checks.sh` in `services/chat-api`, `services/demo-ui` and
  `cloud-tests`.
- Manual check in a dev environment, using the pagination spec's steps: build a
  thread of more than 100 turns, page back until `earlierMessagesUrl` is
  absent, then forwards until `laterMessagesUrl` is absent, and check that no
  message is repeated or missing. Then reuse a message id and check for `409`.

### Rollout

No infrastructure changes, because `gsi1` keeps its fields. Existing messages
stop being returned (R9). They stay in the table until they expire or the
stack is deleted, and their ids no longer return `409`. Cursors from before
this change return `422`, and no client pages yet. demo-ui and cloud-tests
are the only readers of the response, and both change in the same pull
request. Threads carry on, and the agent still remembers them through
AgentCore memory. Every stack is a short-lived dev stack.

## Risks

- **Turns over 400 KB.** An assistant turn's messages share one item. Text
  answers are a few kilobytes, and tool results are the likely way to reach
  the limit. A turn over it fails `finishRun`, so the run ends with
  `RUN_ERROR` and stores nothing. A page of large turns could also pass
  Lambda's 6 MB response limit. Both wait until tools are planned, and an S3
  pointer would fit without changing keys. This is tracked in
  [#483](https://github.com/govuk-once/govuk-chat-v2/issues/483).
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

## Appendix: AG-UI scenarios

These examples follow a run from the client's request to the turns it stores.
Each shows the request, the events the agent streams, the turns `finishRun`
writes, and when each time is taken. Examples 1 and 2 fit this design.
Examples 3 and 4 need requests chat-api rejects today. They would fit with
additions, without changing the keys or stored turns.

The JSON was checked by running it through chat-api's request schema,
`@ag-ui/core`'s schemas, `MessageAccumulator`, and the turn entities above
with ElectroDB 3.9.3. Turns are shown with the attributes the examples are
about. Their keys are as in [The turn entities](#the-turn-entities).

The ids are valid UUIDs chosen to be easy to follow:

- `1111…` is the client's thread id
- `a…` ids are run ids
- `b…` ids come from the client, and `c…` ids come from the agent

### How a run is written

1. The client sends a request. chat-api checks it against
   `src/schemas/client-input.ts` and claims the run with `beginRun`. The time
   just after the claim is the user turn's `createdAt`.
2. The agent streams events. chat-api relays each one to the client, with the
   client's thread id, and `MessageAccumulator` collects the text. The time of
   the first `TEXT_MESSAGE_START` is the assistant turn's `firstOutputAt`.
3. On `RUN_FINISHED`, `finishRun` writes one transaction: the run, the user
   turn and the assistant turn, and it deletes the run lock. That time is the
   assistant turn's `createdAt`.
4. `GET /v1/threads/{threadId}/messages` reads turns from `gsi1` in
   `createdAt` order, and returns them.

### Example 1: a question and a text answer

This is what this spec builds.

The request:

```json
{
  "threadId": "11111111-1111-4111-8111-111111111111",
  "runId": "a0000000-0000-4000-8000-000000000001",
  "messages": [
    {
      "id": "b0000000-0000-4000-8000-000000000001",
      "role": "user",
      "content": "How do I renew my passport?"
    }
  ]
}
```

The events chat-api relays:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000001"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000001","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000001","delta":"You can renew your passport "}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000001","delta":"online on GOV.UK."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000001"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000001"}
```

The times, from chat-api's clock:

| Time         | What happens                         | Stored as                      |
| ------------ | ------------------------------------ | ------------------------------ |
| 10:00:00.040 | `beginRun` claims the run            | user turn `createdAt`          |
| 10:00:01.200 | the first `TEXT_MESSAGE_START`       | assistant turn `firstOutputAt` |
| 10:00:03.500 | `RUN_FINISHED`, and `finishRun` runs | assistant turn `createdAt`     |

The turns `finishRun` writes:

```json
[
  {
    "turnId": "b0000000-0000-4000-8000-000000000001",
    "sender": "user",
    "runId": "a0000000-0000-4000-8000-000000000001",
    "createdAt": "2026-11-09T10:00:00.040Z",
    "messages": [
      {
        "id": "b0000000-0000-4000-8000-000000000001",
        "role": "user",
        "content": "How do I renew my passport?"
      }
    ]
  },
  {
    "turnId": "a0000000-0000-4000-8000-000000000001",
    "sender": "assistant",
    "runId": "a0000000-0000-4000-8000-000000000001",
    "createdAt": "2026-11-09T10:00:03.500Z",
    "firstOutputAt": "2026-11-09T10:00:01.200Z",
    "messages": [
      {
        "id": "a0000000-0000-4000-8000-000000000001",
        "role": "assistant",
        "content": "You can renew your passport online on GOV.UK."
      }
    ]
  }
]
```

Things to check against the request and events:

- The user turn's id and message are the request's last message.
- The assistant message's id is the run id. Its content is the
  `TEXT_MESSAGE_CONTENT` deltas joined.
- Both turns have the run id as `runId`, which ties them to the same run.

The messages endpoint returns the two turns in that order (R5).
`firstOutputAt` is stored but not returned.

### Example 2: an answer that uses a search tool

The agent says it will check, calls a search tool, and answers. The events,
in the order ag_ui_strands sends them:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000002"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000002","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000002","delta":"Let me check GOV.UK."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000002"}
{"type":"TOOL_CALL_START","toolCallId":"tooluse_search01","toolCallName":"search_govuk","parentMessageId":"c0000000-0000-4000-8000-000000000002"}
{"type":"TOOL_CALL_ARGS","toolCallId":"tooluse_search01","delta":"{\"query\":\"renew passport\"}"}
{"type":"TOOL_CALL_END","toolCallId":"tooluse_search01"}
{"type":"TOOL_CALL_RESULT","messageId":"c0000000-0000-4000-8000-000000000003","toolCallId":"tooluse_search01","content":"[{\"title\":\"Renew your passport\",\"url\":\"https://www.gov.uk/renew-adult-passport\"}]"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000004","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000004","delta":"You can renew your passport online on GOV.UK."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000004"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000002"}
```

`TOOL_CALL_START`'s `parentMessageId` is the first text message's id.
`TOOL_CALL_RESULT` has its own `messageId`, and the `toolCallId` of the call
it answers.

This spec stores only text, as chat-api does today. `MessageAccumulator` joins
the two text messages, and the tool call and its result aren't stored. The
assistant turn's `messages`:

```json
[
  {
    "id": "a0000000-0000-4000-8000-000000000002",
    "role": "assistant",
    "content": "Let me check GOV.UK.\n\nYou can renew your passport online on GOV.UK."
  }
]
```

Once messages are built from events, the same assistant turn holds:

```json
{
  "turnId": "a0000000-0000-4000-8000-000000000002",
  "sender": "assistant",
  "runId": "a0000000-0000-4000-8000-000000000002",
  "createdAt": "2026-11-09T10:05:06.300Z",
  "firstOutputAt": "2026-11-09T10:05:01.100Z",
  "messages": [
    {
      "id": "c0000000-0000-4000-8000-000000000002",
      "role": "assistant",
      "content": "Let me check GOV.UK.",
      "toolCalls": [
        {
          "id": "tooluse_search01",
          "type": "function",
          "function": {
            "name": "search_govuk",
            "arguments": "{\"query\":\"renew passport\"}"
          }
        }
      ]
    },
    {
      "id": "c0000000-0000-4000-8000-000000000003",
      "role": "tool",
      "toolCallId": "tooluse_search01",
      "content": "[{\"title\":\"Renew your passport\",\"url\":\"https://www.gov.uk/renew-adult-passport\"}]"
    },
    {
      "id": "c0000000-0000-4000-8000-000000000004",
      "role": "assistant",
      "content": "You can renew your passport online on GOV.UK."
    }
  ]
}
```

Only `messages` differs between the two. The agent ran the tool during the
run, so the tool message is in the assistant turn.

### Example 3: a choice the client shows

The agent asks the user to pick from choices, using a tool the client runs.
AG-UI handles this across two runs. chat-api rejects both requests today, so
the turns here show how they would be stored if it accepted them and built
messages from events. They aren't part of this spec.

The first request is like example 1's, with a `tools` list declaring
`offer_choices`, a tool the client runs that takes a list of choices. The
agent calls the tool and the run ends. `pendingToolCallIds` tells the
client the call is waiting for its answer:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000003"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000005","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000005","delta":"Where do you live?"}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000005"}
{"type":"TOOL_CALL_START","toolCallId":"tooluse_choices01","toolCallName":"offer_choices","parentMessageId":"c0000000-0000-4000-8000-000000000005"}
{"type":"TOOL_CALL_ARGS","toolCallId":"tooluse_choices01","delta":"{\"choices\":[\"In the UK\",\"Outside the UK\"]}"}
{"type":"TOOL_CALL_END","toolCallId":"tooluse_choices01"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000003","outcome":{"type":"success","pendingToolCallIds":["tooluse_choices01"]}}
```

The client shows the choices. The user picks one, and the client sends the
answer as a tool message in a second request. It has the same `threadId` and
`tools` as the first, a new `runId`, and the conversation so far:

```json
{
  "runId": "a0000000-0000-4000-8000-000000000004",
  "messages": [
    {
      "id": "b0000000-0000-4000-8000-000000000003",
      "role": "user",
      "content": "How do I renew my passport?"
    },
    {
      "id": "c0000000-0000-4000-8000-000000000005",
      "role": "assistant",
      "content": "Where do you live?",
      "toolCalls": [
        {
          "id": "tooluse_choices01",
          "type": "function",
          "function": {
            "name": "offer_choices",
            "arguments": "{\"choices\":[\"In the UK\",\"Outside the UK\"]}"
          }
        }
      ]
    },
    {
      "id": "b0000000-0000-4000-8000-000000000004",
      "role": "tool",
      "toolCallId": "tooluse_choices01",
      "content": "Outside the UK"
    }
  ]
}
```

`@ag-ui/core`'s `RunAgentInputSchema` accepts both requests. chat-api's
rejects both with `422`, because `tools` must be empty. It also rejects the
second because `toolCalls` and `toolCallId` aren't allowed, and the last
message must be a user message.

The second run then answers as normal:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000004"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000006","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000006","delta":"You can renew your passport online from outside the UK."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000006"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000004"}
```

The first run's assistant turn would hold `c…05`, the assistant message with
the tool call. The client sends the same message back in the second
request's history.

The second run's user turn would hold the tool message. The client sent it,
so its `sender` is `user`, and its id is the tool message's id. The user
turn's schema would need to accept tool messages:

```json
{
  "turnId": "b0000000-0000-4000-8000-000000000004",
  "sender": "user",
  "runId": "a0000000-0000-4000-8000-000000000004",
  "createdAt": "2026-11-09T10:10:15.040Z",
  "messages": [
    {
      "id": "b0000000-0000-4000-8000-000000000004",
      "role": "tool",
      "toolCallId": "tooluse_choices01",
      "content": "Outside the UK"
    }
  ]
}
```

The thread's turns, in `createdAt` order:

| `createdAt`  | `sender`    | `turnId` | Messages                 |
| ------------ | ----------- | -------- | ------------------------ |
| 10:10:00.040 | `user`      | `b…03`   | user                     |
| 10:10:02.000 | `assistant` | `a…03`   | assistant with tool call |
| 10:10:15.040 | `user`      | `b…04`   | tool                     |
| 10:10:19.000 | `assistant` | `a…04`   | assistant                |

Examples 2 and 3 both store a `tool` message. In example 2 the agent ran the
tool, so it's in the assistant turn. In example 3 the client ran it, so it's
in the user turn.

Fitting this is an addition, like a new message type (R10).
`UserTurnMessagesSchema` accepts a tool message. Keys and stored turns don't
change.

### Example 4: a tool that needs the user's approval

The agent wants to run a tool, but needs the user to approve it first. AG-UI
handles this with an interrupt, across two runs. As in example 3, chat-api
rejects the second request today, and the turns here aren't part of this
spec.

The first request is like example 1's, asking "Has my passport application
been processed?". The agent calls the tool, and the run finishes with an
`interrupt` outcome instead of running it. The interrupt's `message` is the
question for the user:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000005"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000007","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000007","delta":"I can check where your application is up to."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000007"}
{"type":"TOOL_CALL_START","toolCallId":"tooluse_status01","toolCallName":"check_application_status","parentMessageId":"c0000000-0000-4000-8000-000000000007"}
{"type":"TOOL_CALL_ARGS","toolCallId":"tooluse_status01","delta":"{\"reference\":\"PEX123456\"}"}
{"type":"TOOL_CALL_END","toolCallId":"tooluse_status01"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000005","outcome":{"type":"interrupt","interrupts":[{"id":"interrupt_status01","reason":"tool_approval","message":"Can I use your application reference to check its status?","toolCallId":"tooluse_status01"}]}}
```

The user approves. The client sends a second request with the same
`threadId`, a new `runId`, and the conversation so far, which ends with
`c…07`, the agent's message with the tool call. Unlike example 3, there's no
new message. The approval is a `resume` entry beside `messages`:

```json
{
  "resume": [
    {
      "interruptId": "interrupt_status01",
      "status": "resolved",
      "payload": { "approved": true }
    }
  ]
}
```

`@ag-ui/core`'s `RunAgentInputSchema` accepts it. chat-api's rejects it with
`422`, because `resume` and `toolCalls` aren't allowed, and the last message
must be a user message.

The second run runs the tool and answers:

```
{"type":"RUN_STARTED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000006"}
{"type":"TOOL_CALL_RESULT","messageId":"c0000000-0000-4000-8000-000000000008","toolCallId":"tooluse_status01","content":"{\"status\":\"printed\"}"}
{"type":"TEXT_MESSAGE_START","messageId":"c0000000-0000-4000-8000-000000000009","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"c0000000-0000-4000-8000-000000000009","delta":"Your passport has been printed."}
{"type":"TEXT_MESSAGE_END","messageId":"c0000000-0000-4000-8000-000000000009"}
{"type":"RUN_FINISHED","threadId":"11111111-1111-4111-8111-111111111111","runId":"a0000000-0000-4000-8000-000000000006"}
```

The interrupt and the resume entry aren't messages, so this spec's turns
can't hold them. Without them, a reloaded thread would show the tool call,
then its result, without the question or the user's approval between them.
The second run's request has no new message, so there's no message id to use
as its user turn's `turnId`.

Fitting this is a set of additions:

- the assistant turn stores `interrupts` beside `messages`, as an optional
  attribute
- the user turn stores `resume` beside `messages`, and its list of messages
  can be empty
- a user turn with no message needs another id. The resume entry's
  `interruptId` can't be it, as AG-UI only makes interrupt ids unique within
  a run. Choosing one is left to that work.

With those additions, the thread's turns, in `createdAt` order:

| `createdAt`  | `sender`    | `turnId`       | Holds                               |
| ------------ | ----------- | -------------- | ----------------------------------- |
| 10:15:00.040 | `user`      | `b…05`         | user message                        |
| 10:15:02.000 | `assistant` | `a…05`         | assistant with tool call, interrupt |
| 10:15:10.040 | `user`      | not yet chosen | no messages, resume entry           |
| 10:15:12.000 | `assistant` | `a…06`         | tool, assistant                     |

The keys don't change, and neither do stored turns. The duplicate message
check runs only when the request has a new message. `beginRun` already
rejects a reused run id, so retrying the second request still returns `409`.

### Every AG-UI message type

AG-UI 1.0 has seven message types. Some can come from more than one place.
This is where each would go, and whether this spec stores it:

| Type        | Comes from                         | Turn      | Stored by this spec    |
| ----------- | ---------------------------------- | --------- | ---------------------- |
| `user`      | the request's last message         | user      | yes                    |
| `assistant` | the agent                          | assistant | yes, as joined text    |
| `tool`      | a tool the agent runs (example 2)  | assistant | no, later              |
| `tool`      | a tool the client runs (example 3) | user      | no, not designed       |
| `reasoning` | the agent                          | assistant | no, later              |
| `activity`  | the agent                          | assistant | no, later              |
| `user`      | agent text with this role          | assistant | joined, as `assistant` |
| `system`    | agent text with this role          | assistant | joined, as `assistant` |
| `developer` | agent text with this role          | assistant | joined, as `assistant` |
| `system`    | the request's history              | none      | no                     |
| `developer` | the request's history              | none      | no, chat-api rejects   |

The system prompt is part of the agent, not an AG-UI message, so it isn't
stored.

`TEXT_MESSAGE_START` can have the role `user`, `system` or `developer`, as
well as `assistant`. The agent produced that text, so it is in the assistant
turn and keeps its role. So a message's `role` doesn't always say which side
of the run sent it. The turn's `sender` does.

### Other scenarios

In this spec:

- **No text from the agent.** The assistant turn has `messages: []`, and
  `firstOutputAt` equal to `createdAt`.
- **Citations.** They go in the assistant message's `metadata`, which the
  schema keeps.
- **A reused user message id.** `beginRun` returns `409`, and nothing is
  written.
- **A failed run.** The run ends with `RUN_ERROR`, or the stream stops before
  `RUN_FINISHED`. Nothing is written.
- **A cancelled run.** chat-api writes both turns on any `RUN_FINISHED`, so
  the assistant turn holds what the agent sent before it stopped.

Once messages are built from events, in the assistant turn as in example 2:

- **Several tools at once.** One assistant message holds several tool calls,
  and a tool message follows for each.
- **A tool that fails.** The tool message has an `error` beside its
  `content`.
- **Reasoning.** A `reasoning` message, with any `encryptedValue` the provider
  needs on a later run.
- **Activity.** An `activity` message, as it was when the run finished.
- **Subagents.** Their messages keep `subagentRunId`, which says which
  subagent produced them.

Additions this design allows, not built as chat-api rejects the requests:

- **A tool the client runs.** See example 3.
- **A tool that needs approval.** See example 4.

Not supported:

- **A change to an earlier run's message.** AG-UI lets a producer reopen or
  restate a message by its id, and our agent does neither (see
  [Duplicate message ids](#duplicate-message-ids)).

Not designed yet:

- **Images and files from the user.** A user message's content can be a list
  of parts. chat-api only accepts text. Inline data counts towards the 400 KB
  limit.
- **A tool result over 400 KB.** The run fails (see [Risks](#risks)).
