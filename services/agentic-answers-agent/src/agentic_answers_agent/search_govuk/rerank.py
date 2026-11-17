from agentic_answers_agent.search_govuk.models import OpenSearchHit, WeightedResult

DEFAULT_WEIGHTING = 1.0

DOCUMENT_TYPE_WEIGHTINGS: dict[str, float] = {
    "about": 1.1,
    "answer": 2.0,
    "business_finance_support_scheme": 2.0,
    "complaints_procedure": 1.1,
    "contact": 1.5,
    "detailed_guide": 1.5,
    "export_health_certificate": 0.5,
    "guidance": 1.1,
    "guide": 2.0,
    "help_page": 1.5,
    "licence_transaction": 2.0,
    "manual_section": 1.5,
    "notice": 0.5,
    "service_manual_guide": 0.5,
    "simple_smart_answer": 2.0,
    "step_by_step_nav": 2.0,
    "take_part": 0.5,
    "transaction": 2.0,
    "worldwide_organisation": 1.1,
    "travel_advice": 1.5,
    "local_transaction": 1.5,
}


def rerank(
    search_results: list[OpenSearchHit],
    max_results: int,
    threshold: float,
) -> list[WeightedResult]:
    """Weights each result by its document type, then keeps the highest
    scoring results at or above the threshold."""
    weighted_results = [_weight_result(result) for result in search_results]
    filtered_results = [
        result for result in weighted_results if result.weighted_score >= threshold
    ]
    return sorted(
        filtered_results, key=lambda result: result.weighted_score, reverse=True
    )[:max_results]


def _weight_result(hit: OpenSearchHit) -> WeightedResult:
    document_type = hit.source.document_type
    # HTML publications are attachments, so their parent says what they are.
    if document_type == "html_publication":
        document_type = hit.source.parent_document_type or document_type

    weighting = DOCUMENT_TYPE_WEIGHTINGS.get(document_type or "", DEFAULT_WEIGHTING)
    return WeightedResult(hit=hit, weighted_score=hit.score * weighting)
