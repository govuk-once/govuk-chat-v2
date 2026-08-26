import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from agentcore_cli_wrapper import configure

ACCOUNT = "123456789012"
REGION = "eu-west-2"
RUNTIME_ID = "example_agent-abc123"
RUNTIME_ARN = f"arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/{RUNTIME_ID}"
ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/example-agent-runtime-role"
MEMORY_ID = "example_agent_memory-abc123"
MEMORY_ARN = f"arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:memory/{MEMORY_ID}"

STACK_OUTPUTS = {
    "AgentRuntimeArn": RUNTIME_ARN,
    "AgentRuntimeRoleArn": ROLE_ARN,
    "ShortTermMemoryId": MEMORY_ID,
    "ShortTermMemoryArn": MEMORY_ARN,
}
MANIFEST = {
    "runtimes": [{"name": "ExampleAgent"}],
    "memories": [{"name": "ExampleAgentMemory", "eventExpiryDuration": 90}],
}


def make_service_dir(
    tmp_path: Path,
    outputs: Mapping[str, str] | None = None,
    manifest: Mapping[str, Any] | None = None,
) -> Path:
    repo_dir = tmp_path / "repo"
    service_dir = repo_dir / "services/example-agent"
    agentcore_dir = service_dir / "agentcore"
    agentcore_dir.mkdir(parents=True)
    (repo_dir / ".venv").mkdir()
    if outputs is not None:
        outputs_dir = repo_dir / "cdk/cdk-outputs"
        outputs_dir.mkdir(parents=True)
        (outputs_dir / "ExampleAgentStack.json").write_text(
            json.dumps({"chaecramb-govuk-chat-ExampleAgentStack": outputs})
        )
    if manifest is not None:
        (agentcore_dir / "agentcore.json").write_text(json.dumps(manifest))
    return service_dir


class TestReadManifest:
    def test_returns_the_parsed_manifest(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path, manifest=MANIFEST)

        assert configure.read_manifest(service_dir) == MANIFEST

    def test_missing_manifest_names_the_expected_path(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path)

        with pytest.raises(
            configure.ConfigError, match="example-agent has no manifest"
        ):
            configure.read_manifest(service_dir)


class TestPrepareAgentConfiguration:
    def test_writes_the_configuration_the_agentcore_cli_reads(
        self, tmp_path: Path
    ) -> None:
        service_dir = make_service_dir(tmp_path, STACK_OUTPUTS)

        configure.prepare_agent_configuration(service_dir, MANIFEST)

        assert (service_dir / "agentcore/.env.local").read_text() == (
            f"BEDROCK_AGENTCORE_MEMORY_ID={MEMORY_ID}\n"
        )
        assert (service_dir / "agentcore/.cli/deployed-state.json").is_file()
        assert (service_dir / ".venv").is_symlink()

    def test_can_run_repeatedly(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path, STACK_OUTPUTS)

        configure.prepare_agent_configuration(service_dir, MANIFEST)
        configure.prepare_agent_configuration(service_dir, MANIFEST)

        assert os.readlink(service_dir / ".venv") == "../../.venv"


def test_runtime_name_returns_the_name_from_the_manifest() -> None:
    assert configure.runtime_name(MANIFEST) == "ExampleAgent"


def test_memory_name_returns_the_name_from_the_manifest() -> None:
    assert configure.memory_name(MANIFEST) == "ExampleAgentMemory"


class TestReadStackOutputs:
    def test_returns_the_deployed_stack_outputs(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path, STACK_OUTPUTS)

        assert configure.read_stack_outputs(service_dir, MANIFEST) == STACK_OUTPUTS

    def test_missing_outputs_says_to_deploy_first(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path)

        with pytest.raises(configure.ConfigError, match="No CDK outputs found"):
            configure.read_stack_outputs(service_dir, MANIFEST)


class TestWriteDeployedState:
    def test_takes_the_account_and_region_from_the_runtime_arn(
        self, tmp_path: Path
    ) -> None:
        service_dir = make_service_dir(tmp_path)

        configure.write_deployed_state(service_dir, MANIFEST, STACK_OUTPUTS)

        assert json.loads((service_dir / "agentcore/aws-targets.json").read_text()) == [
            {"name": "default", "account": ACCOUNT, "region": REGION}
        ]

    def test_records_the_deployed_runtime_and_memory(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path)

        configure.write_deployed_state(service_dir, MANIFEST, STACK_OUTPUTS)

        assert json.loads(
            (service_dir / "agentcore/.cli/deployed-state.json").read_text()
        ) == {
            "targets": {
                "default": {
                    "resources": {
                        "runtimes": {
                            "ExampleAgent": {
                                "runtimeId": RUNTIME_ID,
                                "runtimeArn": RUNTIME_ARN,
                                "roleArn": ROLE_ARN,
                            }
                        },
                        "memories": {
                            "ExampleAgentMemory": {
                                "memoryId": MEMORY_ID,
                                "memoryArn": MEMORY_ARN,
                            }
                        },
                    }
                }
            }
        }


class TestWriteJsonFile:
    def test_creates_missing_parent_directories(self, tmp_path: Path) -> None:
        path = tmp_path / "agentcore/.cli/deployed-state.json"

        configure.write_json_file(path, {"targets": {}})

        assert json.loads(path.read_text()) == {"targets": {}}

    def test_ends_the_file_with_a_newline(self, tmp_path: Path) -> None:
        path = tmp_path / "aws-targets.json"

        configure.write_json_file(path, {"targets": {}})

        assert path.read_text().endswith("\n")


class TestEnsureVenvLink:
    def test_links_the_agent_to_the_workspace_venv(self, tmp_path: Path) -> None:
        service_dir = make_service_dir(tmp_path)

        configure.ensure_venv_link(service_dir)

        assert os.readlink(service_dir / ".venv") == "../../.venv"

    def test_missing_venv_says_to_install_dependencies(self, tmp_path: Path) -> None:
        service_dir = tmp_path / "repo/services/example-agent"
        service_dir.mkdir(parents=True)

        with pytest.raises(configure.ConfigError, match="No virtual environment found"):
            configure.ensure_venv_link(service_dir)
