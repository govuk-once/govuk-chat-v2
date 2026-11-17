from typing import Any

from agentic_answers_agent.search_govuk.models import InputContext, WeightedResult


def format_results(ranked_results: list[WeightedResult]) -> list[dict[str, Any]]:
    """Maps search results to the fields the model is given, leaving out any
    that aren't set.

    This matches how Chat V1 builds its context:
    https://github.com/alphagov/govuk-chat/blob/02afd51980072e265d24237f8de3b4afb597b86e/lib/answer_composition/pipeline/context.rb#L67-L79
    """
    return [
        InputContext(
            page_url=result.hit.source.exact_path,
            page_title=result.hit.source.title,
            page_description=result.hit.source.description,
            context_headings=result.hit.source.heading_hierarchy or [],
            context_content=result.hit.source.html_content,
            llm_instructions=result.hit.source.llm_instructions,
        ).model_dump(exclude_none=True)
        for result in ranked_results
    ]
