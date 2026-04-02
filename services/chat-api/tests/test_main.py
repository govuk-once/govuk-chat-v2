import json
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from chat_api.main import app
from chat_assistants.anthropic import UserInput, AssistantResponseDelta

client = TestClient(app)


def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}


def test_stream(mocker):
    tokens = "This is an SSE stream".split(" ")
    sleep_mock = mocker.patch("asyncio.sleep", new_callable=AsyncMock)

    response = client.get("/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.text.splitlines()
    for index, token in enumerate(tokens):
        starting_index = index * 3
        assert body[starting_index] == "event: delta"
        content = {"type": "delta", "content": token}
        assert body[starting_index + 1] == f"data: {json.dumps(content)}"

    assert sleep_mock.call_count == len(tokens)


def test_agent_stream(mocker):
    tokens = "This is an SSE stream".split(" ")

    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            for token in tokens:
                yield f"data: {token}".encode("utf-8")

    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {
        "response": MockStreamingBody(),
        "contentType": "text/event-stream",
    }

    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    response = client.get("/agent-stream")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = [line for line in response.text.splitlines() if line]
    for index, token in enumerate(tokens):
        assert body[index] == f"data: {token}"


def test_agent_stream_error(mocker):
    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.side_effect = Exception("Bedrock error")

    mocker.patch("boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    response = client.get("/agent-stream")

    assert response.status_code == 500
    assert response.json() == {"error": "Bedrock error"}


def test_sonnet_streaming_assistant_response(mocker):
    tokens = ("I'm very ", "well. Thank ", "you.")

    async def mock_data():
        yield AssistantResponseDelta(delta=tokens[0])
        yield AssistantResponseDelta(delta=tokens[1])
        yield AssistantResponseDelta(delta=tokens[2])

    assistant_method = mocker.patch(
        "chat_api.main.anthropic_assistant.sonnet_streaming_assistant",
        side_effect=lambda _: mock_data(),
    )

    response = client.post(
        "/sonnet-streaming/assistant-response",
        json={"message": "Hi, how are you?"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.text.splitlines()
    for index, token in enumerate(tokens):
        starting_index = index * 3
        assert body[starting_index] == "event: delta"
        content = {"type": "delta", "content": token}
        assert body[starting_index + 1] == f"data: {json.dumps(content)}"

    assistant_method.assert_called_with(UserInput("Hi, how are you?"))


def test_sonnet_streaming_assistant_response_blank_message():
    response = client.post(
        "/sonnet-streaming/assistant-response",
        json={"message": " "},
    )
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    # don't know how to get rid of the ugly "Value error, " prefix
    assert data["detail"][0]["msg"] == "Value error, Message must not be empty"
