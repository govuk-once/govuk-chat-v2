import os
from unittest import mock

from agentic_answers_agent.tools.search_govuk.opensearch_connection import (
    OpenSearchConnection,
)

# main.py reads these when it's imported. The agent's runtime gets the
# guardrail's from its CDK stack, and the OpenSearch connection details from
# a secret, so the tests give it placeholders.
os.environ.setdefault("GUARDRAIL_ID", "test-guardrail")
os.environ.setdefault("GUARDRAIL_VERSION", "1")

mock.patch(
    "agentic_answers_agent.tools.search_govuk.tool.read_opensearch_connection",
    return_value=OpenSearchConnection(
        url="https://opensearch.example.com",
        index="chunks",
        username="test",
        password="test",
    ),
).start()
