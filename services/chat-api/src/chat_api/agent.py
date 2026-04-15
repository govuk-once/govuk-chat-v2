import json
import os
import uuid

import boto3


def invoke_agent_runtime(
    prompt: str, session_id: str | None = None, end_user_id: str | None = None
) -> dict:
    client = boto3.client("bedrock-agentcore")
    payload = json.dumps({"prompt": prompt, "end_user_id": end_user_id}).encode()
    return client.invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENT_RUNTIME_ARN"],
        runtimeSessionId=session_id or str(uuid.uuid4()),
        payload=payload,
        qualifier="DEFAULT",
    )


def parse_agent_response_stream(response: dict):
    # Using a small chunk_size here because the LLM returns quite small chunks
    # of text. iter_lines will wait until the chunk has been filled before
    # returning it, so a smaller number means you get chunks back more frequently.
    for line in response["response"].iter_lines(chunk_size=10):
        line = line.decode("utf-8")
        if line.startswith("data: "):
            data = json.loads(line[6:])  # strip "data: " from the start of the line
            message_type = data["type"]

            match message_type:
                case "data":
                    yield {"data": data["content"]}
                case _:
                    raise ValueError(f"Unexpected message type: {message_type}")
