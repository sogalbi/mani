'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/api';
import type { PostCard as Post } from '@/lib/types';
import PostCard from '@/components/PostCard';
import { Empty, ErrorBox, Loading, Stepper, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';

const KEY = 'freenanum.match.v1';
type Counts = Record<string, number>;
type Prefs = { have: Counts; need: Counts };
const EMPTY: Prefs = { have: {}, need: {} };

function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Prefs;
    return { have: p.have ?? {}, need: p.need ?? {} };
  } catch {
    return EMPTY;
  }
}

function writePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private mode or blocked storage: matching still works for this visit
  }
}

export default function MatchesPage() {
  const { boot, configured } = useApp();
  const types = boot?.sticker_types?.length ? boot.sticker_types : [{ code: 'MISSION', name: '미션' }, { code: 'GENERAL', name: '일반' }];
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs());
    setLoaded(true);
  }, []);

  const update = (side: 'have' | 'need', code: string, v: number) => {
    setPrefs((p) => {
      const next = { ...p, [side]: { ...p[side], [code]: v } };
      writePrefs(next);
      return next;
    });
  };

  const { data, error, loading, reload } = useLoad(async () => {
    if (!configured) return { give: [] as Post[], swap: [] as Post[], req: [] as Post[] };
    const [give, swap, req] = await Promise.all(
      (['GIVEAWAY', 'SWAP', 'REQUEST'] as const).map((k) => rpc<Post[]>('list_posts', { p_kind: k, p_only_open: true, p_limit: 50 })),
    );
    return { give, swap, req };
  }, [configured]);

  const have = (c: string) => prefs.have[c] ?? 0;
  const need = (c: string) => prefs.need[c] ?? 0;
  const anyNeed = types.some((t) => need(t.code) > 0);
  const anyHave = types.some((t) => have(t.code) > 0);

  const result = useMemo(() => {
    if (!data) return null;
    const notMine = (p: Post) => !p.is_mine;
    const offers = (p: Post) => p.items.filter((i) => i.direction === 'offer');
    const wants = (p: Post) => p.items.filter((i) => i.direction === 'want');

    const giveaways = data.give.filter(notMine).filter((p) => offers(p).some((i) => need(i.code) > 0));

    const full: Post[] = [];
    const partial: Post[] = [];
    for (const p of data.swap.filter(notMine)) {
      // the post offers what I need, and wants what I can spare
      const getsOk = offers(p).every((i) => need(i.code) > 0);
      const givesOk = wants(p).every((i) => have(i.code) >= i.quantity);
      const touches = offers(p).some((i) => need(i.code) > 0) || wants(p).some((i) => have(i.code) > 0);
      if (getsOk && givesOk) full.push(p);
      else if (touches) partial.push(p);
    }

    const requests = data.req.filter(notMine).filter((p) => wants(p).some((i) => have(i.code) > 0));
    return { giveaways, full, partial, requests };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>매칭</h1>
        <p className="small muted">남는 스티커와 필요한 스티커를 적으면 맞는 나눔·교환·요청을 골라 드려요.</p>
      </div>

      <section className="card stack" aria-label="내 스티커 상태">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          {(['have', 'need'] as const).map((side) => (
            <div key={side} className="grow stack-sm" style={{ minWidth: 140 }}>
              <span className="label">{side === 'have' ? '남는 스티커' : '필요한 스티커'}</span>
              {types.map((t) => (
                <div key={t.code} className="row-between">
                  <span className="small">{t.name}</span>
                  <Stepper
                    label={`${side === 'have' ? '남는' : '필요한'} ${t.name} 장수`}
                    value={side === 'have' ? have(t.code) : need(t.code)}
                    min={0}
                    max={17}
                    onChange={(v) => update(side, t.code, v)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="tiny muted">
          직접 적은 숫자예요. 공식 앱의 실제 잔량과 다를 수 있어요. 이 숫자는 서버에 저장되지 않고 이 기기에만 남아요.
        </p>
      </section>

      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading || !loaded || !result ? (
        <Loading lines={3} />
      ) : !anyNeed && !anyHave ? (
        <Empty>위에 남는 스티커나 필요한 스티커를 적어 주세요.</Empty>
      ) : (
        <>
          {anyNeed && (
            <Group title="받을 수 있는 나눔" posts={result.giveaways} empty="필요한 종류의 나눔이 지금은 없어요." more="/posts?kind=GIVEAWAY" />
          )}
          {(anyNeed || anyHave) && (
            <Group
              title="나와 맞는 교환"
              posts={result.full}
              empty="조건이 딱 맞는 교환이 없어요."
              more="/posts?kind=SWAP"
              extra={
                result.partial.length > 0 && (
                  <>
                    <h3 className="muted" style={{ marginTop: 4 }}>
                      일부만 맞는 교환
                    </h3>
                    <ul className="list">
                      {result.partial.map((p) => (
                        <li key={p.id}>
                          <PostCard post={p} />
                        </li>
                      ))}
                    </ul>
                  </>
                )
              }
            />
          )}
          {anyHave && (
            <Group title="내가 도울 수 있는 요청" posts={result.requests} empty="지금 도울 수 있는 SOS 요청이 없어요." more="/posts?kind=REQUEST" />
          )}
        </>
      )}

      <p className="faint center">새로 맞는 글이 올라올 때 알려 주는 자동 매칭 알림은 아직 준비 중이에요.</p>
    </div>
  );
}

function Group({ title, posts, empty, more, extra }: { title: string; posts: Post[]; empty: string; more: string; extra?: React.ReactNode }) {
  return (
    <section className="stack" aria-label={title}>
      <div className="section-title">
        <h2>
          {title} <span className="faint">{posts.length}</span>
        </h2>
        <Link href={more}>게시판</Link>
      </div>
      {posts.length === 0 ? (
        <p className="small muted">{empty}</p>
      ) : (
        <ul className="list">
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} />
            </li>
          ))}
        </ul>
      )}
      {extra}
    </section>
  );
}
