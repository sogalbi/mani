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
  const hub = new Hub(Object.assign({ capacity: 4, rand: () => 0.5, now: () => t }, opts));
  return { hub, tick: (ms) => { t += ms; }, at: () => t };
}
const pet = (name = '초코', extra = {}) => Object.assign({ name, species: 'dog', color: 'cream' }, extra);
let photoSeq = 0;
function photo(hub) {
  photoSeq += 1;
  const id = (photoSeq.toString(16) + '0000000000000000').slice(0, 16);
  hub.registerPhoto(id);
  return id;
}

test('이름·한마디 검사: 정상은 통과, 욕설·링크·전화번호·이상한 문자는 막아요', () => {
  assert.equal(S.cleanName('  초코 ').name, '초코');
  assert.equal(S.cleanName('씨 발').ok, false);
  assert.equal(S.cleanName('01012345678').ok, false);
  assert.equal(S.cleanName('<script>').ok, false);
  assert.equal(S.cleanName('초' + String.fromCharCode(0x200b) + '코').name, '초코');
  assert.equal(S.cleanMessage('초코야, 보고 싶어!').text, '초코야, 보고 싶어!');
  assert.equal(S.cleanMessage('').ok, true);
  assert.equal(S.cleanMessage('카톡 문의 주세요').ok, false);
  assert.equal(S.cleanMessage('<img src=x>').ok, false);
  assert.equal(S.cleanMessage('가'.repeat(80)).text.length, S.LIMITS.messageMax);
});

test('부르는 말: 받침에 따라 야/아', () => {
  assert.equal(S.vocative('초코'), '초코야,');
  assert.equal(S.vocative('몽실'), '몽실아,');
});

test('입장하면 위치와 함께 환영 메시지를 받고 다른 사람에게 알려져요', () => {
  const { hub } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('초코'), pos: { x: 0.2, y: 0.8 } }).peer;
  hub.join(b.send, { pet: pet('나비', { species: 'cat' }) });
  const wb = b.last('welcome');
  assert.equal(wb.room.id, 'hall-1');
  assert.equal(wb.peers[0].pet.name, '초코');
  assert.deepEqual([wb.peers[0].x, wb.peers[0].y], [0.2, 0.8]);
  assert.equal(a.last('join').p.pet.name, '나비');
  hub.leave(pa.id);
  assert.equal(b.last('leave').id, pa.id);
});

test('걷기: 위치는 0~1로 맞춰서 같은 방 사람에게만 보내요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('하나') }).peer;
  hub.join(b.send, { pet: pet('둘') });
  tick(100);
  hub.handle(pa.id, { t: 'move', x: 1.7, y: 0.3333 });
  const m = b.last('move');
  assert.deepEqual([m.x, m.y], [1, 0.333]);
  assert.equal(a.last('move'), undefined, '자기 자신에게는 보내지 않아요');
  hub.handle(pa.id, { t: 'move', x: 'a', y: 0 });
  assert.equal(b.msgs.filter((x) => x.t === 'move').length, 1);
});

test('사진을 올리고 들어오면 큰 화면에 소개되고, 다른 사람에게도 알려져요', () => {
  const { hub } = makeHub();
  const b = client();
  hub.join(b.send, { pet: pet('나비') });
  const a = client();
  const ph = photo(hub);
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: ph, message: '초코야, 보고 싶어', since: 2012, until: 2026 } }).peer;
  const w = a.last('welcome');
  assert.ok(w.you.tid && w.you.token);
  assert.equal(w.tributes.length, 1);
  assert.equal(w.tributes[0].message, '초코야, 보고 싶어');
  assert.equal(w.tributes[0].token, undefined, '비밀 토큰은 남에게 보이지 않아요');
  assert.equal(w.spot.tid, pa.tid);
  const got = b.last('tribute');
  assert.equal(got.tr.name, '초코');
  assert.equal(got.tr.since, 2012);
  assert.equal(hub.photoAllowed(ph), true);
});

test('없는 사진이나 이미 쓴 사진, 나쁜 한마디로는 소개를 만들 수 없어요(입장은 돼요)', () => {
  const { hub } = makeHub();
  const a = client();
  const r = hub.join(a.send, { pet: pet('초코'), tribute: { photo: 'ffffffffffffffff', message: '' } });
  assert.ok(r.peer);
  assert.equal(a.last('error').code, 'photo');
  const ph = photo(hub);
  const c = client();
  hub.join(c.send, { pet: pet('셋'), tribute: { photo: ph, message: 'www.spam.com' } });
  assert.equal(c.last('error').code, 'message');
  const d = client();
  hub.join(d.send, { pet: pet('넷'), tribute: { photo: ph, message: '' } });
  assert.equal(d.last('welcome').you.tid !== null, true);
  const e = client();
  hub.join(e.send, { pet: pet('다섯'), tribute: { photo: ph, message: '' } });
  assert.equal(e.last('error').code, 'photo', '같은 사진은 한 번만');
});

test('다시 접속하면 토큰으로 내 소개를 이어 가요', () => {
  const { hub } = makeHub();
  const a = client();
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: photo(hub), message: '' } }).peer;
  const { tid, token } = a.last('welcome').you;
  hub.leave(pa.id);
  const a2 = client();
  hub.join(a2.send, { pet: pet('초코'), resume: { tid, token } });
  assert.equal(a2.last('welcome').you.tid, tid);
  const x = client();
  hub.join(x.send, { pet: pet('남'), resume: { tid, token: 'wrong' } });
  assert.equal(x.last('welcome').you.tid, null);
});

test('헌화: 화면에 있는 아이에게만, 너무 빨리는 안 돼요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: photo(hub), message: '' } }).peer;
  hub.handle(pa.id, { t: 'flower', tid: pa.tid });
  hub.handle(pa.id, { t: 'flower', tid: pa.tid });
  assert.equal(a.last('flower').n, 1);
  tick(S.LIMITS.flowerCooldownMs + 1);
  hub.handle(pa.id, { t: 'flower', tid: pa.tid });
  assert.equal(a.last('flower').n, 2);
  assert.equal(a.last('flower').total, 2);
  hub.handle(pa.id, { t: 'flower', tid: 'nope' });
  assert.equal(hub.stats().today.flowers, 2);
});

test('말풍선은 정해진 말만, 우리 아이 띄우기는 1분에 한 번', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: photo(hub), message: '' } }).peer;
  hub.join(b.send, { pet: pet('나비') });
  hub.handle(pa.id, { t: 'say', w: 0 });
  assert.equal(b.last('say').w, 0);
  tick(S.LIMITS.sayCooldownMs + 1);
  hub.handle(pa.id, { t: 'say', w: 99 });
  hub.handle(pa.id, { t: 'say', w: 'hi' });
  assert.equal(b.msgs.filter((m) => m.t === 'say').length, 1);
  hub.handle(pa.id, { t: 'spot' });
  assert.equal(b.last('spot').tid, pa.tid);
  hub.handle(pa.id, { t: 'spot' });
  assert.equal(a.last('error').what, 'spot');
});

test('들어온 뒤에도 사진을 올려 소개를 만들 수 있어요', () => {
  const { hub } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('초코') }).peer;
  hub.join(b.send, { pet: pet('나비') });
  hub.handle(pa.id, { t: 'tribute', photo: photo(hub), message: '초코야, 고마웠어', since: 2020 });
  assert.ok(a.last('mine').token);
  assert.equal(b.last('tribute').tr.message, '초코야, 고마웠어');
  assert.equal(pa.tid, a.last('mine').tid);
});

test('신고가 쌓이면 소개가 내려가고 사진도 더는 안 보여요', () => {
  const { hub, tick } = makeHub({ reportsToHide: 2 });
  const a = client();
  const ph = photo(hub);
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: ph, message: '' } }, { ip: '1.1.1.1' }).peer;
  const pb = hub.join(client().send, { pet: pet('둘') }, { ip: '2.2.2.2' }).peer;
  const pc = hub.join(client().send, { pet: pet('셋') }, { ip: '3.3.3.3' }).peer;
  const tid = pa.tid;
  hub.handle(pb.id, { t: 'report', tid });
  tick(1001);
  hub.handle(pb.id, { t: 'report', tid });
  assert.equal(hub.recentTributes().length, 1, '같은 사람이 여러 번 신고해도 한 번');
  hub.handle(pc.id, { t: 'report', tid });
  assert.equal(hub.recentTributes().length, 0);
  assert.equal(a.last('hide').tid, tid);
  assert.equal(hub.photoAllowed(ph), false);
  assert.deepEqual(hub.prune(), [ph]);
});

test('오래된 소개와 쓰이지 않은 사진은 정리돼요', () => {
  const { hub, tick } = makeHub({ tributeTtlMs: 1000 * 60 * 60 * 24 });
  const a = client();
  const ph = photo(hub);
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: ph, message: '' } }).peer;
  const unused = photo(hub);
  tick(2 * 60 * 60 * 1000);
  assert.deepEqual(hub.prune(), [unused]);
  hub.leave(pa.id);
  tick(24 * 60 * 60 * 1000);
  assert.deepEqual(hub.prune(), [ph]);
  assert.equal(hub.tributes.size, 0);
});

test('추모실이 차면 다음 호실을 열고, 가족 추모실은 낯선 사람이 자동으로 들어오지 않아요', () => {
  const { hub } = makeHub({ capacity: 2 });
  hub.join(client().send, { pet: pet('하나') });
  hub.join(client().send, { pet: pet('둘') });
  const c = client();
  hub.join(c.send, { pet: pet('셋'), room: 'hall-1' });
  assert.equal(c.last('welcome').room.id, 'hall-2');
  assert.equal(c.last('welcome').notice, 'room-full');
  const f = hub.join(client().send, { pet: pet('가족'), room: 'family-abc' }).peer;
  assert.equal(f.room, 'family-abc');
  const g = hub.join(client().send, { pet: pet('넷') }).peer;
  assert.equal(g.room, 'hall-2');
});

test('추모실을 옮기면 원래 방에 떠났다고 알리고, 내 소개도 따라와요', () => {
  const { hub, tick } = makeHub();
  const a = client();
  const b = client();
  const pa = hub.join(a.send, { pet: pet('하나'), tribute: { photo: photo(hub), message: '' } }).peer;
  hub.join(b.send, { pet: pet('둘') });
  tick(2000);
  hub.handle(pa.id, { t: 'room', room: 'hall-7' });
  assert.equal(b.last('leave').id, pa.id);
  const w = a.last('welcome');
  assert.equal(w.room.id, 'hall-7');
  assert.equal(w.tributes.length, 1);
});

test('저장했다가 다시 불러와도 소개, 헌화 수, 오늘 통계가 남아요', () => {
  const { hub, at } = makeHub();
  const a = client();
  const pa = hub.join(a.send, { pet: pet('초코'), tribute: { photo: photo(hub), message: '초코야, 사랑해' } }).peer;
  hub.handle(pa.id, { t: 'flower', tid: pa.tid });
  const saved = JSON.parse(JSON.stringify(hub.toJSON()));
  const hub2 = new Hub({ capacity: 4, now: () => at() + 1000 });
  hub2.load(saved);
  assert.equal(hub2.recentTributes().length, 1);
  assert.equal(hub2.recentTributes()[0].flowers, 1);
  assert.equal(hub2.stats().today.tributes, 1);
  assert.ok(hub2.keptPhotos().has(saved.tributes[0].photo));
  const c = client();
  hub2.join(c.send, { pet: pet('셋'), room: 'hall-1' });
  assert.equal(c.last('welcome').tributes.length, 1);
  const r = client();
  hub2.join(r.send, { pet: pet('초코'), resume: { tid: pa.tid, token: a.last('welcome').you.token } });
  assert.equal(r.last('welcome').you.tid, pa.tid);
});
