'use client';

// The plaza's big screen (전광판): everyone sees the same slide at the same time
// (slides change on the wall clock), like the shared screen in 산사-style spaces.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtRemaining, KIND_LABEL, stickerSummary } from '@/lib/format';
import type { PostCard } from '@/lib/types';
import s from './world.module.css';

const SLIDE_MS = 7000;

interface Stats {
  open_giveaways: number;
  open_requests: number;
  open_swaps: number;
  given_today: number;
  completed_today: number;
  given_total: number;
}

type Slide = { kind: 'stats'; stats: Stats } | { kind: 'post'; post: PostCard };

export default function BigScreen() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [stats, gives, sos] = await Promise.all([
          rpc<Stats>('plaza_stats'),
          rpc<PostCard[]>('list_posts', { p_kind: 'GIVEAWAY', p_limit: 6 }),
          rpc<PostCard[]>('list_posts', { p_kind: 'REQUEST', p_limit: 4 }),
        ]);
        if (!alive) return;
        // interleave SOS between giveaways so "마지막 한 장" requests come up often
        const posts: PostCard[] = [];
        for (let k = 0; k < Math.max(gives.length, sos.length); k++) {
          if (sos[k]) posts.push(sos[k]);
          if (gives[k]) posts.push(gives[k]);
        }
        setSlides([{ kind: 'stats', stats }, ...posts.map((post) => ({ kind: 'post' as const, post }))]);
      } catch {
        // keep the last slides
      }
    };
    void load();
    const reload = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(reload);
      clearInterval(tick);
    };
  }, []);

  if (!slides.length) {
    return (
      <div className={s.screen} aria-live="off">
        <span className={s.screenTitle}>프리나눔 광장</span>
      </div>
    );
  }

  const idx = Math.floor(now / SLIDE_MS) % slides.length;
  const slide = slides[idx];
  const progress = ((now % SLIDE_MS) / SLIDE_MS) * 100;

  return (
    <div className={s.screenWrap}>
      {slide.kind === 'stats' ? (
        <div className={s.screen}>
          <span className={s.screenTag}>오늘의 광장</span>
          <span className={s.screenTitle}>오늘 나눔 {slide.stats.given_today}장 완료</span>
          <span className={s.screenSub}>
            모집 중 나눔 {slide.stats.open_giveaways} · SOS {slide.stats.open_requests} · 교환 {slide.stats.open_swaps}
          </span>
        </div>
      ) : (
        <Link className={s.screen} href={`/posts/${slide.post.code}`} aria-label={`큰 화면: ${slide.post.title} 보러 가기`}>
          <span className={`${s.screenTag} ${slide.post.kind === 'REQUEST' ? s.screenSos : ''}`}>
            {slide.post.kind === 'REQUEST' ? '마지막 한 장 SOS' : KIND_LABEL[slide.post.kind]}
          </span>
          <span className={s.screenTitle}>{slide.post.title}</span>
          <span className={s.screenSub}>
            {stickerSummary(slide.post.items)} · {fmtRemaining(slide.post.closes_at, now)}
          </span>
        </Link>
      )}
      <span className={s.screenBar} style={{ width: `${progress}%` }} aria-hidden />
    </div>
  );
}
