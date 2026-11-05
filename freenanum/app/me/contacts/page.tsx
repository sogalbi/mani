'use client';

import Link from 'next/link';
import { rpc } from '@/lib/api';
import { fmtDate, TRADE_STATUS_LABEL } from '@/lib/format';
import type { SavedContact } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { Badge, Empty, ErrorBox, Loading, MemberOnly, PageHeader, useAction, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { threadsUrl } from '@/components/trades/util';

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="거래 상대" back="/me" />
      <p className="faint">
        거래에서 &quot;상대 스레드 아이디 확인했어요&quot;를 누르면 상대 닉네임과 스레드 아이디가 여기에 자동으로 저장돼요. 나만 볼 수 있고, 바코드 번호는 저장하지 않아요.
      </p>
      <MemberOnly message="거래에서 확인한 상대가 여기에 저장돼요.">
        <Contacts />
      </MemberOnly>
    </>
  );
}

function Contacts() {
  const { toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => rpc<SavedContact[]>('my_contacts'), []);
  const del = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) {
    return (
      <Empty action={<Link className="btn secondary small" href="/trades">거래 보러 가기</Link>}>
        아직 저장된 거래 상대가 없어요.
      </Empty>
    );
  }

  return (
    <ul className="list">
      {data.map((c) => (
        <li key={c.contact_id} className="card stack-sm">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Avatar level={c.badge.level.level} size={48} label={`${c.nickname} 캐릭터`} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <b>{c.nickname}</b>
                {c.blocked && <Badge tone="gray">차단</Badge>}
                {c.badge.threads?.verified && <Badge tone="green">계정 소유 확인</Badge>}
              </div>
              <span className="faint">
                {c.badge.level.name} · 완료 거래 {c.badge.completed_trades}건 · 미이행 기록 {c.badge.unfulfilled}건
              </span>
            </div>
          </div>

          {c.threads_handle ? (
            <a className="btn secondary small" href={threadsUrl(c.threads_handle)} target="_blank" rel="noopener noreferrer">
              스레드 @{c.threads_handle} 열기 ↗
            </a>
          ) : (
            <span className="faint">스레드 아이디 없음</span>
          )}

          <dl className="kv">
            <dt>처음 확인</dt>
            <dd>{fmtDate(c.first_confirmed_at)}</dd>
            <dt>함께한 거래</dt>
            <dd>{c.trades_together}건</dd>
            {c.last_trade && (
              <>
                <dt>최근 거래</dt>
                <dd>
                  <Link href={`/trades/${c.last_trade.id}`}>
                    TR-{String(c.last_trade.trade_no).padStart(6, '0')} · {TRADE_STATUS_LABEL[c.last_trade.status]}
                    {c.last_trade.post_title ? ` · ${c.last_trade.post_title}` : ''} ›
                  </Link>
                </dd>
              </>
            )}
          </dl>

          <button
            className="btn ghost small"
            style={{ alignSelf: 'flex-end' }}
            disabled={del.busy}
            onClick={() =>
              del.run(async () => {
                if (!window.confirm(`${c.nickname}님을 거래 상대 목록에서 지울까요? 거래 기록은 그대로 남아요.`)) return;
                await rpc('delete_contact', { p_contact_id: c.contact_id });
                toast('목록에서 지웠어요');
                await reload();
              })
            }
          >
            목록에서 지우기
          </button>
        </li>
      ))}
      <ErrorBox error={del.error} />
    </ul>
  );
}
