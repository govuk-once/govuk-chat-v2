import pytest

from chat_prototyping.main import generate_response
from chat_assistants.anthropic import AssistantResponse, UserInput


@pytest.mark.asyncio
async def test_generate_response_returns_string(mocker):
    user_input = UserInput(message="What's the weather like?")
    assistant_response = AssistantResponse(message="It's sunny today")
    mock = mocker.AsyncMock(return_value=assistant_response)
    assistant_method = mocker.patch(
        "chat_prototyping.main.sonnet_non_streaming_assistant", mock
    )

    response = await generate_response(user_input.message)
    assert response == assistant_response.message
    assistant_method.assert_awaited_with(user_input)
