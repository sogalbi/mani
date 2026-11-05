'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Plaza, { type Spot } from '@/components/world/Plaza';
import s from '@/components/world/world.module.css';
import { useApp } from '@/components/Providers';
import { PageHeader } from '@/components/ui';

const KEY = 'fn-world-simple';

export default function WorldPage() {
  const { me } = useApp();
  const [simple, setSimple] = useState(false);

  useEffect(() => {
    try {
      setSimple(localStorage.getItem(KEY) === '1');
    } catch {
      // storage unavailable → show the scene
    }
  }, []);

  function toggle() {
    const v = !simple;
    setSimple(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      // ignore
    }
  }

  const spots: Spot[] = [
    { id: 'give', name: '나눔 게시판', emoji: '🎁', desc: '지금 모집 중인 무료 나눔을 볼 수 있어요.', href: '/posts?kind=GIVEAWAY', cta: '나눔 보러 가기', at: [1, 3], stand: [2, 3] },
    { id: 'swap', name: '교환 게시판', emoji: '🔄', desc: '필요한 스티커끼리 바꿔요. 교환 글과 제안을 볼 수 있어요.', href: '/posts?kind=SWAP', cta: '교환 보러 가기', at: [3, 1], stand: [3, 2] },
    { id: 'mail', name: '우체통', emoji: '📮', desc: '당첨 소식과 나눔·교환 진행 상황, 거래 기록이 모여 있어요.', href: '/trades', cta: '내 거래 보기', at: [5, 3], stand: [5, 4] },
    { id: 'me', name: '내 캐릭터', emoji: '🌱', desc: '나눔이 수령 확인될 때마다 작은 장식이 생겨요. 지금 단계와 장식을 볼 수 있어요.', href: '/me/rewards', cta: '꾸미기 보기', at: [3, 5], stand: [4, 5] },
  ];
  const level = me?.badge?.level.level ?? 1;

  return (
    <div className="stack">
      <PageHeader
        title="나눔 광장"
        back="/"
        right={
          <button className="btn ghost small" onClick={toggle} aria-pressed={simple}>
            {simple ? '광장 보기' : '간단히 보기'}
          </button>
        }
      />
      <p className="muted small">
        타일을 눌러 걸어 보고, 게시판과 우체통에 들러 보세요. 광장에 들어오지 않아도 모든 기능은 아래 메뉴에서 바로 쓸 수 있어요.
      </p>

      {!simple && <Plaza spots={spots} level={level} />}

      <nav aria-label="광장 바로가기" className={s.dest}>
        {spots.map((sp) => (
          <Link key={sp.id} href={sp.href} className="card flat" style={{ padding: 12 }}>
            <span className={s.emoji} aria-hidden>{sp.emoji}</span>
            <b>{sp.name}</b>
            <span className="faint">{sp.desc}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
