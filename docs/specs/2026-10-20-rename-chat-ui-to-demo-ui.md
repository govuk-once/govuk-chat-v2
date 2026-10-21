# Rename chat-ui to demo-ui

**Date:** 2026-10-20

**Status:** accepted

## Problem

`services/chat-ui` is a Next.js web app for trying out the Chat API in a
browser. The name `chat-ui` suggests it is the user interface for GOV.UK Chat.
It is a demo, and the real user-facing interface is owned elsewhere (see the
out-of-scope list in AGENTS.md). Developers and coding agents can mistake it for
a production service.

There is also a precedent to avoid. "Chat" is the name of the underlying
product, so prefixing a service with it implies an association with the product
that may not hold. Left alone, `chat-` would become the default prefix for every
service in the repository.

[The previous rename](./2026-10-15-remove-unused-packages-and-rename-chat-api.md)
cleaned up the `-ts` suffix on the Chat API. This work does the same for the
UI, so its name says what it is for.

## Goals

- The package, its CI workflow, its CDK stack and its deployed AWS resources are
  named `demo-ui`, so the name matches the app's purpose.
- As with the Chat API rename, we prefer clean names over continuity. The
  project is still in development, so we accept a redeploy of the stack.

## Non-goals

- Changing what the app does, or its UI copy. The page title stays
  "GOV.UK Chat", and nothing in `src/` says "Chat UI".
- Changes to the Chat API, `agui-agent` or any other service.
- Tearing down deployed AWS resources. Developers clean up the stack this work
  leaves behind (see [Rollout](#rollout)).
- Rewriting accepted specs. They are a point-in-time record, so the previous
  spec keeps referring to `chat-ui`.

## Requirements

1. **R1:** `services/chat-ui` is renamed to `services/demo-ui`. Its package is
   `@govuk-chat-v2/demo-ui`, and its README title and prose say "Demo UI".
2. **R2:** The CI workflow is `demo-ui-ci.yaml`, and its name, path filters,
   script paths, Docker image tag and container name use `demo-ui`.
3. **R3:** The CDK stack class is `DemoUiStack` in
   `cdk/src/stacks/demo-ui-stack.ts`, and the CloudFormation stack is
   `${prefix}-DemoUiStack`.
4. **R4:** No stack ID, construct ID or AWS resource name contains `chat-ui` or
   `ChatUi`. That covers the VPC, log group, session secret, sign-in client,
   Express service and log stream prefix.
5. **R5:** The Dockerfile, `.dockerignore`, `scripts/cdk-deploy.sh` and the
   README commands all use the new paths and stack name.
6. **R6:** Apart from specs, no file in the repository refers to `chat-ui`,
   `ChatUi` or "Chat UI" as the name of this app.
7. **R7:** `pnpm-lock.yaml` is regenerated, every affected package's
   `scripts/dev-checks.sh` passes, and the CI workflow's path filters match the
   package's new location.

## Design

The rename is mechanical and covers the code and the deployed AWS names, as
the Chat API rename did.

- **Package (R1, R5).** Move the directory, change `name` in `package.json`,
  and update the paths in the Dockerfile (the `pnpm --filter`, the `COPY`
  lines, the standalone `server.js` location and `WORKDIR`) and in
  `.dockerignore`. The `scripts/` symlinks are relative and stay at the same
  depth, so they keep working. `pnpm-workspace.yaml` uses a `services/*` glob
  and needs no edit.
- **CI (R2).** Rename `.github/workflows/chat-ui-ci.yaml` and update its name,
  both sets of path filters, the script paths and the Docker image and container
  names.
- **CDK (R3, R4).** Rename the stack class, props interface and files, and the
  stack ID and `stackName` in `cdk/bin/app.ts`. The names derived from
  `getResourceNamePrefix()` change from `-chat-ui…` to `-demo-ui…`: the VPC,
  the `/ecs/express/` log group, the session secret, the sign-in client, the
  Express service and its image and role construct IDs. The bundled Dockerfile
  path becomes `services/demo-ui/Dockerfile`. The stack test is renamed and its
  `serviceName` updated.
- **Docs (R1, R5, R6).** Update the README title, prose and
  `fetch-cdk-output.sh` / `cdk destroy` commands, and the "Chat UI" wording in
  `scripts/create-dev-user.sh`.

Renaming the stack makes CloudFormation treat `DemoUiStack` as a new stack.
Unlike the Chat API, nothing imports `ChatUiStack`'s exports, and the new stack
has a different service name, so the two stacks could coexist. The old one still
has to be deleted by hand, because `cdk deploy` no longer manages it.

No architectural decision is involved, so no ADR is proposed.

## Alternatives considered

- **A code-only rename.** Keep the `ChatUiStack` stack ID and resource names, so
  a deploy updates the stack in place. Rejected because it leaves `chat-ui` in
  the deployed names, which is the confusion this work aims to remove. This
  matches the choice made for the Chat API rename.
- **Renaming only the directory and package.** Rejected for the same reason.
  The CDK stack and AWS names would still say `chat-ui`.

## Implementation plan

One commit, because a partial rename leaves the Dockerfile, CI and CDK pointing
at paths that don't exist.

1. **Rename `chat-ui` to `demo-ui`** (R1–R7). `git mv services/chat-ui
services/demo-ui`. Update `package.json`, the Dockerfile, `.dockerignore`,
   the README and the scripts as described in the Design, then run
   `pnpm install` to regenerate `pnpm-lock.yaml`. Rename the CI workflow to
   `demo-ui-ci.yaml`. Rename the CDK stack and test files and their contents,
   and the stack in `cdk/bin/app.ts`.

### Testing

- R1–R5, R7: `scripts/dev-checks.sh` passes for `demo-ui` and `cdk`, and
  `pnpm install --frozen-lockfile` succeeds. The Docker build in
  `demo-ui-ci.yaml` builds the image and the container responds on
  `/api/health`.
- R3, R4: `cdk synth` produces `DemoUiStack` and no `ChatUiStack`. The renamed
  stack test uses the new names.
- R6: a repository-wide search for `chat-ui`, `chat_ui`, `ChatUi` and `Chat UI`
  only matches specs.
- R3, R4: following the [Rollout](#rollout) steps in a dev environment deploys
  `DemoUiStack` and the app can hold a conversation through the Chat API.
- R7: the pull request triggers `demo-ui-ci.yaml`.

### Rollout

Each environment with a `ChatUiStack` replaces it with `DemoUiStack`:

1. Destroy `ChatUiStack`.
2. Outside ephemeral environments, delete what outlives the stack because of
   `RemovalPolicy.RETAIN`: the `/ecs/express/${prefix}-chat-ui` log group and
   the `${prefix}-chat-ui-session-secret` secret.
3. Deploy `DemoUiStack`.
4. Check that no AWS resource in the environment has `chat-ui` or `ChatUi` in
   its name.

The redeploy gives each environment a new app URL, sign-in client and session
secret, so anything holding the old URL needs updating and users are signed
out. Developers who use `scripts/create-dev-user.sh` are unaffected, as the
user pool belongs to the Chat API stack.

The implementation pull request should flag these steps to the team.

## Risks

- **Missing a `chat-ui` reference** breaks the Docker build or CI path filters.
  Mitigated by the Docker build in CI and the repository-wide search.
- **Missing a resource in the cleanup** leaves `chat-ui` names and their costs
  behind. Mitigated by the final rollout step.
- **Bookmarks and saved log queries** for the old URL and log group stop
  working. Nothing in the repository uses them.

## Open questions

None. The team confirmed that `demo-ui` is the final name, that a redeploy
is acceptable, and that the page title does not change.
