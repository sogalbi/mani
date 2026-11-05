'use client';

import Link from 'next/link';
import { useState } from 'react';
import { rpc } from '@/lib/api';
import type { TradeListItem } from '@/lib/types';
import { Empty, ErrorBox, Loading, MemberOnly, PageHeader, useLoad } from '@/components/ui';
import TradeRow from '@/components/trades/TradeRow';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행 중' },
  { key: 'done', label: '완료' },
  { key: 'problem', label: '문제' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function TradesPage() {
  return (
    <>
      <PageHeader title="거래" />
      <MemberOnly message="닉네임만 정하면 바로 시작해요. 당첨·나눔·교환 거래는 여기에서 이어서 진행해요.">
        <TradeList />
      </MemberOnly>
    </>
  );
}

function TradeList() {
  const [filter, setFilter] = useState<FilterKey>('active');
  const { data, error, loading, reload } = useLoad(() => rpc<TradeListItem[]>('my_trades', { p_filter: filter }), [filter]);
  const todo = (data ?? []).filter((t) => t.needs_action);
  const rest = (data ?? []).filter((t) => !t.needs_action);

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="거래 상태">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading lines={3} />
      ) : data && data.length === 0 ? (
        <Empty
          action={
            <Link className="btn secondary small" href="/posts">
              게시판 둘러보기
            </Link>
          }
        >
          {filter === 'active' ? '진행 중인 거래가 없어요.' : '해당하는 거래가 없어요.'}
        </Empty>
      ) : (
        <>
          {todo.length > 0 && (
            <section className="stack" aria-labelledby="todo-h">
              <h2 id="todo-h">내가 할 일 {todo.length}건</h2>
              <ul className="list">
                {todo.map((t) => (
                  <li key={t.id}>
                    <TradeRow t={t} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rest.length > 0 && (
            <section className="stack" aria-label="거래 목록">
              {todo.length > 0 && <h2>그 밖의 거래</h2>}
              <ul className="list">
                {rest.map((t) => (
                  <li key={t.id}>
                    <TradeRow t={t} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="faint">
        지난 기록은 <Link href="/me/history">MY › 나눔·교환 이력</Link>에서 모아 볼 수 있어요.
      </p>
    </div>
  );
}
