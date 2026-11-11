# Attempt 3: Progressive disclosure

Our specs assume one reader, reading from the top. Really
there are three:

1. **Someone who wants to know what's happening:** a teammate, a product
   manager, Platform. They need the summary and nothing else.
2. **A reviewer:** they need the decisions they're being asked to agree to,
   and the detail on the ones they question.
3. **The implementer, human or agent:** they need everything, including
   file names, outputs and edge cases.

This attempt layers the spec for them. The first screen (under 300 words)
is everything readers 1 and 2 need: a summary, every decision as one line,
the plan, and what's blocked. Below it, the detail is in collapsed
`<details>` sections that GitHub renders closed, so it's there for whoever
needs it but doesn't make everyone else scroll.

Each detail section gives the reason, the rejected alternatives and any
edge cases, and nothing else, because the one-line version already carries
the decision.

---

# Run cloud tests against deployed environments

**Date:** 2026-10-29 · **Status:** accepted · CHAT-1119

## Summary

Our tests mock AWS, so nothing checks a deployed system works. This adds:

- a `cloud-tests` package with two tests against a deployed environment: an
  API round trip through a thread, and signing in to the Demo UI
- `cloud-tests/scripts/test.sh`, to run them against your own stacks; it
  doesn't deploy
- a `test-pr-<number>` environment for each pull request that changes code
  or infrastructure, tested on every push and destroyed when it closes. The
  check is informational.

**Blocked:** CI can't yet assume Platform's deploy role. We've asked
Platform. Only PR 1 can go ahead without it.

## Decisions to agree

1. [The suite is a top-level `cloud-tests/` package.](#1-top-level-package)
2. [Tests find stacks by their CloudFormation tags.](#2-find-stacks-by-tag)
3. [Vitest for the API test, Playwright Test for the UI test.](#3-two-runners)
4. [Tests check the protocol and stored messages, not the answer.](#4-protocol-not-answer)
5. [The UI test signs in through the Hosted UI as a throwaway user.](#5-throwaway-user)
6. [Local runs test your existing stacks and never deploy.](#6-local-runs-dont-deploy)
7. [Every relevant pull request deploys its own environment.](#7-environment-per-pull-request)
8. [A new push cancels the pull request's run in progress.](#8-cancel-in-progress)
9. [Every closed pull request is cleaned up, whatever it changed.](#9-clean-up-on-close)
10. [CI uses OIDC with Platform's shared `GitHubDeploymentRole`.](#10-platforms-deploy-role)

## Plan

1. **Package and API test, run locally.** No dependencies.
2. **Deploy and destroy per pull request, without tests.** Needs the role.
3. **API test in CI.**
4. **UI test, locally and in CI.**

Each pull request tells us whether the next is worth doing.

## Detail

### 1. Top-level package

<details>
<summary>Why not <code>utilities/</code> or per service</summary>

It tests the whole system, not one service. `utilities/` is for dev
tooling, and per-service suites can't share one deploy and one run. AGENTS.md's
directory structure gains `cloud-tests/`.

```
cloud-tests/
  src/
    environment.ts               # find stack outputs by tag
    api/thread-journey.test.ts
    ui/homepage.test.ts
    ui/global-setup.ts           # wait for health, create test user
    ui/global-teardown.ts        # delete test user
  scripts/
    dev-checks.sh                # format, lint, type-check only
    test.sh, test-api.sh, test-ui.sh
    deploy.sh, destroy.sh        # all stacks for ENVIRONMENT
```

`dev-checks.sh` and `cloud-tests-ci.yaml` don't run the tests, because every
test here needs AWS.

</details>

### 2. Find stacks by tag

<details>
<summary>How, and why not <code>cdk ls</code></summary>

CDK tags every stack with `Environment` and `ServiceName`. `environment.ts`
finds the stacks with both and reads:

- `ChatApiStack`: `GatewayUrl`, `TokenEndpoint`, `UserPoolId`, `AppClientId`
- `DemoUiStack`: `EndpointUrl`, `SignInClientId`

If none match, it fails naming the environment.

`cdk ls` and `fetch-cdk-output.sh` synthesise the app, which is slow and
needs a GitHub token. Importing the CDK naming helpers crosses package
boundaries.

</details>

### 3. Two runners

<details>
<summary>Why not one</summary>

Vitest matches the rest of the repo, as UNS does for its API tests.
Playwright Test gives fixtures, retries and the trace viewer, which we'd
lose driving Playwright from Vitest. Their configs keep them to `src/api`
and `src/ui`.

</details>

### 4. Protocol, not answer

<details>
<summary>What the API test checks</summary>

It gets a client-credentials token, invokes a new thread with random ids and
a dummy prompt, and checks the stream has `RUN_STARTED`, a text message event
and `RUN_FINISHED`, in that order. It then checks the thread's messages
include a user and an assistant message. LLM answers vary, so asserting on
them would be flaky. The random `end-user-id` keeps it clear of other users'
rate limits.

</details>

### 5. Throwaway user

<details>
<summary>Set-up, teardown, and why not a session cookie</summary>

Global setup waits for `/api/health` to return 200, because ECS tasks can
still be starting after CloudFormation finishes. It then creates
`cloud-test-<random>` with a random password that's never printed. Teardown
deletes it, even if tests fail.

Forging a session cookie would be less brittle, but needs a test-only way
into the Demo UI.

</details>

### 6. Local runs don't deploy

<details>
<summary>Commands, and why not a separate environment</summary>

```sh
cloud-tests/scripts/test.sh                          # your $USER stacks
ENVIRONMENT=test-pr-123 cloud-tests/scripts/test.sh  # a PR's stacks
cloud-tests/scripts/test-ui.sh --headed              # args go to Playwright
```

Developers already deploy their branch to their own stacks. Deploying to a
separate environment by default would double every deploy, and the two
could drift. Anyone who wants one can set `ENVIRONMENT` and use `deploy.sh`
and `destroy.sh`.

The scripts check AWS credentials first, unless passed `--skip-credentials`,
which CI uses. `dev-prepare.zsh` checks Playwright's Chromium is installed.

</details>

### 7. Environment per pull request

<details>
<summary>Triggers, steps, and the alternatives</summary>

`cloud-tests-pr-environment.yaml` runs on changes to `services/`, `cdk/`,
`cloud-tests/`, `pnpm-lock.yaml`, `uv.lock`, `.nvmrc`, `.python-version`,
`tsconfig.json`, `.github/actions/setup-node-pnpm-env/*` or itself. It
assumes the role, logs in to public ECR (so base image pulls aren't rate
limited), deploys `test-pr-<number>`, runs `test.sh`, and uploads Playwright
traces on failure. Step timings in Actions give us deploy times.

Rejected:

- a shared environment after merging: pull requests wouldn't be tested first
- a fresh environment per run: every push pays for a full deploy and destroy
- deploying on a label: easy to forget
- one agent stack shared between pull requests: agent changes wouldn't be
  isolated. Revisit if it dominates deploy time.

</details>

### 8. Cancel in progress

<details>
<summary>Why that's safe</summary>

Runs share a concurrency group per pull request, as UNS does. Cancelling
stops `cdk`, but CloudFormation still completes or rolls back the stack it
was updating. Stacks not reached are deployed by the next run. We expect the
next `cdk deploy` to wait for a stack still updating; PR 2 checks.

</details>

### 9. Clean up on close

<details>
<summary>Why no path filter, and how it stays cheap</summary>

`cloud-tests-pr-environment-cleanup.yaml` runs on every closed pull request,
because one may have deployed in an earlier commit. It checks for
`test-pr-<number>` stacks with the AWS CLI first, so a pull request that
never deployed finishes without synthesising the app. It shares the
concurrency group, so closing cancels a deploy in progress before
destroying.

</details>

### 10. Platform's deploy role

<details>
<summary>Why this role, what's blocked, and the security trade-off</summary>

Using Platform's role means no IAM work, and it matches how other teams
deploy. No long-lived credentials are stored in GitHub. The role's trust
policy expects GitHub's immutable OIDC subject, so on 2026-11-02 we opted in
to it, rather than ask Platform to change a role their bootstrapping
manages.

It doesn't work yet. A test workflow on
[#438](https://github.com/govuk-once/govuk-chat-v2/pull/438) is denied
`sts:AssumeRoleWithWebIdentity`, though CloudTrail shows its token matches
the trust policy, and Platform's own repository assumes roles in the same
account. We think an organisation-level control denies us, and have asked
Platform. We've also asked whether they'd prefer a separate account, such as
`once-chat-ci`. Once unblocked, we add the role ARN as the
`AWS_DEV_DEPLOY_ROLE_ARN` secret.

The role has administrator access, so pull request code does too. That's
acceptable because only team members can push branches, and forks get no
OIDC token.

</details>

## Testing

<details>
<summary>Checks for each pull request</summary>

`environment.ts` and the health poll have no unit tests; every run
exercises them.

1. The API test passes against your own stacks, and the scripts stop without
   credentials.
2. On a test pull request: a first push deploys, a second updates in place,
   a push mid-deploy cancels cleanly, a docs-only change doesn't run, and
   closing (mid-deploy, or never deployed) leaves nothing in CloudFormation,
   Cognito, ECR, CloudWatch Logs or AgentCore. Record deploy, redeploy and
   destroy times.
3. The API test passes in CI. Record its time.
4. The UI test passes locally and in CI, and a failing run still deletes the
   user. Set **implemented**.

</details>

## Risks

<details>
<summary>Six risks, all mitigated or measured</summary>

- Another AWS customer holds the `test-pr-<number>-govuk-chat` Cognito
  domain → the first deploy shows it.
- Teardown leaves resources behind → PR 2 checks.
- Deploys are too slow for every push → measure first.
- Bedrock spend → short prompt, path filters.
- Cognito changes the Hosted UI → selectors use roles and labels.
- Public ECR login doesn't stop 429s → pull-through cache.

</details>

## Out of scope

More tests, required checks, `stag` or `prod`, asserting on answers, a
sweeper for leftover environments
([aws-stack-cleanup](https://github.com/govuk-once/aws-stack-cleanup) may
cover it), a separate CI account, and faster deploys.

---

## Notes for the spec skill

Result: the first screen is about 260 words. With every section open, the
spec is about 1,300 words, but nobody has to read it all.

- **The "Decisions to agree" list is the most useful thing so far.** It
  answers the reviewer's real question, "what am I signing off?", in ten
  lines, and every line links to its detail. It would work just as well
  without the collapsing.
- **Collapsed sections are a mixed blessing.**
  - They hide detail on the rendered page, but in the pull request diff
    everything shows, so reviewers commenting on the diff get no benefit.
  - `<details>` is raw HTML in markdown, and the `<summary>` text has to be
    written as well as the heading. That's an extra line per section for
    the skill to get right.
  - Collapsed content may be missed by find-in-page in some browsers. Worth
    checking before adopting.
  - Hiding risks and testing behind a toggle makes it easy to never open
    them. Those may be better left open and kept short.
- **Writing the summary of a decision as a statement forced clarity.** "Local
  runs test your existing stacks and never deploy" is the decision; the
  reason and alternatives are supporting detail. Several original
  paragraphs had no clear statement to extract.

For the skill:

- Add a **Decisions to agree** list near the top: one line per decision,
  each a statement, linked to its detail.
- Add a **Plan** near the top as one line per pull request, with detailed
  checks further down.
- Don't use `<details>` by default. Use the order of the file to do the same
  job: everything a reviewer needs in the first screen, then detail.
- Put the ticket in the header line rather than in a Problem section.
