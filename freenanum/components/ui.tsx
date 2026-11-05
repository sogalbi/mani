'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  fmtRemaining, POST_STATUS_LABEL, postTone, TRADE_STATUS_LABEL, tradeTone, type Tone,
} from '@/lib/format';
import type { PostStatus, StickerCode, TradeStatus } from '@/lib/types';
import { Icon } from './Icon';
import { useApp } from './Providers';

export function Badge({ tone = 'neutral', children }: { tone?: Tone | 'terra'; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function PostStatusBadge({ status }: { status: PostStatus }) {
  return <Badge tone={postTone(status)}>{POST_STATUS_LABEL[status] ?? status}</Badge>;
}

export function TradeStatusBadge({ status }: { status: TradeStatus }) {
  return <Badge tone={tradeTone(status)}>{TRADE_STATUS_LABEL[status] ?? status}</Badge>;
}

export function Sticker({ code, name, quantity }: { code: StickerCode; name: string; quantity?: number }) {
  return (
    <span className={`sticker ${code}`}>
      <span className="gem" aria-hidden>{code === 'MISSION' ? '★' : '●'}</span>
      {name}
      {quantity !== undefined && <span>{quantity}장</span>}
    </span>
  );
}

export function Loading({ lines = 2 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box row-between" role="alert">
      <span>{typeof error === 'string' ? error : errorMessage(error)}</span>
      {onRetry && (
        <button className="btn ghost small" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span aria-hidden style={{ fontSize: '2rem' }}>🌿</span>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function PageHeader({ title, back, right }: { title: string; back?: string | true; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="row-between">
      <div className="row" style={{ gap: 4, minWidth: 0 }}>
        {back && (
          <button
            className="icon-btn"
            aria-label="뒤로"
            onClick={() => (back === true ? (history.length > 1 ? router.back() : router.push('/')) : router.push(back))}
          >
            <Icon name="back" />
          </button>
        )}
        <h1 style={{ minWidth: 0 }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** Live "N시간 남음" text. */
export function Countdown({ to, prefix }: { to: string | null | undefined; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!to) return null;
  return (
    <span>
      {prefix}
      {fmtRemaining(to, now)}
    </span>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="줄이기" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="늘리기" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        +
      </button>
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="small">{children}</span>
    </label>
  );
}

/** Shown where an action needs a login. Returns to the current page afterwards. */
export function LoginRequired({ message = '로그인하면 이용할 수 있어요.' }: { message?: string }) {
  const pathname = usePathname() ?? '/';
  const next = typeof window !== 'undefined' ? pathname + window.location.search : pathname;
  return (
    <div className="card butter stack" style={{ alignItems: 'flex-start' }}>
      <p>{message}</p>
      <Link className="btn" href={`/login?next=${encodeURIComponent(next)}`}>
        로그인 / 시작하기
      </Link>
    </div>
  );
}

/** Wraps a page that needs a member with a nickname. */
export function MemberOnly({ children, message }: { children: React.ReactNode; message?: string }) {
  const { ready, session, me } = useApp();
  if (!ready) return <Loading />;
  if (!session) return <LoginRequired message={message} />;
  if (!me) return <Loading />;
  if (me.needs_profile) return <LoginRequired message="닉네임을 정하면 바로 시작할 수 있어요." />;
  return <>{children}</>;
}

/** Small data loader with reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await run();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Runs an action, shows errors, prevents double taps. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return { busy, error, setError, run };
}

export async function shareOrCopy(url: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ url, text, title: '프리나눔' });
      return 'shared';
    }
  } catch {
    // user closed the share sheet → fall back to copy
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
