from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
import pytest
from moto import mock_aws

from chat_api.conversation_persistence.conversation_repository import (
    ConversationRepository,
)
from chat_api.conversation_persistence.data_models import (
    ConversationMessageItem,
    ConversationMetadataItem,
    ConversationTableItem,
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


def test_create_conversation(dynamo_table, repository):
    conversation = repository.create_conversation("user-123", "Prototype chat")

    assert isinstance(conversation, ConversationMetadataItem)
    assert conversation.conversation_id
    assert conversation.user_id == "user-123"
    assert conversation.title == "Prototype chat"

    response = dynamo_table.get_item(
        Key={"PK": f"CONVERSATION#{conversation.conversation_id}", "SK": "METADATA"}
    )
    assert response["Item"]["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert response["Item"]["SK"] == "METADATA"
    assert response["Item"]["GSI1PK"] == "USER#user-123"
    assert response["Item"]["GSI1SK"].startswith("CREATED_AT#")
    assert response["Item"]["title"] == "Prototype chat"
    assert response["Item"]["entityType"] == "METADATA"


def test_add_message(dynamo_table, repository):
    conversation = repository.create_conversation("user-123", "Prototype chat")

    message = repository.add_message(
        conversation.conversation_id, "assistant", "Hello from the assistant"
    )

    assert isinstance(message, ConversationMessageItem)
    assert message.conversation_id == conversation.conversation_id
    assert message.role == "assistant"
    assert message.content == "Hello from the assistant"

    response = dynamo_table.query(
        KeyConditionExpression=Key("PK").eq(
            f"CONVERSATION#{conversation.conversation_id}"
        )
    )
    items = [item for item in response["Items"] if item["entityType"] == "MESSAGE"]

    assert len(items) == 1
    assert items[0]["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert items[0]["role"] == "assistant"
    assert items[0]["content"] == "Hello from the assistant"
    assert items[0]["SK"].startswith("MSG#")


def test_get_conversation_with_messages(repository):
    conversation = ConversationMetadataItem.new_conversation(
        conversation_id="conversation-123",
        user_id="user-123",
        title="Prototype chat",
        created_at=datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc),
    )
    conversation.save()

    first_message = ConversationMessageItem.new_message(
        conversation_id=conversation.conversation_id,
        role="user",
        content="Hello",
        timestamp=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
    )
    first_message.save()

    second_message = ConversationMessageItem.new_message(
        conversation_id=conversation.conversation_id,
        role="assistant",
        content="Hi there",
        timestamp=datetime(2026, 1, 1, 12, 0, 1, tzinfo=timezone.utc),
    )
    second_message.save()

    result = repository.get_conversation_with_messages(conversation.conversation_id)

    assert result is not None
    metadata_item, message_items = result
    assert isinstance(metadata_item, ConversationMetadataItem)
    assert metadata_item.conversation_id == "conversation-123"
    assert metadata_item.user_id == "user-123"
    assert metadata_item.title == "Prototype chat"
    assert metadata_item.created_at == datetime(
        2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc
    )
    assert [
        (item.conversation_id, item.role, item.content, item.timestamp)
        for item in message_items
    ] == [
        (
            "conversation-123",
            "user",
            "Hello",
            datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        ),
        (
            "conversation-123",
            "assistant",
            "Hi there",
            datetime(2026, 1, 1, 12, 0, 1, tzinfo=timezone.utc),
        ),
    ]


def test_list_conversations_for_user(repository):
    oldest_conversation = ConversationMetadataItem.new_conversation(
        conversation_id="conversation-1",
        user_id="user-123",
        title="First conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
    )
    oldest_conversation.save()

    newest_conversation = ConversationMetadataItem.new_conversation(
        conversation_id="conversation-2",
        user_id="user-123",
        title="Second conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc),
    )
    newest_conversation.save()

    other_users_conversation = ConversationMetadataItem.new_conversation(
        conversation_id="conversation-3",
        user_id="user-999",
        title="Someone else's conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 10, tzinfo=timezone.utc),
    )
    other_users_conversation.save()

    message = ConversationMessageItem.new_message(
        conversation_id=newest_conversation.conversation_id,
        role="user",
        content="Hello again",
        timestamp=datetime(2026, 1, 1, 12, 0, 6, tzinfo=timezone.utc),
    )
    message.save()

    conversations = repository.list_conversations_for_user("user-123")

    assert [
        (item.conversation_id, item.user_id, item.title, item.created_at)
        for item in conversations
    ] == [
        (
            "conversation-2",
            "user-123",
            "Second conversation",
            datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc),
        ),
        (
            "conversation-1",
            "user-123",
            "First conversation",
            datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        ),
    ]
