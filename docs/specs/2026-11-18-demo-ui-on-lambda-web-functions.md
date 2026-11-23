# Run demo-ui on Lambda web functions

**Date:** 2026-11-18

**Status:** accepted

**2-minute read. The decisions are made; check you agree with them under
[Know](#know).** The [build sheet](#build-sheet) is for whoever implements
it; you don't need it to review.

## Briefing

### Problem

`services/demo-ui` is a small Next.js app on ECS Express Mode. Hosting it
needs a VPC, a Docker image build and an ECS service, which is heavy and slow
to deploy for one app.
[Lambda web functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
run an ordinary Node.js HTTP server behind a managed HTTPS endpoint and scale
to zero, so we'll host demo-ui on one instead.

### Before and after

- **Today:** an ECS Express service runs a Docker image in a VPC, health-
  checked on `/api/health`, at a URL on `*.ecs.<region>.on.aws`.
- **After:** a Lambda web function runs a zip of the Next.js build, with no
  VPC or health check, at a URL on the web function's domain.

### What you'll experience

You deploy demo-ui and open the URL from the stack output, as now. It's a new
URL, so old bookmarks stop working. You sign in through Cognito as you do
today, and chat replies stream to the browser. If nobody has used it for a
while, it still loads. If you deploy a build that can't start, the deploy
still succeeds and you find out when you open the app.

### Know

- **Web functions over the alternatives:** ECS Express is the set-up we're
  leaving but stays the fallback, Lambda Web Adapter has more moving parts,
  and Amplify Hosting has a different deploy model from the rest of our app.
- **Public endpoint, with Cognito as its only protection:** as the ECS
  endpoint is today. The `Host` header reaches the app unchanged, so the
  OAuth redirect logic doesn't change. CloudFront with an IAM-signed origin
  would add a distribution, an origin access control, `Host` rewriting and a
  way to keep Cognito's redirects working, for no benefit while we have no
  custom domain or WAF. We'd revisit it if we need either.
- **`SESSION_SECRET` is fetched from Secrets Manager at start-up:** ECS
  injects it into the container today, and web functions have no
  equivalent. An environment variable would be simpler, but anyone who can
  read the revision could read the secret back.
- **No health check:** a broken build deploys and only fails on requests,
  which the manual check covers for a demo app.
- **No VPC:** calls to Cognito and API Gateway are public.
- **Docker goes:** the Dockerfile, root `.dockerignore`, Docker CI job and
  `/api/health` are removed. CDK runs `next build` on the host during synth,
  rather than building an image.
- **Two construct defaults are overridden:** a 30-second timeout, too short
  for a streamed reply, and a log group retained on stack deletion, which
  would stop ephemeral environments tearing down cleanly.

### Precedent

The existing custom resource sets the sign-in client's callback URLs
(localhost only in ephemeral environments), the stack outputs stay the same,
and sessions stay in encrypted cookies. The app already fetches a secret at
runtime: it reads the Chat API client secret from Cognito rather than
holding a copy.

### Risks

- **The service and its CDK construct are new**, the construct only weeks
  old, so behaviour may still shift.
- **Streaming is untested** with our app on web functions.

## Build sheet

### Files

```
.dockerignore                         # remove
.github/workflows/demo-ui-ci.yaml     # remove Docker job and .dockerignore paths
cdk/package.json                      # aws-cdk-lib >= 2.276.0
cdk/src/bundling/nextjs.ts            # add: next build on the host, zip .next/standalone, .next/static, index.js
cdk/src/stacks/demo-ui-stack.ts       # WebFunction replaces VPC, Docker asset, ECS service
cdk/src/stacks/demo-ui-stack.test.ts
services/demo-ui/
  Dockerfile                          # remove
  README.md
  index.js                            # add: HOSTNAME, PORT from AWS_LAMBDA_HTTP_ENDPOINT; fetch SESSION_SECRET; start standalone server
  package.json                        # add @aws-sdk/client-secrets-manager
  src/app/api/health/                 # remove
```

### `WebFunction`

- `runtime`: `WebFunctionRuntime.NODEJS_24_X`
- `code`: `WebFunctionCode.fromAssetToManagedBucket(<package dir>)`, with
  local bundling so synth runs `next build` on the host
- `defaultEndpointAuth`: `WebFunctionAuthType.APPLICATION_MANAGED`
- `timeout`: enough for a streamed reply; default 30s, maximum 900s
- `logGroup`: the stack's own; `DESTROY` when ephemeral, `RETAIN` otherwise
- `environment`: `ENVIRONMENT`, `CHAT_API_URL`, `COGNITO_TOKEN_ENDPOINT`,
  `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`,
  `COGNITO_SIGN_IN_CLIENT_ID`, `SESSION_SECRET_ARN`
- Role: `cognito-idp:DescribeUserPoolClient` on the user pool;
  `secretsmanager:GetSecretValue` on the session secret

### Stack wiring

- `SignInClientSettings` origins: `https://<endpoint.domainName>`, plus
  `http://localhost:3000` when ephemeral
- Outputs: `EndpointUrl` from `endpoint.domainName`; `SignInClientId`
  unchanged

### Edge cases

- If the app fails to start, the deploy still succeeds.
- If the bootstrap bucket uses a customer managed KMS key, staging fails with
  `AccessDenied` on `CopyObject`; use `fromBucket()`.
- If an AWS Organizations service control policy denies
  `ApplicationManaged` endpoints, the deploy fails with access denied; ask
  the Platform team for an exception.
- If the session secret can't be fetched, the shim exits before starting the
  server, so requests fail rather than sessions using no secret.
- The standalone output only includes modules Next.js traces, so the shim's
  Secrets Manager client must be included explicitly.
- If the `WebFunction` construct id changes, the endpoint gets a new URL.

### Checks

- CDK tests: web function and endpoint exist; localhost callbacks only when
  ephemeral; both outputs exist.
- Unit test for the entry shim.
- Manual, against real AWS: sign in, stream a reply, open after idle.
- Set **implemented** in the implementation pull request.
