import gradio as gr
from chat_assistants.anthropic import (
    sonnet_streaming_assistant,
    UserInput,
    AssistantResponseDelta,
    UserHistoryItem,
    AssistantHistoryItem,
)


async def generate_response(message, history):
    response = ""

    formatted_history = []
    for item in history:
        match item:
            case {"role": "user", "content": content}:
                formatted_history.append(UserHistoryItem(content))
            case {"role": "assistant", "content": content}:
                formatted_history.append(AssistantHistoryItem(content))
            case _:
                raise ValueError("Unexpected history item")

    user_input = UserInput(message, formatted_history)
    async for event in sonnet_streaming_assistant(user_input):
        match event:
            case AssistantResponseDelta(delta=delta):
                response += delta
                yield response


def build_interface():
    gr.ChatInterface(fn=generate_response)
