#!/usr/bin/env -S uv run --script

from pathlib import Path
from botocore.exceptions import (
    NoCredentialsError,
    PartialCredentialsError,
    ClientError,
)
import boto3
import os
import re
import subprocess
import sys
import uuid
import yaml

project_dir = Path(__file__).resolve().parent.parent

print("== Creating .bedrock_agentcore.yaml ==")

sts_client = boto3.client("sts")
try:
    account_id = sts_client.get_caller_identity()["Account"]
except (NoCredentialsError, PartialCredentialsError):
    sys.exit("No AWS credentials found, exiting!")

print("== Checking for AWS cloudformation resources ==")
local_only = False
local_stack_name = "ExampleAgentStack"
deployed_agent_name: str | None = None
deployed_agent_arn: str | None = None

# fetch remote stack name using local stack name
try:
    output = subprocess.check_output(
        ["cdk", "list", local_stack_name], text=True, cwd=project_dir / "../../cdk"
    )

    pattern = re.compile(rf"^{re.escape(local_stack_name)}\s*\((.*?)\)$", re.MULTILINE)
    match = pattern.search(output)

    stack_name = match.group(1) if match else None

except subprocess.CalledProcessError as e:
    sys.exit(f"Failed to run cdk: {e}")

# fetch stack output variables
if stack_name:
    cf_client = boto3.client("cloudformation")
    try:
        stack = cf_client.describe_stacks(StackName=stack_name)["Stacks"][0]
        outputs_dict = {
            item["OutputKey"]: item["OutputValue"] for item in stack["Outputs"]
        }

        deployed_agent_name = outputs_dict["AgentRuntimeName"]
        deployed_agent_arn = outputs_dict["AgentRuntimeArn"]
    except KeyError as e:
        print(f"Stack outputs not identified: {e}")
        local_only = True

    except ClientError as e:
        print(f"Stack {stack_name} not found on current AWS account: {e}")
        local_only = True

# output whether we're connecting to the cloud resources
if local_only:
    print("Failed to identify deployed resources, configuring for local only")
else:
    print(f"Configuring for AWS resources from stack: {stack_name}")

agent_name = deployed_agent_name or "example_agent"

config = {
    "default_agent": agent_name,
    "is_agentcore_create_with_iac": True,
    "agents": {
        agent_name: {
            "name": agent_name,
            "language": "python",
            "entrypoint": str(project_dir / "src/example_agent/main.py"),
            "deployment_type": "direct_code_deploy",
            "aws": {
                "account": account_id,
                "region": os.environ["AWS_REGION"],
            },
            "bedrock_agentcore": {
                "agent_arn": deployed_agent_arn,
                "agent_session_id": str(uuid.uuid4()),
            },
            "is_generated_by_agentcore_create": False,
        }
    },
}

with open(project_dir / ".bedrock_agentcore.yaml", "w") as file:
    # Note: We did originally output a warning at the top of the YAML file
    # to suggest people don't edit it. However the agentcore CLI tool rewrites
    # file when it's used to invoke on actual AWS, removing all comments.
    yaml.dump(config, file, sort_keys=False, default_flow_style=False)
    print("Created " + file.name)
