from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from backend.graph.engine import graph_manager
from backend.graph.traverser import multi_hop_traverser
from backend.pipeline.retriever import hybrid_retriever
from backend.storage import get_supabase

router = APIRouter(prefix="/graph", tags=["knowledge-graph"])


class TraverseRequest(BaseModel):
    conversation_id: str
    query: str = ""
    entity_a: Optional[str] = None
    entity_b: Optional[str] = None


@router.get("/{conversation_id}")
def get_conversation_graph(conversation_id: str):
    """
    Returns nodes, edges, and statistics for the conversation's Knowledge Graph instantly.
    """
    cg = graph_manager.get_graph(conversation_id)

    # Prune inactive files that were deleted from Supabase, or build graph if not yet indexed
    try:
        sb = get_supabase()
        res = (
            sb.table("files")
            .select("id, filename, file_type, extracted_text")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        active_files = res.data or []
        active_file_ids = {row["id"] for row in active_files}

        # If graph is empty but extracted files exist in a personal workspace, build graph from real files
        if cg.graph.number_of_nodes() == 0 and len(active_files) > 0 and conversation_id != "conv_demo":
            for row in active_files:
                text = row.get("extracted_text")
                if text and text.strip():
                    graph_manager.index_file_text(
                        conversation_id=conversation_id,
                        file_id=row["id"],
                        filename=row["filename"],
                        file_type=row.get("file_type", "document"),
                        text=text,
                    )
        elif active_file_ids:
            cg.prune_inactive_files(active_file_ids)
    except Exception as e:
        print(f"[get_conversation_graph] Notice: {e}")

    return cg.get_graph_data()



@router.post("/traverse")
def traverse_knowledge_graph(req: TraverseRequest):
    """
    Traverses the graph to discover shortest paths and multi-hop citations between entities.
    """
    result = multi_hop_traverser.traverse(
        conversation_id=req.conversation_id,
        query=req.query,
        entity_a=req.entity_a,
        entity_b=req.entity_b,
    )
    return result.to_dict()


@router.post("/rebuild/{conversation_id}")
def rebuild_knowledge_graph(conversation_id: str):
    """
    Wipes and comprehensively re-extracts the Knowledge Graph for a conversation.
    """
    graph_manager.clear_conversation(conversation_id)
    try:
        sb = get_supabase()
        res = (
            sb.table("files")
            .select("id, conversation_id, filename, file_type, extracted_text")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        for row in res.data or []:
            text = row.get("extracted_text")
            if text and text.strip():
                hybrid_retriever.index_file(
                    file_id=row["id"],
                    conversation_id=row["conversation_id"],
                    filename=row["filename"],
                    file_type=row.get("file_type", "document"),
                    extracted_text=text,
                )
                graph_manager.index_file_text(
                    conversation_id=conversation_id,
                    file_id=row["id"],
                    filename=row["filename"],
                    file_type=row.get("file_type", "document"),
                    text=text,
                )

        cg = graph_manager.get_graph(conversation_id)
        return {
            "status": "success",
            "conversation_id": conversation_id,
            "node_count": cg.graph.number_of_nodes(),
            "edge_count": cg.graph.number_of_edges(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph rebuild failed: {str(e)}")
