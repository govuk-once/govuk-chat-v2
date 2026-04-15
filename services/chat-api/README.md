# Chat API

Basic prototype, but could one day be a basis for conversation and usage APIs.
Built using FastAPI framework and configured to run on AWS Lambda Web Adapter.

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

#### DynamoDB endpoints

```
./scripts/aws-curl.sh -X POST -H 'Content-type: application/json' -d '{"title": "Test conversation", "user_id": "user-123"}' ${GATEWAY_URL}/conversations
./scripts/aws-curl.sh -X POST -H 'Content-type: application/json' -d '{"message": "How much tax should I pay?"}' ${GATEWAY_URL}/conversations/${CONVERSATION_ID}/messages
./scripts/aws-curl.sh ${GATEWAY_URL}/conversations/${CONVERSATION_ID}
./scripts/aws-curl.sh ${GATEWAY_URL}/users/user-123/conversations
```
