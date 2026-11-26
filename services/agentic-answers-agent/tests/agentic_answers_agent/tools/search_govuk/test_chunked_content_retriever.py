import io
import json

from agentic_answers_agent.tools.search_govuk.chunked_content_retriever import (
    EMBEDDING_FIELD_NAME,
    EMBEDDING_MODEL,
    ChunkedContentRetriever,
)
from agentic_answers_agent.tools.search_govuk.models import SearchResult


def test_embed_query_returns_the_titan_embedding_of_the_query(mocker):
    bedrock_client = mocker.Mock()
    bedrock_client.invoke_model.return_value = {
        "body": io.BytesIO(json.dumps({"embedding": [0.1, 0.2]}).encode())
    }
    retriever = ChunkedContentRetriever(
        search_client=mocker.Mock(),
        bedrock_client=bedrock_client,
        index_name="chunks",
    )

    assert retriever.embed_query("renew passport") == [0.1, 0.2]
    request = bedrock_client.invoke_model.call_args.kwargs
    assert request["modelId"] == EMBEDDING_MODEL
    assert json.loads(request["body"]) == {"inputText": "renew passport"}


def test_retrieve_asks_only_for_the_fields_it_uses(mocker):
    search_client = mocker.Mock()
    search_client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_index": "chunks",
                    "_id": "1",
                    "_score": 0.9,
                    "_source": {
                        "exact_path": "/renew-passport",
                        "title": "Renew your passport",
                        "html_content": "<p>Apply online.</p>",
                    },
                }
            ]
        }
    }
    retriever = ChunkedContentRetriever(
        search_client=search_client,
        bedrock_client=mocker.Mock(),
        index_name="chunks",
    )
    mocker.patch.object(retriever, "embed_query", return_value=[0.1, 0.2])

    results = retriever.retrieve("renew passport", top_k=5)

    search_client.search.assert_called_once_with(
        index="chunks",
        body={
            "size": 5,
            "query": {"knn": {EMBEDDING_FIELD_NAME: {"vector": [0.1, 0.2], "k": 5}}},
            "_source": {"includes": SearchResult.source_field_names()},
        },
    )
    assert results == [
        SearchResult(
            score=0.9,
            exact_path="/renew-passport",
            title="Renew your passport",
            html_content="<p>Apply online.</p>",
        )
    ]
