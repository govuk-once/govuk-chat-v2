# Environment

Identifies which deployment of GOV.UK Chat a process is working with, so that
the code that deploys it and the code that tests it agree.

- `getEnvironment()` returns the environment name: `ENVIRONMENT` if set,
  otherwise `USER`, with anything other than letters, digits and hyphens
  removed. CDK tags every stack with it as `Environment`.
- `serviceMetadata` holds the service, team and repository names CDK tags every
  stack with.

## Usage

Add it as a workspace dependency:

```json
"dependencies": {
  "@govuk-chat-v2/environment": "workspace:*"
}
```

Then import it:

```ts
import { getEnvironment, serviceMetadata } from '@govuk-chat-v2/environment';
```

## Development

Run the checks CI runs with:

```
./scripts/dev-checks.sh
```
