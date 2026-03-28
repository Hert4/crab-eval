# Eval Studio — CLAUDE.md

## Dự án là gì
Next.js web app kiểu LangSmith để đánh giá LLM. Chạy bằng `npm run dev`, mở `localhost:3000`.

## Tech stack
- **Next.js** App Router, TypeScript, Tailwind CSS v4
- **Zustand** cho state (có `persist` vào localStorage)
- **shadcn/ui** cho component primitives
- **react-markdown + remark-gfm + rehype-highlight** cho markdown rendering
- **API keys** lưu trong `sessionStorage` (xóa khi đóng tab), config còn lại vào `localStorage`

## Cấu trúc thư mục

```
datasets/                       ← benchmark datasets (JSON, committed vào repo)
results/                        ← eval outputs (JSON, git-ignored, tạo lúc runtime)
src/
├── app/
│   ├── layout.tsx              ← RootLayout, sidebar cố định, main scroll
│   ├── page.tsx                ← redirect → /datasets
│   ├── datasets/page.tsx       ← upload + quản lý datasets
│   ├── gt-generator/page.tsx   ← tạo Ground Truth bằng LLM
│   ├── config/page.tsx         ← cấu hình target model + judge model
│   ├── run/page.tsx            ← chạy eval, progress bar, live log
│   ├── visual-eval/page.tsx    ← 2 AI tự conversation (agentic eval)
│   ├── leaderboard/page.tsx    ← bảng xếp hạng + radar charts
│   └── api/
│       ├── datasets/route.ts   ← đọc file từ datasets/ trong repo
│       ├── results/route.ts    ← đọc/ghi kết quả vào results/ trong repo
│       └── visual-eval/route.ts← lưu transcript simulation vào results/ trong repo
├── components/
│   ├── layout/Sidebar.tsx      ← nav sidebar (indicator khi eval/sim đang chạy)
│   └── ui/
│       └── MarkdownRenderer.tsx← render markdown với code block + copy button
├── lib/
│   ├── openai.ts               ← OpenAI-compatible fetch wrapper
│   ├── metrics.ts              ← tính metric client-side (exact_match, token_f1, bleu, rougeL, astAccuracy)
│   ├── evalRunner.ts           ← pipeline chạy inference + tính metric
│   ├── gtGenerator.ts          ← tạo reference GT batch bằng LLM
│   └── visualEvalRunner.ts     ← simulation engine (2 model tự conversation)
├── store/
│   ├── configStore.ts          ← config target + judge model (persist localStorage)
│   ├── datasetsStore.ts        ← danh sách datasets (persist localStorage)
│   ├── resultsStore.ts         ← kết quả run (persist localStorage, trim khi quota đầy)
│   ├── evalSessionStore.ts     ← runtime state khi đang chạy eval (không persist)
│   └── visualEvalStore.ts      ← runtime + config Visual Eval (cfg persist qua navigation)
└── types/index.ts              ← tất cả TypeScript types
```

## Design system
- Màu nền: `#FFFFFF` / `#F9F9F8` (off-white)
- Border: `#E5E5E4`, Text primary: `#1A1A1A`, muted: `#6B6B6B` / `#9B9B9B`
- Accent: `#D97706` (amber, giống Claude logo), success: `#059669`, error: `#DC2626`
- Font: Geist (Google Fonts, khai báo trong layout.tsx)
- Sidebar: `w-56`, active item `bg-[#EFEFED]`
- **Không dùng dark mode. Không emoji trong UI code.**

## Các types quan trọng

### Dataset
```ts
Dataset { id, filename, uploadedAt, metadata: DatasetMetadata, data: DataRecord[] }
DataRecord { id, input, output, reference, context?, tool_calls?, expected_tool_calls?, conversation_history? }
DatasetMetadata { task_name, task_type, gt_metrics: string[], ... }
```

### Run result (leaderboard)
```ts
RunResult {
  runId, model, baseUrl, date, durationMs,
  tasks: Record<taskName, Record<metricName, score_pct>>  // score 0-100
}
```

### Visual Eval
```ts
SimulationTurn { turnIndex, role: 'user'|'assistant'|'tool', content, tool_calls?, tool_name?, scores?, durationMs? }
SimulationResult { simId, scenarioName, targetModel, userModel, date, durationMs, turns, finalScore, finalAssessment, status }
```

## openai.ts — wrapper quan trọng

```ts
chatCompletion(config, messages, signal?, tools?) → OpenAIResponse
```

- **`max_tokens` vs `max_completion_tokens`**: tự detect theo model name (`o1`, `o3`, `o4`, `gpt-5` → dùng `max_completion_tokens`). Nếu API trả 400 `unsupported_parameter` thì **auto-retry** với param kia.
- **API keys** không trong config object — lấy qua `getApiKey(key)` từ sessionStorage.
  - Key names: `'target_api_key'`, `'judge_api_key'`, `'visual_user_api_key'`
- `testConnection(config)` → gọi `/models` endpoint, return boolean.

## visualEvalRunner.ts — simulation engine

**Flow**: User Model đóng vai người dùng, Target Model đóng vai assistant. Tự động conversation.

1. **User Model** sinh câu hỏi (có `[SCORE R:x A:x H:x]` tag để chấm điểm)
2. **Target Model** trả lời (có thể gọi tool)
3. Nếu có tool calls → **User Model fake tool response** (mock JSON)
4. **Target Model** trả lời sau khi nhận tool result
5. Lặp đến `maxTurns` hoặc User Model gửi `[DONE]`

**`sanitizeTools(tools)`**: bắt buộc phải gọi trước khi truyền tools vào Claude/OpenAI.
- Đảm bảo `type: 'object'` ở root parameters
- Thêm `items: {type:'string'}` cho mọi property có `type: 'array'`
- Strip các field không hợp lệ theo JSON Schema

**`generateScenario(description, userCfg)`**: 2 API calls:
1. Call 1 (1024 tokens): tạo `targetSystemPrompt` + `scenarioDescription`
2. Call 2 (8000 tokens): extract tất cả tools từ document (tối đa 24K chars)

**Lưu kết quả**: POST `/api/visual-eval` để lưu disk, push vào `resultsStore` để lên leaderboard.

## visualEvalStore.ts — config persist qua navigation

```ts
cfg: VisualEvalConfig  // tất cả input form lưu ở đây, KHÔNG dùng useState local
setCfg(patch)          // partial update
```

Khi navigate sang trang khác và quay lại, `cfg` vẫn còn nguyên.

## evalSessionStore.ts — eval runtime

- `appendLog(log)`: append vào cuối (`[...state.logs, log]`), giữ tối đa 500 records
- `AbortController` là module-level singleton (`_controller`), không bị GC khi component unmount

## leaderboard/page.tsx — merge mode

- `mergeRunsByModel()`: gộp các run cùng model name, lấy điểm tốt nhất (max) mỗi task
- Default bật merge mode (`mergeMode = true`) — hiện 1 row mỗi model
- Toggle bằng `GitMerge` icon để xem tất cả run riêng lẻ
- `getActiveGroups()`: tự thêm group "Visual Eval" cho task chưa được classify

## Metrics (client-side, không cần server)

| Metric | Dùng cho |
|---|---|
| `exact_match` | classification, intent |
| `accuracy` | alias exact_match |
| `token_f1` | QA, summarization |
| `bleu1` | translation |
| `rouge_l` | summarization |
| `ast_accuracy` | tool calling (60% name + 40% args keys) |
| `task_success_rate` | tool calling (name match only) |
| `faithfulness`, `answer_relevancy` | LLM-as-judge (gọi judge model) |

## MarkdownRenderer

```tsx
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
<MarkdownRenderer content={markdownString} className="optional-extra-class" />
```

- Code block: có header (language tag + copy button), syntax highlight
- Inline code: amber color (`#D97706`), rounded bg
- Full GFM support: tables, strikethrough, task lists

## Gotchas / lưu ý khi sửa code

1. **Tool call IDs**: Claude yêu cầu `role: 'tool'` message phải có `tool_call_id` khớp với ID từ assistant message. Không được tự tạo ID mới.

2. **Temperature cho o1/o3**: không được truyền `temperature` cho reasoning models (fixed at 1). `openai.ts` tự handle — đừng override.

3. **localStorage quota**: `resultsStore` có logic tự trim khi đầy. Đừng lưu `taskDetails` vào store (chỉ summary scores).

4. **API key flow**:
   - Form nhập → `setApiKey('target_api_key', value)` → sessionStorage
   - Runner đọc → `getApiKey('target_api_key')`
   - Không bao giờ lưu vào Zustand/localStorage

5. **Visual Eval config**: KHÔNG dùng `useState` cho form fields ở `visual-eval/page.tsx`. Luôn dùng `useVisualEvalStore` + `setCfg()`.

6. **TypeScript**: chạy `npx tsc --noEmit` để check trước khi commit. Project clean (0 errors).

7. **Tailwind v4**: không có `tailwind.config.ts` truyền thống — config qua `@theme` trong CSS. Nếu thêm màu custom, thêm vào `globals.css`.

## Chạy local

```bash
npm run dev    # localhost:3000
npm run build  # production build
npx tsc --noEmit  # type check
```

## Evaluation Pipeline v2

### Milestone 1 — Frozen Oracle Dataset
- `generateFrozenOracle()` in `src/lib/visualEvalRunner.ts`
- Oracle runs a dry-run simulation (oracle acts as target) to discover all tool calls organically, then pre-caches responses. Ensures every target model in a batch gets **identical** mock tool responses.
- Oracle datasets saved to `results/oracle-datasets/{datasetId}.json`
- API: `GET/POST /api/visual-eval/oracle`
- Types: `FrozenOracleDataset`, `FrozenToolResponse` in `src/types/index.ts`
- `SimulationResult` carries: `judgePromptHash`, `oracleDatasetId`, `toolDefinitions`, `evaluationVersion`

### Milestone 2 — Multi-Judge + 3-Axis Scoring
- `multiJudgeEvaluate()` in `src/lib/visualEvalEvaluators.ts`
  - Runs `evaluateVisualSimulation()` for each judge in parallel (`Promise.allSettled`)
  - Consensus = weighted median of successful judge scores
  - `agreementRate` = fraction of judge pairs agreeing within 15 points
- `computeThreeAxisScore(toolTrace, judgeScore, compliance)` → `ThreeAxisScore`
  - Task Completion (programmatic, tool trace) — 50%
  - Quality Score (LLM judge semantic) — 35%
  - Compliance Score (config-driven rules) — 15%
- `checkCompliance(turns, rules)` — no hardcoded domain logic; rules in `ComplianceRule[]`
- UI: Up to 2 additional judges in Judge config section (`cfg.additionalJudges`)
- `SimulationResult` carries: `multiJudgeResult`, `threeAxisScore`, `complianceResult`, `judgeAgreement`

### Milestone 3 — Statistical Rigor
- `src/lib/statistics.ts`: `bootstrapCI()`, `passAtK()`, `isSignificantlyDifferent()`
  - Bootstrap CI: 2000 iterations, percentile method
  - Pass@k: unbiased estimator `1 - C(n-c,k)/C(n,k)` (τ-bench / Yao et al. 2024)
  - Significance: Welch's t-test, α=0.05, no external dependencies
- `runsPerModel` in batch config — frozen oracle generated once, shared across all runs
- `SimulationResult` carries: `runIndex`, `totalRuns`
- Leaderboard (`src/app/leaderboard/page.tsx`):
  - Default `mergeMode=false` (statistical view) — was `true`
  - 95% CI column shown when ≥2 runs per model
  - significance badge when NOT significantly different from #1
  - H1 shows "A vs B" only when exactly 2 models AND significantly different
  - pass@1 / pass@3 shown per model row

### Key invariants
- All `SimulationResult` new fields are optional — backward compatible with old JSON files
- API keys: sessionStorage only (`getApiKey()`), never Zustand/localStorage
- `judgeBaseUrl`, `judgeModel` already existed in store/UI before M1 — not re-added
- `EVALUATION_VERSION = '2.0.0'` in `visualEvalRunner.ts`
