from agentic_answers_agent.tools.search_govuk.models import SearchResult


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
