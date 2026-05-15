from pydantic import BaseModel
from datetime import datetime


class MessageResponse(BaseModel):
    participant: str
    content: str
    created_at: datetime


class ConversationResponse(BaseModel):
    label: str
    end_user_id: str
    created_at: datetime
    messages: list[MessageResponse]
