from backend.config import get_settings
from backend.synthesis.intent import generate_conversational_response

s = get_settings()
print("Gemini API key:", bool(s.gemini_api_key))
print("Gemini model:", s.gemini_model)

try:
    ans = generate_conversational_response("what is photosynthesis and why is it important?", "conv_demo")
    print("Answer length:", len(ans))
    print("Answer snippet:\n", ans[:300])
except Exception as e:
    import traceback
    traceback.print_exc()
