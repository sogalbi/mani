import type { TradeDetail, TradeListItem, TradeParticipant, TradeStatus } from '@/lib/types';

export const tradeNo = (n: number) => `TR-${String(n).padStart(6, '0')}`;

export function tradeKindLabel(t: Pick<TradeListItem, 'kind' | 'my_role'>): string {
  if (t.kind === 'swap') return '교환';
  return t.my_role === 'giver' ? '나눔 하기' : '나눔 받기';
}

export const OPEN_STATUSES: TradeStatus[] = ['proposed', 'accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt'];
export const isOpen = (s: TradeStatus) => OPEN_STATUSES.includes(s);

// Fields added by the Threads-ID flow (submit_trade_info → confirm_peer).
export type Peer = TradeParticipant & { threads_handle?: string | null; peer_confirmed_at?: string | null };
export const peers = (t: TradeDetail) => (t.participants ?? []) as Peer[];
export const myself = (t: TradeDetail) => peers(t).find((p) => p.is_me) ?? null;
export const canFlags = (t: TradeDetail) => (t.can ?? {}) as Record<string, boolean | undefined>;
export const threadsUrl = (handle: string) => `https://www.threads.net/@${encodeURIComponent(handle)}`;

/** Did this participant finish the info step (Threads ID, plus barcode if they receive)? */
export const infoDone = (p: Peer) => Boolean(p.threads_handle) && (!p.receives || Boolean(p.barcode_ready_at));

export const TRADE_RISK_TEXT =
  '전송한 e-스티커는 회수하기 어려우며, 상대방이 약속한 스티커를 보내지 않거나 응답하지 않을 위험이 있습니다. 거래 조건을 확인하고 신중하게 진행해 주세요. 프리나눔의 기록·신고 기능이 스티커의 회수나 반환을 보장하지는 않습니다.';

export const BARCODE_TEXT =
  '바코드 번호는 해당 나눔·교환 거래에서 스티커를 보내는 상대에게 제한적으로 제공됩니다. 상대가 한번 열람한 정보는 회수할 수 없으니 신중하게 제공해 주세요.';

export const STAGES = ['정보 입력', '서로 확인', '전송', '수령 확인', '완료'] as const;

/** How many of the five stages are done, from participant flags (works for every status). */
export function stagesDone(t: TradeDetail): number {
  const p = peers(t);
  const senders = p.filter((x) => x.sends);
  const receivers = p.filter((x) => x.receives);
  const checks = [
    p.length > 0 && p.every(infoDone),
    p.length > 0 && p.every((x) => x.peer_confirmed_at),
    senders.every((x) => x.sent_declared_at),
    receivers.every((x) => x.receipt_confirmed_at),
  ];
  let n = 0;
  for (const c of checks) {
    if (!c) break;
    n++;
  }
  if (n === 4 && (t.status === 'completed' || t.status === 'resolved_completed')) n = 5;
  return n;
}

/** Friendly text for what the other side still has to do, when I have nothing to do. */
export function waitingText(t: TradeDetail): string | null {
  const me = myself(t);
  if (!t.me || !me || !isOpen(t.status)) return null;
  const others = peers(t).filter((p) => !p.is_me);
  if (t.status === 'proposed' && infoDone(me)) {
    const pending = others.filter((o) => !infoDone(o));
    if (pending.length)
      return `${pending.map((o) => o.nickname).join(', ')}님이 스레드 아이디${pending.some((o) => o.receives) ? '와 바코드' : ''}를 입력하길 기다리고 있어요.`;
  }
  if (t.status === 'accepted' && me.peer_confirmed_at) {
    const pending = others.filter((o) => !o.peer_confirmed_at);
    if (pending.length) return `${pending.map((o) => o.nickname).join(', ')}님이 내 스레드 아이디를 확인하길 기다리고 있어요.`;
  }
  if (t.status === 'ready' || t.status === 'transfer_in_progress') {
    const toMe = t.items.filter((i) => i.receiver_id === me.user_id).map((i) => i.sender_id);
    const pending = others.filter((p) => toMe.includes(p.user_id) && !p.sent_declared_at);
    if (me.receives && pending.length > 0)
      return `${pending.map((p) => p.nickname).join(', ')}님이 공식 앱에서 선물하고 "보냈어요"를 누르면 알려 드릴게요.`;
  }
  if (me.sends && me.sent_declared_at && others.some((o) => o.receives && !o.receipt_confirmed_at))
    return '받는 분의 수령 확인을 기다리고 있어요. 기한 안에 확인이 없으면 자동으로 완료되지 않고 운영자 확인(분쟁)으로 넘어가요.';
  if (me.receives && me.receipt_confirmed_at) return '나는 수령 확인을 마쳤어요. 상대의 확인을 기다리고 있어요.';
  return null;
}
