# Epistematics Audit — TODO

**Nguồn**: Kalaitzidis, "The Evaluation Trap: Benchmark Design as Theoretical Commitment", arXiv:2605.14167 (13/05/2026).

**Ngày tạo TODO**: 2026-05-17. Audit thực hiện sau khi Phase 1 judge audit ship (12/05/2026).

**Vấn đề cốt lõi paper nêu**: benchmark không trung lập — nó encode giả định lý thuyết về cái nó đo. Khi judge model và evaluated model cùng paradigm, eval tự xác nhận proxy behavior thay vì đo capability thật ("evaluation produces a version of the target defined by its own operational assumptions").

---

## Findings — crab-eval đang dính evaluation trap ở đâu

### F1. Reference-as-Truth Trap (Criterion Leakage — nặng nhất)

`src/lib/evalRunner.ts:340-927` — judge prompt `answer_correctness`:
> "Score the candidate from 1 to 10 based on how well it matches the reference in correctness and completeness."

Judge explicit reward "giống reference", không reward "đúng". Ground truth phần lớn do `gpt-5.2`/`gpt-4.1` sinh → toàn bộ eval đang đo "có giống gpt-5.2 không". Misa models luôn thua không phải vì kém mà vì GT có shape gpt.

### F2. Same-Family Judge (Architectural Indistinguishability)

`configStore.ts` cho phép judge cùng provider với target. Trường hợp `misa-ai-1.0-plus` tự judge chính nó = circularity tối đa. `VISUAL_EVAL_REVIEW.md` mục 1.2 đã flag RISK 2 nhưng chưa enforce.

### F3. Surface metrics che mechanism (Proxy Substitution)

`src/lib/metrics.ts` — `tool_call_exact`, `token_f1`, `exact_match`:
- `tool_call_exact` check tên tool + arg KEYS, **không check arg VALUES** semantic → hallucinated values vẫn pass.
- `token_f1` reward lexical mimicry.
- BENCHMARK_REPORT_APR2026.md mục 4.3: misa-ai-1.1-plus output văn xuôi thay JSON ở 82% case — lộ ra do **parser sập**, không phải rubric phát hiện.

### F4. Hardcoded business rules (Implicit Functionalism)

`src/lib/evalRunner.ts:174-176` hardcode pattern `CAND-XXXX`, `RJ`. Model train trên convention MISA được free credit. Recruitment agent thật sự tốt hơn nhưng dùng convention khác sẽ **fail**.

### F5. Synthetic ground truth (Approximation Ceiling)

GT từ `gpt-5.2`/`gpt-4.1` → design envelope bị cap bởi data-generating model. Rubric hiện tại không có cách nào để model **vượt** GT.

---

## Per-task failure mode mapping

| Dataset | Capability claim ngầm | Rubric thực tế | Failure modes trigger |
|---|---|---|---|
| `ava_tool_calling_50` | Hiểu HR intent → chọn tool → extract args | `tool_call_exact` (binary tên + keys) | Criterion leakage (arg values không check), Proxy substitution (keyword match đủ pass) |
| `htkh_intent_classification_150` | Phân biệt handoff vs other | `exact_match` nhị phân | Context blindness (không có adversarial paraphrase), Proxy substitution (keyword detection đủ) |
| `htkh_intent_routing_154` | Multi-class routing | `exact_match` | Như trên |
| `crm_recommendation_150` | Gợi ý sản phẩm phù hợp customer | JSON list match expected | Approximation ceiling (GT gpt-shape), Architectural indistinguishability (2 list khác cùng đúng business) |
| `mtrans_translation_150` | Localize UI 144 ngôn ngữ | chrF + `translation_quality` LLM judge | Criterion leakage (match reference, không match UI fit), Same-family judge |

---

## TODO — Action items theo priority

### Quick wins (1-2 ngày, ship làm "Phase 1.5 audit hardening")

- [ ] **A1. Lưu judge prompt + judge model vào result file**
  - File: `src/lib/evalRunner.ts` write-result path
  - Append vào JSON output: `judge_model`, `judge_prompt_hash`, `judge_provider`, `judge_temperature`
  - Lý do: `CHANGES.md 2026-05-06` đã flag thiếu reproducibility. Không fix cái này thì mọi audit sau đều không reproducible.

- [ ] **A2. Judge isolation policy**
  - File: `src/lib/configStore.ts` validation logic
  - Rule: reject run nếu `judge.provider === target.provider`. Cho phép override bằng flag explicit `--allow-same-family` + warning log.
  - Stretch: require 2 judge models khác family per eval, log disagreement. Disagreement = tín hiệu Epistematics quan trọng nhất.

- [ ] **A3. Tag GT provenance**
  - File: mỗi `datasets/*.json` add field `gt_source: "gpt-5.2" | "gpt-4.1" | "human" | "misa-team"` per record
  - Update report generation: breakdown score theo nhóm GT
  - Output: gap giữa các nhóm = đo synthetic-GT bias trực tiếp

### Medium effort (1 tuần)

- [ ] **A4. Reference-free judge variant**
  - File: `src/lib/evalRunner.ts` — thêm judge prompt KHÔNG thấy reference, chỉ question + candidate
  - So sánh với reference-based judge. Khi 2 score lệch nhiều → reference đang dominate (probe trực tiếp cho F1)
  - Report dual scores: `correctness_blind` vs `correctness_vs_ref`

- [ ] **A5. Negative/adversarial examples mỗi dataset**
  - `ava_tool_calling_50`: thêm 10-20 case "câu hỏi không cần tool" (HR small talk). Model gọi tool = fail. Hiện rubric chỉ measure precision, không measure restraint.
  - `htkh_intent_classification_150`: thêm adversarial paraphrase (cùng intent, lexical khác hẳn) để test context sensitivity
  - `mtrans_translation_150`: thêm case có length budget, cultural reference — không pass được nếu chỉ dịch literal

### Heavier (sprint level)

- [ ] **A6. Capability claim per dataset**
  - Mỗi dataset có 1 file `datasets/<name>/CAPABILITY.md`:
    1. Claim (1-2 dòng)
    2. Theoretical assumptions (giả định ngầm)
    3. Proxy behaviors to disqualify
    4. Discriminative conditions (điều kiện phân biệt thật vs proxy)
  - Rubric phải derive từ file này. Không có file = không deploy dataset.

- [ ] **A7. Mechanism probes**
  - Theo Epistematics' "disrupt feedback pathway"
  - Tool-calling: ablate tool description khỏi prompt → model thật sự hiểu sẽ fail rõ rệt; pattern-matcher có thể vẫn output pass surface rubric
  - Translation: scramble context window, kiểm tra model có dùng context hay không
  - Cost cao nhưng đây là cách duy nhất thoát evaluation trap structurally

---

## Decision pending

**Ship A1+A2+A3 thành "Phase 1.5" tách riêng, hay gộp vào Phase 2 (RAG/rubric/agent/monitor)?**

Mình đề xuất tách Phase 1.5 vì:
- Tổng <3 ngày code
- Block mọi Phase 2+: nếu không có reproducibility + judge isolation thì Phase 2 cũng dính evaluation trap
- Defensible từ paper bên ngoài, không phải scope creep tự nghĩ

→ Cần user confirm trước khi pick up.

---

## Reference

- Paper: arXiv:2605.14167 — Kalaitzidis, "The Evaluation Trap"
- Related: Phase 1 judge audit (2026-05-12), `reports/benchmark-report-multi-turn-tool-calling-12-05-2026.md`, `reports/benchmark-report-translation-12-05-2026.md`
- Related: `VISUAL_EVAL_REVIEW.md` (đã flag same-family judge risk)
- Related: `BENCHMARK_REPORT_APR2026.md` mục 4.3 (misa-ai-1.1-plus JSON parsing failure)
