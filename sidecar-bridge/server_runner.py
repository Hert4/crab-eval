"""
Wraps EnvScaler's full pipeline (skel_builder → scen_generator → interact_with_env)
into callables that server.py uses.

Public API:
  build_envs_batch(records, ...)         → dict[record_id, env_item | None]
  build_task(record, env_item, ...)      → TaskItem   (Stage 3+4: init_config + checklist)
  run_agent_for_task(record, task, ...)  → RecordResult  (Stage 5: run agent)
"""
import datetime
import hashlib
import math
import os
import re
import sys
import time
import json
import tempfile
import traceback
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed

# Silence sklearn cosine-normalize warnings: divide-by-zero/overflow inside
# matmul when embedding vectors are near-zero — doesn't affect clustering
# correctness, just spams the log.
warnings.filterwarnings("ignore", category=RuntimeWarning, module="sklearn.utils.extmath")

# ── Path setup ────────────────────────────────────────────────────────────────
_BASE_DIR        = os.path.dirname(__file__)
_ENVSCALER_DIR   = os.path.join(_BASE_DIR, "..", "EnvScaler")
_ENVS_DIR        = os.path.join(_BASE_DIR, "..", "envs")
_ENV_CACHE_DIR   = os.path.join(_ENVS_DIR, "env_cache")
_ENV_ITEMS_DIR   = os.path.join(_ENVS_DIR, "env_items")   # {env_class_name}.json
_TASK_CACHE_DIR  = os.path.join(_ENVS_DIR, "task_cache")  # {env_class_name}.cache.json
_TRAJ_CACHE_DIR  = os.path.join(_ENVS_DIR, "traj_cache")
_SKEL_DIR        = os.path.join(_ENVSCALER_DIR, "skel_builder")
_SCEN_DIR        = os.path.join(_ENVSCALER_DIR, "scen_generator")
_INTERACT_DIR    = os.path.join(_ENVSCALER_DIR, "interact_with_env")

for _p in (_SKEL_DIR, _SCEN_DIR, _INTERACT_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── skel_builder imports ──────────────────────────────────────────────────────
from stage1_collect_env_from_task.step1_judge_stateful_query  import process_query as _stage1_step1
from stage1_collect_env_from_task.step2_infer_env_topic        import process_item  as _stage1_step2
from stage1_collect_env_from_task.step3_optional_get_embedding import add_embeddings_to_samples as _stage1_step3_embed
from stage1_collect_env_from_task.step3_optional_select_env    import (
    filter_environments      as _stage1_step3_filter,
    cluster_deduplicate      as _stage1_step3_cluster,
)
from stage2_syn_env.step1_infer_state                         import process_env_item as _stage2_step1
from stage2_syn_env.step2_infer_state_code                    import process_env_item as _stage2_step2
from stage2_syn_env.step3_infer_operation                     import process_env_item as _stage2_step3
from stage2_syn_env.step4_infer_func_code                     import construct_messages as _step4_msgs, llm_infer as _step4_llm
from stage2_syn_env.step5_concat                              import process_env_item as _stage2_step5
from stage2_syn_env.step6_analysis_env_class_code             import process_env_item as _stage2_step6

_STEP4_MAX_WORKERS = int(os.environ.get("ENVSCALER_STEP4_WORKERS", "8"))


def _stage2_step4(env_item: dict, model: str, api_key: str | None = None, base_url: str | None = None) -> dict:
    """Parallel replacement for EnvScaler's per-demo step4 loop.

    Upstream `process_env_item_for_demo` chạy tuần tự + print verbose mỗi op.
    Với env có 20+ operations, đây là bottleneck lớn nhất của Stage 2.
    """
    from copy import deepcopy
    new_env_item = deepcopy(env_item)
    operation_items = deepcopy(env_item["operation_list"])

    def _one(i: int):
        msgs = _step4_msgs(env_item, operation_items[i])
        return i, _step4_llm(msgs, model, api_key=api_key, base_url=base_url)

    with ThreadPoolExecutor(max_workers=_STEP4_MAX_WORKERS) as ex:
        for i, code in ex.map(_one, range(len(operation_items))):
            operation_items[i]["code"] = code

    new_env_item["operation_list"] = operation_items
    return new_env_item

# ── scen_generator imports ────────────────────────────────────────────────────
from step1_gen_env_config       import gen_init_config
from step3_gen_task_check_func  import process_single_task

# ── interact_with_env imports ─────────────────────────────────────────────────
from agent.task_solve_agent import TaskSolveAgent
from envscaler_env import EnvScalerNonConvRLEnv, EnvScalerConvRLEnv

from dataclasses import dataclass, field

from server_models import RecordInput, RecordResult, ChecklistResult


@dataclass
class TaskItem:
    """Holds everything needed to run Stage 5 for one env."""
    env_class_name: str          # identifies the env, used as traj key
    env_item: dict
    init_config: dict
    checklist_with_func: list
    task_text: str               # env_summary_and_introduction
    model: str = ""              # target model — used to partition traj_cache
    run_id: str = ""             # run identifier — subfolder inside model dir


# ── Internal helpers ──────────────────────────────────────────────────────────

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_env_cache(cache_key: str) -> dict | None:
    path = os.path.join(_ENV_CACHE_DIR, f"{cache_key}.env.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("env_item")
    except Exception:
        return None


def _write_env_cache(cache_key: str, env_item: dict) -> None:
    os.makedirs(_ENV_CACHE_DIR, exist_ok=True)
    payload = {
        "cache_key": cache_key,
        "cached_at": datetime.datetime.utcnow().isoformat() + "Z",
        "env_item": {k: v for k, v in env_item.items()
                     if k != "env_summary_and_introduction_embedding"},
    }
    with open(os.path.join(_ENV_CACHE_DIR, f"{cache_key}.env.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _write_traj_cache(
    record_id: str,
    score: float,
    steps: int,
    checklist_results: list,
    agent_trajectory: list,
    env_trajectory: list,
    model: str = "",
    run_id: str = "",
) -> None:
    # traj_cache/{model_slug}/{run_id}/{env_class_name}.traj.json
    model_slug = re.sub(r"[^a-zA-Z0-9_\-.]", "_", model) if model else "unknown_model"
    run_slug   = re.sub(r"[^a-zA-Z0-9_\-.]", "_", run_id)  if run_id  else "unknown_run"
    traj_dir = os.path.join(_TRAJ_CACHE_DIR, model_slug, run_slug)
    os.makedirs(traj_dir, exist_ok=True)
    path = os.path.join(traj_dir, f"{record_id}.traj.json")
    if os.path.exists(path):
        return  # write-once: xóa file thủ công để force re-run

    # Merge agent-level + env-level trajectory theo step
    # Dùng step-index nếu step numbers unique, else positional
    env_steps_unique = (
        len(env_trajectory) > 0
        and len({s["step"] for s in env_trajectory}) == len(env_trajectory)
    )
    env_by_step = (
        {s["step"]: s for s in env_trajectory} if env_steps_unique else None
    )

    merged = []
    for idx, agent_step in enumerate(agent_trajectory):
        step_num = agent_step["step"]
        env_step = (
            env_by_step.get(step_num, {}) if env_by_step is not None
            else (env_trajectory[idx] if idx < len(env_trajectory) else {})
        )
        rec: dict = {"step": step_num}
        for k in ("action", "observation", "reward", "terminated", "truncated"):
            if k in agent_step:
                rec[k] = agent_step[k]
        for k in ("state_snapshot", "state_diff", "tool_error"):
            if k in env_step:
                rec[k] = env_step[k]
        merged.append(rec)

    payload = {
        "record_id": record_id,
        "saved_at": datetime.datetime.utcnow().isoformat() + "Z",
        "score": score,
        "steps": steps,
        "checklist_results": checklist_results,
        "trajectory": merged,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


_REQUIRE_STATEFUL_JUDGE = os.environ.get("ENVSCALER_REQUIRE_STATEFUL", "0") == "1"
_PREBUILT_ENV_ID       = os.environ.get("ENVSCALER_PREBUILT_ENV") or None


def _load_prebuilt_env(env_id: str) -> dict:
    """
    Load a hand-written env class and run only step6 (AST extract) to
    populate env_func_details / env_structure / tools. Skips step1-5
    (LLM-generated state code + ops code).
    """
    sys.path.insert(0, _BASE_DIR)
    from prebuilt_envs import PREBUILT_ENVS
    if env_id not in PREBUILT_ENVS:
        raise ValueError(f"Unknown prebuilt env: {env_id}. Available: {list(PREBUILT_ENVS)}")
    meta = PREBUILT_ENVS[env_id]
    env_class_code = meta["file"].read_text(encoding="utf-8")
    env_item = {
        "environment_summary":      meta["summary"],
        "environment_introduction": meta["introduction"],
        "env_class_code":           env_class_code,
    }
    return _stage2_step6(env_item=env_item)


def _read_stage1_cache(cache_key: str) -> dict | None:
    path = os.path.join(_ENV_CACHE_DIR, f"s1_{cache_key}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            return data.get("env_item")
    except Exception:
        return None


def _write_stage1_cache(cache_key: str, env_item: dict | None) -> None:
    os.makedirs(_ENV_CACHE_DIR, exist_ok=True)
    payload = {
        "cache_key": cache_key,
        "cached_at": datetime.datetime.utcnow().isoformat() + "Z",
        "env_item": env_item,
    }
    with open(os.path.join(_ENV_CACHE_DIR, f"s1_{cache_key}.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _run_stage1(record: RecordInput, model: str, api_key: str | None, base_url: str | None) -> dict | None:
    """
    Stage 1-1 + 1-2 for a single record. Returns env_item with metrics or None if filtered.
    Cached by SHA-256 of record.input — same input always produces the same env description,
    so env class is shared across model evaluations.

    By default the step1 LLM judge is BYPASSED — it's unreliable on borderline
    state-dependent tasks (composing content for filtered subsets) and just
    burns LLM calls. Stage 2 will fail naturally if env can't be built.
    Set env var ENVSCALER_REQUIRE_STATEFUL=1 to re-enable the gate.
    """
    cache_key = _sha256(record.input)
    cached = _read_stage1_cache(cache_key)
    if cached is not None:
        return cached

    if _REQUIRE_STATEFUL_JUDGE:
        judge = _stage1_step1(query=record.input, model=model, api_key=api_key, base_url=base_url)
        if not judge.get("judge_result"):
            _write_stage1_cache(cache_key, None)
            return None
    env_item_raw = {"task": record.input, "task_from": "crab-eval"}
    result = _stage1_step2(item=env_item_raw, model=model, api_key=api_key, base_url=base_url)
    _write_stage1_cache(cache_key, result)
    return result


def _run_stage2(env_item: dict, model: str, api_key: str | None, base_url: str | None) -> dict:
    """
    Stage 2 (1-6): synthesise full env class from env description.

    LLM-generated method code occasionally has bad syntax; one bad method
    is filtered in step5, but if class_def itself (step2) is broken, the
    whole assembly fails. Retry step1-5 up to MAX_TRIES times — each LLM
    pass is non-deterministic and usually recovers.
    """
    from copy import deepcopy
    original = deepcopy(env_item)
    MAX_TRIES = 3
    last_err: Exception | None = None
    for attempt in range(MAX_TRIES):
        try:
            item = original if attempt == 0 else deepcopy(original)
            item = _stage2_step1(env_item=item, model=model, api_key=api_key, base_url=base_url)
            item = _stage2_step2(env_item=item, model=model, api_key=api_key, base_url=base_url)
            item = _stage2_step3(env_item=item, model=model, api_key=api_key, base_url=base_url)
            item = _stage2_step4(env_item=item, model=model, api_key=api_key, base_url=base_url)
            success, item = _stage2_step5(env_item=item)
            if not success:
                raise RuntimeError("skel_builder Stage 2-5 AST check failed")
            return _stage2_step6(env_item=item)
        except Exception as e:
            last_err = e
            if attempt < MAX_TRIES - 1:
                print(f"⚠ Stage 2 attempt {attempt+1}/{MAX_TRIES} failed: {type(e).__name__}: {e}. Retrying...")
                continue
            raise
    raise last_err if last_err else RuntimeError("Stage 2 exhausted retries")


def _build_init_config(env_item: dict, model: str, temperature: float, api_key: str | None = None, base_url: str | None = None) -> dict:
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
        base_url=base_url,
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
    base_url: str | None = None,
) -> list:
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
    conversation_mode: bool = False,
    user_model: str | None = None,
    generator_model: str | None = None,
) -> dict:
    synthetic_env_id = env_item.get("env_id", "dynamic_env")
    env_class_name   = env_item["env_class_name"]

    synthetic_task_item = {
        "task_id":             0,
        "env_id":              synthetic_env_id,
        "env_class_name":      env_class_name,
        "task":                task_text,
        "init_config":         init_config,
        "checklist_with_func": checklist_with_func,
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tf:
        json.dump([synthetic_task_item], tf, ensure_ascii=False)
        task_items_path = tf.name

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as ef:
        json.dump({synthetic_env_id: env_item}, ef, ensure_ascii=False)
        env_items_path = ef.name

    try:
        if conversation_mode:
            env_name = "envscaler_conversation_rl"
            env = EnvScalerConvRLEnv(
                mode="eval",
                user_model=user_model or generator_model or model,
                provider=model_provider,
                env_items_path=env_items_path,
                task_items_path=task_items_path,
                api_key=api_key,
                base_url=base_url,
            )
        else:
            env_name = "envscaler_non_conversation_rl"
            env = EnvScalerNonConvRLEnv(
                mode="eval",
                env_items_path=env_items_path,
                task_items_path=task_items_path,
            )
        agent = TaskSolveAgent(
            env_name=env_name,
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
        result["env_trajectory"] = getattr(env, "trajectory", [])
        result["checklist_results"] = getattr(env, "last_checklist_results", [])
    finally:
        for p in (task_items_path, env_items_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    return result


# ── Public: batch env builder (Stage 1 + clustering + Stage 2) ───────────────

def build_envs_batch(
    records: list[RecordInput],
    generator_model: str,
    generator_api_key: str | None = None,
    generator_base_url: str | None = None,
    embedding_model: str = "text-embedding-3-small",
    n_clusters: int | None = None,
    progress_cb=None,
) -> tuple[dict[str, dict | None], dict[str, str]]:
    """
    Run Stage 1 for all records in parallel, embed + cluster to deduplicate envs,
    then run Stage 2 only for cluster representatives.

    Returns (env_items, task_texts):
      env_items  — {record_id: full_env_item | None | Exception}
        - None      → filtered out (not stateful or below metrics threshold)
        - Exception → stage1/2 error
        - dict      → ready-to-use env_item with env_class_code etc.
      task_texts — {env_class_name: record.input of the representative record}
        The original user input used to build that env — used as task text for the agent.
    """
    import numpy as np

    def _emit(event: str, payload: dict) -> None:
        if progress_cb is not None:
            try:
                progress_cb(event, payload)
            except Exception:
                pass

    os.makedirs(_ENVS_DIR, exist_ok=True)

    # Fast path: use a prebuilt hand-written env class for every record.
    # Bypasses Stage 1+2 LLM code generation entirely.
    if _PREBUILT_ENV_ID:
        _emit("stage1_start", {"total": len(records), "prebuilt": _PREBUILT_ENV_ID})
        try:
            prebuilt = _load_prebuilt_env(_PREBUILT_ENV_ID)
        except Exception as exc:
            return {r.id: exc for r in records}, {}
        _emit("stage2_start", {"total_reps": 1, "total_records": len(records)})
        results: dict[str, dict | None | Exception] = {r.id: prebuilt for r in records}
        for r in records:
            _emit("stage1_done", {"record_id": r.id, "ok": True})
        _emit("stage2_done", {"rep_id": 0, "ok": True})
        env_class_name = prebuilt.get("env_class_name", _PREBUILT_ENV_ID)
        task_texts: dict[str, str] = {env_class_name: records[0].input if records else ""}
        return results, task_texts

    _emit("stage1_start", {"total": len(records)})

    # ── Step 1: Stage 1-1 + 1-2 for all records (parallel) ───────────────────
    stage1_results: dict[str, dict | None | Exception] = {}

    def _do_stage1(record: RecordInput):
        return record.id, _run_stage1(record, generator_model, generator_api_key, generator_base_url)

    with ThreadPoolExecutor() as pool:
        futures = {pool.submit(_do_stage1, r): r for r in records}
        for fut in as_completed(futures):
            record = futures[fut]
            try:
                rid, env_item = fut.result()
                stage1_results[rid] = env_item
                _emit("stage1_done", {"record_id": rid, "ok": env_item is not None})
            except Exception as exc:
                stage1_results[record.id] = exc
                _emit("stage1_done", {"record_id": record.id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})

    # Partition: valid (passed stage1) vs filtered/errored
    valid: list[tuple[RecordInput, dict]] = []   # (record, stage1_env_item)
    results: dict[str, dict | None | Exception] = {}

    for record in records:
        res = stage1_results[record.id]
        if isinstance(res, Exception) or res is None:
            results[record.id] = res   # None = filtered, Exception = error
        else:
            valid.append((record, res))

    if not valid:
        return results, {}

    # ── Step 2: build embedding field + get embeddings for all valid envs ─────
    for _, env_item in valid:
        env_item["env_summary_and_introduction"] = (
            f"**{env_item.get('environment_summary', '')}**: {env_item.get('environment_introduction', '')}"
        )

    try:
        embedded = _stage1_step3_embed(
            samples=[env_item for _, env_item in valid],
            field="env_summary_and_introduction",
            model=embedding_model,
            timeout=60,
            api_key=generator_api_key,
            base_url=generator_base_url,
        )
        for i, (record, _) in enumerate(valid):
            valid[i] = (record, embedded[i])
        has_embeddings = True
    except Exception:
        has_embeddings = False

    # ── Step 3: filter by metrics, then cluster-deduplicate ───────────────────
    # Filter first
    filtered_valid: list[tuple[RecordInput, dict]] = []
    for record, env_item in valid:
        if _stage1_step3_filter([env_item]):
            filtered_valid.append((record, env_item))
        else:
            results[record.id] = None  # below metrics threshold

    if not filtered_valid:
        return results, {}

    # Cluster to find representatives
    n = len(filtered_valid)
    if has_embeddings and n > 1:
        k = n_clusters if n_clusters is not None else max(1, int(math.sqrt(n)))
        k = min(k, n)
        env_items_list = [env_item for _, env_item in filtered_valid]
        representatives = _stage1_step3_cluster(
            items=env_items_list,
            embedding_field="env_summary_and_introduction_embedding",
            n_clusters=k,
        )
        # Map each record to its representative via nearest embedding
        embeddings = np.array([
            env_item["env_summary_and_introduction_embedding"]
            for _, env_item in filtered_valid
        ])
        rep_embeddings = np.array([
            rep["env_summary_and_introduction_embedding"]
            for rep in representatives
        ])
        # For each record find closest representative; also track which record IS the rep
        rep_id_to_record: dict[int, RecordInput] = {}
        record_to_rep: dict[str, dict] = {}
        for i, (record, _) in enumerate(filtered_valid):
            dists = np.linalg.norm(rep_embeddings - embeddings[i], axis=1)
            closest_rep_idx = int(np.argmin(dists))
            rep = representatives[closest_rep_idx]
            record_to_rep[record.id] = rep
            # First record mapped to this rep becomes its "owner" for task_text
            rep_obj_id = id(rep)
            if rep_obj_id not in rep_id_to_record:
                rep_id_to_record[rep_obj_id] = record
    else:
        # No clustering: every record is its own representative
        record_to_rep = {record.id: env_item for record, env_item in filtered_valid}
        representatives = list(record_to_rep.values())
        rep_id_to_record = {id(env_item): record for record, env_item in filtered_valid}

    # ── Step 4: run Stage 2 for each unique representative ────────────────────
    # Key representatives by identity (id of dict object) to avoid duplicates
    unique_reps: dict[int, dict] = {id(rep): rep for rep in representatives}
    built_reps: dict[int, dict | Exception] = {}

    _emit("stage2_start", {"total_reps": len(unique_reps), "total_records": len(filtered_valid)})

    def _do_stage2(rep_id: int, rep: dict):
        cache_key = _sha256(rep.get("task", ""))
        cached = _read_env_cache(cache_key)
        if cached is not None:
            return rep_id, cached
        full_env = _run_stage2(rep, generator_model, generator_api_key, generator_base_url)
        _write_env_cache(cache_key, full_env)
        return rep_id, full_env

    with ThreadPoolExecutor() as pool:
        futures2 = {pool.submit(_do_stage2, rep_id, rep): rep_id for rep_id, rep in unique_reps.items()}
        for fut in as_completed(futures2):
            rep_id = futures2[fut]
            try:
                rid, full_env = fut.result()
                built_reps[rid] = full_env
                _emit("stage2_done", {"rep_id": rid, "ok": True})
            except Exception as exc:
                built_reps[rep_id] = exc
                _emit("stage2_done", {"rep_id": rep_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})

    # ── Step 5: assign built env_item to each record; collect task_texts ──────
    task_texts: dict[str, str] = {}
    for record, _ in filtered_valid:
        rep = record_to_rep[record.id]
        rep_id = id(rep)
        built = built_reps.get(rep_id)
        if isinstance(built, Exception):
            results[record.id] = built
        else:
            results[record.id] = built
            # task_text = input of the representative record that produced this env
            env_class_name = built.get("env_class_name") if isinstance(built, dict) else None
            if env_class_name and env_class_name not in task_texts:
                owner_record = rep_id_to_record.get(rep_id)
                task_texts[env_class_name] = owner_record.input if owner_record else ""

    return results, task_texts


# ── Public: run agent for a single record (Stage 3-5) ────────────────────────

def build_task(
    env_item: dict,
    task_text: str,
    generator_model: str,
    generator_api_key: str | None = None,
    generator_base_url: str | None = None,
    temperature: float = 0.7,
    model: str = "",
    run_id: str = "",
) -> TaskItem:
    """
    Stage 3+4: generate init_config and checklist for one env.
    Cache key is env_class_name — all records that share an env share this cache.
    task_text is the original record.input used as the agent's task.
    Raises on failure so the caller can convert to an error result.
    """
    os.makedirs(_ENV_ITEMS_DIR, exist_ok=True)
    os.makedirs(_TASK_CACHE_DIR, exist_ok=True)
    env_class_name = env_item.get("env_class_name", "unknown_env")
    cache_path = os.path.join(_TASK_CACHE_DIR, f"{env_class_name}.cache.json")

    cache_valid = False
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
        cached_hash  = cache.get("env_item", {}).get("env_class_code_hash")
        current_hash = _sha256(env_item.get("env_class_code", ""))
        cached_task  = cache.get("task_text", "")
        if cached_hash and cached_hash == current_hash and cached_task == task_text:
            cache_valid = True

    if cache_valid:
        cached_env_item     = cache["env_item"]
        init_config         = cache["init_config"]
        checklist_with_func = cache["checklist_with_func"]
    else:
        cached_env_item = env_item

        init_config = _build_init_config(
            env_item=cached_env_item,
            model=generator_model,
            temperature=temperature,
            api_key=generator_api_key,
            base_url=generator_base_url,
        )

        checklist_with_func = _build_checklist_with_func(
            env_item=cached_env_item,
            task_text=task_text,
            init_config=init_config,
            model=generator_model,
            api_key=generator_api_key,
            base_url=generator_base_url,
        )

        env_path = os.path.join(_ENV_ITEMS_DIR, f"{env_class_name}.json")
        with open(env_path, "w", encoding="utf-8") as f:
            json.dump(cached_env_item, f, ensure_ascii=False, indent=2)
        cached_env_item["env_class_code_hash"] = _sha256(cached_env_item.get("env_class_code", ""))
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({
                "env_item":            cached_env_item,
                "init_config":         init_config,
                "checklist_with_func": checklist_with_func,
                "task_text":           task_text,
            }, f, ensure_ascii=False, indent=2)

    return TaskItem(
        env_class_name=env_class_name,
        env_item=cached_env_item,
        init_config=init_config,
        checklist_with_func=checklist_with_func,
        task_text=task_text,
        model=model,
        run_id=run_id,
    )


def run_agent_for_task(
    task: TaskItem,
    model: str,
    model_provider: str,
    infer_mode: str = "fc",
    enable_thinking: bool = False,
    max_steps: int = 30,
    temperature: float = 0.7,
    api_key: str | None = None,
    base_url: str | None = None,
    custom_headers: dict | None = None,
    conversation_mode: bool = True,
    user_model: str | None = None,
    generator_model: str | None = None,
) -> RecordResult:
    """
    Stage 5: run agent against a pre-built TaskItem.
    Writes trajectory cache after completion (write-once).
    """
    start_ms = int(time.time() * 1000)
    failed_stage: str | None = None

    try:
        failed_stage = "stage5_agent"
        raw = _run_agent(
            env_item=task.env_item,
            task_text=task.task_text,
            init_config=task.init_config,
            checklist_with_func=task.checklist_with_func,
            model=model,
            model_provider=model_provider,
            infer_mode=infer_mode,
            enable_thinking=enable_thinking,
            max_steps=max_steps,
            temperature=temperature,
            api_key=api_key,
            base_url=base_url,
            custom_headers=custom_headers,
            conversation_mode=conversation_mode,
            user_model=user_model,
            generator_model=generator_model,
        )
        failed_stage = None

        try:
            _write_traj_cache(
                record_id=task.env_class_name,
                score=float(raw.get("total_reward", 0.0)),
                steps=int(raw.get("steps", 0)),
                checklist_results=raw.get("checklist_results", []),
                agent_trajectory=raw.get("trajectory", []),
                env_trajectory=raw.get("env_trajectory", []),
                model=task.model,
                run_id=task.run_id,
            )
        except Exception:
            pass

    except Exception as exc:
        return RecordResult(
            record_id=task.env_class_name,
            status="error",
            score=0.0,
            steps=0,
            duration_ms=int(time.time() * 1000) - start_ms,
            error=f"[{failed_stage}] {type(exc).__name__}: {exc}\n{traceback.format_exc()}",
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

    empty_checklist_reason: str | None = None
    if not checklist_results and not task.checklist_with_func:
        empty_checklist_reason = "[stage4_checklist] LLM failed to generate checklist items after max retries"

    return RecordResult(
        record_id=task.env_class_name,
        status="truncated" if truncated else "success",
        score=float(total_reward),
        steps=steps,
        duration_ms=duration_ms,
        trajectory=trajectory,
        checklist_results=checklist_results,
        error=empty_checklist_reason,
    )


def list_available_envs() -> list[str]:
    """Return list of pre-built env IDs (from interact_with_env)."""
    from run_main import env_cls_map
    return list(env_cls_map.keys())
