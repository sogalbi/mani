// QA acceptance tests from spec v3.0 §19, run against the local Supabase database.
//   npx supabase start && npm run test:db
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect, nick } from './helpers.mjs';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let db;
before(async () => {
  db = await connect();
});
after(async () => {
  await db.close();
});

describe('기본 동작', () => {
  test('비회원이 공유 링크(코드)로 게시글을 바로 열 수 있다', async () => {
    const giver = await db.createUser();
    const g = await db.giveaway(giver);
    const post = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.equal(post.code, g.code);
    assert.equal(post.kind, 'GIVEAWAY');
    assert.equal(post.giveaway.method, 'random');
    const list = await db.rpc(null, 'list_posts', {});
    assert.ok(list.some((p) => p.code === g.code));
  });

  test('비회원은 신청·등록 함수를 호출할 수 없다', async () => {
    const giver = await db.createUser();
    const g = await db.giveaway(giver);
    await assert.rejects(db.rpc(null, 'enter_giveaway', { p_post_id: g.id }), /permission denied/);
    await assert.rejects(db.rpc(null, 'create_giveaway', { p: {} }), /permission denied/);
  });

  test('로그인했지만 닉네임을 정하지 않은 사람은 신청할 수 없다', async () => {
    const giver = await db.createUser();
    const g = await db.giveaway(giver);
    const noProfile = await db.createUser(null);
    await assert.rejects(db.rpc(noProfile, 'enter_giveaway', { p_post_id: g.id }), /PROFILE_REQUIRED/);
    const me = await db.rpc(noProfile, 'get_me');
    assert.equal(me.needs_profile, true);
  });

  test('필수 동의 없이 가입할 수 없고 닉네임은 중복될 수 없다', async () => {
    const id = await db.createUser(null);
    await assert.rejects(
      db.rpc(id, 'register_profile', { p_nickname: nick(), p_agree_terms: true, p_agree_privacy: false }),
      /CONSENT_REQUIRED/,
    );
    const taken = nick();
    await db.createUser(taken);
    await assert.rejects(
      db.rpc(id, 'register_profile', { p_nickname: taken.toUpperCase(), p_agree_terms: true, p_agree_privacy: true }),
      /NICKNAME_TAKEN/,
    );
    const consents = await db.sql('select consent_type from public.consent_records where user_id = $1', [id]);
    assert.equal(consents.length, 0);
  });

  test('일반·미션 스티커와 장수를 정확히 저장한다', async () => {
    const author = await db.createUser();
    const g = await db.giveaway(author, { sticker_code: 'GENERAL', total_quantity: 6, per_winner_quantity: 2 });
    const post = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.deepEqual(post.items, [{ direction: 'offer', code: 'GENERAL', name: '일반', quantity: 6 }]);
    assert.equal(post.giveaway.winners_count, 3);
    assert.equal(post.giveaway.per_winner_quantity, 2);

    const s = await db.rpc(author, 'create_swap', {
      p: {
        title: '일반 2장 ↔ 미션 1장',
        offer: [{ sticker_code: 'GENERAL', quantity: 2 }],
        want: [{ sticker_code: 'MISSION', quantity: 1 }],
      },
    });
    const swap = await db.rpc(null, 'get_post', { p_code: s.code });
    assert.equal(swap.kind, 'SWAP');
    assert.equal(swap.items.length, 2);

    await assert.rejects(db.giveaway(author, { sticker_code: 'NOPE' }), /INVALID_STICKER_TYPE/);
    await assert.rejects(db.giveaway(author, { total_quantity: 0 }), /INVALID_QUANTITY/);
  });

  test('본인 글에는 참여할 수 없고, 같은 이벤트에 중복 신청할 수 없다', async () => {
    const giver = await db.createUser();
    const user = await db.createUser();
    const g = await db.giveaway(giver);
    await assert.rejects(db.rpc(giver, 'enter_giveaway', { p_post_id: g.id }), /OWN_POST/);
    await db.rpc(user, 'enter_giveaway', { p_post_id: g.id });
    await assert.rejects(db.rpc(user, 'enter_giveaway', { p_post_id: g.id }), /ALREADY_ENTERED/);
    const post = await db.rpc(user, 'get_post', { p_code: g.code });
    assert.equal(post.giveaway.entries_count, 1);
    assert.equal(post.giveaway.my_entry.status, 'active');
  });

  test('모집 마감 이후 새 신청은 거절된다', async () => {
    const giver = await db.createUser();
    const user = await db.createUser();
    const g = await db.giveaway(giver);
    await db.closeGiveaway(g.id);
    await assert.rejects(db.rpc(user, 'enter_giveaway', { p_post_id: g.id }), /ENTRY_CLOSED/);
  });

  test('클라이언트는 테이블을 직접 읽거나 쓸 수 없다', async () => {
    const user = await db.createUser();
    await assert.rejects(db.as(user, 'select * from public.posts'), /permission denied/);
    await assert.rejects(db.as(user, 'select * from public.trades'), /permission denied/);
    await assert.rejects(db.as(user, "update public.trades set status = 'completed'"), /permission denied/);
    await assert.rejects(db.as(user, 'select * from private.barcode_secrets'), /permission denied/);
    await assert.rejects(db.as(user, 'select * from private.giveaway_secrets'), /permission denied/);
    await assert.rejects(db.as(null, 'select * from public.profiles'), /permission denied/);
    // season config is public
    const camp = await db.as(null, 'select slug from public.campaigns');
    assert.ok(camp.some((c) => c.slug === '2026_winter'));
  });
});

describe('랜덤/게임', () => {
  test('랜덤 추첨: 마감 전 불가, 서버에서 1회만 실행, 당첨·예비 순서 기록', async () => {
    const giver = await db.createUser();
    const users = [];
    for (let i = 0; i < 6; i++) users.push(await db.createUser());
    const g = await db.giveaway(giver, { total_quantity: 2, per_winner_quantity: 1, reserve_count: 2 });
    for (const u of users) await db.rpc(u, 'enter_giveaway', { p_post_id: g.id });

    await assert.rejects(db.rpc(users[0], 'draw_giveaway', { p_post_id: g.id }), /DRAW_TOO_EARLY/);
    await db.closeGiveaway(g.id);

    const first = await db.rpc(users[0], 'draw_giveaway', { p_post_id: g.id });
    const again = await db.rpc(giver, 'draw_giveaway', { p_post_id: g.id });
    assert.equal(first.draw_id, again.draw_id);

    const winners = await db.sql('select rank, role, trade_id from public.giveaway_winners where post_id = $1 order by rank', [g.id]);
    assert.deepEqual(winners.map((w) => w.role), ['winner', 'winner', 'reserve', 'reserve']);
    assert.ok(winners[0].trade_id && winners[1].trade_id);
    assert.equal(winners[2].trade_id, null);
    const trades = await db.sql('select count(*)::int as n from public.trades where post_id = $1', [g.id]);
    assert.equal(trades[0].n, 2);

    const post = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.equal(post.giveaway.draw.entries_count, 6);
    assert.equal(post.giveaway.draw.seed.length, 64);
    assert.ok(post.giveaway.draw.winners.every((w) => w.nickname.includes('*')), '공개 결과는 닉네임을 가린다');
  });

  test('추첨을 동시에 두 번 눌러도 이중 당첨이 생기지 않는다', async () => {
    const giver = await db.createUser();
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await db.createUser());
    const g = await db.giveaway(giver, { total_quantity: 1 });
    for (const u of users) await db.rpc(u, 'enter_giveaway', { p_post_id: g.id });
    await db.closeGiveaway(g.id);
    const other = await connect();
    try {
      const [a, b] = await Promise.all([
        db.rpc(users[0], 'draw_giveaway', { p_post_id: g.id }),
        other.rpc(users[1], 'draw_giveaway', { p_post_id: g.id }),
      ]);
      assert.equal(a.draw_id, b.draw_id);
    } finally {
      await other.close();
    }
    const n = await db.sql(
      `select (select count(*) from public.giveaway_draws where post_id = $1)::int as draws,
              (select count(*) from public.trades where post_id = $1)::int as trades`,
      [g.id],
    );
    assert.deepEqual(n[0], { draws: 1, trades: 1 });
  });

  test('가위바위보: 상대 패는 미리 확정·해시 공개, 마감 후 공개, 최다 승수 그룹에서 선정', async () => {
    const giver = await db.createUser();
    const g = await db.giveaway(giver, { method: 'rps', total_quantity: 2, per_winner_quantity: 1, reserve_count: 0 });
    const before = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.match(before.giveaway.rps_commitment, /^[0-9a-f]{64}$/);
    assert.equal(before.giveaway.draw, null);

    const picks = ['RRRR', 'PPPP', 'SSSS', 'RPSR', 'SPRS', 'PRSP'];
    const users = [];
    for (const p of picks) {
      const u = await db.createUser();
      users.push(u);
      await db.rpc(u, 'enter_giveaway', { p_post_id: g.id, p_rps: p });
    }
    await assert.rejects(db.rpc(users[0], 'enter_giveaway', { p_post_id: g.id, p_rps: 'RRRR' }), /ALREADY_ENTERED/);
    await assert.rejects(db.rpc(users[0], 'withdraw_entry', { p_post_id: g.id }).then(() =>
      db.rpc(users[0], 'enter_giveaway', { p_post_id: g.id, p_rps: 'PPPP' })), /REENTRY_NOT_ALLOWED/);
    // re-enter not allowed, so restore the original entry for the rest of the test
    await db.sql(`update public.giveaway_entries set status = 'active' where post_id = $1 and user_id = $2`, [g.id, users[0]]);

    // other entrants' moves are not visible
    const seenByOther = await db.rpc(users[1], 'get_post', { p_code: g.code });
    assert.equal(seenByOther.giveaway.my_entry.rps_choices, 'PPPP');
    assert.equal(JSON.stringify(seenByOther).includes('RPSR'), false);

    await db.closeGiveaway(g.id);
    await db.rpc(users[0], 'draw_giveaway', { p_post_id: g.id });
    const post = await db.rpc(null, 'get_post', { p_code: g.code });
    const d = post.giveaway.draw;
    assert.equal(sha256(`${d.revealed_rps_moves}:${d.revealed_nonce}`), before.giveaway.rps_commitment);

    const beats = { R: 'S', S: 'P', P: 'R' };
    const wins = (p) => [...p].filter((c, i) => beats[c] === d.revealed_rps_moves[i]).length;
    const scores = picks.map(wins);
    const winnerRows = await db.sql(
      `select user_id, rps_wins from public.giveaway_winners where post_id = $1 and role = 'winner' order by rank`, [g.id]);
    assert.equal(winnerRows.length, 2);
    const sorted = [...scores].sort((a, b) => b - a);
    assert.deepEqual(winnerRows.map((w) => w.rps_wins), sorted.slice(0, 2));
    for (const w of winnerRows) assert.equal(w.rps_wins, scores[users.indexOf(w.user_id)]);
  });

  test('퀴즈: 정답은 마감 전 비공개, 정답자 중에서만 추첨, 정답자가 없으면 사전 규칙대로 취소', async () => {
    const giver = await db.createUser();
    const quiz = { question: '스티커는 총 몇 장?', options: ['15', '17', '20'], answer: 1, zero_policy: 'cancel' };
    const g = await db.giveaway(giver, { method: 'quiz', quiz, total_quantity: 1 });
    const pub = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.equal(JSON.stringify(pub.giveaway).includes('"answer"'), false);
    assert.match(pub.giveaway.quiz_commitment, /^[0-9a-f]{64}$/);

    const right = await db.createUser();
    const wrong = await db.createUser();
    await db.rpc(right, 'enter_giveaway', { p_post_id: g.id, p_quiz_choice: 1 });
    await db.rpc(wrong, 'enter_giveaway', { p_post_id: g.id, p_quiz_choice: 0 });
    await assert.rejects(db.rpc(await db.createUser(), 'enter_giveaway', { p_post_id: g.id, p_quiz_choice: 9 }), /INVALID_QUIZ_CHOICE/);
    await db.closeGiveaway(g.id);
    await db.runJobs(); // scheduler draws automatically
    const post = await db.rpc(right, 'get_post', { p_code: g.code });
    assert.equal(post.giveaway.draw.revealed_quiz_answer, 1);
    assert.equal(sha256(`1:${post.giveaway.draw.revealed_nonce}`), pub.giveaway.quiz_commitment);
    assert.equal(post.giveaway.my_result.role, 'winner');
    assert.equal(post.giveaway.draw.eligible_count, 1);

    // nobody right → cancel policy
    const g2 = await db.giveaway(giver, { method: 'quiz', quiz, total_quantity: 1 });
    await db.rpc(wrong, 'enter_giveaway', { p_post_id: g2.id, p_quiz_choice: 2 });
    await db.closeGiveaway(g2.id);
    await db.rpc(wrong, 'draw_giveaway', { p_post_id: g2.id });
    const post2 = await db.rpc(null, 'get_post', { p_code: g2.code });
    assert.equal(post2.status, 'canceled');
    assert.equal(post2.giveaway.draw.outcome, 'no_correct_canceled');
    const t = await db.sql('select count(*)::int as n from public.trades where post_id = $1', [g2.id]);
    assert.equal(t[0].n, 0);
  });

  test('직접 선정은 랜덤처럼 표시하지 않고, 신청자 중에서만 고를 수 있다', async () => {
    const giver = await db.createUser();
    const a = await db.createUser();
    const b = await db.createUser();
    const outsider = await db.createUser();
    const g = await db.giveaway(giver, { method: 'manual', total_quantity: 1, reserve_count: 1 });
    await db.rpc(a, 'enter_giveaway', { p_post_id: g.id });
    await db.rpc(b, 'enter_giveaway', { p_post_id: g.id });
    await assert.rejects(db.rpc(a, 'draw_giveaway', { p_post_id: g.id }), /DRAW_TOO_EARLY|MANUAL_SELECTION_REQUIRED/);
    await db.closeGiveaway(g.id);
    await assert.rejects(db.rpc(a, 'draw_giveaway', { p_post_id: g.id }), /MANUAL_SELECTION_REQUIRED/);
    await assert.rejects(db.rpc(a, 'select_winners', { p_post_id: g.id, p_user_ids: [a] }), /NOT_FOUND/);
    await assert.rejects(db.rpc(giver, 'select_winners', { p_post_id: g.id, p_user_ids: [outsider] }), /INVALID_SELECTION/);
    await db.rpc(giver, 'select_winners', { p_post_id: g.id, p_user_ids: [b, a] });
    const post = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.equal(post.giveaway.draw.manual, true);
    assert.equal(post.giveaway.draw.seed, null);
    assert.equal(post.giveaway.draw.ordering, 'chosen by giver');
  });

  test('예비 당첨자 승계는 원래 추첨 기록을 바꾸지 않는다 (포기 · 무응답)', async () => {
    const giver = await db.createUser();
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await db.createUser());
    const g = await db.giveaway(giver, { total_quantity: 1, reserve_count: 3 });
    for (const u of users) await db.rpc(u, 'enter_giveaway', { p_post_id: g.id });
    await db.closeGiveaway(g.id);
    await db.rpc(users[0], 'draw_giveaway', { p_post_id: g.id });
    const original = await db.sql('select rank, user_id, role from public.giveaway_winners where post_id = $1 order by rank', [g.id]);

    // 1st winner gives up
    const t1 = await db.tradeOf(g.id, original[0].user_id);
    await db.rpc(original[0].user_id, 'cancel_trade', { p_trade_id: t1 });
    const t2 = await db.tradeOf(g.id, original[1].user_id);
    assert.ok(t2, '예비 1번에게 거래가 생긴다');

    // reserve #1 does not answer in time → scheduler promotes reserve #2
    await db.expireTrade(t2);
    await db.runJobs();
    assert.equal((await db.trade(original[1].user_id, t2)).status, 'expired');
    const t3 = await db.tradeOf(g.id, original[2].user_id);
    assert.ok(t3);

    const now = await db.sql('select rank, user_id, role, promoted_at is not null as promoted from public.giveaway_winners where post_id = $1 order by rank', [g.id]);
    assert.deepEqual(now.map(({ rank, user_id, role }) => ({ rank, user_id, role })), original);
    assert.deepEqual(now.map((w) => w.promoted), [false, true, true, false]);
    await assert.rejects(
      db.sql(`update public.giveaway_winners set role = 'winner' where post_id = $1 and rank = 4`, [g.id]),
      /DRAW_RECORD_IMMUTABLE/,
    );
  });

  test('차단한 사이에서는 참여할 수 없다', async () => {
    const giver = await db.createUser();
    const blockedName = nick();
    const blocked = await db.createUser(blockedName);
    await db.rpc(giver, 'set_block', { p_nickname: blockedName, p_block: true });
    const g = await db.giveaway(giver);
    await assert.rejects(db.rpc(blocked, 'enter_giveaway', { p_post_id: g.id }), /BLOCKED/);
  });
});

describe('바코드/교환', () => {
  const BARCODE = '9876 5432 1012 3456';
  const DIGITS = '9876543210123456';

  test('승인 전에는 바코드에 접근할 수 없고, 거래 당사자가 아니면 볼 수 없다', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    const stranger = await db.createUser();
    const r0 = await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId });
    assert.deepEqual(r0, { ok: false, error: 'BARCODE_NOT_READY' });
    await assert.rejects(db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true }), /ACCEPT_FIRST/);
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await assert.rejects(db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: false }), /CONSENT_REQUIRED/);
    await assert.rejects(db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '12ab', p_consent: true }), /INVALID_BARCODE/);
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });

    await assert.rejects(db.trade(stranger, tradeId), /NOT_FOUND/);
    const rs = await db.rpc(stranger, 'reveal_barcode', { p_trade_id: tradeId });
    assert.equal(rs.ok, false);
    const rw = await db.rpc(winner, 'reveal_barcode', { p_trade_id: tradeId });
    assert.equal(rw.ok, false, '받는 사람은 상대 바코드 열람 대상이 아님');

    const ok = await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId });
    assert.equal(ok.ok, true);
    assert.equal(ok.barcode, DIGITS);

    const logs = await db.sql('select accessor_id, result from private.barcode_access_logs where trade_id = $1 order by id', [tradeId]);
    assert.deepEqual(logs.map((l) => l.result), ['denied:not_ready', 'denied:not_sender', 'denied:not_sender', 'shown']);
  });

  test('운영자 화면과 공개 데이터 어디에도 바코드 원문이 없다', async () => {
    const { giver, winner, tradeId, post } = await db.wonTrade();
    const admin = await db.createAdmin();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId });
    await db.rpc(winner, 'report_trade', { p_trade_id: tradeId, p_reason: 'other', p_detail: '확인 부탁해요' });

    const views = [
      await db.trade(admin, tradeId),
      await db.trade(giver, tradeId),
      await db.trade(winner, tradeId),
      await db.rpc(admin, 'admin_list_trades', { p_filter: 'all' }),
      await db.rpc(admin, 'admin_list_reports', {}),
      await db.rpc(null, 'get_post', { p_code: post.code }),
      await db.rpc(winner, 'my_notifications', {}),
      await db.rpc(giver, 'my_trades', {}),
    ];
    for (const v of views) assert.equal(JSON.stringify(v).includes(DIGITS), false);

    const dump = await db.sql(
      `select string_agg(x, ' ') as all_text from (
         select meta::text as x from public.trade_events
         union all select title || body from public.notifications
         union all select detail from public.reports
         union all select detail::text from public.admin_audit_logs
         union all select result from private.barcode_access_logs
         union all select coalesce(encode(ciphertext, 'escape'), '') from private.barcode_secrets) s`,
    );
    assert.equal(dump[0].all_text.includes(DIGITS), false);
    // reporting moved the trade into dispute → ciphertext is already gone
    const sec = await db.sql('select ciphertext is null as purged from private.barcode_secrets where trade_id = $1', [tradeId]);
    assert.equal(sec[0].purged, true);
  });

  test("전송 신고만으로는 완료가 아니고, 수령 확인 후 완료 · 성장 점수는 1회만", async () => {
    const { giver, winner, tradeId } = await db.wonTrade({ quantity: 2 });
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    assert.equal((await db.trade(giver, tradeId)).status, 'ready');
    await assert.rejects(db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId }), /INVALID_STATE|SENDER_NOT_DECLARED/);
    await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId });
    assert.equal((await db.trade(giver, tradeId)).status, 'transfer_in_progress');
    await assert.rejects(db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId }), /SENDER_NOT_DECLARED/);

    await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId });
    await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId }); // idempotent
    const mid = await db.trade(winner, tradeId);
    assert.equal(mid.status, 'awaiting_receipt');
    assert.equal(mid.official_transfer_verified, false);
    assert.equal(mid.events.filter((e) => e.type === 'sent_declared').length, 1);
    // after declaring, the barcode is no longer needed and is deleted
    const purged = await db.sql('select ciphertext is null as p from private.barcode_secrets where trade_id = $1', [tradeId]);
    assert.equal(purged[0].p, true);
    assert.equal((await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId })).ok, false);

    await db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId });
    await db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId });
    assert.equal((await db.trade(giver, tradeId)).status, 'completed');

    const giverSum = await db.rpc(giver, 'my_summary');
    const winnerSum = await db.rpc(winner, 'my_summary');
    assert.equal(giverSum.campaign.given, 2);
    assert.equal(winnerSum.campaign.received, 2);
    const pe = await db.sql('select count(*)::int as n from public.progress_events where source_trade_id = $1', [tradeId]);
    assert.equal(pe[0].n, 2);
  });

  test('나눔자가 전송 신고 후 받는 사람이 응답이 없으면 자동 완료/취소가 아니라 분쟁', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId });
    await db.expireTrade(tradeId);
    await db.runJobs();
    const t = await db.trade(giver, tradeId);
    assert.equal(t.status, 'disputed');
    assert.equal(t.dispute_reason, 'receipt_unconfirmed');
    await assert.rejects(db.rpc(giver, 'cancel_trade', { p_trade_id: tradeId }), /CANNOT_CANCEL_NOW/);
    const sum = await db.rpc(giver, 'my_summary');
    assert.equal(sum.campaign.given, 0, '확인되지 않은 나눔은 성장 점수에 넣지 않는다');
  });

  test('교환: 한쪽만 전송 신고하고 상대가 잠수 → 분쟁, 양쪽 수령 확인 전에는 완료가 아님', async () => {
    const author = await db.createUser();
    const proposer = await db.createUser();
    const s = await db.rpc(author, 'create_swap', {
      p: { title: '일반2 ↔ 미션1', offer: [{ sticker_code: 'GENERAL', quantity: 2 }], want: [{ sticker_code: 'MISSION', quantity: 1 }] },
    });
    await assert.rejects(db.rpc(proposer, 'propose_swap', { p_post_id: s.id, p_risk_ack: false }), /CONSENT_REQUIRED/);
    const { trade_id } = await db.rpc(proposer, 'propose_swap', { p_post_id: s.id, p_risk_ack: true });
    const t0 = await db.trade(author, trade_id);
    assert.equal(t0.status, 'proposed');
    assert.equal(t0.can.accept, true);
    const mine = t0.items.find((i) => i.sender === t0.participants.find((p) => p.is_me).nickname);
    assert.equal(mine.code, 'GENERAL');
    assert.equal(mine.quantity, 2);

    await db.rpc(author, 'accept_trade', { p_trade_id: trade_id, p_risk_ack: true });
    await db.rpc(author, 'submit_barcode', { p_trade_id: trade_id, p_barcode: '1111222233334444', p_consent: true });
    assert.equal((await db.trade(author, trade_id)).status, 'accepted');
    await db.rpc(proposer, 'submit_barcode', { p_trade_id: trade_id, p_barcode: '5555666677778888', p_consent: true });
    assert.equal((await db.trade(author, trade_id)).status, 'ready');

    // each side only sees the other's number
    assert.equal((await db.rpc(author, 'reveal_barcode', { p_trade_id: trade_id })).barcode, '5555666677778888');
    assert.equal((await db.rpc(proposer, 'reveal_barcode', { p_trade_id: trade_id })).barcode, '1111222233334444');

    await db.rpc(author, 'declare_sent', { p_trade_id: trade_id });
    const mid = await db.trade(proposer, trade_id);
    assert.equal(mid.status, 'transfer_in_progress');
    await db.rpc(proposer, 'confirm_receipt', { p_trade_id: trade_id });
    assert.notEqual((await db.trade(proposer, trade_id)).status, 'completed');

    await db.expireTrade(trade_id);
    await db.runJobs();
    const t = await db.trade(author, trade_id);
    assert.equal(t.status, 'disputed');
    assert.equal(t.dispute_reason, 'partial_sent_timeout');
  });

  test('교환 양쪽 완료 · 교환은 나눔 장수에 합산하지 않음 · 다른 제안은 자동 거절', async () => {
    const author = await db.createUser();
    const p1 = await db.createUser();
    const p2 = await db.createUser();
    const s = await db.rpc(author, 'create_swap', {
      p: { title: '미션 교환', offer: [{ sticker_code: 'MISSION', quantity: 1 }], want: [{ sticker_code: 'GENERAL', quantity: 3 }] },
    });
    const a = await db.rpc(p1, 'propose_swap', { p_post_id: s.id, p_risk_ack: true });
    const b = await db.rpc(p2, 'propose_swap', { p_post_id: s.id, p_risk_ack: true });
    await db.rpc(author, 'accept_trade', { p_trade_id: a.trade_id, p_risk_ack: true });
    assert.equal((await db.trade(p2, b.trade_id)).status, 'rejected');

    await db.rpc(author, 'submit_barcode', { p_trade_id: a.trade_id, p_barcode: '1234567890', p_consent: true });
    await db.rpc(p1, 'submit_barcode', { p_trade_id: a.trade_id, p_barcode: '0987654321', p_consent: true });
    await db.rpc(author, 'declare_sent', { p_trade_id: a.trade_id });
    await db.rpc(p1, 'declare_sent', { p_trade_id: a.trade_id });
    assert.equal((await db.trade(p1, a.trade_id)).status, 'awaiting_receipt');
    await db.rpc(p1, 'confirm_receipt', { p_trade_id: a.trade_id });
    assert.equal((await db.trade(p1, a.trade_id)).status, 'awaiting_receipt');
    await db.rpc(author, 'confirm_receipt', { p_trade_id: a.trade_id });
    assert.equal((await db.trade(p1, a.trade_id)).status, 'completed');

    const sum = await db.rpc(author, 'my_summary');
    assert.equal(sum.campaign.swaps, 1);
    assert.equal(sum.campaign.given, 0);
    const post = await db.rpc(null, 'get_post', { p_code: s.code });
    assert.equal(post.status, 'done');
  });

  test('거래 위험 고지와 바코드 제공 동의가 정책 버전과 함께 기록된다', async () => {
    const { winner, tradeId } = await db.wonTrade();
    await assert.rejects(db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: false }), /CONSENT_REQUIRED/);
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    const rows = await db.sql(
      'select consent_type, policy_version from public.consent_records where user_id = $1 and trade_id = $2 order by id', [winner, tradeId]);
    assert.deepEqual(rows, [
      { consent_type: 'trade_risk', policy_version: 'draft-2026-11' },
      { consent_type: 'barcode_provision', policy_version: 'draft-2026-11' },
    ]);
  });

  test('바코드 열람 횟수 제한, 열람 후에는 바코드를 바꿀 수 없음', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    for (let i = 0; i < 5; i++) assert.equal((await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId })).ok, true);
    assert.deepEqual(await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId }), { ok: false, error: 'BARCODE_VIEW_LIMIT' });
    await assert.rejects(db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '1111111111', p_consent: true }), /INVALID_STATE|BARCODE_LOCKED/);
    const t = await db.trade(winner, tradeId);
    assert.equal(t.my_barcode.view_count, 5);
    assert.equal(t.my_barcode.last4, '3456');
  });

  test('아무도 보내지 않고 기한이 지나면 만료, 나눔자 미이행 기록이 남는다', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: BARCODE, p_consent: true });
    await db.expireTrade(tradeId);
    await db.runJobs();
    const t = await db.trade(winner, tradeId);
    assert.equal(t.status, 'expired');
    assert.ok(t.events.some((e) => e.type === 'unfulfilled_by_sender' && e.meta.user_id === giver));
    const badge = (await db.trade(winner, tradeId)).participants.find((p) => p.user_id === giver).badge;
    assert.equal(badge.unfulfilled, 1);
  });

  test('나눔 요청(SOS)에 나눔 제안 → 요청자가 수락하면 같은 거래 절차', async () => {
    const requester = await db.createUser();
    const giver = await db.createUser();
    const r = await db.rpc(requester, 'create_request', { p: { title: '미션 1장만 부족해요', sticker_code: 'MISSION', quantity: 1 } });
    await assert.rejects(db.rpc(giver, 'offer_to_request', { p_post_id: r.id, p_quantity: 2 }), /INVALID_QUANTITY/);
    const { trade_id } = await db.rpc(giver, 'offer_to_request', { p_post_id: r.id, p_quantity: 1 });
    await assert.rejects(db.rpc(giver, 'offer_to_request', { p_post_id: r.id, p_quantity: 1 }), /ALREADY_OFFERED/);
    const t = await db.trade(requester, trade_id);
    assert.equal(t.kind, 'giveaway');
    assert.equal(t.can.accept, true);
    assert.equal(t.me.role, 'receiver');
  });
});

describe('이력/등급', () => {
  test('나눔자·수령자 모두 MY에 기록이 남고, 게시글을 숨겨도 거래 기록은 남는다', async () => {
    const { giver, winner, tradeId, post } = await db.wonTrade();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '1234567890', p_consent: true });
    await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId });
    await db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId });

    await db.rpc(giver, 'close_my_post', { p_post_id: post.id, p_hide: true });
    await assert.rejects(db.rpc(null, 'get_post', { p_code: post.code }), /NOT_FOUND/);

    const gList = await db.rpc(giver, 'my_trades', { p_filter: 'done' });
    const wList = await db.rpc(winner, 'my_trades', { p_filter: 'done' });
    assert.ok(gList.some((t) => t.id === tradeId && t.my_role === 'giver'));
    assert.ok(wList.some((t) => t.id === tradeId && t.my_role === 'receiver'));
    const detail = await db.trade(winner, tradeId);
    assert.deepEqual(detail.items.map((i) => [i.code, i.quantity]), [['MISSION', 1]]);
    const types = detail.events.map((e) => e.type);
    for (const ev of ['trade_created', 'terms_accepted', 'barcode_submitted', 'sent_declared', 'receipt_confirmed']) {
      assert.ok(types.includes(ev), ev);
    }
    await assert.rejects(db.sql('update public.trade_events set event_type = $1 where trade_id = $2', ['x', tradeId]), /APPEND_ONLY/);
    await assert.rejects(db.sql('delete from public.trade_events where trade_id = $1', [tradeId]), /APPEND_ONLY/);
  });

  test('성장 단계: 3장 확인되면 네잎클로버, 허위 거래 확정 시 회수 기록', async () => {
    const giver = await db.createUser();
    const admin = await db.createAdmin();
    const winner = await db.createUser();
    const g = await db.giveaway(giver, { total_quantity: 3, per_winner_quantity: 3 });
    await db.rpc(winner, 'enter_giveaway', { p_post_id: g.id });
    await db.closeGiveaway(g.id);
    await db.rpc(winner, 'draw_giveaway', { p_post_id: g.id });
    const tradeId = await db.tradeOf(g.id, winner);
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '1234567890', p_consent: true });
    await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId });
    await db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId });

    let me = await db.rpc(giver, 'get_me');
    assert.equal(me.badge.level.name, '네잎클로버');
    assert.equal(me.badge.level.given, 3);

    await assert.rejects(db.rpc(giver, 'admin_revoke_progress', { p_trade_id: tradeId, p_reason: '허위' }), /ADMIN_ONLY/);
    const r1 = await db.rpc(admin, 'admin_revoke_progress', { p_trade_id: tradeId, p_reason: '허위 거래 확인' });
    const r2 = await db.rpc(admin, 'admin_revoke_progress', { p_trade_id: tradeId, p_reason: '허위 거래 확인' });
    assert.equal(r1.revoked, 2);
    assert.equal(r2.revoked, 0);
    me = await db.rpc(giver, 'get_me');
    assert.equal(me.badge.level.name, '새싹');
    const log = await db.rpc(admin, 'admin_audit_logs', {});
    assert.ok(log.some((l) => l.action === 'revoke_progress' && l.target_id === tradeId));
  });
});

describe('운영', () => {
  test('신고 접수 → 분쟁 전환 → 운영자 처리 → 신고자 확인, 모두 기록', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    const admin = await db.createAdmin();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '1234567890', p_consent: true });
    const rep = await db.rpc(winner, 'report_trade', { p_trade_id: tradeId, p_reason: 'not_sent', p_detail: '연락이 없어요' });
    assert.equal(rep.status, 'disputed');

    await assert.rejects(db.rpc(winner, 'admin_list_reports', {}), /ADMIN_ONLY/);
    const reports = await db.rpc(admin, 'admin_list_reports', { p_status: 'received' });
    const mine = reports.find((r) => r.report_no === rep.report_no);
    assert.ok(mine);
    await assert.rejects(db.rpc(admin, 'admin_resolve_trade', { p_trade_id: tradeId, p_outcome: 'resolved_unfulfilled', p_note: '' }), /REASON_REQUIRED/);
    await db.rpc(admin, 'admin_resolve_trade', { p_trade_id: tradeId, p_outcome: 'resolved_unfulfilled', p_note: '나눔자 미전송 확인' });
    await db.rpc(admin, 'admin_update_report', { p_report_id: mine.id, p_status: 'resolved', p_resolution: '미이행으로 처리했어요' });

    const my = await db.rpc(winner, 'my_reports');
    assert.equal(my.find((r) => r.report_no === rep.report_no).status, 'resolved');
    const t = await db.trade(giver, tradeId);
    assert.equal(t.status, 'resolved_unfulfilled');
    assert.equal((await db.rpc(giver, 'get_me')).badge.unfulfilled, 1);
    const logs = await db.rpc(admin, 'admin_audit_logs', {});
    assert.ok(logs.some((l) => l.action === 'resolve_trade' && l.target_id === tradeId));
  });

  test('이용 제한된 계정은 새 참여는 못 하지만 진행 중 거래는 마무리할 수 있다', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    const admin = await db.createAdmin();
    await db.rpc(admin, 'admin_set_account_status', { p_user_id: winner, p_status: 'restricted', p_until: null, p_reason: '반복 미응답' });
    const other = await db.giveaway(giver);
    await assert.rejects(db.rpc(winner, 'enter_giveaway', { p_post_id: other.id }), /ACCOUNT_RESTRICTED/);
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    assert.equal((await db.trade(winner, tradeId)).status, 'accepted');
  });

  test('종료된 시즌에는 새 글을 만들 수 없다', async () => {
    const user = await db.createUser();
    await db.sql(`update public.campaigns set status = 'ended' where slug = '2026_winter'`);
    try {
      await assert.rejects(db.giveaway(user), /NO_ACTIVE_CAMPAIGN/);
    } finally {
      await db.sql(`update public.campaigns set status = 'active' where slug = '2026_winter'`);
    }
  });

  test('모집 기간은 10분~7일, 시즌 종료 전이어야 한다', async () => {
    const user = await db.createUser();
    await assert.rejects(db.giveaway(user, { closes_at: new Date(Date.now() + 60_000).toISOString() }), /INVALID_CLOSING_TIME/);
    await assert.rejects(db.giveaway(user, { closes_at: new Date(Date.now() + 9 * 86400_000).toISOString() }), /INVALID_CLOSING_TIME/);
  });
});

describe('추가 경계', () => {
  test('바코드를 연 뒤(전송 중)에는 기한 전까지 취소할 수 없다', async () => {
    const { giver, winner, tradeId } = await db.wonTrade();
    await db.rpc(winner, 'accept_trade', { p_trade_id: tradeId, p_risk_ack: true });
    await db.rpc(winner, 'submit_barcode', { p_trade_id: tradeId, p_barcode: '1234567890', p_consent: true });
    await db.rpc(giver, 'reveal_barcode', { p_trade_id: tradeId });
    await assert.rejects(db.rpc(winner, 'cancel_trade', { p_trade_id: tradeId }), /CANNOT_CANCEL_NOW/);
    await assert.rejects(db.rpc(giver, 'cancel_trade', { p_trade_id: tradeId }), /CANNOT_CANCEL_NOW/);
    const t = await db.trade(winner, tradeId);
    assert.equal(t.can.cancel, false);
    assert.equal(t.can.report, true);
  });

  test('운영자가 숨긴 글은 비회원·다른 회원에게 보이지 않고, 기록은 감사로그에 남는다', async () => {
    const author = await db.createUser();
    const other = await db.createUser();
    const admin = await db.createAdmin();
    const g = await db.giveaway(author);
    await assert.rejects(db.rpc(author, 'admin_set_post_visibility', { p_post_id: g.id, p_visibility: 'hidden_by_admin', p_reason: 'x' }), /ADMIN_ONLY/);
    await db.rpc(admin, 'admin_set_post_visibility', { p_post_id: g.id, p_visibility: 'hidden_by_admin', p_reason: '광고성 글' });
    await assert.rejects(db.rpc(null, 'get_post', { p_code: g.code }), /NOT_FOUND/);
    await assert.rejects(db.rpc(other, 'enter_giveaway', { p_post_id: g.id }), /NOT_FOUND/);
    const list = await db.rpc(null, 'list_posts', { p_only_open: false, p_limit: 50 });
    assert.equal(list.some((p) => p.code === g.code), false);
    assert.equal((await db.rpc(author, 'get_post', { p_code: g.code })).visibility, 'hidden_by_admin');
    const logs = await db.rpc(admin, 'admin_audit_logs', {});
    assert.ok(logs.some((l) => l.action === 'set_post_visibility' && l.target_id === g.id));
  });

  test('스레드 계정 확인은 선택이며, 운영자 승인 전에는 확인 표시가 없다', async () => {
    const user = await db.createUser();
    const admin = await db.createAdmin();
    await assert.rejects(db.rpc(user, 'set_threads_handle', { p_handle: 'bad handle!' }), /INVALID_HANDLE/);
    await db.rpc(user, 'set_threads_handle', { p_handle: '@my.threads' });
    const { verify_code } = await db.rpc(user, 'request_threads_verification');
    assert.match(verify_code, /^FN-[A-Z0-9]{6}$/);
    let me = await db.rpc(user, 'get_me');
    assert.equal(me.badge.threads.verified, false);
    const pending = await db.rpc(admin, 'admin_list_threads', { p_status: 'pending' });
    assert.ok(pending.some((p) => p.user_id === user && p.verify_code === verify_code));
    await db.rpc(admin, 'admin_decide_threads', { p_user_id: user, p_approve: true });
    me = await db.rpc(user, 'get_me');
    assert.equal(me.badge.threads.verified, true);
    assert.equal(me.badge.threads.handle, 'my.threads');
  });

  test('알림은 본인 것만 보이고 읽음 처리할 수 있다', async () => {
    const { winner } = await db.wonTrade();
    const other = await db.createUser();
    const mine = await db.rpc(winner, 'my_notifications', {});
    assert.ok(mine.some((n) => n.kind === 'giveaway_won'));
    assert.equal((await db.rpc(other, 'my_notifications', {})).length, 0);
    assert.ok((await db.rpc(winner, 'get_me')).unread_notifications > 0);
    await db.rpc(winner, 'mark_notifications_read', {});
    assert.equal((await db.rpc(winner, 'get_me')).unread_notifications, 0);
  });

  test('기한이 지난 요청·교환 글은 만료되고, 마감 전 나눔은 정기 작업이 건드리지 않는다', async () => {
    const user = await db.createUser();
    const r = await db.rpc(user, 'create_request', { p: { title: '미션 한 장 구해요', sticker_code: 'MISSION', quantity: 1 } });
    const g = await db.giveaway(user);
    await db.sql(`update public.posts set closes_at = now() - interval '1 second' where id = $1`, [r.id]);
    await db.runJobs();
    assert.equal((await db.rpc(null, 'get_post', { p_code: r.code })).status, 'expired');
    const gp = await db.rpc(null, 'get_post', { p_code: g.code });
    assert.equal(gp.status, 'open');
    assert.equal(gp.giveaway.draw, null);
  });
});
