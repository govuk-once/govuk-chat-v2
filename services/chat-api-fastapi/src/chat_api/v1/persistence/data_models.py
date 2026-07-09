from datetime import datetime, timezone
import os
from typing import Literal, TypeAlias
import uuid

from pynamodb.attributes import (
    DiscriminatorAttribute,
    DynamicMapAttribute,
    NumberAttribute,
    UTCDateTimeAttribute,
    UnicodeAttribute,
)
from pynamodb.indexes import AllProjection, GlobalSecondaryIndex
from pynamodb.models import Model

PYNAMODB_UTC_DATETIME_FORMAT = "%Y-%m-%dT%H:%M:%S.%f+0000"
DEFAULT_CONVERSATION_LABEL = "New conversation"

MessageParticipant: TypeAlias = Literal["user", "assistant"]
TextMessageType: TypeAlias = Literal["UserMessageText", "AssistantMessageText"]
MessageStatus: TypeAlias = Literal["complete", "cancelled", "error"]


class ConversationsByUserIndex(GlobalSecondaryIndex):
    class Meta:
        index_name = "GSI1"
        projection = AllProjection()

    GSI1PK = UnicodeAttribute(hash_key=True)
    GSI1SK = UnicodeAttribute(range_key=True)


class MessagePayload(DynamicMapAttribute):
    text = UnicodeAttribute(null=True)


class ConversationTableItem(Model):
    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        table_name = os.environ["CONVERSATION_DYNAMODB_TABLE"]
        region = (
            os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
            or "eu-west-1"
        )

    PK = UnicodeAttribute(hash_key=True)
    SK = UnicodeAttribute(range_key=True)
    entity_type = DiscriminatorAttribute(attr_name="entityType")
    conversations_by_user = ConversationsByUserIndex()

    @classmethod
    def conversation_pk(cls, conversation_id: str) -> str:
        return f"CONVERSATION#{conversation_id}"

    @classmethod
    def active_conversations_gsi_pk(cls, end_user_id: str) -> str:
        return f"USER#{end_user_id}#CONVERSATIONS#ACTIVE"

    @classmethod
    def deleted_conversations_gsi_pk(cls, end_user_id: str) -> str:
        return f"USER#{end_user_id}#CONVERSATIONS#DELETED"

    @property
    def conversation_id(self) -> str:
        return self.PK.split("#", maxsplit=1)[1]


class ConversationMetadataItem(ConversationTableItem, discriminator="Conversation"):
    GSI1PK = UnicodeAttribute()
    GSI1SK = UnicodeAttribute()
    end_user_id = UnicodeAttribute()
    label = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    last_activity_at = UTCDateTimeAttribute()
    default_branch_id = UnicodeAttribute()
    deleted_at = UTCDateTimeAttribute(null=True)

    @classmethod
    def new_conversation(
        cls,
        end_user_id: str,
        label: str = DEFAULT_CONVERSATION_LABEL,
        conversation_id: str | None = None,
        default_branch_id: str | None = None,
        created_at: datetime | None = None,
        last_activity_at: datetime | None = None,
    ) -> "ConversationMetadataItem":
        conversation_id = conversation_id or str(uuid.uuid4())
        default_branch_id = default_branch_id or str(uuid.uuid4())
        created_at = created_at or datetime.now(timezone.utc)
        last_activity_at = last_activity_at or created_at

        return cls(
            PK=cls.conversation_pk(conversation_id),
            SK="METADATA",
            GSI1PK=ConversationTableItem.active_conversations_gsi_pk(end_user_id),
            GSI1SK=_make_active_conversations_gsi_sk(last_activity_at, conversation_id),
            end_user_id=end_user_id,
            label=label,
            created_at=created_at,
            last_activity_at=last_activity_at,
            default_branch_id=default_branch_id,
        )

    def record_activity(self, last_activity_at: datetime) -> None:
        self.last_activity_at = last_activity_at
        self.GSI1SK = _make_active_conversations_gsi_sk(
            last_activity_at, self.conversation_id
        )

    def record_deleted(self, deleted_at: datetime | None = None) -> None:
        deleted_at = deleted_at or datetime.now(timezone.utc)
        self.deleted_at = deleted_at
        self.GSI1PK = ConversationTableItem.deleted_conversations_gsi_pk(
            self.end_user_id
        )
        self.GSI1SK = _make_deleted_conversations_gsi_sk(
            deleted_at, self.conversation_id
        )


class ConversationBranchItem(ConversationTableItem, discriminator="Branch"):
    branch_id = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    updated_at = UTCDateTimeAttribute()
    parent_branch_id = UnicodeAttribute(null=True)
    forked_from_message_id = UnicodeAttribute(null=True)
    tip_message_id = UnicodeAttribute(null=True)
    tip_sequence = NumberAttribute(default=0)
    message_count = NumberAttribute(default=0)

    @classmethod
    def branch_sk(cls, branch_id: str) -> str:
        return _make_branch_sk(branch_id)

    @classmethod
    def new_default_branch(
        cls,
        conversation_id: str,
        branch_id: str,
        created_at: datetime | None = None,
    ) -> "ConversationBranchItem":
        created_at = created_at or datetime.now(timezone.utc)
        return cls(
            PK=cls.conversation_pk(conversation_id),
            SK=_make_branch_sk(branch_id),
            branch_id=branch_id,
            created_at=created_at,
            updated_at=created_at,
        )

    def record_message(
        self, message_id: str, sequence: int, updated_at: datetime
    ) -> None:
        self.tip_message_id = message_id
        self.tip_sequence = sequence
        self.message_count = sequence
        self.updated_at = updated_at


class ConversationMessageItem(ConversationTableItem, discriminator="Message"):
    message_id = UnicodeAttribute()
    branch_id = UnicodeAttribute()
    sequence = NumberAttribute()
    created_at = UTCDateTimeAttribute()
    participant = UnicodeAttribute()
    message_type = UnicodeAttribute()
    payload = MessagePayload()
    session_id = UnicodeAttribute(null=True)
    status = UnicodeAttribute(null=True)
    stop_reason = UnicodeAttribute(null=True)
    error_type = UnicodeAttribute(null=True)
    error_message = UnicodeAttribute(null=True)

    @classmethod
    def new_text_message(
        cls,
        conversation_id: str,
        branch_id: str,
        sequence: int,
        participant: MessageParticipant,
        text: str,
        message_id: str | None = None,
        created_at: datetime | None = None,
        session_id: str | None = None,
        status: MessageStatus | None = None,
        stop_reason: str | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> "ConversationMessageItem":
        message_id = message_id or str(uuid.uuid4())
        created_at = created_at or datetime.now(timezone.utc)
        message_type = _text_message_type_for_participant(participant)

        return cls(
            PK=cls.conversation_pk(conversation_id),
            SK=_make_message_sk(branch_id, sequence, message_id),
            message_id=message_id,
            branch_id=branch_id,
            sequence=sequence,
            created_at=created_at,
            participant=participant,
            message_type=message_type,
            payload={"text": text},
            session_id=session_id,
            status=status,
            stop_reason=stop_reason,
            error_type=error_type,
            error_message=error_message,
        )


class ConversationStreamItem(ConversationTableItem, discriminator="ConversationStream"):
    stream_id = UnicodeAttribute()
    end_user_id = UnicodeAttribute()
    message_id = UnicodeAttribute()
    runtime_session_id = UnicodeAttribute()
    status = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    cancelled_at = UTCDateTimeAttribute(null=True)

    @classmethod
    def stream_sk(cls, stream_id: str) -> str:
        return f"STREAM#{stream_id}"

    @classmethod
    def new_stream(
        cls,
        stream_id: str,
        conversation_id: str,
        end_user_id: str,
        message_id: str,
        runtime_session_id: str,
        created_at: datetime | None = None,
    ) -> "ConversationStreamItem":
        created_at = created_at or datetime.now(timezone.utc)

        return cls(
            PK=cls.conversation_pk(conversation_id),
            SK=cls.stream_sk(stream_id),
            stream_id=stream_id,
            end_user_id=end_user_id,
            message_id=message_id,
            runtime_session_id=runtime_session_id,
            status="active",
            created_at=created_at,
        )

    def record_cancelled(self, cancelled_at: datetime | None = None) -> None:
        self.status = "cancelled"
        self.cancelled_at = cancelled_at or datetime.now(timezone.utc)


def _make_branch_sk(branch_id: str) -> str:
    return f"BRANCH#{branch_id}"


def _make_message_sk(branch_id: str, sequence: int, message_id: str) -> str:
    return f"BRANCH#{branch_id}#MESSAGE#{sequence:010d}#{message_id}"


def _make_active_conversations_gsi_sk(
    last_activity_at: datetime, conversation_id: str
) -> str:
    timestamp = _serialise_timestamp(last_activity_at)
    return f"LAST_ACTIVITY#{timestamp}#CONVERSATION#{conversation_id}"


def _make_deleted_conversations_gsi_sk(
    deleted_at: datetime, conversation_id: str
) -> str:
    timestamp = _serialise_timestamp(deleted_at)
    return f"DELETED_AT#{timestamp}#CONVERSATION#{conversation_id}"


def _text_message_type_for_participant(
    participant: MessageParticipant,
) -> TextMessageType:
    match participant:
        case "user":
            return "UserMessageText"
        case "assistant":
            return "AssistantMessageText"


def _serialise_timestamp(timestamp: datetime) -> str:
    return timestamp.astimezone(timezone.utc).strftime(PYNAMODB_UTC_DATETIME_FORMAT)
