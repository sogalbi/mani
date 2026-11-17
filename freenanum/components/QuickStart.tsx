'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const ADJ = ['포근한', '반짝', '다정한', '느긋한', '상냥한', '말랑', '보송', '따뜻한', '수줍은', '씩씩한'];
const ANIMAL = ['곰', '토끼', '다람쥐', '고양이', '수달', '펭귄', '여우', '부엉이', '고슴도치', '햄스터'];

function randomNickname(): string {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}${pick(ANIMAL)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 12);
}

/**
 * No sign-up: creates an anonymous session for this device (if needed) and a nickname.
 * Records stay tied to this browser.
 */
export default function QuickStart({ hasSession, onDone, onCancel }: { hasSession: boolean; onDone: () => void; onCancel: () => void }) {
  const [nickname, setNickname] = useState(randomNickname);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const valid = /^[가-힣A-Za-z0-9_.]{2,12}$/.test(nickname.trim());

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !agree || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!hasSession) {
        const { error: authError } = await supabase().auth.signInAnonymously();
        if (authError) throw new Error('QUICK_START_UNAVAILABLE');
      }
      await rpc('register_profile', { p_nickname: nickname.trim(), p_agree_terms: true, p_agree_privacy: true });
      onDone();
    } catch (err) {
      if (err instanceof Error && err.message === 'QUICK_START_UNAVAILABLE') {
        setError('지금은 바로 시작할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
      } else {
        setError(errorMessage(err));
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label="바로 시작하기" onClick={(e) => e.stopPropagation()} onSubmit={start}>
        <div className="row-between">
          <h2>바로 시작하기</h2>
          <button type="button" className="btn ghost small" onClick={onCancel}>
            닫기
          </button>
        </div>
        <p className="muted small">가입 없이 이 기기에서 바로 써요. 닉네임만 정해 주세요.</p>
        <div className="field">
          <label htmlFor="qs-nick">닉네임</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              id="qs-nick"
              ref={inputRef}
              className="input"
              value={nickname}
              maxLength={12}
              autoComplete="nickname"
              onChange={(e) => setNickname(e.target.value)}
              aria-invalid={!valid}
            />
            <button type="button" className="btn secondary small" onClick={() => setNickname(randomNickname())} aria-label="다른 닉네임 추천">
              🎲
            </button>
          </div>
          <span className="hint">2~12자, 한글·영문·숫자·_ . · 스레드 아이디를 닉네임으로 써도 좋아요.</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span className="small">
            <Link href="/help#terms" target="_blank">이용 안내</Link>와 <Link href="/help#privacy" target="_blank">개인정보 처리 안내</Link>를 확인했어요 (필수)
          </span>
        </label>
        <p className="notice tiny">
          기록은 이 기기(브라우저)에 묶여 있어요. 브라우저 데이터를 지우면 다시 찾기 어려워요. 프리나눔은 스타벅스 공식 서비스가 아니에요.
        </p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <button className="btn block" type="submit" disabled={!valid || !agree || busy}>
          {busy ? '준비 중…' : '시작하기'}
        </button>
      </form>
    </div>
  );
}
