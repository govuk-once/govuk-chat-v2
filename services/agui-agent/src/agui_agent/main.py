import os

from ag_ui_strands import StrandsAgent, StrandsAgentConfig, create_strands_app
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from govuk_chat_v2_prototype_private import load_prompts
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

model = BedrockModel(
    model_id="eu.anthropic.claude-sonnet-5",
    max_tokens=4000,
)

prompts = load_prompts()
structured_answer_prompt = prompts["structured_answer_composer"]["system_prompt"]


def get_memory_session_manager(
    session_id: str, actor_id: str
) -> AgentCoreMemorySessionManager | None:
    memory_config = AgentCoreMemoryConfig(
        memory_id=os.environ["BEDROCK_AGENTCORE_MEMORY_ID"],
        session_id=session_id,
        actor_id=actor_id,
    )

    return AgentCoreMemorySessionManager(
        memory_config,
        "eu-west-1",
    )


def session_manager_provider(input_data):
    # TODO: remove this "default-user" fallback once we figure out a way
    # to populate the forwarded props when running in development with
    # AgentCore CLI.
    actor_id = input_data.forwarded_props.get("endUserId", "default-user")

    return get_memory_session_manager(input_data.thread_id, actor_id)


agent_config = StrandsAgentConfig(
    session_manager_provider=session_manager_provider,
    # By default StrandsAgentConfig emits MESSAGES_SNAPSHOT events, which
    # assistant-ui renders as a single assistant message. It'll then render
    # the actual messages from the stream as they arrive too.
    # https://github.com/ag-ui-protocol/ag-ui/blob/11f03fa65c4fa22a8637d3f6e06e77d8c1b9ae78/integrations/aws-strands/python/src/ag_ui_strands/config.py#L112-L121
    emit_messages_snapshot=False,
)

agent = Agent(
    model=model,
    system_prompt=structured_answer_prompt,
    tools=[],
    callback_handler=None,  # disable Strands' default callback handler which prints all events to stdout
)

agui_agent = StrandsAgent(
    agent=agent,
    name="AGUI-Agent",
    description="A helpful assistant",
    config=agent_config,
)
app = create_strands_app(agui_agent, path="/invocations", ping_path="/ping")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
