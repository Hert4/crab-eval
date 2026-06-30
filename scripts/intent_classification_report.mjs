#!/usr/bin/env node
// intent_classification_report.mjs
// ------------------------------------------------------------------
// Tính metric phân loại đúng chuẩn (CLINC-150 / Banking77 + OOS) cho 3 bộ intent,
// CHẠY OFFLINE trên các file đã có trong results/<model>/<dataset>.json.
// Không cần data raw, không gọi LLM, không sửa evalRunner.
//
// Vì sao cần: 3 bộ này đang chấm `accuracy` trần → bị lớp đa số nuốt
//   (vd htkh_classification: đoán bừa "others" đã 92%). Script bổ sung:
//     - macro-F1, weighted-F1
//     - precision/recall/F1 từng lớp + support
//     - confusion matrix
//     - majority-baseline để biết accuracy "thật sự" hơn baseline bao nhiêu
//     - tách known (in-scope) vs unknown (OOS) — báo riêng (kiểu CLINC)
//     - crm_intent: TÁCH 8 dòng JSON (task trích xuất, sai chỗ) ra khỏi metric
//
// Phương pháp chấm đường chéo: tin `record.scores.accuracy` (normalization
//   chính thức của crab-eval, gồm unknown-synonyms + valid_label_range).
//   Khi đúng -> pred = nhãn gold. Khi sai -> best-effort canon của output
//   (không nhận dạng được -> bucket 'OTHER'). Cách hybrid này khớp 100%
//   accuracy crab-eval báo, đồng thời dựng được off-diagonal cho confusion.
//
// Dùng:
//   node scripts/intent_classification_report.mjs                 # tất cả model
//   node scripts/intent_classification_report.mjs --model gpt-4.1 # lọc 1 model
//   node scripts/intent_classification_report.mjs --dataset crm   # lọc 1 dataset
// Output: in bảng tóm tắt + ghi reports/intent_metrics_report.md và reports/intent_metrics.json
// ------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULTS = path.join(ROOT, 'results');
const REPORTS = path.join(ROOT, 'reports');

// ---- CLI ----
const argv = process.argv.slice(2);
const getArg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const modelFilter = getArg('--model');
const datasetFilter = getArg('--dataset');

// ---- Cấu hình từng dataset ----
const CRM_UNKNOWN_SYNONYMS = [
  'không có hành động', 'vui lòng cung cấp', 'không cần thực hiện',
  'không xác định', 'không nhận diện', 'unknown',
];

const DATASETS = [
  {
    key: 'htkh_intent_classification',
    labels: ['others', 'request_human_handoff'],
    canon: 'token',
    focus: 'request_human_handoff', // lớp business quan trọng (lớp thiểu số)
  },
  {
    key: 'htkh_intent_routing',
    labels: ['human_handoff', 'clarify', 'rag_answer', 'chitchat'],
    canon: 'token',
  },
  {
    key: 'crm_intent_analysis',
    canon: 'crm',
    oos: 'unknown',          // lớp out-of-scope
    excludeKind: 'JSON',     // dòng GT là JSON = task trích xuất, tách riêng
  },
];

// ---- Canonical hoá nhãn ----
function normText(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

function tokenCanon(s, labels) {
  const low = normText(s);
  // ưu tiên khớp đúng tuyệt đối, sau đó mới "chứa" (output dạng câu)
  for (const L of labels) if (low === L) return L;
  for (const L of labels) if (low.includes(L)) return L;
  return 'OTHER';
}

function crmCanon(s) {
  const raw = String(s == null ? '' : s).trim();
  if (/^[\{\[]/.test(raw)) return { kind: 'JSON', label: 'JSON' };
  const low = raw.toLowerCase();
  const nums = [...new Set(raw.match(/\b[1-7]\b/g) || [])].sort();
  const isPureNumeric = /^[\s\d,\.]+$/.test(raw);
  if (isPureNumeric && nums.length) return { kind: 'code', label: nums.join(',') };
  if (CRM_UNKNOWN_SYNONYMS.some((u) => low.includes(u))) return { kind: 'unknown', label: 'unknown' };
  if (nums.length && raw.length < 40) return { kind: 'code', label: nums.join(',') };
  return { kind: 'other', label: 'OTHER' };
}

function canonLabel(cfg, s) {
  if (cfg.canon === 'token') return { kind: 'token', label: tokenCanon(s, cfg.labels) };
  return crmCanon(s);
}

// ---- Metric từ confusion matrix ----
// rows[gold][pred] = count
function computeMetrics(pairs) {
  const labels = new Set();
  for (const [g, p] of pairs) { labels.add(g); labels.add(p); }
  const L = [...labels];
  const conf = {};
  for (const g of L) { conf[g] = {}; for (const p of L) conf[g][p] = 0; }
  for (const [g, p] of pairs) conf[g][p]++;

  // gold classes = lớp có xuất hiện trong gold (support>0)
  const goldClasses = L.filter((c) => pairs.some(([g]) => g === c));
  const per = {};
  for (const c of L) {
    const tp = conf[c]?.[c] || 0;
    let fp = 0, fn = 0, support = 0;
    for (const g of L) { if (g !== c) fp += conf[g]?.[c] || 0; }
    // support = tổng hàng gold c (gồm cả tp khi p===c) — KHÔNG cộng tp lần nữa
    for (const p of L) { const v = conf[c]?.[p] || 0; support += v; if (p !== c) fn += v; }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    per[c] = { precision, recall, f1, support, tp, fp, fn };
  }
  const total = pairs.length;
  const correct = pairs.reduce((a, [g, p]) => a + (g === p ? 1 : 0), 0);
  const accuracy = total ? correct / total : 0;
  // macro-F1 chỉ trên các lớp GOLD (không tính lớp 'OTHER' nếu nó không phải gold thật)
  const macroClasses = goldClasses;
  const macroF1 = macroClasses.length
    ? macroClasses.reduce((a, c) => a + per[c].f1, 0) / macroClasses.length : 0;
  const weightedF1 = total
    ? macroClasses.reduce((a, c) => a + per[c].f1 * per[c].support, 0) / total : 0;
  // majority baseline = support lớp gold lớn nhất / tổng
  const maxSupport = Math.max(0, ...goldClasses.map((c) => per[c].support));
  const majorityBaseline = total ? maxSupport / total : 0;
  return { labels: L, goldClasses, conf, per, accuracy, macroF1, weightedF1, majorityBaseline, total, correct };
}

// binary P/R/F1 cho 1 lớp mục tiêu (vd OOS 'unknown' hoặc 'request_human_handoff')
function binaryFocus(pairs, focus) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const [g, p] of pairs) {
    const gp = g === focus, pp = p === focus;
    if (gp && pp) tp++; else if (!gp && pp) fp++; else if (gp && !pp) fn++; else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { focus, precision, recall, f1, tp, fp, fn, tn, support: tp + fn };
}

// ---- Đọc 1 file result, dựng cặp (goldLabel, predLabel) bằng hybrid ----
function buildPairs(cfg, resultJson) {
  const logs = resultJson.logs || [];
  const all = [];      // {gold, pred, kind, correct}
  for (const r of logs) {
    if (r.status && r.status !== 'done') continue;
    const acc = r.scores && (r.scores.accuracy ?? Object.values(r.scores)[0]);
    const correct = Number(acc) >= 50;
    const gc = canonLabel(cfg, r.reference);
    let pred;
    if (correct) {
      pred = gc.label;               // đúng -> pred = gold (tin normalization chính thức)
    } else {
      const pc = canonLabel(cfg, r.output);
      pred = pc.label === gc.label ? 'OTHER' : pc.label; // tránh "đúng giả" khi canon trùng nhưng crab chấm sai
    }
    all.push({ gold: gc.label, pred, kind: gc.kind, correct });
  }
  return all;
}

// ---- Pretty helpers ----
const pct = (x) => (x * 100).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function renderConfusion(m) {
  const L = m.labels;
  const w = Math.max(6, ...L.map((s) => s.length));
  let out = '```\n' + pad('gold\\pred', w + 2);
  for (const p of L) out += padL(p.slice(0, w), w + 2);
  out += padL('| total', 9) + '\n';
  for (const g of m.goldClasses) {
    out += pad(g, w + 2);
    let tot = 0;
    for (const p of L) { const v = m.conf[g][p] || 0; tot += v; out += padL(v, w + 2); }
    out += padL('| ' + tot, 9) + '\n';
  }
  out += '```\n';
  return out;
}

function reportDatasetModel(cfg, model, resultJson, md) {
  const all = buildPairs(cfg, resultJson);
  const excluded = cfg.excludeKind ? all.filter((x) => x.kind === cfg.excludeKind) : [];
  const clean = cfg.excludeKind ? all.filter((x) => x.kind !== cfg.excludeKind) : all;
  const pairs = clean.map((x) => [x.gold, x.pred]);
  const m = computeMetrics(pairs);

  // focus / OOS binary
  let focus = null;
  if (cfg.focus) focus = binaryFocus(pairs, cfg.focus);
  let oos = null;
  if (cfg.oos) oos = binaryFocus(pairs, cfg.oos);

  const reportedAcc = resultJson.scores && (resultJson.scores.accuracy ?? Object.values(resultJson.scores)[0]);

  // ---- markdown ----
  md.push(`\n### ${model}\n`);
  md.push(`- n (chấm) = **${m.total}**` + (excluded.length ? `  | excluded (GT=JSON, task trích xuất) = **${excluded.length}**` : ''));
  md.push(`- accuracy (clean) = **${pct(m.accuracy)}%**` +
    (reportedAcc != null ? `  | crab-eval báo (toàn bộ) = ${Number(reportedAcc).toFixed(1)}%` : '') +
    `  | majority-baseline = ${pct(m.majorityBaseline)}%`);
  md.push(`- **macro-F1 = ${pct(m.macroF1)}%**  | weighted-F1 = ${pct(m.weightedF1)}%`);
  if (focus) md.push(`- lớp trọng tâm \`${focus.focus}\`: P=${pct(focus.precision)}% R=${pct(focus.recall)}% **F1=${pct(focus.f1)}%** (support ${focus.support})`);
  if (oos) md.push(`- OOS detection \`${oos.focus}\` (in-scope vs unknown): P=${pct(oos.precision)}% R=${pct(oos.recall)}% **F1=${pct(oos.f1)}%** (support ${oos.support})`);
  md.push('\n| lớp | precision | recall | F1 | support |');
  md.push('|---|---|---|---|---|');
  for (const c of m.goldClasses.sort((a, b) => m.per[b].support - m.per[a].support)) {
    const p = m.per[c];
    md.push(`| \`${c}\` | ${pct(p.precision)}% | ${pct(p.recall)}% | ${pct(p.f1)}% | ${p.support} |`);
  }
  md.push('\n**Confusion matrix:**\n');
  md.push(renderConfusion(m));

  return {
    model,
    n: m.total,
    excluded: excluded.length,
    accuracy: +pct(m.accuracy),
    crabAccuracy: reportedAcc != null ? +Number(reportedAcc).toFixed(1) : null,
    majorityBaseline: +pct(m.majorityBaseline),
    macroF1: +pct(m.macroF1),
    weightedF1: +pct(m.weightedF1),
    focusF1: focus ? +pct(focus.f1) : null,
    oosF1: oos ? +pct(oos.f1) : null,
    perClass: Object.fromEntries(m.goldClasses.map((c) => [c, {
      precision: +pct(m.per[c].precision), recall: +pct(m.per[c].recall),
      f1: +pct(m.per[c].f1), support: m.per[c].support,
    }])),
  };
}

// ---- Main ----
function listModels() {
  if (!fs.existsSync(RESULTS)) { console.error('Không thấy thư mục results/'); process.exit(1); }
  return fs.readdirSync(RESULTS)
    .filter((d) => fs.statSync(path.join(RESULTS, d)).isDirectory())
    .filter((d) => !modelFilter || d.includes(modelFilter))
    .sort();
}

function main() {
  const models = listModels();
  const md = ['# Intent classification — metric chuẩn (macro-F1 + per-class + OOS)\n'];
  md.push(`_Sinh bởi scripts/intent_classification_report.mjs — ${new Date().toISOString()}_\n`);
  md.push('> Đường chéo tin `scores.accuracy` của crab-eval; off-diagonal canon best-effort. ' +
    'macro-F1 tính trên lớp gold. crm_intent: dòng GT=JSON (task trích xuất) bị tách khỏi metric.\n');

  const machine = {};

  for (const cfg of DATASETS) {
    if (datasetFilter && !cfg.key.includes(datasetFilter)) continue;
    md.push(`\n---\n\n## ${cfg.key}\n`);
    const rows = [];
    for (const model of models) {
      const fp = path.join(RESULTS, model, `${cfg.key}.json`);
      if (!fs.existsSync(fp)) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
      if (!j.logs || !j.logs.length) continue;
      rows.push(reportDatasetModel(cfg, model, j, md));
    }
    machine[cfg.key] = rows;

    // bảng leaderboard tóm tắt (in ra stdout)
    if (rows.length) {
      const extraCol = cfg.oos ? 'oosF1' : (cfg.focus ? 'focusF1' : null);
      const extraName = cfg.oos ? `OOS-F1(${cfg.oos})` : (cfg.focus ? `F1(${cfg.focus})` : '');
      console.log(`\n=== ${cfg.key} ===`);
      console.log(
        pad('model', 30) + padL('acc%', 7) + padL('base%', 7) +
        padL('macroF1', 9) + padL('wF1', 7) + (extraCol ? padL(extraName.slice(0, 18), 20) : ''));
      // sắp theo macro-F1 giảm dần
      for (const r of [...rows].sort((a, b) => b.macroF1 - a.macroF1)) {
        console.log(
          pad(r.model, 30) + padL(r.accuracy, 7) + padL(r.majorityBaseline, 7) +
          padL(r.macroF1, 9) + padL(r.weightedF1, 7) +
          (extraCol ? padL(r[extraCol] == null ? '-' : r[extraCol], 20) : ''));
      }
    }
  }

  fs.mkdirSync(REPORTS, { recursive: true });
  const mdPath = path.join(REPORTS, 'intent_metrics_report.md');
  const jsonPath = path.join(REPORTS, 'intent_metrics.json');
  fs.writeFileSync(mdPath, md.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify(machine, null, 2));
  console.log(`\n✅ Ghi báo cáo:\n   ${path.relative(ROOT, mdPath)}\n   ${path.relative(ROOT, jsonPath)}`);
}

main();
