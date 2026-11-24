# Attempt 2: OpenSpec-style proposal, design and tasks

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is an open format for
specs written with AI coding agents. It splits a change into separate
files, each with one job, so the reader opens only the one they need:

- `proposal.md`: why, and what changes. Its guidance is "1-2 sentences" of
  why, and "keep it concise (1-2 pages)".
- `specs/<capability>/spec.md`: behaviour only, as requirements using
  SHALL, each with **WHEN** / **THEN** scenarios. Its test for what belongs
  here: "if the implementation can change without changing externally
  visible behavior, it likely does not belong in the spec".
- `design.md`: how, and optional. Decisions are written as "X over Y", and
  risks as "[Risk] → Mitigation". It tells the writer to "reference the
  proposal for motivation instead of restating it".
- `tasks.md`: a checklist, where each task says how to verify it.

This attempt follows that shape as closely as it can. In OpenSpec these
would be separate files in `changes/run-cloud-tests/`; here they're
sections of one file so they're comparable with the other attempts.

---

## `proposal.md`

# Run cloud tests against deployed environments

**Date:** 2026-10-29 · **Status:** accepted

### Why

Our tests mock AWS, so nothing checks that a deployed system works as a
whole (CHAT-1119).

### What changes

- New `cloud-tests` package with an API test and a UI sign-in test that run
  against a deployed environment.
- Developers run them against their own stacks with
  `cloud-tests/scripts/test.sh`, which doesn't deploy.
- Pull requests that change code or infrastructure deploy their own
  `test-pr-<number>` environment and run the tests. The check is
  informational.
- Closing a pull request destroys its environment.
- CI authenticates to AWS with OIDC and Platform's `GitHubDeploymentRole`.

### Impact

- **New:** `cloud-tests/`, three GitHub workflows, `AWS_DEV_DEPLOY_ROLE_ARN`
  repository secret.
- **Changed:** AGENTS.md (directory structure, note on cloud tests),
  `scripts/dev-prepare.zsh` (Chromium check).
- **Depends on:** Platform unblocking this repository from assuming
  `GitHubDeploymentRole`.
- **Cost:** a deploy and Bedrock tokens per relevant push.

## `specs/cloud-tests/spec.md`

### ADDED Requirements

#### Requirement: Target an environment

The suite SHALL test the environment named by `ENVIRONMENT`, defaulting to
`$USER`.

- **Scenario: stacks found**
  - **WHEN** stacks tagged with the environment exist
  - **THEN** the suite reads their endpoint and Cognito outputs and runs
- **Scenario: no stacks**
  - **WHEN** no stacks are tagged with the environment
  - **THEN** the suite fails with a message naming it

#### Requirement: API round trip

The suite SHALL check that a message can be sent to a new thread and is
stored.

- **Scenario: thread invoked**
  - **WHEN** the test invokes a new thread with a dummy prompt
  - **THEN** the stream has `RUN_STARTED`, a text message event and
    `RUN_FINISHED`, in that order
  - **AND** listing the thread's messages returns a user and an assistant
    message

#### Requirement: UI sign-in

The suite SHALL check that a user can sign in to the Demo UI.

- **Scenario: sign in**
  - **WHEN** the Demo UI's health check returns 200
  - **AND** the test signs in through the Hosted UI as a test user
  - **THEN** the chat page renders
- **Scenario: Demo UI not ready**
  - **WHEN** the health check doesn't return 200 before the timeout
  - **THEN** the UI suite fails without running its tests

#### Requirement: Throwaway test users

Each UI run SHALL use its own Cognito user and SHALL NOT print its password.

- **Scenario: tests pass or fail**
  - **WHEN** the UI suite finishes, whatever the result
  - **THEN** its user is deleted

#### Requirement: Cloud tests stay out of standard checks

`dev-checks.sh` and `cloud-tests-ci.yaml` SHALL NOT run tests that need
AWS.

#### Requirement: Local runs

The test scripts SHALL NOT deploy.

- **Scenario: no credentials**
  - **WHEN** a developer runs a test script without AWS credentials
  - **THEN** it stops with the refresh suggestion
- **Scenario: runner arguments**
  - **WHEN** a developer passes extra arguments, such as `--headed`
  - **THEN** they reach the test runner

#### Requirement: Pull request environments

CI SHALL deploy and test a `test-pr-<number>` environment for pull requests
that change `services/`, `cdk/`, `cloud-tests/`, lockfiles, `.nvmrc`,
`.python-version`, `tsconfig.json`, the `setup-node-pnpm-env` action or
the workflow.

- **Scenario: relevant push**
  - **WHEN** a push changes a watched path
  - **THEN** CI deploys the environment and runs the suite
- **Scenario: docs-only push**
  - **WHEN** a push changes no watched path
  - **THEN** nothing runs
- **Scenario: newer push**
  - **WHEN** a push lands while that pull request's run is in progress
  - **THEN** the older run is cancelled

#### Requirement: Clean-up

CI SHALL destroy a pull request's environment when it closes, whatever
paths it changed.

- **Scenario: environment exists**
  - **WHEN** a pull request with `test-pr-<number>` stacks closes
  - **THEN** any run in progress is cancelled and the stacks are destroyed
- **Scenario: never deployed**
  - **WHEN** a pull request with no stacks closes
  - **THEN** clean-up succeeds

#### Requirement: No stored AWS credentials

CI SHALL authenticate to AWS with OIDC and SHALL NOT store long-lived AWS
credentials in GitHub.

## `design.md`

### Context

See the proposal. The [Unified Notification Service](https://github.com/govuk-once/gds-unified-notification-service)
already does this, and we follow it where we can.

### Goals / Non-goals

**Non-goals:** more than two tests, required checks, `stag` or `prod`,
asserting on LLM answers, a sweeper for leftover environments, faster
deploys.

### Decisions

- **Top-level `cloud-tests/` over `utilities/` or per service.** It tests
  the whole system; `utilities/` is dev tooling, and per-service suites
  can't share a deploy.
- **Finding stacks by CloudFormation tag over `cdk ls` or CDK naming
  helpers.** CDK already tags stacks with `Environment` and `ServiceName`.
  `cdk ls` synthesises the app, which is slow and needs a GitHub token;
  importing the helpers crosses package boundaries.
- **Vitest for the API test, Playwright Test for the UI test, over one
  runner.** Vitest matches the repo; Playwright Test brings fixtures,
  retries and the trace viewer, which running it inside Vitest would lose.
- **Signing in through the Hosted UI over forging a session cookie.** The
  cookie would need a test-only way into the Demo UI.
- **Only the UI test waits for health.** ECS tasks can still be starting
  when CloudFormation finishes; Lambdas and AgentCore are ready.
- **Testing existing stacks locally over deploying a separate
  environment.** Developers already deploy their branch; deploying again
  would double the work and could drift. `deploy.sh` and `destroy.sh` are
  there for anyone who wants a separate environment.
- **Per-PR environments over a shared environment after merge, a fresh one
  per run, or deploying on a label.** Tests before merge, reuses stacks
  between pushes, and doesn't rely on remembering a label.
- **One agent stack per PR over sharing one.** Agent changes are tested in
  isolation. Revisit if it dominates deploy time.
- **Cancelling in-progress runs is safe.** Cancelling stops `cdk`, but
  CloudFormation completes or rolls back the stack it's updating. We expect
  the next `cdk deploy` to wait for that stack; PR 2 checks this.
- **Clean-up checks with the AWS CLI before synthesising.** Most pull
  requests never deployed, and synthesis needs a GitHub App token.
- **Platform's `GitHubDeploymentRole` over our own role.** No IAM work, and
  it matches other teams. We opted in to immutable OIDC subject claims on
  2026-11-02, which the role expects, rather than ask Platform to trust the
  legacy subject.
- **Public ECR login over a pull-through cache.** One step; the cache is the
  fallback.

### Risks / Trade-offs

- PR code gets administrator access to the dev account → only team members
  can push; forks get no OIDC token.
- Another AWS customer holds the `test-pr-<number>-govuk-chat` Cognito
  domain → the first deploy shows it; change the prefix.
- Teardown leaves resources behind → PR 2 checks; informs the sweeper.
- Deploys are too slow → measure before optimising.
- Bedrock spend → short prompt, path filters.
- Cognito changes the Hosted UI → selectors use roles and labels.
- Public ECR login doesn't stop 429s → pull-through cache.

### Migration plan

None. The check isn't required, so a broken run doesn't block merging.

### Open questions

- What denies this repository from assuming `GitHubDeploymentRole`? A test
  workflow on [#438](https://github.com/govuk-once/govuk-chat-v2/pull/438)
  is denied though CloudTrail shows its token matches the trust policy.
  Asked Platform.
- Do Platform want teams to use this role from CI, or a separate account?
  Asked Platform.

## `tasks.md`

### 1. Package and API test, run locally

- [ ] 1.1 Add the package, its checks, `cloud-tests-ci.yaml`, and the
      AGENTS.md changes. Verify: `dev-checks.sh` passes without AWS.
- [ ] 1.2 Add `environment.ts`. Verify: an unknown `ENVIRONMENT` fails with
      its name.
- [ ] 1.3 Add the API test and `test.sh`. Verify: passes against your own
      stacks; stops without credentials.

### 2. Deploy and clean up per pull request

Blocked on Platform and the `AWS_DEV_DEPLOY_ROLE_ARN` secret.

- [ ] 2.1 Add `deploy.sh` and `destroy.sh`.
- [ ] 2.2 Add the deploy workflow, without tests. Verify on a test PR: each
      "Pull request environments" scenario; record first deploy and
      redeploy times.
- [ ] 2.3 Add the clean-up workflow. Verify: each "Clean-up" scenario;
      nothing left in CloudFormation, Cognito, ECR, CloudWatch Logs or
      AgentCore; record destroy time.

### 3. API test in CI

- [ ] 3.1 Run `test.sh` after deploying. Verify: passes; record time.

### 4. UI test

- [ ] 4.1 Add Playwright, the UI test, setup, teardown and the Chromium
      check. Verify: passes locally; user deleted after a failing run.
- [ ] 4.2 Run it in CI and upload traces on failure. Verify: passes in CI.
      Set **implemented**.

---

## Notes for the spec skill

Result: about 1,400 words. The proposal alone is about 150 words and is
the best "should I care?" read so far.

What worked:

- **The proposal's shape:** one or two sentences of why, a bullet list of
  what changes, then impact (new, changed, depends on, cost). "Impact" is a
  useful prompt our template lacks: it made dependencies and cost explicit
  in one place.
- **"X over Y" decisions,** each one sentence of reason. The heading
  carries the rejected option, so there's no separate alternatives section.
- **"[Risk] → Mitigation"** keeps every risk to one line.
- **Tasks that say how to verify them** merge the plan and the test plan.
- **"Reference, don't restate":** design's Context section is one line.

What didn't fit us:

- **SHALL requirements with scenarios are verbose for set-up work.** Every
  scenario restates its trigger in full. They're designed to merge into a
  living spec of the system, which we don't keep: our specs are
  point-in-time records. The delta format (ADDED / MODIFIED / REMOVED)
  earns its place only with a living spec to apply it to.
- **Four files multiply the navigation.** A reviewer on a GitHub pull
  request would jump between files, and review comments scatter. One file
  with a proposal-shaped top is simpler for us.
- **SHALL / SHALL NOT** reads as legal language. GOV.UK style uses "must".

For the skill:

- Adopt the proposal's shape for the top of the spec: **Why** (1–2
  sentences), **What changes** (bullets), **Impact** (new, changed, depends
  on, cost).
- Write decisions as "**X over Y.** Reason."
- Write risks as "Risk → mitigation", one line each.
- Make each plan step say how it'll be verified, and drop the separate
  testing section.
- Keep requirements in plain "must" language, and use scenarios only where
  behaviour branches on an event or input.
