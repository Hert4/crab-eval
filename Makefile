# ─── crab-eval × envscaler-sidecar dev targets ──────────────────────────────
# Yêu cầu: node >= 20, python >= 3.10, npm, pip
#
# Lệnh hay dùng:
#   make install   — install deps cả 2 phía
#   make dev       — chạy frontend (3000) + sidecar (8000) cùng lúc
#   make test      — chạy sidecar tests
#   make clean     — xoá __pycache__ + .next

.PHONY: install install-frontend install-sidecar dev dev-frontend dev-sidecar test clean help

help:
	@echo "Targets:"
	@echo "  install        - install all deps (npm + pip)"
	@echo "  dev            - run frontend + sidecar concurrently"
	@echo "  dev-frontend   - run only crab-eval Next.js dev server (port 3000)"
	@echo "  dev-sidecar    - run only sidecar FastAPI server (port 8000)"
	@echo "  test           - run sidecar pytest suite"
	@echo "  clean          - remove __pycache__ + .next build artifacts"

install: install-frontend install-sidecar

install-frontend:
	cd crab-eval && npm install

install-sidecar:
	cd sidecar-bridge && pip install -r requirements.txt

# Chạy concurrent: trap để Ctrl+C kill cả 2.
# Frontend log prefix [WEB], sidecar log prefix [API].
dev:
	@echo "Starting crab-eval (3000) + sidecar (8000). Ctrl+C để dừng cả hai."
	@trap 'kill 0' INT; \
		(cd crab-eval && npm run dev 2>&1 | sed 's/^/[WEB] /') & \
		(cd sidecar-bridge && uvicorn server:app --port 8000 --reload 2>&1 | sed 's/^/[API] /') & \
		wait

dev-frontend:
	cd crab-eval && npm run dev

dev-sidecar:
	cd sidecar-bridge && uvicorn server:app --port 8000 --reload

test:
	cd sidecar-bridge && python -m pytest test_server.py -v

clean:
	find . -type d -name __pycache__ -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .next -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
	@echo "Cleaned __pycache__ + .next"
