import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { setUnauthorizedHandler } from '../api/client';
import { useMe } from '../api/hooks';
import { App } from '../App';
import { SessionProvider } from '../state/session';
import { AuthFrame, ForgotView, LoginView, ResetView, SignupView, VerifyView, type AuthScreen } from './AuthViews';
import { ErrorBanner } from './ErrorBanner';

/** Token trong liên kết thư: `/?reset=…` hoặc `/?verify=…`. Chỉ đọc một lần khi tải trang. */
function readLinkToken(): { kind: 'reset' | 'verify'; token: string } | null {
  const q = new URLSearchParams(window.location.search);
  for (const kind of ['reset', 'verify'] as const) {
    const t = q.get(kind);
    if (t && /^[A-Za-z0-9_-]{20,100}$/.test(t)) return { kind, token: t };
  }
  return null;
}

/** Cổng đăng nhập: chưa đăng nhập thì hiện màn đăng nhập, rồi mới vào ứng dụng. */
export function AuthGate() {
  const qc = useQueryClient();
  const me = useMe();
  const [screen, setScreen] = useState<AuthScreen>('login');
  const [link, setLink] = useState(readLinkToken);

  // Phiên hết hạn giữa chừng (route nào cũng trả 401): bỏ dữ liệu và về màn đăng nhập.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'authConfig' && q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const clearLink = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setLink(null);
  };

  if (link?.kind === 'reset') return <ResetView token={link.token} done={clearLink} />;
  if (link?.kind === 'verify') {
    return (
      <VerifyView
        token={link.token}
        done={() => {
          clearLink();
          void qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  if (me.isPending) {
    return (
      <AuthFrame title="Đang tải…">
        <p role="status" className="m-0 text-sm text-ink-3">
          Đang kiểm tra phiên đăng nhập…
        </p>
      </AuthFrame>
    );
  }
  if (me.isError) {
    return (
      <AuthFrame title="Không kết nối được">
        <ErrorBanner error={me.error} />
      </AuthFrame>
    );
  }
  if (me.data) {
    return (
      <SessionProvider key={me.data.id} me={me.data}>
        <App />
      </SessionProvider>
    );
  }
  if (screen === 'forgot') return <ForgotView goto={setScreen} />;
  if (screen === 'signup') return <SignupView goto={setScreen} />;
  return <LoginView goto={setScreen} />;
}
