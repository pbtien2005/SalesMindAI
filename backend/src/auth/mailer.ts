/**
 * Gửi thư. Hiện chỉ có `ConsoleMailer` (dev): in liên kết ra log, KHÔNG dùng ở production.
 * Bản SMTP (nodemailer) làm sau, khi có máy chủ và tài khoản gửi thư; lúc đó chỉ cần thêm một lớp `Mailer` mới.
 */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}
  async send(to: string, subject: string, text: string): Promise<void> {
    this.log(`[thư dev] tới ${to}: ${subject}\n${text}`);
  }
}

/** Thư ghi lại trong bộ nhớ, dùng cho test. */
export class MemoryMailer implements Mailer {
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(to: string, subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
  }
}

/** Production chưa cấu hình gửi thư: ném lỗi rõ ràng thay vì im lặng nuốt thư. */
export class UnavailableMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('Chưa cấu hình gửi thư (SMTP). Dùng CLI user:reset-password hoặc cấu hình SMTP.');
  }
}
