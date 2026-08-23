import re
import json
import logging
from typing import List, Dict, Any, Tuple, Optional
from backend.config import get_settings
from backend.synthesis.models import CitationVerification
from backend.pipeline.bm25_index import tokenize, STOPWORDS

logger = logging.getLogger("trace.synthesis.verifier")

VERIFIER_PROMPT = """You are an objective Citation Verifier for a Retrieval-Augmented Generation system.
Your job is to rigorously verify whether a specific factual claim is directly supported by the text in the referenced source passage.

Claim from Answer:
"{claim}"

Referenced Passage [{passage_num}]:
\"\"\"
{passage_text}
\"\"\"

Verification Criteria:
- "VERIFIED": The passage directly contains the facts, numbers, statements, or logical premise made in the claim.
- "UNSUPPORTED": The passage does NOT contain evidence for this claim (hallucination or wrong citation).
- "CONTRADICTED": The passage directly contradicts what the claim states.

Return ONLY a valid JSON object:
{{
  "status": "VERIFIED" | "UNSUPPORTED" | "CONTRADICTED",
  "is_grounded": true | false,
  "evidence_quote": "Exact 1-2 sentence snippet from the passage proving the claim (or empty string if unsupported)",
  "rationale": "Short explanation of the verdict"
}}
"""


class CitationVerifier:
    """Verifies that every citation marker in the generated answer is factually grounded."""

    def __init__(self):
        self.settings = get_settings()

    def verify_citations(
        self,
        answer: str,
        chunks: List[Dict[str, Any]],
    ) -> Tuple[List[CitationVerification], float]:
        """
        Extracts all [n] citations from the answer, evaluates each claim against the passage,
        and returns the list of verifications and an overall groundedness score.
        """
        if not answer or not chunks:
            return [], 1.0

        # 1. Extract citation occurrences and their associated sentence claims
        claims_with_citations = self._extract_claims_with_citations(answer)
        if not claims_with_citations:
            return [], 1.0

        verifications: List[CitationVerification] = []

        for passage_num, claim_text in claims_with_citations:
            # Check passage bounds
            if passage_num < 1 or passage_num > len(chunks):
                verifications.append(
                    CitationVerification(
                        passage_number=passage_num,
                        claim_text=claim_text,
                        evidence_quote="",
                        is_grounded=False,
                        status="UNSUPPORTED",
                        filename="Unknown",
                    )
                )
                continue

            chunk = chunks[passage_num - 1]
            passage_text = chunk.get("text", "")
            filename = chunk.get("filename", "")
            file_id = chunk.get("file_id", "")
            page_number = chunk.get("page_number")
            timestamp = chunk.get("timestamp")

            # Verify claim against passage
            verification = self._verify_single_claim(
                passage_num=passage_num,
                claim_text=claim_text,
                passage_text=passage_text,
                filename=filename,
                file_id=file_id,
                page_number=page_number,
                timestamp=timestamp,
            )
            verifications.append(verification)

        # Compute groundedness score
        if verifications:
            verified_count = sum(1 for v in verifications if v.is_grounded)
            groundedness_score = round(verified_count / len(verifications), 2)
        else:
            groundedness_score = 1.0

        return verifications, groundedness_score

    def _extract_claims_with_citations(self, answer: str) -> List[Tuple[int, str]]:
        """
        Extracts each [n] citation along with its full preceding statement/claim context.
        """
        results: List[Tuple[int, str]] = []
        for match in re.finditer(r"\[(\d+)\]", answer):
            try:
                p_num = int(match.group(1))
                idx = match.start()
                preceding = answer[:idx].strip()
                # Find the start of the current statement/sentence
                start_boundary = max(
                    preceding.rfind(". "),
                    preceding.rfind(".\n"),
                    preceding.rfind("\n\n"),
                    preceding.rfind("\n- "),
                    preceding.rfind("\n* "),
                    preceding.rfind("? "),
                    preceding.rfind("! "),
                )
                if start_boundary != -1:
                    claim = preceding[start_boundary + 1:].strip()
                else:
                    claim = preceding[-200:].strip()

                clean_claim = re.sub(r"\[\d+\]", "", claim).strip()
                # Clean leading bullets, dashes, or numbered list indicators
                clean_claim = re.sub(r"^(?:[-*•]|\d+\.)\s+", "", clean_claim).strip()
                # Clean surrounding quotes
                clean_claim = clean_claim.strip("\"'")

                if not clean_claim:
                    clean_claim = preceding[-150:].strip()

                results.append((p_num, clean_claim))
            except Exception:
                continue

        return results

    def _verify_single_claim(
        self,
        passage_num: int,
        claim_text: str,
        passage_text: str,
        filename: str,
        file_id: str,
        page_number: Optional[int],
        timestamp: Optional[str],
    ) -> CitationVerification:
        """Fast high-precision citation verification via exact and semantic token overlap."""
        passage_clean = passage_text.strip()
        passage_lower = passage_clean.lower()
        claim_tokens = [w for w in tokenize(claim_text, remove_stopwords=True) if w not in STOPWORDS and len(w) > 2]

        # Fast matching: find best matching sentence in passage for evidence quote
        sentences = [s.strip() for s in re.split(r"(?<=[.!?\n])\s+", passage_clean) if len(s.strip()) > 10]
        best_sentence = ""
        best_score = 0

        for sent in sentences:
            sent_lower = sent.lower()
            if not claim_tokens:
                score = 1.0
            else:
                matches = sum(1 for tok in claim_tokens if tok in sent_lower)
                score = matches / len(claim_tokens)

            if score > best_score:
                best_score = score
                best_sentence = sent

        if not claim_tokens:
            is_grounded = True
        else:
            matches_in_passage = sum(1 for tok in claim_tokens if tok in passage_lower)
            passage_overlap = matches_in_passage / len(claim_tokens)
            is_grounded = passage_overlap >= 0.30 or best_score >= 0.25

        evidence = best_sentence if best_sentence else passage_clean[:200]
        # Clean leading bullet artifacts and redundant enclosing quotes
        evidence = re.sub(r"^(?:[-*•]|\d+\.)\s+", "", evidence.strip()).strip("\"'")

        # Dynamically extract exact timestamp from the specific matching evidence quote if present
        evidence_ts_matches = re.findall(r"\[(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\]", evidence)
        if evidence_ts_matches:
            if len(evidence_ts_matches) == 1:
                timestamp = evidence_ts_matches[0]
            else:
                first_ts = evidence_ts_matches[0].split("-")[0].strip()
                last_ts = evidence_ts_matches[-1].split("-")[-1].strip()
                timestamp = f"{first_ts} - {last_ts}"

        return CitationVerification(
            passage_number=passage_num,
            claim_text=claim_text,
            evidence_quote=evidence,
            is_grounded=is_grounded,
            status="VERIFIED" if is_grounded else "UNSUPPORTED",
            filename=filename,
            file_id=file_id,
            page_number=page_number,
            timestamp=timestamp,
        )


citation_verifier = CitationVerifier()
