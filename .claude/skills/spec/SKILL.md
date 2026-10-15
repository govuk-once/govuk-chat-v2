---
name: spec
description: Draft a feature spec in docs/specs for review before implementation. Use when the user wants to plan, spec out or design a feature or change before building it.
argument-hint: '[short description of the feature]'
---

# Write a feature spec

Produce a spec in `docs/specs/` describing a piece of work, so a human can
review the approach before any code is written. The format, naming, status
lifecycle and template are defined in
[docs/specs/README.md](../../../docs/specs/README.md) — read it first and
follow it exactly. Don't restate or vary the template here.

**Don't implement anything.** The output of this skill is a document. Code is
written only after the spec has been reviewed and accepted.

## 1. Interview

Start from the user's description (`$ARGUMENTS`, if given). Ask about what you
can't find out from the codebase, a few questions at a time:

- the problem and who has it — why this work, why now
- what success looks like, and what is explicitly out of scope
- constraints: deadlines, dependencies on other teams or services, security,
  privacy or accessibility needs
- any approach the user already has in mind, or has already rejected

Stop asking once you can describe the problem and goals in the user's terms.

## 2. Explore

Find what the spec needs to be grounded in the code as it is today:

- the packages, files and infrastructure the work will touch
- precedent to follow (see AGENTS.md: consistency over preference)
- relevant ADRs in `docs/adr/` and earlier specs in `docs/specs/`
- existing tests and CI that will need to cover the change

Use subagents for broad searches so the conversation keeps the conclusions, not
the file dumps.

## 3. Draft

Write the spec to `docs/specs/YYYY-MM-DD-title-in-kebab-case.md`, using today's
date and status **accepted**.

- **Don't invent content.** Requirements, goals and rationale come from the
  user or the codebase. Where you would be guessing, add an open question
  instead.
- Make each requirement testable, and reference requirement numbers from the
  implementation plan and testing sections.
- Order the implementation plan as atomic commits, following the repo's
  conventions for packages, tests and CDK.
- Treat prompts as sensitive: don't write production prompts into a spec.
- If the design includes an architectural decision, say so to the user and ask
  whether it warrants an ADR. Don't write one unprompted.

## 4. Review

Summarise the spec for the user, lead with the open questions and riskiest
assumptions, and iterate on their feedback. When they are happy, offer to
commit it and open a pull request for team review — the spec is accepted when
that pull request merges.
