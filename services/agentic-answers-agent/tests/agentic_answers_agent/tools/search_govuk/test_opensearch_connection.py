import json

from agentic_answers_agent.tools.search_govuk.opensearch_connection import (
    SECRET_NAME,
    OpenSearchConnection,
    read_opensearch_connection,
)

SECRET_STRING = json.dumps(
    {
        "OPENSEARCH_URL": "https://opensearch.example.com",
        "OPENSEARCH_INDEX": "chunks",
        "OPENSEARCH_USERNAME": "chat",
        "OPENSEARCH_PASSWORD": "hunter2",
        "OPENSEARCH_EMBEDDING_MODEL": "ignored",
    }
)


class TestOpenSearchConnection:
    def test_from_secret_string_reads_the_connection_details(self):
        assert OpenSearchConnection.from_secret_string(
            SECRET_STRING
        ) == OpenSearchConnection(
            url="https://opensearch.example.com",
            index="chunks",
            username="chat",
            password="hunter2",
        )

    def test_repr_leaves_out_the_password(self):
        connection = OpenSearchConnection.from_secret_string(SECRET_STRING)

        assert "hunter2" not in repr(connection)


def test_read_opensearch_connection_reads_v1s_secret(mocker):
    client = mocker.patch(
        "agentic_answers_agent.tools.search_govuk.opensearch_connection.boto3.client"
    ).return_value
    client.get_secret_value.return_value = {"SecretString": SECRET_STRING}

    connection = read_opensearch_connection()

    client.get_secret_value.assert_called_once_with(SecretId=SECRET_NAME)
    assert connection.index == "chunks"
