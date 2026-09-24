# Chat UI

A Next.js web app for trying out the Chat API in a browser. Its page is a
chat that sends each message to the Chat API through a server-side route and
streams the answer back. Refreshing the page starts a new conversation. It
also serves a `/api/health` route.

## Usage

To run it on your own machine:

```
./scripts/dev.sh
```

The page is at http://localhost:3000 and the health check at
http://localhost:3000/api/health. Arguments are passed to `next dev`, so
`./scripts/dev.sh --port 3001` picks another port.

## Configuration

The server calls the Chat API as the Cognito app client of a deployed
`ChatApiTsStack`. It needs that stack's URL, token endpoint, user pool and
app client, and reads the client secret from Cognito with your AWS
credentials. To run it against your own stack:

```
export CHAT_API_URL=$(scripts/fetch-cdk-output.sh ChatApiTsStack GatewayUrl)
export COGNITO_TOKEN_ENDPOINT=$(scripts/fetch-cdk-output.sh ChatApiTsStack TokenEndpoint)
export COGNITO_USER_POOL_ID=$(scripts/fetch-cdk-output.sh ChatApiTsStack UserPoolId)
export COGNITO_APP_CLIENT_ID=$(scripts/fetch-cdk-output.sh ChatApiTsStack AppClientId)
```

## Building the image

The image builds from the repo root, because pnpm keeps the lockfile there:

```
docker build -f services/chat-ui/Dockerfile -t chat-ui .
docker run --rm -p 3000:3000 chat-ui
```

`next build` runs only inside this Docker build.

## Deploying

To deploy to ECS Express Mode:

```
./scripts/cdk-deploy.sh
```

The app is at the stack's `EndpointUrl`:

```
./scripts/fetch-cdk-output.sh ChatUiStack EndpointUrl
```

The container gets one config value, `ENVIRONMENT`, the deployment
environment name. `/api/health` reports it.

A deployed stack has no access gate until CHAT-932 adds sign-in. Anyone with
its URL can chat using the team's Chat API credentials, so destroy it as soon
as you are finished.

Each stack runs a Fargate task and a load balancer all the time, so destroy
it when you are finished. `aws-stack-cleanup` will not remove it, because it
matches on a tag key named after its environment and Chat stacks tag
`Environment=<name>`. To destroy it, from the `cdk` directory:

```
pnpm exec cdk destroy ChatUiStack
```
