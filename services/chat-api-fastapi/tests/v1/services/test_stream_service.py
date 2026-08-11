import json
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from chat_api.v1.data_models.messages import ConversationAssistantMessage
from chat_api.v1.services.stream_service import event_generator


def assert_base_event_fields(
    data, expected_end_user_id, expected_conversation_id, expected_session_id
):
    assert data["conversation_id"] == expected_conversation_id
    assert data["end_user_id"] == expected_end_user_id
    assert data["session_id"] == expected_session_id
    assert uuid.UUID(data["message_id"])
    assert uuid.UUID(data["stream_id"])


@pytest.fixture
def base_context():
    return {
        "conversation_id": "conversation-1",
        "end_user_id": "user-1",
        "session_id": "session-1",
    }


@pytest.fixture
def mock_stream_parser():
    def _patcher(chunks):
        return patch(
            "chat_api.v1.services.stream_service.parse_agent_response_stream",
            return_value=iter(chunks),
        )

    return _patcher


@pytest.fixture(autouse=True)
def mock_repository():
    with patch(
        "chat_api.v1.services.stream_service.get_conversation_repository"
    ) as mock:
        repository = mock.return_value
        repository.is_conversation_stream_cancelled.return_value = False
        yield repository


@pytest.fixture(autouse=True)
def mock_persist_message():
    with patch(
        "chat_api.v1.services.stream_service.persist_message",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


@pytest.mark.asyncio
async def test_event_generator_complete_agent_response(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello "})},
        {"data": json.dumps({"type": "content_delta", "delta": "world!"})},
        {
            "data": json.dumps(
                {"type": "stream_end", "stop_reason": "end_turn", "complete": True}
            )
        },
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)
        events = [event async for event in generator]

        stream_start_event = events[0]
        stream_start_data = json.loads(stream_start_event["data"])
        assert stream_start_event["event"] == "stream_start"
        assert_base_event_fields(
            stream_start_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert "stream_started_at" in stream_start_data
        assert datetime.fromisoformat(stream_start_data["stream_started_at"])

        first_content_event = events[1]
        first_content_data = json.loads(first_content_event["data"])
        assert first_content_event["event"] == "content_delta"
        assert first_content_data["content"] == "Hello "

        second_content_event = events[2]
        second_content_data = json.loads(second_content_event["data"])
        assert second_content_event["event"] == "content_delta"
        assert second_content_data["content"] == "world!"

        stream_end_event = events[3]
        stream_end_data = json.loads(stream_end_event["data"])
        assert stream_end_event["event"] == "stream_end"
        assert_base_event_fields(
            stream_end_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert stream_end_data["stop_reason"] == "end_turn"
        assert stream_end_data["complete"] is True
        assert "stream_ended_at" in stream_end_data
        assert stream_end_data["stream_id"] == stream_start_data["stream_id"]

        mock_repository.create_conversation_stream.assert_called_once_with(
            conversation_id=base_context["conversation_id"],
            stream_id=stream_start_data["stream_id"],
            end_user_id=base_context["end_user_id"],
            message_id=stream_start_data["message_id"],
            runtime_session_id=base_context["session_id"],
        )
        assert mock_repository.is_conversation_stream_cancelled.call_count == 1
        mock_repository.is_conversation_stream_cancelled.assert_called_with(
            conversation_id=base_context["conversation_id"],
            stream_id=stream_start_data["stream_id"],
            end_user_id=base_context["end_user_id"],
        )
        mock_repository.delete_conversation_stream.assert_called_once_with(
            conversation_id=base_context["conversation_id"],
            stream_id=stream_start_data["stream_id"],
            end_user_id=base_context["end_user_id"],
        )

        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=stream_end_data["message_id"],
                message="Hello world!",
                status="complete",
                stop_reason="end_turn",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_persistence_error_on_complete_stream_is_not_sent_as_stream_error(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello"})},
        {
            "data": json.dumps(
                {"type": "stream_end", "stop_reason": "end_turn", "complete": True}
            )
        },
    ]
    mock_persist_message.side_effect = RuntimeError("dynamodb write failed")

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)
        events = []

        with pytest.raises(RuntimeError, match="dynamodb write failed"):
            async for event in generator:
                events.append(event)

    stream_start_data = json.loads(events[0]["data"])

    assert [event["event"] for event in events] == ["stream_start", "content_delta"]
    mock_persist_message.assert_awaited_once()
    persisted_message = mock_persist_message.await_args.args[0]
    assert persisted_message.status == "complete"
    assert persisted_message.message == "Hello"
    mock_repository.delete_conversation_stream.assert_called_once_with(
        conversation_id=base_context["conversation_id"],
        stream_id=stream_start_data["stream_id"],
        end_user_id=base_context["end_user_id"],
    )


@pytest.mark.asyncio
async def test_event_generator_cancelled_from_stream_state(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "1"})},
        {
            "data": json.dumps(
                {"type": "stream_end", "stop_reason": "end_turn", "complete": True}
            )
        },
    ]
    mock_repository.is_conversation_stream_cancelled.return_value = True

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)

        events = [event async for event in generator]

        stream_start_data = json.loads(events[0]["data"])
        content_event = events[1]
        stream_end_event = events[2]
        stream_end_data = json.loads(stream_end_event["data"])

        assert json.loads(content_event["data"])["content"] == "1"
        assert stream_end_event["event"] == "stream_end"
        assert stream_end_data["stop_reason"] == "cancelled_by_user"
        assert stream_end_data["complete"] is False
        assert stream_end_data["stream_id"] == stream_start_data["stream_id"]

        mock_repository.is_conversation_stream_cancelled.assert_called_once_with(
            conversation_id=base_context["conversation_id"],
            stream_id=stream_start_data["stream_id"],
            end_user_id=base_context["end_user_id"],
        )
        mock_repository.delete_conversation_stream.assert_called_once_with(
            conversation_id=base_context["conversation_id"],
            stream_id=stream_start_data["stream_id"],
            end_user_id=base_context["end_user_id"],
        )
        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=stream_end_data["message_id"],
                message="1",
                status="cancelled",
                stop_reason="cancelled_by_user",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_cancelled_by_user(
    base_context, mock_stream_parser, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello "})},
        {
            "data": json.dumps(
                {
                    "type": "stream_end",
                    "stop_reason": "cancelled_by_user",
                    "complete": False,
                }
            )
        },
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)

        events = [event async for event in generator]

        stream_end_event = events[2]
        stream_end_data = json.loads(stream_end_event["data"])

        assert stream_end_event["event"] == "stream_end"
        assert_base_event_fields(
            stream_end_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert stream_end_data["stop_reason"] == "cancelled_by_user"
        assert stream_end_data["complete"] is False

        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=stream_end_data["message_id"],
                message="Hello ",
                status="cancelled",
                stop_reason="cancelled_by_user",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_error_in_stream(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello "})},
        {
            "data": json.dumps(
                {
                    "type": "error",
                    "error_type": "context_length_exceeded",
                    "error_message": "Too many tokens",
                }
            )
        },
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)
        events = [event async for event in generator]

        error_event = events[2]
        error_data = json.loads(error_event["data"])

        assert error_event["event"] == "error"
        assert_base_event_fields(
            error_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert error_data["stop_reason"] == "error"
        assert error_data["error_type"] == "ErrorEventReceivedFromAgentError"
        assert (
            error_data["error_message"]
            == "Error event received: context_length_exceeded - Too many tokens"
        )
        assert "stream_ended_at" in error_data
        mock_repository.delete_conversation_stream.assert_called_once_with(
            conversation_id=base_context["conversation_id"],
            stream_id=error_data["stream_id"],
            end_user_id=base_context["end_user_id"],
        )

        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=error_data["message_id"],
                message="Hello ",
                status="error",
                stop_reason="error",
                error_type="ErrorEventReceivedFromAgentError",
                error_message="Error event received: context_length_exceeded - Too many tokens",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_does_not_persist_assistant_message_when_error_occurs_before_content(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {
            "data": json.dumps(
                {
                    "type": "error",
                    "error_type": "agent_failure",
                    "error_message": "Failed before content",
                }
            )
        },
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)
        events = [event async for event in generator]

    stream_start_data = json.loads(events[0]["data"])
    error_data = json.loads(events[1]["data"])

    assert len(events) == 2
    assert events[0]["event"] == "stream_start"
    assert events[1]["event"] == "error"
    assert error_data["error_type"] == "ErrorEventReceivedFromAgentError"
    assert (
        error_data["error_message"]
        == "Error event received: agent_failure - Failed before content"
    )

    mock_persist_message.assert_not_awaited()
    mock_repository.delete_conversation_stream.assert_called_once_with(
        conversation_id=base_context["conversation_id"],
        stream_id=stream_start_data["stream_id"],
        end_user_id=base_context["end_user_id"],
    )


@pytest.mark.asyncio
async def test_event_generator_unknown_event_type(
    base_context, mock_stream_parser, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello "})},
        {"data": json.dumps({"type": "unknown_event"})},
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)
        events = [event async for event in generator]

        error_event = events[2]
        error_data = json.loads(error_event["data"])

        assert error_event["event"] == "error"
        assert_base_event_fields(
            error_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert error_data["stop_reason"] == "error"
        assert error_data["error_type"] == "UnknownAgentEventTypeError"
        assert (
            error_data["error_message"]
            == "Received unknown event type: 'unknown_event'"
        )

        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=error_data["message_id"],
                message="Hello ",
                status="error",
                stop_reason="error",
                error_type="UnknownAgentEventTypeError",
                error_message="Received unknown event type: 'unknown_event'",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_any_other_error(
    base_context, mock_stream_parser, mock_persist_message
):
    chunks = [
        {"data": json.dumps({"type": "stream_start"})},
        {"data": json.dumps({"type": "content_delta", "delta": "Hello "})},
        {"data": "not a json string"},
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)

        events = [event async for event in generator]

        error_event = events[2]
        error_data = json.loads(error_event["data"])

        assert error_event["event"] == "error"
        assert_base_event_fields(
            error_data,
            base_context["end_user_id"],
            base_context["conversation_id"],
            base_context["session_id"],
        )
        assert error_data["stop_reason"] == "error"
        assert error_data["error_type"] == "JSONDecodeError"
        assert (
            error_data["error_message"] == "Expecting value: line 1 column 1 (char 0)"
        )

        mock_persist_message.assert_awaited_once_with(
            ConversationAssistantMessage(
                **base_context,
                message_id=error_data["message_id"],
                message="Hello ",
                status="error",
                stop_reason="error",
                error_type="JSONDecodeError",
                error_message="Expecting value: line 1 column 1 (char 0)",
            ),
        )


@pytest.mark.asyncio
async def test_event_generator_does_not_persist_assistant_message_when_error_occurs_before_stream_start(
    base_context, mock_stream_parser, mock_repository, mock_persist_message
):
    chunks = [
        {
            "data": json.dumps(
                {
                    "type": "error",
                    "error_type": "agent_failure",
                    "error_message": "Immediate failure",
                }
            )
        },
    ]

    with mock_stream_parser(chunks):
        generator = event_generator(agent_response=MagicMock(), **base_context)

        events = [event async for event in generator]

    assert len(events) == 1
    assert events[0]["event"] == "error"
    mock_persist_message.assert_not_awaited()
    mock_repository.create_conversation_stream.assert_not_called()
    mock_repository.delete_conversation_stream.assert_not_called()
