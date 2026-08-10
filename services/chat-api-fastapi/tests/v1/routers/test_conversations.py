from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from moto import mock_aws

from chat_api.main import app
from chat_api.v1.persistence.conversation_repository import (
    ConversationNotFoundError,
    ConversationRepository,
    ConversationStreamNotFoundError,
)
from chat_api.v1.persistence.data_models import (
    DEFAULT_CONVERSATION_LABEL,
    ConversationTableItem,
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def valid_payload():
    return {
        "message": "Hello world",
        "session_id": "session-123",
    }


@pytest.fixture
def mock_invoke():
    with patch("chat_api.v1.routers.conversations.invoke_agent_runtime") as mock:
        mock.return_value = {"response": MagicMock()}
        yield mock


@pytest.fixture
def dynamo_table():
    with mock_aws():
        ConversationTableItem.create_table(billing_mode="PAY_PER_REQUEST", wait=True)
        dynamodb = boto3.resource("dynamodb", region_name="eu-west-1")
        yield dynamodb.Table("test-table")


@pytest.fixture
def repository(dynamo_table):
    return ConversationRepository()


@pytest.fixture(autouse=True)
def mock_persist():
    with patch("chat_api.v1.routers.conversations.persist_message") as mock:
        mock.return_value = "conversation-123"
        yield mock


@pytest.fixture(autouse=True)
def mock_name_conversation():
    with patch("chat_api.v1.routers.conversations.name_conversation") as mock:
        yield mock


@pytest.fixture(autouse=True)
def mock_event_gen():
    with patch("chat_api.v1.routers.conversations.event_generator") as mock:
        yield mock


def assert_model_matches(model, expected_dict):
    model_dict = model.model_dump()
    for key, value in expected_dict.items():
        assert model_dict[key] == value


class TestCreateConversation:
    def test_create_conversation_correct_args_passed_to_persist_user_message(
        self, client, valid_payload, mock_invoke, mock_persist
    ):
        client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        mock_persist.assert_called_once()
        assert_model_matches(mock_persist.call_args[0][0], valid_payload)

    def test_create_conversation_persists_generated_session_id(
        self, client, valid_payload, mock_invoke, mock_persist, mocker
    ):
        valid_payload.pop("session_id")
        mocker.patch("chat_api.v1.routers.conversations.uuid.uuid4", return_value="123")

        client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        mock_persist.assert_called_once()
        assert_model_matches(
            mock_persist.call_args[0][0],
            {
                **valid_payload,
                "session_id": "123",
            },
        )

    def test_create_conversation_correct_args_are_passed_to_agent(
        self, client, valid_payload, mock_invoke
    ):
        response = client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        assert response.status_code == 200
        mock_invoke.assert_called_once()
        _, kwargs = mock_invoke.call_args
        assert kwargs["end_user_id"] == "user-123"
        assert kwargs["session_id"] == valid_payload["session_id"]
        assert mock_invoke.call_args.args[0] == valid_payload["message"]

    def test_create_conversation_200(self, client, valid_payload, mock_invoke):
        response = client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_create_conversation_200_event_generator_called_with_correct_args(
        self, client, valid_payload, mock_invoke, mock_event_gen
    ):
        client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        mock_event_gen.assert_called_once()
        _, kwargs = mock_event_gen.call_args
        assert kwargs["agent_response"] == mock_invoke.return_value
        assert kwargs["end_user_id"] == "user-123"
        assert kwargs["session_id"] == valid_payload["session_id"]
        assert "conversation_id" in kwargs
        assert "background_tasks" not in kwargs

    def test_create_conversation_200_name_conversation_background_tasks_called_with_correct_args(
        self, client, valid_payload, mock_event_gen, mock_invoke, mock_name_conversation
    ):
        with patch("fastapi.BackgroundTasks.add_task") as mock_add_task:
            client.post(
                "/v1/conversations",
                headers={"end-user-id": "user-123"},
                json=valid_payload,
            )

            args, _kwargs = mock_add_task.call_args

            assert args[0] == mock_name_conversation
            assert args[1] == "conversation-123"  # conversation_id
            assert args[2] == valid_payload["message"]
            assert args[3] == "user-123"

    def test_create_conversation_422_invalid_json(self, client, valid_payload):
        valid_payload["message"] = "  "
        response = client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        assert response.status_code == 422
        assert "message must not be empty" in response.text

    def test_create_conversation_422_no_end_user_id_in_headers(
        self, client, valid_payload
    ):
        response = client.post("/v1/conversations", json=valid_payload)

        assert response.status_code == 422
        assert "end-user-id" in response.text

    def test_create_conversation_500_when_agent_call_returns_client_error(
        self, client, valid_payload, mock_invoke
    ):
        mock_invoke.side_effect = ClientError(
            {
                "Error": {"Message": "Connection Timeout", "Code": "TimeoutError"},
                "ResponseMetadata": {
                    "HTTPStatusCode": 500,
                    "RequestId": "mock-request-id",
                    "HostId": "mock-host-id",
                    "HTTPHeaders": {},
                    "RetryAttempts": 0,
                },
            },
            "OperationName",
        )
        response = client.post(
            "/v1/conversations", headers={"end-user-id": "user-123"}, json=valid_payload
        )

        data = response.json()

        assert response.status_code == 500
        assert (
            data["error_message"]
            == "An error occurred (TimeoutError) when calling the OperationName operation: Connection Timeout"
        )
        assert data["error_type"] == "ClientError"


class TestGetConversation:
    def test_get_conversation_not_found(self, client, dynamo_table):
        response = client.get(
            "/v1/conversations/123", headers={"end-user-id": "user-123"}
        )

        assert response.status_code == 404

        data = response.json()
        assert data["detail"] == "Conversation not found"

    def test_get_conversation_successful_response(
        self, client, dynamo_table, repository
    ):
        conversation, message_1 = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
            session_id="session-123",
        )
        message_2 = repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Hello again",
            end_user_id="user-123",
        )

        response = client.get(
            f"/v1/conversations/{conversation.conversation_id}",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == conversation.conversation_id
        assert data["label"] == DEFAULT_CONVERSATION_LABEL
        assert data["end_user_id"] == "user-123"
        assert data["created_at"]

        assert len(data["messages"]) == 2
        assert data["messages"][0]["participant"] == "user"
        assert data["messages"][0]["content"] == "Hello world"
        assert (
            datetime.fromisoformat(data["messages"][0]["created_at"])
            == message_1.created_at
        )

        assert data["messages"][1]["participant"] == "user"
        assert data["messages"][1]["content"] == "Hello again"
        assert (
            datetime.fromisoformat(data["messages"][1]["created_at"])
            == message_2.created_at
        )

    def test_get_conversation_successful_response_message_count(
        self, client, dynamo_table, repository
    ):
        conversation, _ = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello 1",
            session_id="session-123",
        )
        repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Hello 2",
            end_user_id="user-123",
        )
        repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Hello 3",
            end_user_id="user-123",
        )
        repository.append_user_message(
            conversation_id=conversation.conversation_id,
            message="Hello 4",
            end_user_id="user-123",
        )

        with patch("chat_api.v1.routers.conversations.RECENT_MESSAGE_COUNT", 2):
            response = client.get(
                f"/v1/conversations/{conversation.conversation_id}",
                headers={"end-user-id": "user-123"},
            )

            assert response.status_code == 200

            data = response.json()
            assert len(data["messages"]) == 2


class TestGetConversations:
    def test_get_conversations_successful_response(self, client, repository):
        conversation_1, _ = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )
        conversation_2, _ = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )
        conversation_3, _ = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )

        response = client.get(
            "/v1/conversations",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 200

        data = response.json()

        assert (len(data)) == 3

        assert data[0]["label"] == DEFAULT_CONVERSATION_LABEL
        assert data[0]["end_user_id"] == "user-123"
        assert data[0]["id"] == conversation_3.conversation_id
        assert (
            datetime.fromisoformat(data[0]["created_at"]) == conversation_3.created_at
        )

        assert data[1]["label"] == DEFAULT_CONVERSATION_LABEL
        assert data[1]["end_user_id"] == "user-123"
        assert data[1]["id"] == conversation_2.conversation_id
        assert (
            datetime.fromisoformat(data[1]["created_at"]) == conversation_2.created_at
        )

        assert data[2]["label"] == DEFAULT_CONVERSATION_LABEL
        assert data[2]["end_user_id"] == "user-123"
        assert data[2]["id"] == conversation_1.conversation_id
        assert (
            datetime.fromisoformat(data[2]["created_at"]) == conversation_1.created_at
        )

    def test_get_conversations_successful_response_conversation_count(
        self, client, repository
    ):
        repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )
        repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )
        repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
        )

        with patch("chat_api.v1.routers.conversations.RECENT_CONVERSATION_COUNT", 2):
            response = client.get(
                "/v1/conversations/",
                headers={"end-user-id": "user-123"},
            )

            assert response.status_code == 200

            data = response.json()
            assert len(data) == 2


class TestDeleteConversation:
    @pytest.fixture
    def mock_repository(self):
        with patch(
            "chat_api.v1.routers.conversations.get_conversation_repository"
        ) as mock:
            yield mock.return_value

    def test_delete_conversation_204_calls_repository_with_correct_args(
        self, client, mock_repository
    ):
        response = client.delete(
            "/v1/conversations/conversation-123",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 204
        assert response.content == b""
        mock_repository.delete_conversation.assert_called_once_with(
            "conversation-123", "user-123"
        )

    def test_delete_conversation_404_if_conversation_not_found(
        self, client, mock_repository
    ):
        mock_repository.delete_conversation.side_effect = ConversationNotFoundError(
            "Conversation not found"
        )

        response = client.delete(
            "/v1/conversations/conversation-123",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Conversation not found"

    def test_delete_conversation_422_no_end_user_id_in_headers(
        self, client, mock_repository
    ):
        response = client.delete("/v1/conversations/conversation-123")

        assert response.status_code == 422
        assert "end-user-id" in response.text
        mock_repository.delete_conversation.assert_not_called()


class TestDeleteConversationStream:
    @pytest.fixture
    def mock_repository(self):
        with patch(
            "chat_api.v1.routers.conversations.get_conversation_repository"
        ) as mock:
            yield mock.return_value

    @pytest.fixture
    def mock_stop_agent_runtime_session(self):
        with patch(
            "chat_api.v1.routers.conversations.stop_agent_runtime_session"
        ) as mock:
            yield mock

    def test_delete_conversation_stream_204_cancels_stream_and_stops_agentcore_session(
        self, client, mock_repository, mock_stop_agent_runtime_session
    ):
        mock_repository.cancel_conversation_stream.return_value = SimpleNamespace(
            runtime_session_id="runtime-session-123"
        )

        response = client.delete(
            "/v1/conversations/conversation-123/streams/stream-123",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 204
        assert response.content == b""
        mock_repository.cancel_conversation_stream.assert_called_once_with(
            "conversation-123", "stream-123", "user-123"
        )
        mock_stop_agent_runtime_session.assert_called_once_with("runtime-session-123")

    def test_delete_conversation_stream_404_if_stream_not_found(
        self, client, mock_repository, mock_stop_agent_runtime_session
    ):
        mock_repository.cancel_conversation_stream.side_effect = (
            ConversationStreamNotFoundError("Conversation stream not found")
        )

        response = client.delete(
            "/v1/conversations/conversation-123/streams/stream-123",
            headers={"end-user-id": "user-123"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Conversation stream not found"
        mock_stop_agent_runtime_session.assert_not_called()

    def test_delete_conversation_stream_422_no_end_user_id_in_headers(
        self, client, mock_repository, mock_stop_agent_runtime_session
    ):
        response = client.delete(
            "/v1/conversations/conversation-123/streams/stream-123"
        )

        assert response.status_code == 422
        assert "end-user-id" in response.text
        mock_repository.cancel_conversation_stream.assert_not_called()
        mock_stop_agent_runtime_session.assert_not_called()


class TestCreateMessage:
    def test_create_message_correct_args_passed_to_persist_user_message(
        self, client, valid_payload, mock_invoke, mock_persist
    ):
        client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        mock_persist.assert_called_once()
        assert_model_matches(mock_persist.call_args[0][0], valid_payload)

    def test_create_message_persists_generated_session_id(
        self, client, valid_payload, mock_invoke, mock_persist, mocker
    ):
        valid_payload.pop("session_id")
        mocker.patch("chat_api.v1.routers.conversations.uuid.uuid4", return_value="123")

        client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        mock_persist.assert_called_once()
        assert_model_matches(
            mock_persist.call_args[0][0],
            {
                **valid_payload,
                "session_id": "123",
            },
        )

    def test_create_message_correct_args_are_passed_to_agent(
        self, client, valid_payload, mock_invoke
    ):
        client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        mock_invoke.assert_called_once()
        _, kwargs = mock_invoke.call_args
        assert kwargs["end_user_id"] == "user-123"
        assert kwargs["session_id"] == valid_payload["session_id"]

    def test_create_message_200(self, client, valid_payload, mock_invoke):
        response = client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_create_message_200_event_generator_called_with_correct_args(
        self, client, valid_payload, mock_invoke, mock_event_gen
    ):
        client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        mock_event_gen.assert_called_once()
        _, kwargs = mock_event_gen.call_args
        assert kwargs["conversation_id"] == "conv-123"
        assert kwargs["agent_response"] == mock_invoke.return_value

    def test_create_message_404_if_conversation_not_found(
        self, client, valid_payload, mock_persist
    ):
        mock_persist.side_effect = ConversationNotFoundError("Conversation not found")
        response = client.post(
            "/v1/conversations/nonexistent-conv/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        assert response.status_code == 404
        assert "Conversation not found" in response.text

    def test_create_message_422_invalid_json(self, client, valid_payload):
        valid_payload["message"] = "  "
        response = client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        assert response.status_code == 422
        assert "message" in response.text

    def test_create_message_422_no_end_user_id_in_headers(self, client, valid_payload):
        response = client.post(
            "/v1/conversations/conv-123/messages",
            json=valid_payload,
        )

        assert response.status_code == 422
        assert "end-user-id" in response.text

    def test_create_message_500_when_agent_call_returns_client_error(
        self, client, valid_payload, mock_invoke
    ):
        mock_invoke.side_effect = ClientError(
            {
                "Error": {"Message": "Connection Timeout", "Code": "TimeoutError"},
                "ResponseMetadata": {
                    "HTTPStatusCode": 500,
                    "RequestId": "mock-request-id",
                    "HostId": "mock-host-id",
                    "HTTPHeaders": {},
                    "RetryAttempts": 0,
                },
            },
            "OperationName",
        )
        response = client.post(
            "/v1/conversations/conv-123/messages",
            headers={"end-user-id": "user-123"},
            json=valid_payload,
        )

        data = response.json()
        assert response.status_code == 500
        assert (
            data["error_message"]
            == "An error occurred (TimeoutError) when calling the OperationName operation: Connection Timeout"
        )
        assert data["error_type"] == "ClientError"


class TestUpdateConversation:
    def test_update_conversation_200(self, client, repository):
        conversation, _ = repository.create_conversation_with_user_message(
            end_user_id="user-123",
            message="Hello world",
            session_id="session-123",
        )
        response = client.patch(
            f"/v1/conversations/{conversation.conversation_id}",
            headers={"end-user-id": "user-123"},
            json={"title": "Updated Title"},
        )

        assert response.status_code == 200
        assert response.json()["label"] == "Updated Title"
        assert response.json()["end_user_id"] == "user-123"
        assert (
            datetime.fromisoformat(response.json()["updated_at"])
            > conversation.created_at
        )

    def test_update_coversation_404_conversation_not_found(self, client, repository):
        response = client.patch(
            "/v1/conversations/nonexistent-conv",
            headers={"end-user-id": "user-123"},
            json={"title": "New Title"},
        )

        assert response.status_code == 404
        assert response.json() == {"detail": "Conversation not found"}

    def test_update_conversation_422_invalid_json(self, client):
        response = client.patch(
            "/v1/conversations/conv-123",
            headers={"end-user-id": "user-123"},
            json={"title": ""},
        )

        assert response.status_code == 422
        assert "title" in response.text

    def test_update_conversation_422_no_end_user_id_in_headers(self, client):
        response = client.patch(
            "/v1/conversations/conv-123", json={"title": "New Title"}
        )

        assert response.status_code == 422
        assert "end-user-id" in response.text
