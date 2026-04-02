import json
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sse_starlette.sse import EventSourceResponse
from chat_api.agent import invoke_agent, parse_agent_response_stream

import chat_assistants.anthropic as anthropic_assistant
import chat_api.db as db

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


@app.get("/agent-stream")
def agent_stream():
    try:
        response = invoke_agent(
            "Tell me about the state of the automotive industry, in 2 sentences"
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    return EventSourceResponse(parse_agent_response_stream(response))


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


class ConversationInput(BaseModel):
    title: str


@app.post("/conversations")
def create_conversation(input: ConversationInput):
    conversation_id = db.create_conversation(input.title)
    return {"conversation_id": conversation_id}


@app.post("/conversations/{conversation_id}/messages")
def add_message(conversation_id: str, user_input: UserInput):
    db.add_message(conversation_id, "user", user_input.message)
    return {"status": "message added"}


@app.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str):
    result = db.get_conversation_with_messages(conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation, messages = result
    return {"conversation": conversation, "messages": messages}
