from datetime import datetime
from typing import cast

from pydantic import BaseModel, field_validator

from chat_api.conversation_persistence.data_models import (
    ConversationMessageItem,
    ConversationMetadataItem,
    MessageRole,
)


class CreateConversationInput(BaseModel):
    title: str
    user_id: str


class AddMessageInput(BaseModel):
    message: str

    @field_validator("message")
    def not_empty(cls, value):
        if not value.strip():
            raise ValueError("Message must not be empty")
        return value


class CreateConversationResponse(BaseModel):
    conversation_id: str


class ConversationResponse(BaseModel):
    id: str
    user_id: str
    title: str
    created_at: datetime

    @classmethod
    def from_item(cls, item: ConversationMetadataItem) -> "ConversationResponse":
        return cls(
            id=item.conversation_id,
            user_id=item.user_id,
            title=item.title,
            created_at=item.created_at,
        )


class MessageResponse(BaseModel):
    conversation_id: str
    content: str
    timestamp: datetime
    role: MessageRole

    @classmethod
    def from_item(cls, item: ConversationMessageItem) -> "MessageResponse":
        return cls(
            conversation_id=item.conversation_id,
            content=item.content,
            timestamp=item.timestamp,
            role=message_role_from_item(item.role),
        )


class GetConversationResponse(BaseModel):
    conversation: ConversationResponse
    messages: list[MessageResponse]


def message_role_from_item(role: str) -> MessageRole:
    if role not in ("user", "assistant"):
        raise ValueError(f"Unexpected message role in DynamoDB item: {role}")
    return cast(MessageRole, role)
