from unittest.mock import MagicMock
from chat_api.agent import invoke_agent_runtime, parse_agent_response_stream
import json


def test_invoke_agent_runtime(mocker):
    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {"response": MagicMock()}
    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    invoke_agent_runtime("test prompt", "session_123", "user_123")

    mock_client.invoke_agent_runtime.assert_called_once_with(
        agentRuntimeArn="test-arn",
        runtimeSessionId="session_123",
        payload=b'{"prompt": "test prompt", "end_user_id": "user_123"}',
        qualifier="DEFAULT",
    )


def test_invoke_agent_uses_default_session_and_user_id(mocker):
    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {"response": MagicMock()}
    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})
    mocker.patch("chat_api.agent.uuid.uuid4", return_value="mock-uuid")

    invoke_agent_runtime("test prompt")

    mock_client.invoke_agent_runtime.assert_called_once_with(
        agentRuntimeArn="test-arn",
        runtimeSessionId="mock-uuid",
        payload=b'{"prompt": "test prompt", "end_user_id": null}',
        qualifier="DEFAULT",
    )


def test_parse_agent_response_stream_yields_content_for_data_messages():
    tokens = "This is an SSE stream".split(" ")

    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            for token in tokens:
                payload = json.dumps({"type": "content_delta", "delta": token})
                yield f"data: {payload}".encode("utf-8")

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [
        {
            "data": json.dumps(
                {"type": "content_delta", "delta": token},
                separators=(",", ":"),  # Remove spaces with the `separators` parameter
            )
        }
        for token in tokens
    ]


def test_parse_agent_response_stream_ignores_empty_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b""
            yield (
                b"data: "
                + json.dumps({"type": "content_delta", "delta": "hello"}).encode()
            )

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": '{"type":"content_delta","delta":"hello"}'}]


def test_parse_agent_response_stream_ignores_non_data_prefixed_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b"event: something"
            yield (
                b"data: "
                + json.dumps({"type": "content_delta", "delta": "hello"}).encode()
            )

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": '{"type":"content_delta","delta":"hello"}'}]
