/**
 * Extractor chạy bằng luật, không gọi mạng: dùng khi chưa có `ANTHROPIC_API_KEY` (demo, test, dev).
 * Phủ các kiểu câu của kịch bản demo và vài biến thể thường gặp; KHÔNG phải AI thật và không thay thế chế độ
 * `live`. Câu lạ có thể không ra đề xuất. Vẫn đi qua cùng đường kiểm chứng câu gốc như chế độ live.
 */
import {
  type Candidate,
  type Extractor,
  type ExtractorInput,
  type ExtractorMessage,
  type ExtractorOutcome,
  type Quote,
  ZERO_USAGE,
} from './types.js';

const inbound = (input: ExtractorInput): ExtractorMessage[] => input.messages.filter((m) => m.direction === 'inbound' && m.text.trim() !== '');

/** Khớp cuối cùng (tin mới nhất thắng) của một danh sách mẫu trên các tin khách. */
function lastMatch(msgs: ExtractorMessage[], patterns: RegExp[]): { msg: ExtractorMessage; m: RegExpExecArray } | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    for (const p of patterns) {
      const m = new RegExp(p.source, p.flags.replace('g', '')).exec(msg.text);
      if (m) return { msg, m };
    }
  }
  return null;
}

const quoteOf = (msg: ExtractorMessage, text: string): Quote => ({ messageId: msg.id, quote: text });

const NAME_WORD = String.raw`\p{Lu}[\p{Ll}]*`;
const NAME_PATTERNS = [
  new RegExp(String.raw`(?:^|[\s,.!])((?:anh|chị|chi|em|cô|co|chú|chu|bác|bac)\s+(${NAME_WORD}(?:\s+${NAME_WORD}){0,2})\s+đây)`, 'iu'),
  new RegExp(String.raw`(?:tên\s+(?:là|mình\s+là|anh\s+là|em\s+là|chị\s+là)|mình\s+là|tôi\s+là|em\s+là|anh\s+là|chị\s+là)\s+(${NAME_WORD}(?:\s+${NAME_WORD}){0,2})`, 'u'),
];

const PRODUCT_NOUN = String.raw`(?:sofa|sô\s*pha|ghế\s+sofa|bàn\s+ăn|bàn\s+trà|bàn\s+làm\s+việc|giường(?:\s+ngủ)?|tủ\s+quần\s+áo|tủ|kệ\s+tivi|kệ|ghế(?:\s+ăn)?)`;
const PRODUCT = new RegExp(String.raw`${PRODUCT_NOUN}(?:\s+phòng\s+(?:khách|ngủ|ăn|làm\s+việc))?`, 'iu');
const COLOR = /màu\s+\p{L}+/iu;

const BUDGET = /(?:(tầm\s+khoảng|tầm|khoảng|cỡ|dưới|trên|ngân\s+sách(?:\s+là)?)\s*)?(\d+(?:[.,]\d+)?)\s*(triệu|tr|củ|nghìn|ngàn|k|tỷ|tỉ)(?![\p{L}])/iu;

const TIME_PATTERNS = [
  /\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?/u,
  /(?:cuối|đầu|giữa)\s+tuần(?:\s+(?:này|sau|tới))?/iu,
  /(?:sáng|trưa|chiều|tối)\s+(?:nay|mai)/iu,
  /ngày\s+(?:mai|kia|mốt)|hôm\s+nay|\bmai\b/iu,
  /thứ\s+(?:hai|ba|tư|năm|sáu|bảy|[2-7])/iu,
  /chủ\s+nhật/iu,
  /tuần\s+(?:này|sau|tới)/iu,
  /(?:cuối|đầu|giữa)?\s*tháng\s+(?:này|sau|tới)/iu,
];

const QUANTITY = /(\d+|một|hai|ba|bốn)\s*(bộ|cái|chiếc)/iu;
const ADDRESS = /(?:địa\s+chỉ(?:\s+nhận\s+hàng)?(?:\s+là)?|giao\s+(?:về|tới|đến))\s*[:\-]?\s*([^.\n]{6,100})/iu;

const PURPOSE_RULES: Array<{ purpose: string; intent: string; pattern: RegExp }> = [
  { purpose: 'buy_intent', intent: 'ready_to_buy', pattern: /chốt(?:\s+(?:luôn|đơn|nhé))?|đặt\s+hàng|mua\s+luôn|lấy\s+(?:luôn|\d+\s*bộ|một\s+bộ)/iu },
  { purpose: 'ask_payment', intent: 'ready_to_buy', pattern: /chuyển\s+khoản|thanh\s+toán|trả\s+tiền|đặt\s+cọc|\bcọc\b|số\s+tài\s+khoản|\bstk\b/iu },
  { purpose: 'schedule_visit', intent: 'interested', pattern: /ghé\s+(?:shop|cửa\s+hàng|xem)?|xem\s+(?:hàng|shop|trực\s+tiếp)|đến\s+(?:shop|cửa\s+hàng)|qua\s+shop/iu },
  { purpose: 'ask_price', intent: 'interested', pattern: /giá|bao\s+nhiêu|nhiêu\s+tiền/iu },
];

const MULT: Record<string, number> = { triệu: 1e6, tr: 1e6, củ: 1e6, nghìn: 1e3, ngàn: 1e3, k: 1e3, tỷ: 1e9, tỉ: 1e9 };

function formatVnd(n: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
}

export class OfflineExtractor implements Extractor {
  readonly model = 'offline-rules';

  async extract(input: ExtractorInput): Promise<ExtractorOutcome> {
    const msgs = inbound(input);
    const out: Candidate[] = [];

    // Tên: "Anh Minh đây", "tên mình là Minh".
    const name = lastMatch(msgs, NAME_PATTERNS);
    if (name) {
      const value = name.m[2] ?? name.m[1]!;
      const quote = name.m[2] ? name.m[1]! : name.m[0].trim();
      out.push({ field: 'customer_name', value, quotes: [quoteOf(name.msg, quote)] });
    }

    // Sản phẩm (kèm màu nếu khách nói ở tin nào đó).
    const product = lastMatch(msgs, [PRODUCT]);
    if (product) {
      const quotes = [quoteOf(product.msg, product.m[0])];
      const parts = [product.m[0].toLowerCase().replace(/\s+/g, ' ')];
      const color = lastMatch(msgs, [COLOR]);
      if (color) {
        quotes.push(quoteOf(color.msg, color.m[0]));
        parts.push(color.m[0].toLowerCase());
      }
      out.push({ field: 'product_interest', value: parts.join(', '), quotes });
    }

    // Ngân sách.
    const budget = lastMatch(msgs, [BUDGET]);
    if (budget) {
      const [whole, qualifier, num, unit] = budget.m;
      const amount = Math.round(Number(num!.replace(',', '.')) * (MULT[unit!.toLowerCase()] ?? 1));
      const approx = qualifier && /tầm|khoảng|cỡ/i.test(qualifier);
      const prefix = qualifier && /dưới/i.test(qualifier) ? 'dưới ' : qualifier && /trên/i.test(qualifier) ? 'trên ' : approx ? '≈ ' : '';
      const note = approx ? ` (khách nói "${qualifier!.toLowerCase().replace(/\s+/g, ' ')}")` : '';
      out.push({ field: 'budget', value: `${prefix}${formatVnd(amount)}${note}`, quotes: [quoteOf(budget.msg, whole!.trim())] });
    }

    // Số lượng.
    const qty = lastMatch(msgs, [QUANTITY]);
    if (qty) out.push({ field: 'quantity', value: `${qty.m[1]} ${qty.m[2]}`.toLowerCase(), quotes: [quoteOf(qty.msg, qty.m[0])] });

    // Địa chỉ.
    const addr = lastMatch(msgs, [ADDRESS]);
    if (addr) out.push({ field: 'address', value: addr.m[1]!.trim(), quotes: [quoteOf(addr.msg, addr.m[1]!.trim())] });

    // Cụm thời gian: chép nguyên văn, không giải ngày.
    const time = lastMatch(msgs, TIME_PATTERNS);
    if (time) out.push({ field: 'timeline', value: time.m[0].trim(), quotes: [quoteOf(time.msg, time.m[0].trim())] });

    // Mục đích và ý định: chỉ xét tin khách MỚI NHẤT.
    const latest = msgs[msgs.length - 1];
    if (latest) {
      for (const rule of PURPOSE_RULES) {
        const m = rule.pattern.exec(latest.text);
        if (m) {
          out.push({ field: 'message_purpose', value: rule.purpose, quotes: [quoteOf(latest, m[0])] });
          out.push({ field: 'intent', value: rule.intent, quotes: [quoteOf(latest, m[0])] });
          break;
        }
      }
    }

    return { kind: 'ok', candidates: out, usage: { ...ZERO_USAGE } };
  }
}
