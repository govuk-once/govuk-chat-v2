import pytest

from agentic_answers_agent.tools.search_govuk.models import SearchResult
from agentic_answers_agent.tools.search_govuk.tool import (
    chunked_content_retriever,
    search_govuk_content,
)

TOOL_MODULE = "agentic_answers_agent.tools.search_govuk.tool"


@pytest.fixture(autouse=True)
def clear_cached_retriever():
    chunked_content_retriever.cache_clear()
    yield
    chunked_content_retriever.cache_clear()


@pytest.fixture
def read_connection(mocker):
    return mocker.patch(f"{TOOL_MODULE}.read_opensearch_connection")


@pytest.fixture
def retriever(mocker, read_connection):
    retriever = mocker.patch(
        f"{TOOL_MODULE}.ChunkedContentRetriever"
    ).from_connection.return_value
    retriever.retrieve.return_value = []
    return retriever


def test_search_govuk_content_reads_the_connection_details_once(
    read_connection, retriever
):
    search_govuk_content(query="renew a passport")
    search_govuk_content(query="apply for a driving licence")

    read_connection.assert_called_once()
    assert retriever.retrieve.call_count == 2


def test_search_govuk_content_returns_the_ranked_results_formatted_for_the_model(
    retriever,
):
    retriever.retrieve.return_value = [
        SearchResult(
            score=0.8,
            exact_path="/renew-passport",
            title="Renew your passport",
            html_content="<p>Apply online.</p>",
        ),
        SearchResult(
            score=0.5,
            exact_path="/too-far",
            title="Below the minimum score",
            html_content="<p>Not relevant.</p>",
        ),
    ]

    assert search_govuk_content(query="renew a passport") == [
        {
            "page_url": "/renew-passport",
            "page_title": "Renew your passport",
            "context_headings": [],
            "context_content": "<p>Apply online.</p>",
        }
    ]
