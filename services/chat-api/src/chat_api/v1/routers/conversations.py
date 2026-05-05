from fastapi import APIRouter, BackgroundTasks
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
    conversation_id: str | None = None,
) -> str:
    conversation_user_message = ConversationUserMessage(
        message=user_message.message,
        end_user_id=user_message.end_user_id,
        session_id=user_message.session_id,
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
    request: ConversationPostRequest, background_tasks: BackgroundTasks
):
    session_id = request.session_id or str(uuid.uuid4())
    conversation_id = await _persist_user_message(request)
    background_tasks.add_task(
        name_conversation,
        conversation_id,
        request.message,
    )

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=request.end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
        background_tasks=background_tasks,
    )


@router.post("/{conversation_id}/messages")
async def create_message(
    conversation_id: str,
    request: ConversationPostRequest,
    background_tasks: BackgroundTasks,
):
    session_id = request.session_id or str(uuid.uuid4())

    await _persist_user_message(request, conversation_id)

    return await _generate_and_stream_response(
        message=request.message,
        end_user_id=request.end_user_id,
        session_id=session_id,
        conversation_id=conversation_id,
        background_tasks=background_tasks,
    )
