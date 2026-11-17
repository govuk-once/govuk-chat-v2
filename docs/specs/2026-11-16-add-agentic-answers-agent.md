# Add agentic-answers-agent

**Date:** 2026-11-16

**Status:** accepted

## Problem

Data science's guardrailed AG-UI agent in govuk-chat-v2-experiments is the
version we want to take to production. Data science have confirmed we port it
as it stood at commit
[40a238e](https://github.com/govuk-once/govuk-chat-v2-experiments/tree/40a238ee7eeff040eb6ae9576c9c236597085545/agents/app/AGUI_Demo).

This repo only has `agui-agent`, which has no tools or guardrails. It answers
from the model alone, so it can't ground answers in GOV.UK content the way
the experiments agent does with Chat V1's search.

This is the first of four tickets to port the agent. It gets a new agent
answering questions like the experiments version does, using V1's search.
Connecting the chat API and adding guardrails come in the next two tickets.
The plan is in the Confluence proposal "Porting the latest experiments agent
to GOV.UK Chat V2".

## Goals

- A new `agentic-answers-agent` service that answers GOV.UK questions using
  results from V1's OpenSearch index, with data science's prompt.
- It deploys to a developer's dev stack alongside `agui-agent`, so nobody has
  to tear down their stack and `agui-agent` keeps working.
- It keeps what `agui-agent` already gives us, such as tracing and
  conversation memory, rather than being a straight copy of the experiments
  agent.
- The model and conversation settings are visible choices in the code, not
  defaults.

## Non-goals

- Guardrails. See "Agent: Add a basic guardrail, through to the demo UI".
- Connecting the chat API or the demo UI to the new agent, or deciding what
  happens to `agui-agent`. See "Agent: Connect agentic-answers-agent to the
  chat API and demo UI".
- Filtering which AG-UI events reach the client. The chat API will do that
  for every agent, in the "Connect" ticket. See
  [Events the agent sends](#events-the-agent-sends) for what it needs to know.
- Getting the OpenSearch secret into environments beyond dev, and moving
  prompts to S3. Both are part of the private config work, which follows the
  private config spike.
- Putting the search tool behind an AgentCore Gateway.
- The out-of-scope tool. See "Agent: Add the out-of-scope tool".
- Changing how search ranks or formats results. The tool is a port, and its
  behaviour should match the experiments version.

## Requirements

1. **R1:** The agent's system prompt is `preventative_guardrails`, loaded from
   govuk-chat-v2-private with `load_prompts()`. No production prompt text is
   committed to this repo.
2. **R2:** The model is configured with only its model ID, maximum output
   tokens and thinking effort, set as constants in one module. It uses Claude
   Sonnet 5.5, subject to data science confirming it (see
   [Open questions](#open-questions)).
3. **R3:** The agent sets Strands' `SlidingWindowConversationManager`
   explicitly, with its window size as a named constant of 40 messages. It
   doesn't use `NullConversationManager`.
4. **R4:** The agent has one tool, `search_govuk_guidance`, which searches
   V1's OpenSearch index and returns at most 20 results scoring at least 0.75
   after reranking, from 80 candidates, matching the experiments tool.
5. **R5:** The search tool reads V1's OpenSearch connection details from the
   `govuk-chat-v2-opensearch` secret in Secrets Manager the first time it
   runs, and reuses them for the life of the process. They are never read
   from environment variables, logged or returned to the model.
6. **R6:** The runtime role can call `secretsmanager:GetSecretValue` on that
   secret and no other.
7. **R7:** The agent keeps what `agui-agent` sets up (see
   [What we keep from agui-agent](#what-we-keep-from-agui-agent)): OpenTelemetry
   tracing, an AgentCore Memory session per thread and end user, no
   `MESSAGES_SNAPSHOT` events, and no printing of events to stdout.
8. **R8:** `agentic-answers-agent` is a package in `services/`, registered in
   the uv workspace, with a README, the standard `scripts/` and an
   `agentic-answers-agent-ci.yaml` workflow, following `agui-agent`.
9. **R9:** An `AgenticAnswersAgentStack` deploys the agent's AgentCore runtime
   and memory, with namespaced resource names and the standard tags, and can
   be deployed with the package's `scripts/cdk-deploy.sh` alongside
   `AguiAgentStack`.
10. **R10:** The agent runs locally with `scripts/agentcore-inspector.sh`.
11. **R11:** Invoking the deployed runtime with a GOV.UK question gets an
    answer that uses search results.
12. **R12:** A conversation that runs past the conversation window still gets
    answers.

## Design

### What we port from the experiments, and what we leave behind

The experiments agent is a 169-line
[`main.py`](https://github.com/govuk-once/govuk-chat-v2-experiments/blob/40a238ee7eeff040eb6ae9576c9c236597085545/agents/app/AGUI_Demo/main.py)
with its own FastAPI app, plus a model loader and the search tool. We port:

- the agent itself: the prompt, the search tool and the model settings
  data science chose for the `guardrailed_agui_agent` experiment
- the search tool's retrieval, reranking and formatting, unchanged in
  behaviour

We leave behind:

- **the custom FastAPI app.** `agui-agent` already uses ag-ui-strands'
  `create_strands_app`, which gives us `/invocations` and `/ping`. The
  experiments app's CORS middleware is only there for a local UI.
- **the JSON logger.** For every turn it logs the user's question, the full
  answer, time to first token and stream duration. The agent's traces
  already record all of that (see [Tracing](#tracing)), so it would only
  duplicate them.
- **the guardrail callback, agent state and `guardrail_triggered` event,**
  and the in-memory set of blocked message IDs. The guardrail ticket replaces
  them: ag-ui-strands already sends a `CUSTOM` `AgentStopped` event with
  `stop_reason: guardrail_intervened`, and AgentCore Memory means the model
  only gets the latest message from the client, so there's no resent history
  to redact.
- **the model loader's switches.** It reads nine environment variables and
  supports models that need a thinking budget. We need one model, so the
  settings become constants (R2).
- **the tool's `__main__` blocks and `.env` loading,** which were for trying
  it by hand.

### What we keep from agui-agent

The new service starts as a copy of `agui-agent`, so it keeps (R7):

- **tracing.** The runtime starts the agent with `opentelemetry-instrument`
  (`cdk/src/bundling/python.ts`), with `aws-opentelemetry-distro` installed,
  so Strands' traces go to AgentCore's observability. See [Tracing](#tracing).
- **AgentCore Memory.** A session manager per thread, with the end user's ID
  from `forwardedProps.endUserId` as the actor, and the `default-user`
  fallback for local runs. Events expire after 90 days.
- **`emit_messages_snapshot=False`,** because assistant-ui renders a
  `MESSAGES_SNAPSHOT` as a duplicate message.
- **`callback_handler=None`,** so Strands doesn't print every event to
  stdout.

It doesn't copy two things from `agui-agent` that do nothing:

- `app = BedrockAgentCoreApp()`, which `create_strands_app` overwrites
- the `strands-agents-tools` dependency, which nothing imports

`agui-agent` has no logging of its own, and the chat API logs only IDs and
errors, so there's no other logging to keep.

### Tracing

Strands' traces record a span for each model call and tool call, with its
timings and token counts. By default they also record the content. From
reading Strands' tracer
([`strands/telemetry/tracer.py`](https://github.com/strands-agents/sdk-python/blob/main/src/strands/telemetry/tracer.py)
in 1.62.0), every model call's span includes the system prompt, the messages
sent to the model and its answer, and tool spans include the arguments and
results.

So, as with `agui-agent` today, the production prompt and users'
conversations end up in CloudWatch. We're fine with that. What we're
protecting prompts from is being readable in our public repo, and CloudWatch
is only open to people with access to our AWS accounts. See
[Risks](#risks).

### Package layout

The service follows `agui-agent`, with the Python package
`agentic_answers_agent`:

```
services/agentic-answers-agent/
  agentcore/agentcore.json
  pyproject.toml
  README.md
  scripts/                      # as agui-agent, mostly symlinks to scripts/shared
  src/agentic_answers_agent/
    main.py                     # wiring only: app, agent, session manager
    model.py                    # model constants and create_model()
    search_govuk/
      tool.py                   # the @tool and the search constants
      opensearch_connection.py  # reads the secret, builds the client
      retrieve.py
      rerank.py                 # weightings as a Python dict
      format.py
      models.py
  tests/agentic_answers_agent/
    ...
```

`main.py` stays as thin as `agui-agent`'s: it builds the model, agent,
session manager provider and app, and has no branching of its own. Anything
with logic is a plain function in its own module, so it can be unit tested
without the app.

### Model

`model.py` holds three constants and a `create_model()` that builds a Strands
`BedrockModel` from them:

| Setting    | Value                                                | Source                                                                                           |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Model      | Claude Sonnet 5.5, EU cross-region inference profile | Experiments used Sonnet 5 at 40a238e. Data science's newer experiments have moved to Sonnet 5.5. |
| Max tokens | 16,000                                               | `guardrailed_agui_agent` config                                                                  |
| Thinking   | adaptive, effort `low`                               | `guardrailed_agui_agent` config (`MODEL_THINKING_EFFORT: low`)                                   |

Adaptive thinking and effort go in `additional_request_fields`, as the
experiments loader does. We don't set a temperature: the experiments set 1.0,
which is the default, and Sonnet 5.5 rejects non-default values (see the
[migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)).

Effort levels were recalibrated between Sonnet 5 and Sonnet 5.5, so `low` on
Sonnet 5.5 may not behave like `low` on Sonnet 5. That's for data science to
confirm (see [Open questions](#open-questions)).

### Conversation history

With a session manager, the agent restores the conversation from AgentCore
Memory rather than from the history the client sends. Without a conversation
manager limit, every turn sends the whole conversation to the model, so long
conversations get slower and more expensive each turn and would eventually
go past the context window. Some experiments use `NullConversationManager`,
which does exactly that. Data science (Tigs) flagged that it isn't suitable
for production and asked that the decision isn't lost.

So the agent sets `SlidingWindowConversationManager(window_size=40)`
explicitly (R3). 40 is Strands' default, and setting it explicitly records it
as a choice. A window of 40 messages is roughly 10 questions when each one
uses search, as a search adds a tool call message and a tool result message.
AgentCore Memory still keeps the whole conversation. The window only limits
what's sent to the model.

### Events the agent sends

The agent sends everything ag-ui-strands produces, and the chat API decides
what reaches the client. That's in the "Connect" ticket, which needs to land
before the chat API uses this agent. For that ticket:

- ag-ui-strands forwards anything it doesn't map as a `RAW` event. That
  includes model metrics and, once guardrails are on, the full guardrail
  trace with every denied topic name.
- It sends the full tool result as `TOOL_CALL_RESULT`. A spike found one
  search result set is about 22 KB.
- With thinking on, it sends `REASONING_*` events, which are empty, as
  Sonnet 5.5 doesn't return its reasoning by default.
- The events the demo UI needs are `RUN_*`, `TEXT_MESSAGE_*`,
  `TOOL_CALL_START`, `TOOL_CALL_ARGS` and `TOOL_CALL_END` (which carry only
  the search query), and the `CUSTOM` `AgentStopped` event the guardrail
  ticket uses.

Developers calling the runtime directly, for example through the AgentCore
Inspector, still see the full stream, which helps with debugging.

### Search tool

The tool is copied from
[`agents/app/tools/chat_v1_search_govuk`](https://github.com/govuk-once/govuk-chat-v2-experiments/tree/40a238ee7eeff040eb6ae9576c9c236597085545/agents/app/tools/chat_v1_search_govuk)
at 40a238e, with these changes:

- **Connection details come from Secrets Manager (R5).**
  `opensearch_connection.py` reads the `govuk-chat-v2-opensearch` secret on
  first use and caches the OpenSearch client for the process, rather than
  building it at import time from environment variables. The secret holds
  the URL, username, password, index, embedding field name and embedding
  model. A spike confirmed an AgentCore runtime in `PUBLIC` network mode can
  reach V1's OpenSearch endpoint with these, and that a search returns 20
  results in 1.1 to 1.6 seconds, plus about 0.45 seconds of one-off setup.
- **The search settings become constants** in `tool.py`: 80 candidates, 20
  results, a minimum score of 0.75. These were environment variables so each
  experiment could tune them.
- **The rerank weightings become a Python dict** rather than a YAML file.
  That drops the `pyyaml` runtime dependency, and means changing a weighting
  redeploys the agent: the CDK asset hash only covers `src/**/*.py` and
  `uv.lock` (`cdk/src/bundling/python.ts`), so a YAML change wouldn't.
- **Types and tests are added** so the code passes pyright, ruff and our
  testing conventions. At the moment the tool has no tests, and several
  functions return untyped `dict`s.

It adds one runtime dependency, `opensearch-py`. `boto3` and `pydantic` are
already installed through Strands and ag-ui-strands.

### Infrastructure

`AgenticAnswersAgentStack` in `cdk/src/stacks/agentic-answers-agent-stack.ts`
starts as a copy of `AguiAgentStack`: an AgentCore memory, a runtime built
with the shared `agentCoreCodeAsset`, the same Bedrock and memory
permissions, and the outputs the AgentCore CLI wrapper reads. It differs in:

- names: the runtime `<prefix>-agentic-answers-agent-runtime` and the memory
  `<prefix>-agentic-answers-memory`, from `getResourceNamePrefix()`
- the secret: it looks up the existing secret by name with
  `Secret.fromSecretNameV2` and grants the runtime role read access with
  `grantRead` (R6). The secret isn't created by this stack, as it's V1's.

`cdk/bin/app.ts` instantiates it next to `AguiAgentStack`. `ChatApiStack`
still gets `agui-agent`'s runtime ARN until the next ticket.

The stack is named to match the runtime in `agentcore/agentcore.json`
(`AgenticAnswersAgent`), as the
[AgentCore CLI wrapper](../../libs/python/agentcore-cli-wrapper/README.md#add-a-new-agent)
requires.

### Security

- No production prompt in this repo (R1). The spec and tests refer to the
  prompt by name only, and tests use a dummy prompt.
- OpenSearch credentials stay in Secrets Manager. They're not in environment
  variables, where they'd be visible in the runtime's configuration and the
  CloudFormation template (R5).
- The runtime role gets read access to one secret (R6).
- The prompt and conversations are in the agent's traces in CloudWatch,
  which only people with access to our AWS accounts can read (see
  [Tracing](#tracing) and [Risks](#risks)).
- Until the "Connect" ticket adds filtering in the chat API, nothing outside
  AWS calls this runtime, so `RAW` events and search results only reach
  developers with AWS access.
- The model still sees `llm_instructions` from GOV.UK content, as V1 does.

## Alternatives considered

- **Renaming or replacing `agui-agent`.** We could have changed `agui-agent`
  in place, but that would break everyone's stack and the demo UI until the
  whole port was done. A new service alongside it keeps both working, and the
  next ticket decides what happens to `agui-agent`.
- **A shared CDK construct or Python module for what the two agents have in
  common.** The duplicated code is the stack's memory, runtime and
  permissions, about 120 lines, and the session manager provider, about 20.
  The bundling, environment helpers and dev scripts are already shared. As
  the next ticket may remove `agui-agent`, an abstraction now could end up
  with one user, so we copy and can extract later if a third agent arrives.
- **Porting the experiments' FastAPI app.** It would bring the duplicate
  logging, global guardrail state and CORS for a local UI.
  `create_strands_app` already does what we need.
- **Filtering events in the agent.** The agent could drop events before they
  leave the runtime. We're filtering in the chat API instead, because it
  already parses every event it relays
  (`services/chat-api/src/streaming/agent-event-stream.ts`), one filter there
  covers every agent, and filtering before storage means a stored
  conversation matches what was streamed. It also leaves the full stream
  available to developers calling the runtime directly.
- **Reading credentials from environment variables,** as the experiments do.
  They'd be stored in plain text in the runtime's configuration.
- **Keeping `NullConversationManager` or Strands' implicit default.** See
  [Conversation history](#conversation-history).

## Implementation plan

The work is in two repos and five pull requests, merged in this order. The
public repo's work is split so the infrastructure, the agent and the search
tool can each be reviewed on their own, and each PR leaves a working agent.

### PR 1 (govuk-chat-v2-private): Add the preventative_guardrails prompt

1. Add `prompts/preventative_guardrails.yaml` with its `system_prompt`, next
   to `structured_answer_composer.yaml`. (R1)
2. Update `tests/test_prompts.py`, which expects every prompt to have a
   `user_prompt`. This prompt only has a system prompt.

### PR 2 (govuk-chat-v2): Bump private repo

3. Merge the "Bump private repo" PR that opens automatically. (R1)

### PR 3 (govuk-chat-v2): Add the agentic-answers-agent service

This is a copy of `agui-agent` under the new names, so reviewers can check
the infrastructure without any agent changes mixed in.

4. Add `services/agentic-answers-agent` as a copy of `agui-agent`, with its
   README, `scripts/` and `agentcore/agentcore.json`, and register it in the
   root `pyproject.toml`. Leave out the unused `BedrockAgentCoreApp` and
   `strands-agents-tools`. (R7, R8, R10)
5. Add `.github/workflows/agentic-answers-agent-ci.yaml`, following
   `agui-agent-ci.yaml`. (R8)
6. Add `AgenticAnswersAgentStack` and its test, and instantiate it in
   `cdk/bin/app.ts`. (R9)

### PR 4 (govuk-chat-v2): Port the agent

7. Add `model.py` with the model constants and `create_model()`. (R2)
8. Load `preventative_guardrails` as the system prompt. (R1)
9. Set the sliding window conversation manager. (R3)

### PR 5 (govuk-chat-v2): Add the search tool

10. Copy the search tool into `search_govuk/`, with types, the search
    settings and rerank weightings as constants, and unit tests. (R4)
11. Read the connection details from Secrets Manager. (R5)
12. Grant the runtime role read access to the secret. (R6)
13. Add the tool to the agent, and update the README with how to try it.
    (R11)

### Testing

Unit tests, following AGENTS.md:

- the session manager provider, as in `agui-agent`. (R7)
- reranking: document type weighting, `html_publication` using its parent
  type, the score threshold and the result limit. (R4)
- formatting: the mapping to the model's input and dropping empty fields.
  (R4)
- `GovUkChunkSource.from_source` rejecting unknown fields. (R4)
- the connection reading the secret once across several searches, with
  Secrets Manager mocked. (R5)
- the CDK stack: the runtime and memory exist, the outputs the wrapper reads,
  the tags, and a policy granting `secretsmanager:GetSecretValue`. (R6, R9)

There are no unit tests for constants or the model's construction, as they
have no logic.

Manual checks on a dev stack, as they need AWS and a real model:

1. Deploy with `services/agentic-answers-agent/scripts/cdk-deploy.sh`.
   `AguiAgentStack` is unchanged. (R9)
2. Run `scripts/agentcore-inspector.sh` and ask a GOV.UK question, such as
   "How do I renew my passport?". The answer uses search results. (R10, R11)
3. Invoke the deployed runtime directly with the same question, then open
   the session's trace in CloudWatch. The model and search tool spans are
   there with their timings and token counts. (R7, R11)
4. Ask more than 10 questions that each use search in one conversation. The
   later answers still arrive. (R12)

The cloud tests go through the chat API, which still uses `agui-agent`, so
they're unaffected.

### Rollout

- PR 4 needs PR 2 merged, as it loads the new prompt.
- PR environments deploy all stacks, so they'll deploy the new stack too,
  which adds to their deploy time.
- The secret only exists in the dev account. Deploying the stack elsewhere
  works, but searches fail there until the private config work gets the
  secret into those environments.
- Nothing calls the new runtime until the next ticket, so there's no effect
  on the demo UI. That ticket must add the chat API's event filtering before
  or at the same time as it switches the chat API to this agent.

## Risks

- **History trimming and preserved thinking.** Sonnet 5.5 ties each thinking
  block to the conversation before it. When the sliding window drops the
  oldest messages, the thinking blocks it keeps no longer match. For accounts
  where this check is enforced, the
  [API rejects the request](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking);
  otherwise it quietly drops the old thinking, which is harmless here. We
  don't know yet whether our account is enforced, or whether Strands and
  AgentCore Memory replay thinking blocks at all. Manual check 4 tests it. If
  it fails, we'd strip thinking from the history before it's sent, or move to
  server-side context editing, in this ticket.
- **The prompt and conversations are in traces.** Anyone who can read
  CloudWatch in an account can read the production prompt, and users'
  conversations, including any personal details they type. We accept this,
  as it's the same as `agui-agent` today and what we're protecting prompts
  from is being readable in the public repo. If we need to restrict it later,
  Strands can redact content from traces and keep the timings and token
  counts, by setting
  `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_unredacted_attributes=` on the
  runtime. That's from reading Strands' code, and we haven't tried it.
- **Search strictness.** `GovUkChunkSource.from_source` raises if V1's index
  returns a field it doesn't know, which would make every search fail. We
  keep that behaviour, as the port should match the experiments, and we own
  the index, so we'd see a change coming.
- **Long resource names.** AgentCore runtime and memory names have a length
  limit, and the new names are longer than `agui-agent`'s. The longest prefix
  we use is a PR environment's (`test-pr-<number>`). `cdk synth` in PR 3
  should catch it.
- **Thinking effort.** Effort levels changed between Sonnet 5 and Sonnet 5.5,
  so answers may be slower or weaker than data science saw. Their evals
  should show that.

## Open questions

- **Model and effort.** Should the agent use Sonnet 5.5, and is `low` still
  the right effort? Is 16,000 max tokens still right? For data science
  (Tigs), before PR 4.
- **Inference profile.** Which Sonnet 5.5 inference profile ID to use in
  eu-west-1, and is it enabled in each account? We'll check when we write
  PR 4.
