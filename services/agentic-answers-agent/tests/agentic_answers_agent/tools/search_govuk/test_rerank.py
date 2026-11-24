from agentic_answers_agent.tools.search_govuk.models import SearchResult
from agentic_answers_agent.tools.search_govuk.rerank import rerank


def search_result(score: float, document_type: str | None = None) -> SearchResult:
    return SearchResult(
        score=score,
        exact_path="/example",
        title="Example",
        html_content="<p>Example</p>",
        document_type=document_type,
    )


def weighted_scores(results: list[SearchResult], **kwargs) -> list[float]:
    options = {"max_results": 20, "threshold": 0.0} | kwargs
    return [result.weighted_score for result in rerank(results, **options)]


class TestRerank:
    def test_sorts_by_weighted_score(self):
        results = [search_result(0.5, "notice"), search_result(0.5, "answer")]

        assert weighted_scores(results) == [1.0, 0.25]

    def test_keeps_results_with_a_weighted_score_of_at_least_the_threshold(self):
        results = [search_result(0.75), search_result(0.74)]

        assert weighted_scores(results, threshold=0.75) == [0.75]

    def test_keeps_the_highest_scoring_results_up_to_max_results(self):
        results = [search_result(0.8), search_result(0.9), search_result(0.7)]

        assert weighted_scores(results, max_results=2) == [0.9, 0.8]
