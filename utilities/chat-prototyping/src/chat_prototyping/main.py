import gradio as gr
from dotenv import load_dotenv, find_dotenv
from chat_assistants.anthropic import (
    sonnet_streaming_assistant,
    UserInput,
    AssistantResponseDelta,
)

load_dotenv(find_dotenv(".env.aws"))


async def generate_response(message, _history=[]):
    response = ""
    user_input = UserInput(message=message)
    async for event in sonnet_streaming_assistant(user_input):
        match event:
            case AssistantResponseDelta(delta=delta):
                response += delta
                yield response


with gr.Blocks() as demo:
    gr.ChatInterface(
        fn=generate_response,
        type="messages",
    )

if __name__ == "__main__":
    demo.launch()
