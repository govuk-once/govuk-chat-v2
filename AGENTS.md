# AGENTS.md

Guidance for AI coding agents (and their human colleagues) on how to work with
this repository.

## What this repo contains

### The product

Read the [README.md](./README.md) for an overview of the product's purpose.

### The codebase

A monorepo for the GOV.UK Chat V2 orchestrator: the core services that run it
(the orchestrator agents, the API, the management interface) plus the tooling to
develop and evaluate them.

Out of scope — don't add these here:

- the supporting services of GOV.UK Chat V2 (owned by their respective teams)
- tools shared across teams (MCP servers, agents)

All code must be production quality: readable, maintainable, secure, and
covered by automated tests.

### Directory structure

- `services/` — production service components, one per sub-directory
- `utilities/` — standalone dev tooling that isn't part of production, one per
  sub-directory
- `libs/` — shared libraries, split by language (e.g. `libs/python`)
- `cdk/` — AWS CDK infrastructure as code
- `scripts/` — repo-wide helper scripts; `scripts/shared` holds scripts meant to
  be symlinked into individual packages

## Conventions

### Organisational

This product is built by the Government Digital Service (GDS), part of the UK
government. Follow the [GDS Way](https://gds-way.digital.cabinet-office.gov.uk/).
Where this document is more specific than the GDS Way, this document takes
precedence.

We code in the open — everything here will become public. Only commit what is
safe to share publicly; **never commit secrets** (e.g. API keys). Treat LLM
prompts as sensitive, as they can advance jailbreaks: **don't write or commit
production prompts** — only dummy prompts that don't represent the production
system.

Prefer consistency with the existing codebase over individual preference. Before
any routine development decision, check the codebase for precedent and follow
it. If you think the precedent is a poor choice, flag it to a human rather than
silently diverging.

We work in GDS App & AI, which favours AWS serverless. When proposing technology
to solve a problem, choose idiomatic AWS serverless offerings.

### Project wide

#### Development

The app depends on AWS managed services, so it only runs accurately on AWS.
Prefer development tooling that runs against real AWS over cloud emulators.

Local machines must be able to run the standard CI tasks (automated testing,
linting, static analysis) simply and easily. Any test that needs cloud
infrastructure must be tagged separately from the other tests for that package.

`source scripts/dev-prepare.zsh` sets a developer up with the dependencies and
credentials to run any of this project's scripts. Keep it up to date when you
add new dependencies.

When writing development shell scripts:

- Target MacOS by default. Cater for Linux only where it's succinct; never worry
  about Windows.
- Prefer bash (`#!/usr/bin/env bash`); ZSH is acceptable for complex tasks, as
  most developers use it.
- Authenticate to AWS via the GDS CLI to assume a role, then use the regular
  `aws` CLI. **Don't authenticate any other way.**
- Guard scripts that require AWS auth with
  `scripts/check-dev-aws-credentials.sh`.
- **Never write AWS credentials to `.env` files**; use env vars, set via
  `source scripts/refresh-dev-aws-credentials.zsh`.

#### Packages

Code in `services/`, `utilities/` and `libs/` is organised into packages, which
stay consistent across the project:

- each has a README.md describing its purpose and how to develop with it
- each has a `scripts/` directory exposing common dev/CI tasks (formatting,
  linting, testing) the same way regardless of the package's language
  - prefer reusable scripts symlinked from `scripts/shared` over writing new
    ones. The exception is `dev-checks.sh`: it composes a package's own checks
    and is expected to vary per package (e.g. cdk adds a synth step), so each
    package keeps its own copy.
  - follow existing naming conventions
- avoid project-specific dotfiles; use global ones, and only add a local one
  where a global one causes a conflict
- each one should have a GitHub action named after the tool with a ci suffix, for
  example a `chat-api` file should have a `chat-api-ci.yaml` GitHub
  action workflow

After changing code in a package, run its `scripts/dev-checks.sh` (format, lint,
type-check, test) before committing — this is what CI runs per package.

#### Formatting

Code should be readable and consistent, so that code review doesn't get spent on
preferences:

- use formatters (e.g. prettier / ruff) to apply industry conventions; don't
  tweak their config for individual taste
- for rules not covered by a formatter, follow existing precedent in the
  codebase, then fall back to the most common industry convention
- where no rule enforces line length, aim for 80-character columns while still
  readable; only exceed 120 where wrapping would hinder readability

To keep diffs free of editor-dependent noise: end every text file with a
newline, and don't leave trailing whitespace (except where a syntax like
markdown makes it meaningful).

#### Testing

We unit test so we can be confident our logic still behaves as intended —
most valuably when something underneath us changes, such as a dependency
upgrade. That confidence depends on the suite staying readable, so we aim
for tests that are necessary and sufficient to test our logic paths.

- Cover the logic paths through the unit — branches, boundaries, error
  handling. Don't assert incidental detail: exact wording, field-by-field
  shapes, values with no branch behind them. Tests aren't here to catch typos.
- Only test edge cases the code actually handles. If there's no code for a
  case, there's nothing to test — write the code first or leave it. The
  exception is a regression test: if a bug reached us once, a test pinning that
  scenario earns its place. Say so in the test name or the commit.
- Stay inside the unit under test. Don't re-test collaborators, libraries or
  framework behaviour through it.
- Keep existing tests in scope — when behaviour changes, update or delete
  the tests that covered it rather than leaving them in place and adding
  more alongside.
- Follow existing test patterns; ask before introducing a new framework,
  harness or fixture style.
- LLMs tend to over-generate tests - really think about whether new tests or
  assertions meet the guidelines here.

#### Documentation

Documentation is valuable but it easily goes stale, so we keep it lean and put
the effort where it stays accurate. In order of what we rely on most:

- Git history is our primary documentation. Each commit should record the _why_
  of that change — the reasoning, trade-offs and context that the diff alone
  can't convey. Write commit messages accordingly and keep changes focused so
  the history stays readable.
- Architectural decisions are documented at the point in time they are made,
  as ADRs in [docs/adr](docs/adr). When you make a similarly significant
  decision, add one — see [docs/adr/README.md](docs/adr/README.md) for the
  format, naming and when a decision warrants an ADR at all. Don't restate that
  guidance here; it lives in one place so it can't drift.

  Three things an agent writing an ADR tends to get wrong:

  - **Don't invent content.** An ADR records what a human decided, including
    the reasoning they actually gave. If the rationale is thin, leave it thin
    and ask — don't pad it with plausible-sounding justification.
  - **Don't edit accepted ADRs to reflect new thinking.** Supersede them with a
    new one. The value of the record is that it preserves what we believed at
    the time, mistakes included.
  - **Ask before writing one.** Whether a decision is significant enough to
    warrant an ADR is a judgement for the team, not a side effect of a task.

- Guides for developers (getting started, how things work) live in the relevant
  README.md files. Keep these succinct — the more detail a guide carries the
  faster it drifts out of date, so cover what a developer needs to orient
  themselves and no more. If a README grows bloated, move longer or more
  specific documentation into a package `docs/` directory.

For code itself, prefer making it self-documenting over describing it:

- Prefer self-documenting code over comments. Clear names and structure don't go
  out of date the way comments do. Use a comment only where code is genuinely
  cryptic, or to explain an unobvious decision that the code can't express on
  its own.
- Prefer restrictive type signatures over documentation. A precise type tells a
  developer (and their IDE) how to use a function far more reliably than prose
  describing parameters. Reach for tighter typing before reaching for docs.
- Docstrings and similar IDE hints are fine, but keep them low maintenance. They
  should give useful hints on usage without becoming something that has to be
  kept in sync with the code as it changes.

### Technology specific

#### TypeScript

- Single Node version, managed by `nvm`. One version covers the whole project,
  pinned in the root `.nvmrc` — change it there, don't add per-package versions.
- `pnpm` for dependency management, in workspace mode. There is a single
  `pnpm-lock.yaml` for the whole project — **don't add per-package lockfiles**. A
  new package must be registered in `pnpm-workspace.yaml`.
- No build step. We run TypeScript directly and use `tsc` only for type checking
  (`--noEmit`) — **don't introduce a compile/bundle step or emit JavaScript**.
- `src/` layout. Package code lives in a `src/` directory.
- Tests sit next to the code they cover, using a `.test.ts` extension (e.g.
  `thing.ts` and `thing.test.ts`), and run with `vitest`.
- `prettier` formats, `eslint` lints — see the [Formatting](#formatting)
  guidance; don't hand-format or disable rules for taste.
- Share code via `libs/typescript`. When TypeScript needs to be reused across
  packages, put it in a module under `libs/typescript` rather than reaching
  across package boundaries.
- Don't duplicate script commands in `package.json`. Where a `package.json`
  script runs the same task as a file in the package's `scripts/` directory,
  reference the script file rather than repeating the command inline.

#### Python

- Python 3.13+. Modern syntax and standard-library features are available; use
  them. A single version covers the whole project, pinned in the root
  `.python-version` — change it there, don't add per-package versions.
- `src/` layout. Package code lives in a `src/` directory, with the
  `pyproject.toml` configured (`setuptools` build backend,
  `[tool.setuptools.packages.find]`) so that layout resolves.
- Unit tests go in a `tests/` directory, run with `pytest`.
- `uv` for dependency management, in workspace mode. There is a single `uv.lock`
  for the whole project — **don't add per-package lockfiles**. A new package must
  be registered in `[tool.uv.workspace].members` in the root `pyproject.toml`.
- `pyright` for type checking, `ruff` for formatting and linting — see the
  [Formatting](#formatting) guidance. Both run on default config; don't add
  per-package tool overrides.
- We use `prettier` for non-Python file formatting in Python services.
- All Python code should be typed. Write proper type hints and prefer
  restrictive signatures (see [Documentation](#documentation)).
- Share code via `libs/python`. When Python needs to be reused across packages,
  put it in a module under `libs/python` rather than reaching across package
  boundaries.
- When writing pytest tests make sure the unit under test is identifiable, we
  follow the convention that tests functions are prefixed with
  `def test_<function_name>_<behaviour_tested>`. If that is too verbose for a
  function we group them under a class of `Test<FunctionName>`.

#### CDK

CDK is TypeScript, so the [TypeScript](#typescript) conventions apply. In
addition:

- Stacks live in `cdk/src/stacks/` and are instantiated in `cdk/bin/app.ts`. Shared
  helpers and constants (naming, environment detection, metadata) live in
  `cdk/src/constants/` — reuse them rather than reinventing. Other shared helper
  files should have appropriate directories in `cdk/src`.
- Namespace every named resource. We share a single dev AWS account, so
  unprefixed resource names cause one developer's deploy to collide with — or
  block — another's. Derive names from `getResourceNamePrefix()` (which is
  per-environment, defaulting to the developer's `$USER`); **never hardcode a
  resource name**.
- Tag resources conventionally. Apply the standard tags (`ServiceName`,
  `TeamName`, `RepositoryUrl`, `Environment`) to every stack via
  `cdk.Tags.of(this)`, sourced from `serviceMetadata` — don't invent ad-hoc
  tags.
- Keep dev resources disposable. Use `isEphemeralEnvironment()` to distinguish
  throwaway developer/test environments from `stag`/`prod`, and make ephemeral
  resources tear down cleanly (e.g. `RemovalPolicy.DESTROY`).
- Keep tests lean (see [Testing](#testing)). CDK tests exist for coverage
  and light confidence that a stack has the intended side effect — assert
  presence with `Template.fromStack`
  (`hasResource`, `hasOutput`, `Tags.hasValues`). Don't get bogged down
  asserting full CloudFormation output.

#### Git

Git history is our primary documentation (see [Documentation](#documentation)),
so we care a lot about it. A `git blame` on any line should lead to a commit
that explains that change.

- Write [Tim Pope style](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html)
  commit messages: a capitalised, imperative-mood subject of roughly 50
  characters ("Rename common/scripts to scripts/shared"), a blank line, then a
  body wrapped at ~72 characters.
- Explain the _why_, not the _what_. The diff already shows what changed; the
  message should capture the reasoning and context. If you're an agent and don't
  know why a change is being made, ask the human rather than guessing.
- Record rejected alternatives, especially where the code as written could
  surprise a future reader — knowing what was considered and dismissed saves
  them re-treading it.
- Aim for atomic commits — one small, focused change per commit.
- Curate history so it only reflects what landed on main. We don't want the
  back-and-forth of a branch's journey (PR open → review → approval) in the
  history; amend and rebase your commits so that, once merged, they read as the
  changes that actually affected main.
- **Rebase, don't merge**, to bring a branch up to date with its base.
- One `.gitignore` for the whole project, ignoring only artefacts produced by
  this codebase. Personal or device-specific ignores belong in the developer's
  global gitignore, not here.
