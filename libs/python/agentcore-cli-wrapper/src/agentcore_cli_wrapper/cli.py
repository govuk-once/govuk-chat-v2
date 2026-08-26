import os
from collections.abc import Sequence
from pathlib import Path

import click

from agentcore_cli_wrapper.configure import (
    ConfigError,
    prepare_agent_configuration,
    read_manifest,
    runtime_name,
)


def agentcore_command(runtime: str, arguments: Sequence[str]) -> list[str]:
    # --skip-deploy because CDK owns all AWS resources
    return [
        "pnpm",
        "exec",
        "agentcore",
        "dev",
        "--runtime",
        runtime,
        "--skip-deploy",
        *arguments,
    ]


@click.command(context_settings={"ignore_unknown_options": True})
@click.argument("arguments", nargs=-1, type=click.UNPROCESSED)
def main(arguments: tuple[str, ...]) -> None:
    """Run the agent in the current directory and open the Inspector.

    Any arguments are passed on to the AgentCore CLI, such as --port,
    --no-browser, --logs, or a prompt for an already-running local agent.
    """
    service_dir = Path.cwd()

    try:
        manifest = read_manifest(service_dir)
        prepare_agent_configuration(service_dir, manifest)
    except ConfigError as error:
        raise click.ClickException(str(error)) from error

    command = agentcore_command(runtime_name(manifest), arguments)
    os.execvp(command[0], command)
