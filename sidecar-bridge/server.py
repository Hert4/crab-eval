"""
FastAPI server exposing EnvScaler evaluation as a REST API for crab-eval.

Start with:
    cd sidecar-bridge
    uvicorn server:app --port 8000
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from server_models import RunRequest, RunResponse, RecordResult, AggregateStats
from server_runner import build_envs_batch, run_record, list_available_envs

_executor = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _executor
    # ThreadPool not ProcessPool — Stage 3-5 is LLM I/O bound, no CPU gains
    # from processes, and ProcessPool workers can get stuck on bad request
    # retry loops with no clean way to recycle them mid-session.
    _executor = ThreadPoolExecutor(max_workers=8)
    yield
    if _executor:
        _executor.shutdown(wait=True)

app = FastAPI(title="EnvScaler API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

def _worker_wrapper(record, env_item, model, model_provider, infer_mode, enable_thinking, max_steps, temperature, api_key, base_url, custom_headers, generator_model=None, generator_api_key=None, generator_base_url=None, conversation_mode=False, user_model=None):
    from server_runner import run_record
    return run_record(
        record=record,
        env_item=env_item,
        model=model,
        model_provider=model_provider,
        generator_model=generator_model or model,
        generator_api_key=generator_api_key,
        generator_base_url=generator_base_url,
        infer_mode=infer_mode,
        enable_thinking=enable_thinking,
        max_steps=max_steps,
        temperature=temperature,
        api_key=api_key,
        base_url=base_url,
        custom_headers=custom_headers,
        conversation_mode=conversation_mode,
        user_model=user_model,
    )


@app.get("/envscaler/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/envscaler/envs")
def get_envs():
    return {"envs": list_available_envs()}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


@app.post("/envscaler/run")
async def run_eval(request: RunRequest):
    """
    SSE streaming endpoint. Yields events:
      - stage1_start  {total}
      - stage1_done   {record_id, ok, error?}
      - stage2_start  {total_reps, total_records}
      - stage2_done   {rep_id, ok, error?}
      - record_done   {record_id, result: RecordResult}
      - complete      {run_id, status, results, aggregate}
      - error         {message}
    """
    if not request.records:
        raise HTTPException(status_code=422, detail="records must not be empty")

    # Fallback to env vars when frontend sends empty/None credentials.
    # Empty string would be passed straight to OpenAI client and fail with
    # "Missing credentials" instead of triggering the SDK's env-var fallback.
    def _or_env(value, env_key):
        if value:
            return value
        return os.environ.get(env_key) or None

    target_api_key       = _or_env(request.api_key,           "USER_OPENAI_API_KEY") or _or_env(None, "OPENAI_API_KEY")
    target_base_url      = _or_env(request.base_url,          "USER_OPENAI_BASE_URL") or _or_env(None, "OPENAI_BASE_URL")
    generator_api_key    = _or_env(request.generator_api_key, "OPENAI_API_KEY")
    generator_base_url   = _or_env(request.generator_base_url, "OPENAI_BASE_URL")

    cfg = request.eval_config
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()

    def push(event: str, payload: dict) -> None:
        # Thread-safe: workers call this from ThreadPoolExecutor inside the
        # ProcessPool-bound build_envs_batch (actually same process for stage1).
        loop.call_soon_threadsafe(queue.put_nowait, (event, payload))

    async def driver() -> None:
        import functools
        try:
            gen_model = request.generator_model or request.model

            # Phase 1: build envs (Stage 1 + Stage 2). Emits stage1_*/stage2_* via push().
            # Run on the default thread pool (NOT ProcessPool) because `push`
            # closes over the running loop and queue — not picklable across processes.
            # build_envs_batch is I/O-bound (LLM + embeddings) so threads are fine.
            env_items = await loop.run_in_executor(
                None,
                functools.partial(
                    build_envs_batch,
                    request.records,
                    gen_model,
                    generator_api_key,
                    generator_base_url,
                    "text-embedding-3-small",
                    None,
                    push,
                ),
            )

            # Phase 2: spawn run_record per valid record, emit record_done as each finishes.
            immediate_results: dict[str, RecordResult] = {}
            running: list[tuple[str, asyncio.Future]] = []

            for record in request.records:
                env_item = env_items.get(record.id)
                if env_item is None:
                    res = RecordResult(
                        record_id=record.id,
                        status="error",
                        score=0.0,
                        steps=0,
                        duration_ms=0,
                        error="[stage1] Record filtered out: not stateful or below metrics threshold",
                    )
                    immediate_results[record.id] = res
                    push("record_done", {"record_id": record.id, "result": res.model_dump()})
                elif isinstance(env_item, Exception):
                    res = RecordResult(
                        record_id=record.id,
                        status="error",
                        score=0.0,
                        steps=0,
                        duration_ms=0,
                        error=f"[stage1_or_stage2] {type(env_item).__name__}: {env_item}",
                    )
                    immediate_results[record.id] = res
                    push("record_done", {"record_id": record.id, "result": res.model_dump()})
                else:
                    fut = loop.run_in_executor(
                        _executor,
                        functools.partial(
                            _worker_wrapper,
                            record,
                            env_item,
                            request.model,
                            request.model_provider,
                            cfg.infer_mode,
                            cfg.enable_thinking,
                            cfg.max_steps,
                            cfg.temperature,
                            target_api_key,
                            target_base_url,
                            request.custom_headers,
                            gen_model,
                            generator_api_key,
                            generator_base_url,
                            request.conversation_mode,
                            request.user_model,
                        ),
                    )
                    running.append((record.id, fut))

            agent_results: dict[str, RecordResult] = {}
            for rid, fut in running:
                try:
                    res = await fut
                except Exception as exc:
                    res = RecordResult(
                        record_id=rid,
                        status="error",
                        score=0.0,
                        steps=0,
                        duration_ms=0,
                        error=f"[stage3-5] {type(exc).__name__}: {exc}",
                    )
                agent_results[rid] = res
                push("record_done", {"record_id": rid, "result": res.model_dump()})

            results: list[RecordResult] = [
                immediate_results.get(r.id) or agent_results[r.id]
                for r in request.records
            ]
            total = len(results)
            passed = sum(1 for r in results if r.score >= 0.99)
            avg_score = sum(r.score for r in results) / total if total else 0.0
            avg_steps = sum(r.steps for r in results) / total if total else 0.0
            any_error = any(r.status == "error" for r in results)

            response = RunResponse(
                run_id=request.run_id,
                status="partial" if any_error else "completed",
                results=results,
                aggregate=AggregateStats(
                    total=total,
                    passed=passed,
                    avg_score=avg_score,
                    avg_steps=avg_steps,
                ),
            )
            push("complete", response.model_dump())
        except Exception as exc:
            push("error", {"message": f"{type(exc).__name__}: {exc}"})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

    async def generator():
        # Kick off the driver, then drain the event queue → SSE frames.
        task = asyncio.create_task(driver())
        try:
            while True:
                item = await queue.get()
                if item is SENTINEL:
                    break
                event, payload = item
                yield _sse(event, payload)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
