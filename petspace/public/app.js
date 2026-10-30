/* 멍냥사 화면. 캔버스에 법당과 아이들을 그리고, 서버(또는 혼자 모드)와 주고받아요. */
(function () {
  'use strict';

  var PS = window.PS;
  var CFG = Object.assign({ ws: 'auto' }, window.PETSPACE_CONFIG || {});
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;

  // ---------- 작은 도구 ----------
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('mns:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('mns:' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 계속 */ } }
  };
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 지원 안 함 */ } }
  function timeAgo(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    return Math.floor(s / 3600) + '시간 전';
  }
  function todayKey() {
    var d = new Date(Date.now() + 9 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function nowMs() { return performance.now(); }

  // ---------- 상태 ----------
  var state = {
    pet: store.get('pet', null),
    joined: false,
    mode: 'idle',           // live | solo | reconnecting | idle
    myId: null,
    mySeat: -1,
    room: { id: null, cap: 24, public: true, treats: 0 },
    peers: new Map(),       // id -> peer (나 포함)
    lanterns: [],           // 오래된 것부터
    treats: 0,
    bowlBump: -10,
    stats: null,
    lanternCooldown: PS.LIMITS.lanternCooldownMs,
    treatCooldown: PS.LIMITS.treatCooldownMs,
    lanternReadyAt: 0,
    treatReadyAt: 0,
    wantRoom: null,
    reported: store.get('reported', [])
  };

  var draft = {
    name: state.pet ? state.pet.name : '',
    species: state.pet ? state.pet.species : 'dog',
    color: state.pet ? state.pet.color : 'cream',
    memorial: state.pet ? !!state.pet.memorial : false
  };

  var daily = store.get('daily', null);
  if (!daily || daily.day !== todayKey()) daily = { day: todayKey(), bows: 0, beads: 0, rounds: 0, moktak: 0 };
  function saveDaily() { store.set('daily', daily); }

  // ---------- 장면 크기와 배치 ----------
  var scene = {
    canvas: $('scene'), ctx: null, w: 0, h: 0, dpr: 1,
    bg: null, vignette: null, G: null,
    stars: [], smoke: [], motes: [], fx: [], slots: []
  };
  scene.ctx = scene.canvas.getContext('2d');

  function computeLayout() {
    var W = scene.w, H = scene.h;
    var tb = $('topbar'), ab = $('actions');
    var top = tb.hidden ? 64 : tb.getBoundingClientRect().bottom - 4;
    var bottom = ab.hidden ? H - 104 : ab.getBoundingClientRect().top + 4;
    var midH = Math.max(260, bottom - top);
    var floorY = Math.round(top + midH * 0.40);
    var cx = W / 2;
    var span = Math.min(W, 760);
    var left = cx - span / 2, right = cx + span / 2;
    var wallH = floorY - top;
    var winR = clamp(Math.min(span * 0.30, wallH * 0.52), 44, 178);
    var winY = top + wallH * 0.52 + 4;
    var pillarW = clamp(span * 0.045, 12, 30);
    var pL = left + span * 0.035, pR = right - span * 0.035 - pillarW;
    var altarW = Math.min(span * 0.54, 320);
    var altarH = clamp(wallH * 0.15, 16, 34);
    var altarTop = floorY + 8 - altarH;
    var lotusR = clamp(winR * 0.24, 13, 34);
    var lotusY = altarTop - lotusR * 1.05;

    // 연등 줄
    var lr = clamp(span * 0.031, 10, 16);
    var sp = lr * 3.5;
    var strTop = top + 14;
    var limitY = lotusY - lotusR - lr * 2.6;
    var gap = lr * 4.2;
    var nStr = clamp(Math.floor((limitY - strTop) / gap) + 1, 1, 3);
    var strings = [];
    for (var k = 0; k < nStr; k++) {
      var x0 = pL + pillarW + 4, x1 = pR - 4;
      var n = Math.max(1, Math.floor((x1 - x0) / sp));
      strings.push({ y: strTop + k * gap, x0: x0, x1: x1, sag: 8 + k * 3, n: n, pad: ((x1 - x0) - n * sp) / 2, sp: sp });
    }

    // 방석
    var cap = state.room.cap || 24;
    var perRow = cap <= 12 ? 4 : cap <= 24 ? 6 : cap <= 40 ? 8 : 10;
    var rows = Math.ceil(cap / perRow);
    var floorH = bottom - floorY;
    var rowTop = floorY + Math.max(40, floorH * 0.2);
    var rowBottom = bottom - Math.max(26, floorH * 0.1);
    var seats = [];
    for (var r = 0; r < rows; r++) {
      var t = rows === 1 ? 1 : r / (rows - 1);
      var y = lerp(rowTop, rowBottom, Math.pow(t, 1.1));
      var rw = Math.min(span * lerp(0.72, 0.96, t), 720);
      var cell = rw / perRow;
      var u = clamp(cell * 0.78, 20, 64) * lerp(0.92, 1, t);
      var count = Math.min(perRow, cap - r * perRow);
      for (var i = 0; i < count; i++) {
        seats.push({ x: cx + (i - (count - 1) / 2) * cell, y: y, u: u, row: r, cell: cell });
      }
    }

    scene.G = {
      W: W, H: H, top: top, bottom: bottom, floorY: floorY, cx: cx, span: span, left: left, right: right,
      winR: winR, winY: winY, pillarW: pillarW, pL: pL, pR: pR,
      altarW: altarW, altarH: altarH, altarTop: altarTop, lotusR: lotusR, lotusY: lotusY,
      lr: lr, strings: strings, seats: seats
    };

    var rand = rng(7);
    scene.stars = [];
    for (var s = 0; s < 46; s++) {
      var a = rand() * TAU, d = Math.sqrt(rand()) * winR * 0.96;
      var sx = cx + Math.cos(a) * d, sy = winY + Math.sin(a) * d;
      if (sy > winY + winR * 0.15) continue;
      scene.stars.push({ x: sx, y: sy, r: 0.5 + rand() * 1.1, p: rand() * TAU, s: 0.6 + rand() * 1.6 });
    }
    scene.motes = [];
    for (var m = 0; m < 14; m++) {
      scene.motes.push({ x: rand() * W, y: top + rand() * (bottom - top), p: rand() * TAU, s: 0.3 + rand() * 0.7 });
    }
    paintBackground();
    computeSlots(true);
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    scene.dpr = dpr;
    scene.w = window.innerWidth;
    scene.h = window.innerHeight;
    scene.canvas.width = Math.round(scene.w * dpr);
    scene.canvas.height = Math.round(scene.h * dpr);
    computeLayout();
  }

  // ---------- 배경 (크기가 바뀔 때만 다시 그려요) ----------
  function offscreen(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.round(w * scene.dpr);
    c.height = Math.round(h * scene.dpr);
    var x = c.getContext('2d');
    x.scale(scene.dpr, scene.dpr);
    return { c: c, x: x };
  }

  function ellipse(x, cx, cy, rx, ry, rot) {
    x.beginPath();
    x.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU);
  }

  function paintBackground() {
    var G = scene.G, W = G.W, H = G.H;
    var o = offscreen(W, H), x = o.x;

    // 벽
    var g = x.createLinearGradient(0, 0, 0, G.floorY);
    g.addColorStop(0, '#191324');
    g.addColorStop(1, '#352420');
    x.fillStyle = g;
    x.fillRect(0, 0, W, G.floorY + 2);
    x.strokeStyle = 'rgba(0,0,0,.2)';
    x.lineWidth = 1;
    for (var px = G.left; px < G.right; px += 24) {
      x.beginPath(); x.moveTo(Math.round(px) + 0.5, 0); x.lineTo(Math.round(px) + 0.5, G.floorY); x.stroke();
    }

    // 창살문 (창 양옆)
    var panelL = G.pL + G.pillarW + 12, panelR = G.cx - G.winR - 16;
    if (panelR - panelL > 34) {
      [[panelL, panelR], [G.cx + G.winR + 16, G.pR - 12]].forEach(function (pr) {
        var x0 = pr[0], x1 = pr[1], y0 = G.top + 6, y1 = G.floorY - 10;
        var pg = x.createLinearGradient(0, y0, 0, y1);
        pg.addColorStop(0, 'rgba(255,214,160,.05)');
        pg.addColorStop(1, 'rgba(255,200,140,.13)');
        x.fillStyle = pg;
        x.fillRect(x0, y0, x1 - x0, y1 - y0);
        x.strokeStyle = 'rgba(70,42,28,.9)';
        x.lineWidth = 1.2;
        var step = 11;
        for (var gx = x0 + step; gx < x1 - 2; gx += step) { x.beginPath(); x.moveTo(gx, y0); x.lineTo(gx, y1); x.stroke(); }
        for (var gy = y0 + step; gy < y1 - 2; gy += step) { x.beginPath(); x.moveTo(x0, gy); x.lineTo(x1, gy); x.stroke(); }
        x.lineWidth = 3;
        x.strokeStyle = '#4a2c1e';
        x.strokeRect(x0, y0, x1 - x0, y1 - y0);
      });
    }

    // 둥근 창과 밤하늘
    x.save();
    x.beginPath(); x.arc(G.cx, G.winY, G.winR, 0, TAU); x.clip();
    var sky = x.createLinearGradient(0, G.winY - G.winR, 0, G.winY + G.winR);
    sky.addColorStop(0, '#0d1433');
    sky.addColorStop(0.6, '#26285a');
    sky.addColorStop(1, '#4a3a68');
    x.fillStyle = sky;
    x.fillRect(G.cx - G.winR, G.winY - G.winR, G.winR * 2, G.winR * 2);
    // 달무지개
    var bowColors = ['#ff9aa8', '#ffc88a', '#fff0a0', '#a8e8b8', '#9cc8ff', '#c4a8ff'];
    x.lineWidth = Math.max(2, G.winR * 0.035);
    for (var b = 0; b < bowColors.length; b++) {
      x.strokeStyle = bowColors[b];
      x.globalAlpha = 0.22;
      x.beginPath();
      x.arc(G.cx, G.winY + G.winR * 0.62, G.winR * (0.86 - b * 0.04), Math.PI * 1.08, Math.PI * 1.92);
      x.stroke();
    }
    x.globalAlpha = 1;
    // 달
    var mx = G.cx + G.winR * 0.42, my = G.winY - G.winR * 0.45, mr = G.winR * 0.13;
    var mg = x.createRadialGradient(mx, my, 0, mx, my, mr * 4);
    mg.addColorStop(0, 'rgba(255,244,214,.35)');
    mg.addColorStop(1, 'rgba(255,244,214,0)');
    x.fillStyle = mg;
    x.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
    x.fillStyle = '#fff3d6';
    x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
    x.fillStyle = '#26285a';
    x.beginPath(); x.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.88, 0, TAU); x.fill();
    // 산
    var rand = rng(11);
    [['#2a2752', 0.18, 0.2], ['#1c1b3c', 0.36, 0.14]].forEach(function (layer) {
      x.fillStyle = layer[0];
      x.beginPath();
      var base = G.winY + G.winR * layer[1];
      x.moveTo(G.cx - G.winR, G.winY + G.winR);
      for (var i = 0; i <= 12; i++) {
        var lx = G.cx - G.winR + (G.winR * 2) * (i / 12);
        var ly = base - Math.sin(i * 0.9 + layer[1] * 9) * G.winR * layer[2] - rand() * G.winR * 0.06;
        x.lineTo(lx, ly);
      }
      x.lineTo(G.cx + G.winR, G.winY + G.winR);
      x.closePath();
      x.fill();
    });
    x.restore();
    // 창틀
    x.lineWidth = Math.max(4, G.winR * 0.07);
    x.strokeStyle = '#4b2a1c';
    x.beginPath(); x.arc(G.cx, G.winY, G.winR, 0, TAU); x.stroke();
    x.lineWidth = 1.5;
    x.strokeStyle = 'rgba(214,170,100,.45)';
    x.beginPath(); x.arc(G.cx, G.winY, G.winR + Math.max(4, G.winR * 0.07) / 2 + 1, 0, TAU); x.stroke();

    // 기둥
    [G.pL, G.pR].forEach(function (pxl) {
      var pg2 = x.createLinearGradient(pxl, 0, pxl + G.pillarW, 0);
      pg2.addColorStop(0, '#4f1d16');
      pg2.addColorStop(0.45, '#7c2c21');
      pg2.addColorStop(1, '#3f1712');
      x.fillStyle = pg2;
      x.fillRect(pxl, 0, G.pillarW, G.floorY + 10);
    });
    // 들보와 단청
    var beamY = Math.max(0, G.top - 30), beamH = 22;
    x.fillStyle = '#2b4f4a';
    x.fillRect(G.left, beamY, G.span, beamH);
    var cols = ['#3f7f6a', '#a3443a', '#d4b15c', '#3f7f6a', '#e8e0cf'];
    for (var bx = G.left + 2, ci = 0; bx < G.right - 6; bx += 12, ci++) {
      x.fillStyle = cols[ci % cols.length];
      x.globalAlpha = 0.55;
      x.fillRect(bx, beamY + 5, 8, beamH - 10);
    }
    x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,.35)';
    x.fillRect(G.left, beamY + beamH, G.span, 3);

    // 마루 바닥
    var fg = x.createLinearGradient(0, G.floorY, 0, H);
    fg.addColorStop(0, '#3a271c');
    fg.addColorStop(1, '#6c4831');
    x.fillStyle = fg;
    x.fillRect(0, G.floorY, W, H - G.floorY);
    x.save();
    x.beginPath(); x.rect(0, G.floorY, W, H - G.floorY); x.clip();
    var vx = G.cx, vy = G.floorY - (H - G.floorY) * 1.5;
    x.strokeStyle = 'rgba(20,10,4,.28)';
    x.lineWidth = 1;
    for (var i2 = -16; i2 <= 16; i2++) {
      var bx2 = G.cx + i2 * (G.span / 8);
      x.beginPath(); x.moveTo(vx, vy); x.lineTo(bx2, H); x.stroke();
    }
    for (var k = 1; k < 12; k++) {
      var fy = G.floorY + (H - G.floorY) * Math.pow(k / 12, 1.5);
      x.strokeStyle = 'rgba(20,10,4,' + (0.12 + k * 0.012) + ')';
      x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke();
    }
    x.restore();
    x.fillStyle = '#20140d';
    x.fillRect(0, G.floorY - 2, W, 6);

    // 불단(상)
    var aw = G.altarW, ah = G.altarH, ax = G.cx - aw / 2, ay = G.altarTop;
    x.fillStyle = 'rgba(0,0,0,.35)';
    ellipse(x, G.cx, ay + ah + 4, aw * 0.56, ah * 0.35); x.fill();
    x.fillStyle = '#4a2b1d';
    x.fillRect(ax, ay, aw, ah);
    x.fillStyle = '#6b412b';
    x.fillRect(ax - 4, ay - 4, aw + 8, 6);
    x.fillStyle = '#7a2a22';
    x.fillRect(G.cx - aw * 0.22, ay + 2, aw * 0.44, ah - 2);
    x.strokeStyle = 'rgba(214,170,90,.7)';
    x.lineWidth = 1.5;
    x.strokeRect(G.cx - aw * 0.22 + 3, ay + 5, aw * 0.44 - 6, ah - 9);

    // 불빛과 가장자리 어둠
    var lg = x.createRadialGradient(G.cx, G.lotusY, 0, G.cx, G.lotusY, Math.max(W, H) * 0.75);
    lg.addColorStop(0, 'rgba(255,184,104,.22)');
    lg.addColorStop(0.4, 'rgba(255,170,90,.07)');
    lg.addColorStop(1, 'rgba(255,170,90,0)');
    x.fillStyle = lg;
    x.fillRect(0, 0, W, H);
    scene.bg = o.c;

    var v = offscreen(W, H);
    var vg = v.x.createRadialGradient(G.cx, H * 0.55, Math.min(W, H) * 0.35, G.cx, H * 0.55, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(8,5,16,0)');
    vg.addColorStop(1, 'rgba(8,5,16,.55)');
    v.x.fillStyle = vg;
    v.x.fillRect(0, 0, W, H);
    scene.vignette = v.c;
  }

  // ---------- 연등 ----------
  var LIVING_LAMPS = ['#ff9eb0', '#ffc879', '#9fe0b4', '#9ec9ff', '#cfaaff', '#ffb38a'];
  function lampColor(l) { return l.memorial ? '#f6f1e6' : LIVING_LAMPS[hash(l.id) % LIVING_LAMPS.length]; }

  function stringY(st, x) {
    var mid = (st.x0 + st.x1) / 2, half = (st.x1 - st.x0) / 2;
    var d = (x - mid) / half;
    return st.y + st.sag * (1 - d * d);
  }

  function computeSlots(snap) {
    var G = scene.G;
    var slots = [];
    for (var s = G.strings.length - 1; s >= 0; s--) {
      var st = G.strings[s];
      var mid = (st.n - 1) / 2;
      var idx = [];
      for (var i = 0; i < st.n; i++) idx.push(i);
      idx.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid) || a - b; });
      idx.forEach(function (i) {
        var lx = st.x0 + st.pad + st.sp * (i + 0.5);
        var sy = stringY(st, lx);
        slots.push({ x: lx, sy: sy, y: sy + G.lr * 1.55, spacing: st.sp });
      });
    }
    scene.slots = slots;
    var shown = visibleLanterns();
    shown.forEach(function (l, i) {
      var slot = slots[i];
      l.slot = slot;
      if (snap || l.x == null) { l.x = slot.x; l.y = slot.y; }
    });
    state.lanterns.forEach(function (l) { if (shown.indexOf(l) === -1) l.slot = null; });
  }

  function visibleLanterns() {
    var out = [];
    for (var i = state.lanterns.length - 1; i >= 0 && out.length < scene.slots.length; i--) {
      if (!state.lanterns[i].hidden) out.push(state.lanterns[i]);
    }
    return out;
  }

  function drawLotus(ctx, x, y, r, color, glow, flick) {
    var gr = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
    gr.addColorStop(0, hexA(color, 0.55 * glow * flick));
    gr.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    // 뒤 꽃잎
    ctx.fillStyle = shade(color, -0.18);
    for (var i = -3; i <= 3; i += 2) {
      var a = i * 0.36;
      ellipse(ctx, x + Math.sin(a) * r * 0.52, y - Math.cos(a) * r * 0.18, r * 0.34, r * 0.66, a);
      ctx.fill();
    }
    // 앞 꽃잎
    ctx.strokeStyle = shade(color, -0.32);
    ctx.lineWidth = Math.max(0.8, r * 0.07);
    for (var j = -2; j <= 2; j++) {
      var b = j * 0.42;
      ctx.fillStyle = j === 0 ? shade(color, 0.12) : color;
      ellipse(ctx, x + Math.sin(b) * r * 0.42, y + r * 0.08 - Math.cos(b) * r * 0.12, r * 0.3, r * 0.62, b);
      ctx.fill();
      ctx.stroke();
    }
    // 받침
    ctx.fillStyle = shade(color, -0.4);
    ellipse(ctx, x, y + r * 0.62, r * 0.62, r * 0.16);
    ctx.fill();
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    var f = function (c) { return Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var chars = Array.from(text);
    while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
    return chars.join('') + '…';
  }

  // ---------- 아이 그리기 (뒷모습, 불단을 바라봐요) ----------
  function path(ctx) { ctx.beginPath(); return ctx; }

  function drawPet(ctx, pet, x, y, u, a) {
    var col = PS.color(pet.color);
    var t = a.time;
    var bow = a.bow || 0;
    var breathe = Math.sin(t * 1.7 + a.phase) * 0.014;
    var drop = bow * u * 0.34;
    var lw = Math.max(1, u * 0.04);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = col.line;

    if (pet.memorial) {
      var mg = ctx.createRadialGradient(0, -u * 0.55, 0, 0, -u * 0.55, u * 1.05);
      mg.addColorStop(0, 'rgba(255,252,240,.22)');
      mg.addColorStop(1, 'rgba(255,252,240,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(-u * 1.1, -u * 1.6, u * 2.2, u * 2.2);
    }
    if (a.palms > 0) {
      var p = a.palms;
      var pg = ctx.createRadialGradient(0, -u * 0.6, 0, 0, -u * 0.6, u * (0.6 + p * 0.7));
      pg.addColorStop(0, 'rgba(255,214,130,' + (0.5 * (1 - p)).toFixed(3) + ')');
      pg.addColorStop(1, 'rgba(255,214,130,0)');
      ctx.fillStyle = pg;
      ctx.fillRect(-u * 1.4, -u * 2, u * 2.8, u * 2.8);
    }

    var sq = 1 - bow * 0.07 + breathe;
    var fill = function (c) { ctx.fillStyle = c; ctx.fill(); ctx.stroke(); };
    var wagSpeed = a.wag > 0 ? 17 : 2.4;
    var wagAmp = 0.22 + a.wag * 0.7;
    var sway = Math.sin(t * wagSpeed + a.phase) * wagAmp;

    switch (pet.species) {
      case 'cat': {
        var hy = -u * 0.84 + drop, hr = u * 0.27;
        [-1, 1].forEach(function (s) {
          path(ctx);
          ctx.moveTo(s * hr * 0.92, hy - hr * 0.2);
          ctx.lineTo(s * hr * 0.66, hy - hr * 1.3);
          ctx.lineTo(s * hr * 0.08, hy - hr * 0.82);
          ctx.closePath();
          fill(col.fill);
        });
        path(ctx); ctx.arc(0, hy, hr, 0, TAU); fill(col.fill);
        ellipse(ctx, 0, -u * 0.37 * sq, u * 0.36, u * 0.4 * sq); fill(col.fill);
        // 꼬리
        ctx.save();
        ctx.translate(u * 0.2, -u * 0.06);
        path(ctx);
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(u * 0.3, u * 0.04, u * 0.44, -u * 0.06, u * 0.4 + sway * u * 0.12, -u * 0.36);
        tailStroke(ctx, u * 0.1, col, lw);
        ctx.restore();
        break;
      }
      case 'rabbit': {
        var ry = -u * 0.82 + drop, rr = u * 0.26;
        var droop = bow * 0.45 + Math.sin(t * 1.3 + a.phase) * 0.03;
        [-1, 1].forEach(function (s) {
          ctx.save();
          ctx.translate(s * u * 0.09, ry - rr * 0.6);
          ctx.rotate(s * (0.14 + droop));
          ellipse(ctx, 0, -u * 0.3, u * 0.085, u * 0.3);
          fill(col.fill);
          ctx.restore();
        });
        path(ctx); ctx.arc(0, ry, rr, 0, TAU); fill(col.fill);
        ellipse(ctx, 0, -u * 0.35 * sq, u * 0.4, u * 0.37 * sq); fill(col.fill);
        path(ctx); ctx.arc(sway * u * 0.02, -u * 0.14, u * 0.1, 0, TAU);
        ctx.fillStyle = '#fffaf2'; ctx.fill();
        ctx.save(); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.restore();
        break;
      }
      case 'hamster': {
        var hy2 = -u * 0.64 + drop * 0.55;
        [-1, 1].forEach(function (s) {
          path(ctx); ctx.arc(s * u * 0.19, hy2 - u * 0.24, u * 0.075, 0, TAU); fill(col.shade);
        });
        // 바깥선만 남기려고 굵게 먼저 칠하고 위에 덮어요
        ctx.save();
        ctx.lineWidth = lw * 2;
        path(ctx); ctx.arc(0, hy2, u * 0.3, 0, TAU); ctx.stroke();
        ellipse(ctx, 0, -u * 0.34 * sq, u * 0.43, u * 0.36 * sq); ctx.stroke();
        ctx.fillStyle = col.fill;
        path(ctx); ctx.arc(0, hy2, u * 0.3, 0, TAU); ctx.fill();
        ellipse(ctx, 0, -u * 0.34 * sq, u * 0.43, u * 0.36 * sq); ctx.fill();
        ctx.restore();
        break;
      }
      case 'bird': {
        path(ctx);
        ctx.moveTo(-u * 0.08, -u * 0.22);
        ctx.lineTo(sway * u * 0.03, u * 0.14);
        ctx.lineTo(u * 0.08, -u * 0.22);
        ctx.closePath();
        fill(col.shade);
        ellipse(ctx, 0, -u * 0.47 * sq, u * 0.26, u * 0.38 * sq); fill(col.fill);
        var by = -u * 0.88 + drop * 1.1;
        path(ctx); ctx.arc(0, by, u * 0.2, 0, TAU); fill(col.fill);
        path(ctx);
        ctx.moveTo(-u * 0.02, by - u * 0.19);
        ctx.quadraticCurveTo(u * 0.02, by - u * 0.36, u * 0.1, by - u * 0.3);
        ctx.stroke();
        [-1, 1].forEach(function (s) {
          ellipse(ctx, s * u * 0.16, -u * 0.46 * sq, u * 0.11, u * 0.26, s * 0.18 - s * bow * 0.2);
          fill(col.shade);
        });
        break;
      }
      default: { // dog
        var dy = -u * 0.86 + drop, dr = u * 0.3;
        path(ctx); ctx.arc(0, dy, dr, 0, TAU); fill(col.fill);
        [-1, 1].forEach(function (s) {
          ellipse(ctx, s * dr * 0.98, dy + dr * 0.18, u * 0.11, u * 0.22, -s * (0.38 + bow * 0.25));
          fill(col.shade);
        });
        ellipse(ctx, 0, -u * 0.36 * sq, u * 0.42, u * 0.38 * sq); fill(col.fill);
        ctx.save();
        ctx.translate(u * 0.16, -u * 0.1);
        ctx.rotate(sway * 0.7);
        path(ctx);
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(u * 0.3, -u * 0.02, u * 0.33, -u * 0.32);
        tailStroke(ctx, u * 0.12, col, lw);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function tailStroke(ctx, w, col, lw) {
    ctx.lineWidth = w;
    ctx.strokeStyle = col.line;
    ctx.stroke();
    ctx.lineWidth = Math.max(1, w - lw * 2);
    ctx.strokeStyle = col.fill;
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = col.line;
  }

  function drawCushion(ctx, x, y, u, mode, t) {
    var rx = u * 0.62, ry = u * 0.2;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ellipse(ctx, x, y + ry * 0.75, rx * 1.06, ry * 1.1); ctx.fill();
    ctx.globalAlpha = mode === 'empty' ? 0.78 : 1;
    ctx.fillStyle = '#6a2824';
    ellipse(ctx, x, y + ry * 0.3, rx, ry); ctx.fill();
    ctx.fillStyle = '#9a3a32';
    ellipse(ctx, x, y, rx, ry); ctx.fill();
    ctx.strokeStyle = 'rgba(255,205,150,.22)';
    ctx.lineWidth = 1;
    ellipse(ctx, x, y - ry * 0.04, rx * 0.76, ry * 0.66); ctx.stroke();
    ctx.globalAlpha = 1;
    if (mode === 'me') {
      var pulse = 0.55 + Math.sin(t * 2.4) * 0.25;
      ctx.strokeStyle = 'rgba(242,179,90,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 2;
      ellipse(ctx, x, y + ry * 0.2, rx * 1.18, ry * 1.35); ctx.stroke();
    }
  }

  // ---------- 그릇의 간식 ----------
  function drawTreatIcon(ctx, kind, x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.lineWidth = Math.max(0.8, s * 0.12);
    switch (kind) {
      case 'fish':
        ctx.fillStyle = '#9fc4d8'; ctx.strokeStyle = '#4c6b7c';
        ellipse(ctx, 0, 0, s * 0.62, s * 0.32); ctx.fill(); ctx.stroke();
        path(ctx); ctx.moveTo(s * 0.55, 0); ctx.lineTo(s * 0.95, -s * 0.3); ctx.lineTo(s * 0.95, s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'carrot':
        ctx.fillStyle = '#f08a3c'; ctx.strokeStyle = '#a3521c';
        path(ctx); ctx.moveTo(-s * 0.7, 0); ctx.lineTo(s * 0.5, -s * 0.25); ctx.lineTo(s * 0.5, s * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#6fb05a'; ctx.lineWidth = Math.max(1, s * 0.16);
        path(ctx); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.85, -s * 0.25); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.88, s * 0.18); ctx.stroke();
        break;
      case 'seed':
        ctx.fillStyle = '#e8d29a'; ctx.strokeStyle = '#8c7240';
        ellipse(ctx, 0, 0, s * 0.42, s * 0.26, 0.4); ctx.fill(); ctx.stroke();
        break;
      default:
        ctx.fillStyle = '#f3e3c3'; ctx.strokeStyle = '#a58a5a';
        path(ctx);
        ctx.rect(-s * 0.45, -s * 0.13, s * 0.9, s * 0.26);
        ctx.fill();
        [-1, 1].forEach(function (k) {
          path(ctx); ctx.arc(k * s * 0.5, -s * 0.13, s * 0.17, 0, TAU); ctx.fill(); ctx.stroke();
          path(ctx); ctx.arc(k * s * 0.5, s * 0.13, s * 0.17, 0, TAU); ctx.fill(); ctx.stroke();
        });
        ctx.fillStyle = '#f3e3c3';
        ctx.fillRect(-s * 0.48, -s * 0.11, s * 0.96, s * 0.22);
    }
    ctx.restore();
  }
  var TREAT_KINDS = ['bone', 'fish', 'carrot', 'seed', 'bone', 'fish'];

  // ---------- 효과 ----------
  function addFx(f) { f.t0 = nowMs(); scene.fx.push(f); }

  function seatPos(seat) {
    var s = scene.G && scene.G.seats[seat];
    return s || { x: scene.w / 2, y: scene.h * 0.7, u: 40 };
  }

  function peerPos(peer) {
    var s = seatPos(peer.seat);
    var x = s.x, y = s.y, u = s.u;
    if (peer.move) {
      var p = clamp((nowMs() - peer.move.t0) / 520, 0, 1);
      if (p >= 1) peer.move = null;
      else {
        var e = easeInOut(p);
        x = lerp(peer.move.x, s.x, e);
        y = lerp(peer.move.y, s.y, e) - Math.sin(Math.PI * p) * u * 0.6;
        u = lerp(peer.move.u, s.u, e);
      }
    }
    return { x: x, y: y, u: u };
  }

  // ---------- 그리기 ----------
  function draw(now) {
    var ctx = scene.ctx, G = scene.G;
    if (!G) return;
    var t = now / 1000;
    ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
    ctx.drawImage(scene.bg, 0, 0, G.W, G.H);

    // 별
    for (var i = 0; i < scene.stars.length; i++) {
      var st = scene.stars[i];
      var a = 0.35 + 0.65 * Math.abs(Math.sin(t * st.s + st.p));
      ctx.fillStyle = 'rgba(255,248,225,' + a.toFixed(3) + ')';
      ctx.fillRect(st.x - st.r / 2, st.y - st.r / 2, st.r, st.r);
    }

    // 연등 줄
    ctx.strokeStyle = 'rgba(40,24,14,.9)';
    ctx.lineWidth = 1.2;
    G.strings.forEach(function (sg) {
      ctx.beginPath();
      for (var x = sg.x0; x <= sg.x1; x += 6) {
        var y = stringY(sg, x);
        if (x === sg.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // 걸린 연등
    var dt = scene.dt || 0.016;
    ctx.font = '10px "Gowun Dodum", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var flyers = [];
    state.lanterns.forEach(function (l) {
      if (l.hidden || !l.slot) return;
      if (l.rise) {
        var p = clamp((now - l.rise.t0) / 1700, 0, 1);
        var e = easeInOut(p);
        var cxp = (l.rise.x + l.slot.x) / 2, cyp = Math.min(l.rise.y, l.slot.y) - 40;
        l.x = (1 - e) * (1 - e) * l.rise.x + 2 * (1 - e) * e * cxp + e * e * l.slot.x;
        l.y = (1 - e) * (1 - e) * l.rise.y + 2 * (1 - e) * e * cyp + e * e * l.slot.y;
        if (p >= 1) l.rise = null; else { flyers.push(l); return; }
      } else {
        var k = Math.min(1, dt * 5);
        l.x = lerp(l.x, l.slot.x, k);
        l.y = lerp(l.y, l.slot.y, k);
      }
      drawHangingLantern(ctx, l, t, true);
    });

    // 불단 위
    drawAltar(ctx, G, t, now);

    // 떠다니는 빛가루
    scene.motes.forEach(function (m) {
      var mx = m.x + Math.sin(t * 0.3 * m.s + m.p) * 18;
      var my = m.y + Math.cos(t * 0.2 * m.s + m.p) * 12;
      var ma = 0.12 + 0.18 * Math.abs(Math.sin(t * 0.8 + m.p));
      ctx.fillStyle = 'rgba(255,214,150,' + ma.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(mx, my, 1.4, 0, TAU); ctx.fill();
    });

    // 방석과 아이들
    var bySeat = {};
    state.peers.forEach(function (p) { if (!p.move) bySeat[p.seat] = p; });
    var movers = [];
    state.peers.forEach(function (p) { if (p.move) movers.push(p); });
    var rowsDone = -1;
    var drawLabel = function (p) {
      var pp = peerPos(p);
      var fs = Math.round(clamp(pp.u * 0.24, 9.5, 13));
      var me = p.id === state.myId;
      ctx.font = (me ? '700 ' : '') + fs + 'px "Gowun Dodum", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var label = fitText(ctx, p.pet.name, (seatPos(p.seat).cell || 60) - 6);
      var ly = pp.y + pp.u * 0.3;
      ctx.globalAlpha = p.fade != null ? p.fade : 1;
      ctx.fillStyle = 'rgba(10,6,16,.55)';
      ctx.fillText(label, pp.x + 0.5, ly + 1);
      ctx.fillStyle = me ? '#f6c879' : (p.pet.memorial ? 'rgba(250,246,236,.9)' : 'rgba(246,234,214,.82)');
      ctx.fillText(label, pp.x, ly);
      ctx.globalAlpha = 1;
    };
    var rowPeers = [];

    for (var si = 0; si < G.seats.length; si++) {
      var s = G.seats[si];
      var occ = bySeat[si];
      var mode = occ ? (occ.id === state.myId ? 'me' : 'taken') : 'empty';
      drawCushion(ctx, s.x, s.y, s.u, mode, t);
      if (occ) { drawPeer(ctx, occ, s.x, s.y, s.u, now, t); rowPeers.push(occ); }
      // 한 줄이 끝나면 그 줄의 이름표와 옮겨 앉는 아이를 그려요. 앞줄이 뒷줄을 자연스럽게 가려요.
      var next = G.seats[si + 1];
      if (!next || next.row !== s.row) {
        rowsDone = s.row;
        rowPeers.forEach(function (p) { if (state.peers.has(p.id)) drawLabel(p); });
        rowPeers = [];
        movers.forEach(function (p) {
          if (seatPos(p.seat).row === rowsDone) { var pp = peerPos(p); drawPeer(ctx, p, pp.x, pp.y, pp.u, now, t); drawLabel(p); }
        });
      }
    }

    // 날아오르는 연등은 아이들 위로
    flyers.forEach(function (l) { drawHangingLantern(ctx, l, t, false); });

    drawFx(ctx, now);
    ctx.drawImage(scene.vignette, 0, 0, G.W, G.H);
  }

  function drawHangingLantern(ctx, l, t, withCord) {
    var G = scene.G, r = G.lr;
    var color = lampColor(l);
    var flick = 0.85 + 0.15 * Math.sin(t * 3 + (hash(l.id) % 100));
    var sw = Math.sin(t * 1.2 + (hash(l.id) % 50)) * 0.04;
    if (withCord && l.slot && Math.abs(l.y - l.slot.y) < 2) {
      ctx.strokeStyle = 'rgba(40,24,14,.9)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.slot.x, l.slot.sy); ctx.lineTo(l.x, l.y - r * 0.7); ctx.stroke();
    }
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(sw);
    drawLotus(ctx, 0, 0, r, color, l.memorial ? 0.8 : 1, flick);
    ctx.restore();
    if (withCord && l.slot) {
      ctx.font = '10px "Gowun Dodum", sans-serif';
      ctx.fillStyle = 'rgba(246,234,214,.8)';
      ctx.fillText(fitText(ctx, l.name, l.slot.spacing - 4), l.x, l.y + r * 0.9);
    }
  }

  function drawAltar(ctx, G, t, now) {
    var aw = G.altarW, ay = G.altarTop;
    // 촛대
    [-1, 1].forEach(function (s) {
      var cx = G.cx + s * aw * 0.38, h = G.lotusR * 0.9, w = G.lotusR * 0.26;
      ctx.fillStyle = '#f2e8d6';
      ctx.fillRect(cx - w / 2, ay - h, w, h);
      var fl = 1 + Math.sin(t * 13 + s) * 0.08 + Math.sin(t * 7.3 + s * 2) * 0.06;
      var fy = ay - h - w * 0.9;
      var g = ctx.createRadialGradient(cx, fy, 0, cx, fy, w * 4);
      g.addColorStop(0, 'rgba(255,200,110,.45)');
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - w * 4, fy - w * 4, w * 8, w * 8);
      ctx.fillStyle = '#ffd28a';
      ellipse(ctx, cx, fy, w * 0.42 * fl, w * 0.95 * fl); ctx.fill();
      ctx.fillStyle = '#fff6dc';
      ellipse(ctx, cx, fy + w * 0.25, w * 0.18, w * 0.4); ctx.fill();
    });
    // 향로와 연기
    var ix = G.cx - aw * 0.2, iy = ay;
    ctx.fillStyle = '#5b4a3a';
    ellipse(ctx, ix, iy - G.lotusR * 0.18, G.lotusR * 0.34, G.lotusR * 0.2); ctx.fill();
    ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ix, iy - G.lotusR * 0.3); ctx.lineTo(ix, iy - G.lotusR * 0.9); ctx.stroke();
    ctx.fillStyle = '#ff9a5a';
    ctx.beginPath(); ctx.arc(ix, iy - G.lotusR * 0.9, 1.4, 0, TAU); ctx.fill();
    if (!scene.lastSmoke || now - scene.lastSmoke > 140) {
      scene.lastSmoke = now;
      scene.smoke.push({ x: ix, y: iy - G.lotusR * 0.95, t0: now, p: Math.random() * TAU });
      if (scene.smoke.length > 40) scene.smoke.shift();
    }
    scene.smoke.forEach(function (sm) {
      var age = (now - sm.t0) / 4200;
      if (age > 1) return;
      var sx = sm.x + Math.sin(age * 5 + sm.p) * 6 * age;
      var sy = sm.y - age * G.lotusR * 2.4;
      ctx.fillStyle = 'rgba(220,210,230,' + (0.16 * (1 - age)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, 2 + age * 6, 0, TAU); ctx.fill();
    });
    // 간식 그릇
    var bx = G.cx + aw * 0.2, by = ay;
    var bump = clamp(1 - (now - state.bowlBump) / 300, 0, 1);
    var bs = G.lotusR * 0.5 * (1 + bump * 0.12);
    var n = Math.min(state.treats, 15);
    var rand = rng(42);
    var placed = 0;
    for (var row = 0; placed < n; row++) {
      var inRow = Math.max(1, 5 - row);
      for (var k = 0; k < inRow && placed < n; k++, placed++) {
        var tx = bx + (k - (inRow - 1) / 2) * bs * 0.75;
        var ty = by - bs * 0.55 - row * bs * 0.36;
        drawTreatIcon(ctx, TREAT_KINDS[placed % TREAT_KINDS.length], tx, ty, bs * 0.7, (rand() - 0.5) * 1.2);
      }
    }
    ctx.fillStyle = '#c9a25a';
    ellipse(ctx, bx, by - bs * 0.2, bs * 1.6, bs * 0.4); ctx.fill();
    ctx.fillStyle = '#8f6b34';
    path(ctx);
    ctx.moveTo(bx - bs * 1.6, by - bs * 0.2);
    ctx.quadraticCurveTo(bx, by + bs * 0.7, bx + bs * 1.6, by - bs * 0.2);
    ctx.closePath();
    ctx.fill();
    if (state.treats > 0) {
      ctx.font = Math.round(clamp(G.lotusR * 0.42, 9, 12)) + 'px "Gowun Dodum", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(246,230,200,.75)';
      ctx.fillText('간식 ' + state.treats, bx, by + G.altarH * 0.35);
    }
    // 가운데 큰 연등
    var fl2 = 0.9 + 0.1 * Math.sin(t * 2.1);
    drawLotus(ctx, G.cx, G.lotusY, G.lotusR, '#ffcf8a', 1.1, fl2);
  }

  function drawPeer(ctx, p, x, y, u, now, t) {
    var a = p.anim;
    var bow = 0;
    if (a.bow) {
      var bp = (now - a.bow) / 1300;
      if (bp >= 1) a.bow = 0; else bow = Math.sin(Math.PI * easeInOut(bp));
    }
    var palms = 0;
    if (a.palms) {
      var pp = (now - a.palms) / 1800;
      if (pp >= 1) a.palms = 0; else palms = pp;
    }
    var wag = 0;
    if (a.wag) {
      var wp = (now - a.wag) / 1400;
      if (wp >= 1) a.wag = 0; else wag = 1 - wp;
    }
    var hop = 0;
    if (a.join) {
      var jp = (now - a.join) / 600;
      if (jp >= 1) a.join = 0; else hop = Math.sin(Math.PI * jp) * u * 0.25;
    }
    var alpha = 1;
    if (a.leave) {
      var lp = (now - a.leave) / 700;
      alpha = clamp(1 - lp, 0, 1);
      p.fade = alpha;
      if (lp >= 1) { state.peers.delete(p.id); return; }
    } else if (a.join) {
      alpha = clamp((now - a.join) / 300, 0, 1);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    drawPet(ctx, p.pet, x, y - u * 0.04 - hop, u, { time: t, phase: p.phase, bow: bow, palms: palms, wag: wag });
    ctx.restore();
  }

  function drawFx(ctx, now) {
    var keep = [];
    scene.fx.forEach(function (f) {
      var age = now - f.t0;
      var p = age / f.dur;
      if (p >= 1) { if (f.done) f.done(); return; }
      keep.push(f);
      if (f.kind === 'treat') {
        var e = easeInOut(p);
        var cx = (f.x0 + f.x1) / 2, cy = Math.min(f.y0, f.y1) - 70;
        var x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * cx + e * e * f.x1;
        var y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * cy + e * e * f.y1;
        drawTreatIcon(ctx, f.treat, x, y, f.s, p * 6);
      } else if (f.kind === 'heart') {
        var hy = f.y - p * 34;
        ctx.globalAlpha = 1 - p;
        drawHeart(ctx, f.x + Math.sin(p * 8) * 4, hy, f.s * (0.8 + p * 0.3));
        ctx.globalAlpha = 1;
      } else if (f.kind === 'spark') {
        var sx = f.x + f.vx * p, sy = f.y + f.vy * p;
        ctx.fillStyle = 'rgba(255,224,150,' + (1 - p).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(sx, sy, f.s * (1 - p * 0.5), 0, TAU); ctx.fill();
      } else if (f.kind === 'ring') {
        ctx.strokeStyle = 'rgba(255,214,150,' + (0.6 * (1 - p)).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ellipse(ctx, f.x, f.y, f.s * (0.6 + p * 0.8), f.s * 0.22 * (0.6 + p * 0.8)); ctx.stroke();
      }
    });
    scene.fx = keep;
  }

  function drawHeart(ctx, x, y, s) {
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.4, y - s * 0.85, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.4, y - s * 0.85, x + s * 0.9, y - s * 0.2, x, y + s * 0.35);
    ctx.fill();
  }

  // ---------- 매 프레임 ----------
  var lastFrame = nowMs();
  function frame(now) {
    scene.dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    draw(now);
    updateCooldownUI(now);
    requestAnimationFrame(frame);
  }

  // ---------- 아이(접속자) 관리 ----------
  function addPeer(p, quiet) {
    var existing = state.peers.get(p.id);
    var peer = existing || { id: p.id, anim: {}, phase: (hash(p.id) % 1000) / 160 };
    peer.seat = p.seat;
    peer.pet = p.pet;
    peer.move = null;
    peer.fade = null;
    peer.anim.leave = 0;
    if (!quiet) peer.anim.join = nowMs();
    state.peers.set(p.id, peer);
    updateCount();
  }
  function removePeer(id) {
    var p = state.peers.get(id);
    if (!p) return;
    p.anim.leave = nowMs();
    setTimeout(updateCount, 750);
  }
  function movePeer(id, seat) {
    var p = state.peers.get(id);
    if (!p) return;
    var from = peerPos(p);
    p.move = { x: from.x, y: from.y, u: from.u, t0: nowMs() };
    p.seat = seat;
    if (id === state.myId) { state.mySeat = seat; store.set('seat', seat); }
  }
  function playAct(id, act) {
    var p = state.peers.get(id);
    if (!p) return;
    var now = nowMs();
    var pos = peerPos(p);
    if (act === 'bow') {
      if (p.anim.bow) return;
      p.anim.bow = now;
      setTimeout(function () { addFx({ kind: 'ring', x: pos.x, y: pos.y + pos.u * 0.05, s: pos.u, dur: 900 }); }, 600);
    } else if (act === 'palms') {
      p.anim.palms = now;
      for (var i = 0; i < 6; i++) {
        addFx({ kind: 'spark', x: pos.x + (Math.random() - 0.5) * pos.u * 0.6, y: pos.y - pos.u * 0.9, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, s: 1.6 + Math.random() * 1.4, dur: 1100 + Math.random() * 600 });
      }
    } else if (act === 'tail') {
      p.anim.wag = now;
      addFx({ kind: 'heart', x: pos.x + pos.u * 0.3, y: pos.y - pos.u * 1.1, s: clamp(pos.u * 0.22, 6, 12), dur: 1300 });
    }
  }
  function playTreat(id) {
    var p = state.peers.get(id);
    if (!p || !scene.G) return;
    var pos = peerPos(p);
    var G = scene.G;
    addFx({
      kind: 'treat', treat: PS.species(p.pet.species).treat,
      x0: pos.x, y0: pos.y - pos.u * 0.9, x1: G.cx + G.altarW * 0.2, y1: G.altarTop - G.lotusR * 0.4,
      s: clamp(pos.u * 0.3, 8, 15), dur: 950,
      done: function () { state.bowlBump = nowMs(); }
    });
  }

  function updateCount() {
    var n = 0;
    state.peers.forEach(function (p) { if (!p.anim.leave) n++; });
    var pill = $('online-pill');
    if (state.mode === 'solo') {
      pill.classList.add('solo');
      $('online-n').textContent = '혼자';
      $('online-unit').textContent = '';
      pill.title = '지금은 혼자 앉아 있어요';
    } else {
      pill.classList.remove('solo');
      $('online-n').textContent = String(n);
      $('online-unit').textContent = '명';
      pill.title = '이 마루에 앉아 있는 수';
    }
  }

  // ---------- 연등 관리 ----------
  function setLanterns(list) {
    state.lanterns = (list || []).map(function (l) { return Object.assign({}, l); });
    computeSlots(true);
  }
  function addLantern(l, by) {
    if (state.lanterns.some(function (x) { return x.id === l.id; })) return;
    var item = Object.assign({}, l);
    state.lanterns.push(item);
    if (state.lanterns.length > 80) state.lanterns.shift();
    computeSlots(false);
    var p = by && state.peers.get(by);
    if (p && item.slot) {
      var pos = peerPos(p);
      item.rise = { x: pos.x, y: pos.y - pos.u * 0.9, t0: nowMs() };
      item.x = pos.x; item.y = pos.y - pos.u * 0.9;
    }
    if (by === state.myId) {
      audio.lantern(1);
      toast('‘' + l.name + '’ 연등을 달았어요. 24시간 동안 빛나요.');
    } else {
      audio.lantern(0.35);
      flashStatus('‘' + l.name + '’에게 연등이 하나 달렸어요');
    }
  }
  function hideLantern(id) {
    state.lanterns.forEach(function (l) { if (l.id === id) l.hidden = true; });
    computeSlots(false);
  }

  // ---------- 서버 연결 ----------
  function wsUrl() {
    if (CFG.ws === false) return null;
    if (typeof CFG.ws === 'string' && /^wss?:\/\//.test(CFG.ws)) return CFG.ws;
    if (!/^https?:$/.test(location.protocol)) return null;
    if (/\.github\.io$/.test(location.hostname)) return null;
    var u = new URL('ws', location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    u.hash = '';
    return u.href;
  }
  function apiUrl(p) {
    var ws = wsUrl();
    if (!ws) return null;
    var u = new URL(p, ws.replace(/^ws/, 'http').replace(/ws$/, ''));
    return u.href;
  }
  function urlRoom() {
    try { return PS.cleanRoomId(new URLSearchParams(location.search).get('room')); } catch (e) { return null; }
  }

  var net = {
    ws: null, url: null, local: false, everOpened: false, retry: 0, timer: null,
    start: function () {
      this.url = wsUrl();
      if (!this.url) { this.goSolo(); return; }
      setMode('connecting');
      this.open();
    },
    open: function () {
      var self = this;
      var ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.onClosed(); return; }
      this.ws = ws;
      var guard = setTimeout(function () { if (ws.readyState !== 1) ws.close(); }, 7000);
      ws.onopen = function () { clearTimeout(guard); self.everOpened = true; self.retry = 0; self.hello(); };
      ws.onmessage = function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        onMessage(m);
      };
      ws.onclose = function (e) {
        clearTimeout(guard);
        if (self.ws !== ws) return;
        self.ws = null;
        self.onClosed(e);
      };
      ws.onerror = function () { /* onclose 에서 처리 */ };
    },
    onClosed: function (e) {
      if (this.local) return;
      if (!this.everOpened) { this.goSolo(); return; }
      if (e && e.code === 4003) { this.goSolo(true); return; }
      setMode('reconnecting');
      var self = this;
      var delay = Math.min(15000, 800 * Math.pow(2, this.retry++));
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.open(); }, delay);
    },
    hello: function () {
      this.send({
        t: 'hello', v: 1, pet: state.pet,
        room: state.wantRoom || state.room.id || urlRoom(),
        seat: state.mySeat >= 0 ? state.mySeat : store.get('seat', undefined),
        resume: !!state.myId
      });
    },
    send: function (msg) {
      if (this.local) { localHub.handle(msg); return; }
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    },
    restart: function () {
      if (this.local) { localHub.hello(); return; }
      var ws = this.ws;
      this.ws = null;
      if (ws) ws.close();
      this.retry = 0;
      clearTimeout(this.timer);
      this.open();
    },
    goSolo: function (full) {
      this.local = true;
      setMode('solo');
      localHub.hello();
      toast(full ? '지금 모든 마루가 가득 찼어요. 잠시 혼자 앉아 있어요.' : '지금은 혼자 조용히 앉아 있어요.');
    }
  };

  // 서버 없이 쓰는 혼자 모드: 서버와 같은 메시지를 흉내 내요. 다른 사람은 만들지 않아요.
  var localHub = {
    hello: function () {
      var saved = (store.get('soloLanterns', []) || []).filter(function (l) { return Date.now() - l.ts < PS.LIMITS.lanternTtlMs; });
      store.set('soloLanterns', saved);
      var treats = store.get('soloTreats', { day: todayKey(), n: 0 });
      if (treats.day !== todayKey()) treats = { day: todayKey(), n: 0 };
      this.treats = treats.n;
      var seat = state.mySeat >= 0 ? state.mySeat : store.get('seat', -1);
      if (!(seat >= 0 && seat < 24)) seat = 14;
      onMessage({
        t: 'welcome', you: { id: 'me', seat: seat },
        room: { id: 'solo', cap: 24, public: false, treats: this.treats },
        peers: [], lanterns: saved, stats: null,
        cooldown: { lantern: PS.LIMITS.lanternCooldownMs, treat: PS.LIMITS.treatCooldownMs }
      });
    },
    handle: function (msg) {
      if (msg.t === 'sit') onMessage({ t: 'sit', id: 'me', seat: msg.seat });
      else if (msg.t === 'treat') {
        this.treats += 1;
        store.set('soloTreats', { day: todayKey(), n: this.treats });
        onMessage({ t: 'treat', id: 'me', total: this.treats });
      } else if (msg.t === 'lantern') {
        var l = {
          id: 'local-' + Date.now().toString(36), room: 'solo', name: state.pet.name, species: state.pet.species,
          color: state.pet.color, memorial: !!state.pet.memorial, wish: msg.wish, ts: Date.now()
        };
        var saved = store.get('soloLanterns', []) || [];
        saved.push(l);
        store.set('soloLanterns', saved.slice(-40));
        onMessage({ t: 'lantern', l: l, by: 'me' });
      }
    }
  };

  function onMessage(m) {
    switch (m.t) {
      case 'welcome': {
        state.myId = m.you.id;
        state.mySeat = m.you.seat;
        store.set('seat', m.you.seat);
        var capChanged = state.room.cap !== m.room.cap;
        state.room = m.room;
        state.treats = m.room.treats || 0;
        state.wantRoom = null;
        if (m.cooldown) { state.lanternCooldown = m.cooldown.lantern; state.treatCooldown = m.cooldown.treat; }
        if (m.stats) state.stats = m.stats;
        state.peers.clear();
        addPeer({ id: m.you.id, seat: m.you.seat, pet: state.pet }, false);
        (m.peers || []).forEach(function (p) { addPeer(p, true); });
        if (capChanged) computeLayout();
        setLanterns(m.lanterns);
        if (!net.local) setMode('live');
        updateRoomUI();
        if (m.notice === 'room-full') toast('그 마루는 자리가 다 찼어요. 옆 마루로 안내했어요.');
        if (state.pendingShare) { state.pendingShare = false; shareRoom(); }
        break;
      }
      case 'join': addPeer(m.p, false); break;
      case 'leave': removePeer(m.id); break;
      case 'sit': movePeer(m.id, m.seat); break;
      case 'act': playAct(m.id, m.a); break;
      case 'treat':
        state.treats = m.total;
        if (m.id !== state.myId) playTreat(m.id);
        break;
      case 'lantern': addLantern(m.l, m.by); break;
      case 'hide': hideLantern(m.id); break;
      case 'stats': state.stats = m.stats; break;
      case 'error':
        if (m.code === 'rate') {
          state.lanternReadyAt = Date.now() + (m.wait || 0);
          toast('연등은 ' + Math.ceil((m.wait || 0) / 1000) + '초 뒤에 또 달 수 있어요.');
        } else if (m.code === 'name' || m.code === 'name-empty') {
          showEntry('그 이름은 쓸 수 없어요. 다른 이름을 적어 주세요.');
        }
        break;
      default:
    }
  }

  function setMode(mode) {
    state.mode = mode;
    var line = $('status-line');
    if (mode === 'reconnecting') { line.textContent = '연결이 잠시 끊겼어요. 다시 잇는 중…'; line.hidden = false; }
    else if (mode === 'connecting') { line.textContent = '마루로 가는 중…'; line.hidden = false; }
    else line.hidden = true;
    updateCount();
  }

  var flashTimer = null;
  function flashStatus(text) {
    if (state.mode !== 'live') return;
    var line = $('status-line');
    line.textContent = text;
    line.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { if (state.mode === 'live') line.hidden = true; }, 3200);
  }

  function updateRoomUI() {
    $('room-name').textContent = net.local ? '혼자 앉은 마루' : PS.roomLabel(state.room.id);
    updateCount();
    if (!net.local && state.room.id) {
      try {
        var u = new URL(location.href);
        u.searchParams.set('room', state.room.id);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* 주소를 못 바꿔도 괜찮아요 */ }
    }
  }

  // ---------- 행동 ----------
  function act(kind) {
    if (!state.joined || !state.myId) return;
    audio.unlock();
    var now = Date.now();
    if (kind === 'bow') {
      var me = state.peers.get(state.myId);
      if (me && me.anim.bow) return;
      playAct(state.myId, 'bow');
      net.send({ t: 'act', a: 'bow' });
      vibrate(12);
      audio.bowl();
      daily.bows += 1;
      saveDaily();
      updateBowBadge();
      if (daily.bows === 108) toast('오늘 108배를 다 했어요. 고생 많았어요.');
    } else if (kind === 'palms') {
      playAct(state.myId, 'palms');
      net.send({ t: 'act', a: 'palms' });
      vibrate(8);
      audio.chime(0.5);
    } else if (kind === 'treat') {
      if (now < state.treatReadyAt) return;
      state.treatReadyAt = now + state.treatCooldown;
      playTreat(state.myId);
      net.send({ t: 'treat' });
      vibrate(8);
      audio.pop();
    } else if (kind === 'lantern') {
      if (now < state.lanternReadyAt) {
        toast('연등은 ' + Math.ceil((state.lanternReadyAt - now) / 1000) + '초 뒤에 또 달 수 있어요.');
        return;
      }
      openLanternSheet();
    } else if (kind === 'beads') {
      beads.open();
    }
  }

  function updateBowBadge() {
    var btn = document.querySelector('[data-act="bow"] span');
    btn.textContent = daily.bows > 0 ? '절 ' + daily.bows : '절하기';
  }

  function updateCooldownUI() {
    var bar = document.querySelector('[data-act="lantern"] .cool');
    if (!bar) return;
    var left = state.lanternReadyAt - Date.now();
    var v = left > 0 ? left / state.lanternCooldown : 0;
    var s = v.toFixed(3);
    if (bar.dataset.v !== s) { bar.dataset.v = s; bar.style.transform = 'scaleX(' + s + ')'; }
  }

  // ---------- 화면 누르기 ----------
  var press = null;
  scene.canvas.addEventListener('pointerdown', function (e) { press = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  scene.canvas.addEventListener('pointerup', function (e) {
    if (!press) return;
    var moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    press = null;
    if (moved > 12) return;
    tap(e.clientX, e.clientY);
  });

  function tap(x, y) {
    if (!state.joined || !scene.G) return;
    hidePop();
    // 연등
    var r = scene.G.lr;
    var hit = null;
    state.lanterns.forEach(function (l) {
      if (l.hidden || !l.slot || l.x == null) return;
      if (Math.hypot(x - l.x, y - l.y) < r * 1.6) hit = l;
    });
    if (hit) { showPop(hit); return; }
    // 방석·아이
    var best = -1, bestD = Infinity;
    scene.G.seats.forEach(function (s, i) {
      var d = Math.hypot(x - s.x, (y - (s.y - s.u * 0.35)) * 0.8);
      if (d < s.cell * 0.55 && d < bestD) { best = i; bestD = d; }
    });
    if (best < 0) return;
    var occ = null;
    state.peers.forEach(function (p) { if (p.seat === best && !p.anim.leave) occ = p; });
    if (!occ) {
      net.send({ t: 'sit', seat: best });
      vibrate(6);
    } else if (occ.id === state.myId) {
      playAct(state.myId, 'tail');
      net.send({ t: 'act', a: 'tail' });
      vibrate(6);
    } else {
      var pos = peerPos(occ);
      showPeerPop(occ, pos.x, pos.y - pos.u * 1.25);
    }
  }

  var popTimer = null;
  function placePop(pop, x, y) {
    pop.hidden = false;
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var px = clamp(x, w / 2 + 8, scene.w - w / 2 - 8);
    var py = y - h - 14;
    if (py < 70) py = y + 24;
    pop.style.left = px + 'px';
    pop.style.top = py + 'px';
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 4000);
  }
  function showPop(l) {
    var pop = $('lantern-pop');
    pop.textContent = '';
    pop.appendChild(el('b', null, l.name));
    pop.appendChild(el('span', 'w', PS.WISHES[l.wish] ? PS.WISHES[l.wish].text : ''));
    pop.appendChild(el('span', 'm', PS.species(l.species).label + ' · ' + (l.memorial ? '무지개다리' : '곁에 있는 아이') + ' · ' + timeAgo(l.ts)));
    placePop(pop, l.x, l.y);
  }
  function showPeerPop(p, x, y) {
    var pop = $('lantern-pop');
    pop.textContent = '';
    pop.appendChild(el('b', null, p.pet.name));
    pop.appendChild(el('span', 'm', PS.species(p.pet.species).label + ' · ' + (p.pet.memorial ? '무지개다리를 건넌 아이' : '곁에 있는 아이')));
    placePop(pop, x, y);
  }
  function hidePop() { $('lantern-pop').hidden = true; }

  // ---------- 시트 ----------
  var openSheetId = null;
  function openSheet(id) {
    closeSheet();
    hidePop();
    openSheetId = id;
    $('backdrop').hidden = false;
    $(id).hidden = false;
  }
  function closeSheet() {
    if (!openSheetId) return;
    $(openSheetId).hidden = true;
    $('backdrop').hidden = true;
    openSheetId = null;
  }
  $('backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!$('beads').hidden) beads.close(); else closeSheet(); }
  });

  var chosenWish = null;
  function openLanternSheet() {
    var pet = state.pet;
    $('lantern-sub').textContent = '‘' + pet.name + '’ 이름으로 ' + (pet.memorial ? '하얀 연등(영가등)' : '색 연등') + '을 달아요.';
    var box = $('wish-chips');
    box.textContent = '';
    chosenWish = null;
    $('lantern-go').disabled = true;
    PS.wishesFor(pet.memorial).forEach(function (i) {
      var b = el('button', 'chip', PS.WISHES[i].text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () {
        chosenWish = i;
        box.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === b)); });
        $('lantern-go').disabled = false;
      });
      box.appendChild(b);
    });
    openSheet('sheet-lantern');
  }
  $('lantern-go').addEventListener('click', function () {
    if (chosenWish == null) return;
    net.send({ t: 'lantern', wish: chosenWish });
    state.lanternReadyAt = Date.now() + state.lanternCooldown;
    vibrate(14);
    closeSheet();
  });

  function getJson(p) {
    var u = apiUrl(p);
    if (!u || net.local) return Promise.resolve(null);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
    return fetch(u, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(to); return v; });
  }

  function openRooms() {
    openSheet('sheet-rooms');
    var grid = $('room-grid');
    grid.textContent = '';
    $('private-room').hidden = !!net.local;
    if (net.local) {
      $('rooms-sub').textContent = '지금은 서버에 연결되지 않아 혼자 앉아 있어요. 마루를 옮길 수 없어요.';
      return;
    }
    $('rooms-sub').textContent = '불러오는 중…';
    getJson('api/stats').then(function (s) {
      if (!s) { $('rooms-sub').textContent = '마루 목록을 불러오지 못했어요.'; return; }
      $('rooms-sub').textContent = '지금 모든 마루에 ' + s.online + '명 · 오늘 연등 ' + s.today.lanterns + '개';
      var rooms = s.rooms.slice();
      var maxN = rooms.reduce(function (m, r) { return Math.max(m, parseInt(r.id.slice(5), 10)); }, 0);
      rooms.push({ id: 'maru-' + (maxN + 1), n: 0 });
      rooms.forEach(function (r) {
        var b = el('button');
        b.type = 'button';
        b.appendChild(el('span', null, PS.roomLabel(r.id)));
        b.appendChild(el('small', null, r.n + ' / ' + s.cap));
        if (r.id === state.room.id) b.setAttribute('aria-current', 'true');
        if (r.n >= s.cap && r.id !== state.room.id) b.disabled = true;
        b.addEventListener('click', function () {
          if (r.id !== state.room.id) { state.wantRoom = r.id; net.send({ t: 'room', room: r.id }); }
          closeSheet();
        });
        grid.appendChild(b);
      });
    });
  }
  $('private-room').addEventListener('click', function () {
    var id = 'home-' + Math.random().toString(36).slice(2, 8);
    state.wantRoom = id;
    state.pendingShare = true;
    net.send({ t: 'room', room: id });
    closeSheet();
  });

  function openToday() {
    openSheet('sheet-today');
    var list = $('today-list');
    list.textContent = '';
    $('today-sub').textContent = '불러오는 중…';
    var p = net.local
      ? Promise.resolve({ lanterns: (store.get('soloLanterns', []) || []).slice().reverse() })
      : getJson('api/lanterns?limit=100');
    p.then(function (d) {
      var items = (d && d.lanterns) || [];
      $('today-sub').textContent = net.local
        ? '이 기기에서 단 연등이에요.'
        : '지난 24시간 동안 모든 마루에 달린 연등 ' + items.length + '개';
      if (!items.length) { list.appendChild(el('li', 'empty', '아직 달린 연등이 없어요.')); return; }
      items.forEach(function (l) {
        var li = el('li');
        var lamp = el('span', 'lamp');
        lamp.style.color = lampColor(l);
        li.appendChild(lamp);
        var mid = el('div');
        mid.appendChild(el('div', 'who', l.name + ' · ' + PS.species(l.species).label));
        mid.appendChild(el('div', 'what', (PS.WISHES[l.wish] ? PS.WISHES[l.wish].text : '') + ' · ' + timeAgo(l.ts)));
        li.appendChild(mid);
        if (!net.local) {
          var rep = el('button', 'report', state.reported.indexOf(l.id) !== -1 ? '신고함' : '신고');
          rep.type = 'button';
          rep.disabled = state.reported.indexOf(l.id) !== -1;
          rep.addEventListener('click', function () {
            net.send({ t: 'report', id: l.id });
            state.reported.push(l.id);
            store.set('reported', state.reported.slice(-200));
            rep.textContent = '신고함';
            rep.disabled = true;
            toast('신고했어요. 여러 명이 신고하면 바로 내려가요.');
          });
          li.appendChild(rep);
        } else {
          li.appendChild(el('span'));
        }
        list.appendChild(li);
      });
    });
  }

  function shareRoom() {
    var u = new URL(location.href);
    if (!net.local && state.room.id) u.searchParams.set('room', state.room.id);
    var url = u.href;
    var name = state.pet ? PS.callName(state.pet.name) : '';
    var text = name ? name + '도 오늘 멍냥사 마루에 앉아 있어요. 같이 앉아 있다 가요.' : '멍냥사에서 같이 앉아 있다 가요.';
    if (navigator.share) {
      navigator.share({ title: PS.BRAND, text: text, url: url }).catch(function () { /* 닫음 */ });
      return;
    }
    copyText(url).then(function (ok) { toast(ok ? '링크를 복사했어요. 붙여넣어 보내 주세요.' : url); });
  }
  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  $('room-btn').addEventListener('click', openRooms);
  $('menu-btn').addEventListener('click', function () { openSheet('sheet-menu'); });
  document.querySelectorAll('[data-menu]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-menu');
      closeSheet();
      if (k === 'share') shareRoom();
      else if (k === 'today') openToday();
      else if (k === 'rooms') openRooms();
      else if (k === 'sound') openSheet('sheet-sound');
      else if (k === 'pet') showEntry();
      else if (k === 'info') openSheet('sheet-info');
    });
  });
  document.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
  });

  // ---------- 소리 (모두 이 기기에서 만들어요. 녹음 파일 없음) ----------
  var audio = {
    ctx: null, master: null, noise: null, nodes: {}, timers: {},
    on: store.get('soundOn', false),
    prefs: Object.assign({ chimes: true, rain: false, night: true, bowl: true }, store.get('soundPrefs', {})),
    unlock: function () {
      if (!this.on) return null;
      return this.ensure();
    },
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.85;
        this.master.connect(this.ctx.destination);
        var len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = this.noise.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    setOn: function (v) {
      this.on = v;
      store.set('soundOn', v);
      ['sound-btn', 'beads-sound'].forEach(function (id) {
        $(id).setAttribute('aria-pressed', String(v));
        $(id).setAttribute('aria-label', v ? '소리 끄기' : '소리 켜기');
      });
      if (!$('beads').hidden) beads.sync();
      if (v) { this.ensure(); this.applyAmbient(); } else this.stopAll();
    },
    setPref: function (k, v) {
      this.prefs[k] = v;
      store.set('soundPrefs', this.prefs);
      if (v && !this.on) { this.setOn(true); return; }
      this.applyAmbient();
    },
    stopAll: function () {
      var self = this;
      Object.keys(this.timers).forEach(function (k) { clearTimeout(self.timers[k]); });
      this.timers = {};
      Object.keys(this.nodes).forEach(function (k) { self.fadeOut(k); });
    },
    fadeOut: function (k) {
      var n = this.nodes[k];
      if (!n || !this.ctx) return;
      var t = this.ctx.currentTime;
      n.gain.gain.cancelScheduledValues(t);
      n.gain.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(function () { try { n.src.stop(); } catch (e) { /* 이미 멈춤 */ } }, 2000);
      delete this.nodes[k];
    },
    applyAmbient: function () {
      if (!this.on || !this.ensure()) return;
      var self = this, c = this.ctx;
      // 빗소리
      if (this.prefs.rain && !this.nodes.rain) {
        var src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
        var g = c.createGain(); g.gain.value = 0;
        src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(this.master);
        src.start();
        g.gain.setTargetAtTime(0.16, c.currentTime, 1.2);
        this.nodes.rain = { src: src, gain: g };
      } else if (!this.prefs.rain && this.nodes.rain) this.fadeOut('rain');
      // 풍경
      clearTimeout(this.timers.chimes);
      if (this.prefs.chimes) {
        var nextChime = function () {
          self.timers.chimes = setTimeout(function () {
            if (!self.on || !self.prefs.chimes) return;
            self.chime(0.32 + Math.random() * 0.2);
            if (Math.random() < 0.5) setTimeout(function () { self.chime(0.22); }, 180 + Math.random() * 300);
            nextChime();
          }, 4500 + Math.random() * 9000);
        };
        this.chime(0.3);
        nextChime();
      }
      // 풀벌레
      clearTimeout(this.timers.night);
      if (this.prefs.night) {
        var nextChirp = function () {
          self.timers.night = setTimeout(function () {
            if (!self.on || !self.prefs.night) return;
            self.chirp();
            nextChirp();
          }, 900 + Math.random() * 2600);
        };
        nextChirp();
      }
    },
    env: function (g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    },
    tone: function (freq, peak, decay, type, when, detune) {
      var c = this.ctx;
      var o = c.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      var g = c.createGain();
      o.connect(g); g.connect(this.master);
      var t = c.currentTime + (when || 0);
      this.env(g, t, peak, 0.006, decay);
      o.start(t); o.stop(t + decay + 0.1);
      return o;
    },
    chime: function (vol) {
      if (!this.on || !this.ensure()) return;
      var notes = [1046.5, 1174.7, 1396.9, 1568, 1760, 2093];
      var f = notes[Math.floor(Math.random() * notes.length)];
      var v = (vol || 0.4) * 0.12;
      this.tone(f, v, 3.2);
      this.tone(f * 2.76, v * 0.35, 1.6);
      this.tone(f * 5.4, v * 0.12, 0.7);
    },
    bowl: function () {
      if (!this.on || !this.prefs.bowl || !this.ensure()) return;
      var f = 196;
      this.tone(f, 0.16, 6.5, 'sine', 0, 0);
      this.tone(f, 0.12, 6.5, 'sine', 0, 9);
      this.tone(f * 2.71, 0.06, 4.5);
      this.tone(f * 5.1, 0.025, 2.4);
    },
    pop: function () {
      if (!this.on || !this.ensure()) return;
      var c = this.ctx, t = c.currentTime;
      var o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(920, t + 0.09);
      var g = c.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t, 0.14, 0.01, 0.16);
      o.start(t); o.stop(t + 0.3);
    },
    lantern: function (vol) {
      if (!this.on || !this.ensure()) return;
      var self = this;
      [1046.5, 1318.5, 1568].forEach(function (f, i) {
        self.tone(f, 0.07 * vol, 2.4, 'sine', i * 0.16);
        self.tone(f * 2.76, 0.02 * vol, 1.2, 'sine', i * 0.16);
      });
    },
    moktak: function () {
      if (!this.on || !this.ensure()) return;
      var c = this.ctx, t = c.currentTime;
      var o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.05);
      var g = c.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t, 0.5, 0.002, 0.16);
      o.start(t); o.stop(t + 0.25);
      var n = c.createBufferSource(); n.buffer = this.noise;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3;
      var g2 = c.createGain(); n.connect(bp); bp.connect(g2); g2.connect(this.master);
      this.env(g2, t, 0.25, 0.001, 0.05);
      n.start(t); n.stop(t + 0.1);
    },
    bead: function () {
      if (!this.on || !this.ensure()) return;
      var c = this.ctx, t = c.currentTime;
      var n = c.createBufferSource(); n.buffer = this.noise;
      var hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600; hp.Q.value = 6;
      var g = c.createGain(); n.connect(hp); hp.connect(g); g.connect(this.master);
      this.env(g, t, 0.35, 0.001, 0.035);
      n.start(t, Math.random()); n.stop(t + 0.06);
      this.tone(1900 + Math.random() * 200, 0.03, 0.06);
    },
    chirp: function () {
      if (!this.ctx) return;
      var c = this.ctx, base = c.currentTime;
      var f = 4200 + Math.random() * 900;
      var pulses = 2 + Math.floor(Math.random() * 3);
      for (var i = 0; i < pulses; i++) {
        var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        var g = c.createGain(); o.connect(g); g.connect(this.master);
        var t = base + i * 0.07;
        this.env(g, t, 0.012, 0.008, 0.035);
        o.start(t); o.stop(t + 0.06);
      }
    }
  };
  $('beads-sound').innerHTML = $('sound-btn').innerHTML;
  $('sound-btn').addEventListener('click', function () { audio.setOn(!audio.on); });
  $('beads-sound').addEventListener('click', function () { audio.setOn(!audio.on); });
  document.querySelectorAll('[data-sound]').forEach(function (inp) {
    var k = inp.getAttribute('data-sound');
    inp.checked = !!audio.prefs[k];
    inp.addEventListener('change', function () { audio.setPref(k, inp.checked); });
  });
  document.addEventListener('visibilitychange', function () {
    if (!audio.ctx) return;
    if (document.hidden) audio.ctx.suspend(); else if (audio.on) audio.ctx.resume();
  });

  // ---------- 염주·목탁 (나만 봐요) ----------
  var beads = {
    tool: 'beads', count: 0, steps: 0, rot: 0, rotFrom: 0, rotT0: 0, hit: 0, raf: 0,
    canvas: $('beads-canvas'),
    open: function () {
      $('beads').hidden = false;
      this.count = store.get('beadsCount', 0) % 108;
      this.steps = this.count;
      this.rot = this.count;
      this.rotFrom = this.count;
      this.resize();
      this.sync();
      var self = this;
      cancelAnimationFrame(this.raf);
      var loop = function (now) { self.draw(now); self.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    },
    close: function () {
      $('beads').hidden = true;
      cancelAnimationFrame(this.raf);
    },
    resize: function () {
      var r = this.canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.dpr = dpr;
    },
    setTool: function (tool) {
      this.tool = tool;
      document.querySelectorAll('[data-tool]').forEach(function (b) {
        b.setAttribute('aria-selected', String(b.getAttribute('data-tool') === tool));
      });
      this.sync();
    },
    sync: function () {
      if (this.tool === 'beads') {
        $('beads-n').textContent = String(this.count);
        $('beads-of').textContent = ' / 108';
        $('beads-hint').textContent = audio.on ? '아무 데나 누르면 한 알씩 넘어가요' : '아무 데나 누르면 한 알씩 넘어가요 · 소리는 꺼져 있어요';
      } else {
        $('beads-n').textContent = String(daily.moktak);
        $('beads-of').textContent = ' 번';
        $('beads-hint').textContent = audio.on ? '목탁을 두드려요. 나한테만 들려요' : '소리를 켜면 목탁 소리가 나요 (오른쪽 위 스피커)';
      }
      $('beads-total').textContent = '오늘 염주 ' + daily.rounds + '바퀴 ' + (daily.beads % 108) + '알 · 목탁 ' + daily.moktak + '번 · 절 ' + daily.bows + '번';
    },
    tap: function () {
      this.hit = nowMs();
      if (this.tool === 'beads') {
        this.rotFrom = this.rot;
        this.rotT0 = nowMs();
        this.steps += 1;
        this.count += 1;
        daily.beads += 1;
        audio.bead();
        vibrate(6);
        if (this.count >= 108) {
          this.count = 0;
          daily.rounds += 1;
          audio.bowl();
          vibrate([20, 60, 20]);
          toast('염주 한 바퀴(108알)를 다 돌았어요.');
        }
        store.set('beadsCount', this.count);
      } else {
        daily.moktak += 1;
        audio.moktak();
        vibrate(10);
      }
      saveDaily();
      this.sync();
    },
    draw: function (now) {
      var c = this.canvas.getContext('2d');
      var w = this.w, h = this.h;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2;
      var R = Math.min(w, h) * 0.36;
      if (this.tool === 'beads') {
        var p = clamp((now - this.rotT0) / 220, 0, 1);
        this.rot = lerp(this.rotFrom, this.steps, easeOut(p));
        var N = 27, br = R * 0.105;
        var off = ((this.rot % N) / N) * TAU;
        c.strokeStyle = 'rgba(200,150,90,.5)';
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
        for (var i = 0; i < N; i++) {
          var a = Math.PI / 2 + (i / N) * TAU + off;
          var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
          var g = c.createRadialGradient(x - br * 0.35, y - br * 0.35, br * 0.1, x, y, br);
          g.addColorStop(0, '#c98f5a');
          g.addColorStop(0.6, '#8a5530');
          g.addColorStop(1, '#4e2c16');
          c.fillStyle = g;
          c.beginPath(); c.arc(x, y, br, 0, TAU); c.fill();
        }
        // 모주(큰 알)와 술
        var gx = cx, gy = cy + R + br * 0.4;
        c.fillStyle = '#b7894a';
        c.beginPath(); c.arc(gx, gy, br * 1.35, 0, TAU); c.fill();
        c.strokeStyle = '#c94c3c';
        c.lineWidth = 2;
        for (var k = -3; k <= 3; k++) {
          c.beginPath(); c.moveTo(gx, gy + br * 1.2); c.lineTo(gx + k * br * 0.25, gy + br * 4); c.stroke();
        }
        var pulse = clamp(1 - (now - this.hit) / 400, 0, 1);
        if (pulse > 0) {
          c.strokeStyle = 'rgba(255,214,150,' + (pulse * 0.6).toFixed(3) + ')';
          c.lineWidth = 3;
          c.beginPath(); c.arc(cx, cy, R + br * 1.6 + (1 - pulse) * 20, 0, TAU); c.stroke();
        }
      } else {
        var q = clamp((now - this.hit) / 180, 0, 1);
        var squash = 1 - Math.sin(Math.PI * q) * 0.06;
        var mw = R * 1.1, mh = R * 0.85 * squash;
        c.save();
        c.translate(cx, cy + R * 0.15);
        var mg = c.createRadialGradient(-mw * 0.3, -mh * 0.4, mw * 0.1, 0, 0, mw * 1.1);
        mg.addColorStop(0, '#d79a52');
        mg.addColorStop(0.7, '#9a5a28');
        mg.addColorStop(1, '#5a3014');
        c.fillStyle = mg;
        c.beginPath(); c.ellipse(0, 0, mw, mh, 0, 0, TAU); c.fill();
        c.fillStyle = '#2a1408';
        c.beginPath(); c.ellipse(0, mh * 0.18, mw * 0.72, mh * 0.08, 0, 0, Math.PI); c.fill();
        c.fillStyle = '#3a1c0a';
        c.beginPath(); c.arc(-mw * 0.62, -mh * 0.12, mw * 0.06, 0, TAU); c.fill();
        c.beginPath(); c.arc(mw * 0.62, -mh * 0.12, mw * 0.06, 0, TAU); c.fill();
        c.restore();
        var sa = -0.9 + Math.sin(Math.PI * q) * 0.45;
        c.save();
        c.translate(cx + R * 0.95, cy - R * 0.85);
        c.rotate(sa);
        c.fillStyle = '#c99a5e';
        c.fillRect(-R * 0.04, 0, R * 0.08, R * 0.9);
        c.beginPath(); c.arc(0, R * 0.92, R * 0.1, 0, TAU); c.fill();
        c.restore();
      }
    }
  };
  $('beads').addEventListener('pointerdown', function (e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    audio.unlock();
    beads.tap();
  });
  $('beads-close').addEventListener('click', function () { beads.close(); });
  document.querySelectorAll('[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { beads.setTool(b.getAttribute('data-tool')); });
  });

  // ---------- 알림 ----------
  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ---------- 들어가기 화면 ----------
  var preview = $('preview');
  function buildEntry() {
    var chips = $('species-chips');
    PS.SPECIES.forEach(function (s) {
      var b = el('button', 'chip', s.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.id = s.id;
      b.addEventListener('click', function () { draft.species = s.id; syncEntry(); });
      chips.appendChild(b);
    });
    var sw = $('color-swatches');
    PS.COLORS.forEach(function (c) {
      var b = el('button', 'swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
      b.dataset.id = c.id;
      b.style.background = c.fill;
      b.addEventListener('click', function () { draft.color = c.id; syncEntry(); });
      sw.appendChild(b);
    });
    document.querySelectorAll('#memorial-seg button').forEach(function (b) {
      b.addEventListener('click', function () { draft.memorial = b.dataset.m === '1'; syncEntry(); });
    });
    $('pet-name').value = draft.name;
    $('pet-name').addEventListener('input', function () { draft.name = this.value; $('entry-err').hidden = true; });
    $('entry-form').addEventListener('submit', function (e) { e.preventDefault(); enter(); });
    syncEntry();
  }
  function syncEntry() {
    document.querySelectorAll('#species-chips .chip').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.id === draft.species)); });
    document.querySelectorAll('#color-swatches .swatch').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.id === draft.color)); });
    document.querySelectorAll('#memorial-seg button').forEach(function (b) { b.setAttribute('aria-checked', String((b.dataset.m === '1') === draft.memorial)); });
    $('memorial-note').textContent = draft.memorial
      ? '하얀 연등(영가등)을 달고, 같이 앉아 기억해요.'
      : '색 연등을 달고 건강을 빌어요.';
  }
  var previewWag = 0;
  preview.addEventListener('pointerdown', function () { previewWag = nowMs(); });
  function drawPreview(now) {
    if ($('entry').hidden) return;
    var c = preview.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (preview.width !== 160 * dpr) { preview.width = 160 * dpr; preview.height = 150 * dpr; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, 160, 150);
    var g = c.createRadialGradient(80, 80, 4, 80, 80, 78);
    g.addColorStop(0, 'rgba(255,190,110,.32)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 160, 150);
    var u = 70;
    drawCushion(c, 80, 122, u, 'taken', now / 1000);
    var wag = previewWag ? clamp(1 - (now - previewWag) / 1400, 0, 1) : 0;
    drawPet(c, { species: draft.species, color: draft.color, memorial: draft.memorial }, 80, 120, u, { time: now / 1000, phase: 0, bow: 0, palms: 0, wag: wag });
  }
  (function previewLoop(now) { drawPreview(now || 0); requestAnimationFrame(previewLoop); })();

  function showEntry(err) {
    closeSheet();
    $('entry').hidden = false;
    $('entry-err').hidden = !err;
    if (err) $('entry-err').textContent = err;
    $('enter-btn').textContent = state.joined ? '이 모습으로 다시 앉기' : '조용히 들어가기';
  }

  function enter() {
    var check = PS.cleanName(draft.name);
    if (!check.ok) {
      var msg = check.reason === 'empty' ? '아이 이름을 적어 주세요.'
        : check.reason === 'chars' ? '이름에는 한글, 영문, 숫자만 쓸 수 있어요.'
          : '그 이름은 쓸 수 없어요. 다른 이름을 적어 주세요.';
      $('entry-err').textContent = msg;
      $('entry-err').hidden = false;
      $('pet-name').focus();
      return;
    }
    state.pet = { name: check.name, species: draft.species, color: draft.color, memorial: draft.memorial };
    store.set('pet', state.pet);
    $('entry').hidden = true;
    $('topbar').hidden = false;
    $('actions').hidden = false;
    audio.setOn(audio.on);
    if (document.activeElement) document.activeElement.blur();
    computeLayout();
    if (state.joined) { net.restart(); return; }
    state.joined = true;
    updateBowBadge();
    net.start();
  }

  function loadLiveCount() {
    getJson('api/stats').then(function (s) {
      if (!s || $('entry').hidden) return;
      if (s.online > 0) {
        $('live-n').textContent = String(s.online);
        $('live-count').hidden = false;
      }
    });
  }

  // ---------- 시작 ----------
  window.addEventListener('resize', function () {
    resize();
    if (!$('beads').hidden) beads.resize();
  });
  buildEntry();
  resize();
  ['sound-btn', 'beads-sound'].forEach(function (id) { $(id).setAttribute('aria-pressed', String(audio.on)); });
  loadLiveCount();
  requestAnimationFrame(frame);
}());
