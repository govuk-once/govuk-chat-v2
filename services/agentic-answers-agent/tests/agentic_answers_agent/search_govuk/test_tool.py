import pytest

from agentic_answers_agent.search_govuk.tool import (
    opensearch_retrieval,
    search_govuk_guidance,
)


@pytest.fixture(autouse=True)
def clear_cached_retrieval():
    opensearch_retrieval.cache_clear()
    yield
    opensearch_retrieval.cache_clear()


def test_search_govuk_guidance_reads_the_connection_details_once(mocker):
    read_settings = mocker.patch(
        "agentic_answers_agent.search_govuk.tool.read_opensearch_settings"
    )
    retrieval = mocker.patch(
        "agentic_answers_agent.search_govuk.tool.OpenSearchRetrieval"
    ).from_settings.return_value
    retrieval.retrieve.return_value = []

    search_govuk_guidance(query="renew a passport")
    search_govuk_guidance(query="apply for a driving licence")

    read_settings.assert_called_once()
    assert retrieval.retrieve.call_count == 2
