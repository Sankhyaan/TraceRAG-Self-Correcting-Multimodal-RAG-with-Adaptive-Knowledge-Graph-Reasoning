import re
import json
import logging
from typing import Dict, Any, List, Optional
from backend.config import get_settings
from backend.storage import storage_service

logger = logging.getLogger("trace.synthesis.intent")


def classify_intent_with_llm(
    query: str,
    conversation_id: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Pure LLM Semantic Intent Classifier & Modality Router.
    Evaluates query semantics, ongoing dialogue history, and active session files
    without brittle hardcoded regex rules.
    """
    settings = get_settings()

    # 1. Fetch available files in this session to provide corpus grounding
    file_context_lines = []
    if conversation_id:
        try:
            files = storage_service.list_files(conversation_id)
            for f in files:
                fname = f.get("filename", "")
                ftype = f.get("file_type", "document")
                snippet = (f.get("extracted_text") or "")[:120].replace("\n", " ").strip()
                file_context_lines.append(f"- '{fname}' ({ftype}): {snippet}...")
        except Exception as e:
            logger.debug(f"File context note: {e}")

    file_context_str = "\n".join(file_context_lines) if file_context_lines else "No files uploaded in this session."

    history_str = ""
    if conversation_history:
        recent = conversation_history[-4:]
        history_str = "Recent Conversation History:\n" + "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
            for m in recent
        ) + "\n\n"

    # Default fallback object
    default_res = {
        "intent_type": "CORPUS_QUERY",
        "is_conversational": False,
        "target_modality": "document",
        "target_filename": None,
        "intent_label": "Document (PDF/Docx)",
        "reasoning": "Standard document search",
    }

    if not settings.gemini_api_key:
        return default_res

    prompt = f"""You are the Semantic Intent Classifier for TraceRAG.
Determine if the user's message is CASUAL_CONVERSATION (general chatting, greetings, jokes, philosophical or coding questions) OR CORPUS_QUERY (asking about uploaded session files, courses, videos, audio, resumes, project budgets, transfers, diagrams, or documents).

IMPORTANT MULTI-MODAL ROUTING RULES:
1. If the user's question spans or requires information from multiple modalities/files (e.g. asking for project budget, leadership, transfer locations, effective dates which span PDF documents, audio updates, and diagrams), classify it as MULTI-MODAL!
2. For multi-modal queries, set "target_modality": "multimodal", "target_modalities": ["document", "audio", "image", "video"], "intent_label": "Multi-Modal", and "target_filename": null.
3. If the query clearly targets a single specific modality or file (e.g. "summarize the video" or "what does page 3 of the PDF say"), specify that exact modality and filename.

Session Files:
{file_context_str}

{history_str}User Message:
\"{query}\"

Return ONLY a JSON object matching this schema:
{{
  "intent_type": "CASUAL_CONVERSATION" | "CORPUS_QUERY",
  "is_conversational": true | false,
  "target_modality": "multimodal" | "video" | "document" | "audio" | "image" | null,
  "target_modalities": ["document", "audio", "image", "video"],
  "target_filename": "exact matching filename from session files if single-file" | null,
  "intent_label": "Multi-Modal" | "General Conversation" | "Video Presentation (Filename)" | "Document (Filename)" | "Audio Transcript (Filename)" | "Image / Diagram (Filename)",
  "reasoning": "Brief explanation."
}}"""

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
        raw = resp.text.strip() if resp.text else "{}"
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        return data
    except Exception as e:
        logger.warning(f"Pure LLM semantic intent classification failed: {e}")
        return default_res


def is_conversational_query(
    query: str,
    conversation_id: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> bool:
    """
    Returns True if the query is general dialogue rather than a corpus inquiry.
    """
    res = classify_intent_with_llm(query, conversation_id, conversation_history)
    return res.get("is_conversational", False) or res.get("intent_type") == "CASUAL_CONVERSATION"


CONVERSATIONAL_SYSTEM_PROMPT = """You are Trace, a friendly, highly intelligent, conversational AI assistant with the natural language abilities and charm of ChatGPT, Gemini, and Claude.

When conversing:
1. Speak naturally, warmly, and helpfully like an articulate human friend and expert.
2. Remember the ongoing conversation context and answer seamlessly.
3. If the user asks general questions, chat casually, share interesting thoughts, or answer their questions directly.
4. If relevant, remind them that you can also search and verify insights from any files they've uploaded in the session.
"""


def generate_conversational_response(
    query: str,
    conversation_id: str,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """
    Generates a natural, friendly conversational response for chit-chat, greetings, and general dialogue.
    """
    settings = get_settings()

    file_count = 0
    file_names = []
    try:
        files = storage_service.list_files(conversation_id)
        file_count = len(files)
        file_names = [f.filename for f in files[:4]]
    except Exception:
        pass

    history_str = ""
    if conversation_history:
        recent = conversation_history[-6:]
        history_str = "Conversation History:\n" + "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Trace'}: {m.get('content', '')}"
            for m in recent
        ) + "\n\n"

    context_msg = f"{history_str}User message: \"{query}\"\n"
    if file_count > 0:
        names_str = ", ".join(f"'{name}'" for name in file_names)
        context_msg += f"\nSession files: {file_count} uploaded ({names_str})."

    if settings.gemini_api_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.gemini_api_key)
            resp = client.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents=f"{CONVERSATIONAL_SYSTEM_PROMPT}\n\n{context_msg}",
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    max_output_tokens=400,
                ),
            )
            if resp.text and resp.text.strip():
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"Gemini conversational generation failed: {e}")

    return "Hello! I'm here with you. Feel free to ask me anything or explore any of your uploaded files."
