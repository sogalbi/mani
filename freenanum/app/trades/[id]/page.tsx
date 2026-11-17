'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { rpc } from '@/lib/api';
import { fmtDateTime, KIND_LABEL } from '@/lib/format';
import type { TradeDetail } from '@/lib/types';
import { Badge, Countdown, ErrorBox, Loading, MemberOnly, PageHeader, Sticker, TradeStatusBadge, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';
import ActionPanel from '@/components/trades/ActionPanel';
import Participants from '@/components/trades/Participants';
import Timeline from '@/components/trades/Timeline';
import { isOpen, STAGES, stagesDone, tradeNo } from '@/components/trades/util';
import s from '@/components/trades/trades.module.css';

export default function TradePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <MemberOnly message="거래 내용은 이 거래의 참여자만 볼 수 있어요.">
      <TradeView id={id} />
    </MemberOnly>
  );
}

function TradeView({ id }: { id: string }) {
  const { refreshMe } = useApp();
  const { data: t, error, loading, reload } = useLoad(() => rpc<TradeDetail>('get_trade', { p_trade_id: id }), [id]);

  if (loading && !t) return <Loading lines={3} />;
  if (!t)
    return (
      <>
        <PageHeader title="거래" back="/trades" />
        <ErrorBox error={error} onRetry={reload} />
      </>
    );

  const done = stagesDone(t);
  const open = isOpen(t.status);
  const refresh = async () => {
    await reload();
    void refreshMe();
  };

  return (
    <>
      <PageHeader title={`거래 ${tradeNo(t.trade_no)}`} back="/trades" />
      <ErrorBox error={error} onRetry={reload} />

      <section className="card stack" aria-label="거래 요약">
        <div className="row-between">
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={t.kind === 'swap' ? 'yellow' : 'green'}>{t.kind === 'swap' ? '교환' : '무료 나눔'}</Badge>
            <TradeStatusBadge status={t.status} />
          </div>
          <span className="faint">{fmtDateTime(t.created_at)}</span>
        </div>
        {t.post && (
          <Link href={`/posts/${t.post.code}`} className="small">
            {KIND_LABEL[t.post.kind]} 글: {t.post.title} ›
          </Link>
        )}
        <div className="stack-sm" aria-label={`진행 단계 ${done}/5`}>
          <div className="steps">
            {STAGES.map((st, i) => (
              <span key={st} className={i < done ? 'done' : i === done && open ? 'now' : ''} />
            ))}
          </div>
          <div className={s.stepLabels}>
            {STAGES.map((st, i) => (
              <span key={st} className={i === done && open ? s.on : undefined}>
                {st}
              </span>
            ))}
          </div>
        </div>
        {open && t.stage_deadline_at && (
          <p className="small">
            이 단계 기한: <b>{fmtDateTime(t.stage_deadline_at)}</b>{' '}
            <span className={t.deadline_passed ? '' : 'faint'}>
              (<Countdown to={t.stage_deadline_at} />)
            </span>
          </p>
        )}
        <ul className="list" aria-label="주고받는 스티커">
          {t.items.map((i) => (
            <li key={i.seq} className={s.flowItem}>
              <b>{i.sender}</b> → <b>{i.receiver}</b>
              <Sticker code={i.code} name={i.name} quantity={i.quantity} />
            </li>
          ))}
        </ul>
      </section>

      <ActionPanel t={t} onChanged={refresh} />
      <Participants t={t} />
      <Timeline t={t} />

      <p className="notice">
        프리나눔은 공식 앱의 실제 전송 여부를 확인하지 않아요. 기록은 참여자의 신고·확인을 바탕으로 해요. 실제 선물은 스타벅스 공식 앱에서 직접 진행해요.
      </p>
    </>
  );
}
