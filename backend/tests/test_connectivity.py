"""
Connectivity Test Script for Trace RAG.
Tests:
1. Environment configuration loading
2. Supabase database and storage bucket connectivity
3. LLM API connectivity (Google Gemini and/or Anthropic Claude)
4. (Optional) Qdrant Vector DB reachability
"""

import sys
from pathlib import Path

# Fix Windows console UTF-8 encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.config import get_settings


def test_environment():
    print("=" * 60)
    print("[*] STEP 1: Checking Environment Configuration")
    print("=" * 60)
    settings = get_settings()

    status = True
    if not settings.supabase_url:
        print("[!] SUPABASE_URL is missing in .env")
        status = False
    else:
        print(f"[+] SUPABASE_URL: {settings.supabase_url}")

    key = settings.supabase_service_role_key or settings.supabase_key
    if not key:
        print("[!] SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY is missing in .env")
        status = False
    else:
        masked = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
        print(f"[+] Supabase Key: {masked}")

    # LLM configuration check
    print(f"[*] Active LLM Provider: {settings.llm_provider.upper()}")
    if settings.llm_provider == "gemini" or settings.gemini_api_key:
        if not settings.gemini_api_key:
            print("[!] GEMINI_API_KEY is missing in .env")
            status = False
        else:
            masked_gemini = (
                settings.gemini_api_key[:6] + "..." + settings.gemini_api_key[-4:]
                if len(settings.gemini_api_key) > 10
                else "***"
            )
            print(f"[+] GEMINI_API_KEY: {masked_gemini} (Model: {settings.gemini_model})")
    elif settings.llm_provider == "anthropic" or settings.anthropic_api_key:
        if not settings.anthropic_api_key:
            print("[!] ANTHROPIC_API_KEY is missing in .env")
            status = False
        else:
            masked_anthropic = (
                settings.anthropic_api_key[:8] + "..." + settings.anthropic_api_key[-4:]
                if len(settings.anthropic_api_key) > 12
                else "***"
            )
            print(f"[+] ANTHROPIC_API_KEY: {masked_anthropic} (Model: {settings.anthropic_model})")

    print(f"[*] Storage Bucket: {settings.supabase_storage_bucket}")
    print(f"[*] Qdrant URL: {settings.qdrant_url}")
    print(f"[*] Max Upload Size: {settings.max_upload_size_mb} MB")

    return status


def test_supabase_connectivity():
    print("\n" + "=" * 60)
    print("[*] STEP 2: Testing Supabase Database & Storage")
    print("=" * 60)
    settings = get_settings()

    key = settings.supabase_service_role_key or settings.supabase_key
    if not settings.supabase_url or not key:
        print("[!] Skipping Supabase test — credentials not provided in .env")
        return False

    try:
        from supabase import create_client

        supabase = create_client(settings.supabase_url, key)

        # Test Storage reachability
        print("Connecting to Supabase storage...")
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        print(f"[+] Supabase connected successfully! Found buckets: {bucket_names or '[]'}")

        target_bucket = settings.supabase_storage_bucket
        if target_bucket in bucket_names:
            print(f"[+] Target storage bucket '{target_bucket}' exists and is reachable.")
        else:
            print(
                f"[!] Target bucket '{target_bucket}' was not found in buckets list: {bucket_names}."
            )
            print(f"[*] Please create the bucket '{target_bucket}' in your Supabase dashboard (Storage section).")

        return True
    except Exception as e:
        print(f"[x] Failed to connect to Supabase: {str(e)}")
        return False


def test_gemini_api():
    print("\n" + "=" * 60)
    print("[*] STEP 3: Testing Google Gemini API")
    print("=" * 60)
    settings = get_settings()

    if not settings.gemini_api_key:
        print("[!] Skipping Gemini test — GEMINI_API_KEY not provided in .env")
        return False

    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(settings.gemini_model)
        print(f"Sending test ping to Gemini ({settings.gemini_model})...")
        response = model.generate_content("Respond with exact text: 'Trace backend connectivity confirmed.'")
        response_text = response.text.strip()
        print(f"[+] Gemini API Response: \"{response_text}\"")
        return True
    except Exception as e:
        print(f"[x] Gemini API call failed: {str(e)}")
        return False


def test_claude_api():
    print("\n" + "=" * 60)
    print("[*] STEP 3: Testing Anthropic Claude API (Alternative)")
    print("=" * 60)
    settings = get_settings()

    if not settings.anthropic_api_key:
        print("[!] Skipping Anthropic test — ANTHROPIC_API_KEY not provided in .env")
        return False

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        print(f"Sending test ping to Claude ({settings.anthropic_model})...")

        message = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=50,
            messages=[
                {
                    "role": "user",
                    "content": "Respond with exact text: 'Trace backend connectivity confirmed.'",
                }
            ],
        )

        response_text = message.content[0].text.strip()
        print(f"[+] Claude API Response: \"{response_text}\"")
        return True
    except Exception as e:
        print(f"[x] Anthropic API call failed: {str(e)}")
        return False


def test_qdrant_optional():
    print("\n" + "=" * 60)
    print("[*] STEP 4: Checking Qdrant Vector DB")
    print("=" * 60)
    settings = get_settings()

    try:
        from qdrant_client import QdrantClient

        client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=10.0,
        )
        collections = client.get_collections()
        names = [c.name for c in collections.collections]
        print(f"[+] Qdrant connected at {settings.qdrant_url}! Existing Collections: {names}")
        return True
    except Exception as e:
        print(f"[x] Qdrant connection notice: {str(e)}")
        return False


def run_all_tests():
    print("\n=== STARTING TRACE CONNECTIVITY VERIFICATION (Phase 0) ===\n")
    settings = get_settings()
    env_ok = test_environment()
    supabase_ok = test_supabase_connectivity()

    if settings.llm_provider == "gemini" or settings.gemini_api_key:
        llm_ok = test_gemini_api()
    else:
        llm_ok = test_claude_api()

    qdrant_ok = test_qdrant_optional()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"1. Environment Configuration : {'[+] OK' if env_ok else '[!] MISSING VALUES'}")
    print(f"2. Supabase Storage & DB     : {'[+] CONNECTED' if supabase_ok else '[!] NOT CONNECTED'}")
    print(f"3. LLM API ({settings.llm_provider.upper()})        : {'[+] CONNECTED' if llm_ok else '[!] NOT CONNECTED'}")
    print(f"4. Qdrant Vector DB          : {'[+] CONNECTED' if qdrant_ok else '[!] NOT CONNECTED'}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    run_all_tests()
