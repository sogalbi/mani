import type { Method, PostKind, PostStatus, ReportReason, TradeStatus } from './types';

const KST = 'Asia/Seoul';

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: KST, year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

/** "3시간 12분 남음" / "마감" */
export function fmtRemaining(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '기한 지남';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  if (h > 0) return `${h}시간 ${m}분 남음`;
  return `${Math.max(m, 1)}분 남음`;
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const sec = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

export const KIND_LABEL: Record<PostKind, string> = {
  GIVEAWAY: '무료 나눔',
  SWAP: '교환',
  REQUEST: '나눔 요청',
};

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  open: '모집 중',
  selecting: '선정 중',
  in_progress: '전달 중',
  done: '완료',
  canceled: '취소',
  expired: '마감',
};

export const METHOD_LABEL: Record<Method, string> = {
  random: '랜덤 추첨',
  quiz: '퀴즈 + 정답자 추첨',
  rps: '가위바위보 4판',
  manual: '나눔자 직접 선정',
};

export const METHOD_HELP: Record<Method, string> = {
  random: '마감 뒤 서버가 신청자 중에서 무작위로 뽑아요.',
  quiz: '정답을 맞힌 사람 중에서 서버가 무작위로 뽑아요. 정답은 마감 전까지 비공개예요.',
  rps: '가위·바위·보 4판을 미리 내요. 상대 패는 서버가 미리 정해 두었고(해시 공개), 마감 뒤 공개돼요. 가장 많이 이긴 사람들 중에서 무작위로 뽑아요.',
  manual: '마감 뒤 나눔자가 신청자 중에서 직접 골라요. 무작위 추첨이 아니에요.',
};

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  proposed: '정보 입력 대기',
  accepted: '서로 확인 대기',
  ready: '전송 대기',
  transfer_in_progress: '전송 중',
  awaiting_receipt: '수령 확인 대기',
  completed: '완료',
  disputed: '확인 필요(분쟁)',
  resolved_completed: '운영자 확인: 완료',
  resolved_unfulfilled: '운영자 확인: 미이행',
  closed_unresolved: '운영자 종료',
  rejected: '거절됨',
  expired: '기한 만료',
  canceled: '취소됨',
};

export type Tone = 'neutral' | 'green' | 'yellow' | 'red' | 'gray';

export function tradeTone(s: TradeStatus): Tone {
  if (s === 'completed' || s === 'resolved_completed') return 'green';
  if (s === 'disputed' || s === 'resolved_unfulfilled') return 'red';
  if (s === 'rejected' || s === 'expired' || s === 'canceled' || s === 'closed_unresolved') return 'gray';
  return 'yellow';
}

export function postTone(s: PostStatus): Tone {
  if (s === 'open') return 'green';
  if (s === 'selecting' || s === 'in_progress') return 'yellow';
  return 'gray';
}

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  not_sent: '약속한 스티커를 보내지 않아요',
  not_received: '보냈다는데 받지 못했어요',
  no_response: '연락·응답이 없어요',
  barcode_misuse: '바코드를 다른 곳에 쓴 것 같아요',
  fake_trade: '허위 거래로 보여요',
  abuse: '욕설·괴롭힘',
  spam: '도배·광고',
  commercial: '현금 거래·판매 유도',
  other: '기타',
};

export const DISPUTE_REASON_LABEL: Record<string, string> = {
  receipt_unconfirmed: '전송 신고 뒤 수령 확인이 기한 안에 없었어요',
  partial_sent_timeout: '한쪽만 전송 신고하고 기한이 지났어요',
  ...REPORT_REASON_LABEL,
};

export const EVENT_LABEL: Record<string, string> = {
  trade_created: '거래가 만들어졌어요',
  info_submitted: '스레드 아이디 입력 (받는 분 바코드는 암호화 저장)',
  info_updated: '거래 정보 수정 (서로 확인 다시)',
  peer_confirmed: '상대 스레드 아이디 확인',
  barcode_opened: '보내는 사람이 바코드를 열람',
  sent_declared: '보냈다고 신고',
  receipt_confirmed: '받았다고 확인',
  status_changed: '상태 변경',
  deadline_passed: '기한 지남',
  unfulfilled_by_sender: '보내는 사람 미이행 기록',
  cancel_requested: '취소',
  problem_reported: '문제 신고',
  admin_resolution: '운영자 처리',
};

export const ROLE_LABEL = { giver: '나눔자', receiver: '받는 사람', swapper: '교환 상대' } as const;

export function stickerSummary(items: { code: string; name: string; quantity: number }[]): string {
  return items.map((i) => `${i.name} ${i.quantity}장`).join(' + ');
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
}
