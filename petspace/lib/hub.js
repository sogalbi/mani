'use strict';
// 마루(방), 방석, 연등, 오늘 통계를 관리하는 순수 로직. 네트워크와 분리해 테스트하기 쉽게 둬요.
const S = require('../public/shared.js');

const KST_MS = 9 * 60 * 60 * 1000;
const HISTORY_DAYS = 120;

function dayKey(ts) { return new Date(ts + KST_MS).toISOString().slice(0, 10); }
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

class Hub {
  constructor(opts = {}) {
    this.capacity = clampInt(opts.capacity, 4, 100, 24);
    this.maxRooms = clampInt(opts.maxRooms, 1, 10000, 500);
    this.roomLanternLimit = clampInt(opts.roomLanternLimit, 4, 200, 40);
    this.lanternTtl = opts.lanternTtlMs || S.LIMITS.lanternTtlMs;
    this.reportsToHide = clampInt(opts.reportsToHide, 1, 50, 3);
    this.now = opts.now || Date.now;
    this.rand = opts.rand || Math.random;
    this.cooldown = Object.assign({
      act: 300,
      treat: S.LIMITS.treatCooldownMs,
      lantern: S.LIMITS.lanternCooldownMs,
      sit: 800,
      room: 1500,
      report: 1000
    }, opts.cooldown || {});

    this.rooms = new Map();       // id -> { id, public, seats: [], peers: Set }
    this.peers = new Map();       // id -> peer
    this.lanterns = new Map();    // id -> lantern (만든 순서대로)
    this.roomLanterns = new Map();// roomId -> [lanternId...] (오래된 것부터)
    this.roomTreats = new Map();  // roomId -> 오늘 올린 간식 수
    this.seq = 0;
    this.history = [];
    this.day = this._newDay(dayKey(this.now()));
  }

  _newDay(key) { return { day: key, visits: 0, peak: 0, lanterns: 0, treats: 0, bows: 0 }; }

  _rollDay() {
    const key = dayKey(this.now());
    if (key === this.day.day) return;
    this.history.push(this.day);
    if (this.history.length > HISTORY_DAYS) this.history.shift();
    this.day = this._newDay(key);
    this.day.peak = this.peers.size;
    this.roomTreats.clear();
  }

  // 시각을 섞어서 서버를 다시 켜도 저장된 연등 id와 겹치지 않게 해요.
  _id(prefix) { this.seq += 1; return prefix + this.now().toString(36) + '-' + this.seq.toString(36); }

  _createRoom(id) {
    const room = { id, public: S.isPublicRoom(id), seats: new Array(this.capacity).fill(null), peers: new Set() };
    this.rooms.set(id, room);
    return room;
  }

  _gcRooms() {
    for (const [id, r] of this.rooms) if (r.peers.size === 0) this.rooms.delete(id);
  }

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
    // 사람이 가장 많지만 아직 자리가 있는 공개 마루로 보내요. 같이 있는 느낌이 나도록.
    let best = null;
    for (const r of this.rooms.values()) {
      if (!r.public || r.peers.size >= this.capacity) continue;
      if (!best || r.peers.size > best.peers.size) best = r;
    }
    if (best) return best;
    if (this.rooms.size >= this.maxRooms) this._gcRooms();
    if (this.rooms.size >= this.maxRooms) return null;
    let n = 1;
    while (this.rooms.has('maru-' + n)) n += 1;
    return this._createRoom('maru-' + n);
  }

  _pickSeat(room, requested) {
    if (Number.isInteger(requested) && requested >= 0 && requested < this.capacity && room.seats[requested] === null) return requested;
    const free = [];
    for (let i = 0; i < room.seats.length; i++) if (room.seats[i] === null) free.push(i);
    return free[Math.floor(this.rand() * free.length)];
  }

  _pub(peer) { return { id: peer.id, seat: peer.seat, pet: peer.pet }; }

  _lanternPub(l) {
    return { id: l.id, room: l.room, name: l.name, species: l.species, color: l.color, memorial: l.memorial, wish: l.wish, ts: l.ts };
  }

  _visibleRoomLanterns(roomId) {
    const ids = this.roomLanterns.get(roomId) || [];
    const out = [];
    for (const id of ids) {
      const l = this.lanterns.get(id);
      if (l && !l.hidden) out.push(this._lanternPub(l));
    }
    return out;
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
    const last = peer.last[kind] || 0;
    const wait = this.cooldown[kind] - (t - last);
    if (wait > 0) return wait;
    peer.last[kind] = t;
    return 0;
  }

  _welcome(peer, room, notice) {
    const peers = [];
    for (const pid of room.peers) if (pid !== peer.id) peers.push(this._pub(this.peers.get(pid)));
    this._send(peer, {
      t: 'welcome',
      you: { id: peer.id, seat: peer.seat },
      room: { id: room.id, cap: this.capacity, public: room.public, treats: this.roomTreats.get(room.id) || 0 },
      peers,
      lanterns: this._visibleRoomLanterns(room.id),
      stats: this.stats(),
      cooldown: { lantern: this.cooldown.lantern, treat: this.cooldown.treat },
      notice: notice || null
    });
  }

  _place(peer, room, seat) {
    peer.room = room.id;
    peer.seat = seat;
    room.seats[seat] = peer.id;
    room.peers.add(peer.id);
  }

  _unplace(peer) {
    const room = this.rooms.get(peer.room);
    if (!room) return null;
    if (room.seats[peer.seat] === peer.id) room.seats[peer.seat] = null;
    room.peers.delete(peer.id);
    return room;
  }

  /**
   * 새 연결을 마루에 앉혀요. send(str)는 그 연결로 문자열을 보내는 함수예요.
   * 성공하면 { peer }, 실패하면 { error } 를 돌려줘요.
   */
  join(send, hello, meta = {}) {
    this._rollDay();
    const checked = S.cleanPet(hello && hello.pet);
    if (!checked.ok) return { error: checked.reason === 'empty' ? 'name-empty' : 'name' };
    const room = this._pickRoom(hello.room);
    if (!room) return { error: 'full' };
    const seat = this._pickSeat(room, hello.seat);
    const peer = { id: this._id('p'), send, pet: checked.pet, ip: meta.ip || '', last: {}, room: null, seat: -1 };
    this._place(peer, room, seat);
    this.peers.set(peer.id, peer);
    this.day.visits += hello.resume ? 0 : 1;
    this.day.peak = Math.max(this.day.peak, this.peers.size);
    const requested = S.cleanRoomId(hello.room);
    this._welcome(peer, room, requested && requested !== room.id ? 'room-full' : null);
    this._broadcast(room, { t: 'join', p: this._pub(peer) }, peer.id);
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
      case 'sit': {
        const seat = msg.seat;
        if (!Number.isInteger(seat) || seat < 0 || seat >= this.capacity || room.seats[seat] !== null) return;
        if (this._ready(peer, 'sit')) return;
        room.seats[peer.seat] = null;
        peer.seat = seat;
        room.seats[seat] = peer.id;
        this._broadcast(room, { t: 'sit', id: peer.id, seat });
        return;
      }
      case 'act': {
        if (msg.a !== 'bow' && msg.a !== 'palms' && msg.a !== 'tail') return;
        if (this._ready(peer, 'act')) return;
        if (msg.a === 'bow') this.day.bows += 1;
        this._broadcast(room, { t: 'act', id: peer.id, a: msg.a }, peer.id);
        return;
      }
      case 'treat': {
        if (this._ready(peer, 'treat')) return;
        const total = (this.roomTreats.get(room.id) || 0) + 1;
        this.roomTreats.set(room.id, total);
        this.day.treats += 1;
        this._broadcast(room, { t: 'treat', id: peer.id, total });
        return;
      }
      case 'lantern': {
        const wish = msg.wish;
        if (!S.validWish(wish, peer.pet.memorial)) return;
        const wait = this._ready(peer, 'lantern');
        if (wait) { this._send(peer, { t: 'error', code: 'rate', wait }); return; }
        const l = {
          id: this._id('l'), room: room.id, name: peer.pet.name, species: peer.pet.species,
          color: peer.pet.color, memorial: peer.pet.memorial, wish, ts: this.now(),
          reports: new Set(), hidden: false
        };
        this.lanterns.set(l.id, l);
        const list = this.roomLanterns.get(room.id) || [];
        list.push(l.id);
        while (list.length > this.roomLanternLimit) list.shift();
        this.roomLanterns.set(room.id, list);
        this.day.lanterns += 1;
        this._broadcast(room, { t: 'lantern', l: this._lanternPub(l), by: peer.id });
        return;
      }
      case 'report': {
        if (this._ready(peer, 'report')) return;
        const l = this.lanterns.get(msg.id);
        if (!l || l.hidden) return;
        l.reports.add(peer.ip || peer.id);
        if (l.reports.size >= this.reportsToHide) this.hide(l.id);
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
        const seat = this._pickSeat(next, null);
        this._place(peer, next, seat);
        this._welcome(peer, next, target && target !== next.id ? 'room-full' : null);
        this._broadcast(next, { t: 'join', p: this._pub(peer) }, peer.id);
        return;
      }
      default:
    }
  }

  hide(lanternId) {
    const l = this.lanterns.get(lanternId);
    if (!l || l.hidden) return false;
    l.hidden = true;
    this._broadcastAll({ t: 'hide', id: lanternId });
    return true;
  }

  prune() {
    const cutoff = this.now() - this.lanternTtl;
    for (const [id, l] of this.lanterns) {
      if (l.ts >= cutoff) break;
      this.lanterns.delete(id);
    }
    for (const [rid, ids] of this.roomLanterns) {
      const kept = ids.filter((id) => this.lanterns.has(id));
      if (kept.length) this.roomLanterns.set(rid, kept); else this.roomLanterns.delete(rid);
    }
  }

  recentLanterns(limit = 100) {
    const out = [];
    const all = Array.from(this.lanterns.values());
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      if (!all[i].hidden) out.push(this._lanternPub(all[i]));
    }
    return out;
  }

  stats() {
    return {
      online: this.peers.size,
      rooms: this.rooms.size,
      today: { lanterns: this.day.lanterns, treats: this.day.treats, bows: this.day.bows, visits: this.day.visits }
    };
  }

  roomList(limit = 60) {
    const list = [];
    for (const r of this.rooms.values()) if (r.public) list.push({ id: r.id, n: r.peers.size });
    list.sort((a, b) => parseInt(a.id.slice(5), 10) - parseInt(b.id.slice(5), 10));
    return { cap: this.capacity, rooms: list.slice(0, limit) };
  }

  dailyHistory() { return this.history.concat([this.day]); }

  toJSON() {
    const lanterns = [];
    for (const l of this.lanterns.values()) {
      lanterns.push(Object.assign(this._lanternPub(l), { hidden: l.hidden, reports: l.reports.size }));
    }
    return { v: 1, savedAt: this.now(), day: this.day, history: this.history, roomTreats: Array.from(this.roomTreats), lanterns };
  }

  load(data) {
    if (!data || data.v !== 1) return;
    const today = dayKey(this.now());
    if (Array.isArray(data.history)) this.history = data.history.slice(-HISTORY_DAYS);
    if (data.day && data.day.day === today) {
      this.day = Object.assign(this._newDay(today), data.day);
      if (Array.isArray(data.roomTreats)) this.roomTreats = new Map(data.roomTreats);
    } else if (data.day && data.day.day) {
      this.history.push(data.day);
    }
    const cutoff = this.now() - this.lanternTtl;
    const rows = (data.lanterns || []).filter((l) => l && l.ts >= cutoff).sort((a, b) => a.ts - b.ts);
    for (const row of rows) {
      const l = Object.assign({}, row, { reports: new Set(), hidden: !!row.hidden });
      this.lanterns.set(l.id, l);
      const list = this.roomLanterns.get(l.room) || [];
      list.push(l.id);
      while (list.length > this.roomLanternLimit) list.shift();
      this.roomLanterns.set(l.room, list);
    }
  }
}

module.exports = { Hub, dayKey };
