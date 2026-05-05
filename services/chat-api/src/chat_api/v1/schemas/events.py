from pydantic import BaseModel
from typing import Literal, TypedDict


class CommonEventFields(TypedDict):
    conversation_id: str
    message_id: str
    session_id: str
    end_user_id: str


class BaseConversationEvent(BaseModel):
    conversation_id: str
    message_id: str
    session_id: str
    end_user_id: str


class StreamStartEvent(BaseConversationEvent):
    event: Literal["stream_start"] = "stream_start"
    stream_started_at: str


class ContentDeltaEvent(BaseModel):
    event: Literal["content_delta"] = "content_delta"
    content: str


class StreamEndEvent(BaseConversationEvent):
    event: Literal["stream_end"] = "stream_end"
    stream_ended_at: str
    stop_reason: str = "end_turn"
    complete: bool = True


class StreamErrorEvent(BaseConversationEvent):
    event: Literal["error"] = "error"
    stop_reason: Literal["error"] = "error"
    complete: Literal[False] = False
    stream_ended_at: str
    error_type: str
    error_message: str | None
