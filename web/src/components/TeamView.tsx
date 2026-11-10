import { useState } from 'react';
import { formatDateTime } from '../api/format';
import { useCreateInvite, useRemoveMember, useRevokeInvite, useSetRole, useTeam } from '../api/hooks';
import type { Role } from '../api/types';
import { useSession } from '../state/session';
import { ErrorBanner } from './ErrorBanner';
import { Main } from './Main';

export const ROLE_LABEL: Record<Role, string> = { owner: 'Chủ doanh nghiệp', manager: 'Quản lý', sale: 'Sale' };

const btn = 'h-9 rounded-lg border border-line-strong bg-white px-3 text-sm disabled:opacity-50';
const primary = 'h-9 rounded-lg border-0 bg-brand px-4 text-sm font-semibold text-white disabled:bg-[#c9d2e0] disabled:text-ink-2';

export function TeamView() {
  const { role } = useSession();
  const team = useTeam();
  const invite = useCreateInvite();
  const revoke = useRevokeInvite();
  const setRole = useSetRole();
  const remove = useRemoveMember();
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('sale');
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const roles: Role[] = role === 'owner' ? ['sale', 'manager', 'owner'] : ['sale', 'manager'];
  const failure = invite.error ?? revoke.error ?? setRole.error ?? remove.error;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setCopied(false);
    invite.mutate(
      { role: newRole, ...(email.trim() ? { email: email.trim() } : {}) },
      {
        onSuccess: (r) => {
          setLink({ url: r.link, emailed: r.emailed });
          setEmail('');
        },
      },
    );
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Main title="Đội" className="overflow-auto bg-canvas">
      <div className="mx-auto flex max-w-[860px] flex-col gap-5 p-6">
        <h2 className="m-0 text-[22px] font-bold">Đội</h2>

        <section aria-label="Mời thành viên" className="rounded-xl border border-line bg-white p-5">
          <h3 className="m-0 mb-3 text-base font-bold">Mời thành viên</h3>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="inv-email" className="mb-1 block text-xs font-semibold text-ink-2">
                Email (không bắt buộc)
              </label>
              <input id="inv-email" name="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 w-64 rounded-lg border border-line-strong px-3 text-sm" />
            </div>
            <div>
              <label htmlFor="inv-role" className="mb-1 block text-xs font-semibold text-ink-2">
                Vai trò
              </label>
              <select id="inv-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm">
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={primary} disabled={invite.isPending}>
              Tạo liên kết mời
            </button>
          </form>
          {link ? (
            <div role="status" className="mt-4 rounded-lg border border-line bg-canvas p-3 text-sm">
              <div className="mb-1 font-semibold">Liên kết mời (chỉ hiện một lần, hiệu lực 7 ngày)</div>
              {link.emailed ? <div className="mb-1 text-ink-3">Đã gửi thư mời kèm liên kết này.</div> : null}
              <input readOnly aria-label="Liên kết mời" value={link.url} onFocus={(e) => e.currentTarget.select()} className="mb-2 h-9 w-full rounded-lg border border-line-strong px-2 text-xs" />
              <button type="button" className={btn} onClick={() => void copy()}>
                {copied ? 'Đã sao chép' : 'Sao chép liên kết'}
              </button>
            </div>
          ) : null}
        </section>

        {failure ? <ErrorBanner error={failure} /> : null}
        {team.isError ? <ErrorBanner error={team.error} /> : null}

        <section aria-label="Thành viên" className="rounded-xl border border-line bg-white p-5">
          <h3 className="m-0 mb-3 text-base font-bold">Thành viên</h3>
          {team.data ? (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {team.data.members.map((m) => {
                const self = m.id === team.data.me;
                const locked = m.role === 'owner' && role !== 'owner';
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 grow">
                      <div className="font-semibold">
                        {m.displayName}
                        {self ? <span className="ml-2 text-xs font-normal text-ink-3">(bạn)</span> : null}
                      </div>
                      <div className="truncate text-xs text-ink-3">{m.email}</div>
                    </div>
                    <select
                      aria-label={`Vai trò của ${m.displayName}`}
                      value={m.role}
                      disabled={locked || setRole.isPending}
                      onChange={(e) => setRole.mutate({ userId: m.id, role: e.target.value })}
                      className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm disabled:opacity-60"
                    >
                      {(['sale', 'manager', 'owner'] as Role[]).map((r) => (
                        <option key={r} value={r} disabled={r === 'owner' && role !== 'owner'}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    {confirmRemove === m.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs">Gỡ {m.displayName}?</span>
                        <button type="button" className="h-9 rounded-lg border-0 bg-p1 px-3 text-sm font-semibold text-white" disabled={remove.isPending} onClick={() => remove.mutate(m.id, { onSettled: () => setConfirmRemove(null) })}>
                          Gỡ
                        </button>
                        <button type="button" className={btn} onClick={() => setConfirmRemove(null)}>
                          Hủy
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={btn} disabled={locked} aria-label={`Gỡ ${m.displayName}`} onClick={() => setConfirmRemove(m.id)}>
                        Gỡ
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 text-sm text-ink-3">Đang tải…</p>
          )}
        </section>

        <section aria-label="Lời mời đang chờ" className="rounded-xl border border-line bg-white p-5">
          <h3 className="m-0 mb-3 text-base font-bold">Lời mời đang chờ</h3>
          {team.data && team.data.invites.length === 0 ? <p className="m-0 text-sm text-ink-3">Không có lời mời nào đang chờ.</p> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {team.data?.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="grow">
                  <span className="font-semibold">{ROLE_LABEL[i.role]}</span>
                  <span className="ml-2 text-ink-3">{i.email ?? 'Ai có liên kết cũng nhận được'}</span>
                  <span className="ml-2 text-xs text-ink-3">hết hạn {formatDateTime(i.expiresAt)}</span>
                </div>
                <button type="button" className={btn} disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                  Thu hồi
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Main>
  );
}
