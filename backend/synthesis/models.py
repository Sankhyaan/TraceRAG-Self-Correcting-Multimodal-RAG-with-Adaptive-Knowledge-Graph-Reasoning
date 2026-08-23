from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class CriticResult(BaseModel):
    confidence: str = Field(description="'high', 'medium', or 'low'")
    reason: str = Field(description="Short rationale explaining what facts are present or missing")
    missing_aspects: List[str] = Field(default_factory=list, description="Specific concepts or facts needed but missing")
    should_retry: bool = Field(default=False, description="True if confidence is low and retrieval should be retried")


class CitationVerification(BaseModel):
    passage_number: int = Field(description="Passage index cited (e.g. 1 for [1])")
    claim_text: str = Field(description="The factual claim made in the generated answer")
    evidence_quote: str = Field(description="Direct snippet from the referenced passage supporting the claim")
    is_grounded: bool = Field(description="True if the passage factually substantiates the claim")
    status: str = Field(default="VERIFIED", description="'VERIFIED', 'UNSUPPORTED', or 'CONTRADICTED'")
    filename: Optional[str] = None
    file_id: Optional[str] = None
    page_number: Optional[int] = None
    timestamp: Optional[str] = None


class RetryInfo(BaseModel):
    retried: bool = False
    original_query: str = ""
    reformulated_query: Optional[str] = None
    reason: Optional[str] = None
    initial_confidence: Optional[str] = None


class SynthesisResult(BaseModel):
    query: str
    conversation_id: str
    answer: str
    confidence: str
    critic: CriticResult
    retry_info: RetryInfo
    citations: List[CitationVerification] = Field(default_factory=list)
    groundedness_score: float = Field(default=1.0, description="Ratio of verified citations (0.0 to 1.0)")
    chunks: List[Dict[str, Any]] = Field(default_factory=list)
    graph_hops: Optional[List[Dict[str, Any]]] = None
    graph_entities: Optional[List[str]] = Field(default_factory=list)
    graph_context_text: Optional[str] = None
    routed_categories: List[str] = Field(default_factory=list)
