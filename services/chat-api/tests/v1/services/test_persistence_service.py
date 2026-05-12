import pytest
import uuid
from chat_api.v1.services.persistence_service import (
    persist_message,
    name_conversation,
)
from chat_api.v1.data_models.messages import (
    ConversationUserMessage,
    ConversationAssistantMessage,
)
import json


@pytest.mark.asyncio
async def test_persist_message_assistant_message():
    conversation_assistant_message = ConversationAssistantMessage(
        message="Hello world",
        end_user_id="user-123",
        session_id="session-123",
        message_id="message-123",
        conversation_id="conversation-123",
        stop_reason="end_turn",
        status="complete",
    )

    result_id = await persist_message(conversation_assistant_message)

    assert result_id == "conversation-123"


@pytest.mark.asyncio
async def test_persist_message_user_message_generates_new_id_when_none_provided():
    conversation_user_message = ConversationUserMessage(
        message="Hello world",
        end_user_id="user-123",
        session_id="session-456",
        conversation_id=None,
    )

    result_id = await persist_message(conversation_user_message)

    assert isinstance(result_id, str)
    assert uuid.UUID(result_id)


@pytest.mark.asyncio
async def test_persist_message_user_message_uses_existing_id_when_provided():
    existing_id = str(uuid.uuid4())
    conversation_user_message = ConversationUserMessage(
        message="Hello again",
        end_user_id="user-123",
        session_id="session-456",
        conversation_id=existing_id,
    )

    result_id = await persist_message(conversation_user_message)

    assert result_id == existing_id


@pytest.mark.asyncio
async def test_name_conversation(mock_bedrock_client):
    result = await name_conversation("conversation-123", "The users first message.")
    assert result == "Conversation conversation-123 named: Stubbed LLM response"

    _, kwargs = mock_bedrock_client.invoke_model.call_args
    sent_body = json.loads(kwargs["body"])
    expected_prompt = "Summarise this query into a 3-5 word title. Output ONLY the title: The users first message."
    assert sent_body["messages"][0]["content"] == expected_prompt
