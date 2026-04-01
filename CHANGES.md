# CHANGELOG — Crab Eval UI/UX & Feature Updates

> Tài liệu này ghi lại toàn bộ thay đổi đã thực hiện trong session làm việc gần nhất.
> Dùng để biết bắt đầu từ đâu khi tiếp tục.

---

## Trạng thái hiện tại (2026-04-01)

**TypeScript:** `npx tsc --noEmit` → **0 errors**
**Dev server:** `npm run dev` → `localhost:3000`

---

## Phần 1 — UI/UX Redesign (đã hoàn thành)

### 1.1 Layout toàn trang — "full-viewport pattern"

**Vấn đề gốc:** Tất cả các trang (Task Generator, Run Eval, Config) đều bị scroll mất CTA button.

**Pattern đã áp dụng cho tất cả trang:**
```
flex flex-col h-screen
  ├── shrink-0   → Header
  ├── flex-1 min-h-0 overflow-y-auto  → Body (scrollable)
  └── shrink-0   → Footer với CTA button (luôn visible)
```

**Lưu ý quan trọng:**
- `ScrollArea` từ shadcn/ui **không dùng được** trong flex layout → thay bằng `div className="flex-1 min-h-0 overflow-y-auto"`
- `sticky` **không hoạt động** khi parent có `overflow: auto` → dùng full-height flex thay thế

### 1.2 Files đã sửa

| File | Thay đổi |
|---|---|
| `src/app/layout.tsx` | Thêm `suppressHydrationWarning` vào `<main>` — fix hydration mismatch toàn app |
| `src/app/config/page.tsx` | Rewrite hoàn toàn: 2-column grid (Target + Judge), Save button pinned footer, custom toggle |
| `src/app/run/page.tsx` | Rewrite: split panel, log table, pinned Run button, empty states |
| `src/components/layout/Sidebar.tsx` | Bỏ subtitle "LLM Evaluation", bỏ footer "Quick Start", bỏ robot icon |

### 1.3 Task Generator — Split Panel Layout

**File:** `src/app/task-generator/page.tsx`

**Cấu trúc mới của Step 1:**
```
h-full flex
  ├── LEFT  w-[46%] flex flex-col overflow-y-auto border-r p-5
  │         (Upload + textarea 18 rows)
  └── RIGHT flex-1 min-w-0 flex flex-col h-full
            ├── shrink-0: Detection card (type badge)
            ├── flex-1 min-h-0 overflow-y-auto: Model config accordion + Tool defs
            └── shrink-0 border-t: CTA button "Generate..."
```

**CrawdAnim size:** `size={72}` trong detection card.

**State vars đã thêm vào Step1Extract:**
```ts
const [modelConfigOpen, setModelConfigOpen] = useState(false)
const [sysPromptOpen, setSysPromptOpen] = useState(false)
```

**TYPE_META constant** (6 task types, mỗi type có label + description + colorCls).

---

## Phần 2 — LangSmith-Inspired Features (đã hoàn thành)

Lấy cảm hứng từ reverse engineering LangSmith Insights Agent (xem `langsmith.md`).

### 2.1 Feature 1 — Post-eval Analysis Breakdown

**Mục đích:** Sau khi chạy eval, xem breakdown score theo difficulty/intent/tag trong Leaderboard.

**Data flow:**
```
QAPair.difficulty/intent/tags
  → DataRecord.metadata (đã có từ task-generator export)
  → RecordLog.metadata  (MỚI — evalRunner copy vào)
  → disk: results/<model>/<task>.json
  → GET /api/results/[runId]
  → RunAnalysis { tasks[].byDifficulty, byIntent, byTag }
  → AnalysisBreakdown component trong Leaderboard tab
```

**Files mới/sửa:**
- `src/types/index.ts` — thêm `RecordLog.metadata?`, `DatasetMetadata.customAttributes?`, types: `MetricBreakdownBucket`, `TaskAnalysis`, `RunAnalysis`
- `src/lib/evalRunner.ts` — thêm `...(record.metadata ? { metadata: record.metadata } : {})` khi tạo RecordLog (~line 309)
- `src/store/datasetsStore.ts` — `partialize` giờ giữ slim metadata (difficulty/intent/tags/test_aspect/attack_type/expected_behavior), thêm action `updateDatasetMetadata`
- `src/app/api/results/[runId]/route.ts` — **file mới**, GET handler đọc disk files, tính buckets
- `src/components/ui/AnalysisBreakdown.tsx` — **file mới**, Recharts BarChart + table per breakdown dimension
- `src/app/leaderboard/page.tsx` — thêm tab "Leaderboard / Analysis", nút Microscope per row, `loadAnalysis()` function

**Backward compat:** Runs cũ không có `metadata` trong logs → Analysis tab hiện "No metadata — re-run eval to populate". Không break gì cả.

**Để có data breakdown:** Phải chạy eval MỚI sau khi deploy (runs cũ không có metadata).

### 2.2 Feature 2 — Failure Mode Detection

**Mục đích:** Sau khi eval xong, tự động gom nhóm records bị fail theo pattern, click để highlight trong log table.

**Hoạt động hoàn toàn client-side** — không cần API, đọc từ `evalSessionStore.logs`.

**5 patterns được detect:**
| ID | Label | Điều kiện |
|---|---|---|
| `errors` | API / Runtime Errors | `log.error != null` |
| `low_overall` | Low Overall Score | avg(all scores) < 50% |
| `tool_fail` | Tool Call Failures | tool_call_exact / ast_accuracy / task_success_rate < 50% |
| `low_faith` | Low Faithfulness | faithfulness / answer_relevancy < 50% |
| `low_criteria` | Failed Criteria | criteria_score / instruction_adherence < 50% |

**Files mới/sửa:**
- `src/components/ui/FailurePatternsPanel.tsx` — **file mới**
- `src/app/run/page.tsx` — thêm `highlightedPatternId`, `highlightedIds` state, row highlight styling, `<FailurePatternsPanel>` sau scrollable logs

**Bug đã fix:** Header của panel là `<div onClick>` (không phải `<button>`) để tránh lỗi `<button> cannot be descendant of <button>`. "Clear highlight" dùng `<span role="button">`.

### 2.3 Feature 3 — Custom Attributes cho Dataset

**Mục đích:** Gắn key-value metadata tùy chỉnh lên dataset (ví dụ: domain, version, owner).

**Files mới/sửa:**
- `src/components/ui/DatasetAttributesModal.tsx` — **file mới**, modal key-value editor với diff detection
- `src/app/datasets/page.tsx` — thêm nút `SlidersHorizontal`, attribute pills dưới gt_metrics badges, `DatasetAttributesModal` ở cuối JSX

**Persist:** `customAttributes` nằm ở `dataset.metadata` (dataset level) → persist tự động qua `...d` spread trong `partialize`.

---

## Kiến trúc quan trọng cần nhớ

### API Keys
```ts
getApiKey('target_api_key')   // sessionStorage — xóa khi đóng tab
getApiKey('judge_api_key')
getApiKey(`agent_${id}_key`)  // per agent profile
```
**Không bao giờ** lưu API key vào Zustand/localStorage.

### Stores và persist behavior
| Store | Persist | Ghi chú |
|---|---|---|
| `datasetsStore` | localStorage | `partialize` strip context/output, giữ slim metadata |
| `resultsStore` | localStorage | Strip `taskDetails` trước khi persist — chỉ giữ scores |
| `configStore` | localStorage | Toàn bộ config (không có key) |
| `agentsStore` | localStorage | Profile list (không có key) |
| `evalSessionStore` | **Không** | Runtime only — reset khi reload |
| `taskGeneratorStore` | localStorage | Chỉ persist `detectedLanguage` + `composeOptions` |

### Dark theme
Chỉ dùng `--crab-*` CSS vars. Không hardcode Tailwind colors (e.g. không dùng `bg-blue-100`).
Dark-compatible exceptions: `bg-emerald-900/30 text-emerald-300`, `bg-sky-900/30 text-sky-300`, etc.

### Score colors (nhất quán toàn app)
```ts
score >= 80 → #8fba7a  (green)
score >= 60 → #7dbfd4  (blue)
score >= 40 → #c96442  (orange)
else        → #f87171  (red)
```

---

## Việc còn lại / Known issues

### Đã biết nhưng chưa fix
- **Nút Microscope 🔬 trong Leaderboard không click được**: Chưa reproduce được nguyên nhân rõ ràng. Cần kiểm tra xem có nested interactive element nào trong table row không.
- **Analysis tab Feature 1**: Cần chạy eval MỚI (sau deploy) mới có breakdown data. Runs cũ sẽ hiện "No metadata available".

### Cải tiến chưa làm (backlog)
- **Per-metric breakdown** trong Leaderboard thay vì chỉ global avg — giúp phân tích `tool_call_exact` riêng thay vì bị average với các metrics khác
- **Pass rate metric**: % records đạt ≥80% trên TẤT CẢ metrics (không phải average) — phản ánh thực tế hơn global avg
- **Multi-model compare run**: Chọn 2 config, chạy song song, side-by-side scores
- **Export failure logs**: Download các records thuộc failure pattern để debug offline

### Vấn đề với global avg score
Global 72.2% **không hoàn toàn đáng tin** vì:
1. Average gộp metrics không đồng đều (binary `tool_call_exact` vs partial `ast_accuracy`)
2. `criteria_score` phụ thuộc chất lượng judge prompt và criteria text
3. Easy records (avg 95%) "kéo lên" score của hard records (avg 30%)
→ Nên nhìn `tool_call_exact` và `task_success_rate` riêng biệt

---

## Quick reference — chạy lại từ đầu

```bash
cd /home/dev/Develop_2026/crab-eval
npm run dev          # localhost:3000
npx tsc --noEmit     # type check, phải = 0 errors
```

### Thứ tự workflow chuẩn
1. `/task-generator` → Upload doc → Generate dataset → Send to Run Eval
2. `/datasets` → Kiểm tra dataset, thêm custom attributes nếu cần
3. `/config` → Set target model + judge model
4. `/run` → Chọn datasets → Run Evaluation → xem Failure Patterns khi done
5. `/leaderboard` → Load from disk → xem score → click 🔬 để xem Analysis breakdown
