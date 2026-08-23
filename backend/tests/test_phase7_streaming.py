import json
import unittest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


class TestPhase7Streaming(unittest.TestCase):
    """Phase 7: Real-time Server-Sent Events (SSE) streaming and live pipeline verification."""

    def test_01_conversational_stream(self):
        # 1. Create a session
        conv_res = client.post("/api/conversations", json={"title": "Stream Session"}).json()
        conv_id = conv_res["id"]

        # 2. Test conversational SSE stream
        req = {
            "conversation_id": conv_id,
            "query": "Hello! How can you help me today?",
            "top_k": 5,
            "alpha": 0.5,
            "use_router": True,
        }

        res = client.post("/api/query/stream", json=req)
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/event-stream", res.headers.get("content-type", ""))

        # Parse SSE events from response text
        events = []
        for line in res.text.strip().split("\n"):
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())

        self.assertIn("route", events)
        self.assertIn("answer", events)
        self.assertIn("done", events)

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")

    def test_02_document_rag_stream(self):
        # 1. Create a session
        conv_res = client.post("/api/conversations", json={"title": "RAG Stream Session"}).json()
        conv_id = conv_res["id"]

        req = {
            "conversation_id": conv_id,
            "query": "Where is the LIMIT clause explained?",
            "top_k": 5,
            "alpha": 0.5,
            "use_router": True,
        }

        res = client.post("/api/query/stream", json=req)
        self.assertEqual(res.status_code, 200)

        # Parse SSE events and data blocks
        stages = []
        done_payload = None
        for block in res.text.split("\n\n"):
            if not block.strip():
                continue
            lines = block.strip().split("\n")
            event_name = None
            data_dict = {}
            for line in lines:
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data_dict = json.loads(line.split(":", 1)[1].strip())

            if event_name:
                stages.append(event_name)
            if event_name == "done":
                done_payload = data_dict.get("result")

        self.assertIn("route", stages)
        self.assertIn("retrieve", stages)
        self.assertIn("confidence", stages)
        self.assertIn("answer", stages)
        self.assertIn("verify", stages)
        self.assertIn("done", stages)

        self.assertIsNotNone(done_payload)
        self.assertIn("answer", done_payload)

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")


if __name__ == "__main__":
    unittest.main()
