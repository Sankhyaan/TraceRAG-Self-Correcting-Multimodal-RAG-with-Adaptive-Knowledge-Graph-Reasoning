import re
import json
import logging
from typing import Dict, Any, List, Optional
from backend.config import get_settings

logger = logging.getLogger("trace.synthesis.llm_client")


def call_llm(
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2500,
    json_mode: bool = False,
) -> Optional[str]:
    """
    Universal, high-reliability LLM caller.
    Supports Google Gemini (via Direct REST API with zero SDK quirks + google.genai fallback)
    and Anthropic Claude.
    """
    settings = get_settings()

    # 1. Google Gemini
    if settings.gemini_api_key:
        full_prompt = f"{system_prompt.strip()}\n\n{prompt.strip()}" if system_prompt else prompt.strip()
        candidate_models = [
            settings.gemini_model or "gemini-2.0-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ]

        # 1A. Direct High-Throughput REST API (Bulletproof, zero SDK version mismatches)
        for model_name in candidate_models:
            try:
                import httpx
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={settings.gemini_api_key}"
                body: Dict[str, Any] = {
                    "contents": [{
                        "parts": [{"text": full_prompt}]
                    }],
                    "generationConfig": {
                        "temperature": temperature,
                        "maxOutputTokens": max_tokens,
                    }
                }
                if json_mode:
                    body["generationConfig"]["responseMimeType"] = "application/json"

                with httpx.Client(timeout=30.0) as client:
                    resp = client.post(url, json=body)
                    if resp.status_code == 200:
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts and parts[0].get("text"):
                                text_out = parts[0]["text"].strip()
                                if text_out:
                                    return text_out
                    else:
                        logger.debug(f"Gemini REST error ({model_name}): HTTP {resp.status_code} - {resp.text[:120]}")
            except Exception as e:
                logger.debug(f"Gemini REST attempt exception for {model_name}: {e}")
                continue

        # 1B. Fallback to google.genai Client
        try:
            from google import genai
            client = genai.Client(api_key=settings.gemini_api_key)
            for model_name in candidate_models:
                try:
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=full_prompt,
                    )
                    if resp.text and resp.text.strip():
                        return resp.text.strip()
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"google.genai fallback exception: {e}")

        # 1C. Fallback to legacy google.generativeai
        try:
            import google.generativeai as legacy_genai
            legacy_genai.configure(api_key=settings.gemini_api_key)
            for model_name in candidate_models:
                try:
                    model = legacy_genai.GenerativeModel(model_name=model_name)
                    response = model.generate_content(full_prompt)
                    if response.text and response.text.strip():
                        return response.text.strip()
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"legacy_genai fallback exception: {e}")

    # 2. Anthropic Claude (Alternative)
    if settings.anthropic_api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            kwargs: Dict[str, Any] = {
                "model": settings.anthropic_model or "claude-3-5-sonnet-20241022",
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            }
            if system_prompt:
                kwargs["system"] = system_prompt
            resp = client.messages.create(**kwargs)
            if resp.content and resp.content[0].text:
                return resp.content[0].text.strip()
        except Exception as e:
            logger.error(f"Claude invocation error: {e}")

    return None
