// Browser walkthrough of the main giveaway flow on a phone-sized screen.
//   npx supabase start && node scripts/seed-demo.mjs && npm run build && npx next start -p 3000
//   node scripts/e2e.mjs            → screenshots in ./screenshots
// Two visitors with no sign-up: a giver posts, a receiver enters, the draw runs,
// both enter Threads IDs (+ barcode), confirm each other, send, receive.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { connect } from '../tests/helpers.mjs';

// Playwright is resolved like `require` (works with a global install or a local devDependency).
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const SCALE = Number(process.env.SCALE ?? 1);
mkdirSync(OUT, { recursive: true });

const db = await connect();
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
const errors = [];

async function newVisitor(name) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|fonts\.g/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
  return page;
}

async function shot(page, name, fullPage = true) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
  console.log('📸', name);
}

// Reads the newest 6-digit code sent to `to` after `since` from Mailpit.
async function mailCode(to, since) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.find((x) => x.Created > since);
    if (m) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).Text;
      return text.match(/\b(\d{6})\b/)[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no mail for ${to}`);
}

async function quickStart(page, nickname) {
  await page.getByRole('button', { name: '바로 시작하기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '바로 시작하기' });
  await dialog.getByRole('textbox', { name: '닉네임' }).fill(nickname);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '시작하기', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

const run = String(Date.now()).slice(-4);
const GIVER_NICK = `나눔요정${run}`;
const RECEIVER_NICK = `스티커곰${run}`;
const giver = await newVisitor('giver');
const receiver = await newVisitor('receiver');

try {
  // 1) Home and board without any sign-up
  await giver.goto(BASE + '/');
  await giver.getByText('무료 나눔하기').first().waitFor();
  await shot(giver, '01-home');
  await giver.goto(BASE + '/posts');
  await giver.locator('a[href^="/posts/"]').nth(1).waitFor();
  await shot(giver, '02-board', false);

  // 2) Giver: quick start (nickname only) and a new random giveaway
  await giver.goto(BASE + '/posts/new?kind=GIVEAWAY');
  await shot(giver, '03-new-needs-start', false);
  await quickStart(giver, GIVER_NICK);
  await giver.getByLabel('제목').fill('미션 스티커 1장 나눔해요');
  await giver.locator('input[type=checkbox]').last().check();
  await shot(giver, '04-new-form');
  await giver.getByRole('button', { name: /올리기|등록/ }).last().click();
  await giver.waitForURL(/\/posts\/[A-Za-z0-9]{8}\?created=1/);
  const postUrl = giver.url().split('?')[0];
  const code = postUrl.split('/').pop();
  await giver.getByText('미션 스티커 1장 나눔해요').first().waitFor();
  await shot(giver, '05-post-created');

  // 3) Receiver opens the shared link directly and enters
  await receiver.goto(postUrl + '?utm_source=threads&utm_medium=share');
  await receiver.getByText('미션 스티커 1장 나눔해요').first().waitFor();
  await shot(receiver, '06-post-as-visitor');
  await quickStart(receiver, RECEIVER_NICK);
  await receiver.getByRole('button', { name: '신청하기' }).click();
  await receiver.getByText(/신청했어요/).first().waitFor();
  await shot(receiver, '07-entered');

  // 4) Time travel: close the giveaway, then the receiver asks for the result (server draws once)
  const [{ id: postId }] = await db.sql('select id from public.posts where code = $1', [code]);
  await db.closeGiveaway(postId);
  await receiver.reload();
  await receiver.getByRole('button', { name: '결과 보기' }).click();
  const tradeLink = receiver.locator('a[href^="/trades/"]').first();
  await tradeLink.waitFor();
  await shot(receiver, '08-won');
  await tradeLink.click();
  await receiver.waitForURL(/\/trades\//);
  const tradeUrl = receiver.url();

  // 5) Step 1 — receiver: Threads ID + barcode + consent
  await receiver.getByLabel(/스레드/).first().fill('sticker.bear');
  await receiver.getByLabel(/바코드/).first().fill('1234 5678 9012 3456');
  await receiver.locator('input[type=checkbox]').last().check();
  await shot(receiver, '09-trade-info-receiver');
  await receiver.getByRole('button', { name: '받을게요' }).click();
  await receiver.getByText(/입력한 정보/).first().waitFor();

  //    giver: Threads ID only
  await giver.goto(tradeUrl);
  await giver.getByLabel(/스레드/).first().fill('nanum_fairy');
  await giver.locator('input[type=checkbox]').last().check();
  await giver.getByRole('button', { name: '입력 완료' }).click();

  // 6) Step 2 — confirm each other
  await giver.getByRole('button', { name: '상대 스레드 아이디 확인했어요' }).waitFor();
  assert.ok(await giver.getByText('sticker.bear').first().isVisible(), 'giver sees the receiver Threads ID');
  await shot(giver, '10-confirm-peer');
  await giver.getByRole('button', { name: '상대 스레드 아이디 확인했어요' }).click();
  // the barcode must still be closed: the receiver has not confirmed yet
  assert.equal(await giver.getByRole('button', { name: /바코드 보기/ }).count(), 0, 'barcode stays closed until both confirm');
  await receiver.reload();
  await receiver.getByRole('button', { name: '상대 스레드 아이디 확인했어요' }).click();

  // 7) Giver opens the barcode, sends in the official app, declares
  await giver.reload();
  await giver.getByRole('button', { name: /바코드 보기/ }).click();
  await giver.getByText(/1234\s?5678\s?9012\s?3456/).first().waitFor();
  await shot(giver, '11-barcode-open', false);
  await giver.getByRole('button', { name: '보냈어요' }).first().click();
  await giver.getByRole('button', { name: '네, 보냈어요' }).click();
  await giver.getByText(/수령 확인/).first().waitFor();

  // 8) Receiver confirms receipt → completed
  await receiver.reload();
  await receiver.getByRole('button', { name: '받았어요' }).first().click();
  await receiver.getByRole('button', { name: '네, 받았어요' }).click();
  await receiver.getByText('완료됐어요!').first().waitFor();
  await shot(receiver, '12-trade-completed');

  const [t] = await db.sql('select status from public.trades where post_id = $1', [postId]);
  assert.equal(t.status, 'completed');

  // 9) The counterpart confirmed in step 6 is saved to the giver's account
  await giver.goto(BASE + '/me/contacts');
  await giver.getByText(RECEIVER_NICK).first().waitFor();
  assert.ok(await giver.getByText('@sticker.bear').first().isVisible(), 'saved Threads ID');
  assert.equal(await giver.getByText(/1234\s?5678/).count(), 0, 'barcode is not saved');
  await shot(giver, '13a-contacts', false);

  // 10) MY, history, world, help
  await giver.goto(BASE + '/me');
  await giver.getByText(GIVER_NICK).first().waitFor();
  await shot(giver, '13-my');
  await giver.goto(BASE + '/me/history');
  await shot(giver, '14-history');
  await giver.goto(BASE + '/world');
  await shot(giver, '15-world', false);
  await giver.goto(BASE + '/help#safety');
  await shot(giver, '16-help', false);
  await giver.goto(BASE + '/matches');
  await shot(giver, '17-matches', false);

  // 11) Optional: the receiver links an e-mail, then restores the same records on another device
  const linkMail = `bear${run}@demo.local`;
  await receiver.goto(BASE + '/settings');
  await receiver.getByLabel('이메일', { exact: true }).fill(linkMail);
  let since = new Date().toISOString();
  await receiver.getByRole('button', { name: '연결 코드 받기' }).click();
  await receiver.getByLabel('메일로 받은 6자리 코드').fill(await mailCode(linkMail, since));
  await receiver.getByRole('button', { name: '연결하기' }).click();
  await receiver.getByText(`연결된 이메일`).first().waitFor();
  const otherDevice = await newVisitor('other-device');
  await otherDevice.goto(BASE + '/login?next=/me');
  await otherDevice.getByLabel('연결해 둔 이메일').fill(linkMail);
  since = new Date().toISOString();
  await otherDevice.getByRole('button', { name: '6자리 코드 받기' }).click();
  await otherDevice.getByLabel('6자리 코드').fill(await mailCode(linkMail, since));
  await otherDevice.getByRole('button', { name: '기록 불러오기' }).click();
  await otherDevice.waitForURL(/\/me/);
  await otherDevice.getByText(RECEIVER_NICK).first().waitFor();

  // 12) Optional e-mail restore (demo admin) → admin console
  const admin = await newVisitor('admin');
  await admin.goto(BASE + '/login?next=/admin');
  await admin.getByLabel('연결해 둔 이메일').fill('admin@demo.local');
  since = new Date().toISOString();
  await admin.getByRole('button', { name: '6자리 코드 받기' }).click();
  await admin.getByLabel('6자리 코드').fill(await mailCode('admin@demo.local', since));
  await admin.getByRole('button', { name: '기록 불러오기' }).click();
  await admin.waitForURL(/\/admin/);
  await admin.getByText(/바코드 원문/).first().waitFor();
  await shot(admin, '18-admin', false);

  console.log('✅ main flow passed');
} catch (err) {
  console.error('❌', err.message);
  await shot(giver, 'fail-giver', false).catch(() => {});
  await shot(receiver, 'fail-receiver', false).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) {
    console.log('page errors:\n' + [...new Set(errors)].join('\n'));
  }
  await browser.close();
  await db.close();
}
