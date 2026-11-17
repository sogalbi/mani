'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import Plaza, { type Spot } from '@/components/world/Plaza';
import s from '@/components/world/world.module.css';
import { Avatar, BODY_COLORS, type BodyColor } from '@/components/Avatar';
import { useApp } from '@/components/Providers';
import { PageHeader } from '@/components/ui';
import { EMOTES, ROOM_CAP, usePlaza, type Look } from '@/lib/plaza';

const SIMPLE_KEY = 'fn-world-simple';
const LOOK_KEY = 'fn.plaza.look';
// open tiles to appear on, so visitors do not stack on one spot
const STARTS = [[2, 4], [4, 2], [4, 4], [2, 2], [1, 5], [5, 1], [4, 5], [5, 4], [2, 5], [5, 2], [1, 4], [4, 1], [0, 4], [4, 0]] as const;
const randomStart = () => {
  const [i, j] = STARTS[Math.floor(Math.random() * STARTS.length)];
  return { i, j };
};

const SPOTS: Spot[] = [
  { id: 'give', name: '나눔 게시판', emoji: '🎁', desc: '지금 모집 중인 무료 나눔을 볼 수 있어요.', href: '/posts?kind=GIVEAWAY', cta: '나눔 보러 가기', at: [1, 3], stand: [2, 3] },
  { id: 'swap', name: '교환 게시판', emoji: '🔄', desc: '필요한 스티커끼리 바꿔요. 교환 글과 제안을 볼 수 있어요.', href: '/posts?kind=SWAP', cta: '교환 보러 가기', at: [3, 1], stand: [3, 2] },
  { id: 'mail', name: '우체통', emoji: '📮', desc: '당첨 소식과 나눔·교환 진행 상황, 거래 기록이 모여 있어요.', href: '/trades', cta: '내 거래 보기', at: [5, 3], stand: [5, 4] },
  { id: 'me', name: '내 캐릭터', emoji: '🌱', desc: '나눔이 수령 확인될 때마다 작은 장식이 생겨요. 지금 단계와 장식을 볼 수 있어요.', href: '/me/rewards', cta: '꾸미기 보기', at: [3, 5], stand: [4, 5] },
];

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
}

export default function WorldPage() {
  const { me, ready, requireMember } = useApp();
  const [simple, setSimple] = useState(false);
  const [color, setColor] = useState<BodyColor | null>(null);
  const [draft, setDraft] = useState<BodyColor>('cream');
  const [picking, setPicking] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSimple(readStore(SIMPLE_KEY, false));
    const saved = readStore<{ color?: BodyColor } | null>(LOOK_KEY, null);
    if (saved?.color && saved.color in BODY_COLORS) {
      setColor(saved.color);
      setDraft(saved.color);
    }
    setLoaded(true);
  }, []);

  const member = me && !me.needs_profile ? me : null;
  const look: Look | null = useMemo(() => {
    if (!ready || !loaded || !color || simple || picking) return null;
    return {
      name: member?.nickname ?? '손님',
      guest: !member,
      color,
      level: member?.badge?.level.level ?? 1,
    };
  }, [ready, loaded, color, simple, picking, member]);

  const [start] = useState(randomStart);
  const plaza = usePlaza(look, start);
  const othersCount = plaza.peers.length;

  function toggleSimple() {
    const v = !simple;
    setSimple(v);
    writeStore(SIMPLE_KEY, v);
  }

  function enter(c: BodyColor) {
    setColor(c);
    writeStore(LOOK_KEY, { color: c });
    setPicking(false);
  }

  const needsPick = loaded && !simple && (!color || picking);

  return (
    <div className="stack">
      <PageHeader
        title="나눔 광장"
        back="/"
        right={
          <button className="btn ghost small" onClick={toggleSimple} aria-pressed={simple}>
            {simple ? '광장 보기' : '간단히 보기'}
          </button>
        }
      />

      {needsPick ? (
        <section className="card stack" aria-label="캐릭터 고르기">
          <h2>어떤 모습으로 들어갈까요?</h2>
          <p className="muted small">
            가입 없이 바로 들어가요. 광장에서는 다른 사람들 캐릭터가 같이 걸어 다녀요. 말은 못 걸고, 정해진 인사만 할 수 있어요.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Avatar level={member?.badge?.level.level ?? 1} color={draft} size={96} label="미리보기" />
          </div>
          <div className={s.swatches} role="group" aria-label="몸 색">
            {(Object.keys(BODY_COLORS) as BodyColor[]).map((c) => (
              <button
                key={c}
                type="button"
                className={s.swatch}
                style={{ background: BODY_COLORS[c] }}
                aria-pressed={draft === c}
                aria-label={`${c} 색`}
                onClick={() => setDraft(c)}
              />
            ))}
          </div>
          <p className="small">
            이름표: <b>{member?.nickname ?? '손님'}</b>
            {!member && (
              <>
                {' · '}
                <button className="btn ghost small" type="button" onClick={() => void requireMember()}>
                  닉네임 정하기
                </button>
              </>
            )}
          </p>
          <button className="btn block" onClick={() => enter(draft)}>
            광장 들어가기
          </button>
        </section>
      ) : (
        !simple &&
        look && (
          <>
            <div className="row-between">
              <span className={s.status} aria-live="polite">
                {plaza.status === 'live' ? (
                  <>
                    <span className={s.live} aria-hidden /> 광장 {plaza.room} · 나 포함 {othersCount + 1}명이 같이 있어요
                  </>
                ) : plaza.status === 'connecting' ? (
                  <>
                    <span className={s.solo} aria-hidden /> 광장에 들어가는 중…
                  </>
                ) : (
                  <>
                    <span className={s.solo} aria-hidden /> 지금은 혼자 둘러보는 중이에요
                  </>
                )}
              </span>
              <button className="btn ghost small" onClick={() => setPicking(true)}>
                모습 바꾸기
              </button>
            </div>
            <Plaza
              spots={SPOTS}
              self={look}
              pos={plaza.pos}
              peers={plaza.peers}
              myEmote={plaza.myEmote?.id ?? null}
              celebration={plaza.celebration}
              onMove={plaza.moveTo}
              onCelebrationDone={plaza.clearCelebration}
            />
            <div className={s.emotes} role="group" aria-label="인사하기 (말 대신 정해진 인사만 할 수 있어요)">
              {EMOTES.map((e) => (
                <button key={e.id} type="button" onClick={() => plaza.emote(e.id)}>
                  <span aria-hidden>{e.emoji}</span> {e.text}
                </button>
              ))}
            </div>
            <p className="faint">
              바닥을 누르면 걸어가요. 큰 화면을 누르면 지금 나오는 나눔으로 가요. 광장 하나에 {ROOM_CAP}명까지, 차면 다음 광장이 열려요. 대화창은 없어요.
            </p>
          </>
        )
      )}

      <nav aria-label="광장 바로가기" className={s.dest}>
        {SPOTS.map((sp) => (
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
