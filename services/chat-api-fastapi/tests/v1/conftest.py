import json
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_bedrock_client():
    with patch(
        "chat_api.v1.services.llm_invoker_service._get_client"
    ) as mock_get_client:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        yield mock_client


@pytest.fixture(autouse=True)
def setup_bedrock_response(mock_bedrock_client):
    mock_response_payload = {"content": [{"text": "Stubbed LLM response"}]}

    mock_body = MagicMock()
    mock_body.read.return_value = json.dumps(mock_response_payload).encode("utf-8")

    mock_bedrock_client.invoke_model.return_value = {"body": mock_body}
