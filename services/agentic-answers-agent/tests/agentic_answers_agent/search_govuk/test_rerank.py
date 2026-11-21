from agentic_answers_agent.search_govuk.models import GovUkChunkSource, OpenSearchHit
from agentic_answers_agent.search_govuk.rerank import rerank


def search_hit(
    score: float,
    document_type: str | None = None,
    parent_document_type: str | None = None,
) -> OpenSearchHit:
    source = GovUkChunkSource(
        exact_path="/example",
        title="Example",
        html_content="<p>Example</p>",
        document_type=document_type,
        parent_document_type=parent_document_type,
    )
    return OpenSearchHit(index="index", id="id", score=score, source=source)


def weighted_scores(hits: list[OpenSearchHit], **kwargs) -> list[float]:
    options = {"max_results": 20, "threshold": 0.0} | kwargs
    return [result.weighted_score for result in rerank(hits, **options)]


class TestRerank:
    def test_weights_by_document_type_and_sorts_by_weighted_score(self):
        hits = [search_hit(0.5, "notice"), search_hit(0.5, "answer")]

        assert weighted_scores(hits) == [1.0, 0.25]

    def test_keeps_the_score_of_an_unweighted_document_type(self):
        hits = [search_hit(0.8, "unweighted"), search_hit(0.7)]

        assert weighted_scores(hits) == [0.8, 0.7]

    def test_weights_an_html_publication_by_its_parent_document_type(self):
        hits = [search_hit(0.5, "html_publication", parent_document_type="guide")]

        assert weighted_scores(hits) == [1.0]

    def test_keeps_results_scoring_at_least_the_threshold(self):
        hits = [search_hit(0.75), search_hit(0.74)]

        assert weighted_scores(hits, threshold=0.75) == [0.75]

    def test_keeps_the_highest_scoring_results_up_to_max_results(self):
        hits = [search_hit(0.8), search_hit(0.9), search_hit(0.7)]

        assert weighted_scores(hits, max_results=2) == [0.9, 0.8]
