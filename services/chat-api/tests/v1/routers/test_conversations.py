import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from chat_api.main import app
from botocore.exceptions import ClientError
from chat_api.v1.persistence.conversation_repository import (
    ConversationNotFoundError,
    ConversationRepository,
)
from moto import mock_aws
from chat_api.v1.persistence.data_models import (
    ConversationTableItem,
    DEFAULT_CONVERSATION_LABEL,
)
from datetime import datetime

import boto3


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
        assert kwargs["background_tasks"] is not None

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
        conversation, message_1 = repository.create_conversation_with_user_message(
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
