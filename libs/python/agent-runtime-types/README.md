# Agent Runtime Types

Shared type definitions for the streaming protocol between agents running on AWS
Bedrock AgentCore Runtime and the services that consume them.

The events are Pydantic models discriminated on their `type` field.
`AgentStreamEventModel` parses an arbitrary event into the right one:

```python
from agent_runtime_types import AgentStreamEventModel

event = AgentStreamEventModel.model_validate_json(line).root
```

## Development

Run the checks CI runs with:

```
./scripts/dev-checks.sh
```

This package is types only, so it has no tests.
