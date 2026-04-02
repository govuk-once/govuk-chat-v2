import boto3
from boto3.dynamodb.conditions import Key
import uuid
import os

from chat_api.models import AssistantMessage, Conversation, UserMessage

_table = None


def get_table_name() -> str:
    name = os.environ.get("DYNAMODB_TABLE_NAME")
    if name:
        return name
    user = os.environ.get("USER", "")
    return f"{user}-govuk-chat-chat-api-table"


def get_table(name: str):
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb")
        _table = dynamodb.Table(name)
    return _table


def create_conversation(title: str) -> Conversation:
    conversation = Conversation(id=uuid.uuid4().hex, title=title)
    get_table(get_table_name()).put_item(Item=conversation.to_item())
    return conversation


def add_message(
    conversation_id: str, role: str, content: str
) -> UserMessage | AssistantMessage:
    if role == "user":
        message = UserMessage(conversation_id=conversation_id, content=content)
    else:
        message = AssistantMessage(conversation_id=conversation_id, content=content)
    get_table(get_table_name()).put_item(Item=message.to_item())
    return message


def get_conversation_with_messages(
    conversation_id: str,
) -> tuple[Conversation, list[UserMessage | AssistantMessage]] | None:
    pk = f"CONVERSATION#{conversation_id}"
    response = get_table(get_table_name()).query(
        KeyConditionExpression=Key("PK").eq(pk)
    )
    items = response.get("Items", [])
    metadata_item = next(
        (item for item in items if item["entityType"] == "METADATA"), None
    )
    if metadata_item is None:
        return None
    conversation = Conversation.from_item(metadata_item)
    messages = [
        UserMessage.from_item(item)
        if item["role"] == "user"
        else AssistantMessage.from_item(item)
        for item in items
        if item["entityType"] == "MESSAGE"
    ]
    return conversation, messages
