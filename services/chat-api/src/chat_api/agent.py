import json
import os
import uuid

import boto3


def invoke_agent(prompt: str) -> dict:
    client = boto3.client("bedrock-agentcore")
    payload = json.dumps({"prompt": prompt}).encode()
    return client.invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENT_RUNTIME_ARN"],
        runtimeSessionId=str(uuid.uuid4()),
        payload=payload,
        qualifier="DEFAULT",
    )

def parse_agent_response_stream(response: dict):
    # Using a small chunk_size here because the LLM returns quite small chunks
    # of text. iter_lines will wait until the chunk has been filled before
    # returning it, so a smaller number means you get chunks back more frequently.
    for line in response["response"].iter_lines(chunk_size=10):
        if line:
            line = line.decode("utf-8")
            if line.startswith("data: "):
                yield {"data": line[6:]}
