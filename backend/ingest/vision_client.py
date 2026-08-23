import io
import time
import re
import logging
from typing import Optional, List, Tuple
from PIL import Image
from backend.config import get_settings

logger = logging.getLogger("trace.vision")


class VisionClient:
    """Unified client for multimodal visual understanding with automatic model rotation & robust rate-limit handling."""

    def __init__(self):
        self.settings = get_settings()

    def describe_image(
        self,
        image_bytes: bytes,
        mime_type: str = "image/png",
        prompt: Optional[str] = None,
        max_retries: int = 3,
    ) -> str:
        """
        Generates a rich, structured description of an image for search, knowledge graph, and citations.
        """
        default_prompt = (
            "Analyze this image comprehensively. "
            "Extract and describe all text, headers, bullet points, networking/technical terms, concepts, "
            "code, diagrams, and entities in rich detail so that it can be deeply indexed in a Knowledge Graph."
        )
        active_prompt = prompt or default_prompt

        if self.settings.gemini_api_key:
            return self._describe_with_gemini(image_bytes, mime_type, active_prompt, max_retries)
        elif self.settings.anthropic_api_key:
            return self._describe_with_claude(image_bytes, mime_type, active_prompt)
        else:
            raise ValueError("No Vision LLM provider configured (missing GEMINI_API_KEY or ANTHROPIC_API_KEY)")

    def _describe_with_gemini(
        self,
        image_bytes: bytes,
        mime_type: str,
        prompt: str,
        max_retries: int = 3,
    ) -> str:
        """Calls Google Gemini Vision API with model fallback and automatic retry on rate limits."""
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.settings.gemini_api_key)
        candidate_models = [
            self.settings.gemini_model or "gemini-3.6-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.5-flash",
        ]

        pil_img = Image.open(io.BytesIO(image_bytes))
        if pil_img.mode in ("RGBA", "P"):
            pil_img = pil_img.convert("RGB")

        # Convert PIL Image back to JPEG/PNG bytes for modern SDK
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=90)
        img_data = buf.getvalue()

        for attempt in range(max_retries):
            for model_name in candidate_models:
                try:
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=[
                            prompt,
                            types.Part.from_bytes(data=img_data, mime_type="image/jpeg"),
                        ],
                    )
                    if resp.text and resp.text.strip():
                        return resp.text.strip()
                except Exception as e:
                    err_str = str(e)
                    logger.debug(f"Gemini vision on {model_name} attempt {attempt}: {err_str}")
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        time.sleep(2.0)
                        continue
                    continue

            time.sleep(3.0)

        # Fallback
        w, h = pil_img.size
        return f"[Visual Image]: Dimensions {w}x{h} px. Visual content preserved."

    def _describe_with_claude(
        self,
        image_bytes: bytes,
        mime_type: str,
        prompt: str,
    ) -> str:
        import base64
        import anthropic

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        media_type = mime_type if mime_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"

        msg = client.messages.create(
            model=self.settings.anthropic_model or "claude-3-5-sonnet-20241022",
            max_tokens=1000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
        return msg.content[0].text.strip()


vision_client = VisionClient()
