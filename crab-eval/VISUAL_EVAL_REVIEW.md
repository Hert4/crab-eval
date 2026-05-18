# Visual Eval — Team Review: Công bằng & Chuẩn Benchmark

**Ngày review:** 27/03/2026
**Reviewer:** Claude Code (automated deep-code review)
**Phiên bản code:** HEAD (`crab-eval`)
**Benchmark đã chạy:** AVA Tuyển Dụng — 9 models, 10 tasks (`BENCHMARK_REPORT.md`)

---

## Executive Summary

| Chiều đánh giá | Verdict | Ghi chú ngắn |
|---|:---:|---|
| Fairness — công bằng giữa các model | **PASS** ⚠️ | Batch mode tốt; single run có rủi ro oracle variance |
| Scoring validity — điểm có đúng không | **PARTIAL** ⚠️ | Logic đúng, nhưng hardcode business rules và simple mean |
| Leaderboard objectivity | **PARTIAL** ⚠️ | `mergeMode=true` mặc định cherry-pick best run |
| Reproducibility | **PARTIAL** ⚠️ | Transcript lưu đủ, nhưng thiếu judge/oracle metadata |
| Internal R&D use | **READY** ✅ | Dùng so sánh models trong cùng một batch — đủ tin cậy |
| Public benchmark / academic | **NOT READY** ❌ | Thiếu statistical testing, inter-rater reliability |
| Enterprise production eval | **CONDITIONAL** ⚠️ | OK nếu dùng đúng — xem điều kiện ở mục 7 |

**TL;DR:** Visual Eval là một tool **nội bộ R&D mạnh** với cơ chế fairness batch tốt. Để dùng làm benchmark chuẩn chính thức (công bố, so sánh với bên ngoài, ra quyết định production), cần fix 3 issues P0 trước.

---

## 1. Fairness Analysis — Công bằng giữa các model

### 1.1 Cơ chế đã implement (điểm mạnh)

#### Shared Replay Script (batch mode)
```
src/lib/visualEvalRunner.ts — buildBatchReplayScript() + startBatchSimulation()
```
- `startBatchSimulation()` gọi `buildBatchReplayScript()` một lần duy nhất trước khi chạy bất kỳ model nào.
- Kết quả là một mảng fixed user messages. **Tất cả target models nhận cùng câu hỏi y hệt nhau**, theo cùng thứ tự — loại bỏ variance từ User Model.
- Nếu replay script có sẵn (`config.replayScript`), dùng trực tiếp (không gọi LLM). Fallback thứ tự ưu tiên: explicit replay → generated → task list.
- UI hiển thị badge "Replay mode" màu xanh khi đang dùng fixed script — minh bạch với người dùng.

**Verdict: PASS** — Đây là cơ chế fairness tốt, hiệu quả.

#### Shared Oracle Cache (batch mode)
```
src/lib/visualEvalRunner.ts — sharedOracleCache (Map<string, string>)
```
- `startBatchSimulation()` tạo một `sharedOracleCache = new Map()` và pass cho tất cả model runs.
- Khi model A đã gọi `get_candidate_fit_score({ candidateId: "CAND-1042" })`, kết quả được cache với key `get_candidate_fit_score:{"candidateId":"CAND-1042"}`.
- Model B gọi cùng tool với cùng arguments → nhận **đúng cùng mock response** → loại bỏ oracle variance cross-model.

**Cache key stability:**
```
src/lib/visualEvalRunner.ts — stableSortJson() + getToolCallCacheKey()
```
- JSON arguments được sorted alphabetically theo key trước khi hash → `{b:1,a:2}` và `{a:2,b:1}` cho cùng cache key. Không bị miss cache do key ordering.

**Verdict: PASS** — Implementation đúng và chu đáo.

#### Tool Schema Normalization
```
src/lib/visualEvalRunner.ts — sanitizeTools()
```
- Trước khi pass tools vào bất kỳ model nào, `sanitizeTools()` được gọi để ensure valid JSON Schema.
- Thêm `items: {type:'string'}` cho array properties (required by GPT-4.1 + Claude).
- Strip các fields không hợp lệ theo JSON Schema.
- **Tất cả models nhận cùng tool definition**, không phụ thuộc vào format gốc.

**Verdict: PASS** — Cross-provider fairness tốt.

#### Judge Scale Normalization
```
src/lib/visualEvalEvaluators.ts — detectJudgeMetricMultiplier()
```
- Tự detect thang điểm judge (0–1, 0–10, 0–100) và normalize về 0–100.
- Retry 3 lần nếu judge response không parse được.
- `temperature: 0` cho judge để maximize determinism.

**Verdict: PASS** — Robust với các judge models khác nhau.

---

### 1.2 Rủi ro và điểm yếu

#### RISK 1: Single run không có oracle cache sharing
```
src/lib/visualEvalRunner.ts — startSimulation() (single model)
```
Khi chạy **từng model riêng lẻ** (không dùng batch), mỗi run có `oracleMemory` riêng (per-run Map) và **không có** `sharedOracleCache`. Oracle có thể trả response khác nhau cho cùng tool call giữa các single runs. Điều này có nghĩa:
- Nếu so sánh kết quả của model A (chạy single ngày hôm qua) với model B (chạy single hôm nay), oracle responses có thể khác → điểm số không comparable.
- **Chỉ batch mode mới đảm bảo oracle fairness.**

**Severity: MEDIUM** — Dễ fix bằng cách enforce: "để so sánh models, luôn dùng batch mode".

#### RISK 2: Judge model = User Model (không bắt buộc tách)
```
src/lib/visualEvalRunner.ts, line 727:
const evaluation = await evaluateVisualSimulation(storeTurns, userCfg, signal, {...})
```
Judge được gọi với `userCfg` (User Model config). Không có separate judge model config bắt buộc. Trong `VisualEvalConfig`, `judgeConfig` là optional. Hệ quả:
- Nếu không config judge riêng, User Model = Judge → provider bias (model tự chấm bài liên quan đến conversation mình tạo ra).
- Không lưu judge model name vào `SimulationResult` → không biết result được chấm bởi model nào.

**Severity: HIGH** — Ảnh hưởng đến validity của score.

#### RISK 3: maxTokens hardcoded trong batch mode
```
src/lib/visualEvalRunner.ts, line 344-348:
targetConfig: {
  baseUrl: target.baseUrl,
  model: target.model,
  maxTokens: 4096,       // ← hardcoded
  temperature: 0.3,      // ← hardcoded
},
```
Tất cả models trong batch nhận `maxTokens: 4096, temperature: 0.3` dù có thể model đó cần config khác (e.g., reasoning models cần `temperature: 1`). `openai.ts` tự handle temperature cho o1/o3 nhưng maxTokens vẫn fixed.

**Severity: LOW** — Ảnh hưởng đến khả năng tùy chỉnh, ít ảnh hưởng fairness.

#### RISK 4: Task order cố định, không randomized
Tất cả models nhận tasks theo cùng thứ tự (T1→T10). Đây là **điều tốt cho fairness** nhưng không test order sensitivity. Nếu model có context window issues, model nhận nhiều context ở turn sau sẽ có lợi thế/bất lợi nhất quán.

**Severity: LOW** — Acceptable tradeoff.

---

## 2. Scoring Validity — Điểm số có đúng không

### 2.1 Pipeline chấm điểm

```
Transcript
    │
    ├── Tool Trace Evaluator (deterministic)
    │   analyzeToolTrace() — validate tool calls vs schemas
    │   Score = (validCalls/totalCalls)*100 - penalties
    │   Penalties: unknownTool*20 + malformedArgs*15 + missingRequired*8
    │
    └── Checklist LLM Judge (non-deterministic)
        buildJudgePrompt() → chatCompletion(judge, temperature=0)
        Axes: completion, grounding, clarification (nullable), tool_use (nullable)
        Retry up to 3 times if parse fails
        │
        └── combineWeightedScores(breakdown) → task_score (0-100)
            With tools:    completion*0.40 + grounding*0.25 + toolUse*0.15
                           + clarification*0.10 + toolTrace*0.10
            Without tools: completion*0.55 + grounding*0.30 + clarification*0.15
            (null values excluded + weights re-normalized)
            │
            └── finalScore = mean(task_scores)   ← simple arithmetic mean
```

### 2.2 Điểm tốt của scoring

- **Hybrid approach**: Kết hợp deterministic (tool trace) + LLM judgment → giảm pure LLM bias
- **Null-safe weight re-normalization**: `combineWeightedScores()` xử lý đúng khi `clarification` hoặc `toolUse` là null
- **Tool trace penalty structure**: Phân biệt unknown tools (severe -20), malformed args (moderate -15), missing required (-8) — reasonable severity ordering
- **Score clamping**: Tất cả scores bị clamp về 0-100 tại nhiều điểm
- **Segment-based evaluation**: Transcript được split theo user turns → judge chấm per-task, không phải toàn bộ conversation

### 2.3 Issues với scoring

#### ISSUE 1: Simple mean — task difficulty không được weight
```
src/lib/visualEvalRunner.ts, line 652-654:
const finalScore = taskResults.length
  ? clampScore(taskResults.reduce((sum, task) => sum + task.score, 0) / taskResults.length)
  : null
```
T4 (lấy 10 ứng viên gần nhất) và T10 (soạn email + lưu template) đều đóng góp 1/10 vào finalScore dù complexity rất khác nhau. Theo BENCHMARK_REPORT.md, khoảng cách điểm T4 giữa top model (88) và bottom (40) là 48 điểm — nếu T4 là task quan trọng hơn, current weighting underweights sự phân hóa này.

**Impact:** Moderate — finalScore phản ánh số lượng tasks hoàn thành, không phải quality của tasks khó.

#### ISSUE 2: Business ID validation hardcoded trong evaluator core
```
src/lib/visualEvalEvaluators.ts, lines 65-66:
const CANDIDATE_ID_RE = /^CAND-\d{4,}$/i
const RECRUITMENT_ID_RE = /^RJ[A-Z0-9-]+$/i
```
Và trong judge prompt (line 436-437):
```
"- CandidateID must use the form CAND-XXXX and RecruitmentID must use the form RJ...."
```
Những rules này **chỉ đúng cho domain AVA Tuyển Dụng**. Nếu dùng Visual Eval cho domain khác (CRM, logistics, finance), validator sẽ không penalize sai ID format (vì không có pattern match), nhưng nếu domain đó có ID conventions khác, sẽ không được enforce. Ngược lại, judge prompt chứa business rules cụ thể → judge sẽ bị confused khi chấm domain khác.

**Impact:** High nếu dùng cross-domain. Hiện tại acceptable vì chỉ dùng cho 1 domain.

#### ISSUE 3: Tool Trace penalty có thể quá harsh trong edge cases
```
penalty = unknownTools*20 + malformedArguments*15 + missingRequiredArguments*8
```
Ví dụ: Model gọi 5 tools, 4 valid + 1 unknown tool (hallucinated tool name):
```
baseScore = (4/5)*100 = 80
penalty = 1*20 = 20
toolTrace score = 60
```
Nhưng nếu model gọi 1 tool, 0 valid + 1 unknown:
```
baseScore = 0
penalty = 20
toolTrace score = clamp(0-20) = 0
```
Cả 2 cases đều "gọi 1 tool sai" nhưng context rất khác nhau. Hiện tại không có normalization penalty theo số lượng calls.

**Impact:** Low-Medium — Ảnh hưởng edge cases, không systematic bias.

#### ISSUE 4: Judge prompt dài với business-specific instructions
Judge prompt (`buildJudgePrompt`) bao gồm ~20 dòng instructions cụ thể về behavior được expect (ask clarification, business IDs, etc.). Đây là **opinionated evaluation** — đánh giá model có follow những conventions này không, không phải general capability. Điều này là intentional nhưng cần được document rõ: **đây là domain-specific benchmark, không phải general LLM benchmark**.

---

## 3. Leaderboard Objectivity

### 3.1 Merge Mode mặc định — Optimistic Bias

```
src/app/leaderboard/page.tsx, line 165:
const [mergeMode, setMergeMode] = useState(true)
```

```
src/app/leaderboard/page.tsx — mergeRunsByModel():
// Picks run with highest global average for each model
if (!existing || runGlobalAvg(r) > runGlobalAvg(existing)) {
  byModel.set(r.model, r)
}
```

Mặc định, leaderboard chỉ show **run tốt nhất** (highest global avg) cho mỗi model. Hệ quả:
- Model chạy 5 lần và có 1 run tốt sẽ xuất hiện với điểm cao nhất đó
- Model chỉ chạy 1 lần không có "retry advantage"
- Variance không được hiển thị → user không biết model A có run từ 50% đến 80% (variance=30) so với model B luôn ổn định 65% (variance=0)

**Recommendation:** Đổi label button thành "Best run per model (optimistic)" và consider default `mergeMode=false` hoặc thêm variance indicator.

### 3.2 Global Average Aggregation

```
src/app/leaderboard/page.tsx — getGlobalAvg():
// Simple mean of active group averages
for (const g of allGroups) {
  if (!activeGroups.has(g.id)) continue
  const a = getGroupAvg(entry, g)  // mean of tasks in group
  if (a !== null) { total += a; count++ }
}
return count ? total / count : 0
```

Global avg = mean(group averages). Nhưng:
- Group "Intent & Routing" có 3 tasks (htkh_intent_classification, htkh_intent_routing, crm_intent_analysis)
- Group "Tool Calling" có 2 tasks
- Mỗi group đóng góp ngang nhau vào global avg dù số tasks khác nhau → group ít tasks có weight per-task cao hơn.

**Impact:** Minor cho comparisons trong cùng benchmark, nhưng misleading khi interpreting "global average".

### 3.3 Visual Eval Mixed với Dataset Eval

```
src/app/leaderboard/page.tsx — getActiveGroups():
const unclassified = [...allTasks].filter(t => !knownTasks.has(t))
// → dumped into "Visual Eval / Other" group
```

Visual Eval task scores (từ LLM judge) và Dataset Eval scores (từ exact_match, BLEU, etc.) đều appear trong cùng leaderboard, cùng được average vào global avg. Hai loại này **không cùng thang đo**:
- Dataset eval: deterministic, reproducible, ground-truth-based
- Visual eval: LLM judge, subjective, scenario-dependent

**Impact:** Medium — Leaderboard global avg là con số misleading nếu trộn 2 loại này.

### 3.4 Top-2 Anchoring

```
src/app/leaderboard/page.tsx, line 315-316:
<h1 className="text-3xl font-bold text-[#1A1A1A] tracking-tight mb-2">
  {filtered[0].model} vs {filtered[1].model}
```

H1 của trang luôn là "ModelA vs ModelB" (top 2 models sau sort). Score pills của top 2 models được hiển thị prominently trong header. Tạo anchoring bias — attention của người xem bị pull về top 2.

**Impact:** Presentational, không ảnh hưởng tính đúng của data.

---

## 4. Reproducibility

### 4.1 Những gì đã lưu

```typescript
// src/types/index.ts — SimulationResult
{
  simId: string,
  scenarioName: string,
  targetModel: string,            // ✅ target model name
  userModel: string,              // ✅ user model name (or "replay:N turns")
  date: string,
  durationMs: number,
  turns: SimulationTurn[],        // ✅ full transcript
  finalScore: number | null,
  finalAssessment: string,
  taskResults: TaskResult[],      // ✅ per-task breakdown
  evaluationStatus: string,
  evaluationDebug: {              // ✅ raw judge response
    rawJudgeResponse: string
  }
}
```

Transcript đầy đủ được lưu → có thể replay conversation và re-evaluate thủ công. `taskResults` bao gồm `breakdown` (completion/grounding/clarification/toolUse/toolTrace) → auditable.

### 4.2 Những gì KHÔNG lưu (reproducibility gaps)

| Thiếu | Hệ quả |
|-------|--------|
| **Judge model name/baseUrl** | Không biết score được chấm bởi judge nào; re-run với judge khác cho kết quả khác |
| **Oracle model name/baseUrl** | Không biết oracle model nào được dùng; ảnh hưởng đến tool response quality |
| **Judge prompt hash/version** | Judge prompt trong code có thể thay đổi; old scores không comparable với new scores sau code update |
| **Replay script** | Phải reconstruct từ `turns` (user messages), không embed trực tiếp |
| **Tool definitions used** | Tools dùng trong simulation không lưu vào result file |
| **Oracle cache** | Shared oracle cache không được persist → re-run sẽ tạo oracle responses mới |

### 4.3 Ví dụ reproduce gap thực tế

Từ `BENCHMARK_REPORT.md`:
> "Avg = trung bình 10 task scores. Final = điểm holistic do judge LLM chấm."

Kết quả của `misa-ai-1.1-plus`: Avg = 66.8%, Final = 67. Nhưng:
- Judge model nào chấm? Không biết từ result file.
- Nếu run lại với judge khác, Final có thể khác đáng kể.
- Nếu code judge prompt đã thay đổi từ ngày 27/03, score không comparable.

---

## 5. Đánh giá theo Chuẩn Benchmark Khoa học

So sánh với standards của HELM, BIG-Bench, MT-Bench, và enterprise LLM evaluation best practices:

| Tiêu chí | Cơ chế hiện tại | Verdict | Notes |
|----------|----------------|:-------:|-------|
| **Fixed test set** | Replay script tạo fixed user messages cho batch | ✅ PASS | Tốt |
| **Blind evaluation** | Judge không biết model name trong transcript | ✅ PASS | Judge chỉ thấy "ASSISTANT:", không biết tên model |
| **Controlled conditions** | Same replay script, same oracle responses (batch) | ✅ PASS | Chỉ trong batch mode |
| **Independent evaluation** | Judge có thể là cùng provider với target | ⚠️ PARTIAL | Recommendation: tách judge khỏi user model |
| **Statistical significance** | Không có p-value, confidence intervals | ❌ FAIL | 1 run per model không đủ để claim significance |
| **Inter-rater reliability** | 1 LLM judge, không có human annotation | ❌ FAIL | LLM judges có systematic biases |
| **Task difficulty control** | Simple mean, không weighted | ❌ FAIL | Tất cả tasks đóng góp ngang nhau |
| **Reproducibility** | Transcript lưu, nhưng thiếu judge/oracle metadata | ⚠️ PARTIAL | Xem mục 4 |
| **Prompt versioning** | Không có | ❌ FAIL | Judge prompt thay đổi → scores không comparable |
| **Domain generalizability** | Business ID rules hardcoded cho AVA domain | ⚠️ PARTIAL | Cần refactor để dùng cross-domain |
| **Result persistence** | JSON files on disk, export JSON/Markdown | ✅ PASS | Tốt |
| **Error/variance reporting** | Không hiển thị std, confidence intervals | ❌ FAIL | Single number không đủ |
| **Baseline comparison** | Không có baseline model | ⚠️ PARTIAL | Cần 1 known baseline để anchor scale |

**Score: 4 PASS / 4 PARTIAL / 5 FAIL** → Đạt chuẩn nội bộ, chưa đạt chuẩn academic/public benchmark.

---

## 6. Production Readiness

### Scenario 1: Internal R&D — So sánh models để ra quyết định chọn model
**Verdict: READY ✅**

Điều kiện sử dụng đúng:
- Luôn dùng **batch mode** để so sánh multiple models (không chạy riêng lẻ rồi so sánh)
- Dùng cùng scenario và judge config cho tất cả models
- Chạy trong cùng một session để oracle cache được share
- Hiểu rằng điểm số có margin of error ~±5 points (do LLM judge variance)

### Scenario 2: Enterprise Production Evaluation Gate (go/no-go cho model deployment)
**Verdict: CONDITIONAL ⚠️**

OK nếu:
- Fix P0 issues (lưu judge metadata, tách judge model)
- Chạy 3+ runs per model và lấy median (không best)
- Document judge model và version dùng để chấm
- Có human spot-check 10-20% results

Không OK nếu:
- So sánh với runs từ trước khi code thay đổi
- Dùng single run per model để ra quyết định
- Không biết judge model nào được dùng

### Scenario 3: Public Benchmark (publish so sánh, claim SOTA)
**Verdict: NOT READY ❌**

Cần thêm:
- Statistical significance testing (min 5 runs per model, bootstrap CI)
- Independent judge (không cùng provider với target)
- Human annotation cho inter-rater reliability
- Prompt versioning và public disclosure
- Remove domain-specific rules khỏi evaluator core
- Multi-judge consensus

---

## 7. Known Bugs từ Benchmark Thực tế (BENCHMARK_REPORT.md)

### Bug 1: Oracle ID Format Inconsistency
**Status: CONFIRMED** — Từ BENCHMARK_REPORT.md:
> "Oracle sinh `UV1023` / `CAND-1023` / `1023` lẫn lộn. 5/9 model bị ảnh hưởng ở T5/T6."

**Root cause:** Oracle system prompt enforce ID format trong text, nhưng không có structural validation trước khi cache. Khi oracle trả `UV1023`, Tool Trace validator (`validateBusinessIdField`) detect và penalize tool_use score, nhưng judge có thể không penalize đủ mức vì judge thấy "tool returned a result" dù result có malformed IDs.

**Code location:**
```
src/lib/visualEvalRunner.ts — buildOracleSystemPrompt():
"- CandidateID: always use format 'CAND-XXXX'..."
```
Text instruction, không phải code enforcement.

**Fix direction:** Validate oracle output JSON và reformat IDs trước khi cache/use. Hoặc: thêm post-processing layer sau oracle response.

### Bug 2: fit_score Tool Thiếu Context
**Status: CONFIRMED** — Từ BENCHMARK_REPORT.md:
> "Tool trả về điểm số, model paraphrase tên field thay vì đọc CV thực."

**Root cause:** Oracle system prompt có rule: "For fit score tools: always include a Summary field with 1-2 sentences and CVHighlights array with 2-3 skills". Nhưng rule này phụ thuộc vào Oracle LLM follow đúng instructions. Nếu oracle trả thiếu, model không có content để reason about.

**Code location:**
```
src/lib/visualEvalRunner.ts — buildOracleSystemPrompt(), line 445:
"For fit score tools (e.g. get_candidate_fit_score...): always include a 'Summary' field..."
```

**Fix direction:** Add `get_candidate_fit_score` mock template vào mockContext hoặc enforce schema validation cho oracle output của specific tool types.

### Bug 3: T10 Email Template Flow
**Status: UNSTABLE** — Từ BENCHMARK_REPORT.md:
> "misa-ai-1.0-plus: T10 = 0"

**Root cause:** T10 yêu cầu: (1) soạn email, (2) gọi `save_email_template`, (3) oracle phải trả `{"success": true, "id": "..."}`. Nếu oracle trả response khác format, target model không biết save thành công và judge penalize "action not confirmed". Khi không dùng batch oracle cache, oracle response của step này không ổn định.

**Fix direction:** Add explicit mock cho `save_*` tools trong mockContext với guaranteed structure.

---

## 8. Priority Recommendations

### P0 — Critical (fix trước khi dùng làm benchmark chuẩn)

**P0.1: Lưu judge model metadata vào SimulationResult**

File: `src/types/index.ts` + `src/lib/visualEvalRunner.ts`
```typescript
// Add to SimulationResult type:
judgeModel?: string       // model name used as judge
judgeBaseUrl?: string     // baseUrl of judge
judgePromptVersion?: string  // hash of judge prompt used
```
Trong `_runSimulation()`, thêm vào `result` object trước khi save.

**P0.2: Enforce judge model tách khỏi user model trong config UI**

File: `src/app/visual-eval/page.tsx` + `src/store/visualEvalStore.ts`
Thêm optional "Judge Model" config section riêng. Nếu không config, warn user: "Judge = User Model — có thể có provider bias".

**P0.3: Fix Oracle ID format consistency**

File: `src/lib/visualEvalRunner.ts` — sau khi nhận oracle response, validate và reformat IDs.
Hoặc: thêm explicit ID format examples vào `mockContext` auto-generation.

---

### P1 — High (ảnh hưởng fairness/validity)

**P1.1: Hiển thị variance trong leaderboard**
Khi model có multiple runs, show `mean ± std` thay vì chỉ best run.

**P1.2: Đổi label/default của mergeMode**
Đổi label button: "Best run (optimistic)" thay vì "Per model". Hoặc default `mergeMode = false`.

**P1.3: Lưu replay script vào SimulationResult**
Thêm `replayScript?: string[]` vào `SimulationResult` type và populate khi save.

**P1.4: Tách domain-specific business rules ra config**
Thay vì hardcode `CAND-XXXX` patterns trong evaluator core, make chúng configurable trong scenario config.

---

### P2 — Medium

**P2.1: Multi-judge consensus**
Option chạy evaluation với 2-3 judge models và lấy median score.

**P2.2: Hiển thị judge debug panel**
Collapsible panel trong UI để xem `rawJudgeResponse` và từng task's judge reasoning.

**P2.3: Lưu oracle model và tool definitions vào result**
Để full reproducibility.

---

### P3 — Low (academic completeness)

**P3.1: Task difficulty weighting**
Cho phép assign weight per task trong scenario config.

**P3.2: Statistical testing**
Bootstrap confidence intervals khi có 3+ runs per model.

**P3.3: Prompt versioning**
MD5/SHA hash của judge prompt, lưu trong result. Cảnh báo khi load result từ khác prompt version.

---

## 9. Summary cho Engineering Team

### Dùng đúng cách — Visual Eval hoạt động tốt

Để có kết quả công bằng và đáng tin cậy với current implementation:

1. **Luôn dùng Batch Mode** khi so sánh multiple models — đây là cơ chế fairness chính
2. **Dùng cùng judge model** cho tất cả comparisons trong một benchmark cycle
3. **Không mix runs từ các ngày khác nhau** vào cùng một comparison nếu code đã thay đổi
4. **Hiểu margin of error**: LLM judge có sai số ~±5 điểm — khoảng cách < 5% giữa 2 models không statistically significant
5. **Coi `mergeMode=true` là optimistic view** — toggle sang "Per run" để thấy variance

### Red flags cần tránh

- So sánh model A chạy single run với model B chạy single run (khác ngày) và kết luận A > B vì 66.8% > 66.0% — khoảng cách < 5%, không significant
- Dùng Visual Eval score để ra quyết định production mà không biết judge model nào chấm
- Trộn Visual Eval score và Dataset Eval score vào Global Avg để rank models

### Kết luận

Visual Eval của crab-eval là **một internal benchmark tool tốt** với cơ chế fairness batch được thiết kế chu đáo. Benchmark AVA Tuyển Dụng (9 models, 10 tasks) cho thấy tool hoạt động đúng intent. Để nâng lên chuẩn production benchmark chính thức, cần fix 3 issues P0 về metadata và judge isolation. Để nâng lên chuẩn academic/public, cần thêm substantial work về statistical testing và inter-rater reliability.

---

*Generated by automated code review · crab-eval Visual Eval Review · 27/03/2026*
*Files reviewed: visualEvalRunner.ts, visualEvalEvaluators.ts, leaderboard/page.tsx, visual-eval/page.tsx, resultsStore.ts, types/index.ts, BENCHMARK_REPORT.md*
