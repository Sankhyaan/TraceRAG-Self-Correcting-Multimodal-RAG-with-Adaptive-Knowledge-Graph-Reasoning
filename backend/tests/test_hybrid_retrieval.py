"""
Phase 3: Router & Hybrid Retrieval Test Suite.
Tests:
1. Chunking with timestamp and page preservation
2. Sentence-Transformers dense embedding generation
3. Qdrant Cloud vector upsert and scoped search
4. BM25 sparse keyword search
5. Query intent and modality routing
6. Hybrid rank fusion (Dense + BM25 + Router weighting)
7. End-to-end API retrieval endpoint (POST /api/retrieval/query)
"""

import sys
import uuid
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Fix Windows console UTF-8 encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi.testclient import TestClient
from backend.main import app
from backend.pipeline.chunker import chunker
from backend.pipeline.embeddings import embedding_engine
from backend.pipeline.vector_store import vector_store
from backend.pipeline.bm25_index import bm25_manager
from backend.pipeline.router import query_router
from backend.pipeline.retriever import hybrid_retriever

client = TestClient(app)


def test_chunker_timestamp_preservation():
    print("\n" + "=" * 60)
    print("[*] TEST 1: Overlapping Chunker & Timestamp Preservation")
    print("=" * 60)

    sample_audio_transcript = (
        "[Audio Transcript - standup_meeting.mp3]:\n"
        "[00:00 - 00:04] Good morning everyone, let's start the standup meeting.\n"
        "[00:04 - 00:09] Alice deployed the database migration for Supabase storage.\n"
        "[00:09 - 00:15] Bob finished integrating Qdrant Cloud vector search with cosine distance.\n"
        "[00:15 - 00:22] Charlie resolved the frontend video playback issue for MKV media files.\n"
    )

    chunks = chunker.chunk_document(
        file_id="test_file_audio_1",
        conversation_id="test_conv_phase3",
        filename="standup_meeting.mp3",
        file_type="audio",
        text=sample_audio_transcript,
    )

    print(f"[+] Produced {len(chunks)} chunk(s).")
    for c in chunks:
        print(f"    - Chunk {c.chunk_index}: timestamp={c.timestamp}, len={len(c.text)} chars")
        print(f"      Text: {c.text[:80]}...")

    assert len(chunks) >= 1
    assert chunks[0].file_type == "audio"
    assert chunks[0].timestamp is not None
    print("[+] Chunker test PASSED!")


def test_embeddings_generation():
    print("\n" + "=" * 60)
    print("[*] TEST 2: Sentence-Transformers Embedding Generation")
    print("=" * 60)

    sample_texts = [
        "Trace uses hybrid retrieval combining dense vectors and BM25.",
        "Audio transcripts contain exact timestamps for playback.",
    ]

    vectors = embedding_engine.embed_texts(sample_texts)
    print(f"[+] Generated {len(vectors)} vectors.")
    print(f"    Vector dimension: {len(vectors[0])} (expected 384)")
    assert len(vectors) == 2
    assert len(vectors[0]) == 384
    assert len(vectors[1]) == 384

    query_vec = embedding_engine.embed_query("How does Trace perform vector search?")
    assert len(query_vec) == 384
    print("[+] Embeddings test PASSED!")


def test_qdrant_vector_store():
    print("\n" + "=" * 60)
    print("[*] TEST 3: Qdrant Cloud Vector Indexing & Scoped Search")
    print("=" * 60)

    test_conv_id = f"test_conv_qdrant_{uuid.uuid4().hex[:6]}"
    test_text = "Vector database indexing enables high-speed semantic similarity queries in Qdrant."

    chunks = chunker.chunk_document(
        file_id="test_file_vec_1",
        conversation_id=test_conv_id,
        filename="qdrant_architecture.pdf",
        file_type="document",
        text=test_text,
    )

    vectors = embedding_engine.embed_texts([c.text for c in chunks])
    upserted = vector_store.upsert_chunks(chunks, vectors)
    print(f"[+] Upserted {upserted} chunks into Qdrant Cloud.")

    # Query Qdrant
    q_vec = embedding_engine.embed_query("semantic similarity queries")
    hits = vector_store.search(query_vector=q_vec, conversation_id=test_conv_id, limit=5)
    print(f"[+] Qdrant search returned {len(hits)} hit(s):")
    for h in hits:
        print(f"    - Score: {h['score']:.4f}, File: {h['filename']}, Text: {h['text']}")

    assert len(hits) >= 1
    assert "Vector database indexing" in hits[0]["text"]

    # Cleanup test points
    vector_store.delete_conversation_chunks(test_conv_id)
    print("[+] Qdrant Vector Store test PASSED!")


def test_bm25_search():
    print("\n" + "=" * 60)
    print("[*] TEST 4: BM25 Sparse Keyword Search")
    print("=" * 60)

    test_conv_id = f"test_conv_bm25_{uuid.uuid4().hex[:6]}"
    doc_text = "The system implements tokenization with BM25Okapi for exact acronym and keyword matching."

    chunks = chunker.chunk_document(
        file_id="test_file_bm25_1",
        conversation_id=test_conv_id,
        filename="bm25_spec.txt",
        file_type="document",
        text=doc_text,
    )

    bm25_manager.add_chunks(test_conv_id, chunks)
    results = bm25_manager.search(conversation_id=test_conv_id, query="BM25Okapi keyword matching", top_k=5)

    print(f"[+] BM25 search returned {len(results)} match(es):")
    for chunk, score in results:
        print(f"    - Score: {score:.4f}, Text: {chunk.text}")

    assert len(results) >= 1
    assert "BM25Okapi" in results[0][0].text

    bm25_manager.clear_conversation(test_conv_id)
    print("[+] BM25 test PASSED!")


def test_query_router():
    print("\n" + "=" * 60)
    print("[*] TEST 5: Query Intent & Modality Router")
    print("=" * 60)

    # 1. Meeting / Audio query
    q_audio = "What did Alice say in the morning standup meeting?"
    route_audio = query_router.route_query(q_audio)
    print(f"[+] Query: '{q_audio}'")
    print(f"    Primary Categories: {route_audio['primary_categories']}")
    print(f"    Weights: {route_audio['weights']}")
    assert "audio" in route_audio["primary_categories"] or "video" in route_audio["primary_categories"]
    assert route_audio["weights"]["audio"] >= 0.8

    # 2. Document / PDF query
    q_doc = "What does section 3 of the syllabus document state about grading?"
    route_doc = query_router.route_query(q_doc)
    print(f"\n[+] Query: '{q_doc}'")
    print(f"    Primary Categories: {route_doc['primary_categories']}")
    print(f"    Weights: {route_doc['weights']}")
    assert "document" in route_doc["primary_categories"]
    assert route_doc["weights"]["document"] >= 0.8

    # 3. Image query
    q_img = "Describe the architecture diagram and chart in the graphic"
    route_img = query_router.route_query(q_img)
    print(f"\n[+] Query: '{q_img}'")
    print(f"    Primary Categories: {route_img['primary_categories']}")
    print(f"    Weights: {route_img['weights']}")
    assert "image" in route_img["primary_categories"]

    print("\n[+] Query Router test PASSED!")


def test_hybrid_retriever_modality_favoring():
    print("\n" + "=" * 60)
    print("[*] TEST 6: Hybrid Retrieval with Modality Favoring")
    print("=" * 60)

    test_conv_id = f"test_conv_fusion_{uuid.uuid4().hex[:6]}"

    # Index 1 document and 1 audio transcript
    doc_text = "Project roadmap: The beta release will be published in Q3 according to the written PDF specification."
    audio_text = "[00:08 - 00:14] In the team call, David announced that the security audit passed with zero vulnerabilities."

    hybrid_retriever.index_file(
        file_id="f_doc",
        conversation_id=test_conv_id,
        filename="roadmap.pdf",
        file_type="document",
        extracted_text=doc_text,
    )

    hybrid_retriever.index_file(
        file_id="f_audio",
        conversation_id=test_conv_id,
        filename="team_call.mp3",
        file_type="audio",
        extracted_text=audio_text,
    )

    # Test query favoring audio speech
    query = "What did David announce in the call about security audit?"
    retrieval_res = hybrid_retriever.retrieve(
        conversation_id=test_conv_id,
        query=query,
        top_k=2,
        alpha=0.5,
        use_router=True,
    )

    print(f"[+] Query: '{query}'")
    print(f"    Routed Categories: {retrieval_res['routed_categories']}")
    print(f"    Total candidates: {retrieval_res['total_candidates']}")
    for chunk in retrieval_res["chunks"]:
        print(f"    - Rank 1: [{chunk['file_type'].upper()}] {chunk['filename']} (Score: {chunk['final_score']}, Timestamp: {chunk['timestamp']})")
        print(f"      Text: {chunk['text']}")

    top_chunk = retrieval_res["chunks"][0]
    assert top_chunk["file_type"] == "audio"
    assert "David announced" in top_chunk["text"]
    assert top_chunk["timestamp"] == "00:08 - 00:14"

    # Cleanup
    vector_store.delete_conversation_chunks(test_conv_id)
    bm25_manager.clear_conversation(test_conv_id)
    print("[+] Hybrid Retriever test PASSED!")


def test_api_retrieval_endpoint():
    print("\n" + "=" * 60)
    print("[*] TEST 7: End-to-End API Endpoint (POST /api/retrieval/query)")
    print("=" * 60)

    test_conv_id = f"test_conv_api_{uuid.uuid4().hex[:6]}"

    # Index sample data
    hybrid_retriever.index_file(
        file_id="f_api_test",
        conversation_id=test_conv_id,
        filename="server_cluster.txt",
        file_type="document",
        extracted_text="The cluster nodes are configured with auto-scaling on port 8000 and 6333.",
    )

    res = client.post(
        "/api/retrieval/query",
        json={
            "conversation_id": test_conv_id,
            "query": "Which ports are configured for the cluster nodes?",
            "top_k": 3,
            "alpha": 0.5,
        },
    )

    assert res.status_code == 200, f"API error: {res.text}"
    data = res.json()
    print("[+] API /api/retrieval/query response:")
    print(f"    Routed: {data['routed_categories']}")
    print(f"    Rationale: {data['router_rationale']}")
    print(f"    Returned {len(data['chunks'])} chunks")
    assert len(data["chunks"]) >= 1
    assert "port 8000" in data["chunks"][0]["text"]

    # Cleanup
    vector_store.delete_conversation_chunks(test_conv_id)
    bm25_manager.clear_conversation(test_conv_id)
    print("[+] API Retrieval endpoint test PASSED!")


def run_all_retrieval_tests():
    print("\n" + "=" * 60)
    print("🚀 STARTING PHASE 3 ROUTER & HYBRID RETRIEVAL TEST SUITE")
    print("=" * 60)

    test_chunker_timestamp_preservation()
    test_embeddings_generation()
    test_qdrant_vector_store()
    test_bm25_search()
    test_query_router()
    test_hybrid_retriever_modality_favoring()
    test_api_retrieval_endpoint()

    print("\n" + "=" * 60)
    print("🎉 ALL PHASE 3 ROUTER & HYBRID RETRIEVAL TESTS PASSED 100%!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    run_all_retrieval_tests()
