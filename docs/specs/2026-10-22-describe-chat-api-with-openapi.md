# Describe the Chat API with an OpenAPI spec

**Date:** 2026-10-22

**Status:** accepted

## Problem

The Chat API's contract (what it accepts and returns) isn't written down in one
place:

- Requests are described by the Zod schemas that validate them, in
  `services/chat-api/src/schemas/client-input.ts`.
- Response bodies only exist in the handler code, in
  `services/chat-api/src/handlers/threads/`.
- Responses produced by AWS rather than by our code (failed authentication,
  rate limiting) are only described in the CDK stack and the README.
- `chat-ui` keeps its own copies of the types, in
  `services/chat-ui/src/chat-api/client.ts`.

Nothing keeps these in step, so a change in one can quietly break another.

Other teams building clients need a reliable description of the API to work
from. The closest thing we have is the [draft API spec][draft]. It was
deliberately loose, it no longer matches what we built, and it was removed with
`chat-api-fastapi`. Chat V1 has an [OpenAPI spec][v1-openapi] that we link
teams to, and we want the same for V2.

We're also about to change the contract in several ways: storing AG-UI objects
rather than a string, streaming more kinds of AG-UI event, and adding a
feedback endpoint. If the OpenAPI spec exists first, each of those changes
updates one source of truth.

[draft]: https://github.com/govuk-once/govuk-chat-v2/blob/3771432e642ee7f84af04623548ce1f947ba01bd/services/chat-api-fastapi/api-spec.md
[v1-openapi]: https://github.com/alphagov/govuk-chat/blob/6c81d98a30cc6ab722def53217723262884c81d3/docs/api_openapi_specification.yml

## Goals

- Client teams have one accurate description of the V1 API to work from,
  linked from GitHub.
- The OpenAPI spec can't drift from the code without CI failing.
- We have a record of how the draft API spec compares with what we built, so
  nobody mistakes the draft for the current design.

## Non-goals

- Changing what the API accepts or returns. Inconsistencies this work has found
  are listed in
  [Inconsistencies to raise separately](#inconsistencies-to-raise-separately),
  to be raised as their own tickets.
- Publishing or hosting the OpenAPI spec. We'll link teams to the file on
  GitHub.
- Generating `chat-ui`'s client types from the OpenAPI spec. This is a possible
  follow-up.
- Describing endpoints we haven't built yet, including the planned feedback
  endpoint.

## Requirements

1. **R1:** This spec records, for each endpoint in the draft API spec, whether
   we built it, decided against it, or may add it later. At the time of
   writing, none has been decided against.
2. **R2:** `services/chat-api/openapi.yaml` is an OpenAPI 3.2 document
   describing `POST /v1/threads/invoke`: the `end-user-id` header, the request
   body, the `200` `text/event-stream` response, and the `409`, `415`, `422`,
   `429` and `500` error responses. The stream lists the AG-UI events clients
   receive today: `RUN_STARTED`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`,
   `TEXT_MESSAGE_END`, `RUN_FINISHED` and `RUN_ERROR`.
3. **R3:** The document describes `GET /v1/threads/{threadId}/messages`: the
   `end-user-id` header, the `threadId` path parameter, the `before` query
   parameter, the paginated `200` response, and the `404`, `422`, `429` and
   `500` error responses.
4. **R4:** The document describes authentication as a bearer token, applies
   it to every operation, and describes the responses for failing it. Its
   description explains how to get a token from Cognito today (client
   credentials, scope `chat-api/invoke`), and that this is temporary.
5. **R5:** The shared error body shapes, `{ error }` and `{ error, details }`,
   are reusable components that every error response refers to.
6. **R6:** The document is generated from the Zod schemas the API uses.
   Requests use the schemas the validators already run. Response bodies get
   their own Zod schemas, and the handlers' response types are derived from
   them, so a handler that returns a different shape fails type checking.
7. **R7:** `services/chat-api/scripts/generate-openapi.sh` regenerates
   `openapi.yaml`.
8. **R8:** A unit test fails when the committed `openapi.yaml` differs from
   what generation produces.
9. **R9:** CI fails when `openapi.yaml` isn't a valid OpenAPI 3.2 document.
10. **R10:** The Chat API README links to `openapi.yaml` and says how to
    update it.
11. **R11:** The API's behaviour doesn't change. The existing handler tests
    pass without changes to their assertions.

## Design

### How the draft compares with what we built (R1)

The draft described conversations, made up of messages, that could branch when
a user edited or regenerated a message. What we built is smaller. A
conversation is a **thread**, and an AG-UI run adds a user message and the
assistant's reply to it. There is no branching. Two endpoints cover what we
need today: starting or continuing a thread, and reading back its messages.

| Draft endpoint                                      | Outcome            | What we built, or why not                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /conversations`                               | Built, differently | `POST /v1/threads/invoke`. The client sends an AG-UI `RunAgentInput` with its own `threadId`, `runId` and message ids, which must be UUIDs. The first run on a `threadId` creates the thread. The API doesn't generate a name for the thread. |
| `POST /conversations/{id}/messages`                 | Built, differently | The same `POST /v1/threads/invoke` endpoint. A `threadId` the end user has used before continues that thread.                                                                                                                                 |
| `GET /conversations/{id}/messages`                  | Built, differently | `GET /v1/threads/{threadId}/messages`. It returns up to 50 messages, oldest first, ending with the most recent. `earlier_messages_url` links to the page before, so clients can page backwards but not forwards.                              |
| `GET /conversations`                                | May add later      | Users can't choose from a list of their conversations yet, so there is nothing to list.                                                                                                                                                       |
| `GET /conversations/{id}`                           | May add later      | Not needed without a list of conversations: a thread has no data of its own, other than its messages.                                                                                                                                         |
| `PATCH /conversations/{id}` (rename)                | May add later      | Conversations aren't named, because users don't choose from a list of them.                                                                                                                                                                   |
| `DELETE /conversations/{id}`                        | May add later      | Not built. Threads expire a year after their last message.                                                                                                                                                                                    |
| `DELETE /conversation-stream/{id}` (stop a stream)  | May add later      | We're likely to add cancelling a run.                                                                                                                                                                                                         |
| `POST /conversations/{id}/messages/{id}/regenerate` | May add later      | We're likely to add regenerating a response.                                                                                                                                                                                                  |
| `PATCH /conversations/{id}/messages/{id}` (edit)    | May add later      | Not built. Editing a message branches the conversation, and nothing we've built supports branching yet.                                                                                                                                       |

What we built also answers several of the draft's open points:

- **Authentication** uses Cognito for now, through the OAuth 2.0 client
  credentials flow with the `chat-api/invoke` scope. This is only for
  development. We expect clients to arrive with a token that we check with
  another service, Flex, instead.
- **Versioning**: routes have a `/v1` prefix.
- **End users** are identified by an `end-user-id` header, which must be a
  UUID, rather than an `end_user_id` value.
- **Rate limits** are applied at the API Gateway, before the Lambda runs (see
  the README's "Rate limits" section).
- **Streamed responses** are AG-UI events. `RUN_STARTED`, `RUN_FINISHED` and
  `RUN_ERROR` take the place of the draft's start, stop and error events.
- **Concurrent messages**: a thread runs one message at a time. A second run,
  or a reused run or message id, gets `409`.
- **Persistence** matches the draft. Nothing is stored until the run finishes,
  and nothing is stored for a run that ends in an error.

### Inconsistencies to raise separately

Writing the OpenAPI spec describes these as they are. Each one should be raised
as its own ticket:

- `earlier_messages_url` is snake_case, while every other field is camelCase
  (`services/chat-api/src/handlers/threads/messages.ts`).
- `earlier_messages_url` starts with `/v1/`. API Gateway serves the API under a
  stage path (`stageName: props.environment` in
  `cdk/src/stacks/chat-api-stack.ts`), so resolving the URL against the API's
  host drops the stage. This needs checking against a deployed stack.
- Errors that API Gateway produces, such as failed authentication, have a
  `{ "message": ... }` body. Our code, and the `429` responses, use
  `{ "error": ... }`. Only the `THROTTLED` gateway response is overridden in
  `chat-api-stack.ts`.
- A `before` value that isn't a message in the thread returns `200` with no
  messages, rather than an error.

### Producing the document (R6, R7)

The document is generated from Zod with
[`@asteasolutions/zod-to-openapi`][zod-to-openapi]. It supports Zod 4, which
the API uses, and generates OpenAPI 3.2, including `itemSchema` for streamed
responses. It's a development dependency only. The schema modules the handlers
import don't use it, so the Lambda bundles don't change.

- `src/openapi/document.ts` builds the document. It registers the two paths,
  the security scheme and the shared components against the Zod schemas.
- `src/openapi/generate.ts` writes the document to `openapi.yaml`, using the
  [`yaml`][yaml] package. YAML is easier to read on GitHub than JSON, and it
  matches Chat V1. Node 24, pinned in `.nvmrc`, [runs TypeScript
  directly][node-typescript], so this follows the repo's no-build-step rule.
- `scripts/generate-openapi.sh` runs `generate.ts`, and then formats the output
  with prettier, so the generated file passes the format check.

**Requests** use the schemas in `src/schemas/client-input.ts` as they are:
`RunAgentInputSchema`, `ClientInputHeadersSchema`,
`ThreadMessagesPathParametersSchema` and `ThreadMessagesQuerySchema`. These are
what the middleware validates requests against, so the document can't disagree
with them.

**Response bodies** get Zod schemas in a new `src/schemas/api-responses.ts`:

- the messages page: `messages` (each with `id`, `role`, `content` and
  `createdAt`), and an optional `earlier_messages_url`
- the simple error body, `{ error }`
- the validation error body, `{ error, details }`, where `details` is the
  `z.flattenError` shape (`formErrors` and `fieldErrors`)

The `ErrorBody` types in `src/http/errors.ts`, and the messages handler's
response body, are derived from these schemas with `z.infer`. The type checker
then catches a handler whose response doesn't match the document.

**The event stream** is described with OpenAPI 3.2's `itemSchema`. Each item is
a server-sent event whose `data` field is JSON
([`contentMediaType` and `contentSchema`][oas-sse]) matching an AG-UI event.
The event schemas come from `@ag-ui/core/schemas`, which exports Zod schemas
for every AG-UI event.

The document lists only the events clients receive today (R2), rather than
every AG-UI event type. Listing every type would suggest clients have to handle
events they'll never see. We expect to stream more kinds of event soon, and
each of those changes adds to the list. The description also covers three
behaviours of the stream:

- more event types will be added, so clients should ignore types they don't
  recognise
- an error after the stream starts arrives as a `RUN_ERROR` event inside the
  `200` response, because the status code has already been sent
- `RUN_STARTED` and `RUN_FINISHED` carry the client's `threadId`

**Error responses** come from three places:

| Source              | Responses                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handlers            | `404` thread not found, `409` thread busy or id reused, `500` with `{ error }`                                                                                                                                                          |
| Middleware          | `422` failed validation with `{ error, details }`. `422` malformed JSON, and `415` when `Content-Type` isn't JSON, both with `{ error }`, from `@middy/http-json-body-parser`. `415` isn't listed in the ticket, but it is built today. |
| API Gateway and WAF | `401` failed authentication, and `429` from the stage throttle (both endpoints) or the per-end-user WAF rule (invoke only)                                                                                                              |

The gateway and WAF responses have no code to generate them from, so
`document.ts` registers them by hand. Before they're written, their exact
status codes and bodies are confirmed against a deployed stack: no token, an
expired token, and a token without the `chat-api/invoke` scope.

**Authentication** is an `http` security scheme with the `bearer` scheme,
applied to every operation. That's what a client sends today, and it doesn't
tie the document to Cognito, which is only for development. The scheme's
description says how to get a token in a dev environment (Cognito client
credentials with the `chat-api/invoke` scope, as in the README), and that
authentication will change when we move to tokens checked with Flex. How a
Flex token reaches us isn't decided yet, so the document is updated when it
is.

**Servers**: there's no long-lived environment, only developers' own dev
stacks, each with its own API Gateway URL and stage. The document lists one
server whose URL is built from OpenAPI server variables (the API id, region
and stage). Its description points to the README's
`fetch-cdk-output.sh ChatApiStack GatewayUrl` command for finding a stack's
URL.

### Keeping it accurate (R8, R9)

- **Drift**: `src/openapi/document.test.ts` generates the document and
  compares it with the committed `openapi.yaml`. It runs in `scripts/test.sh`,
  so it's covered by `dev-checks.sh` and the existing CI test job without a new
  step. When it fails, the fix is to run `scripts/generate-openapi.sh` and
  commit the result.
- **Validity**: a new `scripts/lint-openapi.sh` runs
  [Redocly CLI][redocly-lint]'s `lint` command on `openapi.yaml`. Redocly
  [added OpenAPI 3.2 support in November 2025][redocly-32]. The script runs
  from `dev-checks.sh` and from a new job in `chat-api-ci.yaml`. It uses
  Redocly's default rules, following AGENTS.md's guidance not to tweak tool
  config for taste. If a default rule conflicts with the API as built, the
  implementation pull request should raise it rather than quietly turn it off.

Because the drift test compares the whole document, a Dependabot bump to
`@ag-ui/core` that changes an event schema fails CI until someone regenerates
the document. That's intended. It makes a change to our contract visible.

### Documentation (R10)

The Chat API README gets a short "API contract" section. It links to
`openapi.yaml`, says the file is generated, and says to run
`scripts/generate-openapi.sh` after changing a request or response schema.

[zod-to-openapi]: https://github.com/asteasolutions/zod-to-openapi
[yaml]: https://github.com/eemeli/yaml
[node-typescript]: https://nodejs.org/api/typescript.html
[oas-sse]: https://spec.openapis.org/oas/v3.2.0.html#special-considerations-for-server-sent-events
[redocly-lint]: https://redocly.com/docs/cli/commands/lint
[redocly-32]: https://redocly.com/blog/updates-2025-11

## Alternatives considered

- **Hand-writing the OpenAPI spec and validating against it at runtime**, as
  [Chat V1 does with `committee`][v1-committee]. Rejected because it would
  replace the Zod validators, which changes the `details` in our `422`
  responses. That's a contract change, which is out of scope. Validating
  streamed responses at runtime would also add work to every event.
- **Hand-writing the OpenAPI spec and checking handler tests against it.**
  Rejected because each request would then be defined twice: in Zod, which
  validates it, and in the OpenAPI spec. Responses would only be checked where
  a test happens to exercise them, and the event stream is hard to check this
  way.
- **[`zod-openapi`][zod-openapi]**, another Zod-to-OpenAPI generator. Rejected
  because its README lists OpenAPI 3.1 as the newest version it supports, so it
  can't describe the event stream with `itemSchema`.
- **Building the document with Zod's own `z.toJSONSchema`.** Rejected because
  we'd write and maintain the paths, parameters, responses and security plumbing
  that `zod-to-openapi` already provides.
- **An `oauth2` security scheme with a `clientCredentials` flow.** This
  describes Cognito more precisely, scope included. Rejected because the flow
  needs a fixed token URL, and each dev stack has its own Cognito domain
  (built from `getResourceNamePrefix()`). Cognito is also temporary, so the
  document would describe something clients won't use.
- **Listing every AG-UI event type.** Rejected because it suggests clients
  must handle events they'll never receive.
- **OpenAPI 3.1 or 3.0.** Chat V1 uses 3.0.4, and both have wider tool support
  than 3.2. Rejected because neither can describe the events in a
  `text/event-stream` response, and the stream is the main thing clients need
  to understand.
- **Checking drift in CI by regenerating and running `git diff`.** Rejected in
  favour of a unit test, which runs in `dev-checks.sh` and the existing CI test
  job with no extra workflow steps.
- **Keeping the file in `docs/`**, as Chat V1 does. Rejected because, inside
  `services/chat-api`, the file sits beside the code it describes and the
  existing `chat-api-ci.yaml` path filter already covers it.

[v1-committee]: https://github.com/alphagov/govuk-chat/blob/6c81d98a30cc6ab722def53217723262884c81d3/config/initializers/committee.rb
[zod-openapi]: https://github.com/samchungy/zod-openapi

## Implementation plan

All changes are in `services/chat-api`, apart from the CI workflow.

1. **Define response schemas** (R6, R11). Add `src/schemas/api-responses.ts`.
   Derive the error body types in `src/http/errors.ts`, and the messages
   handler's response body, from it. Behaviour doesn't change.
2. **Generate the OpenAPI document** (R2–R8). Spike generating from Zod first
   (see [Risks](#risks)), then add `@asteasolutions/zod-to-openapi` and `yaml`
   as development dependencies. Add `src/openapi/document.ts`,
   `src/openapi/generate.ts`, `scripts/generate-openapi.sh`, the generated
   `openapi.yaml` and `src/openapi/document.test.ts`. Before registering them,
   confirm against a deployed dev stack the gateway's authentication and
   throttling responses, and that a run streams only the events R2 lists.
3. **Lint the OpenAPI document in CI** (R9). Add `@redocly/cli` as a
   development dependency and `scripts/lint-openapi.sh`. Call the script from
   `dev-checks.sh`, and from a new job in `.github/workflows/chat-api-ci.yaml`.
4. **Document the API contract** (R10). Add the "API contract" section to the
   Chat API README.

Separately from the commits, raise a ticket for each item in
[Inconsistencies to raise separately](#inconsistencies-to-raise-separately).

### Testing

- R1: reviewed as part of this spec.
- R2–R5: reviewed in the implementation pull request by reading the generated
  `openapi.yaml`. Against a deployed dev stack, each documented error is
  triggered with `scripts/api-curl.sh` and its status and body compared with
  the document. For example: no token, wrong `Content-Type`, a missing
  `end-user-id`, a reused `runId` and an unknown `threadId`.
- R6: `scripts/type-check.sh` passes. Changing a field name in the messages
  handler's response locally makes it fail.
- R7, R8: `src/openapi/document.test.ts` passes. Editing `openapi.yaml` by
  hand locally makes it fail, and running `scripts/generate-openapi.sh` fixes
  it.
- R9: `scripts/lint-openapi.sh` passes, and the new CI job runs on the pull
  request. Breaking the document locally (for example, removing a required
  `responses` key) makes it fail.
- R11: the existing handler tests pass without changes to their assertions.

### Rollout

None. Nothing deployed changes: the new dependencies are development-only and
the Lambda bundles stay the same.

## Risks

- **Generated documents can be harder to read than hand-written ones.** Client
  teams read this file directly, so it needs good descriptions. Mitigated by
  adding descriptions and examples through `zod-to-openapi`'s metadata in
  `document.ts`, and by reviewing the generated file in the pull request.
- **Gateway responses are registered by hand, so they can drift.** They're
  defined in the CDK stack, which the drift test can't see. Mitigated by
  confirming them against a deployed stack, and by a comment beside
  `TOO_MANY_REQUESTS_BODY` in `chat-api-stack.ts` pointing at `document.ts`.
- **OpenAPI 3.2 tooling is young.** Viewers and client generators may not
  understand `itemSchema` yet. Teams can still read the file. If this blocks
  someone, we could fall back to 3.1 and describe the stream in prose.
- **Generating from Zod may not work out.** It's the less proven option, so
  step 2 starts with a spike of about a day. The spike converts the
  `@ag-ui/core` event schemas and `RunAgentInputSchema`, and describes the
  stream with `itemSchema`. We switch to hand-writing `openapi.yaml`, with
  handler tests checking responses against it (see
  [Alternatives considered](#alternatives-considered)), if any of these happen:
  - the AG-UI event schemas don't convert, or the stream can't be described
    with `itemSchema`
  - the output is only readable after a lot of manual overrides in
    `document.ts`
  - adding descriptions means importing `zod-to-openapi` into the schema
    modules the Lambdas bundle

  If we switch, the implementation pull request updates this spec to match.

- **The drift test adds friction to Dependabot pull requests** that change an
  AG-UI schema, because someone has to regenerate the document. Accepted, as it
  shows the contract change.
- **The listed events can drift from what the agent sends.** The relay passes
  on every event the agent sends, and nothing in our code checks them against
  the list, so the drift test can't catch an agent change. Mitigated by the
  note telling clients to ignore event types they don't recognise. Changes
  that stream new kinds of event should also update the list.
