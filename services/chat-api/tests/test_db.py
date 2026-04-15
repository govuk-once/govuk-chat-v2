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
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield table


def test_create_conversation(dynamo_table):
    repository = ConversationRepository(dynamo_table)
    conversation = repository.create_conversation("Prototype chat")

    assert isinstance(conversation, Conversation)
    assert conversation.title == "Prototype chat"

    response = dynamo_table.get_item(
        Key={"PK": f"CONVERSATION#{conversation.id}", "SK": "METADATA"}
    )
    assert response["Item"] == conversation.to_item()


def test_add_message(dynamo_table):
    repository = ConversationRepository(dynamo_table)
    conversation = repository.create_conversation("Prototype chat")

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
    conversation = Conversation(id="conversation-123", title="Prototype chat")
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
