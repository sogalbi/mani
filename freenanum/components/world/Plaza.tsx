'use client';

// Live plaza (spec §13 option A + 산사-style presence): a hand-drawn isometric plaza in
// inline SVG. Other visitors' characters walk around in real time; there is no chat,
// only fixed emotes. Every hotspot is also a real button, and the same destinations are
// listed as plain links below the scene.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Sheet } from '@/components/ui';
import { emoteOf, type Celebration, type EmoteId, type Look, type Peer } from '@/lib/plaza';
import BigScreen from './BigScreen';
import s from './world.module.css';

const W = 360;
const H = 270;
const CX = 180;
const TOP = 70;
const N = 7;

type Pt = { x: number; y: number };
const iso = (i: number, j: number): Pt => ({ x: CX + (i - j) * 24, y: TOP + (i + j) * 12 });

export interface Spot {
  id: 'give' | 'swap' | 'mail' | 'me';
  name: string;
  emoji: string;
  desc: string;
  href: string;
  cta: string;
  at: [number, number];
  stand: [number, number];
}

const PATH = (i: number, j: number) => i === 3 || j === 3;
const GARDEN = (i: number, j: number) => i + j >= 11 || (i === 0 && j === 6) || (i === 6 && j === 0);

function diamond({ x, y }: Pt) {
  return `${x},${y - 12} ${x + 24},${y} ${x},${y + 12} ${x - 24},${y}`;
}

/* ---------- scenery ---------- */

function House({ x, y, roof, wall = '#fbf3e2' }: Pt & { roof: string; wall?: string }) {
  const h = 26;
  return (
    <g>
      <polygon points={`${x - 20},${y} ${x},${y + 10} ${x},${y + 10 - h} ${x - 20},${y - h}`} fill={wall} stroke="#8a7a60" strokeWidth="1" />
      <polygon points={`${x},${y + 10} ${x + 20},${y} ${x + 20},${y - h} ${x},${y + 10 - h}`} fill="#efe2c6" stroke="#8a7a60" strokeWidth="1" />
      <path d={`M${x - 23} ${y - h + 1} C${x - 23} ${y - h - 30} ${x + 23} ${y - h - 30} ${x + 23} ${y - h + 1} Q${x} ${y - h + 12} ${x - 23} ${y - h + 1}Z`} fill={roof} stroke="#6b4a32" strokeWidth="1" />
      <path d={`M${x + 6} ${y + 6} v-12 a4 4 0 0 1 8 -4 v12z`} fill="#a86f4a" />
      <path d={`M${x - 15} ${y - 6} v-8 a3.5 3.5 0 0 1 7 2 v8z`} fill="#bfdbe6" stroke="#8a7a60" strokeWidth="0.8" />
    </g>
  );
}

function Tree({ x, y }: Pt) {
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx="10" ry="4" fill="rgba(60,50,30,0.15)" />
      <rect x={x - 2.5} y={y - 14} width="5" height="16" rx="2" fill="#9a6b45" />
      <circle cx={x} cy={y - 24} r="13" fill="#8fb27e" stroke="#56744f" strokeWidth="1" />
      <circle cx={x - 6} cy={y - 28} r="7" fill="#a4c792" />
    </g>
  );
}

function Fountain({ x, y }: Pt) {
  return (
    <g>
      <ellipse cx={x} cy={y + 3} rx="31" ry="15" fill="#d9ccb0" stroke="#8a7a60" strokeWidth="1" />
      <ellipse cx={x} cy={y} rx="27" ry="12.5" fill="#bfe0ea" />
      <ellipse cx={x - 6} cy={y - 2} rx="9" ry="3" fill="#e4f3f7" />
      <rect x={x - 4} y={y - 26} width="8" height="24" rx="3" fill="#e9dcc0" stroke="#8a7a60" strokeWidth="0.8" />
      <ellipse cx={x} cy={y - 26} rx="11" ry="5" fill="#e9dcc0" stroke="#8a7a60" strokeWidth="0.8" />
      <path d={`M${x} ${y - 30} q-12 -10 -16 6 M${x} ${y - 30} q12 -10 16 6`} fill="none" stroke="#7fc2d6" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Board({ x, y, color, label }: Pt & { color: string; label: string }) {
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx="20" ry="6" fill="rgba(60,50,30,0.15)" />
      <rect x={x - 15} y={y - 26} width="4" height="28" rx="1.5" fill="#9a6b45" />
      <rect x={x + 11} y={y - 26} width="4" height="28" rx="1.5" fill="#9a6b45" />
      <rect x={x - 22} y={y - 46} width="44" height="24" rx="5" fill={color} stroke="#6b4a32" strokeWidth="1.2" />
      <path d={`M${x - 25} ${y - 46} Q${x} ${y - 60} ${x + 25} ${y - 46}Z`} fill="#cf7a52" stroke="#6b4a32" strokeWidth="1" />
      <rect x={x - 17} y={y - 41} width="12" height="9" rx="1.5" fill="#fffdf7" opacity="0.9" />
      <rect x={x - 2} y={y - 41} width="9" height="11" rx="1.5" fill="#fffdf7" opacity="0.9" />
      <text x={x} y={y - 26} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#3b372f">{label}</text>
    </g>
  );
}

function Mailbox({ x, y }: Pt) {
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx="12" ry="4" fill="rgba(60,50,30,0.15)" />
      <rect x={x - 2.5} y={y - 18} width="5" height="20" fill="#7a6a52" />
      <path d={`M${x - 12} ${y - 18} v-14 a12 10 0 0 1 24 0 v14z`} fill="#cf7a52" stroke="#6b4a32" strokeWidth="1.2" />
      <rect x={x - 7} y={y - 30} width="14" height="3" rx="1.5" fill="#6b4a32" />
      <rect x={x + 12} y={y - 38} width="2.5" height="14" fill="#6b4a32" />
      <path d={`M${x + 14.5} ${y - 38} h9 v6 h-9z`} fill="#f3d27a" stroke="#6b4a32" strokeWidth="0.8" />
    </g>
  );
}

function Podium({ x, y }: Pt) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx="20" ry="9" fill="#e4ecdc" stroke="#56744f" strokeWidth="1" />
      <path d={`M${x - 20} ${y} v-6 a20 9 0 0 1 40 0 v6`} fill="#cfe0c2" stroke="#56744f" strokeWidth="1" />
      <ellipse cx={x} cy={y - 6} rx="20" ry="9" fill="#e4ecdc" stroke="#56744f" strokeWidth="1" />
      <path d={`M${x - 9} ${y - 22} q9 -18 18 0 q-9 10 -18 0z`} fill="#f2b5a7" stroke="#a85a37" strokeWidth="1" />
      <path d={`M${x} ${y - 46} l2.4 5.6 6 .6 -4.6 4 1.4 6 -5.2 -3.2 -5.2 3.2 1.4 -6 -4.6 -4 6 -.6z`} fill="#f3d27a" stroke="#c99b2f" strokeWidth="0.8" />
    </g>
  );
}

function Flowers({ x, y }: Pt) {
  const dots: [number, number, string][] = [[-8, -2, '#f2b5a7'], [4, -5, '#f3d27a'], [10, 2, '#fffdf7'], [-2, 4, '#e9a3a0'], [-14, 3, '#f3d27a']];
  return (
    <g>
      {dots.map(([dx, dy, c], k) => (
        <g key={k}>
          <path d={`M${x + dx} ${y + dy} v-4`} stroke="#56744f" strokeWidth="1" />
          <circle cx={x + dx} cy={y + dy - 5} r="2.2" fill={c} stroke="#a85a37" strokeWidth="0.4" />
        </g>
      ))}
    </g>
  );
}

function ScreenFrame() {
  // big screen stand at the back of the plaza; the live content is an HTML overlay (BigScreen)
  return (
    <g>
      <ellipse cx="180" cy="70" rx="70" ry="8" fill="rgba(60,50,30,0.12)" />
      <rect x="112" y="40" width="6" height="32" rx="2" fill="#9a6b45" />
      <rect x="242" y="40" width="6" height="32" rx="2" fill="#9a6b45" />
      <rect x="86" y="3" width="188" height="56" rx="9" fill="#5e4a3a" stroke="#3b2f25" strokeWidth="1.2" />
      <path d="M80 6 Q180 -14 280 6 L274 8 Q180 -8 86 8Z" fill="#cf7a52" stroke="#6b4a32" strokeWidth="0.8" />
    </g>
  );
}

/* ---------- characters ---------- */

const pct = (p: Pt) => ({ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` });

function Character({ peer, me, walking, flip, emote }: { peer: Look & { i: number; j: number }; me?: boolean; walking?: boolean; flip?: boolean; emote: EmoteId | null }) {
  const p = iso(peer.i, peer.j);
  const e = emoteOf(emote);
  return (
    <div
      className={`${s.player} ${me ? s.me : ''} ${flip ? s.flip : ''} ${walking ? s.walking : ''}`}
      style={{ ...pct(p), zIndex: 10 + Math.round(p.y) }}
      aria-hidden
    >
      {e && (
        <span className={s.bubble}>
          <span aria-hidden>{e.emoji}</span> {e.text}
        </span>
      )}
      <span className={s.shadow} />
      <div>
        <Avatar level={peer.level} color={peer.color} size={64} label="" />
      </div>
      <span className={s.nameTag}>{me ? '나' : peer.name}</span>
    </div>
  );
}

/* ---------- scene ---------- */

export interface PlazaProps {
  spots: Spot[];
  self: Look;
  pos: { i: number; j: number };
  peers: Peer[];
  myEmote: EmoteId | null;
  celebration: Celebration | null;
  onMove: (i: number, j: number) => void;
  onCelebrationDone: () => void;
}

export default function Plaza({ spots, self, pos, peers, myEmote, celebration, onMove, onCelebrationDone }: PlazaProps) {
  const [walking, setWalking] = useState(false);
  const [flip, setFlip] = useState(false);
  const [open, setOpen] = useState<Spot | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(onCelebrationDone, 5000);
    return () => clearTimeout(t);
  }, [celebration, onCelebrationDone]);

  const walkTo = useCallback((i: number, j: number, then?: () => void) => {
    if (busy.current || open) return; // card open or still walking → ignore input
    const from = iso(posRef.current.i, posRef.current.j);
    const to = iso(i, j);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 1) setFlip(to.x < from.x);
    onMove(i, j);
    if (reduced.current || dist < 1) {
      then?.();
      return;
    }
    busy.current = true;
    setWalking(true);
    timer.current = setTimeout(() => {
      busy.current = false;
      setWalking(false);
      then?.();
    }, 680);
  }, [open, onMove]);

  const tiles: { i: number; j: number; p: Pt }[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tiles.push({ i, j, p: iso(i, j) });

  const at = (id: Spot['id']) => iso(...(spots.find((x) => x.id === id)?.at ?? [3, 3]));
  const scene: [string, Pt, (p: Pt) => React.ReactNode][] = [
    ['h2', iso(0, 6), (p) => <House {...p} roof="#cf7a52" />],
    ['h3', iso(6, 0), (p) => <House {...p} roof="#8fb27e" />],
    ['t1', iso(2, 0), (p) => <Tree {...p} />],
    ['t2', iso(0, 2), (p) => <Tree {...p} />],
    ['fountain', iso(3, 3), (p) => <Fountain {...p} />],
    ['give', at('give'), (p) => <Board {...p} color="#cfe0c2" label="나눔" />],
    ['swap', at('swap'), (p) => <Board {...p} color="#fbf0cc" label="교환" />],
    ['mail', at('mail'), (p) => <Mailbox {...p} />],
    ['me', at('me'), (p) => <Podium {...p} />],
    ['f1', iso(6, 6), (p) => <Flowers {...p} />],
    ['f2', iso(5, 6), (p) => <Flowers {...p} />],
    ['f3', iso(6, 5), (p) => <Flowers {...p} />],
  ];
  // back-to-front so nearer objects overlap farther ones
  const objects = scene.map(([key, p, draw]) => ({ key, y: p.y, el: draw(p) })).sort((a, b) => a.y - b.y);

  return (
    <>
      <div className={s.stage}>
        <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {tiles.map(({ i, j, p }) => (
            <polygon
              key={`${i}-${j}`}
              className={s.tile}
              points={diamond(p)}
              fill={PATH(i, j) ? '#d8e5cc' : GARDEN(i, j) ? '#bcd6a6' : (i + j) % 2 ? '#f6ecd4' : '#f1e4c6'}
              stroke="#e2d3b2"
              strokeWidth="0.8"
              onClick={() => walkTo(i, j)}
            />
          ))}
          <ScreenFrame />
          {objects.map((o) => (
            <g key={o.key} style={{ pointerEvents: 'none' }}>
              {o.el}
            </g>
          ))}
        </svg>

        <div className={s.screenSlot}>
          <BigScreen />
        </div>

        {spots.map((sp) => {
          const p = iso(...sp.at);
          return (
            <button
              key={sp.id}
              type="button"
              className={s.hot}
              style={pct(p)}
              aria-label={`${sp.name}: ${sp.desc}`}
              onClick={() => walkTo(...sp.stand, () => setOpen(sp))}
            >
              <span className={s.hotLabel}>{sp.name}</span>
            </button>
          );
        })}

        {peers.map((peer) => (
          <Character key={peer.key} peer={peer} emote={peer.emoteUntil > Date.now() ? peer.emote : null} />
        ))}
        <Character peer={{ ...self, ...pos }} me walking={walking} flip={flip} emote={myEmote} />

        {celebration && (
          <div className={s.celebrate} role="status" key={celebration.id}>
            <span aria-hidden>🎉</span> 방금 {celebration.kind === 'swap' ? '교환' : '나눔'}이 완료됐어요! {celebration.summary}
          </div>
        )}
      </div>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? `${open.emoji} ${open.name}` : ''}>
        {open && (
          <>
            <p>{open.desc}</p>
            <Link className="btn block" href={open.href}>
              {open.cta}
            </Link>
          </>
        )}
      </Sheet>
    </>
  );
}
