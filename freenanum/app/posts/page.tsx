'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { rpc } from '@/lib/api';
import type { PostCard as Post, PostKind } from '@/lib/types';
import PostCard from '@/components/PostCard';
import { Empty, ErrorBox, Loading, useAction, useLoad } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useApp } from '@/components/Providers';

const TABS: { kind: PostKind; label: string; write: string }[] = [
  { kind: 'GIVEAWAY', label: '무료 나눔', write: '나눔 올리기' },
  { kind: 'SWAP', label: '교환', write: '교환 올리기' },
  { kind: 'REQUEST', label: '나눔 요청', write: '요청 올리기' },
];
const PAGE = 20;

export default function PostsPage() {
  return (
    <Suspense fallback={<Loading lines={3} />}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const { boot, configured } = useApp();
  const kindParam = params?.get('kind') as PostKind | null;
  const kind: PostKind = TABS.some((t) => t.kind === kindParam) ? (kindParam as PostKind) : 'GIVEAWAY';
  const [sticker, setSticker] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const more = useAction();

  const args = (before?: string) => ({
    p_kind: kind, p_sticker: sticker, p_q: q || null, p_only_open: onlyOpen, p_limit: PAGE, p_before: before ?? null,
  });
  const { data, error, loading, reload, setData } = useLoad(async () => {
    if (!configured) return [] as Post[];
    const rows = await rpc<Post[]>('list_posts', args());
    setHasMore(rows.length === PAGE);
    return rows;
  }, [kind, sticker, q, onlyOpen, configured]);

  const loadMore = () =>
    more.run(async () => {
      const last = data?.[data.length - 1];
      if (!last) return;
      const rows = await rpc<Post[]>('list_posts', args(last.created_at));
      setHasMore(rows.length === PAGE);
      setData((prev) => [...(prev ?? []), ...rows.filter((r) => !prev?.some((p) => p.id === r.id))]);
    });

  const tab = TABS.find((t) => t.kind === kind)!;
  const types = boot?.sticker_types ?? [
    { code: 'MISSION', name: '미션' },
    { code: 'GENERAL', name: '일반' },
  ];

  return (
    <div className="stack">
      <div className="row-between">
        <h1>게시판</h1>
        <Link className="btn small" href={`/posts/new?kind=${kind}`}>
          <Icon name="plus" size={18} /> {tab.write}
        </Link>
      </div>

      <div className="segmented" role="tablist" aria-label="게시판 종류">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={t.kind === kind}
            onClick={() => router.replace(`/posts?kind=${t.kind}`, { scroll: false })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <label htmlFor="post-search" className="sr-only">
          제목 검색
        </label>
        <input
          id="post-search"
          className="input grow"
          type="search"
          placeholder="제목으로 찾기"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value) setQ('');
          }}
        />
        <button className="btn secondary" type="submit">
          검색
        </button>
      </form>

      <div className="chips" aria-label="필터">
        <button className="chip" aria-pressed={sticker === null} onClick={() => setSticker(null)}>
          전체
        </button>
        {types.map((t) => (
          <button key={t.code} className="chip" aria-pressed={sticker === t.code} onClick={() => setSticker(t.code)}>
            {t.name}
          </button>
        ))}
        <button className="chip" aria-pressed={onlyOpen} onClick={() => setOnlyOpen((v) => !v)}>
          모집 중만
        </button>
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading lines={3} />
      ) : !data || data.length === 0 ? (
        <Empty
          action={
            <Link className="btn small" href={`/posts/new?kind=${kind}`}>
              {tab.write}
            </Link>
          }
        >
          {q ? `“${q}” 검색 결과가 없어요.` : onlyOpen ? '지금 모집 중인 글이 없어요.' : '아직 글이 없어요.'}
        </Empty>
      ) : (
        <ul className="list" aria-busy={loading}>
          {data.map((p) => (
            <li key={p.id}>
              <PostCard post={p} />
            </li>
          ))}
        </ul>
      )}

      <ErrorBox error={more.error} />
      {hasMore && data && data.length > 0 && (
        <button className="btn secondary block" disabled={more.busy} onClick={loadMore}>
          {more.busy ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </div>
  );
}
