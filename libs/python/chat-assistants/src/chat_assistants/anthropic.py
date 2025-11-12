from anthropic import AsyncAnthropicBedrock
from pydantic import BaseModel
from typing import AsyncGenerator


class UserInput(BaseModel):
    message: str


class AssistantResponseDelta(BaseModel):
    delta: str


class AssistantResponseFinal(BaseModel):
    message: str


async def sonnet_streaming_assistant(
    user_input: UserInput,
) -> AsyncGenerator[AssistantResponseDelta | AssistantResponseFinal, None]:
    client = AsyncAnthropicBedrock()
    async with client.messages.stream(
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": user_input.message,
            }
        ],
        model="eu.anthropic.claude-sonnet-4-20250514-v1:0",
    ) as stream:
        async for text in stream.text_stream:
            yield AssistantResponseDelta(delta=text)

    yield AssistantResponseFinal(message=await stream.get_final_text())
