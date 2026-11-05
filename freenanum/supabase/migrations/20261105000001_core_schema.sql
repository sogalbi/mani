-- 프리나눔 core schema
-- Every write goes through the server functions in the next migrations.
-- Clients never insert/update these tables directly (see 20261105000004_security.sql).

create extension if not exists pgcrypto with schema extensions;

-- Server-only objects (secrets, hidden answers, barcode ciphertext, access logs).
-- This schema is not exposed by the API and anon/authenticated get no usage on it.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Settings and seasons
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]{3,40}$'),
  name text not null,
  brand text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('upcoming', 'active', 'ended')),
  completion_rule jsonb not null default '{}'::jsonb,
  official_url text,
  notice text not null default '',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.sticker_types (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id),
  code text not null check (code ~ '^[A-Z_]{2,20}$'),
  name text not null,
  sort_order int not null default 0,
  unique (campaign_id, code)
);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id),
  nickname text not null check (char_length(nickname) between 2 and 12 and nickname ~ '^[가-힣A-Za-z0-9_.]+$'),
  role text not null default 'member' check (role in ('member', 'admin')),
  account_status text not null default 'active' check (account_status in ('active', 'restricted', 'suspended')),
  restricted_until timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_nickname_key on public.profiles (lower(nickname));

create table public.blocks (
  blocker_id uuid not null references public.profiles (user_id),
  blocked_id uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Optional Threads link. "verified" only means "owns this Threads account".
create table public.threads_profiles (
  user_id uuid primary key references public.profiles (user_id),
  handle text not null check (handle ~ '^[A-Za-z0-9_.]{1,30}$'),
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'rejected')),
  verify_code text,
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles (user_id),
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id),
  consent_type text not null check (consent_type in ('terms', 'privacy', 'trade_risk', 'barcode_provision')),
  policy_version text not null,
  trade_id uuid,
  accepted_at timestamptz not null default now()
);
create index consent_records_user_idx on public.consent_records (user_id, consent_type);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9]{8}$'),
  campaign_id uuid not null references public.campaigns (id),
  author_id uuid not null references public.profiles (user_id),
  kind text not null check (kind in ('GIVEAWAY', 'SWAP', 'REQUEST')),
  title text not null check (char_length(title) between 2 and 60),
  body text not null default '' check (char_length(body) <= 1000),
  -- open → selecting (giveaway closed, not drawn) → in_progress → done | canceled | expired
  status text not null default 'open' check (status in ('open', 'selecting', 'in_progress', 'done', 'canceled', 'expired')),
  visibility text not null default 'public' check (visibility in ('public', 'hidden_by_author', 'hidden_by_admin')),
  closes_at timestamptz not null,
  status_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_list_idx on public.posts (campaign_id, visibility, created_at desc);
create index posts_author_idx on public.posts (author_id, created_at desc);

create table public.post_items (
  post_id uuid not null references public.posts (id),
  sticker_type_id uuid not null references public.sticker_types (id),
  direction text not null check (direction in ('offer', 'want')),
  quantity int not null check (quantity between 1 and 50),
  primary key (post_id, sticker_type_id, direction)
);

-- ---------------------------------------------------------------------------
-- Giveaway engine
-- ---------------------------------------------------------------------------

create table public.giveaway_events (
  post_id uuid primary key references public.posts (id),
  method text not null check (method in ('random', 'quiz', 'rps', 'manual')),
  sticker_type_id uuid not null references public.sticker_types (id),
  total_quantity int not null check (total_quantity between 1 and 50),
  per_winner_quantity int not null check (per_winner_quantity between 1 and 17),
  winners_count int not null check (winners_count between 1 and 50),
  reserve_count int not null check (reserve_count between 0 and 20),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  claim_hours int not null check (claim_hours between 1 and 72),
  quiz_question text,
  quiz_options jsonb,
  quiz_zero_policy text check (quiz_zero_policy in ('cancel', 'draw_all')),
  -- sha256 commitments published before entries open (see private.giveaway_secrets)
  quiz_commitment text,
  rps_commitment text,
  rules_snapshot jsonb not null,
  rules_hash text not null,
  state text not null default 'open' check (state in ('open', 'drawn', 'canceled')),
  canceled_reason text,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at),
  check (winners_count * per_winner_quantity <= total_quantity),
  check (method <> 'quiz' or (quiz_question is not null and quiz_options is not null and quiz_zero_policy is not null and quiz_commitment is not null)),
  check (method <> 'rps' or rps_commitment is not null)
);

-- Hidden until the draw. Never readable by clients.
create table private.giveaway_secrets (
  post_id uuid primary key references public.giveaway_events (post_id),
  quiz_answer int,
  rps_moves text check (rps_moves ~ '^[RPS]{4}$'),
  nonce text not null,
  created_at timestamptz not null default now()
);

create table public.giveaway_entries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.giveaway_events (post_id),
  user_id uuid not null references public.profiles (user_id),
  status text not null default 'active' check (status in ('active', 'withdrawn', 'invalid')),
  quiz_choice int,
  rps_choices text check (rps_choices ~ '^[RPS]{4}$'),
  -- filled in by the draw
  quiz_correct boolean,
  rps_wins int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table public.giveaway_draws (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.giveaway_events (post_id),
  method text not null,
  executed_at timestamptz not null default now(),
  executed_by uuid references public.profiles (user_id),
  entries_count int not null,
  eligible_count int not null,
  eligible_hash text not null,
  seed text,
  revealed_nonce text,
  revealed_quiz_answer int,
  revealed_rps_moves text,
  details jsonb not null default '{}'::jsonb
);

create table public.giveaway_winners (
  post_id uuid not null references public.giveaway_events (post_id),
  draw_id uuid not null references public.giveaway_draws (id),
  rank int not null check (rank >= 1),
  user_id uuid not null references public.profiles (user_id),
  role text not null check (role in ('winner', 'reserve')),
  rps_wins int,
  promoted_at timestamptz,
  trade_id uuid,
  primary key (post_id, rank),
  unique (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Trades (giveaway hand-offs and swaps share one state machine)
-- ---------------------------------------------------------------------------

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  trade_no bigint generated always as identity unique,
  kind text not null check (kind in ('giveaway', 'swap')),
  campaign_id uuid not null references public.campaigns (id),
  post_id uuid references public.posts (id),
  origin text not null check (origin in ('draw', 'manual_pick', 'request_offer', 'swap_proposal')),
  status text not null default 'proposed' check (status in (
    'proposed', 'accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt', 'completed',
    'disputed', 'resolved_completed', 'resolved_unfulfilled', 'closed_unresolved',
    'rejected', 'expired', 'canceled')),
  stage_deadline_at timestamptz,
  dispute_reason text,
  close_reason text,
  -- Users only declare transfers. Nothing here is verified against the official app.
  official_transfer_verified boolean not null default false check (official_transfer_verified = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz
);
create index trades_status_idx on public.trades (status, stage_deadline_at);
create index trades_post_idx on public.trades (post_id);

alter table public.giveaway_winners
  add constraint giveaway_winners_trade_fk foreign key (trade_id) references public.trades (id);

create table public.trade_participants (
  trade_id uuid not null references public.trades (id),
  user_id uuid not null references public.profiles (user_id),
  role text not null check (role in ('giver', 'receiver', 'swapper')),
  sends boolean not null,
  receives boolean not null,
  accepted_at timestamptz,
  barcode_ready_at timestamptz,
  barcode_opened_at timestamptz,
  sent_declared_at timestamptz,
  receipt_confirmed_at timestamptz,
  primary key (trade_id, user_id)
);
create index trade_participants_user_idx on public.trade_participants (user_id);

-- Snapshot of agreed terms. Never changes after the trade is created.
create table public.trade_items (
  trade_id uuid not null references public.trades (id),
  seq int not null,
  sender_id uuid not null references public.profiles (user_id),
  receiver_id uuid not null references public.profiles (user_id),
  sticker_type_id uuid not null references public.sticker_types (id),
  quantity int not null check (quantity between 1 and 50),
  primary key (trade_id, seq),
  check (sender_id <> receiver_id)
);

-- Append-only timeline. Updates and deletes are blocked by trigger.
create table public.trade_events (
  id bigint generated always as identity primary key,
  trade_id uuid not null references public.trades (id),
  actor_id uuid references public.profiles (user_id),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  idempotency_key text,
  unique (trade_id, idempotency_key)
);
create index trade_events_trade_idx on public.trade_events (trade_id, id);

-- Barcode numbers: encrypted, only revealed to the matching sender via public.reveal_barcode.
create table private.barcode_secrets (
  trade_id uuid not null references public.trades (id),
  owner_id uuid not null references public.profiles (user_id),
  ciphertext bytea,
  last4 text,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  purged_at timestamptz,
  primary key (trade_id, owner_id)
);

-- Who opened which barcode and when. Never stores the number itself.
create table private.barcode_access_logs (
  id bigint generated always as identity primary key,
  trade_id uuid not null,
  owner_id uuid not null,
  accessor_id uuid,
  result text not null,
  accessed_at timestamptz not null default now()
);
create index barcode_access_logs_trade_idx on private.barcode_access_logs (trade_id, owner_id);

-- ---------------------------------------------------------------------------
-- Safety, notifications, growth, audit
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  report_no bigint generated always as identity unique,
  reporter_id uuid not null references public.profiles (user_id),
  target_kind text not null check (target_kind in ('post', 'trade', 'user')),
  post_id uuid references public.posts (id),
  trade_id uuid references public.trades (id),
  target_user_id uuid references public.profiles (user_id),
  reason text not null check (reason in (
    'not_sent', 'not_received', 'no_response', 'barcode_misuse', 'fake_trade',
    'abuse', 'spam', 'commercial', 'other')),
  detail text not null default '' check (char_length(detail) <= 1000),
  status text not null default 'received' check (status in ('received', 'reviewing', 'resolved', 'rejected')),
  resolution text,
  resolved_by uuid references public.profiles (user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id),
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, id desc);

create table public.member_progress (
  user_id uuid not null references public.profiles (user_id),
  campaign_id uuid not null references public.campaigns (id),
  given_count int not null default 0,
  received_count int not null default 0,
  swap_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create table public.progress_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id),
  campaign_id uuid not null references public.campaigns (id),
  source_trade_id uuid not null references public.trades (id),
  event_kind text not null check (event_kind in (
    'giveaway_given', 'giveaway_received', 'swap_completed',
    'revoke_giveaway_given', 'revoke_giveaway_received', 'revoke_swap_completed')),
  delta int not null,
  note text,
  created_by uuid references public.profiles (user_id),
  created_at timestamptz not null default now(),
  unique (source_trade_id, user_id, event_kind)
);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (user_id),
  action text not null,
  target_kind text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Append-only guards
-- ---------------------------------------------------------------------------

create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'APPEND_ONLY' using errcode = 'P0001', detail = tg_table_name;
end;
$$;

create trigger trade_events_append_only before update or delete on public.trade_events
  for each row execute function private.forbid_change();
create trigger progress_events_append_only before update or delete on public.progress_events
  for each row execute function private.forbid_change();
create trigger admin_audit_logs_append_only before update or delete on public.admin_audit_logs
  for each row execute function private.forbid_change();
create trigger consent_records_append_only before update or delete on public.consent_records
  for each row execute function private.forbid_change();
create trigger barcode_access_logs_append_only before update or delete on private.barcode_access_logs
  for each row execute function private.forbid_change();
create trigger giveaway_draws_immutable before update or delete on public.giveaway_draws
  for each row execute function private.forbid_change();
create trigger trade_items_immutable before update or delete on public.trade_items
  for each row execute function private.forbid_change();
