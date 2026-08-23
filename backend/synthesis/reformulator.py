import re
import json
import logging
from typing import List, Dict, Any, Optional
from backend.config import get_settings
from backend.synthesis.models import RetryInfo, CriticResult
from backend.pipeline.retriever import hybrid_retriever

logger = logging.getLogger("trace.synthesis.reformulator")

REFORMULATE_PROMPT = """You are a search query reformulation specialist for a Retrieval-Augmented Generation system.
The original search query returned passages that were missing critical facts or lacked enough specificity.

Original Query: "{query}"
Critic Diagnosis: {reason}
Missing Aspects: {missing_aspects}

Task: Produce a more targeted, keyword-rich search query designed to retrieve the missing facts from technical documents, audio transcripts, or video captions.
- Remove conversational filler.
- Focus on concrete nouns, technical terms, code keywords, and domain concepts.
- Return ONLY a JSON object:
{{
  "reformulated_query": "specific search keywords and concepts",
  "rationale": "short explanation of why these keywords target the missing information"
}}
"""


class QueryReformulator:
    """Reformulates underperforming queries to execute targeted retrieval retries."""

    def __init__(self):
        self.settings = get_settings()

    def reformulate_and_retry(
        self,
        conversation_id: str,
        original_query: str,
        critic_result: CriticResult,
        top_k: int = 5,
        alpha: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Generates a targeted query reformulation and performs a single retrieval retry.
        """
        reformulated_query = self._generate_reformulation(original_query, critic_result)
        logger.info(f"Retrying query '{original_query}' -> '{reformulated_query}'")

        # Execute retry retrieval
        retry_retrieval = hybrid_retriever.retrieve(
            conversation_id=conversation_id,
            query=reformulated_query,
            top_k=top_k,
            alpha=alpha,
            use_router=True,
        )

        retry_info = RetryInfo(
            retried=True,
            original_query=original_query,
            reformulated_query=reformulated_query,
            reason=critic_result.reason,
            initial_confidence=critic_result.confidence,
        )

        return {
            "retry_info": retry_info,
            "retrieval": retry_retrieval,
        }

    def _generate_reformulation(self, query: str, critic_result: CriticResult) -> str:
        """Calls LLM or heuristic builder to produce a refined search string."""
        if self.settings.gemini_api_key:
            try:
                from google import genai
                client = genai.Client(api_key=self.settings.gemini_api_key)

                prompt = REFORMULATE_PROMPT.format(
                    query=query,
                    reason=critic_result.reason,
                    missing_aspects=", ".join(critic_result.missing_aspects) or "Core technical details",
                )
                resp = client.models.generate_content(
                    model=self.settings.gemini_model or "gemini-3.6-flash",
                    contents=prompt
                )
                raw = resp.text.strip()
                if raw.startswith("```"):
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)

                data = json.loads(raw)
                ref_q = data.get("reformulated_query")
                if ref_q and len(ref_q.strip()) > 3:
                    return ref_q.strip()
            except Exception as e:
                logger.warning(f"LLM Reformulation notice: {str(e)}; using heuristic reformulation.")

        # Heuristic fallback: combine core query terms with missing aspects
        missing_terms = " ".join(critic_result.missing_aspects)
        clean_orig = re.sub(r"[^\w\s\./-]", "", query)
        return f"{clean_orig} {missing_terms}".strip()


query_reformulator = QueryReformulator()
