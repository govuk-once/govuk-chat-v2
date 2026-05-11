from fastapi import BackgroundTasks
from chat_api.v1.data_models.messages import (
    ConversationAssistantMessage,
)
from chat_api.v1.schemas.events import (
    CommonEventFields,
    StreamStartEvent,
    ContentDeltaEvent,
    StreamEndEvent,
    StreamErrorEvent,
)
from chat_api.agent import parse_agent_response_stream
import uuid
import datetime
from typing import Any
from chat_api.v1.services.persistence_service import (
    persist_message,
)
from chat_api.v1.errors import (
    UnknownAgentEventTypeError,
    ErrorEventReceivedFromAgentError,
)
import json


async def event_generator(
    agent_response: Any,
    conversation_id: str,
    end_user_id: str,
    session_id: str,
    background_tasks: BackgroundTasks,
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
    **background_tasks:** The FastAPI BackgroundTasks instance, used to schedule the persist message and
    name conversation background tasks.
    """

    message_id = str(uuid.uuid4())
    message = ""
    status = ""
    stop_reason = ""
    error_type = None
    error_message = None

    common: CommonEventFields = {
        "end_user_id": end_user_id,
        "session_id": session_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
    }
    try:
        for chunk in parse_agent_response_stream(agent_response):
            data = json.loads(chunk["data"])

            match data["type"]:
                case "stream_start":
                    event = StreamStartEvent(
                        **common,
                        stream_started_at=datetime.datetime.now(
                            datetime.timezone.utc
                        ).isoformat(),
                    )
                    yield {"event": event.event, "data": event.model_dump_json()}

                case "content_delta":
                    content = data["delta"]
                    message += content
                    event = ContentDeltaEvent(content=content)
                    yield {"event": event.event, "data": event.model_dump_json()}

                case "stream_end":
                    stop_reason = data["stop_reason"] or "end_turn"
                    event = StreamEndEvent(
                        **common,
                        stream_ended_at=datetime.datetime.now(
                            datetime.timezone.utc
                        ).isoformat(),
                        stop_reason=stop_reason,
                        complete=bool(data.get("complete", True)),
                    )
                    status = "complete" if event.complete else "cancelled"
                    yield {"event": event.event, "data": event.model_dump_json()}
                case "error":
                    raise ErrorEventReceivedFromAgentError(
                        f"Error event received: {data['error_type']} - {data.get('error_message')}"
                    )
                case _:
                    raise UnknownAgentEventTypeError(
                        f"Received unknown event type: '{data.get('type')}'"
                    )

        conversation_msg = ConversationAssistantMessage(
            **common,
            message=message,
            status=status,
            stop_reason=stop_reason,
            error_type=error_type,
            error_message=error_message,
        )
        background_tasks.add_task(persist_message, conversation_msg)
    except Exception as e:
        error_type = e.__class__.__name__
        error_message = str(e)
        error_event = StreamErrorEvent(
            **common,
            stream_ended_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            error_type=error_type,
            error_message=error_message,
        )
        yield {"event": error_event.event, "data": error_event.model_dump_json()}

        if message != "":
            conversation_msg = ConversationAssistantMessage(
                **common,
                message=message,
                status="error",
                stop_reason="error",
                error_type=error_type,
                error_message=error_message,
            )
            background_tasks.add_task(persist_message, conversation_msg)
