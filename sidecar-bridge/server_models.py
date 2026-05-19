from typing import Any, Optional, Dict, List
from pydantic import BaseModel, Field


# ─── Request models ───────────────────────────────────────────────────────────

class RecordMetadata(BaseModel):
    env_id: Optional[str] = None
    init_config: Optional[Dict[str, Any]] = None

    class Config:
        extra = "allow"


class RecordInput(BaseModel):
    id: str
    input: str
    tools: List[Dict[str, Any]] = Field(default_factory=list)
    conversation_history: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: RecordMetadata = Field(default_factory=RecordMetadata)


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
    custom_headers: Optional[Dict[str, str]] = None
    records: List[RecordInput]
    eval_config: EvalConfig = Field(default_factory=EvalConfig)


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
    trajectory: List[Dict[str, Any]] = Field(default_factory=list)
    checklist_results: List[ChecklistResult] = Field(default_factory=list)
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