# Store thread messages as turns

**Date:** 2026-11-04 · **Status:** accepted

**5-minute read.** The
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
| A messages endpoint returns a flat list of messages        | A turns endpoint returns turns, each holding its messages       |
| Feedback is on each assistant message                      | Feedback is on the assistant turn                               |

We still only store text. Later work builds each AG-UI message from the
agent's events, and stores it in these turns.

## What you'll experience

**Calling the API.** You send a message to `invoke` as now. When the run
finishes, chat-api writes two turns in one transaction, each with an id it
mints. Just before `RUN_FINISHED`, the stream has a `CUSTOM` event with both
turns' ids, so you can give feedback on the answer straight away.
`GET /v1/threads/{threadId}/turns` returns `turns`. Each has an id, a
`sender` of `user` or `assistant`, a `createdAt` and its messages. Assistant
turns also have `feedback` or `feedbackUrl`. Paging works as it does today.
Reusing a message id still returns `409`.

**Using demo-ui.** Nothing changes for the browser. demo-ui's history route
reads `/turns` and lists each turn's messages in order.

**Adding a message type later.** You add its `@ag-ui/core` schema to what a
turn accepts. The keys and stored turns don't change.

## Decisions

### 1. Should user and assistant turns be separate entities?

**Decided**, as `userTurn` and `assistantTurn`, read together
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

### 2. Should the API return turns?

**Decided**, from a turns endpoint that replaces the messages one.

`createdAt`, `sender` and feedback belong to the turn, and no AG-UI message
type has them. Returning turns keeps each message as the AG-UI object we
stored. demo-ui and cloud-tests are the only readers.

- **Alternative:** a flat list of messages, as today. But we'd have to add
  fields to AG-UI messages that their types don't have.

### 3. Should turns have their own ids?

**Decided**, a UUID chat-api mints for each turn.

A turn's id isn't a message id or the run id, as those come from the client
or the agent. A turn can also have no message of its own, like the user turn
of a run that resumes after the user approves a tool. The user message's id
moves to a pointer item, which keeps the duplicate check.

chat-api sends both turns' ids to the browser in one `CUSTOM` event, just
before `RUN_FINISHED`. The browser needs the assistant turn's id to give
feedback. It's the only event chat-api adds to the agent's stream. Sent
after the turns are written, it only ever names stored turns.

- **Alternative:** key both turns by the run id. The browser already has it,
  but it comes from the client, and a turn would need its `sender` as well
  to be unique.

The agent's message ids aren't checked yet, and a follow-up decides how. Our
agent gives each message a new UUID, and never reopens or restates one.

## Know

- **A run is two turns,** not one item per message or one per run. One
  per message could split an answer across pages. One per run would put the
  user's and the agent's fields on one entity, which decision 1 avoids.
- **Messages are checked before they're written,** against `@ag-ui/core`'s
  Zod schemas with `.strict()`, so a message can't have fields its type
  doesn't have. A mismatch fails the run, and nothing is written.
- **An answer with no messages is an error.** The run ends with `RUN_ERROR`,
  and neither turn is written.
- **`createdAt` is ours, from chat-api's clock.** No AG-UI message type has
  a time. The user turn's time moves to just after `beginRun` claims the
  run, so a question always sorts after the answer before it. The assistant
  turn's time is when the run finished, as now. It also stores
  `firstOutputAt`, the time of the agent's first message, but doesn't
  return it.
- **An answer gets one reaction,** as feedback is on the assistant turn.
- **Existing messages are discarded,** not migrated. They're only in
  short-lived dev stacks. Their ids stop returning `409`, and their feedback
  isn't carried over.
- **`metadata` isn't checked.** AG-UI types it as `Record<string, any>`, so
  the schemas keep it without checking its shape. It counts towards the
  400 KB item limit.

## Following precedent

The pagination spec's paging, cursors and page size, with turns in place of
messages. ElectroDB's default key format, as the feedback entity uses. The
existing `gsi1` index, so no table changes. Repositories hide ElectroDB types,
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

## Delivery

Four pull requests. Each adds to the last, so `/messages` keeps working
until the final one removes it.

1. Store turns beside messages.
2. Add the turns endpoint and feedback on turns.
3. Move demo-ui and cloud-tests to `/turns`.
4. Remove `Message`, `/messages` and the old feedback endpoint.

---

## Build sheet

Reference for the implementer. It records agreed facts, not arguments.

Versions: `@ag-ui/core` 1.0.3, the
[AG-UI 1.0 spec](https://docs.ag-ui.com/spec/1.0/basic), Zod 4.6.7,
ElectroDB 3.9.3.

### Steps

**Pull request 1: store turns beside messages.**

1. Take the user turn's time just after `beginRun` claims the run, in
   `src/handlers/threads/invoke.ts`.
2. Record the time of the first `TEXT_MESSAGE_START` in
   `MessageAccumulator`.
3. Add `src/schemas/turn-messages.ts`.
4. Add the `userTurn`, `assistantTurn` and `messagePointer` entities.
   `finishRun` writes them beside the `Message` items, in the same
   transaction.
5. Fail a run with no messages.

**Pull request 2: the turns endpoint and feedback on turns.**

1. Add `getTurnPage`, the turn cursor and the turns handler.
2. Add feedback on assistant turns, with its handler.
3. Send both turns' ids in a `CUSTOM` event.
4. Add both routes and lambdas in `cdk/src/stacks/chat-api-stack.ts`.

**Pull request 3: move the readers.** Read `/turns` in demo-ui's history
route and in cloud-tests.

**Pull request 4: remove the old code.**

1. Switch `beginRun`'s duplicate check to `messagePointer`.
2. Remove `Message`, `getMessagePage`, the messages and old feedback
   handlers, and their routes and lambdas.
3. Mark this spec implemented.

### Entities

In `services/chat-api/src/persistence/service.ts`. They replace `Message`,
which pull request 4 removes:

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

- each turn's `turnId` is a UUID that `finishRun` mints with
  `crypto.randomUUID()`
- `runId` is the run id, on both turns

A message pointer maps the user message's id to its turn, for the duplicate
check:

```ts
const MessagePointer = new Entity({
  model: { service: 'chat-api', entity: 'messagePointer', version: '1' },
  attributes: {
    systemThreadId: { type: 'string', required: true },
    messageId: { type: 'string', required: true },
    turnId: { type: 'string', required: true, readOnly: true },
    expiresAt: { type: 'number', required: true },
  },
  indexes: {
    primary: {
      pk: { field: 'pk', composite: ['systemThreadId'] },
      sk: { field: 'sk', composite: ['messageId'] },
    },
  },
});
```

`finishRun` writes the run, both turns and the user message's pointer, and
deletes the run lock, in one transaction. The pointer is conditioned on
being absent or expired.

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

Today's assistant turn holds one assistant message: the id of the agent's
last text message, and the joined text as its content, as `invoke` stores it
now.

### Keys and order

- `gsi1` keeps its fields. Both entities join the clustered collection
  `threadTurns`.
- Sort keys on `gsi1` start `$threadturns#`, not `$message_1#`, so a
  collection query never reads stored messages.
- Turns sort by `createdAt`, then turn id.
- Within an assistant turn, messages keep the order they arrived in.

### Reading a page

`getTurnPage` replaces `getMessagePage`, and `TURN_PAGE_SIZE` replaces
`MESSAGE_PAGE_SIZE`. `getTurnPage`:

1. Queries `threadTurns` with the same `limit` as today, and no `count`.
2. On a forward page, drops the turn at the cursor, which `gt` returns,
   before counting turns.
3. Queries again from the returned cursor until it has 101 turns or there
   are none left.
4. Merges `{ userTurn: [...], assistantTurn: [...] }` by `createdAt`, then
   turn id.
5. Reads reactions with `readFeedback`, using the assistant turns' ids.

A page returns up to 100 turns, or 50 runs, with `earlierTurnsUrl` and
`laterTurnsUrl` in place of `earlierMessagesUrl` and `laterMessagesUrl`.

### Response

`GET /v1/threads/{threadId}/turns`, from `src/handlers/threads/turns.ts`:

```json
{
  "turns": [
    {
      "id": "d0000000-0000-4000-8000-000000000001",
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
      "id": "e0000000-0000-4000-8000-000000000001",
      "sender": "assistant",
      "createdAt": "2026-11-09T10:00:03.500Z",
      "messages": [
        {
          "id": "c0000000-0000-4000-8000-000000000001",
          "role": "assistant",
          "content": "You can renew your passport online on GOV.UK."
        }
      ],
      "feedbackUrl": "/v1/threads/…/turns/e0000000-0000-4000-8000-000000000001/feedback"
    }
  ],
  "earlierTurnsUrl": "/v1/threads/…/turns?cursor=…",
  "laterTurnsUrl": "/v1/threads/…/turns?cursor=…"
}
```

Each message keeps its own AG-UI `role`. `firstOutputAt` isn't returned.

### Cursor

`src/schemas/message-cursor.ts` becomes `turn-cursor.ts`. It holds
`direction`, `createdAt` and `turnId`, in place of `messageId`.

### Turn ids in the stream

The relay in `src/streaming/agent-event-stream.ts` already waits for
`finishRun` before it sends `RUN_FINISHED`. `finishRun` returns both turns'
ids, and the relay sends this just before `RUN_FINISHED`:

```json
{
  "type": "CUSTOM",
  "name": "turnIds",
  "value": {
    "userTurnId": "d0000000-0000-4000-8000-000000000001",
    "assistantTurnId": "e0000000-0000-4000-8000-000000000001"
  }
}
```

A run that fails sends `RUN_ERROR` and no `CUSTOM` event.

### Duplicate check

- `beginRun` checks for a `messagePointer` with the user message's id, in
  the same transaction as today.
- A failed check is `duplicate-message`, returning `409`.
- An expired pointer doesn't block its id.

### Feedback

- `POST /v1/threads/{threadId}/turns/{turnId}/feedback` takes the assistant
  turn's id.
- The feedback entity's key becomes `turnId`, as version 2 of the entity, so
  the old endpoint keeps version 1 until pull request 4.
- The transaction's check moves from a message's `role` being `assistant` to
  the `assistantTurn` existing, unexpired.
- `feedback` and `feedbackUrl` move from the assistant message to the
  assistant turn.

### Timestamps

- User turn `createdAt`: just after `beginRun` returns.
- Assistant turn `createdAt`: when `RUN_FINISHED` arrives and `finishRun`
  runs.
- Assistant turn `firstOutputAt`: `MessageAccumulator` records the first
  `TEXT_MESSAGE_START`. `invoke` passes it to `finishRun`.

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

- If the agent sends no messages, `invoke` fails the run before
  `finishRun`. The run ends with `RUN_ERROR`, and nothing is written.
- If a turn's messages don't match its schema, throw before the write. The
  run ends with `RUN_ERROR`.
- If the run fails or the stream stops before `RUN_FINISHED`, write
  nothing. A client disconnecting stops the stream.
- If a turn is over 400 KB, the write fails and so does the run.

### Checks

- `src/schemas/turn-messages.test.ts`:
  - pass: one user message in a user turn; assistant messages in an
    assistant turn
  - fail: an assistant message in a user turn; a user message in an
    assistant turn; two user messages; a field the type doesn't have
- `src/streaming/message-accumulator.test.ts`: the first output time is the
  first `TEXT_MESSAGE_START`'s time, and absent before one.
- `src/streaming/agent-event-stream.test.ts`: the `CUSTOM` event carries
  both turns' ids, comes just before `RUN_FINISHED`, and isn't sent on a
  failed run.
- `src/persistence/runs.test.ts`:
  - `finishRun` writes a `userTurn` and an `assistantTurn` under new ids,
    and a `messagePointer` for the user message
  - a turn that fails its schema isn't sent
  - `beginRun` checks the pointer, and a failed check is
    `duplicate-message`
- `src/handlers/threads/invoke.test.ts`:
  - the user turn's `createdAt` is the time the claim returned, with fake
    timers
  - a run with no messages ends with `RUN_ERROR`
- `src/persistence/turns.test.ts`: the paging tests from `messages.test.ts`,
  with turn fixtures and `$threadturns` sort keys. Add:
  - turns merge in `createdAt` order, then turn id
  - a short response is followed by another query from its cursor
  - a forward page leaves out the cursor's turn
- `src/handlers/threads/turns.test.ts`: turns returned in order with their
  fields, and feedback on assistant turns.
- `src/schemas/turn-cursor.test.ts`: the tests from `message-cursor.test.ts`,
  with `turnId`.
- The turn feedback handler's tests, from the feedback handler's.
- `src/persistence/feedback.test.ts`: feedback is written under the
  assistant turn's id, only if that turn exists and hasn't expired, and a
  second reaction is refused.
- `services/demo-ui/src/app/api/chat/messages/route.test.ts`: each turn's
  messages returned in order.
- `cloud-tests/src/api/thread-journey.test.ts`: a run stores a user turn
  and an assistant turn.
- `cdk/src/stacks/chat-api-stack.test.ts`: the turns and turn feedback
  lambdas and routes.
- `scripts/dev-checks.sh` in each package changed.
- Manually, in a dev environment, with the pagination spec's steps:
  - build a thread of more than 100 turns
  - page back until `earlierTurnsUrl` is absent, then forward until
    `laterTurnsUrl` is absent
  - check no turn is repeated or missing
  - reuse a message id and check for `409`
  - give feedback on a just-streamed answer, using the `CUSTOM` event's assistant turn id

### Rollout

- CDK adds the turns and turn feedback lambdas and routes in pull request
  2, and removes the messages ones in pull request 4. The table doesn't
  change.
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
- Checking the agent's message ids.
- A later run changing an earlier run's message.
