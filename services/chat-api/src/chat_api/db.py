import boto3
from boto3.dynamodb.conditions import Key
import os
import uuid

from chat_api.models import AssistantMessage, Conversation, UserMessage


def get_table_name() -> str:
    return os.environ["DYNAMODB_TABLE_NAME"]


_dynamodb = boto3.resource(
    "dynamodb",
    region_name=os.environ.get("AWS_REGION")
    or os.environ.get("AWS_DEFAULT_REGION")
    or "eu-west-1",
)
_table = _dynamodb.Table(get_table_name())


def create_conversation(title: str) -> Conversation:
    conversation = Conversation(id=uuid.uuid4().hex, title=title)
    _table.put_item(Item=conversation.to_item())
    return conversation


def add_message(
    conversation_id: str, role: str, content: str
) -> UserMessage | AssistantMessage:
    if role == "user":
        message = UserMessage(conversation_id=conversation_id, content=content)
    else:
        message = AssistantMessage(conversation_id=conversation_id, content=content)
    _table.put_item(Item=message.to_item())
    return message


def get_conversation_with_messages(
    conversation_id: str,
) -> tuple[Conversation, list[UserMessage | AssistantMessage]] | None:
    pk = f"CONVERSATION#{conversation_id}"
    response = _table.query(KeyConditionExpression=Key("PK").eq(pk))
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
