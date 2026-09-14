"""
Supabase Keep-Alive Heartbeat Probe
Pings Supabase PostgREST & Auth APIs to maintain active status on free-tier projects.
"""
import os
import sys
import json
import urllib.request
import urllib.error

def main():
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.environ.get("SUPABASE_KEY", "") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not supabase_key:
        print("[Keep-Alive] [NOTICE] SUPABASE_URL or SUPABASE_KEY missing in environment.")
        sys.exit(0)

    print(f"[Keep-Alive] Pinging Supabase instance at {supabase_url}...")

    # 1. Probe PostgREST OpenAPI / health endpoint
    endpoints = [
        f"{supabase_url}/rest/v1/",
        f"{supabase_url}/auth/v1/health",
    ]

    success = False
    for url in endpoints:
        req = urllib.request.Request(
            url,
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "User-Agent": "TraceRAG-KeepAlive/1.0",
            },
            method="GET"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                status_code = response.getcode()
                print(f"[Keep-Alive] [OK] {url} -> HTTP {status_code}")
                success = True
        except urllib.error.HTTPError as e:
            # Even a 400/404 or auth challenge counts as active traffic to Supabase infrastructure
            print(f"[Keep-Alive] [INFO] {url} -> HTTP {e.code} (Traffic registered)")
            success = True
        except urllib.error.URLError as e:
            print(f"[Keep-Alive] [ERROR] Failed to connect to {url}: {e.reason}")
        except Exception as e:
            print(f"[Keep-Alive] [ERROR] Unexpected error pinging {url}: {e}")

    if success:
        print("[Keep-Alive] [SUCCESS] Supabase activity registered successfully. Auto-pause prevented.")
    else:
        print("[Keep-Alive] [WARN] Could not establish connection to Supabase.")

if __name__ == "__main__":
    main()
