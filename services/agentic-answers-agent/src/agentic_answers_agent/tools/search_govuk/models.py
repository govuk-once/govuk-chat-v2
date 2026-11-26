from collections.abc import Mapping
from dataclasses import dataclass, fields
from typing import Any, NotRequired, Self, TypedDict

from agentic_answers_agent.tools.search_govuk.document_type_weightings import (
    DEFAULT_WEIGHTING,
    DOCUMENT_TYPE_WEIGHTINGS,
)


class GovukContentChunk(TypedDict):
    page_url: str
    page_title: str
    page_description: NotRequired[str]
    context_headings: list[str]
    context_content: str
    llm_instructions: NotRequired[str]


@dataclass(frozen=True, kw_only=True)
class SearchResult:
    score: float
    exact_path: str
    title: str
    html_content: str
    heading_hierarchy: list[str] | None = None
    description: str | None = None
    document_type: str | None = None
    parent_document_type: str | None = None
    llm_instructions: str | None = None

    @classmethod
    def source_field_names(cls) -> list[str]:
        return [field.name for field in fields(cls) if field.name != "score"]

    @classmethod
    def from_hit(cls, hit: Mapping[str, Any]) -> Self:
        return cls(score=hit["_score"], **hit["_source"])

    def as_content_chunk(self) -> GovukContentChunk:
        chunk: GovukContentChunk = {
            "page_url": self.exact_path,
            "page_title": self.title,
            "context_headings": self.heading_hierarchy or [],
            "context_content": self.html_content,
        }
        if self.description is not None:
            chunk["page_description"] = self.description
        if self.llm_instructions is not None:
            chunk["llm_instructions"] = self.llm_instructions
        return chunk

    @property
    def weighted_score(self) -> float:
        document_type = self.document_type
        # HTML publications are attachments, so their parent says what they are.
        if document_type == "html_publication":
            document_type = self.parent_document_type or document_type
        weighting = DOCUMENT_TYPE_WEIGHTINGS.get(document_type or "", DEFAULT_WEIGHTING)
        return self.score * weighting
