from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import chat_assistants.anthropic as anthropic_assistant

load_dotenv(find_dotenv(".env.aws"), override=True)

app = FastAPI()


class UserInput(BaseModel):
    message: str


@app.get("/")
async def read_root():
    return {"message": "Hello World"}


async def assistant_response_generator(user_input: UserInput):
    normalised_input = anthropic_assistant.UserInput(user_input.message)
    async for event in anthropic_assistant.sonnet_streaming_assistant(normalised_input):
        match event:
            case anthropic_assistant.AssistantResponseDelta(delta=delta):
                yield {"event": "delta", "data": delta}


@app.post("/sonnet-streaming/assistant-response")
async def sonnet_streaming_assistant_response(user_input: UserInput):
    return EventSourceResponse(assistant_response_generator(user_input))
