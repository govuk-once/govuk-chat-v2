# Remove unused packages and rename chat-api-ts to chat-api

**Date:** 2026-10-15

**Status:** implemented

## Problem

The repository still contains packages from earlier exploration that we no
longer use:

- `services/chat-api-fastapi`, a Python HTTP API on Lambda Web Adapter.
  [ADR 0002](../adr/0002-use-python-for-ai-and-typescript-elsewhere.md)
  moved HTTP APIs to TypeScript, and `services/chat-api-ts` has replaced it.
- `services/example-agent`, an AgentCore agent that streams this repository's
  own event format. `services/agui-agent` has replaced it, and it is the agent
  `chat-api-ts` invokes.
- `libs/python/agent-runtime-types`, which only those two packages consume.

Keeping them costs us maintenance: Dependabot bumps, CI runs and dev-checks on
code nobody uses. It also causes confusion, because developers and coding agents
can't easily tell which implementation is the real one. The `-ts` suffix on
`chat-api-ts` is part of the same problem. It only made sense while there was
another Chat API to tell it apart from.

## Goals

- The repository contains only the packages we use, so there is less to
  maintain.
- Each service has one obvious implementation, named without a language
  suffix, which matches the `chat-api` example in AGENTS.md. The same applies
  to its CloudFormation stack and AWS resources.
- After a redeploy, deployed environments keep working under the new names.
  The project is still in development, so we're not precious about deployed
  stacks or their data. We prefer clean names over continuity, and expect
  developers to clean up the stacks this work leaves behind.

## Non-goals

- Tearing down deployed AWS resources. The `ExampleAgentStack` and
  `ChatApiFastapiStack` CloudFormation stacks are left behind when their code is
  removed. They only exist in developers' dev environments (see
  [Rollout](#rollout)).
- Migrating data from the existing Chat API DynamoDB table or Cognito user pool
  to the renamed stack (see [Rollout](#rollout)).
- Preserving `services/chat-api-fastapi/api-spec.md`. Nothing links to it,
  `chat-api-ts` has moved away from its design, and git history keeps it.
- Changes to `services/agui-agent` or `libs/python/agentcore-cli-wrapper`,
  except for references to the removed packages.

## Requirements

1. **R1:** `services/chat-api-fastapi` is removed, along with its CDK stack and
   stack test, its CI workflow and its uv workspace membership.
2. **R2:** `services/example-agent` is removed, along with its CDK stack and
   stack test, its CI workflow and its uv workspace membership.
3. **R3:** `libs/python/agent-runtime-types` is removed, along with its CI
   workflow and its `[tool.uv.sources]` entry.
4. **R4:** Apart from specs and ADRs, no file in the repository refers to the
   removed packages. Fixtures and documentation that use them as examples
   refer to `agui-agent` instead.
5. **R5:** `services/chat-api-ts` is renamed to `services/chat-api`. Its package
   is `@govuk-chat-v2/chat-api`, its CI workflow is `chat-api-ci.yaml`, and its
   CDK stack class is `ChatApiStack` in `cdk/src/stacks/chat-api-stack.ts`.
   Its Lambdas log with the Powertools service name `chat-api`.
6. **R6:** The CloudFormation stack is `${prefix}-ChatApiStack`. No stack ID,
   construct ID or AWS resource name contains `chat-api-ts` or `ChatApiTs`.
7. **R7:** `uv.lock` and `pnpm-lock.yaml` are regenerated, every remaining
   package's `scripts/dev-checks.sh` passes, and each CI workflow's path
   filters match the package's new location.

## Design

### Removals (R1–R4)

Neither package is a dependency of any remaining service. `chat-api-ts` invokes
`agui-agent`, which it receives through `aguiAgentStack.agentRuntimeArn` in
`cdk/bin/app.ts`. `ChatApiFastapiStack` consumes
`exampleAgentStack.agentRuntimeArn`, so both stacks come out of `app.ts`
together with their imports.

Shared CDK code stays, because `agui-agent` still uses it. That includes
`cdk/src/bundling/python.ts`, and `hashGlobs`, `repoRoot` and
`isEphemeralEnvironment` in `cdk/src/constants/environment.ts`. The pnpm
workspace uses a `services/*` glob, and the uv workspace uses a `libs/python/*`
glob, so neither needs editing beyond the explicit `services/...` members in
the root `pyproject.toml`.

These files mention the removed packages as examples and are updated to use
`agui-agent`:

- `libs/python/agentcore-cli-wrapper/tests/test_configure.py` and
  `tests/test_cli.py`, which use `ExampleAgent` as fixture values
- `libs/python/agentcore-cli-wrapper/README.md`, whose "When the Inspector's
  chat pane stays empty" section refers to `example-agent`'s event format
- the comment example in `scripts/shared/fetch-cdk-output.sh`

### Rename (R5–R6)

The rename covers both the code and the deployed AWS names:

- the directory, the package name, the CI workflow, the CDK class and file
  names, the handler entry path the stack bundles
  (`services/chat-api/src/handlers/...`), and README titles and prose
- the stack ID and `stackName` in `cdk/bin/app.ts`, which become
  `ChatApiStack` and `${prefix}-ChatApiStack`
- the construct IDs and physical names containing `chat-api-ts` in the stack:
  the user pool, resource server, app client, domain, authorizer, DynamoDB
  table, REST API, WAF web ACL and Lambda functions
- the `POWERTOOLS_SERVICE_NAME` environment variable the stack sets on each
  Lambda. The Powertools `Logger` in `services/chat-api/src/logging/logger.ts`
  reads it to set the `service` field on every log line. Nothing uses
  Powertools metrics or tracing, so the variable affects logs only.
- the stack ID passed to `dev-cdk-deploy.sh` in the package's
  `scripts/cdk-deploy.sh`, and to `fetch-cdk-output.sh` in the `chat-api` and
  `chat-ui` READMEs

Renaming the stack means CloudFormation treats `ChatApiStack` as a new stack.
It can't deploy while `ChatApiTsStack` still exists, because the Cognito domain
prefix (`getResourceNamePrefix()`) is globally unique. Each environment
therefore has to destroy the old stack before deploying the new one (see
[Rollout](#rollout)). Because the stack is replaced anyway, the resources are
renamed too, so no `-ts` names are left behind.

The `scripts/` symlinks inside the package are relative and stay at the same
depth, so moving the directory keeps them working.

## Alternatives considered

- **A code-only rename.** Keep the `ChatApiTsStack` stack ID and the AWS
  resource names, so a deploy updates the existing stack in place and keeps its
  data. Rejected because it leaves `Ts` in the stack and resource names, which
  is the confusion this work aims to remove. Needing a redeploy was judged
  acceptable.
- **A rename that leaves the old stack in place.** Rename everything, and
  change the Cognito domain prefix to avoid the clash, so the new stack can
  deploy alongside the old one. Rejected because it duplicates every Chat API
  resource and still moves users to a new user pool and an empty table.
- **Keeping `agent-runtime-types`.** Rejected because no remaining package uses
  it, and keeping it costs the maintenance this work aims to remove.
- **Moving `api-spec.md` to `docs/`.** Rejected because it describes a design
  the API has moved away from, and git history keeps it.

## Implementation plan

The removals come first, so a new `chat-api` never sits beside
`chat-api-fastapi`.

1. **Remove `chat-api-fastapi`** (R1, R4, R7). Delete the package,
   `chat-api-fastapi-ci.yaml`, `cdk/src/stacks/chat-api-fastapi-stack{,.test}.ts`
   and its stack in `cdk/bin/app.ts`. Remove it from
   `[tool.uv.workspace].members`, then run `uv lock`.
2. **Remove `example-agent`** (R2, R4, R7). Delete the package,
   `example-agent-ci.yaml`, `cdk/src/stacks/example-agent-stack{,.test}.ts` and
   its stack in `cdk/bin/app.ts`. Remove it from `[tool.uv.workspace].members`,
   then run `uv lock`. Point the `agentcore-cli-wrapper` fixtures and README,
   and the `fetch-cdk-output.sh` comment, at `agui-agent`.
3. **Remove `agent-runtime-types`** (R3, R7). Delete the library,
   `agent-runtime-types-ci.yaml` and its `[tool.uv.sources]` entry, then run
   `uv lock`.
4. **Rename `chat-api-ts` to `chat-api`** (R5, R6, R7). Move
   `services/chat-api-ts` to `services/chat-api`. Rename the package in
   `package.json`, then run `pnpm install`. Rename the CI workflow to
   `chat-api-ci.yaml` and update its name, path filters and script paths.
   Rename the stack class and files to `ChatApiStack` /
   `chat-api-stack{,.test}.ts`, and the stack ID and `stackName` in `app.ts`.
   Update the handler entry path, the construct IDs and physical names, and
   `POWERTOOLS_SERVICE_NAME`, along with the stack test assertions on them.
   Update `scripts/cdk-deploy.sh` and the `fetch-cdk-output.sh` instructions in
   the `chat-api` and `chat-ui` READMEs. Update the `chat-api` README title and
   its description, which still compares it with the Python API, and the
   "unlike chat-api-ts" comment in `services/chat-ui/src/chat-api/client.ts`.

### Testing

- R1–R3, R7: `scripts/dev-checks.sh` passes for `cdk`, `chat-api`, `chat-ui`,
  `agui-agent` and `agentcore-cli-wrapper`. `uv lock --check` and
  `pnpm install --frozen-lockfile` succeed.
- R1, R2, R6: `cdk synth` produces only `AguiAgentStack`, `ChatApiStack` and
  `ChatUiStack`. The deleted stack tests don't need replacing.
- R4: a repository-wide search for `chat-api-fastapi`, `chat_api_fastapi`,
  `example-agent`, `example_agent`, `ExampleAgent` and `agent-runtime-types`
  only matches specs and ADRs.
- R5, R6: a search for `chat-api-ts` and `ChatApiTs` only matches specs and
  ADRs. The stack tests' assertions on resource names use the new names.
- R6: following the [Rollout](#rollout) steps in a dev environment that
  already has `ChatApiTsStack` deploys `ChatApiStack` and `ChatUiStack`, and
  Chat UI can hold a conversation through the renamed API.
- R7: the pull request triggers `chat-api-ci.yaml`.

### Rollout

A downside of this work is that the rename needs a redeploy. Each environment
with a `ChatApiTsStack` replaces it with `ChatApiStack`, and cleans up
everything that still carries the old name:

1. Destroy `ChatUiStack`, because it imports `ChatApiTsStack`'s exports and
   CloudFormation won't delete a stack whose exports are in use.
2. Destroy `ChatApiTsStack`.
3. Delete what outlives the stacks:
   - the Lambda log groups `/aws/lambda/${prefix}-chat-api-ts-*`, which Lambda
     creates outside CloudFormation, so they survive in every environment
   - outside ephemeral environments, the resources with
     `RemovalPolicy.RETAIN`: the `${prefix}-chat-api-ts` DynamoDB table, the
     `${prefix}-chat-api-ts-user-pool` Cognito user pool, and `ChatUiStack`'s
     `/ecs/express/${prefix}-chat-ui` log group. The log group must go before
     the next step, because its fixed name would block `ChatUiStack` from
     deploying again.
4. Deploy `ChatApiStack` and `ChatUiStack`.
5. Check that no AWS resource in the environment has `chat-api-ts` or
   `ChatApiTs` in its name.

The redeploy gives each environment a new DynamoDB table, Cognito user pool,
app client and secret, and API Gateway URL. Conversations stored in the old
table are lost, and anything holding the old URL or client credentials has to
be updated.

After the redeploy, Chat API log lines have the service `chat-api` instead of
`chat-api-ts`.

As a consequence of this work, developers may also need to delete stacks by
hand. `ExampleAgentStack` and `ChatApiFastapiStack` only exist in developers'
dev environments, and `cdk deploy` no longer manages them, so each developer
who deployed them deletes their own (for example, with
`aws cloudformation delete-stack`). Delete `ChatApiFastapiStack` first, because
it imports an export from `ExampleAgentStack`.

The implementation pull request should flag these steps to the team.

## Risks

- **Deploying without destroying the old stack first** fails, because the
  Cognito domain prefix clashes. Mitigated by the rollout steps and by flagging
  them in the implementation pull request.
- **Losing Chat API data and credentials** in the redeploy. Accepted as the
  cost of clean names while the project is in development.
- **Missing a resource in the cleanup** leaves `chat-api-ts` names and their
  costs behind. Mitigated by the final rollout step, which checks that none
  remain.
- **Log searches filtering on `service = "chat-api-ts"`** stop matching new log
  lines. Nothing in the repository uses one, but saved queries outside it
  would need updating.
