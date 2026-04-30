from typing import TypedDict, Literal, Union, NotRequired


class StreamStartEvent(TypedDict):
    type: Literal["stream_start"]


class ContentDeltaEvent(TypedDict):
    type: Literal["content_delta"]
    delta: str


class StreamEndEvent(TypedDict):
    type: Literal["stream_end"]
    complete: bool
    stop_reason: NotRequired[str]


class ErrorEvent(TypedDict):
    type: Literal["error"]
    error_type: str
    error_message: str


AgentStreamEvent = Union[
    StreamStartEvent, ContentDeltaEvent, StreamEndEvent, ErrorEvent
]
