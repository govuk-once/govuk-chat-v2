from pydantic import BaseModel, field_validator, ValidationInfo


class ConversationPostRequest(BaseModel):
    """
    Schema for a conversation and messages post request.

    **message:** The user's message to the agent.
    **end_user_id:** The ID of the end user sending the message. This is used to associate the
    message with the correct user in the returned metadata and database.
    **session_id:** The ID of the session. This is used to associate the message with the correct
    session and is passed to the agent runtime to provide additional context. If no session_id is
    provided, a new one will be generated and returned in the response metadata.
    """

    message: str
    end_user_id: str
    session_id: str | None = None

    @field_validator("message", "end_user_id")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value
