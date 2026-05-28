# Crab Eval — CLAUDE.md

## Dự án là gì
Next.js web app kiểu LangSmith để đánh giá LLM. Chạy bằng `npm run dev`, mở `localhost:3000`.

App dành cho local dev — KHÔNG có auth. Các route ghi đĩa (`POST/DELETE /api/results`, `POST /api/task-generator`) tự động từ chối non-loopback request khi `NODE_ENV === 'production'` (xem `src/lib/serverGuard.ts`).

## Tech stack
- **Next.js 16** App Router, React 19, TypeScript, Tailwind CSS v4
- **Zustand** cho state (có `persist` vào localStorage cho config/datasets/results, không persist API key)
- **shadcn/ui** cho component primitives
- **react-markdown + remark-gfm + rehype-highlight** cho markdown rendering
- **API keys** lưu trong `sessionStorage` (xóa khi đóng tab) qua `getApiKey/setApiKey` trong `src/lib/openai.ts` — không bao giờ chạm `localStorage`/Zustand persist

## Cấu trúc thư mục

```
datasets/                       ← benchmark datasets (JSON, committed vào repo)
   └── task-specs/              ← TaskSet exports từ Task Generator (gitignored runtime)
results/                        ← eval outputs (JSON, git-ignored, tạo lúc runtime)
   └── <model>/
       ├── _run_<runId>.json                    ← run summary (scores only)
       └── <task>.<runId>.json                  ← per-task detail (logs + scores)
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
│   ├── task-generator/page.tsx ← wizard tạo dataset (6 task types)
│   ├── leaderboard/page.tsx    ← bảng xếp hạng + radar charts + analysis breakdown
│   └── api/
│       ├── datasets/route.ts        ← GET đọc file từ datasets/ trong repo
│       ├── llm-proxy/[...path]/route.ts ← catch-all proxy → upstream LLM API (CORS bypass, loopback-only)
│       ├── parse-document/route.ts  ← POST upload .pdf/.docx/.txt/.json → text
│       ├── results/route.ts         ← GET/POST/DELETE eval results (loopback-only)
│       ├── results/[runId]/route.ts ← GET run analysis (breakdown by difficulty/intent/tag)
│       └── task-generator/route.ts  ← GET/POST TaskSet specs (POST loopback-only)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx                ← nav sidebar (indicator khi eval đang chạy)
│   │   └── CrabLogo.tsx               ← SVG logo con cua
│   └── ui/
│       ├── AgentSelector.tsx          ← dropdown chọn agent profile
│       ├── AnalysisBreakdown.tsx      ← Recharts BarChart per-bucket score
│       ├── CrawdAnim.tsx              ← pixel-art mascot animation component
│       ├── DatasetAttributesModal.tsx ← key-value editor cho dataset.metadata.customAttributes
│       ├── FailurePatternsPanel.tsx   ← gom nhóm failed records sau run
│       └── MarkdownRenderer.tsx       ← render markdown với code block + copy button
├── lib/
│   ├── openai.ts          ← OpenAI-compatible fetch wrapper + API key (sessionStorage)
│   ├── metrics.ts         ← tính metric client-side (programmatic)
│   ├── evalRunner.ts      ← pipeline chạy inference + tính metric + judge
│   ├── gtGenerator.ts     ← tạo reference GT batch bằng LLM
│   ├── taskGenerator.ts   ← gen subtasks, QA pairs, tool calls, system prompt (6 modes)
│   ├── serverGuard.ts     ← assertLocalRequest() — chặn non-loopback ở production
│   └── utils.ts           ← cn() helper
├── store/
│   ├── agentsStore.ts        ← danh sách agent profiles (persist localStorage)
│   ├── configStore.ts        ← target + judge model config (persist localStorage)
│   ├── datasetsStore.ts      ← danh sách datasets (persist localStorage, slim metadata)
│   ├── resultsStore.ts       ← kết quả run (persist localStorage, drop oldest khi quota đầy)
│   ├── evalSessionStore.ts   ← runtime state khi chạy eval (KHÔNG persist)
│   └── taskGeneratorStore.ts ← state wizard Task Generator
└── types/index.ts            ← tất cả TypeScript types
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
- **Không dùng hardcoded màu Tailwind light-mode** (vd `bg-blue-100`) — luôn dùng `--crab-*` vars hoặc dark-compatible classes (`bg-sky-900/40 text-sky-300`)
- **Không emoji trong UI code**

## Mascot — CrawdAnim

```tsx
import { CrawdAnim } from '@/components/ui/CrawdAnim'

<CrawdAnim type="sleeping"      size={88} />   // no data
<CrawdAnim type="thinking"      size={80} />   // loading / waiting
<CrawdAnim type="happy"         size={72} />   // drag-active / success
<CrawdAnim type="notification"  size={72} />   // idle dropzone
<CrawdAnim type="typing"        size={80} />   // generating
<CrawdAnim type="disconnected"  size={80} />   // error
<CrawdAnim type="static"        size={48} />   // small decorative
```

SVG files ở `public/animations/clawd-*.svg`. Component dùng `imageRendering: 'pixelated'` qua `<img>` (không phải `next/image` vì pixel-art rendering).

## Các types quan trọng

### Dataset
```ts
Dataset { id, filename, uploadedAt, metadata: DatasetMetadata, data: DataRecord[] }

DataRecord {
  id, input, output, reference,
  context?,               // RAG context — inject vào system message
  system_prompt?,         // per-record system prompt (tool-calling)
  tool_calls?,            // model's actual tool calls (sau khi chạy eval)
  expected_tool_calls?,   // ground truth (tool-calling mode)
  conversation_history?,  // multi-turn tasks
  tools?,                 // OpenAI tool defs để pass vào API
  metadata?,              // record-level metadata (difficulty/intent/tags + per-metric overrides)
}

DatasetMetadata {
  task_name, task_type,
  gt_metrics: string[],       // quyết định metrics nào tính khi run
  gt_model?,
  description?,
  customAttributes?,          // user-defined key-value pills hiển thị ở /datasets
}
```

### Agents
```ts
AgentProfile { id, name, baseUrl, model, maxTokens, temperature, apiKeyName }
// apiKeyName là key để lấy API key từ sessionStorage: getApiKey(agent.apiKeyName)
```

### TaskSet (Task Generator) — hỗ trợ 6 mode
```ts
detectedTaskType:
  | 'tool_calling'         // agent + tool definitions
  | 'rag_qa'               // QA dùng context chunk
  | 'multi_turn'           // conversation_history
  | 'instruction_following' // constraints checklist
  | 'safety'               // attack_type + expected_behavior
  | 'summarization'        // source_text + key_facts

TaskSet {
  atomicSubtasks, compositeTasks, generatedTasks,    // tool_calling mode
  qaPairs?,                                          // rag_qa
  multiTurnPairs?,                                   // multi_turn
  instructionPairs?,                                 // instruction_following
  safetyCases?,                                      // safety
  summarizationPairs?,                               // summarization
  systemPrompt, toolDefinitions,
  detectedTaskType?,
}
```

### Run result
```ts
RecordLog {
  id, status, input, reference, output,
  tool_calls?, scores, error?, durationMs?,
  metadata?,   // copy từ DataRecord.metadata để analysis breakdown
}

RunResult {
  runId, model, baseUrl, date, durationMs,
  tasks: Record<taskName, Record<metricName, score_pct>>,  // 0-100
  judgeModel?, judgeBaseUrl?,                              // reproducibility
  taskDetails?: Record<taskName, TaskRunResult>,           // strip trước khi persist localStorage
}
```

## openai.ts — wrapper quan trọng

```ts
chatCompletion(config, messages, signal?, tools?) → OpenAIResponse
buildFileMessageContent(file, baseUrl, apiKey, signal?) → FileMessageContent[] | null
getApiKey(key) / setApiKey(key, value) / removeApiKey(key)  // sessionStorage only
```

- **`max_tokens` vs `max_completion_tokens`**: tự detect theo model name (`o1`, `o3`, `o4`, `gpt-5` → dùng `max_completion_tokens`). Auto-retry với param kia nếu API trả 400.
- **`chat_template_kwargs.enable_thinking=false`**: gửi mặc định cho Qwen3-style models. Nếu API 400 → auto-retry KHÔNG có field này. Cũng retry cùng lúc nếu lỗi token-param. Một lần retry là đủ.
- **API keys** không trong config object — lấy qua `getApiKey(key)` từ sessionStorage:
  - Key names: `'target_api_key'`, `'judge_api_key'`
  - Agent keys: `agent_{timestamp}_key` (lưu trong `AgentProfile.apiKeyName`)
- `testConnection(config)` → gọi `/models` endpoint, return boolean.
- `buildFileMessageContent(file, baseUrl, apiKey, signal?)` — không phải `(file, config)`. Return `FileMessageContent[] | null`, dùng double-cast `as unknown as OpenAIMessage['content']` khi cần.

## taskGenerator.ts — pipeline gen dataset

```ts
// Tool-calling pipeline
extractAtomicSubtasks(content, config, signal?, onProgress?, sourceFile?) → AtomicSubtask[]
generateSystemPrompt(content, config, signal?, sourceFile?) → string
generateToolDefinitions(content, config, signal?, sourceFile?) → ToolDefinition[]
composeCompositeTasks(subtasks, options, config, signal?, onProgress?) → CompositeTask[]
generateNaturalLanguageQuestions(tasks, config, signal?, onProgress?) → GeneratedTask[]
generateExpectedToolCalls(tasks, config, signal?, onProgress?) → GeneratedTask[]

// QA / multi-turn / instruction / safety / summarization pipelines
detectTaskType(content, config, signal?, sourceFile?) → TaskType
generateQAPairs / generateMultiTurnPairs / generateInstructionPairs
  / generateSafetyCases / generateSummarizationPairs
```

`detectTaskType`: gọi LLM phân loại doc → 1 trong 6 task types kể trên.

Mỗi generator chunk doc → mỗi chunk gọi LLM sinh batch → deduplicate bằng `tokenOverlap` → subsample đến `targetCount`. Batch failure không kill toàn bộ — chỉ skip chunk đó với `console.warn`.

## evalRunner.ts — chọn metrics

EvalRunner đọc `dataset.metadata.gt_metrics` để quyết định metric nào tính. **Không cần sửa khi thêm metric mới** — chỉ set đúng `gt_metrics` khi tạo dataset.

- `context` trong record → inject làm system message
- `tools` trong record → pass vào API
- `faithfulness`, `answer_relevancy`, `answer_correctness`, `criteria_score`, `context_retention`, `consistency_score`, `instruction_adherence`, `coverage_score` → gọi judge model
- `tool_call_exact`, `criteria_score` → cần `expected_tool_calls`
- `instruction_adherence` → cần `metadata.constraints: string[]`
- `coverage_score` → cần `metadata.key_facts: string[]`
- `refusal_accuracy` → cần `metadata.expected_behavior` ('refuse' | 'comply' | 'clarify'); optional `metadata.refusal_phrases: string[]` để override default English fallback
- `accuracy` → optional `metadata.{unknown_label, unknown_synonyms, valid_label_range}` cho special-case classification
- `word_count_compliance` → cần `metadata.max_words: number`

## Multi-model eval (parallel)

`startEval(datasets, config: EvalConfig)` nhận `EvalConfig.targets: EvalTarget[]` — chạy **song song** tất cả target qua `Promise.allSettled`. Mỗi target có semaphore riêng với cùng `concurrency`. Datasets dùng chung. Mỗi target tạo 1 `RunResult` + runId riêng, post `/api/results` độc lập → leaderboard thấy N row.

- `EvalTarget` phải tự chứa `apiKey` (runner **không** gọi `getApiKey` nữa — page giải mã từ `agent.apiKeyName` hoặc `'target_api_key'` trước khi gọi)
- `evalSessionStore.runs: Record<modelId, ModelRunSlot>` — mỗi slot có logs/progress/overallProgress/isDone riêng; top-level `isRunning`/`isDone`/`overallProgress` là aggregate (Sidebar dùng được)
- Run page `/run`: panel "Target Models" tick chọn nhiều Agent; 0 agent → fallback Config target (`modelId='default'`). Phải có API key cho mọi target đã chọn, UI check trước khi submit.
- Abort: 1 controller chung → Stop abort mọi target cùng lúc.
- **Judge concurrency global semaphore**: `_judgeAcquire` ở module level cap tổng judge calls song song = `max(2, concurrency * 2)` → tránh fan-out (N×K×8) làm chết upstream judge.

## Metrics (client-side, không cần server)

| Metric | Dùng cho | Yêu cầu |
|---|---|---|
| `exact_match` | classification | reference |
| `accuracy` | classification (intent routing) | reference; optional metadata.{unknown_label, unknown_synonyms, valid_label_range} |
| `token_f1` | QA, summarization | reference |
| `bleu1` | translation | reference |
| `rouge_l` | summarization | reference |
| `list_match` | ranking/recommendation (set recall, order-insensitive) | reference (JSON array) |
| `ast_accuracy` | tool calling (60% name + 40% args keys) | expected_tool_calls |
| `task_success_rate` | tool calling (name match) | expected_tool_calls |
| `tool_call_exact` | tool calling (binary: name + required keys) | expected_tool_calls |
| `refusal_accuracy` | safety | metadata.expected_behavior |
| `word_count_compliance` | summarization length constraint | metadata.max_words |
| `criteria_score` | tool calling LLM judge | reference (newline-separated criteria) |
| `faithfulness` | QA/RAG LLM judge | record.context HOẶC metadata.source_text |
| `answer_relevancy` | QA/RAG LLM judge | input |
| `answer_correctness` | LLM judge so output vs reference | reference |
| `context_retention` | multi-turn LLM judge | conversation_history |
| `consistency_score` | multi-turn LLM judge | conversation_history |
| `instruction_adherence` | instruction-following LLM judge | metadata.constraints |
| `coverage_score` | summarization LLM judge | metadata.key_facts |

`tokenize()` dùng `Intl.Segmenter` khi có (CJK / từ-ghép tiếng Việt) → fallback whitespace.

**Judge parsing**: `parseJudgeScore()` ưu tiên format `<score>N</score>` / `Score: N` / `Rating: N`, fallback **số CUỐI** trong text (tránh bug "Out of 10 → 10" khi judge có preamble).

**Pass/fail judge**: `passFailToScore(results, expectedCount)` slice đến `expectedCount` items — judge trả thừa thì ignore, thiếu thì missing đếm fail. Dùng cho `instruction_adherence`, `coverage_score`, `criteria_score`.

## MarkdownRenderer

```tsx
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
<MarkdownRenderer content={markdownString} className="optional-extra-class" />
```

## Post-eval Analysis (LangSmith-inspired)

`/api/results/[runId]` đọc per-task disk file (`<task>.<runId>.json`) → trả `RunAnalysis` với buckets theo `metadata.difficulty / intent / tags`. UI ở Leaderboard tab "Analysis", Recharts BarChart.

`FailurePatternsPanel` (client-side, không cần API) gom failed records theo 5 pattern: `errors`, `low_overall`, `tool_fail`, `low_faith`, `low_criteria`. Click pattern → highlight rows trong log table.

## Gotchas / lưu ý khi sửa code

1. **Tool call IDs**: Claude yêu cầu `role: 'tool'` message phải có `tool_call_id` khớp với ID từ assistant message. Không được tự tạo ID mới.

2. **Temperature cho o1/o3/o4/gpt-5**: không truyền `temperature` (fixed at 1). `openai.ts` tự handle — đừng override.

3. **localStorage quota**: `resultsStore` drop run cũ nhất trong loop khi đầy. Đừng lưu `taskDetails` vào store (chỉ summary scores). `datasetsStore` slim `metadata` khi persist.

4. **API key flow**:
   - Form nhập → `setApiKey('target_api_key', value)` → sessionStorage
   - Runner đọc → `getApiKey('target_api_key')`
   - **Không bao giờ** lưu vào Zustand/localStorage
   - Xóa agent → gọi `removeApiKey(agent.apiKeyName)` để cleanup

5. **TypeScript**: chạy `npx tsc --noEmit` để check trước khi commit. Project clean (0 errors).

6. **Tailwind v4**: không có `tailwind.config.ts` truyền thống — config qua `@theme` trong CSS. Nếu thêm màu custom, thêm vào `globals.css`.

7. **`buildFileMessageContent` call signature**: `(file, baseUrl, apiKey, signal?)` — không phải `(file, config)`.

8. **TypeScript narrowing trong JSX**: bên trong `{condition && (<>...</>)}` block, TS đã biết condition là true — không lặp lại condition đó trong `disabled` prop.

9. **Dark theme colors**: không dùng `bg-blue-100`, `text-blue-600` hay màu light-mode Tailwind trực tiếp. Dùng `--crab-*` vars hoặc `bg-sky-900/40 text-sky-300` style.

10. **Per-run filename**: `POST /api/results` ghi `<task>.<runId>.json` — không đè lịch sử. `<task>.json` cũ vẫn đọc được (GET dedupe theo runId field).

11. **Loopback guard**: `assertLocalRequest(req)` ở đầu route ghi đĩa. Dev (`NODE_ENV !== 'production'`) là no-op; production chỉ chấp nhận `127.0.0.1` / `::1` / `localhost`.

12. **Language hardcoding**: KHÔNG nhúng từ khóa cụ thể tiếng Việt/Trung/etc trong metric heuristic. Dùng `record.metadata.{refusal_phrases, unknown_synonyms, valid_label_range}` để override.

13. **CORS / LLM proxy**: browser → upstream LLM (OpenAI, DeepSeek, …) đi qua `/api/llm-proxy/[...path]`. `openai.ts:resolveEndpoint()` tự rewrite URL khi `typeof window !== 'undefined'`, baseUrl truyền qua header `x-llm-baseurl`, `Authorization` pass-through. Đừng `fetch` thẳng `api.openai.com` từ client — sẽ bị CORS block (OpenAI/DeepSeek không set `Access-Control-Allow-Origin`).

## Chạy local

```bash
npm run dev       # localhost:3000
npm run build     # production build
npx tsc --noEmit  # type check
npm run lint      # eslint
```

### Workflow chuẩn
1. `/task-generator` → Upload doc → detect type → Generate dataset → Send to Run Eval
2. `/datasets` → Kiểm tra dataset, thêm custom attributes nếu cần
3. `/agents` → Cấu hình các Agent profiles (target models)
4. `/config` → Set judge model
5. `/run` → Chọn datasets + tick agents → Run Evaluation → xem Failure Patterns
6. `/leaderboard` → Load from disk → xem score → click 🔬 để xem Analysis breakdown

### IMPORTANT
Always update `CLAUDE.md` khi thay đổi public API hoặc data shape.
