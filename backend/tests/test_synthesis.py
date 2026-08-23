import sys
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.synthesis.critic import retrieval_critic
from backend.synthesis.reformulator import query_reformulator
from backend.synthesis.generator import answer_generator
from backend.synthesis.verifier import citation_verifier
from backend.synthesis.pipeline import synthesis_pipeline
from backend.synthesis.models import CriticResult


class TestPhase5Synthesis(unittest.TestCase):
    """
    Phase 5 Test Suite:
    1. Fully Answerable Question -> High confidence, cited answer.
    2. Query Reformulation & Retry -> Underperforming query gets reformulated.
    3. Uncovered Out-of-Corpus Question -> Explicit refusal without hallucination.
    4. Citation Verifier -> Flags unsupported / hallucinated claims.
    5. End-to-End Synthesis Pipeline.
    """

    def setUp(self):
        self.sample_chunks = [
            {
                "chunk_id": "c1",
                "filename": "MySQL_Documentation.pdf",
                "file_id": "f1",
                "file_type": "document",
                "page_number": 9,
                "timestamp": None,
                "final_score": 0.85,
                "text": "LIMIT with OFFSET: In MySQL, SELECT * FROM students LIMIT 3, 2; The first parameter (3) is the offset which represents the number of rows to skip. The second parameter (2) is the limit representing the number of rows to return."
            },
            {
                "chunk_id": "c2",
                "filename": "MySQL_Documentation.pdf",
                "file_id": "f1",
                "file_type": "document",
                "page_number": 8,
                "timestamp": None,
                "final_score": 0.72,
                "text": "The LIMIT clause in MySQL is used to restrict the number of rows returned by a query. Example: SELECT * FROM students LIMIT 3;"
            }
        ]

    def test_case_1_clearly_answered_question(self):
        """Case 1: Question clearly answered by corpus -> High/Medium confidence, cited answer."""
        query = "How does LIMIT and OFFSET work in MySQL?"
        critic = retrieval_critic.evaluate(query, self.sample_chunks)
        print(f"\n[Test 1] Critic Confidence: {critic.confidence.upper()} | Reason: {critic.reason}")
        self.assertIn(critic.confidence, ["high", "medium"])
        self.assertFalse(critic.should_retry)

        # Generate cited answer
        answer = answer_generator.generate(query, self.sample_chunks)
        print(f"[Test 1] Generated Answer:\n{answer}\n")
        self.assertTrue(len(answer) > 20)
        self.assertTrue("[" in answer and "]" in answer, "Answer must contain [n] citation markers")

        # Verify citations
        citations, score = citation_verifier.verify_citations(answer, self.sample_chunks)
        print(f"[Test 1] Citations Count: {len(citations)} | Groundedness Score: {score}")
        self.assertGreaterEqual(score, 0.5)

    def test_case_2_query_reformulation(self):
        """Case 2: Underperforming query triggers reformulation into targeted keywords."""
        query = "where is that thing to skip lines in db"
        mock_critic = CriticResult(
            confidence="low",
            reason="Passages lack specific keyword matches for skipping lines.",
            missing_aspects=["OFFSET", "LIMIT", "MySQL skip rows"],
            should_retry=True,
        )

        reformulated = query_reformulator._generate_reformulation(query, mock_critic)
        print(f"\n[Test 2] Original: '{query}' -> Reformulated: '{reformulated}'")
        self.assertTrue(len(reformulated) > len(query))
        self.assertTrue(any(term in reformulated.lower() for term in ["offset", "limit", "skip", "rows"]))

    def test_case_3_uncovered_out_of_corpus_question(self):
        """Case 3: Question not covered by corpus -> Low confidence, explicit refusal without hallucination."""
        query = "What is the quantum orbital radius of electron 99 on Mars base alpha?"
        critic = retrieval_critic.evaluate(query, self.sample_chunks)
        print(f"\n[Test 3] Critic for Out-of-Corpus Query: {critic.confidence.upper()} | Reason: {critic.reason}")
        self.assertEqual(critic.confidence, "low")

        # Generate answer on irrelevant chunks
        answer = answer_generator.generate(query, self.sample_chunks)
        print(f"[Test 3] Out-of-Corpus Response:\n{answer}\n")
        # Generator must explicitly indicate insufficient evidence or state limitation
        self.assertTrue(
            any(phrase in answer.lower() for phrase in ["insufficient evidence", "not contain", "does not mention", "no information", "cannot answer"]),
            f"Answer should acknowledge lack of evidence: {answer}"
        )

    def test_case_4_citation_verifier_flags_hallucination(self):
        """Case 4: Citation verifier flags unsupported claims and validates grounded claims."""
        # Simulated answer with 1 grounded citation [1] and 1 fake hallucinated citation [2]
        simulated_answer = (
            "In MySQL, the offset parameter represents the number of rows to skip [1]. "
            "MySQL was originally invented in 1845 by Napoleon Bonaparte during the Battle of Waterloo [2]."
        )

        citations, score = citation_verifier.verify_citations(simulated_answer, self.sample_chunks)
        print(f"\n[Test 4] Groundedness Score: {score}")
        for c in citations:
            print(f"  - Citation [{c.passage_number}] Status: {c.status} | Grounded: {c.is_grounded} | Claim: '{c.claim_text[:60]}...'")

        self.assertEqual(len(citations), 2)
        # Citation 1 should be verified
        self.assertTrue(citations[0].is_grounded)
        self.assertEqual(citations[0].status, "VERIFIED")

        # Citation 2 should be flagged as unsupported
        self.assertFalse(citations[1].is_grounded)
        self.assertEqual(citations[1].status, "UNSUPPORTED")
        self.assertEqual(score, 0.5)

    def test_case_5_end_to_end_synthesis_pipeline(self):
        """Case 5: End-to-End Synthesis on active conversation."""
        result = synthesis_pipeline.synthesize(
            conversation_id="conv_hndjrrxd",
            query="Where is LIMIT and OFFSET explained?",
            top_k=3,
        )
        print(f"\n[Test 5] End-to-End Synthesis Result:")
        print(f"  Confidence: {result.confidence.upper()}")
        print(f"  Retried: {result.retry_info.retried}")
        print(f"  Groundedness: {result.groundedness_score * 100}%")
        print(f"  Answer:\n{result.answer}\n")
        print(f"  Total Citations: {len(result.citations)}")

        self.assertTrue(len(result.answer) > 10)
        self.assertIsNotNone(result.critic)
        self.assertIsNotNone(result.retry_info)


if __name__ == "__main__":
    unittest.main()
