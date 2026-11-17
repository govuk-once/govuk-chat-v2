from dataclasses import dataclass, fields

from pydantic import BaseModel, Field


@dataclass
class GovUkChunkSource:
    """The fields we use from a chunk of GOV.UK content in Chat V1's
    OpenSearch index."""

    exact_path: str
    title: str
    html_content: str
    heading_hierarchy: list[str] | None = None
    description: str | None = None
    document_type: str | None = None
    parent_document_type: str | None = None
    llm_instructions: str | None = None

    @classmethod
    def field_names(cls) -> list[str]:
        return [field.name for field in fields(cls)]


@dataclass
class OpenSearchHit:
    index: str
    id: str
    score: float
    source: GovUkChunkSource


@dataclass
class WeightedResult:
    hit: OpenSearchHit
    weighted_score: float


class InputContext(BaseModel):
    """A search result in the shape the model is given."""

    page_url: str = Field(
        ...,
        description="The URL of the page containing the context",
        title="Page Url",
    )
    page_title: str = Field(
        ...,
        description="The title of the page of which the context is an extract",
        title="Page Title",
    )
    page_description: str | None = Field(
        None,
        description="A description of the page of which the context is an extract",
        title="Page Description",
    )
    context_headings: list[str] = Field(
        ...,
        description="The parent and direct headings of the context",
        title="Context Headings",
    )
    context_content: str = Field(
        ...,
        description="The body content of the context in HTML format",
        title="Context Content",
    )
    llm_instructions: str | None = Field(
        None,
        description="Special instructions for the LLM, if any",
        title="LLM Instructions",
    )
