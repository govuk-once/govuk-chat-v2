import json
import asyncio
from fastapi import FastAPI
from pydantic import BaseModel, field_validator
from sse_starlette.sse import EventSourceResponse

import chat_assistants.anthropic as anthropic_assistant

app = FastAPI()


class UserInput(BaseModel):
    message: str

    @field_validator("message")
    def not_empty(cls, value):
        if not value.strip():
            raise ValueError("Message must not be empty")
        return value


@app.get("/")
async def read_root():
    return {"message": "Hello World"}


@app.get("/stream")
async def stream():
    async def streamer():
        message = "This is an SSE stream".split(" ")
        for word in message:
            content = {"type": "delta", "content": word}
            yield {"event": content["type"], "data": json.dumps(content)}
            await asyncio.sleep(0.5)

    return EventSourceResponse(streamer())


@app.post("/sonnet-streaming/assistant-response")
async def sonnet_streaming_assistant_response(user_input: UserInput):
    async def assistant_response_generator(user_input: UserInput):
        normalised_input = anthropic_assistant.UserInput(user_input.message)
        async for event in anthropic_assistant.sonnet_streaming_assistant(
            normalised_input
        ):
            match event:
                case anthropic_assistant.AssistantResponseDelta(delta=delta):
                    content = {"type": "delta", "content": delta}
                    yield {"event": content["type"], "data": json.dumps(content)}

    return EventSourceResponse(assistant_response_generator(user_input))
