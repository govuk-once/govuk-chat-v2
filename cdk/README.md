# CDK Infrastructure as Code

This is to contain the [CDK stacks](https://docs.aws.amazon.com/cdk/v2/guide/stacks.html) to deploy the infrastructure and to use as part of a cloud native developer workflow.

## Running

At the time of writing we're not quite sure of how/when this code will be run exactly as part of the development workflow.

The current approach to execute the CDK to trigger a deployment is as follows:

```
# assume the role, you need to be on the VPN
$ eval $(gds aws once-chat-development-admin -e)
# go into CDK directory
$ cd cdk
# Run CDK commands
$ cdk deploy
```

This is, clearly, rather manual and should be improved.

## Development

```
./scripts/dev-checks.sh
```

Will perform linting, formatting, type checking and execute tests.
