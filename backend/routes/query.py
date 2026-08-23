import uuid
import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from backend.synthesis.pipeline import synthesis_pipeline
from backend.synthesis.models import SynthesisResult
from backend.routes.conversations import message_storage
from backend.storage import get_supabase

logger = logging.getLogger("trace.routes.query")
router = APIRouter(prefix="/query", tags=["Query & Synthesis"])


class QueryRequest(BaseModel):
    conversation_id: str
    query: str
    top_k: int = Field(default=5, ge=1, le=20)
    alpha: float = Field(default=0.5, ge=0.0, le=1.0)
    use_router: bool = True


@router.post("", response_model=SynthesisResult)
async def query_and_synthesize(req: QueryRequest):
    """
    Unified multimodal RAG query endpoint with immediate message persistence.
    Performs Router -> Hybrid Retrieval -> Multi-Hop Knowledge Graph ->
    Retrieval Critic -> Reformulation Retry (if low confidence) ->
    Cited Generation -> Claim-by-Claim Citation Verification.
    """
    clean_query = req.query.strip()
    if not clean_query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    now_user = datetime.utcnow().isoformat()
    # 1. Save User Question message immediately
    user_msg_id = f"msg_u_{uuid.uuid4().hex[:8]}"
    try:
        message_storage.save_message(req.conversation_id, {
            "id": user_msg_id,
            "role": "user",
            "content": clean_query,
            "created_at": now_user,
        })
    except Exception as e:
        logger.warning(f"Failed to persist user message: {e}")

    try:
        result = synthesis_pipeline.synthesize(
            conversation_id=req.conversation_id,
            query=clean_query,
            top_k=req.top_k,
            alpha=req.alpha,
            use_router=req.use_router,
        )

        # 2. Save Assistant Response message immediately with citations and critic data
        now_assistant = datetime.utcnow().isoformat()
        assistant_msg_id = f"msg_a_{uuid.uuid4().hex[:8]}"
        try:
            message_storage.save_message(req.conversation_id, {
                "id": assistant_msg_id,
                "role": "assistant",
                "content": result.answer,
                "citations": [c.model_dump() for c in result.citations],
                "critic_info": result.critic.model_dump(),
                "groundedness_score": result.groundedness_score,
                "retry_info": result.retry_info.model_dump(),
                "graph_hops": result.graph_hops or [],
                "graph_entities": result.graph_entities or [],
                "graph_context_text": result.graph_context_text or "",
                "created_at": now_assistant,
            })
        except Exception as e:
            logger.warning(f"Failed to persist assistant response: {e}")

        # 3. Auto-update conversation title if it's currently a default generic title
        try:
            supabase = get_supabase()
            res = supabase.table("conversations").select("title").eq("id", req.conversation_id).execute()
            current_title = res.data[0]["title"] if res.data else "New Conversation"
            if current_title in ("New Conversation", "Untitled Session") or current_title.startswith("Session conv_"):
                # Generate clean 40-char title from first question
                new_title = clean_query[:40].strip()
                if len(clean_query) > 40:
                    new_title += "..."
                supabase.table("conversations").update({"title": new_title, "updated_at": now_assistant}).eq("id", req.conversation_id).execute()
        except Exception:
            pass

        return result
    except Exception as e:
        logger.error(f"Error during query synthesis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query synthesis failed: {str(e)}")


@router.post("/stream")
async def query_and_synthesize_stream(req: QueryRequest):
    """
    Streaming endpoint: streams real-time SSE progress events:
    route -> retrieve -> graph -> confidence -> retry -> answer -> verify -> done
    """
    clean_query = req.query.strip()
    if not clean_query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    now_user = datetime.utcnow().isoformat()
    # 1. Save User Question message immediately
    user_msg_id = f"msg_u_{uuid.uuid4().hex[:8]}"
    try:
        message_storage.save_message(req.conversation_id, {
            "id": user_msg_id,
            "role": "user",
            "content": clean_query,
            "created_at": now_user,
        })
    except Exception as e:
        logger.warning(f"Failed to persist user message: {e}")

    def event_stream():
        final_result = None
        try:
            for event in synthesis_pipeline.synthesize_stream(
                conversation_id=req.conversation_id,
                query=clean_query,
                top_k=req.top_k,
                alpha=req.alpha,
                use_router=req.use_router,
            ):
                if event.get("event") == "done":
                    final_result = event["data"]["result"]
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"
        except Exception as e:
            logger.error(f"Error during stream generation: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        # Save assistant message on done
        if final_result:
            now_assistant = datetime.utcnow().isoformat()
            assistant_msg_id = f"msg_a_{uuid.uuid4().hex[:8]}"
            try:
                message_storage.save_message(req.conversation_id, {
                    "id": assistant_msg_id,
                    "role": "assistant",
                    "content": final_result.get("answer", ""),
                    "citations": final_result.get("citations", []),
                    "critic_info": final_result.get("critic"),
                    "groundedness_score": final_result.get("groundedness_score"),
                    "retry_info": final_result.get("retry_info"),
                    "graph_hops": final_result.get("graph_hops", []),
                    "graph_entities": final_result.get("graph_entities", []),
                    "graph_context_text": final_result.get("graph_context_text", ""),
                    "created_at": now_assistant,
                })
            except Exception as e:
                logger.warning(f"Failed to persist assistant response: {e}")

            # Auto-update title if needed
            try:
                supabase = get_supabase()
                res = supabase.table("conversations").select("title").eq("id", req.conversation_id).execute()
                current_title = res.data[0]["title"] if res.data else "New Conversation"
                if current_title in ("New Conversation", "Untitled Session") or current_title.startswith("Session conv_"):
                    new_title = clean_query[:40].strip()
                    if len(clean_query) > 40:
                        new_title += "..."
                    supabase.table("conversations").update({"title": new_title, "updated_at": now_assistant}).eq("id", req.conversation_id).execute()
            except Exception:
                pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")
