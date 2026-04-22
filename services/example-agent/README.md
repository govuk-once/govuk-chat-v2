# Example agent

A quick example of an LLM agent intended to be run on AWS Bedrock AgentCore Runtime.

## Usage

Prior to running this you will need to deploy dependent infrastructure to AWS, this can be done with:

```
./scripts/cdk-deploy.sh
```

### Local

```
./scripts/run.sh
```

Then in another terminal window:

```
./scripts/agentcore.sh invoke --dev "Hello agent"
```

### AWS

```
./scripts/agentcore.sh invoke "Hello agent"
```

### Using memory

By default, the agent will use the same short-term memory session on every invocation. If you want to use a different session, you can pass the `session_id` and `end_user_id` parameters to the agent:

```
./scripts/agentcore.sh invoke [--dev] --session-id=db05c8e4-e6fd-44b2-baea-244504a8b779 '{ "prompt": "Tell me a short joke", "end_user_id": "1"}'
```

To view memory events:

```
uv run agentcore memory show events --all
```

or for a specific actor / session:

```
uv run agentcore memory show events --all --actor-id=1 --session-id=db05c8e4-e6fd-44b2-baea-244504a8b779
```
