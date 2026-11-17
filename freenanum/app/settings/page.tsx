'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';
import type { Me } from '@/lib/types';
import { Badge, ErrorBox, MemberOnly, PageHeader, useAction, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="설정" back="/me" />
      <MemberOnly>
        <Settings />
      </MemberOnly>
    </>
  );
}

function Settings() {
  const { me, signOut, session } = useApp();
  const router = useRouter();
  if (!me) return null;
  const deviceOnly = session?.user?.is_anonymous ?? true;
  return (
    <>
      <NicknameForm me={me} />
      <ThreadsLink me={me} />
      <Blocks />
      <LinkEmail />
      <section className="card stack-sm">
        <h2>안내</h2>
        <Link href="/help">이용약관 · 개인정보 처리 안내 · 신고 운영 정책 ›</Link>
        <p className="faint">가입일 {fmtDate(me.created_at)}</p>
      </section>
      {deviceOnly && (
        <p className="notice tiny">
          가입 없이 시작한 기록은 이 기기(브라우저)에만 연결돼 있어요. 나가거나 브라우저 데이터를 지우면 다시 찾을 수 없어요.
        </p>
      )}
      <button
        className="btn danger block"
        onClick={async () => {
          const msg = deviceOnly
            ? '이 기기에서 나가면 지금까지의 나눔·교환 기록과 진행 중인 거래를 다시 찾을 수 없어요. 정말 나갈까요?'
            : '로그아웃할까요?';
          if (!window.confirm(msg)) return;
          await signOut();
          router.push('/');
        }}
      >
        {deviceOnly ? '이 기기에서 나가기' : '로그아웃'}
      </button>
    </>
  );
}

function NicknameForm({ me }: { me: Me }) {
  const { refreshMe, toast } = useApp();
  const [value, setValue] = useState(me.nickname ?? '');
  const { busy, error, run } = useAction();
  const changed = value.trim() !== me.nickname;
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await rpc('update_nickname', { p_nickname: value.trim() });
          await refreshMe();
          toast('닉네임을 바꿨어요');
        });
      }}
    >
      <h2>닉네임</h2>
      <div className="field">
        <label htmlFor="nick">공개 닉네임</label>
        <input id="nick" className="input" value={value} maxLength={12} onChange={(e) => setValue(e.target.value)} autoComplete="nickname" />
        <span className="hint">2~12자, 한글·영문·숫자·_ . 만 쓸 수 있어요. 지난 거래 기록에도 새 닉네임으로 보여요.</span>
      </div>
      <ErrorBox error={error} />
      <button className="btn" type="submit" disabled={!changed || busy}>
        {busy ? '저장 중…' : '저장'}
      </button>
    </form>
  );
}

const THREADS_STATUS = {
  unverified: { label: '미인증', tone: 'neutral' },
  pending: { label: '확인 대기', tone: 'yellow' },
  verified: { label: '계정 소유 확인', tone: 'green' },
  rejected: { label: '반려', tone: 'red' },
} as const;

function ThreadsLink({ me }: { me: Me }) {
  const { refreshMe, toast } = useApp();
  const th = me.threads ?? null;
  const [handle, setHandle] = useState(th?.handle ?? '');
  const save = useAction();
  const verify = useAction();
  const st = th ? THREADS_STATUS[th.status] : null;

  return (
    <section className="card stack" aria-labelledby="threads-h">
      <div className="row-between">
        <h2 id="threads-h">스레드(Threads) 연결</h2>
        {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge tone="gray">미등록</Badge>}
      </div>
      <p className="small muted">
        여기 저장해 두면 거래할 때 스레드 아이디가 미리 채워져요. 운영자 &quot;소유 확인&quot;은 선택 사항이에요.
      </p>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(async () => {
            await rpc('set_threads_handle', { p_handle: handle.trim() });
            await refreshMe();
            toast(handle.trim() ? '스레드 아이디를 저장했어요' : '스레드 연결을 해제했어요');
          });
        }}
      >
        <div className="field">
          <label htmlFor="threads">스레드 아이디</label>
          <input
            id="threads"
            className="input"
            value={handle}
            maxLength={31}
            placeholder="@아이디"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value)}
          />
          <span className="hint">비워서 저장하면 연결이 해제돼요. 아이디를 바꾸면 확인을 다시 받아야 해요.</span>
        </div>
        <ErrorBox error={save.error} />
        <button className="btn secondary" type="submit" disabled={save.busy || handle.trim().replace(/^@/, '') === (th?.handle ?? '')}>
          저장
        </button>
      </form>

      {th && th.status !== 'verified' && (
        <div className="stack-sm">
          {th.status === 'pending' && th.verify_code ? (
            <div className="card butter stack-sm">
              <p className="small">
                스레드 프로필 소개에 아래 코드를 잠시 넣어 두면, 운영자가 공개 프로필에서 확인해요. 확인이 끝나면 지워도 돼요.
              </p>
              <p className="mono" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                {th.verify_code}
              </p>
              <p className="faint">비공개 계정은 확인이 어려울 수 있어요.</p>
            </div>
          ) : (
            <p className="small">
              스레드 프로필 소개에 인증코드를 잠시 넣어 두면 운영자가 공개 프로필에서 확인해요.
              {th.status === 'rejected' && ' 이전 요청이 반려됐어요. 코드가 보이는지 확인하고 다시 요청해 주세요.'}
            </p>
          )}
          <ErrorBox error={verify.error} />
          <button
            className="btn"
            onClick={() =>
              verify.run(async () => {
                await rpc<{ verify_code: string }>('request_threads_verification');
                await refreshMe();
              })
            }
            disabled={verify.busy}
          >
            {th.status === 'pending' ? '새 코드로 다시 요청' : '소유 확인 요청'}
          </button>
        </div>
      )}
      <p className="faint">
        &quot;계정 소유 확인&quot;은 그 스레드 계정을 가진 사람이라는 뜻일 뿐, 실명이나 거래 안전을 인증하지 않아요.
      </p>
    </section>
  );
}

function Blocks() {
  const { data, error, reload } = useLoad(() => rpc<{ nickname: string; created_at: string }[]>('my_blocks'), []);
  const [name, setName] = useState('');
  const { busy, error: actionError, run } = useAction();
  const { toast } = useApp();

  const setBlock = (nickname: string, block: boolean) =>
    run(async () => {
      await rpc('set_block', { p_nickname: nickname, p_block: block });
      if (block) setName('');
      toast(block ? `${nickname}님을 차단했어요` : `${nickname}님 차단을 풀었어요`);
      await reload();
    });

  return (
    <section className="card stack" aria-labelledby="block-h">
      <h2 id="block-h">차단</h2>
      <p className="small muted">차단한 사이에서는 서로의 글이 목록에 보이지 않고, 나눔 참여·제안·교환을 할 수 없어요.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void setBlock(name.trim(), true);
        }}
      >
        <label htmlFor="block-name" className="sr-only">
          차단할 닉네임
        </label>
        <input id="block-name" className="input grow" placeholder="닉네임" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn secondary" type="submit" disabled={busy || !name.trim()}>
          차단
        </button>
      </form>
      <ErrorBox error={error ?? actionError} />
      {data && data.length > 0 ? (
        <ul className="list">
          {data.map((b) => (
            <li key={b.nickname} className="row-between">
              <span>
                {b.nickname} <span className="faint">· {fmtDate(b.created_at)}</span>
              </span>
              <button className="btn ghost small" onClick={() => void setBlock(b.nickname, false)} disabled={busy}>
                차단 해제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        data && <p className="faint">차단한 사용자가 없어요.</p>
      )}
    </section>
  );
}

/** Optional: attach an e-mail to this device-only account so records can be restored elsewhere. */
function LinkEmail() {
  const { session, toast } = useApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = session?.user?.email;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase().auth.updateUser({ email: email.trim() });
    setBusy(false);
    if (err) setError(/registered|exists/i.test(err.message) ? '이미 다른 기록에 연결된 이메일이에요.' : '코드를 보내지 못했어요. 이메일 주소를 확인해 주세요.');
    else if (data.user?.email === email.trim()) toast('이메일을 연결했어요'); // projects without e-mail confirmation
    else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email_change' });
    setBusy(false);
    if (err) setError('코드가 맞지 않거나 만료됐어요.');
    else {
      toast('이메일을 연결했어요');
      setSent(false);
    }
  }

  return (
    <section className="card stack-sm">
      <h2>다른 기기에서도 쓰기 (선택)</h2>
      {linked ? (
        <p className="small">
          연결된 이메일: <b>{linked}</b> · 다른 기기에서는 <Link href="/login">내 기록 불러오기</Link>로 이어서 쓸 수 있어요.
        </p>
      ) : !sent ? (
        <form className="stack-sm" onSubmit={send}>
          <p className="faint">
            지금 기록은 이 기기에만 있어요. 이메일을 연결해 두면 폰을 바꾸거나 브라우저 데이터를 지워도 기록을 불러올 수 있어요. 안 해도 모든 기능을 쓸 수 있어요.
          </p>
          <label className="label" htmlFor="link-email">이메일</label>
          <input id="link-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn secondary" disabled={busy || !email.includes('@')}>{busy ? '보내는 중…' : '연결 코드 받기'}</button>
        </form>
      ) : (
        <form className="stack-sm" onSubmit={verify}>
          <label className="label" htmlFor="link-code">메일로 받은 6자리 코드</label>
          <input id="link-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          <button className="btn" disabled={busy || code.length !== 6}>{busy ? '확인 중…' : '연결하기'}</button>
        </form>
      )}
      {error && <div className="error-box" role="alert">{error}</div>}
    </section>
  );
}
