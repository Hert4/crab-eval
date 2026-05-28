# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
make install

# Run both servers (frontend :3000 + sidecar :8000)
make dev

# Run only one side
make dev-frontend
make dev-sidecar

# Run sidecar tests (no API key needed — all mocked)
make test

# Run a single test
cd sidecar-bridge && python -m pytest test_server.py::test_health_endpoint -v

# Kill all running servers
make stop

# Clear __pycache__ + .next
make clean
```

First-time setup:
```bash
make install
cp crab-eval/.env.example crab-eval/.env.local
cp sidecar-bridge/.env.example sidecar-bridge/.env
# Fill in API keys in both files
```

## Architecture

Three components, each in its own directory:

```
crab-eval/       — Next.js 16 frontend (port 3000)
sidecar-bridge/  — FastAPI backend (port 8000)
EnvScaler/       — Vendored env generation + agent runner (RUC-NLPIR/EnvScaler)
```

### Request flow

```
crab-eval (browser)
  → POST /envscaler/run  (SSE streaming)
  → sidecar-bridge/server.py
  → build_envs_batch()   [Stage 1+2: gen env class per cluster]
  → run_record()         [Stage 3–5: gen init_config + checklist + run agent]
  ← SSE events: stage1_start/done, stage2_start/done, record_done, complete
```

### sidecar-bridge pipeline (`server_runner.py`)

The pipeline has 5 stages for each evaluation run:

| Stage | Function | What it does |
|---|---|---|
| 1 | `_run_stage1` | LLM judge + gen env description from `record.input` |
| 2 | `_run_stage2` | LLM gen full env class (Python code) from env description |
| 3 | `_build_init_config` | Gen initial state for the env |
| 4 | `_build_checklist_with_func` | Gen checklist + check functions for the task |
| 5 | `_run_agent` | Run the target LLM agent against the env |

**Stage 1+2 are per-cluster** — records with similar `record.input` share the same env class via embedding + KMeans clustering (`build_envs_batch`).  
**Stage 3+4 are per-record** — each task has its own `init_config` and `checklist_with_func`.  
**Stage 5 always re-runs** — agent is never cached.

### Cache layers (`envs/` directory)

- `env_cache/{sha256}.env.json` — Stage 1+2 cache, keyed by SHA-256 of env summary text
- `{record_id}.cache.json` — Stage 3+4 cache (init_config + checklist); invalidated when `env_class_code` hash changes
- `traj_cache/{record_id}.traj.json` — Stage 5 write-once trajectory

Delete specific files to force regeneration (see `envs/README.md` for exact mapping).

### Prebuilt envs

Set `ENVSCALER_PREBUILT_ENV=<env_id>` to bypass Stage 1+2 entirely. The env class is read from `EnvScaler/prebuilt_envs/` (hand-written Python), only step 6 (AST extract tools) runs. All records in the batch share the same env class.

### EnvScaler env lifecycle

When an agent runs, `EnvScalerBaseEnv` (`interact_with_env/envscaler_env/base_env.py`) drives the loop:
- `reset()` — loads `env_item` from JSON, `exec()`s the env class code, calls `init_env_instance(env_class, init_config)`
- `step()` — calls tool methods on the env instance, records `state_snapshot` + `state_diff` via `_record_step()`
- Reward is calculated at termination by running `checklist_with_func` against `pred_final_state`

### Frontend (`crab-eval/`)

Next.js App Router. The existing `crab-eval/CLAUDE.md` has full frontend documentation — read it for component details, design system (`--crab-*` CSS vars), store layout, and type definitions.

Key constraint: API keys are stored in `sessionStorage` only, never `localStorage` or Zustand persist. Access via `getApiKey(key)` / `setApiKey(key, value)` in `src/lib/openai.ts`.

### Tests

`sidecar-bridge/test_server.py` — 18 tests, all mocked (no real LLM calls, no EnvScaler install needed). Mocks `server.run_record` and stubs out EnvScaler modules at import time.

Pass threshold: `score >= 0.99` counts as passed in aggregate stats.
