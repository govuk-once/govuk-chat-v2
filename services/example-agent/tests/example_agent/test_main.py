import pytest

from example_agent.main import app, invoke
from types import SimpleNamespace


def test_app_has_entrypoint():
    assert app is not None
    assert hasattr(app, "entrypoint")


@pytest.mark.asyncio
async def test_invoke_yields_data(mocker):
    async def fake_stream():
        yield {"data": "Knock, Knock"}
        yield {"data": "Who's there?"}
        yield {"other": "A chicken"}

    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(return_value=fake_stream())
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
        {"type": "data", "content": "Knock, Knock"},
        {"type": "data", "content": "Who's there?"},
    ]


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
