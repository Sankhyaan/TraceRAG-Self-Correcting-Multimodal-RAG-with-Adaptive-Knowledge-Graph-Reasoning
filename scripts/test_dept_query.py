import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.bm25_index import tokenize, STOPWORDS

query = "Why is ON e.dept_id = d.dept_id a valid join condition in the employees/departments examples, and what happens to employee rows if a department is deleted?"
conv_id = "conv_hndjrrxd"

print("Query tokens (without stopwords):", [w for w in tokenize(query, remove_stopwords=True) if w not in STOPWORDS])

res = hybrid_retriever.retrieve(
    conversation_id=conv_id,
    query=query,
    top_k=5,
)

print(f"\n--- RETRIEVAL RESULTS FOR: '{query}' ---")
for i, c in enumerate(res["chunks"]):
    print(f"\n#{i+1} [{c['file_type'].upper()}] {c['filename']} (Page {c['page_number']}) -> Final Score: {round(c['final_score']*100, 1)}% (Dense Rank: {c.get('dense_rank')}, BM25 Rank: {c.get('bm25_rank')}, Coord: {c.get('coordination_ratio')})")
    print(f"     Text: {c['text'][:300]}...")
