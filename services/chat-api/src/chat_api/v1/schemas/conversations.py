from pydantic import BaseModel, field_validator, ValidationInfo


class ConversationPostRequest(BaseModel):
    message: str
    end_user_id: str
    session_id: str | None = None

    @field_validator("message", "end_user_id")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value
