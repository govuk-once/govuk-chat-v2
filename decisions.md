# Decision log

Prior to us putting together more formal ADR type documents, this keeps a brief list of key decisions made in prototyping.

## 1. Use Python for AI/Data Science and TypeScript for other parts

- [We previously][old-python-ts-decision] intended for this project to use Python as the default
  language for all but CDK - which was provisionally TypeScript. However, since then we've:
  - learnt that returning streaming responses with Python on AWS Lambda requires
    [workarounds][lambda-workaround] that increase complexity and negatively impact performance
  - decided to run agents as distinct services, via
    [AWS Bedrock AgentCore Runtime][agentcore-runtime], which removed the need for the agent
    to use the same language as the backend HTTP service
  - experienced less friction building AWS Lambdas in TypeScript, due to better tooling
    support
  - built a successful [user interface prototype][ui-proto] with [AssistantUI][assistant-ui]
    and expect further UIs to be built in full-stack TypeScript
- We therefore expect that while Python will be the language choice for AI/Data Science aspects,
  most notably agents, TypeScript will be the default choice for anything else, with usage
  expected predominantly in HTTP APIs, user interfaces and CDK Infrastructure as Code
- We don't expect the Once Platform team to provide a port of their TypeScript CDK Constructs
  in Python in the medium term, so feel TypeScript CDK is our only platform-friendly option
- We understand this creates a risk that we won't be able to share libraries between tooling
  built in the different languages
- This is consistent with [TAG ADR 011][]

[old-python-ts-decision]: https://github.com/govuk-once/govuk-chat-v2/blob/7b3d8ef1b7e708015e72aa84d6ba4eec8cd5442c/decisions.md#L5-L17
[lambda-workaround]: https://github.com/govuk-once/govuk-chat-v2/commit/b54e1fc8d5227ecbc0c740c132de005a52d9375d
[agentcore-runtime]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
[ui-proto]: https://github.com/govuk-once/govuk-chat-v2-experiments/tree/009865a93af1a3386b0390d0288ca0f6c438eefe/ui
[assistant-ui]: https://www.assistant-ui.com/
[TAG ADR 011]: https://gdsgovukagents.atlassian.net/wiki/spaces/TAG/pages/159318076/011+-+Use+Python+as+the+default+language+for+AI+Projects

## 2. Use Amazon Strands as the agentic framework SDK

We want to use an agentic SDK to orchestrate agent logic rather than building a custom agent loop from scratch. This reduces boilerplate and lets us focus on product behaviour over "plumbing".
Other teams across the Agentic workstream have been experimenting with Strands, the Claude Agent SDK, and Google ADK, giving us a useful reference point across options.

[Amazon Strands](https://strandsagents.com/) is chosen for the following reasons:

- AWS-native but model-agnostic — Strands integrates tightly with Amazon Bedrock (where our models are hosted by default) while remaining compatible with other providers. This avoids lock-in to a single model or provider as the space evolves rapidly.
- Open source (Apache 2.0) — unlike the Claude Agent SDK (proprietary licence), Strands carries no commercial licensing constraints.
- Built-in observability — full tracing and observability are included out of the box, which aligns with our need for debugging and evaluation in a prototyping phase and beyond.
- Flexible orchestration patterns — Strands supports conversational, non-conversational, streaming and non-streaming agent types, and can accommodate graph-style orchestration patterns as our needs evolve.
- Multi-agent support — support for multi-agent coordination, including Graph and the Agent-to-Agent (A2A) protocol, gives us headroom to grow toward more complex architectures without switching frameworks.
- MCP and Skills integration — means we can integrate external tools and skills in a standardised way.
- AWS support relationship — as an AWS-built open-source project, there is a realistic support channel available to us given our AWS partnership.

The Claude Agent SDK was not chosen because it is Claude-specific (limiting model flexibility), proprietary-licensed, and grew primarily out of a coding agent use case rather than general-purpose agentic orchestration.

Google ADK was not chosen as it ties more closely to GCP infrastructure, which sits outside our current stack.

Risk / caveat — Strands is still relatively new and maturing, and its API may change or development stop. We accept some risk links to this as acceptable at prototype stage.
