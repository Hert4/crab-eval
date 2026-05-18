# Hướng dẫn Đánh giá với Crab Eval

> Tài liệu này mô tả hai pipeline chính: **Tool-Calling** (đánh giá agent gọi function) và **QA/RAG** (đánh giá trả lời câu hỏi từ tài liệu).

---

## Mục lục

1. [Chọn pipeline phù hợp](#1-chọn-pipeline-phù-hợp)
2. [Pipeline Tool-Calling](#2-pipeline-tool-calling)
3. [Pipeline QA/RAG](#3-pipeline-qârag)
4. [Scoring — Cách tính điểm](#4-scoring--cách-tính-điểm)
5. [Chạy Eval và đọc kết quả](#5-chạy-eval-và-đọc-kết-quả)
6. [Phân tích kết quả chi tiết](#6-phân-tích-kết-quả-chi-tiết)
7. [Các lỗi thường gặp](#7-các-lỗi-thường-gặp)
8. [Kết quả benchmark thực tế](#8-kết-quả-benchmark-thực-tế)

---

## 1. Chọn pipeline phù hợp

| Loại tài liệu | Pipeline | Metrics |
|---|---|---|
| Spec mô tả API / tool / function của agent | **Tool-Calling** | `tool_call_exact` + `criteria_score` |
| FAQ / chính sách / hướng dẫn nghiệp vụ | **QA/RAG** | `faithfulness` + `answer_relevancy` |

Task Generator tự động detect loại tài liệu sau khi upload. Kết quả hiện thị dưới dạng badge và bạn có thể override nếu cần.

---

## 2. Pipeline Tool-Calling

### 2.1 Tổng quan luồng

```
Tài liệu mô tả agent (PDF/text)
        │
        ▼
[Task Generator — Step 1]
  Extract atomic subtasks + System Prompt + Tool Definitions
        │
        ▼
[Step 2: Compose Tasks]
  Kết hợp subtasks → composite tasks (difficulty, persona, edge cases)
        │
        ▼
[Step 3: Generate Questions]
  LLM sinh userMessage tự nhiên cho mỗi task
        │
        ▼
[Step 4: Generate Tool Call Arguments]
  LLM sinh expected_tool_calls cho mỗi task
        │
        ▼
[Send to Run Eval]
  Dataset: {input, reference, tools, expected_tool_calls}
        │
        ▼
[Run Eval → Scoring]
  tool_call_exact (binary) + criteria_score (LLM judge)
```

### 2.2 Chuẩn bị tài liệu đầu vào

Tài liệu (PDF hoặc text) phải mô tả:
- Các **skill / chức năng** agent hỗ trợ
- Các **tool** tương ứng với mỗi skill
- **Input/output** của từng tool

### 2.3 Tool Definitions JSON

File JSON định nghĩa tools theo chuẩn OpenAI function calling. **Quan trọng: tên param phải nhất quán** — đây là ground truth để gen `expected_tool_calls`.

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

> **Lưu ý:** Nếu tool API thực tế dùng PascalCase (`CandidateName`) nhưng benchmark dùng snake_case, eval sẽ đánh giá theo convention trong Tool Definitions JSON — không phải theo schema API gốc.

### 2.4 Step 4: Generate Tool Call Arguments

**Bước quan trọng nhất** — LLM sinh `expected_tool_calls` dựa trên tool spec, `userMessage`, và metadata task.

| Điều kiện | expected_tool_calls |
|-----------|---------------------|
| Input có đủ tất cả required params | `[{name, arguments}]` |
| Thiếu bất kỳ required param nào | `[]` (agent nên hỏi lại) |
| out_of_scope / ambiguous không rõ | `[]` |
| partial / ambiguous info completeness | Lean về `[]` |

**Quy tắc gen:**
- Chỉ sinh **required params**, không sinh optional
- Dùng **giá trị từ userMessage**, không tự suy diễn
- Date range chỉ lấy khi **explicit hoàn toàn** ("từ 01/07 đến 31/07"), không tự tính từ "tháng 7"
- Param names phải **khớp chính xác** với Tool Definitions JSON

---

## 3. Pipeline QA/RAG

### 3.1 Tổng quan luồng

```
Tài liệu nghiệp vụ (FAQ / chính sách / hướng dẫn)
        │
        ▼
[Task Generator — Auto-detect: rag_qa]
        │
        ▼
[Step 1: Generate QA Pairs]
  Chunk tài liệu → LLM sinh 3-5 cặp QA mỗi chunk
  Mỗi cặp: question + reference answer + context chunk
        │
        ▼
[Step 2: Review QA Pairs]
  Chỉnh sửa / xóa pairs không phù hợp
        │
        ▼
[Send to Run Eval]
  Dataset: {input=question, reference=answer, context=chunk}
  gt_metrics: [faithfulness, answer_relevancy]
        │
        ▼
[Run Eval → Scoring]
  context inject làm system message
  LLM judge chấm faithfulness + answer_relevancy
```

### 3.2 Cấu trúc record QA/RAG

```json
{
  "id": "qa_001",
  "input": "Câu hỏi của người dùng",
  "reference": "Câu trả lời chuẩn từ tài liệu",
  "context": "Đoạn văn bản chứa thông tin để trả lời câu hỏi",
  "output": ""
}
```

`context` được inject vào system message khi gọi target model. Model không có context này trong production sẽ thấy điểm thấp hơn — đây là behavior đúng (đánh giá khả năng RAG).

### 3.3 QA metrics

- **`faithfulness`**: câu trả lời có căn cứ trong `context` không (không bịa thêm)
- **`answer_relevancy`**: câu trả lời có đúng hướng với câu hỏi không

Cả hai đều là LLM-as-judge — cần judge model được cấu hình trong Config page.

---

## 4. Scoring — Cách tính điểm

### 4.1 `tool_call_exact` (binary, 0 hoặc 100)

Metric chính cho tool-calling. **Không có điểm trung gian.**

```
expected_tool_calls = []  (task cần clarification)
  → model không gọi tool  → PASS (100)
  → model gọi tool        → FAIL (0)   ← gọi tool khi nên hỏi

expected_tool_calls = [{name, arguments}]  (task hoàn chỉnh)
  → model không gọi tool          → FAIL (0)
  → model gọi sai tool name       → FAIL (0)
  → model gọi đúng tool nhưng
    thiếu required param key      → FAIL (0)
  → model gọi đúng tool + đủ keys → PASS (100)
```

**Chi tiết:**
- So sánh **tên tool** (exact match)
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

### 4.2 `criteria_score` (LLM judge, 0–100)

LLM judge đánh giá response dựa trên assertion criteria. Cho phép partial credit.

**Điểm khác biệt với `tool_call_exact`:**
- `criteria_score` lenient hơn — bỏ qua param name case
- Có thể cho 100% dù model gọi sai param name convention
- `tool_call_exact` bắt đúng lỗi mà `criteria_score` bỏ qua

### 4.3 `faithfulness` và `answer_relevancy` (LLM judge, 0–100)

Dùng cho QA/RAG mode:
- **`faithfulness`**: judge đọc context và output, đánh giá output có được hỗ trợ bởi context không
- **`answer_relevancy`**: judge đánh giá output có trả lời đúng câu hỏi không

### 4.4 Kết hợp metrics tool-calling

| tool_call_exact | criteria_score | Ý nghĩa |
|---|---|---|
| 100 | 100 | Model đúng hoàn toàn |
| 100 | < 100 | Tool call đúng nhưng response thiếu sót |
| 0 | 100 | **Model gọi đúng intent nhưng sai param convention** |
| 0 | 0 | Model sai hoàn toàn |

---

## 5. Chạy Eval và đọc kết quả

### 5.1 Cấu hình

- **Config page**: target model + judge model (dùng cho mọi run từ đây)
- **Agents page**: tạo model profiles để chọn nhanh trong Config
- **Dataset**: dataset đã gen từ Task Generator

### 5.2 Luồng xử lý mỗi record

```
record.input + record.context → Target model (kèm tools nếu có) → tool_calls + output
                                                                          │
                              ┌───────────────────────────────────────────┤
                              ▼                                           ▼
                    toolCallExact(tool_calls,               judgeScore(output,
                      expected_tool_calls)                    reference, context)
                    → 0 or 100                               → 0-100
```

### 5.3 Kết quả lưu vào

```
results/{model-name}/{dataset-name}_{date}.json
```

---

## 6. Phân tích kết quả chi tiết

### 6.1 Phân nhóm fail (tool-calling)

```python
import json

data = json.load(open('results/model/dataset_date.json'))
logs = data['logs']

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

always_fail = [t for t, s in tool_stats.items() if s['pass'] == 0 and s['fail'] > 0]
print("Tools luôn fail:", always_fail)
```

### 6.3 Phân tích nguyên nhân fail

| Nguyên nhân | Cách nhận biết | Hành động |
|---|---|---|
| Sai param name convention | `criteria=100, exact=0` | Verify convention trong Tool Definitions JSON |
| Model không gọi tool khi nên gọi | `no_call=True`, `criteria>0` | Model cần cải thiện tool selection |
| Model gọi tool khi nên hỏi lại | `exact=0`, `expected=[]` | Model quá aggressive |
| `expected_tool_calls` gen sai | `criteria=100, exact=0`, task `complete` | Re-gen arguments |
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

## 7. Các lỗi thường gặp

### 7.1 `expected_tool_calls` dùng sai convention

**Triệu chứng:** Nhiều task `criteria=100, exact=0`.

**Nguyên nhân:** Tool Definitions JSON dùng để gen arguments và để run eval không đồng bộ.

**Fix:** Đảm bảo **cùng 1 file Tool Definitions JSON** cho cả 2 bước.

### 7.2 `expected_tool_calls = []` sai cho task `complete`

**Triệu chứng:** Task `complete`, input rõ ràng, model gọi tool đúng nhưng `exact=0`.

**Fix:** Re-generate Tool Call Arguments. Noise ~5-7% là bình thường.

### 7.3 Score không thay đổi sau khi re-gen

**Nguyên nhân:** Run eval đang dùng dataset cũ trong datasetsStore.

**Fix:** Sau khi re-gen, phải **Send to Run Eval** lại từ Task Generator để tạo dataset mới.

### 7.4 QA pairs chất lượng thấp

**Triệu chứng:** Câu hỏi không answerable, reference quá ngắn, context không chứa đủ thông tin.

**Fix:** Review và edit/delete pairs ở Step 2 trước khi export. Các pairs khó (difficulty=hard) thường cần review kỹ hơn.

### 7.5 `faithfulness` thấp dù model trả lời đúng

**Nguyên nhân:** Model thêm thông tin ngoài context (ví dụ: kiến thức chung, số liệu tự sinh).

**Đây là behavior đúng** — faithfulness đánh giá grounding, không phải correctness. Model RAG tốt phải chỉ dùng context được cung cấp.

### 7.6 So sánh model không fair

**Nguyên nhân:** 2 model eval trên 2 dataset khác nhau (gen ở thời điểm khác).

**Fix:** Luôn re-run tất cả models sau khi thay đổi dataset.

---

## 8. Kết quả benchmark thực tế

### 8.1 Tool-Calling — AVA Tuyển dụng (30/03/2026)

- **Dataset:** Task Generator — AVA Tuyển dụng · 116 tasks · 19 tools · snake_case params
- **Metrics:** `tool_call_exact` + `criteria_score`

| Rank | Model | tool_call_exact | criteria_score |
|:---:|---|:---:|:---:|
| 1 | misa-ai-1.1-plus | **69.83%** | 61.48% |
| 2 | misa-ai-1.1 | 68.97% | **64.35%** |
| 3 | gpt-5.4 | 68.10% | 65.77% |
| 4 | claude-sonnet-4-5 | 65.52% | 65.30% |
| 5 | gpt-4.1-mini | 60.34% | 65.08% |

**Nhận xét:**
- Top 3 chênh nhau chưa tới 2pp — không phân biệt được bằng benchmark này
- `claude-sonnet-4-5` aggressive hơn (ít no-call nhất) nhưng hay sai khi task cần clarification
- `gpt-4.1-mini` thấp nhất, cách top ~9pp — khoảng cách có ý nghĩa thống kê
- Lỗi phổ biến nhất: **param name convention** và **tool selection với partial tasks**

**Pattern lỗi chung:**

| Tool | Lý do fail phổ biến |
|------|---------------------|
| `get_candidates` | Sai convention key hoặc không gọi khi partial task |
| `get_multiple_candidates_fit_score` | Model hallucinate `candidate_i_ds` thay vì `candidate_ids` |
| `get_cv_content` | Expected=`[]` (partial) nhưng model gọi tool |

### 8.2 Agentic Simulation — AVA Tuyển dụng (27/03/2026)

- **Phương pháp:** Visual Eval · 9 models · 10 tasks · Oracle AI mock tools
- **Scoring:** LLM judge đọc transcript, chấm per-task 0–100

| Rank | Model | Avg | Final |
|:---:|---|:---:|:---:|
| 1 | misa-ai-1.1-plus | 66.8% | 67 |
| 2 | claude-opus-4-5 | 66.0% | 66 |
| 2 | gpt-5.4 | 66.0% | 66 |
| 4 | misa-ai-1.1 | 65.6% | 66 |
| 5 | claude-sonnet-4-5 | 64.8% | 65 |
| 6 | gpt-4.1 | 58.5% | 59 |
| 7 | misa-ai-1.0-plus | 58.0% | 58 |
| 8 | gpt-4.1-mini | 57.8% | 58 |
| 9 | misa-ai-1.0 | 56.0% | 56 |

---

## Appendix: File quan trọng

| File | Mô tả |
|---|---|
| `src/lib/taskGenerator.ts` | Gen subtasks, QA pairs, compose, gen questions, gen arguments |
| `src/lib/metrics.ts` | `toolCallExact()`, `computeMetrics()`, tất cả metrics |
| `src/lib/evalRunner.ts` | Pipeline chạy eval, chọn metrics từ `gt_metrics` |
| `src/store/taskGeneratorStore.ts` | State wizard Task Generator (detectedTaskType, qaPairs, ...) |
| `src/app/task-generator/page.tsx` | UI Task Generator (tool-calling + QA/RAG) |
| `src/types/index.ts` | Types: `GeneratedTask`, `QAPair`, `DataRecord`, `DatasetMetadata` |
| `datasets/` | Benchmark datasets (committed) |
| `results/` | Eval results (git-ignored) |
