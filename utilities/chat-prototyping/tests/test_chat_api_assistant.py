import pytest
import respx
from httpx import Response

from chat_prototyping.chat_api_assistant import generate_response


@pytest.mark.asyncio
async def test_generate_response_yields_deltas(mocker):
    sse_content = (
        "event: delta\n"
        'data: {"type": "delta", "content": "I\'m"}\n\n'
        "event: delta\n"
        'data: {"type": "delta", "content": " good thanks"}\n\n'
        "event: other\n"
        'data: {"type": "other", "content": "ignored"}\n\n'
    )

    with respx.mock:
        api_host = "http://localhost"
        route = respx.post(f"{api_host}/sonnet-streaming/assistant-response").mock(
            return_value=Response(
                200, text=sse_content, headers={"Content-Type": "text/event-stream"}
            )
        )

        deltas = []
        async for delta in generate_response("Hi, how are you?", [], api_host):
            deltas.append(delta)

        assert deltas == ["I'm", "I'm good thanks"]
        assert route.call_count == 1
