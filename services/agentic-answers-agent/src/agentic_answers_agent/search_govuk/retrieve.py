import json
from typing import Self

import boto3
from opensearchpy import OpenSearch

from agentic_answers_agent.search_govuk.models import GovUkChunkSource, OpenSearchHit
from agentic_answers_agent.search_govuk.opensearch_connection import (
    AWS_REGION,
    OpenSearchSettings,
)


class OpenSearchRetrieval:
    """Runs semantic searches against Chat V1's OpenSearch index."""

    def __init__(
        self,
        search_client: OpenSearch,
        index_name: str,
        embedding_field_name: str,
        embedding_model: str,
    ):
        self.bedrock_client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
        self.search_client = search_client
        self.index_name = index_name
        self.embedding_field_name = embedding_field_name
        self.embedding_model = embedding_model

    @classmethod
    def from_settings(cls, settings: OpenSearchSettings) -> Self:
        search_client = OpenSearch(
            hosts=[settings.url],
            http_auth=(settings.username, settings.password),
            use_ssl=True,
            verify_certs=True,
        )
        return cls(
            search_client=search_client,
            index_name=settings.index,
            embedding_field_name=settings.embedding_field_name,
            embedding_model=settings.embedding_model,
        )

    def embed_query(self, query: str) -> list[float]:
        response = self.bedrock_client.invoke_model(
            modelId=self.embedding_model,
            body=json.dumps({"inputText": query}),
            contentType="application/json",
            accept="application/json",
        )
        return json.loads(response["body"].read())["embedding"]

    def retrieve(self, query: str, top_k: int) -> list[OpenSearchHit]:
        vector = self.embed_query(query)
        search_body = {
            "size": top_k,
            "query": {
                "knn": {
                    self.embedding_field_name: {
                        "vector": vector,
                        "k": top_k,
                    }
                }
            },
            "_source": {"includes": GovUkChunkSource.field_names()},
        }
        response = self.search_client.search(index=self.index_name, body=search_body)
        return [
            OpenSearchHit(
                index=hit["_index"],
                id=hit["_id"],
                score=hit["_score"],
                source=GovUkChunkSource(**hit["_source"]),
            )
            for hit in response["hits"]["hits"]
        ]
