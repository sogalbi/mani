-- 프리나눔 engine: private helpers for members, trades, draws and barcodes.
-- Nothing in this file is callable by clients (schema "private" has no client usage).

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

create function private.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex');
$$;

create function private.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  b bytea := extensions.gen_random_bytes(8);
  r text := '';
begin
  for i in 0..7 loop
    r := r || substr(chars, (get_byte(b, i) % length(chars)) + 1, 1);
  end loop;
  return r;
end;
$$;

create function private.setting_int(p_key text, p_default int) returns int
language sql stable set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::int from public.app_settings s where s.key = p_key), p_default);
$$;

create function private.setting_text(p_key text, p_default text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.value #>> '{}' from public.app_settings s where s.key = p_key), p_default);
$$;

create function private.mask_nickname(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when char_length(p) <= 2 then left(p, 1) || '*'
    else left(p, 1) || repeat('*', char_length(p) - 2) || right(p, 1)
  end;
$$;

create function private.nickname(p_user uuid) returns text
language sql stable set search_path = '' as $$
  select nickname from public.profiles where user_id = p_user;
$$;

-- Growth level from confirmed free-giveaway sticker count.
create function private.level_info(p_given int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  levels jsonb := coalesce((select value from public.app_settings where key = 'levels'), '[]'::jsonb);
  cur jsonb := jsonb_build_object('level', 1, 'name', '새싹', 'min', 0, 'deco', '기본 새싹');
  nxt jsonb := null;
  l jsonb;
begin
  for l in select * from jsonb_array_elements(levels) order by (value ->> 'min')::int loop
    if (l ->> 'min')::int <= coalesce(p_given, 0) then
      cur := l;
    elsif nxt is null then
      nxt := l;
    end if;
  end loop;
  return cur || jsonb_build_object('given', coalesce(p_given, 0), 'next', nxt);
end;
$$;

-- ---------------------------------------------------------------------------
-- Members and permissions
-- ---------------------------------------------------------------------------

create function private.current_member(p_allow_restricted boolean default false) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
  p public.profiles;
begin
  if v is null then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;
  select * into p from public.profiles where user_id = v;
  if not found then
    raise exception 'PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p.account_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;
  if p.account_status = 'restricted' and not p_allow_restricted
     and (p.restricted_until is null or p.restricted_until > now()) then
    raise exception 'ACCOUNT_RESTRICTED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create function private.is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = p_user and role = 'admin' and account_status <> 'suspended');
$$;

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not private.is_admin(v) then
    raise exception 'ADMIN_ONLY' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create function private.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create function private.active_campaign() returns public.campaigns
language plpgsql stable set search_path = '' as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns
  where status = 'active' and now() >= starts_at and now() < ends_at
  order by starts_at desc limit 1;
  if not found then
    raise exception 'NO_ACTIVE_CAMPAIGN' using errcode = 'P0001';
  end if;
  return c;
end;
$$;

create function private.sticker_type_id(p_campaign uuid, p_code text) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid;
begin
  select id into v from public.sticker_types where campaign_id = p_campaign and code = p_code;
  if v is null then
    raise exception 'INVALID_STICKER_TYPE' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, p_title, coalesce(p_body, ''), p_link);
$$;

create function private.audit(p_admin uuid, p_action text, p_kind text, p_id text, p_detail jsonb)
returns void language sql set search_path = '' as $$
  insert into public.admin_audit_logs (admin_id, action, target_kind, target_id, detail)
  values (p_admin, p_action, p_kind, p_id, coalesce(p_detail, '{}'::jsonb));
$$;

create function private.record_consent(p_user uuid, p_type text, p_trade uuid)
returns void language sql set search_path = '' as $$
  insert into public.consent_records (user_id, consent_type, policy_version, trade_id)
  values (p_user, p_type, private.setting_text('policy_version_' || p_type, 'draft-1'), p_trade);
$$;

-- ---------------------------------------------------------------------------
-- Barcode encryption (key lives in Supabase Vault, never in code or client)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'freenanum_barcode_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'freenanum_barcode_key',
      'Symmetric key for barcode numbers in private.barcode_secrets');
  end if;
end;
$$;

create function private.barcode_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'freenanum_barcode_key';
  if k is null or length(k) < 32 then
    raise exception 'BARCODE_KEY_MISSING' using errcode = 'P0001';
  end if;
  return k;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trade engine
-- ---------------------------------------------------------------------------

create function private.trade_event(p_trade uuid, p_actor uuid, p_type text, p_meta jsonb default '{}'::jsonb, p_key text default null)
returns boolean language plpgsql set search_path = '' as $$
declare
  n int;
begin
  insert into public.trade_events (trade_id, actor_id, event_type, meta, idempotency_key)
  values (p_trade, p_actor, p_type, coalesce(p_meta, '{}'::jsonb), p_key)
  on conflict (trade_id, idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create function private.is_open_trade_status(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('proposed', 'accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt');
$$;

-- Delete barcode ciphertext as soon as nobody needs it any more.
create function private.purge_barcodes(p_trade uuid) returns void
language plpgsql set search_path = '' as $$
declare
  st text;
begin
  select status into st from public.trades where id = p_trade;
  update private.barcode_secrets b
     set ciphertext = null, purged_at = now()
   where b.trade_id = p_trade and b.purged_at is null
     and (
       st not in ('proposed', 'accepted', 'ready', 'transfer_in_progress')
       or not exists (
         select 1 from public.trade_items i
         join public.trade_participants p on p.trade_id = i.trade_id and p.user_id = i.sender_id
         where i.trade_id = p_trade and i.receiver_id = b.owner_id and p.sent_declared_at is null)
     );
end;
$$;

create function private.grant_progress(p_user uuid, p_campaign uuid, p_trade uuid, p_kind text, p_delta int, p_by uuid, p_note text)
returns boolean language plpgsql set search_path = '' as $$
declare
  n int;
  col text;
begin
  insert into public.progress_events (user_id, campaign_id, source_trade_id, event_kind, delta, created_by, note)
  values (p_user, p_campaign, p_trade, p_kind, p_delta, p_by, p_note)
  on conflict (source_trade_id, user_id, event_kind) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  insert into public.member_progress (user_id, campaign_id) values (p_user, p_campaign)
  on conflict do nothing;
  col := case
    when p_kind in ('giveaway_given', 'revoke_giveaway_given') then 'given_count'
    when p_kind in ('giveaway_received', 'revoke_giveaway_received') then 'received_count'
    else 'swap_count' end;
  execute format(
    'update public.member_progress set %1$I = greatest(0, %1$I + $1), updated_at = now() where user_id = $2 and campaign_id = $3', col)
  using p_delta, p_user, p_campaign;
  return true;
end;
$$;

create function private.refresh_post_status(p_post uuid) returns void
language plpgsql set search_path = '' as $$
declare
  p public.posts;
  ev public.giveaway_events;
  open_trades int;
  new_status text;
begin
  select * into p from public.posts where id = p_post for update;
  if not found or p.status in ('canceled') then
    return;
  end if;
  select count(*) into open_trades from public.trades
   where post_id = p_post and (private.is_open_trade_status(status) or status = 'disputed');

  if p.kind = 'GIVEAWAY' then
    select * into ev from public.giveaway_events where post_id = p_post;
    if ev.state = 'canceled' then
      new_status := 'canceled';
    elsif ev.state = 'open' then
      new_status := case when now() >= ev.closes_at then 'selecting' else 'open' end;
    elsif open_trades > 0 then
      new_status := 'in_progress';
    elsif p.status in ('expired') then
      new_status := p.status;
    else
      new_status := 'done';
    end if;
  elsif p.kind = 'SWAP' then
    if p.status in ('done', 'expired') then
      new_status := p.status;
    elsif exists (select 1 from public.trades where post_id = p_post
                   and status in ('accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt', 'disputed')) then
      new_status := 'in_progress';
    elsif exists (select 1 from public.trades where post_id = p_post and status in ('completed', 'resolved_completed')) then
      new_status := 'done';
    elsif now() >= p.closes_at then
      new_status := 'expired';
    else
      new_status := 'open';
    end if;
  else -- REQUEST
    if p.status in ('done', 'expired') then
      new_status := p.status;
    elsif now() >= p.closes_at then
      new_status := 'expired';
    else
      new_status := 'open';
    end if;
  end if;

  if new_status is distinct from p.status then
    update public.posts set status = new_status, updated_at = now() where id = p_post;
  end if;
end;
$$;

create function private.on_trade_completed(p_trade uuid) returns void
language plpgsql set search_path = '' as $$
declare
  t public.trades;
  it record;
  pa record;
begin
  select * into t from public.trades where id = p_trade;
  if t.kind = 'giveaway' then
    for it in select sender_id, receiver_id, sum(quantity)::int as qty from public.trade_items
              where trade_id = p_trade group by sender_id, receiver_id loop
      perform private.grant_progress(it.sender_id, t.campaign_id, p_trade, 'giveaway_given', it.qty, null, null);
      perform private.grant_progress(it.receiver_id, t.campaign_id, p_trade, 'giveaway_received', it.qty, null, null);
      perform private.notify(it.sender_id, 'trade_completed', '나눔이 완료됐어요',
        format('%s님이 수령을 확인했어요. 나눔 %s장이 기록됐어요.', private.nickname(it.receiver_id), it.qty),
        '/trades/' || p_trade);
    end loop;
  else
    for pa in select user_id from public.trade_participants where trade_id = p_trade loop
      perform private.grant_progress(pa.user_id, t.campaign_id, p_trade, 'swap_completed', 1, null, null);
      perform private.notify(pa.user_id, 'trade_completed', '교환이 완료됐어요',
        '양쪽 모두 수령을 확인했어요.', '/trades/' || p_trade);
    end loop;
  end if;
end;
$$;

create function private.stage_hours(p_status text) returns int
language sql stable set search_path = '' as $$
  select case p_status
    when 'ready' then private.setting_int('send_hours', 12)
    when 'awaiting_receipt' then private.setting_int('receipt_hours', 48)
    else null end;
$$;

-- Derive the status from participant flags. Terminal and disputed trades are left alone.
create function private.recompute_trade(p_trade uuid, p_actor uuid) returns text
language plpgsql set search_path = '' as $$
declare
  t public.trades;
  all_info boolean;
  all_confirmed boolean;
  senders_declared boolean;
  any_send_activity boolean;
  receivers_confirmed boolean;
  new_status text;
  new_deadline timestamptz;
begin
  select * into t from public.trades where id = p_trade for update;
  if not private.is_open_trade_status(t.status) then
    perform private.purge_barcodes(p_trade);
    return t.status;
  end if;

  -- proposed: someone still has to enter Threads ID (+ barcode if receiving)
  -- accepted: everyone entered info, waiting for everyone to confirm each other
  -- ready:    everyone confirmed → senders may open the barcode
  select bool_and(accepted_at is not null and threads_handle is not null and (not receives or barcode_ready_at is not null)),
         bool_and(peer_confirmed_at is not null),
         coalesce(bool_and(sent_declared_at is not null) filter (where sends), true),
         coalesce(bool_or(barcode_opened_at is not null or sent_declared_at is not null) filter (where sends), false),
         coalesce(bool_and(receipt_confirmed_at is not null) filter (where receives), true)
    into all_info, all_confirmed, senders_declared, any_send_activity, receivers_confirmed
    from public.trade_participants where trade_id = p_trade;

  new_status := case
    when not all_info then 'proposed'
    when not all_confirmed then 'accepted'
    when senders_declared and receivers_confirmed then 'completed'
    when senders_declared then 'awaiting_receipt'
    when any_send_activity then 'transfer_in_progress'
    else 'ready' end;

  if new_status <> t.status then
    new_deadline := case
      when new_status in ('proposed', 'accepted') then t.stage_deadline_at
      when new_status = 'transfer_in_progress' and t.status = 'ready' then t.stage_deadline_at
      when new_status = 'completed' then null
      when new_status = 'transfer_in_progress' then now() + make_interval(hours => private.stage_hours('ready'))
      else now() + make_interval(hours => private.stage_hours(new_status)) end;
    update public.trades
       set status = new_status,
           stage_deadline_at = new_deadline,
           updated_at = now(),
           completed_at = case when new_status = 'completed' then now() else completed_at end,
           closed_at = case when new_status = 'completed' then now() else closed_at end
     where id = p_trade;
    perform private.trade_event(p_trade, p_actor, 'status_changed',
      jsonb_build_object('from', t.status, 'to', new_status));
    if new_status = 'completed' then
      perform private.on_trade_completed(p_trade);
    end if;
    if new_status = 'accepted' then
      perform private.notify(tp.user_id, 'trade_confirm', '상대 스레드 아이디를 확인해 주세요',
        '서로 확인하면 보내는 분에게 바코드가 열려요.', '/trades/' || p_trade)
      from public.trade_participants tp where tp.trade_id = p_trade;
    end if;
    if new_status = 'ready' then
      perform private.notify(i.sender_id, 'trade_ready', '서로 확인 완료! 바코드가 열렸어요',
        '공식 앱에서 스티커를 선물한 뒤 "보냈어요"를 눌러 주세요.', '/trades/' || p_trade)
      from (select distinct sender_id from public.trade_items where trade_id = p_trade) i;
    end if;
  end if;

  perform private.purge_barcodes(p_trade);
  if t.post_id is not null then
    perform private.refresh_post_status(t.post_id);
  end if;
  return new_status;
end;
$$;

-- Promote the next reserve of a giveaway after a winner gave up.
create function private.promote_reserve(p_post uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  w public.giveaway_winners;
  tid uuid;
begin
  select * into w from public.giveaway_winners
   where post_id = p_post and role = 'reserve' and promoted_at is null and trade_id is null
   order by rank limit 1 for update;
  if not found then
    return null;
  end if;
  tid := private.create_giveaway_trade(p_post, w.user_id, 'draw', w.rank);
  update public.giveaway_winners set promoted_at = now(), trade_id = tid
   where post_id = p_post and rank = w.rank;
  return tid;
end;
$$;

-- Close a trade with a terminal status.
create function private.close_trade(p_trade uuid, p_status text, p_actor uuid, p_reason text, p_promote boolean)
returns void language plpgsql set search_path = '' as $$
declare
  t public.trades;
  pa record;
begin
  select * into t from public.trades where id = p_trade for update;
  if p_status not in ('rejected', 'expired', 'canceled', 'resolved_completed', 'resolved_unfulfilled', 'closed_unresolved') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  update public.trades
     set status = p_status, close_reason = p_reason, stage_deadline_at = null,
         updated_at = now(), closed_at = now(),
         completed_at = case when p_status = 'resolved_completed' then now() else completed_at end
   where id = p_trade;
  perform private.trade_event(p_trade, p_actor, 'status_changed',
    jsonb_build_object('from', t.status, 'to', p_status, 'reason', p_reason));
  perform private.purge_barcodes(p_trade);

  for pa in select user_id from public.trade_participants where trade_id = p_trade and user_id is distinct from p_actor loop
    perform private.notify(pa.user_id, 'trade_closed',
      case p_status
        when 'expired' then '거래 기한이 지나 종료됐어요'
        when 'canceled' then '거래가 취소됐어요'
        when 'rejected' then '교환 제안이 거절됐어요'
        else '운영자가 거래를 정리했어요' end,
      coalesce(p_reason, ''), '/trades/' || p_trade);
  end loop;

  if p_promote and t.kind = 'giveaway' and t.origin in ('draw', 'manual_pick') then
    perform private.promote_reserve(t.post_id);
  end if;
  if t.post_id is not null then
    perform private.refresh_post_status(t.post_id);
  end if;
end;
$$;

create function private.open_dispute(p_trade uuid, p_actor uuid, p_reason text) returns void
language plpgsql set search_path = '' as $$
declare
  t public.trades;
  pa record;
begin
  select * into t from public.trades where id = p_trade for update;
  if t.status = 'disputed' then
    return;
  end if;
  update public.trades set status = 'disputed', dispute_reason = p_reason, stage_deadline_at = null, updated_at = now()
   where id = p_trade;
  perform private.trade_event(p_trade, p_actor, 'status_changed',
    jsonb_build_object('from', t.status, 'to', 'disputed', 'reason', p_reason));
  perform private.purge_barcodes(p_trade);
  for pa in select user_id from public.trade_participants where trade_id = p_trade loop
    perform private.notify(pa.user_id, 'trade_disputed', '거래가 확인 대기(분쟁)로 넘어갔어요',
      '운영자가 기록을 확인할 때까지 자동으로 완료되거나 취소되지 않아요.', '/trades/' || p_trade);
  end loop;
  if t.post_id is not null then
    perform private.refresh_post_status(t.post_id);
  end if;
end;
$$;

create function private.create_trade_shell(p_kind text, p_campaign uuid, p_post uuid, p_origin text, p_deadline_hours int)
returns uuid language sql set search_path = '' as $$
  insert into public.trades (kind, campaign_id, post_id, origin, status, stage_deadline_at)
  values (p_kind, p_campaign, p_post, p_origin, 'proposed', now() + make_interval(hours => p_deadline_hours))
  returning id;
$$;

-- Giveaway hand-off: giver → receiver. Both enter their Threads ID, then confirm each other.
create function private.create_giveaway_trade(p_post uuid, p_receiver uuid, p_origin text, p_rank int)
returns uuid language plpgsql set search_path = '' as $$
declare
  p public.posts;
  ev public.giveaway_events;
  tid uuid;
begin
  select * into p from public.posts where id = p_post;
  select * into ev from public.giveaway_events where post_id = p_post;
  tid := private.create_trade_shell('giveaway', p.campaign_id, p_post, p_origin, ev.claim_hours);
  insert into public.trade_participants (trade_id, user_id, role, sends, receives)
  values (tid, p.author_id, 'giver', true, false),
         (tid, p_receiver, 'receiver', false, true);
  insert into public.trade_items (trade_id, seq, sender_id, receiver_id, sticker_type_id, quantity)
  values (tid, 1, p.author_id, p_receiver, ev.sticker_type_id, ev.per_winner_quantity);
  perform private.trade_event(tid, null, 'trade_created',
    jsonb_build_object('origin', p_origin, 'rank', p_rank, 'post_code', p.code));
  perform private.notify(p_receiver, 'giveaway_won', '나눔에 당첨됐어요!',
    format('「%s」 %s시간 안에 거래 화면에서 스레드 아이디와 바코드를 입력해 주세요.', p.title, ev.claim_hours),
    '/trades/' || tid);
  perform private.notify(p.author_id, 'giveaway_trade', '받을 분이 정해졌어요',
    format('「%s」 거래 화면에서 내 스레드 아이디를 입력하고 서로 확인해 주세요.', p.title),
    '/trades/' || tid);
  return tid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Draw engine
-- ---------------------------------------------------------------------------

create function private.rps_wins(p_choices text, p_opponent text) returns int
language sql immutable set search_path = '' as $$
  select count(*)::int from generate_series(1, 4) i
  where (substr(p_choices, i, 1), substr(p_opponent, i, 1)) in (('R', 'S'), ('S', 'P'), ('P', 'R'));
$$;

create function private.notify_entrants(p_post uuid) returns void
language plpgsql set search_path = '' as $$
declare
  p public.posts;
  e record;
begin
  select * into p from public.posts where id = p_post;
  for e in
    select ge.user_id, gw.role
      from public.giveaway_entries ge
      left join public.giveaway_winners gw on gw.post_id = ge.post_id and gw.user_id = ge.user_id
     where ge.post_id = p_post and ge.status = 'active'
  loop
    if e.role = 'reserve' then
      perform private.notify(e.user_id, 'giveaway_reserve', '예비 당첨자가 됐어요',
        format('「%s」 당첨자가 수령하지 않으면 순서대로 기회가 와요.', p.title), '/posts/' || p.code);
    elsif e.role is null then
      perform private.notify(e.user_id, 'giveaway_lost', '아쉽게도 이번 나눔은 당첨되지 않았어요',
        format('「%s」 결과와 추첨 기록을 확인할 수 있어요.', p.title), '/posts/' || p.code);
    end if;
  end loop;
  perform private.notify(p.author_id, 'giveaway_drawn', '나눔 추첨이 끝났어요',
    format('「%s」 거래 화면에서 서로 스레드 아이디를 확인하면 바코드가 열려요.', p.title), '/posts/' || p.code);
end;
$$;

-- Server-side draw. Runs once per giveaway (unique draw row + row lock).
create function private.run_draw(p_post uuid, p_actor uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  ev public.giveaway_events;
  sec private.giveaway_secrets;
  d_id uuid;
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
  n_entries int;
  n_eligible int;
  v_hash text;
  use_all boolean := true;
  outcome text := 'drawn';
  w record;
  tid uuid;
  author uuid;
begin
  select * into ev from public.giveaway_events where post_id = p_post for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select id into d_id from public.giveaway_draws where post_id = p_post;
  if found then
    return d_id;
  end if;
  if ev.state = 'canceled' then
    raise exception 'GIVEAWAY_CANCELED' using errcode = 'P0001';
  end if;
  if ev.method = 'manual' then
    raise exception 'MANUAL_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;
  if now() < ev.closes_at then
    raise exception 'DRAW_TOO_EARLY' using errcode = 'P0001';
  end if;

  select author_id into author from public.posts where id = p_post;
  select * into sec from private.giveaway_secrets where post_id = p_post;

  -- Suspended accounts and blocked pairs are not eligible.
  update public.giveaway_entries e set status = 'invalid', updated_at = now()
   where e.post_id = p_post and e.status = 'active'
     and (exists (select 1 from public.profiles pr where pr.user_id = e.user_id and pr.account_status = 'suspended')
          or private.is_blocked_between(author, e.user_id));

  if ev.method = 'quiz' then
    update public.giveaway_entries set quiz_correct = (quiz_choice = sec.quiz_answer), updated_at = now()
     where post_id = p_post and status = 'active';
  elsif ev.method = 'rps' then
    update public.giveaway_entries set rps_wins = private.rps_wins(rps_choices, sec.rps_moves), updated_at = now()
     where post_id = p_post and status = 'active';
  end if;

  select count(*) into n_entries from public.giveaway_entries where post_id = p_post and status = 'active';

  if ev.method = 'quiz' then
    select count(*) into n_eligible from public.giveaway_entries
     where post_id = p_post and status = 'active' and quiz_correct;
    if n_eligible > 0 then
      use_all := false;
    elsif ev.quiz_zero_policy = 'draw_all' then
      use_all := true;
      outcome := 'no_correct_draw_all';
    else
      use_all := false;
      outcome := 'no_correct_canceled';
    end if;
  end if;

  select count(*), private.sha256_hex(coalesce(string_agg(user_id::text, ',' order by user_id), ''))
    into n_eligible, v_hash
    from public.giveaway_entries
   where post_id = p_post and status = 'active'
     and (use_all or (ev.method = 'quiz' and quiz_correct and outcome = 'drawn'));

  if n_entries = 0 then
    outcome := 'no_entries';
  end if;

  insert into public.giveaway_draws (post_id, method, executed_by, entries_count, eligible_count, eligible_hash,
                                     seed, revealed_nonce, revealed_quiz_answer, revealed_rps_moves, details)
  values (p_post, ev.method, p_actor, n_entries, n_eligible, v_hash, v_seed, sec.nonce, sec.quiz_answer, sec.rps_moves,
          jsonb_build_object('outcome', outcome,
                             'ordering', case when ev.method = 'rps'
                               then 'rps_wins desc, sha256(seed:user_id)'
                               else 'sha256(seed:user_id)' end))
  returning id into d_id;

  insert into public.giveaway_winners (post_id, draw_id, rank, user_id, role, rps_wins)
  select p_post, d_id, r.rk, r.user_id,
         case when r.rk <= ev.winners_count then 'winner' else 'reserve' end, r.rps_wins
    from (
      select e.user_id, e.rps_wins,
             row_number() over (order by
               case when ev.method = 'rps' then e.rps_wins end desc nulls last,
               private.sha256_hex(v_seed || ':' || e.user_id::text)) as rk
        from public.giveaway_entries e
       where e.post_id = p_post and e.status = 'active'
         and (use_all or (ev.method = 'quiz' and e.quiz_correct and outcome = 'drawn'))
    ) r
   where r.rk <= ev.winners_count + ev.reserve_count;

  update public.giveaway_events set state = 'drawn' where post_id = p_post;

  for w in select * from public.giveaway_winners where post_id = p_post and role = 'winner' order by rank loop
    tid := private.create_giveaway_trade(p_post, w.user_id, 'draw', w.rank);
    update public.giveaway_winners set trade_id = tid where post_id = p_post and rank = w.rank;
  end loop;

  if outcome = 'no_entries' then
    update public.posts set status = 'expired', status_note = '신청자가 없었어요', updated_at = now() where id = p_post;
  elsif outcome = 'no_correct_canceled' then
    update public.posts set status = 'canceled', status_note = '정답자가 없어 규칙에 따라 취소됐어요', updated_at = now() where id = p_post;
  else
    perform private.refresh_post_status(p_post);
  end if;
  perform private.notify_entrants(p_post);
  return d_id;
end;
$$;

-- Winners' rank/user/role are permanent. Only promotion and the trade link may be filled in, once.
create function private.guard_winner_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'APPEND_ONLY' using errcode = 'P0001';
  end if;
  if new.post_id <> old.post_id or new.draw_id <> old.draw_id or new.rank <> old.rank
     or new.user_id <> old.user_id or new.role <> old.role or new.rps_wins is distinct from old.rps_wins
     or (old.promoted_at is not null and new.promoted_at is distinct from old.promoted_at)
     or (old.trade_id is not null and new.trade_id is distinct from old.trade_id) then
    raise exception 'DRAW_RECORD_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger giveaway_winners_guard before update or delete on public.giveaway_winners
  for each row execute function private.guard_winner_update();

-- ---------------------------------------------------------------------------
-- Scheduled work (deadlines, automatic draws, post expiry)
-- ---------------------------------------------------------------------------

create function private.process_deadlines() returns jsonb
language plpgsql set search_path = '' as $$
declare
  t record;
  ev record;
  n_expired int := 0;
  n_disputed int := 0;
  n_drawn int := 0;
  any_declared boolean;
  giver_done boolean;
  receiver_done boolean;
  pa record;
begin
  -- 1. automatic draws for closed random/quiz/rps giveaways
  for ev in
    select e.post_id from public.giveaway_events e
     where e.state = 'open' and e.method <> 'manual' and e.closes_at <= now()
     for update skip locked
  loop
    perform private.run_draw(ev.post_id, null);
    n_drawn := n_drawn + 1;
  end loop;

  -- 2. manual giveaways nobody picked within manual_select_hours
  for ev in
    select e.post_id from public.giveaway_events e
     where e.state = 'open' and e.method = 'manual'
       and e.closes_at + make_interval(hours => private.setting_int('manual_select_hours', 48)) <= now()
     for update skip locked
  loop
    update public.giveaway_events set state = 'canceled', canceled_reason = 'manual_not_selected' where post_id = ev.post_id;
    update public.posts set status = 'canceled', status_note = '나눔자가 기한 안에 선정하지 않았어요', updated_at = now()
     where id = ev.post_id;
  end loop;

  -- 3. trade deadlines
  for t in
    select id, status, kind, origin from public.trades
     where private.is_open_trade_status(status) and stage_deadline_at <= now()
     for update skip locked
  loop
    if t.status in ('proposed', 'accepted') then
      -- who still had something to do in this stage?
      select coalesce(bool_and(case when t.status = 'proposed' then accepted_at is not null else peer_confirmed_at is not null end)
                        filter (where role = 'giver'), false),
             coalesce(bool_and(case when t.status = 'proposed' then accepted_at is not null else peer_confirmed_at is not null end)
                        filter (where role = 'receiver'), false)
        into giver_done, receiver_done
        from public.trade_participants where trade_id = t.id;
      perform private.trade_event(t.id, null, 'deadline_passed', jsonb_build_object('stage', t.status));
      if t.kind = 'giveaway' and receiver_done and not giver_done then
        perform private.trade_event(t.id, null, 'unfulfilled_by_sender',
          jsonb_build_object('user_id', (select user_id from public.trade_participants where trade_id = t.id and role = 'giver'),
                             'stage', t.status));
      end if;
      -- a winner who did not respond gives the slot to the next reserve
      perform private.close_trade(t.id, 'expired', null,
        case when t.status = 'proposed' then '정보 입력 기한이 지났어요' else '서로 확인 기한이 지났어요' end,
        t.kind = 'giveaway' and not receiver_done);
      n_expired := n_expired + 1;
    elsif t.status in ('ready', 'transfer_in_progress') then
      select coalesce(bool_or(sent_declared_at is not null), false) into any_declared
        from public.trade_participants where trade_id = t.id and sends;
      if any_declared then
        perform private.open_dispute(t.id, null, 'partial_sent_timeout');
        n_disputed := n_disputed + 1;
      else
        for pa in select user_id from public.trade_participants where trade_id = t.id and sends and sent_declared_at is null loop
          perform private.trade_event(t.id, null, 'unfulfilled_by_sender', jsonb_build_object('user_id', pa.user_id));
        end loop;
        perform private.close_trade(t.id, 'expired', null, '전송 기한이 지났어요(아무도 보내지 않음)', false);
        n_expired := n_expired + 1;
      end if;
    elsif t.status = 'awaiting_receipt' then
      perform private.open_dispute(t.id, null, 'receipt_unconfirmed');
      n_disputed := n_disputed + 1;
    end if;
  end loop;

  -- 4. request/swap posts past their closing time
  update public.posts p set status = 'expired', updated_at = now()
   where p.kind in ('REQUEST', 'SWAP') and p.status = 'open' and p.closes_at <= now()
     and not exists (select 1 from public.trades tr where tr.post_id = p.id
                      and tr.status in ('accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt', 'disputed'));
  update public.posts p set status = 'selecting', updated_at = now()
   where p.kind = 'GIVEAWAY' and p.status = 'open' and p.closes_at <= now();

  return jsonb_build_object('drawn', n_drawn, 'expired', n_expired, 'disputed', n_disputed);
end;
$$;
