# Metrics Overview — Crab Eval

> Tổng quan tất cả metric đang có trong codebase, metric nào đang được dataset nào dùng, và khoảng trống chưa cover.
> Tham chiếu code: `src/lib/metrics.ts` (programmatic), `src/lib/evalRunner.ts` (LLM-as-judge).

---

## 1. Hai loại metric

| Loại | Nơi tính | Đặc điểm |
|---|---|---|
| **Programmatic** | `metrics.ts` chạy thuần client-side | Nhanh, deterministic, không tốn API call |
| **LLM-as-judge** | `evalRunner.ts` gọi judge model | Chậm hơn, tốn token, đánh giá chất lượng ngữ nghĩa |

Mỗi dataset khai báo `metadata.gt_metrics: string[]` — runner dispatch theo tên metric. Thêm metric mới chỉ cần khai báo trong `gt_metrics`, **không sửa runner**.

---

## 2. Metrics đang được thực thi (theo dataset hiện có)

| Task type | Dataset | Metrics đang chạy |
|---|---|---|
| `tool_calling` | `ava_tool_calling_50`, `recruitment_tool_calling_60` | `ast_accuracy`, `task_success_rate`, `tool_call_exact` |
| `qa` (classification) | `crm_intent_analysis_57`, `htkh_intent_classification_150`, `htkh_intent_routing_154` | `accuracy` |
| `qa` (open-ended) | `crmmisa_dashboard_150` | `answer_relevancy`, `answer_correctness` |
| `qa` (ranking/list) | `crm_recommendation_150`, `makt_forecast_150` | `list_match`, `answer_correctness` |
| `rag` | `htkh_rag_qa_150` | `faithfulness`, `answer_relevancy` |
| `translation` | `mtrans_translation_85`, `mtrans_translation_150` | `bleu` (alias của `bleu1`) |

---

## 3. Bảng metric đầy đủ — cách tính & khi nào dùng

### 3.1 Programmatic metrics

| Metric | Công thức ngắn gọn | Yêu cầu | Dùng cho |
|---|---|---|---|
| `exact_match` | `normalize(out) == normalize(ref)` → 0/100 | `reference` | Classification strict |
| `accuracy` | Exact match + standalone label match + override qua `metadata.{unknown_label, unknown_synonyms, valid_label_range}` | `reference` | Intent routing/classification |
| `token_f1` | F1 trên unigram overlap, dùng `Intl.Segmenter` cho CJK/VN | `reference` | QA, summarization |
| `bleu1` / `bleu` | Unigram precision × brevity penalty | `reference` | Translation |
| `rouge_l` | F1 trên LCS giữa output và reference | `reference` | Summarization |
| `list_match` | `|intersection| / |reference|` (set recall, order-insensitive). Parse JSON array hoặc 1-item-per-line | `reference` (JSON array hoặc list) | Ranking / recommendation |
| `ast_accuracy` | `0.6 × name_match + 0.4 × matched_keys / expected_keys` | `expected_tool_calls` | Tool calling (partial credit) |
| `task_success_rate` | Binary: tool name khớp → 100, sai → 0 | `expected_tool_calls` | Tool calling (loose) |
| `tool_call_exact` | Binary: name + tất cả required keys phải khớp (key normalize: lowercase + strip `_`) | `expected_tool_calls` | Tool calling (strict) |
| `refusal_accuracy` | Match `expected_behavior` ∈ `{refuse, comply, clarify}`. `clarify` check `?` trong output | `metadata.expected_behavior`; optional `metadata.refusal_phrases` | Safety |
| `word_count_compliance` | `len(tokens) <= max_words` → 0/100 | `metadata.max_words: number` | Summarization length constraint |

### 3.2 LLM-as-judge metrics

| Metric | Judge prompt đánh giá điều gì | Yêu cầu |
|---|---|---|
| `answer_correctness` | Output có đúng so với reference không | `reference` |
| `answer_relevancy` | Output có liên quan đến question không | `input` |
| `faithfulness` | Output có grounded vào context, không hallucinate | `record.context` HOẶC `metadata.source_text` |
| `criteria_score` | Mỗi assertion trong reference (newline-separated) đạt/không đạt → tỉ lệ pass | `reference` (multi-line criteria) |
| `context_retention` | Trong multi-turn, model có nhớ context turn trước không | `conversation_history` |
| `consistency_score` | Multi-turn có nhất quán giữa các turn không | `conversation_history` |
| `instruction_adherence` | Output có tuân thủ từng constraint trong list không | `metadata.constraints: string[]` |
| `coverage_score` | Output có cover từng key fact không | `metadata.key_facts: string[]` |

**Judge parsing**: ưu tiên `<score>N</score>`, `Score: N`, `Rating: N`; fallback **số CUỐI** trong text (tránh bug "Out of 10 → 10").

**Pass/fail aggregate**: `passFailToScore(results, expectedCount)` slice đến `expectedCount` — thừa thì ignore, thiếu đếm fail.

**Judge concurrency**: global semaphore cap = `max(2, concurrency × 2)` để tránh fan-out giết upstream.

---

## 4. Mapping metric → task ý nghĩa

| Task | Programmatic | LLM-as-judge |
|---|---|---|
| Classification / intent | `exact_match`, `accuracy` | — |
| QA (open) | `token_f1` | `answer_correctness`, `answer_relevancy` |
| RAG | — | `faithfulness`, `answer_relevancy` |
| Summarization | `rouge_l`, `token_f1`, `word_count_compliance` | `coverage_score` |
| Translation | `bleu1` | — |
| Ranking / recommendation | `list_match` | — |
| Tool calling | `ast_accuracy`, `task_success_rate`, `tool_call_exact` | `criteria_score` |
| Safety | `refusal_accuracy` | — |
| Multi-turn | — | `context_retention`, `consistency_score` |
| Instruction following | `word_count_compliance` | `instruction_adherence` |

---

## 5. Khoảng trống — chưa có dataset cover

Các metric đã code nhưng zero dataset thật để verify:

- **Summarization**: `rouge_l`, `coverage_score`, `word_count_compliance`
- **Multi-turn**: `context_retention`, `consistency_score`
- **Instruction following**: `instruction_adherence`
- **Safety**: `refusal_accuracy`

Các task chưa có metric nào trong codebase:

- **Vision** (OCR, VQA, document understanding) — chưa có support image input
- **Reference-free / self-supervised** — mọi metric hiện tại đều cần `reference` hoặc judge có ground truth
- **Translation neural metrics** — chỉ có `bleu1`, thiếu chrF/COMET/BERTScore vốn fit cho VN và morphology-rich languages
- **Statistical** — chưa có confidence interval, significance test, inter-judge agreement

---

## 6. Thêm metric mới — checklist

1. Implement function trong `src/lib/metrics.ts` (programmatic) hoặc thêm prompt + xử lý trong `src/lib/evalRunner.ts` (judge)
2. Thêm case mới vào dispatcher `computeMetrics()` (chỉ programmatic)
3. Update bảng metric trong `CLAUDE.md` + `README.md` + file này
4. Tạo dataset test có `gt_metrics` chứa metric mới → chạy thử trên 1-2 model
5. Viết golden test đối chiếu với lib Python (`sacrebleu`, `evaluate`, `nltk`...)
6. **KHÔNG hard-code keyword ngôn ngữ cụ thể** — dùng `record.metadata.*` overrides

---

## 7. Tham khảo nhanh

- **File metric chính**: `src/lib/metrics.ts:1-466`
- **Dispatcher**: `computeMetrics()` ở `metrics.ts:365`
- **Judge logic**: `src/lib/evalRunner.ts` — search `judge` để xem prompt + parsing
- **Tokenize VN/CJK**: `tokenize()` ở `metrics.ts:27` dùng `Intl.Segmenter`
- **Type definitions**: `src/types/index.ts`
