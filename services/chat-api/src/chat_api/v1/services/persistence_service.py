import asyncio
from typing import cast

from chat_api.v1.data_models.messages import (
    ConversationUserMessage,
    ConversationAssistantMessage,
)
from chat_api.v1.persistence.conversation_repository import ConversationRepository
from chat_api.v1.persistence.data_models import MessageStatus
from chat_api.v1.services.llm_invoker_service import (
    invoke_model,
)


def get_conversation_repository() -> ConversationRepository:
    """
    Returns the repository used by persistence operations.

    Kept behind a function so tests can replace the repository factory.
    """
    return ConversationRepository()


async def persist_message(
    message: ConversationUserMessage | ConversationAssistantMessage,
) -> str:
    """
    Persists a V1 conversation message through the repository.

    **message:** A user or assistant message. User messages without a conversation
    ID create a new conversation; user messages with one are appended to that
    conversation; assistant messages append the streamed response result.

    Returns the conversation ID for the persisted message.
    """
    repository = get_conversation_repository()
    if isinstance(message, ConversationUserMessage):
        if message.conversation_id is None:
            conversation = await asyncio.to_thread(
                repository.create_conversation_with_user_message,
                end_user_id=message.end_user_id,
                message=message.message,
                session_id=message.session_id,
            )
            return conversation.conversation_id

        await asyncio.to_thread(
            repository.append_user_message,
            conversation_id=message.conversation_id,
            message=message.message,
            session_id=message.session_id,
        )
        return message.conversation_id

    await asyncio.to_thread(
        repository.append_assistant_message,
        conversation_id=message.conversation_id,
        message=message.message,
        session_id=message.session_id,
        status=cast(MessageStatus, message.status),
        stop_reason=message.stop_reason,
        message_id=message.message_id,
        error_type=message.error_type,
        error_message=message.error_message,
    )

    return message.conversation_id


async def name_conversation(conversation_id: str, message: str):
    """
    Generates and stores a short title for a conversation.

    **conversation_id:** The conversation record to update.
    **message:** The user message text used to generate the title.
    """
    prompt = (
        f"Summarise this query into a 3-5 word title. Output ONLY the title: {message}"
    )
    """
    This will be utlised to persist the conversation name to the database. For now, it just invokes the model to
    get a title for the conversation and returns a string with the conversation_id and title, but in the future we
    will want to update the conversation record in the database with the generated title.
    """
    title = await invoke_model(prompt)

    # message = Message.update(title=title).where(Message.conversation_id == conversation_id)

    return f"Conversation {conversation_id} named: {title}"
