from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from strands import Agent
from strands.models import BedrockModel
import os
from govuk_chat_v2_prototype_private import load_prompts

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload, context):
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

        stream = agent.stream_async(payload.get("prompt"))

        async for event in stream:
            if "data" in event and isinstance(event["data"], str):
                yield {"type": "data", "content": event["data"]}


if __name__ == "__main__":
    app.run()
