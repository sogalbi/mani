'use client';

// Live plaza (산사-style): everyone in the same room sees each other's characters.
// No chat — only movement and a fixed set of emotes. Runs on Supabase Realtime
// presence (public channels), so no extra server is needed.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { BODY_COLORS, type BodyColor } from '@/components/Avatar';
import { isConfigured, supabase } from './supabase';

export const GRID = 7;
export const ROOM_CAP = 40;
const MAX_ROOMS = 30;
const EMOTE_MS = 4500;

export const EMOTES = [
  { id: 'hi', emoji: '👋', text: '안녕하세요' },
  { id: 'cheer', emoji: '🙌', text: '응원해요' },
  { id: 'thanks', emoji: '🙏', text: '고마워요' },
  { id: 'sos', emoji: '🥺', text: '미션 한 장만!' },
  { id: 'congrats', emoji: '🎉', text: '축하해요' },
  { id: 'rest', emoji: '☕', text: '쉬는 중' },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];
export const emoteOf = (id: string | null | undefined) => EMOTES.find((e) => e.id === id) ?? null;

export interface Look {
  name: string;
  guest: boolean;
  color: BodyColor;
  level: number;
}

export interface Peer extends Look {
  key: string;
  i: number;
  j: number;
  emote: EmoteId | null;
  /** local time until which the emote bubble is shown */
  emoteUntil: number;
}

export interface Celebration {
  id: string;
  kind: 'giveaway' | 'swap';
  summary: string;
}

const NAME_RE = /^[가-힣A-Za-z0-9_.]{2,12}$/;
const clampCell = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < GRID ? (n as number) : null);

/** Presence payloads come from other browsers: keep only well-formed values. */
function readPeer(key: string, raw: Record<string, unknown>): Omit<Peer, 'emoteUntil'> & { emoteAt: number } | null {
  const i = clampCell(raw.i);
  const j = clampCell(raw.j);
  if (i === null || j === null) return null;
  const guest = raw.guest === true;
  const name = typeof raw.name === 'string' && NAME_RE.test(raw.name) ? raw.name : null;
  const color = typeof raw.color === 'string' && raw.color in BODY_COLORS ? (raw.color as BodyColor) : 'cream';
  const level = Number.isInteger(raw.level) ? Math.min(6, Math.max(1, raw.level as number)) : 1;
  const emote = emoteOf(typeof raw.emote === 'string' ? raw.emote : null)?.id ?? null;
  const emoteAt = typeof raw.emoteAt === 'number' ? raw.emoteAt : 0;
  return { key, i, j, guest, name: guest || !name ? '손님' : name, color, level, emote, emoteAt };
}

export function plazaKey(): string {
  try {
    let k = localStorage.getItem('fn.plaza.key');
    if (!k) {
      k = crypto.randomUUID().slice(0, 12);
      localStorage.setItem('fn.plaza.key', k);
    }
    return k;
  } catch {
    return crypto.randomUUID().slice(0, 12);
  }
}

function subscribe(ch: RealtimeChannel, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(t);
        reject(new Error(status));
      }
    });
  });
}

type Status = 'connecting' | 'live' | 'solo';

/**
 * Joins the first plaza room with space (rooms fill up to ROOM_CAP, then the next one opens).
 * Falls back to solo mode when Realtime is unavailable (no fake visitors).
 */
export function usePlaza(look: Look | null, start: { i: number; j: number }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [room, setRoom] = useState<number | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [pos, setPos] = useState(start);
  const [myEmote, setMyEmote] = useState<{ id: EmoteId; until: number } | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  const chRef = useRef<RealtimeChannel | null>(null);
  const lobbyRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef<Record<string, unknown>>({});
  const seenEmote = useRef(new Map<string, { at: number; until: number }>());
  const lastTrack = useRef(0);
  const pendingTrack = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef('');

  const lookKey = look ? `${look.name}|${look.guest}|${look.color}|${look.level}` : '';

  const track = useCallback((patch: Record<string, unknown>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    const ch = chRef.current;
    if (!ch) return;
    const send = () => {
      lastTrack.current = Date.now();
      pendingTrack.current = null;
      void ch.track(stateRef.current);
    };
    const wait = 250 - (Date.now() - lastTrack.current);
    if (pendingTrack.current) clearTimeout(pendingTrack.current);
    if (wait <= 0) send();
    else pendingTrack.current = setTimeout(send, wait);
  }, []);

  useEffect(() => {
    if (!look) return;
    let cancelled = false;
    let client: SupabaseClient | null = null;
    const events: RealtimeChannel[] = [];
    keyRef.current = plazaKey();
    stateRef.current = { ...stateRef.current, name: look.name, guest: look.guest, color: look.color, level: look.level, i: pos.i, j: pos.j };

    const onSync = (ch: RealtimeChannel) => () => {
      const state = ch.presenceState() as Record<string, Record<string, unknown>[]>;
      const now = Date.now();
      const next: Peer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === keyRef.current || !metas?.length) continue;
        const p = readPeer(key, metas[metas.length - 1]);
        if (!p) continue;
        const prev = seenEmote.current.get(key);
        let until = prev?.until ?? 0;
        if (p.emote && p.emoteAt && p.emoteAt !== prev?.at) {
          until = now + EMOTE_MS;
          seenEmote.current.set(key, { at: p.emoteAt, until });
        }
        const { emoteAt: _ignored, ...rest } = p;
        next.push({ ...rest, emoteUntil: until });
      }
      setPeers(next);
    };

    (async () => {
      if (!isConfigured) {
        setStatus('solo');
        return;
      }
      try {
        client = supabase();
        // fixed-format celebrations sent by the database when a trade completes (no names)
        const ev = client.channel('plaza:events');
        ev.on('broadcast', { event: 'celebrate' }, ({ payload }) => {
          const kind = payload?.kind === 'swap' ? 'swap' : 'giveaway';
          const summary = typeof payload?.summary === 'string' ? payload.summary.slice(0, 40) : '';
          setCelebration({ id: String(payload?.id ?? Date.now()), kind, summary });
        });
        events.push(ev);
        void ev.subscribe();

        for (let n = 1; n <= MAX_ROOMS && !cancelled; n++) {
          const ch = client.channel(`plaza:room-${n}`, { config: { presence: { key: keyRef.current } } });
          let firstSync: () => void = () => {};
          const synced = new Promise<void>((r) => (firstSync = r));
          ch.on('presence', { event: 'sync' }, () => {
            firstSync();
            onSync(ch)();
          });
          await subscribe(ch);
          await Promise.race([synced, new Promise((r) => setTimeout(r, 1200))]);
          const others = Object.keys(ch.presenceState()).filter((k) => k !== keyRef.current).length;
          if (others >= ROOM_CAP) {
            await client.removeChannel(ch);
            continue;
          }
          if (cancelled) {
            await client.removeChannel(ch);
            return;
          }
          chRef.current = ch;
          await ch.track(stateRef.current);
          lastTrack.current = Date.now();
          const lobby = client.channel('plaza:lobby', { config: { presence: { key: keyRef.current } } });
          await subscribe(lobby).catch(() => {});
          void lobby.track({ room: n });
          lobbyRef.current = lobby;
          setRoom(n);
          setStatus('live');
          return;
        }
        setStatus('solo');
      } catch {
        if (!cancelled) setStatus('solo');
      }
    })();

    return () => {
      cancelled = true;
      if (pendingTrack.current) clearTimeout(pendingTrack.current);
      const c = client;
      const ch = chRef.current;
      const lobby = lobbyRef.current;
      chRef.current = null;
      lobbyRef.current = null;
      if (c) {
        if (ch) void c.removeChannel(ch);
        if (lobby) void c.removeChannel(lobby);
        for (const e of events) void c.removeChannel(e);
      }
    };
    // the room connection depends only on who I am, not on where I stand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey]);

  const moveTo = useCallback((i: number, j: number) => {
    setPos({ i, j });
    track({ i, j });
  }, [track]);

  const emote = useCallback((id: EmoteId) => {
    const at = Date.now();
    setMyEmote({ id, until: at + EMOTE_MS });
    track({ emote: id, emoteAt: at });
  }, [track]);

  // drop finished bubbles
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setMyEmote((e) => (e && e.until < now ? null : e));
      setPeers((ps) => (ps.some((p) => p.emoteUntil && p.emoteUntil < now) ? ps.map((p) => (p.emoteUntil && p.emoteUntil < now ? { ...p, emoteUntil: 0 } : p)) : ps));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return { status, room, peers, pos, moveTo, emote, myEmote, celebration, clearCelebration: () => setCelebration(null) };
}

/** Headcount for the home screen: listens to the lobby without joining a room. */
export function usePlazaCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isConfigured) return;
    const client = supabase();
    const ch = client.channel('plaza:lobby');
    ch.on('presence', { event: 'sync' }, () => setCount(Object.keys(ch.presenceState()).length));
    ch.subscribe();
    return () => {
      void client.removeChannel(ch);
    };
  }, []);
  return count;
}
