import httpx
import pytest
import respx
import re

from chat_assistants.anthropic import UserInput, sonnet_non_streaming_assistant

BEDROCK_INVOKE_REGEX = re.compile(
    r"https://bedrock-runtime\..*\.amazonaws\.com/model/.*anthropic\.claude.*?/invoke"
)


@pytest.fixture(autouse=True)
def mock_aws_env(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "fake")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "fake")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")


def mock_anthropic_messages_response(content: list):
    return {
        "content": content,
        "id": "msg_013Zva2CMHLNnXjNJJKqJ2EF",
        "model": "claude-sonnet-4-5-20250929",
        "role": "assistant",
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "type": "message",
        "usage": {"input_tokens": 2095, "output_tokens": 503},
    }


def mock_anthropic_messages_text_block_response(message: str):
    content = [
        {
            "citations": None,
            "text": message,
            "type": "text",
        }
    ]
    return mock_anthropic_messages_response(content)


def mock_anthropic_messages_create(respx_mock: respx.MockRouter, response: dict):
    respx_mock.post(url__regex=BEDROCK_INVOKE_REGEX).mock(
        return_value=httpx.Response(200, json=response),
    )


@pytest.mark.asyncio
@respx.mock(assert_all_mocked=True)
async def test_sonnet_non_streaming_assistant(respx_mock):
    mock_anthropic_messages_create(
        respx_mock, mock_anthropic_messages_text_block_response("I'm fine thanks")
    )
    user_input = UserInput(message="How are you?")
    assistant_response = await sonnet_non_streaming_assistant(user_input)
    assert assistant_response.message == "I'm fine thanks"
