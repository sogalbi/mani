'use strict';
// 추모실(방), 걷는 위치, 사진 소개(추모 카드), 헌화, 하루 통계를 관리하는 순수 로직.
// 네트워크·파일과 분리해서 테스트하기 쉽게 둬요.
const crypto = require('crypto');
const S = require('../public/shared.js');

const KST_MS = 9 * 60 * 60 * 1000;
const HISTORY_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_PHOTO_MS = 60 * 60 * 1000;

function dayKey(ts) { return new Date(ts + KST_MS).toISOString().slice(0, 10); }
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

class Hub {
  constructor(opts = {}) {
    this.capacity = clampInt(opts.capacity, 2, 100, 30);
    this.maxRooms = clampInt(opts.maxRooms, 1, 10000, 500);
    this.roomTributeLimit = clampInt(opts.roomTributeLimit, 4, 200, 40);
    this.tributeTtl = opts.tributeTtlMs || 7 * DAY_MS;
    this.reportsToHide = clampInt(opts.reportsToHide, 1, 50, 3);
    this.now = opts.now || Date.now;
    this.rand = opts.rand || Math.random;
    this.cooldown = Object.assign({
      move: 60,
      act: 300,
      say: S.LIMITS.sayCooldownMs,
      flower: S.LIMITS.flowerCooldownMs,
      spot: S.LIMITS.spotCooldownMs,
      tribute: 30000,
      room: 1500,
      report: 1000
    }, opts.cooldown || {});

    this.rooms = new Map();     // id -> { id, public, peers: Set, tributes: [tid], flowers, spot }
    this.peers = new Map();     // id -> peer
    this.tributes = new Map();  // id -> tribute (만든 순서대로)
    this.photos = new Map();    // photoId -> { ts, used }
    this.roomTributes = new Map(); // roomId -> [tid] (사람이 없어 방이 닫혀도 남겨요)
    this.roomFlowers = new Map();  // roomId -> 오늘 헌화 수
    this.seq = 0;
    this.history = [];
    this.day = this._newDay(dayKey(this.now()));
  }

  _newDay(key) { return { day: key, visits: 0, peak: 0, tributes: 0, flowers: 0, says: 0, bows: 0 }; }

  _rollDay() {
    const key = dayKey(this.now());
    if (key === this.day.day) return;
    this.history.push(this.day);
    if (this.history.length > HISTORY_DAYS) this.history.shift();
    this.day = this._newDay(key);
    this.day.peak = this.peers.size;
    this.roomFlowers.clear();
  }

  // 시각을 섞어서 서버를 다시 켜도 저장된 id와 겹치지 않게 해요.
  _id(prefix) { this.seq += 1; return prefix + this.now().toString(36) + '-' + this.seq.toString(36); }

  _createRoom(id) {
    const room = { id, public: S.isPublicRoom(id), peers: new Set(), spot: null };
    this.rooms.set(id, room);
    return room;
  }

  _gcRooms() { for (const [id, r] of this.rooms) if (r.peers.size === 0) this.rooms.delete(id); }

  _pickRoom(requested) {
    const rid = S.cleanRoomId(requested);
    if (rid) {
      let r = this.rooms.get(rid);
      if (!r) {
        if (this.rooms.size >= this.maxRooms) this._gcRooms();
        if (this.rooms.size < this.maxRooms) r = this._createRoom(rid);
      }
      if (r && r.peers.size < this.capacity) return r;
    }
    // 사람이 가장 많지만 아직 자리가 있는 공개 추모실로 보내요. 같이 있는 느낌이 나도록.
    let best = null;
    for (const r of this.rooms.values()) {
      if (!r.public || r.peers.size >= this.capacity) continue;
      if (!best || r.peers.size > best.peers.size) best = r;
    }
    if (best) return best;
    if (this.rooms.size >= this.maxRooms) this._gcRooms();
    if (this.rooms.size >= this.maxRooms) return null;
    let n = 1;
    while (this.rooms.has('hall-' + n)) n += 1;
    return this._createRoom('hall-' + n);
  }

  _spawn() { return S.cleanPos(0.15 + this.rand() * 0.7, 0.62 + this.rand() * 0.3); }

  _pub(peer) { return { id: peer.id, pet: peer.pet, x: peer.x, y: peer.y, tid: peer.tid }; }

  _tributePub(t) {
    return {
      id: t.id, name: t.name, species: t.species, color: t.color, photo: t.photo,
      message: t.message, since: t.since, until: t.until, ts: t.ts, flowers: t.flowers
    };
  }

  _visible(tid) {
    const t = this.tributes.get(tid);
    return t && !t.hidden ? t : null;
  }

  _roomTributeIds(roomId) {
    const ids = (this.roomTributes.get(roomId) || []).filter((id) => this._visible(id));
    const room = this.rooms.get(roomId);
    if (room) {
      for (const pid of room.peers) {
        const p = this.peers.get(pid);
        if (p && p.tid && this._visible(p.tid) && ids.indexOf(p.tid) === -1) ids.push(p.tid);
      }
    }
    const order = (a, b) => this.tributes.get(a).ts - this.tributes.get(b).ts;
    return ids.sort(order);
  }

  _addToRoom(roomId, tid) {
    const list = (this.roomTributes.get(roomId) || []).filter((id) => id !== tid);
    list.push(tid);
    while (list.length > this.roomTributeLimit) list.shift();
    this.roomTributes.set(roomId, list);
  }

  _send(peer, msg) { peer.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  _broadcast(room, msg, exceptId) {
    const str = JSON.stringify(msg);
    for (const pid of room.peers) {
      if (pid === exceptId) continue;
      const p = this.peers.get(pid);
      if (p) p.send(str);
    }
  }

  _broadcastAll(msg) {
    const str = JSON.stringify(msg);
    for (const p of this.peers.values()) p.send(str);
  }

  _ready(peer, kind) {
    const t = this.now();
    const wait = this.cooldown[kind] - (t - (peer.last[kind] || 0));
    if (wait > 0) return wait;
    peer.last[kind] = t;
    return 0;
  }

  _welcome(peer, room, notice, token) {
    const peers = [];
    for (const pid of room.peers) if (pid !== peer.id) peers.push(this._pub(this.peers.get(pid)));
    const spot = room.spot && this.now() - room.spot.at < S.LIMITS.spotMs && this._visible(room.spot.tid) ? room.spot : null;
    this._send(peer, {
      t: 'welcome',
      now: this.now(),
      you: { id: peer.id, x: peer.x, y: peer.y, tid: peer.tid, token: token || null },
      room: { id: room.id, cap: this.capacity, public: room.public, flowers: this.roomFlowers.get(room.id) || 0 },
      peers,
      tributes: this._roomTributeIds(room.id).map((id) => this._tributePub(this.tributes.get(id))),
      spot,
      stats: this.stats(),
      notice: notice || null
    });
  }

  _place(peer, room) {
    peer.room = room.id;
    room.peers.add(peer.id);
    if (peer.tid) this._addToRoom(room.id, peer.tid);
  }

  _unplace(peer) {
    const room = this.rooms.get(peer.room);
    if (!room) return null;
    room.peers.delete(peer.id);
    return room;
  }

  // ---------- 사진 ----------
  registerPhoto(id) {
    if (!S.PHOTO_ID.test(id)) return false;
    this.photos.set(id, { ts: this.now(), used: false });
    return true;
  }

  photoAllowed(id) {
    const p = this.photos.get(id);
    if (!p) return false;
    if (!p.used) return this.now() - p.ts < PENDING_PHOTO_MS;
    for (const t of this.tributes.values()) if (t.photo === id) return !t.hidden;
    return false;
  }

  _createTribute(peer, room, input) {
    if (!input || typeof input !== 'object') return { error: 'tribute' };
    const photo = this.photos.get(input.photo);
    if (!photo || photo.used) return { error: 'photo' };
    const msg = S.cleanMessage(input.message);
    if (!msg.ok) return { error: 'message' };
    let since = S.cleanYear(input.since, this.now());
    let until = S.cleanYear(input.until, this.now());
    if (since && until && since > until) { const x = since; since = until; until = x; }
    const t = {
      id: this._id('t'), room: room.id, name: peer.pet.name, species: peer.pet.species, color: peer.pet.color,
      photo: input.photo, message: msg.text, since, until, ts: this.now(), flowers: 0,
      token: crypto.randomBytes(8).toString('hex'), hidden: false, reports: new Set()
    };
    photo.used = true;
    this.tributes.set(t.id, t);
    peer.tid = t.id;
    this._addToRoom(room.id, t.id);
    room.spot = { tid: t.id, at: t.ts };
    this.day.tributes += 1;
    return { tribute: t };
  }

  /**
   * 새 연결을 추모실에 들여보내요. send(str)는 그 연결로 문자열을 보내는 함수예요.
   * 성공하면 { peer }, 실패하면 { error } 를 돌려줘요.
   */
  join(send, hello, meta = {}) {
    this._rollDay();
    const checked = S.cleanPet(hello && hello.pet);
    if (!checked.ok) return { error: checked.reason === 'empty' ? 'name-empty' : 'name' };
    const room = this._pickRoom(hello.room);
    if (!room) return { error: 'full' };
    const pos = S.cleanPos(hello.pos && hello.pos.x, hello.pos && hello.pos.y) || this._spawn();
    const peer = { id: this._id('p'), send, pet: checked.pet, ip: meta.ip || '', last: {}, room: null, x: pos.x, y: pos.y, tid: null };

    let token = null;
    let created = null;
    let tributeError = null;
    const resume = hello.resume;
    if (resume && typeof resume === 'object') {
      const t = this._visible(resume.tid);
      if (t && typeof resume.token === 'string' && resume.token === t.token) { peer.tid = t.id; token = t.token; }
    }
    if (!peer.tid && hello.tribute) {
      const r = this._createTribute(peer, room, hello.tribute);
      if (r.error) tributeError = r.error; else { created = r.tribute; token = created.token; peer.last.tribute = this.now(); }
    }

    this._place(peer, room);
    this.peers.set(peer.id, peer);
    if (!hello.again) this.day.visits += 1;
    this.day.peak = Math.max(this.day.peak, this.peers.size);
    const requested = S.cleanRoomId(hello.room);
    this._welcome(peer, room, requested && requested !== room.id ? 'room-full' : null, token);
    if (tributeError) this._send(peer, { t: 'error', code: tributeError });
    this._broadcast(room, { t: 'join', p: this._pub(peer) }, peer.id);
    if (created) this._broadcast(room, { t: 'tribute', tr: this._tributePub(created), at: created.ts, by: peer.id }, peer.id);
    return { peer };
  }

  leave(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const room = this._unplace(peer);
    if (room) {
      this._broadcast(room, { t: 'leave', id: peerId });
      if (room.peers.size === 0) this.rooms.delete(room.id);
    }
  }

  handle(peerId, msg) {
    const peer = this.peers.get(peerId);
    if (!peer || !msg || typeof msg !== 'object') return;
    this._rollDay();
    const room = this.rooms.get(peer.room);
    if (!room) return;

    switch (msg.t) {
      case 'move': {
        const pos = S.cleanPos(msg.x, msg.y);
        if (!pos || this._ready(peer, 'move')) return;
        peer.x = pos.x;
        peer.y = pos.y;
        this._broadcast(room, { t: 'move', id: peer.id, x: pos.x, y: pos.y }, peer.id);
        return;
      }
      case 'act': {
        if (msg.a !== 'bow' && msg.a !== 'tail') return;
        if (this._ready(peer, 'act')) return;
        if (msg.a === 'bow') this.day.bows += 1;
        this._broadcast(room, { t: 'act', id: peer.id, a: msg.a }, peer.id);
        return;
      }
      case 'say': {
        if (!Number.isInteger(msg.w) || msg.w < 0 || msg.w >= S.WORDS.length) return;
        if (this._ready(peer, 'say')) return;
        this.day.says += 1;
        this._broadcast(room, { t: 'say', id: peer.id, w: msg.w }, peer.id);
        return;
      }
      case 'flower': {
        const t = this._visible(msg.tid);
        if (!t || this._roomTributeIds(room.id).indexOf(t.id) === -1) return;
        if (this._ready(peer, 'flower')) return;
        t.flowers += 1;
        const total = (this.roomFlowers.get(room.id) || 0) + 1;
        this.roomFlowers.set(room.id, total);
        this.day.flowers += 1;
        this._broadcast(room, { t: 'flower', id: peer.id, tid: t.id, n: t.flowers, total });
        return;
      }
      case 'spot': {
        if (!peer.tid || !this._visible(peer.tid)) return;
        const wait = this._ready(peer, 'spot');
        if (wait) { this._send(peer, { t: 'error', code: 'rate', what: 'spot', wait }); return; }
        room.spot = { tid: peer.tid, at: this.now() };
        this._broadcast(room, { t: 'spot', tid: peer.tid, at: room.spot.at });
        return;
      }
      case 'tribute': {
        const wait = this._ready(peer, 'tribute');
        if (wait) { this._send(peer, { t: 'error', code: 'rate', what: 'tribute', wait }); return; }
        const r = this._createTribute(peer, room, msg);
        if (r.error) { peer.last.tribute = 0; this._send(peer, { t: 'error', code: r.error }); return; }
        this._send(peer, { t: 'mine', tid: r.tribute.id, token: r.tribute.token });
        this._broadcast(room, { t: 'tribute', tr: this._tributePub(r.tribute), at: r.tribute.ts, by: peer.id });
        return;
      }
      case 'report': {
        if (this._ready(peer, 'report')) return;
        const t = this._visible(msg.tid);
        if (!t) return;
        t.reports.add(peer.ip || peer.id);
        if (t.reports.size >= this.reportsToHide) this.hide(t.id);
        return;
      }
      case 'room': {
        if (this._ready(peer, 'room')) return;
        const target = S.cleanRoomId(msg.room);
        if (target === room.id) return;
        this._unplace(peer);
        this._broadcast(room, { t: 'leave', id: peer.id });
        if (room.peers.size === 0) this.rooms.delete(room.id);
        let next = this._pickRoom(msg.room);
        if (!next) next = this.rooms.get(room.id) || this._createRoom(room.id);
        const pos = this._spawn();
        peer.x = pos.x;
        peer.y = pos.y;
        this._place(peer, next);
        this._welcome(peer, next, target && target !== next.id ? 'room-full' : null, null);
        this._broadcast(next, { t: 'join', p: this._pub(peer) }, peer.id);
        return;
      }
      default:
    }
  }

  hide(tid) {
    const t = this.tributes.get(tid);
    if (!t || t.hidden) return false;
    t.hidden = true;
    for (const p of this.peers.values()) if (p.tid === tid) p.tid = null;
    this._broadcastAll({ t: 'hide', tid });
    return true;
  }

  /** 오래된 추모 카드와 쓰이지 않은 사진을 정리하고, 지워야 할 사진 id 목록을 돌려줘요. */
  prune() {
    const now = this.now();
    const remove = [];
    const cutoff = now - this.tributeTtl;
    for (const [id, t] of this.tributes) {
      if (t.ts >= cutoff) break;
      let present = false;
      for (const p of this.peers.values()) if (p.tid === id) present = true;
      if (present) continue;
      this.tributes.delete(id);
      this.photos.delete(t.photo);
      remove.push(t.photo);
    }
    for (const [id, t] of this.tributes) {
      if (t.hidden && this.photos.has(t.photo)) { this.photos.delete(t.photo); remove.push(t.photo); }
    }
    for (const [pid, p] of this.photos) {
      if (!p.used && now - p.ts > PENDING_PHOTO_MS) { this.photos.delete(pid); remove.push(pid); }
    }
    for (const [rid, ids] of this.roomTributes) {
      const kept = ids.filter((id) => this.tributes.has(id));
      if (kept.length) this.roomTributes.set(rid, kept); else this.roomTributes.delete(rid);
    }
    return remove;
  }

  recentTributes(limit = 60) {
    const out = [];
    const all = Array.from(this.tributes.values());
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      if (!all[i].hidden) out.push(this._tributePub(all[i]));
    }
    return out;
  }

  stats() {
    return {
      online: this.peers.size,
      rooms: this.rooms.size,
      today: { visits: this.day.visits, tributes: this.day.tributes, flowers: this.day.flowers, says: this.day.says }
    };
  }

  roomList(limit = 60) {
    const list = [];
    for (const r of this.rooms.values()) if (r.public) list.push({ id: r.id, n: r.peers.size });
    list.sort((a, b) => parseInt(a.id.slice(5), 10) - parseInt(b.id.slice(5), 10));
    return { cap: this.capacity, rooms: list.slice(0, limit) };
  }

  dailyHistory() { return this.history.concat([this.day]); }

  /** 디스크에 남아 있어야 하는 사진 id (서버를 켤 때 나머지 파일을 정리해요). */
  keptPhotos() {
    const keep = new Set();
    for (const t of this.tributes.values()) if (!t.hidden) keep.add(t.photo);
    return keep;
  }

  toJSON() {
    const tributes = [];
    for (const t of this.tributes.values()) {
      tributes.push(Object.assign(this._tributePub(t), { room: t.room, token: t.token, hidden: t.hidden }));
    }
    return {
      v: 2, savedAt: this.now(), day: this.day, history: this.history,
      roomFlowers: Array.from(this.roomFlowers), roomTributes: Array.from(this.roomTributes), tributes
    };
  }

  load(data) {
    if (!data || data.v !== 2) return;
    const today = dayKey(this.now());
    if (Array.isArray(data.history)) this.history = data.history.slice(-HISTORY_DAYS);
    if (data.day && data.day.day === today) {
      this.day = Object.assign(this._newDay(today), data.day);
      if (Array.isArray(data.roomFlowers)) this.roomFlowers = new Map(data.roomFlowers);
    } else if (data.day && data.day.day) {
      this.history.push(data.day);
    }
    const cutoff = this.now() - this.tributeTtl;
    const rows = (data.tributes || []).filter((t) => t && t.ts >= cutoff && S.PHOTO_ID.test(t.photo)).sort((a, b) => a.ts - b.ts);
    for (const row of rows) {
      const t = Object.assign({}, row, { reports: new Set(), hidden: !!row.hidden });
      this.tributes.set(t.id, t);
      this.photos.set(t.photo, { ts: t.ts, used: true });
    }
    for (const [rid, ids] of (data.roomTributes || [])) {
      const kept = (ids || []).filter((id) => this.tributes.has(id));
      if (kept.length) this.roomTributes.set(rid, kept);
    }
  }
}

module.exports = { Hub, dayKey };
