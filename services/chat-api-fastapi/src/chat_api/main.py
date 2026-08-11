import asyncio
import json

from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationInfo, field_validator
from sse_starlette.sse import EventSourceResponse

from chat_api.agent import invoke_agent_runtime, parse_agent_response_stream
from chat_api.conversation_api.routes import router as conversation_router
from chat_api.v1.routers.conversations import router as v1_conversations_router

app = FastAPI()
app.include_router(conversation_router)
app.include_router(v1_conversations_router)


class UserInput(BaseModel):
    message: str

    @field_validator("message")
    def not_empty(cls, value):
        if not value.strip():
            raise ValueError("Message must not be empty")
        return value


class ConversationInput(UserInput):
    session_id: str
    end_user_id: str

    @field_validator("session_id", "end_user_id")
    def not_empty_fields(cls, value, info: ValidationInfo):
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value


@app.exception_handler(ClientError)
async def boto3_client_error_handler(request, exc: ClientError):
    return JSONResponse(
        status_code=exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 500),
        content={
            "error_type": exc.__class__.__name__,
            "error_message": str(exc),
        },
    )


@app.get("/")
async def read_root():
    return {"message": "Hello World"}


@app.get("/stream")
async def stream():
    async def streamer():
        message = ["This", "is", "an", "SSE", "stream"]
        for word in message:
            content = {"type": "delta", "content": word}
            yield {"event": content["type"], "data": json.dumps(content)}
            await asyncio.sleep(0.5)

    return EventSourceResponse(streamer())


@app.post("/invoke-agent")
def invoke_agent(user_input: ConversationInput):
    try:
        response = invoke_agent_runtime(
            user_input.message, user_input.session_id, user_input.end_user_id
        )
    # Return an arbitrary exception into a 500 response
    # TODO: Check if this can be narrower
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(e)})

    return EventSourceResponse(parse_agent_response_stream(response))
