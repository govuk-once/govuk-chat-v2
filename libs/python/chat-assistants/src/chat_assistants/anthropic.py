from anthropic import AsyncAnthropicBedrock
from anthropic.types import TextBlock
from pydantic import BaseModel


class UserInput(BaseModel):
    message: str


class AssistantResponse(BaseModel):
    message: str


async def sonnet_non_streaming_assistant(user_input: UserInput) -> AssistantResponse:
    client = AsyncAnthropicBedrock()
    message = await client.messages.create(
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": user_input.message,
            }
        ],
        model="eu.anthropic.claude-sonnet-4-20250514-v1:0",
    )

    text_responses = [
        block.text for block in message.content if isinstance(block, TextBlock)
    ]

    return AssistantResponse(message="".join(text_responses))
