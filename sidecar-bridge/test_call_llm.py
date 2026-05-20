"""
Quick test: call LLM — hardcode model, api_key, base_url below then run.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "EnvScaler", "skel_builder"))

from utils.call_llm import openai_llm_inference

# ── Config ─────────────────────────────────────────────────────────────────────
MODEL    = "gpt-4.1"
API_KEY  = "misa_tmduc3_00tc557d_1hdMBJq8Mj5RwyrLAyQU4gXP_EXawv8QI"
BASE_URL = "https://test-aiservice.misa.com.vn/llm-gateway/v1"   # set None to use default OpenAI
# ───────────────────────────────────────────────────────────────────────────────

response = openai_llm_inference(
    model=MODEL,
    messages=[{"role": "user", "content": "Tell me a joke."}],
    temperature=0.7,
    api_key=API_KEY,
    base_url=BASE_URL,
)

print("Response:", response)
