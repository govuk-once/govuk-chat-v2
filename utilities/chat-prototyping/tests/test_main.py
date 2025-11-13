import pytest

from chat_prototyping.main import generate_response
from chat_assistants.anthropic import (
    AssistantResponseDelta,
    AssistantResponseFinal,
    UserInput,
    UserHistoryItem,
    AssistantHistoryItem,
)


@pytest.mark.asyncio
async def test_generate_response_yields_deltas(mocker):
    history = [
        UserHistoryItem("How are you?"),
        AssistantHistoryItem("I'm well"),
    ]
    user_input = UserInput("What's the weather like?", history)
    tokens = ("It's ", "sunny ", "today")

    async def mock_data():
        yield AssistantResponseDelta(delta=tokens[0])
        yield AssistantResponseDelta(delta=tokens[1])
        yield AssistantResponseDelta(delta=tokens[2])
        yield AssistantResponseFinal(message="".join(tokens))

    assistant_method = mocker.patch(
        "chat_prototyping.main.sonnet_streaming_assistant",
        side_effect=lambda _: mock_data(),
    )

    expected_history = [
        {"role": "user", "content": "How are you?"},
        {"role": "assistant", "content": "I'm well"},
    ]

    deltas = []
    async for delta in generate_response(user_input.message, expected_history):
        deltas.append(delta)

    first_token, second_token, _ = tokens
    assert deltas == [
        first_token,
        "".join((first_token, second_token)),
        "".join(tokens),
    ]

    assistant_method.assert_called_with(user_input)
