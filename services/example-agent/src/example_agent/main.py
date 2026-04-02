from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from govuk_chat_v2_prototype_private import load_prompts

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload):
    prompts = load_prompts()
    structured_answer_prompt = prompts["structured_answer_composer"]["system_prompt"]
    agent = Agent(
        model=BedrockModel(model_id="eu.anthropic.claude-sonnet-4-6"),
        system_prompt=structured_answer_prompt,
    )

    stream = agent.stream_async(payload.get("prompt"))

    async for event in stream:
        if "data" in event and isinstance(event["data"], str):
            yield {"type": "data", "content": event["data"]}


if __name__ == "__main__":
    app.run()
