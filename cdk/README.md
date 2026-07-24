# CDK Infrastructure as Code

This is to contain the [CDK stacks](https://docs.aws.amazon.com/cdk/v2/guide/stacks.html) to deploy the infrastructure and to use as part of a cloud native developer workflow.

## Running

Individual projects that are deployed via CDK have a `scripts/cdk-deploy.sh`.

You can run other aspects of CDK with `pnpm exec cdk` from this directory.

## Development

```
./scripts/dev-checks.sh
```

Will perform linting, formatting, type checking and execute tests.
