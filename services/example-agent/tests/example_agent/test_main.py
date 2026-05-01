import pytest

from example_agent.main import app, invoke
from types import SimpleNamespace
from govuk_chat_v2_prototype_private import load_prompts
from strands.agent import AgentResult
from unittest.mock import MagicMock
from agent_runtime_types import (
    StreamStartEvent,
    StreamEndEvent,
    ContentDeltaEvent,
    ErrorEvent,
)


async def fake_agent_stream():
    yield {"init_event_loop": True}
    yield {"start": True}
    yield {"start_event_loop": True}
    yield {"event": {"messageStart": {"role": "assistant"}}}
    yield {
        "event": {
            "contentBlockDelta": {
                "delta": {"text": "Knock knock"},
                "contentBlockIndex": 0,
            }
        }
    }
    yield {"data": "Knock knock", "delta": {"text": "Knock knock"}}
    yield {
        "event": {
            "contentBlockDelta": {
                "delta": {"text": "Who's there?"},
                "contentBlockIndex": 0,
            }
        }
    }
    yield {"data": "Who's there?", "delta": {"text": "Who's there?"}}
    yield {
        "event": {
            "contentBlockDelta": {
                "delta": {"text": "A chicken"},
                "contentBlockIndex": 0,
            }
        }
    }
    yield {"data": "A chicken", "delta": {"text": "A chicken"}}
    yield {"event": {"contentBlockStop": {"contentBlockIndex": 0}}}
    yield {"event": {"messageStop": {"stopReason": "end_turn"}}}
    yield {
        "event": {
            "metadata": {
                "usage": {"inputTokens": 20, "outputTokens": 27, "totalTokens": 47},
                "metrics": {"latencyMs": 1410},
            }
        }
    }
    yield {
        "message": {
            "role": "assistant",
            "content": [{"text": "Knock knock\n\nWho's there?\n\nA chicken"}],
        }
    }
    yield {
        "result": AgentResult(
            stop_reason="end_turn",
            message={
                "role": "assistant",
                "content": [{"text": "Knock knock\n\nWho's there\n\nA chicken"}],
            },
            metrics=MagicMock(),
            state=MagicMock(),
        )
    }


def test_app_has_entrypoint():
    assert app is not None
    assert hasattr(app, "entrypoint")


@pytest.mark.asyncio
async def test_invoke_yields_data(mocker):
    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(return_value=fake_agent_stream())
    mocker.patch("example_agent.main.Agent", return_value=mock_agent_instance)
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace(session_id="test-session")

    result = []
    async for item in invoke({"prompt": "Tell me a joke"}, context):
        result.append(item)

    assert result == [
        StreamStartEvent(),
        ContentDeltaEvent(delta="Knock knock"),
        ContentDeltaEvent(delta="Who's there?"),
        ContentDeltaEvent(delta="A chicken"),
        StreamEndEvent(complete=True),
    ]


@pytest.mark.asyncio
async def test_invoke_yields_force_stop_event(mocker):
    async def fake_agent_stream_with_force_stop():
        yield {"init_event_loop": True}
        yield {"event": {"messageStart": {"role": "assistant"}}}
        yield {
            "event": {
                "contentBlockDelta": {
                    "delta": {"text": "Knock knock"},
                    "contentBlockIndex": 0,
                }
            }
        }
        yield {"force_stop": True, "force_stop_reason": "Stop reason"}

    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(
        return_value=fake_agent_stream_with_force_stop()
    )
    mocker.patch("example_agent.main.Agent", return_value=mock_agent_instance)
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace(session_id="test-session")

    result = []
    async for item in invoke({"prompt": "Tell me a joke"}, context):
        result.append(item)

    assert result == [
        StreamStartEvent(),
        ContentDeltaEvent(delta="Knock knock"),
        StreamEndEvent(complete=False, stop_reason="Stop reason"),
    ]


@pytest.mark.asyncio
async def test_invoke_handles_general_exception(mocker):
    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async.side_effect = Exception("Generic error")
    mocker.patch("example_agent.main.Agent", return_value=mock_agent_instance)
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace(session_id="test-session")

    result = []
    async for item in invoke({"prompt": "Tell me a joke"}, context):
        result.append(item)

    assert result == [
        ErrorEvent(error_type="agent_error", error_message="Generic error")
    ]


@pytest.mark.asyncio
async def test_invoke_only_yields_specific_events(mocker):
    async def fake_agent_stream():
        yield {"start": True}
        yield {"unknown_event": "something"}
        yield {"event": {"messageStop": {"stopReason": "end_turn"}}}

    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(return_value=fake_agent_stream())
    mocker.patch("example_agent.main.Agent", return_value=mock_agent_instance)
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace(session_id="test-session")

    result = []
    async for item in invoke({"prompt": "Tell me a joke"}, context):
        result.append(item)

    assert result == []


@pytest.mark.asyncio
async def test_memory_config_construction(mocker):
    config = mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch("example_agent.main.Agent")
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-xyz"}
    )

    context = SimpleNamespace(session_id="session-abc")

    async for _ in invoke({"prompt": "hi", "end_user_id": "u1"}, context):
        break

    _, kwargs = config.call_args

    assert kwargs == {
        "memory_id": "mem-xyz",
        "session_id": "session-abc",
        "actor_id": "u1",
    }


@pytest.mark.asyncio
async def test_memory_config_uses_default_session_and_user_id(mocker):
    config = mocker.patch("example_agent.main.AgentCoreMemoryConfig")

    mocker.patch("example_agent.main.Agent")
    mocker.patch("example_agent.main.AgentCoreMemorySessionManager")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace()

    async for _ in invoke({"prompt": "hi"}, context):
        break

    _, kwargs = config.call_args

    assert kwargs["session_id"] == "default-session"
    assert kwargs["actor_id"] == "default-session"


@pytest.mark.asyncio
async def test_session_manager_used(mocker):
    mock_session_manager = mocker.MagicMock()
    mock_session_manager.__enter__.return_value = mock_session_manager

    mock_sm_class = mocker.patch(
        "example_agent.main.AgentCoreMemorySessionManager",
        return_value=mock_session_manager,
    )

    mocker.patch("example_agent.main.Agent")
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    context = SimpleNamespace()

    async for _ in invoke({"prompt": "hi"}, context):
        break

    mock_sm_class.assert_called_once()
    mock_session_manager.__enter__.assert_called_once()
    mock_session_manager.__exit__.assert_called_once()


@pytest.mark.asyncio
async def test_invoke_passes_system_prompt_from_private_package(mocker):
    mock_session_manager = mocker.MagicMock()
    mock_session_manager.__enter__.return_value = mock_session_manager
    mocker.patch(
        "example_agent.main.AgentCoreMemorySessionManager",
        return_value=mock_session_manager,
    )
    mocker.patch("example_agent.main.AgentCoreMemoryConfig")
    mocker.patch.dict(
        "example_agent.main.os.environ", {"BEDROCK_AGENTCORE_MEMORY_ID": "mem-123"}
    )

    prompts = load_prompts()
    expected_prompt = prompts["structured_answer_composer"]["system_prompt"]

    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(return_value=fake_agent_stream())
    mock_agent_class = mocker.patch(
        "example_agent.main.Agent", return_value=mock_agent_instance
    )

    context = SimpleNamespace(session_id="test-session")
    async for _ in invoke({"prompt": "Test prompt"}, context):
        pass

    # We don't want to output the expected prompt it test logs if this fails.
    # This ensures that if the test fails, we get a clear message without exposing
    # the prompt content in the logs.
    assert mock_agent_class.called
    _, kwargs = mock_agent_class.call_args

    if kwargs["system_prompt"] != expected_prompt:
        pytest.fail("System prompt passed to Agent does not match expected prompt")
