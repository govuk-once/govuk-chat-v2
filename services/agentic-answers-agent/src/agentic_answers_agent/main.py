import os

from ag_ui_strands import StrandsAgent, StrandsAgentConfig, create_strands_app
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from govuk_chat_v2_private import load_prompts
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.models import BedrockModel

from agentic_answers_agent.tools.search_govuk import (
    chunked_content_retriever,
    search_govuk_content,
)

MODEL_ID = "eu.anthropic.claude-sonnet-5-5"
MAX_TOKENS = 16_000
THINKING_EFFORT = "low"

# The number of messages sent to the model each turn. AgentCore Memory keeps
# the whole conversation.
CONVERSATION_WINDOW_SIZE = 40

system_prompt = load_prompts()["agentic_answers_agent"]["system_prompt"]

# Read the OpenSearch connection details now, so the agent fails to start without them.
chunked_content_retriever()


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
    model=BedrockModel(
        model_id=MODEL_ID,
        max_tokens=MAX_TOKENS,
        additional_request_fields={
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": THINKING_EFFORT},
        },
        guardrail_id=os.environ["GUARDRAIL_ID"],
        guardrail_version=os.environ["GUARDRAIL_VERSION"],
        guardrail_stream_processing_mode="async",
        guardrail_redact_output=True,
        guardrail_latest_message=True,
    ),
    system_prompt=system_prompt,
    tools=[search_govuk_content],
    conversation_manager=SlidingWindowConversationManager(
        window_size=CONVERSATION_WINDOW_SIZE
    ),
    callback_handler=None,  # disable Strands' default callback handler which prints all events to stdout
)

agentic_answers_agent = StrandsAgent(
    agent=agent,
    name="agentic-answers-agent",
    description="A helpful assistant",
    config=agent_config,
)
app = create_strands_app(agentic_answers_agent, path="/invocations", ping_path="/ping")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
