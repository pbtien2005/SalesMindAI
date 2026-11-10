import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { Me } from '../api/types';
import { meLan } from './fixtures';
import { SessionProvider } from '../state/session';

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type Handler = (url: string, init: RequestInit & { headers: Record<string, string> }) => Response | Promise<Response>;

/** Gắn `fetch` giả; mọi lời gọi được ghi lại để kiểm tra. Mỗi lần gọi trả Response mới. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), { ...(init ?? {}), headers: (init?.headers ?? {}) as Record<string, string> }));
  vi.stubGlobal('fetch', fn);
  const calls = () => fn.mock.calls.map(([url, init]) => ({ url: String(url), init: (init ?? {}) as RequestInit & { headers: Record<string, string> } }));
  const posts = () => calls().filter((c) => c.init.method === 'POST');
  return { fn, calls, posts, body: (i: number) => JSON.parse(posts()[i]?.init.body as string) as Record<string, unknown> };
}

export function renderApp(ui: ReactElement, me: Me = meLan) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider me={me}>{ui}</SessionProvider>
    </QueryClientProvider>,
  );
}
