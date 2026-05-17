from typing import Any, Optional
from pydantic import BaseModel


# ─── Request models ───────────────────────────────────────────────────────────

class RecordMetadata(BaseModel):
    env_id: Optional[str] = None
    init_config: Optional[dict[str, Any]] = None
    model_config = {"extra": "allow"}


class RecordInput(BaseModel):
    id: str
    input: str
    tools: list[dict[str, Any]] = []
    conversation_history: list[dict[str, Any]] = []
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
    model_provider: str = "openai"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    records: list[RecordInput]
    eval_config: EvalConfig = EvalConfig()


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
    trajectory: list[dict[str, Any]] = []
    checklist_results: list[ChecklistResult] = []
    error: Optional[str] = None


class AggregateStats(BaseModel):
    total: int
    passed: int           # records with score > 0
    avg_score: float
    avg_steps: float


class RunResponse(BaseModel):
    run_id: str
    status: str           # "completed" | "partial"
    results: list[RecordResult]
    aggregate: AggregateStats
