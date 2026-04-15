# Decision log

Prior to us putting together more formal ADR type documents, this keeps a brief list of key decisions made in prototyping.

## 1. Use Python as main lanugage

- Python is the most common language in the AI space, with the richest library support
- Python is a GDS supported language
- Python has first class AWS support and fast cold start times on AWS Lambda
- Python is often the default language of those working in the AI / Data space, particularly data scientists, and thus we want a cleaner route from prototype to production than we've previously had porting between languages.

## 2. Use TypeScript/NodeJS for AWS CDK

- While CDK supports Python, the App & AI Platform team only currently have resources in TypeScript
- The platform team expects to support Python in future as well as TypeScript, but no concrete commitments
- We don't yet know how heavily we'll rely on internal dependencies for CDK, but it seems unnecessary to cut this off at a language level in the short term
- On Chat team we already expect to have to work with JS somewhat so don't expect infra being written in TS to be a significant impedement or inconvenience at this stage.

## 3. Use Lambda Web Adapter to run Python API Code

- We want to use HTTP streaming, yet Python Lambda Runtime does not currently support this
- Running FastAPI in [Lambda Web Adapater](https://github.com/awslabs/aws-lambda-web-adapter) allows streaming support and a Python backend
- This seemed more appealing than other alternatives:
    1. Switch to Node.JS over Python - unappealing due to decision #1 to use Python
    2. Build a custom runtime for Python Lambda's that supports streaming - unappealing due to it being quite a low level operation that'd impact maintenance and how we write the lambdas
    3. Use ECS to host FastAPI - unappealing as it's much more heavy duty set-up infra wise
    4. Use AWS AppSync - unappealing since it imposes the communication technology (GraphQL) for our API, reducing our flexibility
- Cold starts are likely to be a problem without use of features such as Lambda SnapStart

## 4. Use Amazon Strands as the agentic framework SDK

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
