# Intent classification — metric chuẩn (macro-F1 + per-class + OOS)

_Sinh bởi scripts/intent_classification_report.mjs — 2026-06-30T04:49:50.409Z_

> Đường chéo tin `scores.accuracy` của crab-eval; off-diagonal canon best-effort. macro-F1 tính trên lớp gold. crm_intent: dòng GT=JSON (task trích xuất) bị tách khỏi metric.


---

## htkh_intent_classification


### gpt-4.1

- n (chấm) = **150**
- accuracy (clean) = **96.7%**  | crab-eval báo (toàn bộ) = 96.7%  | majority-baseline = 92.0%
- **macro-F1 = 90.5%**  | weighted-F1 = 96.9%
- lớp trọng tâm `request_human_handoff`: P=70.6% R=100.0% **F1=82.8%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 100.0% | 96.4% | 98.2% | 138 |
| `request_human_handoff` | 70.6% | 100.0% | 82.8% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     133                      5    | 138
request_human_handoff                        0                     12     | 12
```


### gpt-4.1-mini

- n (chấm) = **150**
- accuracy (clean) = **96.7%**  | crab-eval báo (toàn bộ) = 96.7%  | majority-baseline = 92.0%
- **macro-F1 = 90.5%**  | weighted-F1 = 96.9%
- lớp trọng tâm `request_human_handoff`: P=70.6% R=100.0% **F1=82.8%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 100.0% | 96.4% | 98.2% | 138 |
| `request_human_handoff` | 70.6% | 100.0% | 82.8% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     133                      5    | 138
request_human_handoff                        0                     12     | 12
```


### misa-ai-1.0

- n (chấm) = **150**
- accuracy (clean) = **90.7%**  | crab-eval báo (toàn bộ) = 90.7%  | majority-baseline = 92.0%
- **macro-F1 = 78.9%**  | weighted-F1 = 92.1%
- lớp trọng tâm `request_human_handoff`: P=46.2% R=100.0% **F1=63.2%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 100.0% | 89.9% | 94.7% | 138 |
| `request_human_handoff` | 46.2% | 100.0% | 63.2% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     124                     14    | 138
request_human_handoff                        0                     12     | 12
```


### misa-ai-1.0-plus

- n (chấm) = **141**
- accuracy (clean) = **96.5%**  | crab-eval báo (toàn bộ) = 96.5%  | majority-baseline = 92.2%
- **macro-F1 = 89.0%**  | weighted-F1 = 96.6%
- lớp trọng tâm `request_human_handoff`: P=71.4% R=90.9% **F1=80.0%** (support 11)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 99.2% | 96.9% | 98.1% | 130 |
| `request_human_handoff` | 71.4% | 90.9% | 80.0% | 11 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     126                      4    | 130
request_human_handoff                        1                     10     | 11
```


### misa-ai-1.1

- n (chấm) = **150**
- accuracy (clean) = **95.3%**  | crab-eval báo (toàn bộ) = 95.3%  | majority-baseline = 92.0%
- **macro-F1 = 87.4%**  | weighted-F1 = 95.8%
- lớp trọng tâm `request_human_handoff`: P=63.2% R=100.0% **F1=77.4%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 100.0% | 94.9% | 97.4% | 138 |
| `request_human_handoff` | 63.2% | 100.0% | 77.4% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     131                      7    | 138
request_human_handoff                        0                     12     | 12
```


### misa-ai-1.1-plus

- n (chấm) = **150**
- accuracy (clean) = **97.3%**  | crab-eval báo (toàn bộ) = 97.3%  | majority-baseline = 92.0%
- **macro-F1 = 91.6%**  | weighted-F1 = 97.4%
- lớp trọng tâm `request_human_handoff`: P=78.6% R=91.7% **F1=84.6%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 99.3% | 97.8% | 98.5% | 138 |
| `request_human_handoff` | 78.6% | 91.7% | 84.6% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     135                      3    | 138
request_human_handoff                        1                     11     | 12
```


### misa-ai-2.0-bloom

- n (chấm) = **150**
- accuracy (clean) = **97.3%**  | crab-eval báo (toàn bộ) = 97.3%  | majority-baseline = 92.0%
- **macro-F1 = 92.1%**  | weighted-F1 = 97.5%
- lớp trọng tâm `request_human_handoff`: P=75.0% R=100.0% **F1=85.7%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 100.0% | 97.1% | 98.5% | 138 |
| `request_human_handoff` | 75.0% | 100.0% | 85.7% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     134                      4    | 138
request_human_handoff                        0                     12     | 12
```


### misa-gemma-4-26b-it-06042026

- n (chấm) = **150**
- accuracy (clean) = **95.3%**  | crab-eval báo (toàn bộ) = 95.3%  | majority-baseline = 92.0%
- **macro-F1 = 86.6%**  | weighted-F1 = 95.7%
- lớp trọng tâm `request_human_handoff`: P=64.7% R=91.7% **F1=75.9%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 99.2% | 95.7% | 97.4% | 138 |
| `request_human_handoff` | 64.7% | 91.7% | 75.9% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     132                      6    | 138
request_human_handoff                        1                     11     | 12
```


### misa-gemma-4-31b-it-06042026

- n (chấm) = **150**
- accuracy (clean) = **98.0%**  | crab-eval báo (toàn bộ) = 98.0%  | majority-baseline = 92.0%
- **macro-F1 = 92.9%**  | weighted-F1 = 98.0%
- lớp trọng tâm `request_human_handoff`: P=90.9% R=83.3% **F1=87.0%** (support 12)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `others` | 98.6% | 99.3% | 98.9% | 138 |
| `request_human_handoff` | 90.9% | 83.3% | 87.0% | 12 |

**Confusion matrix:**

```
gold\pred                               others  request_human_handoff  | total
others                                     137                      1    | 138
request_human_handoff                        2                     10     | 12
```


---

## htkh_intent_routing


### gpt-4.1

- n (chấm) = **154**
- accuracy (clean) = **66.9%**  | crab-eval báo (toàn bộ) = 66.9%  | majority-baseline = 50.0%
- **macro-F1 = 60.2%**  | weighted-F1 = 69.6%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 90.6% | 75.3% | 82.3% | 77 |
| `clarify` | 70.2% | 51.6% | 59.5% | 64 |
| `rag_answer` | 25.0% | 90.0% | 39.1% | 10 |
| `chitchat` | 42.9% | 100.0% | 60.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify  human_handoff     rag_answer       chitchat  | total
human_handoff               13             58              2              4     | 77
clarify                     33              6             25              0     | 64
rag_answer                   1              0              9              0     | 10
chitchat                     0              0              0              3      | 3
```


### gpt-4.1-mini

- n (chấm) = **154**
- accuracy (clean) = **68.2%**  | crab-eval báo (toàn bộ) = 68.2%  | majority-baseline = 50.0%
- **macro-F1 = 61.1%**  | weighted-F1 = 71.3%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 95.1% | 75.3% | 84.1% | 77 |
| `clarify` | 70.0% | 54.7% | 61.4% | 64 |
| `rag_answer` | 25.0% | 90.0% | 39.1% | 10 |
| `chitchat` | 42.9% | 100.0% | 60.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat  | total
human_handoff               14              2             58              3     | 77
clarify                     35             25              3              1     | 64
rag_answer                   1              9              0              0     | 10
chitchat                     0              0              0              3      | 3
```


### misa-ai-1.0

- n (chấm) = **154**
- accuracy (clean) = **58.4%**  | crab-eval báo (toàn bộ) = 58.4%  | majority-baseline = 50.0%
- **macro-F1 = 48.9%**  | weighted-F1 = 58.0%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 80.5% | 90.9% | 85.4% | 77 |
| `clarify` | 70.6% | 18.8% | 29.6% | 64 |
| `rag_answer` | 20.7% | 60.0% | 30.8% | 10 |
| `chitchat` | 40.0% | 66.7% | 50.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify          OTHER  human_handoff     rag_answer       chitchat  | total
human_handoff                5              1             70              1              0     | 77
clarify                     12             11             16             22              3     | 64
rag_answer                   0              3              1              6              0     | 10
chitchat                     0              1              0              0              2      | 3
```


### misa-ai-1.0-plus

- n (chấm) = **139**
- accuracy (clean) = **59.7%**  | crab-eval báo (toàn bộ) = 59.7%  | majority-baseline = 48.2%
- **macro-F1 = 46.4%**  | weighted-F1 = 61.5%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 90.5% | 85.1% | 87.7% | 67 |
| `clarify` | 78.9% | 25.0% | 38.0% | 60 |
| `rag_answer` | 21.3% | 100.0% | 35.1% | 10 |
| `chitchat` | 16.7% | 50.0% | 25.0% | 2 |

**Confusion matrix:**

```
gold\pred              clarify  human_handoff     rag_answer       chitchat          OTHER  | total
human_handoff                4             57              4              1              1     | 67
clarify                     15              6             32              4              3     | 60
rag_answer                   0              0             10              0              0     | 10
chitchat                     0              0              1              1              0      | 2
```


### misa-ai-1.1

- n (chấm) = **154**
- accuracy (clean) = **51.9%**  | crab-eval báo (toàn bộ) = 52.0%  | majority-baseline = 50.0%
- **macro-F1 = 51.1%**  | weighted-F1 = 53.6%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 87.9% | 75.3% | 81.1% | 77 |
| `clarify` | 81.8% | 14.1% | 24.0% | 64 |
| `rag_answer` | 13.9% | 100.0% | 24.4% | 10 |
| `chitchat` | 60.0% | 100.0% | 75.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat  | total
human_handoff                2             16             58              1     | 77
clarify                      9             46              8              1     | 64
rag_answer                   0             10              0              0     | 10
chitchat                     0              0              0              3      | 3
```


### misa-ai-1.1-plus

- n (chấm) = **154**
- accuracy (clean) = **59.1%**  | crab-eval báo (toàn bộ) = 59.1%  | majority-baseline = 50.0%
- **macro-F1 = 47.4%**  | weighted-F1 = 54.4%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 78.0% | 92.2% | 84.5% | 77 |
| `clarify` | 80.0% | 12.5% | 21.6% | 64 |
| `rag_answer` | 20.5% | 90.0% | 33.3% | 10 |
| `chitchat` | 33.3% | 100.0% | 50.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat  | total
human_handoff                2              3             71              1     | 77
clarify                      8             32             19              5     | 64
rag_answer                   0              9              1              0     | 10
chitchat                     0              0              0              3      | 3
```


### misa-ai-2.0-bloom

- n (chấm) = **154**
- accuracy (clean) = **55.8%**  | crab-eval báo (toàn bộ) = 55.8%  | majority-baseline = 50.0%
- **macro-F1 = 48.4%**  | weighted-F1 = 54.4%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 88.0% | 85.7% | 86.8% | 77 |
| `clarify` | 87.5% | 10.9% | 19.4% | 64 |
| `rag_answer` | 15.9% | 100.0% | 27.4% | 10 |
| `chitchat` | 42.9% | 100.0% | 60.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat          OTHER  | total
human_handoff                1              9             66              1              0     | 77
clarify                      7             44              9              3              1     | 64
rag_answer                   0             10              0              0              0     | 10
chitchat                     0              0              0              3              0      | 3
```


### misa-gemma-4-26b-it-06042026

- n (chấm) = **154**
- accuracy (clean) = **58.4%**  | crab-eval báo (toàn bộ) = 58.4%  | majority-baseline = 50.0%
- **macro-F1 = 49.7%**  | weighted-F1 = 58.6%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 82.9% | 81.8% | 82.4% | 77 |
| `clarify` | 65.2% | 23.4% | 34.5% | 64 |
| `rag_answer` | 19.6% | 90.0% | 32.1% | 10 |
| `chitchat` | 33.3% | 100.0% | 50.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat  | total
human_handoff                7              3             63              4     | 77
clarify                     15             34             13              2     | 64
rag_answer                   1              9              0              0     | 10
chitchat                     0              0              0              3      | 3
```


### misa-gemma-4-31b-it-06042026

- n (chấm) = **154**
- accuracy (clean) = **60.4%**  | crab-eval báo (toàn bộ) = 60.4%  | majority-baseline = 50.0%
- **macro-F1 = 54.0%**  | weighted-F1 = 61.6%

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `human_handoff` | 82.4% | 79.2% | 80.8% | 77 |
| `clarify` | 63.6% | 32.8% | 43.3% | 64 |
| `rag_answer` | 20.0% | 80.0% | 32.0% | 10 |
| `chitchat` | 42.9% | 100.0% | 60.0% | 3 |

**Confusion matrix:**

```
gold\pred              clarify     rag_answer  human_handoff       chitchat  | total
human_handoff               11              2             61              3     | 77
clarify                     21             30             13              0     | 64
rag_answer                   1              8              0              1     | 10
chitchat                     0              0              0              3      | 3
```


---

## crm_intent_analysis


### gpt-4.1

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **67.3%**  | crab-eval báo (toàn bộ) = 57.9%  | majority-baseline = 79.6%
- **macro-F1 = 44.0%**  | weighted-F1 = 74.7%
- OOS detection `unknown` (in-scope vs unknown): P=96.4% R=69.2% **F1=80.6%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 96.4% | 69.2% | 80.6% | 39 |
| `2` | 71.4% | 100.0% | 83.3% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `5` | 0.0% | 0.0% | 0.0% | 1 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2    OTHER        5      1,2      1,5        1  | total
unknown         27        2        8        2        0        0        0     | 39
2                0        5        0        0        0        0        0      | 5
1,5              0        0        2        0        0        0        0      | 2
5                1        0        0        0        0        0        0      | 1
1,2              0        0        1        0        0        0        0      | 1
1                0        0        0        0        0        0        1      | 1
```


### gpt-4.1-mini

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **81.6%**  | crab-eval báo (toàn bộ) = 82.5%  | majority-baseline = 79.6%
- **macro-F1 = 61.6%**  | weighted-F1 = 87.0%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=89.7% **F1=94.6%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 89.7% | 94.6% | 39 |
| `2` | 100.0% | 60.0% | 75.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |
| `5` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2    OTHER      1,2      1,5        1        5  | total
unknown         35        0        4        0        0        0        0     | 39
2                0        3        2        0        0        0        0      | 5
1,5              0        0        2        0        0        0        0      | 2
1,2              0        0        1        0        0        0        0      | 1
1                0        0        0        0        0        1        0      | 1
5                0        0        0        0        0        0        1      | 1
```


### misa-ai-1.0

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **91.8%**  | crab-eval báo (toàn bộ) = 80.7%  | majority-baseline = 79.6%
- **macro-F1 = 50.0%**  | weighted-F1 = 91.8%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=100.0% **F1=100.0%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 100.0% | 100.0% | 39 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `5` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2      1,2    OTHER      1,5        5        1  | total
unknown         39        0        0        0        0        0        0     | 39
2                0        5        0        0        0        0        0      | 5
1,5              0        0        0        0        0        2        0      | 2
1,2              0        0        0        1        0        0        0      | 1
5                0        0        0        1        0        0        0      | 1
1                0        0        0        0        0        0        1      | 1
```


### misa-ai-1.0-plus

- n (chấm) = **46**  | excluded (GT=JSON, task trích xuất) = **7**
- accuracy (clean) = **87.0%**  | crab-eval báo (toàn bộ) = 75.5%  | majority-baseline = 78.3%
- **macro-F1 = 54.8%**  | weighted-F1 = 88.6%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=91.7% **F1=95.7%** (support 36)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 91.7% | 95.7% | 36 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `5` | 50.0% | 100.0% | 66.7% | 1 |
| `1` | 50.0% | 100.0% | 66.7% | 1 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2        5    OTHER        1      1,2      1,5  | total
unknown         33        0        1        1        1        0        0     | 36
2                0        5        0        0        0        0        0      | 5
1,5              0        0        0        2        0        0        0      | 2
5                0        0        1        0        0        0        0      | 1
1                0        0        0        0        1        0        0      | 1
1,2              0        0        0        1        0        0        0      | 1
```


### misa-ai-1.1

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **83.7%**  | crab-eval báo (toàn bộ) = 71.9%  | majority-baseline = 79.6%
- **macro-F1 = 65.5%**  | weighted-F1 = 88.4%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=87.2% **F1=93.2%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 87.2% | 93.2% | 39 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |
| `5` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown    OTHER        2      1,2      1,5        1        5  | total
unknown         34        5        0        0        0        0        0     | 39
2                0        0        5        0        0        0        0      | 5
1,5              0        2        0        0        0        0        0      | 2
1,2              0        1        0        0        0        0        0      | 1
1                0        0        0        0        0        1        0      | 1
5                0        0        0        0        0        0        1      | 1
```


### misa-ai-1.1-plus

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **69.4%**  | crab-eval báo (toàn bộ) = 59.6%  | majority-baseline = 79.6%
- **macro-F1 = 63.6%**  | weighted-F1 = 79.4%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=69.2% **F1=81.8%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 69.2% | 81.8% | 39 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |
| `5` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown    OTHER        2      1,2      1,5        1        5  | total
unknown         27       12        0        0        0        0        0     | 39
2                0        0        5        0        0        0        0      | 5
1,5              0        2        0        0        0        0        0      | 2
1,2              0        1        0        0        0        0        0      | 1
1                0        0        0        0        0        1        0      | 1
5                0        0        0        0        0        0        1      | 1
```


### misa-ai-2.0-bloom

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **79.6%**  | crab-eval báo (toàn bộ) = 68.4%  | majority-baseline = 79.6%
- **macro-F1 = 52.8%**  | weighted-F1 = 82.7%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=82.1% **F1=90.1%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 82.1% | 90.1% | 39 |
| `2` | 62.5% | 100.0% | 76.9% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |
| `5` | 33.3% | 100.0% | 50.0% | 1 |
| `1` | 100.0% | 100.0% | 100.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2    OTHER      1,2        5      1,5        1  | total
unknown         32        3        3        0        1        0        0     | 39
2                0        5        0        0        0        0        0      | 5
1,5              0        0        1        0        1        0        0      | 2
1,2              0        0        1        0        0        0        0      | 1
5                0        0        0        0        1        0        0      | 1
1                0        0        0        0        0        0        1      | 1
```


### misa-gemma-4-26b-it-06042026

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **65.3%**  | crab-eval báo (toàn bộ) = 56.1%  | majority-baseline = 79.6%
- **macro-F1 = 46.4%**  | weighted-F1 = 74.4%
- OOS detection `unknown` (in-scope vs unknown): P=100.0% R=64.1% **F1=78.1%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 100.0% | 64.1% | 78.1% | 39 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `5` | 20.0% | 100.0% | 33.3% | 1 |
| `1` | 50.0% | 100.0% | 66.7% | 1 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        5        2    OTHER     JSON        1      1,2      1,5  | total
unknown         25        4        0        4        5        1        0        0     | 39
2                0        0        5        0        0        0        0        0      | 5
1,5              0        0        0        1        1        0        0        0      | 2
5                0        1        0        0        0        0        0        0      | 1
1                0        0        0        0        0        1        0        0      | 1
1,2              0        0        0        1        0        0        0        0      | 1
```


### misa-gemma-4-31b-it-06042026

- n (chấm) = **49**  | excluded (GT=JSON, task trích xuất) = **8**
- accuracy (clean) = **65.3%**  | crab-eval báo (toàn bộ) = 56.1%  | majority-baseline = 79.6%
- **macro-F1 = 38.1%**  | weighted-F1 = 73.9%
- OOS detection `unknown` (in-scope vs unknown): P=96.3% R=66.7% **F1=78.8%** (support 39)

| lớp | precision | recall | F1 | support |
|---|---|---|---|---|
| `unknown` | 96.3% | 66.7% | 78.8% | 39 |
| `2` | 100.0% | 100.0% | 100.0% | 5 |
| `1,5` | 0.0% | 0.0% | 0.0% | 2 |
| `5` | 0.0% | 0.0% | 0.0% | 1 |
| `1` | 33.3% | 100.0% | 50.0% | 1 |
| `1,2` | 0.0% | 0.0% | 0.0% | 1 |

**Confusion matrix:**

```
gold\pred  unknown        2    OTHER     JSON        5        1      1,2      1,5  | total
unknown         26        0        7        1        3        2        0        0     | 39
2                0        5        0        0        0        0        0        0      | 5
1,5              0        0        2        0        0        0        0        0      | 2
5                1        0        0        0        0        0        0        0      | 1
1                0        0        0        0        0        1        0        0      | 1
1,2              0        0        1        0        0        0        0        0      | 1
```
