from pydantic import BaseModel, field_validator, ValidationInfo


class ConversationUserMessage(BaseModel):
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
