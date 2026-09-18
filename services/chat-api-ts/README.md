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
export API_KEY_ID=$(scripts/fetch-cdk-output.sh ChatApiTsStack AppApiKeyId)

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

## Clients

Each client receives Cognito credentials for authentication and an API
Gateway API key for throttling. Requests carry a bearer token and the key
in an `x-api-key` header. A missing or invalid key is rejected with `403`
and the API's usual `{ "error": "..." }` body.

API Gateway validates the token and key independently. It does not check
that they were issued to the same client. A caller with another client's
key can use that client's allowance with its own valid token.

To add a client, add a name to the stack's `clients` list and deploy.
Then hand its client secret and API key to the client out of band.

Thread identity uses only `end-user-id` and `threadId`. Clients with the
same values access the same thread, regardless of their API keys.

## Rate limits

Three limits apply at the API Gateway, before the lambda runs:

- Each method has a shared target of 15 requests a second and burst 30
  multiplied by the number of configured clients. Two clients give each
  method a shared target of 30 requests a second and burst 60. GET and
  POST have separate shared targets.
- Each API key has an allowance of 15 requests a second and a burst
  allowance of 30. GET and POST requests share it. This uses V1's write
  rate for all operations; separate read limits are not configured.
- Each end user, identified by the `end-user-id` and `x-api-key` headers
  together, can send 15 `POST /v1/threads/invoke` requests a minute. The
  same end user sent by two clients has a separate count for each.

All API keys use one usage plan, which defines their throttling policy.
API Gateway keeps a separate allowance for each key in the plan.
The shared method targets grow with the client list to accommodate each
client's allowance. They do not represent measured downstream capacity.
Review that capacity before adding clients.

Throttled requests receive `429` with the API's usual
`{ "error": "..." }` body.
[API Gateway throttles are best effort](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html),
so requests can exceed these targets. They are not guaranteed cost caps.

The per-end-user WAF rule runs before authentication and counts requests
with the same pair of header values even if authentication fails. It
does not count requests missing either header, because
[WAF requires every aggregation key to be present](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-aggregation-options.html).
The gateway's key check or the lambda refuses such a request instead.

The per-end-user limit is a WAF rate rule. WAF checks the count about
every ten seconds, so a burst can exceed the limit before blocking
begins, and blocking lasts until the count for the last minute drops
below the limit again.
