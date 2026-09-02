#!/usr/bin/env python3
"""
Qdrant Cloud Keep-Alive Script
Pings the Qdrant cluster to reset the 7-day inactivity timer on free-tier clusters.
"""
import os
import sys

def keep_alive():
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_api_key = os.getenv("QDRANT_API_KEY")

    if not qdrant_url:
        print("[Keep-Alive] QDRANT_URL not set in environment. Checking .env file...")
        try:
            from dotenv import load_dotenv
            load_dotenv()
            qdrant_url = os.getenv("QDRANT_URL")
            qdrant_api_key = os.getenv("QDRANT_API_KEY")
        except Exception as e:
            print(f"[Keep-Alive] Notice loading .env: {e}")

    if not qdrant_url:
        print("[Keep-Alive] Error: QDRANT_URL is not set.")
        sys.exit(1)

    try:
        from qdrant_client import QdrantClient
        print(f"[Keep-Alive] Connecting to {qdrant_url}...")
        client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key, timeout=15)
        
        collections = client.get_collections()
        col_names = [c.name for c in collections.collections]
        print(f"[Keep-Alive] Successfully queried collections: {col_names}")

        if "trace_chunks" in col_names:
            points = client.scroll(collection_name="trace_chunks", limit=2)
            print(f"[Keep-Alive] Scrolled active points: {len(points[0])} items found.")
        
        print("[Keep-Alive] [OK] Heartbeat successful! Qdrant inactivity timer reset.")
    except Exception as exc:
        print(f"[Keep-Alive] [ERROR] Error contacting Qdrant: {exc}")
        sys.exit(1)

if __name__ == "__main__":
    keep_alive()
