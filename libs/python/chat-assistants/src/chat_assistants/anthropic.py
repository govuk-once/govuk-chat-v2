from anthropic.lib.bedrock import AsyncAnthropicBedrock
from dataclasses import dataclass, field
from typing import AsyncGenerator


@dataclass
class UserHistoryItem:
    message: str

    def __post_init__(self):
        if not self.message:
            raise ValueError("message cannot be empty")


@dataclass
class AssistantHistoryItem:
    message: str

    def __post_init__(self):
        if not self.message:
            raise ValueError("message cannot be empty")


@dataclass
class UserInput:
    message: str
    history: list[UserHistoryItem | AssistantHistoryItem] = field(default_factory=list)

    def __post_init__(self):
        if not self.message:
            raise ValueError("message cannot be empty")


@dataclass
class AssistantResponseDelta:
    delta: str


@dataclass
class AssistantResponseFinal:
    message: str


async def sonnet_streaming_assistant(
    user_input: UserInput,
) -> AsyncGenerator[AssistantResponseDelta | AssistantResponseFinal, None]:
    client = AsyncAnthropicBedrock()

    messages = []
    for item in user_input.history:
        match item:
            case UserHistoryItem(message):
                messages.append({"role": "user", "content": message})
            case AssistantHistoryItem(message):
                messages.append({"role": "assistant", "content": message})

    messages.append({"role": "user", "content": user_input.message})

    async with client.messages.stream(
        max_tokens=1024,
        messages=messages,
        model="eu.anthropic.claude-sonnet-4-20250514-v1:0",
    ) as stream:
        async for text in stream.text_stream:
            yield AssistantResponseDelta(delta=text)

    yield AssistantResponseFinal(message=await stream.get_final_text())
