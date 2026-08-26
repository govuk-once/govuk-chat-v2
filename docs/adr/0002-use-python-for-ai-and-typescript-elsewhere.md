# 2. Use Python for AI and data science, TypeScript elsewhere

**Date:** 2026-08-13

## Context

[We previously][old-python-ts-decision] intended for this project to use Python
as the default language for all but CDK, which was provisionally TypeScript.
Since then we have:

- learnt that returning streaming responses with Python on AWS Lambda requires
  [workarounds][lambda-workaround] that increase complexity and negatively
  impact performance
- decided to run agents as distinct services, via
  [AWS Bedrock AgentCore Runtime][agentcore-runtime], which removed the need for
  the agent to use the same language as the backend HTTP service
- experienced less friction building AWS Lambdas in TypeScript, due to better
  tooling support
- built a successful [user interface prototype][ui-proto] with
  [AssistantUI][assistant-ui] and expect further UIs to be built in full-stack
  TypeScript

Separately, we don't expect the Once Platform team to provide a port of their
TypeScript CDK Constructs in Python in the medium term, so TypeScript CDK is our
only platform-friendly option for infrastructure as code.

## Decision

Python will be the language choice for AI and data science aspects, most
notably agents. TypeScript will be the default choice for anything else, with
usage expected predominantly in HTTP APIs, user interfaces and CDK
infrastructure as code.

## Status

**accepted**

This supersedes the [earlier position][old-python-ts-decision] that Python was
the default for everything but CDK. That decision predates this directory and
was recorded in the decision log rather than as an ADR, so there is no numbered
record to mark as superseded.

## Consequences

- This is consistent with [TAG ADR 011][].
- We understand this creates a risk that we won't be able to share libraries
  between tooling built in the different languages.

[old-python-ts-decision]: https://github.com/govuk-once/govuk-chat-v2/blob/7b3d8ef1b7e708015e72aa84d6ba4eec8cd5442c/decisions.md#L5-L17
[lambda-workaround]: https://github.com/govuk-once/govuk-chat-v2/commit/b54e1fc8d5227ecbc0c740c132de005a52d9375d
[agentcore-runtime]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
[ui-proto]: https://github.com/govuk-once/govuk-chat-v2-experiments/tree/009865a93af1a3386b0390d0288ca0f6c438eefe/ui
[assistant-ui]: https://www.assistant-ui.com/
[TAG ADR 011]: https://gdsgovukagents.atlassian.net/wiki/spaces/TAG/pages/159318076/011+-+Use+Python+as+the+default+language+for+AI+Projects
