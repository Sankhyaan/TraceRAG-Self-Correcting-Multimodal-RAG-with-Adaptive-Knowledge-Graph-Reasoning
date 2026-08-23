import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.bm25_index import tokenize

query = "Why is ON e.dept_id = d.dept_id a valid join condition in the employees/departments examples, and what happens to employee rows if a department is deleted?"
conv_id = "conv_hndjrrxd"

res = hybrid_retriever.retrieve(
    conversation_id=conv_id,
    query=query,
    top_k=6,
)

q_concepts = set(tokenize(query, remove_stopwords=True, apply_stem=True))
print("Query Concepts:", q_concepts)

for i, c in enumerate(res["chunks"]):
    c_tokens = set(tokenize(c["text"], remove_stopwords=True, apply_stem=True))
    matched = q_concepts.intersection(c_tokens)
    print(f"\n#{i+1} Page {c['page_number']} of {c['filename']}")
    print(f"   Final Score: {round(c['final_score']*100, 2)}% | Coord Ratio: {c.get('coordination_ratio')}")
    print(f"   Matched Concepts ({len(matched)}): {matched}")
    print(f"   Dense Rank: {c.get('dense_rank')}, BM25 Rank: {c.get('bm25_rank')}")
