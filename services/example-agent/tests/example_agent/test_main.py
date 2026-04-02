import pytest

from example_agent.main import app, invoke
from govuk_chat_v2_prototype_private import load_prompts


def test_app_has_entrypoint():
    assert app is not None
    assert hasattr(app, "entrypoint")


async def fake_stream():
    yield {"data": "Knock, Knock"}
    yield {"data": "Who's there?"}
    yield {"other": "A chicken"}


@pytest.mark.asyncio
async def test_invoke_yields_data(mocker):
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


@pytest.mark.asyncio
async def test_invoke_passes_system_prompt_from_private_package(mocker):
    prompts = load_prompts()
    expected_prompt = prompts["structured_answer_composer"]["system_prompt"]

    mock_agent_instance = mocker.Mock()
    mock_agent_instance.stream_async = mocker.Mock(return_value=fake_stream())
    mocker.patch("example_agent.main.Agent", return_value=mock_agent_instance)
    mock_agent_class = mocker.patch(
        "example_agent.main.Agent", return_value=mock_agent_instance
    )

    async for _ in invoke({"prompt": "Test prompt"}):
        pass

    assert mock_agent_class.called
    _, kwargs = mock_agent_class.call_args

    # We don't want to output the expected prompt it test logs if this fails.
    # This ensures that if the test fails, we get a clear message without exposing
    # the prompt content in the logs.
    if kwargs["system_prompt"] != expected_prompt:
        pytest.fail("System prompt passed to Agent does not match expected prompt")
