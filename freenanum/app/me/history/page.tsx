'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { rpc } from '@/lib/api';
import type { PostCard as Post, Summary, TradeListItem } from '@/lib/types';
import { Empty, ErrorBox, Loading, MemberOnly, PageHeader, useLoad } from '@/components/ui';
import PostCard from '@/components/PostCard';
import TradeRow from '@/components/trades/TradeRow';
import s from '@/components/me/me.module.css';

const TABS = [
  { key: 'trades', label: '거래 이력' },
  { key: 'posts', label: '내 글' },
  { key: 'entries', label: '참여한 나눔' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'giveaway', label: '나눔' },
  { key: 'swap', label: '교환' },
  { key: 'active', label: '진행 중' },
  { key: 'done', label: '완료' },
  { key: 'problem', label: '문제 발생' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="나눔·교환 이력" back="/me" />
      <MemberOnly message="시작하면 내 나눔·교환 이력이 여기에 쌓여요.">
        <Suspense fallback={<Loading />}>
          <History />
        </Suspense>
      </MemberOnly>
    </>
  );
}

function History() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const tab: Tab = raw === 'posts' || raw === 'entries' ? raw : 'trades';
  const setTab = (t: Tab) => router.replace(t === 'trades' ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="이력 종류">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'trades' && <Trades />}
      {tab === 'posts' && <MyPosts />}
      {tab === 'entries' && <MyEntries />}
    </div>
  );
}

function Trades() {
  const [filter, setFilter] = useState<Filter>('all');
  const sum = useLoad(() => rpc<Summary>('my_summary'), []);
  const list = useLoad(() => rpc<TradeListItem[]>('my_trades', { p_filter: filter }), [filter]);
  const c = sum.data?.all_time;

  return (
    <>
      <div className={s.stats}>
        <div className={s.stat}>
          <b>{c?.given ?? '-'}</b>
          <span>나눔한 장수</span>
        </div>
        <div className={s.stat}>
          <b>{c?.received ?? '-'}</b>
          <span>나눔받은 장수</span>
        </div>
        <div className={s.stat}>
          <b>{c?.swaps ?? '-'}</b>
          <span>교환 완료</span>
        </div>
      </div>
      <p className="faint">장수는 받는 분이 수령을 확인한 무료 나눔만 세요. 시즌이 바뀌어도 기록은 그대로 남아요.</p>
      <div className="chips" role="group" aria-label="거래 필터">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <Loading lines={3} />
      ) : list.data?.length === 0 ? (
        <Empty>해당하는 거래 기록이 없어요.</Empty>
      ) : (
        <ul className="list">
          {list.data?.map((t) => (
            <li key={t.id}>
              <TradeRow t={t} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MyPosts() {
  const { data, error, loading, reload } = useLoad(() => rpc<Post[]>('my_posts'), []);
  if (loading && !data) return <Loading lines={3} />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      {data?.length === 0 ? (
        <Empty
          action={
            <Link className="btn small" href="/posts/new">
              글 올리기
            </Link>
          }
        >
          아직 올린 글이 없어요.
        </Empty>
      ) : (
        <ul className="list">
          {data?.map((p) => (
            <li key={p.id} className="stack-sm">
              <PostCard post={p} />
              {p.visibility !== 'public' && <span className="faint">숨김 처리된 글이에요. 거래 기록은 그대로 남아요.</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Entry = Post & { entry_status: 'active' | 'withdrawn' | 'invalid'; result: 'winner' | 'reserve' | null; trade_id: string | null };

function entryText(e: Entry): string {
  if (e.entry_status === 'withdrawn') return '신청 취소';
  if (e.entry_status === 'invalid') return '무효 처리';
  if (e.giveaway?.state === 'canceled') return '나눔 취소';
  if (e.giveaway?.state !== 'drawn') return '결과 기다리는 중';
  if (e.result === 'winner') return '당첨';
  if (e.result === 'reserve') return e.trade_id ? '예비 → 당첨 승계' : '예비 당첨';
  return '미당첨';
}

function MyEntries() {
  const { data, error, loading, reload } = useLoad(() => rpc<Entry[]>('my_entries'), []);
  if (loading && !data) return <Loading lines={3} />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      {data?.length === 0 ? (
        <Empty>참여한 나눔이 없어요.</Empty>
      ) : (
        <ul className="list">
          {data?.map((e) => (
            <li key={e.id} className="stack-sm">
              <PostCard post={e} />
              <div className="row-between small" style={{ padding: '0 4px' }}>
                <span>
                  내 결과: <b>{entryText(e)}</b>
                </span>
                {e.trade_id && <Link href={`/trades/${e.trade_id}`}>거래 보기 ›</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
