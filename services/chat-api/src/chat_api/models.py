from dataclasses import dataclass, field
from datetime import datetime, timezone
import uuid


@dataclass
class Conversation:
    id: str
    title: str

    def to_item(self):
        return {
            "PK": f"CONVERSATION#{self.id}",
            "SK": "METADATA",
            "entityType": "METADATA",
            "title": self.title,
        }

    @classmethod
    def from_item(cls, item: dict):
        return cls(
            id=item["PK"].split("#")[1],
            title=item["title"],
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
    ts = timestamp.isoformat(timespec="microseconds").replace("+00:00", "Z")
    return f"MSG#{ts}#{uuid.uuid4().hex}"
