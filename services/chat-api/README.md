# Chat API

Basic prototype, but could one day be a basis for conversation and usage APIs.
Built using FastAPI framework and configured to run on AWS Lambda Web Adapter.

There is a draft specification for the endpoints and use-cases: [API Spec](api-spec.md)

## Usage

### Local

```
./scripts/run.sh
```

### AWS

To deploy:

```
./scripts/cdk-deploy.sh
```

To invoke:

```
GATEWAY_URL=$(scripts/fetch-cdk-output.sh ChatApiStack GatewayUrl)
./scripts/aws-curl.sh "${GATEWAY_URL%/}/stream"
./scripts/aws-curl.sh -H 'Content-type: application/json' -d '{ "message": "Is this working?" }' "${GATEWAY_URL%/}/sonnet-streaming/assistant-response"
```
