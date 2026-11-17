import { supabase } from './supabase';

/** Korean text for the error codes raised by the database functions. */
const MESSAGES: Record<string, string> = {
  LOGIN_REQUIRED: '로그인이 필요해요.',
  PROFILE_REQUIRED: '닉네임을 먼저 정해 주세요.',
  PROFILE_EXISTS: '이미 가입되어 있어요.',
  ACCOUNT_SUSPENDED: '이용이 정지된 계정이에요. 도움말의 문의 경로로 알려 주세요.',
  ACCOUNT_RESTRICTED: '이용이 제한된 계정이라 새 참여는 할 수 없어요. 진행 중인 거래는 마무리할 수 있어요.',
  ADMIN_ONLY: '운영자만 할 수 있어요.',
  NO_ACTIVE_CAMPAIGN: '지금은 진행 중인 시즌이 없어요.',
  INVALID_STICKER_TYPE: '스티커 종류를 다시 골라 주세요.',
  CONSENT_REQUIRED: '안내를 확인하고 동의해 주세요.',
  NICKNAME_INVALID: '닉네임은 2~12자, 한글·영문·숫자·_ . 만 쓸 수 있어요.',
  NICKNAME_TAKEN: '이미 쓰고 있는 닉네임이에요.',
  NOT_FOUND: '찾을 수 없어요. 삭제됐거나 볼 수 없는 내용이에요.',
  INVALID_TITLE: '제목은 2~60자로 써 주세요.',
  INVALID_BODY: '설명은 1,000자까지 쓸 수 있어요.',
  INVALID_METHOD: '선정 방식을 골라 주세요.',
  INVALID_QUANTITY: '장수를 다시 확인해 주세요.',
  INVALID_CLAIM_HOURS: '수령 확인 시간은 1~72시간 사이로 정해 주세요.',
  INVALID_CLOSING_TIME: '마감 시각은 지금부터 10분 뒤 ~ 7일 안, 시즌 종료 전이어야 해요.',
  TOO_MANY_OPEN_POSTS: '동시에 열어 둘 수 있는 글 수를 넘었어요. 기존 글을 마감한 뒤 올려 주세요.',
  INVALID_QUIZ: '퀴즈 문제·보기(2~5개)·정답을 확인해 주세요.',
  INVALID_SWAP_TERMS: '주는 스티커와 받고 싶은 스티커를 하나 이상 넣어 주세요.',
  CANCEL_GIVEAWAY_FIRST: '신청자가 있는 나눔은 먼저 사유를 적어 취소해 주세요.',
  OWN_POST: '내 글에는 참여할 수 없어요.',
  ENTRY_CLOSED: '모집이 끝났어요.',
  BLOCKED: '차단 관계인 사용자와는 참여·거래할 수 없어요.',
  INVALID_QUIZ_CHOICE: '보기를 하나 골라 주세요.',
  INVALID_RPS_CHOICES: '가위·바위·보 4판을 모두 골라 주세요.',
  ALREADY_ENTERED: '이미 신청했어요.',
  REENTRY_NOT_ALLOWED: '퀴즈·가위바위보 나눔은 신청을 취소한 뒤 다시 참여할 수 없어요.',
  NOT_ENTERED: '신청 내역이 없어요.',
  DRAW_TOO_EARLY: '아직 모집 중이에요. 마감 뒤에 추첨돼요.',
  GIVEAWAY_CANCELED: '취소된 나눔이에요.',
  MANUAL_SELECTION_REQUIRED: '직접 선정 방식이라 나눔자가 고르면 결과가 나와요.',
  NOT_MANUAL: '직접 선정 방식이 아니에요.',
  ALREADY_DRAWN: '이미 추첨(선정)이 끝났어요.',
  INVALID_SELECTION: '신청자 중에서 정해진 인원 안으로 골라 주세요.',
  REASON_REQUIRED: '사유를 적어 주세요.',
  POST_CLOSED: '마감된 글이에요.',
  ALREADY_OFFERED: '이미 이 요청에 나눔을 제안했어요.',
  ALREADY_PROPOSED: '이미 교환을 제안했어요.',
  TOO_MANY_ACTIVE_SWAPS: '동시에 진행할 수 있는 교환 수를 넘었어요. 진행 중인 교환을 먼저 마무리해 주세요.',
  INVALID_STATE: '지금 단계에서는 할 수 없어요. 화면을 새로 고쳐 주세요.',
  NOT_RECEIVER: '받는 사람만 할 수 있어요.',
  NOT_SENDER: '보내는 사람만 할 수 있어요.',
  ACCEPT_FIRST: '먼저 거래 조건을 수락해 주세요.',
  INVALID_BARCODE: '바코드 번호는 숫자 8~24자리예요.',
  BARCODE_LOCKED: '상대가 이미 열람한 바코드는 바꿀 수 없어요. 문제가 있으면 신고해 주세요.',
  BARCODE_KEY_MISSING: '서버 설정 문제로 바코드를 처리할 수 없어요. 운영자에게 알려 주세요.',
  BARCODE_NOT_SENDER: '이 거래에서 보내는 사람만 바코드를 볼 수 있어요.',
  BARCODE_NOT_SENDER_FOR_OWNER: '이 거래에서 보내는 사람만 바코드를 볼 수 있어요.',
  BARCODE_SUSPENDED: '이용이 정지된 계정은 바코드를 볼 수 없어요.',
  BARCODE_NOT_READY: '받는 분이 아직 바코드를 입력하지 않았어요.',
  BARCODE_ALREADY_SENT: '전송 신고 후에는 바코드를 다시 볼 수 없어요.',
  BARCODE_MISSING: '바코드가 없거나 이미 삭제됐어요.',
  BARCODE_VIEW_LIMIT: '바코드 열람 횟수를 모두 썼어요. 문제가 있으면 신고해 주세요.',
  SENDER_NOT_DECLARED: '상대가 아직 전송 신고를 하지 않았어요.',
  CANNOT_CANCEL_NOW: '전송이 시작된 거래는 취소할 수 없어요. 문제가 있으면 신고해 주세요.',
  TOO_MANY_REPORTS: '오늘 신고 접수 한도를 넘었어요.',
  INVALID_TARGET: '신고 대상을 확인해 주세요.',
  INVALID_HANDLE: '스레드 아이디는 영문·숫자·_ . 30자 이내예요.',
  INVALID_STATUS: '상태 값을 확인해 주세요.',
  APPEND_ONLY: '기록은 수정하거나 지울 수 없어요.',
  NOT_CONFIGURED: '서버 연결 설정이 아직 없어요. (.env 확인)',
};

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && MESSAGES[err.message]) return MESSAGES[err.message];
  if (err instanceof Error && /fetch|network/i.test(err.message)) return '네트워크 연결을 확인해 주세요.';
  return '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
}

export function toApiError(code: string): ApiError {
  return new ApiError(code, MESSAGES[code] ?? '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.');
}

/** Calls a database function. Throws ApiError with Korean text. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let client;
  try {
    client = supabase();
  } catch {
    throw toApiError('NOT_CONFIGURED');
  }
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : error.code === '42501' ? 'LOGIN_REQUIRED' : 'UNKNOWN';
    if (code === 'UNKNOWN' && process.env.NODE_ENV !== 'production') {
      console.error(fn, error);
    }
    throw toApiError(code);
  }
  return data as T;
}
