import os
import uuid
from datetime import UTC, datetime
from typing import Literal, TypeAlias

from pynamodb.attributes import (
    DiscriminatorAttribute,
    UnicodeAttribute,
    UTCDateTimeAttribute,
)
from pynamodb.indexes import AllProjection, GlobalSecondaryIndex
from pynamodb.models import Model

PYNAMODB_UTC_DATETIME_FORMAT = "%Y-%m-%dT%H:%M:%S.%f+0000"
MessageRole: TypeAlias = Literal["user", "assistant"]


class ConversationsByUserIndex(GlobalSecondaryIndex):
    class Meta:
        index_name = "GSI1"
        projection = AllProjection()

    GSI1PK = UnicodeAttribute(hash_key=True)
    GSI1SK = UnicodeAttribute(range_key=True)


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
    def list_for_conversation(
        cls, conversation_id: str
    ) -> list["ConversationTableItem"]:
        return list(cls.query(f"CONVERSATION#{conversation_id}"))

    @property
    def conversation_id(self) -> str:
        return self.PK.split("#")[1]


class ConversationMetadataItem(ConversationTableItem, discriminator="METADATA"):
    GSI1PK = UnicodeAttribute()
    GSI1SK = UnicodeAttribute()
    user_id = UnicodeAttribute()
    title = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()

    @classmethod
    def new_conversation(
        cls,
        user_id: str,
        title: str,
        created_at: datetime | None = None,
        conversation_id: str | None = None,
    ) -> "ConversationMetadataItem":
        created_at = created_at or datetime.now(UTC)
        conversation_id = conversation_id or uuid.uuid4().hex
        return cls(
            PK=f"CONVERSATION#{conversation_id}",
            SK="METADATA",
            GSI1PK=f"USER#{user_id}",
            GSI1SK=_make_conversation_gsi_sk(created_at, conversation_id),
            user_id=user_id,
            title=title,
            created_at=created_at,
        )

    @classmethod
    def list_for_user(cls, user_id: str) -> list["ConversationMetadataItem"]:
        return list(
            cls.conversations_by_user.query(
                f"USER#{user_id}",
                scan_index_forward=False,
            )
        )


class ConversationMessageItem(ConversationTableItem, discriminator="MESSAGE"):
    role = UnicodeAttribute()
    content = UnicodeAttribute()
    timestamp = UTCDateTimeAttribute()

    @classmethod
    def new_message(
        cls,
        conversation_id: str,
        role: MessageRole,
        content: str,
        timestamp: datetime | None = None,
    ) -> "ConversationMessageItem":
        timestamp = timestamp or datetime.now(UTC)
        return cls(
            PK=f"CONVERSATION#{conversation_id}",
            SK=_make_message_sk(timestamp),
            role=role,
            content=content,
            timestamp=timestamp,
        )


def _make_message_sk(timestamp: datetime) -> str:
    ts = _serialise_timestamp(timestamp)
    return f"MSG#{ts}#{uuid.uuid4().hex}"


def _make_conversation_gsi_sk(created_at: datetime, conversation_id: str) -> str:
    ts = _serialise_timestamp(created_at)
    return f"CREATED_AT#{ts}#CONVERSATION#{conversation_id}"


def _serialise_timestamp(timestamp: datetime) -> str:
    return timestamp.astimezone(UTC).strftime(PYNAMODB_UTC_DATETIME_FORMAT)
