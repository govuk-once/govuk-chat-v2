from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, RootModel


class StreamStartEvent(BaseModel):
    type: Literal["stream_start"] = "stream_start"


class ContentDeltaEvent(BaseModel):
    type: Literal["content_delta"] = "content_delta"
    delta: str


class StreamEndEvent(BaseModel):
    type: Literal["stream_end"] = "stream_end"
    complete: bool
    stop_reason: str | None = None


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    error_type: str
    error_message: str | None = None


AgentStreamEvent = Union[
    StreamStartEvent, ContentDeltaEvent, StreamEndEvent, ErrorEvent
]


class AgentStreamEventModel(RootModel):
    root: Annotated[AgentStreamEvent, Field(discriminator="type")]
