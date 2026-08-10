import json
import uuid

import pytest

from chat_api.v1.data_models.messages import (
    ConversationAssistantMessage,
    ConversationUserMessage,
)
from chat_api.v1.services.persistence_service import (
    name_conversation,
    persist_message,
    rename_conversation,
)


@pytest.mark.asyncio
async def test_persist_message_assistant_message(mocker):
    repository = mocker.Mock()
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )
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
    repository.append_assistant_message.assert_called_once_with(
        conversation_id="conversation-123",
        message="Hello world",
        session_id="session-123",
        status="complete",
        stop_reason="end_turn",
        message_id="message-123",
        error_type=None,
        error_message=None,
        end_user_id="user-123",
    )


@pytest.mark.asyncio
async def test_persist_message_user_message_creates_conversation_when_none_provided(
    mocker,
):
    conversation_id = str(uuid.uuid4())
    conversation = mocker.Mock(conversation_id=conversation_id)
    message = mocker.Mock()
    repository = mocker.Mock()
    repository.create_conversation_with_user_message.return_value = (
        conversation,
        message,
    )
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )
    conversation_user_message = ConversationUserMessage(
        message="Hello world",
        end_user_id="user-123",
        session_id="session-456",
        conversation_id=None,
    )

    result_id = await persist_message(conversation_user_message)

    assert result_id == conversation_id
    repository.create_conversation_with_user_message.assert_called_once_with(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-456",
    )


@pytest.mark.asyncio
async def test_persist_message_user_message_uses_existing_id_when_provided(mocker):
    repository = mocker.Mock()
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )
    existing_id = str(uuid.uuid4())
    conversation_user_message = ConversationUserMessage(
        message="Hello again",
        end_user_id="user-123",
        session_id="session-456",
        conversation_id=existing_id,
    )

    result_id = await persist_message(conversation_user_message)

    assert result_id == existing_id
    repository.append_user_message.assert_called_once_with(
        conversation_id=existing_id,
        message="Hello again",
        session_id="session-456",
        end_user_id="user-123",
    )


@pytest.mark.asyncio
async def test_name_conversation(mock_bedrock_client, mocker):
    repository = mocker.Mock()
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )

    result = await name_conversation(
        "conversation-123", "The users first message.", "user-123"
    )
    assert result == "Conversation conversation-123 named: Stubbed LLM response"

    _, kwargs = mock_bedrock_client.invoke_model.call_args
    sent_body = json.loads(kwargs["body"])
    expected_prompt = "Summarise this query into a 3-5 word title. Output ONLY the title: The users first message."
    assert sent_body["messages"][0]["content"] == expected_prompt
    repository.update_conversation_label.assert_called_once_with(
        conversation_id="conversation-123",
        label="Stubbed LLM response",
        end_user_id="user-123",
    )


@pytest.mark.asyncio
async def test_name_conversation_does_not_raise_when_title_persistence_fails(mocker):
    repository = mocker.Mock()
    repository.update_conversation_label.side_effect = RuntimeError("DynamoDB failed")
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )

    result = await name_conversation(
        "conversation-123", "The users first message.", "user-123"
    )

    assert result == "Conversation conversation-123 could not be named: DynamoDB failed"


@pytest.mark.asyncio
async def test_rename_conversation(mocker):
    repository = mocker.Mock()
    mocker.patch(
        "chat_api.v1.services.persistence_service.get_conversation_repository",
        return_value=repository,
    )

    await rename_conversation("conversation-123", "Updated title", "user-123")
    repository.update_conversation_label.assert_called_once_with(
        conversation_id="conversation-123",
        label="Updated title",
        end_user_id="user-123",
    )
