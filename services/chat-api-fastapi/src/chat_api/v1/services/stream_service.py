import asyncio
import datetime
import json
import uuid
from typing import Any

from chat_api.agent import parse_agent_response_stream
from chat_api.v1.data_models.messages import (
    ConversationAssistantMessage,
)
from chat_api.v1.errors import (
    ErrorEventReceivedFromAgentError,
    UnknownAgentEventTypeError,
)
from chat_api.v1.schemas.events import (
    CommonEventFields,
    ContentDeltaEvent,
    StreamEndEvent,
    StreamErrorEvent,
    StreamStartEvent,
)
from chat_api.v1.services.persistence_service import (
    get_conversation_repository,
    persist_message,
)


async def event_generator(
    agent_response: Any,
    conversation_id: str,
    end_user_id: str,
    session_id: str,
):
    """
    This function is responsible for generating the events that will be streamed back to the client.
    It takes the response from the agent and parses it into individual events, which are then yielded
    back to the client. It also handles persisting the assistant message to the database once the
    stream has ended, and error handling for any issues that may arise during the streaming process.

    **agent_response:** The raw response from the agent runtime, which is expected to be a stream of events.
    **conversation_id:** The unique identifier for the conversation. This is used to associate the events
    with the correct conversation in the returned metadata and database.
    **end_user_id:** The unique identifier for the end user. This is used to associate the events with the
    correct user in the returned metadata and database.
    **session_id:** The unique identifier for the session. This is used to associate the events with the
    correct session in the returned metadata and database.
    """

    message_id = str(uuid.uuid4())
    stream_id = str(uuid.uuid4())
    message = ""
    stream_created = False
    repository = get_conversation_repository()

    event_common: CommonEventFields = {
        "end_user_id": end_user_id,
        "session_id": session_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "stream_id": stream_id,
    }
    message_common = {
        "end_user_id": end_user_id,
        "session_id": session_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
    }
    stream_end_event: StreamEndEvent | None = None

    async def persist_assistant_message(
        *,
        status: str,
        stop_reason: str,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> None:
        conversation_msg = ConversationAssistantMessage(
            **message_common,
            message=message,
            status=status,
            stop_reason=stop_reason,
            error_type=error_type,
            error_message=error_message,
        )
        await persist_message(conversation_msg)

    async def is_stream_cancelled() -> bool:
        return stream_created and await asyncio.to_thread(
            repository.is_conversation_stream_cancelled,
            conversation_id=conversation_id,
            stream_id=stream_id,
            end_user_id=end_user_id,
        )

    def make_stream_end_event(stop_reason: str, complete: bool) -> StreamEndEvent:
        return StreamEndEvent(
            **event_common,
            stream_ended_at=datetime.datetime.now(datetime.UTC).isoformat(),
            stop_reason=stop_reason,
            complete=complete,
        )

    try:
        for chunk in parse_agent_response_stream(agent_response):
            data = json.loads(chunk["data"])

            match data["type"]:
                case "stream_start":
                    await asyncio.to_thread(
                        repository.create_conversation_stream,
                        conversation_id=conversation_id,
                        stream_id=stream_id,
                        end_user_id=end_user_id,
                        message_id=message_id,
                        runtime_session_id=session_id,
                    )
                    stream_created = True
                    event = StreamStartEvent(
                        **event_common,
                        stream_started_at=datetime.datetime.now(
                            datetime.UTC
                        ).isoformat(),
                    )
                    yield {"event": event.event, "data": event.model_dump_json()}

                case "content_delta":
                    content = data["delta"]
                    message += content
                    event = ContentDeltaEvent(content=content)
                    yield {"event": event.event, "data": event.model_dump_json()}

                case "stream_end":
                    is_cancelled = await is_stream_cancelled()
                    complete = bool(data.get("complete", True))
                    stop_reason = data["stop_reason"] or "end_turn"
                    if is_cancelled:
                        stop_reason = "cancelled_by_user"
                        complete = False

                    stream_end_event = make_stream_end_event(stop_reason, complete)
                    break
                case "error":
                    if await is_stream_cancelled():
                        stream_end_event = make_stream_end_event(
                            "cancelled_by_user", False
                        )
                        break

                    raise ErrorEventReceivedFromAgentError(
                        f"Error event received: {data['error_type']} - {data.get('error_message')}"
                    )
                case _:
                    raise UnknownAgentEventTypeError(
                        f"Received unknown event type: '{data.get('type')}'"
                    )
        else:
            if await is_stream_cancelled():
                stream_end_event = make_stream_end_event("cancelled_by_user", False)
            else:
                raise ErrorEventReceivedFromAgentError(
                    "Agent response stream ended before stream_end"
                )
    except Exception as e:
        error_type = e.__class__.__name__
        error_message = str(e)
        error_event = StreamErrorEvent(
            **event_common,
            stream_ended_at=datetime.datetime.now(datetime.UTC).isoformat(),
            error_type=error_type,
            error_message=error_message,
        )

        if message != "":
            await persist_assistant_message(
                status="error",
                stop_reason="error",
                error_type=error_type,
                error_message=error_message,
            )
        yield {"event": error_event.event, "data": error_event.model_dump_json()}
    else:
        if stream_end_event is not None:
            await persist_assistant_message(
                status="complete" if stream_end_event.complete else "cancelled",
                stop_reason=stream_end_event.stop_reason,
            )
            yield {
                "event": stream_end_event.event,
                "data": stream_end_event.model_dump_json(),
            }
    finally:
        if stream_created:
            await asyncio.to_thread(
                repository.delete_conversation_stream,
                conversation_id=conversation_id,
                stream_id=stream_id,
                end_user_id=end_user_id,
            )
