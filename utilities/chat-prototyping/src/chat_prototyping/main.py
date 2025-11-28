import gradio as gr
from dotenv import load_dotenv, find_dotenv

from chat_prototyping import sonnet_streaming_assistant, chat_api_assistant

load_dotenv(find_dotenv(".env.aws"), override=True)

with gr.Blocks() as demo:
    with gr.Tab("Sonnet streaming assistant"):
        sonnet_streaming_assistant.build_interface()
    with gr.Tab("API assistant"):
        chat_api_assistant.build_interface()


if __name__ == "__main__":
    demo.launch()
