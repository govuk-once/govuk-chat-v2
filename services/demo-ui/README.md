# Demo UI

A Next.js web app for trying out the Chat API in a browser. Its page is a
chat that sends each message to the Chat API through a server-side route and
streams the answer back. The server keeps the conversation's thread in a
cookie, so refreshing the page carries on the same conversation. The page
shows the conversation's earlier messages when it loads. The "New
conversation" button starts a new one. Each finished answer has 👍 and 👎
buttons for giving feedback on it once, and shows the reaction given. It
also serves a `/api/chat/messages` route that returns the conversation's
messages, and a
`/api/chat/threads/{threadId}/messages/{messageId}/feedback` route that
gives feedback on one.

## Usage

To run it on your own machine:

```
./scripts/dev.sh
```

The page is at http://localhost:3000. Arguments are passed to `next dev`,
but keep the default port, as sign-in only works locally on port 3000.

## Configuration

The server calls the Chat API as the Cognito app client of a deployed
`ChatApiStack`. It needs that stack's URL, token endpoint, user pool and
app client, and reads the client secret from Cognito with your AWS
credentials. To run it against your own stack:

```
export CHAT_API_URL=$(scripts/fetch-cdk-output.sh ChatApiStack GatewayUrl)
export COGNITO_TOKEN_ENDPOINT=$(scripts/fetch-cdk-output.sh ChatApiStack TokenEndpoint)
export COGNITO_USER_POOL_ID=$(scripts/fetch-cdk-output.sh ChatApiStack UserPoolId)
export COGNITO_APP_CLIENT_ID=$(scripts/fetch-cdk-output.sh ChatApiStack AppClientId)
```

## Sign-in

The app requires Cognito sign-in. Unauthenticated page requests are
redirected to the Cognito Hosted UI, and API requests get a 401.

Sign-in uses [openid-client](https://github.com/panva/openid-client),
which finds Cognito's endpoints from its published configuration.
Sessions last 24 hours and are kept in a cookie encrypted with
[iron-session](https://github.com/vvo/iron-session).

Self sign-up is off, so to sign in to your dev stack, create yourself a
user (named `$USER` unless you pass a username) in your `ChatApiStack`
user pool:

```
scripts/create-dev-user.sh
```

Run it again if you forget the password, and it sets a new one.

For local development, deploy your `DemoUiStack` to create the sign-in
client, then export its ID and a session secret of at least 32
characters:

```
export COGNITO_SIGN_IN_CLIENT_ID=$(scripts/fetch-cdk-output.sh DemoUiStack SignInClientId)
export SESSION_SECRET=$(openssl rand -base64 32)
```

Locally, sign-in only works on port 3000, as
`http://localhost:3000/api/auth/callback` is the only local callback URL
the sign-in client accepts.

For a deployed stack, the CDK passes these values to the web function and
registers the endpoint's callback URL automatically via a custom resource.
Rather than `SESSION_SECRET`, the web function gets `SESSION_SECRET_ARN`
and reads the secret from Secrets Manager.

## Deploying

To deploy to a
[Lambda web function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html):

```
./scripts/cdk-deploy.sh
```

The CDK runs `next build` on your machine and deploys a zip of the
standalone output, with `index.js` as its entry point. `index.js` starts
the standalone server on the address Lambda gives it.

The app is at the stack's `EndpointUrl`:

```
./scripts/fetch-cdk-output.sh DemoUiStack EndpointUrl
```

The web function gets the Chat API values above from the `ChatApiStack` in
the same environment, which the deploy script deploys first.

A deploy succeeds even if the app fails to start, so open the app after
deploying to check it.

The web function scales to zero when idle, but destroy the stack when you
are finished. `aws-stack-cleanup` will not remove it, because it matches on
a tag key named after its environment and Chat stacks tag
`Environment=<name>`. To destroy it, from the `cdk` directory:

```
pnpm exec cdk destroy DemoUiStack
```
