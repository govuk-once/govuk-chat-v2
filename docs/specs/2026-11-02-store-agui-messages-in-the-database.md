# Store AG-UI messages in the database

**Date:** 2026-11-02

**Status:** accepted

## Problem

When a run finishes, `services/chat-api` joins the text of everything the
agent streamed into one string, and stores it as a single assistant message
with the run id as its id (`MessageAccumulator` in
`src/streaming/message-accumulator.ts`, called from
`src/handlers/threads/invoke.ts`). Any event that isn't text is dropped, and
so are the message ids the agent gave.

That works while the agent sends one text message per run, but:

- a reloaded thread can look different from the one that was streamed. If the
  agent sends two text messages, they come back as one, joined with a blank
  line.
- once the agent calls tools, ag_ui_strands starts a new text message after
  each tool call, and the tool calls and results would be silently lost from
  the history.

`services/demo-ui` already reads `GET /v1/threads/{threadId}/messages` as
AG-UI messages (`fromAgUiMessages` in `src/app/thread-history.ts`). If we store
and return one AG-UI message per message the agent streamed, with its id, a
reloaded thread renders the same as it did live.

This is ticket CHAT-1174. It builds on
[Paginate thread messages in DynamoDB](./2026-10-21-paginate-thread-messages-in-dynamodb.md)
([PR #421](https://github.com/govuk-once/govuk-chat-v2/pull/421)), which
merged on 2026-11-02.

## Goals

- Each text message the agent streams in a run is stored as its own AG-UI
  assistant message, with the agent's id.
- The messages endpoint returns AG-UI message objects, in the order they were
  streamed.
- Tool call and tool result messages can be added later by adding to the
  storage model, not reworking it.

## Non-goals

- Deciding which AG-UI message and event types we support. That's the "What
  AG-UI objects" ticket.
- Handling AG-UI events we don't expect, including text messages with a role
  other than assistant. That has its own ticket.
- Accepting anything other than text from the user.
- Storing tool call, tool result, activity or reasoning messages. This spec
  only shows how they would fit (see
  [Fitting other message types later](#fitting-other-message-types-later)).
- Splitting the Message entity into one entity per message type. That's
  CHAT-1184.
- Migrating existing messages. They can be discarded.

## Requirements

1. **R1:** Each text message the agent streams in a run (a
   `TEXT_MESSAGE_START`, its `TEXT_MESSAGE_CONTENT` deltas and its
   `TEXT_MESSAGE_END`, sharing a `messageId`) is stored as its own assistant
   message. Its id is the agent's `messageId` and its content is the deltas
   joined in the order they arrived.
2. **R2:** The run's user message is stored with the `id`, `role` and
   `content` from the request, as today.
3. **R3:** Within a run, messages are stored with a `createdAt` that is
   strictly later than the one before, in the order the agent started them,
   with the user message first. So the messages endpoint returns them in
   streamed order.
4. **R4:** `GET /v1/threads/{threadId}/messages` returns each message as an
   AG-UI message object, with `id`, `role` and `content`, plus `createdAt`.
5. **R5:** A text message with no content isn't stored, as today. If the agent
   streams no text, only the user message is stored.

## Design

### Which AG-UI events build messages

Some AG-UI events are partial: the agent streams a message in pieces, and the
pieces have to be merged into one message to store it. The table follows the
reference behaviour in `@ag-ui/client`'s `defaultApplyEvents`.

| Events                                        | Message it builds                                                                | How they merge                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT_MESSAGE_START`, `_CONTENT`, `_END`      | One message with `id = messageId`. The role is the event's `role`, or assistant. | `delta`s are appended to `content`                                                                                                                                |
| `TEXT_MESSAGE_CHUNK`                          | Shorthand for start, content and end                                             | Must be expanded first (`transformChunks`)                                                                                                                        |
| `TOOL_CALL_START`, `_ARGS`, `_END`            | A `toolCalls` entry on an assistant message                                      | Attached to the message whose id is `parentMessageId`. Without one, a new assistant message with `id = toolCallId`. `delta`s are appended to `function.arguments` |
| `TOOL_CALL_RESULT`                            | A tool message with `id = messageId` and `toolCallId`                            | Not partial                                                                                                                                                       |
| `REASONING_MESSAGE_START`, `_CONTENT`, `_END` | A reasoning message                                                              | `delta`s are appended to `content`                                                                                                                                |
| `REASONING_ENCRYPTED_VALUE`                   | `encryptedValue` on a message or tool call                                       | Set on the entity named by `entityId`                                                                                                                             |
| `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA`         | An activity message                                                              | A snapshot replaces `content`. A delta applies a JSON Patch to it                                                                                                 |

The agent only sends text messages today. `services/agui-agent` has no tools,
and ag_ui_strands 1.0.2 (the version in `uv.lock`) sends no chunk or activity
events. This spec handles the text message events only. The others are listed
so we can see how they would fit (see
[Fitting other message types later](#fitting-other-message-types-later)).

### Build the messages from the event stream

`MessageAccumulator` is replaced by a class that builds a run's messages from
its events, in `src/streaming/`. It keeps the same `process(event)` shape, so
`invoke.ts` still feeds it from `relayAgentEventStream`'s `onEvent`.

- `TEXT_MESSAGE_START` starts a message with the event's `messageId`, and
  records `createdAt` as the time the event arrived (R1, R3).
- `TEXT_MESSAGE_CONTENT` appends its `delta` to the message with that
  `messageId` (R1).
- Other events don't change the messages, as today.

When the run finishes, `invoke.ts` passes `finishRun` the user message,
followed by the built messages that have content (R2, R5). The assistant
message no longer uses the run id.

#### Order within a run

PR #421 orders a thread's messages by `createdAt`, then by message id. All of
a run's messages are written in one transaction when it finishes, so if two of
them had the same `createdAt` they would be ordered by their random ids. To
keep streamed order, each message's `createdAt` must be later than the one
before it in the run (R3).

The builder takes the time each message started. If that isn't later than the
previous message's `createdAt` (including the user message), it uses the
previous `createdAt` plus one millisecond. It only changes a timestamp when two
messages start in the same millisecond.

### Storage

The `Message` entity in `src/persistence/service.ts` keeps its attributes and
keys. For the message types we store today, an AG-UI message is `id`, `role`
and `content`, and the entity already has those as `messageId`, `role` and
`content`. The only change is that `role` becomes an enum of `user` and
`assistant`, so ElectroDB rejects any other role.

Each message is stored as typed attributes, not as an AG-UI object in one
attribute. ElectroDB can't check what's inside a blob, which is the problem
CHAT-1184 describes.

`MessageInput` in `src/persistence/runs.ts` and `StoredMessage` in
`src/persistence/messages.ts` take `id` and `role` from `@ag-ui/core`'s
`UserMessage` and `AssistantMessage`, with `content` as a string, plus
`createdAt`. For example,
`Pick<AssistantMessage, 'id' | 'role'> & { content: string; createdAt: string }`.
The full AG-UI types are wider than the entity. User `content` can be a list
of content parts, assistant `content` is optional, and both allow fields such
as `metadata` that we don't store. Picking the fields keeps the types to what
the entity accepts. Callers still see no ElectroDB types, as
[ADR 0003](../adr/0003-use-dynamodb-via-electrodb-for-chat-api-persistence.md)
requires.

### Response

The messages endpoint returns each message as `id`, `role` and `content`,
which is a valid AG-UI message, plus `createdAt` (R4). This is the shape it
returns today. What changes is that each message is one the agent streamed,
with the agent's id. So the id a client sees on `TEXT_MESSAGE_START` while
streaming is the id the message is stored under. Today they differ, because
the stored assistant message uses the run id. The feedback endpoint planned
in [PR #382](https://github.com/govuk-once/govuk-chat-v2/pull/382) identifies
a message by its stored id, so clients could send feedback on a message they
have just streamed.

`createdAt` isn't an AG-UI field. We keep it because PR #421's cursor relies
on clients having already been sent each message's `createdAt`. The
`@ag-ui/core` message schemas are `looseObject`s, so a message with an extra
field is still valid AG-UI.

### Fitting other message types later

We don't build any of this now. It shows how other message types fit without
reworking what this spec stores.

The ticket asks that tool call messages fit without a change to the storage
model. We read that as adding to the model, not reworking it. Tool calls add
attributes or entities, and nothing this spec stores has to change or be
migrated.

- **Tool calls.** An assistant message gets an optional `toolCalls` list, and
  `content` becomes optional, because an assistant message can hold tool calls
  and no text. Each tool call is `{ id, type: "function", function: { name,
arguments } }`, which ElectroDB can model as a list of maps. The builder
  attaches a tool call to the message whose id is `parentMessageId`.
  ag_ui_strands sets that to the last text message's id, or leaves it out if no
  text came first. In that case the builder starts a new assistant message
  with `id = toolCallId`, as `defaultApplyEvents` does.
- **Tool results.** A tool message has `id`, `toolCallId` and `content`, and
  gets its `createdAt` like a text message does.
- **Activity messages.** An activity message has `activityType` and structured
  `content`. `ACTIVITY_DELTA` is a JSON Patch, so building these would need a
  JSON Patch library. `content` is an object whose shape depends on
  `activityType`, so it can't go in the string `content` attribute. It would
  be a map attribute on its own entity under CHAT-1184. ElectroDB only checks
  a map's shape when its properties are listed, so we would either list them
  for each activity type or store `content` unchecked.

CHAT-1184 plans one ElectroDB entity per message type. Each would share the
thread partition and PR #421's time-ordered index, so one query returns every
type in order. One thing to know for that ticket: ElectroDB 3.9.3 starts the
sort key of an index in a collection with the collection and then the entity
name, so by default items sort by type before time. A collection of type
`clustered` puts the entity name at the end of the key instead, so items sort
by `createdAt` across types (`_makeKeyFixings` in ElectroDB's
`src/entity.js`). That changes the key format of the existing index, so
messages written before it would need discarding or re-keying.

### Size limits

- **Items.** A DynamoDB item can be at most 400 KB, and each message is one
  item. The agent's `max_tokens` is 4,000, so a text message is far smaller
  than that. Tool results could be bigger, for example when a tool returns
  whole documents. That needs deciding when tool messages are added.
- **Transactions.** `finishRun` writes the run, every message from the run and
  the lock release in one `TransactWriteItems`, which allows 100 items and
  4 MB. So a run can store at most 98 messages. Today a run has two. If
  `finishRun` fails, the run ends with `RUN_ERROR` and nothing is stored, as
  today.

### Security

Message content comes from the agent and is treated as untrusted, as today.
It's stored and returned as data and never interpreted by the API. The
agent's message ids are UUIDs from ag_ui_strands. If one matched a message
already in the thread, `finishRun`'s condition would cancel the transaction
and the run would end with `RUN_ERROR`. No message would be overwritten.

## Alternatives considered

- **Turn `MESSAGES_SNAPSHOT` back on and store that.** ag_ui_strands sends a
  snapshot before `RUN_FINISHED` that holds the agent's messages with their
  streamed ids. But it doesn't send one at all when the agent's AgentCore
  memory holds more messages than the request sent, which is any thread where
  the client only sends its latest message. The snapshot also holds the
  history the client sent, not just this run, so we would have to work out
  which messages are new. And turning it on brings back the duplicate message
  in assistant-ui that `services/agui-agent/src/agui_agent/main.py` turned it
  off for.
- **Use `@ag-ui/client`'s `defaultApplyEvents`.** It is the reference fold of
  events into messages, and handles every message type. But it takes an RxJS
  `Observable` and an `AbstractAgent`. It brings in `rxjs`, `fast-json-patch`,
  `@ag-ui/proto` and a second copy of `zod` (v3). Version 1.0.3 pins
  `@ag-ui/core` to exactly 1.0.3, so chat-api would have to keep its core
  version in step with the client or have two copies. For text messages we
  need a few lines of code. It may be worth revisiting when activity messages
  need JSON Patch.
- **Store each AG-UI object whole in one attribute.** Any message type would
  fit with no change to the entity, but ElectroDB couldn't check what's
  stored, which is the reason for CHAT-1184.
- **Split the Message entity by type here.** That's CHAT-1184. It isn't needed
  for the user and assistant text messages we store today, and it would make
  this change much bigger.
- **Add a sequence number to the index's sort key** to order a run's messages,
  instead of adjusting `createdAt`. That would change PR #421's index and
  cursor for a case that only comes up when two messages start in the same
  millisecond.

## Implementation plan

The work lands in one pull request in `services/chat-api`. It is small, and
each step builds on the one before.

1. Type stored messages from the AG-UI types: `MessageInput` and
   `StoredMessage` with fields picked from `@ag-ui/core`'s types, `role` as an
   enum on the `Message` entity, and the messages handler mapping to them
   (R4).
2. Replace `MessageAccumulator` with the run message builder and its tests,
   and switch `invoke.ts` to store the built messages with the agent's ids
   (R1, R2, R3, R5).
3. Mark this spec implemented.

### Testing

- Builder tests in `src/streaming/`, replacing
  `message-accumulator.test.ts`:
  - two text messages in a run build two messages, each with its own id and
    its deltas joined in order (R1)
  - a message's `createdAt` is when it started. A message that starts in the
    same millisecond as the previous one gets the previous `createdAt` plus
    one millisecond (R3), using fake timers as the persistence tests do.
  - a message with no content isn't returned (R5)
- `src/handlers/threads/invoke.test.ts`: `finishRun` gets the user message
  followed by the built messages, using the agent's ids, not the run id (R1,
  R2, R5).
- `src/handlers/threads/messages.test.ts`: update the existing mapping test
  for the typed messages (R4).
- Run `scripts/dev-checks.sh` in `services/chat-api`.
- Manual check in a dev environment: send a message from `services/demo-ui`,
  reload, and check the thread renders the same. The agent sends one text
  message per run today, so a run with several text messages is only covered
  by the unit tests.

### Rollout

No infrastructure changes. Existing messages are discarded, not migrated.
Messages written before PR #421 aren't in its index, so they aren't returned.
Messages written between PR #421 and this change keep their run id and joined
content until they expire. All of these are in short-lived dev stacks.

If the OpenAPI spec
([PR #400](https://github.com/govuk-once/govuk-chat-v2/pull/400)) lands first,
update its messages response schema in the same pull request.

## Risks

- **Clocks decide the order.** The order within a run now depends on when each
  message started on the Lambda's clock, and across runs on `createdAt`, as
  today. Adjusting `createdAt` by a millisecond means a stored timestamp can
  be up to a few milliseconds later than when the message actually started.
- **Tool-heavy runs.** Once tools are added, a run could have many more
  messages. A run with more than 98, or more than 4 MB of messages, would fail
  to store. If that becomes realistic, `finishRun` would need to write in
  more than one transaction.
- **CHAT-1184 changes the index keys.** Moving messages into a clustered
  collection changes the format of PR #421's sort key. That's cheap while all
  data is in dev stacks, and costly once a stack holds data we must keep.

## Open questions

- **Should messages be split by type now or in CHAT-1184?** This spec keeps
  the one Message entity and leaves the split to CHAT-1184. CHAT-1184 lists
  the AG-UI fields as out of scope and points here, so this order seems to be
  what was intended. For the team to confirm.
- **Does adding to the storage model meet the ticket?** The ticket asks for
  tool calls to fit without a change to the storage model. This spec reads
  that as adding to it, not reworking it (see
  [Fitting other message types later](#fitting-other-message-types-later)).
  For the ticket's author.
- **Should CHAT-1184 come before any stack holds data we must keep?** See
  [Risks](#risks). For the team.
- **Should text message `metadata` be stored?** ag_ui_strands 1.0.2 sends
  citations as `metadata` on content and end events, and AG-UI messages have
  a `metadata` field. Our agent sends none today. For the "What AG-UI objects"
  ticket.
- **How should large tool results be stored?** Over 400 KB won't fit in an
  item. For when tool messages are added.
