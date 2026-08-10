from decimal import Decimal

import boto3
import pytest
from boto3.dynamodb.conditions import Key
from moto import mock_aws

from chat_api.v1.persistence.conversation_repository import (
    ConversationNotFoundError,
    ConversationRepository,
    ConversationStreamNotFoundError,
)
from chat_api.v1.persistence.data_models import (
    DEFAULT_CONVERSATION_LABEL,
    PYNAMODB_UTC_DATETIME_FORMAT,
    ConversationStreamItem,
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


def items_for_conversation(dynamo_table, conversation_id: str) -> list[dict]:
    response = dynamo_table.query(
        KeyConditionExpression=Key("PK").eq(f"CONVERSATION#{conversation_id}")
    )
    return response["Items"]


def item_with_entity_type(items: list[dict], entity_type: str) -> dict:
    return next(item for item in items if item["entityType"] == entity_type)


def message_items(items: list[dict]) -> list[dict]:
    return [item for item in items if item["entityType"] == "Message"]


def items_for_gsi_partition(dynamo_table, partition_key: str) -> list[dict]:
    response = dynamo_table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(partition_key),
    )
    return response["Items"]


def item_for_stream(dynamo_table, conversation_id: str, stream_id: str) -> dict | None:
    response = dynamo_table.get_item(
        Key={
            "PK": f"CONVERSATION#{conversation_id}",
            "SK": f"STREAM#{stream_id}",
        }
    )
    return response.get("Item")


def conversation_with_stream(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )
    stream = repository.create_conversation_stream(
        conversation_id=conversation.conversation_id,
        stream_id="stream-123",
        end_user_id="user-123",
        message_id="message-123",
        runtime_session_id="session-123",
    )
    return conversation, stream


def test_create_conversation_with_user_message(dynamo_table, repository):
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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
    conversation, _ = repository.create_conversation_with_user_message(
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


def test_get_conversations_for_user(dynamo_table, repository):
    conversation_1, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )
    conversation_2, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )
    _conversation_3, _ = repository.create_conversation_with_user_message(
        end_user_id="user-999",
        message="User message",
    )
    conversation_4, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )

    conversations = repository.get_conversations_for_user(
        end_user_id="user-123",
    )

    assert len(conversations) == 3

    assert conversations[0].conversation_id == conversation_4.conversation_id
    assert conversations[1].conversation_id == conversation_2.conversation_id
    assert conversations[2].conversation_id == conversation_1.conversation_id


def test_get_conversations_for_user_with_count(dynamo_table, repository):
    _conversation_1, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )
    _conversation_2, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )
    conversation_3, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message",
    )

    conversations = repository.get_conversations_for_user(
        end_user_id="user-123",
        count=1,
    )

    assert len(conversations) == 1

    assert conversations[0].conversation_id == conversation_3.conversation_id


def test_update_conversation_label_wont_update_if_not_users_conversation(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.update_conversation_label(
            conversation.conversation_id,
            "Generated title",
            "user-456",
        )


def test_delete_conversation_marks_conversation_as_deleted(dynamo_table, repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    deleted_conversation = repository.delete_conversation(
        conversation.conversation_id,
        "user-123",
    )

    assert deleted_conversation.deleted_at is not None

    items = items_for_conversation(dynamo_table, conversation.conversation_id)
    metadata_item = item_with_entity_type(items, "Conversation")

    assert metadata_item["deleted_at"] == deleted_conversation.deleted_at.strftime(
        PYNAMODB_UTC_DATETIME_FORMAT
    )
    assert metadata_item["GSI1PK"] == "USER#user-123#CONVERSATIONS#DELETED"
    assert metadata_item["GSI1SK"].startswith("DELETED_AT#")
    assert metadata_item["GSI1SK"].endswith(
        f"#CONVERSATION#{conversation.conversation_id}"
    )


def test_delete_conversation_moves_conversation_out_of_active_index(
    dynamo_table, repository
):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    repository.delete_conversation(conversation.conversation_id, "user-123")

    active_items = items_for_gsi_partition(
        dynamo_table, "USER#user-123#CONVERSATIONS#ACTIVE"
    )
    deleted_items = items_for_gsi_partition(
        dynamo_table, "USER#user-123#CONVERSATIONS#DELETED"
    )

    assert active_items == []
    assert len(deleted_items) == 1
    assert deleted_items[0]["PK"] == f"CONVERSATION#{conversation.conversation_id}"


def test_delete_conversation_wont_delete_if_not_users_conversation(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.delete_conversation(conversation.conversation_id, "user-456")


def test_deleted_conversation_cannot_be_returned(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )
    repository.delete_conversation(conversation.conversation_id, "user-123")

    with pytest.raises(ConversationNotFoundError):
        repository.get_conversation_with_messages(
            conversation_id=conversation.conversation_id,
            end_user_id="user-123",
        )


def test_deleted_conversation_cannot_be_updated(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )
    repository.delete_conversation(conversation.conversation_id, "user-123")

    with pytest.raises(ConversationNotFoundError):
        repository.update_conversation_label(
            conversation.conversation_id,
            "Generated title",
            "user-123",
        )


def test_deleted_conversation_cannot_have_messages_appended(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )
    repository.delete_conversation(conversation.conversation_id, "user-123")

    with pytest.raises(ConversationNotFoundError):
        repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Follow-up question",
            end_user_id="user-123",
        )

    with pytest.raises(ConversationNotFoundError):
        repository.append_assistant_message(
            conversation_id=conversation.conversation_id,
            message="Assistant response",
            session_id="session-123",
            status="complete",
            stop_reason="end_turn",
            end_user_id="user-123",
        )


def test_deleted_conversation_cannot_be_deleted_again(repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )
    repository.delete_conversation(conversation.conversation_id, "user-123")

    with pytest.raises(ConversationNotFoundError):
        repository.delete_conversation(conversation.conversation_id, "user-123")


def test_create_conversation_stream(dynamo_table, repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="Hello world",
    )

    stream = repository.create_conversation_stream(
        conversation_id=conversation.conversation_id,
        stream_id="stream-123",
        end_user_id="user-123",
        message_id="message-123",
        runtime_session_id="session-123",
    )

    assert isinstance(stream, ConversationStreamItem)
    assert stream.stream_id == "stream-123"
    assert stream.conversation_id == conversation.conversation_id
    assert stream.end_user_id == "user-123"
    assert stream.message_id == "message-123"
    assert stream.runtime_session_id == "session-123"
    assert stream.status == "active"
    assert stream.cancelled_at is None

    stream_item = item_for_stream(
        dynamo_table, conversation.conversation_id, "stream-123"
    )
    assert stream_item is not None
    assert stream_item["PK"] == f"CONVERSATION#{conversation.conversation_id}"
    assert stream_item["SK"] == "STREAM#stream-123"
    assert stream_item["entityType"] == "ConversationStream"
    assert stream_item["stream_id"] == "stream-123"
    assert stream_item["end_user_id"] == "user-123"
    assert stream_item["message_id"] == "message-123"
    assert stream_item["runtime_session_id"] == "session-123"
    assert stream_item["status"] == "active"


def test_cancel_conversation_stream_marks_stream_as_cancelled(dynamo_table, repository):
    conversation, _ = conversation_with_stream(repository)

    cancelled_stream = repository.cancel_conversation_stream(
        conversation_id=conversation.conversation_id,
        stream_id="stream-123",
        end_user_id="user-123",
    )

    assert cancelled_stream.status == "cancelled"
    assert cancelled_stream.runtime_session_id == "session-123"
    assert cancelled_stream.cancelled_at is not None

    stream_item = item_for_stream(
        dynamo_table, conversation.conversation_id, "stream-123"
    )
    assert stream_item is not None
    assert stream_item["status"] == "cancelled"
    assert stream_item["cancelled_at"] == cancelled_stream.cancelled_at.strftime(
        PYNAMODB_UTC_DATETIME_FORMAT
    )


def test_cancel_conversation_stream_wont_cancel_unknown_stream(repository):
    with pytest.raises(ConversationStreamNotFoundError):
        repository.cancel_conversation_stream(
            conversation_id="conversation-123",
            stream_id="stream-123",
            end_user_id="user-123",
        )


def test_cancel_conversation_stream_wont_cancel_another_users_stream(repository):
    conversation, _ = conversation_with_stream(repository)

    with pytest.raises(ConversationStreamNotFoundError):
        repository.cancel_conversation_stream(
            conversation_id=conversation.conversation_id,
            stream_id="stream-123",
            end_user_id="user-456",
        )


def test_is_conversation_stream_cancelled(repository):
    assert (
        repository.is_conversation_stream_cancelled(
            conversation_id="conversation-123",
            stream_id="stream-123",
            end_user_id="user-123",
        )
        is False
    )

    conversation, _ = conversation_with_stream(repository)

    assert (
        repository.is_conversation_stream_cancelled(
            conversation_id=conversation.conversation_id,
            stream_id="stream-123",
            end_user_id="user-123",
        )
        is False
    )

    repository.cancel_conversation_stream(
        conversation_id=conversation.conversation_id,
        stream_id="stream-123",
        end_user_id="user-123",
    )

    assert (
        repository.is_conversation_stream_cancelled(
            conversation_id=conversation.conversation_id,
            stream_id="stream-123",
            end_user_id="user-123",
        )
        is True
    )


def test_delete_conversation_stream(dynamo_table, repository):
    conversation, _ = conversation_with_stream(repository)

    repository.delete_conversation_stream(
        conversation_id=conversation.conversation_id,
        stream_id="stream-123",
        end_user_id="user-123",
    )

    assert (
        item_for_stream(dynamo_table, conversation.conversation_id, "stream-123")
        is None
    )


def test_get_conversation_with_messages(dynamo_table, repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message 1",
        session_id="session-123",
    )
    repository.append_assistant_message(
        conversation_id=conversation.conversation_id,
        message="Assistant message 1",
        session_id="session-123",
        status="complete",
        stop_reason="end_turn",
        message_id="message-123",
        end_user_id="user-123",
    )
    repository.append_user_message(
        conversation_id=conversation.conversation_id,
        message="User message 2",
        session_id="session-123",
        end_user_id="user-123",
    )

    conversation, messages = repository.get_conversation_with_messages(
        conversation_id=conversation.conversation_id,
        end_user_id="user-123",
    )

    assert conversation.end_user_id == "user-123"
    assert conversation.label == DEFAULT_CONVERSATION_LABEL

    assert len(messages) == 3

    message_1 = messages[0]
    assert message_1.participant == "user"
    assert message_1.payload.text == "User message 1"

    message_2 = messages[1]
    assert message_2.participant == "assistant"
    assert message_2.payload.text == "Assistant message 1"

    message_3 = messages[2]
    assert message_3.participant == "user"
    assert message_3.payload.text == "User message 2"


def test_get_conversation_with_messages_and_message_count(dynamo_table, repository):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message 1",
        session_id="session-123",
    )
    repository.append_user_message(
        conversation_id=conversation.conversation_id,
        message="User message 2",
        session_id="session-123",
        end_user_id="user-123",
    )
    repository.append_user_message(
        conversation_id=conversation.conversation_id,
        message="User message 3",
        session_id="session-123",
        end_user_id="user-123",
    )

    conversation, messages = repository.get_conversation_with_messages(
        conversation_id=conversation.conversation_id,
        end_user_id="user-123",
        message_count=2,
    )

    assert len(messages) == 2

    message_1 = messages[0]
    assert message_1.participant == "user"
    assert message_1.payload.text == "User message 1"

    message_2 = messages[1]
    assert message_2.participant == "user"
    assert message_2.payload.text == "User message 2"


def test_get_conversation_with_messages_raises_exception_if_not_users_conversation(
    repository,
):
    conversation, _ = repository.create_conversation_with_user_message(
        end_user_id="user-123",
        message="User message 1",
        session_id="session-123",
    )

    with pytest.raises(ConversationNotFoundError):
        repository.get_conversation_with_messages(
            conversation_id=conversation.conversation_id,
            end_user_id="user-999",
        )
