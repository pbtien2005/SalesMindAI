import { describe, expect, it } from 'vitest';
import { classifyPageSender, DEFAULT_PAGE_INBOX_APP_IDS } from '../src/meta/sender-kind.js';

const cfg = { ownAppId: '1234567890', pageInboxAppIds: DEFAULT_PAGE_INBOX_APP_IDS };

describe('classifyPageSender (phân loại tin do Page gửi theo app_id của echo)', () => {
  it.each([
    ['app của ta', '1234567890', 'page_app'],
    ['Page Inbox (15 chữ số, giá trị thường dùng)', '263902037430900', 'page_inbox'],
    ['Page Inbox (14 chữ số, như tài liệu Meta ghi)', '26390203743090', 'page_inbox'],
    ['app hoặc bot khác', '999888777', 'page_other'],
    ['không có app_id (null)', null, 'page_unknown'],
    ['app_id rỗng', '', 'page_unknown'],
  ])('%s', (_name, appId, expected) => {
    expect(classifyPageSender(appId, cfg)).toBe(expected);
  });

  it('app của ta thắng khi trùng cả hai danh sách (tin gửi từ SalesMind không bị coi là người gõ tay)', () => {
    expect(classifyPageSender('263902037430900', { ownAppId: '263902037430900', pageInboxAppIds: ['263902037430900'] })).toBe('page_app');
  });

  it('danh sách Page Inbox cấu hình được: giá trị thật thay cho mặc định', () => {
    const custom = { ownAppId: '1', pageInboxAppIds: ['777'] };
    expect(classifyPageSender('777', custom)).toBe('page_inbox');
    expect(classifyPageSender('263902037430900', custom)).toBe('page_other'); // không còn được coi là Page Inbox
  });

  it('so khớp CHÍNH XÁC chuỗi: tiền tố hay số gần giống không được nhận nhầm', () => {
    expect(classifyPageSender('2639020374309000', cfg)).toBe('page_other'); // thừa một chữ số
    expect(classifyPageSender('63902037430900', cfg)).toBe('page_other'); // thiếu chữ số đầu
    expect(classifyPageSender(' 263902037430900', cfg)).toBe('page_other'); // có khoảng trắng
  });
});
