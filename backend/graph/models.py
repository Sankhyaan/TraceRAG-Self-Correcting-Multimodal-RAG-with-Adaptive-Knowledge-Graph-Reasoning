import uuid
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


@dataclass
class EntityNode:
    id: str  # Canonical Node ID (e.g. 'ENTITY_DAVID_VANCE')
    name: str  # Canonical display name (e.g. 'David Vance')
    type: str = "CONCEPT"  # Dynamic open-ended type (e.g. PERSON, ORG, CONCEPT, PRODUCT, TECH, LOCATION...)
    conversation_id: str = ""
    aliases: List[str] = field(default_factory=list)  # Recorded surface mentions / co-referents
    file_ids: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "canonical_id": self.id,
            "type": self.type,
            "conversation_id": self.conversation_id,
            "aliases": self.aliases,
            "file_ids": self.file_ids,
            "metadata": self.metadata,
        }


@dataclass
class RelationEdge:
    id: str
    source: str  # Canonical source ID (e.g. 'ENTITY_DAVID_VANCE')
    target: str  # Canonical target ID (e.g. 'ENTITY_BERLIN_DIVISION')
    relation: str  # Dynamic open-ended relation in UPPERCASE_SNAKE_CASE
    evidence: str
    file_id: str
    filename: str
    chunk_id: str
    timestamp: Optional[str] = None
    start_timestamp: Optional[str] = None
    end_timestamp: Optional[str] = None
    frame_id: Optional[str] = None
    bounding_box: Optional[List[float]] = None  # Normalized [ymin, xmin, ymax, xmax]
    spatial_location: Optional[str] = None  # e.g. "top-left", "diagram-box-A"
    page_number: Optional[int] = None
    amount: Optional[float] = None  # Extracted numeric sub-allocation amount (e.g. 30000.0)
    currency: Optional[str] = None  # e.g. "USD", "EUR"
    properties: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.9
    metadata: Dict[str, Any] = field(default_factory=dict)  # source_name, target_name, etc.

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "relation": self.relation,
            "evidence": self.evidence,
            "file_id": self.file_id,
            "filename": self.filename,
            "chunk_id": self.chunk_id,
            "timestamp": self.timestamp,
            "start_timestamp": self.start_timestamp,
            "end_timestamp": self.end_timestamp,
            "frame_id": self.frame_id,
            "bounding_box": self.bounding_box,
            "spatial_location": self.spatial_location,
            "page_number": self.page_number,
            "amount": self.amount,
            "currency": self.currency,
            "properties": self.properties,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


@dataclass
class GraphPathHop:
    from_node: str  # Display name
    from_type: str
    relation: str
    to_node: str  # Display name
    to_type: str
    evidence: str
    filename: str
    file_id: str
    from_id: Optional[str] = None  # Canonical ID
    to_id: Optional[str] = None  # Canonical ID
    timestamp: Optional[str] = None
    start_timestamp: Optional[str] = None
    end_timestamp: Optional[str] = None
    frame_id: Optional[str] = None
    bounding_box: Optional[List[float]] = None
    spatial_location: Optional[str] = None
    page_number: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    properties: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from_node": self.from_node,
            "from_type": self.from_type,
            "from_id": self.from_id or self.from_node,
            "relation": self.relation,
            "to_node": self.to_node,
            "to_type": self.to_type,
            "to_id": self.to_id or self.to_node,
            "evidence": self.evidence,
            "filename": self.filename,
            "file_id": self.file_id,
            "timestamp": self.timestamp,
            "start_timestamp": self.start_timestamp,
            "end_timestamp": self.end_timestamp,
            "frame_id": self.frame_id,
            "bounding_box": self.bounding_box,
            "spatial_location": self.spatial_location,
            "page_number": self.page_number,
            "amount": self.amount,
            "currency": self.currency,
            "properties": self.properties,
        }


@dataclass
class MultiHopResult:
    is_multihop: bool
    query: str
    detected_entities: List[str]
    paths: List[List[GraphPathHop]]
    graph_context_text: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_multihop": self.is_multihop,
            "query": self.query,
            "detected_entities": self.detected_entities,
            "paths": [[hop.to_dict() for hop in path] for path in self.paths],
            "graph_context_text": self.graph_context_text,
        }
