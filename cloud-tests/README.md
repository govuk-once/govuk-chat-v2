# Cloud tests

Tests of the whole system against a deployed environment. Unit tests in each
package mock out AWS; these check that the deployed stacks work together,
including their wiring, IAM permissions and authentication.

The suite is deliberately small. It checks the protocol and persistence around
the agent's answers, not what the agent says, so differences between LLM runs
don't make it flaky.

## Development

Run the checks CI runs with:

```
./scripts/dev-checks.sh
```

These don't run the tests, as every test here needs AWS.
