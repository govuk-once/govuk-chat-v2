# Chat API TypeScript

TypeScript Lambda serverless HTTP API. Exploring whether this is a better API
option than Python Lambda Web Adapter

## Usage

To deploy:

```
./scripts/cdk-deploy.sh
```

To invoke:

```
GATEWAY_URL=$(scripts/fetch-cdk-output.sh ChatApiTsStack GatewayUrl)
export TOKEN_ENDPOINT=$(scripts/fetch-cdk-output.sh ChatApiTsStack TokenEndpoint)
export USER_POOL_ID=$(scripts/fetch-cdk-output.sh ChatApiTsStack UserPoolId)
export APP_CLIENT_ID=$(scripts/fetch-cdk-output.sh ChatApiTsStack AppClientId)

./scripts/api-curl.sh -X POST "${GATEWAY_URL%/}/v1/threads/invoke" \
  -H "Content-Type: application/json" \
  -H "end-user-id: $(uuidgen)" \
  -d '{
    "threadId": "'"$(uuidgen)"'",
    "runId": "'"$(uuidgen)"'",
    "messages": [
      { "id": "'"$(uuidgen)"'", "role": "user", "content": "Tell me about Statutory Sick Pay" }
    ]
  }'
```

## Threads

A thread belongs to the end user in the `end-user-id` header. It is
identified by that header and the client's `threadId` together, so two end
users sending the same `threadId` get separate threads. The API generates
its own id for each thread and uses it as the agent runtime session. The
client never sees that id. `RUN_STARTED` and `RUN_FINISHED` carry the
client's `threadId`. Threads expire a year after their last message.

## Runs and messages

A `runId` and the id of the last message in a request must each be unused
within their thread. They are user input, so they are not expected to be
unique across threads or users, and nothing here looks them up by id alone.

A thread runs one message at a time. Invoking a thread that is already
running, reusing a `runId`, or reusing a message id all return `409`. The
claim on a thread is released when the run ends, and leases for the
lambda's timeout so an instance that dies without releasing cannot block
the thread for longer than it could have been running.

Nothing is recorded for a run that ends in an error. A run and its message
are stored as the run finishes, just before `RUN_FINISHED` reaches the
client, and expire alongside the thread.
