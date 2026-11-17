'use client';

// Optional: bring back records on another device for people who earlier linked an email.
// Normal use needs no login — the app starts with an anonymous device session.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { isConfigured, supabase } from '@/lib/supabase';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useApp } from '@/components/Providers';

const COOLDOWN = 60;

/** Only same-site paths: "/x", never "//host" or "/\host". */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw.startsWith('/login')) return '/';
  return raw;
}

function authMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  const status = (err as { status?: number } | null)?.status;
  if (status === 429 || /security purposes|rate limit/i.test(msg)) return '요청이 많아요. 잠시 뒤 다시 시도해 주세요.';
  if (/signups? not allowed|not found|user/i.test(msg) && !/expired/i.test(msg)) return '이 이메일로 연결된 기록이 없어요. 이메일을 연결해 둔 기기에서 먼저 연결해 주세요.';
  if (/expired|invalid/i.test(msg)) return '코드가 맞지 않거나 만료됐어요. 새 코드를 받아 주세요.';
  return errorMessage(err);
}

function Restore() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { refreshMe } = useApp();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    setIsLocal(['localhost', '127.0.0.1'].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const redirectTo = () => `${window.location.origin}/login?next=${encodeURIComponent(next)}`;

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || left > 0) return;
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError('이메일 주소를 다시 확인해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase().auth.signInWithOtp({
        email: addr,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo() },
      });
      if (err) throw err;
      setStep('code');
      setCode('');
      setLeft(COOLDOWN);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      setError('메일로 받은 6자리 코드를 넣어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (err) throw err;
      await refreshMe();
      router.replace(next);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function kakao() {
    setError(null);
    const { error: err } = await supabase().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: redirectTo() } });
    if (err) setError(authMessage(err));
  }

  return (
    <div className="stack">
      <PageHeader title="내 기록 불러오기" back={next} />

      <Link href={next} className="card sage stack-sm" style={{ textDecoration: 'none' }}>
        <b>로그인 없이 바로 쓸 수 있어요 →</b>
        <span className="small muted">처음 신청하거나 글을 쓸 때 닉네임만 정하면 이 기기에서 바로 시작돼요.</span>
      </Link>

      <p className="muted small">
        예전에 이메일을 연결해 둔 사람만 쓰는 화면이에요. 다른 기기(브라우저)에서 쓰던 나눔·교환 기록을 이 기기로 불러와요.
      </p>

      {!isConfigured ? (
        <div className="notice warn">서버 연결 설정이 없어 불러올 수 없어요.</div>
      ) : step === 'email' ? (
        <form className="card stack" onSubmit={sendCode} noValidate>
          <div className="field">
            <label htmlFor="email">연결해 둔 이메일</label>
            <input
              id="email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <ErrorBox error={error} />
          <button className="btn block" disabled={busy}>
            {busy ? '보내는 중…' : '6자리 코드 받기'}
          </button>
        </form>
      ) : (
        <form className="card stack" onSubmit={verify} noValidate>
          <p className="small">
            <b>{email.trim()}</b>(으)로 코드를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.
          </p>
          <div className="field">
            <label htmlFor="code">6자리 코드</label>
            <input
              id="code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              style={{ letterSpacing: '0.3em', fontSize: '1.2rem' }}
            />
          </div>
          <ErrorBox error={error} />
          <button className="btn block" disabled={busy}>
            {busy ? '확인 중…' : '기록 불러오기'}
          </button>
          <div className="row-between">
            <button type="button" className="btn ghost small" onClick={() => { setStep('email'); setError(null); }}>
              이메일 바꾸기
            </button>
            <button type="button" className="btn ghost small" onClick={() => void sendCode()} disabled={busy || left > 0}>
              {left > 0 ? `다시 보내기 (${left}초)` : '코드 다시 보내기'}
            </button>
          </div>
        </form>
      )}

      {isConfigured && process.env.NEXT_PUBLIC_ENABLE_KAKAO === '1' && (
        <button type="button" className="btn butter block" onClick={() => void kakao()}>
          카카오로 불러오기
        </button>
      )}

      {isLocal && (
        <p className="notice small">
          로컬 개발 환경: 메일은 <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">Mailpit (127.0.0.1:54324)</a>에서 볼 수 있어요.
        </p>
      )}
      <p className="faint">
        불러오면 지금 기기의 익명 기록 대신 연결된 기록으로 바뀌어요. <Link href="/help#about">도움말</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Restore />
    </Suspense>
  );
}
