"""
FastAPI server exposing EnvScaler evaluation as a REST API for crab-eval.

Start with:
    cd sidecar-bridge
    uvicorn server:app --port 8000
"""
import asyncio
import os
from contextlib import asynccontextmanager
from concurrent.futures import ProcessPoolExecutor
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from server_models import RunRequest, RunResponse, RecordResult, AggregateStats
from server_runner import run_record, list_available_envs

_executor = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _executor
    _executor = ProcessPoolExecutor(max_workers=4)
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

def _worker_wrapper(record, model, model_provider, infer_mode, enable_thinking, max_steps, temperature, api_key, base_url, custom_headers, generator_model=None, generator_api_key=None, generator_base_url=None, conversation_mode=False, user_model=None):
    from server_runner import run_record
    return run_record(
        record=record,
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


@app.post("/envscaler/run", response_model=RunResponse)
async def run_eval(request: RunRequest):
    if not request.records:
        raise HTTPException(status_code=422, detail="records must not be empty")

    cfg = request.eval_config
    loop = asyncio.get_running_loop()

    import functools

    # Run each record in the process pool to keep os.environ isolated
    futures = [
        loop.run_in_executor(
            _executor,
            functools.partial(
                _worker_wrapper,
                record,
                request.model,
                request.model_provider,
                cfg.infer_mode,
                cfg.enable_thinking,
                cfg.max_steps,
                cfg.temperature,
                request.api_key,
                request.base_url,
                request.custom_headers,
                request.generator_model,
                request.generator_api_key,
                request.generator_base_url,
                request.conversation_mode,
                request.user_model,
            ),
        )
        for record in request.records
    ]
    results: list[RecordResult] = await asyncio.gather(*futures)

    # Aggregate
    total = len(results)
    passed = sum(1 for r in results if r.score >= 0.99)   # all check pass?
    avg_score = sum(r.score for r in results) / total if total else 0.0
    avg_steps = sum(r.steps for r in results) / total if total else 0.0

    any_error = any(r.status == "error" for r in results)

    return RunResponse(
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
