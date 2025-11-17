import json
from fastapi.testclient import TestClient

from chat_api.main import app
from chat_assistants.anthropic import UserInput, AssistantResponseDelta

client = TestClient(app)


def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}


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
