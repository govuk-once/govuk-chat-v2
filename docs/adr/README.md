# Architecture decision records

This directory records the architecture decisions made for GOV.UK Chat V2, in
the format described by the
[GDS Way](https://gds-way.digital.cabinet-office.gov.uk/standards/architecture-decisions.html).
It is the same structure used by
[GOV.UK Chat V1](https://github.com/alphagov/govuk-chat/tree/main/docs/adr), so
the two repositories read alike.

## When to write one

Write an ADR when a decision affects the architecture of the service and a
future reader would otherwise have to guess why things are the way they are —
choosing a framework, a language, a storage technology, a protocol, or
deliberately rejecting one.

Routine decisions don't need an ADR. Git history is our primary documentation
(see [AGENTS.md](../../AGENTS.md)), so if a good commit message covers the
reasoning, that is enough.

## Naming

Files are named `NNNN-title-in-kebab-case.md`, where `NNNN` is the next number
in the sequence, zero-padded to four digits. The title describes the decision,
not the problem — "Use Amazon Strands as the agentic framework SDK", not
"Choosing an agentic framework".

Numbers are permanent identifiers. Never renumber an existing ADR, and never
reuse a number, even if an ADR is superseded.

If an ADR needs supporting files such as diagrams, put them in a directory
named after its number (e.g. `0001/`).

## Status

An ADR moves through the following states:

- **proposed** — open as a pull request for discussion
- **accepted** — merged to `main`
- **superseded** — replaced by a later decision

Don't edit an accepted ADR to change its decision. Write a new one and mark the
old as `superseded by [ADR-NNNN](NNNN-title-in-kebab-case.md)`, so the record of
what we thought at the time survives.

Correcting a typo or a broken link in an accepted ADR is fine.

## Template

```markdown
# N. Title of the decision

**Date:** YYYY-MM-DD

## Context

The facts behind the need to make this decision. What forces are at play —
technical, organisational, product? Write neutrally; this section should read
as true regardless of what was decided.

## Decision

What we have decided to do, in the active voice: "We will…".

## Status

**accepted**

## Consequences

What follows from the decision, both positive and negative. Include the risks
we are knowingly accepting and anything a future reader would need to revisit
if those risks materialise.
```
