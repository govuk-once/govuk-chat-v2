import gradio as gr
from dotenv import load_dotenv, find_dotenv
from chat_assistants.anthropic import sonnet_non_streaming_assistant, UserInput

load_dotenv(find_dotenv(".env.aws"))


async def generate_response(message, _history=[]):
    user_input = UserInput(message=message)
    response = await sonnet_non_streaming_assistant(user_input)
    return response.message


with gr.Blocks() as demo:
    gr.ChatInterface(
        fn=generate_response,
        type="messages",
    )

if __name__ == "__main__":
    demo.launch()
