import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.storage import get_supabase

sb = get_supabase()
res = sb.table("files").select("filename, extracted_text").eq("conversation_id", "conv_hndjrrxd").execute()

print("--- SEARCHING ACTIVE FILES IN CONV_HNDJRRXD FOR 'dept' / 'employee' ---")
for f in res.data:
    fn = f["filename"]
    text = (f.get("extracted_text") or "").lower()
    has_dept = "dept" in text
    has_emp = "employee" in text or "employ" in text
    has_join = "join" in text
    has_cascade = "cascade" in text or "on delete" in text
    print(f"File: {fn}")
    print(f"   has_dept: {has_dept} | has_employee: {has_emp} | has_join: {has_join} | has_cascade: {has_cascade}")
    if has_dept or has_emp:
        # Print snippet
        lines = [line for line in (f.get("extracted_text") or "").split("\n") if "dept" in line.lower() or "employee" in line.lower()]
        for l in lines[:5]:
            print(f"     -> {l.strip()}")
