from agentic_answers_agent.tools.search_govuk.models import SearchResult


def search_result(
    score: float,
    document_type: str | None = None,
    parent_document_type: str | None = None,
) -> SearchResult:
    return SearchResult(
        score=score,
        exact_path="/example",
        title="Example",
        html_content="<p>Example</p>",
        document_type=document_type,
        parent_document_type=parent_document_type,
    )


class TestSearchResult:
    def test_source_field_names_leaves_out_the_score(self):
        assert "score" not in SearchResult.source_field_names()
        assert "exact_path" in SearchResult.source_field_names()

    def test_from_hit_takes_the_score_from_the_hit_and_the_rest_from_its_source(self):
        hit = {
            "_id": "1",
            "_score": 0.9,
            "_source": {
                "exact_path": "/renew-passport",
                "title": "Renew your passport",
                "html_content": "<p>Apply online.</p>",
                "document_type": "guide",
            },
        }

        assert SearchResult.from_hit(hit) == SearchResult(
            score=0.9,
            exact_path="/renew-passport",
            title="Renew your passport",
            html_content="<p>Apply online.</p>",
            document_type="guide",
        )

    def test_weighted_score_weights_the_score_by_document_type(self):
        assert search_result(0.5, "answer").weighted_score == 1.0
        assert search_result(0.5, "notice").weighted_score == 0.25

    def test_weighted_score_keeps_the_score_of_an_unweighted_document_type(self):
        assert search_result(0.8, "unweighted").weighted_score == 0.8
        assert search_result(0.7).weighted_score == 0.7

    def test_weighted_score_weights_an_html_publication_by_its_parent_document_type(
        self,
    ):
        result = search_result(0.5, "html_publication", parent_document_type="guide")

        assert result.weighted_score == 1.0
