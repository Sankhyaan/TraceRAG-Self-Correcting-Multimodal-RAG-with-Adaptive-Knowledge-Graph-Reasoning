import logging
from typing import Dict, List, Optional, Any
from backend.config import get_settings
from backend.synthesis.intent import classify_intent_with_llm

logger = logging.getLogger("trace.router")


class QueryRouter:
    """
    Pure LLM Semantic Modality Router for TraceRAG.
    Accurately identifies target media categories and active source files using Gemini.
    """

    def __init__(self):
        self.settings = get_settings()

    def route_query(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Returns target modality categories, target filename, and intent label.
        """
        try:
            llm_res = classify_intent_with_llm(query, conversation_id, conversation_history)
            intent_type = llm_res.get("intent_type", "CORPUS_QUERY")
            target_modality = llm_res.get("target_modality") or "document"
            target_filename = llm_res.get("target_filename")
            intent_label = llm_res.get("intent_label") or "Document (PDF/Docx)"
            reasoning = llm_res.get("reasoning", "")

            if intent_type == "CASUAL_CONVERSATION" or llm_res.get("is_conversational"):
                return {
                    "primary_categories": ["conversational"],
                    "primary_category": "conversational",
                    "target_filename": None,
                    "intent_label": "General Conversation",
                    "weights": {"document": 0.1, "image": 0.1, "audio": 0.1, "video": 0.1},
                    "rationale": reasoning or "General conversation dialogue",
                }

            target_modalities = llm_res.get("target_modalities") or []
            if target_modality == "multimodal" or len(target_modalities) > 1 or intent_label == "Multi-Modal":
                cats = target_modalities if target_modalities else ["document", "audio", "image", "video"]
                return {
                    "primary_categories": cats,
                    "primary_category": "multimodal",
                    "target_filename": None,
                    "intent_label": "Multi-Modal",
                    "weights": {"document": 1.0, "image": 1.0, "audio": 1.0, "video": 1.0},
                    "rationale": reasoning or "Multi-modal cross-document synthesis",
                }

            weights = {"document": 0.2, "image": 0.2, "audio": 0.2, "video": 0.2}
            weights[target_modality] = 1.0

            return {
                "primary_categories": [target_modality],
                "primary_category": target_modality,
                "target_filename": target_filename,
                "intent_label": intent_label,
                "weights": weights,
                "rationale": reasoning or f"Routed to {intent_label}",
            }
        except Exception as e:
            logger.warning(f"Semantic router note: {e}")
            return {
                "primary_categories": ["document"],
                "primary_category": "document",
                "target_filename": None,
                "intent_label": "Document (PDF/Docx)",
                "weights": {"document": 1.0, "image": 0.5, "audio": 0.5, "video": 0.5},
                "rationale": "Standard document query",
            }


query_router = QueryRouter()
