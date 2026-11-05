# Run cloud tests against deployed environments

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

- A developer can run a small cloud test suite from their machine against a deployed
  environment with one command.
- Every relevant pull request deploys its own environment and runs the same
  suite against it in CI.
- PR environments are torn down when the PR closes.
- We learn what deploying per PR costs us in time, so we can decide what to
  optimise next.

## Non-goals

- Broad test coverage. The suite is deliberately two tests; expanding it is
  later work.
- Blocking merges on cloud test results. The check is informational until it has
  proven reliable.
- Running cloud tests against `stag` or `prod`, or after deploys to them.
- Asserting on what the LLM says. Answers vary between runs; the tests check
  the protocol and persistence around them.
- A sweeper for PR stacks left behind by a failed teardown (see
  [Follow-ups](#follow-ups)).
- Optimising deploy time, or caching base images in a pull-through cache.

## Requirements

1. **R1:** The suite lives in a new `cloud-tests` package, registered in the pnpm
   workspace, with a README and a `scripts/` directory following the package
   conventions in AGENTS.md.
2. **R2:** The suite targets the environment named by `ENVIRONMENT`, defaulting
   to `$USER` as the CDK does, and reads endpoint URLs and Cognito identifiers
   from that environment's CloudFormation stack outputs. If the stacks can't be
   found it fails with a message naming the environment.
3. **R3:** Before running the UI tests, the suite waits for the Demo UI's
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
9. **R9:** On pull requests that change `services/`, `cdk/`, `cloud-tests/`,
   the lockfiles (`pnpm-lock.yaml`, `uv.lock`), tooling files (`.nvmrc`,
   `.python-version`, `tsconfig.json`), the shared actions the workflow uses
   (`.github/actions/setup-node-pnpm-env/*`) or the workflow itself, CI
   deploys all stacks with `ENVIRONMENT=test-pr-<number>` and runs the suite
   against them.
10. **R10:** Only one cloud test run per PR happens at a time, and a newer push to a
    PR cancels that PR's in-progress run.
11. **R11:** When any PR closes, whatever paths it changed, CI destroys that
    PR's stacks if it has any, and succeeds if it has none.
12. **R12:** CI authenticates to AWS with OIDC. No long-lived AWS credentials
    are stored in GitHub.
13. **R13:** CI authenticates to public ECR before deploying, so base image
    pulls aren't rate limited as anonymous pulls.

## Design

### Package

A new top-level `cloud-tests/` directory holds the suite, which tests the
system as a whole rather than one service. It is a TypeScript package,
`@govuk-chat-v2/cloud-tests`, added to `pnpm-workspace.yaml`. It is dedicated
to tests against deployed infrastructure, so it doesn't become a home for
other kinds of test. AGENTS.md's directory structure gains an entry for
`cloud-tests/`.

```
cloud-tests/
  README.md
  package.json
  tsconfig.json
  vitest.config.ts       # includes src/api only
  playwright.config.ts   # testDir src/ui
  src/
    environment.ts       # resolve stack outputs (R2)
    api/
      thread-journey.test.ts       # R4
    ui/
      global-setup.ts    # wait for health, create test user (R3, R6)
      global-teardown.ts # delete test user (R6)
      homepage.test.ts   # R5
  scripts/
    dev-checks.sh        # lint, format, type-check; doesn't call test.sh (R8)
    format.sh, lint.sh, type-check.sh  # symlinks to scripts/shared
    test.sh              # API and UI tests, needs AWS (R7)
    test-api.sh          # vitest only (R7)
    test-ui.sh           # playwright only, args passed through (R7)
    deploy.sh            # deploy all stacks for ENVIRONMENT
    destroy.sh           # destroy all stacks for ENVIRONMENT
```

As in other packages, `test.sh` runs the package's tests. Unlike them,
`dev-checks.sh` and `cloud-tests-ci.yaml` don't run it, because every test
here needs AWS (R8).

Both runners read test files named `.test.ts`, as the rest of the repo does,
and are kept apart by their configured directories.

### Finding the environment

The tests need URLs and Cognito IDs from the deployed stacks, which the stacks
publish as CloudFormation outputs. So the tests first have to find which
stacks belong to the environment under test.

CDK already tags every stack with its environment and service, e.g.
`Environment=jweeden` or `Environment=test-pr-123`, and
`ServiceName=govuk-chat`. `environment.ts` asks CloudFormation for the stacks
carrying both tags, then reads these outputs:

- from the `ChatApiStack`: `GatewayUrl`, `TokenEndpoint`, `UserPoolId`,
  `AppClientId`
- from the `DemoUiStack`: `EndpointUrl`, `SignInClientId`

If it finds no stacks for that environment, it fails with a message naming
the environment (R2).

Looking stacks up by tag means the tests don't need to know how CDK builds
stack names. Rebuilding the names would mean importing CDK code across
package boundaries. Running `cdk ls`, as `fetch-cdk-output.sh` does,
synthesises the whole app, which is slow and needs a GitHub token.

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

Playwright's global setup first polls the Demo UI's `/api/health`. ECS tasks
can still be starting after CloudFormation reports the deploy complete, while
the API's Lambdas and AgentCore runtime are ready by then, so only the UI tests
wait.

Global setup then creates a user named `cloud-test-<random>` with
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

`source scripts/dev-prepare.zsh` gains a step that checks Playwright's
Chromium is installed and, if it isn't, tells the developer the command to
install it, as it does for its other dependencies. A developer deploys their
own stacks as they do today, then runs:

```sh
cloud-tests/scripts/test.sh                          # your own $USER stacks
ENVIRONMENT=test-pr-123 cloud-tests/scripts/test.sh  # a PR's stacks
cloud-tests/scripts/test-ui.sh --headed              # watch the browser
```

The test scripts don't deploy. Developers already deploy their branch to
their own stacks to try changes, so the suite tests whatever is there.

To test in a separate environment, for instance to keep work in progress on
your own stacks, a developer uses the package's `deploy.sh` and `destroy.sh`,
which CI uses too:

```sh
ENVIRONMENT=$USER-cloud cloud-tests/scripts/deploy.sh
ENVIRONMENT=$USER-cloud cloud-tests/scripts/test.sh
ENVIRONMENT=$USER-cloud cloud-tests/scripts/destroy.sh
```

`deploy.sh` runs `cdk deploy --all --require-approval never` and `destroy.sh`
runs `cdk destroy --all --force`, both for `ENVIRONMENT`. Neither writes an
outputs file, since the tests read outputs from CloudFormation. `destroy.sh`
first looks for stacks tagged with the environment, and if there are none it
says so and exits successfully.

The scripts run `check-dev-aws-credentials.sh` first, unless passed
`--skip-credentials`, following `fetch-cdk-output.sh`. CI passes that flag,
as the check relies on the GDS CLI.

### CI

A new `cloud-tests-ci.yaml` runs format, lint and type checks for the package
on changes to `cloud-tests/`, like the other packages' `-ci` workflows (R8).

A new `cloud-tests-pr-environment.yaml` runs on `pull_request`, filtered to the
paths in R9 (R9):

1. Check out the code and set up Node with the existing
   `setup-node-pnpm-env` action.
2. Create a token for the private repo with the GitHub App step `cdk-ci.yaml`
   uses, since synthesising `AguiAgentStack` needs it.
3. Assume the deploy role with `aws-actions/configure-aws-credentials`, using
   the role ARN from a repository secret (R12).
4. Log in to public ECR with
   `aws ecr-public get-login-password --region us-east-1` (R13).
5. Run `deploy.sh --skip-credentials` with `ENVIRONMENT=test-pr-<number>`.
6. Install Playwright's Chromium, then run `test.sh --skip-credentials`.
7. Upload the Playwright report and traces if the tests fail.

The workflow uses a concurrency group per PR with `cancel-in-progress: true`
(R10), as UNS does. Cancelling a run only stops the `cdk` process:
CloudFormation carries on with any stack update in progress and completes or
rolls it back as normal, so nothing is left half-applied. If the cancel lands
between stacks, the later stacks aren't updated, but the next run deploys them
anyway. The next run may start while a stack is still updating; we expect
`cdk deploy` to wait for the stack to settle, and the testing below checks
this. The workflow isn't added to the required checks.

A new `cloud-tests-pr-environment-cleanup.yaml` runs on every `pull_request`
`closed`, with no path filter, since a PR may have deployed in an earlier
commit and later dropped the changes that matched the filter. It assumes the
role and checks with the AWS CLI for stacks tagged
`Environment=test-pr-<number>`. Most PRs never deployed, so it usually stops
there, without synthesising the app. Otherwise it creates the private repo
token (the CDK app requires `GITHUB_TOKEN` even to destroy) and runs
`destroy.sh --skip-credentials` with `ENVIRONMENT=test-pr-<number>` (R11). It shares the PR's concurrency group, so
closing a PR cancels any run still deploying before the stacks are destroyed.

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
(`repo:govuk-once@241280733/<repo>@<id>:…`). It is built from the organisation
and repository IDs rather than their names, so renaming either can't change
which repository a token claims to come from. Repositories created before
15 July 2026 keep the legacy `repo:govuk-once/govuk-chat-v2` form unless they
opt in, as other govuk-once repositories have.

We could instead have asked Platform to add the legacy subject to the role's
trust policy, but the role is managed by their account bootstrapping, and it
would go against the format the other repositories use. So on 2026-11-02 we
opted this repository in to immutable subject claims. It only affects OIDC
tokens, and nothing else here uses them.

Using Platform's shared role rather than one of our own means no IAM work and
matches how other teams deploy from CI. However, it doesn't work for us yet.
A throwaway workflow on a draft PR
([#438](https://github.com/govuk-once/govuk-chat-v2/pull/438)) assumes the role
and is denied `sts:AssumeRoleWithWebIdentity`, even though:

- its token's subject, `repo:govuk-once@241280733/govuk-chat-v2@1125418398:pull_request`,
  and audience match the role's trust policy, as CloudTrail confirms
- it is denied through both eu-west-1 and eu-west-2
- Platform's `aws-account-bootstrapping` repository assumes roles in the same
  account successfully, so the provider works

Something outside the role, most likely an organisation-level control, denies
this repository. We have asked Platform to unblock it. Once they have, we add a
repository secret, `AWS_DEV_DEPLOY_ROLE_ARN`, holding the role's ARN.

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

Split into four small pull requests, so each one tells us whether the next is
worth the effort before we put much into it. The local API test comes first
because it is useful on its own and needs nothing from anyone else, while CI
access waits on Platform (see [AWS access from CI](#aws-access-from-ci)).

### PR 1: cloud test package with the API test, runnable locally

1. Add the `cloud-tests` package with its README, `package.json`, `tsconfig`,
   lint, format and type-check scripts, `dev-checks.sh`, and register it in
   `pnpm-workspace.yaml`. Update AGENTS.md: add `cloud-tests/` to the
   directory structure, point the Development section's note on tests that
   need cloud infrastructure at it, and note that its `dev-checks.sh` doesn't
   run its tests. (R1, R8)
2. Add `cloud-tests-ci.yaml` for format, lint and type checks. (R8)
3. Add `environment.ts`, resolving stack outputs by tag. (R2)
4. Add Vitest config, `test-api.sh`, `test.sh` (running the API tests only for
   now) and the thread journey test. (R4, R7)

Before PR 2, the throwaway workflow on
[#438](https://github.com/govuk-once/govuk-chat-v2/pull/438) must be able to
assume the role, proving CI can reach AWS. It isn't merged. (R12)

### PR 2: deploy and clean up a stack per PR

The bare minimum to learn what deploying per PR is like, with no tests yet.

5. Add `deploy.sh` and `destroy.sh` to the package.
6. Add `cloud-tests-pr-environment.yaml`, deploying only: OIDC, public ECR
   login, path filters and concurrency. (R9, R10, R12, R13)
7. Add `cloud-tests-pr-environment-cleanup.yaml`. (R11)

### PR 3: run the API test against PR environments

8. Run `test.sh --skip-credentials` in `cloud-tests-pr-environment.yaml` after
   deploying. (R9)

### PR 4: add Playwright

9. Add Playwright config, global setup waiting for the Demo UI health check
   and creating the test user, teardown, `test-ui.sh` and the homepage test.
   Make `test.sh` run both suites. Check for Chromium in `dev-prepare.zsh`.
   (R3, R5, R6, R7)
10. Install Chromium in `cloud-tests-pr-environment.yaml`, and upload the
    Playwright report and traces if the tests fail.

Set **implemented** in PR 4.

### Testing

The suite is itself the test of R2 to R6. `environment.ts` and the health poll
have no unit tests: their logic is a tag filter and a polling loop, and every
cloud test run exercises both.

- **PR 1:** run the API test against a developer's own stacks. Check R7 by
  running the scripts without AWS credentials and confirming they stop with
  the refresh suggestion.
- **PR 2:** open a test PR and check that:
  - the first push deploys `test-pr-<number>`
  - a second push updates the stacks rather than recreating them
  - pushing during a deploy cancels the old run, and the new run deploys
    successfully
  - closing the PR during a deploy cancels the run, and the stacks are still
    destroyed
  - a documentation-only change doesn't trigger the workflow
  - closing a PR that never deployed succeeds without error
  - closing the PR destroys every `test-pr-<number>` stack, and nothing is
    left in CloudFormation, Cognito, ECR, CloudWatch Logs or AgentCore

  Record the timings of a first deploy, a no-change redeploy and a destroy in
  the PR description.

- **PR 3:** the API test passes against a PR environment. Record how long the
  test run takes.
- **PR 4:** run the UI test locally and in CI, including a run where it fails,
  to check the test user is still deleted.

### Rollout

- PR 2 can't run until Platform has unblocked this repository from assuming
  `GitHubDeploymentRole`, the experiment on
  [#438](https://github.com/govuk-once/govuk-chat-v2/pull/438) passes, and the
  `AWS_DEV_DEPLOY_ROLE_ARN` secret is added.
- The workflow isn't a required check, so a broken run doesn't block merging.

## Risks

- **Cognito domain prefixes are unique across AWS within a region.** Each PR
  environment registers `test-pr-<number>-govuk-chat` as a Hosted UI domain, which
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

- What denies this repository from assuming `GitHubDeploymentRole`, and can
  Platform allow it? We've asked Platform.
- Is `GitHubDeploymentRole` what Platform expect a team's repository to use
  for CI deploys, or would they prefer something else, such as a separate
  `once-chat-ci` account? We've asked Platform.

## Follow-ups

These are out of scope here and become their own tickets:

- A scheduled sweeper that destroys PR environments whose PR has closed.
  Platform's [aws-stack-cleanup](https://github.com/govuk-once/aws-stack-cleanup)
  already finds stale stacks by tag and age, so it may do this for us.
- Moving cloud tests to a separate CI account, once they've proven their
  value.
- Making the cloud test check required once it has run reliably for a while.
- Reducing deploy time, if the measurements call for it, for example by
  sharing an agent stack or skipping unchanged stacks.
- A pull-through cache for base images, if public ECR login isn't enough.
- More tests, chosen from bugs that unit tests didn't catch.
