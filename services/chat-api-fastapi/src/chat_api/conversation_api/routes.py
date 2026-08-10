from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from chat_api.conversation_api.schemas import (
    AddMessageInput,
    ConversationResponse,
    CreateConversationInput,
    CreateConversationResponse,
    GetConversationResponse,
    MessageResponse,
)
from chat_api.conversation_persistence.conversation_repository import (
    ConversationRepository,
)

router = APIRouter()

ConversationRepositoryDependency = Annotated[
    ConversationRepository, Depends(ConversationRepository)
]


@router.post("/conversations")
def create_conversation(
    input: CreateConversationInput,
    repository: ConversationRepositoryDependency,
) -> CreateConversationResponse:
    conversation = repository.create_conversation(input.user_id, input.title)
    return CreateConversationResponse(conversation_id=conversation.conversation_id)


@router.post("/conversations/{conversation_id}/messages")
def add_message(
    conversation_id: str,
    user_input: AddMessageInput,
    repository: ConversationRepositoryDependency,
) -> MessageResponse:
    message = repository.add_message(conversation_id, "user", user_input.message)
    return MessageResponse.from_item(message)


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str,
    repository: ConversationRepositoryDependency,
) -> GetConversationResponse:
    result = repository.get_conversation_with_messages(conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation_item, message_items = result
    return GetConversationResponse(
        conversation=ConversationResponse.from_item(conversation_item),
        messages=[MessageResponse.from_item(message) for message in message_items],
    )


@router.get("/users/{user_id}/conversations")
def list_conversations_for_user(
    user_id: str,
    repository: ConversationRepositoryDependency,
) -> list[ConversationResponse]:
    conversations = repository.list_conversations_for_user(user_id)
    return [ConversationResponse.from_item(item) for item in conversations]
