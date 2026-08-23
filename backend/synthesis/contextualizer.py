import re
import json
import logging
from typing import List, Dict, Any, Optional
from backend.config import get_settings

logger = logging.getLogger("trace.synthesis.contextualizer")

CONTEXTUALIZE_SYSTEM_PROMPT = """You are a conversational query contextualizer for an intelligent Multimodal RAG system.
Your job is to reformulate a follow-up or ambiguous user question into a standalone, fully-explicit search query using the recent conversation history.

RULES:
1. If the user's question is already a complete, standalone question with all required subjects and entities (e.g., "What are the admission requirements for PhD in 2024?", "tell me about thunderstorm report"), return the original question as-is.
2. If the user introduces a new document, file name, or topic (e.g. Thunderstorm, SQL, Dance, Resume), do NOT append or mix subjects/entities from previous turns into the query.
3. If the user's question is a follow-up, ellipsis, pronoun reference, or continuation (e.g., "what about mechanical?", "who is the advisor?", "how many credits?", "and for physics?"):
   - Identify what subject or entity is being asked about from the previous conversation turns.
   - Expand the question into a complete, standalone query that includes all necessary context.
   - Example 1:
     History: User: "How many credits required to get minor in computer science?" -> Assistant: "Total credits required for minor in CSE is 20 [1]..."
     Follow-up: "what about mechanical?"
     Standalone Query: "How many credits are required to get a minor in mechanical engineering?"
   - Example 2:
     History: User: "What are 3 compulsory courses for economics minor?" -> Assistant: "The compulsory courses are..."
     Follow-up: "who is the ug advisor?"
     Standalone Query: "Who is the UG advisor for minor in economics?"
4. Return ONLY a single line containing the standalone query. Do not add explanations or formatting.
"""


class QueryContextualizer:
    """
    Resolves conversational coreferences and anaphora by rewriting follow-up
    questions into standalone search queries using conversation history.
    """

    def __init__(self):
        self.settings = get_settings()

    def contextualize(
        self,
        query: str,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        Intelligently reformulates follow-ups, pronoun references, and meta-instructions
        into standalone, topic-preserving search queries using recent conversation history.
        """
        clean_query = query.strip()
        if not conversation_history or len(conversation_history) == 0:
            return clean_query

        # If query is long and clearly standalone (> 10 words with its own subject), return as-is
        if len(clean_query.split()) > 10 and not self._is_likely_followup(clean_query):
            return clean_query

        # Use modern LLM contextualizer to naturally understand human language & conversation thread
        if self.settings.gemini_api_key:
            try:
                from google import genai
                client = genai.Client(api_key=self.settings.gemini_api_key)

                history_lines = []
                for m in conversation_history[-4:]:
                    role = "User" if m.get("role") == "user" else "Assistant"
                    content = m.get("content", "").strip()
                    # Truncate long assistant messages to keep prompt fast
                    if role == "Assistant" and len(content) > 300:
                        content = content[:300] + "..."
                    history_lines.append(f"{role}: {content}")

                history_str = "\n".join(history_lines)
                user_prompt = f"Conversation History:\n{history_str}\n\nLatest User Follow-up:\n\"{clean_query}\"\n\nStandalone Search Query:"

                resp = client.models.generate_content(
                    model=self.settings.gemini_model or "gemini-3.5-flash-lite",
                    contents=user_prompt,
                    config={"system_instruction": CONTEXTUALIZE_SYSTEM_PROMPT, "temperature": 0.0, "max_output_tokens": 100}
                )
                if resp.text and resp.text.strip():
                    rewritten = resp.text.strip().strip('"\'')
                    logger.info(f"LLM Contextualized: '{clean_query}' -> '{rewritten}'")
                    return rewritten
            except Exception as e:
                logger.warning(f"Notice during LLM contextualization: {e}")

        # Fast heuristic fallback if LLM is unavailable
        heuristic_rewrite = self._heuristic_contextualize(clean_query, conversation_history)
        if heuristic_rewrite and heuristic_rewrite != clean_query:
            logger.info(f"Heuristic contextualized fallback: '{clean_query}' -> '{heuristic_rewrite}'")
            return heuristic_rewrite

        return clean_query

    def _is_likely_followup(self, query: str) -> bool:
        """Determines if a query depends on previous conversation context."""
        q_lower = query.lower()

        # Follow-up trigger patterns
        FOLLOWUP_PATTERNS = [
            r"^(what|how)\s+about\b",
            r"^and\s+(for|what|how|who|where|why)\b",
            r"^(who|what|where|when|why|how)\s+(is|are|was|were|do|does|did)\s+(the|their|its|it|they|this|that)\b",
            r"\b(it|they|them|their|its|this|that|these|those)\b",
            r"^who\s+is\s+(the\s+)?(advisor|faculty|head|lead|coordinator)\b",
            r"^(tell me more|elaborate|explain more|more details)\b",
            r"^same\s+for\b",
            r"^(and\s+)?(for\s+)?[a-zA-Z\s]{1,25}\?*$", # e.g. "mechanical?", "physics?"
        ]

        for pat in FOLLOWUP_PATTERNS:
            if re.search(pat, q_lower):
                return True

        # Very short queries (< 5 words) after conversation
        words = q_lower.split()
        if len(words) <= 4:
            return True

        return False

    def _heuristic_contextualize(
        self,
        query: str,
        conversation_history: List[Dict[str, Any]],
    ) -> str:
        """Rule-based contextual expansion if LLM is unavailable."""
        # Find last user question in history
        last_user_query = ""
        for msg in reversed(conversation_history):
            if msg.get("role") == "user":
                last_user_query = msg.get("content", "")
                break

        if not last_user_query:
            return query

        clean_last = re.sub(r"[^\w\s]", "", last_user_query).strip()
        q_lower = query.lower()

        # "what about X" -> Replace last subject with X
        match = re.search(r"(?:what|how)\s+about\s+([a-zA-Z\s]+)", q_lower)
        if match:
            new_subject = match.group(1).strip()
            # E.g. "credits required for minor in CSE" -> "credits required for minor in mechanical"
            return f"{clean_last} {new_subject}"

        return f"{clean_last} {query}"


query_contextualizer = QueryContextualizer()
