from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import pytest
from moto import mock_aws

from chat_api.v1.persistence.conversation_repository import (
    ConversationRepository,
    ConversationNotFoundError,
)
from chat_api.v1.persistence.data_models import (
    ConversationTableItem,
    DEFAULT_CONVERSATION_LABEL,
)


@pytest.fixture
def dynamo_table():
    with mock_aws():
        ConversationTableItem.create_table(billing_mode="PAY_PER_REQUEST", wait=True)
        dynamodb = boto3.resource("dynamodb", region_name="eu-west-1")
        yield dynamodb.Table("test-table")


@pytest.fixture
def repository(dynamo_table):
    return ConversationRepository()


def items_for_conversation(dynamo_table, conversation_id: str) -> list[dict]:
    response = dynamo_table.query(
        KeyConditionExpression=Key("PK").eq(f"CONVERSATION#{conversation_id}")
    )
    return response["Items"]


def item_with_entity_type(items: list[dict], entity_type: str) -> dict:
    return next(item for item in items if item["entityType"] == entity_type)


def message_items(items: list[dict]) -> list[dict]:
    return [item for item in items if item["entityType"] == "Message"]


def test_create_conversation_with_user_message(dynamo_table, repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-123",
    )

    items = items_for_conversation(dynamo_table, conversation.conversation_id)

    assert len(items) == 3

    metadata_item = item_with_entity_type(items, "Conversation")
    assert metadata_item["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert metadata_item["SK"] == "METADATA"
    assert metadata_item["end_user_id"] == "user-123"
    assert metadata_item["label"] == DEFAULT_CONVERSATION_LABEL
    assert metadata_item["default_branch_id"] == conversation.default_branch_id
    assert metadata_item["GSI1PK"] == "USER#user-123#CONVERSATIONS#ACTIVE"
    assert metadata_item["GSI1SK"].startswith("LAST_ACTIVITY#")
    assert metadata_item["GSI1SK"].endswith(
        f"#CONVERSATION#{conversation.conversation_id}"
    )

    branch_item = item_with_entity_type(items, "Branch")
    assert branch_item["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert branch_item["SK"] == f"BRANCH#{conversation.default_branch_id}"
    assert branch_item["branch_id"] == conversation.default_branch_id
    assert branch_item["tip_sequence"] == Decimal(1)
    assert branch_item["message_count"] == Decimal(1)

    [message_item] = message_items(items)
    assert message_item["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert message_item["SK"].startswith(
        f"BRANCH#{conversation.default_branch_id}#MESSAGE#0000000001#"
    )
    assert message_item["message_id"] == branch_item["tip_message_id"]
    assert message_item["branch_id"] == conversation.default_branch_id
    assert message_item["sequence"] == Decimal(1)
    assert message_item["participant"] == "user"
    assert message_item["message_type"] == "UserMessageText"
    assert message_item["payload"] == {"text": "Hello world"}
    assert message_item["session_id"] == "session-123"


def test_append_user_message_updates_branch_tip(dynamo_table, repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-123",
    )

    appended_message = repository.append_user_message(
        conversation_id=conversation.conversation_id,
        message="Follow-up question",
        session_id="session-456",
        end_user_id="user-123",
    )

    items = items_for_conversation(dynamo_table, conversation.conversation_id)
    branch_item = item_with_entity_type(items, "Branch")

    assert branch_item["tip_message_id"] == appended_message.message_id
    assert branch_item["tip_sequence"] == Decimal(2)
    assert branch_item["message_count"] == Decimal(2)

    messages = message_items(items)
    assert len(messages) == 2

    appended_item = next(
        item for item in messages if item["message_id"] == appended_message.message_id
    )
    assert appended_item["SK"].startswith(
        f"BRANCH#{conversation.default_branch_id}#MESSAGE#0000000002#"
    )
    assert appended_item["sequence"] == Decimal(2)
    assert appended_item["participant"] == "user"
    assert appended_item["message_type"] == "UserMessageText"
    assert appended_item["payload"] == {"text": "Follow-up question"}
    assert appended_item["session_id"] == "session-456"


def test_append_user_message_wont_append_if_not_users_conversation(repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-123",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Follow-up question",
            session_id="session-456",
            end_user_id="user-456",
        )


def test_append_assistant_message_updates_branch_tip(dynamo_table, repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-123",
    )

    assistant_message = repository.append_assistant_message(
        conversation_id=conversation.conversation_id,
        message="Hello from the assistant",
        session_id="session-123",
        status="complete",
        stop_reason="end_turn",
        message_id="message-123",
        end_user_id="user-123",
    )

    items = items_for_conversation(dynamo_table, conversation.conversation_id)
    branch_item = item_with_entity_type(items, "Branch")

    assert branch_item["tip_message_id"] == "message-123"
    assert branch_item["tip_sequence"] == Decimal(2)
    assert branch_item["message_count"] == Decimal(2)

    messages = message_items(items)
    assistant_item = next(
        item for item in messages if item["message_id"] == assistant_message.message_id
    )
    assert assistant_item["SK"].startswith(
        f"BRANCH#{conversation.default_branch_id}#MESSAGE#0000000002#message-123"
    )
    assert assistant_item["sequence"] == Decimal(2)
    assert assistant_item["participant"] == "assistant"
    assert assistant_item["message_type"] == "AssistantMessageText"
    assert assistant_item["payload"] == {"text": "Hello from the assistant"}
    assert assistant_item["session_id"] == "session-123"
    assert assistant_item["status"] == "complete"
    assert assistant_item["stop_reason"] == "end_turn"


def test_append_assistant_error_message_stores_error_metadata(dynamo_table, repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    assistant_message = repository.append_assistant_message(
        conversation_id=conversation.conversation_id,
        message="Partial response",
        session_id="session-123",
        status="error",
        stop_reason="error",
        message_id="message-123",
        error_type="UnknownAgentEventTypeError",
        error_message="Received unknown event type",
        end_user_id="user-123",
    )

    items = items_for_conversation(dynamo_table, conversation.conversation_id)
    assistant_item = next(
        item
        for item in message_items(items)
        if item["message_id"] == assistant_message.message_id
    )

    assert assistant_item["status"] == "error"
    assert assistant_item["stop_reason"] == "error"
    assert assistant_item["error_type"] == "UnknownAgentEventTypeError"
    assert assistant_item["error_message"] == "Received unknown event type"


def test_append_assistant_message_wont_append_if_not_users_conversation(repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
        session_id="session-123",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.append_assistant_message(
            conversation_id=conversation.conversation_id,
            message="Partial response",
            session_id="session-123",
            status="error",
            stop_reason="error",
            message_id="message-123",
            error_type="UnknownAgentEventTypeError",
            error_message="Received unknown event type",
            end_user_id="user-456",
        )


def test_update_conversation_label(dynamo_table, repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    updated_conversation = repository.update_conversation_label(
        conversation.conversation_id,
        "Generated title",
        "user-123",
    )

    assert updated_conversation.label == "Generated title"

    items = items_for_conversation(dynamo_table, conversation.conversation_id)
    metadata_item = item_with_entity_type(items, "Conversation")
    assert metadata_item["label"] == "Generated title"


def test_update_conversation_label_wont_update_if_not_users_conversation(repository):
    conversation = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.update_conversation_label(
            conversation.conversation_id,
            "Generated title",
            "user-456",
        )
