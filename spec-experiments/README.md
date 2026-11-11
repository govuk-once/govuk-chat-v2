# Spec readability experiments

Rewrites of
[the cloud tests spec](../docs/specs/2026-10-29-run-cloud-tests-against-deployed-environments.md)
to explore how specs could be quicker for a human to read. Each file is one
attempt and has three parts, split by horizontal rules:

1. what the attempt tries
2. the rewritten spec
3. notes on what to change in the `/spec` skill

This directory is for discussion and isn't meant to merge.

## Why the current spec is a tough read

The spec runs to 476 lines and about 3,400 words, roughly 15 minutes of
reading. The rest of `docs/specs` is similar: 1,100 to 3,600 words each.

- **No summary.** Nothing says what is changing until you reach the design
  at line 89. The first thing you read is the problem, which reviewers
  usually know already from the ticket.
- **Everything is said three or four times.** For example, "the test scripts
  don't deploy" appears in R7, twice in _Running locally_, and again in
  _Alternatives considered_. Looking stacks up by tag appears in R2, in
  _Finding the environment_, in _Alternatives considered_ and in the plan.
  The template has a separate section for requirements, design, alternatives,
  security, testing and risks, and the skill fills every one, so each
  decision gets restated in most of them.
- **The requirements are design in disguise.** R4 names AG-UI event types and
  R9 lists file paths, so a reviewer reads the design twice: once as
  requirements, once as prose.
- **Design paragraphs braid four things together:** what we'll do, how it
  works, why, and edge cases. The concurrency paragraph (lines 243–250) gives
  the decision in its first sentence. The next six sentences reason about
  what happens when a run is cancelled. You can't skim for the decision.
- **Decisions aren't marked.** "We chose X" reads the same as "X already
  exists", so you can't scan for the choices you're being asked to agree to.
- **Status is written as design.** About half of _AWS access from CI_ is a
  debugging log of the blocked role assumption. It's useful, but it's status
  that will go stale, and it sits in the middle of the design.
- **Cross-references interrupt reading.** There are 26 inline `(Rn)` tags.
  They let tooling trace requirements, but a human reading prose has to stop
  and look each one up, or learn to ignore them.
- **Justification everywhere.** Most sentences carry a "because", "as X
  does" or "since". Linking to precedent helps reviewers check consistency,
  but repeating it in every clause adds length without adding decisions.

## Attempts

1. [Tables and scenarios](01-tables-and-scenarios.md)
