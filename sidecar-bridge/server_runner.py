"""
Wraps EnvScaler's full pipeline (skel_builder → scen_generator → interact_with_env)
into callables that server.py uses.

Public API:
  build_envs_batch(records, ...)  → dict[record_id, env_item | None]
  run_record(record, env_item, ...)  → RecordResult
"""
import math
import os
import sys
import time
import json
import tempfile
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Path setup ────────────────────────────────────────────────────────────────
_BASE_DIR        = os.path.dirname(__file__)
_ENVSCALER_DIR   = os.path.join(_BASE_DIR, "..", "EnvScaler")
_ENVS_DIR        = os.path.join(_BASE_DIR, "..", "envs")
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
from stage2_syn_env.step4_infer_func_code                     import process_env_item_for_demo as _stage2_step4
from stage2_syn_env.step5_concat                              import process_env_item as _stage2_step5
from stage2_syn_env.step6_analysis_env_class_code             import process_env_item as _stage2_step6

# ── scen_generator imports ────────────────────────────────────────────────────
from step1_gen_env_config       import gen_init_config
from step3_gen_task_check_func  import process_single_task

# ── interact_with_env imports ─────────────────────────────────────────────────
from agent.task_solve_agent import TaskSolveAgent
from envscaler_env import EnvScalerNonConvRLEnv, EnvScalerConvRLEnv

from server_models import RecordInput, RecordResult, ChecklistResult


# ── Internal helpers ──────────────────────────────────────────────────────────

def _run_stage1(record: RecordInput, model: str, api_key: str | None, base_url: str | None) -> dict | None:
    """Stage 1-1 + 1-2 for a single record. Returns env_item with metrics or None if filtered."""
    judge = _stage1_step1(query=record.input, model=model, api_key=api_key, base_url=base_url)
    if not judge.get("judge_result"):
        return None
    env_item_raw = {"task": record.input, "task_from": "crab-eval"}
    return _stage1_step2(item=env_item_raw, model=model, api_key=api_key, base_url=base_url)


def _run_stage2(env_item: dict, model: str, api_key: str | None, base_url: str | None) -> dict:
    """Stage 2 (1-6): synthesise full env class from env description."""
    env_item = _stage2_step1(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step2(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step3(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    env_item = _stage2_step4(env_item=env_item, model=model, api_key=api_key, base_url=base_url)
    success, env_item = _stage2_step5(env_item=env_item)
    if not success:
        raise RuntimeError("skel_builder Stage 2-5 AST check failed")
    env_item = _stage2_step6(env_item=env_item)
    return env_item


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
) -> dict[str, dict | None]:
    """
    Run Stage 1 for all records in parallel, embed + cluster to deduplicate envs,
    then run Stage 2 only for cluster representatives.

    Returns {record_id: full_env_item | None}
      - None  → filtered out (not stateful or below metrics threshold)
      - dict  → ready-to-use env_item with env_class_code etc.
    Raises are caught per-record and stored as exceptions (caller checks isinstance).
    """
    import numpy as np

    os.makedirs(_ENVS_DIR, exist_ok=True)

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
            except Exception as exc:
                stage1_results[record.id] = exc

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
        return results

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
        return results

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
        # For each record find closest representative
        record_to_rep: dict[str, dict] = {}
        for i, (record, _) in enumerate(filtered_valid):
            dists = np.linalg.norm(rep_embeddings - embeddings[i], axis=1)
            record_to_rep[record.id] = representatives[int(np.argmin(dists))]
    else:
        # No clustering: every record is its own representative
        record_to_rep = {record.id: env_item for record, env_item in filtered_valid}
        representatives = list(record_to_rep.values())

    # ── Step 4: run Stage 2 for each unique representative ────────────────────
    # Key representatives by identity (id of dict object) to avoid duplicates
    unique_reps: dict[int, dict] = {id(rep): rep for rep in representatives}
    built_reps: dict[int, dict | Exception] = {}

    def _do_stage2(rep_id: int, rep: dict):
        return rep_id, _run_stage2(rep, generator_model, generator_api_key, generator_base_url)

    with ThreadPoolExecutor() as pool:
        futures2 = {pool.submit(_do_stage2, rep_id, rep): rep_id for rep_id, rep in unique_reps.items()}
        for fut in as_completed(futures2):
            rep_id = futures2[fut]
            try:
                rid, full_env = fut.result()
                built_reps[rid] = full_env
            except Exception as exc:
                built_reps[rep_id] = exc

    # ── Step 5: assign built env_item to each record ──────────────────────────
    for record, _ in filtered_valid:
        rep = record_to_rep[record.id]
        rep_id = id(rep)
        built = built_reps.get(rep_id)
        if isinstance(built, Exception):
            results[record.id] = built
        else:
            results[record.id] = built

    return results


# ── Public: run agent for a single record (Stage 3-5) ────────────────────────

def run_record(
    record: RecordInput,
    env_item: dict,
    model: str,
    model_provider: str,
    generator_model: str,
    generator_api_key: str | None = None,
    generator_base_url: str | None = None,
    infer_mode: str = "fc",
    enable_thinking: bool = False,
    max_steps: int = 30,
    temperature: float = 0.7,
    api_key: str | None = None,
    base_url: str | None = None,
    custom_headers: dict | None = None,
    conversation_mode: bool = True,
    user_model: str | None = None,
) -> RecordResult:
    """
    Given a pre-built env_item (from build_envs_batch), run:
      Stage 3: gen init_config
      Stage 4: gen checklist + check funcs
      Stage 5: run agent
    Results are cached to disk so re-runs skip stages 3-4.
    """
    start_ms = int(time.time() * 1000)
    failed_stage: str | None = None

    os.makedirs(_ENVS_DIR, exist_ok=True)
    cache_path = os.path.join(_ENVS_DIR, f"{record.id}.cache.json")

    try:
        if os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as f:
                cache = json.load(f)
            cached_env_item      = cache["env_item"]
            init_config          = cache["init_config"]
            checklist_with_func  = cache["checklist_with_func"]
        else:
            cached_env_item = env_item

            # ── Stage 3: generate init_config ─────────────────────────────────
            failed_stage = "stage3_init_config"
            init_config = _build_init_config(
                env_item=cached_env_item,
                model=generator_model,
                temperature=temperature,
                api_key=generator_api_key,
                base_url=generator_base_url,
            )

            # ── Stage 4: generate checklist + check funcs ──────────────────────
            failed_stage = "stage4_checklist"
            checklist_with_func = _build_checklist_with_func(
                env_item=cached_env_item,
                task_text=record.input,
                init_config=init_config,
                model=generator_model,
                api_key=generator_api_key,
                base_url=generator_base_url,
            )

            # ── Save cache ─────────────────────────────────────────────────────
            env_path = os.path.join(_ENVS_DIR, f"{record.id}.json")
            with open(env_path, "w", encoding="utf-8") as f:
                json.dump(cached_env_item, f, ensure_ascii=False, indent=2)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({
                    "env_item":           cached_env_item,
                    "init_config":        init_config,
                    "checklist_with_func": checklist_with_func,
                }, f, ensure_ascii=False, indent=2)

        # ── Stage 5: run agent ─────────────────────────────────────────────────
        failed_stage = "stage5_agent"
        raw = _run_agent(
            env_item=cached_env_item,
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
            conversation_mode=conversation_mode,
            user_model=user_model,
            generator_model=generator_model,
        )
        failed_stage = None

    except Exception as exc:
        return RecordResult(
            record_id=record.id,
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
    if not checklist_results and not checklist_with_func:
        empty_checklist_reason = "[stage4_checklist] LLM failed to generate checklist items after max retries"

    return RecordResult(
        record_id=record.id,
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
