import pytest
from unittest.mock import MagicMock
from chat_api.agent import invoke_agent, parse_agent_response_stream
import json


def test_invoke_agent(mocker):
    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {"response": MagicMock()}
    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    invoke_agent("test prompt")

    mock_client.invoke_agent_runtime.assert_called_once_with(
        agentRuntimeArn="test-arn",
        runtimeSessionId=mocker.ANY,
        payload=b'{"prompt": "test prompt"}',
        qualifier="DEFAULT",
    )


def test_parse_agent_response_stream_yields_content_for_data_messages():
    tokens = "This is an SSE stream".split(" ")

    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            for token in tokens:
                payload = json.dumps({"type": "data", "content": token})
                yield f"data: {payload}".encode("utf-8")

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": token} for token in tokens]


def test_parse_agent_response_stream_raises_error_for_unknown_message_types():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b"data: " + json.dumps({"type": "unknown", "content": "x"}).encode()

    with pytest.raises(ValueError, match="Unexpected message type: unknown"):
        list(parse_agent_response_stream({"response": MockStreamingBody()}))


def test_parse_agent_response_stream_ignores_empty_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b""
            yield b"data: " + json.dumps({"type": "data", "content": "hello"}).encode()

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": "hello"}]


def test_parse_agent_response_stream_ignores_non_data_prefixed_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b"event: something"
            yield b"data: " + json.dumps({"type": "data", "content": "hello"}).encode()

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": "hello"}]
