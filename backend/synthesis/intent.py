import re
import json
import logging
from typing import Dict, Any, List, Optional
from backend.config import get_settings
from backend.storage import storage_service

logger = logging.getLogger("trace.synthesis.intent")

GREETING_PATTERNS = [
    r"^(hi|hello|hey|greetings|howdy|sup|yo|hi\s+there|hello\s+there)\b",
    r"^(good\s+(morning|afternoon|evening|day|night))\b",
    r"^(how\s+are\s+you|how\s+are\s+you\s+doing|how's\s+it\s+going|hows\s+it\s+going|what's\s+up|whats\s+up)\b",
    r"^(who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do|introduce\s+yourself|help\s+me)\b",
    r"^(thanks|thank\s+you|thank\s+you\s+very\s+much|thanks\s+a\s+lot|bye|goodbye|see\s+you)\b",
]

FILE_EXPLICIT_TRIGGERS = [
    r"\b(pdf|docx?|txt|markdown|document|documents|file|files|upload|uploaded|schematic|diagram|blueprint)\b",
    r"\b(video|audio|recording|transcript|presentation|keyframe|slide|slides|page\s+\d+|table\s+\d+)\b",
    r"\b(in\s+the\s+file|in\s+the\s+document|in\s+the\s+pdf|from\s+the\s+data|according\s+to\s+the|based\s+on\s+the\s+file)\b",
    r"\b(voltbus|stop\s+7|elena\s+rostova|marcus\s+vance|route\s+101|depot-gamma|mmig|vuts|phase\s+ii|level\s+1\s+thermal)\b",
]


def classify_intent_with_llm(
    query: str,
    conversation_id: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    High-Precision Semantic Intent Classifier & Scope Router.
    Accurately differentiates between:
    1. GENERAL_KNOWLEDGE / CASUAL_CONVERSATION: World facts, science, coding, math, explanations, greetings, definitions.
    2. CORPUS_QUERY: Specific inquiries targeting uploaded private session files, documents, schematics, or specific project details.
    """
    settings = get_settings()
    clean_q = query.strip()
    q_low = clean_q.lower()

    # 1. Fetch available files in this session to provide corpus grounding
    session_filenames = []
    file_context_lines = []
    if conversation_id:
        try:
            files = storage_service.list_files(conversation_id)
            for f in files:
                fname = f.get("filename", "")
                ftype = f.get("file_type", "document")
                if fname:
                    session_filenames.append(fname)
                    snippet = (f.get("extracted_text") or "")[:120].replace("\n", " ").strip()
                    file_context_lines.append(f"- '{fname}' ({ftype}): {snippet}...")
        except Exception as e:
            logger.debug(f"File context note: {e}")

    file_context_str = "\n".join(file_context_lines) if file_context_lines else "No files uploaded in this session."

    # Fast heuristic pre-checks
    has_file_trigger = any(re.search(pat, q_low) for pat in FILE_EXPLICIT_TRIGGERS)
    has_filename_mention = any(fn.lower() in q_low for fn in session_filenames if len(fn) > 3)
    is_greeting = any(re.search(pat, q_low) for pat in GREETING_PATTERNS)

    if is_greeting and not has_file_trigger:
        return {
            "intent_type": "CASUAL_CONVERSATION",
            "is_conversational": True,
            "target_modality": None,
            "target_modalities": [],
            "target_filename": None,
            "intent_label": "General Conversation",
            "reasoning": "Standard greeting or small talk.",
        }

    history_str = ""
    if conversation_history:
        recent = conversation_history[-4:]
        history_str = "Recent Conversation History:\n" + "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
            for m in recent
        ) + "\n\n"

    if not settings.gemini_api_key:
        if has_file_trigger or has_filename_mention:
            return {
                "intent_type": "CORPUS_QUERY",
                "is_conversational": False,
                "target_modality": "document",
                "target_filename": session_filenames[0] if session_filenames else None,
                "intent_label": "Document (PDF/Docx)",
                "reasoning": "Heuristic match for document keywords.",
            }
        return {
            "intent_type": "GENERAL_KNOWLEDGE",
            "is_conversational": True,
            "target_modality": None,
            "target_modalities": [],
            "target_filename": None,
            "intent_label": "General Knowledge & Reasoning",
            "reasoning": "General knowledge inquiry.",
        }

    prompt = f"""You are the Semantic Intent Classifier for Trace, an intelligent Multimodal AI Assistant.

TASK:
Determine whether the user's inquiry is:
1. "GENERAL_KNOWLEDGE" / "CASUAL_CONVERSATION":
   - Greetings, casual talk, jokes, identity questions ("hi", "how are you", "who are you").
   - General world knowledge, facts, history, science, geography ("what is photosynthesis?", "what is the speed of light?", "who was Isaac Newton?").
   - General engineering, physics, hardware concepts not specific to uploaded files ("how do electric motors work in general?", "what is an inverter?", "explain AC vs DC", "how do batteries store energy?").
   - Coding, programming, algorithms, debugging, math ("write a python function to sort an array", "how does binary search work?", "what is Docker?").
   - Broad explanations, brainstorming, tutorials, advice, or translations.
2. "CORPUS_QUERY":
   - Explicitly asks about uploaded documents, PDFs, schematics, transcripts, or session files ("what does page 3 say?", "in the uploaded pdf", "summarize the video presentation", "in the schematic diagram").
   - Inquires about specific private project entities, incident reports, or names found in the session files (e.g. "VoltBus", "Stop 7 incident", "Elena Rostova", "Marcus Vance", "Route 101", "Depot-Gamma", "MMIG").

Session Files Present:
{file_context_str}

{history_str}User Message:
\"{clean_q}\"

Return ONLY a JSON object matching this schema:
{{
  "intent_type": "GENERAL_KNOWLEDGE" | "CASUAL_CONVERSATION" | "CORPUS_QUERY",
  "is_conversational": true | false,
  "target_modality": "multimodal" | "video" | "document" | "audio" | "image" | null,
  "target_modalities": ["document", "audio", "image", "video"],
  "target_filename": "exact matching filename from session files if single-file" | null,
  "intent_label": "General Knowledge & Reasoning" | "General Conversation" | "Multi-Modal" | "Document (Filename)" | "Video Presentation (Filename)" | "Audio Transcript (Filename)" | "Image / Diagram (Filename)",
  "reasoning": "Short 1-sentence reason for classification."
}}"""

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model=settings.gemini_model or "gemini-2.5-flash",
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

        intent_type = data.get("intent_type", "GENERAL_KNOWLEDGE")
        if intent_type in ("GENERAL_KNOWLEDGE", "CASUAL_CONVERSATION"):
            data["is_conversational"] = True
        elif intent_type == "CORPUS_QUERY":
            data["is_conversational"] = False

        return data
    except Exception as e:
        logger.warning(f"Pure LLM semantic intent classification failed: {e}")
        if has_file_trigger or has_filename_mention:
            return {
                "intent_type": "CORPUS_QUERY",
                "is_conversational": False,
                "target_modality": "document",
                "target_filename": session_filenames[0] if session_filenames else None,
                "intent_label": "Document (PDF/Docx)",
                "reasoning": "Fallback corpus query.",
            }
        return {
            "intent_type": "GENERAL_KNOWLEDGE",
            "is_conversational": True,
            "target_modality": None,
            "target_modalities": [],
            "target_filename": None,
            "intent_label": "General Knowledge & Reasoning",
            "reasoning": "Fallback general knowledge inquiry.",
        }


def is_conversational_query(
    query: str,
    conversation_id: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> bool:
    """
    Returns True if the query is general dialogue, world knowledge, coding, or concept explanation
    rather than a specific query targeting the uploaded session files.
    """
    clean_q = query.strip()
    q_low = clean_q.lower()

    # Fast sub-millisecond greeting check
    if any(re.search(pat, q_low) for pat in GREETING_PATTERNS) and len(clean_q.split()) <= 6:
        return True

    res = classify_intent_with_llm(query, conversation_id, conversation_history)
    return res.get("is_conversational", False) or res.get("intent_type") in ("CASUAL_CONVERSATION", "GENERAL_KNOWLEDGE")


GENERAL_ASSISTANT_SYSTEM_PROMPT = """You are Trace, an advanced, highly intelligent AI assistant with deep reasoning, coding, and scientific abilities comparable to ChatGPT, Gemini, and Claude.

CORE PRINCIPLES:
1. For General Knowledge, Coding, Math, Science, and Conceptual Questions:
   - Provide a comprehensive, accurate, articulate, and well-structured answer.
   - Use clean Markdown with clear headings, bullet points, and syntax-highlighted code blocks where appropriate.
   - Do NOT say "Based on the provided documents" when answering general world knowledge, coding, or conceptual questions.
2. For Greetings & Small Talk:
   - Be warm, friendly, natural, and concise (e.g., "Hello! How can I help you today? Feel free to ask general questions or explore your uploaded files.").
3. For Conversational Follow-ups:
   - Maintain full multi-turn conversational memory and natural dialogue continuity.
"""


def generate_conversational_response(
    query: str,
    conversation_id: str,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """
    Generates rich, comprehensive expert answers for general world knowledge, coding,
    science, math, and friendly chit-chat.
    """
    settings = get_settings()
    clean_q = query.strip()
    q_low = clean_q.lower()

    # Fast greeting check
    is_simple_greeting = any(re.search(pat, q_low) for pat in GREETING_PATTERNS) and len(clean_q.split()) <= 6

    if is_simple_greeting and (not conversation_history or len(conversation_history) <= 1):
        return "Hello! How can I help you today? Feel free to ask any questions about your documents, general science, coding, or explore your data."

    history_str = ""
    if conversation_history and not is_simple_greeting:
        recent = conversation_history[-6:]
        history_str = "Conversation History:\n" + "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Trace'}: {m.get('content', '')}"
            for m in recent
        ) + "\n\n"

    context_msg = f"{history_str}User message: \"{query}\"\n\nPlease provide your helpful, accurate, and structured answer:"

    if settings.gemini_api_key:
        # 1. Try modern google.genai Client
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.gemini_api_key)
            resp = client.models.generate_content(
                model=settings.gemini_model or "gemini-2.5-flash",
                contents=context_msg,
                config=types.GenerateContentConfig(
                    system_instruction=GENERAL_ASSISTANT_SYSTEM_PROMPT,
                    temperature=0.3,
                    max_output_tokens=2500,
                ),
            )
            if resp.text and resp.text.strip():
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"google.genai general knowledge generation notice: {e}")

        # 2. Fallback candidate loop
        candidate_models = [
            settings.gemini_model or "gemini-2.5-flash",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
        ]
        for m_name in candidate_models:
            try:
                import google.generativeai as legacy_genai
                legacy_genai.configure(api_key=settings.gemini_api_key)
                model = legacy_genai.GenerativeModel(
                    model_name=m_name,
                    system_instruction=GENERAL_ASSISTANT_SYSTEM_PROMPT,
                )
                response = model.generate_content(
                    context_msg,
                    generation_config={"temperature": 0.3, "max_output_tokens": 2500}
                )
                if response.text and response.text.strip():
                    return response.text.strip()
            except Exception as e:
                logger.warning(f"Gemini generation fallback failed for model {m_name}: {str(e)}")
                continue

    if settings.anthropic_api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            resp = client.messages.create(
                model=settings.anthropic_model,
                max_tokens=2500,
                system=GENERAL_ASSISTANT_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": context_msg}],
            )
            return resp.content[0].text.strip()
        except Exception as e:
            logger.error(f"Claude general answer generation error: {e}")

    return "Hello! I am Trace, your multimodal AI assistant. How can I help you explore your documents, write code, or solve problems today?"
