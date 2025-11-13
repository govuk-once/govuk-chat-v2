import pytest
from unittest.mock import AsyncMock, MagicMock

from chat_assistants.anthropic import (
    AssistantResponseDelta,
    AssistantResponseFinal,
    sonnet_streaming_assistant,
    UserInput,
    UserHistoryItem,
    AssistantHistoryItem,
)


def mock_client_messages_stream(deltas: list[str]):
    text_stream = MagicMock()
    text_stream.__aiter__.return_value = iter(deltas)

    mock_stream_object = MagicMock(
        text_stream=text_stream,
        get_final_text=AsyncMock(return_value="".join(deltas)),
    )

    mock_stream = MagicMock(__aenter__=AsyncMock(return_value=mock_stream_object))
    mock_messages = MagicMock(stream=MagicMock(return_value=mock_stream))
    return MagicMock(messages=mock_messages)


@pytest.mark.asyncio
async def test_sonnet_streaming_assistant(mocker):
    mock_client = mock_client_messages_stream(["I'm ", "fine ", "thanks"])
    mocker.patch(
        "chat_assistants.anthropic.AsyncAnthropicBedrock", return_value=mock_client
    )

    user_input = UserInput("How are you?")
    events = [event async for event in sonnet_streaming_assistant(user_input)]

    assert events == [
        AssistantResponseDelta("I'm "),
        AssistantResponseDelta("fine "),
        AssistantResponseDelta("thanks"),
        AssistantResponseFinal("I'm fine thanks"),
    ]

    mock_client.messages.stream.assert_called_once()
    called_messages = mock_client.messages.stream.call_args.kwargs["messages"]
    assert called_messages == [{"role": "user", "content": user_input.message}]


@pytest.mark.asyncio
async def test_sonnet_streaming_assistant_with_history(mocker):
    mock_client = mock_client_messages_stream(["No"])
    mocker.patch(
        "chat_assistants.anthropic.AsyncAnthropicBedrock", return_value=mock_client
    )

    history = [
        UserHistoryItem("How are you?"),
        AssistantHistoryItem("I'm fine thanks"),
    ]

    user_input = UserInput("Any news?", history)
    events = [event async for event in sonnet_streaming_assistant(user_input)]

    assert events == [AssistantResponseDelta("No"), AssistantResponseFinal("No")]

    mock_client.messages.stream.assert_called_once()
    called_messages = mock_client.messages.stream.call_args.kwargs["messages"]

    assert called_messages == [
        {"role": "user", "content": "How are you?"},
        {"role": "assistant", "content": "I'm fine thanks"},
        {"role": "user", "content": "Any news?"},
    ]
