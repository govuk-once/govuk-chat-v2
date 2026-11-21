# Attempt 5: A briefing and a build sheet

Attempts 1 to 4 make the spec better. This one asks what a spec is for, and
starts again from that.

**Why specs feel like slop.** Every fact gets the same weight. A choice
that could sink the project, such as giving pull request code admin access
to AWS, gets one paragraph. Following precedent, such as using the existing
`setup-node-pnpm-env` action, also gets one paragraph. The reader has to do
the triage, and they can only do it by reading everything. Human writers
triage as they go, because writing is expensive. An agent doesn't need to,
so it writes everything at the same weight. The reader pays the cost.

**What a reviewer actually does.** They don't study the design. They want
to know three things:

1. What will be different?
2. What am I being asked to agree to that I might disagree with?
3. What could go wrong?

Everything else is for the person, or agent, who builds it.

**So this attempt splits the spec by reader** and makes the author do the
triage:

- **The briefing** is for humans, with a hard limit of a 3-minute read. It
  covers:
  - what's different before and after
  - a walkthrough of what you'll experience, in the second person
  - the decisions, sorted into three bins:
    - **Decide**: real trade-offs where a reviewer might choose differently.
      Each is a question with a recommendation.
    - **Know**: consequential but not contentious.
    - **Precedent**: listed in one line, so you can object without reading
      about it.
  - what we're waiting on, and the few risks that could bite
- **The build sheet** is for the implementer. It's terse reference material
  with no prose argument: file layout, outputs, triggers, edge cases and
  checks. Reviewers are told they don't need to read it. In practice it
  could be a separate file, or become the first commit's task list.

The briefing could also be the pull request description, so a reviewer
never has to open the file to review the approach.

---

# Run cloud tests against deployed environments

**Date:** 2026-10-29 · **Status:** accepted · **Ticket:** CHAT-1119

**3-minute read. You're asked to decide 3 things.** The
[build sheet](#build-sheet) is for whoever implements it; you don't need it
to review.

## In one sentence

We'll test real deployed environments, from your machine and on every pull
request, so that broken wiring, IAM or authentication is caught before
merge rather than found by hand.

## Before and after

| Today                                         | After                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| All tests mock AWS                            | Two tests also run against a real deployment                           |
| You check a deployed change by clicking round | `cloud-tests/scripts/test.sh` checks the API and sign-in for you       |
| Pull requests are only tested with mocks      | Each relevant pull request gets its own deployed, tested environment   |
| CI has no access to AWS                       | CI deploys to the dev account through OIDC, with no stored credentials |

## What you'll experience

**Locally.** You deploy your branch to your own stacks, as now. Then you
run `cloud-tests/scripts/test.sh`. It finds your stacks and sends a message
through the API. It checks the reply streams and both messages are stored.
It then signs in to the Demo UI as a throwaway user and checks the chat page
loads. It never deploys anything. Add `--headed` to `test-ui.sh` to watch
the browser.

**On a pull request.** If your change touches code, infrastructure or
dependencies, CI deploys a full copy of the system called
`test-pr-<number>` and runs the same tests against it. The result shows as
a check, but it won't block merging. Pushing again updates that environment
and cancels any run still going. Closing the pull request destroys the
environment.

## Decide

### 1. Should every relevant pull request deploy its own full environment?

**Recommended: yes**, on any push that changes code, infrastructure or
dependencies.

It tests each change in isolation before merge. The cost is a full deploy
of every stack per pull request, including the agent, and we don't yet know
how long that takes. PR 2 measures it before any tests depend on it.

- **Cheaper alternative:** one shared environment, tested after merging.
  But nothing is tested before merge.
- **Faster alternative:** share one agent stack between pull requests. But
  agent changes aren't tested in isolation. We'd revisit this if the agent
  stack dominates deploy time.

### 2. Is it acceptable for pull request code to run with admin access to the dev account?

**Recommended: yes.**

We'd use Platform's shared `GitHubDeploymentRole`. It has administrator
access, so the code in any pull request does too. Only team members can
push branches, and forks get no OIDC token. Using Platform's role means no
IAM work for us, and it's how other govuk-once teams deploy.

- **Alternative:** a role of our own, which we could scope ourselves. But
  we'd have to build and maintain the IAM, and we'd differ from other
  teams.

### 3. Should we add Playwright?

**Recommended: yes, for the UI test only.**

It's a new dependency and a new test runner for this repo. It gives us
fixtures, retries and a trace viewer for debugging a failed sign-in in CI.
The API test stays on Vitest, like the rest of the repo.

- **Alternative:** skip the browser by forging a session cookie. Less
  brittle, but it needs a test-only way into the Demo UI's session code.

## Know

- **It's a new top-level directory, `cloud-tests/`,** because it tests the
  whole system. Its `dev-checks.sh` doesn't run its own tests, unlike every
  other package, because they all need AWS.
- **Local runs test whatever is in your stacks.** To test elsewhere, set
  `ENVIRONMENT` and use the package's `deploy.sh` and `destroy.sh`.
- **The tests never check what the LLM says,** only that it streamed and
  stored. Answers vary between runs.
- **Every closed pull request runs clean-up,** even one that never
  deployed. A cheap check finds nothing and stops.

## Following precedent

Vitest for API tests. OIDC, concurrency groups and per-PR environments as
UNS does. Credential checks as `fetch-cdk-output.sh` does. Test users as
`create-dev-user.sh` creates them. Stacks found by the tags CDK already
applies.

## Waiting on

**Platform.** CI is denied when it tries to assume their role, though the
trust policy matches. We've asked them why, and whether they'd prefer a
separate CI account. Only the first pull request can go ahead until then.

## What could bite us

- **Deploys may be too slow for every push.** We'll measure in PR 2 before
  adding tests.
- **Teardown may leave resources behind,** such as log groups or images.
  PR 2 checks for leftovers.
- **Another AWS customer may hold our Cognito domain name.** Domain
  prefixes are unique per region. The first deploy will tell us.

## Delivery

1. Package and API test, run locally.
2. Deploy and destroy per pull request, without tests. Waits on Platform.
3. API test in CI.
4. UI test, locally and in CI.

Each pull request tells us whether the next is worth doing.

---

## Build sheet

Reference for the implementer. Terse by design: it records agreed facts,
not arguments.

### Layout

```
cloud-tests/                     # @govuk-chat-v2/cloud-tests, in pnpm-workspace.yaml
  vitest.config.ts               # src/api only
  playwright.config.ts           # src/ui only
  src/
    environment.ts               # stacks tagged Environment=<env>, ServiceName=govuk-chat
    api/thread-journey.test.ts
    ui/global-setup.ts           # poll /api/health; AdminCreateUser + AdminSetUserPassword
    ui/global-teardown.ts        # AdminDeleteUser
    ui/homepage.test.ts
  scripts/
    dev-checks.sh                # format, lint, type-check; not test.sh
    format.sh, lint.sh, type-check.sh   # symlinks to scripts/shared
    test.sh                      # test-api.sh then test-ui.sh
    test-api.sh, test-ui.sh      # extra args passed to the runner
    deploy.sh                    # cdk deploy --all --require-approval never
    destroy.sh                   # cdk destroy --all --force; exits 0 if no tagged stacks
```

All scripts run `check-dev-aws-credentials.sh` unless passed
`--skip-credentials`. No outputs file is written.

### Inputs

- `ENVIRONMENT`, default `$USER`
- `ChatApiStack` outputs: `GatewayUrl`, `TokenEndpoint`, `UserPoolId`,
  `AppClientId`
- `DemoUiStack` outputs: `EndpointUrl`, `SignInClientId`

### API test

1. `DescribeUserPoolClient` for the secret, then a client-credentials token
   from `TokenEndpoint`.
2. `POST /v1/threads/invoke` with random `threadId`, `runId`, message id and
   `end-user-id`, and a short dummy prompt.
3. Assert `RUN_STARTED`, then at least one text message event, then
   `RUN_FINISHED`.
4. `GET /v1/threads/{threadId}/messages` with the same `end-user-id`. Assert
   one user and one assistant message.

### UI test

Username `cloud-test-<random>`, random password, welcome message
suppressed. Credentials are passed to tests through in-process environment
variables. Selectors use roles and labels.

### Workflows

- `cloud-tests-ci.yaml`: format, lint and type-check on `cloud-tests/`
  changes.
- `cloud-tests-pr-environment.yaml`, on `pull_request`:
  - Paths: `services/`, `cdk/`, `cloud-tests/`, `pnpm-lock.yaml`,
    `uv.lock`, `.nvmrc`, `.python-version`, `tsconfig.json`,
    `.github/actions/setup-node-pnpm-env/*`, the workflow itself.
  - Concurrency: one group per pull request, `cancel-in-progress: true`.
  - Steps:
    1. `setup-node-pnpm-env`
    2. GitHub App token, as `cdk-ci.yaml` does
    3. `configure-aws-credentials` with `AWS_DEV_DEPLOY_ROLE_ARN`
    4. `aws ecr-public get-login-password --region us-east-1`
    5. `deploy.sh --skip-credentials`
    6. install Chromium
    7. `test.sh --skip-credentials`
    8. upload the Playwright report and traces on failure
- `cloud-tests-pr-environment-cleanup.yaml`, on `pull_request` `closed`:
  - No path filter, and the same concurrency group.
  - Assumes the role and lists stacks tagged `Environment=test-pr-<number>`.
  - If there are none, it stops.
  - Otherwise it gets the GitHub App token and runs
    `destroy.sh --skip-credentials`.

### Edge cases

- If no stacks match `ENVIRONMENT`, fail with a message naming it.
- If `/api/health` doesn't return 200 before the timeout, fail the UI suite.
- If a UI test fails, teardown still deletes the user.
- If a run is cancelled mid-deploy, CloudFormation finishes or rolls back
  the stack it was on. We expect the next `cdk deploy` to wait for it.
- If a pull request closes mid-deploy, clean-up cancels the deploy, then
  destroys the environment.

### Also changes

- AGENTS.md:
  - add `cloud-tests/` to the directory structure
  - point the note on cloud tests at it
  - note that its `dev-checks.sh` doesn't run its tests
- `dev-prepare.zsh`: check for Playwright's Chromium and print the install
  command if it's missing.

### Checks

- `environment.ts` and the health poll have no unit tests; every run
  exercises them.
- **PR 1:**
  - the API test passes against your own stacks
  - the scripts stop without credentials
- **PR 2:** on a test pull request, check that:
  - the first push deploys
  - the second push updates in place
  - a push mid-deploy cancels cleanly
  - a docs-only change doesn't run
  - closing mid-deploy, or without ever deploying, leaves nothing in
    CloudFormation, Cognito, ECR, CloudWatch Logs or AgentCore

  Record the deploy, redeploy and destroy times.

- **PR 3:** the API test passes in CI. Record how long it takes.
- **PR 4:**
  - the UI test passes locally and in CI
  - a failing run still deletes the user
  - set **implemented**

### Open with Platform

- What denies `sts:AssumeRoleWithWebIdentity`?
  - The test workflow on
    [#438](https://github.com/govuk-once/govuk-chat-v2/pull/438) is denied
    in both eu-west-1 and eu-west-2.
  - CloudTrail shows the subject
    `repo:govuk-once@241280733/govuk-chat-v2@1125418398:pull_request` and
    the audience match the trust policy.
  - Platform's own repository assumes roles in the same account.
  - The repository opted in to immutable subject claims on 2026-11-02.
- Do Platform want teams to use `GitHubDeploymentRole`, or a separate
  account such as `once-chat-ci`?

### Lower risks

- Bedrock spend per run: a short prompt, and only pull requests that match
  the paths run.
- Cognito changes the Hosted UI: selectors use roles and labels.
- Public ECR login doesn't stop 429s: fall back to a pull-through cache.

### Later

- A sweeper for leftover environments (Platform's
  [aws-stack-cleanup](https://github.com/govuk-once/aws-stack-cleanup)
  may do it).
- A separate CI account.
- A required check.
- Faster deploys.
- More tests, chosen from bugs that unit tests missed.

---

## Notes for the spec skill

Result: the briefing is about 850 words, about a 3-minute read, and it
holds every judgement a reviewer is asked to make. The build sheet is
another 700 words that no reviewer has to read. Unlike attempts 1 to 4, the
length isn't evenly spread: the three decisions that matter get the most
words, and the 14 that don't get a line each, or less.

What changes in the skill:

- **Write two things, for two readers.** A briefing for humans and a build
  sheet for the implementer. The briefing has a hard limit, a 3-minute read
  (about 600–900 words), and the skill states the reading time and the
  number of decisions at the top.
- **The author does the triage, not the reader.** Sort every decision into
  **Decide**, **Know** or **Precedent**:
  - **Decide** is for a real trade-off a reviewer might choose differently.
    At most three, each a question with a recommendation and its main
    alternative.
  - **Know** gets a line each.
  - **Precedent** is one sentence for all of them.
- **Ask the human to do the sorting.** In the interview, the skill lists
  the decisions it found and asks which ones colleagues will argue about.
  It mustn't guess, because whether something is contentious is a
  judgement about the team.
- **Concrete before abstract.** "Before and after" and a second-person
  walkthrough ("you run…, it checks…") come before any design. People
  absorb what they'd experience faster than a description of the
  mechanism.
- **The build sheet is reference, not argument.** It uses lists, trees and
  "If… then…" lines, with no justification, because the briefing already
  made the case. Anything with a "because" belongs in the briefing or
  nowhere.
- **The briefing becomes the pull request description.** Reviewers comment
  on decisions in the conversation, and on build-sheet details inline in
  the diff.
- **Keep the rules that still apply:** don't invent content, and no
  production prompts.

Open questions about this approach:

- Does the team trust the author's sort? A wrongly binned decision hides in
  "Know". Asking the human to confirm the sort is the safeguard. Reviewers
  can also scan the precedent line in seconds.
- Should the build sheet be in the spec at all? Much of it, such as output
  names and workflow steps, is rediscovered while building. A lighter
  option keeps only the edge cases and checks, and leaves the rest to the
  implementation pull request.
