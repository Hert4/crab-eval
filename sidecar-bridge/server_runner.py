"""
Wraps EnvScaler's full pipeline (skel_builder → scen_generator → interact_with_env)
into a callable that accepts RecordInput and returns RecordResult.
"""
import os
import sys
import time
import json
import tempfile
import traceback

# ── Path setup ────────────────────────────────────────────────────────────────
_BASE_DIR        = os.path.dirname(__file__)
_ENVSCALER_DIR   = os.path.join(_BASE_DIR, "..", "EnvScaler")
_SKEL_DIR        = os.path.join(_ENVSCALER_DIR, "skel_builder")
_SCEN_DIR        = os.path.join(_ENVSCALER_DIR, "scen_generator")
_INTERACT_DIR    = os.path.join(_ENVSCALER_DIR, "interact_with_env")

for _p in (_SKEL_DIR, _SCEN_DIR, _INTERACT_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── skel_builder imports ──────────────────────────────────────────────────────
from stage1_collect_env_from_task.step1_judge_stateful_query import process_query as _stage1_step1
from stage1_collect_env_from_task.step2_infer_env_topic       import process_item  as _stage1_step2
from stage2_syn_env.step1_infer_state                         import process_env_item as _stage2_step1
from stage2_syn_env.step2_infer_state_code                    import process_env_item as _stage2_step2
from stage2_syn_env.step3_infer_operation                     import process_env_item as _stage2_step3
from stage2_syn_env.step4_infer_func_code                     import process_env_item_for_demo as _stage2_step4
from stage2_syn_env.step5_concat                              import process_env_item as _stage2_step5
from stage2_syn_env.step6_analysis_env_class_code             import process_env_item as _stage2_step6

# ── scen_generator imports ────────────────────────────────────────────────────
from step1_gen_env_config       import gen_init_config
from step3_gen_task_check_func  import process_single_task

# ── interact_with_env imports ─────────────────────────────────────────────────
from agent.task_solve_agent import TaskSolveAgent
from envscaler_env import EnvScalerNonConvRLEnv

from server_models import RecordInput, RecordResult, ChecklistResult




# ── skel_builder pipeline ─────────────────────────────────────────────────────

def _build_env_metadata(task_text: str, model: str, api_key: str | None = None, base_url: str | None = None) -> dict | None:
    """
    Run the full skel_builder pipeline on raw task text.
    Returns an env_item dict (with env_class_code, tools, etc.)
    or None if the task is filtered out by Stage 1 Step 1.
    """
    env_item_raw = {"task": task_text, "task_from": "crab-eval"}

    # Stage 1-1: filter non-stateful tasks
    judge = _stage1_step1(query=task_text, model=model, api_key=api_key, base_url=base_url)
    if not judge.get("judge_result"):
        return None

    # Stage 1-2: infer env topic
    env_item = _stage1_step2(item=env_item_raw, model=model, api_key=api_key, base_url=base_url)

    # Stage 2-1 … 2-6: synthesise full env class
    env_item = _stage2_step1(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step2(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step3(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step4(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    success, env_item = _stage2_step5(env_item=env_item)
    if not success:
        raise RuntimeError("skel_builder Stage 2-5 AST check failed")
    env_item = _stage2_step6(env_item=env_item, model=model, api_key=api_key, base_url=base_url)

    return env_item


# ── scen_generator helpers ────────────────────────────────────────────────────

def _build_init_config(env_item: dict, model: str, temperature: float, api_key: str | None = None, base_url: str | None = None) -> dict:
    """Call gen_init_config with the env class code and container info."""
    all_containers = {
        k: v
        for k, v in env_item.get("env_structure", {}).get("states", {}).items()
        if k != "init_config"
    }
    init_config = gen_init_config(
        env_class_code=env_item["env_class_code"],
        all_containers=all_containers,
        model=model,
        temperature=temperature,
        api_key=api_key,
        base_url=base_url
    )
    if init_config is None:
        raise RuntimeError("gen_init_config returned None after retries")
    return init_config


def _build_checklist_with_func(
    env_item: dict,
    task_text: str,
    init_config: dict,
    model: str,
    api_key: str | None = None,
    base_url: str | None = None
) -> list:
    """Generate checklist + check_func for a single task."""
    # process_single_task expects a task_item dict and an env_items dict keyed by env_id
    synthetic_env_id = env_item.get("env_id", "dynamic_env")
    env_item_copy = dict(env_item)
    env_item_copy["env_id"] = synthetic_env_id

    task_item = {
        "env_id":         synthetic_env_id,
        "env_class_name": env_item["env_class_name"],
        "task":           task_text,
        "init_config":    init_config,
    }
    env_items = {synthetic_env_id: env_item_copy}

    result = process_single_task(model=model, task_item=task_item, env_items=env_items, api_key=api_key, base_url=base_url)
    return result.get("checklist_with_func", [])


# ── interact_with_env runner ──────────────────────────────────────────────────

def _run_agent(
    env_item: dict,
    task_text: str,
    init_config: dict,
    checklist_with_func: list,
    model: str,
    model_provider: str,
    infer_mode: str,
    enable_thinking: bool,
    max_steps: int,
    temperature: float = 0.7,
    api_key: str | None = None,
    base_url: str | None = None,
    custom_headers: dict | None = None,
) -> dict:
    """
    Inject a synthetic task_item into a temp file, spin up
    EnvScalerNonConvRLEnv, run TaskSolveAgent, and return raw results.
    """
    synthetic_env_id    = env_item.get("env_id", "dynamic_env")
    env_class_name      = env_item["env_class_name"]

    synthetic_task_item = {
        "task_id":           0,
        "env_id":            synthetic_env_id,
        "env_class_name":    env_class_name,
        "task":              task_text,
        "init_config":       init_config,
        "checklist_with_func": checklist_with_func,
    }

    # Write synthetic task items to a temp file so base_env can load it
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as task_f:
        json.dump([synthetic_task_item], task_f, ensure_ascii=False)
        task_items_path = task_f.name

    # Write synthetic env items to a temp file
    env_items_dict = {synthetic_env_id: env_item}
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as env_f:
        json.dump(env_items_dict, env_f, ensure_ascii=False)
        env_items_path = env_f.name

    try:
        env = EnvScalerNonConvRLEnv(
            mode="eval",
            env_items_path=env_items_path,
            task_items_path=task_items_path,
        )
        agent = TaskSolveAgent(
            env_name="envscaler_non_conversation_rl",
            env=env,
            model=model,
            provider=model_provider,
            infer_mode=infer_mode,
            temperature=temperature,
            max_steps=max_steps,
            enable_thinking=enable_thinking,
            api_key=api_key,
            base_url=base_url,
            custom_headers=custom_headers,
        )
        result = agent.run(task_index=0)
        # Attach per-item checklist results stored by calculate_reward
        result["checklist_results"] = getattr(env, "last_checklist_results", [])
    finally:
        try:
            os.unlink(task_items_path)
        except OSError:
            pass
        try:
            os.unlink(env_items_path)
        except OSError:
            pass

    return result


# ── Public entry point ────────────────────────────────────────────────────────

def run_record(
    record: RecordInput,
    model: str,
    model_provider: str,
    infer_mode: str,
    enable_thinking: bool,
    max_steps: int = 30,
    temperature: float = 0.7,
    api_key: str | None = None,
    base_url: str | None = None,
    custom_headers: dict | None = None,
) -> RecordResult:
    """
    Full pipeline: raw task text → skel_builder → scen_generator → agent run → RecordResult.
    """
    start_ms = int(time.time() * 1000)

    try:
        # ── Stage 1-2: build env from raw task text ───────────────────────────
        env_item = _build_env_metadata(task_text=record.input, model=model, api_key=api_key, base_url=base_url)
        if env_item is None:
            return RecordResult(
                record_id=record.id,
                status="error",
                score=0.0,
                duration_ms=int(time.time() * 1000) - start_ms,
                error="Task filtered out by skel_builder Stage 1-1 (not a stateful query)",
            )

        # ── Stage 3: generate init_config ────────────────────────────────────
        init_config = _build_init_config(
            env_item=env_item, model=model, temperature=temperature, api_key=api_key, base_url=base_url
        )

        # ── Stage 4: generate check functions (use record.input as task) ─────
        checklist_with_func = _build_checklist_with_func(
            env_item=env_item,
            task_text=record.input,
            init_config=init_config,
            model=model,
            api_key=api_key,
            base_url=base_url
        )

        # ── Stage 5: run agent ────────────────────────────────────────────────
        raw = _run_agent(
            env_item=env_item,
            task_text=record.input,
            init_config=init_config,
            checklist_with_func=checklist_with_func,
            model=model,
            model_provider=model_provider,
            infer_mode=infer_mode,
            enable_thinking=enable_thinking,
            max_steps=max_steps,
            temperature=temperature,
            api_key=api_key,
            base_url=base_url,
            custom_headers=custom_headers,
        )

    except Exception as exc:
        duration_ms = int(time.time() * 1000) - start_ms
        return RecordResult(
            record_id=record.id,
            status="error",
            score=0.0,
            steps=0,
            duration_ms=duration_ms,
            error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        )

    duration_ms = int(time.time() * 1000) - start_ms

    total_reward: float = raw.get("total_reward", 0.0)
    steps: int          = raw.get("steps", 0)
    truncated: bool     = raw.get("truncated", False)
    trajectory: list    = raw.get("trajectory", [])

    raw_checklist = raw.get("checklist_results", [])
    checklist_results = [
        ChecklistResult(
            check_item=item.get("check_item", ""),
            passed=bool(item.get("check_func_result", {}).get("result")),
        )
        for item in raw_checklist
    ]

    return RecordResult(
        record_id=record.id,
        status="truncated" if truncated else "success",
        score=float(total_reward),
        steps=steps,
        duration_ms=duration_ms,
        trajectory=trajectory,
        checklist_results=checklist_results,
    )


def list_available_envs() -> list[str]:
    """Return list of pre-built env IDs (from interact_with_env)."""
    from run_main import env_cls_map
    return list(env_cls_map.keys())
