// Dựng ảnh bill demo (tự vẽ, KHÔNG dùng logo hay giao diện của ngân hàng thật) bằng Chrome headless.
// Chạy: node scripts/make-demo-bills.mjs   (cần Chrome; đặt CHROME_PATH nếu không ở chỗ mặc định)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'demo-assets');
mkdirSync(out, { recursive: true });
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Không tìm thấy Chrome. Đặt CHROME_PATH.');

const bill = (amount, code) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif">
<div style="width:560px;margin:0 auto;padding:36px 28px;background:#fff;min-height:820px;box-sizing:border-box">
<div style="text-align:center;color:#0a7a3b;font-size:26px;font-weight:700">&#10003; Chuyển khoản thành công</div>
<div style="text-align:center;font-size:20px;color:#444;margin-top:6px">NGÂN HÀNG DEMO (ảnh mẫu, không phải bill thật)</div>
<div style="text-align:center;font-size:58px;font-weight:800;margin:36px 0 8px;color:#111">${amount} VND</div>
<div style="text-align:center;font-size:20px;color:#444">13/11/2026 10:09</div>
<hr style="margin:30px 0;border:0;border-top:1px solid #ddd">
<table style="width:100%;font-size:22px;line-height:2.1"><tr><td style="color:#666;width:42%">Người nhận</td><td style="font-weight:700">NOI THAT MINH PHAT (DEMO)</td></tr>
<tr><td style="color:#666">Số tài khoản</td><td style="font-weight:700">0000 0000 000</td></tr>
<tr><td style="color:#666">Nội dung</td><td style="font-weight:700">${code}</td></tr>
<tr><td style="color:#666">Mã giao dịch</td><td style="font-weight:700">DEMO${amount.replace(/\D/g, '')}</td></tr></table></div>`;

const sofa = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f4efe6">
<div style="width:560px;height:420px;position:relative;margin:0 auto">
<div style="position:absolute;left:60px;top:120px;width:440px;height:130px;background:#8b95a1;border-radius:24px 24px 8px 8px"></div>
<div style="position:absolute;left:40px;top:190px;width:90px;height:130px;background:#7a8490;border-radius:20px"></div>
<div style="position:absolute;left:430px;top:190px;width:90px;height:130px;background:#7a8490;border-radius:20px"></div>
<div style="position:absolute;left:100px;top:210px;width:360px;height:100px;background:#9aa4af;border-radius:14px"></div>
<div style="position:absolute;left:80px;top:320px;width:20px;height:50px;background:#5a4630"></div>
<div style="position:absolute;left:460px;top:320px;width:20px;height:50px;background:#5a4630"></div></div>`;

const jobs = [
  ['bill-6000000.png', bill('6.000.000', 'Minh coc SF-021'), '560,820'],
  ['bill-3000000.png', bill('3.000.000', 'Minh coc SF-021'), '560,820'],
  ['sofa.png', sofa, '560,420'],
];
const tmp = mkdtempSync(join(tmpdir(), 'bills-'));
for (const [name, html, size] of jobs) {
  const f = join(tmp, name.replace('.png', '.html'));
  writeFileSync(f, html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size}`, `--screenshot=${join(out, name)}`, pathToFileURL(f).href], { stdio: 'ignore' });
  console.log('đã tạo', name);
}
