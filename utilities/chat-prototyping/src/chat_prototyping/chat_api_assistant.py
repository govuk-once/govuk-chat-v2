import gradio as gr
import httpx
import json
from httpx_sse import aconnect_sse


async def generate_response(message, _history, api_host_input):
    response = ""
    async with (
        httpx.AsyncClient() as client,
        aconnect_sse(
            client,
            "POST",
            f"{api_host_input}/sonnet-streaming/assistant-response",
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
    api_host_input = gr.Textbox("http://127.0.0.1:8000", label="API host", render=False)
    gr.ChatInterface(fn=generate_response, additional_inputs=api_host_input)
