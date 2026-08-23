import io
import re
from PIL import Image
import pytesseract
from backend.ingest.vision_client import vision_client
from backend.config import get_settings

settings = get_settings()

if settings.tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd


class ImageExtractor:
    """Extracts content from images using OCR first, falling back to Vision LLM captioning with fail-safe metadata fallback."""

    def extract(self, filename: str, image_bytes: bytes, mime_type: str = "image/png") -> str:
        # 1. Attempt OCR with Pytesseract
        ocr_text = ""
        try:
            img = Image.open(io.BytesIO(image_bytes))
            ocr_text = pytesseract.image_to_string(img).strip()
        except Exception as e:
            print(f"[ImageExtractor] OCR notice: {str(e)}")

        # 2. Check if meaningful text was detected (30+ alphanumeric chars)
        alphanumeric_count = len(re.findall(r"[a-zA-Z0-9]", ocr_text))

        if alphanumeric_count >= 30:
            return f"[Image OCR Text - {filename}]:\n{ocr_text}"

        # 3. Vision LLM description with fail-safe fallback
        try:
            prompt = (
                f"Analyze this image '{filename}'. "
                "Provide a detailed, factual summary of all visual content, diagrams, charts, labels, "
                "data points, and entities to enable accurate retrieval in a RAG knowledge base."
            )
            caption = vision_client.describe_image(
                image_bytes=image_bytes,
                mime_type=mime_type,
                prompt=prompt,
            )

            result_parts = []
            if ocr_text.strip():
                result_parts.append(f"[Detected Text Fragments]:\n{ocr_text.strip()}")
            result_parts.append(f"[Visual Description - {filename}]:\n{caption}")

            return "\n\n".join(result_parts)
        except Exception as e:
            if ocr_text.strip():
                return f"[Image OCR Text - {filename}]:\n{ocr_text.strip()}"

            # Fallback metadata so file is never completely un-indexable
            try:
                img = Image.open(io.BytesIO(image_bytes))
                return f"[Image File - {filename}]: Resolution {img.width}x{img.height}px. (Visual extraction notice: {str(e)})"
            except Exception:
                return f"[Image File - {filename}]: Image data recorded."


image_extractor = ImageExtractor()
