#!/usr/bin/env python3
"""
Qdrant Cloud Keep-Alive Script
Pings the Qdrant REST API to reset the 7-day inactivity timer on free-tier clusters.
Uses standard library urllib for zero-dependency, reliable execution.
"""
import os
import sys
import json
import urllib.request
import urllib.error

DEFAULT_QDRANT_URL = "https://f1dd0814-91dd-44d8-9ace-a8453c7204a4.ca-central-1-0.aws.cloud.qdrant.io:6333"

def keep_alive():
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    qdrant_api_key = os.getenv("QDRANT_API_KEY", "").strip()

    # Clean up empty or boolean string evaluations from GitHub Actions YAML
    if not qdrant_url or qdrant_url.lower() in ("true", "false", "none", ""):
        qdrant_url = DEFAULT_QDRANT_URL

    if not qdrant_api_key:
        try:
            from dotenv import load_dotenv
            load_dotenv()
            qdrant_api_key = os.getenv("QDRANT_API_KEY", "").strip()
        except Exception:
            pass

    if not qdrant_api_key:
        print("[Keep-Alive] [ERROR] QDRANT_API_KEY secret is missing or empty.")
        sys.exit(1)

    # Clean URL format
    qdrant_url = qdrant_url.rstrip("/")
    if not qdrant_url.startswith("http"):
        qdrant_url = f"https://{qdrant_url}"

    endpoint = f"{qdrant_url}/collections"
    print(f"[Keep-Alive] Sending REST heartbeat to {endpoint}...")

    req = urllib.request.Request(
        endpoint,
        headers={
            "api-key": qdrant_api_key,
            "User-Agent": "TraceRAG-KeepAlive/1.0",
            "Content-Type": "application/json"
        },
        method="GET"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            status_code = response.getcode()
            body = response.read().decode("utf-8")
            data = json.loads(body)
            collections = [c.get("name") for c in data.get("result", {}).get("collections", [])]
            print(f"[Keep-Alive] [OK] HTTP {status_code} - Active Collections: {collections}")
            print("[Keep-Alive] [SUCCESS] Heartbeat successful! Qdrant inactivity timer reset.")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        print(f"[Keep-Alive] [ERROR] HTTP Error {e.code}: {err_body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[Keep-Alive] [ERROR] URL Connection Error: {e.reason}")
        sys.exit(1)
    except Exception as exc:
        print(f"[Keep-Alive] [ERROR] Unexpected Error: {exc}")
        sys.exit(1)

if __name__ == "__main__":
    keep_alive()
