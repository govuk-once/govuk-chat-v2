from agentic_answers_agent.tools.search_govuk.models import SearchResult


def rerank(
    search_results: list[SearchResult],
    max_results: int,
    threshold: float,
) -> list[SearchResult]:
    kept = [result for result in search_results if result.weighted_score >= threshold]
    return sorted(kept, key=lambda result: result.weighted_score, reverse=True)[
        :max_results
    ]
