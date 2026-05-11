import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from chat_api.main import app
from botocore.exceptions import ClientError


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def valid_payload():
    return {
        "message": "Hello world",
        "end_user_id": "user-123",
        "session_id": "session-123",
    }


@pytest.fixture
def mock_invoke():
    with patch("chat_api.v1.routers.conversations.invoke_agent_runtime") as mock:
        mock.return_value = {"response": MagicMock()}
        yield mock


@pytest.fixture(autouse=True)
def mock_persist():
    with patch("chat_api.v1.routers.conversations.persist_message") as mock:
        mock.return_value = "conversation-123"
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
        client.post("/v1/conversations", json=valid_payload)

        mock_persist.assert_called_once()
        assert_model_matches(mock_persist.call_args[0][0], valid_payload)

    def test_create_conversation_persists_generated_session_id(
        self, client, valid_payload, mock_invoke, mock_persist, mocker
    ):
        valid_payload.pop("session_id")
        mocker.patch("chat_api.v1.routers.conversations.uuid.uuid4", return_value="123")

        client.post("/v1/conversations", json=valid_payload)

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
        response = client.post("/v1/conversations", json=valid_payload)

        assert response.status_code == 200
        mock_invoke.assert_called_once()
        _, kwargs = mock_invoke.call_args
        assert kwargs["end_user_id"] == valid_payload["end_user_id"]
        assert kwargs["session_id"] == valid_payload["session_id"]
        assert mock_invoke.call_args.args[0] == valid_payload["message"]

    def test_create_conversation_200(self, client, valid_payload, mock_invoke):
        response = client.post("/v1/conversations", json=valid_payload)

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_create_conversation_200_event_generator_called_with_correct_args(
        self, client, valid_payload, mock_invoke, mock_event_gen
    ):
        client.post("/v1/conversations", json=valid_payload)

        mock_event_gen.assert_called_once()
        _, kwargs = mock_event_gen.call_args
        assert kwargs["agent_response"] == mock_invoke.return_value
        assert kwargs["end_user_id"] == valid_payload["end_user_id"]
        assert kwargs["session_id"] == valid_payload["session_id"]
        assert "conversation_id" in kwargs
        assert kwargs["background_tasks"] is not None

    def test_create_conversation_422_invalid_data(self, client, valid_payload):
        valid_payload["message"] = "  "
        response = client.post("/v1/conversations", json=valid_payload)

        assert response.status_code == 422
        assert "message must not be empty" in response.text

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
        response = client.post("/v1/conversations", json=valid_payload)

        data = response.json()

        assert response.status_code == 500
        assert (
            data["error_message"]
            == "An error occurred (TimeoutError) when calling the OperationName operation: Connection Timeout"
        )
        assert data["error_type"] == "ClientError"


class TestCreateMessage:
    def test_create_message_correct_args_passed_to_persist_user_message(
        self, client, valid_payload, mock_invoke, mock_persist
    ):
        client.post("/v1/conversations/conv-123/messages", json=valid_payload)

        mock_persist.assert_called_once()
        assert_model_matches(mock_persist.call_args[0][0], valid_payload)

    def test_create_message_persists_generated_session_id(
        self, client, valid_payload, mock_invoke, mock_persist, mocker
    ):
        valid_payload.pop("session_id")
        mocker.patch("chat_api.v1.routers.conversations.uuid.uuid4", return_value="123")

        client.post("/v1/conversations/conv-123/messages", json=valid_payload)

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
        client.post("/v1/conversations/conv-123/messages", json=valid_payload)

        mock_invoke.assert_called_once()
        _, kwargs = mock_invoke.call_args
        assert kwargs["end_user_id"] == valid_payload["end_user_id"]
        assert kwargs["session_id"] == valid_payload["session_id"]

    def test_create_message_200(self, client, valid_payload, mock_invoke):
        response = client.post(
            "/v1/conversations/conv-123/messages", json=valid_payload
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_create_message_200_event_generator_called_with_correct_args(
        self, client, valid_payload, mock_invoke, mock_event_gen
    ):
        client.post("/v1/conversations/conv-123/messages", json=valid_payload)

        mock_event_gen.assert_called_once()
        _, kwargs = mock_event_gen.call_args
        assert kwargs["conversation_id"] == "conv-123"
        assert kwargs["agent_response"] == mock_invoke.return_value

    def test_create_message_422_invalid_data(self, client, valid_payload):
        valid_payload["end_user_id"] = ""
        response = client.post(
            "/v1/conversations/conv-123/messages", json=valid_payload
        )

        assert response.status_code == 422
        assert "end_user_id" in response.text

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
            "/v1/conversations/conv-123/messages", json=valid_payload
        )

        data = response.json()
        assert response.status_code == 500
        assert (
            data["error_message"]
            == "An error occurred (TimeoutError) when calling the OperationName operation: Connection Timeout"
        )
        assert data["error_type"] == "ClientError"
