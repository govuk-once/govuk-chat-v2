# Example agent

A quick example of an LLM agent intended to be run on AWS Bedrock AgentCore
Runtime.

## Usage

Deploy the agent's infrastructure with:

```
./scripts/cdk-deploy.sh
```

Then run it on your own machine with:

```
./scripts/agentcore-inspector.sh
```

See the
[AgentCore CLI wrapper](../../libs/python/agentcore-cli-wrapper/README.md) for
what that needs and what else you can pass it.

The Inspector's chat pane stays empty for this agent, which streams this
repository's own event format rather than AG-UI. It still runs, and the traces
and resources views still work. To read a reply, use the two-terminal fallback
in the wrapper's README.
