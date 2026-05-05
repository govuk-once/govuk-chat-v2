from chat_api.v1.data_models.messages import (
    ConversationUserMessage,
    ConversationAssistantMessage,
)
import uuid
from chat_api.v1.services.llm_invoker_service import (
    invoke_model,
)


async def persist_message(
    message: ConversationUserMessage | ConversationAssistantMessage,
) -> str:
    # This will be utlised to persist a message and conversation record (if required)
    # to the database once the stream has ended. For now, it just prints the question to the console.

    if message.conversation_id is None:
        conversation_id = str(uuid.uuid4())
        attrs = message.model_dump()
        attrs["conversation_id"] = conversation_id
    else:
        conversation_id = message.conversation_id
        attrs = message.model_dump()

    if isinstance(message, ConversationUserMessage):
        attrs["type"] = "user"
    elif isinstance(message, ConversationAssistantMessage):
        attrs["type"] = "assistant"

    # message = Message.save(**attrs)

    # We would want to return the saved message here, but for now i'll just retun the conversation_id that we will
    # pass back in the stream events so we can assert on it in the tests.
    # return message

    return conversation_id


async def name_conversation(conversation_id: str, message: str):
    prompt = (
        f"Summarise this query into a 3-5 word title. Output ONLY the title: {message}"
    )
    title = await invoke_model(prompt)

    return f"Conversation {conversation_id} named: {title}"
