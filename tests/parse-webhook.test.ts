import { describe, expect, it } from 'vitest';
import { parseWebhookPayload } from '../src/meta/parse-webhook.js';
import { messageEvent, PAGE_ID, PSID, webhookPayload } from './helpers/webhook.js';

describe('parseWebhookPayload', () => {
  it('rút một tin nhắn text', () => {
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'm1', text: 'xin chào', timestamp: 1_458_692_752_478 })]));
    expect(r.messages).toEqual([
      { fbPageId: PAGE_ID, psid: PSID, mid: 'm1', text: 'xin chào', attachments: null, sentAtMs: 1_458_692_752_478 },
    ]);
  });

  it('tin chỉ có attachment: text null, giữ metadata attachment', () => {
    const attachments = [{ type: 'image', payload: { url: 'https://x/a.jpg' } }];
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'm2', attachments })]));
    expect(r.messages[0]).toMatchObject({ mid: 'm2', text: null, attachments });
  });

  it('bỏ is_echo (tin do Page gửi) và đếm lại', () => {
    const r = parseWebhookPayload(
      webhookPayload([messageEvent({ mid: 'in', text: 'a' }), messageEvent({ mid: 'out', text: 'b', isEcho: true })]),
    );
    expect(r.messages.map((m) => m.mid)).toEqual(['in']);
    expect(r.stats.echo).toBe(1);
  });

  it('bỏ tin có sender là chính Page dù không có cờ is_echo (phòng thủ)', () => {
    const ev = messageEvent({ mid: 'self', text: 'x', psid: PAGE_ID });
    const r = parseWebhookPayload(webhookPayload([ev]));
    expect(r.messages).toHaveLength(0);
    expect(r.stats.echo).toBe(1);
  });

  it('bỏ sự kiện không phải tin nhắn (delivery, read, postback)', () => {
    const delivery = { sender: { id: PSID }, recipient: { id: PAGE_ID }, delivery: { mids: ['m'], watermark: 1 } };
    const read = { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1, read: { watermark: 1 } };
    const r = parseWebhookPayload(webhookPayload([delivery, read, messageEvent({ mid: 'm3', text: 'ok' })]));
    expect(r.messages.map((m) => m.mid)).toEqual(['m3']);
    expect(r.stats.notMessage).toBe(2);
  });

  it('sắp theo timestamp tăng dần, bằng nhau thì giữ thứ tự gốc', () => {
    const r = parseWebhookPayload(
      webhookPayload([
        messageEvent({ mid: 'c', timestamp: 3000 }),
        messageEvent({ mid: 'a1', timestamp: 1000 }),
        messageEvent({ mid: 'b', timestamp: 2000 }),
        messageEvent({ mid: 'a2', timestamp: 1000 }),
      ]),
    );
    expect(r.messages.map((m) => m.mid)).toEqual(['a1', 'a2', 'b', 'c']);
  });

  it('một sự kiện hỏng không làm mất các sự kiện khác trong batch', () => {
    const bad1 = { sender: { id: PSID }, message: { mid: 'x' } }; // thiếu recipient, timestamp
    const bad2 = { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 'abc', message: { mid: 'y' } };
    const bad3 = { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 5, message: {} }; // thiếu mid
    const r = parseWebhookPayload(webhookPayload([bad1, messageEvent({ mid: 'good', text: 'ok' }), bad2, bad3, null, 7]));
    expect(r.messages.map((m) => m.mid)).toEqual(['good']);
    expect(r.stats.invalid).toBe(3);
    expect(r.stats.notMessage).toBe(2); // null và 7 không phải đối tượng có `message`
  });

  it('cùng mid lặp trong một payload chỉ giữ một', () => {
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'dup', text: 'a' }), messageEvent({ mid: 'dup', text: 'a' })]));
    expect(r.messages).toHaveLength(1);
    expect(r.stats.duplicateInPayload).toBe(1);
  });

  it('nhiều entry (nhiều Page) trong một payload', () => {
    const payload = {
      object: 'page',
      entry: [
        { id: 'P1', messaging: [messageEvent({ mid: 'a', pageId: 'P1', timestamp: 2000 })] },
        { id: 'P2', messaging: [messageEvent({ mid: 'b', pageId: 'P2', timestamp: 1000 })] },
        { id: 'P3' }, // không có messaging
      ],
    };
    const r = parseWebhookPayload(payload);
    expect(r.messages.map((m) => [m.fbPageId, m.mid])).toEqual([
      ['P2', 'b'],
      ['P1', 'a'],
    ]);
  });

  it('xử lý batch lớn (1000 sự kiện, mức tối đa Meta gộp)', () => {
    const events = Array.from({ length: 1000 }, (_, i) => messageEvent({ mid: `m${i}`, text: `t${i}`, timestamp: 1_700_000_000_000 + (999 - i) }));
    const r = parseWebhookPayload(webhookPayload(events));
    expect(r.messages).toHaveLength(1000);
    expect(r.messages[0]!.mid).toBe('m999'); // timestamp nhỏ nhất
    expect(r.messages[999]!.mid).toBe('m0');
  });

  it('bỏ ký tự NUL khỏi text và attachments (Postgres không lưu được) mà vẫn giữ tin', () => {
    const nul = '\u0000';
    const attachments = [{ type: 'file', payload: { url: `https://x/a${nul}b.pdf`, [`k${nul}`]: [`v${nul}`] } }];
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'n1', text: `xin${nul} chào${nul}`, attachments })]));
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.text).toBe('xin chào');
    expect(JSON.stringify(r.messages[0]!.attachments)).not.toContain('\\u0000');
    expect(r.messages[0]!.attachments).toEqual([{ type: 'file', payload: { url: 'https://x/ab.pdf', k: ['v'] } }]);
  });

  it('ID hoặc mid chứa NUL: coi là sự kiện hỏng, không làm hỏng các tin khác', () => {
    const nul = '\u0000';
    const r = parseWebhookPayload(
      webhookPayload([
        messageEvent({ mid: `bad${nul}mid`, text: 'a' }),
        messageEvent({ mid: 'b', text: 'b', psid: `ps${nul}id` }),
        messageEvent({ mid: 'ok', text: 'c' }),
      ]),
    );
    expect(r.messages.map((m) => m.mid)).toEqual(['ok']);
    expect(r.stats.invalid).toBe(2);
  });

  it.each([
    ['null', null],
    ['chuỗi', 'hello'],
    ['mảng', []],
    ['object khác page', { object: 'instagram', entry: [{ id: '1', messaging: [messageEvent({ mid: 'z' })] }] }],
    ['thiếu entry', { object: 'page' }],
    ['entry không phải mảng', { object: 'page', entry: 'x' }],
  ])('payload lạ (%s) không ném lỗi và không cho tin nào', (_name, payload) => {
    expect(() => parseWebhookPayload(payload)).not.toThrow();
    expect(parseWebhookPayload(payload).messages).toEqual([]);
  });
});
