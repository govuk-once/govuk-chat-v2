from pydantic import BaseModel
from typing import Literal, TypedDict


class CommonEventFields(TypedDict):
    """
    Common fields that are included in all events. This is used to ensure that
    all events yielded to the client have the necessary context for the conversation.
    """

    conversation_id: str
    message_id: str
    session_id: str
    end_user_id: str


class BaseConversationEvent(BaseModel):
    """
    Base class for all conversation events. This includes the common fields
    that are present in all events related to a conversation.
    """

    conversation_id: str
    message_id: str
    session_id: str
    end_user_id: str


class StreamStartEvent(BaseConversationEvent):
    """
    Event indicating the start of a stream. This is sent to the client when
    the agent begins streaming a response.
    """

    event: Literal["stream_start"] = "stream_start"
    stream_started_at: str


class ContentDeltaEvent(BaseModel):
    """
    Event indicating a delta of content from the agent. This is sent to the client
    as the agent streams its response.
    """

    event: Literal["content_delta"] = "content_delta"
    content: str


class StreamEndEvent(BaseConversationEvent):
    """
    Event indicating the end of a stream. This is sent to the client when the agent has
    finished streaming its response.

    **stream_ended_at:** The timestamp indicating when the stream ended. This is used to
    calculate the duration of the stream on the client side.
    **stop_reason:** The reason why the stream ended. This is populated based on the
    stop_reason provided by the agent runtime, and defaults to "end_turn" if no stop_reason
    is provided.
    **complete:** A boolean indicating whether the agent completed it's response or if the
    stream was ended prematurely (for example due to user cancellation).
    """

    event: Literal["stream_end"] = "stream_end"
    stream_ended_at: str
    stop_reason: str = "end_turn"
    complete: bool = True


class StreamErrorEvent(BaseConversationEvent):
    """
    Event indicating an error occurred during the stream. This is sent to the client when
    the agent encounters an error while streaming its response.

    **stream_ended_at:** The timestamp indicating when the error occurred. This is used to
    calculate the duration of the stream on the client side.
    **error_type:** The type of error that occurred. This is populated based on the error
    information provided by the agent runtime.
    **error_message:** A message describing the error that occurred. This is populated based on the
    error information provided by the agent runtime.
    """

    event: Literal["error"] = "error"
    stop_reason: Literal["error"] = "error"
    complete: Literal[False] = False
    stream_ended_at: str
    error_type: str
    error_message: str | None
