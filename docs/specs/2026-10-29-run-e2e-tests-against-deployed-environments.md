# Run e2e tests against deployed environments

**Date:** 2026-10-29

**Status:** accepted

## Problem

GOV.UK Chat V2 depends on AWS managed services (AgentCore, Bedrock, Cognito,
API Gateway, DynamoDB, ECS) and only behaves accurately on AWS. Our automated
tests are unit tests with the AWS services mocked out, and CI only runs
formatting, linting, type checks, unit tests and `cdk synth`. Nothing checks
that a deployed system works as a whole, so a change that breaks wiring between
the stacks, IAM permissions or authentication is only found by a developer
trying it by hand.

Ticket CHAT-1119 asks us to explore tests that use deployed AWS infrastructure
and can run from both CI and developer machines, taking inspiration from the
[Unified Notification Service](https://github.com/govuk-once/gds-unified-notification-service)
(UNS), which has done this. The content of the tests matters less than getting
the set-up working: the ticket suggests loading the Web UI homepage and making a
single API request.

## Goals

- A developer can run a small e2e suite from their machine against a deployed
  environment with one command.
- Every relevant pull request deploys its own environment and runs the same
  suite against it in CI.
- PR environments are torn down when the PR closes.
- We learn what deploying per PR costs us in time, so we can decide what to
  optimise next.

## Non-goals

- Broad test coverage. The suite is deliberately two tests; expanding it is
  later work.
- Blocking merges on e2e results. The check is informational until it has
  proven reliable.
- Running e2e against `stag` or `prod`, or after deploys to them.
- Asserting on what the LLM says. Answers vary between runs; the tests check
  the protocol and persistence around them.
- A sweeper for PR stacks left behind by a failed teardown (see
  [Follow-ups](#follow-ups)).
- Optimising deploy time, or caching base images in a pull-through cache.

## Requirements

1. **R1:** The suite lives in a new `tests/e2e` package, registered in the pnpm
   workspace, with a README and a `scripts/` directory following the package
   conventions in AGENTS.md.
2. **R2:** The suite targets the environment named by `ENVIRONMENT`, defaulting
   to `$USER` as the CDK does, and reads endpoint URLs and Cognito identifiers
   from that environment's CloudFormation stack outputs. If the stacks can't be
   found it fails with a message naming the environment.
3. **R3:** Before running tests, the suite waits for the Demo UI's
   `/api/health` to return 200, failing after a timeout.
4. **R4:** An API test gets a client-credentials token from Cognito, invokes a
   new thread with a dummy prompt, and asserts the stream contains
   `RUN_STARTED`, at least one text message event and `RUN_FINISHED`, in that
   order. It then fetches that thread's messages and asserts both the user's
   message and an assistant message were stored.
5. **R5:** A UI test signs in to the Demo UI through the Cognito Hosted UI as a
   test user and asserts the chat page renders.
6. **R6:** Each UI test run creates its own Cognito user with a unique
   username and random password, and deletes it afterwards, including when
   tests fail. The password is never printed.
7. **R7:** Tests that need AWS run from a script separate from
   `dev-checks.sh`. Locally the script checks AWS credentials with
   `check-dev-aws-credentials.sh`, doesn't deploy anything, and passes extra
   arguments through to the test runner (e.g. Playwright's `--headed`).
8. **R8:** `dev-checks.sh` and the package's `-ci` workflow run formatting,
   linting and type checks only, so they never need AWS.
9. **R9:** On pull requests that change `services/`, `cdk/`, `tests/e2e/`,
   shared dependency or tooling files, or the workflow itself, CI deploys all
   stacks with `ENVIRONMENT=pr-<number>` and runs the suite against them.
10. **R10:** Only one e2e run per PR happens at a time, and a newer push never
    cancels a deploy in progress.
11. **R11:** When a PR closes, CI destroys all of that PR's stacks.
12. **R12:** CI authenticates to AWS with OIDC. No long-lived AWS credentials
    are stored in GitHub.
13. **R13:** CI authenticates to public ECR before deploying, so base image
    pulls aren't rate limited as anonymous pulls.

## Design

### Package

A new top-level `tests/` directory holds suites that test the system as a
whole rather than one service. `tests/e2e` is a TypeScript package,
`@govuk-chat-v2/e2e-tests`, added to `pnpm-workspace.yaml` as `tests/*`.
AGENTS.md's directory structure gains an entry for `tests/`.

```
tests/e2e/
  README.md
  package.json
  tsconfig.json
  vitest.config.ts       # includes src/api only
  playwright.config.ts   # testDir src/ui
  src/
    environment.ts       # resolve stack outputs, wait for health (R2, R3)
    api/
      thread-journey.test.ts       # R4
    ui/
      global-setup.ts    # create test user (R6)
      global-teardown.ts # delete test user (R6)
      homepage.test.ts   # R5
  scripts/
    dev-checks.sh        # lint, format, type-check (R8)
    format.sh, lint.sh, type-check.sh  # symlinks to scripts/shared
    test-api.sh          # vitest, needs AWS (R7)
    test-ui.sh           # playwright, needs AWS (R7)
    test-e2e.sh          # both (R7)
```

The AWS-backed scripts are named `test-*.sh` rather than `test.sh`, because
`test.sh` in other packages means tests that run without cloud
infrastructure, and `dev-checks.sh` runs it. Keeping the name free means
nothing that runs `test.sh` across packages starts calling AWS.

Both runners read test files named `.test.ts`, as the rest of the repo does,
and are kept apart by their configured directories.

### Finding the environment

The stacks are tagged with `ServiceName` and `Environment`. `environment.ts`
lists CloudFormation stacks, picks those tagged `ServiceName=govuk-chat` and
`Environment=<env>`, and reads the outputs it needs from the stacks whose
names end in `ChatApiStack` and `DemoUiStack`:

- `ChatApiStack`: `GatewayUrl`, `TokenEndpoint`, `UserPoolId`, `AppClientId`
- `DemoUiStack`: `EndpointUrl`, `SignInClientId`

`<env>` is `ENVIRONMENT` or `USER`, with the same character stripping as
`getEnvironment()` in `cdk/src/constants/environment.ts`.

Matching on tags avoids importing from the `cdk` package, which AGENTS.md
asks us not to do across package boundaries. It also avoids running
`cdk ls` as `fetch-cdk-output.sh` does, which synthesises the app and so
needs a GitHub token.

### API test

The test reads the app client's secret with `DescribeUserPoolClient`, and
requests a token from `TokenEndpoint` with the client-credentials grant. It
then calls `POST /v1/threads/invoke` as the Chat API README shows, with random
`threadId`, `runId`, message id and `end-user-id`, and a short dummy prompt.
It parses the server-sent events, and then calls
`GET /v1/threads/{threadId}/messages` with the same `end-user-id`.

The prompt is a dummy written for the test, not a production prompt. The test
asserts on event types and stored message roles, not on the answer's content,
so differences between LLM runs don't make it flaky.

### UI test

Playwright's global setup creates a user named `e2e-<random>` with
`AdminCreateUser` (with the welcome message suppressed) and sets a random
permanent password with `AdminSetUserPassword`, as
`services/demo-ui/scripts/create-dev-user.sh` does. It passes the credentials
to the test through environment variables set in-process. Global teardown
deletes the user with `AdminDeleteUser`.

The test opens the Demo UI's `EndpointUrl`, follows the redirect to the
Hosted UI, signs in, and asserts it lands back on the chat page. Using a
unique username means a run never touches a developer's own user created by
`create-dev-user.sh`.

### Running locally

`source scripts/dev-prepare.zsh` gains a step to install Playwright's
Chromium. A developer deploys their own stacks as they do today, then runs:

```sh
tests/e2e/scripts/test-e2e.sh                     # your own $USER stacks
ENVIRONMENT=pr-123 tests/e2e/scripts/test-e2e.sh  # a PR's stacks
tests/e2e/scripts/test-ui.sh --headed             # watch the browser
```

The scripts don't deploy. Developers already deploy their branch to their own
stacks to try changes, so the suite tests whatever is there. To test in a
separate environment, for instance to keep work in progress on your own
stacks, the README documents deploying, testing and destroying with
`ENVIRONMENT=$USER-e2e`. This needs no extra tooling.

The scripts run `check-dev-aws-credentials.sh` first, unless passed
`--skip-credentials`, following `fetch-cdk-output.sh`. CI passes that flag,
as the check relies on the GDS CLI.

### CI

A new `e2e-tests-ci.yaml` runs format, lint and type checks for the package on
changes to `tests/e2e/`, like the other packages' `-ci` workflows (R8).

A new `e2e-tests-pr-environment.yaml` runs on `pull_request`, filtered to the
paths in R9 (R9):

1. Check out the code and set up Node with the existing
   `setup-node-pnpm-env` action.
2. Create a token for the private repo with the GitHub App step `cdk-ci.yaml`
   uses, since synthesising `AguiAgentStack` needs it.
3. Assume the deploy role with `aws-actions/configure-aws-credentials`, using
   the role ARN from a repository secret (R12).
4. Log in to public ECR with
   `aws ecr-public get-login-password --region us-east-1` (R13).
5. `cdk deploy --all --require-approval never` with
   `ENVIRONMENT=pr-<number>`.
6. Install Playwright's Chromium, then run `test-e2e.sh --skip-credentials`.
7. Upload the Playwright report and traces if the tests fail.

The workflow uses a concurrency group per PR with `cancel-in-progress: false`
(R10). Cancelling a CloudFormation deploy halfway leaves stacks in a state
that needs rolling back before the next deploy. It isn't added to the required
checks.

A new `e2e-tests-pr-environment-cleanup.yaml` runs on `pull_request` `closed`,
creates the private repo token (the CDK app requires `GITHUB_TOKEN` even to
destroy), assumes the role, and runs `cdk destroy --all --force` with
`ENVIRONMENT=pr-<number>` (R11).

Each step's duration appears in the Actions UI, which gives us the deploy
timings the ticket asks for.

### AWS access from CI

GitHub Actions requests an OIDC token, and AWS exchanges it for short-lived
credentials for a role whose trust policy accepts the token. This is the
approach UNS, flex and other govuk-once repos use.

Most of this already exists in the dev account (`207513914339`), created by
the Platform team's account bootstrapping:

- the GitHub OIDC identity provider (`token.actions.githubusercontent.com`,
  audience `sts.amazonaws.com`)
- `GitHubDeploymentRole`, which trusts any repository in the govuk-once
  organisation for branches, environments and `pull_request`, and has
  administrator access

The role's trust policy matches GitHub's immutable subject format
(`repo:govuk-once@241280733/<repo>@<id>:…`). Other govuk-once repositories use
that format, but this one still sends the legacy `repo:govuk-once/govuk-chat-v2`
form, so AWS would refuse its tokens. To use the role we need to:

1. switch this repository to immutable OIDC subject claims, which a repository
   admin can do in the repository's Actions settings; nothing here uses OIDC
   yet, so nothing else is affected
2. add a repository secret, `AWS_DEV_DEPLOY_ROLE_ARN`, holding the role's ARN

Using Platform's shared role rather than one of our own means no IAM work and
matches how other teams deploy from CI.

### Security

- No AWS credentials are stored in GitHub (R12).
- Test users exist only for the length of a run and have random passwords
  that are never printed (R6).
- PR environments are ephemeral by `isEphemeralEnvironment()`, so their user
  pools and tables are destroyed with the stack.
- Running deploys on `pull_request` means PR code runs with administrator
  access to the dev account, through Platform's shared deploy role. That's
  acceptable for branches in this repository, which only team members can
  push to; forks get no OIDC token.

## Alternatives considered

- **Run tests against a shared, long-lived environment after merging.**
  Cheaper and quicker to set up, but PRs wouldn't be tested before merging,
  and runs would have to be serialised.
- **Create a fresh environment on every CI run.** Clean every time, but every
  push would pay for a full deploy from scratch and a destroy.
- **Deploy PR environments only when a label is added.** Cheapest, but easy
  to forget. Path filters skip PRs that only change documentation instead.
- **Share one `AguiAgentStack` between PR environments.** Probably faster,
  but PRs that change the agent wouldn't be tested in isolation. We'll
  revisit it if measurements show the agent stack dominates deploy time.
- **Playwright Test for the API tests too.** One runner and report, but the
  rest of the repo uses Vitest, as UNS does for its API tests.
- **Drive Playwright from Vitest.** One runner, but we'd lose Playwright
  Test's fixtures, retries and trace viewer.
- **Skip the sign-in page by creating a session cookie directly.** Faster and
  less brittle, but needs a test-only way into the Demo UI's session code.
- **Run local tests in a separate environment by default.** Every change
  would be deployed twice, to your own stacks and the test environment, and
  the two could drift apart.
- **Put the package in `utilities/` or alongside each service.**
  `utilities/` is for dev tooling, and per-service tests can't easily share
  one deploy and one run.
- **Find stacks with `fetch-cdk-output.sh` or by importing the CDK naming
  helpers.** The script synthesises the app, and importing reaches across
  package boundaries.

## Implementation plan

Split into two pull requests. The first is useful on its own, as developers
can run the suite against their stacks, and needs no changes to repository
settings. The second needs the OIDC subject claim change and the role secret,
so it can wait for them without blocking the first.

### PR 1: e2e test package, runnable locally

1. Add the `tests/e2e` package with its README, `package.json`, `tsconfig`,
   lint, format and type-check scripts, `dev-checks.sh`, and register
   `tests/*` in `pnpm-workspace.yaml`. Add `tests/` to AGENTS.md's directory
   structure. (R1, R8)
2. Add `e2e-tests-ci.yaml` for format, lint and type checks. (R8)
3. Add `environment.ts`, resolving stack outputs by tag and waiting for the
   Demo UI health check. (R2, R3)
4. Add Vitest config, `test-api.sh` and the thread journey test. (R4, R7)
5. Add Playwright config, test user setup and teardown, `test-ui.sh`, the
   homepage test and `test-e2e.sh`. Install Chromium in `dev-prepare.zsh`.
   (R5, R6, R7)

### PR 2: PR environments in CI

6. Add `e2e-tests-pr-environment.yaml`: OIDC, public ECR login, deploy and
   test. (R9, R10, R12, R13)
7. Add `e2e-tests-pr-environment-cleanup.yaml`. (R11)

Set **implemented** in PR 2.

### Testing

- The suite is itself the test of R2 to R6. Run it against a developer's own
  stacks before merging PR 1, including a run where the UI test fails, to
  check the test user is still deleted.
- `environment.ts` has no unit tests: its logic is a tag filter and a polling
  loop, and every e2e run exercises both.
- Check R7 by running the scripts without AWS credentials and confirming they
  stop with the refresh suggestion.
- For PR 2, open a test PR and check that:
  - the first push deploys `pr-<number>` and the tests pass
  - a second push updates the stacks rather than recreating them
  - pushing during a deploy queues the new run and doesn't cancel the old one
  - a documentation-only change doesn't trigger the workflow
  - closing the PR destroys every `pr-<number>` stack, and nothing is left in
    CloudFormation, Cognito, ECR, CloudWatch Logs or AgentCore
- Record the timings of a first deploy, a no-change redeploy, a test run and a
  destroy in the PR 2 description.

### Rollout

- PR 2 can't run until a repository admin has switched the repository to
  immutable OIDC subject claims and added the `AWS_DEV_DEPLOY_ROLE_ARN`
  secret.
- The workflow isn't a required check, so a broken run doesn't block merging.

## Risks

- **Cognito domain prefixes are unique across AWS within a region.** Each PR
  environment registers `pr-<number>-govuk-chat` as a Hosted UI domain, which
  another AWS customer could already hold. We'll find out on the first deploy;
  if it happens, the prefix needs a more distinctive form.
- **Teardown may leave resources behind.** Some resources may be retained or
  created outside CloudFormation, such as log groups or ECR images. The PR 2
  testing checks for this; anything left over shapes the sweeper follow-up.
- **Deploys may be too slow to run on every push.** AgentCore and ECS are
  likely the slowest parts. We'll measure before optimising.
- **Each run spends Bedrock tokens.** The prompt is short and asks for a short
  answer, and only PRs that match the path filters run.
- **Signing in through the Hosted UI may be brittle** if Cognito changes its
  page. Assertions use form roles and labels rather than layout.
- **Public ECR login may not stop the rate limiting.** If 429s continue, a
  pull-through cache in private ECR is the fallback.
- **Rate limits.** The Chat API allows 15 invokes a minute per end user; the
  test uses a random `end-user-id`, so it won't collide with other users.

## Open questions

- Is switching to immutable subject claims and using `GitHubDeploymentRole`
  how Platform expect a repository to start deploying from CI? Let's confirm
  this with Platform.
- Does the new top-level `tests/` directory need team agreement before PR 1,
  given it changes the layout AGENTS.md describes?

## Follow-ups

These are out of scope here and become their own tickets:

- A scheduled sweeper that destroys PR environments whose PR has closed.
  Platform's [aws-stack-cleanup](https://github.com/govuk-once/aws-stack-cleanup)
  already finds stale stacks by tag and age, so it may do this for us.
- Making the e2e check required once it has run reliably for a while.
- Reducing deploy time, if the measurements call for it, for example by
  sharing an agent stack or skipping unchanged stacks.
- A pull-through cache for base images, if public ECR login isn't enough.
- More tests, chosen from bugs that unit tests didn't catch.
