import json
from botocore.exceptions import ClientError
import boto3
import asyncio


client = None


def _get_client():
    """
    Generates a boto3 client for Bedrock if one doesn't already exist.
    """
    global client
    if not client:
        client = boto3.client(service_name="bedrock-runtime", region_name="eu-west-1")
    return client


async def invoke_model(
    prompt: str,
    max_tokens: int = 50,
    model: str = "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
) -> str:
    model_id = model
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.0,
        }
    )
    """
    Invokes a model using the Bedrock client.

    **prompt:** The prompt to send to the model.
    **max_tokens:** The maximum number of tokens to generate in the response. Defaults to 50.
    **model:** The ID of the model to invoke. Defaults to "eu.anthropic.claude-haiku-4-5-20251001-v1:0".
    """
    try:
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None, lambda: _get_client().invoke_model(body=body, modelId=model_id)
        )

        response_body = json.loads(response.get("body").read())
        return response_body["content"][0]["text"].strip()
    except ClientError as e:
        # We will probably just want sentry to fire here, but for now we can return
        # the error message so we can assert on it in tests.
        return f"Error: {str(e)}"
