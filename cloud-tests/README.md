# Cloud tests

Tests of the whole system against a deployed environment. Unit tests in each
package mock out AWS; these check that the deployed stacks work together,
including their wiring, IAM permissions and authentication.

The suite is deliberately small. It checks the protocol and persistence around
the agent's answers, not what the agent says, so differences between LLM runs
don't make it flaky.

## Running the tests

The tests run against whatever is already deployed; they don't deploy
anything. To test a change, deploy it to your own stacks first with the
services' `scripts/cdk-deploy.sh`, as you would to try it by hand.

With AWS credentials from `source scripts/refresh-dev-aws-credentials.zsh`:

```
cloud-tests/scripts/test.sh                          # your own $USER stacks
ENVIRONMENT=test-pr-123 cloud-tests/scripts/test.sh  # another environment
```

The tests find the environment's stacks by the `Environment` and
`ServiceName` tags CDK gives them, and read the URLs and Cognito IDs they need
from the stacks' outputs.

`scripts/test-api.sh` runs only the API tests. Both scripts pass their
arguments to the test runner, for example a test name filter with `-t`.

## Development

Run the checks CI runs with:

```
./scripts/dev-checks.sh
```

These don't run the tests, as every test here needs AWS.
