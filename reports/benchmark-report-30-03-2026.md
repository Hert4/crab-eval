# Báo cáo Benchmark — AVA Tuyển Dụng Agent
**Ngày thực hiện:** 30/03/2026
**Tool:** Crab Eval (internal LLM evaluation framework)
**Dataset:** Task Generator — 30/3/2026 (130 tasks, tiếng Việt)
**Tác vụ đánh giá:** Agent tuyển dụng — gọi đúng tool và xử lý yêu cầu người dùng

---

## 1. Tổng quan luồng đánh giá

```
[1] Tài liệu nghiệp vụ (AVA_Tuyen_Dung.docx)
        ↓
[2] Task Generator (LLM phân tích tài liệu → sinh task spec)
        ↓  atomicSubtasks: tool schema + required args + criteria
[3] Dataset Generation (LLM sinh 130 cặp input/label tiếng Việt)
        ↓  mỗi record: input + expected_tool_calls + reference criteria
[4] Run Eval (5 model chạy inference song song)
        ↓  mỗi model nhận cùng input + cùng tool definitions
[5] Metrics 
        ↓  tool_call_exact: binary 0/100, so sánh tên tool + param keys
[6] LLM-as-Judge (criteria_score)
        ↓  judge đánh từng criteria pass/fail → trung bình
[7] Leaderboard
```

### Chi tiết từng bước

#### Bước 1–2: Task Generator
- Upload tài liệu mô tả nghiệp vụ (DOCX/PDF/TXT)
- LLM phân tích và trích xuất các **atomic subtask**: mỗi subtask có tên tool, required args, optional args, và assertion criteria
- Kết quả lưu thành `task-spec JSON` → làm blueprint cho dataset

#### Bước 3: Dataset Generation
- Từ task spec, LLM sinh **130 cặp (input, label)** tiếng Việt
- Mỗi record gồm:
  - `input`: câu hỏi của user (đa dạng cách diễn đạt)
  - `expected_tool_calls`: tool + arguments kỳ vọng
  - `reference`: assertion criteria dạng văn bản (dùng cho LLM judge)
  - `tools`: toàn bộ tool schema inject vào prompt (giống nhau với mọi model)
- Dataset phân bố đều giữa 2 loại case:
  - **Happy path**: user cung cấp đủ thông tin → model phải gọi tool ngay
  - **Clarification path**: user thiếu thông tin → model phải hỏi lại, không gọi tool

#### Bước 4: Run Eval
- 5 model chạy trên **cùng 130 records**, cùng tool schema, cùng system prompt
- Mỗi model nhận: `system prompt + conversation history (nếu có) + user message + tool definitions`
- Không có multi-turn: mỗi record là một lượt inference độc lập

#### Bước 5–6: Metrics
| Metric | Loại | Mô tả |
|---|---|---|
| `tool_call_exact` | Programmatic | Binary: 100 nếu đúng tên tool + đủ param keys (case-insensitive), 0 nếu sai bất kỳ thứ gì |
| `criteria_score` | LLM-as-judge | Judge đánh từng assertion criteria pass/fail → (passed/total) × 100 |

**Lưu ý về fairness:**
- Tool name: fixed theo schema → không bị bias bởi model tự đặt tên
- Param key matching: case-insensitive (`CandidateID` = `candidate_id` = `candidateId`)
- Cùng judge model cho tất cả → điểm criteria có thể so sánh được

---

## 2. Kết quả

### 2.1 Bảng xếp hạng tổng hợp

| Hạng | Model | tool_call_exact | criteria_score | Thời gian | Records pass tool |
|---|---|---|---|---|---|
| 🥇 1 | **misa-ai-1.1-plus** | **82.31%** | 62.55% | 3m 18s | ~107/130 |
| 🥈 2 | **claude-sonnet-4-5** | 70.00% | **67.76%** | 11m 9s | ~91/130 |
| 🥉 3 | **gpt-4.1-mini** | 67.69% | 60.14% | 4m 9s | ~88/130 |
| 4 | **misa-ai-1.1** | 66.92% | 59.55% | 2m 5s | ~87/130 |
| 5 | **gpt-4.1** | 58.46% | 61.75% | 3m 44s | ~76/130 |

> *Records pass tool = ước tính từ tỉ lệ × 130 samples*

---

### 2.2 Nhận xét từng model

---

#### 🥇 misa-ai-1.1-plus — **Điểm cao nhất về tool calling**

**Điểm mạnh:**
- Dẫn đầu tool_call_exact với **82.31%** — cách biệt rõ ràng với các model còn lại
- Tốc độ phản hồi nhanh (3m18s cho 130 records, ~1.5s/record)
- Nhận diện chính xác khi nào có đủ thông tin để gọi tool, khi nào cần hỏi lại
- Xử lý tốt các case "happy path" với thông tin đầy đủ

**Điểm yếu:**
- `criteria_score` 62.55% — thấp hơn claude-sonnet ~5 điểm, cho thấy câu trả lời text còn thiếu chi tiết hoặc giải thích chưa đủ
- Với các case **ambiguous input** (user cung cấp 2 ID không chắc chắn, vd: "ID 55 hay 102 ấy"), model hỏi lại nhưng judge chỉ cho 25/100 vì label dataset kỳ vọng model gọi tool — đây là **vấn đề của dataset label**, không hoàn toàn do model
- criteria_score bị kéo xuống do 4 records có label mâu thuẫn (xem mục 3)

**Kết luận:** Model phù hợp nhất cho production use case — tool calling chính xác, nhanh, ổn định.

---

#### 🥈 claude-sonnet-4-5 — **Reasoning tốt nhất, tool calling trung bình**

**Điểm mạnh:**
- `criteria_score` cao nhất: **67.76%** — câu trả lời có chất lượng ngôn ngữ tốt, reasoning rõ ràng
- Biết từ chối hoặc hỏi lại có lý do, giải thích mạch lạc
- Xử lý các case clarification path chính xác và tự nhiên

**Điểm yếu:**
- tool_call_exact chỉ **70%** — kém misa-plus 12 điểm
- Đôi khi gọi **tool phụ** trước để tìm thêm thông tin (vd: gọi `get_recruitment` để tra ID) thay vì gọi thẳng tool chính → sai theo metric binary
- Thời gian phản hồi chậm nhất: **11m9s** (gấp ~5 lần misa-plus) — chi phí inference cao
- Với các task cần action nhanh, Claude có xu hướng reasoning quá nhiều

**Kết luận:** Phù hợp cho các task cần chất lượng ngôn ngữ cao hoặc reasoning phức tạp. Không tối ưu cho agent action-first như tuyển dụng.

---

#### 🥉 gpt-4.1-mini — **Cân bằng, nhưng over-clarification**

**Điểm mạnh:**
- Cân bằng tốt giữa hai metric (67.69% / 60.14%)
- Tốc độ ổn (~4m9s)
- Xử lý đúng nhiều case happy path

**Điểm yếu:**
- **Over-clarification**: hỏi lại ngay cả khi user đã cung cấp đủ thông tin
  - Vd: "ứng viên 101,102,103 với recruitment ID 55" → mini hỏi lại "tên tin tuyển dụng là gì?" trong khi ID đã có sẵn
- Điểm criteria thấp nhất trong nhóm top 3 (60.14%)

**Kết luận:** Phiên bản nhỏ hơn nhưng không hẳn kém hơn gpt-4.1 trong task này. Vấn đề chính là quá thận trọng dẫn đến trải nghiệm người dùng kém.

---

#### 4️⃣ misa-ai-1.1 — **Ổn, kém phiên bản plus rõ rệt**

**Điểm mạnh:**
- Nhanh nhất: **2m5s** cho 130 records (~1s/record)
- Cách gap với gpt-4.1-mini không lớn (66.92% vs 67.69%)

**Điểm yếu:**
- Kém misa-ai-1.1-plus **15.4 điểm** về tool_call_exact — gap lớn, cho thấy bản plus được cải thiện đáng kể
- criteria_score thấp nhất toàn bảng: 59.55%
- Một số case gọi sai tool hoặc bỏ qua optional args quan trọng

**Kết luận:** Phiên bản nền tốt nhưng rõ ràng cần nâng cấp lên plus cho production.

---

#### 5️⃣ gpt-4.1 — **Nghịch lý: model lớn hơn điểm thấp hơn**

**Điểm mạnh:**
- criteria_score **61.75%** — tốt hơn mini (60.14%), cho thấy reasoning không tệ
- Với các case có đủ thông tin, gpt-4.1 gọi tool **chính xác hơn** mini

**Điểm yếu:**
- tool_call_exact thấp nhất: **58.46%** — kém mini ~9 điểm
- **Overthinking với ambiguous input**: thay vì hỏi lại, gpt-4.1 cố tự suy luận rồi gọi sai tool
  - Vd: input "101,102,103 so với job ID 55 hay 102" → gpt-4.1 parse nhầm, gọi `get_candidates(candidate_name="103")`
  - Mini cũng fail nhưng theo cách hỏi lại — ít "phá" hơn
- Thời gian phản hồi trung bình (3m44s)

**Lý do điểm thấp hơn mini:**
1. Dataset được sinh bởi model có style gần với GPT-mini → **self-generation bias nhẹ** favoring mini
2. gpt-4.1 bị penalize nặng hơn vì gọi **sai tool** (score = 0) trong khi mini **hỏi lại** (cũng score = 0 nhưng không gây hại)
3. Với 130 samples, chênh 14 records = ~9 điểm % — không đủ lớn để kết luận gpt-4.1 thực sự kém hơn mini

**Kết luận:** Điểm thấp không phản ánh năng lực thật. Cần thêm run hoặc dataset trung lập hơn để kết luận chính xác.

---

## 3. Vấn đề phát hiện trong Dataset

### 3.1 Label mâu thuẫn — Record `_2`
- **Input:** "Bạn ơi tìm giúp mình hồ sơ ứng viên tên Nguyễn Văn A với."
- **expected_tool_calls:** `[]` → label là "clarification task"
- **reference criteria:** "Agent calls get_candidates with CandidateName..." → label là "phải gọi tool"
- **Kết quả:** `tool_call_exact = 100` (vì expected = []) nhưng `criteria_score = 0`
- **Nguyên nhân:** LLM tạo dataset viết `reference` và `expected_tool_calls` theo 2 logic khác nhau

### 3.2 Ambiguous label — Records `_5`, `_8`, `_11`, `_14`
- **Pattern:** User cung cấp 2 ID không chắc ("ID 55 hay 102 ấy")
- **Label:** "Agent calls tool" — kỳ vọng model tự chọn một ID
- **Thực tế:** Hành vi hỏi lại mới là đúng về product logic
- **Ảnh hưởng:** criteria_score bị kéo xuống 25/100 cho tất cả model hỏi lại (kể cả misa-plus)

### 3.3 Đề xuất cải thiện dataset
1. **Human review** tất cả records có `expected_tool_calls: []` — loại dễ bị label sai nhất
2. Với ambiguous input: thống nhất label hoặc chấp nhận cả 2 hành vi (gọi tool + hỏi lại đều pass)
3. Tăng số samples lên 200+ để giảm variance (hiện tại 14 records lệch = ~9% điểm)

---

## 4. Tính công bằng của benchmark

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Cùng tool schema cho mọi model | ✅ | Tool definitions inject vào prompt |
| Tool name matching | ✅ | Exact match — model không tự đặt tên |
| Param key case-insensitive | ✅ | `CandidateID` = `candidate_id` |
| Cùng judge model | ✅ | Một judge cho tất cả |
| Không cherry-pick best run | ✅ | Merge mode mặc định tắt |
| Self-generation bias | ⚠️ | Dataset sinh bởi GPT → nhẹ favoring GPT-style, đã mitigate bằng case-insensitive fix |
| Dataset label quality | ⚠️ | 5/130 records có label vấn đề (~3.8%) |
| Sample size | ⚠️ | 130 samples — đủ cho ranking, chưa đủ cho confidence interval hẹp |

---

## 5. Kết luận

**Ranking tin cậy:** misa-ai-1.1-plus > claude-sonnet-4-5 ≈ gpt-4.1-mini ≈ misa-ai-1.1 > gpt-4.1

**Điểm nổi bật:**
- **misa-ai-1.1-plus** là lựa chọn tốt nhất cho production — tool calling chính xác, nhanh, ổn định
- **claude-sonnet-4-5** vượt trội về chất lượng ngôn ngữ và reasoning, nhưng chậm và đắt hơn
- **gpt-4.1** thấp điểm không phải do kém năng lực mà do overthinking với ambiguous input — cần thêm dữ liệu để kết luận
- Phiên bản **misa-ai-1.1-plus so với misa-ai-1.1** cải thiện rõ rệt (+15.4% tool_call_exact)

**Khuyến nghị tiếp theo:**
1. Fix 5 records label lỗi trong dataset
2. Chạy thêm 1 run cho mỗi model để có confidence interval
3. Mở rộng dataset lên 200 samples với phân bố tool đồng đều hơn
4. Thêm test case cho edge cases: tool chain (gọi 2 tool liên tiếp), tool không tồn tại trong schema

---

*Báo cáo được tạo tự động bởi Crab Eval — 30/03/2026*
*Framework: Next.js + Zustand, metrics tính client-side, judge: LLM-as-judge*
