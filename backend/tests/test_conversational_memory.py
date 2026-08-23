import json
import unittest
from fastapi.testclient import TestClient
from backend.main import app
from backend.synthesis.contextualizer import query_contextualizer
from backend.pipeline.router import query_router

client = TestClient(app)


class TestConversationalMemoryAndRouting(unittest.TestCase):
    """Verifies multi-turn conversation memory, intent routing labels, and natural LLM generation."""

    def test_01_intent_routing_labels(self):
        # 1. Casual / conversational query -> Generic
        route_casual = query_router.route_query("Hello! How are you doing today?")
        # If routed to conversational or general
        self.assertEqual(len(route_casual["primary_categories"]), 1)

        # 2. Document query -> Single highest probability label
        route_doc = query_router.route_query("Where is the LIMIT clause explained in the SQL documentation?")
        self.assertEqual(len(route_doc["primary_categories"]), 1)
        self.assertEqual(route_doc["primary_category"], "document")
        self.assertEqual(route_doc["intent_label"], "Document (PDF/Docx)")

        # 3. Audio query -> Single highest probability label
        route_audio = query_router.route_query("What did the speaker say in the audio meeting recording at timestamp 05:20?")
        self.assertEqual(len(route_audio["primary_categories"]), 1)
        self.assertEqual(route_audio["primary_category"], "audio")
        self.assertEqual(route_audio["intent_label"], "Audio Transcript")

    def test_02_contextual_query_rewriting(self):
        history = [
            {"role": "user", "content": "how many credits required to get minor in computer science?"},
            {"role": "assistant", "content": "Total credits required for minor in CSE is 20 [1]"},
        ]

        # Follow-up: "what about mechanical?"
        rewritten = query_contextualizer.contextualize("what about mechanical?", history)
        self.assertTrue(
            "mechanical" in rewritten.lower() and ("minor" in rewritten.lower() or "credits" in rewritten.lower()),
            f"Rewritten query '{rewritten}' should contain contextual keywords from previous turns."
        )

    def test_03_multi_turn_streaming_flow(self):
        # 1. Create a session
        conv_res = client.post("/api/conversations", json={"title": "Multi-Turn Test"}).json()
        conv_id = conv_res["id"]

        # 2. First turn
        req1 = {
            "conversation_id": conv_id,
            "query": "Where is the LIMIT clause explained?",
            "top_k": 3,
            "alpha": 0.5,
            "use_router": True,
        }
        res1 = client.post("/api/query/stream", json=req1)
        self.assertEqual(res1.status_code, 200)

        # 3. Follow-up turn
        req2 = {
            "conversation_id": conv_id,
            "query": "what about OFFSET?",
            "top_k": 3,
            "alpha": 0.5,
            "use_router": True,
        }
        res2 = client.post("/api/query/stream", json=req2)
        self.assertEqual(res2.status_code, 200)

        # Check SSE events
        stages = []
        for line in res2.text.strip().split("\n"):
            if line.startswith("event:"):
                stages.append(line.split(":", 1)[1].strip())

        self.assertIn("route", stages)
        self.assertIn("answer", stages)
        self.assertIn("done", stages)

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")


if __name__ == "__main__":
    unittest.main()
