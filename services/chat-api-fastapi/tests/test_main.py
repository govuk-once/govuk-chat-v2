import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from chat_api.conversation_persistence.conversation_repository import (
    ConversationRepository,
)
from chat_api.main import app
from chat_api.conversation_persistence.data_models import (
    ConversationMessageItem,
    ConversationMetadataItem,
    MessageRole,
)
from agent_runtime_types import StreamStartEvent, ContentDeltaEvent, StreamEndEvent

client = TestClient(app)


def utc_time(second: int) -> datetime:
    return datetime(2026, 1, 1, 12, 0, second, tzinfo=timezone.utc)


def make_conversation(
    conversation_id: str, title: str, second: int
) -> ConversationMetadataItem:
    return ConversationMetadataItem.new_conversation(
        conversation_id=conversation_id,
        user_id="user-123",
        title=title,
        created_at=utc_time(second),
    )


def make_message(
    conversation_id: str, role: MessageRole, content: str, second: int
) -> ConversationMessageItem:
    return ConversationMessageItem.new_message(
        conversation_id=conversation_id,
        role=role,
        content=content,
        timestamp=utc_time(second),
    )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def repository(mocker):
    repository = mocker.Mock(spec=ConversationRepository)
    app.dependency_overrides[ConversationRepository] = lambda: repository
    return repository


def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}


def test_stream(mocker):
    tokens = "This is an SSE stream".split(" ")
    sleep_mock = mocker.patch("asyncio.sleep", new_callable=AsyncMock)

    response = client.get("/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.text.splitlines()
    for index, token in enumerate(tokens):
        starting_index = index * 3
        assert body[starting_index] == "event: delta"
        content = {"type": "delta", "content": token}
        assert body[starting_index + 1] == f"data: {json.dumps(content)}"

    assert sleep_mock.call_count == len(tokens)


def test_invoke_agent(mocker):
    agent_responses = [
        StreamStartEvent(),
        ContentDeltaEvent(delta="This is"),
        ContentDeltaEvent(delta="an"),
        ContentDeltaEvent(delta="SSE stream"),
        StreamEndEvent(complete=True),
    ]

    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            for content in agent_responses:
                yield f"data: {content.model_dump_json()}".encode(
                    "utf-8"
                )  # iter_lines returns bytes

    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {
        "response": MockStreamingBody(),
        "contentType": "text/event-stream",
    }

    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    response = client.post(
        "/invoke-agent",
        json={
            "message": "How much VAT do I pay?",
            "session_id": "123",
            "end_user_id": "user_123",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = [line for line in response.text.splitlines() if line]
    for index, content in enumerate(agent_responses):
        assert body[index] == f"data: {content.model_dump_json()}"


def test_invoke_agent_handles_invalid_json(mocker):
    class MockStreamingBody:
        def iter_lines(self, chunk_size=None):
            yield "data: invalid_json".encode("utf-8")

    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.return_value = {
        "response": MockStreamingBody(),
        "contentType": "text/event-stream",
    }

    mocker.patch("chat_api.agent.boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    response = client.post(
        "/invoke-agent",
        json={
            "message": "How much VAT do I pay?",
            "session_id": "123",
            "end_user_id": "user_123",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = [line for line in response.text.splitlines() if line]
    assert body == [
        f"data: {json.dumps({'type': 'error', 'error_type': 'agent_error', 'error_message': None}, separators=(',', ':'))}",
    ]


def test_invoke_agent_validates_message_presence(mocker):
    response = client.post(
        "/invoke-agent", json={"session_id": "123", "end_user_id": "123"}
    )
    assert response.status_code == 422


def test_invoke_agent_validates_message_empty_string(mocker):
    response = client.post(
        "/invoke-agent", json={"session_id": "123", "end_user_id": "123", "message": ""}
    )
    assert response.status_code == 422


def test_invoke_agent_validates_end_user_id_presence(mocker):
    response = client.post(
        "/invoke-agent", json={"message": "How much VAT do I pay?", "session_id": "123"}
    )
    assert response.status_code == 422


def test_invoke_agent_validates_end_user_id_empty_string(mocker):
    response = client.post(
        "/invoke-agent",
        json={
            "message": "How much VAT do I pay?",
            "session_id": "123",
            "end_user_id": "",
        },
    )
    assert response.status_code == 422


def test_invoke_agent_validates_session_id_presence(mocker):
    response = client.post(
        "/invoke-agent",
        json={"message": "How much VAT do I pay?", "end_user_id": "123"},
    )
    assert response.status_code == 422


def test_invoke_agent_validates_session_id_empty_string(mocker):
    response = client.post(
        "/invoke-agent",
        json={
            "message": "How much VAT do I pay?",
            "end_user_id": "123",
            "session_id": "",
        },
    )
    assert response.status_code == 422


def test_invoke_agent_error(mocker):
    mock_client = mocker.Mock()
    mock_client.invoke_agent_runtime.side_effect = Exception("Bedrock error")

    mocker.patch("boto3.client", return_value=mock_client)
    mocker.patch.dict("os.environ", {"AGENT_RUNTIME_ARN": "test-arn"})

    response = client.post(
        "/invoke-agent",
        json={
            "message": "How much VAT do I pay?",
            "session_id": "123",
            "end_user_id": "user_123",
        },
    )

    assert response.status_code == 500
    assert response.json() == {"error": "Bedrock error"}


def test_create_conversation(repository):
    repository.create_conversation.return_value = make_conversation(
        "conversation-123", "Prototype chat", 0
    )

    response = client.post(
        "/conversations",
        json={"title": "Prototype chat", "user_id": "user-123"},
    )

    assert response.status_code == 200
    assert response.json() == {"conversation_id": "conversation-123"}
    repository.create_conversation.assert_called_once_with("user-123", "Prototype chat")


def test_add_message(repository):
    repository.add_message.return_value = make_message(
        conversation_id="conversation-123",
        role="user",
        content="How much tax should I pay?",
        second=3,
    )

    response = client.post(
        "/conversations/conversation-123/messages",
        json={"message": "How much tax should I pay?"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "conversation_id": "conversation-123",
        "content": "How much tax should I pay?",
        "timestamp": "2026-01-01T12:00:03Z",
        "role": "user",
    }
    repository.add_message.assert_called_once_with(
        "conversation-123", "user", "How much tax should I pay?"
    )


def test_create_conversation_requires_user_id(repository):
    response = client.post(
        "/conversations",
        json={"title": "Prototype chat"},
    )

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/json")
    repository.create_conversation.assert_not_called()


def test_list_conversations_for_user(repository):
    repository.list_conversations_for_user.return_value = [
        make_conversation("conversation-2", "Most recent", 5),
        make_conversation("conversation-1", "Older conversation", 0),
    ]

    response = client.get("/users/user-123/conversations")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "conversation-2",
            "user_id": "user-123",
            "title": "Most recent",
            "created_at": "2026-01-01T12:00:05Z",
        },
        {
            "id": "conversation-1",
            "user_id": "user-123",
            "title": "Older conversation",
            "created_at": "2026-01-01T12:00:00Z",
        },
    ]
    repository.list_conversations_for_user.assert_called_once_with("user-123")


def test_list_conversations_for_user_returns_empty_list(repository):
    repository.list_conversations_for_user.return_value = []

    response = client.get("/users/user-999/conversations")

    assert response.status_code == 200
    assert response.json() == []
    repository.list_conversations_for_user.assert_called_once_with("user-999")


def test_get_conversation(repository):
    repository.get_conversation_with_messages.return_value = (
        make_conversation("conversation-123", "Prototype chat", 0),
        [
            make_message(
                conversation_id="conversation-123",
                role="user",
                content="Hello",
                second=1,
            ),
            make_message(
                conversation_id="conversation-123",
                role="assistant",
                content="Hi there",
                second=2,
            ),
        ],
    )

    response = client.get("/conversations/conversation-123")

    assert response.status_code == 200
    assert response.json() == {
        "conversation": {
            "id": "conversation-123",
            "user_id": "user-123",
            "title": "Prototype chat",
            "created_at": "2026-01-01T12:00:00Z",
        },
        "messages": [
            {
                "conversation_id": "conversation-123",
                "content": "Hello",
                "timestamp": "2026-01-01T12:00:01Z",
                "role": "user",
            },
            {
                "conversation_id": "conversation-123",
                "content": "Hi there",
                "timestamp": "2026-01-01T12:00:02Z",
                "role": "assistant",
            },
        ],
    }
    repository.get_conversation_with_messages.assert_called_once_with(
        "conversation-123"
    )


def test_get_conversation_returns_404_for_missing_conversation(repository):
    repository.get_conversation_with_messages.return_value = None

    response = client.get("/conversations/conversation-999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Conversation not found"}
    repository.get_conversation_with_messages.assert_called_once_with(
        "conversation-999"
    )
