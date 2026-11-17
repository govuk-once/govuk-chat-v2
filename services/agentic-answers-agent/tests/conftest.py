from unittest import mock

from agentic_answers_agent.tools.search_govuk.opensearch_connection import (
    OpenSearchConnection,
)

# main.py reads the OpenSearch connection details when it's imported, so the
# tests give it placeholders rather than reading the real secret.
mock.patch(
    "agentic_answers_agent.tools.search_govuk.tool.read_opensearch_connection",
    return_value=OpenSearchConnection(
        url="https://opensearch.example.com",
        index="chunks",
        username="test",
        password="test",
    ),
).start()
