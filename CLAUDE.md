# Crab Eval — CLAUDE.md

## Dự án là gì
Next.js web app kiểu LangSmith để đánh giá LLM. Chạy bằng `npm run dev`, mở `localhost:3000`.

## Tech stack
- **Next.js** App Router, TypeScript, Tailwind CSS v4
- **Zustand** cho state (có `persist` vào localStorage)
- **shadcn/ui** cho component primitives
- **react-dropzone** cho upload file
- **react-markdown + remark-gfm + rehype-highlight** cho markdown rendering
- **API keys** lưu trong `sessionStorage` (xóa khi đóng tab), config còn lại vào `localStorage`

## Cấu trúc thư mục

```
datasets/                       ← benchmark datasets (JSON, committed vào repo)
results/                        ← eval outputs (JSON, git-ignored, tạo lúc runtime)
public/
└── animations/                 ← pixel-art Clawd mascot SVG (7 files)
src/
├── app/
│   ├── layout.tsx              ← RootLayout, sidebar cố định, main scroll
│   ├── page.tsx                ← redirect → /datasets
│   ├── datasets/page.tsx       ← upload + quản lý datasets
│   ├── gt-generator/page.tsx   ← tạo Ground Truth bằng LLM
│   ├── agents/page.tsx         ← quản lý model profiles (base URL, key, model, temp)
│   ├── config/page.tsx         ← cấu hình target model + judge model cho run eval
│   ├── run/page.tsx            ← chạy eval, progress bar, live log
│   ├── task-generator/page.tsx ← wizard tạo dataset (tool-calling & QA/RAG)
│   ├── leaderboard/page.tsx    ← bảng xếp hạng + radar charts
│   ├── visual-eval/page.tsx    ← 2 AI tự conversation (agentic eval)
│   └── api/
│       ├── datasets/route.ts   ← đọc file từ datasets/ trong repo
│       ├── results/route.ts    ← đọc/ghi kết quả vào results/ trong repo
│       └── visual-eval/route.ts← lưu transcript simulation vào results/ trong repo
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx         ← nav sidebar (indicator khi eval/sim đang chạy)
│   │   └── CrabLogo.tsx        ← SVG logo con cua
│   └── ui/
│       ├── CrawdAnim.tsx       ← pixel-art mascot animation component
│       └── MarkdownRenderer.tsx← render markdown với code block + copy button
├── lib/
│   ├── openai.ts               ← OpenAI-compatible fetch wrapper
│   ├── metrics.ts              ← tính metric client-side
│   ├── evalRunner.ts           ← pipeline chạy inference + tính metric
│   ├── gtGenerator.ts          ← tạo reference GT batch bằng LLM
│   ├── taskGenerator.ts        ← gen subtasks, QA pairs, tool calls, system prompt
│   ├── statistics.ts           ← bootstrapCI, passAtK, isSignificantlyDifferent
│   ├── visualEvalRunner.ts     ← simulation engine (2 model tự conversation)
│   ├── visualEvalEvaluators.ts ← multi-judge + 3-axis scoring
│   └── visualEvalVerifier.ts   ← programmatic τ-bench style verification
├── store/
│   ├── agentsStore.ts          ← danh sách agent profiles (persist localStorage)
│   ├── configStore.ts          ← config target + judge model (persist localStorage)
│   ├── datasetsStore.ts        ← danh sách datasets (persist localStorage)
│   ├── resultsStore.ts         ← kết quả run (persist localStorage, trim khi quota đầy)
│   ├── evalSessionStore.ts     ← runtime state khi đang chạy eval (không persist)
│   ├── taskGeneratorStore.ts   ← state wizard Task Generator (detectedTaskType, qaPairs, ...)
│   └── visualEvalStore.ts      ← runtime + config Visual Eval (cfg persist qua navigation)
└── types/index.ts              ← tất cả TypeScript types
```

## Design system
- **Dark theme** — CSS custom properties via `--crab-*` variables trong `globals.css`
- Background: `--crab-bg`, `--crab-bg-secondary`, `--crab-bg-tertiary`
- Text: `--crab-text`, `--crab-text-secondary`, `--crab-text-muted`
- Border: `--crab-border`, `--crab-border-strong`, `--crab-border-subtle`
- Accent: `--crab-accent` (amber), `--crab-accent-light`, `--crab-accent-medium`, `--crab-accent-hover`
- Hover background: `--crab-bg-hover`
- Font: Geist (Google Fonts, khai báo trong layout.tsx)
- Sidebar: `w-56`, active item dùng `bg-[var(--crab-accent-light)] text-[var(--crab-accent)]`
- **Không dùng hardcoded màu Tailwind** (vd `bg-blue-100`) — luôn dùng `--crab-*` vars hoặc dark-compatible classes (`bg-sky-900/40 text-sky-300`)
- **Không emoji trong UI code**

## Mascot — CrawdAnim

```tsx
import { CrawdAnim } from '@/components/ui/CrawdAnim'

// Dùng cho empty states, loading indicators
<CrawdAnim type="sleeping"      size={88} />   // no data
<CrawdAnim type="thinking"      size={80} />   // loading / waiting
<CrawdAnim type="happy"         size={72} />   // drag-active / success
<CrawdAnim type="notification"  size={72} />   // idle dropzone
<CrawdAnim type="typing"        size={80} />   // generating
<CrawdAnim type="disconnected"  size={80} />   // error
<CrawdAnim type="static"        size={48} />   // small decorative
```

SVG files ở `public/animations/clawd-*.svg`. Dùng `imageRendering: 'pixelated'`.

## Các types quan trọng

### Dataset
```ts
Dataset { id, filename, uploadedAt, metadata: DatasetMetadata, data: DataRecord[] }

DataRecord {
  id, input, output, reference,
  context?,               // RAG context — inject vào system message
  tool_calls?,            // model's actual tool calls (sau khi chạy eval)
  expected_tool_calls?,   // ground truth tool calls (tool-calling mode)
  conversation_history?,
}

DatasetMetadata {
  task_name, task_type,
  gt_metrics: string[],   // quyết định metrics nào được tính khi run eval
  gt_model?,
  description?,
}

// QA/RAG types
QAIntent = 'factoid' | 'procedural' | 'definition' | 'comparison'
QAPair { id, question, reference, context, difficulty, intent, tags }
```

### Agents
```ts
AgentProfile { id, name, baseUrl, model, maxTokens, temperature, apiKeyName }
// apiKeyName là key để lấy API key từ sessionStorage: getApiKey(agent.apiKeyName)
```

### TaskSet (Task Generator)
```ts
TaskSet {
  atomicSubtasks, compositeTasks, generatedTasks,
  systemPrompt, toolDefinitions,
  detectedTaskType?: 'tool_calling' | 'rag_qa',
  qaPairs?: QAPair[],
}
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
buildFileMessageContent(file, baseUrl, apiKey, signal?) → FileMessageContent[] | null
```

- **`max_tokens` vs `max_completion_tokens`**: tự detect theo model name (`o1`, `o3`, `o4`, `gpt-5` → dùng `max_completion_tokens`). Nếu API trả 400 `unsupported_parameter` thì **auto-retry** với param kia.
- **API keys** không trong config object — lấy qua `getApiKey(key)` từ sessionStorage.
  - Key names: `'target_api_key'`, `'judge_api_key'`, `'visual_user_api_key'`
  - Agent keys: `agent_{timestamp}_key` (lưu trong `AgentProfile.apiKeyName`)
- `testConnection(config)` → gọi `/models` endpoint, return boolean.
- `buildFileMessageContent` dùng để attach file (PDF/text) vào message — signature là `(file, baseUrl, apiKey, signal?)`, **không phải** `(file, config)`.

## taskGenerator.ts — pipeline gen dataset

```ts
// Tool-calling pipeline
extractAtomicSubtasks(content, config, signal?, onProgress?, sourceFile?) → AtomicSubtask[]
generateSystemPrompt(content, config, signal?, sourceFile?) → string
generateToolDefinitions(content, config, signal?, sourceFile?) → ToolDefinition[]
composeCompositeTasks(subtasks, options, config, signal?, onProgress?) → CompositeTask[]
generateNaturalLanguageQuestions(tasks, config, signal?, onProgress?) → GeneratedTask[]
generateExpectedToolCalls(tasks, config, signal?, onProgress?) → GeneratedTask[]

// QA/RAG pipeline
detectTaskType(content, config, signal?, sourceFile?) → 'tool_calling' | 'rag_qa'
generateQAPairs(content, config, signal?, onProgress?, sourceFile?, targetCount?) → QAPair[]
```

**`detectTaskType`**: gọi LLM phân loại doc — "tool spec / agent spec" → `tool_calling`, "FAQ / chính sách / hướng dẫn" → `rag_qa`.

**`generateQAPairs`**: chunk doc → mỗi chunk gọi LLM sinh 3–5 cặp QA → deduplicate bằng `tokenOverlap` → subsample đến `targetCount`.

## taskGeneratorStore.ts — wizard state

```ts
// State
detectedTaskType: 'tool_calling' | 'rag_qa' | null
isDetecting: boolean
qaPairs: QAPair[]
qaProgress: { done: number; total: number }
atomicSubtasks: AtomicSubtask[]
compositeTasks: CompositeTask[]
generatedTasks: GeneratedTask[]
systemPrompt: string
toolDefinitions: ToolDefinition[]
// ...

// Actions
setDetectedTaskType(type)
setIsDetecting(v)
setQAPairs(pairs)
updateQAPair(id, patch)
removeQAPair(id)
setQAProgress(done, total)
reset()   // clears everything including QA state
```

`partialize` chỉ persist `detectedLanguage` và `composeOptions` — không persist QA/subtask data.

## Task Generator — QA/RAG mode flow

1. Upload file → `detectTaskType()` tự chạy sau upload
2. Badge hiển thị `📄 QA/RAG` hoặc `🔧 Tool-Calling` — có nút switch để override
3. **QA mode**: Step 1 → "Generate QA Pairs" (thay vì Extract Subtasks)
4. **QA mode**: Step 2 → review/edit QA pairs (ẩn Agent System Prompt + Tool Definitions)
5. **QA mode**: Step 4 → export với `task_type: 'rag_qa'`, `gt_metrics: ['faithfulness', 'answer_relevancy']`, `record.context` = chunk text
6. **Tool-calling mode**: flow cũ không thay đổi

Khi switch mode: phải clear data của mode cũ (`qaPairs` khi switch về tool_calling; `atomicSubtasks/compositeTasks/generatedTasks` khi switch về rag_qa).

## evalRunner.ts — chọn metrics

EvalRunner đọc `dataset.metadata.gt_metrics` để quyết định metric nào tính. **Không cần sửa khi thêm metric mới** — chỉ cần set đúng `gt_metrics` khi tạo dataset.

- `context` trong record → inject làm system message
- `tools` trong record → pass vào API (nếu có)
- `faithfulness`, `answer_relevancy` → gọi judge model
- `tool_call_exact`, `criteria_score` → cần `expected_tool_calls`

## Multi-model eval (parallel)

`startEval(datasets, config: EvalConfig)` nhận `EvalConfig.targets: EvalTarget[]` — chạy **song song** tất cả target qua `Promise.allSettled`. Mỗi target có semaphore riêng với cùng `concurrency`. Judge + datasets dùng chung. Mỗi target tạo 1 `RunResult` + runId riêng, post `/api/results` độc lập → leaderboard thấy N row.

- `EvalTarget` phải tự chứa `apiKey` (runner **không** gọi `getApiKey` nữa — page giải mã từ `agent.apiKeyName` hoặc `'target_api_key'` trước khi gọi)
- `evalSessionStore.runs: Record<modelId, ModelRunSlot>` — mỗi slot có logs/progress/overallProgress/isDone riêng; top-level `isRunning`/`isDone`/`overallProgress` là aggregate (Sidebar vẫn dùng được)
- Run page `/run`: panel "Target Models" tick chọn nhiều Agent; 0 agent → fallback Config target (`modelId='default'`). Phải có API key cho mọi target đã chọn, UI check trước khi submit.
- Abort: 1 controller chung → Stop abort mọi target cùng lúc.
- Cảnh báo tải: `N targets × concurrency` request song song tối đa.

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
| `tool_call_exact` | tool calling (binary: đúng tool + đủ required keys) |
| `criteria_score` | tool calling LLM judge (assertion criteria) |
| `faithfulness` | QA/RAG LLM judge (answer grounded in context) — **chỉ fire khi record có `context` hoặc `metadata.source_text`** |
| `answer_relevancy` | QA/RAG LLM judge (answer relevant to question) — không cần context/reference |
| `answer_correctness` | LLM judge so output vs reference (không cần context). Dùng cho analysis/recommendation/forecast — chấp nhận semantic equivalence + alternative valid answers |

## visualEvalRunner.ts — simulation engine

**Flow**: User Model đóng vai người dùng, Target Model đóng vai assistant. Tự động conversation.

1. **User Model** sinh câu hỏi (có `[SCORE R:x A:x H:x]` tag để chấm điểm)
2. **Target Model** trả lời (có thể gọi tool)
3. Nếu có tool calls → **User Model fake tool response** (mock JSON)
4. **Target Model** trả lời sau khi nhận tool result
5. Lặp đến `maxTurns` hoặc User Model gửi `[DONE]`

**`sanitizeTools(tools)`**: bắt buộc phải gọi trước khi truyền tools vào Claude/OpenAI.

**Lưu kết quả**: POST `/api/visual-eval` để lưu disk, push vào `resultsStore` để lên leaderboard.

## MarkdownRenderer

```tsx
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
<MarkdownRenderer content={markdownString} className="optional-extra-class" />
```

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

8. **`buildFileMessageContent` call signature**: `(file, baseUrl, apiKey, signal?)` — không phải `(file, config)`. Return type là `FileMessageContent[] | null`, dùng double-cast `as unknown as OpenAIMessage['content']` khi cần.

9. **TypeScript narrowing trong JSX**: bên trong `{condition && (<>...</>)}` block, TS đã biết condition là true — không lặp lại condition đó trong `disabled` prop (gây lỗi type).

10. **Dark theme colors**: không dùng `bg-blue-100`, `text-blue-600` hay màu light-mode Tailwind trực tiếp. Dùng `--crab-*` vars hoặc `bg-sky-900/40 text-sky-300` style dark-compatible classes.

## Chạy local

```bash
npm run dev       # localhost:3000
npm run build     # production build
npx tsc --noEmit  # type check
```

---

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

### Milestone 3 — Statistical Rigor
- `src/lib/statistics.ts`: `bootstrapCI()`, `passAtK()`, `isSignificantlyDifferent()`
  - Bootstrap CI: 2000 iterations, percentile method
  - Pass@k: unbiased estimator `1 - C(n-c,k)/C(n,k)` (τ-bench / Yao et al. 2024)
  - Significance: Welch's t-test, α=0.05, no external dependencies
- `runsPerModel` in batch config — frozen oracle generated once, shared across all runs
- Leaderboard:
  - Default `mergeMode=false` (statistical view)
  - 95% CI column shown when ≥2 runs per model
  - significance badge when NOT significantly different from #1
  - pass@1 / pass@3 shown per model row

### Key invariants
- All `SimulationResult` new fields are optional — backward compatible with old JSON files
- API keys: sessionStorage only (`getApiKey()`), never Zustand/localStorage
- `EVALUATION_VERSION = '2.0.0'` in `visualEvalRunner.ts`

---

## τ-bench Style Evaluation (Phase 2)

**Problem solved:** LLM judge variance (18-33 point spread across runs) from 3 LLM sources.

```
LLM generates tasks+expected_outcomes (1 time, frozen) → Code verifies deterministically
    ↑ random ONCE                                            ↑ no variance
+ LLM judge quality (30% weight only)
    ↑ variance × 0.3 = negligible
```

### Key files
- `src/lib/visualEvalVerifier.ts` — programmatic verification engine
  - `verifyActions()` — tool calls match expected (τ-bench subset check)
  - `verifyCommunication()` — response contains/not-contains expected phrases
  - `verifyBehavior()` — call_tool / ask_clarification / report_not_found / refuse_invalid / respond_directly
  - `verifyTask()` — combines all checks, binary reward (0 or 1)
  - `verifyNLAssertions()` — LLM yes/no only, not scoring
- `src/app/api/visual-eval/taskset/route.ts` — saves `FrozenTaskSet` to `results/task-sets/`
- `generateFrozenTaskSet()` in `visualEvalRunner.ts` — generates tasks+outcomes in one LLM call

### Scoring modes
| Mode | Weight | Description |
|------|--------|-------------|
| `hybrid` | 70% prog + 30% quality | Default — balanced |
| `programmatic` | 100% prog | Fully deterministic, binary |
| `judge_only` | 100% judge | Legacy LLM scoring |


### IMPORTANT: 
Always update `CLAUDE.md `