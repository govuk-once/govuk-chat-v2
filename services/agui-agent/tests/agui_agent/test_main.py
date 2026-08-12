import json

import pytest
from ag_ui.core import RunAgentInput
from fastapi.testclient import TestClient

from agui_agent.main import (
    agui_agent,
    app,
    session_manager_provider,
)


def input_data():
    return {
        "threadId": "session-123",
        "runId": "run-456",
        "state": {},
        "messages": [{"role": "user", "content": "Tell me a joke", "id": "msg-1"}],
        "tools": [],
        "context": [],
        "forwardedProps": {
            "endUserId": "user-123",
        },
    }


def run_agent_input(**overrides):
    data = input_data()
    data.update(overrides)
    return RunAgentInput.model_validate(data)


def test_invocations_endpoint_streams_agui_events(mocker):
    async def fake_run(_input_data):
        from ag_ui.core import (
            RunFinishedEvent,
            RunStartedEvent,
            TextMessageContentEvent,
            TextMessageEndEvent,
            TextMessageStartEvent,
        )

        yield RunStartedEvent(thread_id="session-123", run_id="run-456")
        yield TextMessageStartEvent(message_id="msg-1", role="assistant")
        yield TextMessageContentEvent(message_id="msg-1", delta="Knock knock")
        yield TextMessageContentEvent(message_id="msg-1", delta="Who's there?")
        yield TextMessageEndEvent(message_id="msg-1")
        yield RunFinishedEvent(thread_id="session-123", run_id="run-456")

    # StrandsAgent.run() is the library's own concern (already tested
    # upstream) - we only need to prove our FastAPI app is wired up to call
    # it and stream its output back correctly.
    mocker.patch.object(agui_agent, "run", side_effect=fake_run)

    client = TestClient(app)
    response = client.post("/invocations", json=input_data())

    assert response.status_code == 200

    events = [
        json.loads(line[len("data: ") :])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]

    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]
    assert events[2]["delta"] == "Knock knock"
    assert events[3]["delta"] == "Who's there?"


def test_session_manager_provider_raises_without_actor_id():
    input_without_actor_id = run_agent_input(forwardedProps={})

    with pytest.raises(ValueError, match="No endUserId found in payload"):
        session_manager_provider(input_without_actor_id)
