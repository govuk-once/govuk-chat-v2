from fastapi import APIRouter, BackgroundTasks, Header
from sse_starlette.sse import EventSourceResponse

from chat_api.v1.schemas.conversations import ConversationPostRequest
from chat_api.v1.data_models.messages import ConversationUserMessage
from chat_api.agent import invoke_agent_runtime
import uuid
from chat_api.v1.services.persistence_service import (
    persist_message,
    name_conversation,
)
from chat_api.v1.services.stream_service import (
    event_generator,
)

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


async def _persist_user_message(
    user_message: ConversationPostRequest,
    end_user_id: str,
    session_id: str,
    conversation_id: str | None = None,
) -> str:
    """
    This function is responsible for persisting a user message to the database.

    **user_message:** The ConversationPostRequest object containing the user's message and
    relevant metadata.
    **conversation_id:** The unique identifier for the conversation. If this is not provided,
    the message will be persisted to a new coversation.
    """
    conversation_user_message = ConversationUserMessage(
        message=user_message.message,
        end_user_id=end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
    )
    return await persist_message(conversation_user_message)


async def _generate_and_stream_response(
    message: str,
    end_user_id: str,
    session_id: str,
    conversation_id: str,
    background_tasks: BackgroundTasks,
):
    """
    This function is responsible for invoking the agent runtime with the user's message
    and streaming the response back to the client. It calls the invoke_agent_runtime
    function to get the agent's response, and then utilises the event_generator function to
    parse the agent's response into individual events that are streamed back to the client.

    **message:** The user's message that will be sent to the agent runtime.
    **end_user_id:** The unique identifier for the end user.
    **session_id:** The unique identifier for the session.
    **conversation_id:** The unique identifier for the conversation.
    **background_tasks:** The FastAPI BackgroundTasks instance, used to schedule background tasks.
    """
    response = invoke_agent_runtime(
        message, end_user_id=end_user_id, session_id=session_id
    )

    return EventSourceResponse(
        event_generator(
            agent_response=response,
            conversation_id=conversation_id,
            end_user_id=end_user_id,
            session_id=session_id,
            background_tasks=background_tasks,
        )
    )


@router.post("")
async def create_conversation(
    request: ConversationPostRequest,
    background_tasks: BackgroundTasks,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for creating a new conversation. It takes the user's
    message and relevant metadata, persists the initial user message to the database,
    generates a conversation_id, and then invokes the agent runtime to get the response.
    The response is then streamed back to the client.

    **request:** The ConversationPostRequest object containing the user's message and relevant metadata.
    **end_user_id:** The unique identifier for the end user, passed in the request header.
    **background_tasks:** The FastAPI BackgroundTasks instance, used to schedule background tasks.
    """
    session_id = request.session_id or str(uuid.uuid4())
    conversation_id = await _persist_user_message(request, end_user_id, session_id)
    background_tasks.add_task(
        name_conversation,
        conversation_id,
        request.message,
    )

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
        background_tasks=background_tasks,
    )


@router.post("/{conversation_id}/messages")
async def create_message(
    conversation_id: str,
    request: ConversationPostRequest,
    background_tasks: BackgroundTasks,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for adding a new message to an existing conversation.
    It takes the user's message and relevant metadata, persists the user message to the
    database, and then invokes the agent runtime to get the response. The response is
    then streamed back to the client.

    **conversation_id:** The unique identifier for the conversation that the message will be added to.
    **request:** The ConversationPostRequest object containing the user's message and relevant metadata.
    **end_user_id:** The unique identifier for the end user, passed in the request header.
    **background_tasks:** The FastAPI BackgroundTasks instance, used to schedule background tasks.
    """
    session_id = request.session_id or str(uuid.uuid4())

    await _persist_user_message(request, end_user_id, session_id, conversation_id)

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
        background_tasks=background_tasks,
    )
