# Chat API Serverless

Exploring the idea of Chat API running on AWS Lambda

## Usage

This is deployed via CDK, after sourcing the dev-prepare.zsh script (root directory):

```
$ scripts/cdk-deploy.sh
$ export LAMBDA_URL=(url from ChatApiServerlessStack.LambdaUrl)
$ awscurl --service lambda $LAMBDA_URL
```
