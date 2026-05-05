import pytest
from pydantic import ValidationError
from chat_api.v1.schemas.conversations import (
    ConversationPostRequest,
)


class TestConversationPostRequest:
    @pytest.mark.parametrize("field_name", ["message", "end_user_id"])
    def test_not_empty_fields(self, field_name):
        data = {"message": "Valid message", "end_user_id": "user-123"}
        data[field_name] = ""

        with pytest.raises(ValidationError) as excinfo:
            ConversationPostRequest(**data)

        assert f"{field_name} must not be empty" in str(excinfo.value)
