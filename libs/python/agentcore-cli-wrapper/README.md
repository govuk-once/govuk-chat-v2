# AgentCore CLI wrapper

Runs an agent from `services/` on your own machine and opens the AgentCore
Inspector against it. It wraps the `dev` command of the `@aws/agentcore` CLI.

It is a wrapper rather than a direct call because `agentcore dev` deploys AWS
resources before starting the dev server unless you pass `--skip-deploy`, and
CDK has to stay the only thing that deploys from this repository. Every run
passes that flag, and `dev` is the only subcommand the wrapper runs. Don't use
the CLI's own `deploy` or `import` commands here.

## Add a new agent

1. Write `services/<agent>/agentcore/agentcore.json`, following an existing
   agent's manifest.
2. Create the agent's CDK stack, name it `<RuntimeName>Stack` to match the
   runtime in the manifest, and instantiate it in `cdk/bin/app.ts`. The wrapper
   reads four of its outputs: `AgentRuntimeArn`, `AgentRuntimeRoleArn`,
   `ShortTermMemoryId` and `ShortTermMemoryArn`.
3. Add `services/<agent>/scripts/cdk-deploy.sh`, following an existing agent's.
   The shared `scripts/dev-cdk-deploy.sh` records the outputs to
   `cdk/cdk-outputs/<RuntimeName>Stack.json`.
4. Symlink `scripts/shared/agentcore-inspector.sh` into the agent's `scripts/`.
5. Deploy the stack, then run the script.

## Prerequisites

- `source scripts/dev-prepare.zsh` from the repository root, for dependencies
  and AWS credentials. Agents call real AWS services (models, memory) even when
  they run locally.
- Deploy the agent's stack with its `scripts/cdk-deploy.sh`. The deploy records
  the stack outputs the wrapper reads, so run it before your first local run,
  and again after switching `ENVIRONMENT`.

## Usage

The wrapper takes the agent from the working directory, so run it from the
agent's own directory rather than the repository root:

```
cd services/agui-agent
./scripts/agentcore-inspector.sh
```

That starts the agent as a local process and opens the Inspector in a browser,
where you can chat with it and read its traces and resources.

Arguments pass straight through to `agentcore dev`, so `--port`,
`--no-browser`, `--logs` and a prompt all work.

### When the Inspector's chat pane stays empty

The Inspector renders a reply only if it recognises the stream, which in
practice means AG-UI events. The chat pane shows nothing for example-agent,
which streams this repository's own event format. The agent still runs, and
the traces and resources views still work.

To read a reply from an agent like that, run the dev server in one terminal and
prompt it from a second:

```
./scripts/agentcore-inspector.sh --logs         # terminal 1
./scripts/agentcore-inspector.sh "Hello agent"  # terminal 2
```

`--logs` runs the dev server in the terminal rather than opening the browser
UI. The agent is only reachable on port 8080 in that mode, which is where the
prompt goes. The second terminal prints the raw event stream.

## Why this is fragile

The wrapper writes the AgentCore CLI's own local configuration, and AWS doesn't
document that format. It can change in any release, and we have no automated
check for it, because the only description of the shape lives inside the CLI
package.

So when a run fails in a way that looks like the CLI can't find the agent's AWS
resources, check whether the files below still match what the CLI expects. All
three are gitignored, and every run rewrites them from
`cdk/cdk-outputs/<RuntimeName>Stack.json`:

- `services/<agent>/agentcore/aws-targets.json`, the account and region
- `services/<agent>/agentcore/.cli/deployed-state.json`, naming the runtime and
  memory that the CLI resolves `--runtime` against
- `services/<agent>/agentcore/.env.local`, setting `BEDROCK_AGENTCORE_MEMORY_ID`

One thing that looks broken but isn't: under `--logs`, `watchfiles` reports
`1 change detected` two or three times a second, forever. The CLI writes the
dev server's log inside the directory uvicorn watches, so every line the server
logs is itself a change. The server is not reloading.

## Development

Run the checks CI runs with:

```
./scripts/dev-checks.sh
```
