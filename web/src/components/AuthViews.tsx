import { useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { InviteInfo } from '../api/types';
import { useAuthConfig, useDemoLogin, useLogin } from '../api/hooks';
import { ErrorBanner } from './ErrorBanner';

const input = 'h-11 w-full rounded-lg border border-line-strong px-3 text-[15px]';
const primary = 'h-11 w-full rounded-lg border-0 bg-brand font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';
const link = 'border-0 bg-transparent p-0 text-sm font-semibold text-brand underline';

export type AuthScreen = 'login' | 'forgot' | 'signup';

/** Khung chung của mọi màn trước đăng nhập. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <main id="main" className="w-full max-w-[400px] rounded-2xl border border-line bg-white p-7 shadow-sm">
        <div className="mb-1 text-[15px] font-bold tracking-tight text-brand">SalesMind AI</div>
        <h1 className="m-0 mb-5 text-[22px] font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function Field({ id, label, ...rest }: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <input id={id} className={input} {...rest} />
    </div>
  );
}

export function LoginView({ goto }: { goto: (s: AuthScreen) => void }) {
  const config = useAuthConfig();
  const login = useLogin();
  const demo = useDemoLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email: email.trim(), password });
  };

  return (
    <AuthFrame title="Đăng nhập">
      <form onSubmit={submit}>
        <Field id="email" name="email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field id="password" name="password" label="Mật khẩu" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div aria-live="polite">{login.error ? <ErrorBanner error={login.error} /> : null}</div>
        <button type="submit" className={`${primary} mt-3`} disabled={login.isPending || email.trim() === '' || password === ''}>
          {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
      <div className="mt-4 flex items-center justify-between">
        <button type="button" className={link} onClick={() => goto('forgot')}>
          Quên mật khẩu?
        </button>
        {config.data?.signupOpen ? (
          <button type="button" className={link} onClick={() => goto('signup')}>
            Tạo tài khoản
          </button>
        ) : null}
      </div>
      {config.data?.demoLogin ? (
        <div className="mt-6 border-t border-dashed border-line-strong pt-4">
          <div className="mb-2 text-xs text-ink-3">Chế độ demo: vào nhanh, không cần mật khẩu.</div>
          <div className="flex gap-2">
            <button type="button" className="h-10 grow rounded-lg border border-line-strong bg-white font-semibold" disabled={demo.isPending} onClick={() => demo.mutate('lan')}>
              Vào với tư cách Lan
            </button>
            <button type="button" className="h-10 grow rounded-lg border border-line-strong bg-white font-semibold" disabled={demo.isPending} onClick={() => demo.mutate('ha')}>
              Vào với tư cách chị Hà
            </button>
          </div>
          {demo.error ? (
            <div className="mt-2">
              <ErrorBanner error={demo.error} />
            </div>
          ) : null}
        </div>
      ) : null}
    </AuthFrame>
  );
}

export function ForgotView({ goto }: { goto: (s: AuthScreen) => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await api.forgot(email.trim());
      setState('sent');
    } catch (err) {
      setError(err);
      setState('error');
    }
  };

  return (
    <AuthFrame title="Quên mật khẩu">
      {state === 'sent' ? (
        <p role="status" className="mt-0 text-sm">
          Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu (hiệu lực 1 giờ). Kiểm tra hộp thư của bạn.
        </p>
      ) : (
        <form onSubmit={submit}>
          <Field id="forgot-email" name="email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {state === 'error' ? <ErrorBanner error={error} /> : null}
          <button type="submit" className={`${primary} mt-3`} disabled={state === 'sending' || email.trim() === ''}>
            {state === 'sending' ? 'Đang gửi…' : 'Gửi liên kết đặt lại'}
          </button>
        </form>
      )}
      <div className="mt-4">
        <button type="button" className={link} onClick={() => goto('login')}>
          Quay lại đăng nhập
        </button>
      </div>
    </AuthFrame>
  );
}

export function SignupView({ goto }: { goto: (s: AuthScreen) => void }) {
  const [form, setForm] = useState({ businessName: '', displayName: '', email: '', password: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await api.signup({ ...form, email: form.email.trim() });
      setState('sent');
    } catch (err) {
      setError(err);
      setState('error');
    }
  };

  return (
    <AuthFrame title="Tạo tài khoản">
      {state === 'sent' ? (
        <p role="status" className="mt-0 text-sm">
          Đã tạo tài khoản. Chúng tôi gửi một thư xác minh tới {form.email.trim()}; bạn có thể đăng nhập và kết nối Page Facebook ngay.
        </p>
      ) : (
        <form onSubmit={submit}>
          <Field id="biz" name="organization" label="Tên doanh nghiệp" autoComplete="organization" value={form.businessName} onChange={set('businessName')} required autoFocus />
          <Field id="name" name="name" label="Tên của bạn" autoComplete="name" value={form.displayName} onChange={set('displayName')} required />
          <Field id="su-email" name="email" label="Email" type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
          <Field id="su-pass" name="new-password" label="Mật khẩu (ít nhất 10 ký tự)" type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required />
          <div aria-live="polite">{state === 'error' ? <ErrorBanner error={error} /> : null}</div>
          <button type="submit" className={`${primary} mt-3`} disabled={state === 'sending'}>
            {state === 'sending' ? 'Đang tạo…' : 'Tạo tài khoản'}
          </button>
        </form>
      )}
      <div className="mt-4">
        <button type="button" className={link} onClick={() => goto('login')}>
          Quay lại đăng nhập
        </button>
      </div>
    </AuthFrame>
  );
}

/** Mở từ liên kết trong thư: `/?reset=<token>`. */
export function ResetView({ token, done }: { token: string; done: () => void }) {
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await api.reset(token, password);
      setState('ok');
    } catch (err) {
      setError(err);
      setState('error');
    }
  };

  return (
    <AuthFrame title="Đặt lại mật khẩu">
      {state === 'ok' ? (
        <>
          <p role="status" className="mt-0 text-sm">
            Đã đổi mật khẩu. Mọi phiên đăng nhập cũ đã bị đăng xuất.
          </p>
          <button type="button" className={primary} onClick={done}>
            Đăng nhập
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field id="rs-pass" name="new-password" label="Mật khẩu mới (ít nhất 10 ký tự)" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          <div aria-live="polite">{state === 'error' ? <ErrorBanner error={error} /> : null}</div>
          <button type="submit" className={`${primary} mt-3`} disabled={state === 'sending' || password.length < 10}>
            {state === 'sending' ? 'Đang lưu…' : 'Đặt mật khẩu mới'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

/** Mở từ liên kết mời: `/?invite=<token>`. Người nhận đặt tên và mật khẩu, rồi vào luôn. */
export function AcceptInviteView({ token, done }: { token: string; done: () => void }) {
  const qc = useQueryClient();
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [form, setForm] = useState({ displayName: '', password: '', email: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);
  const [started, setStarted] = useState(false);
  if (!started) {
    setStarted(true);
    api.inviteInfo(token).then(setInfo, () => setInfo(null));
  }
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await api.acceptInvite({ token, displayName: form.displayName, password: form.password, ...(info?.email ? {} : { email: form.email.trim() }) });
      await qc.invalidateQueries({ queryKey: ['me'] });
      done();
    } catch (err) {
      setError(err);
      setState('error');
    }
  };

  if (info === undefined) return <AuthFrame title="Lời mời"><p role="status" className="m-0 text-sm">Đang kiểm tra lời mời…</p></AuthFrame>;
  if (info === null) {
    return (
      <AuthFrame title="Lời mời không dùng được">
        <p className="mt-0 text-sm">Liên kết đã hết hạn, đã được dùng hoặc đã bị thu hồi. Hãy xin người mời một liên kết mới.</p>
        <button type="button" className={primary} onClick={done}>Về đăng nhập</button>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={`Tham gia ${info.tenantName}`}>
      <form onSubmit={submit}>
        <Field id="iv-name" name="name" label="Tên của bạn" autoComplete="name" value={form.displayName} onChange={set('displayName')} required autoFocus />
        {info.email ? <p className="mt-0 text-sm text-ink-3">Email: {info.email}</p> : <Field id="iv-email" name="email" label="Email" type="email" autoComplete="username" value={form.email} onChange={set('email')} required />}
        <Field id="iv-pass" name="new-password" label="Mật khẩu (ít nhất 10 ký tự)" type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required />
        <div aria-live="polite">{state === 'error' ? <ErrorBanner error={error} /> : null}</div>
        <button type="submit" className={`${primary} mt-3`} disabled={state === 'sending'}>{state === 'sending' ? 'Đang tạo…' : 'Tham gia'}</button>
      </form>
    </AuthFrame>
  );
}

/** Mở từ liên kết trong thư: `/?verify=<token>`. Gọi đúng một lần khi hiện. */
export function VerifyView({ token, done }: { token: string; done: () => void }) {
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [error, setError] = useState<unknown>(null);
  const [started, setStarted] = useState(false);
  if (!started) {
    setStarted(true);
    api.verifyEmail(token).then(
      () => setState('ok'),
      (e) => {
        setError(e);
        setState('error');
      },
    );
  }
  return (
    <AuthFrame title="Xác minh email">
      {state === 'working' ? (
        <p role="status" className="mt-0 text-sm">
          Đang xác minh…
        </p>
      ) : null}
      {state === 'ok' ? (
        <p role="status" className="mt-0 text-sm">
          Đã xác minh email.
        </p>
      ) : null}
      {state === 'error' ? <ErrorBanner error={error} /> : null}
      {state !== 'working' ? (
        <button type="button" className={`${primary} mt-3`} onClick={done}>
          Tiếp tục
        </button>
      ) : null}
    </AuthFrame>
  );
}
