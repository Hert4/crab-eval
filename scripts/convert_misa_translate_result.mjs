// Convert misa-translate test-fixture result file → crab-eval Dataset.
// Source: ~/Downloads/20260527-102649-misa-translategemma-4b-it.json
//   (array of fixture blocks, each with results[] of {id,kind,source_lang,
//    target_lang,source,translated,judge,...})
// Output: datasets/misa_translate_sentence_45.json  ({metadata, data})
//
// References (GT) are hand-authored below (reference_source: claude-opus-4-8).
// Confidence: en/ja/ko/zh/vi HIGH; km/lo/my/ne/si/ta BEST-EFFORT — spot-check
// before trusting chrf for the vi_to_km / vi_to_rare fixtures.
//
// Run:  node scripts/convert_misa_translate_result.mjs

import fs from 'fs'
import path from 'path'
import os from 'os'

const SRC = path.join(os.homedir(), 'Downloads', '20260527-102649-misa-translategemma-4b-it.json')
const OUT = path.resolve(process.cwd(), 'datasets', 'misa_translate_sentence_45.json')

// lang code → Vietnamese name (for the instruction prompt + metadata)
const LANG_VI = {
  vi: 'tiếng Việt', en: 'tiếng Anh', ja: 'tiếng Nhật', ko: 'tiếng Hàn',
  zh: 'tiếng Trung', km: 'tiếng Khmer', lo: 'tiếng Lào', my: 'tiếng Miến Điện',
  ne: 'tiếng Nepal', si: 'tiếng Sinhala', ta: 'tiếng Tamil',
}

// The 15 vi-en-003-r* records share one identical source → one reference.
const EN_003 = 'The decision to set a loved one free so they can find new happiness, even though one must endure oblivion and pain when reason and the heart are in conflict.'

// id → hand-authored ground-truth translation
const REFS = {
  // ── vi → en (HIGH confidence) ──
  'vi-en-001': 'Total revenue in 2025 reached 12,500,000,000 VND, up 15% compared to the same period last year.',
  'vi-en-002': '<p>Contract No. <b>HD-2026-001</b> dated 15/03/2026, valued at 500 million VND.</p>',
  'vi-en-003-r01': EN_003, 'vi-en-003-r02': EN_003, 'vi-en-003-r03': EN_003,
  'vi-en-003-r04': EN_003, 'vi-en-003-r05': EN_003, 'vi-en-003-r06': EN_003,
  'vi-en-003-r07': EN_003, 'vi-en-003-r08': EN_003, 'vi-en-003-r09': EN_003,
  'vi-en-003-r10': EN_003, 'vi-en-003-r11': EN_003, 'vi-en-003-r12': EN_003,
  'vi-en-003-r13': EN_003, 'vi-en-003-r14': EN_003, 'vi-en-003-r15': EN_003,
  'vi-en-004': 'not knowing how to love you;breaking up;happiness of one’s own;pain;ending;loving the wrong way',
  'vi-en-mix-001': 'Hello - Hello',
  'vi-en-mix-002': 'Total: 1500 VND, Paid.',
  'vi-en-mix-003': 'Status: Pending - Awaiting processing, Priority: High',

  // ── vi → ja (HIGH) ──
  'vi-ja-001': '申し訳ありませんが、質問が理解できません。もう一度言っていただけますか？',
  'vi-ja-002': '<ul><li>製品A：150,000ドン</li><li>製品B：200,000ドン</li></ul>',

  // ── vi → ko (HIGH) ──
  'vi-ko-001': '주문번호 7890이 14시 30분에 확인되었습니다.',

  // ── vi → zh (HIGH; note 120 tỷ = 1200亿 — large-number scaling, spot-check) ──
  'vi-zh-001': '会议于2026年5月26日上午9点举行。',
  'vi-zh-002': '<div><h2>报告</h2><p>第一季度：<b>1200亿</b>，第二季度：<b>1350亿</b></p></div>',
  'vi-zh-mix-001': '你好 - 你好，今天是星期一。',

  // ── vi → km Khmer (BEST-EFFORT) ──
  'vi-km-001': 'សួស្តី ថ្ងៃនេះគឺថ្ងៃច័ន្ទ។',
  'vi-km-002': 'តម្លៃសរុបនៃការបញ្ជាទិញគឺ 1500 ដុង បញ្ចុះតម្លៃ 20%។',
  'vi-km-003': 'កិច្ចប្រជុំចាប់ផ្តើមនៅម៉ោង 14:30 ថ្ងៃទី 25 ខែ 12 ឆ្នាំ 2026។',
  'vi-km-004': '<p>របាយការណ៍ចំណូលត្រីមាសទី 1៖ <b>1.500.000ដុង</b></p>',
  'vi-km-005': '<div><h3>វិក្កយបត្រលេខ 12345</h3><p>កាលបរិច្ឆេទ៖ 26/05/2026</p><p>ចំនួនទឹកប្រាក់៖ <strong>2,500,000 VND</strong></p></div>',
  'vi-km-006': 'ក្រុមហ៊ុន MISA ត្រូវបានបង្កើតឡើងក្នុងឆ្នាំ 1994 នៅទីក្រុងហាណូយ។',
  'vi-km-007': 'ខ្ញុំផ្ទាល់មិនចេះស្រឡាញ់អ្នកទេ។ ធ្វើឱ្យអ្នកព្រួយចិត្តជាច្រើនដង ទឹកភ្នែកនៅតែហូរ។ ដល់ពេលត្រូវបញ្ចប់ហើយ ចាកចេញឱ្យទាន់ពេល។',
  'vi-km-008': 'គ្មានអ្នកណាស្លាប់តែម្នាក់ឯងព្រោះធ្លាប់ស្រឡាញ់អស់ពីដួងចិត្ត។ គ្មានអ្នកណាចង់បញ្ចប់ពេលកំពុងមានសុភមង្គលជាមួយគ្នា។',

  // ── vi → lo (BEST-EFFORT) ──
  'vi-lo-001': 'ບໍລິສັດ MISA ໃນປີ 2026 ມີລາຍຮັບ 1500 ຕື້ດົ່ງ.',

  // ── vi → my Myanmar (BEST-EFFORT) ──
  'vi-my-001': 'မင်္ဂလာပါ၊ ဒီနေ့သည် တနင်္လာနေ့ 26 ရက်နေ့ ဖြစ်သည်။',
  'vi-my-002': '<p>ပြေစာအမှတ် <b>123</b>: 500.000đ</p>',

  // ── vi → ne (BEST-EFFORT) ──
  'vi-ne-001': 'कुल कर्मचारी संख्या 1200 जना हो।',

  // ── vi → si (BEST-EFFORT) ──
  'vi-si-001': 'නිෂ්පාදන කේතය 4567, මිල 250,000 ඩොං.',

  // ── vi → ta (BEST-EFFORT) ──
  'vi-ta-001': 'கூட்டம் 6 ஆம் மாதம் 15 ஆம் தேதி காலை 10 மணிக்கு நடைபெறும்.',

  // ── vi → vi identity: reference = source unchanged ──
  'vi-vi-001': 'Hôm nay là thứ Hai, ngày 26 tháng 5 năm 2026.',
  'vi-vi-002': 'Giá trị hóa đơn là 1.500.000 đồng, đã bao gồm VAT 10%.',
  'vi-vi-003': '<p>Xin chào <b>các bạn</b>, hôm nay trời <i>rất đẹp</i>.</p>',
  'vi-vi-004': '<div><h2>Báo cáo doanh thu</h2><ul><li>Tháng 1: 1.200.000đ</li><li>Tháng 2: 1.500.000đ</li></ul></div>',
}

const HIGH_CONF = new Set(['en', 'ja', 'ko', 'zh', 'vi'])

function buildInput(kind, tgtName, source) {
  const note = kind === 'html'
    ? 'Giữ nguyên cấu trúc và các thẻ HTML. Giữ nguyên toàn bộ con số, ngày tháng và ký hiệu.'
    : 'Giữ nguyên toàn bộ con số, ngày tháng và ký hiệu.'
  return `Bạn là một chuyên gia dịch thuật. Hãy dịch nội dung sau từ tiếng Việt sang ${tgtName} một cách chính xác, tự nhiên.\n# Lưu ý: ${note} Chỉ trả về bản dịch, không giải thích.\n# Nội dung: ${source}`
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf-8'))
const data = []
const missing = []

for (const blk of raw) {
  for (const r of blk.results) {
    const tgtName = LANG_VI[r.target_lang] || r.target_lang
    const reference = REFS[r.id]
    if (reference === undefined) { missing.push(r.id); continue }

    data.push({
      id: r.id,
      input: buildInput(r.kind, tgtName, r.source),
      output: '',
      reference,
      metadata: {
        source_language: r.source_lang,
        source_language_original: 'tiếng Việt',
        target_language: r.target_lang,
        target_language_original: tgtName,
        source_text: r.source,
        kind: r.kind,                         // plain | html
        fixture: blk.fixture,                 // vi_to_common | vi_to_km | vi_to_rare | vi_to_vi
        tags: [blk.fixture, r.kind],          // analysis breakdown buckets
        reference_source: 'claude-opus-4-8',
        reference_confidence: HIGH_CONF.has(r.target_lang) ? 'high' : 'best-effort',
        baseline_model: 'misa-translategemma-4b-it',
        baseline_translation: r.translated ?? null,
        baseline_judge: r.judge ?? null,
        baseline_error: r.error ?? null,
      },
    })
  }
}

const dataset = {
  metadata: {
    task_name: 'misa_translate_sentence',
    task_type: 'translation',
    gt_task_type: 'translation',
    description: 'MISA Translate — dịch câu/HTML tiếng Việt sang 10 ngôn ngữ (en/zh/ja/ko/km/lo/my/ne/si/ta) + identity vi→vi. Test giữ số, giữ HTML, đúng ngôn ngữ đích.',
    source_file: '20260527-102649-misa-translategemma-4b-it.json',
    gt_metrics: ['translation_score', 'translation_quality', 'chrf'],
    gt_model: 'claude-opus-4-8',
    gt_generated_date: '2026-05-30',
    source_language_original: 'tiếng Việt',
    num_samples: data.length,
    note: 'reference cho km/lo/my/ne/si/ta là best-effort (xem metadata.reference_confidence) — spot-check trước khi tin chrf. digit_preservation/html_structure chưa có metric trong codebase.',
    customAttributes: {
      domain: 'MISA / dữ liệu tài chính',
      fixtures: 'vi_to_common, vi_to_km, vi_to_rare, vi_to_vi',
    },
  },
  data,
}

fs.writeFileSync(OUT, JSON.stringify(dataset, null, 2), 'utf-8')
console.log(`Wrote ${data.length} records → ${OUT}`)
if (missing.length) console.log(`MISSING refs (skipped): ${missing.join(', ')}`)
