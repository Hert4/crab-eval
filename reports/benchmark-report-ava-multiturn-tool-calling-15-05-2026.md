# Báo cáo Benchmark — AVA Multi-turn Tool Calling
**Ngày thực hiện:** 15/05/2026  
**Tool:** Crab Eval (internal LLM evaluation framework)  
**Dataset:** ava_multiturn_tool_calling — multi-turn tool calling — 527 records  
**Tác vụ đánh giá:** Gọi tool đúng tên và đúng thứ tự trong hội thoại nhiều lượt (multi-turn)

---

## 1. Tổng quan luồng đánh giá

```
[1] Dataset ava_multiturn_tool_calling (527 records)
        ↓  mỗi record: conversation_history (N-1 lượt) + input (lượt cuối)
        ↓  mỗi record: expected_tool_calls = sequence tool calls cần gọi ở lượt cuối
[2] Run Eval (3 model, chạy song song)
        ↓  model nhận conversation_history + input, sinh tool calls
[3] Metric: tool_call_exact_sequence (programmatic)
        ↓  so sánh toàn bộ sequence tool calls (tên + thứ tự) với expected
[4] Metric: ast_accuracy_sequence (programmatic)
        ↓  60% tên tool + 40% argument keys — partial credit theo từng tool trong sequence
[5] Metric: task_success_rate_sequence (programmatic)
        ↓  tỉ lệ tool names khớp trong sequence (order-sensitive)
[6] Leaderboard
```

### Chi tiết Dataset

- 527 records: **32 synthetic** (adapted từ AVA tool calling dataset, tagged `synthetic`) + **495 real** (stratified từ 4144 birthday-FT records, tagged `birthday`)
- Multi-turn: mỗi record có `conversation_history` (các lượt trước) và `input` (lượt cuối cần đánh giá)
- Tools: 28 tool definitions, bao gồm các tool thực tế của AVA assistant (MISASearchKnowledge, GetGoldAndWeather, SendBirthdayWishes, v.v.)
- Không phân loại `difficulty` ngoài `medium` — toàn bộ records cùng mức

### Chi tiết Metric

| Metric | Loại | Mô tả |
|---|---|---|
| `tool_call_exact_sequence` | Programmatic | Toàn bộ sequence tool calls (tên + thứ tự) phải khớp 100% để record đạt điểm tối đa. Sequence thiếu tool hoặc thừa tool đều bị penalty theo tỉ lệ |
| `ast_accuracy_sequence` | Programmatic | 60% tên tool + 40% argument keys. Partial credit theo từng tool, trung bình theo sequence length |
| `task_success_rate_sequence` | Programmatic | Tỉ lệ tên tools gọi đúng trong sequence (order-sensitive) |

`tool_call_exact_sequence` là metric nghiêm ngặt nhất: thứ tự và số lượng tool calls phải chính xác. `ast_accuracy_sequence` và `task_success_rate_sequence` cho partial credit, phản ánh khả năng gọi đúng tool dù sequence không hoàn toàn khớp.

---

## 2. Kết quả

### 2.1 Bảng xếp hạng

| Hạng | Model | tool_call_exact | ast_accuracy | task_success_rate | Thời gian | Avg/record |
|---|---|---|---|---|---|---|
| 1 | **gpt-5.5** | **75.89%** | **85.56%** | **85.28%** | ~3h43m | ~25.4s |
| 2 | **gpt-4.1** | 66.58% | 80.69% | 81.70% | ~1h36m | ~10.9s |
| 3 | **gpt-4.1-mini** | 42.79% | 69.43% | 71.92% | ~1h41m | ~11.5s |

- Không có record nào lỗi (error) ở cả 3 model — toàn bộ 527 records đều `status: done`
- gpt-5.5 chậm hơn gpt-4.1 gấp **2.3 lần** về thời gian trung bình (25.4s vs 10.9s)
- gpt-4.1-mini chậm tương đương gpt-4.1 (~11.5s) nhưng điểm thấp hơn đáng kể

### 2.2 Phân bố điểm tool_call_exact_sequence theo record

| Bucket | gpt-5.5 | gpt-4.1 | gpt-4.1-mini |
|---|---|---|---|
| 100 — Chính xác hoàn toàn | 213/527 **(40%)** | 117/527 **(22%)** | 46/527 **(9%)** |
| 1–99 — Partial | 286/527 (54%) | 380/527 (72%) | 373/527 (71%) |
| 0 — Sai hoàn toàn | 28/527 (5%) | 30/527 (6%) | 108/527 **(20%)** |

### 2.3 Điểm theo nguồn dữ liệu

| Nguồn | gpt-5.5 | gpt-4.1 | gpt-4.1-mini |
|---|---|---|---|
| Synthetic (n=32) | **82.8%** | 73.4% | 67.2% |
| Birthday real-data (n=495) | **75.4%** | 66.1% | 41.2% |
| Delta (synthetic − real) | 7.4 điểm | 7.3 điểm | **26.0 điểm** |

---

## 3. Phân tích chi tiết từng model

### 3.1 gpt-5.5 — Tốt nhất mọi metric

**Scores:** tool_call_exact = **75.89%** | ast_accuracy = **85.56%** | task_success_rate = **85.28%**

**Điểm mạnh:**
- **tool_call_exact:** 40% records đạt 100 điểm — gấp gần 2 lần gpt-4.1 (22%) và gấp 4.4 lần gpt-4.1-mini (9%); chứng tỏ model bám sát expected sequence thay vì chỉ gọi đúng tên tool
- **ast_accuracy:** 85.56% — gap với gpt-4.1 là 4.9 điểm; model không chỉ đúng tên mà còn truyền đúng argument keys
- **task_success_rate:** 85.28% — xác nhận tỉ lệ gọi đúng tool cao nhất về cả tên và thứ tự
- Chỉ 5% records zero-score — tương đương gpt-4.1 (6%), cho thấy model ít bị "mất phương hướng" hoàn toàn
- Synthetic data: **82.8%** — cao nhất, cho thấy model generalizes tốt trên các tình huống được chuẩn hóa

**Điểm yếu:**
- Chậm nhất: **~3h43m** tổng, 25.4s/record — gấp 2.3 lần gpt-4.1; chi phí inference cao
- Zero-score patterns: các trường hợp zero thường là khi model gọi sai tool hoàn toàn (vd: `SendBirthdayWishes` thay vì tool khác, hoặc không gọi tool nào khi được kỳ vọng gọi)
- Birthday real-data: **75.4%** — thấp hơn synthetic 7.4 điểm; real data phức tạp hơn do biến thể ngôn ngữ tự nhiên

**Ví dụ tốt (mtt_ava_000, exact=100):**
- Input: "Giá vàng và thời tiết hôm nay thế nào?"
- Expected: `[GetGoldAndWeather]` — Model gọi đúng 1 tool, đúng tên

**Ví dụ zero (birthday_0834, exact=0):**
- Input: "Gửi lời chúc đi"
- Called: `[SendBirthdayWishes]` — nhưng sequence không khớp expected; lượt này có thể đã xử lý ở lượt trước hoặc expected là empty

---

### 3.2 gpt-4.1 — Cân bằng tốc độ và chất lượng

**Scores:** tool_call_exact = 66.58% | ast_accuracy = 80.69% | task_success_rate = 81.70%

**Điểm mạnh:**
- **Nhanh nhất thực tế:** ~1h36m tổng, 10.9s/record — nhanh gấp 2.3 lần gpt-5.5; phù hợp production
- **ast_accuracy:** 80.69% — khoảng cách với gpt-5.5 chỉ 4.9 điểm; model vẫn hiểu đúng về tool structure kể cả khi sequence không hoàn toàn khớp
- **task_success_rate:** 81.70% — cho thấy model gọi đúng tên tool trong phần lớn trường hợp, vấn đề chính là số lượng và thứ tự trong sequence
- Chỉ 6% zero-score — số records "thất bại hoàn toàn" thấp

**Điểm yếu:**
- **tool_call_exact:** 66.58% — thấp hơn gpt-5.5 9.3 điểm; 72% records là partial (không đạt 100% sequence match)
- Confusion giữa tool semantically similar: `mtt_ava_017` gọi `software_support_help` khi expected là `reports_dashboard_menu` — hai tool có overlap ngữ nghĩa cao về use case
- Multi-call sequences bị thiếu: `mtt_ava_001` (partial=50%) gọi `MISASearchKnowledge` 2 lần với query khác nhau, trong khi expected chỉ 1 lần — model over-generate tool calls

**Ví dụ confusion (mtt_ava_017, exact=0, ast=63.3, tsr=50):**
- Input: "chị cần hôc trợ báo cáo kết quả hoạt động"
- Expected: `[reports_dashboard_menu]` | Called: `[software_support_help]`
- ast_accuracy=63.3 — model gọi đúng pattern function, nhưng sai tool; judge partial credit vì argument structure tương tự

**Ví dụ partial (mtt_ava_001, exact=50):**
- Input: "Lịch nghỉ lễ của công ty trong năm nay là gì?"
- Expected: `[MISASearchKnowledge]` | Called: `[MISASearchKnowledge, MISASearchKnowledge]`
- Model gọi 2 lần thay vì 1 lần — sequence length mismatch làm exact penalty nặng

---

### 3.3 gpt-4.1-mini — Khoảng cách lớn trên real data

**Scores:** tool_call_exact = 42.79% | ast_accuracy = 69.43% | task_success_rate = 71.92%

**Điểm mạnh:**
- **task_success_rate:** 71.92% — model vẫn gọi đúng tên tool trong ~72% trường hợp xét về name-only, chứng tỏ model hiểu tool catalog
- Tốc độ tương đương gpt-4.1 (~11.5s/record) nhưng điểm thấp hơn nhiều — cost/performance ratio kém hơn đáng kể
- Synthetic data: **67.2%** — đạt khá tốt trên dữ liệu chuẩn hóa

**Điểm yếu:**
- **tool_call_exact:** 42.79% — kém gpt-4.1 đến **23.8 điểm**; chỉ 9% records đạt exact match hoàn toàn
- **Zero-score:** 20% records (108/527) — gấp 3.3 lần gpt-4.1 (6%); model thường xuyên gọi sai tool hoàn toàn hoặc gọi sai số lượng
- **Birthday real-data drop:** 41.2% — kém synthetic 26.0 điểm (vs 7.3–7.4 điểm ở các model lớn hơn); model mini không generalize tốt sang hội thoại tự nhiên phức tạp
- Nhiều trường hợp gọi `MISASearchKnowledge` thay vì tool đúng — model dùng tool "safe" phổ biến nhất thay vì phân biệt tool chuyên biệt

**Ví dụ lỗi phổ biến (mtt_ava_004, exact=0):**
- Input: "Chính sách nghỉ phép của công ty như nào?"
- Expected: `[MISASearchKnowledge]` | Called: `[MISASearchKnowledge]` — tên đúng nhưng exact=0
- Nghĩa là sequence length hoặc argument không khớp; model có thể gọi thêm tool thừa hoặc thiếu

**Ví dụ birthday gap (birthday_0420, exact=0):**
- Model gọi `GetBirthday` trong khi expected là sequence khác — real data có biến thể phức tạp hơn synthetic, model mini không bắt kịp

---

## 4. Vấn đề quan sát được

### 4.1 Semantic confusion giữa tool có use case gần nhau
Các tool như `reports_dashboard_menu`, `software_support_help`, `MISASearchKnowledge` có overlap ngữ nghĩa cao (đều liên quan đến hỗ trợ nghiệp vụ). Cả 3 model đều confuse ở nhóm này, nhưng gpt-4.1-mini bị nhiều nhất. Ví dụ: `mtt_ava_017–020` ("hỗ trợ báo cáo", "xem số liệu") bị confuse liên tục giữa `reports_dashboard_menu` và `software_support_help`.

**Khắc phục:** Thêm disambiguation cues vào tool descriptions; hoặc thêm negative examples vào conversation_history cho các cặp tool hay bị nhầm.

### 4.2 Over-generation: model gọi nhiều tool hơn expected
gpt-4.1 hay gọi `MISASearchKnowledge` 2 lần với 2 query khác nhau khi expected chỉ 1 lần. Đây là behavior hợp lý về mặt nghiệp vụ (decompose query) nhưng bị penalty bởi exact sequence metric. `tool_call_exact_sequence` không phân biệt "over-generation hợp lý" với "lỗi logic".

### 4.3 Birthday real-data harder than synthetic
Mức độ drop từ synthetic → birthday real-data rất khác nhau giữa các model:
- gpt-5.5: −7.4 điểm (75.4 vs 82.8) — robust tốt
- gpt-4.1: −7.3 điểm (66.1 vs 73.4) — robust tương đương
- gpt-4.1-mini: **−26.0 điểm** (41.2 vs 67.2) — sụt mạnh

Real data có biến thể hội thoại tự nhiên phức tạp hơn: người dùng viết tắt, bối cảnh ngầm định cao, yêu cầu không explicit. Model mini không generalize tốt trong môi trường này.

### 4.4 Partial metric gap cho thấy model hiểu tool nhưng sai sequence
Gap giữa `tool_call_exact_sequence` và `ast_accuracy_sequence` ở các model:
- gpt-5.5: 75.89% vs 85.56% → gap **9.7 điểm**
- gpt-4.1: 66.58% vs 80.69% → gap **14.1 điểm**
- gpt-4.1-mini: 42.79% vs 69.43% → gap **26.6 điểm**

Gap lớn chứng tỏ model hiểu tool structure (argument keys) nhưng sai về sequence orchestration. Đặc biệt gpt-4.1-mini có gap rất lớn (26.6 điểm) — model biết từng tool riêng lẻ nhưng không orchestrate được đúng sequence trong multi-turn context.

---

## 5. Tính công bằng của benchmark

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Cùng dataset cho mọi model | ✅ | 527 records giống nhau |
| Metric programmatic | ✅ | Không phụ thuộc judge model |
| Không có lỗi kỹ thuật | ✅ | 0 error records ở cả 3 model |
| Phân bố nguồn dữ liệu | ✅ | 32 synthetic + 495 real, clearly tagged |
| Expected tool calls từ real data | ⚠️ | Birthday expected_tool_calls từ conversation thực — có thể có noise nếu ground truth annotator cũng dùng LLM |
| Over-generation penalty | ⚠️ | `tool_call_exact_sequence` penalize over-generation dù về nghiệp vụ có thể đúng (gọi thêm tool để làm rõ context) |

---

## 6. Kết luận

**Ranking:** gpt-5.5 (75.89%) > gpt-4.1 (66.58%) > gpt-4.1-mini (42.79%)

*(Ranking theo tool_call_exact_sequence — metric nghiêm ngặt nhất)*

**Tóm tắt:**
- **gpt-5.5** dẫn đầu rõ rệt trên metric exact sequence (75.89%), đặc biệt tỉ lệ perfect records (40% vs 22%). Phù hợp khi tool orchestration accuracy là ưu tiên, bất kể chi phí thời gian gấp 2.3 lần
- **gpt-4.1** cân bằng tốt: ast_accuracy và task_success_rate vẫn cao (80.69% / 81.70%), tốc độ nhanh nhất. Vấn đề chính là sequence length mismatch và semantic confusion giữa tool gần nhau — có thể cải thiện bằng tool descriptions rõ hơn
- **gpt-4.1-mini** có khoảng cách lớn với 2 model trên, đặc biệt trên birthday real-data (41.2%) — không phù hợp cho production task này; 20% zero-score là tỉ lệ cao

**Khuyến nghị:**
1. Cải thiện tool descriptions để phân biệt rõ các tool semantic-similar (`reports_dashboard_menu` vs `software_support_help` vs `MISASearchKnowledge`) — giúp cả gpt-4.1 và gpt-4.1-mini giảm confusion
2. Xem xét thêm metric bổ sung cho over-generation hợp lý (model gọi đúng tool nhưng nhiều hơn expected) — hiện tại bị penalize như lỗi nghiêm trọng
3. Với birthday real-data, kiểm tra lại noise trong expected_tool_calls (ground truth là output của model gốc, không phải human annotation)
4. Không dùng gpt-4.1-mini cho multi-turn tool calling phức tạp — sụt 26 điểm trên real data so với synthetic là dấu hiệu model không đủ khả năng generalize

---

*Báo cáo được tạo bởi Crab Eval — 15/05/2026*  
*Framework: Next.js + Zustand, metric tính client-side (programmatic)*  
*Dataset: ava_multiturn_tool_calling — 527 records (32 synthetic + 495 birthday real-data)*  
*Run ID: gpt-5.5=af7655ae | gpt-4.1=956d8be1 | gpt-4.1-mini=b31c3b36*
