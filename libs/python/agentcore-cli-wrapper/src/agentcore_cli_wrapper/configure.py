import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

VENV_TARGET = "../../.venv"


class ConfigError(Exception):
    pass


def read_manifest(service_dir: Path) -> dict[str, Any]:
    manifest_path = service_dir / "agentcore/agentcore.json"
    if not manifest_path.is_file():
        raise ConfigError(f"{service_dir.name} has no manifest at {manifest_path}")
    return json.loads(manifest_path.read_text())


def prepare_agent_configuration(
    service_dir: Path,
    manifest: Mapping[str, Any],
) -> None:
    outputs = read_stack_outputs(service_dir, manifest)
    memory_id = outputs["ShortTermMemoryId"]
    write_deployed_state(service_dir, manifest, outputs)

    (service_dir / "agentcore/.env.local").write_text(
        f"BEDROCK_AGENTCORE_MEMORY_ID={memory_id}\n"
    )
    ensure_venv_link(service_dir)


def runtime_name(manifest: Mapping[str, Any]) -> str:
    return manifest["runtimes"][0]["name"]


def memory_name(manifest: Mapping[str, Any]) -> str:
    return manifest["memories"][0]["name"]


def read_stack_outputs(
    service_dir: Path,
    manifest: Mapping[str, Any],
) -> dict[str, str]:
    stack_name = f"{runtime_name(manifest)}Stack"
    outputs_path = service_dir.parents[1] / f"cdk/cdk-outputs/{stack_name}.json"
    if not outputs_path.is_file():
        raise ConfigError(
            f"No CDK outputs found at {outputs_path}. Deploy the agent's CDK "
            "stack, recording its outputs to that path."
        )

    stacks = json.loads(outputs_path.read_text())
    return next(iter(stacks.values()))


def write_deployed_state(
    service_dir: Path,
    manifest: Mapping[str, Any],
    outputs: Mapping[str, str],
) -> None:
    runtime_arn = outputs["AgentRuntimeArn"]
    _, _, _, region, account, resource = runtime_arn.split(":", maxsplit=5)

    write_json_file(
        service_dir / "agentcore/aws-targets.json",
        [{"name": "default", "account": account, "region": region}],
    )
    write_json_file(
        service_dir / "agentcore/.cli/deployed-state.json",
        {
            "targets": {
                "default": {
                    "resources": {
                        "runtimes": {
                            runtime_name(manifest): {
                                "runtimeId": resource.removeprefix("runtime/"),
                                "runtimeArn": runtime_arn,
                                "roleArn": outputs["AgentRuntimeRoleArn"],
                            }
                        },
                        "memories": {
                            memory_name(manifest): {
                                "memoryId": outputs["ShortTermMemoryId"],
                                "memoryArn": outputs["ShortTermMemoryArn"],
                            }
                        },
                    }
                }
            }
        },
    )


def write_json_file(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(value, indent=2)}\n")


# The AgentCore CLI runs a local agent with the Python it finds in .venv
# inside the service directory; point that at the uv workspace's shared
# venv at the repository root.
def ensure_venv_link(service_dir: Path) -> None:
    target = (service_dir / VENV_TARGET).resolve()
    if not target.is_dir():
        raise ConfigError(
            f"No virtual environment found at {target}. Install the "
            "repository's Python dependencies first."
        )

    service_venv = service_dir / ".venv"
    if not service_venv.is_symlink():
        service_venv.symlink_to(VENV_TARGET, target_is_directory=True)
