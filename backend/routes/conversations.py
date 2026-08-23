import os
import json
import uuid
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.storage import get_supabase, storage_service
from backend.pipeline.bm25_index import bm25_manager

from backend.auth import get_current_user_id
from fastapi import Depends

from backend.demo_service import (
    get_demo_conversation,
    seed_demo_workspace,
    clone_demo_workspace,
    DEMO_CONV_ID,
)
from backend.graph.engine import graph_manager
from backend.pipeline.vector_store import vector_store

logger = logging.getLogger("trace.routes.conversations")
router = APIRouter(prefix="/conversations", tags=["Conversations"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "conversations")
GRAPHS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "graphs")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(GRAPHS_DIR, exist_ok=True)


class ConversationCreate(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None


class ConversationUpdate(BaseModel):
    title: str


class ConversationItem(BaseModel):
    id: str
    title: str
    file_count: int = 0
    message_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    is_demo: Optional[bool] = False


class MessageCreate(BaseModel):
    id: Optional[str] = None
    role: str  # 'user' or 'assistant'
    content: str
    citations: Optional[List[Dict[str, Any]]] = None
    critic_info: Optional[Dict[str, Any]] = None
    groundedness_score: Optional[float] = None
    retry_info: Optional[Dict[str, Any]] = None
    graph_hops: Optional[List[Dict[str, Any]]] = None
    graph_entities: Optional[List[str]] = None
    graph_context_text: Optional[str] = None
    created_at: Optional[str] = None


class MessageItem(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    citations: Optional[List[Dict[str, Any]]] = None
    critic_info: Optional[Dict[str, Any]] = None
    groundedness_score: Optional[float] = None
    retry_info: Optional[Dict[str, Any]] = None
    graph_hops: Optional[List[Dict[str, Any]]] = None
    graph_entities: Optional[List[str]] = None
    graph_context_text: Optional[str] = None
    created_at: str


class MessageStorage:
    """Manages dual-layer message persistence (Supabase Postgres + Local JSON backup)."""

    @staticmethod
    def _local_file(conv_id: str) -> str:
        return os.path.join(DATA_DIR, f"{conv_id}_messages.json")

    @classmethod
    def get_messages(cls, conv_id: str) -> List[Dict[str, Any]]:
        supabase = get_supabase()
        # 1. Try fetching from Supabase
        try:
            res = (
                supabase.table("messages")
                .select("*")
                .eq("conversation_id", conv_id)
                .order("created_at", desc=False)
                .execute()
            )
            if res.data and len(res.data) > 0:
                # Sync local cache
                with open(cls._local_file(conv_id), "w", encoding="utf-8") as f:
                    json.dump(res.data, f, indent=2)
                return res.data
        except Exception:
            pass

        # 2. Fallback to local storage
        loc_path = cls._local_file(conv_id)
        if os.path.exists(loc_path):
            try:
                with open(loc_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    @classmethod
    def save_message(cls, conv_id: str, message: Dict[str, Any], user_id: Optional[str] = None) -> Dict[str, Any]:
        msg_id = message.get("id") or f"msg_{uuid.uuid4().hex[:10]}"
        now_iso = message.get("created_at") or datetime.utcnow().isoformat()

        record = {
            "id": msg_id,
            "conversation_id": conv_id,
            "role": message.get("role", "user"),
            "content": message.get("content", ""),
            "citations": message.get("citations") or [],
            "critic_info": message.get("critic_info"),
            "groundedness_score": message.get("groundedness_score"),
            "retry_info": message.get("retry_info"),
            "graph_hops": message.get("graph_hops") or [],
            "graph_entities": message.get("graph_entities") or [],
            "graph_context_text": message.get("graph_context_text") or "",
            "created_at": now_iso,
        }
        if user_id:
            record["user_id"] = user_id

        # 1. Save to Supabase
        supabase = get_supabase()
        try:
            supabase.table("messages").insert(record).execute()
        except Exception:
            pass

        # 2. Save to local storage
        msgs = cls.get_messages(conv_id)
        # Avoid duplicate IDs
        msgs = [m for m in msgs if m.get("id") != msg_id]
        msgs.append(record)
        msgs.sort(key=lambda x: x.get("created_at") or "")

        with open(cls._local_file(conv_id), "w", encoding="utf-8") as f:
            json.dump(msgs, f, indent=2)

        # Update conversation updated_at timestamp & ensure user_id is assigned
        try:
            upd = {"updated_at": now_iso}
            if user_id:
                upd["user_id"] = user_id
            supabase.table("conversations").update(upd).eq("id", conv_id).execute()
        except Exception:
            pass

        return record

    @classmethod
    def clear_messages(cls, conv_id: str):
        supabase = get_supabase()
        try:
            supabase.table("messages").delete().eq("conversation_id", conv_id).execute()
        except Exception:
            pass

        loc_path = cls._local_file(conv_id)
        if os.path.exists(loc_path):
            try:
                os.remove(loc_path)
            except Exception:
                pass


message_storage = MessageStorage()


@router.get("", response_model=List[ConversationItem])
def list_conversations(user_id: Optional[str] = Depends(get_current_user_id)):
    """
    Lists saved conversations:
    - Guest Mode (user_id is None): returns the canonical VoltBus demo workspace.
    - Authenticated Mode: returns user's conversations. If user has 0 conversations,
      automatically clones the demo dataset into their account for seamless continuation.
    """
    # 1. Guest Mode -> return canonical demo workspace
    if not user_id:
        return [get_demo_conversation()]

    supabase = get_supabase()
    conversations_dict = {}

    # 2. Query user's conversations
    try:
        query = (
            supabase.table("conversations")
            .select("id,title,created_at,updated_at")
            .eq("user_id", user_id)
            .limit(500)
            .order("updated_at", desc=True)
        )
        res = query.execute()
        for item in res.data or []:
            conversations_dict[item["id"]] = {
                "id": item["id"],
                "title": item.get("title", "Untitled Session"),
                "file_count": 0,
                "message_count": 0,
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
                "is_demo": False,
            }
    except Exception as e:
        logger.warning(f"Error querying conversations for user {user_id}: {e}")

    # 3. First-time authentication -> auto-clone demo workspace into this user's account
    if not conversations_dict:
        try:
            cloned = clone_demo_workspace(user_id)
            return [cloned]
        except Exception as err:
            logger.error(f"Error auto-cloning demo workspace on first sign-in: {err}")
            # Fallback to creating a new clean conversation
            fallback_conv = create_conversation(ConversationCreate(title="New Conversation"), user_id=user_id)
            return [fallback_conv]

    # 4. Batch-count files for this user's sessions
    try:
        files_query = supabase.table("files").select("id,conversation_id,filename,uploaded_at").eq("user_id", user_id).limit(5000)
        files_res = files_query.execute()
        for f in files_res.data or []:
            c_id = f.get("conversation_id")
            if not c_id:
                continue
            if c_id not in conversations_dict:
                title = f.get("filename") or f"Session {c_id[:8]}"
                conversations_dict[c_id] = {
                    "id": c_id,
                    "title": title,
                    "file_count": 0,
                    "message_count": 0,
                    "created_at": f.get("uploaded_at"),
                    "updated_at": f.get("uploaded_at"),
                    "is_demo": False,
                }
            conversations_dict[c_id]["file_count"] += 1
    except Exception as e:
        logger.warning(f"Error querying files for user sessions: {e}")

    # 5. Batch-count messages for this user's sessions
    try:
        conv_ids = list(conversations_dict.keys())
        if conv_ids:
            msgs_query = supabase.table("messages").select("id,conversation_id").in_("conversation_id", conv_ids).limit(20000)
            msgs_res = msgs_query.execute()
            for m in msgs_res.data or []:
                c_id = m.get("conversation_id")
                if c_id and c_id in conversations_dict:
                    conversations_dict[c_id]["message_count"] += 1
    except Exception as e:
        logger.warning(f"Error batch-counting messages: {e}")

    result = list(conversations_dict.values())
    result.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return result


@router.post("/clone-demo", response_model=ConversationItem)
def clone_demo_route(user_id: Optional[str] = Depends(get_current_user_id)):
    """
    Explicitly clones the VoltBus demo workspace into the authenticated user's account.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required to clone demo workspace.")
    return clone_demo_workspace(user_id)


@router.post("", response_model=ConversationItem)
def create_conversation(
    payload: ConversationCreate,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Creates a new clean conversation session associated with the authenticated user.
    """
    supabase = get_supabase()
    conv_id = payload.id or f"conv_{uuid.uuid4().hex[:8]}"
    title = payload.title or "New Conversation"
    now_iso = datetime.utcnow().isoformat()

    record: Dict[str, Any] = {
        "id": conv_id,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    if user_id:
        record["user_id"] = user_id

    try:
        supabase.table("conversations").insert(record).execute()
    except Exception as e:
        logger.warning(f"Notice during conversation insert: {e}")

    return {
        "id": conv_id,
        "title": title,
        "file_count": 0,
        "message_count": 0,
        "created_at": now_iso,
        "updated_at": now_iso,
        "is_demo": False,
    }


@router.get("/{conversation_id}/messages", response_model=List[MessageItem])
def get_conversation_messages(conversation_id: str):
    """
    Retrieves the complete message history for a conversation.
    """
    return message_storage.get_messages(conversation_id)


@router.post("/{conversation_id}/messages", response_model=MessageItem)
def add_conversation_message(
    conversation_id: str,
    payload: MessageCreate,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Appends a new message to a conversation.
    """
    record = message_storage.save_message(conversation_id, payload.model_dump(), user_id=user_id)
    return record


@router.delete("/{conversation_id}/messages")
def clear_conversation_messages(
    conversation_id: str,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Clears message history for a conversation. Demo workspace cannot be cleared by guests.
    """
    if conversation_id == DEMO_CONV_ID and not user_id:
        raise HTTPException(status_code=403, detail="The demo chat history cannot be cleared in guest mode.")

    message_storage.clear_messages(conversation_id)
    return {"success": True, "conversation_id": conversation_id}


@router.patch("/{conversation_id}")
def update_conversation(
    conversation_id: str,
    payload: ConversationUpdate,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Renames a conversation.
    """
    if conversation_id == DEMO_CONV_ID and not user_id:
        raise HTTPException(status_code=403, detail="The demo workspace title cannot be changed.")

    supabase = get_supabase()
    now_iso = datetime.utcnow().isoformat()
    try:
        supabase.table("conversations").update({
            "title": payload.title,
            "updated_at": now_iso,
        }).eq("id", conversation_id).execute()
        return {"success": True, "id": conversation_id, "title": payload.title}
    except Exception as e:
        try:
            supabase.table("conversations").insert({
                "id": conversation_id,
                "title": payload.title,
                "created_at": now_iso,
                "updated_at": now_iso,
            }).execute()
            return {"success": True, "id": conversation_id, "title": payload.title}
        except Exception:
            raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Executes a cascading workspace wipe: deletes all associated files in storage,
    files table, messages table, Qdrant vectors, BM25 index, knowledge graph JSON,
    and the conversation row itself.
    """
    if conversation_id == DEMO_CONV_ID:
        raise HTTPException(status_code=403, detail="The shared VoltBus demo workspace cannot be deleted.")

    supabase = get_supabase()

    # 1. Clear files from Supabase Storage & Files table
    deleted_files = storage_service.clear_conversation_files(conversation_id)

    # 2. Clear dense vectors from Qdrant
    try:
        vector_store.delete_conversation_chunks(conversation_id)
    except Exception as e:
        logger.warning(f"Notice deleting Qdrant vectors: {e}")

    # 3. Clear sparse BM25 index
    try:
        bm25_manager.clear_conversation(conversation_id)
    except Exception as e:
        logger.warning(f"Notice clearing BM25 index: {e}")

    # 4. Clear knowledge graph JSON & in-memory graph
    try:
        graph_manager.clear_conversation(conversation_id)
        g_path = os.path.join(GRAPHS_DIR, f"{conversation_id}.json")
        if os.path.exists(g_path):
            os.remove(g_path)
    except Exception as e:
        logger.warning(f"Notice clearing graph: {e}")

    # 5. Clear messages from database and local disk mirror
    message_storage.clear_messages(conversation_id)

    # 6. Delete conversation record from Supabase
    try:
        supabase.table("conversations").delete().eq("id", conversation_id).execute()
    except Exception as e:
        logger.warning(f"Notice deleting conversation record: {e}")

    return {
        "success": True,
        "deleted_id": conversation_id,
        "deleted_files_count": deleted_files,
    }
