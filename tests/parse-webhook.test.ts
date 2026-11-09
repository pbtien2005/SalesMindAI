import { describe, expect, it } from 'vitest';
import { parseWebhookPayload } from '../src/meta/parse-webhook.js';
import {
  messageEvent,
  PAGE_ID,
  policyEvent,
  postbackEvent,
  PSID,
  reactionEvent,
  referralEvent,
  webhookPayload,
} from './helpers/webhook.js';

describe('parseWebhookPayload: tin nhắn của khách', () => {
  it('rút một tin nhắn text, hướng inbound, không có app_id', () => {
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'm1', text: 'xin chào', timestamp: 1_458_692_752_478 })]));
    expect(r.messages).toEqual([
      { fbPageId: PAGE_ID, psid: PSID, mid: 'm1', direction: 'inbound', appId: null, text: 'xin chào', attachments: null, sentAtMs: 1_458_692_752_478 },
    ]);
  });

  it('tin chỉ có attachment: text null, giữ metadata attachment', () => {
    const attachments = [{ type: 'image', payload: { url: 'https://x/a.jpg' } }];
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'm2', attachments })]));
    expect(r.messages[0]).toMatchObject({ mid: 'm2', text: null, attachments });
  });

  it('bỏ sự kiện không thuộc loại nào ta lưu (delivery, read)', () => {
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
    expect(r.stats.notMessage).toBe(2); // null và 7 không phải đối tượng
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
    expect(r.messages.map((m) => [m.fbPageId, m.mid])).toEqual([['P2', 'b'], ['P1', 'a']]);
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
  ])('payload lạ (%s) không ném lỗi và không cho gì cả', (_name, payload) => {
    expect(() => parseWebhookPayload(payload)).not.toThrow();
    const r = parseWebhookPayload(payload);
    expect(r.messages).toEqual([]);
    expect(r.interactions).toEqual([]);
    expect(r.policyEvents).toEqual([]);
  });
});

describe('parseWebhookPayload: tin của Page (echo) được GIỮ, không bỏ', () => {
  it('echo thành tin outbound: khách là người NHẬN, kèm app_id', () => {
    const r = parseWebhookPayload(
      webhookPayload([messageEvent({ mid: 'e1', text: 'Dạ em gửi báo giá ạ', isEcho: true, appId: '263902037430900', timestamp: 5000 })]),
    );
    expect(r.messages).toEqual([
      { fbPageId: PAGE_ID, psid: PSID, mid: 'e1', direction: 'outbound', appId: '263902037430900', text: 'Dạ em gửi báo giá ạ', attachments: null, sentAtMs: 5000 },
    ]);
    expect(r.stats.outbound).toBe(1);
  });

  it('app_id dạng số (Meta có thể gửi số) được chuẩn hóa thành chuỗi, không mất độ chính xác với 15 chữ số', () => {
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'e2', text: 'a', isEcho: true, appId: 263902037430900 })]));
    expect(r.messages[0]!.appId).toBe('263902037430900');
  });

  it('echo không có app_id: appId null', () => {
    const r = parseWebhookPayload(webhookPayload([messageEvent({ mid: 'e3', text: 'a', isEcho: true })]));
    expect(r.messages[0]).toMatchObject({ direction: 'outbound', appId: null });
  });

  it('tin của khách không bao giờ mang app_id dù payload có', () => {
    const ev = messageEvent({ mid: 'm9', text: 'a' });
    (ev.message as Record<string, unknown>).app_id = 12345;
    expect(parseWebhookPayload(webhookPayload([ev])).messages[0]!.appId).toBeNull();
  });

  it('sender là Page dù không có cờ is_echo: vẫn là tin của Page (phòng thủ), khách là người nhận', () => {
    const ev = { sender: { id: PAGE_ID }, recipient: { id: PSID }, timestamp: 1000, message: { mid: 'self', text: 'x' } };
    const r = parseWebhookPayload(webhookPayload([ev]));
    expect(r.messages[0]).toMatchObject({ direction: 'outbound', psid: PSID });
  });

  it('không xác định được khách (Page gửi cho chính Page): sự kiện hỏng, không phải tin', () => {
    const ev = { sender: { id: PAGE_ID }, recipient: { id: PAGE_ID }, timestamp: 1000, message: { mid: 'weird', text: 'x', is_echo: true } };
    const r = parseWebhookPayload(webhookPayload([ev]));
    expect(r.messages).toEqual([]);
    expect(r.stats.invalid).toBe(1);
  });

  it('tin của khách và echo trong cùng payload, sắp theo thời gian; cùng mid ở hai hướng chỉ giữ một', () => {
    const r = parseWebhookPayload(
      webhookPayload([
        messageEvent({ mid: 'out', text: 'báo giá', isEcho: true, timestamp: 3000 }),
        messageEvent({ mid: 'in', text: 'cho anh báo giá', timestamp: 1000 }),
        messageEvent({ mid: 'out', text: 'báo giá', isEcho: true, timestamp: 3000 }), // echo đến hai đường
      ]),
    );
    expect(r.messages.map((m) => [m.mid, m.direction])).toEqual([['in', 'inbound'], ['out', 'outbound']]);
    expect(r.stats.duplicateInPayload).toBe(1);
  });
});

describe('parseWebhookPayload: standby (app không giữ thread)', () => {
  it('xử lý sự kiện trong mảng standby giống messaging', () => {
    const r = parseWebhookPayload(
      webhookPayload([messageEvent({ mid: 's1', text: 'khách nhắn khi app khác giữ thread' }), messageEvent({ mid: 's2', text: 'trả lời', isEcho: true, appId: 111 })], PAGE_ID, { standby: true }),
    );
    expect(r.messages.map((m) => [m.mid, m.direction])).toEqual([['s1', 'inbound'], ['s2', 'outbound']]);
  });

  it('entry có cả messaging lẫn standby: lấy cả hai', () => {
    const payload = {
      object: 'page',
      entry: [{ id: PAGE_ID, messaging: [messageEvent({ mid: 'a', timestamp: 1 })], standby: [messageEvent({ mid: 'b', timestamp: 2 })] }],
    };
    expect(parseWebhookPayload(payload).messages.map((m) => m.mid)).toEqual(['a', 'b']);
  });
});

describe('parseWebhookPayload: tương tác của khách ngoài tin nhắn', () => {
  it('reaction, postback, referral của khách thành sự kiện tương tác, không thành tin', () => {
    const r = parseWebhookPayload(
      webhookPayload([
        reactionEvent({ timestamp: 1000 }),
        postbackEvent({ timestamp: 2000 }),
        referralEvent({ timestamp: 3000 }),
      ]),
    );
    expect(r.messages).toEqual([]);
    expect(r.interactions).toEqual([
      { fbPageId: PAGE_ID, psid: PSID, atMs: 1000, kind: 'reaction' },
      { fbPageId: PAGE_ID, psid: PSID, atMs: 2000, kind: 'postback' },
      { fbPageId: PAGE_ID, psid: PSID, atMs: 3000, kind: 'referral' },
    ]);
    expect(r.stats.interactions).toBe(3);
  });

  it('bỏ thả cảm xúc (unreact) vì không mở cửa sổ; thiếu action thì coi là react', () => {
    const r = parseWebhookPayload(webhookPayload([reactionEvent({ action: 'unreact' }), reactionEvent({ action: null, timestamp: 5000 })]));
    expect(r.interactions.map((i) => i.atMs)).toEqual([5000]);
    expect(r.stats.notMessage).toBe(1);
  });

  it('Page tự thả cảm xúc hoặc bấm: không phải hành động của khách, không ghi nhận', () => {
    const r = parseWebhookPayload(webhookPayload([reactionEvent({ senderIsPage: true }), { ...postbackEvent(), sender: { id: PAGE_ID } }]));
    expect(r.interactions).toEqual([]);
    expect(r.stats.notMessage).toBe(2);
  });

  it('tương tác thiếu người gửi hoặc timestamp: sự kiện hỏng, không ném lỗi', () => {
    const noSender = { recipient: { id: PAGE_ID }, timestamp: 1, reaction: { action: 'react' } };
    const noTime = { sender: { id: PSID }, recipient: { id: PAGE_ID }, postback: {} };
    const r = parseWebhookPayload(webhookPayload([noSender, noTime, referralEvent({ timestamp: 9000 })]));
    expect(r.interactions).toHaveLength(1);
    expect(r.stats.invalid).toBe(2);
  });

  it('tương tác trong standby cũng được ghi nhận', () => {
    const r = parseWebhookPayload(webhookPayload([postbackEvent({ timestamp: 7000 })], PAGE_ID, { standby: true }));
    expect(r.interactions).toHaveLength(1);
  });
});

describe('parseWebhookPayload: cảnh báo hoặc khóa từ Meta (policy_enforcement)', () => {
  it('đọc action, reason và thời điểm; recipient.id là Page', () => {
    const r = parseWebhookPayload(webhookPayload([policyEvent({ action: 'block', reason: 'Gửi tin quá nhiều', timestamp: 8000 })]));
    expect(r.policyEvents).toEqual([{ fbPageId: PAGE_ID, atMs: 8000, action: 'block', reason: 'Gửi tin quá nhiều' }]);
    expect(r.messages).toEqual([]);
    expect(r.stats.policyEvents).toBe(1);
  });

  it('unblock không có reason (theo tài liệu): reason null', () => {
    const r = parseWebhookPayload(webhookPayload([policyEvent({ action: 'unblock', timestamp: 9000 })]));
    expect(r.policyEvents[0]).toMatchObject({ action: 'unblock', reason: null });
  });

  it('thiếu timestamp thì dùng entry.time; thiếu cả hai thì là sự kiện hỏng', () => {
    const withEntryTime = parseWebhookPayload(webhookPayload([policyEvent({ timestamp: null })], PAGE_ID, { entryTime: 12345 }));
    expect(withEntryTime.policyEvents[0]!.atMs).toBe(12345);
    const noTime = { object: 'page', entry: [{ id: PAGE_ID, messaging: [policyEvent({ timestamp: null })] }] };
    const r = parseWebhookPayload(noTime);
    expect(r.policyEvents).toEqual([]);
    expect(r.stats.invalid).toBe(1);
  });

  it('giữ nguyên giá trị action lạ (Meta có thể thêm); cắt reason quá dài; bỏ NUL', () => {
    const r = parseWebhookPayload(webhookPayload([policyEvent({ action: 'restrict', reason: 'x'.repeat(5000) + '\u0000' })]));
    expect(r.policyEvents[0]!.action).toBe('restrict');
    expect(r.policyEvents[0]!.reason).toHaveLength(1000);
    const nul = parseWebhookPayload(webhookPayload([policyEvent({ reason: 'a\u0000b' })]));
    expect(nul.policyEvents[0]!.reason).toBe('ab');
  });

  it.each([['policy_enforcement'], ['policy-enforcement'], ['messaging_policy_enforcement']])(
    'nhận khóa %s (dạng khóa chưa kiểm chứng bằng payload thật nên không phụ thuộc vào một dạng)',
    (key) => {
      const ev = { recipient: { id: PAGE_ID }, timestamp: 4000, [key]: { action: 'block', reason: 'vi phạm' } };
      const r = parseWebhookPayload(webhookPayload([ev]));
      expect(r.policyEvents).toEqual([{ fbPageId: PAGE_ID, atMs: 4000, action: 'block', reason: 'vi phạm' }]);
    },
  );

  it('khóa lạ không khớp dạng nào: không phải sự kiện chính sách (đếm vào notMessage, không ném lỗi)', () => {
    const ev = { recipient: { id: PAGE_ID }, timestamp: 4000, policy: { action: 'block' } };
    const r = parseWebhookPayload(webhookPayload([ev]));
    expect(r.policyEvents).toEqual([]);
    expect(r.stats.notMessage).toBe(1);
  });

  it('action rỗng hoặc quá dài: sự kiện hỏng', () => {
    const ev = (action: string) => ({ recipient: { id: PAGE_ID }, timestamp: 1, policy_enforcement: { action } });
    const r = parseWebhookPayload(webhookPayload([ev(''), ev('a'.repeat(65))]));
    expect(r.policyEvents).toEqual([]);
    expect(r.stats.invalid).toBe(2);
  });
});

describe('parseWebhookPayload: payload hỗn hợp', () => {
  it('tin, echo, tương tác, cảnh báo và sự kiện lạ trong một batch: mỗi loại vào đúng chỗ, không loại nào làm mất loại khác', () => {
    const r = parseWebhookPayload(
      webhookPayload([
        messageEvent({ mid: 'in1', text: 'hỏi giá', timestamp: 1000 }),
        messageEvent({ mid: 'out1', text: 'dạ 5 triệu', isEcho: true, appId: '263902037430900', timestamp: 2000 }),
        reactionEvent({ timestamp: 3000 }),
        postbackEvent({ timestamp: 4000 }),
        policyEvent({ action: 'warning', timestamp: 5000 }),
        { sender: { id: PSID }, recipient: { id: PAGE_ID }, delivery: {} },
        { garbage: true },
      ]),
    );
    expect(r.messages.map((m) => m.mid)).toEqual(['in1', 'out1']);
    expect(r.interactions).toHaveLength(2);
    expect(r.policyEvents).toHaveLength(1);
    expect(r.stats).toMatchObject({ outbound: 1, interactions: 2, policyEvents: 1, notMessage: 2, invalid: 0 });
  });
});
