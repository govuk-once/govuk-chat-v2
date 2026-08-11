import os
from collections.abc import AsyncGenerator

from agent_runtime_types import (
    AgentStreamEvent,
    ContentDeltaEvent,
    ErrorEvent,
    StreamEndEvent,
    StreamStartEvent,
)
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from govuk_chat_v2_prototype_private import load_prompts
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()


def process_event(event) -> AgentStreamEvent | None:
    match event:
        case {"init_event_loop": True}:
            return StreamStartEvent()
        case {"event": {"contentBlockDelta": {"delta": {"text": text}}}}:
            return ContentDeltaEvent(delta=text)
        case {"result": result} if result.stop_reason == "end_turn":
            return StreamEndEvent(complete=True)
        case {"result": result}:
            return StreamEndEvent(complete=False, stop_reason=result.stop_reason)
        case {"force_stop": True}:
            return StreamEndEvent(
                complete=False, stop_reason=event.get("force_stop_reason", "unknown")
            )


@app.entrypoint
async def invoke(payload, context) -> AsyncGenerator[AgentStreamEvent]:
    session_id = getattr(context, "session_id", "default-session")
    user_id = payload.get("end_user_id") or session_id

    memory_config = AgentCoreMemoryConfig(
        memory_id=os.environ["BEDROCK_AGENTCORE_MEMORY_ID"],
        session_id=session_id,
        actor_id=user_id,
    )

    with AgentCoreMemorySessionManager(
        agentcore_memory_config=memory_config,
        region_name="eu-west-1",
    ) as session_manager:
        prompts = load_prompts()
        structured_answer_prompt = prompts["structured_answer_composer"][
            "system_prompt"
        ]

        agent = Agent(
            model=BedrockModel(model_id="eu.anthropic.claude-sonnet-4-6"),
            system_prompt=structured_answer_prompt,
            session_manager=session_manager,
        )
        try:
            stream = agent.stream_async(payload.get("prompt"))

            async for event in stream:
                if (processed := process_event(event)) is not None:
                    yield processed

        # Catch any errors during stream so a graceful response can be triggered
        # TODO: Check should this re-raise the exception after yielding?
        except Exception as e:  # noqa: BLE001
            # TODO: Log the exception in Sentry
            yield ErrorEvent(
                error_type="agent_error",
                error_message=str(e),
            )


if __name__ == "__main__":
    app.run()
