import pytest
from pydantic import ValidationError
from chat_api.v1.schemas.conversations import (
    ConversationPostRequest,
)


class TestConversationPostRequest:
    def test_message_fields(self):
        with pytest.raises(ValidationError) as excinfo:
            ConversationPostRequest(message=" ", session_id="session-123")

        assert "message must not be empty" in str(excinfo.value)
