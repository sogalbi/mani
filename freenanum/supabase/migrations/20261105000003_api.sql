-- 프리나눔 public API (called with supabase.rpc). Each function checks who is calling.
-- Error messages are stable codes (e.g. ALREADY_ENTERED); the app maps them to Korean text.

-- ---------------------------------------------------------------------------
-- Shared view helpers
-- ---------------------------------------------------------------------------

create function private.effective_post_status(p public.posts) returns text
language sql stable set search_path = '' as $$
  select case
    when p.status = 'open' and p.closes_at <= now() then
      case when p.kind = 'GIVEAWAY' then 'selecting' else 'expired' end
    else p.status end;
$$;

create function private.member_badge(p_user uuid, p_campaign uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'user_id', pr.user_id,
    'nickname', pr.nickname,
    'level', private.level_info(coalesce(mp.given_count, 0)),
    'completed_trades', (select count(*) from public.trade_participants tp join public.trades t on t.id = tp.trade_id
                          where tp.user_id = pr.user_id and t.status in ('completed', 'resolved_completed')),
    'unfulfilled', (select count(*) from public.trade_events te
                     where te.event_type = 'unfulfilled_by_sender' and te.meta ->> 'user_id' = pr.user_id::text)
                   + (select count(*) from public.trade_participants tp join public.trades t on t.id = tp.trade_id
                       where tp.user_id = pr.user_id and tp.sends and tp.sent_declared_at is null
                         and t.status = 'resolved_unfulfilled'),
    'threads', (select jsonb_build_object('handle', th.handle, 'verified', th.status = 'verified')
                  from public.threads_profiles th where th.user_id = pr.user_id),
    'restricted', pr.account_status <> 'active')
  from public.profiles pr
  left join public.member_progress mp on mp.user_id = pr.user_id and mp.campaign_id = p_campaign
  where pr.user_id = p_user;
$$;

create function private.post_items_json(p_post uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'direction', pi.direction, 'code', st.code, 'name', st.name, 'quantity', pi.quantity)
           order by pi.direction, st.sort_order), '[]'::jsonb)
  from public.post_items pi join public.sticker_types st on st.id = pi.sticker_type_id
  where pi.post_id = p_post;
$$;

create function private.post_card(p public.posts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'kind', p.kind, 'title', p.title,
    'is_mine', auth.uid() is not null and p.author_id = auth.uid(),
    'status', private.effective_post_status(p), 'visibility', p.visibility,
    'closes_at', p.closes_at, 'created_at', p.created_at,
    'author', jsonb_build_object('nickname', pr.nickname,
                                 'level', private.level_info(coalesce(mp.given_count, 0))),
    'items', private.post_items_json(p.id),
    'giveaway', (select jsonb_build_object(
                   'method', ge.method, 'per_winner_quantity', ge.per_winner_quantity,
                   'winners_count', ge.winners_count, 'state', ge.state,
                   'entries_count', (select count(*) from public.giveaway_entries e
                                      where e.post_id = p.id and e.status = 'active'))
                 from public.giveaway_events ge where ge.post_id = p.id))
  from public.profiles pr
  left join public.member_progress mp on mp.user_id = pr.user_id and mp.campaign_id = p.campaign_id
  where pr.user_id = p.author_id;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap and profile
-- ---------------------------------------------------------------------------

create function public.get_bootstrap() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'server_time', now(),
    'campaign', (select to_jsonb(c) - 'created_at' from public.campaigns c
                  where c.status = 'active' order by c.starts_at desc limit 1),
    'sticker_types', (select coalesce(jsonb_agg(jsonb_build_object('code', st.code, 'name', st.name) order by st.sort_order), '[]'::jsonb)
                        from public.sticker_types st
                        join public.campaigns c on c.id = st.campaign_id and c.status = 'active'),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.app_settings s));
$$;

create function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
  pr public.profiles;
  camp uuid;
begin
  if v is null then
    return null;
  end if;
  select * into pr from public.profiles where user_id = v;
  if not found then
    return jsonb_build_object('user_id', v, 'needs_profile', true);
  end if;
  select id into camp from public.campaigns where status = 'active' order by starts_at desc limit 1;
  return jsonb_build_object(
    'user_id', v,
    'needs_profile', false,
    'nickname', pr.nickname,
    'role', pr.role,
    'account_status', pr.account_status,
    'restricted_until', pr.restricted_until,
    'created_at', pr.created_at,
    'badge', private.member_badge(v, camp),
    'progress', (select jsonb_build_object('given', coalesce(sum(given_count), 0), 'received', coalesce(sum(received_count), 0),
                                           'swaps', coalesce(sum(swap_count), 0))
                   from public.member_progress where user_id = v and campaign_id = camp),
    'unread_notifications', (select count(*) from public.notifications where user_id = v and read_at is null),
    'action_needed', (select count(*) from public.trades t join public.trade_participants tp on tp.trade_id = t.id
                       where tp.user_id = v and (
                         (t.status = 'proposed' and tp.accepted_at is null)
                         or (t.status = 'accepted' and tp.peer_confirmed_at is null)
                         or (t.status in ('ready', 'transfer_in_progress') and tp.sends and tp.sent_declared_at is null)
                         or (t.status in ('transfer_in_progress', 'awaiting_receipt') and tp.receives and tp.receipt_confirmed_at is null
                             and not exists (select 1 from public.trade_items i join public.trade_participants s
                                               on s.trade_id = i.trade_id and s.user_id = i.sender_id
                                              where i.trade_id = t.id and i.receiver_id = v and s.sent_declared_at is null)))),
    'threads', (select to_jsonb(th) - 'decided_by' from public.threads_profiles th where th.user_id = v));
end;
$$;

create function public.register_profile(p_nickname text, p_agree_terms boolean, p_agree_privacy boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
  nick text := btrim(p_nickname);
begin
  if v is null then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where user_id = v) then
    raise exception 'PROFILE_EXISTS' using errcode = 'P0001';
  end if;
  if not coalesce(p_agree_terms, false) or not coalesce(p_agree_privacy, false) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  if nick is null or char_length(nick) not between 2 and 12 or nick !~ '^[가-힣A-Za-z0-9_.]+$' then
    raise exception 'NICKNAME_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(nick)) then
    raise exception 'NICKNAME_TAKEN' using errcode = 'P0001';
  end if;
  insert into public.profiles (user_id, nickname) values (v, nick);
  perform private.record_consent(v, 'terms', null);
  perform private.record_consent(v, 'privacy', null);
  return public.get_me();
end;
$$;

create function public.update_nickname(p_nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.current_member(true);
  nick text := btrim(p_nickname);
begin
  if nick is null or char_length(nick) not between 2 and 12 or nick !~ '^[가-힣A-Za-z0-9_.]+$' then
    raise exception 'NICKNAME_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(nick) and user_id <> v) then
    raise exception 'NICKNAME_TAKEN' using errcode = 'P0001';
  end if;
  update public.profiles set nickname = nick, updated_at = now() where user_id = v;
  return public.get_me();
end;
$$;

-- ---------------------------------------------------------------------------
-- Posts: list / detail
-- ---------------------------------------------------------------------------

create function public.list_posts(
  p_kind text default null, p_sticker text default null, p_q text default null,
  p_only_open boolean default true, p_limit int default 20, p_before timestamptz default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.post_card(p) order by p.created_at desc), '[]'::jsonb)
  from (
    select p.* from public.posts p
    join public.campaigns c on c.id = p.campaign_id and c.status = 'active'
    where p.visibility = 'public'
      and (p_kind is null or p.kind = p_kind)
      and (p_sticker is null or exists (select 1 from public.post_items pi join public.sticker_types st on st.id = pi.sticker_type_id
                                         where pi.post_id = p.id and st.code = p_sticker))
      and (p_q is null or p.title ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%')
      and (not p_only_open or private.effective_post_status(p) = 'open')
      and (p_before is null or p.created_at < p_before)
      and (auth.uid() is null or not private.is_blocked_between(auth.uid(), p.author_id))
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) p;
$$;

create function public.get_post(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
  p public.posts;
  ev public.giveaway_events;
  d public.giveaway_draws;
  is_author boolean;
  is_admin boolean;
  res jsonb;
begin
  select * into p from public.posts where code = p_code;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  is_author := v is not null and v = p.author_id;
  is_admin := v is not null and private.is_admin(v);
  if p.visibility <> 'public' and not is_author and not is_admin then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  res := private.post_card(p) || jsonb_build_object(
    'body', p.body,
    'status_note', p.status_note,
    'author', private.member_badge(p.author_id, p.campaign_id) - 'user_id',
    'is_author', is_author,
    'blocked', v is not null and private.is_blocked_between(v, p.author_id));

  if p.kind = 'GIVEAWAY' then
    select * into ev from public.giveaway_events where post_id = p.id;
    select * into d from public.giveaway_draws where post_id = p.id;
    res := res || jsonb_build_object('giveaway', jsonb_build_object(
      'method', ev.method,
      'sticker', (select jsonb_build_object('code', code, 'name', name) from public.sticker_types where id = ev.sticker_type_id),
      'total_quantity', ev.total_quantity, 'per_winner_quantity', ev.per_winner_quantity,
      'winners_count', ev.winners_count, 'reserve_count', ev.reserve_count,
      'opens_at', ev.opens_at, 'closes_at', ev.closes_at, 'claim_hours', ev.claim_hours,
      'quiz_question', ev.quiz_question, 'quiz_options', ev.quiz_options, 'quiz_zero_policy', ev.quiz_zero_policy,
      'quiz_commitment', ev.quiz_commitment, 'rps_commitment', ev.rps_commitment,
      'rules_hash', ev.rules_hash, 'state', ev.state, 'canceled_reason', ev.canceled_reason,
      'entries_count', (select count(*) from public.giveaway_entries where post_id = p.id and status = 'active'),
      'my_entry', (select jsonb_build_object('status', e.status, 'quiz_choice', e.quiz_choice, 'rps_choices', e.rps_choices,
                                             'quiz_correct', e.quiz_correct, 'rps_wins', e.rps_wins, 'created_at', e.created_at)
                     from public.giveaway_entries e where e.post_id = p.id and e.user_id = v),
      'my_result', (select jsonb_build_object('role', w.role, 'rank', w.rank, 'promoted', w.promoted_at is not null, 'trade_id', w.trade_id)
                      from public.giveaway_winners w where w.post_id = p.id and w.user_id = v),
      'draw', case when d.id is null then null else jsonb_build_object(
        'executed_at', d.executed_at, 'method', d.method, 'manual', d.method = 'manual',
        'entries_count', d.entries_count, 'eligible_count', d.eligible_count, 'eligible_hash', d.eligible_hash,
        'seed', d.seed, 'revealed_nonce', d.revealed_nonce, 'revealed_quiz_answer', d.revealed_quiz_answer,
        'revealed_rps_moves', d.revealed_rps_moves, 'outcome', d.details ->> 'outcome', 'ordering', d.details ->> 'ordering',
        'winners', (select coalesce(jsonb_agg(jsonb_build_object(
                       'rank', w.rank, 'role', w.role, 'rps_wins', w.rps_wins, 'promoted', w.promoted_at is not null,
                       'nickname', case when is_author or is_admin or w.user_id = v then pr.nickname else private.mask_nickname(pr.nickname) end,
                       'is_me', w.user_id = v,
                       'trade_status', case when is_author or is_admin or w.user_id = v then t.status end)
                     order by w.rank), '[]'::jsonb)
                    from public.giveaway_winners w
                    join public.profiles pr on pr.user_id = w.user_id
                    left join public.trades t on t.id = w.trade_id
                    where w.post_id = p.id)) end,
      -- author-only: entrants for manual selection
      'entrants', case when is_author and ev.method = 'manual' then
                    (select coalesce(jsonb_agg(jsonb_build_object('user_id', e.user_id, 'nickname', pr.nickname,
                                                                  'badge', private.member_badge(e.user_id, p.campaign_id))
                                               order by e.created_at), '[]'::jsonb)
                       from public.giveaway_entries e join public.profiles pr on pr.user_id = e.user_id
                      where e.post_id = p.id and e.status = 'active') end));
  end if;

  if p.kind in ('REQUEST', 'SWAP') then
    res := res || jsonb_build_object(
      'my_trade', (select jsonb_build_object('id', t.id, 'status', t.status)
                     from public.trades t join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = v
                    where t.post_id = p.id order by t.created_at desc limit 1),
      'trades', case when is_author or is_admin then
                  (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', t.id, 'status', t.status, 'created_at', t.created_at,
                     'counterpart', (select pr.nickname from public.trade_participants tp join public.profiles pr on pr.user_id = tp.user_id
                                      where tp.trade_id = t.id and tp.user_id <> p.author_id limit 1))
                     order by t.created_at desc), '[]'::jsonb)
                     from public.trades t where t.post_id = p.id) end,
      'active_trades_count', (select count(*) from public.trades t where t.post_id = p.id and private.is_open_trade_status(t.status)));
  end if;

  if is_author and p.kind = 'GIVEAWAY' then
    res := res || jsonb_build_object('trades',
      (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'counterpart', pr.nickname) order by t.created_at), '[]'::jsonb)
         from public.trades t
         join public.trade_participants tp on tp.trade_id = t.id and tp.role = 'receiver'
         join public.profiles pr on pr.user_id = tp.user_id
        where t.post_id = p.id));
  end if;
  return res;
end;
$$;

create function public.my_posts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.post_card(p) order by p.created_at desc), '[]'::jsonb)
  from public.posts p where p.author_id = auth.uid() and p.visibility <> 'hidden_by_admin';
$$;

create function public.my_entries() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.post_card(p) || jsonb_build_object(
           'entry_status', e.status,
           'result', (select w.role from public.giveaway_winners w where w.post_id = p.id and w.user_id = e.user_id),
           'trade_id', (select w.trade_id from public.giveaway_winners w where w.post_id = p.id and w.user_id = e.user_id))
         order by e.created_at desc), '[]'::jsonb)
  from public.giveaway_entries e join public.posts p on p.id = e.post_id
  where e.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Posts: create / close
-- ---------------------------------------------------------------------------

create function private.check_post_limits(p_user uuid, p_closes timestamptz, c public.campaigns) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_closes is null or p_closes < now() + interval '10 minutes'
     or p_closes > now() + make_interval(hours => private.setting_int('max_post_hours', 168))
     or p_closes > c.ends_at then
    raise exception 'INVALID_CLOSING_TIME' using errcode = 'P0001';
  end if;
  if (select count(*) from public.posts
       where author_id = p_user and status in ('open', 'selecting') and visibility = 'public')
     >= private.setting_int('max_open_posts', 5) then
    raise exception 'TOO_MANY_OPEN_POSTS' using errcode = 'P0001';
  end if;
end;
$$;

create function private.insert_post(p_campaign uuid, p_author uuid, p_kind text, p_title text, p_body text, p_closes timestamptz)
returns public.posts language plpgsql set search_path = '' as $$
declare
  r public.posts;
  c text;
begin
  if p_title is null or char_length(p_title) not between 2 and 60 then
    raise exception 'INVALID_TITLE' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_body, '')) > 1000 then
    raise exception 'INVALID_BODY' using errcode = 'P0001';
  end if;
  loop
    c := private.new_code();
    exit when not exists (select 1 from public.posts where code = c);
  end loop;
  insert into public.posts (code, campaign_id, author_id, kind, title, body, closes_at)
  values (c, p_campaign, p_author, p_kind, p_title, coalesce(p_body, ''), p_closes)
  returning * into r;
  return r;
end;
$$;

create function public.create_giveaway(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  c public.campaigns := private.active_campaign();
  v_method text := p ->> 'method';
  v_sticker uuid := private.sticker_type_id(c.id, p ->> 'sticker_code');
  v_total int := (p ->> 'total_quantity')::int;
  v_per int := coalesce((p ->> 'per_winner_quantity')::int, 1);
  v_winners int;
  v_reserve int;
  v_closes timestamptz := (p ->> 'closes_at')::timestamptz;
  v_claim int := coalesce((p ->> 'claim_hours')::int, private.setting_int('claim_hours', 24));
  v_question text;
  v_options jsonb;
  v_answer int;
  v_zero text;
  v_moves text := null;
  v_nonce text := encode(extensions.gen_random_bytes(16), 'hex');
  v_rules jsonb;
  b int;
  post public.posts;
begin
  if not coalesce((p ->> 'agree_rules')::boolean, false) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_method is null or v_method not in ('random', 'quiz', 'rps', 'manual') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;
  if v_total is null or v_total not between 1 and 50 or v_per not between 1 and 17 or v_per > v_total then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  v_winners := coalesce((p ->> 'winners_count')::int, v_total / v_per);
  v_reserve := coalesce((p ->> 'reserve_count')::int, least(3, greatest(v_winners, 1)));
  if v_winners < 1 or v_winners * v_per > v_total or v_reserve not between 0 and 20 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  if v_claim not between 1 and 72 then
    raise exception 'INVALID_CLAIM_HOURS' using errcode = 'P0001';
  end if;
  perform private.check_post_limits(uid, v_closes, c);

  if v_method = 'quiz' then
    v_question := btrim(p #>> '{quiz,question}');
    v_options := p #> '{quiz,options}';
    v_answer := (p #>> '{quiz,answer}')::int;
    v_zero := coalesce(p #>> '{quiz,zero_policy}', 'cancel');
    if v_question is null or char_length(v_question) not between 2 and 120
       or jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) not between 2 and 5
       or exists (select 1 from jsonb_array_elements(v_options) o
                   where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 40)
       or v_answer is null or v_answer < 0 or v_answer >= jsonb_array_length(v_options)
       or v_zero not in ('cancel', 'draw_all') then
      raise exception 'INVALID_QUIZ' using errcode = 'P0001';
    end if;
  elsif v_method = 'rps' then
    -- 4 opponent moves fixed now, published as a hash, revealed after the draw. Rejection sampling avoids bias.
    v_moves := '';
    while char_length(v_moves) < 4 loop
      b := get_byte(extensions.gen_random_bytes(1), 0);
      if b < 255 then
        v_moves := v_moves || substr('RPS', (b % 3) + 1, 1);
      end if;
    end loop;
  end if;

  post := private.insert_post(c.id, uid, 'GIVEAWAY', btrim(p ->> 'title'), btrim(p ->> 'body'), v_closes);
  insert into public.post_items (post_id, sticker_type_id, direction, quantity) values (post.id, v_sticker, 'offer', v_total);

  v_rules := jsonb_build_object(
    'method', v_method, 'sticker_code', p ->> 'sticker_code', 'total_quantity', v_total,
    'per_winner_quantity', v_per, 'winners_count', v_winners, 'reserve_count', v_reserve,
    'opens_at', post.created_at, 'closes_at', v_closes, 'claim_hours', v_claim,
    'quiz_question', v_question, 'quiz_options', v_options, 'quiz_zero_policy', v_zero,
    'quiz_commitment', case when v_method = 'quiz' then private.sha256_hex(v_answer::text || ':' || v_nonce) end,
    'rps_commitment', case when v_method = 'rps' then private.sha256_hex(v_moves || ':' || v_nonce) end,
    'tie_break', 'sha256(seed:user_id)', 'paid_entry', false);

  insert into public.giveaway_events (post_id, method, sticker_type_id, total_quantity, per_winner_quantity, winners_count,
    reserve_count, opens_at, closes_at, claim_hours, quiz_question, quiz_options, quiz_zero_policy,
    quiz_commitment, rps_commitment, rules_snapshot, rules_hash)
  values (post.id, v_method, v_sticker, v_total, v_per, v_winners, v_reserve, post.created_at, v_closes, v_claim,
    v_question, v_options, case when v_method = 'quiz' then v_zero end,
    v_rules ->> 'quiz_commitment', v_rules ->> 'rps_commitment', v_rules, private.sha256_hex(v_rules::text));

  insert into private.giveaway_secrets (post_id, quiz_answer, rps_moves, nonce)
  values (post.id, case when v_method = 'quiz' then v_answer end, v_moves, v_nonce);

  perform private.record_consent(uid, 'trade_risk', null);
  return jsonb_build_object('id', post.id, 'code', post.code);
end;
$$;

create function public.create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  c public.campaigns := private.active_campaign();
  v_sticker uuid := private.sticker_type_id(c.id, p ->> 'sticker_code');
  v_qty int := (p ->> 'quantity')::int;
  v_closes timestamptz := coalesce((p ->> 'closes_at')::timestamptz, now() + interval '72 hours');
  post public.posts;
begin
  if v_qty is null or v_qty not between 1 and 10 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  perform private.check_post_limits(uid, v_closes, c);
  post := private.insert_post(c.id, uid, 'REQUEST', btrim(p ->> 'title'), btrim(p ->> 'body'), v_closes);
  insert into public.post_items (post_id, sticker_type_id, direction, quantity) values (post.id, v_sticker, 'want', v_qty);
  return jsonb_build_object('id', post.id, 'code', post.code);
end;
$$;

create function public.create_swap(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  c public.campaigns := private.active_campaign();
  v_closes timestamptz := coalesce((p ->> 'closes_at')::timestamptz, now() + interval '72 hours');
  post public.posts;
  it jsonb;
  dir text;
  n_offer int := 0;
  n_want int := 0;
begin
  perform private.check_post_limits(uid, v_closes, c);
  post := private.insert_post(c.id, uid, 'SWAP', btrim(p ->> 'title'), btrim(p ->> 'body'), v_closes);
  foreach dir in array array['offer', 'want'] loop
    for it in select * from jsonb_array_elements(coalesce(p -> dir, '[]'::jsonb)) loop
      if (it ->> 'quantity')::int is null or (it ->> 'quantity')::int not between 1 and 10 then
        raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
      end if;
      insert into public.post_items (post_id, sticker_type_id, direction, quantity)
      values (post.id, private.sticker_type_id(c.id, it ->> 'sticker_code'), dir, (it ->> 'quantity')::int);
      if dir = 'offer' then n_offer := n_offer + 1; else n_want := n_want + 1; end if;
    end loop;
  end loop;
  if n_offer = 0 or n_want = 0 then
    raise exception 'INVALID_SWAP_TERMS' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', post.id, 'code', post.code);
end;
$$;

-- Close a request/swap post early, or hide one's own post.
create function public.close_my_post(p_post_id uuid, p_hide boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  p public.posts;
  ev public.giveaway_events;
begin
  select * into p from public.posts where id = p_post_id for update;
  if not found or p.author_id <> uid then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.kind = 'GIVEAWAY' then
    select * into ev from public.giveaway_events where post_id = p.id;
    if ev.state = 'open' and exists (select 1 from public.giveaway_entries where post_id = p.id and status = 'active') then
      raise exception 'CANCEL_GIVEAWAY_FIRST' using errcode = 'P0001';
    end if;
    if ev.state = 'open' then
      update public.giveaway_events set state = 'canceled', canceled_reason = 'author_closed' where post_id = p.id;
      update public.posts set status = 'canceled', updated_at = now() where id = p.id;
    end if;
  elsif p.status in ('open') then
    -- pending proposals/offers that nobody accepted yet are withdrawn
    perform private.close_trade(t.id, 'canceled', uid, '게시글이 마감됐어요', false)
      from public.trades t where t.post_id = p.id and t.status = 'proposed';
    update public.posts set status = 'done', updated_at = now() where id = p.id;
  end if;
  if p_hide then
    update public.posts set visibility = 'hidden_by_author', updated_at = now() where id = p.id and visibility = 'public';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Giveaway participation and draws
-- ---------------------------------------------------------------------------

create function public.enter_giveaway(p_post_id uuid, p_quiz_choice int default null, p_rps text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  p public.posts;
  ev public.giveaway_events;
  e public.giveaway_entries;
begin
  select * into ev from public.giveaway_events where post_id = p_post_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into p from public.posts where id = p_post_id;
  if p.visibility <> 'public' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.author_id = uid then
    raise exception 'OWN_POST' using errcode = 'P0001';
  end if;
  if ev.state <> 'open' or now() >= ev.closes_at or now() < ev.opens_at then
    raise exception 'ENTRY_CLOSED' using errcode = 'P0001';
  end if;
  if private.is_blocked_between(uid, p.author_id) then
    raise exception 'BLOCKED' using errcode = 'P0001';
  end if;
  if ev.method = 'quiz' and (p_quiz_choice is null or p_quiz_choice < 0 or p_quiz_choice >= jsonb_array_length(ev.quiz_options)) then
    raise exception 'INVALID_QUIZ_CHOICE' using errcode = 'P0001';
  end if;
  if ev.method = 'rps' and (p_rps is null or p_rps !~ '^[RPS]{4}$') then
    raise exception 'INVALID_RPS_CHOICES' using errcode = 'P0001';
  end if;

  select * into e from public.giveaway_entries where post_id = p_post_id and user_id = uid for update;
  if found then
    if e.status = 'active' then
      raise exception 'ALREADY_ENTERED' using errcode = 'P0001';
    end if;
    if e.status = 'invalid' or ev.method in ('quiz', 'rps') then
      -- submitted answers/moves cannot be changed by withdrawing and re-entering
      raise exception 'REENTRY_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    update public.giveaway_entries set status = 'active', updated_at = now() where id = e.id;
  else
    insert into public.giveaway_entries (post_id, user_id, quiz_choice, rps_choices)
    values (p_post_id, uid,
            case when ev.method = 'quiz' then p_quiz_choice end,
            case when ev.method = 'rps' then p_rps end);
  end if;
  return jsonb_build_object('ok', true,
    'entries_count', (select count(*) from public.giveaway_entries where post_id = p_post_id and status = 'active'));
end;
$$;

create function public.withdraw_entry(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  ev public.giveaway_events;
  n int;
begin
  select * into ev from public.giveaway_events where post_id = p_post_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if ev.state <> 'open' or now() >= ev.closes_at then
    raise exception 'ENTRY_CLOSED' using errcode = 'P0001';
  end if;
  update public.giveaway_entries set status = 'withdrawn', updated_at = now()
   where post_id = p_post_id and user_id = uid and status = 'active';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'NOT_ENTERED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Anyone signed in may trigger a due draw; the server picks winners with its own CSPRNG seed,
-- exactly once (unique draw row + row lock), so the caller cannot influence the result.
create function public.draw_giveaway(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  d uuid;
begin
  d := private.run_draw(p_post_id, uid);
  return jsonb_build_object('draw_id', d);
end;
$$;

create function public.select_winners(p_post_id uuid, p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  p public.posts;
  ev public.giveaway_events;
  d_id uuid;
  n int := coalesce(array_length(p_user_ids, 1), 0);
  w record;
  tid uuid;
begin
  select * into ev from public.giveaway_events where post_id = p_post_id for update;
  select * into p from public.posts where id = p_post_id;
  if not found or p.author_id <> uid then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if ev.method <> 'manual' then
    raise exception 'NOT_MANUAL' using errcode = 'P0001';
  end if;
  if ev.state <> 'open' or exists (select 1 from public.giveaway_draws where post_id = p_post_id) then
    raise exception 'ALREADY_DRAWN' using errcode = 'P0001';
  end if;
  if now() < ev.closes_at then
    raise exception 'DRAW_TOO_EARLY' using errcode = 'P0001';
  end if;
  if n < 1 or n > ev.winners_count + ev.reserve_count
     or (select count(distinct x) from unnest(p_user_ids) x) <> n
     or exists (select 1 from unnest(p_user_ids) x
                where not exists (select 1 from public.giveaway_entries e
                                   where e.post_id = p_post_id and e.user_id = x and e.status = 'active')) then
    raise exception 'INVALID_SELECTION' using errcode = 'P0001';
  end if;

  insert into public.giveaway_draws (post_id, method, executed_by, entries_count, eligible_count, eligible_hash, details)
  select p_post_id, 'manual', uid, count(*), count(*),
         private.sha256_hex(coalesce(string_agg(user_id::text, ',' order by user_id), '')),
         jsonb_build_object('outcome', 'drawn', 'ordering', 'chosen by giver')
    from public.giveaway_entries where post_id = p_post_id and status = 'active'
  returning id into d_id;

  insert into public.giveaway_winners (post_id, draw_id, rank, user_id, role)
  select p_post_id, d_id, x.ord::int, x.u, case when x.ord <= ev.winners_count then 'winner' else 'reserve' end
    from unnest(p_user_ids) with ordinality as x(u, ord);

  update public.giveaway_events set state = 'drawn' where post_id = p_post_id;
  for w in select * from public.giveaway_winners where post_id = p_post_id and role = 'winner' order by rank loop
    tid := private.create_giveaway_trade(p_post_id, w.user_id, 'manual_pick', w.rank);
    update public.giveaway_winners set trade_id = tid where post_id = p_post_id and rank = w.rank;
  end loop;
  perform private.refresh_post_status(p_post_id);
  perform private.notify_entrants(p_post_id);
  return jsonb_build_object('draw_id', d_id);
end;
$$;

create function public.cancel_giveaway(p_post_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  p public.posts;
  ev public.giveaway_events;
  admin boolean := private.is_admin(uid);
  e record;
begin
  select * into ev from public.giveaway_events where post_id = p_post_id for update;
  select * into p from public.posts where id = p_post_id;
  if not found or (p.author_id <> uid and not admin) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if ev.state <> 'open' then
    raise exception 'ALREADY_DRAWN' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  update public.giveaway_events set state = 'canceled', canceled_reason = left(btrim(p_reason), 200) where post_id = p_post_id;
  update public.posts set status = 'canceled', status_note = left(btrim(p_reason), 200), updated_at = now() where id = p_post_id;
  for e in select user_id from public.giveaway_entries where post_id = p_post_id and status = 'active' loop
    perform private.notify(e.user_id, 'giveaway_canceled', '참여한 나눔이 취소됐어요',
      format('「%s」 사유: %s', p.title, left(btrim(p_reason), 200)), '/posts/' || p.code);
  end loop;
  if admin and p.author_id <> uid then
    perform private.audit(uid, 'cancel_giveaway', 'post', p_post_id::text, jsonb_build_object('reason', p_reason));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Request offers and swap proposals (both create trades)
-- ---------------------------------------------------------------------------

create function public.offer_to_request(p_post_id uuid, p_quantity int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  p public.posts;
  want record;
  tid uuid;
begin
  select * into p from public.posts where id = p_post_id for update;
  if not found or p.kind <> 'REQUEST' or p.visibility <> 'public' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.author_id = uid then
    raise exception 'OWN_POST' using errcode = 'P0001';
  end if;
  if private.effective_post_status(p) <> 'open' then
    raise exception 'POST_CLOSED' using errcode = 'P0001';
  end if;
  if private.is_blocked_between(uid, p.author_id) then
    raise exception 'BLOCKED' using errcode = 'P0001';
  end if;
  select * into want from public.post_items where post_id = p.id and direction = 'want' limit 1;
  if p_quantity is null or p_quantity < 1 or p_quantity > want.quantity then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trades t join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = uid
              where t.post_id = p.id and (private.is_open_trade_status(t.status) or t.status = 'disputed')) then
    raise exception 'ALREADY_OFFERED' using errcode = 'P0001';
  end if;

  tid := private.create_trade_shell('giveaway', p.campaign_id, p.id, 'request_offer', private.setting_int('claim_hours', 24));
  insert into public.trade_participants (trade_id, user_id, role, sends, receives)
  values (tid, uid, 'giver', true, false), (tid, p.author_id, 'receiver', false, true);
  insert into public.trade_items (trade_id, seq, sender_id, receiver_id, sticker_type_id, quantity)
  values (tid, 1, uid, p.author_id, want.sticker_type_id, p_quantity);
  perform private.trade_event(tid, uid, 'trade_created', jsonb_build_object('origin', 'request_offer', 'post_code', p.code));
  perform private.record_consent(uid, 'trade_risk', tid);
  perform private.notify(p.author_id, 'request_offer', '나눔 제안이 왔어요',
    format('%s님이 「%s」에 %s장을 나눠 주고 싶어 해요. 거래 화면에서 스레드 아이디와 바코드를 입력해 주세요.', private.nickname(uid), p.title, p_quantity), '/trades/' || tid);
  return jsonb_build_object('trade_id', tid);
end;
$$;

create function public.propose_swap(p_post_id uuid, p_risk_ack boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member();
  p public.posts;
  tid uuid;
  it record;
  seq int := 0;
begin
  if not coalesce(p_risk_ack, false) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  select * into p from public.posts where id = p_post_id for update;
  if not found or p.kind <> 'SWAP' or p.visibility <> 'public' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.author_id = uid then
    raise exception 'OWN_POST' using errcode = 'P0001';
  end if;
  if private.effective_post_status(p) <> 'open' then
    raise exception 'POST_CLOSED' using errcode = 'P0001';
  end if;
  if private.is_blocked_between(uid, p.author_id) then
    raise exception 'BLOCKED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trades t join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = uid
              where t.post_id = p.id and (private.is_open_trade_status(t.status) or t.status = 'disputed')) then
    raise exception 'ALREADY_PROPOSED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.trades t join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = uid
       where t.kind = 'swap' and (private.is_open_trade_status(t.status) or t.status = 'disputed'))
     >= private.setting_int('max_active_swaps', 3) then
    raise exception 'TOO_MANY_ACTIVE_SWAPS' using errcode = 'P0001';
  end if;

  tid := private.create_trade_shell('swap', p.campaign_id, p.id, 'swap_proposal', private.setting_int('swap_accept_hours', 24));
  insert into public.trade_participants (trade_id, user_id, role, sends, receives)
  values (tid, uid, 'swapper', true, true), (tid, p.author_id, 'swapper', true, true);
  for it in select * from public.post_items where post_id = p.id order by direction, sticker_type_id loop
    seq := seq + 1;
    insert into public.trade_items (trade_id, seq, sender_id, receiver_id, sticker_type_id, quantity)
    values (tid, seq,
            case when it.direction = 'offer' then p.author_id else uid end,
            case when it.direction = 'offer' then uid else p.author_id end,
            it.sticker_type_id, it.quantity);
  end loop;
  perform private.trade_event(tid, uid, 'trade_created', jsonb_build_object('origin', 'swap_proposal', 'post_code', p.code));
  perform private.record_consent(uid, 'trade_risk', tid);
  perform private.notify(p.author_id, 'swap_proposed', '교환 제안이 왔어요',
    format('%s님이 「%s」 조건으로 교환하고 싶어 해요.', private.nickname(uid), p.title), '/trades/' || tid);
  return jsonb_build_object('trade_id', tid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Trade actions
-- ---------------------------------------------------------------------------

create function private.lock_participant(p_trade uuid, p_user uuid, out t public.trades, out me public.trade_participants)
language plpgsql set search_path = '' as $$
begin
  select * into t from public.trades where id = p_trade for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into me from public.trade_participants where trade_id = p_trade and user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- Step 1: every participant enters a Threads ID; receivers also enter their barcode number.
-- Changing it later resets everyone's confirmation.
create function public.submit_trade_info(p_trade_id uuid, p_threads_handle text, p_barcode text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
  h text := regexp_replace(btrim(coalesce(p_threads_handle, '')), '^@', '');
  digits text := regexp_replace(coalesce(p_barcode, ''), '[\s-]', '', 'g');
  first_time boolean;
  other record;
begin
  r := private.lock_participant(p_trade_id, uid);
  if (r.t).status not in ('proposed', 'accepted') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  if h !~ '^[A-Za-z0-9_.]{1,30}$' then
    raise exception 'INVALID_HANDLE' using errcode = 'P0001';
  end if;
  if (r.me).receives and digits !~ '^[0-9]{8,24}$' then
    raise exception 'INVALID_BARCODE' using errcode = 'P0001';
  end if;
  first_time := (r.me).accepted_at is null;

  if (r.me).receives then
    insert into private.barcode_secrets (trade_id, owner_id, ciphertext, last4)
    values (p_trade_id, uid, extensions.pgp_sym_encrypt(digits, private.barcode_key()), right(digits, 4))
    on conflict (trade_id, owner_id) do update
      set ciphertext = excluded.ciphertext, last4 = excluded.last4, created_at = now(), purged_at = null, view_count = 0;
    perform private.record_consent(uid, 'barcode_provision', p_trade_id);
  end if;
  perform private.record_consent(uid, 'trade_risk', p_trade_id);

  update public.trade_participants
     set threads_handle = h,
         accepted_at = coalesce(accepted_at, now()),
         barcode_ready_at = case when receives then now() else barcode_ready_at end
   where trade_id = p_trade_id and user_id = uid;
  update public.trade_participants set peer_confirmed_at = null
   where trade_id = p_trade_id and peer_confirmed_at is not null;

  -- remember my latest handle for next time (an operator-verified handle is kept as is)
  insert into public.threads_profiles (user_id, handle) values (uid, h)
  on conflict (user_id) do update
    set handle = excluded.handle, status = 'unverified', verify_code = null, requested_at = null,
        decided_at = null, decided_by = null, updated_at = now()
    where public.threads_profiles.status <> 'verified' and public.threads_profiles.handle <> excluded.handle;

  perform private.trade_event(p_trade_id, uid, case when first_time then 'info_submitted' else 'info_updated' end, '{}'::jsonb);
  perform private.notify(tp.user_id, 'trade_info', '상대가 거래 정보를 입력했어요',
    case when first_time then '스레드 아이디를 확인해 주세요.' else '상대가 정보를 고쳤어요. 다시 확인해 주세요.' end,
    '/trades/' || p_trade_id)
    from public.trade_participants tp where tp.trade_id = p_trade_id and tp.user_id <> uid;

  -- a swap post is fulfilled once: when its author joins one proposal, the other pending ones are declined
  if (r.t).kind = 'swap' and first_time
     and exists (select 1 from public.posts where id = (r.t).post_id and author_id = uid) then
    for other in select t.id from public.trades t
                  where t.post_id = (r.t).post_id and t.id <> p_trade_id and t.status = 'proposed' loop
      perform private.close_trade(other.id, 'rejected', null, '게시자가 다른 제안을 수락했어요', false);
    end loop;
  end if;
  return jsonb_build_object('status', private.recompute_trade(p_trade_id, uid));
end;
$$;

-- Step 2: after checking the counterpart's Threads ID. When everyone confirmed, barcodes open to senders.
create function public.confirm_peer(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
begin
  r := private.lock_participant(p_trade_id, uid);
  if (r.me).peer_confirmed_at is not null then
    return jsonb_build_object('status', (r.t).status);
  end if;
  if (r.t).status <> 'accepted' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  update public.trade_participants set peer_confirmed_at = now() where trade_id = p_trade_id and user_id = uid;
  -- save who I confirmed (nickname via profile + their Threads ID) to my account
  insert into public.saved_contacts (owner_id, contact_id, threads_handle, last_trade_id)
  select uid, tp.user_id, tp.threads_handle, p_trade_id
    from public.trade_participants tp where tp.trade_id = p_trade_id and tp.user_id <> uid
  on conflict (owner_id, contact_id) do update
    set threads_handle = excluded.threads_handle, last_trade_id = excluded.last_trade_id, last_confirmed_at = now();
  perform private.trade_event(p_trade_id, uid, 'peer_confirmed', '{}'::jsonb, 'peer:' || uid || ':' || (r.me).accepted_at);
  perform private.notify(tp.user_id, 'peer_confirmed', '상대가 나를 확인했어요',
    '나도 상대 스레드 아이디를 확인하면 다음 단계로 넘어가요.', '/trades/' || p_trade_id)
    from public.trade_participants tp
   where tp.trade_id = p_trade_id and tp.user_id <> uid and tp.peer_confirmed_at is null;
  return jsonb_build_object('status', private.recompute_trade(p_trade_id, uid));
end;
$$;

-- Returns the barcode number only to a sender of this trade, only while sending is possible.
-- Denials are returned (not raised) so that the access log row is kept.
create function public.reveal_barcode(p_trade_id uuid, p_owner_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trades;
  me public.trade_participants;
  owner uuid := p_owner_id;
  sec private.barcode_secrets;
  lim int := private.setting_int('barcode_view_limit', 5);
  plain text;
  deny text := null;
begin
  if uid is null then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;
  select * into t from public.trades where id = p_trade_id for update;
  select * into me from public.trade_participants where trade_id = p_trade_id and user_id = uid;
  if t.id is null or me.trade_id is null or not me.sends then
    deny := 'not_sender';
  end if;
  if deny is null and owner is null then
    select receiver_id into owner from public.trade_items where trade_id = p_trade_id and sender_id = uid limit 1;
  end if;
  if deny is null and not exists (select 1 from public.trade_items where trade_id = p_trade_id and sender_id = uid and receiver_id = owner) then
    deny := 'not_sender_for_owner';
  end if;
  if deny is null and exists (select 1 from public.profiles where user_id = uid and account_status = 'suspended') then
    deny := 'suspended';
  end if;
  if deny is null and t.status not in ('ready', 'transfer_in_progress') then
    deny := 'not_ready';
  end if;
  if deny is null and me.sent_declared_at is not null then
    deny := 'already_sent';
  end if;
  if deny is null then
    select * into sec from private.barcode_secrets where trade_id = p_trade_id and owner_id = owner for update;
    if not found or sec.ciphertext is null then
      deny := 'missing';
    elsif sec.view_count >= lim then
      deny := 'view_limit';
    end if;
  end if;

  insert into private.barcode_access_logs (trade_id, owner_id, accessor_id, result)
  values (p_trade_id, coalesce(owner, '00000000-0000-0000-0000-000000000000'::uuid), uid, coalesce('denied:' || deny, 'shown'));
  if deny is not null then
    return jsonb_build_object('ok', false, 'error', upper('BARCODE_' || deny));
  end if;

  plain := extensions.pgp_sym_decrypt(sec.ciphertext, private.barcode_key());
  update private.barcode_secrets set view_count = view_count + 1 where trade_id = p_trade_id and owner_id = owner;
  if me.barcode_opened_at is null then
    update public.trade_participants set barcode_opened_at = now() where trade_id = p_trade_id and user_id = uid;
  end if;
  perform private.trade_event(p_trade_id, uid, 'barcode_opened', '{}'::jsonb, 'open:' || uid || ':' || owner);
  perform private.recompute_trade(p_trade_id, uid);
  return jsonb_build_object('ok', true, 'barcode', plain, 'owner_nickname', private.nickname(owner),
                            'views_left', lim - sec.view_count - 1);
end;
$$;

create function public.declare_sent(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
begin
  r := private.lock_participant(p_trade_id, uid);
  if not (r.me).sends then
    raise exception 'NOT_SENDER' using errcode = 'P0001';
  end if;
  if (r.me).sent_declared_at is not null then
    return jsonb_build_object('status', (r.t).status);
  end if;
  if (r.t).status not in ('ready', 'transfer_in_progress') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  update public.trade_participants set sent_declared_at = now() where trade_id = p_trade_id and user_id = uid;
  perform private.trade_event(p_trade_id, uid, 'sent_declared', '{}'::jsonb, 'sent:' || uid);
  perform private.notify(i.receiver_id, 'sent_declared', '상대가 보냈다고 신고했어요',
    '공식 앱에서 스티커가 들어왔는지 확인한 뒤 "받았어요"를 눌러 주세요.', '/trades/' || p_trade_id)
    from (select distinct receiver_id from public.trade_items where trade_id = p_trade_id and sender_id = uid) i;
  return jsonb_build_object('status', private.recompute_trade(p_trade_id, uid));
end;
$$;

create function public.confirm_receipt(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
begin
  r := private.lock_participant(p_trade_id, uid);
  if not (r.me).receives then
    raise exception 'NOT_RECEIVER' using errcode = 'P0001';
  end if;
  if (r.me).receipt_confirmed_at is not null then
    return jsonb_build_object('status', (r.t).status);
  end if;
  if (r.t).status not in ('transfer_in_progress', 'awaiting_receipt') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trade_items i
               join public.trade_participants s on s.trade_id = i.trade_id and s.user_id = i.sender_id
              where i.trade_id = p_trade_id and i.receiver_id = uid and s.sent_declared_at is null) then
    raise exception 'SENDER_NOT_DECLARED' using errcode = 'P0001';
  end if;
  update public.trade_participants set receipt_confirmed_at = now() where trade_id = p_trade_id and user_id = uid;
  perform private.trade_event(p_trade_id, uid, 'receipt_confirmed', '{}'::jsonb, 'receipt:' || uid);
  return jsonb_build_object('status', private.recompute_trade(p_trade_id, uid));
end;
$$;

create function public.cancel_trade(p_trade_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
  any_declared boolean;
  deadline_passed boolean;
  new_status text;
  reason text;
begin
  r := private.lock_participant(p_trade_id, uid);
  select coalesce(bool_or(sent_declared_at is not null), false) into any_declared
    from public.trade_participants where trade_id = p_trade_id;
  deadline_passed := (r.t).stage_deadline_at is not null and (r.t).stage_deadline_at <= now();

  if (r.t).status in ('proposed', 'accepted', 'ready') then
    null; -- nobody has opened a barcode yet
  elsif (r.t).status = 'transfer_in_progress' and not any_declared and deadline_passed then
    null;
  else
    raise exception 'CANNOT_CANCEL_NOW' using errcode = 'P0001';
  end if;

  new_status := case when (r.t).status = 'proposed' and (r.me).accepted_at is null then 'rejected' else 'canceled' end;
  reason := coalesce(nullif(left(btrim(p_reason), 200), ''),
    case
      when (r.t).kind = 'giveaway' and (r.me).role = 'receiver' then '받는 분이 수령을 포기했어요'
      when (r.t).kind = 'giveaway' and (r.me).role = 'giver' then '나눔자가 거래를 취소했어요'
      when new_status = 'rejected' then '제안을 거절했어요'
      else '참여자가 거래를 취소했어요' end);
  perform private.trade_event(p_trade_id, uid, 'cancel_requested', jsonb_build_object('reason', reason, 'role', (r.me).role));
  perform private.close_trade(p_trade_id, new_status, uid, reason,
    (r.t).kind = 'giveaway' and (r.me).role = 'receiver');
  return jsonb_build_object('status', new_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports and blocks
-- ---------------------------------------------------------------------------

create function private.check_report_rate(p_user uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if (select count(*) from public.reports where reporter_id = p_user and created_at > now() - interval '1 day')
     >= private.setting_int('max_reports_per_day', 20) then
    raise exception 'TOO_MANY_REPORTS' using errcode = 'P0001';
  end if;
end;
$$;

create function public.report_trade(p_trade_id uuid, p_reason text, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  r record;
  other uuid;
  rep public.reports;
begin
  r := private.lock_participant(p_trade_id, uid);
  perform private.check_report_rate(uid);
  select user_id into other from public.trade_participants where trade_id = p_trade_id and user_id <> uid limit 1;
  insert into public.reports (reporter_id, target_kind, trade_id, target_user_id, reason, detail)
  values (uid, 'trade', p_trade_id, other, p_reason, coalesce(left(p_detail, 1000), ''))
  returning * into rep;
  perform private.trade_event(p_trade_id, uid, 'problem_reported', jsonb_build_object('report_no', rep.report_no, 'reason', p_reason));
  if (r.t).status in ('accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt') then
    perform private.open_dispute(p_trade_id, uid, p_reason);
  end if;
  return jsonb_build_object('report_no', rep.report_no, 'status', (select status from public.trades where id = p_trade_id));
end;
$$;

create function public.report_target(p_kind text, p_target uuid, p_reason text, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  rep public.reports;
begin
  perform private.check_report_rate(uid);
  if p_kind = 'post' then
    if not exists (select 1 from public.posts where id = p_target) then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    insert into public.reports (reporter_id, target_kind, post_id, target_user_id, reason, detail)
    select uid, 'post', p_target, author_id, p_reason, coalesce(left(p_detail, 1000), '') from public.posts where id = p_target
    returning * into rep;
  elsif p_kind = 'user' then
    if not exists (select 1 from public.profiles where user_id = p_target) or p_target = uid then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    insert into public.reports (reporter_id, target_kind, target_user_id, reason, detail)
    values (uid, 'user', p_target, p_reason, coalesce(left(p_detail, 1000), ''))
    returning * into rep;
  else
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  return jsonb_build_object('report_no', rep.report_no);
end;
$$;

create function public.my_reports() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'report_no', r.report_no, 'target_kind', r.target_kind, 'reason', r.reason, 'status', r.status,
           'resolution', r.resolution, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
           'trade_id', r.trade_id, 'post_code', (select code from public.posts where id = r.post_id))
         order by r.created_at desc), '[]'::jsonb)
  from public.reports r where r.reporter_id = auth.uid();
$$;

create function public.set_block(p_nickname text, p_block boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  target uuid;
begin
  select user_id into target from public.profiles where lower(nickname) = lower(btrim(p_nickname));
  if target is null or target = uid then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_block then
    insert into public.blocks (blocker_id, blocked_id) values (uid, target) on conflict do nothing;
  else
    delete from public.blocks where blocker_id = uid and blocked_id = target;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.my_blocks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nickname', pr.nickname, 'created_at', b.created_at) order by b.created_at desc), '[]'::jsonb)
  from public.blocks b join public.profiles pr on pr.user_id = b.blocked_id
  where b.blocker_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Trades: read
-- ---------------------------------------------------------------------------

create function public.get_trade(p_trade_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trades;
  me public.trade_participants;
  admin boolean;
  my_bc private.barcode_secrets;
  senders_to_me_declared boolean;
  any_declared boolean;
  deadline_passed boolean;
begin
  if uid is null then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;
  select * into t from public.trades where id = p_trade_id;
  select * into me from public.trade_participants where trade_id = p_trade_id and user_id = uid;
  admin := private.is_admin(uid);
  if t.id is null or (me.trade_id is null and not admin) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into my_bc from private.barcode_secrets where trade_id = p_trade_id and owner_id = uid;
  select coalesce(bool_and(s.sent_declared_at is not null), true) into senders_to_me_declared
    from public.trade_items i join public.trade_participants s on s.trade_id = i.trade_id and s.user_id = i.sender_id
   where i.trade_id = p_trade_id and i.receiver_id = uid;
  select coalesce(bool_or(sent_declared_at is not null), false) into any_declared
    from public.trade_participants where trade_id = p_trade_id;
  deadline_passed := t.stage_deadline_at is not null and t.stage_deadline_at <= now();

  return jsonb_build_object(
    'id', t.id, 'trade_no', t.trade_no, 'kind', t.kind, 'origin', t.origin, 'status', t.status,
    'stage_deadline_at', t.stage_deadline_at, 'deadline_passed', deadline_passed,
    'dispute_reason', t.dispute_reason, 'close_reason', t.close_reason,
    'official_transfer_verified', t.official_transfer_verified,
    'created_at', t.created_at, 'completed_at', t.completed_at, 'closed_at', t.closed_at,
    'post', (select jsonb_build_object('code', p.code, 'title', p.title, 'kind', p.kind) from public.posts p where p.id = t.post_id),
    'me', case when me.trade_id is null then null else jsonb_build_object(
      'role', me.role, 'sends', me.sends, 'receives', me.receives, 'accepted_at', me.accepted_at,
      'threads_handle', me.threads_handle, 'peer_confirmed_at', me.peer_confirmed_at,
      'barcode_ready_at', me.barcode_ready_at, 'barcode_opened_at', me.barcode_opened_at,
      'sent_declared_at', me.sent_declared_at, 'receipt_confirmed_at', me.receipt_confirmed_at) end,
    'participants', (select jsonb_agg(jsonb_build_object(
        'user_id', tp.user_id, 'nickname', pr.nickname, 'role', tp.role, 'sends', tp.sends, 'receives', tp.receives,
        'is_me', tp.user_id = uid, 'accepted_at', tp.accepted_at, 'barcode_ready_at', tp.barcode_ready_at,
        'threads_handle', tp.threads_handle, 'peer_confirmed_at', tp.peer_confirmed_at,
        'barcode_opened_at', tp.barcode_opened_at, 'sent_declared_at', tp.sent_declared_at,
        'receipt_confirmed_at', tp.receipt_confirmed_at,
        'badge', private.member_badge(tp.user_id, t.campaign_id)) order by tp.role, pr.nickname)
      from public.trade_participants tp join public.profiles pr on pr.user_id = tp.user_id where tp.trade_id = t.id),
    'items', (select jsonb_agg(jsonb_build_object(
        'seq', i.seq, 'sender_id', i.sender_id, 'receiver_id', i.receiver_id,
        'sender', ps.nickname, 'receiver', pr.nickname, 'code', st.code, 'name', st.name, 'quantity', i.quantity) order by i.seq)
      from public.trade_items i
      join public.profiles ps on ps.user_id = i.sender_id
      join public.profiles pr on pr.user_id = i.receiver_id
      join public.sticker_types st on st.id = i.sticker_type_id
      where i.trade_id = t.id),
    'events', (select jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', e.event_type, 'actor', pr.nickname, 'at', e.occurred_at, 'meta', e.meta) order by e.id)
      from public.trade_events e left join public.profiles pr on pr.user_id = e.actor_id where e.trade_id = t.id),
    'my_barcode', case when me.receives then jsonb_build_object(
        'submitted', my_bc.trade_id is not null, 'last4', my_bc.last4, 'view_count', coalesce(my_bc.view_count, 0),
        'purged', my_bc.purged_at is not null,
        'last_viewed_at', (select max(accessed_at) from private.barcode_access_logs
                            where trade_id = t.id and owner_id = uid and result = 'shown')) end,
    'barcode_view_limit', private.setting_int('barcode_view_limit', 5),
    'can', case when me.trade_id is null then '{}'::jsonb else jsonb_build_object(
      'submit_info', t.status in ('proposed', 'accepted'),
      'confirm_peer', t.status = 'accepted' and me.peer_confirmed_at is null,
      'reveal_barcode', me.sends and t.status in ('ready', 'transfer_in_progress') and me.sent_declared_at is null,
      'declare_sent', me.sends and t.status in ('ready', 'transfer_in_progress') and me.sent_declared_at is null,
      'confirm_receipt', me.receives and t.status in ('transfer_in_progress', 'awaiting_receipt')
                         and me.receipt_confirmed_at is null and senders_to_me_declared,
      'cancel', t.status in ('proposed', 'accepted', 'ready')
                or (t.status = 'transfer_in_progress' and not any_declared and deadline_passed),
      'report', true) end);
end;
$$;

create function public.my_trades(p_filter text default 'all') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.updated_at desc), '[]'::jsonb)
  from (
    select t.updated_at, jsonb_build_object(
      'id', t.id, 'trade_no', t.trade_no, 'kind', t.kind, 'status', t.status, 'my_role', tp.role,
      'sends', tp.sends, 'receives', tp.receives,
      'stage_deadline_at', t.stage_deadline_at, 'created_at', t.created_at, 'updated_at', t.updated_at,
      'completed_at', t.completed_at,
      'post', (select jsonb_build_object('code', p.code, 'title', p.title) from public.posts p where p.id = t.post_id),
      'counterpart', (select pr.nickname from public.trade_participants o join public.profiles pr on pr.user_id = o.user_id
                       where o.trade_id = t.id and o.user_id <> tp.user_id limit 1),
      'items', (select jsonb_agg(jsonb_build_object('code', st.code, 'name', st.name, 'quantity', i.quantity,
                                                    'direction', case when i.sender_id = tp.user_id then 'give' else 'get' end) order by i.seq)
                  from public.trade_items i join public.sticker_types st on st.id = i.sticker_type_id where i.trade_id = t.id),
      'needs_action',
        (t.status = 'proposed' and tp.accepted_at is null)
        or (t.status = 'accepted' and tp.peer_confirmed_at is null)
        or (t.status in ('ready', 'transfer_in_progress') and tp.sends and tp.sent_declared_at is null)
        or (t.status in ('transfer_in_progress', 'awaiting_receipt') and tp.receives and tp.receipt_confirmed_at is null
            and not exists (select 1 from public.trade_items i join public.trade_participants s
                              on s.trade_id = i.trade_id and s.user_id = i.sender_id
                             where i.trade_id = t.id and i.receiver_id = tp.user_id and s.sent_declared_at is null))) as j
    from public.trades t
    join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = auth.uid()
    where case coalesce(p_filter, 'all')
      when 'giveaway' then t.kind = 'giveaway'
      when 'swap' then t.kind = 'swap'
      when 'active' then private.is_open_trade_status(t.status)
      when 'done' then t.status in ('completed', 'resolved_completed')
      when 'problem' then t.status in ('disputed', 'resolved_unfulfilled', 'closed_unresolved')
      else true end
    limit 200
  ) x;
$$;

create function public.my_summary() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'campaign', (select jsonb_build_object('given', coalesce(mp.given_count, 0), 'received', coalesce(mp.received_count, 0),
                                           'swaps', coalesce(mp.swap_count, 0), 'level', private.level_info(coalesce(mp.given_count, 0)))
                   from public.campaigns c
                   left join public.member_progress mp on mp.campaign_id = c.id and mp.user_id = auth.uid()
                  where c.status = 'active' order by c.starts_at desc limit 1),
    'all_time', (select jsonb_build_object('given', coalesce(sum(given_count), 0), 'received', coalesce(sum(received_count), 0),
                                           'swaps', coalesce(sum(swap_count), 0))
                   from public.member_progress where user_id = auth.uid()),
    'trades', (select jsonb_build_object(
                  'active', count(*) filter (where private.is_open_trade_status(t.status)),
                  'done', count(*) filter (where t.status in ('completed', 'resolved_completed')),
                  'problem', count(*) filter (where t.status in ('disputed', 'resolved_unfulfilled', 'closed_unresolved')),
                  'total', count(*))
                 from public.trades t join public.trade_participants tp on tp.trade_id = t.id and tp.user_id = auth.uid()),
    'progress_events', (select coalesce(jsonb_agg(jsonb_build_object('kind', pe.event_kind, 'delta', pe.delta, 'at', pe.created_at,
                                                                     'trade_id', pe.source_trade_id, 'note', pe.note) order by pe.id desc), '[]'::jsonb)
                          from public.progress_events pe where pe.user_id = auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Saved trade contacts (filled automatically when I confirm a counterpart)
-- ---------------------------------------------------------------------------

create function public.my_contacts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'contact_id', c.contact_id,
           'nickname', pr.nickname,
           'threads_handle', c.threads_handle,
           'first_confirmed_at', c.first_confirmed_at,
           'last_confirmed_at', c.last_confirmed_at,
           'last_trade', (select jsonb_build_object('id', t.id, 'trade_no', t.trade_no, 'status', t.status, 'kind', t.kind,
                                                    'post_title', (select title from public.posts where id = t.post_id))
                            from public.trades t where t.id = c.last_trade_id),
           'trades_together', (select count(*) from public.trade_participants a
                                 join public.trade_participants b on b.trade_id = a.trade_id and b.user_id = c.contact_id
                                where a.user_id = c.owner_id),
           'blocked', private.is_blocked_between(c.owner_id, c.contact_id),
           'badge', private.member_badge(c.contact_id,
                      (select id from public.campaigns where status = 'active' order by starts_at desc limit 1)) - 'user_id')
         order by c.last_confirmed_at desc), '[]'::jsonb)
  from public.saved_contacts c join public.profiles pr on pr.user_id = c.contact_id
  where c.owner_id = auth.uid();
$$;

create function public.delete_contact(p_contact_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
begin
  delete from public.saved_contacts where owner_id = uid and contact_id = p_contact_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications and Threads link
-- ---------------------------------------------------------------------------

create function public.my_notifications(p_limit int default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(n) - 'user_id' order by n.id desc), '[]'::jsonb)
  from (select * from public.notifications where user_id = auth.uid() order by id desc
        limit least(greatest(coalesce(p_limit, 30), 1), 100)) n;
$$;

create function public.mark_notifications_read(p_ids bigint[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_threads_handle(p_handle text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  h text := regexp_replace(btrim(coalesce(p_handle, '')), '^@', '');
begin
  if h = '' then
    delete from public.threads_profiles where user_id = uid;
    return jsonb_build_object('ok', true);
  end if;
  if h !~ '^[A-Za-z0-9_.]{1,30}$' then
    raise exception 'INVALID_HANDLE' using errcode = 'P0001';
  end if;
  insert into public.threads_profiles (user_id, handle, status) values (uid, h, 'unverified')
  on conflict (user_id) do update set handle = excluded.handle, status = 'unverified', verify_code = null,
    requested_at = null, decided_at = null, decided_by = null, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create function public.request_threads_verification() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.current_member(true);
  c text := 'FN-' || upper(substr(private.new_code(), 1, 6));
begin
  update public.threads_profiles set status = 'pending', verify_code = c, requested_at = now(), updated_at = now()
   where user_id = uid and status in ('unverified', 'rejected', 'pending');
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return jsonb_build_object('verify_code', c);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'reports_open', (select count(*) from public.reports where status in ('received', 'reviewing')),
    'trades_disputed', (select count(*) from public.trades where status = 'disputed'),
    'trades_overdue', (select count(*) from public.trades where private.is_open_trade_status(status) and stage_deadline_at <= now()),
    'trades_active', (select count(*) from public.trades where private.is_open_trade_status(status)),
    'trades_completed', (select count(*) from public.trades where status in ('completed', 'resolved_completed')),
    'stickers_given', (select coalesce(sum(i.quantity), 0) from public.trade_items i join public.trades t on t.id = i.trade_id
                        where t.kind = 'giveaway' and t.status = 'completed'),
    'posts_open', (select count(*) from public.posts where status = 'open' and closes_at > now() and visibility = 'public'),
    'members', (select count(*) from public.profiles),
    'givers', (select count(distinct author_id) from public.posts where kind = 'GIVEAWAY'),
    'threads_pending', (select count(*) from public.threads_profiles where status = 'pending'),
    'notifications_unread', (select count(*) from public.notifications where read_at is null));
end;
$$;

create function public.admin_list_reports(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'report_no', r.report_no, 'target_kind', r.target_kind, 'reason', r.reason, 'detail', r.detail,
      'status', r.status, 'resolution', r.resolution, 'created_at', r.created_at,
      'reporter', (select nickname from public.profiles where user_id = r.reporter_id),
      'target_user', (select nickname from public.profiles where user_id = r.target_user_id),
      'trade_id', r.trade_id, 'trade_status', (select status from public.trades where id = r.trade_id),
      'post_id', r.post_id,
      'post_code', (select code from public.posts where id = r.post_id)) order by r.created_at desc), '[]'::jsonb)
    from public.reports r
    where p_status is null or r.status = p_status
    limit 200);
end;
$$;

create function public.admin_update_report(p_report_id uuid, p_status text, p_resolution text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  rep public.reports;
begin
  if p_status not in ('reviewing', 'resolved', 'rejected') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  update public.reports set status = p_status, resolution = left(p_resolution, 1000), updated_at = now(),
         resolved_by = case when p_status in ('resolved', 'rejected') then admin end,
         resolved_at = case when p_status in ('resolved', 'rejected') then now() end
   where id = p_report_id returning * into rep;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.audit(admin, 'update_report', 'report', p_report_id::text,
    jsonb_build_object('status', p_status, 'resolution', p_resolution));
  perform private.notify(rep.reporter_id, 'report_updated', format('신고 #%s 처리 상태가 바뀌었어요', rep.report_no),
    coalesce(p_resolution, ''), '/me/reports');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_list_trades(p_filter text default 'disputed') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'trade_no', t.trade_no, 'kind', t.kind, 'status', t.status, 'dispute_reason', t.dispute_reason,
      'stage_deadline_at', t.stage_deadline_at, 'updated_at', t.updated_at,
      'participants', (select jsonb_agg(pr.nickname) from public.trade_participants tp join public.profiles pr on pr.user_id = tp.user_id
                        where tp.trade_id = t.id),
      'post', (select jsonb_build_object('code', p.code, 'title', p.title) from public.posts p where p.id = t.post_id))
      order by t.updated_at desc), '[]'::jsonb)
    from (select * from public.trades t
           where case coalesce(p_filter, 'disputed')
             when 'disputed' then t.status = 'disputed'
             when 'overdue' then private.is_open_trade_status(t.status) and t.stage_deadline_at <= now()
             when 'active' then private.is_open_trade_status(t.status)
             else true end
           order by t.updated_at desc limit 200) t);
end;
$$;

create function public.admin_resolve_trade(p_trade_id uuid, p_outcome text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  t public.trades;
begin
  select * into t from public.trades where id = p_trade_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if t.status <> 'disputed' and not private.is_open_trade_status(t.status) then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if p_outcome not in ('resolved_completed', 'resolved_unfulfilled', 'closed_unresolved') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform private.trade_event(p_trade_id, admin, 'admin_resolution', jsonb_build_object('outcome', p_outcome, 'note', p_note));
  perform private.close_trade(p_trade_id, p_outcome, admin, left(p_note, 300), false);
  perform private.audit(admin, 'resolve_trade', 'trade', p_trade_id::text, jsonb_build_object('outcome', p_outcome, 'note', p_note));
  return jsonb_build_object('status', p_outcome);
end;
$$;

create function public.admin_set_post_visibility(p_post_id uuid, p_visibility text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  p public.posts;
begin
  if p_visibility not in ('public', 'hidden_by_admin') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  update public.posts set visibility = p_visibility, updated_at = now() where id = p_post_id returning * into p;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.audit(admin, 'set_post_visibility', 'post', p_post_id::text,
    jsonb_build_object('visibility', p_visibility, 'reason', p_reason));
  if p_visibility = 'hidden_by_admin' then
    perform private.notify(p.author_id, 'post_hidden', '게시글이 운영 정책에 따라 숨겨졌어요',
      coalesce(p_reason, ''), '/posts/' || p.code);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_find_member(p_nickname text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  pr public.profiles;
begin
  perform private.require_admin();
  select * into pr from public.profiles where lower(nickname) = lower(btrim(p_nickname));
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'user_id', pr.user_id, 'nickname', pr.nickname, 'role', pr.role, 'account_status', pr.account_status,
    'restricted_until', pr.restricted_until, 'status_reason', pr.status_reason, 'created_at', pr.created_at,
    'badge', private.member_badge(pr.user_id, (select id from public.campaigns where status = 'active' order by starts_at desc limit 1)),
    'reports_against', (select count(*) from public.reports where target_user_id = pr.user_id),
    'trades', (select count(*) from public.trade_participants where user_id = pr.user_id),
    'disputes', (select count(*) from public.trade_participants tp join public.trades t on t.id = tp.trade_id
                  where tp.user_id = pr.user_id and t.status in ('disputed', 'resolved_unfulfilled', 'closed_unresolved')));
end;
$$;

create function public.admin_set_account_status(p_user_id uuid, p_status text, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
begin
  if p_status not in ('active', 'restricted', 'suspended') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  update public.profiles set account_status = p_status, restricted_until = case when p_status = 'restricted' then p_until end,
         status_reason = left(p_reason, 300), updated_at = now()
   where user_id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.audit(admin, 'set_account_status', 'user', p_user_id::text,
    jsonb_build_object('status', p_status, 'until', p_until, 'reason', p_reason));
  perform private.notify(p_user_id, 'account_status', '계정 상태가 변경됐어요',
    format('상태: %s / 사유: %s · 이의가 있으면 도움말의 문의 경로로 알려 주세요.', p_status, p_reason), '/help');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_revoke_progress(p_trade_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  pe record;
  n int := 0;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  for pe in select * from public.progress_events where source_trade_id = p_trade_id and event_kind not like 'revoke_%' loop
    if private.grant_progress(pe.user_id, pe.campaign_id, p_trade_id, 'revoke_' || pe.event_kind, -pe.delta, admin, p_reason) then
      n := n + 1;
    end if;
  end loop;
  perform private.audit(admin, 'revoke_progress', 'trade', p_trade_id::text, jsonb_build_object('reason', p_reason, 'revoked', n));
  return jsonb_build_object('revoked', n);
end;
$$;

create function public.admin_set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  old jsonb;
begin
  select value into old from public.app_settings where key = p_key for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
  perform private.audit(admin, 'set_setting', 'setting', p_key, jsonb_build_object('old', old, 'new', p_value));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_update_campaign(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  c public.campaigns;
begin
  update public.campaigns set
    name = coalesce(p ->> 'name', name),
    starts_at = coalesce((p ->> 'starts_at')::timestamptz, starts_at),
    ends_at = coalesce((p ->> 'ends_at')::timestamptz, ends_at),
    status = coalesce(p ->> 'status', status),
    completion_rule = coalesce(p -> 'completion_rule', completion_rule),
    notice = coalesce(p ->> 'notice', notice)
  where slug = p_slug returning * into c;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.audit(admin, 'update_campaign', 'campaign', p_slug, p);
  return to_jsonb(c);
end;
$$;

create function public.admin_list_threads(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', th.user_id, 'nickname', pr.nickname, 'handle', th.handle, 'status', th.status,
      'verify_code', th.verify_code, 'requested_at', th.requested_at) order by th.requested_at), '[]'::jsonb)
    from public.threads_profiles th join public.profiles pr on pr.user_id = th.user_id
    where p_status is null or th.status = p_status);
end;
$$;

create function public.admin_decide_threads(p_user_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
begin
  update public.threads_profiles
     set status = case when p_approve then 'verified' else 'rejected' end,
         decided_at = now(), decided_by = admin, updated_at = now()
   where user_id = p_user_id and status = 'pending';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.audit(admin, 'decide_threads', 'user', p_user_id::text, jsonb_build_object('approve', p_approve));
  perform private.notify(p_user_id, 'threads_decided',
    case when p_approve then '스레드 계정 소유 확인이 끝났어요' else '스레드 계정 확인이 반려됐어요' end,
    case when p_approve then '프로필에 "계정 소유 확인" 표시가 붙어요. 실명·거래 안전 인증은 아니에요.'
         else '소개글에 인증코드가 보이는지 확인한 뒤 다시 요청해 주세요.' end, '/settings');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_audit_logs(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'admin', pr.nickname, 'action', l.action, 'target_kind', l.target_kind, 'target_id', l.target_id,
      'detail', l.detail, 'created_at', l.created_at) order by l.id desc), '[]'::jsonb)
    from (select * from public.admin_audit_logs order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l
    left join public.profiles pr on pr.user_id = l.admin_id);
end;
$$;

create function public.admin_run_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  admin uuid := private.require_admin();
  r jsonb;
begin
  r := private.process_deadlines();
  perform private.audit(admin, 'run_jobs', 'system', 'process_deadlines', r);
  return r;
end;
$$;

-- For pg_cron / service role only.
create function public.run_scheduled_jobs() returns jsonb
language sql security definer set search_path = '' as $$
  select private.process_deadlines();
$$;
