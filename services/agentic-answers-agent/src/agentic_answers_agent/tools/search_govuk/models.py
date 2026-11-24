from collections.abc import Mapping
from dataclasses import dataclass, fields
from typing import Any, Self


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
