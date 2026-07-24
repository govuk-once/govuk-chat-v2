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
