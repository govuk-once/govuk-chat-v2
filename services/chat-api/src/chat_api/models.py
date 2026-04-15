from dataclasses import dataclass, field
from datetime import datetime, timezone
import uuid


@dataclass
class Conversation:
    id: str
    user_id: str
    title: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_item(self):
        return {
            "PK": f"CONVERSATION#{self.id}",
            "SK": "METADATA",
            "GSI1PK": f"USER#{self.user_id}",
            "GSI1SK": _make_conversation_gsi_sk(self.created_at, self.id),
            "entityType": "METADATA",
            "user_id": self.user_id,
            "title": self.title,
            "created_at": _serialise_timestamp(self.created_at),
        }

    @classmethod
    def from_item(cls, item: dict):
        return cls(
            id=item["PK"].split("#")[1],
            user_id=item["user_id"],
            title=item["title"],
            created_at=datetime.fromisoformat(item["created_at"]),
        )


@dataclass
class UserMessage:
    conversation_id: str
    content: str
    role: str = "user"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_item(self):
        return {
            "PK": f"CONVERSATION#{self.conversation_id}",
            "SK": _make_message_sk(self.timestamp),
            "entityType": "MESSAGE",
            "role": self.role,
            "content": self.content,
        }

    @classmethod
    def from_item(cls, item: dict):
        return cls(
            conversation_id=item["PK"].split("#")[1],
            content=item["content"],
            timestamp=datetime.fromisoformat(item["SK"].split("#")[1]),
        )


@dataclass
class AssistantMessage:
    conversation_id: str
    content: str
    role: str = "assistant"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_item(self):
        return {
            "PK": f"CONVERSATION#{self.conversation_id}",
            "SK": _make_message_sk(self.timestamp),
            "entityType": "MESSAGE",
            "role": self.role,
            "content": self.content,
        }

    @classmethod
    def from_item(cls, item: dict):
        return cls(
            conversation_id=item["PK"].split("#")[1],
            content=item["content"],
            timestamp=datetime.fromisoformat(item["SK"].split("#")[1]),
        )


def _make_message_sk(timestamp: datetime) -> str:
    ts = _serialise_timestamp(timestamp)
    return f"MSG#{ts}#{uuid.uuid4().hex}"


def _make_conversation_gsi_sk(created_at: datetime, conversation_id: str) -> str:
    ts = _serialise_timestamp(created_at)
    return f"CREATED_AT#{ts}#CONVERSATION#{conversation_id}"


def _serialise_timestamp(timestamp: datetime) -> str:
    return timestamp.isoformat(timespec="microseconds").replace("+00:00", "Z")
