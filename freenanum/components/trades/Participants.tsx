import { ROLE_LABEL } from '@/lib/format';
import type { TradeDetail } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/ui';
import { infoDone, peers, threadsUrl, type Peer } from './util';
import s from './trades.module.css';

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`${s.flag} ${on ? s.flagOn : ''}`}>{on ? '✓ ' : ''}{children}</span>;
}

function Person({ p }: { p: Peer }) {
  const b = p.badge;
  return (
    <li className={s.person}>
      <Avatar level={b?.level?.level ?? 1} size={44} label={`${p.nickname} 캐릭터`} />
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <b>{p.nickname}</b>
          {p.is_me && <Badge tone="neutral">나</Badge>}
          <span className="faint">{ROLE_LABEL[p.role]}</span>
          {b?.threads?.verified && <Badge tone="green">스레드 계정 소유 확인</Badge>}
        </div>
        {p.threads_handle && (
          <a className="small" href={threadsUrl(p.threads_handle)} target="_blank" rel="noopener noreferrer">
            스레드 @{p.threads_handle} ↗
          </a>
        )}
        <p className="faint">
          {b?.level?.name} · 완료 거래 {b?.completed_trades ?? 0}건 · 미이행 기록 {b?.unfulfilled ?? 0}건
          {b?.restricted ? ' · 이용 제한 중' : ''}
        </p>
        <div className={s.flags}>
          <Flag on={infoDone(p)}>정보 입력</Flag>
          <Flag on={Boolean(p.peer_confirmed_at)}>서로 확인</Flag>
          {p.sends && <Flag on={Boolean(p.barcode_opened_at)}>바코드 열람</Flag>}
          {p.sends && <Flag on={Boolean(p.sent_declared_at)}>보냄 신고</Flag>}
          {p.receives && <Flag on={Boolean(p.receipt_confirmed_at)}>수령 확인</Flag>}
        </div>
      </div>
    </li>
  );
}

export default function Participants({ t }: { t: TradeDetail }) {
  return (
    <section className="card stack" aria-labelledby="who">
      <h2 id="who">참여자</h2>
      <ul className="list">
        {peers(t).map((p) => (
          <Person key={p.user_id} p={p} />
        ))}
      </ul>
      <p className="faint">
        스레드 아이디는 참여자가 직접 입력한 값이에요. &quot;계정 소유 확인&quot; 표시도 그 계정을 가진 사람이라는 뜻일 뿐, 실명이나 거래 안전을 인증하지 않아요.
      </p>
    </section>
  );
}
