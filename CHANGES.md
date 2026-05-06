# CHANGELOG — Crab Eval

> Tài liệu này ghi lại các change đáng nhớ. Chi tiết kiến trúc xem `CLAUDE.md`.

---

## 2026-05-06 — Audit fix pass

Một loạt sửa chữa sau code audit. `npx tsc --noEmit` → **0 errors**.

### Security
- **API key giờ thật sự dùng `sessionStorage`** (xóa khi đóng tab) — trước đó code dùng `localStorage` ngược với doc. Nếu bạn đang upgrade từ build cũ, các key cũ trong `localStorage` không tự xóa nhưng cũng không còn được đọc; có thể clear thủ công ở DevTools.
- **`assertLocalRequest()`** (`src/lib/serverGuard.ts`): các route ghi đĩa (`POST/DELETE /api/results`, `POST /api/task-generator`) chặn non-loopback request khi `NODE_ENV === 'production'`. Dev mode no-op để workflow local không thay đổi.
- Xóa agent giờ gọi `removeApiKey(agent.apiKeyName)` cleanup sessionStorage.

### Eval correctness
- **`passFailJudgeScore` math fix**: judge trả thừa item không còn skew score. `passFailToScore(results, expectedCount)` slice đến `expectedCount` — extras ignore, missing đếm fail. `criteriaJudgeScore` dùng cùng logic.
- **`parseJudgeScore` robust**: ưu tiên `<score>N</score>` / `Score: N` / `Rating: N` tags, fallback **số CUỐI** trong text. Sửa bug "Out of 10 → 10" khi judge có preamble. Mọi judge prompt đã thêm `"Respond with ONLY a single integer on its own line"`.
- **Global judge semaphore**: `_judgeAcquire` cap tổng judge call song song = `max(2, concurrency * 2)` thay vì fan-out `(N × concurrency × 8 metrics)`.

### Storage
- **Per-run filename**: `POST /api/results` ghi `results/<model>/<task>.<runId>.json` thay vì `<task>.json` → rerun cùng task không đè lịch sử. GET dedupe theo runId field nên backward-compat với file format cũ.
- **`resultsStore` quota recovery loop**: drop oldest runs đến khi vừa thay vì retry 1 lần rồi give up.

### Language-agnostic metrics
- **`accuracy()`** không còn nhúng VN keywords. Hỗ trợ override qua `record.metadata.{unknown_label, unknown_synonyms, valid_label_range}`.
- **`refusalAccuracy()`** đọc `metadata.refusal_phrases`; default fallback chỉ English.
- **`tokenize()`** dùng `Intl.Segmenter` khi có (CJK / từ-ghép tiếng Việt) → fallback whitespace.

### Compat / wrapper
- **`chat_template_kwargs.enable_thinking=false`** giờ auto-retry: nếu API 400 vì field này (OpenAI/Anthropic gateway), retry không gửi. Cùng nhánh retry với `max_tokens` vs `max_completion_tokens`.

### Cleanup
- Xóa dead code visual-eval ở `api/results/route.ts` (`simResultToRunResult`, `simId`, `finalScore` branches). Visual Eval feature đã bị gỡ khỏi codebase từ trước.
- Rewrite `CLAUDE.md` khớp code thực tế: bỏ Milestone 1/2/3, Frozen Oracle, Multi-Judge, τ-bench Phase 2 (đều không tồn tại). Cập nhật 6 task types thực, sessionStorage flow, judge global semaphore, per-run filename.
- `tsconfig.json` exclude `.next/dev` — fix 2 stray `.next/dev/types/validator.ts` errors.

---

## 2026-04-01 — UI/UX redesign + LangSmith-inspired features

### Layout — "full-viewport pattern"
Tất cả page dùng:
```
flex flex-col h-screen
  ├── shrink-0   → Header
  ├── flex-1 min-h-0 overflow-y-auto  → Body (scrollable)
  └── shrink-0   → Footer với CTA button (luôn visible)
```
- `ScrollArea` shadcn không dùng được trong flex layout → thay bằng `div className="flex-1 min-h-0 overflow-y-auto"`
- `sticky` không hoạt động khi parent có `overflow: auto` → dùng full-height flex

### LangSmith-inspired features
1. **Post-eval Analysis Breakdown** — `/api/results/[runId]` trả `RunAnalysis` với buckets theo `metadata.difficulty/intent/tags`. UI ở Leaderboard tab "Analysis", Recharts BarChart per-metric.
2. **Failure Mode Detection** — `FailurePatternsPanel` gom failed records theo 5 pattern (`errors`, `low_overall`, `tool_fail`, `low_faith`, `low_criteria`). Click pattern → highlight rows.
3. **Custom Attributes** — `DatasetAttributesModal` cho phép gắn key-value metadata tùy chỉnh lên dataset, persist qua `dataset.metadata.customAttributes`.

---

## Score colors (consistent toàn app)
```ts
score >= 80 → #8fba7a  (green)
score >= 60 → #7dbfd4  (blue)
score >= 40 → #c96442  (orange)
else        → #f87171  (red)
```

---

## Backlog / Known issues

### React 19 lint strictness (pre-existing, không block build)
`npm run lint` báo `react-hooks/set-state-in-effect` ở vài chỗ:
- `agents/page.tsx` (form sync, hydration)
- `run/page.tsx` (selectedIds derive từ datasets)
- `gt-generator/page.tsx`, `datasets/page.tsx`, `task-generator/page.tsx` (hydration)
- `DatasetAttributesModal.tsx` (rows sync từ prop)

Đây là warning React 19 mới, hành vi vẫn đúng. Refactor sang `useSyncExternalStore` hoặc derived-during-render khi rảnh.

### Trong roadmap
- **Per-metric breakdown** trong Leaderboard thay vì chỉ global avg
- **Pass rate metric**: % records đạt ≥80% trên TẤT CẢ metrics
- **Multi-model compare run**: side-by-side scores
- **Export failure logs**: download các records thuộc failure pattern
- **Vitest + golden tests** cho `metrics.ts` (BLEU, ROUGE, F1, AST, toolCallExact)
- **Split** `src/lib/taskGenerator.ts` (2256 lines) + `src/app/task-generator/page.tsx` (3133 lines) thành modules nhỏ hơn

---

## Quick reference

```bash
cd /home/dev/Develop_2026/crab-eval
npm run dev          # localhost:3000
npx tsc --noEmit     # type check, phải = 0 errors
npm run lint         # eslint
```
