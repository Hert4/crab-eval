from typing import Any, Optional, Dict, List
from pydantic import BaseModel


# ─── Request models ───────────────────────────────────────────────────────────

class RecordMetadata(BaseModel):
    env_id: Optional[str] = None
    init_config: Optional[Dict[str, Any]] = None
    model_config = {"extra": "allow"}


class RecordInput(BaseModel):
    id: str
    input: str
    tools: List[Dict[str, Any]] = []
    conversation_history: List[Dict[str, Any]] = []
    metadata: RecordMetadata = RecordMetadata()


class EvalConfig(BaseModel):
    max_steps: int = 20
    temperature: float = 0.7
    infer_mode: str = "fc"
    enable_thinking: bool = False


class RunRequest(BaseModel):
    run_id: str
    task_name: str
    model: str
    generator_model: Optional[str] = None   
    generator_api_key: Optional[str] = None
    generator_base_url: Optional[str] = None
    model_provider: str = "openai"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    custom_headers: Optional[Dict[str, str]] = None
    records: List[RecordInput]
    eval_config: EvalConfig = EvalConfig()
    conversation_mode: bool = True  # Whether to use conversation-based env/agent (EnvScalerConvRLEnv + system/user messages) or non-conversation-based (EnvScalerNonConvRLEnv + single prompt). Conversation mode is better for multi-turn tasks but may cause more token usage and instability for short tasks.
    user_model: Optional[str] = None # Optional user_model for conversation mode. If not provided, will use generator_model or model.


# ─── Response models ──────────────────────────────────────────────────────────

class ChecklistResult(BaseModel):
    check_item: str
    passed: bool


class RecordResult(BaseModel):
    record_id: str
    status: str           # "success" | "error" | "truncated"
    score: float          # 0.0 – 1.0
    steps: int = 0
    duration_ms: int = 0
    trajectory: List[Dict[str, Any]] = []
    checklist_results: List[ChecklistResult] = []
    error: Optional[str] = None


class AggregateStats(BaseModel):
    total: int
    passed: int           # records with score > 0
    avg_score: float
    avg_steps: float


class RunResponse(BaseModel):
    run_id: str
    status: str           # "completed" | "partial"
    results: List[RecordResult]
    aggregate: AggregateStats
