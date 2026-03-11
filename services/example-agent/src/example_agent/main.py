from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload):
    agent = Agent(
        model=BedrockModel(model_id="eu.anthropic.claude-sonnet-4-6"),
        system_prompt="You reply to all comments with a joke",
    )

    stream = agent.stream_async(payload.get("prompt"))

    async for event in stream:
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]


if __name__ == "__main__":
    app.run()
