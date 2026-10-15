# Specs

This directory holds feature specs for GOV.UK Chat V2. A spec describes a piece
of work — what we want, why, under which constraints, and how we plan to build
it — so it can be reviewed before any code is written. Changing course at that
point is a matter of editing a document rather than reworking an
implementation.

The `/spec` Claude Code skill (in [.claude/skills/spec](../../.claude/skills/spec))
drafts specs in this format, but they can just as well be written by hand.

## When to write one

Write a spec for work that is large or uncertain enough that a reviewer would
want to agree the approach first — a new feature, a change spanning several
packages, or anything touching security, data or infrastructure.

Small, well-understood changes don't need one; a good commit message is enough.

If a spec contains a decision that affects the architecture of the service,
that decision also warrants an [ADR](../adr/README.md).

## Specs are a point-in-time record

A spec captures what we believed and intended on the date it was written. It is
not kept in sync with the code as it evolves — git history and the code itself
are the source of truth for how things work now. Read an older spec as context
for why something was built, not as a description of current behaviour.

If the plan changes significantly during implementation, update the spec in the
implementation pull request so the merged spec reflects what was actually
built. After that, leave it alone: if later work changes direction, write a new
spec. If the old one was never built, mark it withdrawn.

## Naming

Files are named `YYYY-MM-DD-title-in-kebab-case.md`, where the date is when the
spec was first written. The title describes the feature, e.g.
`2026-10-12-stream-tool-call-progress.md`.

If a spec needs supporting files such as diagrams, put them in a directory with
the same name as the spec, without the `.md` extension.

## Review and status

A spec's status is set in the pull request that changes it, so the merged spec
is always accurate without a follow-up edit:

- **accepted** — the spec is agreed but the work hasn't been built yet. Use
  this when a spec is merged ahead of its implementation.
- **implemented** — the work described has been built. Set this in the
  implementation pull request, or straight away if the spec and implementation
  land in the same pull request.
- **withdrawn** — we decided not to build the work. Set this in a pull request
  that explains why, linking to any spec that replaces it.

An open spec pull request is the proposal, so there is no status for it. Review
it before implementation starts. Reviewers should check that the spec solves
the stated problem, that its requirements are testable, and that open questions
are either answered or explicitly carried forward. Implementation pull requests
should link to the spec they deliver.

## Template

```markdown
# Title of the feature

**Date:** YYYY-MM-DD

**Status:** accepted

## Problem

What problem we are solving, for whom, and why now. Link to any tickets or
supporting research.

## Goals

- What a successful outcome looks like.

## Non-goals

- What is deliberately out of scope, so reviewers don't assume it is covered.

## Requirements

Numbered so tests, the plan and pull requests can refer to them.

1. **R1:** A testable statement of required behaviour.

## Design

How the feature will work: the packages and services involved, changes to
APIs, data or infrastructure, and how it fits the existing architecture. Cover
security, privacy and accessibility where they apply.

## Alternatives considered

Approaches that were rejected, and why.

## Implementation plan

The affected packages and files, and the steps to deliver the work, ordered as
they will be committed. Note which requirements each step delivers.

1. Step one (R1)

### Testing

How the requirements will be verified — unit tests, tests that need cloud
infrastructure, and any manual checks.

### Rollout

Anything needed to deploy safely: infrastructure changes, migrations, feature
flags, ordering between services. Write "None" if there is nothing.

## Risks

What could go wrong, and how we will mitigate or monitor it.

## Open questions

Questions that need an answer before or during implementation, and who can
answer them. Remove this section once there are none.
```
