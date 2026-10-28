# Store end users' feedback on answers

**Date:** 2026-10-19

**Status:** accepted

## Problem

GOV.UK Chat V1's API lets an end user give feedback on an answer, and the
Chat API has no equivalent (CHAT-1119). The Chat API needs it to reach parity
with V1.

V1 calls this feedback a reaction. A reaction is either positive or negative,
and an answer accepts at most one. V1 records it with
`POST /conversation/{conversation_id}/answers/{answer_id}/feedback`, which
returns:

- `201` with `{}` once recorded
- `409` if the answer already has feedback
- `404` if the answer isn't found in the end user's conversation
- `422` if the reaction is invalid

Each answer in V1's API then carries either the `feedback` given or a URL to
give it.

V1 also changed how its rate limits are split when it added feedback
([alphagov/govuk-chat@5947797](https://github.com/alphagov/govuk-chat/commit/594779773ebf76a30608975f6e3d879850003518)).
Before that, its limits were split by HTTP method, so giving feedback used up
the same tight allowance as asking a question. The limits are now split by
cost. Requests that call a model fall into a tight "conversation write"
bucket, and every other request, including feedback, falls into a more
generous default bucket:

| Discriminator | Conversation write limit | Default limit   |
| ------------- | ------------------------ | --------------- |
| API client    | 900 a minute             | 10,800 a minute |
| End user      | 15 a minute              | 180 a minute    |

The Chat API only has the conversation write limits. Each end user can send 15
`POST /v1/threads/invoke` requests a minute, enforced by a WAF rule. A
stage-wide throttle of 15 requests a second stands in for V1's per-client
write limit, because Chat UI is the only client (CHAT-968). That throttle
counts every request, not just invoke, and nothing limits an end user's other
requests. Adding feedback without the default buckets would mean reactions
eat into the allowance for asking questions, which is the problem V1 fixed.

## Goals

- An end user can give a positive or negative reaction to an assistant
  message in one of their threads, once, with the same outcomes as V1.
- A client listing a thread's messages can see which assistant messages have
  feedback and what it was, or where to give it.
- Rate limits are split by cost in the same way as V1, so giving feedback
  doesn't use up an end user's or client's allowance for invoking the agent.

## Non-goals

- Changing or removing feedback once given. A reaction is written once and
  stays until it expires.
- Chat UI changes. Chat UI won't offer feedback or show it yet.
- Truly per-client rate limits. They're approximated with per-method stage
  throttles (see [Rate limits](#rate-limits-r9r10)), which we expect to
  revisit once there's more than one client, such as a web and a mobile app.
- V1's `Govuk-*-RateLimit-*` response headers, and its alerts when a client
  or end user reaches 75% of a limit.

## Requirements

1. **R1:** `POST /v1/threads/{threadId}/messages/{messageId}/feedback` with a
   body of `{ "reaction": "positive" }` or `{ "reaction": "negative" }`
   records that reaction against an assistant message in the end user's
   thread, with the time it was given, and returns `201` with `{}`.
2. **R2:** The endpoint returns `404` without recording anything when the
   thread doesn't exist or doesn't belong to the end user in the `end-user-id`
   header, or when the message doesn't exist in that thread, has expired, or
   isn't an assistant message.
3. **R3:** The endpoint returns `409` without changing the stored reaction
   when the message already has one, including when two submissions for the
   same message race.
4. **R4:** The endpoint returns `422` when the `end-user-id` header,
   `threadId` or `messageId` isn't a UUID, or when the body has no reaction,
   an unrecognised reaction or any other field.
5. **R5:** The check that the message exists, hasn't expired and is from the
   assistant, and the write of the reaction on condition that the message has
   none, happen in one DynamoDB transaction.
6. **R6:** A reaction expires a year after it is given. It doesn't take the
   expiry of the message it is for.
7. **R7:** In `GET /v1/threads/{threadId}/messages`, an assistant message
   with a reaction has
   `"feedback": { "reaction": ..., "createdAt": ... }` and no `feedbackUrl`.
   An assistant message without one has a `feedbackUrl` that is the relative
   path to give feedback on it, and no `feedback`. User messages have
   neither.
8. **R8:** The feedback endpoint requires the same Cognito authorisation and
   scope as the other endpoints.
9. **R9:** Each end user, identified by the `end-user-id` header, can send 15
   `POST /v1/threads/invoke` requests a minute and 180 other requests a
   minute, such as listing messages or giving feedback. Each request counts
   towards exactly one of these limits, and a request over either one
   receives `429` with the API's usual error body.
10. **R10:** The stage accepts 15 `POST /v1/threads/invoke` requests a second
    (V1's 900 a minute per client) and 180 other requests a second, such as
    listing messages or giving feedback (V1's 10,800 a minute per client),
    each with a burst of twice its rate.
11. **R11:** The `chat-api` README documents the feedback endpoint, the
    feedback fields on messages, and the rate limits. It says that the
    per-client limits apply to the whole stage, not to each client.
12. **R12:** Every field in the API's responses is camel case.
    `GET /v1/threads/{threadId}/messages` returns `earlierMessagesUrl` in
    place of `earlier_messages_url`.

## Design

### Identifying the message

The `messageId` in the path is the `id` of a message as `GET .../messages`
returns it, and the feedback is looked up and stored against that stored
message id. Message ids are UUIDs, so `messageId` is validated as one. A
message that hasn't been stored yet gets a `404`.

### Endpoint (R1–R4, R8)

A new handler, `handlers/threads/feedback.ts`, follows the shape of
`handlers/threads/messages.ts`. It's a middy stack with
`httpHeaderNormalizer`, `httpJsonBodyParser`, and the zod validators for the
header, path parameters and body, ending in `jsonHttpErrorHandler`. The
schemas go in `schemas/client-input.ts`, and the body schema is `.strict()`
like the others. Validation failures return `422`, as the zod validators
already do.

The handler resolves the thread with `lookupThread`, as listing messages
does. A thread that is missing, expired or another end user's returns `404`
without revealing whether it exists. The handler then calls the repository
and maps its outcome to a response through a `Record` of outcome to status
and message, as `invoke.ts` does for run claims:

- `recorded` returns `201` with `{}`
- `message-not-found` returns `404`. That includes a user message, as in V1,
  where only answers can be found by that route.
- `already-provided` returns `409`, whether the message already had a
  reaction or another submission for it won a race

Persistence errors are logged with the client's thread id and message id,
and return a generic `500`.

The route sits under the existing `{threadId}/messages` resource, as
`{messageId}/feedback`, and inherits the Cognito authoriser and scope from the
API's `defaultMethodOptions`. The feedback lambda gets `CHAT_API_TABLE_NAME`
and `grantReadWriteData` on the table, because its transaction checks the
message as well as writing the reaction.

### Storage (R5, R6)

Following [ADR 0003](../adr/0003-use-dynamodb-via-electrodb-for-chat-api-persistence.md),
a reaction is a new `feedback` entity in the ElectroDB service in
`persistence/service.ts`, beside the message it belongs to:

| Attribute   | Value                                |
| ----------- | ------------------------------------ |
| `pk`        | `THREAD#${systemThreadId}`           |
| `sk`        | `FEEDBACK#${messageId}`              |
| `reaction`  | `positive` or `negative`             |
| `createdAt` | ISO 8601 time the reaction was given |
| `expiresAt` | a year after `createdAt`             |

A reaction is a record of its own, not an attribute on the message. That
keeps messages write-once, as `finishRun` leaves them, and makes
one-per-message a `create` on a key of its own.

A new repository, `persistence/feedback.ts`, exposes
`recordFeedback(key, reaction)`, which returns a discriminated union of
`recorded`, `message-not-found` or `already-provided`, so that callers never
see keys or cancellation codes.

It writes the reaction in one DynamoDB transaction of two actions, which
either both take effect or neither does:

- a condition check on the message, using ElectroDB's `check`, which writes
  nothing. The message must exist, have an `expiresAt` after now and have the
  `role` `assistant`. DynamoDB's TTL can take days to delete an item after
  its `expiresAt`, so an expired message counts as absent even while it is
  still in the table, as in the other repositories.
- a `create` of the reaction, with `expiresAt` set from the shared
  `RETENTION_PERIOD_IN_SECONDS` (R6). ElectroDB's `create` only writes if no
  item with the same key exists, so a second reaction fails instead of
  overwriting the first. The other repositories write with `put` and
  `absentOrExpired`, which also lets them replace an item that has expired
  but not yet been deleted. A reaction doesn't need that. A reaction always
  expires after its message, so once one has expired, the check on the
  message has already failed.

The cancellation reasons come back in action order. A failed condition on the
message returns `message-not-found`, whether the message is missing, has
expired or is a user message. A failed condition or a `TransactionConflict`
on the reaction returns `already-provided`. A conflict there means another
submission for the same message, such as a double-click, was being written at
the same time, and the other repositories also treat `TransactionConflict` as
a lost race. Any other cancellation throws.

The message doesn't need reading first, because the reaction takes nothing
from it, and the condition check covers every reason it can't take feedback.

### Feedback on messages (R7)

`getMessages` in `persistence/messages.ts` reads the thread's reactions as
well as its messages. It runs a second ElectroDB query, on the `feedback`
entity in the thread's partition, in parallel with the existing one on
`message`. It attaches each reaction to its message as an
optional `feedback` on `StoredMessage`. `sliceMessages` pages as it does
today.

The messages handler adds the fields to each assistant message:

```json
{
  "id": "…",
  "role": "assistant",
  "content": "…",
  "createdAt": "…",
  "feedback": { "reaction": "positive", "createdAt": "…" }
}
```

or, before feedback is given:

```json
{
  "id": "…",
  "role": "assistant",
  "content": "…",
  "createdAt": "…",
  "feedbackUrl": "/v1/threads/…/messages/…/feedback"
}
```

`feedbackUrl` is relative and built from the client's `threadId`, like
`earlierMessagesUrl`.

All response fields are camel case (R12), matching the message's own
`createdAt`. The only existing exception, `earlier_messages_url`, is renamed
to `earlierMessagesUrl`. That breaks any client reading it, but Chat UI
doesn't: its messages route passes only `messages` on to the browser, and
the old name appears only in a test fixture
(`services/chat-ui/src/app/api/chat/messages/route.test.ts`).

### Rate limits (R9–R10)

**Per end user (R9).** The web ACL gains a second WAF rate rule. It limits
each `end-user-id` to 180 requests a minute and is scoped down to requests
that are _not_ `POST .../v1/threads/invoke`. Both rules share one invoke
match statement, so the two buckets can't drift apart and every request falls
into exactly one of them. An endpoint added later falls into the default
bucket without changing the rules. As today, requests without an
`end-user-id` header aren't counted, and the handlers reject them with `422`.

**Per client (R10).** WAF can't identify the API client: the Cognito access
token in the `Authorization` header is rotated hourly, and WAF can't read its
claims. Instead, the stage's default throttle rises to 180 requests a second,
with a burst of 360. A method-level throttle in the stage's `methodOptions`
keeps `POST /v1/threads/invoke` at 15 a second with a burst of 30. The bursts
keep the existing ratio of twice the rate. While Chat UI is the only client,
this is equivalent to V1's per-client limits. With more than one client, the
limits are shared between them, so they will need revisiting when a second
client such as a mobile app arrives. The `RATE_LIMITS` constant and its
CHAT-968 comment in the stack are updated to say this.

### Security and privacy

- Ownership is checked through `lookupThread`, the same way as listing
  messages, so an end user can't give or see feedback on another end user's
  messages, or learn whether they exist.
- Reactions are retained for a year after they are given, so a reaction can
  outlive the message it is for.

## Alternatives considered

- **Storing the reaction as an attribute on the message.** Listing messages
  would return it without a second query. Rejected because it makes a
  write-once record mutable, and telling a missing message from an existing
  reaction would rely on the failed condition's returned item rather than
  separate cancellation reasons.
- **Expiring a reaction with its message**, by copying the message's
  `expiresAt`. Rejected after team discussion in favour of a year from when
  the reaction is given.
- **Checking the message by reading it, then writing the reaction in a
  single-item transaction.** Rejected in favour of checking the message
  inside the transaction, so the guarantee doesn't depend on messages never
  changing.
- **Returning `422` for feedback on a user message.** Rejected to match V1,
  which returns `404`.
- **An ElectroDB collection query** to read messages and reactions in one
  request, as ADR 0003 anticipates. Not chosen here because it means adding a
  collection to the existing `message` entity's index. Two parallel queries
  leave existing entities untouched.
- **A batch get of the reactions for the page's assistant messages**, using
  ElectroDB's `get` with an array of keys. It reads fewer items on long
  threads. Rejected because it can't start until the messages have been
  read, and `BatchGetItem` can return unprocessed keys that would need
  retrying. A query of the thread's reactions runs in parallel and matches
  how messages are already read.
- **Truly per-client limits**, such as API Gateway usage plans with an API
  key for each Cognito app client. Deferred until there is more than one
  client.

## Implementation plan

Each step is one commit with its tests.

1. **Store reactions to assistant messages** (R5, R6). Add the `feedback`
   entity to `persistence/service.ts` and `recordFeedback` in a new
   `persistence/feedback.ts`, with `persistence/feedback.test.ts`.
2. **Add a handler for feedback on assistant messages** (R1–R4). Add the path
   parameter and body schemas to `schemas/client-input.ts`, and
   `handlers/threads/feedback.ts` with its test.
3. **Expose the feedback endpoint through API Gateway** (R1, R8, R11). Add
   the lambda, its table grant and the `{messageId}/feedback` route to
   `cdk/src/stacks/chat-api-stack.ts`, with stack tests. Add a Feedback
   section to the `chat-api` README.
4. **Rename `earlier_messages_url` to `earlierMessagesUrl`** (R12). Update
   `handlers/threads/messages.ts` and its test, and the fixture in Chat UI's
   `src/app/api/chat/messages/route.test.ts`.
5. **Return feedback with messages** (R7, R11). Read reactions in
   `getMessages` and add `feedback` or `feedbackUrl` in
   `handlers/threads/messages.ts`, with tests. Describe the fields in the
   README.
6. **Rate limit end users' other requests** (R9, R11). Add the default WAF
   rule and share the invoke match with the existing rule, with stack tests.
   Update the README's rate limits.
7. **Throttle invoke separately from other requests** (R10, R11). Raise the
   stage throttle, add the invoke method throttle, update `RATE_LIMITS` and
   its comment, with stack tests. Update the README's rate limits, including
   that the per-client limits apply to the whole stage.

### Testing

Unit tests, run by `services/chat-api/scripts/dev-checks.sh` and
`cdk/scripts/dev-checks.sh`, follow the existing patterns: the mocked
`DynamoDBDocumentClient` in `src/test-utils/dynamodb.ts`, assertions on the
ElectroDB command input, and `apiGatewayProxyEventFixture` for handlers.

- R5, R6: `persistence/feedback.test.ts` asserts that the transaction holds
  the condition check on the message and the `create` of the reaction, and
  that the reaction's `expiresAt` is a year after it is given.
- R2, R3: the same test covers each outcome: a failed condition on the
  message, and a failed condition or `TransactionConflict` on the reaction.
  It also covers an unexpected cancellation throwing.
- R1–R4: `handlers/threads/feedback.test.ts` covers `201`, the `404` for an
  unknown thread, each outcome's status, the `422` validation cases that the
  schema handles, and the `500` on persistence errors. The schema tests in
  `schemas/client-input.test.ts` cover the reaction values and strictness.
- R12: the existing `earlier_messages_url` tests in
  `handlers/threads/messages.test.ts` assert `earlierMessagesUrl` instead.
- R7: `persistence/messages.test.ts` covers attaching reactions to their
  messages. `handlers/threads/messages.test.ts` covers an assistant message
  with feedback, one without, and a user message.
- R8–R10: `cdk/src/stacks/chat-api-stack.test.ts` asserts the feedback
  resource path and its Cognito auth, the lambda's environment and table
  access, the default WAF rule's limit and scope-down, and the stage and
  invoke throttles.
- Manual check in a dev environment, using `scripts/api-curl.sh`: invoke a
  thread, list its messages, give feedback on the assistant message's `id`,
  give it again for `409`, give it on the user message's `id` for `404`, and
  list messages again to see `feedback` and `feedbackUrl`.

## Risks

- **Stage throttles are shared once there is a second client**, so one client
  could use up another's allowance. Accepted for now, and recorded in the
  README and the `RATE_LIMITS` comment so it is revisited before a second
  client goes live.
- **Raising the stage throttle to 180 requests a second** lets more
  non-invoke traffic reach the lambdas and DynamoDB. The per-end-user WAF
  rules still bound each end user, and none of these requests call a model.
