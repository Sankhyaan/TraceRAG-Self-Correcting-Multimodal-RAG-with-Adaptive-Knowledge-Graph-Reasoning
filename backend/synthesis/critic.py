import re
import json
import logging
from typing import List, Dict, Any, Optional
from backend.config import get_settings
from backend.synthesis.models import CriticResult
from backend.pipeline.bm25_index import STOPWORDS, tokenize

logger = logging.getLogger("trace.synthesis.critic")

CRITIC_PROMPT = """You are a rigorous Retrieval Quality Critic for an enterprise Multimodal RAG system.
Your job is to objectively grade whether the retrieved passages contain the SPECIFIC FACTS needed to answer the user's question.

User Question:
"{query}"

Retrieved Passages:
\"\"\"
{passages}
\"\"\"

CRITICAL GRADING CRITERIA:
1. "high": The passages contain direct, clear, factual answers or definitions to the user's specific question.
2. "medium": The passages are relevant and contain partial answers or strong contextual hints, but may lack some specific details.
3. "low": The passages do NOT contain the necessary facts to answer the question, are completely off-topic, or only share surface keywords without answering the core inquiry.

Return ONLY valid JSON matching this schema:
{{
  "confidence": "high" | "medium" | "low",
  "reason": "Concise 1-2 sentence explanation of what specific facts are present or missing.",
  "missing_aspects": ["Specific missing concepts or facts required to answer the question"],
  "should_retry": true | false
}}

Note: Set should_retry=true ONLY if confidence is "low" and reformulating the search might uncover the missing facts.
"""


class RetrievalCritic:
    """Evaluates retrieved chunk relevance and completeness before answer generation."""

    def __init__(self):
        self.settings = get_settings()

    def evaluate(self, query: str, chunks: List[Dict[str, Any]]) -> CriticResult:
        """Grades whether retrieved chunks contain enough factual substance to answer the query."""
        if not chunks:
            return CriticResult(
                confidence="low",
                reason="No passages were retrieved for this query.",
                missing_aspects=["All context for the query"],
                should_retry=True,
            )

        # 1. Fast Heuristic Check First (<0.1ms)
        heuristic_res = self._heuristic_evaluate(query, chunks)
        if heuristic_res.confidence in ("high", "medium"):
            return heuristic_res

        # 2. Modern Client LLM Critic if heuristic is low (<2s)
        if self.settings.gemini_api_key:
            try:
                from google import genai
                client = genai.Client(api_key=self.settings.gemini_api_key)
                formatted_passages = []
                for i, c in enumerate(chunks[:4]):
                    src = f"[{i+1}] {c.get('filename', 'Doc')}"
                    if c.get("page_number"):
                        src += f" (Page {c['page_number']})"
                    text = c.get("text", "").strip()[:400]
                    formatted_passages.append(f"{src}:\n{text}")

                passages_str = "\n\n".join(formatted_passages)
                prompt = CRITIC_PROMPT.format(query=query, passages=passages_str)

                resp = client.models.generate_content(
                    model=self.settings.gemini_model or "gemini-3.6-flash",
                    contents=prompt
                )
                raw = resp.text.strip()
                if raw.startswith("```"):
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)

                data = json.loads(raw)
                conf = data.get("confidence", "medium").lower()
                if conf not in ("high", "medium", "low"):
                    conf = "medium"

                return CriticResult(
                    confidence=conf,
                    reason=data.get("reason", "Graded by LLM critic."),
                    missing_aspects=data.get("missing_aspects", []),
                    should_retry=data.get("should_retry", conf == "low"),
                )
            except Exception as e:
                logger.warning(f"LLM Critic notice: {e}")

        elif self.settings.llm_provider == "anthropic" or self.settings.anthropic_api_key:
            try:
                import anthropic

                client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
                formatted_passages = [f"[{i+1}] {c.get('filename')}:\n{c.get('text', '')[:400]}" for i, c in enumerate(chunks[:4])]
                prompt = CRITIC_PROMPT.format(query=query, passages="\n\n".join(formatted_passages))
                resp = client.messages.create(
                    model=self.settings.anthropic_model,
                    max_tokens=500,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text.strip()
                if raw.startswith("```"):
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)

                data = json.loads(raw)
                conf = data.get("confidence", "medium").lower()
                return CriticResult(
                    confidence=conf,
                    reason=data.get("reason", "Graded by Claude critic."),
                    missing_aspects=data.get("missing_aspects", []),
                    should_retry=data.get("should_retry", conf == "low"),
                )
            except Exception:
                pass

        return heuristic_res

        return None

    def _heuristic_evaluate(self, query: str, chunks: List[Dict[str, Any]]) -> CriticResult:
        """Deterministic heuristic fallback grading keyword coverage and detecting missing predicates."""
        query_words = [w.lower() for w in tokenize(query, remove_stopwords=True, apply_stem=True)]
        if not query_words:
            return CriticResult(confidence="medium", reason="Generic query.", should_retry=False)

        top_chunk = chunks[0] if chunks else {}
        top_score = top_chunk.get("final_score", 0.0)

        # Check keyword matches in top chunks
        combined_text = " ".join(c.get("text", "").lower() for c in chunks[:3])
        chunk_tokens = set(tokenize(combined_text, remove_stopwords=True, apply_stem=True))
        matched_words = [w for w in query_words if w in chunk_tokens]
        missing_words = [w for w in query_words if w not in chunk_tokens]
        coverage_ratio = len(matched_words) / len(query_words)

        INQUIRY_VERBS = {
            "work", "mean", "happen", "tell", "give", "look", "know", "run", "use",
            "get", "find", "seem", "occur", "appear", "take", "make", "need", "want",
            "see", "show", "say", "call", "come", "state", "exist", "i", "ii", "iii", "iv", "v"
        }
        substantive_missing = [w for w in missing_words if w not in INQUIRY_VERBS and len(w) > 2]

        if substantive_missing:
            # If critical query terms are missing from all passages (e.g. TRUNCATE)
            return CriticResult(
                confidence="medium" if coverage_ratio >= 0.5 else "low",
                reason=f"Passages cover related context but do not document or mention '{substantive_missing[0]}'.",
                missing_aspects=[f"Specific documentation on '{w}'" for w in substantive_missing],
                should_retry=False if coverage_ratio >= 0.5 else True,
            )

        if coverage_ratio >= 0.75 and top_score >= 0.5:
            return CriticResult(
                confidence="high",
                reason=f"Passages contain direct factual coverage ({int(coverage_ratio*100)}% of core query terms verified).",
                should_retry=False,
            )
        elif coverage_ratio >= 0.3:
            return CriticResult(
                confidence="medium",
                reason="Passages are topically relevant but may only partially cover all requested aspects.",
                missing_aspects=missing_words,
                should_retry=False,
            )
        else:
            return CriticResult(
                confidence="low",
                reason="Passages lack specific keyword matches for the core question concepts.",
                missing_aspects=missing_words,
                should_retry=True,
            )


retrieval_critic = RetrievalCritic()
