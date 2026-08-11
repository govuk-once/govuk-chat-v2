import json

import pytest
from botocore.exceptions import ClientError

from chat_api.v1.services.llm_invoker_service import invoke_model


@pytest.mark.asyncio
async def test_invoke_model_default_args(mock_bedrock_client):
    prompt = "This is a prompt."

    result = await invoke_model(prompt)

    assert "Stubbed LLM response" in result

    _, kwargs = mock_bedrock_client.invoke_model.call_args
    sent_body = json.loads(kwargs["body"])
    assert sent_body["messages"][0]["content"] == prompt
    assert kwargs["modelId"] == "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert sent_body["max_tokens"] == 50


@pytest.mark.asyncio
async def test_invoke_model_custom_args(mock_bedrock_client):
    custom_model = "another-model"
    max_tokens = 100

    result = await invoke_model(
        "The prompt.", max_tokens=max_tokens, model=custom_model
    )

    assert "Stubbed LLM response" in result
    _, kwargs = mock_bedrock_client.invoke_model.call_args
    sent_body = json.loads(kwargs["body"])
    assert kwargs["modelId"] == custom_model
    assert sent_body["max_tokens"] == max_tokens


@pytest.mark.asyncio
async def test_invoke_model_client_error(mock_bedrock_client):
    mock_bedrock_client.invoke_model.side_effect = ClientError(
        error_response={
            "Error": {"Message": "AWS Error", "Code": "service_unavailable"},
            "ResponseMetadata": {
                "HTTPStatusCode": 503,
                "RequestId": "mock-request-id",
                "HostId": "mock-host-id",
                "HTTPHeaders": {},
                "RetryAttempts": 0,
            },
        },
        operation_name="InvokeModel",
    )
    result = await invoke_model("This will cause an error")

    expected_error_message = "An error occurred (service_unavailable) when calling the InvokeModel operation: AWS Error"
    assert result == f"Error: {expected_error_message}"
