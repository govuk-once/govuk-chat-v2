import asyncio
from typing import cast

from chat_api.v1.data_models.messages import (
    ConversationAssistantMessage,
    ConversationUserMessage,
)
from chat_api.v1.persistence.conversation_repository import ConversationRepository
from chat_api.v1.persistence.data_models import ConversationMetadataItem, MessageStatus
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
            conversation, _ = await asyncio.to_thread(
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
            end_user_id=message.end_user_id,
        )
        return message.conversation_id

    await asyncio.to_thread(
        repository.append_assistant_message,
        conversation_id=message.conversation_id,
        message=message.message,
        session_id=message.session_id,
        end_user_id=message.end_user_id,
        status=cast(MessageStatus, message.status),
        stop_reason=message.stop_reason,
        message_id=message.message_id,
        error_type=message.error_type,
        error_message=message.error_message,
    )

    return message.conversation_id


async def name_conversation(
    conversation_id: str, message: str, end_user_id: str
) -> str:
    """
    Generates and stores a short title for a conversation.

    **conversation_id:** The conversation record to update.
    **message:** The user message text used to generate the title.
    **end_user_id:** The ID of the end user who owns the conversation.

    Failures are contained so title generation cannot prevent later background
    persistence tasks from running.
    """
    try:
        repository = get_conversation_repository()
        prompt = f"Summarise this query into a 3-5 word title. Output ONLY the title: {message}"
        title = await invoke_model(prompt)

        await asyncio.to_thread(
            repository.update_conversation_label,
            conversation_id=conversation_id,
            label=title,
            end_user_id=end_user_id,
        )

        return f"Conversation {conversation_id} named: {title}"
    except Exception as e:  # noqa: BLE001
        return f"Conversation {conversation_id} could not be named: {e}"


async def rename_conversation(
    conversation_id: str, title: str, end_user_id: str
) -> ConversationMetadataItem:
    """
    Updates the title of an existing conversation.

    **conversation_id:** The conversation record to update.
    **title:** The new title for the conversation.
    **end_user_id:** The ID of the end user associated with the conversation.
    """

    repository = get_conversation_repository()
    return await asyncio.to_thread(
        repository.update_conversation_label,
        conversation_id=conversation_id,
        label=title,
        end_user_id=end_user_id,
    )
