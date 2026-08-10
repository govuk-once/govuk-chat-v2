import pytest
from pydantic import ValidationError

from chat_api.v1.data_models.messages import (
    ConversationAssistantMessage,
    ConversationUserMessage,
)


class TestConversationUserMessage:
    @pytest.mark.parametrize("field_name", ["message", "end_user_id"])
    def test_not_empty_fields(self, field_name):
        data = {"message": "Valid message", "end_user_id": "user-123"}
        data[field_name] = ""

        with pytest.raises(ValidationError) as excinfo:
            ConversationUserMessage(**data)

        assert f"{field_name} must not be empty" in str(excinfo.value)


class TestConversationAssistantMessage:
    @pytest.mark.parametrize(
        "field_name",
        ["status", "end_user_id", "session_id", "conversation_id", "message_id"],
    )
    def test_not_empty_fields(self, field_name):
        data = {
            "message": "Hello",
            "status": "complete",
            "end_user_id": "u1",
            "session_id": "s1",
            "conversation_id": "c1",
            "message_id": "m1",
        }
        data[field_name] = ""

        with pytest.raises(ValidationError) as excinfo:
            ConversationAssistantMessage(**data)

        assert f"{field_name} must not be empty" in str(excinfo.value)

    @pytest.mark.parametrize("status_value", ["complete", "cancelled", "error"])
    def test_valid_statuses(self, status_value):
        message = ConversationAssistantMessage(
            message="Hi",
            status=status_value,
            end_user_id="u1",
            session_id="s1",
            conversation_id="c1",
            message_id="m1",
        )
        assert message.status == status_value

    def test_invalid_status_raises_error(self):
        with pytest.raises(ValidationError) as excinfo:
            ConversationAssistantMessage(
                message="Hi",
                status="not-a-status",
                end_user_id="u1",
                session_id="s1",
                conversation_id="c1",
                message_id="m1",
            )
        assert "status must be one of" in str(excinfo.value)
