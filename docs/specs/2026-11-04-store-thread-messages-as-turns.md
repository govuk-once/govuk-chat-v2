# Store thread messages as turns

**Date:** 2026-11-04 · **Status:** accepted

**5-minute read. You're asked to decide 3 things.** The
[build sheet](#build-sheet) is for whoever builds it, and the
[AG-UI scenarios](./2026-11-04-store-thread-messages-as-turns/scenarios.md)
show how each kind of AG-UI message would be stored. You don't need either
to review.

## In one sentence

We'll store each run as a user turn and an assistant turn, each holding
AG-UI message objects, so we can store more than text and a page of history
always holds whole runs.

## Before and after

| Today                                                      | After                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| One `Message` entity, with `role` and `content` as strings | `userTurn` and `assistantTurn` entities, holding AG-UI messages |
| Only text from the user or the assistant fits              | Tool, activity and reasoning messages fit, by adding a schema   |
| A page could end part way through an answer                | A page holds up to 50 whole runs                                |
| The messages endpoint returns a flat list of messages      | It returns turns, each holding its messages                     |
| Feedback is on each assistant message                      | Feedback is on the assistant turn                               |

We still only store text. Later work builds each AG-UI message from the
agent's events, and stores it in these turns.

## What you'll experience

**Calling the API.** You send a message to `invoke` as now. When the run
finishes, chat-api writes two turns in one transaction. Then
`GET /v1/threads/{threadId}/messages` returns `turns`. Each has an id, a
`sender` of `user` or `assistant`, a `createdAt` and its messages. Assistant
turns also have `feedback` or `feedbackUrl`. Paging works as it does today.
Reusing a message id still returns `409`.

**Using demo-ui.** Nothing changes. Its messages route lists each turn's
messages in order.

**Adding a message type later.** You add its `@ag-ui/core` schema to what a
turn accepts. The keys and stored turns don't change.

## Decide

### 1. Should user and assistant turns be separate entities?

**Recommended: yes**, as `userTurn` and `assistantTurn`, read together
through one ElectroDB collection.

The two kinds of turn hold different messages and have different fields,
such as `firstOutputAt`, which only an assistant turn has. With an entity
each, ElectroDB rejects the wrong mix.

The cost is in reading a page. An ElectroDB 3.9.3 collection query ignores
`count`, repeats the cursor's turn on a forward page, and groups results by
entity. So we loop, drop that turn and merge.

- **Simpler alternative:** one turn entity with a `sender` of `user` or
  `assistant`. Paging keeps `count` and needs no merge. But fields that
  differ would be optional on every turn, and nothing would stop the wrong
  mix.
- **No collection:** a query per entity, merged. But which turns make up a
  page would rely on every run having one turn of each kind, which a tool
  that needs the user's approval doesn't.

### 2. Should the messages endpoint return turns?

**Recommended: yes.**

`createdAt`, `sender` and feedback belong to the turn, and no AG-UI message
type has them. Returning turns keeps each message as the AG-UI object we
stored. demo-ui and cloud-tests are the only readers, and both change in the
same pull request.

- **Alternative:** a flat list of messages, as today. But we'd have to add
  fields to AG-UI messages that their types don't have.

### 3. Is it fine not to check the agent's message ids?

**Recommended: yes, for now.**

A user turn's id is the user message's id, so `beginRun` still catches a
reused one. Ids of messages inside an assistant turn aren't keys, so nothing
checks them. AG-UI lets an agent reopen or restate a message by its id, but
ours does neither. ag_ui_strands 0.2.4 gives every message a new UUID, and
agui-agent turns snapshots off. Only a bug would repeat one.

- **Alternative:** a pointer item per message at `MESSAGE#${messageId}`,
  holding its turn id. Written in `finishRun`'s transaction, it would cap a
  run at 96 messages, as DynamoDB allows 100 items in a transaction. Written
  separately, a failed run could leave pointers to turns that were never
  written. We'd add it if an agent ever repeats ids.

## Know

- **A run is two turns,** not one item per message or one per run. One
  per message could split an answer across pages. One per run doesn't fit
  the duplicate check, which needs the user message's id as a key.
- **Messages are checked before they're written,** against `@ag-ui/core`'s
  Zod schemas with `.strict()`, so a message can't have fields its type
  doesn't have. A mismatch fails the run, and nothing is written.
- **`createdAt` is ours, from chat-api's clock.** No AG-UI message type has
  a time. The user turn's time moves to just after `beginRun` claims the
  run, so a question always sorts after the answer before it. The assistant
  turn's time is when the run finished, as now. It also stores
  `firstOutputAt`, the time of the agent's first message, but doesn't
  return it.
- **An answer gets one reaction,** as feedback is on the assistant turn.
- **Existing messages are discarded,** not migrated. They're only in
  short-lived dev stacks. Their ids stop returning `409`, and old cursors
  return `422`, though no client pages yet.
- **`metadata` isn't checked.** AG-UI types it as `Record<string, any>`, so
  the schemas keep it without checking its shape. It counts towards the
  400 KB item limit.

## Following precedent

The pagination spec's paging, cursors and page size, with turns in place of
messages. ElectroDB's default key format, as the feedback entity uses. The
existing `gsi1` index, so no CDK changes. Repositories hide ElectroDB types,
as [ADR 0003](../adr/0003-use-dynamodb-via-electrodb-for-chat-api-persistence.md)
requires. Messages aren't logged.

## What could bite us

- **Turns over 400 KB.** An assistant turn's messages share one DynamoDB
  item, and large tool results could pass the limit. The run would fail and
  store nothing. A page of large turns could also pass Lambda's 6 MB
  response limit. An S3 pointer would fit without changing keys. Tracked in
  [#483](https://github.com/govuk-once/govuk-chat-v2/issues/483).
- **A reload can briefly show a question without its answer.** DynamoDB
  copies the two turns to `gsi1` separately. The pagination spec accepts
  the same gap, as clients show the answer from the stream.
- **Feedback once messages keep the agent's ids.** The feedback endpoint
  takes a message id, which today is the run id and so the assistant turn's
  id. The work to build messages from events points it at the turn id. The
  server builds `feedbackUrl`, so clients don't change.

## Delivery

One pull request, in `services/chat-api`, with small changes in
`services/demo-ui` and `cloud-tests`. The steps depend on each other.

---

## Build sheet

Reference for the implementer. It records agreed facts, not arguments.

Versions: `@ag-ui/core` 1.0.3, the
[AG-UI 1.0 spec](https://docs.ag-ui.com/spec/1.0/basic), Zod 4.6.7,
ElectroDB 3.9.3.

### Steps

1. Take the user turn's time just after `beginRun` claims the run, in
   `src/handlers/threads/invoke.ts`.
2. Record the time of the first `TEXT_MESSAGE_START` in
   `MessageAccumulator`.
3. Add `src/schemas/turn-messages.ts`.
4. Replace `Message` with `userTurn` and `assistantTurn`. Update
   `beginRun`, `finishRun`, `getMessagePage`, the cursor and the messages
   handler.
5. Read turns from the response in demo-ui's messages route and in
   cloud-tests.
6. Mark this spec implemented.

### Entities

In `services/chat-api/src/persistence/service.ts`, replacing `Message`:

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

`userTurn` is the same, except:

- `entity` is `userTurn`
- `sender` only allows `user`
- `messages` is `UserTurnMessages`
- no `firstOutputAt`

Ids:

- user turn: the user message's id
- assistant turn: the run id, which is also its one message's id
- both: `runId` is the run id

The entity name is part of the sort key, so a user turn and an assistant
turn with the same id are separate items.

`MessageInput` and `StoredMessage` become `TurnInput` and `StoredTurn`.

### Schemas

`src/schemas/turn-messages.ts`, from `@ag-ui/core/schemas`:

```ts
export const UserTurnMessagesSchema = z.tuple([UserMessageSchema.strict()]);

export const AssistantTurnMessagesSchema = z.array(
  AssistantMessageSchema.strict(),
);

export type UserTurnMessages = z.infer<typeof UserTurnMessagesSchema>;
export type AssistantTurnMessages = z.infer<typeof AssistantTurnMessagesSchema>;
```

`finishRun` parses each turn's `messages` with its schema before building
the transaction. Every field AG-UI defines is kept, including `metadata`,
where ag_ui_strands puts citations.

Today's assistant turn holds one assistant message: the run id as its id,
and the joined text as its content, as `finishRun` writes now. With no text,
the list is empty.

### Keys and order

- `gsi1` keeps its fields. Both entities join the clustered collection
  `threadTurns`.
- Sort keys on `gsi1` start `$threadturns#`, not `$message_1#`, so a
  collection query never reads stored messages.
- Turns sort by `createdAt`, then turn id.
- Within an assistant turn, messages keep the order they arrived in.

### Reading a page

`getMessagePage`:

1. Queries `threadTurns` with the same `limit` as today, and no `count`.
2. On a forward page, drops the turn at the cursor, which `gt` returns,
   before counting turns.
3. Queries again from the returned cursor until it has 101 turns or there
   are none left.
4. Merges `{ userTurn: [...], assistantTurn: [...] }` by `createdAt`, then
   turn id.
5. Reads reactions with `readFeedback`, using the assistant turns' ids.

A page returns up to 100 turns, or 50 runs. The response keeps
`earlierMessagesUrl` and `laterMessagesUrl`.

### Response

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

Each message keeps its own AG-UI `role`. `firstOutputAt` isn't returned.

### Cursor

Holds `direction`, `createdAt` and `turnId`, in place of `messageId`.

### Duplicate check

- `beginRun` checks for a `userTurn` and an `assistantTurn` with the user
  message's id, in the same transaction as today.
- A failed check on either is `duplicate-message`, returning `409`.
- An expired turn doesn't block its id.

### Feedback

- The feedback transaction's check moves from a message's `role` being
  `assistant` to the `assistantTurn`'s `sender` being `assistant`.
- `feedback` and `feedbackUrl` move from the assistant message to the
  assistant turn.

### Timestamps

- User turn `createdAt`: just after `beginRun` returns.
- Assistant turn `createdAt`: when `RUN_FINISHED` arrives and `finishRun`
  runs.
- Assistant turn `firstOutputAt`: `MessageAccumulator` records the first
  `TEXT_MESSAGE_START`. `invoke` passes it to `finishRun`. With no messages,
  `finishRun` uses its own finish time, so it's the same as `createdAt`.

### Adding message types later

Not built now. A tool result the agent runs:

```ts
z.array(
  z.discriminatedUnion('role', [
    AssistantMessageSchema.strict(),
    ToolMessageSchema.strict(),
  ]),
);
```

- Tool calls are a field on the assistant message, already allowed.
- Activity and reasoning messages are added the same way.
- An S3 pointer for big turns would be an optional attribute.

### Edge cases

- If the agent sends no text, write the assistant turn with
  `messages: []`.
- If a turn's messages don't match its schema, throw before the write. The
  run ends with `RUN_ERROR`.
- If the run fails or the stream stops before `RUN_FINISHED`, write
  nothing.
- If the run is cancelled, write both turns on `RUN_FINISHED`, with what
  the agent sent before it stopped.
- If a user message id matches an earlier run id, return `409`, as today.
- If a turn is over 400 KB, the write fails and so does the run.

### Checks

- `src/schemas/turn-messages.test.ts`:
  - pass: one user message in a user turn; assistant messages or an empty
    list in an assistant turn
  - fail: an assistant message in a user turn; a user message in an
    assistant turn; two user messages; a field the type doesn't have
- `src/streaming/message-accumulator.test.ts`: the first output time is the
  first `TEXT_MESSAGE_START`'s time, and absent before one.
- `src/persistence/runs.test.ts`:
  - `finishRun` writes a `userTurn` under the user message's id and an
    `assistantTurn` under the run id
  - with no text, an empty list and `firstOutputAt` equal to `createdAt`
  - a turn that fails its schema isn't sent
  - `beginRun` checks both entities, and a failed check on either is
    `duplicate-message`
- `src/persistence/messages.test.ts`: existing tests stay, with turn
  fixtures and `$threadturns` sort keys. Add:
  - turns merge in `createdAt` order, then turn id
  - a short response is followed by another query from its cursor
  - a forward page leaves out the cursor's turn
- `src/handlers/threads/messages.test.ts`: turns returned in order with
  their fields. Feedback tests move to assistant turns.
- `src/schemas/message-cursor.test.ts`: existing tests stay, with `turnId`.
- `src/handlers/threads/invoke.test.ts`: the user turn's `createdAt` is the
  time the claim returned, with fake timers.
- `services/demo-ui/src/app/api/chat/messages/route.test.ts`: each turn's
  messages returned in order.
- `cloud-tests/src/api/thread-journey.test.ts`: a run stores a user turn
  and an assistant turn.
- `scripts/dev-checks.sh` in `services/chat-api`, `services/demo-ui` and
  `cloud-tests`.
- Manually, in a dev environment, with the pagination spec's steps:
  - build a thread of more than 100 turns
  - page back until `earlierMessagesUrl` is absent, then forward until
    `laterMessagesUrl` is absent
  - check no message is repeated or missing
  - reuse a message id and check for `409`

### Rollout

- No infrastructure changes.
- Stored messages stay in the table until they expire or the stack is
  deleted.
- Threads carry on, and the agent still remembers them through AgentCore
  memory.
- Every stack is a short-lived dev stack.

### Out of scope

- Building messages from the event stream, including reopened messages
  and merged metadata.
- Storing tool, activity or reasoning messages.
- Deciding which AG-UI message types we expose.
- Anything other than text from the user.
- Turns over 400 KB.
- A later run changing an earlier run's message.
