import sys
import uuid
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi.testclient import TestClient
from backend.main import app
from backend.graph.models import EntityNode, RelationEdge, GraphPathHop, MultiHopResult
from backend.graph.extractor import entity_relation_extractor
from backend.graph.engine import graph_manager, ConversationGraph
from backend.graph.traverser import multi_hop_traverser
from backend.pipeline.chunker import DocumentChunk

client = TestClient(app)


def test_triple_extraction():
    print("\n" + "=" * 60)
    print("[*] TEST 1: Entity & Relationship Triple Extraction")
    print("=" * 60)

    sample_text = (
        "Alice is the lead software engineer at Apex Dynamics. "
        "She presented the Apollo-X architectural blueprint, which depends on Qdrant Vector Cloud. "
        "The system requires FastWhisper for audio transcription."
    )

    edges = entity_relation_extractor.extract_triples_for_chunk(
        text=sample_text,
        file_id="test_file_001",
        filename="project_overview.pdf",
        chunk_id="chunk_001",
        page_number=3,
        timestamp=None,
    )

    print(f"[+] Extracted {len(edges)} relationship edge(s):")
    for e in edges:
        print(f"    - ({e.source}) ➔ [{e.relation}] ➔ ({e.target}) | Evidence: \"{e.evidence[:60]}...\"")

    assert len(edges) >= 1, "Should extract at least 1 relationship edge."
    print("[+] Test 1 PASSED!")


import pytest

@pytest.fixture(scope="module")
def conv_id():
    test_conv_id = f"test_kg_conv_{uuid.uuid4().hex[:6]}"
    cg: ConversationGraph = graph_manager.get_graph(test_conv_id)
    cg.clear()

    # File 1 (PDF Document): "Project Alpha depends on PostgreSQL and was designed by Alice."
    edges_pdf = [
        RelationEdge(
            id="edge_1",
            source="Project Alpha",
            target="PostgreSQL",
            relation="DEPENDS_ON",
            evidence="Project Alpha depends on PostgreSQL for transactional storage.",
            file_id="file_pdf_1",
            filename="architecture_spec.pdf",
            chunk_id="chunk_pdf_1",
            page_number=2,
            metadata={"source_type": "PROJECT", "target_type": "DATABASE"},
        ),
        RelationEdge(
            id="edge_2",
            source="Alice",
            target="Project Alpha",
            relation="DESIGNED",
            evidence="Alice is the principal architect who designed Project Alpha.",
            file_id="file_pdf_1",
            filename="architecture_spec.pdf",
            chunk_id="chunk_pdf_1",
            page_number=2,
            metadata={"source_type": "PERSON", "target_type": "PROJECT"},
        ),
    ]

    # File 2 (Audio Meeting Transcript): "In the standup, David approved the security audit for PostgreSQL."
    edges_audio = [
        RelationEdge(
            id="edge_3",
            source="David",
            target="Security Audit",
            relation="APPROVED",
            evidence="[00:04 - 00:09] David approved the security audit in the weekly standup.",
            file_id="file_audio_1",
            filename="standup_meeting.mp3",
            chunk_id="chunk_audio_1",
            timestamp="00:04 - 00:09",
            metadata={"source_type": "PERSON", "target_type": "EVENT"},
        ),
        RelationEdge(
            id="edge_4",
            source="Security Audit",
            target="PostgreSQL",
            relation="VERIFIED",
            evidence="[00:10 - 00:15] The security audit verified that PostgreSQL has zero vulnerabilities.",
            file_id="file_audio_1",
            filename="standup_meeting.mp3",
            chunk_id="chunk_audio_2",
            timestamp="00:10 - 00:15",
            metadata={"source_type": "EVENT", "target_type": "DATABASE"},
        ),
    ]

    cg.add_edges(edges_pdf)
    cg.add_edges(edges_audio)
    return test_conv_id


def test_cross_file_graph_construction(conv_id: str):
    print("\n" + "=" * 60)
    print("[*] TEST 2: Multi-Modal Cross-File Knowledge Graph Construction")
    print("=" * 60)

    cg: ConversationGraph = graph_manager.get_graph(conv_id)
    graph_data = cg.get_graph_data()
    print(f"[+] Knowledge Graph constructed with {graph_data['node_count']} nodes and {graph_data['edge_count']} edges.")
    print(f"    Nodes: {[n['name'] for n in graph_data['nodes']]}")

    assert graph_data["node_count"] >= 4, "Graph should have at least 4 nodes."
    assert graph_data["edge_count"] >= 4, "Graph should have at least 4 edges."
    print("[+] Test 2 PASSED!")


def test_graph_persistence_and_reload(conv_id: str):
    print("\n" + "=" * 60)
    print("[*] TEST 3: Graph Persistence & Server Restart Reload")
    print("=" * 60)

    # Force a fresh instance to reload from disk
    new_cg = ConversationGraph(conv_id)
    reloaded_data = new_cg.get_graph_data()

    print(f"[+] Reloaded graph from disk: {reloaded_data['node_count']} nodes, {reloaded_data['edge_count']} edges.")
    assert reloaded_data["node_count"] >= 4, "Reloaded graph must preserve all nodes."
    assert reloaded_data["edge_count"] >= 4, "Reloaded graph must preserve all edges."
    print("[+] Test 3 PASSED!")


def test_multi_hop_traversal(conv_id: str):
    print("\n" + "=" * 60)
    print("[*] TEST 4: Multi-Hop Cross-File Shortest Path Traversal")
    print("=" * 60)

    # We want to find how "Alice" is connected to "David" across the PDF and Audio file:
    # Path: Alice (PDF) ➔ Project Alpha (PDF) ➔ PostgreSQL (PDF & Audio) ➔ Security Audit (Audio) ➔ David (Audio)
    res: MultiHopResult = multi_hop_traverser.traverse(
        conversation_id=conv_id,
        query="How does Alice relate to David's security decision?",
        entity_a="Alice",
        entity_b="David",
    )

    print(f"[+] Multi-Hop Result: is_multihop={res.is_multihop}")
    print(f"[+] Discovered {len(res.paths)} path(s):")
    for p_idx, path in enumerate(res.paths):
        print(f"\n    Path #{p_idx + 1} ({len(path)} hops):")
        for h_idx, hop in enumerate(path):
            loc = f"Page {hop.page_number}" if hop.page_number else (f"⏱️ {hop.timestamp}" if hop.timestamp else "")
            print(f"      Hop {h_idx + 1}: ({hop.from_node}) ➔ [{hop.relation}] ➔ ({hop.to_node}) | Source: {hop.filename} {loc}")

    assert res.is_multihop, "Traverser should find connecting multi-hop path."
    assert len(res.paths[0]) >= 2, "Path must span at least 2 hops across files."
    print("[+] Test 4 PASSED!")


def test_api_endpoints(conv_id: str):
    print("\n" + "=" * 60)
    print("[*] TEST 5: Knowledge Graph API Endpoints")
    print("=" * 60)

    # 1. GET /api/graph/{conversation_id}
    res_get = client.get(f"/api/graph/{conv_id}")
    assert res_get.status_code == 200, f"GET graph failed: {res_get.text}"
    data_get = res_get.json()
    print(f"[+] GET /api/graph/{conv_id} returned {data_get['node_count']} nodes and {data_get['edge_count']} edges.")

    # 2. POST /api/graph/traverse
    payload = {
        "conversation_id": conv_id,
        "query": "What is the relationship between Project Alpha and Security Audit?",
        "entity_a": "Project Alpha",
        "entity_b": "Security Audit",
    }
    res_traverse = client.post("/api/graph/traverse", json=payload)
    assert res_traverse.status_code == 200, f"POST traverse failed: {res_traverse.text}"
    data_traverse = res_traverse.json()
    print(f"[+] POST /api/graph/traverse returned {len(data_traverse.get('paths', []))} path(s).")
    assert data_traverse.get("is_multihop") is True, "API traverse should return is_multihop=True"

    print("[+] Test 5 PASSED!")


def run_all_tests():
    print("\n" + "=" * 60)
    print("🚀 STARTING PHASE 4 KNOWLEDGE GRAPH & MULTI-HOP TEST SUITE")
    print("=" * 60)

    test_triple_extraction()
    conv_id = test_cross_file_graph_construction()
    test_graph_persistence_and_reload(conv_id)
    test_multi_hop_traversal(conv_id)
    test_api_endpoints(conv_id)

    # Cleanup test graph
    graph_manager.clear_conversation(conv_id)

    print("\n" + "=" * 60)
    print("🎉 ALL PHASE 4 KNOWLEDGE GRAPH TESTS PASSED 100%!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    run_all_tests()
