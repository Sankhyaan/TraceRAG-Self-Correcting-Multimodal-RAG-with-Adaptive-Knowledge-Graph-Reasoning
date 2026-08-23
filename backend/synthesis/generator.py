import re
import logging
from typing import List, Dict, Any, Optional
from backend.config import get_settings

logger = logging.getLogger("trace.synthesis.generator")

SYNTHESIS_SYSTEM_PROMPT = """You are Trace, an advanced, highly intelligent, conversational AI assistant with the natural language abilities and reasoning of ChatGPT, Gemini, and Claude.
Your goal is to communicate seamlessly, warmly, and helpfully, maintaining complete conversation memory, understanding nuances, and following multi-turn dialogues like a human.

CONVERSATIONAL INTELLIGENCE & GROUNDING RULES:
1. Natural Human Dialogue: Speak like a knowledgeable, friendly, and articulate human expert. Seamlessly follow the ongoing conversational thread (e.g. if the user says "explain once more", "tell me more", "can you simplify?", or asks follow-ups, continue discussing the active topic naturally using conversation history and source evidence).
2. Factual Grounding & Citations: Whenever you present facts, rules, courses, numbers, or details from the uploaded source documents or videos, strictly ground your claims in the provided source passages and knowledge graph relations. Append a citation marker [n] (e.g. [1], [2]) directly after each factual statement.
3. Multi-Passage Synthesis: If multiple passages or modalities (PDFs, videos, docx) contribute to the answer, weave them together seamlessly and cite all corresponding markers (e.g. [1][3]).
4. Conversational Continuity: Always respect the active conversation context. Do not jump to unrelated files or topics unless the user explicitly introduces a new subject.
5. Structured & Clear Presentation: Use clean markdown with clear headings, bullet points, and bold text for readability.
6. Clean Plain Text Numbers & Symbols: Write all numbers, scores, percentages, metrics, and thresholds as clean plain text (e.g. 0.32, 0.70, 113, 60, 4:1, 95%). NEVER enclose standard numbers, statistics, or thresholds in LaTeX dollar signs ($0.32$, $113$). Only use clean standard notation for arithmetic.
"""

SYNTHESIS_USER_PROMPT = """{history_section}User Question:
"{query}"

Source Passages:
\"\"\"
{passages}
\"\"\"
{graph_context}

Please provide your clear, natural, and factually grounded answer with [n] citation markers following the mandatory rules:"""


class AnswerGenerator:
    """Generates cited, strictly grounded answers from numbered retrieved passages."""

    def __init__(self):
        self.settings = get_settings()

    def generate(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        graph_hops: Optional[List[Dict[str, Any]]] = None,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        Synthesizes a fact-grounded natural answer citing numbered passages [1], [2], etc.
        """
        if not chunks:
            return "Based on the provided documents, there is insufficient evidence to answer this question as no relevant source materials were found."

        # Format numbered passages
        formatted_passages = []
        for i, c in enumerate(chunks):
            src_info = f"[{i+1}] {c.get('filename', 'Unknown Source')}"
            if c.get("page_number"):
                src_info += f" | Page {c['page_number']}"
            if c.get("timestamp"):
                src_info += f" | Timestamp {c['timestamp']}"
            text = c.get("text", "").strip()
            formatted_passages.append(f"{src_info}:\n{text}")

        passages_str = "\n\n".join(formatted_passages)

        # Format conversation history context if present
        history_section = ""
        if conversation_history:
            turns = []
            for m in conversation_history[-4:]:
                role = "User" if m.get("role") == "user" else "Assistant"
                turns.append(f"{role}: {m.get('content', '')}")
            if turns:
                history_section = "Recent Conversation History:\n" + "\n".join(turns) + "\n\n"

        # Format graph context if present
        graph_str = ""
        if graph_hops:
            hop_lines = []
            for h in graph_hops:
                hop_lines.append(f"- {h.get('from_node')} --[{h.get('relation')}]--> {h.get('to_node')} (Source: {h.get('filename', '')} {h.get('timestamp') or ''})")
            graph_str = "\nKnowledge Graph Connections:\n" + "\n".join(hop_lines) + "\n"

        # Generate via modern high-throughput google.genai Client
        if self.settings.gemini_api_key:
            prompt = SYNTHESIS_USER_PROMPT.format(
                history_section=history_section,
                query=query,
                passages=passages_str,
                graph_context=graph_str,
            )

            # 1. Try modern google.genai Client (super fast HTTP/2)
            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=self.settings.gemini_api_key)
                resp = client.models.generate_content(
                    model=self.settings.gemini_model or "gemini-3.5-flash-lite",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYNTHESIS_SYSTEM_PROMPT,
                        temperature=0.3,
                        max_output_tokens=1500,
                    )
                )
                if resp.text and resp.text.strip():
                    return resp.text.strip()
            except Exception as e:
                logger.warning(f"google.genai Client notice: {e}; falling back to candidate models.")

            # 2. Fallback candidate loop
            candidate_models = [
                self.settings.gemini_model or "gemini-3.5-flash-lite",
                "gemini-3.5-flash-lite",
                "gemini-3.1-flash-lite",
                "gemini-flash-lite-latest",
            ]
            for m_name in candidate_models:
                try:
                    import google.generativeai as legacy_genai
                    legacy_genai.configure(api_key=self.settings.gemini_api_key)
                    model = legacy_genai.GenerativeModel(
                        model_name=m_name,
                        system_instruction=SYNTHESIS_SYSTEM_PROMPT,
                    )
                    response = model.generate_content(
                        prompt,
                        generation_config={"temperature": 0.3, "max_output_tokens": 1500}
                    )
                    if response.text and response.text.strip():
                        return response.text.strip()
                except Exception as e:
                    logger.warning(f"Gemini generation failed for model {m_name}: {str(e)}")
                    continue

        if self.settings.anthropic_api_key:
            try:
                import anthropic

                client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
                prompt = SYNTHESIS_USER_PROMPT.format(
                    history_section=history_section,
                    query=query,
                    passages=passages_str,
                    graph_context=graph_str,
                )
                resp = client.messages.create(
                    model=self.settings.anthropic_model,
                    max_tokens=1500,
                    system=SYNTHESIS_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": prompt}],
                )
                return resp.content[0].text.strip()
            except Exception as e:
                logger.error(f"Claude answer generation error: {str(e)}")

        # Fallback if LLM unavailable/rate-limited: produce keyword-focused extractive summary
        return self._extractive_fallback(query, chunks)

    def _extractive_fallback(self, query: str, chunks: List[Dict[str, Any]]) -> str:
        """Heuristic fallback that extracts the most relevant paragraph blocks matching the query with clean citations."""
        if not chunks:
            return "Based on the provided documents, there is insufficient evidence to answer this question as no relevant source materials were found."

        from backend.pipeline.bm25_index import tokenize, STOPWORDS
        query_words = set(tokenize(query, remove_stopwords=True, apply_stem=True))
        combined_text = " ".join(c.get("text", "").lower() for c in chunks[:3])
        chunk_tokens = set(tokenize(combined_text, remove_stopwords=True, apply_stem=True))
        matched = query_words.intersection(chunk_tokens)
        coverage = len(matched) / len(query_words) if query_words else 0.0

        if query_words and coverage < 0.2:
            return "Based on the provided documents, there is insufficient evidence to answer this question as the source materials do not contain information on this topic."

        # Universal sliding-window extractor to pinpoint exact answer regions in any document type
        excerpts = []
        for i, c in enumerate(chunks[:3]):
            text = c.get("text", "").strip()
            clean_text = re.sub(r"(\n\s*){3,}", "\n\n", text).strip()
            lines = [l.strip() for l in clean_text.split("\n") if len(l.strip()) > 3]
            if not lines:
                continue

            best_start_idx = 0
            best_score = -1

            # Slide a 4-line window across chunk lines
            window_size = 4
            for idx in range(len(lines)):
                window_lines = lines[idx : idx + window_size]
                window_text = " ".join(window_lines)
                window_toks = set(tokenize(window_text, remove_stopwords=True, apply_stem=True))
                score = len(query_words.intersection(window_toks))
                if score > best_score:
                    best_score = score
                    best_start_idx = idx

            snippet = "\n".join(lines[best_start_idx : best_start_idx + window_size]).strip()
            if snippet and best_score > 0:
                excerpts.append(f"{snippet} [{i+1}]")
            elif clean_text and len(excerpts) < 2:
                excerpts.append(f"{lines[0]} [{i+1}]")

        INQUIRY_VERBS = {
            "work", "mean", "happen", "tell", "give", "look", "know", "run", "use",
            "get", "find", "seem", "occur", "appear", "take", "make", "need", "want",
            "see", "show", "say", "call", "come", "state", "exist", "i", "ii", "iii", "iv", "v"
        }
        substantive_missing = [w for w in query_words if w not in chunk_tokens and w not in INQUIRY_VERBS and len(w) > 2]
        if substantive_missing:
            missing_names = ", ".join(f"'{m}'" for m in substantive_missing[:2])
            prefix = f"The provided documentation does not explicitly state what happens regarding {missing_names}. While related behavior is documented below, the exact interaction is not defined in the source materials:\n\n"
            return prefix + ("\n\n".join(excerpts[:2]) if excerpts else "")

        return "\n\n".join(excerpts[:2]) if excerpts else f"Based on the available materials, {chunks[0].get('text', '')[:300]}... [1]"


answer_generator = AnswerGenerator()
