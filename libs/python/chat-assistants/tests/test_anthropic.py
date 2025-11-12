import pytest
from unittest.mock import AsyncMock, MagicMock

from chat_assistants.anthropic import (
    AssistantResponseDelta,
    AssistantResponseFinal,
    sonnet_streaming_assistant,
    UserInput,
)


def mock_messages_stream(deltas: list[str]):
    text_stream = MagicMock()
    text_stream.__aiter__.return_value = iter(deltas)

    mock_stream = MagicMock(
        text_stream=text_stream,
        get_final_text=AsyncMock(return_value="".join(deltas)),
    )

    return MagicMock(__aenter__=AsyncMock(return_value=mock_stream))


@pytest.mark.asyncio
async def test_sonnet_streaming_assistant(mocker):
    mock_messages = MagicMock(
        stream=MagicMock(return_value=mock_messages_stream(["I'm ", "fine ", "thanks"]))
    )
    mock_client = MagicMock(messages=mock_messages)
    mocker.patch(
        "chat_assistants.anthropic.AsyncAnthropicBedrock", return_value=mock_client
    )

    user_input = UserInput(message="How are you?")
    events = []

    async for event in sonnet_streaming_assistant(user_input):
        events.append(event)

    assert events == [
        AssistantResponseDelta(delta="I'm "),
        AssistantResponseDelta(delta="fine "),
        AssistantResponseDelta(delta="thanks"),
        AssistantResponseFinal(message="I'm fine thanks"),
    ]

    mock_messages.stream.assert_called_once()
    called_messages = mock_messages.stream.call_args.kwargs["messages"]
    assert called_messages == [{"role": "user", "content": user_input.message}]
