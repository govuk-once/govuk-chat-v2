# Agentic answers agent

An AgentCore agent that answers questions about GOV.UK, and streams its
answers as AG-UI events. It searches GOV.UK content in GOV.UK Chat V1's
OpenSearch index, using the connection details in the
`govuk-chat-v2-opensearch` secret. That secret is only in the dev account
for now.

A Bedrock guardrail, created by the agent's stack, checks each user message
and each answer. When it steps in, ag-ui-strands sends an `AgentStopped` event
with `stop_reason` set to `guardrail_intervened`.

## Usage

Deploy the agent's infrastructure with:

```
./scripts/cdk-deploy.sh
```

Then run it on your own machine with:

```
./scripts/agentcore-inspector.sh
```

Ask it a question about GOV.UK, such as "How do I renew my passport?".

After changing the agent's code, stop and restart the script to pick up the
changes. You do not need to deploy the stack again.

See the
[AgentCore CLI wrapper](../../libs/python/agentcore-cli-wrapper/README.md) for
what that needs and what else you can pass it.
