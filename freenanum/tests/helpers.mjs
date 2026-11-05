// Test helpers: call the API functions exactly as a signed-in user would
// (role "authenticated" + JWT claims), against the local Supabase database.
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';

export const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export async function connect() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  return new Db(client);
}

export function nick(prefix = 't') {
  return (prefix + randomBytes(5).toString('hex')).slice(0, 12);
}

export class Db {
  constructor(client) {
    this.c = client;
  }

  close() {
    return this.c.end();
  }

  // Runs as the database owner (test setup only: time travel, inspection).
  async sql(text, params = []) {
    return (await this.c.query(text, params)).rows;
  }

  // Runs as an API caller. userId = null means an anonymous visitor.
  async as(userId, text, params = []) {
    await this.c.query('begin');
    try {
      await this.c.query(userId ? 'set local role authenticated' : 'set local role anon');
      const claims = userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' };
      await this.c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const res = await this.c.query(text, params);
      await this.c.query('commit');
      return res.rows;
    } catch (err) {
      await this.c.query('rollback');
      throw err;
    }
  }

  async rpc(userId, fn, args = {}) {
    const keys = Object.keys(args);
    const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const values = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
    });
    const rows = await this.as(userId, call, values);
    return rows[0].r;
  }

  async createUser(nickname = nick()) {
    const id = randomUUID();
    await this.sql(
      `insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [id, `${id}@test.local`],
    );
    if (nickname) {
      await this.rpc(id, 'register_profile', { p_nickname: nickname, p_agree_terms: true, p_agree_privacy: true });
    }
    return id;
  }

  async createAdmin() {
    const id = await this.createUser(nick('adm'));
    await this.sql(`update public.profiles set role = 'admin' where user_id = $1`, [id]);
    return id;
  }

  async giveaway(author, overrides = {}) {
    const closes = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const input = {
      title: '미션 스티커 나눔해요',
      body: '테스트',
      sticker_code: 'MISSION',
      total_quantity: 1,
      per_winner_quantity: 1,
      method: 'random',
      closes_at: closes,
      agree_rules: true,
      ...overrides,
    };
    return this.rpc(author, 'create_giveaway', { p: input });
  }

  // Time travel: move a giveaway's closing time into the past.
  async closeGiveaway(postId) {
    await this.sql(
      `update public.giveaway_events set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 second' where post_id = $1`,
      [postId],
    );
    await this.sql(`update public.posts set closes_at = now() - interval '1 second' where id = $1`, [postId]);
  }

  async expireTrade(tradeId) {
    await this.sql(`update public.trades set stage_deadline_at = now() - interval '1 second' where id = $1`, [tradeId]);
  }

  async runJobs() {
    return (await this.sql('select private.process_deadlines() as r'))[0].r;
  }

  async trade(userId, tradeId) {
    return this.rpc(userId, 'get_trade', { p_trade_id: tradeId });
  }

  async tradeOf(postId, userId) {
    const rows = await this.sql(
      `select t.id from public.trades t join public.trade_participants tp on tp.trade_id = t.id
        where t.post_id = $1 and tp.user_id = $2 order by t.created_at desc limit 1`,
      [postId, userId],
    );
    return rows[0]?.id;
  }

  // Runs a giveaway to the point where one winner holds a trade.
  async wonTrade({ quantity = 1 } = {}) {
    const giver = await this.createUser();
    const winner = await this.createUser();
    const g = await this.giveaway(giver, { total_quantity: quantity, per_winner_quantity: quantity });
    await this.rpc(winner, 'enter_giveaway', { p_post_id: g.id });
    await this.closeGiveaway(g.id);
    await this.rpc(winner, 'draw_giveaway', { p_post_id: g.id });
    const tradeId = await this.tradeOf(g.id, winner);
    return { giver, winner, post: g, tradeId };
  }
}
