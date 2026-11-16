# AG-UI scenarios for storing thread messages as turns

Supporting examples for the
[turn spec](../2026-11-04-store-thread-messages-as-turns.md).

These examples follow a run from the client's request to the turns it stores.
Each shows the request, the events the agent streams, the turns `finishRun`
writes, and when each time is taken. Examples 1 and 2 fit this design.
Examples 3 and 4 need requests chat-api rejects today. They would fit with
additions, without changing the keys or stored turns.

The JSON was checked by running it through chat-api's request schema,
`@ag-ui/core`'s schemas, `MessageAccumulator`, and the spec's turn entities
with ElectroDB 3.9.3. Turns are shown with the attributes the examples are
about. Their keys are as in [Entities](../2026-11-04-store-thread-messages-as-turns.md#entities).

The ids are valid UUIDs chosen to be easy to follow:

- `1111…` is the client's thread id
- `a…` ids are run ids
- `b…` ids come from the client, and `c…` ids come from the agent

## How a run is written

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

## Example 1: a question and a text answer

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

The messages endpoint returns the two turns in that order (see
[Response](../2026-11-04-store-thread-messages-as-turns.md#response)).
`firstOutputAt` is stored but not returned.

## Example 2: an answer that uses a search tool

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

## Example 3: a choice the client shows

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

Fitting this is an addition, like a new message type (see
[Adding message types later](../2026-11-04-store-thread-messages-as-turns.md#adding-message-types-later)).
`UserTurnMessagesSchema` accepts a tool message. Keys and stored turns don't
change.

## Example 4: a tool that needs the user's approval

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

## Every AG-UI message type

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

## Other scenarios

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
  [decision 3](../2026-11-04-store-thread-messages-as-turns.md#3-is-it-fine-not-to-check-the-agents-message-ids)).

Not designed yet:

- **Images and files from the user.** A user message's content can be a list
  of parts. chat-api only accepts text. Inline data counts towards the 400 KB
  limit.
- **A tool result over 400 KB.** The run fails (see [What could bite us](../2026-11-04-store-thread-messages-as-turns.md#what-could-bite-us)).
