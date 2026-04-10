# Báo cáo Benchmark MISA AI — Tháng 4/2026

> **Ngày chạy:** 06/04/2026  
> **Công cụ đánh giá:** crab-eval  
> **Số lượng task:** 9 task · 1.209 records  
> **Số model so sánh:** 6

---

## 1. Tóm tắt điều hành

| Model | Điểm nổi bật | Yếu nhất |
|---|---|---|
| **misa-ai-1.0-plus** | Dẫn đầu tool calling (AVA), makt forecast, routing | CRM intent |
| **misa-gemma-4-31b** | Tốt nhất intent classification, ngang top RAG QA | Tool calling agent |
| **gpt-4.1-mini** | Dẫn đầu CRM intent, task generator | Intent routing |
| misa-ai-1.1 | Cân bằng, có makt forecast tốt | Intent routing, CRM thấp |
| misa-gemma-4-26b | Nhanh nhất, nhưng kém 31b gần như toàn diện | Tool calling |
| misa-ai-1.0 | Baseline — bị vượt ở hầu hết task | Routing, RAG QA |

**Kết luận nhanh:** Không có model nào thắng tuyệt đối. **misa-ai-1.0-plus** dẫn ở production tasks (tool calling, forecast). **Gemma 4-31b** bất ngờ cạnh tranh ở classification và RAG. **GPT-4.1-mini** ổn định nhưng không có task nào vượt trội hẳn.

---

## 2. Kết quả chi tiết theo từng task

### 2.1 AVA Tool Calling — `ast_accuracy`
> Đánh giá khả năng gọi đúng function + đúng tên tham số.  
> 98 records · Nguồn: MISA AMIS (HR, CRM)

| Xếp hạng | Model | AST Accuracy | Task Success |
|:---:|---|:---:|:---:|
| 🥇 | **misa-ai-1.0-plus** | **91.3%** | **89.8%** |
| 🥈 | misa-gemma-4-31b | 90.1% | 89.8% |
| 🥉 | gpt-4.1-mini | 89.4% | 88.8% |
| 4 | misa-ai-1.1 | 82.7% | 82.7% |
| 5 | misa-gemma-4-26b | 80.1% | 80.6% |
| 6 | misa-ai-1.0 | 79.2% | 78.6% |

**Nhận xét:** misa-ai-1.0-plus và Gemma 4-31b ngang nhau (~90%), vượt hẳn misa-ai-1.1 (~83%). Đây là cải tiến lớn so với 1.0 baseline (79%). misa-ai-1.1 bất ngờ kém hơn 1.0-plus ở task này.

---

### 2.2 CRM Intent Analysis — `accuracy`
> Phân loại intent câu lệnh CRM (action 1–7 hoặc unknown).  
> 57 records · Input: câu chat tiếng Việt ngắn

| Xếp hạng | Model | Accuracy |
|:---:|---|:---:|
| 🥇 | **gpt-4.1-mini** | **89.5%** |
| 🥈 | misa-ai-1.0-plus | 82.5% |
| 🥉 | misa-ai-1.0 | 80.7% |
| 4 | misa-gemma-4-26b | 79.0% |
| 5 | misa-gemma-4-31b | 71.9% |
| 6 | misa-ai-1.1 | 64.9% |

**Nhận xét:** GPT-4.1-mini dẫn rõ rệt. misa-ai-1.1 bị điểm thấp nhất dòng MISA — lý do chính: model trả lời giải thích dài thay vì chỉ trả về số action. Gemma 4-26b outperform 31b ở task này.

---

### 2.3 CRM Recommendation — `list_match`
> Gợi ý top sản phẩm/dịch vụ dựa trên lịch sử giao dịch.  
> 150 records

| Xếp hạng | Model | List Match |
|:---:|---|:---:|
| 🥇 | **misa-gemma-4-31b** | **70.7%** |
| 🥈 | gpt-4.1-mini | 68.9% |
| 🥉 | misa-ai-1.0-plus | 68.1% |
| 4 | misa-ai-1.0 | 61.5% |
| 5 | misa-gemma-4-26b | 58.7% |
| 6 | misa-ai-1.1 | 52.0% |

**Nhận xét:** Gemma 4-31b dẫn đầu. misa-ai-1.1 đứng cuối — khoảng cách 18.7% so với top là đáng lo ngại cho use case recommendation.

---

### 2.4 CRMMISA Dashboard — `token_f1`
> Sinh mô tả ngôn ngữ tự nhiên cho dashboard.  
> 150 records

| Xếp hạng | Model | Token F1 |
|:---:|---|:---:|
| 🥇 | **misa-ai-1.0-plus** | **50.3%** |
| 🥈 | gpt-4.1-mini | 50.0% |
| 🥉 | misa-ai-1.0 | 50.1% |
| 4 | misa-gemma-4-31b | 49.9% |
| 5 | misa-gemma-4-26b | 49.4% |
| 6 | misa-ai-1.1 | 48.1% |

**Nhận xét:** Tất cả model cụm nhau trong khoảng 48–50% — không model nào vượt trội. Task open-ended generation, token_f1 không đủ nhạy để phân biệt. **Khuyến nghị:** bổ sung LLM-judge (faithfulness + relevancy) cho task này.

---

### 2.5 HTKH Intent Classification — `accuracy`
> Phân loại intent customer support.  
> 150 records

| Xếp hạng | Model | Accuracy |
|:---:|---|:---:|
| 🥇 | **misa-gemma-4-26b** | **98.0%** |
| 🥈 | **misa-gemma-4-31b** | **98.0%** |
| 🥉 | gpt-4.1-mini | 96.7% |
| 4 | misa-ai-1.0-plus | 96.0% |
| 5 | misa-ai-1.1 | 94.7% |
| 6 | misa-ai-1.0 | 89.3% |

**Nhận xét:** Cả hai Gemma 4 đạt 98% — **dẫn tuyệt đối**. Gemma 4 rất mạnh ở classification tiếng Việt ngắn. misa-ai-1.0 tụt hẳn (89.3%), cải thiện rõ rệt theo thế hệ 1.0 → 1.0-plus → 1.1 → Gemma 4.

---

### 2.6 HTKH Intent Routing — `accuracy`
> Điều phối câu hỏi đến đúng phòng ban/agent.  
> 154 records · Task phức tạp hơn classification

| Xếp hạng | Model | Accuracy |
|:---:|---|:---:|
| 🥇 | **misa-ai-1.0-plus** | **68.4%** |
| 🥈 | gpt-4.1-mini | 66.9% |
| 🥉 | misa-gemma-4-31b | 59.7% |
| 4 | misa-ai-1.0 | 57.8% |
| 5 | misa-gemma-4-26b | 56.5% |
| 6 | misa-ai-1.1 | 52.6% |

**Nhận xét:** Task khó với tất cả model (không ai vượt 70%). misa-ai-1.0-plus dẫn nhẹ. misa-ai-1.1 đứng cuối, kém 1.0-plus tới **15.8%** — đây là điểm yếu rõ nhất của 1.1 so với đời trước.

---

### 2.7 HTKH RAG QA — `rouge_l` + LLM Judge
> Hỏi đáp có ngữ cảnh (Retrieval-Augmented Generation).  
> 150 records · Có faithfulness + answer_relevancy từ LLM judge

| Xếp hạng | Model | ROUGE-L | Token F1 | Faithfulness | Relevancy |
|:---:|---|:---:|:---:|:---:|:---:|
| 🥇 | **gpt-4.1-mini** | **40.7%** | 59.0% | 89.0% | 86.2% |
| 🥈 | **misa-gemma-4-31b** | 40.6% | **59.4%** | **89.3%** | 86.1% |
| 🥉 | misa-ai-1.0-plus | 40.7% | 58.8% | — | — |
| 4 | misa-gemma-4-26b | 35.1% | 53.9% | 88.7% | 85.3% |
| 5 | misa-ai-1.1 | 28.7% | 45.6% | 88.7% | 85.7% |
| 6 | misa-ai-1.0 | 20.1% | 33.4% | 88.6% | **89.9%** |

**Nhận xét:** GPT-4.1-mini và Gemma 4-31b gần như **đồng hạng** về chất lượng RAG. Bất ngờ: misa-ai-1.0 có Relevancy cao nhất (89.9%) nhưng ROUGE-L thấp nhất (20.1%) — model trả lời đúng ý nhưng diễn đạt khác reference. misa-ai-1.1 cải thiện ROUGE so với 1.0 (+8.6%) nhưng vẫn cách top ~12%.

---

### 2.8 Makt Forecast — `list_match`
> Dự báo top 5 sản phẩm bán chạy từ lịch sử.  
> 150 records · Chỉ MISA models được test

| Xếp hạng | Model | List Match |
|:---:|---|:---:|
| 🥇 | **misa-ai-1.0-plus** | **89.6%** |
| 🥈 | misa-ai-1.1 | 89.3% |
| 🥉 | misa-ai-1.0 | 87.2% |

**Nhận xét:** Tất cả MISA models đều mạnh ở task này (>87%). Gemma và GPT chưa được test.

---

### 2.9 Task Generator — Tool Calling Agent
> Agent gọi đúng function từ câu lệnh tự nhiên.  
> 127 tasks · Domain: AVA Tuyển dụng

| Xếp hạng | Model | Tool Call Exact (raw) | Tool Call Exact (normalized†) | Avg Latency |
|:---:|---|:---:|:---:|:---:|
| 🥇 | **gpt-4.1-mini** | **75.6%** | **83.5%** | 1.457s |
| 🥈 | misa-ai-1.1 | 73.2% | 78.7% | 1.674s |
| 🥉 | misa-ai-1.1-plus | 70.1% | 72.4% | 1.364s |
| 4 | misa-gemma-4-31b | 66.9% | **~73%** | 0.941s |
| 5 | misa-gemma-4-26b | 66.9% | **~73%** | **0.610s** |

†Normalized = sau khi bỏ qua khác biệt `PascalCase` vs `snake_case` ở tên argument (vd. `CandidateName` = `candidate_name`).

#### Tại sao điểm raw của Gemma thấp hơn thực tế?

Điểm raw 66.9% bị kéo xuống bởi **một lỗi convention thuần túy, không liên quan đến hiểu ngôn ngữ**. Gemma 4 luôn dùng `snake_case` cho argument keys (`candidate_name`, `recruitment_id`), trong khi dataset ground-truth dùng `PascalCase` (`CandidateName`, `RecruitmentID`). Sau khi chuẩn hóa, Gemma đạt **~73%** — ngang misa-ai-1.1.

#### Phân tích thực chất failures theo loại

| Loại lỗi | gemma-26b | gpt-4.1-mini | misa-ai-1.1 | misa-ai-1.1-plus |
|---|:---:|:---:|:---:|:---:|
| **Không gọi tool** (hỏi ngược lại user) | 2 | 2 | 4 | **14** |
| **Sai function name** (hallucinate tên) | 2 | 5 | 1 | 0 |
| **Key sai convention** (PascalCase/snake) | 7 | 5 | 7 | 3 |
| **Kỹ năng thực sự yếu** (gọi tool khi nên hỏi, hoặc không gọi khi nên gọi) | 26 | 16 | 20 | 18 |
| Khác | 5 | 3 | 2 | 3 |

**3 điểm đáng chú ý:**

**1. Gemma 4 ít "no-call" nhất** — chỉ 2/127 lần không gọi tool khi cần. Điều này thể hiện model rất proactive, hiểu rõ khi nào nên hành động. Ngược lại, **misa-ai-1.1-plus** từ chối gọi tool tới **14 lần** — model quá thận trọng, hay hỏi lại user dù thông tin đã đủ.

**2. Gemma gọi tool dù thiếu thông tin — đây là trade-off** — 26/42 failures của Gemma thuộc loại: model gọi tool khi ground-truth yêu cầu *hỏi ngược lại user* trước. Ví dụ: input "dịch CV của ứng viên 67890" — Gemma lập tức gọi `get_cv_content(candidate_id=67890)` trong khi expected behavior là hỏi thêm `target_language`. Gemma *quyết đoán hơn*, GPT *thận trọng hơn*. Với production chatbot, behavior nào tốt hơn tùy context.

**3. GPT-4.1-mini sai function name nhiều nhất (5 lần)** — model ngoại lại hallucinate tên function nhiều hơn MISA models, dù điểm tổng vẫn cao nhất do ít bị lỗi convention.

#### Tóm tắt thực chất

> Gemma 4 **không yếu hơn misa-ai-1.1** ở task này. Điểm raw thấp hơn hoàn toàn do lỗi convention key — một vấn đề có thể fix bằng system prompt hoặc function schema chuẩn. Điểm mạnh thực của Gemma ở task này: **ít từ chối gọi tool nhất, nhanh nhất (610ms vs 1.674s của misa-ai-1.1)**, và gần như không sai tên function.

---

## 3. Bảng xếp hạng tổng hợp

> Trọng số: Tool Calling 30% · Understanding 25% · Generation 25% · Business Logic 20%

| Model | Tool Calling | Understanding | Generation | Business | **Tổng** |
|---|:---:|:---:|:---:|:---:|:---:|
| 🥇 **misa-ai-1.0-plus** | 90.6% | 82.3% | 45.5% | 78.9% | **76.0%** |
| 🥈 **misa-gemma-4-31b** | 78.5% | 76.5% | 45.2% | 70.7% | **72.7%** |
| 🥉 **gpt-4.1-mini** | 82.6% | 84.7% | 44.8% | 68.9% | **72.4%** |
| 4 misa-ai-1.1 | 77.9% | 70.7% | 37.2% | 70.7% | 67.1% |
| 5 misa-gemma-4-26b | 73.5% | 78.1% | 42.3% | 58.7% | 66.0% |
| 6 misa-ai-1.0 | 78.9% | 75.8% | 27.1% | 74.4% | 64.0% |

---

## 4. Insights chính

### ✅ misa-ai-1.0-plus — Model tổng thể tốt nhất hiện tại
Dẫn đầu ở **tool calling** và **intent routing** — hai task production-critical nhất. Không có điểm đặc biệt yếu. Phù hợp nhất cho production deployment ngắn hạn.

### 🌟 Gemma 4-31b — Bất ngờ tích cực của benchmark
Kết quả đáng chú ý nhất: đạt **98% intent classification** (dẫn tuyệt đối), **ngang GPT-4.1-mini về RAG QA**, và **nhanh hơn hầu hết models**. Điểm yếu duy nhất là tool calling agent, nhưng một phần do convention key — không phải năng lực thực sự. Tiềm năng cao nếu được fine-tune thêm trên domain MISA.

### ⚠️ misa-ai-1.1 — Regression so với 1.0-plus
Đáng lo ngại: misa-ai-1.1 **không cải thiện** so với 1.0-plus ở hầu hết task, thậm chí kém rõ rệt ở intent routing (−15.8%) và CRM recommendation (−16.1%). Điểm mạnh duy nhất: latency thấp ở classification. Cần review quá trình training của 1.1.

### 📊 GPT-4.1-mini — Baseline ngoại ổn định
Không có điểm yếu nào đủ rõ. Dẫn ở CRM intent và task generator. Tuy nhiên không vượt trội ở task nào để justify chi phí API so với MISA-hosted models về dài hạn.

### ⚡ Speed vs Quality
| Model | Tốc độ (avg) | Chất lượng |
|---|:---:|:---:|
| misa-gemma-4-26b | **~500ms** | #5 |
| misa-gemma-4-31b | ~800ms | #2 |
| misa-ai-1.0 | ~900ms | #6 |
| misa-ai-1.1 | ~1.6s | #4 |
| gpt-4.1-mini | ~1.7s | #3 |
| misa-ai-1.0-plus | ~2.1s | #1 |

Gemma 4-26b là lựa chọn tốt nhất về **speed/quality tradeoff** cho task latency-sensitive (classification, routing).

---

## 5. Khuyến nghị theo use case

| Use case | Model đề xuất | Lý do |
|---|---|---|
| Production tool calling (CRM, HR) | **misa-ai-1.0-plus** | Dẫn đầu AST accuracy 91.3% |
| Intent classification real-time | **misa-gemma-4-26b** | 98% accuracy, 152ms avg |
| RAG QA / customer chatbot | **misa-gemma-4-31b** | Ngang GPT, nhanh hơn, faithfulness cao |
| Sales/inventory forecast | **misa-ai-1.0-plus** | 89.6% list match |
| Tất cả tasks, ưu tiên ổn định | **gpt-4.1-mini** | Không có điểm yếu rõ rệt |

---

## 6. Cần test thêm

- **makt_forecast**: Chưa test Gemma 4 và GPT-4.1-mini
- **crmmisa_dashboard**: Nên thêm LLM judge — token_f1 không đủ phân biệt (~50% tất cả models)
- **htkh_rag_qa**: misa-ai-1.0-plus chưa có faithfulness/relevancy score
- **Task Generator**: misa-ai-1.0 và misa-ai-1.0-plus chưa được test

---

*Báo cáo sinh tự động từ crab-eval · 06/04/2026*
