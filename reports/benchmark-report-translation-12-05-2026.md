# Báo cáo Benchmark — mTranslate Translation
**Ngày thực hiện:** 12/05/2026  
**Tool:** Crab Eval (internal LLM evaluation framework)  
**Dataset:** mTranslate — dịch JSON key-value từ tiếng Việt sang 144 ngôn ngữ — 85 records  
**Tác vụ đánh giá:** Dịch chuỗi giao diện phần mềm (CRM UI labels) sang đa ngôn ngữ

---

## 1. Tổng quan luồng đánh giá

```
[1] Dataset mTranslate (85 records)
        ↓  mỗi record: input = JSON tiếng Việt, reference = JSON ngôn ngữ đích
[2] Run Eval (4 model)
        ↓  model sinh output (JSON dịch sang ngôn ngữ đích)
[3] Metric: chrf (programmatic, client-side)
        ↓  đo character n-gram F-score giữa output và reference
[4] Metric: translation_quality (LLM judge, 1–10 adequacy + fluency)
        ↓  normalized 0–100
[5] Metric: translation_score (composite: 0.4 × chrf + 0.6 × translation_quality)
        ↓  kết quả tổng hợp
[6] Leaderboard
```

### Chi tiết Dataset

- 85 records, mỗi record là một file JSON chứa các chuỗi UI tiếng Việt (CRM, kế toán)
- Mỗi record hướng đến một ngôn ngữ đích khác nhau trong tổng số 144 ngôn ngữ
- Không có metadata phân loại theo `difficulty` hay `intent` — toàn bộ records ở dạng plain
- Reference là bản dịch plain JSON (không có code fence, không có chú thích)

### Chi tiết Metric

| Metric | Loại | Mô tả |
|---|---|---|
| `chrf` | Programmatic | Character n-gram F-score (β=2, n=6) giữa output và reference. Đo độ tương đồng ký tự, phù hợp đa ngôn ngữ và các bộ chữ không dùng khoảng trắng |
| `translation_quality` | LLM judge | Đánh giá adequacy + fluency, normalize về 0–100 |
| `translation_score` | Composite | 0.4 × chrf + 0.6 × translation_quality |

---

## 2. Kết quả

### 2.1 Bảng xếp hạng

| Hạng | Model | chrF | translation_quality | translation_score | Thời gian | Avg/record |
|---|---|---|---|---|---|---|
| 🥇 1 | **gpt-5.5** | **82.95%** | **75.18%** | **78.28%** | 11m 19s | ~8.0s |
| 🥈 2 | **gpt-4.1** | 78.56% | 71.88% | 74.55% | 2m 52s | ~2.0s |
| 🥉 3 | **gpt-4.1-mini** | 70.69% | 68.47% | 69.36% | 3m 36s | ~2.5s |
| 4 | **gpt-4o-mini** | 70.63% | 65.00% | 67.25% | 4m 4s | ~2.9s |

- Không có record nào lỗi (error) ở cả 4 model — toàn bộ 85 records đều `status: done`
- gpt-5.5 chậm nhất: ~8s/record so với ~2s/record của gpt-4.1 (gấp 4 lần)
- gpt-4.1-mini và gpt-4o-mini có chrF tương đương (~70.6%) nhưng gpt-4.1-mini nhỉnh hơn về translation_quality (68.47 vs 65.00)

### 2.2 Phân bố điểm chrF theo record

| Bucket | gpt-5.5 | gpt-4.1 | gpt-4.1-mini | gpt-4o-mini |
|---|---|---|---|---|
| >80 — Xuất sắc | 60/85 **(71%)** | 43/85 (51%) | 29/85 (34%) | 24/85 (28%) |
| 60–80 — Tốt | 23/85 (27%) | 36/85 (42%) | 38/85 (45%) | 44/85 (52%) |
| 40–60 — Trung bình | 2/85 (2%) | 5/85 (6%) | 16/85 (19%) | 15/85 (18%) |
| <40 — Kém | 0/85 **(0%)** | 1/85 (1%) | 2/85 (2%) | 2/85 (2%) |

---

## 3. Phân tích chi tiết từng model

### 3.1 gpt-5.5 — Chất lượng cao nhất

**Scores:** chrF = **82.95%** | translation_quality = **75.18%** | translation_score = **78.28%**

**Điểm mạnh:**
- **chrF:** 71% records đạt >80 — tỉ lệ xuất sắc cao nhất trong nhóm; không có record nào <40 — model luôn giữ đúng bộ chữ ngôn ngữ đích
- **translation_quality:** Điểm cao nhất nhóm (75.18%), khoảng cách rõ với gpt-4.1 (+3.3 điểm) — judge xác nhận model dịch đúng nghĩa và tự nhiên, không chỉ đúng ký tự
- **translation_score:** Dẫn đầu tổng hợp (78.28%) nhờ cả 2 thành phần đều cao
- Không bọc output bằng markdown code fence
- Đạt chrF=100 và translation_quality=100 ở Thai (`mtrans_translation_0131`) — hoàn hảo cả về ký tự lẫn ngữ nghĩa

**Điểm yếu:**
- Chậm nhất trong nhóm: **11m19s** tổng, ~8.0s/record — gấp 4 lần gpt-4.1
- Ngôn ngữ ít tài nguyên: Guarani (`mtrans_translation_0046`) chrF=45.23 và translation_quality=35 — cả hai metric đều thấp, cho thấy model thực sự kém ở ngôn ngữ này chứ không chỉ do khác reference

**Ví dụ tốt nhất (Thai, chrF=100.00, translation_quality=100, translation_score=100):**
- Output = Reference: `{"K_1":"การนัดหมาย","K_2":"งาน","K_3":"การโทร","K_4":" và "}`
- Khớp hoàn toàn về cả ký tự lẫn nội dung

**Ví dụ kém nhất (Guarani, chrF=45.23, translation_quality=35, translation_score=39.09):**
- Reference: `{"K_1":"Cliente","K_2":"Tarjeta de atención",...}` (Spanish-influenced Guarani)
- Actual: `{"K_1":"Mba'ejogua","K_2":"Tarhéta ñeñangareko",...}` — cả chrF lẫn judge đều thấp, xác nhận đây là lỗi thật sự về chất lượng dịch

---

### 3.2 gpt-4.1 — Nhanh, chất lượng tốt

**Scores:** chrF = 78.56% | translation_quality = 71.88% | translation_score = 74.55%

**Điểm mạnh:**
- Nhanh nhất: **2m52s** (~2.0s/record) — phù hợp production
- **chrF:** 51% records đạt >80, cách biệt rõ với nhóm mini
- **translation_quality:** 71.88% — khoảng cách với gpt-5.5 chỉ 3.3 điểm, chứng tỏ chất lượng ngữ nghĩa vẫn tốt dù chrF thấp hơn một phần do code fence
- **translation_score:** 74.55% — vị trí thứ 2, cân bằng giữa tốc độ và chất lượng

**Điểm yếu:**
- Hay bọc output trong markdown ` ```json ``` ` — kéo chrF xuống nhưng translation_quality ít bị ảnh hưởng hơn vì judge đánh giá nội dung, không phải format
- Trường hợp kém nhất: Bhojpuri (`mtrans_translation_0011`, chrF=37.07, translation_quality=55, translation_score=47.83) — dùng Latin romanization thay vì Devanagari; chrF rất thấp nhưng translation_quality=55 (judge nhận ra nghĩa đúng dù sai bộ chữ)
- Nhầm ngôn ngữ: Indonesian (`mtrans_translation_0065`, chrF=41.57, translation_quality=15, translation_score=34.63) — dịch sang tiếng Anh; cả 2 metric đều thấp, judge cũng xác nhận đây là lỗi nghiêm trọng

**Ví dụ kém nhất (Bhojpuri, chrF=37.07, translation_quality=55, translation_score=47.83):**
- Reference: `{"K_1":"ग्राहक","K_2":"देखभाल कार्ड",...}` (Devanagari)
- Actual: `{"K_1":"Grahak","K_2":"Dekhbhaal Card",...}` (Latin romanization) — chrF thấp do sai bộ chữ, translation_quality trung bình vì nghĩa vẫn đúng

---

### 3.3 gpt-4.1-mini — Nhiều lỗi định dạng

**Scores:** chrF = 70.69% | translation_quality = 68.47% | translation_score = 69.36%

**Điểm mạnh:**
- Thời gian ổn: **3m36s** (~2.5s/record)
- **translation_quality:** 68.47% — nhỉnh hơn gpt-4o-mini 3.5 điểm, cho thấy chất lượng ngữ nghĩa tốt hơn dù chrF gần tương đương

**Điểm yếu:**
- **chrF:** 70.69% — thấp hơn gpt-4.1 gần 8 điểm; 19% records ở bucket 40–60, 2% dưới 40
- **translation_quality:** 68.47% — kém gpt-4.1 3.4 điểm, kém gpt-5.5 6.7 điểm; judge xác nhận cả chất lượng ngữ nghĩa cũng kém hơn, không chỉ do format
- **translation_score:** 69.36% — kém gpt-4.1 5.2 điểm
- Code fence wrapping thường xuyên — kéo chrF xuống nhưng translation_quality cũng thấp, chứng tỏ có vấn đề cả về nội dung
- Tigrinya (`mtrans_translation_0132`, chrF=37.13, translation_quality=60, translation_score=50.85) — Ge'ez script bị suy giảm + code fence; translation_quality=60 cho thấy judge vẫn nhận ra một phần nghĩa
- Chuvash (`mtrans_translation_0026`, chrF=40.94, translation_quality=35, translation_score=37.37) — sai từ vựng nhiều; cả chrF lẫn judge đều thấp, lỗi thực sự về chất lượng

**Ví dụ kém nhất (Tigrinya, chrF=37.13, translation_quality=60, translation_score=50.85):**
- Reference: `{"K_1":"ሙሉ ስልጣን","K_2":"ዓይነት ንብረት",...}` (Ge'ez script)
- Actual: output bọc code fence + từ vựng Ge'ez sai; chrF rất thấp nhưng translation_quality=60 — judge vẫn nhận ra cấu trúc JSON và một phần nghĩa

---

### 3.4 gpt-4o-mini — Điểm thấp nhất

**Scores:** chrF = 70.63% | translation_quality = 65.00% | translation_score = 67.25%

**Điểm mạnh:**
- Thời gian hợp lý: **4m4s** (~2.9s/record)

**Điểm yếu:**
- **chrF:** 70.63% — gần bằng gpt-4.1-mini (70.69%) nhưng phân bố kém hơn (chỉ 28% records >80 so với 34%)
- **translation_quality:** 65.00% — **thấp nhất trong nhóm**, kém gpt-4.1-mini 3.5 điểm, kém gpt-5.5 10 điểm; cho thấy cả chất lượng ngữ nghĩa cũng thấp hơn, không chỉ vấn đề format
- **translation_score:** 67.25% — thấp nhất, phản ánh cả hai thành phần đều yếu
- Code fence wrapping tương tự các mini model
- Nhầm ngôn ngữ: `mtrans_translation_0023` (chrF=36.72, translation_quality=70, translation_score=56.69) — Azerbaijani Latin nhưng model dịch sang Tatar Cyrillic; chrF rất thấp, nhưng translation_quality=70 vì judge nhận thấy nghĩa gần đúng dù sai ngôn ngữ
- Chuvash (`mtrans_translation_0026`, chrF=38.49, translation_quality=15, translation_score=24.39) — cả hai metric đều thấp; translation_quality=15 cho thấy judge cũng đánh giá đây là lỗi nghiêm trọng về nội dung

**Ví dụ kém nhất về nội dung (Chuvash, chrF=38.49, translation_quality=15, translation_score=24.39):**
- Reference: `{"K_1":"Тулли тивĕç","K_2":"Тавар тĕсĕ",...}` (Chuvash Cyrillic)
- Actual: output sai hoàn toàn về từ vựng — cả chrF lẫn judge đều xác nhận đây là bản dịch kém nhất của model này

**Ví dụ lệch giữa chrF và translation_quality (Azerbaijani, chrF=36.72, translation_quality=70):**
- Reference: `{"K_1":"Ticari teklif","K_2":"Müşteri",...}` (Azerbaijani Latin)
- Actual: `{"K_1":"Тәкъдим итү","K_2":"Клиент",...}` (Tatar Cyrillic) — chrF thấp do sai ngôn ngữ/bộ chữ, translation_quality=70 vì judge nhận ra nghĩa tương đương

---

## 4. Vấn đề quan sát được

### 4.1 Markdown code fence wrapping
gpt-4.1, gpt-4.1-mini và gpt-4o-mini bọc output trong ` ```json ``` `. Vì reference là plain JSON, điều này thêm ký tự thừa và hạ thấp chrF ngay cả khi bản dịch thực chất đúng. gpt-5.5 không có hành vi này.

**Khắc phục:** Thêm vào system prompt: "Output only the raw JSON object without markdown code fences."

### 4.2 Script substitution cho ngôn ngữ ít tài nguyên
Một số ngôn ngữ bị model dùng bộ chữ sai (Latin thay vì Devanagari, Ge'ez bị suy giảm, Cyrillic nhầm dialect) hoặc không có đủ training data (Guarani, Tigrinya, Bhojpuri, Chuvash). chrF penalty cho lỗi này rất nặng vì không có ký tự nào khớp.

### 4.3 Nhầm ngôn ngữ
- gpt-4.1: dịch Indonesian → tiếng Anh (`mtrans_translation_0065`)
- gpt-4o-mini: dịch Azerbaijani → Tatar Cyrillic (`mtrans_translation_0023`)
- Đây là lỗi nghiêm trọng nhất về tác vụ: model hiểu sai ngôn ngữ đích

### 4.4 Sự chênh lệch giữa chrF và translation_quality
Một số records có chrF thấp nhưng translation_quality trung bình (vd: `mtrans_translation_0023` gpt-4o-mini: chrF=36.72 nhưng tq=70) — cho thấy chrF đo character-level similarity với reference cụ thể, trong khi judge đánh giá adequacy/fluency thực tế. Hai metric bổ trợ cho nhau.

---

## 5. Tính công bằng của benchmark

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Cùng dataset cho mọi model | ✅ | 85 records giống nhau |
| Metric programmatic | ✅ | chrF không phụ thuộc judge model |
| Judge metrics có kết quả | ✅ | translation_quality và translation_score đã có đủ |
| Không có lỗi kỹ thuật | ✅ | 0 error records ở cả 4 model |
| Phân bố ngôn ngữ đích | ⚠️ | 144 ngôn ngữ, phân bố không đều về độ khó (high-resource vs low-resource) |
| chrF phù hợp đa bộ chữ | ✅ | character-level, không phụ thuộc tokenizer ngôn ngữ cụ thể |

---

## 6. Kết luận

**Ranking:** gpt-5.5 (78.28%) > gpt-4.1 (74.55%) > gpt-4.1-mini (69.36%) > gpt-4o-mini (67.25%)

*(Ranking theo translation_score tổng hợp)*

**Tóm tắt:**
- **gpt-5.5** chất lượng dịch cao nhất — không bao giờ dùng sai bộ chữ, không bọc code fence — nhưng chậm và đắt gấp 4 lần gpt-4.1
- **gpt-4.1** cân bằng tốt giữa chất lượng và tốc độ — phù hợp production nếu fix vấn đề code fence bằng system prompt
- **gpt-4.1-mini** và **gpt-4o-mini** điểm gần nhau (~67–69%), có lỗi nhầm ngôn ngữ và code fence — chỉ phù hợp khi chi phí là ưu tiên tuyệt đối và các ngôn ngữ đích là high-resource

**Khuyến nghị:**
1. Bổ sung instruction "Output only raw JSON without markdown code fences" vào system prompt để khắc phục vấn đề code fence của gpt-4.1, gpt-4.1-mini, và gpt-4o-mini
2. Tách phân tích theo nhóm ngôn ngữ: high-resource (Latin script, CJK) vs low-resource (Ge'ez, Devanagari, ngôn ngữ thiểu số) để đánh giá công bằng hơn
3. Thêm metadata `difficulty` hoặc `language_family` vào dataset để có Analysis breakdown theo nhóm
4. Xem xét chạy thêm với system prompt đã fix để so sánh delta cải thiện giữa các model

---

*Báo cáo được tạo bởi Crab Eval — 12/05/2026*  
*Framework: Next.js + Zustand, metric tính client-side (programmatic) + LLM judge*  
*Dataset: mTranslate — 85 records, 144 ngôn ngữ đích*  
*Run ID: gpt-5.5=c9390328 | gpt-4.1=227ad706 | gpt-4.1-mini=b42049fa | gpt-4o-mini=b486df45*
