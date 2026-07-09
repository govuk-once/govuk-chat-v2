from pydantic import BaseModel, field_validator, ValidationInfo


class ConversationUserMessage(BaseModel):
    """
    Represents a user message in a conversation.

    **message:** The content of the user's message.
    **end_user_id:** The unique identifier for the end user sending the message.
    **session_id:** The unique identifier for the session.
    **conversation_id:** The unique identifier for the conversation. If this is not provided, a new
    conversation will be created when the message is persisted to the database.
    """

    message: str
    end_user_id: str
    session_id: str | None = None
    conversation_id: str | None = None

    @field_validator("message", "end_user_id")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value


class ConversationAssistantMessage(BaseModel):
    """
    Represents an assistant message in a conversation.

    **message:** The content of the assistant's message.
    **status:** The status of the message (e.g., "complete", "cancelled", "error").
    **stop_reason:** The reason why the message generation stopped. Defaults to "end_turn".
    **end_user_id:** The unique identifier for the end user associated with the message.
    **session_id:** The unique identifier for the session.
    **conversation_id:** The unique identifier for the conversation.
    **message_id:** The unique identifier for the message.
    **error_type:** The type of error, if any occurred during message processing.
    **error_message:** The error message, if any occurred during message processing.
    """

    message: str
    status: str
    stop_reason: str = "end_turn"
    end_user_id: str
    session_id: str
    conversation_id: str
    message_id: str
    error_type: str | None = None
    error_message: str | None = None

    @field_validator(
        "status",
        "end_user_id",
        "session_id",
        "conversation_id",
        "message_id",
    )
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value

    @field_validator("status")
    def valid_status(cls, value):
        valid_statuses = {"complete", "cancelled", "error"}
        if value not in valid_statuses:
            raise ValueError(f"status must be one of {valid_statuses}, got '{value}'")
        return value
