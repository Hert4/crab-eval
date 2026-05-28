# sidecar-bridge

FastAPI server kết nối crab-eval với EnvScaler pipeline. Nhận batch records từ frontend, build môi trường đánh giá, sinh checklist, chạy target LLM, trả kết quả qua SSE streaming.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # điền OPENAI_API_KEY
uvicorn server:app --port 8000 --reload
```

Yêu cầu Python ≥ 3.10. Server bind `127.0.0.1:8000`, CORS chỉ cho `localhost:3000`.

## Endpoints

- `GET  /envscaler/health` — health check
- `GET  /envscaler/envs` — list prebuilt envs có sẵn
- `POST /envscaler/run` — chạy evaluation, trả về SSE stream

Schema xem `server_models.py`.

## Pipeline

```
records → cluster → [Stage 1+2] build env class
                  → [Stage 3+4] build init_config + checklist  (per env)
                  → [Stage 5]   run agent                       (per env)
```

**Stage 1+2 là per-cluster** — nhiều records có input tương tự sẽ share cùng 1 env class.  
**Stage 3+4+5 là per-env** — mỗi env có 1 checklist và 1 lượt agent chạy.

Sau khi build xong env, các records riêng lẻ không còn được theo dõi — kết quả trả về theo env.

## SSE Events

| Event | Payload | Ý nghĩa |
|---|---|---|
| `stage1_start` | `{total}` | Bắt đầu build env descriptions |
| `stage1_done` | `{ok, error?}` | 1 env description xong |
| `stage2_start` | `{total_reps}` | Bắt đầu gen env class code |
| `stage2_done` | `{ok, error?}` | 1 env class xong |
| `task_build_start` | `{total}` | Bắt đầu gen init_config + checklist |
| `task_build_done` | `{env_class_name, ok, error?}` | 1 env task xong |
| `env_done` | `{env_class_name, result: RecordResult}` | 1 env agent chạy xong |
| `complete` | `RunResponse` | Toàn bộ batch xong |
| `error` | `{message}` | Lỗi không thể recover |

## Cache

Tất cả cache nằm trong `../envs/`:

```
envs/
  env_cache/         Stage 1+2 — key: SHA-256 của env summary text
  env_items/         Env item JSON đầy đủ (input cho Stage 5)
  task_cache/        Stage 3+4 — init_config + checklist; invalidate khi env_class_code thay đổi
  traj_cache/
    {model}/
      {run_id}/
        {env_class_name}.traj.json   Stage 5 — write-once
```

Xóa file tương ứng để force regenerate. Traj cache là write-once — muốn chạy lại agent thì xóa thủ công.

## Status

`RecordResult.status`:
- `success` — chạy xong, có checklist kết quả
- `truncated` — đạt `max_steps`
- `error` — build env hoặc agent crash; field `error` có prefix `[stage1]` / `[stage1_or_stage2]` / `[stage3_or_stage4]` / `[stage5]`

HTTP 200 cho mọi response hợp lệ (kể cả `status="partial"`), 422 nếu `records` rỗng.

## Prebuilt envs

Set `ENVSCALER_PREBUILT_ENV=<env_id>` để bypass Stage 1+2 hoàn toàn. Env class được đọc từ `EnvScaler/prebuilt_envs/`, toàn bộ records trong batch dùng chung 1 env class này.

## Test

```bash
python -m pytest test_server.py -v
```

17 tests, toàn mock LLM — không cần API key.
