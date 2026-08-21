import json
import os
from pathlib import Path

import pytest
from click.testing import CliRunner

from agentcore_cli_wrapper import cli

RUNTIME_NAME = "ExampleAgent"
MANIFEST = {"runtimes": [{"name": RUNTIME_NAME}]}
LOCAL_RUN_COMMAND = [
    "pnpm",
    "exec",
    "agentcore",
    "dev",
    "--runtime",
    RUNTIME_NAME,
    "--skip-deploy",
]


def enter_agent_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agentcore_dir = tmp_path / "agentcore"
    agentcore_dir.mkdir()
    (agentcore_dir / "agentcore.json").write_text(json.dumps(MANIFEST))
    monkeypatch.chdir(tmp_path)


def stub_agentcore_cli(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    # os.execvp would replace the test process, so record what it was handed.
    # Generating the agent's configuration is covered in test_configure.py.
    commands: list[list[str]] = []
    monkeypatch.setattr(cli, "prepare_agent_configuration", lambda *_: None)
    monkeypatch.setattr(os, "execvp", lambda _file, command: commands.append(command))
    return commands


class TestAgentCoreCommand:
    def test_runs_the_agent_locally_without_deploying(self) -> None:
        assert cli.agentcore_command(RUNTIME_NAME, []) == LOCAL_RUN_COMMAND


class TestMain:
    def test_runs_the_agent_in_the_current_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enter_agent_dir(tmp_path, monkeypatch)
        commands = stub_agentcore_cli(monkeypatch)

        result = CliRunner().invoke(cli.main)

        assert result.exit_code == 0
        assert commands == [LOCAL_RUN_COMMAND]

    def test_forwards_its_arguments_to_the_agentcore_cli(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enter_agent_dir(tmp_path, monkeypatch)
        commands = stub_agentcore_cli(monkeypatch)

        CliRunner().invoke(cli.main, ["--port", "9000", "a prompt"])

        assert commands[0][len(LOCAL_RUN_COMMAND) :] == ["--port", "9000", "a prompt"]

    def test_reports_configuration_errors_without_a_traceback(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)

        result = CliRunner().invoke(cli.main)

        assert result.exit_code != 0
        assert "has no manifest" in result.output
