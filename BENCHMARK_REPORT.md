# Benchmark AVA Tuyển Dụng

**27/03/2026** · 9 models · 10 tasks · Agentic simulation (Visual Eval)

---

## Leaderboard

| Hạng | Model | Avg | Final | Thời gian | Turns |
|:---:|---|:---:|:---:|:---:|:---:|
| 🥇 | **misa-ai-1.1-plus** | **66.8%** | 67 | 95s | 38 |
| 🥈 | **claude-opus-4-5** | **66.0%** | 66 | 330s | 41 |
| 🥈 | **gpt-5.4** | **66.0%** | 66 | 216s | 51 |
| 4 | misa-ai-1.1 | 65.6% | 66 | 129s | 44 |
| 5 | claude-sonnet-4-5 | 64.8% | 65 | 538s | 58 |
| 6 | gpt-4.1 | 58.5% | 59 | 145s | 50 |
| 7 | misa-ai-1.0-plus | 58.0% | 58 | 409s | 58 |
| 8 | gpt-4.1-mini | 57.8% | 58 | 162s | 53 |
| 9 | misa-ai-1.0 | 56.0% | 56 | 135s | 46 |

> Avg = trung bình 10 task scores. Final = điểm holistic do judge LLM chấm. Best single run per model.

---

## Per-task

| Task | 1.1+ | opus | gpt5.4 | 1.1 | sonnet | 4.1 | 1.0+ | mini | 1.0 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| T1: Tìm ứng viên theo tên gần đúng | 85 | **90** | 85 | **90** | **90** | 55 | **90** | 55 | 85 |
| T2: Lấy JD/Requirement của tin | 40 | 55 | 45 | **78** | 85 | 40 | 40 | 35 | 45 |
| T3: Tìm ứng viên khi chỉ có tên | **90** | 88 | **90** | 80 | **90** | 85 | 88 | 85 | 85 |
| T4: Lấy 10 ứng viên gần nhất | **88** | 45 | 70 | 45 | 40 | 45 | 45 | 40 | 40 |
| T5: Fit score 1 ứng viên | 55 | 40 | 40 | 50 | 45 | 50 | 50 | 45 | 50 |
| T6: Fit score 3 ứng viên + tóm tắt | 45 | 45 | 45 | 40 | 55 | 55 | 45 | 60 | 30 |
| T7: So sánh 2 ứng viên, đề xuất | 50 | **75** | **75** | 45 | 50 | **75** | **75** | 50 | 45 |
| T8: Xử lý yêu cầu mơ hồ / thiếu ID | **95** | 92 | **95** | 88 | 35 | 35 | 92 | 90 | 90 |
| T9: Tạo câu hỏi phỏng vấn | 85 | 80 | 55 | 85 | **88** | 85 | 55 | **88** | 55 |
| T10: Soạn & lưu email mời phỏng vấn | 35 | 50 | **60** | 55 | **70** | **60** | 0 | 30 | 35 |

---

## Nhận xét nhanh

**Điểm mạnh chung:** T1 (tìm kiếm) và T3 (tìm theo tên) — hầu hết model đều đạt 80+. T8 (hỏi làm rõ) phân hóa rõ: top group 88–95, trong khi gpt-4.1 và claude-sonnet chỉ 35 vì gọi tool ngay khi thiếu ID.

**Điểm yếu chung:** T5/T6 (fit score + nhận xét) — không model nào vượt 60. Tool trả về điểm số, model paraphrase tên field thay vì đọc CV thực. T10 (email + lưu template) — không model nào đạt đúng flow đầy đủ.

**Theo model:**

| Model | Mạnh | Yếu |
|---|---|---|
| misa-ai-1.1-plus | T4 (88), T8 (95), tốc độ nhanh | T2 (40), T6 (45), T10 (35) |
| claude-opus-4-5 | T1/T3/T8 nhất quán, ít turns nhất (41) | T4/T5/T6 thấp |
| gpt-5.4 | T8 (95), T3/T7 tốt, trình bày rõ | T9 (55), T5 thấp |
| misa-ai-1.1 | T2 tốt nhất cả field (78), T8 (88) | T6/T7 thấp, baseline so với 1.1+ |
| claude-sonnet-4-5 | T2 (85), T9/T10 tốt nhất | T8 chỉ 35 — điểm nguy hiểm cho production |
| gpt-4.1 | T7 (75), T9 (85) ổn | T8 (35) — gọi tool khi thiếu ID |
| misa-ai-1.0-plus | T8 (92), T1/T3/T7 tốt | 3.2× chậm hơn 1.1+, T10 = 0 |
| gpt-4.1-mini | T8/T9 (90/88) tốt, nhẹ, nhanh | T1/T2 thấp, reasoning giới hạn |
| misa-ai-1.0 | T8 (90), baseline ổn | T6/T9 thấp, bịa dữ liệu khi tool thiếu |

---

## Vấn đề kỹ thuật cần fix

1. **ID inconsistency** — Oracle sinh `UV1023` / `CAND-1023` / `1023` lẫn lộn. 5/9 model bị ảnh hưởng ở T5/T6, điểm chưa phản ánh đúng năng lực.
2. **Tool fit score thiếu context** — `get_multiple_candidates_fit_score` chỉ trả số, không có excerpt CV/JD. Model không có căn cứ để nhận xét cụ thể.
3. **T10 flow chưa ổn định** — Cần test lại tool `save_email_template` với data chuẩn hơn.

---

## Setup

- **Phương pháp:** Visual Eval — User Model (AI đóng vai HR) hội thoại với Target Model (AVA). Oracle AI mock tool responses. Judge LLM chấm transcript.
- **Replay mode:** Tất cả 9 model nhận cùng 10 câu hỏi giống hệt nhau — đảm bảo công bằng.
- **Judge:** LLM đọc toàn transcript, chấm per-task 0–100, sai số ±5 điểm.
- **Merge:** Best single run per model (không cherry-pick per task).

---

*Eval Studio · Visual Eval Module · 27/03/2026*
