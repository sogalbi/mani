'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtAgo, TRADE_STATUS_LABEL } from '@/lib/format';
import type { PostDetail, PostItem } from '@/lib/types';
import { Check, ErrorBox, LoginRequired, Sticker, Stepper, TradeStatusBadge, useAction } from '@/components/ui';
import { useApp } from '@/components/Providers';

const SWAP_RISK =
  '전송한 e-스티커는 회수하기 어려우며, 상대방이 약속한 스티커를 보내지 않거나 응답하지 않을 위험이 있습니다. 거래 조건을 확인하고 신중하게 진행해 주세요. 프리나눔의 기록·신고 기능이 스티커의 회수나 반환을 보장하지는 않습니다.';

function useMember() {
  const { session, me } = useApp();
  return { session, me, member: Boolean(session && me && !me.needs_profile) };
}

function Gate({ children, message }: { children: React.ReactNode; message: string }) {
  const { session, me, member } = useMember();
  if (!session) return <LoginRequired message={message} />;
  if (me?.needs_profile) return <LoginRequired message="닉네임을 정하면 바로 참여할 수 있어요." />;
  if (!member) return null;
  return <>{children}</>;
}

function TradeList({ post, title, empty }: { post: PostDetail; title: string; empty: string }) {
  const trades = post.trades ?? [];
  return (
    <section className="card stack" aria-label={title}>
      <h2>{title}</h2>
      {trades.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="list">
          {trades.map((t) => (
            <li key={t.id}>
              <Link href={`/trades/${t.id}`} className="row-between card flat" style={{ padding: '10px 12px' }}>
                <span className="row" style={{ gap: 8 }}>
                  <strong>{t.counterpart}</strong>
                  {t.created_at && <span className="faint">{fmtAgo(t.created_at)}</span>}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <TradeStatusBadge status={t.status} />
                  <span aria-hidden>›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyTradeLink({ post, label }: { post: PostDetail; label: string }) {
  if (!post.my_trade) return null;
  return (
    <Link href={`/trades/${post.my_trade.id}`} className="card sage row-between">
      <span>
        <strong>{label}</strong>
        <span className="small muted"> · {TRADE_STATUS_LABEL[post.my_trade.status]}</span>
      </span>
      <span aria-hidden>›</span>
    </Link>
  );
}

function CloseButton({ post, reload, label }: { post: PostDetail; reload: () => void; label: string }) {
  const { toast } = useApp();
  const { busy, error, run } = useAction();
  if (post.status !== 'open') return null;
  return (
    <div className="stack-sm">
      <ErrorBox error={error} />
      <button
        className="btn secondary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            if (!window.confirm('마감하면 아직 수락하지 않은 제안은 자동으로 취소돼요. 마감할까요?')) return;
            await rpc('close_my_post', { p_post_id: post.id, p_hide: false });
            toast('마감했어요');
            reload();
          })
        }
      >
        {label}
      </button>
    </div>
  );
}

/** 나눔 요청(SOS): anyone can offer to give; the requester accepts in the trade screen. */
export function RequestPanel({ post, reload }: { post: PostDetail; reload: () => void }) {
  const router = useRouter();
  const want = post.items.find((i) => i.direction === 'want');
  const [qty, setQty] = useState(1);
  const { busy, error, run } = useAction();
  if (!want) return null;

  if (post.is_author) {
    return (
      <>
        <TradeList post={post} title="받은 나눔 제안" empty="아직 제안이 없어요. 링크를 공유해 보세요." />
        <CloseButton post={post} reload={reload} label="필요한 만큼 받았어요 · 요청 마감" />
      </>
    );
  }

  const offer = () =>
    run(async () => {
      const r = await rpc<{ trade_id: string }>('offer_to_request', { p_post_id: post.id, p_quantity: qty });
      router.push(`/trades/${r.trade_id}`);
    });

  return (
    <>
      <MyTradeLink post={post} label="내 나눔 제안 보기" />
      {!post.my_trade && post.status === 'open' && !post.blocked && (
        <Gate message="바로 시작하기로 닉네임만 정하면 이 분께 나눔을 제안할 수 있어요.">
          <section className="card stack" aria-labelledby="offer-title">
            <h2 id="offer-title">이 분께 나눠 주기</h2>
            <div className="row-between">
              <Sticker code={want.code} name={want.name} />
              <Stepper label="나눠 줄 장수" value={qty} min={1} max={want.quantity} onChange={setQty} />
            </div>
            <div className="notice">
              제안하면 거래 화면이 열려요. 거래 화면에서 스레드 아이디를 입력하고, 요청자가 수락하며 바코드를 입력하면 진행돼요. 스티커는 스타벅스 공식 앱에서 직접 선물하고, 보낸 뒤
              &ldquo;보냈어요&rdquo;를 눌러 주세요. 선물한 스티커는 회수하기 어려워요.
            </div>
            <ErrorBox error={error} />
            <button className="btn block" disabled={busy} onClick={offer}>
              {busy ? '보내는 중…' : `${qty}장 나눔 제안하기`}
            </button>
          </section>
        </Gate>
      )}
      {post.blocked && <div className="notice">차단 관계라 참여할 수 없어요.</div>}
    </>
  );
}

function Items({ items }: { items: PostItem[] }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {items.map((i) => (
        <Sticker key={i.code} code={i.code} name={i.name} quantity={i.quantity} />
      ))}
    </div>
  );
}

/** 교환: the viewer accepts the post's terms as a proposal; the author accepts in the trade screen. */
export function SwapPanel({ post, reload }: { post: PostDetail; reload: () => void }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const { busy, error, run } = useAction();
  const offer = post.items.filter((i) => i.direction === 'offer');
  const want = post.items.filter((i) => i.direction === 'want');
  const give = post.is_author ? offer : want;
  const get = post.is_author ? want : offer;

  const propose = () =>
    run(async () => {
      const r = await rpc<{ trade_id: string }>('propose_swap', { p_post_id: post.id, p_risk_ack: ack });
      router.push(`/trades/${r.trade_id}`);
    });

  return (
    <>
      <section className="card stack" aria-label="교환 조건">
        <div className="stack-sm">
          <span className="label">내가 주는 것</span>
          <Items items={give} />
        </div>
        <div className="stack-sm">
          <span className="label">내가 받는 것</span>
          <Items items={get} />
        </div>
        {!post.is_author && (post.active_trades_count ?? 0) > 0 && (
          <p className="faint">지금 진행 중인 제안이 {post.active_trades_count}건 있어요. 게시자가 한 명만 수락할 수 있어요.</p>
        )}
      </section>
      {post.is_author ? (
        <>
          <TradeList post={post} title="받은 교환 제안" empty="아직 제안이 없어요." />
          <p className="faint">제안 하나를 수락하면 나머지 제안은 자동으로 거절돼요.</p>
          <CloseButton post={post} reload={reload} label="교환 마감" />
        </>
      ) : (
        <>
          <MyTradeLink post={post} label="내 교환 제안 보기" />
          {!post.my_trade && post.status === 'open' && !post.blocked && (
            <Gate message="바로 시작하기로 닉네임만 정하면 교환을 제안할 수 있어요.">
              <section className="card stack" aria-labelledby="propose-title">
                <h2 id="propose-title">이 조건으로 교환 제안</h2>
                <div className="notice warn">{SWAP_RISK}</div>
                <p className="small muted">처음에는 적은 장수로 교환하는 걸 권해요. 제안 뒤 거래 화면에서 스레드 아이디와 바코드를 입력하고, 서로 확인하며 진행해요. 바코드는 거래 화면에서만 주고받아요.</p>
                <Check checked={ack} onChange={setAck}>
                  위 위험을 이해했고, 조건을 확인했어요.
                </Check>
                <ErrorBox error={error} />
                <button className="btn block" disabled={!ack || busy} onClick={propose}>
                  {busy ? '보내는 중…' : '교환 제안하기'}
                </button>
              </section>
            </Gate>
          )}
          {post.blocked && <div className="notice">차단 관계라 참여할 수 없어요.</div>}
        </>
      )}
    </>
  );
}
