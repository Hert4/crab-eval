"""
Quick test: call LLM — hardcode model, api_key, base_url below then run.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "EnvScaler", "skel_builder"))

from utils.call_llm import openai_llm_inference

# ── Config ─────────────────────────────────────────────────────────────────────
MODEL    = "gpt-4.1"
API_KEY  = "your_api_key"
BASE_URL = "base_url"   # set None to use default OpenAI
# ───────────────────────────────────────────────────────────────────────────────

response = openai_llm_inference(
    model=MODEL,
    messages=[{"role": "user", "content": "Tell me a joke."}],
    temperature=0.7,
    api_key=API_KEY,
    base_url=BASE_URL,
)

print("Response:", response)
