# Example agent

A quick example of an LLM agent intended to be run on AWS Bedrock AgentCore Runtime.

## Usage

### Local

```
./scripts/run.sh
```

Then in another terminal window:

```
./scripts/agentcore.sh invoke --dev "Hello agent"
```

### AWS

To deploy:

```
./scripts/cdk-deploy.sh
```

To invoke:

```
./scripts/agentcore.sh invoke "Hello agent"
```
