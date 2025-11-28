import gradio as gr
import httpx
import json
from httpx_sse import aconnect_sse


async def generate_response(message, _history):
    response = ""
    async with (
        httpx.AsyncClient() as client,
        aconnect_sse(
            client,
            "POST",
            # TODO: make hostname configurable in Gradio UI
            "http://127.0.0.1:8000/sonnet-streaming/assistant-response",
            json={"message": message},
        ) as event_source,
    ):
        async for sse in event_source.aiter_sse():
            if sse.event != "delta":
                continue
            data = json.loads(sse.data)
            response += data["content"]
            yield response


def build_interface():
    gr.ChatInterface(
        fn=generate_response,
        type="messages",
    )
