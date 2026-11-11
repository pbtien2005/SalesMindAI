// Kịch bản Chrome đi hết các cảnh demo (0 → 6) và hai biến thể, trên backend thật.
//
// Cần: backend đang chạy với DEMO_MODE=true, AI_MODE=offline (hoặc live), AI_DEBOUNCE_SECONDS=3, đã `npm run build` ở web/
// (backend phục vụ web/dist). Chạy:  E2E_URL=http://127.0.0.1:3000 node e2e/run.mjs   (hoặc `npm run e2e`)
// Mỗi lần chạy mở bằng "Đặt lại demo". Thoát mã 1 nếu có bước sai, lỗi console hoặc HTTP >= 400 ngoài dự kiến.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:3000';
const SHOTS = process.env.E2E_SHOTS ?? join(process.cwd(), 'e2e', 'shots');
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Không tìm thấy Chrome. Đặt CHROME_PATH.');
mkdirSync(SHOTS, { recursive: true });

const problems = [];
let expected4xx = 0; // số lỗi 4xx có chủ ý (biến thể) được phép
const log = (m) => console.log(`  ${m}`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--window-size=1500,950'], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
page.on('console', (m) => {
  // "Failed to load resource" đã được kiểm riêng qua sự kiện response (có URL và mã).
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().startsWith(BASE)) {
    if (r.status() < 500 && expected4xx > 0) expected4xx -= 1;
    else if (!(r.url().endsWith('/api/auth/me') && r.status() === 401)) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 40_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await page.evaluate(fn);
      if (v) return v;
    } catch {
      /* trang đang chuyển */
    }
    if (Date.now() > end) throw new Error(`Hết giờ chờ: ${what}`);
    await sleep(250);
  }
}
const body = () => page.evaluate(() => document.body.innerText);
async function expectText(text, what = text, ms = 40_000) {
  await until(`document.body.innerText.includes(${JSON.stringify(text)})`, what, ms);
}
async function shot(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
/** Bấm nút theo tên (khớp chính xác trước, rồi khớp chứa). Chờ tới khi nút có mặt và không bị khóa. */
async function click(name, { within, exact = true, ms = 20_000 } = {}) {
  const fn = `(() => {
    const root = ${within ? `document.querySelector(${JSON.stringify(within)})` : 'document'};
    if (!root) return false;
    const label = (b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\\s+/g, ' ').trim();
    const all = [...root.querySelectorAll('button, a[href]')].filter((b) => !b.disabled);
    const want = ${JSON.stringify(name)};
    const hit = all.find((b) => label(b) === want) || ${exact ? 'null' : 'all.find((b) => label(b).includes(want))'};
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return true;
  })()`;
  await until(fn, `bấm "${name}"`, ms);
}
/** Điền ô theo nhãn (label hoặc aria-label), dùng setter gốc để React nhận. */
async function fill(label, value, { within } = {}) {
  const fn = `(() => {
    const root = ${within ? `document.querySelector(${JSON.stringify(within)})` : 'document'};
    if (!root) return false;
    const want = ${JSON.stringify(label)};
    let el = [...root.querySelectorAll('input, textarea')].find((e) => e.getAttribute('aria-label') === want);
    if (!el) {
      const lab = [...root.querySelectorAll('label')].find((l) => l.innerText.replace(/\\s+/g, ' ').trim() === want);
      if (lab && lab.htmlFor) el = root.querySelector('#' + CSS.escape(lab.htmlFor));
    }
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
  await until(fn, `điền "${label}"`);
}
async function selectOption(label, text) {
  await until(
    `(() => {
      const lab = [...document.querySelectorAll('label')].find((l) => l.innerText.trim() === ${JSON.stringify(label)});
      const el = lab && document.getElementById(lab.htmlFor);
      if (!el) return false;
      const opt = [...el.options].find((o) => o.text.trim() === ${JSON.stringify(text)});
      if (!opt) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
    `chọn "${text}"`,
  );
}
const SIM = '#simulator-panel';
const simSample = async (label) => click(label, { within: SIM });
async function simCustomer(sampleLabel) {
  await simSample(sampleLabel);
  await click('Gửi như khách', { within: SIM });
  await expectText('Đã gửi. AI trích xuất sau vài giây.', 'tin khách đã gửi');
}
async function openSim() {
  if (!(await page.$(SIM))) await click('Giả lập');
  await page.waitForSelector(SIM);
}
async function closeSim() {
  if (await page.$(SIM)) await click('Đóng bảng Giả lập');
}
const nav = async (name) => click(name, { within: 'nav[aria-label="Điều hướng"]' });
async function openConversation(name) {
  await nav('Hội thoại');
  await until(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes(${JSON.stringify(name)}))`, `danh sách có ${name}`);
  await click(name, { exact: false, within: 'main' });
  await until(`(document.querySelector('main h2')?.innerText || '').includes(${JSON.stringify(name)}) || document.body.innerText.includes('Thẻ khách')`, `mở ${name}`);
  await sleep(400);
}
/** Đặt lại demo và chờ xong (hộp xác nhận đóng, dữ liệu nền dựng lại). */
async function resetDemo() {
  await nav('Trang chủ'); // rời màn Hội thoại trước, để không còn gọi hội thoại cũ vừa bị xóa
  await sleep(500);
  await click('Đặt lại demo');
  await click('Đặt lại');
  await until(`!document.body.innerText.includes('Xóa dữ liệu demo?')`, 'đặt lại xong');
  await sleep(2500);
  await expectText('Chị Thu, chờ');
}
const check = (cond, what) => {
  if (!cond) throw new Error(`SAI: ${what}`);
  log(`✓ ${what}`);
};
const statValue = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').startsWith(l));
    return b ? b.innerText : null;
  }, label);

async function run(n) {
  console.log(`\n=== Lần chạy ${n} ===`);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  // Đăng nhập nhanh bằng Lan (đã đăng nhập rồi thì bỏ qua).
  if ((await body()).includes('Vào với tư cách Lan')) await click('Vào với tư cách Lan');
  await expectText('Trang chủ của Lan');

  // ---- Cảnh 0: đặt lại, buổi sáng của Lan.
  await resetDemo();
  check((await body()).includes('Khách ưu tiên P1'), 'Cảnh 0: Trang chủ có thẻ P1');
  check((await statValue('Việc quá hạn')).includes('2'), 'Cảnh 0: 2 việc quá hạn');
  await shot(`${n}-c0-trang-chu`);

  // ---- Cảnh 1: Minh nhắn, thẻ khách tự điền, Lan trả lời.
  await openSim();
  await click('Cảnh 1: Thứ Năm 12/11 09:05', { within: SIM });
  await simCustomer('Cảnh 1, tin 1');
  await simCustomer('Cảnh 1, tin 2');
  await openConversation('anh Minh');
  await expectText('AI điền, chưa duyệt', 'thẻ khách tự điền');
  check(!(await body()).includes('Câu gốc:'), 'Cảnh 1: câu gốc thu gọn mặc định');
  await click('Căn cứ Ngân sách');
  await expectText('Câu gốc:', 'bấm "Căn cứ" hiện câu gốc');
  await shot(`${n}-c1-the-khach`);

  // ---- Cảnh 2: ngừng bám Cô Mai.
  await click('Cảnh 2: Thứ Sáu 13/11 09:30', { within: SIM });
  await closeSim();
  await openConversation('Cô Mai');
  await click('Ngừng bám');
  await click('Xác nhận ngừng bám');
  await expectText('Đã ngừng bám');
  check(true, 'Cảnh 2: Sale xác nhận ngừng bám Cô Mai');

  // ---- Cảnh 3: SĐT và "cuối tuần này" phải hỏi lại ngày.
  await openSim();
  await click('Cảnh 3: Thứ Sáu 13/11 09:40', { within: SIM });
  await simCustomer('Cảnh 3');
  await closeSim();
  await openConversation('anh Minh');
  await expectText('Hộp đề xuất');
  await expectText('cần xác nhận ngày', 'mốc hẹn mơ hồ hỏi lại ngày');
  const noAutoDate = await page.evaluate(() => document.querySelector('input[type="datetime-local"]')?.value === '');
  check(noAutoDate, 'Cảnh 3: ô chọn ngày để trống (AI không tự điền ngày)');
  await click('Thứ Bảy 14/11 10:00');
  await click('Duyệt 2 mục');
  await expectText('Đã duyệt bởi Lan', 'đã duyệt');
  await shot(`${n}-c3-da-duyet`);

  // ---- Cảnh 4: Minh chốt đơn, AI dựng đơn nháp và tin nháp.
  await openSim();
  await click('Cảnh 4: Thứ Sáu 13/11 09:50', { within: SIM });
  await simCustomer('Cảnh 4');
  await closeSim();
  await expectText('Tín hiệu chốt đơn', 'tín hiệu chốt đơn');
  await expectText('Soạn sẵn từ đơn nháp', 'tin nháp');
  const b4 = await body();
  check(b4.includes('Sofa Milan xám (SF-021)') && b4.includes('6.000.000 ₫'), 'Cảnh 4: đơn nháp đúng sản phẩm và tiền cọc 50%');
  check(b4.includes('Thiếu'), 'Cảnh 4: địa chỉ còn thiếu');
  await shot(`${n}-c4-don-nhap`);
  await click('Gửi', { within: 'section[aria-label^="Tin nháp"]' });
  await expectText('Chờ cọc', 'đơn chuyển sang chờ cọc');
  check((await body()).includes('SalesMind'), 'Cảnh 4: tin gửi hiện nhãn SalesMind');

  // ---- Cảnh 5: bill 6 triệu, Sale xác nhận cọc, tạo đơn.
  await openSim();
  await click('Cảnh 5: Thứ Sáu 13/11 10:10', { within: SIM });
  await click('Gửi ảnh bill 6 triệu', { within: SIM });
  await expectText('6.000.000 ₫ / 12.000.000 ₫ = 50%, đạt ngưỡng ≥ 50%', 'bill đạt ngưỡng');
  await shot(`${n}-c5-bill`);
  await closeSim();
  await click('Xác nhận đã cọc');
  await expectText('Tạo đơn', 'bước tạo đơn');
  await fill('Địa chỉ nhận hàng', '12 Lê Lợi, Quận 1, TP.HCM', { within: 'section[aria-label="Tạo đơn"]' });
  await click('Xác nhận tạo đơn');
  await expectText('Đã tạo đơn #DH-0001', 'đã tạo đơn');
  await shot(`${n}-c5-tao-don`);
  // Lan nhắn xác nhận cho khách (không thì Minh còn là P1 thứ hai).
  await click('Gửi', { within: 'section[aria-label^="Tin nháp"]' });
  await sleep(1500);

  // ---- Cảnh 6: chị Hà xem Trang chủ.
  await openSim();
  await click('Cảnh 6: Thứ Sáu 13/11 10:30', { within: SIM });
  await closeSim();
  await click('Chị Hà (Quản lý)', { within: '[aria-label="Vào nhanh"]' });
  await expectText('Trang chủ, đội của chị Hà');
  await nav('Trang chủ');
  await until(`document.body.innerText.includes('Tiền cọc hôm nay')`, 'thẻ tiền cọc');
  const home = await body();
  check(home.includes('6.000.000 ₫'), 'Cảnh 6: tiền cọc hôm nay 6.000.000 ₫');
  check((await statValue('Việc quá hạn')).includes('2'), 'Cảnh 6: 2 việc quá hạn');
  check(/Khách ưu tiên P1\s*\n?\s*1\b/.test(home), 'Cảnh 6: P1 = 1 (chị Thu)');
  check(/1\s*\n?\s*Mốc hẹn AI hỏi lại ngày/.test(home), 'Cảnh 6: AI hỏi lại ngày = 1');
  await shot(`${n}-c6-trang-chu-ha`);
  await nav('Đơn hàng');
  await expectText('#DH-0001', 'màn Đơn hàng');
  const orders = await body();
  check(orders.includes('12.000.000 ₫') && orders.includes('Đã tạo'), 'Cảnh 6: màn Đơn hàng đúng số liệu');
  await shot(`${n}-c6-don-hang`);

  // ---- Biến thể A: bill 3 triệu → dưới 50%, gợi ý nhắc chuyển nốt.
  await click('Lan (Sale)', { within: '[aria-label="Vào nhanh"]' });
  await expectText('Trang chủ của Lan');
  await resetDemo();
  await openSim();
  await click('Cảnh 4: Thứ Sáu 13/11 09:50', { within: SIM });
  await simCustomer('Cảnh 4');
  await closeSim();
  await openConversation('anh Minh');
  await expectText('Soạn sẵn từ đơn nháp');
  await click('Gửi', { within: 'section[aria-label^="Tin nháp"]' });
  await expectText('Chờ cọc');
  await openSim();
  await click('Gửi ảnh bill 3 triệu', { within: SIM });
  await expectText('3.000.000 ₫ / 12.000.000 ₫ = 25%, dưới 50%', 'bill dưới ngưỡng');
  check(!(await body()).includes('đạt ngưỡng'), 'Biến thể A: không nói đạt ngưỡng');
  await closeSim();
  await click('Bỏ qua', { within: 'section[aria-label="Ảnh bill chuyển khoản"]' });
  await until(`[...document.querySelectorAll('textarea')].some((t) => t.value.includes('chưa đủ cọc'))`, 'tin nháp nhắc chuyển nốt');
  check(true, 'Biến thể A: có tin nháp nhắc chuyển nốt');
  await shot(`${n}-bien-the-a`);

  // ---- Biến thể B: Sale sửa giá trị AI điền sai.
  await resetDemo();
  await openSim();
  await click('Cảnh 1: Thứ Năm 12/11 09:05', { within: SIM });
  await simCustomer('Cảnh 1, tin 1');
  await closeSim();
  await openConversation('anh Minh');
  await expectText('AI điền, chưa duyệt');
  await click('Sửa Sản phẩm quan tâm');
  await fill('Giá trị đã sửa của Sản phẩm quan tâm', 'Tủ giày');
  await click('Lưu và duyệt');
  await expectText('Đã sửa và duyệt bởi Lan', 'đã sửa và duyệt');
  await nav('Trang chủ');
  await expectText('Lần Sale phải sửa');
  await until(`/1\\s*\\n?\\s*Lần Sale phải sửa/.test(document.body.innerText)`, 'Sale phải sửa = 1');
  check(true, 'Biến thể B: "Sale phải sửa" = 1');
  await shot(`${n}-bien-the-b`);
}

const runs = Number(process.env.E2E_RUNS ?? 1);
let failed = false;
try {
  for (let i = 1; i <= runs; i++) await run(i);
} catch (e) {
  failed = true;
  console.error(`\nLỖI: ${e.message}`);
  await shot('loi').catch(() => {});
}
await browser.close();
if (problems.length > 0) {
  failed = true;
  console.error(`\nCó ${problems.length} vấn đề console/HTTP:\n${[...new Set(problems)].map((p) => ` - ${p}`).join('\n')}`);
}
console.log(failed ? '\nE2E: KHÔNG ĐẠT' : `\nE2E: ĐẠT (${runs} lần, không lỗi console, không HTTP >= 400)`);
process.exit(failed ? 1 : 0);
