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

## A briefing and a build sheet

A spec has two readers, so it has two parts:

- **The briefing** is for reviewers. It says what will be different, what
  they're being asked to agree to, and what could go wrong. Keep it to a
  3-minute read at most (about 600–900 words), and say at the top how long it
  takes to read and how many decisions it asks for.
- **The build sheet** is for whoever implements it. It's terse reference: the
  work in each pull request, the edge cases to handle and the checks that show
  it works. It records agreed facts, not arguments — anything with a "because"
  belongs in the briefing or nowhere. Reviewers don't need to read it.

The author sorts the decisions, so reviewers don't have to read everything to
find the ones that matter:

- **Decide** is for real trade-offs a reviewer might choose differently. Each
  is a question with a recommendation and its main alternative. Have no more
  than three; if there are more, the work probably wants splitting into more
  than one spec.
- **Know** is for decisions that are consequential but not contentious, a line
  or two each.
- **Following precedent** names the existing patterns the work follows, in a
  sentence or two for all of them, so a reviewer can object without reading
  about each.

Decisions about security, privacy or accessibility go in Decide or Know, never
in Following precedent. Anything needed to roll out safely, such as migrations,
feature flags or ordering between services, goes in Know or Delivery.

Put what a reviewer will experience before any mechanism: the before and after,
then a walkthrough in the second person. Say each fact once. Leave out any
briefing section that would be empty rather than writing "None".

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
it before implementation starts. Reviewers should read the briefing and check
that the Decide items are the real decisions, that nothing under Know or
Following precedent deserves arguing about, that the risks are the right ones,
and that anything being waited on is either resolved or explicitly carried
forward. Implementation pull requests should link to the spec they deliver.
Where the work is split across several pull requests, set **implemented** in
the last of them.

Spec pull requests are an exception to curating history by amending and
rebasing (see [Git](../../AGENTS.md#git)). A spec has no tests or CI to show
whether a revision matters, so reviewers need to see what changed since they
last looked. Commit each round of review changes separately instead of
amending, and keep those commits when merging. Each message should say which
decision or section changed and why.

Likewise, when the plan changes during implementation, update the spec in its
own commit, separate from the code, saying what diverged and why.

## Template

```markdown
# Title of the feature

**Date:** YYYY-MM-DD · **Status:** accepted · **Ticket:** link, if there is one

**N-minute read. You're asked to decide N things.** The
[build sheet](#build-sheet) is for whoever implements it; you don't need it
to review.

## In one sentence

What will be different, and why it's worth doing.

## Before and after

| Today               | After                       |
| ------------------- | --------------------------- |
| How things work now | How they'll work once built |

## What you'll experience

What a developer or user will see and do once this is built, in the second
person: "you run…, it checks…".

## Decide

### 1. A question a reviewer might answer differently?

**Recommended:** the answer we propose.

Why, and what it costs.

- **Alternative:** the main alternative, and why we don't recommend it.

## Know

- **A consequential decision that isn't contentious,** in a line or two.

## Following precedent

The existing patterns this work follows, named in a sentence or two.

## Not in this change

- What is deliberately out of scope, so reviewers don't assume it is covered.

## Waiting on

Who or what the work is blocked on, and what can go ahead in the meantime.

## What could bite us

- **A risk that could sink or delay the work,** and how we'll find out or
  mitigate it.

## Delivery

1. What the first pull request delivers.

Split the work into a pull request for each change a reviewer can assess on
its own, ordered as they will merge, and say why the split helps. One pull
request is fine when the work reads as a single change.

---

## Build sheet

Reference for the implementer. Terse by design: it records agreed facts, not
arguments.

### Steps

The work in each pull request in Delivery, as a list under its number.

### Edge cases

- If something happens, then what the code does.

### Checks

How each pull request is verified — unit tests, tests that need cloud
infrastructure, and any manual checks.

### Open questions

Detail on anything in Waiting on, or that needs answering during
implementation, and who can answer it. Remove this section once there are
none.
```
