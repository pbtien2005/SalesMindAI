import { newConnectUrl, createTenant, listTenants, tenantExists } from '../auth/tenants.js';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';

const USAGE = `Dùng: npm run cli -- <lệnh>

  tenant:create <tên>         Tạo doanh nghiệp (tenant) và in liên kết kết nối Page
  tenant:connect-url <id>     Tạo liên kết kết nối Page mới cho tenant đã có
  tenant:list                 Liệt kê tenant và số Page đã kết nối

Liên kết kết nối dùng được MỘT lần và hết hạn sau 10 phút. Gửi cho người quản lý Page,
họ mở bằng trình duyệt và đăng nhập Facebook để cấp quyền.`;

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
  try {
    switch (command) {
      case 'tenant:create': {
        const name = args.join(' ');
        const tenant = await createTenant(db, name);
        console.log(`Đã tạo tenant "${tenant.name}" (${tenant.id}).`);
        console.log('Liên kết kết nối Page (một lần, 10 phút):');
        console.log(await newConnectUrl(db, env.PUBLIC_BASE_URL, tenant.id));
        return 0;
      }
      case 'tenant:connect-url': {
        const id = args[0];
        if (!id) throw new Error('Thiếu ID tenant.');
        if (!(await tenantExists(db, id))) throw new Error(`Không có tenant ${id}.`);
        console.log(await newConnectUrl(db, env.PUBLIC_BASE_URL, id));
        return 0;
      }
      case 'tenant:list': {
        const rows = await listTenants(db);
        if (rows.length === 0) console.log('Chưa có tenant nào.');
        for (const r of rows) console.log(`${r.id}  ${r.pages} Page  ${r.name}`);
        return 0;
      }
      default:
        console.error(`Lệnh không hợp lệ: ${command}\n\n${USAGE}`);
        return 1;
    }
  } finally {
    await close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
