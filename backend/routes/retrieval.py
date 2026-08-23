from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.bm25_index import bm25_manager
from backend.pipeline.vector_store import vector_store

router = APIRouter(prefix="/retrieval", tags=["Retrieval"])


class RetrievalQueryRequest(BaseModel):
    conversation_id: str
    query: str
    top_k: Optional[int] = 5
    alpha: Optional[float] = 0.5
    use_router: Optional[bool] = True


class RetrievedChunkResponse(BaseModel):
    chunk_id: str
    file_id: str
    conversation_id: str
    filename: str
    file_type: str
    chunk_index: int
    text: str
    timestamp: Optional[str] = None
    page_number: Optional[int] = None
    # Raw scores (kept for pipeline compatibility)
    dense_score: Optional[float] = 0.0
    bm25_score: Optional[float] = 0.0
    final_score: float
    # Normalized 0-100% scores for Inspector UI
    final_score_pct: Optional[float] = None
    dense_score_pct: Optional[float] = None
    bm25_score_pct: Optional[float] = None
    # Metadata
    confidence_tier: Optional[str] = None     # "HIGH" | "MEDIUM" | "LOW"
    coordination_ratio: Optional[float] = None
    modality_boost: Optional[float] = 0.0


class ModalityGap(BaseModel):
    modality: str
    status: str
    message: str


class RetrievalQueryResponse(BaseModel):
    query: str
    conversation_id: str
    routed_categories: List[str]
    router_weights: Dict[str, float]
    router_rationale: str
    router_intent_label: Optional[str] = None
    alpha: float
    total_candidates: int
    chunks: List[RetrievedChunkResponse]
    modality_gaps: Optional[List[ModalityGap]] = None


@router.post("/query", response_model=RetrievalQueryResponse)
def query_retrieval(payload: RetrievalQueryRequest):
    """
    Executes hybrid dense vector and sparse keyword retrieval with query intent routing.
    Returns Min-Max normalized scores (0-100%), confidence tiers, and modality gap info.
    """
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Query string cannot be empty.")
    if not payload.conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required.")

    try:
        result = hybrid_retriever.retrieve(
            conversation_id=payload.conversation_id,
            query=payload.query.strip(),
            top_k=payload.top_k or 5,
            alpha=payload.alpha if payload.alpha is not None else 0.5,
            use_router=payload.use_router if payload.use_router is not None else True,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrieval query failed: {str(e)}")


@router.post("/index-conversation/{conversation_id}")
def index_conversation_files(conversation_id: str):
    """
    Indexes or re-indexes all extracted files for a conversation into Qdrant & BM25.
    """
    try:
        hybrid_retriever.index_conversation_if_needed(conversation_id)
        bm25_idx = bm25_manager.get_index(conversation_id)
        return {
            "success": True,
            "conversation_id": conversation_id,
            "indexed_chunks_count": len(bm25_idx.chunks),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/conversation/{conversation_id}")
def clear_retrieval_index(conversation_id: str):
    """
    Clears Qdrant vectors and BM25 index for a conversation.
    """
    try:
        vector_store.delete_conversation_chunks(conversation_id)
        bm25_manager.clear_conversation(conversation_id)
        return {"success": True, "conversation_id": conversation_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
