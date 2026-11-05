'use client';

import { useEffect, useState } from 'react';
import { rpc, toApiError } from '@/lib/api';
import { ErrorBox, useAction } from '@/components/ui';
import { Icon } from '@/components/Icon';
import s from './trades.module.css';

const SHOW_SECONDS = 60;

type Reveal = { ok: true; barcode: string; owner_nickname: string; views_left: number } | { ok: false; error: string };

/** Shows the receiver's barcode to the sender. The number lives only in this component's memory. */
export default function BarcodeReveal({
  tradeId, ownerId, ownerNickname, limit, onRevealed,
}: { tradeId: string; ownerId: string | null; ownerNickname: string; limit: number; onRevealed: () => void }) {
  const [shown, setShown] = useState<{ barcode: string; viewsLeft: number } | null>(null);
  const [left, setLeft] = useState(SHOW_SECONDS);
  const [copied, setCopied] = useState(false);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (!shown) return;
    setLeft(SHOW_SECONDS);
    const id = setInterval(() => setLeft((v) => v - 1), 1000);
    const hide = () => document.visibilityState === 'hidden' && setShown(null);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [shown]);

  useEffect(() => {
    if (shown && left <= 0) setShown(null);
  }, [left, shown]);

  const open = () =>
    run(async () => {
      const r = await rpc<Reveal>('reveal_barcode', { p_trade_id: tradeId, p_owner_id: ownerId });
      if (!r.ok) {
        setError(toApiError(r.error));
        onRevealed();
        return;
      }
      setCopied(false);
      setShown({ barcode: r.barcode, viewsLeft: r.views_left });
      onRevealed();
    });

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.barcode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const grouped = shown?.barcode.replace(/(\d{4})(?=\d)/g, '$1 ');

  return (
    <div className="stack-sm">
      {shown ? (
        <>
          <p className="small">
            <b>{ownerNickname}</b>님의 프리퀀시 바코드 번호예요. 공식 앱의 선물하기 화면에 입력해 주세요.
          </p>
          <div className={s.barcode} aria-label="바코드 번호">
            {grouped}
          </div>
          <div className="row">
            <button className="btn secondary small" type="button" onClick={copy}>
              <Icon name="copy" size={18} /> {copied ? '복사했어요' : '번호 복사'}
            </button>
            <button className="btn ghost small" type="button" onClick={() => setShown(null)}>
              지금 숨기기
            </button>
            <span className="faint">{left}초 뒤 자동으로 숨겨요</span>
          </div>
          <p className="notice warn">
            이 번호는 이 거래의 선물에만 쓰고, 다른 곳에 저장하거나 공유하지 마세요. 남은 열람 {shown.viewsLeft}회.
          </p>
        </>
      ) : (
        <>
          <button className="btn block" type="button" onClick={() => void open()} disabled={busy}>
            <Icon name="lock" size={18} /> {busy ? '여는 중…' : `${ownerNickname}님 바코드 보기`}
          </button>
          <p className="faint">
            열람은 최대 {limit}회까지 가능하고, 열람할 때마다 받는 분에게 횟수가 기록돼요.
          </p>
        </>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
