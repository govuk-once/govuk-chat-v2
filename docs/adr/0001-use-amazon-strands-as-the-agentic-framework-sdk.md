# 1. Use Amazon Strands as the agentic framework SDK

**Date:** 2026-04-13

## Context

We want an agentic SDK to orchestrate agent logic rather than building a custom
agent loop from scratch. This reduces boilerplate and lets us focus on product
behaviour over "plumbing".

Other teams across the Agentic workstream have been experimenting with
[Amazon Strands](https://strandsagents.com/), the Claude Agent SDK and Google
ADK, which gives us a useful reference point across the options.

## Decision

We will use Amazon Strands, for the following reasons:

- AWS-native but model-agnostic — Strands integrates tightly with Amazon
  Bedrock (where our models are hosted by default) while remaining compatible
  with other providers. This avoids lock-in to a single model or provider as
  the space evolves rapidly.
- Open source (Apache 2.0) — unlike the Claude Agent SDK (proprietary licence),
  Strands carries no commercial licensing constraints.
- Built-in observability — full tracing and observability are included out of
  the box, which aligns with our need for debugging and evaluation.
- Flexible orchestration patterns — Strands supports conversational,
  non-conversational, streaming and non-streaming agent types, and can
  accommodate graph-style orchestration patterns as our needs evolve.
- Multi-agent support — support for multi-agent coordination, including Graph
  and the Agent-to-Agent (A2A) protocol, gives us headroom to grow toward more
  complex architectures without switching frameworks.
- MCP and Skills integration — means we can integrate external tools and skills
  in a standardised way.
- AWS support relationship — as an AWS-built open-source project, there is a
  realistic support channel available to us given our AWS partnership.

## Status

**accepted**

## Consequences

- The Claude Agent SDK was not chosen because it is Claude-specific (limiting
  model flexibility), proprietary-licensed, and grew primarily out of a coding
  agent use case rather than general-purpose agentic orchestration.
- Google ADK was not chosen as it ties more closely to GCP infrastructure,
  which sits outside our current stack.
- Strands is still relatively new and maturing, so its API may change or its
  development may stop. When this decision was taken the codebase was an
  explicit prototype and we judged that risk proportionate.
