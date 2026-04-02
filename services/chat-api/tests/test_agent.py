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
                yield f"data: {token}".encode("utf-8")

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": token} for token in tokens]


def test_parse_agent_response_stream_ignores_non_data_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b"event: something"
            yield b"data: hello"

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": "hello"}]


def test_parse_agent_response_stream_ignores_empty_lines():
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield b""
            yield b"data: hello"

    result = list(parse_agent_response_stream({"response": MockStreamingBody()}))
    assert result == [{"data": "hello"}]
