# Agentic answers agent

An AgentCore agent that answers questions about GOV.UK, and streams its
answers as AG-UI events.

## Usage

Deploy the agent's infrastructure with:

```
./scripts/cdk-deploy.sh
```

Then run it on your own machine with:

```
./scripts/agentcore-inspector.sh
```

After changing the agent's code, stop and restart the script to pick up the
changes. You do not need to deploy the stack again.

See the
[AgentCore CLI wrapper](../../libs/python/agentcore-cli-wrapper/README.md) for
what that needs and what else you can pass it.
