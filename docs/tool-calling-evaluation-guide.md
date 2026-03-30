# Hướng dẫn Đánh giá Tool Calling — Crab Eval

> Tài liệu này mô tả toàn bộ luồng tạo dữ liệu benchmark và cách đánh giá chất lượng tool calling của AI agent, từ bước chuẩn bị đến phân tích kết quả.

---

## Mục lục

1. [Tổng quan luồng](#1-tổng-quan-luồng)
2. [Chuẩn bị dữ liệu đầu vào](#2-chuẩn-bị-dữ-liệu-đầu-vào)
3. [Task Generator — Tạo dataset](#3-task-generator--tạo-dataset)
4. [Scoring — Cách tính điểm](#4-scoring--cách-tính-điểm)
5. [Chạy Eval và đọc kết quả](#5-chạy-eval-và-đọc-kết-quả)
6. [Phân tích kết quả chi tiết](#6-phân-tích-kết-quả-chi-tiết)
7. [Các lỗi thường gặp và cách xử lý](#7-các-lỗi-thường-gặp-và-cách-xử-lý)
8. [Kết quả benchmark thực tế](#8-kết-quả-benchmark-thực-tế)

---

## 1. Tổng quan luồng

```
Tài liệu mô tả agent (PDF/text)
        │
        ▼
[Task Generator — Step 1-3]
  Extract subtasks → Compose tasks → Generate questions
        │
        ▼
[Generate Tool Call Arguments]
  LLM sinh expected_tool_calls cho mỗi task
        │
        ▼
[Send to Run Eval]
  Dataset: {input, reference, tools, expected_tool_calls}
        │
        ▼
[Run Eval — Target model]
  Model nhận input + tools → trả về tool_calls
        │
        ▼
[Scoring]
  tool_call_exact (binary) + criteria_score (LLM judge)
        │
        ▼
[Leaderboard]
  So sánh các model
```

---

## 2. Chuẩn bị dữ liệu đầu vào

### 2.1 Tài liệu mô tả agent

Tài liệu đầu vào (PDF hoặc text) phải mô tả:
- Các **skill/chức năng** agent hỗ trợ
- Các **tool** tương ứng với mỗi skill
- **Input/output** của từng tool

### 2.2 Tool Definitions JSON

File JSON định nghĩa tools theo chuẩn OpenAI function calling. **Quan trọng: tên param phải dùng `snake_case`** — đây là ground truth để gen `expected_tool_calls`.

```json
[
  {
    "type": "function",
    "function": {
      "name": "get_candidates",
      "description": "Load danh sách ứng viên theo tên và tên tin tuyển dụng.",
      "parameters": {
        "type": "object",
        "properties": {
          "candidate_name": { "type": "string", "description": "Tên ứng viên" },
          "recruitment_name": { "type": "string", "description": "Tên tin tuyển dụng" }
        },
        "required": ["candidate_name"]
      }
    }
  }
]
```

> **Lưu ý:** Nếu tool API thực tế dùng PascalCase (`CandidateName`) nhưng model dùng snake_case, benchmark sẽ đánh giá model theo tool definitions JSON bạn cung cấp — không phải theo schema API gốc.

### 2.3 Agent System Prompt

System prompt mô tả vai trò agent, danh sách tool available, và behavior guidelines (khi nào hỏi lại, khi nào từ chối).

---

## 3. Task Generator — Tạo dataset

### Step 1: Upload tài liệu

Upload tài liệu mô tả agent (PDF hoặc text). Hệ thống sẽ:
- Tự động detect ngôn ngữ
- Extract các atomic subtasks từ tài liệu
- Sinh system prompt và tool definitions (có thể chỉnh sửa)

### Step 2: Compose Tasks

Kết hợp các atomic subtasks thành composite tasks với:
- **Difficulty**: easy / medium / hard / expert
- **Persona**: expert / novice / out_of_scope
- **Info completeness**: complete / partial / ambiguous
- **Edge case**: entity_not_found / ambiguous_entity / missing_required_input / malformed_input / out_of_scope / conflicting_request

### Step 3: Generate Questions

LLM sinh `userMessage` tự nhiên cho từng composite task. Đây là input sẽ gửi đến target model khi eval.

### Step 4: Generate Tool Call Arguments ⚠️

**Bước quan trọng nhất** — LLM sinh `expected_tool_calls` dựa trên:
1. Tool spec (tool name + required params từ Tool Definitions JSON)
2. `userMessage` thực tế của task
3. `infoCompleteness` / `edgeCaseType` metadata

**Logic quyết định của LLM gen:**

| Điều kiện | expected_tool_calls |
|-----------|---------------------|
| userMessage có đủ tất cả required params | `[{name, arguments}]` |
| Thiếu bất kỳ required param nào | `[]` (agent nên hỏi lại) |
| out_of_scope / ambiguous không rõ | `[]` |
| partial / ambiguous info completeness | Lean về `[]` |

**Lưu ý khi gen:**
- Chỉ sinh **required params**, không sinh optional params
- Dùng **giá trị từ userMessage**, không tự suy diễn
- Date range chỉ được lấy khi **explicit hoàn toàn** ("từ 01/07 đến 31/07"), không tự tính từ "tháng 7"
- Param names phải **khớp chính xác** với Tool Definitions JSON (snake_case)

### Export và Send to Run Eval

Sau khi Generate Tool Call Arguments xong:
- **Export JSON**: lưu task set để backup / verify
- **Send to Run Eval**: tạo dataset trong store với `gt_metrics: ['criteria_score', 'tool_call_exact']`

---

## 4. Scoring — Cách tính điểm

### 4.1 `tool_call_exact` (binary, 0 hoặc 100)

Metric chính để đánh giá tool calling. **Không có điểm trung gian.**

```
expected_tool_calls = []  (task cần clarification)
  → model không gọi tool  → PASS (100)
  → model gọi tool        → FAIL (0)   ← model gọi tool khi nên hỏi

expected_tool_calls = [{name, arguments}]  (task hoàn chỉnh)
  → model không gọi tool          → FAIL (0)
  → model gọi sai tool name       → FAIL (0)
  → model gọi đúng tool nhưng
    thiếu required param key      → FAIL (0)
  → model gọi đúng tool + đủ keys → PASS (100)
```

**Chi tiết logic so sánh:**
- So sánh theo **tên tool** (exact match)
- Kiểm tra tất cả **required param keys** có trong `got_arguments` không (không check value)
- Model có thể truyền thêm params ngoài expected → vẫn PASS
- Thứ tự params không quan trọng

**Ví dụ:**
```
expected: get_candidates({candidate_name: "A"})
got:      get_candidates({candidate_name: "Trần Thị B", recruitment_name: "XYZ"})
→ PASS (tất cả expected keys có mặt)

expected: get_candidates({candidate_name: "A"})
got:      get_candidates({CandidateName: "Trần Thị B"})
→ FAIL (key "candidate_name" không có, chỉ có "CandidateName")
```

### 4.2 `criteria_score` (LLM-as-judge, 0-100)

LLM judge đánh giá response dựa trên assertion criteria. Cho phép partial credit.

- Judge đọc `reference` (assertion criteria) và `output` (response của model)
- Chấm điểm từng criterion: pass/fail
- Score = (số criteria pass / tổng criteria) × 100

**Điểm khác biệt với `tool_call_exact`:**
- `criteria_score` lenient hơn — bỏ qua param name case
- `criteria_score` có thể cho 100% dù model gọi sai param name
- `tool_call_exact` bắt đúng lỗi mà `criteria_score` bỏ qua

### 4.3 Kết hợp 2 metrics

| tool_call_exact | criteria_score | Ý nghĩa |
|---|---|---|
| 100 | 100 | Model đúng hoàn toàn |
| 100 | < 100 | Tool call đúng nhưng response thiếu sót |
| 0 | 100 | **Model gọi đúng intent nhưng sai param convention** |
| 0 | 0 | Model sai hoàn toàn |
| 0 | trung bình | Model sai tool/params nhưng response có giá trị |

> Case `exact=0, criteria=100` thường gặp khi model dùng sai convention param name (ví dụ `candidate_name` thay vì `CandidateName`). Đây là **lỗi thật** nếu API production yêu cầu đúng convention.

---

## 5. Chạy Eval và đọc kết quả

### 5.1 Cấu hình Run Eval

- **Target model**: model cần đánh giá
- **Judge model**: model chấm `criteria_score` (nên dùng model mạnh như GPT-4o)
- **Dataset**: dataset đã gen từ Task Generator (có `expected_tool_calls`)

### 5.2 Luồng xử lý mỗi record

```
record.input → Target model (với tools JSON) → tool_calls + output
                                                      │
                        ┌─────────────────────────────┤
                        ▼                             ▼
              toolCallExact(                  criteriaJudge(
                tool_calls,                    output,
                expected_tool_calls            reference_criteria
              ) → 0 or 100                   ) → 0-100
```

### 5.3 Kết quả lưu vào

```
results/{model-name}/Task_Generator_{date}.json
```

Cấu trúc file result:
```json
{
  "model": "misa-ai-1.1",
  "scores": {
    "tool_call_exact": 68.97,
    "criteria_score": 64.35
  },
  "logs": [
    {
      "id": "gt_ct_xxx",
      "input": "...",
      "tool_calls": [{"type": "function", "function": {"name": "...", "arguments": "..."}}],
      "scores": {"tool_call_exact": 100, "criteria_score": 75}
    }
  ]
}
```

---

## 6. Phân tích kết quả chi tiết

### 6.1 Script phân tích nhanh

```python
import json

data = json.load(open('results/model/Task_Generator_date.json'))
logs = data['logs']

# Phân nhóm
both100  = [l for l in logs if l['scores'].get('tool_call_exact')==100 and l['scores'].get('criteria_score',0)==100]
c100_e0  = [l for l in logs if l['scores'].get('tool_call_exact')==0   and l['scores'].get('criteria_score',0)>=100]
both0    = [l for l in logs if l['scores'].get('tool_call_exact')==0   and l['scores'].get('criteria_score',0)==0]
no_call  = [l for l in logs if not l.get('tool_calls')]

print(f"Overall: {data['scores']}")
print(f"both=100 (đúng hoàn toàn):      {len(both100)}")
print(f"criteria=100 exact=0 (sai case): {len(c100_e0)}")
print(f"both=0 (sai hoàn toàn):          {len(both0)}")
print(f"no tool call:                    {len(no_call)}")
```

### 6.2 Phân tích theo tool

```python
from collections import defaultdict

tool_stats = defaultdict(lambda: {'pass': 0, 'fail': 0})
for l in logs:
    tc = l.get('tool_calls', [])
    tool = tc[0]['function']['name'] if tc else '(no call)'
    if l['scores'].get('tool_call_exact') == 100:
        tool_stats[tool]['pass'] += 1
    else:
        tool_stats[tool]['fail'] += 1

# Tools luôn fail → candidate để debug
always_fail = [t for t, s in tool_stats.items() if s['pass'] == 0 and s['fail'] > 0]
print("Tools luôn fail:", always_fail)
```

### 6.3 Phân tích nguyên nhân fail

| Nguyên nhân | Cách nhận biết | Hành động |
|---|---|---|
| Model dùng sai param name convention | `criteria=100, exact=0`, keys trông đúng | Verify tool API thực tế dùng case nào |
| Model không gọi tool khi nên gọi | `no_call=True`, `criteria>0` | Model cần cải thiện tool selection |
| Model gọi tool khi nên hỏi lại | `tool_call=True`, `expected=[]` | Model quá aggressive |
| `expected_tool_calls` gen sai | `criteria=100, exact=0`, keys đúng, `complete` task | Re-gen arguments |
| Model gọi sai tool | Tool name khác expected | Model confuse giữa các tools |

### 6.4 So sánh 2 model

```python
logs_a = {l['id']: l for l in data_a['logs']}
logs_b = {l['id']: l for l in data_b['logs']}

a_better = [t for t in logs_a
            if logs_a[t]['scores'].get('tool_call_exact') == 100
            and logs_b.get(t, {}).get('scores', {}).get('tool_call_exact') == 0]

b_better = [t for t in logs_a
            if logs_a[t]['scores'].get('tool_call_exact') == 0
            and logs_b.get(t, {}).get('scores', {}).get('tool_call_exact') == 100]

print(f"A tốt hơn B: {len(a_better)} tasks")
print(f"B tốt hơn A: {len(b_better)} tasks")
```

---

## 7. Các lỗi thường gặp và cách xử lý

### 7.1 `expected_tool_calls` dùng PascalCase, model dùng snake_case

**Triệu chứng:** Nhiều task `criteria=100, exact=0`. Kiểm tra keys trong `expected_tool_calls`.

**Nguyên nhân:** Tool Definitions JSON (dùng để gen arguments) và Tool Definitions JSON (dùng trong eval) không đồng bộ — một cái PascalCase, một cái snake_case.

**Fix:** Đảm bảo **cùng 1 file Tool Definitions JSON** được dùng cho cả 2 bước: gen arguments và run eval.

### 7.2 `expected_tool_calls = []` sai cho task `complete`

**Triệu chứng:** Task `infoCompleteness=complete`, input rõ ràng, model gọi tool đúng nhưng `exact=0`.

**Nguyên nhân:** Gen model quá conservative, sinh `[]` cho task có đủ thông tin.

**Fix:** Re-generate Tool Call Arguments. Nếu vẫn sai, đây là noise ~5-7% không đáng kể nếu cả các model bị đều nhau.

### 7.3 Model dùng `candidate_i_ds` thay vì `candidate_ids`

**Triệu chứng:** Tool `get_multiple_candidates_fit_score` luôn fail với key `candidate_i_ds`.

**Nguyên nhân:** Model hallucinate tên param. Tool definitions có `candidate_ids` hoặc `CandidateIDs` nhưng model tự nghĩ ra `candidate_i_ds`.

**Fix:** Đây là lỗi thật của model. Không cần fix benchmark.

### 7.4 Score không thay đổi sau khi re-gen arguments

**Nguyên nhân:** Run eval đang dùng **dataset cũ** trong datasetsStore, không phải dataset mới.

**Fix:** Sau khi re-gen arguments, phải **Send to Run Eval** lại từ Task Generator để tạo dataset mới, sau đó re-run eval.

### 7.5 So sánh model không fair

**Nguyên nhân:** 2 model được eval trên 2 dataset khác nhau (gen ở thời điểm khác nhau).

**Fix:** Luôn re-run tất cả models sau khi thay đổi dataset.

---

## 8. Kết quả benchmark thực tế

### 8.1 Dataset

- **Tên:** Task Generator — AVA Tuyển dụng
- **Agent:** AVA Tuyển dụng (MISA AMIS)
- **Số task:** 116
- **Ngôn ngữ:** Tiếng Việt
- **Tools:** 19 tools (snake_case params)
- **Metrics:** `tool_call_exact` + `criteria_score`
- **Dataset:** `task-set-1774863094057.json`

### 8.2 Leaderboard

| Rank | Model | tool_call_exact | criteria_score | both=100 | no_call | both=0 |
|------|-------|-----------------|----------------|----------|---------|--------|
| 1 | misa-ai-1.1-plus | **69.83%** | 61.48% | 22 | 38 | 2 |
| 2 | misa-ai-1.1 | 68.97% | **64.35%** | **24** | 28 | 3 |
| 3 | gpt-5.4 | 68.10% | 65.77% | **24** | 32 | 4 |
| 4 | claude-sonnet-4-5 | 65.52% | 65.30% | 23 | **25** | 5 |
| 5 | gpt-4.1-mini | 60.34% | 65.08% | 23 | 31 | **7** |

> **Chú thích cột:**
> - `both=100`: task đúng hoàn toàn cả 2 metrics
> - `no_call`: số task model không gọi tool (đúng hoặc sai)
> - `both=0`: task sai hoàn toàn cả 2 metrics

### 8.3 Phân tích từng model

#### misa-ai-1.1-plus 🥇 (tool_call_exact: 69.83%)
- Đứng đầu `tool_call_exact` nhưng `criteria_score` thấp nhất (61.48%)
- **Conservative nhất**: 38 no-call — hay từ chối gọi tool, hay hỏi lại
- Khi quyết định gọi tool thì chính xác cao
- Điểm yếu: response quality kém khi không gọi tool

#### misa-ai-1.1 🥈 (tool_call_exact: 68.97%)
- Cân bằng nhất: `criteria_score` cao nhất (64.35%)
- Ít no-call hơn 1.1-plus (28 vs 38) — quyết đoán hơn trong việc gọi tool
- Chênh lệch với 1.1-plus chỉ **0.86pp** — không có ý nghĩa thống kê
- Top 5 tools fail: `get_candidates` (9), `get_data_for_gen_interview_question` (4), `get_cv_content` (4)

#### gpt-5.4 🥉 (tool_call_exact: 68.10%)
- `criteria_score` cao nhất trong nhóm (65.77%) — response quality tốt nhất
- Ngang với top 2 (~0.9pp) về `tool_call_exact`
- Top 5 tools fail: `get_candidates` (10), `get_cv_content` (5), `get_data_for_gen_interview_question` (4)

#### claude-sonnet-4-5 (tool_call_exact: 65.52%)
- Thấp hơn top 4.3pp — **thật**, không phải noise
- `criteria_score` cao (65.30%) — response quality tốt dù tool call sai
- **Aggressive nhất**: chỉ 25 no-call — hay gọi tool nhưng hay gọi sai (14 wrong_tool)
- Điểm yếu: hay gọi tool khi task yêu cầu hỏi lại (expected=`[]`)
- Top 5 tools fail: `get_candidates` (13), `get_schedule` (4), `get_cv_content` (4)

#### gpt-4.1-mini (tool_call_exact: 60.34%)
- Thấp nhất, cách top **9.49pp** — khoảng cách có ý nghĩa
- `criteria_score` trung bình (65.08%)
- Nhiều both=0 nhất (7) — hay sai hoàn toàn
- Điểm yếu nặng nhất với `get_candidates`: fail 14/20 lần
- Top 5 tools fail: `get_candidates` (14), `get_cv_content` (5), `get_multiple_candidates_fit_score` (3)

### 8.4 Pattern lỗi chung tất cả models

| Tool | Lý do fail phổ biến |
|------|---------------------|
| `get_candidates` | Model dùng `candidate_name` khi expected là `CandidateName`; hoặc không gọi khi partial task |
| `get_multiple_candidates_fit_score` | Model hallucinate key thành `candidate_i_ds` thay vì `candidate_ids` |
| `get_cv_content` | Expected=`[]` (partial) nhưng model gọi tool; hoặc sai convention key |
| `get_schedule` | Thiếu param `schedule_type` hoặc `scope` |
| `get_recruitment_board` | Sai convention `candidate_schedule_id` vs `CandidateScheduleID` |

### 8.5 Fail categories (trung bình tất cả models)

| Category | ~Số task/model | Mô tả |
|----------|---------------|-------|
| Sai param name convention | ~16 | `expected_tool_calls` dùng convention khác model |
| Model gọi tool khi nên hỏi | ~8 | expected=`[]` nhưng model gọi tool |
| Model gọi sai tool / sai params | ~11 | Nhầm tool, thiếu key |
| Model không gọi tool khi nên gọi | ~1 | Bỏ sót tool call |
| Expected gen sai (false negative) | ~6 | Gen model sinh sai — noise |

### 8.6 Kết luận

- **Top 3 (misa-ai-1.1-plus, misa-ai-1.1, gpt-5.4)** ngang nhau trong khoảng 1.73pp — không phân biệt được bằng benchmark này
- **claude-sonnet-4-5** rõ ràng kém hơn top 3 (~4pp) — aggressive hơn trong tool calling nhưng hay gọi sai
- **gpt-4.1-mini** thấp nhất, cách biệt có ý nghĩa (~9pp)
- `criteria_score` không phân biệt được models tốt (dao động 61-66%) — cần `tool_call_exact` để có discrimination power
- Lỗi phổ biến nhất toàn bộ: **param name convention** và **tool selection với partial tasks**

---

## Appendix: File quan trọng

| File | Mô tả |
|---|---|
| `src/lib/taskGenerator.ts` | Logic gen subtasks, compose, gen questions, gen arguments |
| `src/lib/metrics.ts` | `toolCallExact()`, `astAccuracy()`, `computeMetrics()` |
| `src/lib/evalRunner.ts` | Pipeline chạy eval, tính score |
| `src/app/task-generator/page.tsx` | UI Task Generator (4 steps) |
| `src/types/index.ts` | Types: `GeneratedTask`, `ToolCall`, `DataRecord` |
| `datasets/` | Benchmark datasets (committed) |
| `results/` | Eval results (git-ignored) |
