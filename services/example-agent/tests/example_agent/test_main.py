import pytest

from example_agent.main import app, invoke


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

    result = []
    async for item in invoke({"prompt": "Tell me a joke"}):
        result.append(item)

    assert result == [
        {"type": "data", "content": "Knock, Knock"},
        {"type": "data", "content": "Who's there?"},
    ]
