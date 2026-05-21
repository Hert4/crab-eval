# crab-eval × EnvScaler

Repo gồm 3 phần:

- `crab-eval/` — Next.js frontend, port 3000
- `sidecar-bridge/` — FastAPI gọi EnvScaler pipeline, port 8000
- `EnvScaler/` — vendor từ RUC-NLPIR/EnvScaler

## Chạy

Cần Node ≥ 20 và Python ≥ 3.10.

```bash
make install
cp crab-eval/.env.example      crab-eval/.env.local
cp sidecar-bridge/.env.example sidecar-bridge/.env
# điền API key vào 2 file vừa copy
make dev
```

Mở http://localhost:3000.

## Make targets

`make dev` chạy cả 2 server. `make dev-frontend` / `make dev-sidecar` chạy lẻ. `make test` chạy pytest sidecar. `make clean` xoá cache.

## Doc khác

- `crab-eval/README.md` — frontend features
- `sidecar-bridge/README.md` — REST API contract
- `sidecar-bridge/TEST_GUIDE.md` — test suite
