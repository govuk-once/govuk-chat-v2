# Chat API FastAPI

Basic prototype, but could one day be a basis for conversation and usage APIs.
Built using FastAPI framework and would expected to be run on a containerised
architecture.

## Usage

### Local

```
./scripts/run.sh
```

### AWS

To deploy:

```
./scripts/cdk-deploy.sh
```

To invoke, given the output of the Gateway URL:

```
./scripts/aws-curl.sh ${GATEWAY_URL}/stream
./scripts/aws-curl.sh -H 'Content-type: application/json' -d '{ "message": "Is this working?" }' ${GATEWAY_URL}/sonnet-streaming/assistant-response
```
