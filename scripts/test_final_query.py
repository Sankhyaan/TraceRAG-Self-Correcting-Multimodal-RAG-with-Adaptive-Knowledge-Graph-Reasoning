import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.synthesis.pipeline import synthesis_pipeline

query = "If I TRUNCATE the departments table, what happens to the employees table given the foreign key relationship from Doc III?"
conv_id = "conv_hndjrrxd"

print("--- EXECUTING SYNTHESIS PIPELINE ---")
res = synthesis_pipeline.synthesize(conversation_id=conv_id, query=query)

print("\n[ANSWER]:")
print(res.answer)
print(f"\n[CONFIDENCE]: {res.confidence} | [GROUNDEDNESS]: {round(res.groundedness_score*100, 1)}%")
print(f"[RETRIED]: {res.retry_info.retried}")
print("\n[CITATIONS]:")
for cit in res.citations:
    print(f"  [{cit.passage_number}] {cit.filename} (Page {cit.page_number}) -> Status: {cit.status}")
    print(f"      Claim: {cit.claim_text}")
    print(f"      Evidence: {cit.evidence_quote[:150]}...")
