# sidecar-bridge

FastAPI server gọi EnvScaler pipeline từ crab-eval. Mỗi record trong batch sẽ build env riêng (skel_builder Stage 1+2), sinh checklist (scen_generator), rồi cho target LLM giải (interact_with_env). Score = pass / total check.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # điền OPENAI_API_KEY
uvicorn server:app --port 8000 --reload
```

Yêu cầu Python ≥ 3.10. Server bind `127.0.0.1:8000`, CORS chỉ cho `localhost:3000`.

## Endpoints

- `GET  /envscaler/health` — health check
- `GET  /envscaler/envs` — list envs có sẵn
- `POST /envscaler/run` — chạy evaluation cho 1 batch

`RunRequest` / `RunResponse` schema xem `server_models.py`. Tóm tắt: gửi `records: [{id, input, tools, ...}]` + `model` + `api_key`, nhận về `results: [{record_id, score, trajectory, checklist_results}]`.

## Status code

`RecordResult.status`:
- `success` — chạy xong, có checklist
- `truncated` — reach `max_steps`
- `error` — build env fail hoặc agent crash; `error` field có prefix `[stage1]` / `[stage1_or_stage2]` / `[agent]`

HTTP: 200 cho mọi response hợp lệ (kể cả `status="partial"`), 422 nếu `records` rỗng.

## Test

```bash
python -m pytest test_server.py -v
```

18 tests dùng mock LLM, không cần API key. Chi tiết: `TEST_GUIDE.md`.

## Caveat

Build env runtime per-record → mỗi record tốn ~10-15 LLM call trước khi target chạy. Env không cache, không deterministic. Sync only, timeout 30 phút phía crab-eval.
