import json
from typing import Self

import boto3
from botocore.client import BaseClient
from opensearchpy import OpenSearch

from agentic_answers_agent.tools.search_govuk.models import SearchResult
from agentic_answers_agent.tools.search_govuk.opensearch_connection import (
    AWS_REGION,
    OpenSearchConnection,
)

EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"
EMBEDDING_FIELD_NAME = "titan_embedding"


class ChunkedContentRetriever:
    def __init__(
        self,
        search_client: OpenSearch,
        bedrock_client: BaseClient,
        index_name: str,
    ):
        self.search_client = search_client
        self.bedrock_client = bedrock_client
        self.index_name = index_name

    @classmethod
    def from_connection(cls, connection: OpenSearchConnection) -> Self:
        search_client = OpenSearch(
            hosts=[connection.url],
            http_auth=(connection.username, connection.password),
            use_ssl=True,
            verify_certs=True,
        )
        return cls(
            search_client=search_client,
            bedrock_client=boto3.client("bedrock-runtime", region_name=AWS_REGION),
            index_name=connection.index,
        )

    def embed_query(self, query: str) -> list[float]:
        response = self.bedrock_client.invoke_model(
            modelId=EMBEDDING_MODEL,
            body=json.dumps({"inputText": query}),
            contentType="application/json",
            accept="application/json",
        )
        return json.loads(response["body"].read())["embedding"]

    def retrieve(self, query: str, top_k: int) -> list[SearchResult]:
        vector = self.embed_query(query)
        search_body = {
            "size": top_k,
            "query": {
                "knn": {
                    EMBEDDING_FIELD_NAME: {
                        "vector": vector,
                        "k": top_k,
                    }
                }
            },
            "_source": {"includes": SearchResult.source_field_names()},
        }
        response = self.search_client.search(index=self.index_name, body=search_body)
        return [SearchResult.from_hit(hit) for hit in response["hits"]["hits"]]
