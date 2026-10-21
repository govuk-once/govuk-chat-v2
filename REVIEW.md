# Review instructions

Rules for reviewing a pull request in this repo. The review criteria
(what to look for, what not to raise, severities) are the "Code review"
section of [AGENTS.md](AGENTS.md) — follow it. This file only adds what is
specific to reviewing a pull request.

## Shape of the pull request

- If the PR includes changes unrelated to its main purpose, suggest moving them
  into a separate PR, so each can be reviewed, merged and reverted on its own.
- If the PR is too large to review well, suggest breaking it into stacked PRs,
  each a reviewable step towards the whole. Signs of this are thousands of lines
  changed (excluding lockfiles), changes spread across unrelated areas or
  features, or a large feature delivered in one PR across several parts of the
  codebase. Such a PR asks too much of a human reviewer, puts people off
  reviewing it, and tends to stall on discussion of one part while the rest
  waits.

Raise these in the review summary, not as inline comments.

## Risk assessment

Open the summary with an overall risk rating for the PR — **low**, **medium**
or **high** — and a sentence or two on why, weighing:

- how much it changes, and how much of the system that touches
- how opinionated the changes are: whether they follow existing precedent or
  set a new direction
- how hard it would be to back out of its decisions once merged and deployed,
  e.g. data model changes, public interfaces, infrastructure that holds state
- whether it introduces new technology choices, such as a library, service or
  framework

The rating is to help a human decide how closely to review, not a judgement of
the work.
