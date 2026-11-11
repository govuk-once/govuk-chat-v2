# Attempt 4: Recommended format

This combines what worked in attempts 1 to 3 into one format I'd propose
for the template. It's ordered by what a reader needs first:

1. **Summary**: why in a sentence or two, what changes as bullets, and
   what it depends on (attempt 2's proposal).
2. **Decisions to agree**: one line each, linked to its detail (attempt 3).
   Each is marked if it's **new to this repo**, because AGENTS.md asks
   reviewers to discuss new patterns, and the rest follow precedent and need
   less attention.
3. **Plan**: one line per pull request (attempt 3).
4. **How it works**: the happy path, briefly, like the "guide-level
   explanation" in Rust RFCs.
5. **Decisions**: a heading stating each choice, its reason, "Not X:"
   rejections and "If… then…" edge cases, left open rather than collapsed
   (attempts 2 and 3).
6. **Risks** as "risk → mitigation" one-liners, **open questions**, and
   **out of scope** (attempt 2).

It applies writing rules throughout:

- say each fact once
- sentences under 25 words, as GOV.UK style asks
- "must", not "shall"
- precedent cited only when it's the reason for a choice
- no inline requirement tags
- status and blockers in open questions, not the design

---

# Run cloud tests against deployed environments

**Date:** 2026-10-29 · **Status:** accepted · **Ticket:** CHAT-1119

## Summary

Our tests mock AWS, so nothing checks that a deployed system works as a
whole. This adds tests that run against real deployed environments, locally
and on every relevant pull request.

- **New `cloud-tests` package** with two tests: an API round trip through a
  thread, and signing in to the Demo UI.
- **Run locally** with `cloud-tests/scripts/test.sh`, against your own
  stacks. It doesn't deploy.
- **Each pull request gets its own environment.** Pushes that change code or
  infrastructure deploy `test-pr-<number>` and run the tests. Closing the
  pull request destroys it. The check doesn't block merging.

**Depends on:** Platform letting this repository assume their deploy role
from CI. It's currently denied ([open question](#open-questions)). Only PR 1
can go ahead without it.

## Decisions to agree

1. [The suite is a top-level `cloud-tests/` package.](#d1-the-suite-is-a-top-level-cloud-tests-package)
   **New to this repo.**
2. [Tests find stacks by their CloudFormation tags.](#d2-tests-find-stacks-by-their-cloudformation-tags)
3. [Playwright Test runs the UI test; Vitest runs the API test.](#d3-playwright-test-runs-the-ui-test-vitest-runs-the-api-test)
   **New to this repo.**
4. [Tests check the protocol and storage, never the answer.](#d4-tests-check-the-protocol-and-storage-never-the-answer)
5. [The UI test signs in through the Hosted UI as a throwaway user.](#d5-the-ui-test-signs-in-through-the-hosted-ui-as-a-throwaway-user)
6. [Local runs test your existing stacks and never deploy.](#d6-local-runs-test-your-existing-stacks-and-never-deploy)
7. [Every relevant pull request deploys its own environment.](#d7-every-relevant-pull-request-deploys-its-own-environment)
   **New to this repo.**
8. [Closing any pull request destroys its environment.](#d8-closing-any-pull-request-destroys-its-environment)
9. [CI uses OIDC with Platform's shared `GitHubDeploymentRole`.](#d9-ci-uses-oidc-with-platforms-shared-githubdeploymentrole)
   **New to this repo.**

## Plan

Four pull requests, each small enough to tell us whether the next is worth
doing:

1. **Package and API test, run locally** (D1–D4, D6)
2. **Deploy and destroy an environment per pull request, without tests**
   (D7–D9): waits on Platform
3. **Run the API test in CI**
4. **Add the UI test, locally and in CI** (D5): set **implemented**

[Checks for each pull request](#checks) are below.

## How it works

```
cloud-tests/
  src/
    environment.ts               # find stack outputs by tag
    api/thread-journey.test.ts   # Vitest
    ui/homepage.test.ts          # Playwright
    ui/global-setup.ts           # wait for health, create test user
    ui/global-teardown.ts        # delete test user
  scripts/
    dev-checks.sh                # format, lint, type-check only
    test.sh                      # both suites; test-api.sh, test-ui.sh for one
    deploy.sh, destroy.sh        # all stacks for ENVIRONMENT
```

1. The suite finds the environment named by `ENVIRONMENT` (default `$USER`)
   and reads its stack outputs.
2. The API test sends a message to a new thread, checks the stream and
   checks both messages were stored.
3. The UI test creates a Cognito user, signs in, checks the chat page and
   deletes the user.
4. In CI, each push to a pull request deploys `test-pr-<number>` and runs
   `test.sh`. Closing the pull request destroys it.

## Decisions

### D1. The suite is a top-level `cloud-tests/` package

It tests the system as a whole, so it doesn't belong to one service.
AGENTS.md's directory structure gains `cloud-tests/`.

- **Not `utilities/`:** that's for dev tooling.
- **Not alongside each service:** per-service suites can't share one deploy
  and one run.
- **`dev-checks.sh` and `cloud-tests-ci.yaml` don't run the tests,** unlike
  other packages, because every test here needs AWS. They run format, lint
  and type checks.

### D2. Tests find stacks by their CloudFormation tags

CDK already tags every stack with `Environment` and `ServiceName`. The suite
reads `GatewayUrl`, `TokenEndpoint`, `UserPoolId` and `AppClientId` from
`ChatApiStack`, and `EndpointUrl` and `SignInClientId` from `DemoUiStack`.

- **Not `cdk ls` or `fetch-cdk-output.sh`:** they synthesise the app, which
  is slow and needs a GitHub token.
- **Not the CDK naming helpers:** importing them crosses package
  boundaries.
- **If no stacks match,** the suite fails with a message naming the
  environment.

### D3. Playwright Test runs the UI test; Vitest runs the API test

Vitest is the repo's test runner, and UNS uses it for API tests too.
Playwright Test gives us fixtures, retries and the trace viewer.

- **Not Playwright for both:** it would diverge from the rest of the repo.
- **Not Playwright driven from Vitest:** we'd lose fixtures, retries and
  traces.

### D4. Tests check the protocol and storage, never the answer

The API test sends a dummy prompt to `POST /v1/threads/invoke`. It checks
the stream has `RUN_STARTED`, a text message event and `RUN_FINISHED`, in
that order. Then it checks `GET /v1/threads/{threadId}/messages` returns a
user and an assistant message. LLM answers vary, so checking them would be
flaky.

- **It uses a random `end-user-id`,** so it never shares a rate limit with
  anyone else.

### D5. The UI test signs in through the Hosted UI as a throwaway user

Global setup creates `cloud-test-<random>` with a random password, as
`create-dev-user.sh` does. The test signs in and checks it lands on the chat
page. Teardown deletes the user.

- **Not a forged session cookie:** less brittle, but it needs a test-only way
  into the Demo UI.
- **Setup first waits for `/api/health` to return 200,** because ECS tasks
  can still be starting when CloudFormation finishes. The API test doesn't
  wait: Lambdas and AgentCore are ready by then.
- **If a test fails,** teardown still deletes the user.
- **The password is never printed.**

### D6. Local runs test your existing stacks and never deploy

Developers already deploy their branch to their own stacks to try changes.

```sh
cloud-tests/scripts/test.sh                          # your $USER stacks
ENVIRONMENT=test-pr-123 cloud-tests/scripts/test.sh  # a PR's stacks
cloud-tests/scripts/test-ui.sh --headed              # args go to Playwright
```

- **Not a separate environment by default:** every change would be deployed
  twice, and the two could drift. `deploy.sh` and `destroy.sh` are there for
  anyone who wants one.
- **If AWS credentials are missing,** the scripts stop with the refresh
  suggestion. CI skips the check with `--skip-credentials`.
- `dev-prepare.zsh` checks Playwright's Chromium is installed.

### D7. Every relevant pull request deploys its own environment

`cloud-tests-pr-environment.yaml` deploys `test-pr-<number>` and runs
`test.sh`. It runs when a pull request changes `services/`, `cdk/`,
`cloud-tests/`, `pnpm-lock.yaml`, `uv.lock`, `.nvmrc`, `.python-version`,
`tsconfig.json`, `.github/actions/setup-node-pnpm-env/*` or the workflow.
Its step timings give us deploy times.

- **Not a shared environment after merging:** pull requests wouldn't be
  tested before merging.
- **Not a fresh environment per run:** every push would pay for a full
  deploy and destroy.
- **Not on a label:** easy to forget.
- **Not one agent stack shared between pull requests:** agent changes
  wouldn't be tested in isolation. Revisit if it dominates deploy time.
- **If a newer push arrives,** it cancels the run in progress, as UNS does.
  CloudFormation still completes or rolls back the stack it was updating, so
  nothing is left half-applied. We expect the next `cdk deploy` to wait for
  it.
- **If the tests fail,** the Playwright report and traces are uploaded.
- **CI logs in to public ECR first,** so base image pulls aren't rate
  limited.

### D8. Closing any pull request destroys its environment

`cloud-tests-pr-environment-cleanup.yaml` runs on every closed pull request,
with no path filter, because a pull request may have deployed in an earlier
commit.

- **If it never deployed,** an AWS CLI check finds no stacks and the job
  succeeds without synthesising the app.
- **If a deploy is still running,** it's cancelled first, because both
  workflows share the pull request's concurrency group.

### D9. CI uses OIDC with Platform's shared `GitHubDeploymentRole`

It needs no IAM work from us, and it's how other govuk-once teams deploy.
No long-lived AWS credentials are stored in GitHub. The role expects
GitHub's immutable OIDC subject, so we opted this repository in on
2026-11-02.

- **Not asking Platform to trust our legacy subject:** their bootstrapping
  manages the role, and other repositories use the immutable form.
- **Pull request code gets administrator access to the dev account.** That's
  acceptable because only team members can push branches, and forks get no
  OIDC token.

## Checks

`environment.ts` and the health poll have no unit tests, because every run
exercises them.

1. The API test passes against your own stacks. The scripts stop without
   credentials.
2. On a test pull request:
   - a first push deploys and a second updates in place
   - a push mid-deploy cancels cleanly
   - a docs-only change doesn't run
   - closing mid-deploy, or without ever deploying, leaves nothing in
     CloudFormation, Cognito, ECR, CloudWatch Logs or AgentCore

   Record deploy, redeploy and destroy times.

3. The API test passes in CI. Record how long it takes.
4. The UI test passes locally and in CI, and a failing run still deletes
   the user.

## Risks

- Another AWS customer holds the `test-pr-<number>-govuk-chat` Cognito
  domain → the first deploy shows it; change the prefix.
- Teardown leaves log groups or images behind → PR 2's checks find them.
- Deploys are too slow for every push → measure before optimising.
- Each run spends Bedrock tokens → short prompt, path filters.
- Cognito changes the Hosted UI → selectors use roles and labels.
- Public ECR login doesn't stop 429s → a pull-through cache.

## Open questions

- **What stops this repository assuming `GitHubDeploymentRole`?** A test
  workflow on [#438](https://github.com/govuk-once/govuk-chat-v2/pull/438)
  is denied, though CloudTrail shows its token matches the trust policy, and
  Platform's own repository assumes roles in the same account. Probably an
  organisation-level control. Asked Platform. Once fixed, we add the role
  ARN as `AWS_DEV_DEPLOY_ROLE_ARN`.
- **Should teams deploy from CI with this role,** or from a separate account
  such as `once-chat-ci`? Asked Platform.

## Out of scope

More tests, required checks, `stag` and `prod`, asserting on answers, faster
deploys, and a sweeper for leftover environments. Platform's
[aws-stack-cleanup](https://github.com/govuk-once/aws-stack-cleanup) may
cover the sweeper.

---

## Notes for the spec skill

Result: about 1,550 words, under half the original. A reviewer reads the
first screen (about 310 words) to know what changes, what they're agreeing to and
how it lands. They can jump to any decision they question. The detail no
longer repeats the top, because the top is one-line statements and the
detail is reasons, rejections and edge cases.

### Template

Replace the template in `docs/specs/README.md` with:

```markdown
# Title

**Date:** YYYY-MM-DD · **Status:** accepted · **Ticket:** ABC-123

## Summary

One or two sentences on why. Assume the reader has seen the ticket.

- **What changes,** as 3–6 bullets a non-specialist would follow. Mark
  anything that breaks a contract with **Breaking**.

**Depends on:** other teams, blockers. Omit if none.

## Decisions to agree

1. [A statement of the decision.](#d1-...) **New to this repo**, if it is.

## Plan

1. **What PR 1 delivers** (D1, D2)

## How it works

The happy path in a few steps, plus a file tree if useful. No reasons.

## Requirements

Only for behaviour others depend on: APIs, data, UI. "Must" statements.
Omit for internal tooling, where the decisions are the behaviour.

## Decisions

### D1. A statement of the decision

The reason, in a sentence or two.

- **Not X:** why not.
- **If something happens,** what does.

## Checks

How each pull request will be verified.

## Risks

- Risk → mitigation.

## Open questions

At most three, each saying who's answering. Remove when there are none.

## Out of scope

One line, or a short list.
```

### Skill changes

- **Draft order:** decisions first, then how it works, then the plan.
  Write the summary and the decisions list **last**, from the finished
  detail, so they summarise rather than introduce.
- **Say each fact once.** If a fact belongs in two sections, put it in one
  and link from the other.
- **Only record a real decision:** one with an alternative a reviewer might
  prefer. Following precedent isn't a decision.
- **Flag new patterns** in the decisions list, as AGENTS.md's code review
  guidance asks reviewers to discuss them.
- **Keep status out of the design.** Blockers, experiments and who's been
  asked go in open questions.
- **Writing rules:**
  - sentences under 25 words, paragraphs under 5 sentences
  - "must" for requirements
  - no inline requirement tags in prose
  - cite precedent only when it's the reason for a choice
- **Before handing over, re-read for slop:**
  - restating another section
  - justifying the obvious
  - edge cases the design doesn't handle
  - hedges and "it's worth noting"
- **Keep the existing rules** on not inventing content and on prompts.

### Still to try

- Applying the format to a spec with a public contract, such as the
  pagination spec, to test the optional requirements section.
- Asking a reviewer who hasn't read the original to time themselves on the
  first screen and say what they'd agree or object to.
