# Task: Phase 2 — TRACe RAG Metrics

**Owner**: intern
**Reviewer**: @tmduc3
**Estimate**: ~0.5 day
**Risk**: Low (additive — không sửa logic eval hiện tại)

## Bối cảnh

Crab-eval đang đánh giá task `rag_qa` chỉ với 2 metric judge: `faithfulness` và `answer_relevancy`. [RAGBench (arxiv:2407.11005)](https://arxiv.org/abs/2407.11005) đã chuẩn hóa **4 chiều TRACe** cho RAG eval. Chúng ta đang thiếu 2.

| Metric | Hỏi gì | Status |
|---|---|---|
| `faithfulness` | Answer có bịa thêm thông tin ngoài context không? | ✓ |
| `answer_relevancy` | Answer có trả lời đúng câu hỏi không? | ✓ |
| **`context_relevance`** | Context retrieve có liên quan câu hỏi không? | **Thêm mới** |
| **`context_utilization`** | Answer có thực sự dùng context, hay bỏ qua? | **Thêm mới** |

**Tại sao quan trọng**:
- `context_relevance` đánh giá *retriever*, không phải generator. Nếu retriever lấy nhầm chunk → `faithfulness` vẫn có thể cao (answer trung thành với chunk sai) → kết quả vô dụng nhưng không detect được.
- `context_utilization` phát hiện model **bỏ qua context** và trả lời từ knowledge nội tại. `faithfulness` không bắt được — model có thể trả lời đúng từ trí nhớ.
- Có đủ 4 chiều mới biết lỗi từ retriever hay generator.

## Việc cần làm

### 1. Thêm 2 judge function trong `src/lib/evalRunner.ts`

Đặt cạnh các judge function hiện có (sau `judgeScore` ~line 689). Reuse `chatCompletion`, `parseJudgeScore` đã có. Pattern y hệt `judgeScore` — chỉ khác prompt.

#### `contextRelevanceJudgeScore`

```ts
async function contextRelevanceJudgeScore(
  config: OpenAIConfig,
  question: string,
  context: string,
  signal: AbortSignal,
): Promise<number | null> {
  const prompt = `You are evaluating whether a retrieved context contains the information needed to answer a question.

Question:
"""
${question}
"""

Retrieved context:
"""
${context}
"""

Score from 1 to 10 based ONLY on whether the context contains information relevant to the question:
- 10 = context directly contains the answer or all needed facts
- 5 = context partially relevant, missing some needed information
- 1 = context is unrelated to the question

IMPORTANT: Do NOT evaluate any answer. Do NOT consider whether the question is answerable in general. Judge ONLY the question-context pair.

Respond with ONLY a single number 1-10.`
  return judgeScore(config, prompt, signal)
}
```

#### `contextUtilizationJudgeScore`

```ts
async function contextUtilizationJudgeScore(
  config: OpenAIConfig,
  question: string,
  context: string,
  answer: string,
  signal: AbortSignal,
): Promise<number | null> {
  const prompt = `You are evaluating whether an answer was derived from the provided context, or from external/internal knowledge.

Question:
"""
${question}
"""

Provided context:
"""
${context}
"""

Answer:
"""
${answer}
"""

Score from 1 to 10 based ONLY on context utilization:
- 10 = answer is clearly grounded in the context; key claims trace back to specific context sentences
- 5 = answer is partially grounded; some claims come from context, others from external knowledge
- 1 = answer ignores the context entirely (could be correct, but does not use the context)

IMPORTANT: Do NOT evaluate whether the answer is correct. Do NOT evaluate whether the context is good. Judge ONLY whether the answer USES the context.

Respond with ONLY a single number 1-10.`
  return judgeScore(config, prompt, signal)
}
```

> **Quan trọng**: 2 prompt PHẢI tách bạch. `context_relevance` không nhắc đến answer. `context_utilization` không hỏi đúng/sai. Nếu 2 prompt na ná nhau → 2 metric tương quan ~1.0 → vô dụng. Review sẽ check chỗ này.

### 2. Thêm case vào dispatcher trong `src/lib/evalRunner.ts`

Tìm block dispatcher các judge metric (~line 320-430, ngay sau case `answer_relevancy`). Thêm 2 case:

```ts
if (metrics.includes('context_relevance') && record.context) {
  const score = await withJudgeLimit(() =>
    contextRelevanceJudgeScore(judgeOpenAIConfig, record.input, record.context!, signal)
  )
  if (score !== null) recordLog.scores.context_relevance = score
}

if (metrics.includes('context_utilization') && record.context) {
  const score = await withJudgeLimit(() =>
    contextUtilizationJudgeScore(judgeOpenAIConfig, record.input, record.context!, recordLog.output, signal)
  )
  if (score !== null) recordLog.scores.context_utilization = score
}
```

> Cả 2 cần `record.context`. Nếu record không có context → skip (giống `faithfulness`).

### 3. Update default `gt_metrics` cho `rag_qa` trong `src/lib/taskGenerator.ts`

Tìm chỗ set `gt_metrics: ["faithfulness", "answer_relevancy"]` (trong pipeline `generateQAPairs` hoặc nơi build dataset metadata cho RAG). Đổi thành:

```ts
gt_metrics: ["faithfulness", "answer_relevancy", "context_relevance", "context_utilization"]
```

> **KHÔNG migrate dataset cũ**. Dataset trong `datasets/` đã có gt_metrics hardcoded — giữ nguyên. Chỉ ảnh hưởng dataset *mới sinh* từ Task Generator. Bằng tay user có thể thêm metric vào dataset cũ qua UI `/datasets`.

### 4. Update bảng metrics trong `src/lib/metrics.ts`

Tìm bảng `METRIC_INFO` / dispatcher (nơi liệt kê metric names). Thêm 2 entry:

```ts
context_relevance: { name: 'Context Relevance', desc: 'Is the retrieved context relevant to the question?' },
context_utilization: { name: 'Context Utilization', desc: 'Does the answer actually use the context?' },
```

> Logic ở `evalRunner.ts`, không phải `metrics.ts`. File này chỉ cần biết tên metric tồn tại để leaderboard render đúng.

### 5. Update `CLAUDE.md`

Bảng metrics ở section "Metrics (client-side, không cần server)" — thêm 2 dòng:

```
| `context_relevance` | QA/RAG LLM judge | record.context |
| `context_utilization` | QA/RAG LLM judge | record.context |
```

## Verification

### Type check + build

```bash
npx tsc --noEmit
npm run build
```

### Test discrimination (BẮT BUỘC — không skip)

Test 1 — Baseline: chạy `/run` trên 1 dataset RAG có sẵn (vd `ava_*_rag.json`). Leaderboard phải hiện 4 cột thay vì 2. Cả 4 cột phải có điểm > 60.

Test 2 — Swapped context (kiểm tra `context_relevance` thực sự discriminate):
1. Tạo bản copy của dataset RAG.
2. Trong UI `/datasets` hoặc bằng tay edit JSON: swap `context` của record A với record B (ít nhất 5 cặp).
3. Chạy eval trên dataset đã swap.
4. **Kỳ vọng**: `context_relevance` giảm rõ rệt (< 30 trên các record bị swap). Các metric khác có thể vẫn cao (model trả lời đúng từ trí nhớ).
5. Nếu `context_relevance` không giảm → prompt sai → quay lại bước 1 sửa prompt.

Test 3 — Ignored context (kiểm tra `context_utilization`):
1. Thay `context` thành 1 đoạn văn random không liên quan ("Today's weather is sunny..."), giữ `input` và `reference` nguyên.
2. Chạy eval. Một số model sẽ ignore context và trả lời đúng từ knowledge.
3. **Kỳ vọng**: `context_utilization` giảm rõ rệt cho các record có answer đúng nhưng context không liên quan.

### Lint

```bash
npm run lint
```

Chỉ check lint errors trên file vừa sửa. Ignore lint errors pre-existing ở file khác.

## Pitfalls / không được làm

1. **KHÔNG viết wrapper judge mới**. Reuse `judgeScore()` đã có ở `evalRunner.ts:689-704`. Pattern handle parse + normalize + retry rồi.

2. **KHÔNG migrate dataset cũ tự động**. Đừng viết script chạy qua `datasets/*.json` update `gt_metrics`. Rủi ro corrupt data.

3. **KHÔNG đụng UI**. Leaderboard/radar chart tự pickup metric mới từ tên. Không cần sửa component nào.

4. **KHÔNG hardcode tiếng Việt/Trung trong prompt**. Prompt judge dùng tiếng Anh. Crab-eval rule: không nhúng từ khóa ngôn ngữ cụ thể (xem CLAUDE.md gotcha #12).

5. **KHÔNG để 2 prompt na ná nhau**. Test 2 và Test 3 ở Verification phải pass — nếu cả 2 metric cùng tụt hoặc cùng giữ → prompt design fail.

## Tham khảo

- [RAGBench paper](https://arxiv.org/abs/2407.11005) — TRACe framework gốc
- [TRACe metrics blog summary](https://arxiv.org/html/2504.14891v1) — RAG eval survey 2026
- File hiện có để copy pattern: `src/lib/evalRunner.ts` các function `judgeScore`, faithfulness/answer_relevancy dispatcher cases

## Submission

1. Branch: `feat/phase2-trace-rag`
2. Commit message: `feat(eval): add context_relevance + context_utilization RAG metrics (TRACe)`
3. PR description bắt buộc include:
   - Screenshot leaderboard 4 cột (Test 1)
   - Screenshot leaderboard sau Test 2 (swapped context) — chỉ ra `context_relevance` tụt
   - Note kết quả Test 3
4. Self-review: chạy lại Verification trước khi tag reviewer.
