from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response
from sse_starlette.sse import EventSourceResponse

from chat_api.v1.schemas.conversations import (
    ConversationPostRequest,
    ConversationPatchRequest,
)
from chat_api.v1.data_models.messages import ConversationUserMessage
from chat_api.agent import invoke_agent_runtime, stop_agent_runtime_session
import uuid
from chat_api.v1.services.persistence_service import (
    persist_message,
    get_conversation_repository,
    name_conversation,
    rename_conversation,
)
from chat_api.v1.services.stream_service import (
    event_generator,
)
from chat_api.v1.persistence.conversation_repository import (
    ConversationNotFoundError,
    ConversationStreamNotFoundError,
)
from chat_api.v1.data_models.responses import (
    ConversationResponse,
    MessageResponse,
    ConversationPatchResponse,
)

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])

RECENT_MESSAGE_COUNT = 50
RECENT_CONVERSATION_COUNT = 20


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
        end_user_id,
    )

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
    )


@router.get(
    "", response_model=list[ConversationResponse], response_model_exclude_none=True
)
async def view_conversations(
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for getting the recent conversations for the user.
    """
    repo = get_conversation_repository()

    conversations = repo.get_conversations_for_user(
        end_user_id, RECENT_CONVERSATION_COUNT
    )

    return [
        ConversationResponse(
            id=conversation.conversation_id,
            label=conversation.label,
            end_user_id=conversation.end_user_id,
            created_at=conversation.created_at,
        )
        for conversation in conversations
    ]


@router.get("/{conversation_id}")
async def view_conversation(
    conversation_id: str,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for getting details about a specific conversation.
    """
    repo = get_conversation_repository()

    try:
        conversation, messages = repo.get_conversation_with_messages(
            conversation_id, end_user_id, RECENT_MESSAGE_COUNT
        )
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return ConversationResponse(
        id=conversation.conversation_id,
        label=conversation.label,
        end_user_id=conversation.end_user_id,
        created_at=conversation.created_at,
        messages=[
            MessageResponse(
                participant=message.participant,
                content=message.payload.text,
                created_at=message.created_at,
            )
            for message in messages
        ],
    )


@router.patch("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    request: ConversationPatchRequest,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for updating an existing conversation. For now, you can only update
    the conversation title.

    **request:** The ConversationPatchRequest object containing the updated conversation title.
    **end_user_id:** The unique identifier for the end user, passed in the request header.
    """

    try:
        conversation = await rename_conversation(
            conversation_id=conversation_id,
            title=request.title,
            end_user_id=end_user_id,
        )
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return ConversationPatchResponse(
        label=conversation.label,
        end_user_id=conversation.end_user_id,
        updated_at=conversation.last_activity_at,
    )


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for deleting a specific conversation.
    """
    repo = get_conversation_repository()

    try:
        repo.delete_conversation(conversation_id, end_user_id)
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return Response(status_code=204)


@router.delete("/{conversation_id}/streams/{stream_id}", status_code=204)
async def delete_conversation_stream(
    conversation_id: str,
    stream_id: str,
    end_user_id: str = Header(...),
):
    """
    This endpoint is responsible for cancelling a specific conversation stream.
    """
    repo = get_conversation_repository()

    try:
        stream = repo.cancel_conversation_stream(
            conversation_id, stream_id, end_user_id
        )
    except ConversationStreamNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation stream not found")

    stop_agent_runtime_session(stream.runtime_session_id)

    return Response(status_code=204)


@router.post("/{conversation_id}/messages")
async def create_message(
    conversation_id: str,
    request: ConversationPostRequest,
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
    """
    session_id = request.session_id or str(uuid.uuid4())

    try:
        await _persist_user_message(request, end_user_id, session_id, conversation_id)
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
    )
