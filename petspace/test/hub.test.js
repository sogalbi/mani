'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Hub } = require('../lib/hub');
const S = require('../public/shared.js');

function client() {
  const msgs = [];
  return { msgs, send: (s) => msgs.push(JSON.parse(s)), last: (t) => msgs.filter((m) => m.t === t).pop() };
}
function makeHub(opts = {}) {
  let t = Date.UTC(2026, 9, 30, 3, 0, 0);
  const hub = new Hub(Object.assign({ capacity: 4, rand: () => 0, now: () => t }, opts));
  return { hub, tick: (ms) => { t += ms; }, at: () => t };
}
const pet = (name = '초코', extra = {}) => Object.assign({ name, species: 'dog', color: 'cream', memorial: false }, extra);

test('이름 검사: 정상 이름은 통과하고 욕설·링크·전화번호는 막아요', () => {
  assert.equal(S.cleanName('  초코 ').name, '초코');
  assert.equal(S.cleanName('Coco♥').ok, true);
  assert.equal(S.cleanName('아주아주아주긴이름입니다').name.length, 10);
  assert.equal(S.cleanName('').ok, false);
  assert.equal(S.cleanName('씨 발').ok, false);
  assert.equal(S.cleanName('ㅅ.ㅂ').ok, false);
  assert.equal(S.cleanName('www.abc').ok, false);
  assert.equal(S.cleanName('01012345678').ok, false);
  assert.equal(S.cleanName('<script>').ok, false);
  assert.equal(S.cleanName('초​코').name, '초코');
});

test('받침에 따라 부르는 이름이 달라요', () => {
  assert.equal(S.callName('초코'), '초코');
  assert.equal(S.callName('몽실'), '몽실이');
});

test('입장하면 환영 메시지를 받고 다른 사람에게 알려져요', () => {
  const { hub } = makeHub();
  const a = client();
  const b = client();
  const ra = hub.join(a.send, { pet: pet('초코') });
  const rb = hub.join(b.send, { pet: pet('나비', { species: 'cat' }) });
  assert.ok(ra.peer && rb.peer);
  const wb = b.last('welcome');
  assert.equal(wb.room.id, 'maru-1');
  assert.equal(wb.peers.length, 1);
  assert.equal(wb.peers[0].pet.name, '초코');
  assert.equal(a.last('join').p.pet.name, '나비');
  assert.notEqual(ra.peer.seat, rb.peer.seat);
  hub.leave(rb.peer.id);
  assert.equal(a.last('leave').id, rb.peer.id);
});

test('이름이 나쁘면 입장할 수 없어요', () => {
  const { hub } = makeHub();
  assert.equal(hub.join(client().send, { pet: pet('개새끼') }).error, 'name');
  assert.equal(hub.join(client().send, { pet: pet('') }).error, 'name-empty');
});

test('마루가 차면 다음 마루를 열고, 꽉 찬 마루를 요청하면 알려줘요', () => {
  const { hub } = makeHub({ capacity: 4 });
  for (let i = 0; i < 4; i++) hub.join(client().send, { pet: pet('아이' + i) });
  const c = client();
  hub.join(c.send, { pet: pet('다섯째'), room: 'maru-1' });
  const w = c.last('welcome');
  assert.equal(w.room.id, 'maru-2');
  assert.equal(w.notice, 'room-full');
});

test('사람이 있는 마루부터 채워서 같이 있는 느낌을 줘요', () => {
  const { hub } = makeHub({ capacity: 4 });
  const a = hub.join(client().send, { pet: pet('하나'), room: 'maru-3' }).peer;
  assert.equal(a.room, 'maru-3');
  const b = hub.join(client().send, { pet: pet('둘') }).peer;
  assert.equal(b.room, 'maru-3');
});

test('우리끼리 마루는 낯선 사람이 자동으로 들어오지 않아요', () => {
  const { hub } = makeHub();
  const a = hub.join(client().send, { pet: pet('하나'), room: 'home-abcde' }).peer;
  assert.equal(a.room, 'home-abcde');
  const b = hub.join(client().send, { pet: pet('둘') }).peer;
  assert.equal(b.room, 'maru-1');
  const c = hub.join(client().send, { pet: pet('셋'), room: 'home-abcde' }).peer;
  assert.equal(c.room, 'home-abcde');
});

test('빈 방석으로만 옮겨 앉을 수 있어요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const pa = hub.join(a.send, { pet: pet('하나'), seat: 0 }).peer;
  const pb = hub.join(client().send, { pet: pet('둘'), seat: 1 }).peer;
  tick(1000);
  hub.handle(pa.id, { t: 'sit', seat: 1 });
  assert.equal(pa.seat, 0);
  hub.handle(pa.id, { t: 'sit', seat: 2 });
  assert.equal(pa.seat, 2);
  assert.equal(a.last('sit').seat, 2);
  assert.equal(pb.seat, 1);
});

test('연등: 문구 검사, 쿨다운, 같은 마루에 알림, 오늘의 연등 목록', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('초코', { memorial: true }) }).peer;
  hub.join(b.send, { pet: pet('나비') });
  const living = S.wishesFor(false).find((i) => S.WISHES[i].g === 'l');
  hub.handle(pa.id, { t: 'lantern', wish: living });
  assert.equal(b.last('lantern'), undefined, '무지개다리 아이는 건강 문구를 쓸 수 없어요');
  const memorialWish = S.wishesFor(true)[0];
  hub.handle(pa.id, { t: 'lantern', wish: memorialWish });
  const got = b.last('lantern');
  assert.equal(got.l.name, '초코');
  assert.equal(got.l.memorial, true);
  assert.equal(a.last('lantern').by, pa.id);
  hub.handle(pa.id, { t: 'lantern', wish: memorialWish });
  assert.equal(a.last('error').code, 'rate');
  tick(S.LIMITS.lanternCooldownMs + 1);
  hub.handle(pa.id, { t: 'lantern', wish: memorialWish });
  assert.equal(hub.recentLanterns().length, 2);
  assert.equal(hub.stats().today.lanterns, 2);
});

test('연등은 신고가 쌓이면 내려가고, 24시간 뒤 사라져요', () => {
  const { hub, tick } = makeHub({ reportsToHide: 2 });
  const a = client();
  const pa = hub.join(a.send, { pet: pet('초코') }, { ip: '1.1.1.1' }).peer;
  const pb = hub.join(client().send, { pet: pet('둘') }, { ip: '2.2.2.2' }).peer;
  const pc = hub.join(client().send, { pet: pet('셋') }, { ip: '3.3.3.3' }).peer;
  hub.handle(pa.id, { t: 'lantern', wish: S.wishesFor(false)[0] });
  const id = hub.recentLanterns()[0].id;
  hub.handle(pb.id, { t: 'report', id });
  hub.handle(pb.id, { t: 'report', id });
  assert.equal(hub.recentLanterns().length, 1, '같은 사람이 여러 번 신고해도 한 번');
  tick(1001);
  hub.handle(pc.id, { t: 'report', id });
  assert.equal(hub.recentLanterns().length, 0);
  assert.equal(a.last('hide').id, id);
  tick(S.LIMITS.lanternTtlMs + 1);
  hub.prune();
  assert.equal(hub.lanterns.size, 0);
});

test('간식은 마루별로 세고, 너무 빨리 누르면 무시해요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const pa = hub.join(a.send, { pet: pet('초코') }).peer;
  hub.handle(pa.id, { t: 'treat' });
  hub.handle(pa.id, { t: 'treat' });
  assert.equal(a.last('treat').total, 1);
  tick(S.LIMITS.treatCooldownMs + 1);
  hub.handle(pa.id, { t: 'treat' });
  assert.equal(a.last('treat').total, 2);
});

test('마루를 옮기면 원래 마루에 떠났다고 알리고 새 마루 정보를 받아요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('하나') }).peer;
  hub.join(b.send, { pet: pet('둘') });
  tick(2000);
  hub.handle(pa.id, { t: 'room', room: 'maru-7' });
  assert.equal(b.last('leave').id, pa.id);
  assert.equal(a.last('welcome').room.id, 'maru-7');
  assert.equal(pa.room, 'maru-7');
});

test('저장했다가 다시 불러와도 연등과 오늘 통계가 남아요', () => {
  const { hub, at } = makeHub();
  const pa = hub.join(client().send, { pet: pet('초코') }).peer;
  hub.handle(pa.id, { t: 'lantern', wish: S.wishesFor(false)[0] });
  const saved = JSON.parse(JSON.stringify(hub.toJSON()));
  const hub2 = new Hub({ capacity: 4, now: () => at() + 1000 });
  hub2.load(saved);
  assert.equal(hub2.recentLanterns().length, 1);
  assert.equal(hub2.stats().today.lanterns, 1);
  const c = client();
  hub2.join(c.send, { pet: pet('셋'), room: 'maru-1' });
  assert.equal(c.last('welcome').lanterns.length, 1);
});
