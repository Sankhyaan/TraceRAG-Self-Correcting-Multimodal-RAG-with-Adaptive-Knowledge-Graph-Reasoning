import unittest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


class TestConversationsPhase6(unittest.TestCase):
    """Phase 6: Multi-thread conversations, message persistence, and session scoping."""

    def test_01_create_and_list_conversations(self):
        # 1. Create a conversation
        conv_payload = {"title": "Test SQL Session Alpha"}
        res = client.post("/api/conversations", json=conv_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        conv_id = data["id"]
        self.assertEqual(data["title"], "Test SQL Session Alpha")

        # 2. List conversations and verify presence
        list_res = client.get("/api/conversations")
        self.assertEqual(list_res.status_code, 200)
        convs = list_res.json()
        found = any(c["id"] == conv_id for c in convs)
        self.assertTrue(found, f"Conversation {conv_id} not found in list.")

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")

    def test_02_message_persistence_and_retrieval(self):
        # 1. Create conversation
        conv_res = client.post("/api/conversations", json={"title": "Session with Messages"})
        conv_id = conv_res.json()["id"]

        # 2. Add User Message
        user_msg = {
            "role": "user",
            "content": "Where is the LIMIT clause documented?",
        }
        res_u = client.post(f"/api/conversations/{conv_id}/messages", json=user_msg)
        self.assertEqual(res_u.status_code, 200)

        # 3. Add Assistant Message with Citation payload
        asst_msg = {
            "role": "assistant",
            "content": "The LIMIT clause is documented in Doc 1 [1].",
            "citations": [
                {
                    "passage_number": 1,
                    "claim_text": "The LIMIT clause is documented in Doc 1",
                    "evidence_quote": "LIMIT restricts number of rows",
                    "is_grounded": True,
                    "status": "VERIFIED",
                    "filename": "MySQL_Doc_1.pdf",
                    "page_number": 9,
                }
            ],
            "critic_info": {
                "confidence": "high",
                "reason": "Direct factual support.",
                "missing_aspects": [],
                "should_retry": False,
            },
            "groundedness_score": 1.0,
        }
        res_a = client.post(f"/api/conversations/{conv_id}/messages", json=asst_msg)
        self.assertEqual(res_a.status_code, 200)

        # 4. Fetch Message History
        hist_res = client.get(f"/api/conversations/{conv_id}/messages")
        self.assertEqual(hist_res.status_code, 200)
        messages = hist_res.json()
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[0]["content"], "Where is the LIMIT clause documented?")
        self.assertEqual(messages[1]["role"], "assistant")
        self.assertEqual(len(messages[1]["citations"]), 1)
        self.assertEqual(messages[1]["citations"][0]["status"], "VERIFIED")

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")

    def test_03_conversation_scoping_isolation(self):
        # Create two distinct sessions
        c1 = client.post("/api/conversations", json={"title": "Session Alpha"}).json()["id"]
        c2 = client.post("/api/conversations", json={"title": "Session Beta"}).json()["id"]

        # Add message to Alpha only
        client.post(f"/api/conversations/{c1}/messages", json={"role": "user", "content": "Alpha message"})

        # Verify Alpha has 1 message, Beta has 0 messages
        m1 = client.get(f"/api/conversations/{c1}/messages").json()
        m2 = client.get(f"/api/conversations/{c2}/messages").json()

        self.assertEqual(len(m1), 1)
        self.assertEqual(m1[0]["content"], "Alpha message")
        self.assertEqual(len(m2), 0)

        # Cleanup
        client.delete(f"/api/conversations/{c1}")
        client.delete(f"/api/conversations/{c2}")

    def test_04_delete_conversation_cascading(self):
        conv_res = client.post("/api/conversations", json={"title": "To Delete"}).json()
        conv_id = conv_res["id"]

        # Add message
        client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Temporary message"})

        # Delete conversation
        del_res = client.delete(f"/api/conversations/{conv_id}")
        self.assertEqual(del_res.status_code, 200)

        # Verify messages are empty
        m_res = client.get(f"/api/conversations/{conv_id}/messages").json()
        self.assertEqual(len(m_res), 0)


if __name__ == "__main__":
    unittest.main()
