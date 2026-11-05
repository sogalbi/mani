'use client';

import Link from 'next/link';
import { rpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { PostCard as Post } from '@/lib/types';
import PostCard from '@/components/PostCard';
import { Avatar } from '@/components/Avatar';
import { Empty, ErrorBox, Loading, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { usePlazaCount } from '@/lib/plaza';

const ACTIONS = [
  { href: '/posts/new?kind=GIVEAWAY', emoji: '🎁', label: '무료 나눔하기', bg: 'var(--sage-soft)' },
  { href: '/posts?kind=GIVEAWAY', emoji: '🙌', label: '나눔받기', bg: 'var(--butter-soft)' },
  { href: '/posts?kind=SWAP', emoji: '🔄', label: '교환하기', bg: 'var(--terra-soft)' },
];

function PostList({ kind, limit, empty }: { kind: 'GIVEAWAY' | 'REQUEST'; limit: number; empty: React.ReactNode }) {
  const { configured } = useApp();
  const { data, error, loading, reload } = useLoad(
    () => (configured ? rpc<Post[]>('list_posts', { p_kind: kind, p_only_open: true, p_limit: limit }) : Promise.resolve([] as Post[])),
    [kind, limit, configured],
  );
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading lines={2} />;
  if (!data || data.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="list">
      {data.map((p) => (
        <li key={p.id}>
          <PostCard post={p} />
        </li>
      ))}
    </ul>
  );
}

function PlazaDoor() {
  const count = usePlazaCount();
  return (
    <Link href="/world" className="card sage row" style={{ gap: 12 }}>
      <span aria-hidden style={{ fontSize: '1.9rem' }}>
        🌳
      </span>
      <span className="grow">
        <strong>나눔 광장 들어가기</strong>
        <br />
        <span className="small muted">
          {count && count > 0 ? `지금 ${count}명이 광장에 같이 있어요. ` : ''}가입 없이 캐릭터로 들어가 말없이 같이 있어요.
        </span>
      </span>
      <span aria-hidden>›</span>
    </Link>
  );
}

export default function Home() {
  const { boot, me } = useApp();
  const c = boot?.campaign;
  const lastDay = c ? new Date(new Date(c.ends_at).getTime() - 1).toISOString() : null;
  const rule = c?.completion_rule;
  const actions = me?.action_needed ?? 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="row" style={{ gap: 14, alignItems: 'center' }}>
        <Avatar level={me?.badge?.level.level ?? 1} size={68} label="프리나눔 캐릭터" />
        <div className="grow">
          <h1>남는 한 장이, 누군가의 마지막 한 장</h1>
          <p className="small muted">e-프리퀀시 스티커 무료 나눔과 교환을 이어 주는 작은 마을이에요.</p>
        </div>
      </section>

      <PlazaDoor />

      {actions > 0 && (
        <Link href="/trades" className="card terra row-between">
          <span>
            <strong>내 차례인 거래가 {actions}건 있어요</strong>
            <br />
            <span className="small">기한 안에 확인해 주세요.</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <nav className="big-actions" aria-label="바로 가기">
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} style={{ background: a.bg }}>
            <span className="emoji" aria-hidden>
              {a.emoji}
            </span>
            {a.label}
          </Link>
        ))}
      </nav>

      {c && (
        <section className="card butter stack-sm" aria-label="이번 시즌">
          <div className="row-between">
            <strong>{c.name}</strong>
            <span className="badge green">진행 중</span>
          </div>
          <span className="small">
            {fmtDate(c.starts_at)} ~ {fmtDate(lastDay)}
            {rule?.total ? ` · 미션 ${rule.mission ?? 0}장 포함 총 ${rule.total}장 완성` : ''}
          </span>
          {c.official_url && (
            <a className="small" href={c.official_url} target="_blank" rel="noopener noreferrer">
              공식 이벤트 안내 보기 ↗
            </a>
          )}
          <span className="tiny muted">
            프리나눔은 {c.brand} 공식 서비스가 아니에요. 스티커 선물은 공식 앱에서 직접 해요. 규칙은 공식 안내를 꼭 확인해 주세요.
          </span>
        </section>
      )}

      <section className="stack" aria-labelledby="sos-title">
        <div className="section-title">
          <h2 id="sos-title">마지막 한 장 SOS</h2>
          <Link href="/posts?kind=REQUEST">전체 보기</Link>
        </div>
        <PostList
          kind="REQUEST"
          limit={3}
          empty={
            <>
              지금 도움을 기다리는 요청이 없어요.
              <br />
              <Link href="/posts/new?kind=REQUEST">한 장이 부족하다면 요청을 올려 보세요</Link>
            </>
          }
        />
      </section>

      <section className="stack" aria-labelledby="new-title">
        <div className="section-title">
          <h2 id="new-title">새 나눔</h2>
          <Link href="/posts?kind=GIVEAWAY">전체 보기</Link>
        </div>
        <PostList
          kind="GIVEAWAY"
          limit={5}
          empty={
            <>
              모집 중인 나눔이 없어요.
              <br />
              <Link href="/posts/new?kind=GIVEAWAY">남는 스티커를 나눠 보세요</Link>
            </>
          }
        />
      </section>

    </div>
  );
}
