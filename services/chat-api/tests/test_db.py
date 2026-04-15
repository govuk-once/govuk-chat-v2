from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
import pytest
from moto import mock_aws

from chat_api.conversation_repository import ConversationRepository
from chat_api.models import AssistantMessage, Conversation, UserMessage


@pytest.fixture
def dynamo_table():
    with mock_aws():
        dynamodb = boto3.resource("dynamodb", region_name="eu-west-1")
        table = dynamodb.create_table(
            TableName="test-table",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
                {"AttributeName": "GSI1PK", "AttributeType": "S"},
                {"AttributeName": "GSI1SK", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "GSI1",
                    "KeySchema": [
                        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                        {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield table


def test_create_conversation(dynamo_table):
    repository = ConversationRepository(dynamo_table)
    conversation = repository.create_conversation("user-123", "Prototype chat")

    assert isinstance(conversation, Conversation)
    assert conversation.user_id == "user-123"
    assert conversation.title == "Prototype chat"

    response = dynamo_table.get_item(
        Key={"PK": f"CONVERSATION#{conversation.id}", "SK": "METADATA"}
    )
    assert response["Item"] == conversation.to_item()


def test_add_message(dynamo_table):
    repository = ConversationRepository(dynamo_table)
    conversation = repository.create_conversation("user-123", "Prototype chat")

    message = repository.add_message(
        conversation.id, "assistant", "Hello from the assistant"
    )

    assert isinstance(message, AssistantMessage)
    assert message.conversation_id == conversation.id
    assert message.content == "Hello from the assistant"

    response = dynamo_table.query(
        KeyConditionExpression=Key("PK").eq(f"CONVERSATION#{conversation.id}")
    )
    items = [item for item in response["Items"] if item["entityType"] == "MESSAGE"]

    assert len(items) == 1
    assert items[0]["PK"] == f"CONVERSATION#{conversation.id}"
    assert items[0]["role"] == "assistant"
    assert items[0]["content"] == "Hello from the assistant"
    assert items[0]["SK"].startswith("MSG#")


def test_get_conversation_with_messages(dynamo_table):
    conversation = Conversation(
        id="conversation-123",
        user_id="user-123",
        title="Prototype chat",
        created_at=datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc),
    )
    first_message = UserMessage(
        conversation_id=conversation.id,
        content="Hello",
        timestamp=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
    )
    second_message = AssistantMessage(
        conversation_id=conversation.id,
        content="Hi there",
        timestamp=datetime(2026, 1, 1, 12, 0, 1, tzinfo=timezone.utc),
    )

    dynamo_table.put_item(Item=conversation.to_item())
    dynamo_table.put_item(Item=first_message.to_item())
    dynamo_table.put_item(Item=second_message.to_item())

    repository = ConversationRepository(dynamo_table)
    result = repository.get_conversation_with_messages(conversation.id)

    assert result == (conversation, [first_message, second_message])


def test_list_conversations_for_user(dynamo_table):
    oldest_conversation = Conversation(
        id="conversation-1",
        user_id="user-123",
        title="First conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
    )
    newest_conversation = Conversation(
        id="conversation-2",
        user_id="user-123",
        title="Second conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc),
    )
    other_users_conversation = Conversation(
        id="conversation-3",
        user_id="user-999",
        title="Someone else's conversation",
        created_at=datetime(2026, 1, 1, 12, 0, 10, tzinfo=timezone.utc),
    )
    message = UserMessage(
        conversation_id=newest_conversation.id,
        content="Hello again",
        timestamp=datetime(2026, 1, 1, 12, 0, 6, tzinfo=timezone.utc),
    )

    dynamo_table.put_item(Item=oldest_conversation.to_item())
    dynamo_table.put_item(Item=newest_conversation.to_item())
    dynamo_table.put_item(Item=other_users_conversation.to_item())
    dynamo_table.put_item(Item=message.to_item())

    repository = ConversationRepository(dynamo_table)

    conversations = repository.list_conversations_for_user("user-123")

    assert conversations == [newest_conversation, oldest_conversation]
