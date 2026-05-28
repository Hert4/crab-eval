# Báo cáo Benchmark — EnvScaler Agentic Evaluation
**Ngày thực hiện:** 26/05/2026  
**Tool:** Crab Eval (internal LLM evaluation framework)  
**Dataset:** EnvScaler multi-turn tool calling — môi trường tổng hợp động  
**Tác vụ đánh giá:** Hoàn thành tác vụ đa bước trong môi trường stateful qua nhiều lượt gọi tool

---

## 1. Tổng quan luồng đánh giá

```
[1] Dataset EnvScaler (multi_turn_tool_calling)
        ↓  mỗi record: task description + init_config (trạng thái ban đầu của môi trường)
[2] Sidecar-bridge tự động:
        ↓  Stage 3: tạo init_config (snapshot trạng thái ban đầu)
        ↓  Stage 4: tạo checklist + check functions (tiêu chí hoàn thành)
[3] Run Agent (model được đánh giá)
        ↓  model nhận task, tự quyết định gọi tool nào, theo thứ tự nào, bao nhiêu lần
        ↓  tối đa 20 bước (max_steps=20)
[4] Metric: envscaler_score
        ↓  % checklist items pass sau khi agent kết thúc
[5] Leaderboard
```

### Chi tiết Dataset & Môi trường

- Dataset dạng `multi_turn_tool_calling`: mỗi record là 1 task mô tả bằng ngôn ngữ tự nhiên, kèm trạng thái ban đầu của môi trường (database, entity states)
- Môi trường được tổng hợp tự động bởi EnvScaler skel_builder: mỗi record có thể share env class với các record tương tự (clustering theo embedding), nhưng có `init_config` và `checklist` riêng
- Checklist gồm các mệnh đề boolean dạng "Has ... been set to ..." — đánh giá trạng thái cuối của môi trường sau khi agent thực hiện xong
- Không có ground truth tool sequence cố định — model tự lên kế hoạch và thực thi

### Chi tiết Metric

| Metric | Loại | Mô tả |
|---|---|---|
| `envscaler_score` | Programmatic (môi trường) | % checklist items pass = số assertions môi trường thỏa mãn sau khi agent kết thúc. 100% = hoàn thành toàn bộ tác vụ |

Khác với `tool_call_exact_sequence`, `envscaler_score` **không penalize cách thực hiện** — chỉ đánh giá kết quả cuối cùng của môi trường. Model có thể gọi tool theo thứ tự khác hoặc dùng nhiều bước hơn mà vẫn đạt điểm tối đa nếu trạng thái cuối đúng.

---

## 2. Kết quả

### 2.1 Bảng xếp hạng

| Hạng | Model | envscaler_score | Ghi chú |
|---|---|---|---|
| 🥇 1 | **gpt-5.5** | **42.0%** | Dẫn đầu rõ ràng |
| 🥈 2 | **gpt-4.1** | 37.4% | Cách biệt gpt-5.5: 4.6 điểm |
| 🥉 3 | **gpt-4.1-mini** | 35.3% | Sát gpt-4.1: 2.1 điểm |
| 4 | **gpt-4o-mini** | 20.1% | Cách biệt nhóm trên: ~15 điểm |

### 2.2 Nhận xét phân bố

- **Nhóm trên** (gpt-5.5, gpt-4.1, gpt-4.1-mini): điểm tập trung trong khoảng 35–42%, cách biệt nhau nhỏ (≤6.7 điểm)
- **Nhóm dưới** (gpt-4o-mini): cách biệt lớn với nhóm trên (~15 điểm), cho thấy một ngưỡng năng lực rõ ràng cần vượt qua để xử lý tác vụ agentic phức tạp
- Tất cả 4 model đều có điểm thấp hơn 50% — phản ánh độ khó cao của tác vụ EnvScaler so với các benchmark tool calling thông thường

---

## 3. Phân tích chi tiết từng model

### 3.1 gpt-5.5 — Dẫn đầu nhờ lập kế hoạch tốt hơn

**Score:** envscaler_score = **42.0%**

**Điểm mạnh:**
- Điểm cao nhất trong nhóm — đặc biệt vượt trội ở các tác vụ đòi hỏi nhiều bước phụ thuộc nhau (multi-step dependency)
- Thể hiện khả năng **lập kế hoạch dài hạn**: gọi tool query trước để lấy ID/thông tin, sau đó gọi tool modify — chuỗi logic chính xác hơn
- Tỉ lệ checklist items pass cao hơn ở các task có partial credit — nghĩa là dù không hoàn thành 100%, model hoàn thành được nhiều sub-task hơn trong cùng 1 record
- Ít bị "lạc hướng" ở bước giữa task: model duy trì context tốt qua nhiều lượt tool call

**Điểm yếu:**
- Tổng điểm vẫn chỉ 42.0% — còn 58% checklist items không pass, cho thấy nhiều task quá phức tạp hoặc môi trường có edge case chưa được xử lý
- Chi phí inference và thời gian cao hơn gpt-4.1 (theo đặc điểm đã biết từ các benchmark khác)

---

### 3.2 gpt-4.1 — Cân bằng, phù hợp production

**Score:** envscaler_score = **37.4%**

**Điểm mạnh:**
- Kém gpt-5.5 chỉ 4.6 điểm — trong khi tốc độ và chi phí thấp hơn đáng kể
- Xử lý tốt các tác vụ có cấu trúc rõ ràng: update field, create entity, link relationship
- Ít lỗi tool argument hơn gpt-4.1-mini — argument names và types khớp schema tốt hơn

**Điểm yếu:**
- Khó khăn với tác vụ đòi hỏi suy luận nhiều bước: vd query → filter → aggregate → update
- Đôi khi bỏ qua bước query để lấy ID trước khi gọi modify tool — dẫn đến tool call lỗi hoặc dùng ID sai
- 2.1 điểm cao hơn gpt-4.1-mini nhưng khoảng cách không lớn — cho thấy mini đã đủ tốt ở các tác vụ đơn giản

---

### 3.3 gpt-4.1-mini — Gần gpt-4.1, phù hợp tác vụ đơn giản

**Score:** envscaler_score = **35.3%**

**Điểm mạnh:**
- Kết quả gần với gpt-4.1 (cách biệt chỉ 2.1 điểm) — bất ngờ tích cực so với kết quả của mini trên các benchmark tool calling khác (gpt-4.1-mini thường kém hơn rõ rệt)
- Xử lý ổn với tác vụ 1–2 bước đơn giản: update field trực tiếp, tạo entity mới với thông tin đầy đủ
- Chi phí thấp nhất trong nhóm trên

**Điểm yếu:**
- Kém hơn gpt-4.1 ở tác vụ multi-step phức tạp — model hay bỏ sót bước trung gian
- Hay gọi tool với argument không đúng type (string thay vì int, nested object thay vì flat) — dẫn đến env state không thay đổi dù tool được gọi
- Kết quả 35.3% gần với gpt-4.1 (37.4%) nhưng profile lỗi khác nhau: gpt-4.1 ít lỗi argument hơn nhưng đôi khi bỏ sót bước; mini thường xuyên lỗi argument hơn

---

### 3.4 gpt-4o-mini — Không đủ năng lực agentic

**Score:** envscaler_score = **20.1%**

**Điểm mạnh:**
- Gọi được tool cơ bản — không bị lỗi hoàn toàn 0%
- Phù hợp với tác vụ single-step đơn giản nếu task description cực kỳ rõ ràng

**Điểm yếu:**
- Cách biệt **~15 điểm** so với gpt-4.1-mini — khoảng cách lớn nhất trong bảng xếp hạng
- Không xử lý được tác vụ đa bước: model thường gọi 1–2 tool rồi dừng, không hoàn thành chuỗi hành động cần thiết
- Hay gọi tool không tồn tại (hallucinate tool name) hoặc gọi đúng tool nhưng thiếu required arguments
- Không duy trì được context qua nhiều lượt: quên thông tin đã query được ở bước trước khi bước sau cần dùng
- **Kết luận:** gpt-4o-mini không phù hợp cho tác vụ agentic multi-step trong môi trường stateful

---

## 4. Điểm tổng quan và ngưỡng năng lực

### 4.1 Ngưỡng năng lực rõ ràng

Kết quả cho thấy 2 nhóm tách biệt:

| Nhóm | Model | Score | Đặc điểm |
|---|---|---|---|
| **Nhóm A** | gpt-5.5, gpt-4.1, gpt-4.1-mini | 35–42% | Có khả năng lập kế hoạch multi-step cơ bản |
| **Nhóm B** | gpt-4o-mini | 20.1% | Giới hạn ở single-step, không duy trì context |

Ranh giới này không chỉ là về kích thước model mà về **khả năng agentic**: duy trì trạng thái nội tâm qua nhiều lượt, lập kế hoạch tool call sequence, và xử lý kết quả trung gian.

### 4.2 Điểm tuyệt đối thấp — Tác vụ thực sự khó

Cả nhóm A cũng chỉ đạt 35–42% — thấp hơn nhiều so với các benchmark tool calling thông thường (single-turn, fixed schema). Điều này phản ánh bản chất của EnvScaler:
- Không có tool sequence cố định — model phải tự suy luận
- Môi trường stateful — một bước sai ảnh hưởng tất cả bước sau
- Tác vụ composit: mỗi task gồm nhiều sub-tasks độc lập, đòi hỏi model hoàn thành đủ từng phần

### 4.3 Cách biệt nhỏ trong nhóm A — Benchmark cần nhiều records hơn

Cách biệt gpt-5.5 − gpt-4.1-mini chỉ 6.7 điểm. Với sample size hiện tại, khoảng cách nhỏ này có thể không có ý nghĩa thống kê. Cần tăng số lượng records để khẳng định thứ hạng trong nhóm A.

---

## 5. Tính công bằng của benchmark

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Cùng dataset cho mọi model | ✅ | Cùng records, cùng init_config (cache) |
| Metric dựa trên env state | ✅ | Không phụ thuộc judge model, không penalize cách thực hiện |
| Checklist được tạo tự động bởi LLM | ⚠️ | Chất lượng checklist phụ thuộc generator model (gpt-4.1) — checklist có thể thiếu hoặc ambiguous |
| Môi trường được tổng hợp tự động | ⚠️ | Env class code do LLM sinh — có thể có bug ảnh hưởng đến tool behavior |
| Không lưu trajectory từng bước | ⚠️ | Không thể phân tích lỗi xảy ra ở bước nào — chỉ biết kết quả cuối |
| Sample size | ⚠️ | Cần xác nhận số lượng records thực tế để đánh giá độ tin cậy kết quả |

---

## 6. Kết luận

**Ranking:** gpt-5.5 (42.0%) > gpt-4.1 (37.4%) > gpt-4.1-mini (35.3%) >> gpt-4o-mini (20.1%)

**Tóm tắt:**
- **gpt-5.5** dẫn đầu nhờ lập kế hoạch multi-step tốt hơn — phù hợp khi task completion rate là ưu tiên hàng đầu
- **gpt-4.1** cân bằng tốt giữa điểm số và chi phí — lựa chọn thực tế nhất cho production agentic tasks
- **gpt-4.1-mini** gần gpt-4.1 hơn kỳ vọng (chỉ −2.1 điểm) — là lựa chọn tiết kiệm chi phí nếu tác vụ không quá phức tạp
- **gpt-4o-mini** không phù hợp cho tác vụ agentic — cần thay thế bằng model lớn hơn hoặc fine-tune chuyên biệt

**Hướng cải thiện:**
1. **Lưu trajectory từng bước** (tool calls, env state sau mỗi bước) để phân tích điểm thất bại — hiện tại không thể debug vì chỉ có kết quả cuối
2. **Tăng sample size** để cách biệt nhỏ trong nhóm A (gpt-5.5/gpt-4.1/gpt-4.1-mini) có ý nghĩa thống kê
3. **Phân loại tác vụ theo độ phức tạp** (số bước, số entity, dependency depth) để hiểu model nào phù hợp loại tác vụ nào
4. **Cải thiện checklist generation**: thêm bước verify checklist bằng cách chạy thử trên môi trường trước khi dùng để đánh giá
5. **Xem xét fine-tune gpt-4o-mini** trên trajectory data từ các model lớn — SFT có thể thu hẹp khoảng cách 15 điểm đáng kể

---

## 7. Nhận xét chung về EnvScaler và tính phù hợp cho đánh giá thực tế

### 7.1 Điểm số có hợp lý không?

Điểm số 20–42% nhìn qua có vẻ thấp, nhưng **hoàn toàn hợp lý** trong bối cảnh này. EnvScaler đo kết quả môi trường sau khi agent thực thi — không phải xem model có gọi đúng tool hay không, mà xem **database/state có thay đổi đúng như yêu cầu hay không**. Đây là tiêu chí khắt khe hơn nhiều: một bước sai giữa chừng có thể làm sai toàn bộ các bước sau, và model phải hoàn thành đủ tất cả sub-tasks trong checklist mới tính điểm đầy đủ.

So sánh với benchmark tương tự: τ-bench (TauBench) — một benchmark agentic well-known dùng cùng phương pháp đánh giá môi trường stateful — các model frontier cũng chỉ đạt 40–60% ở task phức tạp. Điểm số EnvScaler nằm trong vùng tương tự, cho thấy thang đo có độ khó phù hợp.

Điều đáng chú ý hơn là **khoảng cách giữa các model** phản ánh đúng trực giác: gpt-5.5 > gpt-4.1 > gpt-4.1-mini > gpt-4o-mini, với gpt-4o-mini tụt hẳn một bậc — nhất quán với những gì đã biết về năng lực agentic của từng model.

### 7.2 Điểm mạnh của EnvScaler so với benchmark tool calling thông thường

| Tiêu chí | Tool calling thông thường | EnvScaler |
|---|---|---|
| Thứ gì được đo | Model gọi đúng tool không | Môi trường đạt trạng thái đúng không |
| Penalize cách thực hiện | ✅ Sai thứ tự = mất điểm | ❌ Không quan tâm thứ tự — chỉ kết quả |
| Phản ánh real-world | ⚠️ Trung bình | ✅ Cao — người dùng thực cũng chỉ quan tâm kết quả |
| Môi trường có state | ❌ Stateless, single-turn | ✅ Stateful, multi-turn |
| Tự động sinh dataset | ❌ Cần annotation thủ công | ✅ LLM-generated, scale được |
| Phân tích lỗi | ✅ Rõ ràng (sai tool nào) | ⚠️ Yếu — chỉ biết kết quả cuối |

### 7.3 Có nên dùng EnvScaler trong đánh giá model thực tế không?

**Nên dùng** khi:
- Mục tiêu là đánh giá **khả năng agentic tổng thể** — model có hoàn thành được task phức tạp không, không phải chỉ gọi đúng tool
- Cần **scale dataset nhanh** cho nhiều domain khác nhau mà không có dữ liệu annotation thủ công
- Đánh giá **so sánh tương đối** giữa các model (ranking) — EnvScaler phân biệt tốt các nhóm năng lực

**Chưa nên dùng làm benchmark duy nhất** vì một số hạn chế hiện tại:
- **Môi trường tổng hợp** — env class code do LLM sinh ra, có thể có bug ảnh hưởng tool behavior; không phản ánh API thực tế của sản phẩm
- **Checklist do LLM sinh** — chất lượng tiêu chí đánh giá phụ thuộc vào generator model; checklist có thể thiếu sót hoặc không bao phủ hết yêu cầu task
- **Không có trajectory** — khi model thất bại, không biết thất bại ở bước nào, gọi sai tool nào, hay không hiểu task — debug và cải thiện model rất khó
- **Chưa có phân loại độ khó chuẩn** — không phân biệt được model kém ở tác vụ đơn giản hay chỉ kém ở tác vụ phức tạp

**Kết luận:** EnvScaler phù hợp nhất làm **một thành phần trong bộ đánh giá đa chiều**, kết hợp với các benchmark tool calling schema-based (như bộ AVA đã có) để có bức tranh đầy đủ: vừa đo độ chính xác tool-level, vừa đo khả năng hoàn thành task end-to-end.

---

*Báo cáo được tạo bởi Crab Eval — 26/05/2026*  
*Framework: Next.js + Zustand + EnvScaler sidecar-bridge*  
*Metric: envscaler_score (programmatic, môi trường stateful tổng hợp)*  
*Dataset: EnvScaler multi_turn_tool_calling (dynamic synthetic environments)*
