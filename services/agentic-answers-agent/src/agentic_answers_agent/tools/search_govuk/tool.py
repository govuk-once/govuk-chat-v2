from functools import cache

from strands import tool

from agentic_answers_agent.tools.search_govuk.chunked_content_retriever import (
    ChunkedContentRetriever,
)
from agentic_answers_agent.tools.search_govuk.models import GovukContentChunk
from agentic_answers_agent.tools.search_govuk.opensearch_connection import (
    read_opensearch_connection,
)
from agentic_answers_agent.tools.search_govuk.rerank import rerank

RETRIEVED_FROM_INDEX = 80
MAX_RESULTS = 20
MINIMUM_SCORE = 0.75


@cache
def chunked_content_retriever() -> ChunkedContentRetriever:
    return ChunkedContentRetriever.from_connection(read_opensearch_connection())


@tool
def search_govuk_content(query: str) -> list[GovukContentChunk]:
    """Search GOV.UK and return relevant government guidance content.

    Use this tool to find information from GOV.UK about UK government
    services, benefits, tax, housing, and other public services.

    Args:
        query: Search query to find relevant GOV.UK content.

    Returns:
        The GOV.UK content found, most relevant first.
    """
    candidates = chunked_content_retriever().retrieve(query, top_k=RETRIEVED_FROM_INDEX)
    ranked = rerank(
        search_results=candidates,
        max_results=MAX_RESULTS,
        threshold=MINIMUM_SCORE,
    )
    return [result.as_content_chunk() for result in ranked]
