import Link from 'next/link';
import { fmtDate } from '@/lib/format';
import type { TradeListItem } from '@/lib/types';
import { Badge, Countdown, Sticker, TradeStatusBadge } from '@/components/ui';
import { isOpen, tradeKindLabel, tradeNo } from './util';
import s from './trades.module.css';

export default function TradeRow({ t }: { t: TradeListItem }) {
  const give = (t.items ?? []).filter((i) => i.direction === 'give');
  const get = (t.items ?? []).filter((i) => i.direction === 'get');
  return (
    <Link href={`/trades/${t.id}`} className={`card stack-sm ${t.needs_action ? s.action : ''}`} style={{ padding: 14 }}>
      <div className="row-between">
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={t.kind === 'swap' ? 'yellow' : t.my_role === 'giver' ? 'green' : 'terra'}>{tradeKindLabel(t)}</Badge>
          <TradeStatusBadge status={t.status} />
        </div>
        {t.needs_action ? (
          <Badge tone="yellow">내가 할 일</Badge>
        ) : (
          isOpen(t.status) && t.stage_deadline_at && <span className="faint"><Countdown to={t.stage_deadline_at} /></span>
        )}
      </div>
      <h3 style={{ fontSize: '1rem' }}>{t.post?.title ?? `거래 ${tradeNo(t.trade_no)}`}</h3>
      <div className={s.items}>
        {give.length > 0 && <span className={s.dir}>보냄</span>}
        {give.map((i, k) => (
          <Sticker key={`g${k}`} code={i.code} name={i.name} quantity={i.quantity} />
        ))}
        {get.length > 0 && <span className={s.dir}>받음</span>}
        {get.map((i, k) => (
          <Sticker key={`r${k}`} code={i.code} name={i.name} quantity={i.quantity} />
        ))}
      </div>
      <div className="row-between faint">
        <span>상대 {t.counterpart ?? '-'}</span>
        <span>
          {tradeNo(t.trade_no)} · {fmtDate(t.completed_at ?? t.created_at)}
        </span>
      </div>
    </Link>
  );
}
