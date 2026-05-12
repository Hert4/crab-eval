# Báo cáo Benchmark — AVA Multi-turn Tool Calling
**Ngày thực hiện:** 11/05/2026  
**Tool:** Crab Eval (internal LLM evaluation framework)  
**Dataset:** AVA Multi-turn Tool Calling (synthetic) — 32 sessions, tiếng Việt  
**Tác vụ đánh giá:** Gọi đúng tool xuyên suốt nhiều lượt hội thoại liên tiếp

---

## 1. Tổng quan luồng đánh giá

```
[1] Dataset synthetic (multi-turn)
        ↓  mỗi record: 2 prior assistant turns (expected_tool_calls) + final user input
[2] Run Eval (3 model)
        ↓  với mỗi record: simulate từng assistant turn, gọi model thật, lấy tool_calls thực tế
[3] Metric: tool_call_exact_sequence
        ↓  trung bình tool_call_exact qua tất cả assistant turns trong conversation_history
[4] Leaderboard
```

### Chi tiết Dataset

Dataset được tạo tổng hợp bằng cách gộp 3 records liên tiếp từ `ava_tool_calling_50.json` thành một session multi-turn:
- Mỗi session gồm 2 prior assistant turns (mỗi turn có `expected_tool_calls`) + 1 final user input
- **Lưu ý:** các lượt hội thoại trong history không liên quan đến nhau về mặt ngữ nghĩa — đây là dataset dùng để test pipeline, không phải conversation tự nhiên
- 32 sessions, toàn bộ độ khó `medium`, tiếng Việt
- Metric duy nhất: `tool_call_exact_sequence`

### Chi tiết Metric

| Metric | Loại | Mô tả |
|---|---|---|
| `tool_call_exact_sequence` | Programmatic | Với mỗi assistant turn trong history: binary 100 nếu đúng tên tool + đủ param keys, 0 nếu sai. Lấy trung bình qua tất cả turns kể cả final turn. |

**Cách EvalRunner simulate:**
1. Với mỗi assistant turn trong `conversation_history`: gọi model với context tích lũy đến thời điểm đó → lấy `tool_calls` thực tế → inject stub tool result → tiếp tục
2. Gọi model lần cuối với `final_input` → lấy output + tool_calls final
3. Score toàn bộ các turns, lấy trung bình

---

## 2. Kết quả


### 2.1 Bảng xếp hạng

| Hạng | Model | tool_call_exact_sequence | Thời gian | Perfect sessions | Partial | Zero |
|---|---|---|---|---|---|---|
| 🥇 1 | **gpt-5.5** | **82.81%** | 2m 37s | 21/32 (66%) | 11/32 | 0/32 |
| 🥈 2 | **gpt-4.1** | 73.44% | 1m 48s | 19/32 (59%) | 9/32 | 4/32 |
| 🥉 3 | **gpt-4.1-mini** | 67.19% | 1m 58s | 14/32 (44%) | 15/32 | 3/32 |

---

## 3. Phân tích chi tiết từng model

### 3.1 gpt-5.5 — Điểm cao nhất

**Điểm mạnh:**
- Không có session nào bị điểm 0 — model luôn gọi được ít nhất 1 tool đúng trong mọi trường hợp
- 21/32 sessions đạt perfect (100%) — tỉ lệ cao nhất trong nhóm
- Xử lý tốt các case multi-tool (vd: gọi đồng thời `GetGoldAndWeather` 2 lần cho 2 query khác nhau)

**Điểm yếu:**
- 11/32 sessions partial — chủ yếu do tool argument không khớp pattern kỳ vọng (tool name đúng nhưng query string khác biệt)
- Chậm nhất trong nhóm: **2m37s** (~4.9s/session) — gấp 1.5 lần gpt-4.1

**Ví dụ partial:**
- Input: "Lịch nghỉ lễ của công ty trong năm nay là gì?"
- Expected: `MISASearchKnowledge(query="lịch nghỉ lễ của công ty MISA năm 2024")`
- Actual: `MISASearchKnowledge(query="Lịch nghỉ lễ công ty MISA năm 2024")` → turn này pass (key đúng), nhưng turn khác trong cùng session fail → partial

---

### 3.2 gpt-4.1 — Nhanh và ổn định

**Điểm mạnh:**
- Nhanh nhất: **1m48s** (~3.4s/session) — phù hợp production
- 19/32 perfect — cách biệt rõ với mini
- Xử lý tốt các task kế toán phức tạp (lập chứng từ, rút dự toán) khi context đủ rõ

**Điểm yếu:**
- 4/32 sessions điểm 0 — model gọi sai tool hoặc gọi tool không có trong schema (vd: `software_support_help` không tồn tại)
- 9/32 partial — phần lớn do `MISASearchKnowledge` với query string không match expected

**Ví dụ zero:**
- Input: "chị cần hỗ trợ báo cáo kết quả hoạt động"
- Expected: `software_support_help()` (theo context của prior turn)
- Actual: `MISASearchKnowledge(query="Hướng dẫn lập báo cáo kết quả hoạt động...")` → gọi tool sai

---

### 3.3 gpt-4.1-mini — Nhiều partial, ít zero

**Điểm mạnh:**
- Chỉ 3/32 zero — ít hơn gpt-4.1 (4/32), model ít gọi sai tool hơn
- Thời gian tốt: **1m58s** (~3.7s/session)

**Điểm yếu:**
- 15/32 partial — nhiều nhất trong nhóm: hay gọi đúng tool nhưng sai/thiếu argument
- 14/32 perfect — thấp hơn đáng kể so với gpt-4.1 (19/32) và gpt-5.5 (21/32)
- Kém gpt-4.1 6 điểm và gpt-5.5 15.6 điểm

**Nhận xét:** mini có profile "thận trọng" — ít gọi sai tool hơn nhưng hay bỏ sót argument, dẫn đến nhiều partial thay vì zero.

---

## 4. Vấn đề Dataset

### 4.1 Conversation history không tự nhiên
Dataset ghép ngẫu nhiên 3 records không liên quan thành 1 session:
- Vd: Turn 1 hỏi kế toán → Turn 2 hỏi giá vàng → Final hỏi về phần mềm
- Model nhận context vô nghĩa → ảnh hưởng đến behavior ở các turn trung gian

### 4.2 Out-of-domain records
Một số records có input ngoài domain MISA (phim kinh dị, học máy) nhưng `expected_tool_calls` vẫn là tool MISA — penalize model khi từ chối gọi tool đúng với domain.

### 4.3 Tool argument matching — MISASearchKnowledge
Nhiều partial do `query` string không match hoàn toàn (khác viết hoa, thiếu từ đệm). Metric `tool_call_exact_sequence` chỉ check key names, không check value — partial ở đây do turn khác trong session fail, không phải do argument value.

---

## 5. Tính công bằng của benchmark

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Cùng dataset cho mọi model | ✅ | 32 sessions giống nhau |
| Cùng tool schema | ✅ | Tool definitions inject như nhau |
| Metric programmatic | ✅ | Không phụ thuộc judge model |
| Conversation history tự nhiên | ❌ | Ghép ngẫu nhiên — không phản ánh real-world |
| Domain coverage đồng đều | ⚠️ | Có out-of-domain records |
| Sample size | ⚠️ | 32 sessions — đủ để xếp hạng, chưa đủ cho kết luận chắc chắn |

---

## 6. Kết luận

**Ranking:** gpt-5.5 (82.81%) > gpt-4.1 (73.44%) > gpt-4.1-mini (67.19%)

**Tóm tắt:**
- **gpt-5.5** dẫn đầu rõ ràng — ceiling cao nhất, không có zero session, nhưng chậm và đắt hơn
- **gpt-4.1** cân bằng tốt giữa điểm số và tốc độ — phù hợp nhất cho production
- **gpt-4.1-mini** ít gọi sai tool nhưng hay bỏ sót argument — phù hợp khi chi phí là ưu tiên

**Hướng cải thiện:**
1. Tạo lại dataset với conversation history tự nhiên (dùng `generateMultiTurnToolPairs()` từ document thực)
2. Tăng lên 80–100 sessions để có kết quả tin cậy hơn
3. Thêm `criteria_score` để đánh giá chất lượng response text, không chỉ tool accuracy
4. Bổ sung các mức độ khó `easy` và `hard` để phân tích theo difficulty

---

*Báo cáo được tạo bởi Crab Eval — 12/05/2026*  
*Framework: Next.js + Zustand, metric tính client-side (programmatic)*  
*Dataset: AVA Multi-turn Tool Calling (synthetic) — pipeline test only, not production benchmark*
