import pytest
from pydantic import ValidationError
from chat_api.v1.schemas.conversations import (
    ConversationPostRequest,
    ConversationPatchRequest,
)


class TestConversationPostRequest:
    def test_message_fields(self):
        with pytest.raises(ValidationError) as excinfo:
            ConversationPostRequest(message=" ", session_id="session-123")

        assert "message must not be empty" in str(excinfo.value)


class TestConversationPatchRequest:
    def test_title_not_empty(self):
        data = {"title": ""}

        with pytest.raises(ValidationError) as excinfo:
            ConversationPatchRequest(**data)

        assert "title must not be empty" in str(excinfo.value)
