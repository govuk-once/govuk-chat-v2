# Separate entities for user and assistant messages

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

Fitting those into one entity means either a loose blob that ElectroDB can't
check, or many optional attributes where nothing stops an invalid mix, like a
user message with tool calls.

This comes before the work to store each AG-UI message the agent streams,
which will build on these entities. Defining an entity means listing its
attributes, so this spec lists which AG-UI fields user and assistant messages
store.

Moving messages into a collection changes the key format from the
[pagination spec](./2026-10-21-paginate-thread-messages-in-dynamodb.md). That
is cheap now, because every stack's data is disposable.

Versions referred to below: `@ag-ui/core` 1.0.2
([`types.ts`](https://github.com/ag-ui-protocol/ag-ui/blob/0034593ee0c9678298c6c2a643589c2bedb69099/sdks/typescript/packages/core/src/generated/types.ts)),
the [AG-UI 1.0 spec](https://docs.ag-ui.com/spec/1.0/basic), ag_ui_strands
1.0.2 and ElectroDB 3.9.3.

## Goals

- User and assistant messages are stored as separate ElectroDB entities, each
  with its own required attributes.
- `GET /v1/threads/{threadId}/messages` returns every type of message from one
  query, in order, and paging still works as it does today.
- Reusing a message id in a thread still returns `409`.
- Adding a new message type means adding a new entity, without changing the
  existing ones.

## Non-goals

- Building messages from the event stream, including reopened messages and
  merging metadata. That is later work, which builds on these entities.
- Changing the messages response, including returning `metadata`. That is part
  of the same later work.
- Storing tool, activity or reasoning messages. This spec only shows how they
  fit (see [Adding other message types](#adding-other-message-types)).
- Deciding which AG-UI message types we expose.
- Accepting anything other than text from the user.
- Storing messages over DynamoDB's 400 KB item limit. Text answers are a few
  kilobytes, so this waits for tool messages, which are the likely way to
  reach it. [Adding other message types](#adding-other-message-types) shows
  how it would fit.
- Migrating existing messages. They are discarded.

## Requirements

1. **R1:** Each message in a run is stored as one item, under the same primary
   key as today (`THREAD#${systemThreadId}`, `MESSAGE#${messageId}`).
2. **R2:** User messages are stored as a `userMessage` entity and assistant
   messages as an `assistantMessage` entity, and the `Message` entity is
   removed. Each requires `messageId`, `role`, `content`, `runId`,
   `runStartedAt`, `position`, `createdAt` and `expiresAt`, and rejects any role
   but its own.
3. **R3:** Both entities store an optional `metadata` value as given, without
   checking its shape.
4. **R4:** Reusing a message id in a thread returns `409`, whichever entity
   holds that id. An expired message doesn't block its id.
5. **R5:** `GET /v1/threads/{threadId}/messages` reads every message type
   through one ElectroDB collection, and returns them ordered by `runStartedAt`,
   then by `position`, then by message id.
6. **R6:** The pagination spec's requirements still hold, apart from the order,
   which R5 replaces, and the cursor values, which R11 replaces. A page reads at
   most 101 records, including when DynamoDB's 1 MB limit cuts a request short.
   Following `laterMessagesUrl` doesn't repeat the message at the cursor. The
   response body doesn't change.
7. **R7:** A user message's `createdAt` is the time chat-api received the
   request.
8. **R8:** Adding a message type means defining an entity from the shared
   attributes and indexes and adding it to the service. Existing entities and
   stored items don't change.
9. **R9:** Messages stored before this change aren't returned or migrated.
10. **R10:** Every message in a run has the same `runStartedAt`, which is the
    time chat-api received the request. Each has a `position`, which is its
    place in the order the run's messages arrived.
11. **R11:** A cursor holds `runStartedAt`, `position` and `messageId` in place
    of `createdAt` and `messageId`.

## Design

All of this is in `services/chat-api`. Each AG-UI message in a run is one
item, under the message's own id (R1), so a run that says something, calls a
tool and says more is stored as a user message, an assistant message with the
tool call, a tool message and a second assistant message, in that order.

### Entities

`userMessage` and `assistantMessage` are built from shared attributes and
indexes, and each adds what is its own. ElectroDB entities are config objects,
so spreading a shared object is enough. ElectroDB's types still infer from the
spread when `messageAttributes` and `messageIndexes` are declared `as const`.

```ts
const UserMessage = new Entity({
  model: { service: 'chat-api', entity: 'userMessage', version: '1' },
  attributes: {
    ...messageAttributes,
    role: { type: ['user'] as const, required: true },
    content: { type: 'string', required: true },
  },
  indexes: messageIndexes,
});
```

The AG-UI fields come from `UserMessage` and `AssistantMessage` in `types.ts`:

| AG-UI field      | `userMessage`         | `assistantMessage`      |
| ---------------- | --------------------- | ----------------------- |
| `id`             | `messageId`, required | `messageId`, required   |
| `role`           | `'user'`, required    | `'assistant'`, required |
| `content`        | string, required      | string, required        |
| `metadata`       | `any`, optional       | `any`, optional         |
| `toolCalls`      | not in AG-UI          | not yet                 |
| `name`           | not stored            | not stored              |
| `encryptedValue` | not stored            | not stored              |
| `subagentRunId`  | not stored            | not stored              |

They also keep `systemThreadId`, `runId`, `runStartedAt`, `position`, `createdAt`
and `expiresAt`, which are ours. Today the two entities only differ by `role`. They start to differ
when the agent gets tools.

- **`role`** could be worked out from the entity, but the API returns it and
  the planned feedback endpoint checks it, so it stays.
- **`content`** stays a string. AG-UI allows user content to be a list of
  parts, but we only accept text (`src/schemas/client-input.ts`), and
  assistant content is only a string in AG-UI 1.0. If we accept parts later,
  `content` widens and stored strings stay valid.
- **`metadata`** is `Record<string, any>` in AG-UI, so ElectroDB can store it
  but not check its shape. ag_ui_strands sends citations in it, so it is
  defined now (R3). Nothing writes it until messages are built from events.
- **`name`, `encryptedValue` and `subagentRunId`** aren't sent by the request
  schema or by ag_ui_strands. Each can be added as an optional attribute later
  with no migration.

### Keys and the collection

A collection is ElectroDB's way of querying several entities that share a
partition key in one go. Both entities join a collection called
`threadMessages` on `gsi1`. The index and its fields don't change, but the key
format does:

```ts
byRunOrder: {
  index: 'gsi1',
  collection: 'threadMessages',
  type: 'clustered',
  pk: {
    field: 'gsi1pk',
    composite: ['systemThreadId'],
    template: 'THREAD#${systemThreadId}',
    casing: 'none',
  },
  sk: {
    field: 'gsi1sk',
    composite: ['runStartedAt', 'position', 'messageId'],
    template: 'MESSAGE#${runStartedAt}#${position}#${messageId}',
    casing: 'none',
  },
},
```

`gsi1` moves to key templates, which every other key in `service.ts` already
uses. With a template, ElectroDB adds nothing to the key, so a query's range
bound and the stored key have the same format. `lt` and `gt` then compare
messages directly (R6). `type: 'clustered'` is what makes `lt` and `gt`
available on a collection query. The default `isolated` collection doesn't have
them.

Without templates, a clustered collection doesn't fit paging. ElectroDB 3.9.3
adds the entity name to the end of the stored sort key and leaves it off the
range bound. The stored key `…#messageid_m1#usermessage_1` is greater than the
bound `…#messageid_m1`, so `gt` returns m1 again. That would repeat a message
when paging forwards, breaking the pagination spec's R8.

The template on `gsi1pk` isn't needed for paging. It moves new items to a
different index partition from messages stored before this change, so old
items don't use up a query's `Limit` (R9).

### Message order

Messages sort by `runStartedAt`, then by `position` (R5, R10).

`runStartedAt` is the time chat-api received the request, and every message in
a run has the same value. It orders runs. The run lock already stops two runs
overlapping on a thread.

`position` is a message's place in the order the run's messages arrived. The
user message is 0. `finishRun` already holds a run's messages in that order, so
`position` is the index in its array. It is zero-padded in the key so that it
sorts as a number:

```ts
position: {
  type: 'number',
  required: true,
  readOnly: true,
  padding: { length: 3, char: '0' },
},
```

Three digits are enough, because a run's messages are written in one
transaction, which allows 100 items.

Within a run, order doesn't depend on a clock. AG-UI's order is arrival order,
and `position` stores it. Each message's own time can't do that. ag_ui_strands
sends the results of a parallel tool batch one after another, so chat-api can
process them in the same millisecond. A sort on time would put those in message
id order, which is random.

### Cursors

A cursor holds `direction`, `runStartedAt`, `position` and `messageId`, because
these are the sort key (R11). `getMessagePage` gets them from the records it
reads, so `StoredMessage` gains both new attributes. The handler picks the
response's fields one by one, so neither reaches the response body.

The pagination spec's R6 says a cursor only holds values the client has been
sent. `runStartedAt` and `position` are an exception. Neither is an internal id
or a key format, and clients still treat the token as opaque.

### Reading a page

`getMessagePage` reads the collection with `lt` and `gt` as it does today. Two
things change.

**`count` doesn't apply to a collection query.** Paging uses `limit` and
`count` together (`src/persistence/messages.ts`), so that a request cut short
at 1 MB is followed by another. ElectroDB 3.9.3 only counts entity query
results. On a collection it keeps requesting until the index runs out, which
is the read-everything behaviour pagination replaced. So `getMessagePage`
follows ElectroDB's cursor itself, asking only for what is left. `count` sends
the same `Limit` on every request, so a page cut short can read more than 101
records. This loop can't (R6).

```ts
const readRecords = (limit: number, cursor: string | null) =>
  query.go({ order, limit, cursor });

const records = [];
let cursor: string | null = null;
do {
  const page: Awaited<ReturnType<typeof readRecords>> = await readRecords(
    MESSAGE_PAGE_SIZE + 1 - records.length,
    cursor,
  );
  records.push(...Object.values(page.data).flat());
  cursor = page.cursor;
} while (cursor && records.length <= MESSAGE_PAGE_SIZE);
```

This `cursor` is ElectroDB's, and only the loop uses it. Clients still get the
same opaque cursor.

**Results come back grouped by entity.** A collection query returns
`{ userMessage: [...], assistantMessage: [...] }`, so the order across types
is lost. `getMessagePage` sorts the records by `runStartedAt`, `position` then
`messageId`, in the direction it queried, then carries on as it does today. With
`casing: 'none'` and a padded `position`, this sort matches the key order (R5).

`Object.values` means a new entity needs no change to the loop. ElectroDB's
entity filter still runs after `Limit`, and it still removes nothing, because
`gsi1` only holds messages in this partition.

### Duplicate message ids

Both entities keep the primary key `MESSAGE#${messageId}`. The `check` and the
`put` conditions look at whatever item is at that key, and don't check its
entity. So `beginRun` can use `userMessage.check` and still find an assistant
message with that id (R4). `finishRun`'s conditions and cancellation handling
don't change.

`MessageInput` and `StoredMessage` become unions on `role`, and `finishRun`
picks the entity from `role`. Repositories still don't expose ElectroDB types,
as [ADR 0003](../adr/0003-use-dynamodb-via-electrodb-for-chat-api-persistence.md)
requires.

### Timestamps

No AG-UI message type has a timestamp, and the spec says a consumer "MUST NOT
use" event timestamps to order events
([basic types](https://docs.ag-ui.com/spec/1.0/basic)). So `createdAt` is
ours, from chat-api's clock.

`createdAt` records when a message happened, and clients get it in the response.
It doesn't decide order.

The user message's time moves from after the agent call is accepted to the
start of `invokeAgent` in `src/handlers/threads/invoke.ts`, which is when the
request was received (R7). `runStartedAt` is the same value (R10). The assistant
message's time stays as it is, the time the run finished, because a run has one
assistant message until messages are built from events. That work then gives
each assistant message the time its text finished streaming, at
`TEXT_MESSAGE_END`. ag_ui_strands can attach a tool call to a text message after
that event, and this doesn't change the message's time.

### Adding other message types

None of this is built now. A new type is a new entity with the shared
attributes and indexes (R8).

- **Tool results.** A `toolMessage` entity adds `toolCallId`, `content` and an
  optional `error`.
- **Tool calls.** These aren't a message type in AG-UI. They are a field on
  the assistant message, so `assistantMessage` gains an optional `toolCalls`
  list and `content` becomes optional. Old items stay valid.
- **Activity messages.** An `activityMessage` entity adds `activityType` and a
  `content` object. ElectroDB only compares an attribute's field name across a
  collection, so `content` can be an object on one entity and a string on
  another.
- **Messages over 400 KB.** An S3 pointer would be an optional attribute on
  the entity that needs it, with `content` made optional there. The keys
  don't change.

### Security

This doesn't change who can read or write a message. `metadata` comes from the
agent, ElectroDB doesn't check it, and it counts towards the item size. It is
treated as untrusted data, like `content`, and it isn't logged.

## Alternatives considered

- **One item per answer**, holding the run's AG-UI messages in an array under
  the run id. Order comes from the array, an answer never splits across pages,
  and an answer is the unit V1 attaches feedback to.
  Not chosen because one list shape can't give each message type its own
  required attributes, which is the problem this spec solves. It also reaches
  the 400 KB item limit sooner, because every message and tool result in an
  answer shares one item. `position` gives the same order within a run as the
  array. The ids inside an array also wouldn't be keys, so the duplicate check
  couldn't see them. The cost of one item per message is that a page can split
  an answer, as it can today.
- **One entity with optional attributes.** It needs no key change, but nothing
  stops an invalid mix, which is the problem this spec solves.
- **Query each entity separately and merge.** It needs no collection, but a
  page would need one query per message type.
- **Keep ElectroDB's clustered key format.** The repeated message could be
  dropped in code, at the cost of an extra record on every forward page, or
  avoided with ElectroDB's `compare: 'v2'` option, which moves the bound but
  also adds a filter on `messageId` and `createdAt` separately that would
  drop messages with a lower id. A template is one line per key.
- **Keep `createdAt` in the sort key.** It needs no `runStartedAt`, and a cursor
  would only hold values the client has been sent. But order within a run would
  depend on when each message's time is taken, and messages in the same
  millisecond would sort by id. Adding `position` later would mean rewriting
  stored keys, and this spec already changes them.
- **Add 1 ms to `createdAt` when two messages tie.** Rejected because the
  stored time would no longer be when the thing happened.
- **Migrate existing messages.** They are in short-lived dev stacks, so it
  isn't worth the code.

## Implementation plan

One pull request in `services/chat-api`. The steps depend on each other and
the whole change is small. No CDK changes are needed.

1. Record the user message's time when the request is received, and store
   `runStartedAt` and `position` on each message (R7, R10).
2. Add the clustered collection and key templates to `Message`, the read loop
   and sort to `getMessagePage`, and the new values to the cursor (R5, R6, R9,
   R11).
3. Split `Message` into `userMessage` and `assistantMessage`, with shared
   attributes and indexes. Update `beginRun`, `finishRun`, `MessageInput` and
   `StoredMessage` (R1, R2, R4, R8).
4. Store `metadata` on both entities (R3).
5. Mark this spec implemented.

### Testing

- `src/persistence/messages.test.ts`:
  - records from both entities come back ordered, in ascending and descending
    queries, including messages in a run with the same `createdAt` (R5)
  - a request cut short with a `LastEvaluatedKey` is followed by one asking
    for the remainder, and reading stops at 101 records (R6)
  - the bound in `lt` and `gt` queries equals the stored `gsi1sk` of the
    cursor's message (R6)
  - the existing cursor tests stay, with updated fixtures (R6, R11)
- `src/persistence/runs.test.ts`:
  - `finishRun` writes each role through its own entity, with `metadata` when
    given (R2, R3)
  - `finishRun` gives a run's messages one `runStartedAt`, and each its index as
    `position` (R10)
  - `beginRun`'s check uses the shared primary key, and a failed check is
    `duplicate-message` (R4)
- `src/schemas/message-cursor.test.ts`: the existing tests stay, with the new
  values (R11).
- `src/handlers/threads/invoke.test.ts`: the user message's `createdAt` and the
  run's `runStartedAt` are the time the handler started, using fake timers (R7,
  R10).
- Run `scripts/dev-checks.sh` in `services/chat-api`.
- Manual check in a dev environment, using the pagination spec's steps: build a
  thread of more than 100 messages, page back until `earlierMessagesUrl` is
  absent, then forwards until `laterMessagesUrl` is absent, and check that no
  message is repeated or missing. Then reuse a message id and check for `409`.

### Rollout

No infrastructure changes, because `gsi1` keeps its fields. Existing messages
stop being returned (R9). They stay in the table until they expire or the
stack is deleted, and their ids still return `409`. Cursors from before this
change return `422`, and no client pages yet. Threads carry on, and the
agent still remembers them through AgentCore memory. Every stack is a
short-lived dev stack.

## Risks

- **Clocks decide the order of runs.** Runs sort by `runStartedAt`, which
  depends on Lambda clocks, as `createdAt` does today. Order within a run
  doesn't depend on a clock.
- **Tool-heavy runs.** `finishRun` writes a run in one transaction, which
  allows 100 items and 4 MB, so a run with more than 98 messages fails, ends
  with `RUN_ERROR` and stores nothing. If that becomes realistic, `finishRun`
  would need more than one transaction.
- **Feedback on a run with several assistant messages.** The planned feedback
  endpoint attaches a reaction to a message id and allows one per answer. Once
  a run stores several assistant messages, it needs a rule for which one, or to
  key on the run id instead.
