// Local demo data (never run against production).
//   npx supabase start && node scripts/seed-demo.mjs
// Creates demo members (login with their e-mail; codes arrive in Mailpit http://127.0.0.1:54324),
// open giveaways of every kind, a request, a swap, and one finished giveaway.
import { connect } from '../tests/helpers.mjs';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (!/127\.0\.0\.1|localhost/.test(API)) {
  console.error('seed-demo is for the local stack only');
  process.exit(1);
}

const db = await connect();

async function authUser(email) {
  const existing = await db.sql('select id from auth.users where email = $1', [email]);
  if (existing[0]) return existing[0].id;
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body.id;
}

async function member(email, nickname) {
  const id = await authUser(email);
  const has = await db.sql('select 1 from public.profiles where user_id = $1', [id]);
  if (!has.length) {
    await db.rpc(id, 'register_profile', { p_nickname: nickname, p_agree_terms: true, p_agree_privacy: true });
  }
  return id;
}

const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const giver = await member('giver@demo.local', '별빛나눔');
const latte = await member('latte@demo.local', '라떼한잔');
const bear = await member('bear@demo.local', '겨울곰');
const sos = await member('sos@demo.local', '미션한장');
const admin = await member('admin@demo.local', '운영자');
await db.sql(`update public.profiles set role = 'admin' where user_id = $1`, [admin]);

const already = await db.sql('select count(*)::int as n from public.posts where author_id = $1', [giver]);
if (already[0].n > 0) {
  console.log('demo data already exists');
  await db.close();
  process.exit(0);
}

// 1) A finished giveaway → history + level for 별빛나눔
const done = await db.giveaway(giver, { title: '미션 스티커 3장 나눔 (완료)', total_quantity: 3, per_winner_quantity: 3, closes_at: hours(1) });
await db.rpc(latte, 'enter_giveaway', { p_post_id: done.id });
await db.closeGiveaway(done.id);
await db.rpc(latte, 'draw_giveaway', { p_post_id: done.id });
const t1 = await db.tradeOf(done.id, latte);
await db.rpc(latte, 'accept_trade', { p_trade_id: t1, p_risk_ack: true });
await db.rpc(latte, 'submit_barcode', { p_trade_id: t1, p_barcode: '1234 5678 9012 3456', p_consent: true });
await db.rpc(giver, 'reveal_barcode', { p_trade_id: t1 });
await db.rpc(giver, 'declare_sent', { p_trade_id: t1 });
await db.rpc(latte, 'confirm_receipt', { p_trade_id: t1 });

// 2) Open giveaways of each method
await db.giveaway(giver, {
  title: '일반 스티커 4장, 두 분께 2장씩 드려요', body: '남는 일반 스티커 나눔해요. 마감 뒤 서버가 랜덤으로 뽑아요.',
  sticker_code: 'GENERAL', total_quantity: 4, per_winner_quantity: 2, closes_at: hours(20),
});
await db.giveaway(bear, {
  title: '퀴즈 맞히고 미션 1장 받아 가세요', body: '정답자 중 한 분을 뽑아요.',
  method: 'quiz', total_quantity: 1, closes_at: hours(30),
  quiz: { question: '이번 겨울 프리퀀시 완성 기준은 총 몇 장일까요?', options: ['15장', '17장', '20장'], answer: 1, zero_policy: 'draw_all' },
});
await db.giveaway(latte, {
  title: '가위바위보 4판! 미션 스티커 나눔', body: '가장 많이 이긴 분 중에서 뽑아요.',
  method: 'rps', total_quantity: 1, closes_at: hours(8),
});

// 3) SOS request and a swap
await db.rpc(sos, 'create_request', { p: { title: '미션 1장만 있으면 완성이에요 🙏', body: '마지막 한 장이 부족해요.', sticker_code: 'MISSION', quantity: 1, closes_at: hours(48) } });
await db.rpc(bear, 'create_swap', {
  p: { title: '일반 3장 ↔ 미션 1장 교환해요', body: '소량부터 천천히 진행해요.', offer: [{ sticker_code: 'GENERAL', quantity: 3 }], want: [{ sticker_code: 'MISSION', quantity: 1 }], closes_at: hours(40) },
});

// 4) A giveaway 라떼한잔 just won (needs action) — so the trade screen has something to do
const won = await db.giveaway(bear, { title: '일반 1장 바로 나눔', sticker_code: 'GENERAL', total_quantity: 1, closes_at: hours(1) });
await db.rpc(latte, 'enter_giveaway', { p_post_id: won.id });
await db.closeGiveaway(won.id);
await db.rpc(latte, 'draw_giveaway', { p_post_id: won.id });

console.log('demo members (log in with these e-mails, codes in Mailpit):');
console.log('  giver@demo.local 별빛나눔 · latte@demo.local 라떼한잔 · bear@demo.local 겨울곰 · sos@demo.local 미션한장 · admin@demo.local 운영자(admin)');
await db.close();
