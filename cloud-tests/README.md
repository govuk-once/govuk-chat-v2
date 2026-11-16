# Cloud tests

Tests of the whole system against a deployed environment. Unit tests in each
package mock out AWS; these check that the deployed stacks work together,
including their wiring, IAM permissions and authentication.

The suite is deliberately small. It checks the protocol and persistence around
the agent's answers, not what the agent says, so differences between LLM runs
don't make it flaky.

## When to add a cloud test

Cloud tests are a form of
[system testing](https://en.wikipedia.org/wiki/System_testing), testing, from
the perspective of a user interacting with the system, that the system can
operate as expected. They are slow to setup, slow to run, hard to debug why
they fail and they have real infrastructure costs; however they provide an
insight that unit tests alone don't cover: the integration of services with
real AWS components.

Due to this we should add them sparingly and carefully, they should:

- test numerous integrations at once, ideally following a user happy path,
  covering all the services/components in a key user journey
- test functionality that couldn't be tested in other ways
- cover critical user journeys that affect multiple services

Don't add one:

- for logic a unit test could cover, such as branches, validation and error
  handling — test it in its package
- to test that an AWS service works as documented — test how our code
  integrates with it
- to assert on non-deterministic AI output, since responses vary between runs
- for a variation on a journey that's already covered, such as more input
  permutations - unit tests' role is to explore each path of code
- if it depends on data or configuration the environment doesn't set up for
  itself

Cloud tests failing without an associated unit test may indicate a missing unit
test, consider adding them before additional cloud test checks.

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
