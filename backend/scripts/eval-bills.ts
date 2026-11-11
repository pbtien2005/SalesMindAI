/**
 * Đánh giá bộ đọc bill trên 3 ảnh MẪU trong `demo-assets/` (không dùng bill thật của khách). Chạy tay, không thuộc `npm test`:
 *
 *   npm run eval:bills                 # AI_MODE trong .env (offline = bộ đọc mô phỏng, không tốn tiền)
 *   AI_MODE=live npm run eval:bills    # gọi Claude thật: tốn tiền, gửi 3 ảnh mẫu ra API nước ngoài
 *
 * Kỳ vọng: bill-6000000 → 6.000.000; bill-3000000 → 3.000.000; sofa.png (không phải bill) → KHÔNG đọc được, không bịa số.
 * Vùng khoanh phải nằm trong [0,1]; việc nó có khoanh đúng dòng số tiền do người xem ảnh đối chiếu (script in tọa độ).
 * Thoát mã 1 nếu một ca sai số tiền hoặc bịa số cho ảnh không phải bill.
 *
 * Biến: EVAL_MAX_TOKENS (mặc định 1000), EVAL_TOKEN_BUDGET (mặc định 20000, 0 = không giới hạn), `--only <từ khóa tên file>`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBillReader } from '../src/bills/factory.js';
import type { BillReadOutcome } from '../src/bills/types.js';
import { loadEnv } from '../src/config/env.js';

interface Case {
  file: string;
  /** Số tiền kỳ vọng; null = phải KHÔNG đọc được. */
  amount: number | null;
}

const CASES: Case[] = [
  { file: 'bill-6000000.png', amount: 6_000_000 },
  { file: 'bill-3000000.png', amount: 3_000_000 },
  { file: 'sofa.png', amount: null },
];

const dir = fileURLToPath(new URL('../demo-assets/', import.meta.url));

async function main(): Promise<number> {
  const env = loadEnv();
  const maxTokens = Number(process.env.EVAL_MAX_TOKENS ?? 1000);
  const tokenBudget = Number(process.env.EVAL_TOKEN_BUDGET ?? 20000);
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] ?? '').toLowerCase() : '';
  const cases = only ? CASES.filter((c) => c.file.toLowerCase().includes(only)) : CASES;
  if (cases.length === 0) {
    console.error(`Không có ảnh nào khớp --only "${only}".`);
    return 1;
  }
  const reader = createBillReader({ ...env, maxTokens });
  console.log(`Bộ đọc: ${reader.model} (AI_MODE=${env.AI_MODE}), max_tokens=${maxTokens}, ${cases.length}/${CASES.length} ảnh\n`);

  let bad = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let totalMs = 0;
  let n = 0;
  for (const c of cases) {
    if (tokenBudget > 0 && tokensIn + tokensOut > tokenBudget) {
      console.log(`\nDỪNG: tổng token ${tokensIn + tokensOut} vượt ngân sách ${tokenBudget} (EVAL_TOKEN_BUDGET). Các ảnh còn lại chưa chạy.`);
      break;
    }
    const bytes = await readFile(`${dir}${c.file}`);
    const t0 = Date.now();
    let out: BillReadOutcome;
    try {
      out = await reader.read({ bytes, mediaType: 'image/png' });
    } catch (err) {
      console.log(`LỖI  ${c.file}: ${err instanceof Error ? err.message : String(err)}`);
      bad += 1;
      break; // lỗi hệ thống (khóa, mạng, hết credit): không thử tiếp để khỏi tốn thêm
    }
    const ms = Date.now() - t0;
    n += 1;
    totalMs += ms;
    tokensIn += out.usage?.inputTokens ?? 0;
    tokensOut += out.usage?.outputTokens ?? 0;

    const problems: string[] = [];
    let detail: string = out.kind;
    if (out.kind === 'ok') {
      detail = `ok, số tiền ${out.amountVnd}, vùng khoanh ${out.bbox ? JSON.stringify(out.bbox) : 'không có'}`;
      if (c.amount === null) problems.push(`ảnh không phải bill nhưng đọc ra số tiền ${out.amountVnd}`);
      else if (out.amountVnd !== c.amount) problems.push(`sai số tiền (kỳ vọng ${c.amount}, được ${out.amountVnd})`);
      if (c.amount !== null && !out.bbox) problems.push('không có vùng khoanh hợp lệ (ngoài [0,1] hoặc thiếu)');
    } else if (c.amount !== null) {
      problems.push(`không đọc được (${out.kind}) dù là bill rõ ràng`);
    }
    if (problems.length) bad += 1;
    console.log(`${problems.length === 0 ? 'ĐẠT ' : 'LỆCH'} ${c.file}: ${detail} [vào ${out.usage?.inputTokens ?? 0}, ra ${out.usage?.outputTokens ?? 0}, ${ms} ms]${problems.length ? `\n       - ${problems.join('\n       - ')}` : ''}`);
  }

  console.log(`\n${n} ảnh. Ca lệch hoặc lỗi: ${bad}.`);
  console.log(`Token: vào ${tokensIn}, ra ${tokensOut}. Thời gian: tổng ${totalMs} ms, trung bình ${n ? Math.round(totalMs / n) : 0} ms mỗi ảnh.`);
  return bad === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
