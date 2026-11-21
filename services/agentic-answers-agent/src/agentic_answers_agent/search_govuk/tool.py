from functools import cache
from typing import Any

from strands import tool

from agentic_answers_agent.search_govuk.format import format_results
from agentic_answers_agent.search_govuk.opensearch_connection import (
    read_opensearch_settings,
)
from agentic_answers_agent.search_govuk.rerank import rerank
from agentic_answers_agent.search_govuk.retrieve import OpenSearchRetrieval

RETRIEVED_FROM_INDEX = 80
MAX_RESULTS = 20
MINIMUM_SCORE = 0.75


@cache
def opensearch_retrieval() -> OpenSearchRetrieval:
    """Reads the connection details on the first search, and reuses them for
    the life of the process."""
    return OpenSearchRetrieval.from_settings(read_opensearch_settings())


@tool
def search_govuk_guidance(query: str) -> dict[str, list[dict[str, Any]]]:
    """Search GOV.UK and return relevant government guidance content.

    Use this tool to find information from GOV.UK about UK government
    services, benefits, tax, housing, and other public services.

    Args:
        query: Search query to find relevant GOV.UK content.

    Returns:
        Dictionary containing retrieved contexts from GOV.UK.
    """
    candidates = opensearch_retrieval().retrieve(query, top_k=RETRIEVED_FROM_INDEX)
    ranked = rerank(
        search_results=candidates,
        max_results=MAX_RESULTS,
        threshold=MINIMUM_SCORE,
    )
    return {"contexts": format_results(ranked)}
