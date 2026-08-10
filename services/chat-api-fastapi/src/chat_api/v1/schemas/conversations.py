from pydantic import BaseModel, ValidationInfo, field_validator


class ConversationPostRequest(BaseModel):
    """
    Schema for a conversation and messages post request.

    **message:** The user's message to the agent.
    message with the correct user in the returned metadata and database.
    **session_id:** The ID of the session. This is used to associate the message with the correct
    session and is passed to the agent runtime to provide additional context. If no session_id is
    provided, a new one will be generated and returned in the response metadata.
    """

    message: str
    session_id: str | None = None

    @field_validator("message")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value


class ConversationPatchRequest(BaseModel):
    """
    Schema for a patch conversation request.

    **conversation_id:** The ID of the conversation to update.
    **title:** The new title for the conversation.
    """

    title: str

    @field_validator("title")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value
