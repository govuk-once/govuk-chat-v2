from agentic_answers_agent.search_govuk.models import GovUkChunkSource, OpenSearchHit
from agentic_answers_agent.search_govuk.retrieve import OpenSearchRetrieval


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
    retrieval = OpenSearchRetrieval(
        search_client=search_client,
        index_name="chunks",
        embedding_field_name="embedding",
        embedding_model="titan",
    )
    mocker.patch.object(retrieval, "embed_query", return_value=[0.1, 0.2])

    hits = retrieval.retrieve("renew passport", top_k=5)

    search_client.search.assert_called_once_with(
        index="chunks",
        body={
            "size": 5,
            "query": {"knn": {"embedding": {"vector": [0.1, 0.2], "k": 5}}},
            "_source": {"includes": GovUkChunkSource.field_names()},
        },
    )
    assert hits == [
        OpenSearchHit(
            index="chunks",
            id="1",
            score=0.9,
            source=GovUkChunkSource(
                exact_path="/renew-passport",
                title="Renew your passport",
                html_content="<p>Apply online.</p>",
            ),
        )
    ]
