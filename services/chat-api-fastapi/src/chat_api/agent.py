import json
import os
import uuid
from typing import assert_never

import boto3
from agent_runtime_types import (
    AgentStreamEventModel,
    ContentDeltaEvent,
    ErrorEvent,
    StreamEndEvent,
    StreamStartEvent,
)


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


def stop_agent_runtime_session(runtime_session_id: str) -> dict:
    client = boto3.client("bedrock-agentcore")
    return client.stop_runtime_session(
        agentRuntimeArn=os.environ["AGENT_RUNTIME_ARN"],
        runtimeSessionId=runtime_session_id,
        qualifier="DEFAULT",
    )


def parse_agent_response_stream(response: dict):
    # Using a small chunk_size here because the LLM returns quite small chunks
    # of text. iter_lines will wait until the chunk has been filled before
    # returning it, so a smaller number means you get chunks back more frequently.
    for line in response["response"].iter_lines(chunk_size=10):
        line = line.decode("utf-8")
        if line.startswith("data: "):
            raw_data = line[6:]  # strip "data: " from the start of the line

            try:
                data = AgentStreamEventModel.model_validate_json(raw_data).root

                match data:
                    case ErrorEvent():
                        # TODO: Log the error in Sentry
                        yield {"data": data.model_dump_json()}
                    case StreamStartEvent() | ContentDeltaEvent() | StreamEndEvent():
                        yield {"data": data.model_dump_json()}
                    case _ as unreachable:
                        assert_never(unreachable)
            except Exception:
                # TODO: Log the error in Sentry
                error = ErrorEvent(type="error", error_type="agent_error")
                yield {"data": error.model_dump_json()}
