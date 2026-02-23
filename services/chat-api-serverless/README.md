# Chat API Serverless

Exploring the idea of Chat API running on AWS Lambda

## Usage

Change directory to the [cdk directory](../../cdk/): `cd ../../cdk`

Then:

```
$ eval $(gds aws once-chat-development-admin -e)
$ cdk deploy ChatApiServerlessStack
$ export LAMBDA_URL=(url from ChatApiServerlessStack.LambdaUrl)
$ awscurl --service lambda $LAMBDA_URL
```
