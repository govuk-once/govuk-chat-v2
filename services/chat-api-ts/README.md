# Chat API TypeScript

Prototype TypeScript Lambda serverless HTTP API. Exploring whether this is a
better API option than Python Lambda Web Adapter

## Usage

To deploy:

```
./scripts/cdk-deploy.sh
```

To invoke:

```
GATEWAY_URL=$(scripts/fetch-cdk-output.sh ChatApiTsStack GatewayUrl)
./scripts/aws-curl.sh "${GATEWAY_URL%/}/v1/hello-world"
```

or:

```
GATEWAY_URL=$(scripts/fetch-cdk-output.sh ChatApiTsStack GatewayUrl)
./aws-curl.sh -X POST "${GATEWAY_URL%/}/v1/threads/invoke" \
  -H "Content-Type: application/json" \
  -H "end-user-id: user-123" \
  -d '{
    "threadId": "12345678-1234-4234-8234-123456789012",
    "runId":"12345678-1234-4234-8234-123456789012",
    "messages": [
      { "id": "msg-1", "role": "user", "content": "Tell me about Statutory Sick Pay" }
    ]
  }'
```
