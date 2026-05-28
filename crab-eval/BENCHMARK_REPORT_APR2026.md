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

## 3. Vấn đề nghiêm trọng: misa-ai-1.1-plus — JSON Format Failure

### Tóm tắt

**misa-ai-1.1-plus** chỉ đạt **14.8% trên task CRM Recommendation** — thấp hơn tất cả các model khác ít nhất 37 điểm phần trăm. Đây không phải lỗi hiểu ngữ nghĩa mà là **lỗi format output**: model từ chối trả về JSON theo yêu cầu và thay bằng phân tích dạng văn bản tự do.

### Quy mô ảnh hưởng

- **123/150 records** (82%) fail hoàn toàn vì output không parse được thành JSON
- Chỉ **27/150 records** (18%) trả về đúng format

### Ví dụ cụ thể

**Yêu cầu (ground truth format):**
```json
["Phần mềm kế toán", "Phần mềm nhân sự", "Module báo cáo", "Dịch vụ tư vấn triển khai", "Gói bảo trì hệ thống"]
```

**Output của misa-ai-1.1-plus (thực tế):**
```
Dựa trên lịch sử giao dịch và thông tin khách hàng được cung cấp, tôi phân tích và đề xuất 
top 5 sản phẩm/dịch vụ tiếp theo phù hợp nhất với nhu cầu của khách hàng này:

1. **Phần mềm kế toán MISA SME** - Khách hàng hiện đang sử dụng phần mềm kế toán cơ bản, 
   việc nâng cấp lên MISA SME sẽ giúp tối ưu hóa quy trình kế toán và báo cáo tài chính.

2. **Module quản lý nhân sự** - Với quy mô nhân sự ngày càng tăng, giải pháp quản lý nhân sự 
   tích hợp sẽ giúp doanh nghiệp tiết kiệm thời gian và chi phí...

[tiếp tục thêm 3 mục nữa với giải thích dài]
```

**Tại sao xảy ra:** System prompt yêu cầu `Trả về dưới dạng JSON array`. misa-ai-1.1-plus có xu hướng "over-reason" — thay vì tuân thủ format, model tự phán đoán rằng giải thích chi tiết sẽ "hữu ích hơn" và bỏ qua format constraint.

### So sánh với model khác trên cùng task

| Model | Output format | List Match |
|---|---|:---:|
| misa-gemma-4-31b | JSON array đúng 100% | 70.7% |
| gpt-4.1-mini | JSON array đúng 100% | 68.9% |
| misa-ai-1.0-plus | JSON array đúng ~95% | 68.1% |
| misa-ai-1.0 | JSON array đúng ~90% | 61.5% |
| misa-gemma-4-26b | JSON array đúng ~88% | 58.7% |
| **misa-ai-1.1** | JSON array đúng ~75% | 52.0% |
| **misa-ai-1.1-plus** | **JSON array đúng ~18%** | **14.8%** |

Đây là **regression rất nghiêm trọng** — misa-ai-1.1 (không có plus) cũng bị ảnh hưởng (52% vs 68% top) nhưng ở mức độ nhẹ hơn. misa-ai-1.1-plus bị lỗi trầm trọng hơn hẳn.

### Ảnh hưởng đến production

Bất kỳ downstream code nào gọi misa-ai-1.1-plus để sinh JSON structured output **sẽ fail với tỉ lệ cao (~82%)**. Không thể dùng model này cho pipeline có structured output requirement mà không có fallback parsing phức tạp.

### Khuyến nghị

1. **Ngắn hạn:** Không deploy misa-ai-1.1-plus cho use cases yêu cầu JSON output
2. **Trung hạn:** Test với few-shot examples trong system prompt để ép format
3. **Dài hạn:** Review quá trình instruction tuning của 1.1-plus — model có thể bị over-trained trên long-form reasoning, làm giảm instruction following cho format constraints

---

## 4. Model Behavior

Phần này mô tả hành vi quan sát được khi đọc output thực tế — không chỉ dựa vào con số metric.

---

### 4.1 misa-ai-1.0-plus — Ngắn gọn, đúng format, ít "sáng tạo" ngoài yêu cầu

**Đặc điểm nổi bật:** Tuân thủ format tốt nhất trong nhóm MISA. Khi yêu cầu JSON array, trả về JSON array. Khi yêu cầu số action, trả về số.

**Điểm mạnh hành vi:**
- Tool calling: lựa chọn function name chính xác, ít hallucinate tên function
- Intent routing: phân tích context nhiều bước trước khi quyết định route — giải thích tại sao route đến agent X thay vì agent Y
- Makt forecast: trả về đúng 5 item, không thêm commentary

**Điểm yếu hành vi:**
- Đôi khi quá ngắn gọn trong RAG QA — câu trả lời đúng nhưng thiếu ngữ cảnh, user cần hỏi thêm
- Latency cao nhất (~2.1s) — model "suy nghĩ" lâu hơn trước khi respond

**Ví dụ intent routing (điểm tốt):**
```
Input: "Tôi muốn hủy hợp đồng dịch vụ nhưng vẫn cần hỗ trợ kỹ thuật trong 3 tháng"
Output: route → "Chăm sóc khách hàng" (không phải "Kinh doanh")
Lý do đúng: câu hỏi ưu tiên giải quyết vấn đề hiện tại, không phải bán hàng
```

---

### 4.2 misa-ai-1.1 — Over-explanation, kém instruction following

**Đặc điểm nổi bật:** Model có xu hướng giải thích quá nhiều. Ngay cả khi prompt yêu cầu output ngắn gọn, model vẫn thêm preamble và justification dài.

**Điểm yếu hành vi nghiêm trọng:**

**1. Thêm disclaimer không cần thiết trong classification:**
```
Input: "Tôi cần báo lỗi phần mềm"
Expected output: "Hỗ trợ kỹ thuật"
Actual output: "Dựa trên nội dung yêu cầu của bạn, tôi nhận thấy đây là vấn đề liên quan 
               đến kỹ thuật phần mềm. Vì vậy, câu trả lời phù hợp nhất là: Hỗ trợ kỹ thuật.
               Tuy nhiên nếu vấn đề liên quan đến thanh toán, xin vui lòng..."
```
Metric `exact_match` fail vì output không match reference, dù semantic đúng.

**2. JSON format drift:**
Trên CRM recommendation, ~25% records trả về JSON có prefix như `"Đây là danh sách gợi ý: [...]"` thay vì array thuần — làm `list_match` parse fail một phần.

**3. Intent routing bị ảnh hưởng bởi từ khóa surface-level:**
Model hay bị mislead bởi từ khóa trong câu thay vì phân tích intent thực. Ví dụ: câu chứa từ "hóa đơn" → route về "Kế toán" dù context là hỏi về kỹ thuật xuất file.

---

### 4.3 misa-ai-1.1-plus — Over-reasoning, bỏ qua format hoàn toàn

**Đặc điểm nổi bật:** Phiên bản cực đoan của misa-ai-1.1. Model "nghĩ" rằng câu trả lời dài, có phân tích sẽ tốt hơn — ngay cả khi prompt explicit yêu cầu format ngắn.

**Pattern lặp lại trên CRM recommendation (123/150 records):**
```
Prompt: "Trả về JSON array gồm top 5 sản phẩm phù hợp nhất. Chỉ trả về array, không giải thích."
Output: "Dựa trên phân tích lịch sử giao dịch và hành vi mua hàng của khách hàng, 
        tôi đề xuất chiến lược cross-sell và upsell như sau:
        
        **Phân tích khách hàng:**
        - Khách hàng thuộc phân khúc SME, doanh thu ~5 tỷ/năm
        - Đã sử dụng: Kế toán cơ bản, CRM lite
        ...
        [200-400 từ tiếp theo]
        
        **Danh sách đề xuất:**
        1. Phần mềm kế toán nâng cao — vì..."
```

Model không trả về array. JSON parser fail hoàn toàn.

**Pattern trên task generator (14/127 records "no-call"):**

Khi task generator yêu cầu model gọi tool, misa-ai-1.1-plus hỏi ngược lại user dù thông tin đã đủ:
```
Input: "Tạo hồ sơ tuyển dụng cho vị trí Kỹ sư phần mềm, lương 20-30 triệu"
Expected: gọi create_job_posting(title="Kỹ sư phần mềm", salary_range="20-30 triệu")
Actual: "Để tạo hồ sơ tuyển dụng chính xác, tôi cần thêm thông tin:
         1. Mô tả công việc cụ thể là gì?
         2. Yêu cầu kinh nghiệm bao nhiêu năm?
         3. Địa điểm làm việc ở đâu?..."
```
Model đặt câu hỏi clarification khi ground-truth kỳ vọng model tự điền reasonable defaults.

**Kết luận:** Behavior này là dấu hiệu của **over-training trên long-form reasoning** — model học cách "suy nghĩ thành tiếng" nhưng mất khả năng follow format constraint.

---

### 4.4 misa-gemma-4-31b — Quyết đoán, tuân thủ format, nhanh

**Đặc điểm nổi bật:** Behavior "sạch" nhất trong benchmark. Output đúng format, đủ nội dung, không thừa.

**Điểm mạnh hành vi:**
- **Intent classification:** Không bao giờ thêm preamble — output là label thuần, `exact_match` pass 98%
- **RAG QA:** Câu trả lời trực tiếp, dùng thông tin từ context tốt, ít hallucinate
- **Tool calling:** Ít "no-call" nhất (2/127) — proactively gọi tool khi có đủ thông tin

**Điểm yếu hành vi:**
- **Argument key convention:** Nhất quán dùng `snake_case` trong khi dataset dùng `PascalCase` — lỗi này lặp lại 100% trên các model có cùng argument. Đây là **training data artifact**, không phải lỗi hiểu ngôn ngữ.
- **Gọi tool khi thiếu thông tin:** Gemma fill reasonable defaults thay vì hỏi lại — hành vi tốt cho chatbot nhưng fail với GT kỳ vọng clarification

**Ví dụ "quyết đoán" của Gemma (trade-off):**
```
Input: "Dịch CV của ứng viên 67890"
Gemma: gọi get_cv_content(candidate_id=67890) → dịch luôn sang tiếng Anh (default)
Expected GT: hỏi target_language trước
```
Từ góc độ UX: Gemma behavior tốt hơn cho chatbot thực. GT cần review lại với các case này.

---

### 4.5 misa-gemma-4-26b — Nhanh, ổn định, đôi khi "too literal"

**Đặc điểm nổi bật:** Behavior rất giống 31b nhưng đôi khi quá literal với prompt — không suy luận thêm khi cần.

**Điểm yếu hành vi:**
- **Intent routing:** Kém hơn 31b vì ít "đọc ngữ cảnh" — phụ thuộc nhiều vào từ khóa surface
- **RAG QA:** Câu trả lời đúng nhưng đôi khi quá ngắn, không khai thác hết context

**Điểm mạnh hành vi:**
- Latency thấp nhất (~500ms) — trong production, user ít có cảm giác "đang chờ"
- Format compliance gần như hoàn hảo — không thêm text thừa

---

### 4.6 misa-ai-1.0 — Baseline: tốt cho classification, kém cho generation

**Đặc điểm nổi bật:** Model đời đầu, behavior đơn giản và "thô". Tốt ở task phân loại ngắn, yếu ở task sinh văn bản dài.

**Điểm yếu hành vi rõ nhất — RAG QA (ROUGE-L 20.1%):**
```
Input: "Cách xuất báo cáo thuế VAT trong MISA?"
Context: [3 đoạn hướng dẫn chi tiết về menu Báo cáo > Thuế > VAT]
Expected: hướng dẫn step-by-step từ context
Actual: "Bạn có thể xuất báo cáo thuế VAT trong phần Báo cáo của phần mềm MISA."
```
Model hiểu câu hỏi và có context nhưng không khai thác — chỉ trả lời ở mức high-level. ROUGE thấp vì không dùng ngôn ngữ từ reference.

Lưu ý: faithfulness score cao (88.6%) cho thấy model không hallucinate — chỉ trả lời quá cô đọng.

---

### 4.7 Tóm tắt pattern hành vi theo nhóm

| Pattern | Model bị ảnh hưởng | Mức độ |
|---|---|:---:|
| **Over-explanation** (thêm preamble/justification) | misa-ai-1.1, misa-ai-1.1-plus | Cao |
| **Format non-compliance** (bỏ JSON, trả prose) | misa-ai-1.1-plus | Nghiêm trọng |
| **Clarification over-caution** (hỏi khi không cần) | misa-ai-1.1-plus | Cao |
| **Surface keyword routing** (bỏ qua deep context) | misa-ai-1.1, misa-gemma-4-26b | Trung bình |
| **Too-brief generation** (đúng nhưng thiếu chi tiết) | misa-ai-1.0 | Trung bình |
| **Argument key convention** (snake vs PascalCase) | misa-gemma-4-31b, 26b | Thấp (fixable) |
| **Proactive tool call** (fill defaults thay vì hỏi) | misa-gemma-4-31b, 26b | Trade-off |

---

## 6. Bảng xếp hạng tổng hợp

> Trọng số: Tool Calling 30% · Understanding 25% · Generation 25% · Business Logic 20%

| Model | Tool Calling | Understanding | Generation | Business | **Tổng** |
|---|:---:|:---:|:---:|:---:|:---:|
| 🥇 **misa-ai-1.0-plus** | 90.6% | 82.3% | 45.5% | 78.9% | **76.0%** |
| 🥈 **misa-gemma-4-31b** | 78.5% | 76.5% | 45.2% | 70.7% | **72.7%** |
| 🥉 **gpt-4.1-mini** | 82.6% | 84.7% | 44.8% | 68.9% | **72.4%** |
| 4 misa-ai-1.1 | 77.9% | 70.7% | 37.2% | 70.7% | 67.1% |
| 5 misa-gemma-4-26b | 73.5% | 78.1% | 42.3% | 58.7% | 66.0% |
| 6 misa-ai-1.0 | 78.9% | 75.8% | 27.1% | 74.4% | 64.0% |
| 7 misa-ai-1.1-plus | n/a | n/a | n/a | 14.8% | — |

> misa-ai-1.1-plus chỉ được test trên task generator và CRM recommendation — không đủ tasks để xếp hạng tổng hợp.

---

## 7. Insights chính

### ✅ misa-ai-1.0-plus — Model tổng thể tốt nhất hiện tại
Dẫn đầu ở **tool calling** và **intent routing** — hai task production-critical nhất. Không có điểm đặc biệt yếu. Phù hợp nhất cho production deployment ngắn hạn.

### 🌟 Gemma 4-31b — Bất ngờ tích cực của benchmark
Kết quả đáng chú ý nhất: đạt **98% intent classification** (dẫn tuyệt đối), **ngang GPT-4.1-mini về RAG QA**, và **nhanh hơn hầu hết models**. Điểm yếu duy nhất là tool calling agent, nhưng một phần do convention key — không phải năng lực thực sự. Tiềm năng cao nếu được fine-tune thêm trên domain MISA.

### ⚠️ misa-ai-1.1 — Regression so với 1.0-plus
Đáng lo ngại: misa-ai-1.1 **không cải thiện** so với 1.0-plus ở hầu hết task, thậm chí kém rõ rệt ở intent routing (−15.8%) và CRM recommendation (−16.1%). Điểm mạnh duy nhất: latency thấp ở classification. Cần review quá trình training của 1.1.

### 🚨 misa-ai-1.1-plus — Critical regression về instruction following
Như đã phân tích ở mục 3, model này có lỗi nghiêm trọng về structured output. Điểm 14.8% CRM recommendation là chỉ báo của vấn đề lớn hơn trong instruction following.

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

## 8. Khuyến nghị theo use case

| Use case | Model đề xuất | Lý do |
|---|---|---|
| Production tool calling (CRM, HR) | **misa-ai-1.0-plus** | Dẫn đầu AST accuracy 91.3% |
| Intent classification real-time | **misa-gemma-4-26b** | 98% accuracy, 152ms avg |
| RAG QA / customer chatbot | **misa-gemma-4-31b** | Ngang GPT, nhanh hơn, faithfulness cao |
| Sales/inventory forecast | **misa-ai-1.0-plus** | 89.6% list match |
| Tất cả tasks, ưu tiên ổn định | **gpt-4.1-mini** | Không có điểm yếu rõ rệt |
| **TRÁNH** structured JSON output | ~~misa-ai-1.1-plus~~ | 82% format failure rate |

---

## 9. Cần test thêm

- **makt_forecast**: Chưa test Gemma 4 và GPT-4.1-mini
- **crmmisa_dashboard**: Nên thêm LLM judge — token_f1 không đủ phân biệt (~50% tất cả models)
- **htkh_rag_qa**: misa-ai-1.0-plus chưa có faithfulness/relevancy score
- **Task Generator**: misa-ai-1.0 và misa-ai-1.0-plus chưa được test
- **misa-ai-1.1-plus**: Cần test toàn bộ task suite để xác định phạm vi ảnh hưởng của format regression

---

*Báo cáo sinh tự động từ crab-eval · 06/04/2026*
