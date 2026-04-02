import boto3
from boto3.dynamodb.conditions import Key
from datetime import datetime, timezone
import uuid
import os

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


def create_conversation(title: str) -> str:
    conversation_id = uuid.uuid4().hex
    pk = f"CONVERSATION#{conversation_id}"
    get_table(get_table_name()).put_item(
        Item={
            "PK": pk,
            "SK": "METADATA",
            "entityType": "METADATA",
            "title": title,
        }
    )
    return conversation_id


def add_message(conversation_id: str, role: str, content: str) -> None:
    pk = f"CONVERSATION#{conversation_id}"
    sk = make_message_sk()
    get_table(get_table_name()).put_item(
        Item={
            "PK": pk,
            "SK": sk,
            "role": role,
            "entityType": "MESSAGE",
            "content": content,
        }
    )


def get_conversation_with_messages(conversation_id: str) -> dict:
    pk = f"CONVERSATION#{conversation_id}"
    response = get_table(get_table_name()).query(
        KeyConditionExpression=Key("PK").eq(pk)
    )
    items = response.get("Items", [])
    return {
        "metadata": next(
            (item for item in items if item["entityType"] == "METADATA"), None
        ),
        "messages": [item for item in items if item["entityType"] == "MESSAGE"],
    }


def make_message_sk() -> str:
    """
    Create a DynamoDB sort key for a message.

    The key uses the form ``MSG#<timestamp>#<uuid>`` so that:

    - the ``MSG#`` prefix identifies the item type,
    - the UTC ISO 8601 timestamp sorts correctly as a string in time order,
    - and the UUID prevents collisions when multiple messages are created at
    nearly the same instant.

    UTC is used to avoid timezone ambiguity, microseconds are included for
    consistent precision, and ``Z`` is used as the standard UTC suffix.
    """
    ts = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    ts = ts.replace("+00:00", "Z")
    return f"MSG#{ts}#{uuid.uuid4().hex}"
