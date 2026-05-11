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
    """
    Will be used to persist messages to the database. For now, it just prints the message to the console and
    returns the conversation_id that was passed in (or generated if it was a user message with no conversation_id).

    **message:** The message object to be persisted, which can be either a ConversationUserMessage or ConversationAssistantMessage.
    This object contains the message text and relevant metadata such as end_user_id, session_id, and conversation_id.
    """
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
    """
    This will be utlised to persist the conversation name to the database. For now, it just invokes the model to
    get a title for the conversation and returns a string with the conversation_id and title, but in the future we
    will want to update the conversation record in the database with the generated title.
    """
    title = await invoke_model(prompt)

    # message = Message.update(title=title).where(Message.conversation_id == conversation_id)

    return f"Conversation {conversation_id} named: {title}"
