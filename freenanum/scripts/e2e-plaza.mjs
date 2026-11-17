// Live plaza check: three phones in the same plaza see each other move and greet,
// and a finished trade shows a celebration for everyone.
//   (stack + seed + server as in scripts/e2e.mjs) → node scripts/e2e-plaza.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { connect } from '../tests/helpers.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const SCALE = Number(process.env.SCALE ?? 1);
mkdirSync(OUT, { recursive: true });

const db = await connect();
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
const errors = [];

async function visitor(name, color) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE + '/world');
  await page.getByRole('button', { name: `${color} 색` }).click();
  await page.getByRole('button', { name: '광장 들어가기' }).click();
  await page.getByText(/같이 있어요/).first().waitFor({ timeout: 15000 });
  return page;
}

const others = (page) => page.locator('[class*="nameTag"]').filter({ hasNotText: /^나$/ });

try {
  const a = await visitor('a', 'mint');
  const b = await visitor('b', 'peach');
  const c = await visitor('c', 'lilac');

  for (const p of [a, b, c]) {
    await p.getByText('나 포함 3명이 같이 있어요').waitFor({ timeout: 10000 });
    assert.equal(await others(p).count(), 2);
  }
  console.log('✓ three visitors see each other');

  // B greets → A and C see the bubble
  await b.getByRole('button', { name: /응원해요/ }).click();
  for (const p of [a, c]) await p.locator('[class*="bubble"]').filter({ hasText: '응원해요' }).first().waitFor({ timeout: 5000 });
  console.log('✓ greeting shows for others');

  // C walks → A sees C's character move
  const before = await a.locator('[class*="player"]').evaluateAll((els) => els.map((e) => e.getAttribute('style')));
  const tile = c.locator('svg polygon').nth(8);
  await tile.click({ force: true });
  await a.waitForFunction(
    (prev) => {
      const now = [...document.querySelectorAll('[class*="player"]')].map((e) => e.getAttribute('style'));
      return JSON.stringify(now) !== JSON.stringify(prev);
    },
    before,
    { timeout: 5000 },
  );
  console.log('✓ movement shows for others');

  await a.waitForTimeout(800);
  await a.screenshot({ path: `${OUT}20-plaza-live.png` });

  // a trade completes somewhere → everyone sees a nameless celebration
  const { giver, winner, tradeId } = await db.wonTrade();
  await db.ready(giver, winner, tradeId);
  await db.rpc(giver, 'declare_sent', { p_trade_id: tradeId });
  await db.rpc(winner, 'confirm_receipt', { p_trade_id: tradeId });
  for (const p of [a, b, c]) await p.getByText(/방금 나눔이 완료됐어요/).first().waitFor({ timeout: 8000 });
  console.log('✓ celebration reached everyone');
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${OUT}20b-plaza-celebrate.png` });

  // home shows the headcount
  const home = await (await browser.newContext(phone)).newPage();
  await home.goto(BASE + '/');
  await home.getByText(/지금 3명이 광장에 같이 있어요/).waitFor({ timeout: 10000 });
  await home.screenshot({ path: `${OUT}21-home-plaza-door.png` });
  console.log('✓ home headcount');

  // a visitor leaves → the others update
  await c.context().close();
  await a.getByText('나 포함 2명이 같이 있어요').waitFor({ timeout: 10000 });
  console.log('✓ leaving updates the room');
  console.log('✅ plaza passed');
} catch (err) {
  console.error('❌', err.message);
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
  await db.close();
}
