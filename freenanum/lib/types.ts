// Shapes returned by the database functions (supabase/migrations/*_api.sql).

export type StickerCode = 'MISSION' | 'GENERAL' | string;
export type PostKind = 'GIVEAWAY' | 'SWAP' | 'REQUEST';
export type PostStatus = 'open' | 'selecting' | 'in_progress' | 'done' | 'canceled' | 'expired';
export type Method = 'random' | 'quiz' | 'rps' | 'manual';
export type TradeStatus =
  | 'proposed' | 'accepted' | 'ready' | 'transfer_in_progress' | 'awaiting_receipt' | 'completed'
  | 'disputed' | 'resolved_completed' | 'resolved_unfulfilled' | 'closed_unresolved'
  | 'rejected' | 'expired' | 'canceled';

export interface Level {
  level: number;
  name: string;
  min: number;
  deco: string;
  given: number;
  next: { level: number; name: string; min: number; deco: string } | null;
}

export interface Badge {
  user_id?: string;
  nickname: string;
  level: Level;
  completed_trades: number;
  unfulfilled: number;
  threads: { handle: string; verified: boolean } | null;
  restricted: boolean;
}

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  brand: string;
  starts_at: string;
  ends_at: string;
  status: string;
  completion_rule: { mission?: number; total?: number };
  official_url: string | null;
  notice: string;
}

export interface Bootstrap {
  server_time: string;
  campaign: Campaign | null;
  sticker_types: { code: StickerCode; name: string }[];
  settings: Record<string, unknown>;
}

export interface Me {
  user_id: string;
  needs_profile: boolean;
  nickname?: string;
  role?: 'member' | 'admin';
  account_status?: 'active' | 'restricted' | 'suspended';
  restricted_until?: string | null;
  created_at?: string;
  badge?: Badge;
  progress?: { given: number; received: number; swaps: number };
  unread_notifications?: number;
  action_needed?: number;
  threads?: { handle: string; status: 'unverified' | 'pending' | 'verified' | 'rejected'; verify_code: string | null } | null;
}

export interface PostItem {
  direction: 'offer' | 'want';
  code: StickerCode;
  name: string;
  quantity: number;
}

export interface PostCard {
  id: string;
  code: string;
  is_mine?: boolean;
  kind: PostKind;
  title: string;
  status: PostStatus;
  visibility: 'public' | 'hidden_by_author' | 'hidden_by_admin';
  closes_at: string;
  created_at: string;
  author: { nickname: string; level: Level };
  items: PostItem[];
  giveaway: {
    method: Method;
    per_winner_quantity: number;
    winners_count: number;
    state: 'open' | 'drawn' | 'canceled';
    entries_count: number;
  } | null;
}

export interface DrawWinner {
  rank: number;
  role: 'winner' | 'reserve';
  rps_wins: number | null;
  promoted: boolean;
  nickname: string;
  is_me: boolean;
  trade_status: TradeStatus | null;
}

export interface GiveawayDetail {
  method: Method;
  sticker: { code: StickerCode; name: string };
  total_quantity: number;
  per_winner_quantity: number;
  winners_count: number;
  reserve_count: number;
  opens_at: string;
  closes_at: string;
  claim_hours: number;
  quiz_question: string | null;
  quiz_options: string[] | null;
  quiz_zero_policy: 'cancel' | 'draw_all' | null;
  quiz_commitment: string | null;
  rps_commitment: string | null;
  rules_hash: string;
  state: 'open' | 'drawn' | 'canceled';
  canceled_reason: string | null;
  entries_count: number;
  my_entry: {
    status: 'active' | 'withdrawn' | 'invalid';
    quiz_choice: number | null;
    rps_choices: string | null;
    quiz_correct: boolean | null;
    rps_wins: number | null;
    created_at: string;
  } | null;
  my_result: { role: 'winner' | 'reserve'; rank: number; promoted: boolean; trade_id: string | null } | null;
  draw: {
    executed_at: string;
    method: Method;
    manual: boolean;
    entries_count: number;
    eligible_count: number;
    eligible_hash: string;
    seed: string | null;
    revealed_nonce: string | null;
    revealed_quiz_answer: number | null;
    revealed_rps_moves: string | null;
    outcome: 'drawn' | 'no_entries' | 'no_correct_canceled' | 'no_correct_draw_all';
    ordering: string;
    winners: DrawWinner[];
  } | null;
  entrants: { user_id: string; nickname: string; badge: Badge }[] | null;
}

export interface PostDetail extends Omit<PostCard, 'giveaway' | 'author'> {
  body: string;
  status_note: string | null;
  author: Omit<Badge, 'user_id'>;
  is_author: boolean;
  blocked: boolean;
  giveaway?: GiveawayDetail;
  my_trade?: { id: string; status: TradeStatus } | null;
  trades?: { id: string; status: TradeStatus; counterpart: string; created_at?: string }[] | null;
  active_trades_count?: number;
}

export interface TradeParticipant {
  user_id: string;
  nickname: string;
  role: 'giver' | 'receiver' | 'swapper';
  sends: boolean;
  receives: boolean;
  is_me: boolean;
  threads_handle: string | null;
  accepted_at: string | null;
  peer_confirmed_at: string | null;
  barcode_ready_at: string | null;
  barcode_opened_at: string | null;
  sent_declared_at: string | null;
  receipt_confirmed_at: string | null;
  badge: Badge;
}

export interface TradeEvent {
  id: number;
  type: string;
  actor: string | null;
  at: string;
  meta: Record<string, unknown>;
}

export interface TradeDetail {
  id: string;
  trade_no: number;
  kind: 'giveaway' | 'swap';
  origin: 'draw' | 'manual_pick' | 'request_offer' | 'swap_proposal';
  status: TradeStatus;
  stage_deadline_at: string | null;
  deadline_passed: boolean;
  dispute_reason: string | null;
  close_reason: string | null;
  official_transfer_verified: false;
  created_at: string;
  completed_at: string | null;
  closed_at: string | null;
  post: { code: string; title: string; kind: PostKind } | null;
  me: {
    role: 'giver' | 'receiver' | 'swapper';
    sends: boolean;
    receives: boolean;
    threads_handle: string | null;
    accepted_at: string | null;
    peer_confirmed_at: string | null;
    barcode_ready_at: string | null;
    barcode_opened_at: string | null;
    sent_declared_at: string | null;
    receipt_confirmed_at: string | null;
  } | null;
  participants: TradeParticipant[];
  items: { seq: number; sender_id: string; receiver_id: string; sender: string; receiver: string; code: StickerCode; name: string; quantity: number }[];
  events: TradeEvent[];
  my_barcode: { submitted: boolean; last4: string | null; view_count: number; purged: boolean; last_viewed_at: string | null } | null;
  barcode_view_limit: number;
  can: Partial<Record<'submit_info' | 'confirm_peer' | 'reveal_barcode' | 'declare_sent' | 'confirm_receipt' | 'cancel' | 'report', boolean>>;
}

export interface TradeListItem {
  id: string;
  trade_no: number;
  kind: 'giveaway' | 'swap';
  status: TradeStatus;
  my_role: 'giver' | 'receiver' | 'swapper';
  sends: boolean;
  receives: boolean;
  stage_deadline_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  post: { code: string; title: string } | null;
  counterpart: string | null;
  items: { code: StickerCode; name: string; quantity: number; direction: 'give' | 'get' }[];
  needs_action: boolean;
}

export interface Summary {
  campaign: { given: number; received: number; swaps: number; level: Level } | null;
  all_time: { given: number; received: number; swaps: number };
  trades: { active: number; done: number; problem: number; total: number };
  progress_events: { kind: string; delta: number; at: string; trade_id: string; note: string | null }[];
}

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface ReportItem {
  report_no: number;
  target_kind: 'post' | 'trade' | 'user';
  reason: string;
  status: 'received' | 'reviewing' | 'resolved' | 'rejected';
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  trade_id: string | null;
  post_code: string | null;
}

export type ReportReason =
  | 'not_sent' | 'not_received' | 'no_response' | 'barcode_misuse' | 'fake_trade'
  | 'abuse' | 'spam' | 'commercial' | 'other';

/** A counterpart saved automatically when I confirmed their Threads ID in a trade. */
export interface SavedContact {
  contact_id: string;
  nickname: string;
  threads_handle: string | null;
  first_confirmed_at: string;
  last_confirmed_at: string;
  last_trade: { id: string; trade_no: number; status: TradeStatus; kind: 'giveaway' | 'swap'; post_title: string | null } | null;
  trades_together: number;
  blocked: boolean;
  badge: Omit<Badge, 'user_id'>;
}
