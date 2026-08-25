# Chat API FastAPI

An early implementation, but could one day be a basis for conversation and
usage APIs. Built using FastAPI framework and configured to run on AWS Lambda
Web Adapter.

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
GATEWAY_URL=$(scripts/fetch-cdk-output.sh ChatApiFastapiStack GatewayUrl)
./scripts/aws-curl.sh "${GATEWAY_URL%/}/stream"
./scripts/aws-curl.sh -H 'Content-type: application/json' -d '{ "message": "Is this working?", "session_id": "session-123", "end_user_id": "user-123" }' "${GATEWAY_URL%/}/invoke-agent"
```

#### DynamoDB endpoints

```
./scripts/aws-curl.sh -X POST -H 'Content-type: application/json' -d '{"title": "Test conversation", "user_id": "user-123"}' "${GATEWAY_URL%/}/conversations"
./scripts/aws-curl.sh -X POST -H 'Content-type: application/json' -d '{"message": "How much tax should I pay?"}' "${GATEWAY_URL%/}/conversations/${CONVERSATION_ID}/messages"
./scripts/aws-curl.sh "${GATEWAY_URL%/}/conversations/${CONVERSATION_ID}"
./scripts/aws-curl.sh "${GATEWAY_URL%/}/users/user-123/conversations"
```
