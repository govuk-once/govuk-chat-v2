from agentic_answers_agent.search_govuk.format import format_results
from agentic_answers_agent.search_govuk.models import (
    GovUkChunkSource,
    OpenSearchHit,
    WeightedResult,
)


def weighted_result(source: GovUkChunkSource) -> WeightedResult:
    hit = OpenSearchHit(index="index", id="id", score=0.9, source=source)
    return WeightedResult(hit=hit, weighted_score=0.9)


def test_format_results_maps_a_result_to_the_model_input():
    source = GovUkChunkSource(
        exact_path="/renew-passport/how-to",
        title="Renew your passport",
        description="How to renew your passport",
        heading_hierarchy=["How to renew"],
        html_content="<p>Apply online.</p>",
        llm_instructions="Mention the fee",
    )

    assert format_results([weighted_result(source)]) == [
        {
            "page_url": "/renew-passport/how-to",
            "page_title": "Renew your passport",
            "page_description": "How to renew your passport",
            "context_headings": ["How to renew"],
            "context_content": "<p>Apply online.</p>",
            "llm_instructions": "Mention the fee",
        }
    ]


def test_format_results_leaves_out_fields_that_are_not_set():
    source = GovUkChunkSource(
        exact_path="/renew-passport",
        title="Renew your passport",
        html_content="<p>Apply online.</p>",
    )

    [result] = format_results([weighted_result(source)])

    assert "page_description" not in result
    assert "llm_instructions" not in result
    assert result["context_headings"] == []
