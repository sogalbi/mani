/* 꼬리별 추모관 화면. 캔버스에 추모관과 걸어 다니는 아이들을 그리고, 서버(또는 혼자 모드)와 주고받아요. */
(function () {
  'use strict';

  var PS = window.PS;
  var CFG = Object.assign({ ws: 'auto' }, window.PETSPACE_CONFIG || {});
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;

  // ---------- 작은 도구 ----------
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('kkb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('kkb:' + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
  };
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
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
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function nowMs() { return performance.now(); }
  function objJosa(name) { return name + (PS.hasBatchim(name) ? '을' : '를'); }
  function years(t) {
    if (t.since && t.until) return t.since + ' – ' + t.until;
    if (t.since) return t.since + '년부터';
    if (t.until) return t.until + '년까지';
    return '';
  }
  function subline(t) {
    var y = years(t);
    return PS.species(t.species).label + (y ? ' · ' + y : '');
  }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var f = function (c) { return Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt); };
    return 'rgb(' + f(n >> 16 & 255) + ',' + f(n >> 8 & 255) + ',' + f(n & 255) + ')';
  }

  // ---------- 상태 ----------
  var state = {
    pet: store.get('pet', null),
    mine: null,                 // { tid, token } 내 추모 카드
    joined: false,
    mode: 'idle',               // live | solo | connecting | reconnecting
    myId: null,
    room: { id: null, cap: 30, public: true, flowers: 0 },
    peers: new Map(),
    tributes: [],               // 이 추모실 화면에 도는 아이들 (오래된 것부터)
    spot: null,                 // { tid, at } 서버 시각
    clockOffset: 0,
    flowersTotal: 0,
    wantRoom: null,
    pendingTribute: null,
    pendingFlower: null,
    welcomed: false,
    reported: store.get('reported', []),
    readyAt: { say: 0, flower: 0, spot: 0 }
  };

  var thisYear = new Date().getFullYear();
  var draft = {
    name: state.pet ? state.pet.name : '',
    species: state.pet ? state.pet.species : 'dog',
    color: state.pet ? state.pet.color : 'cream',
    msgIdx: 0,
    custom: '',
    since: '',
    until: '',
    photo: null
  };

  // ---------- 장면 배치 ----------
  var scene = {
    canvas: $('scene'), ctx: null, w: 0, h: 0, dpr: 1, bg: null, G: null,
    fx: [], floaters: [], smoke: [], marker: null,
    slide: null, prevSlide: null, slideAt: 0
  };
  scene.ctx = scene.canvas.getContext('2d');

  function computeLayout() {
    var W = scene.w, H = scene.h;
    var tb = $('topbar'), ab = $('actions');
    var top = tb.hidden ? 60 : tb.getBoundingClientRect().bottom - 2;
    var bottom = ab.hidden ? H - 96 : ab.getBoundingClientRect().top + 2;
    var midH = Math.max(300, bottom - top);
    var cx = W / 2;
    var span = Math.min(W, 860);
    var left = cx - span / 2, right = cx + span / 2;
    var floorY = Math.round(top + midH * 0.46);
    var wallH = floorY - top;

    var sw = Math.min(span * 0.74, 560), sh = sw * 0.6;
    var maxSh = wallH * 0.64;
    if (sh > maxSh) { sh = maxSh; sw = sh / 0.6; }
    var sx = cx - sw / 2, sy = top + Math.max(10, wallH * 0.07);
    var bez = Math.max(4, sw * 0.018);
    var ft = clamp(sw * 0.07, 12, 30);

    var floorH = bottom - floorY;
    var tw = Math.min(sw * 0.8, 400), th = clamp(floorH * 0.045, 9, 16);
    var ty = floorY + clamp(floorH * 0.09, 16, 46);
    var walk = {
      x0: left + span * 0.06, x1: right - span * 0.06,
      y0: ty + th + clamp(floorH * 0.13, 22, 54), y1: bottom - clamp(floorH * 0.06, 14, 30)
    };

    // 기억의 벽 액자 (화면 양옆에 자리가 있을 때만)
    var frames = [];
    var sideW = (sx - ft * 1.4) - (left + span * 0.04) - 10;
    if (sideW >= 46) {
      var f = clamp(sideW * 0.42, 34, 66), fh = f * 1.22, gap = 14;
      var cols = Math.max(1, Math.floor((sideW + gap) / (f + gap)));
      var rows = Math.max(1, Math.floor((floorY - wallH * 0.2 - (top + 12)) / (fh + gap)));
      var slots = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          [-1, 1].forEach(function (side) {
            var x = side < 0 ? sx - ft * 1.4 - 10 - f - c * (f + gap) : sx + sw + ft * 1.4 + 10 + c * (f + gap);
            slots.push({ x: x, y: top + 14 + r * (fh + gap), w: f, h: fh, order: r * 10 + c });
          });
        }
      }
      frames = slots.sort(function (a, b) { return a.order - b.order; });
    }

    scene.G = {
      W: W, H: H, top: top, bottom: bottom, cx: cx, span: span, left: left, right: right, floorY: floorY, wallH: wallH,
      screen: { x: sx, y: sy, w: sw, h: sh, ix: sx + bez, iy: sy + bez, iw: sw - bez * 2, ih: sh - bez * 2 },
      ft: ft,
      table: { x: cx - tw / 2, y: ty, w: tw, h: th },
      walk: walk,
      u0: clamp(span * 0.105, 30, 56),
      frames: frames
    };
    paintBackground();
  }

  function resize() {
    scene.dpr = Math.min(window.devicePixelRatio || 1, 2);
    scene.w = window.innerWidth;
    scene.h = window.innerHeight;
    scene.canvas.width = Math.round(scene.w * scene.dpr);
    scene.canvas.height = Math.round(scene.h * scene.dpr);
    computeLayout();
  }

  function toPx(nx, ny) {
    var w = scene.G.walk;
    return { x: w.x0 + nx * (w.x1 - w.x0), y: w.y0 + ny * (w.y1 - w.y0) };
  }
  function toNorm(x, y) {
    var w = scene.G.walk;
    return { x: clamp((x - w.x0) / (w.x1 - w.x0), 0, 1), y: clamp((y - w.y0) / (w.y1 - w.y0), 0, 1) };
  }
  function unitAt(ny) { return scene.G.u0 * lerp(0.8, 1.05, ny); }

  // ---------- 그리기 도구 ----------
  function ellipse(x, cx, cy, rx, ry, rot) {
    x.beginPath();
    x.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU);
  }
  function roundRect(x, rx, ry, w, h, r) {
    x.beginPath();
    x.moveTo(rx + r, ry);
    x.arcTo(rx + w, ry, rx + w, ry + h, r);
    x.arcTo(rx + w, ry + h, rx, ry + h, r);
    x.arcTo(rx, ry + h, rx, ry, r);
    x.arcTo(rx, ry, rx + w, ry, r);
    x.closePath();
  }
  function offscreen(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.round(w * scene.dpr);
    c.height = Math.round(h * scene.dpr);
    var x = c.getContext('2d');
    x.scale(scene.dpr, scene.dpr);
    return { c: c, x: x };
  }
  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var chars = Array.from(text);
    while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
    return chars.join('') + '…';
  }
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = text.split(' ');
    var lines = [];
    var cur = '';
    words.forEach(function (w) {
      var tryLine = cur ? cur + ' ' + w : w;
      if (ctx.measureText(tryLine).width <= maxW) { cur = tryLine; return; }
      if (cur) lines.push(cur);
      cur = w;
      while (ctx.measureText(cur).width > maxW && cur.length > 1) {
        var chars = Array.from(cur), head = '';
        while (chars.length && ctx.measureText(head + chars[0]).width <= maxW) head += chars.shift();
        lines.push(head);
        cur = chars.join('');
      }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = fitText(ctx, lines[maxLines - 1] + '…', maxW);
    }
    return lines;
  }

  // 국화 한 송이 (위에서 본 모양)
  function drawMum(x, cx, cy, r, tone) {
    var petal = tone || '#fbfaf6';
    var edge = 'rgba(150,140,120,.45)';
    for (var layer = 0; layer < 2; layer++) {
      var rr = layer ? r * 0.62 : r;
      var n = layer ? 10 : 14;
      for (var k = 0; k < n; k++) {
        var a = (k / n) * TAU + layer * 0.2;
        x.save();
        x.translate(cx + Math.cos(a) * rr * 0.45, cy + Math.sin(a) * rr * 0.45);
        x.rotate(a + Math.PI / 2);
        ellipse(x, 0, 0, rr * 0.17, rr * 0.5);
        x.fillStyle = layer ? shade(petal, -0.04) : petal;
        x.fill();
        x.strokeStyle = edge;
        x.lineWidth = 0.6;
        x.stroke();
        x.restore();
      }
    }
    x.fillStyle = '#efe0a8';
    x.beginPath(); x.arc(cx, cy, r * 0.2, 0, TAU); x.fill();
  }

  // 옆으로 누운 국화 (헌화대 위)
  function drawLyingMum(x, cx, cy, s, rot) {
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.strokeStyle = '#5f7f52';
    x.lineWidth = Math.max(1, s * 0.12);
    x.beginPath(); x.moveTo(-s * 1.6, s * 0.1); x.lineTo(-s * 0.3, 0); x.stroke();
    x.fillStyle = '#6f8f62';
    ellipse(x, -s * 1.0, -s * 0.12, s * 0.35, s * 0.14, -0.4); x.fill();
    drawMum(x, 0, 0, s * 0.62);
    x.restore();
  }

  // ---------- 배경 (크기가 바뀔 때만 다시 그려요) ----------
  function paintBackground() {
    var G = scene.G, W = G.W, H = G.H, S = G.screen;
    var o = offscreen(W, H), x = o.x;

    // 벽
    var g = x.createLinearGradient(0, 0, 0, G.floorY);
    g.addColorStop(0, '#e9dfd2');
    g.addColorStop(0.35, '#f3ece2');
    g.addColorStop(1, '#ece2d4');
    x.fillStyle = g;
    x.fillRect(0, 0, W, G.floorY + 2);
    x.strokeStyle = 'rgba(120,95,70,.07)';
    x.lineWidth = 1;
    for (var px = G.left + 40; px < G.right; px += 80) {
      x.beginPath(); x.moveTo(Math.round(px) + 0.5, 0); x.lineTo(Math.round(px) + 0.5, G.floorY); x.stroke();
    }
    // 천장 조명
    [G.cx].concat(G.frames.length ? [G.left + G.span * 0.14, G.right - G.span * 0.14] : []).forEach(function (lx, i) {
      var lr = i === 0 ? S.w * 0.95 : G.span * 0.2;
      var lg = x.createRadialGradient(lx, G.top - 10, 0, lx, G.top - 10, lr);
      lg.addColorStop(0, 'rgba(255,246,228,.85)');
      lg.addColorStop(1, 'rgba(255,246,228,0)');
      x.fillStyle = lg;
      x.fillRect(lx - lr, G.top - 10 - lr, lr * 2, lr * 2);
    });
    var cg = x.createLinearGradient(0, 0, 0, G.top + 16);
    cg.addColorStop(0, 'rgba(120,96,72,.18)');
    cg.addColorStop(1, 'rgba(120,96,72,0)');
    x.fillStyle = cg;
    x.fillRect(0, 0, W, G.top + 16);

    // 아래 벽 나무판
    var wy = G.floorY - G.wallH * 0.14;
    x.fillStyle = '#b8936d';
    x.fillRect(0, wy, W, G.floorY - wy);
    x.fillStyle = '#8f6c4c';
    x.fillRect(0, wy - 3, W, 4);
    x.strokeStyle = 'rgba(80,55,35,.25)';
    for (var wx = G.left + 30; wx < G.right; wx += 70) {
      x.strokeRect(Math.round(wx) + 0.5, wy + 5.5, 56, G.floorY - wy - 11);
    }

    // 바닥
    var fg = x.createLinearGradient(0, G.floorY, 0, H);
    fg.addColorStop(0, '#d2b18a');
    fg.addColorStop(1, '#c39d74');
    x.fillStyle = fg;
    x.fillRect(0, G.floorY, W, H - G.floorY);
    var rand = rng(5);
    var rows = 16;
    for (var k = 0; k <= rows; k++) {
      var y0 = G.floorY + (H - G.floorY) * Math.pow(k / rows, 1.35);
      var y1 = G.floorY + (H - G.floorY) * Math.pow((k + 1) / rows, 1.35);
      x.strokeStyle = 'rgba(110,75,45,.22)';
      x.beginPath(); x.moveTo(0, Math.round(y0) + 0.5); x.lineTo(W, Math.round(y0) + 0.5); x.stroke();
      var plank = 90 + k * 14;
      for (var bx = -rand() * plank; bx < W; bx += plank) {
        x.strokeStyle = 'rgba(110,75,45,.14)';
        x.beginPath(); x.moveTo(Math.round(bx) + 0.5, y0); x.lineTo(Math.round(bx) + 0.5, y1); x.stroke();
      }
    }
    x.fillStyle = '#6f4f36';
    x.fillRect(0, G.floorY - 2, W, 5);

    // 화면 뒤 빛
    var sg = x.createRadialGradient(G.cx, S.y + S.h / 2, S.h * 0.3, G.cx, S.y + S.h / 2, S.w * 0.85);
    sg.addColorStop(0, 'rgba(255,255,255,.55)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sg;
    x.fillRect(G.cx - S.w, S.y - S.w * 0.4, S.w * 2, S.w * 1.4);

    // 국화 제단: 화면을 감싸는 아치 + 아래 단
    var ft = G.ft;
    var mums = [];
    var R = rng(19);
    var baseY = S.y + S.h + ft * 0.35;
    var addMum = function (mx, my, r) {
      var roll = R();
      mums.push({ x: mx + (R() - 0.5) * r * 0.5, y: my + (R() - 0.5) * r * 0.5, r: r * (0.85 + R() * 0.3), tone: roll < 0.1 ? '#f5e7aa' : roll < 0.15 ? '#e2ecc8' : null });
    };
    var mr = ft * 0.62;
    for (var yy = S.y + S.h * 0.18; yy <= baseY; yy += mr * 1.25) {
      addMum(S.x - ft * 0.55, yy, mr);
      addMum(S.x + S.w + ft * 0.55, yy, mr);
    }
    var tiers = clamp(Math.floor((G.floorY - baseY) / (mr * 1.5)), 1, 4);
    for (var ti = 0; ti < tiers; ti++) {
      var half = S.w / 2 + ft * (0.6 + ti * 0.9);
      var ry = baseY + ti * mr * 1.45;
      var r2 = mr * (1 + ti * 0.12);
      for (var mx = G.cx - half; mx <= G.cx + half + 1; mx += r2 * 1.3) addMum(mx, ry, r2);
    }
    mums.forEach(function (m) {
      x.fillStyle = R() < 0.5 ? '#6f8f62' : '#7f9d6f';
      ellipse(x, m.x + (R() - 0.5) * m.r, m.y + m.r * 0.5, m.r * 0.55, m.r * 0.22, (R() - 0.5) * 1.4);
      x.fill();
    });
    mums.sort(function (a, b) { return a.y - b.y; }).forEach(function (m) { drawMum(x, m.x, m.y, m.r, m.tone); });

    // 화면 틀
    x.fillStyle = 'rgba(40,28,18,.25)';
    roundRect(x, S.x + 2, S.y + 6, S.w, S.h, 8); x.fill();
    x.fillStyle = '#1d1b1c';
    roundRect(x, S.x, S.y, S.w, S.h, 8); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.12)';
    x.lineWidth = 1;
    roundRect(x, S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1, 8); x.stroke();

    // 기억의 벽 액자 틀
    G.frames.forEach(function (f) {
      x.fillStyle = 'rgba(60,40,20,.18)';
      x.fillRect(f.x + 2, f.y + 4, f.w, f.h);
      x.fillStyle = '#8a6748';
      x.fillRect(f.x, f.y, f.w, f.h);
      x.fillStyle = '#fbf8f2';
      x.fillRect(f.x + 3, f.y + 3, f.w - 6, f.h - 6);
    });

    // 헌화대
    var T = G.table;
    x.fillStyle = 'rgba(70,45,25,.18)';
    ellipse(x, G.cx, T.y + T.h + T.h * 1.6, T.w * 0.56, T.h * 0.9); x.fill();
    x.fillStyle = '#fbf9f4';
    x.fillRect(T.x, T.y, T.w, T.h * 2.4);
    x.fillStyle = '#ffffff';
    x.fillRect(T.x - 3, T.y - 3, T.w + 6, 5);
    x.strokeStyle = 'rgba(150,135,115,.25)';
    for (var fx = T.x + 14; fx < T.x + T.w - 6; fx += 22) {
      x.beginPath(); x.moveTo(fx, T.y + 4); x.lineTo(fx - 3, T.y + T.h * 2.4); x.stroke();
    }
    // 향로
    x.fillStyle = '#7d6a55';
    ellipse(x, G.cx, T.y - T.h * 0.25, T.h * 0.9, T.h * 0.45); x.fill();
    x.fillStyle = '#5e4f40';
    ellipse(x, G.cx, T.y - T.h * 0.45, T.h * 0.8, T.h * 0.25); x.fill();
    // 촛대
    [-1, 1].forEach(function (s) {
      var cxp = G.cx + s * T.w * 0.42, ch = T.h * 2.2, cw = T.h * 0.55;
      x.fillStyle = '#c9a75c';
      x.fillRect(cxp - cw, T.y - 3, cw * 2, 3);
      x.fillStyle = '#fffdf6';
      x.fillRect(cxp - cw / 2, T.y - 3 - ch, cw, ch);
    });
    scene.bg = o.c;
  }

  // ---------- 사진 불러오기 ----------
  var imgCache = new Map();
  function photoUrl(t) {
    if (!t) return null;
    if (t.photoUrl) return t.photoUrl;
    if (!t.photo) return null;
    return apiUrl('photos/' + t.photo + '.jpg') || ('photos/' + t.photo + '.jpg');
  }
  function getImg(t) {
    var url = photoUrl(t);
    if (!url) return null;
    var c = imgCache.get(url);
    if (!c) {
      c = { img: new Image(), ok: false };
      c.img.onload = function () { c.ok = true; };
      c.img.src = url;
      imgCache.set(url, c);
      if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
    }
    return c.ok ? c.img : null;
  }
  function drawCover(ctx, img, x, y, w, h) {
    var s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // ---------- 큰 화면 ----------
  function serverNow() { return Date.now() + state.clockOffset; }
  function findTribute(tid) {
    for (var i = 0; i < state.tributes.length; i++) if (state.tributes[i].id === tid) return state.tributes[i];
    return null;
  }
  function currentSlide() {
    var now = serverNow();
    if (state.spot && now - state.spot.at < PS.LIMITS.spotMs) {
      var t = findTribute(state.spot.tid);
      if (t) return { t: t, kind: 'spot', start: state.spot.at, dur: PS.LIMITS.spotMs };
    }
    var list = state.tributes;
    if (!list.length) return null;
    var k = Math.floor(now / PS.LIMITS.slideMs);
    return { t: list[k % list.length], kind: 'cycle', start: k * PS.LIMITS.slideMs, dur: PS.LIMITS.slideMs };
  }

  function drawScreen(ctx, now, t) {
    var S = scene.G.screen;
    var cur = currentSlide();
    var curId = cur ? cur.t.id + cur.kind : null;
    var shownId = scene.slide ? scene.slide.t.id + scene.slide.kind : null;
    if (curId !== shownId) { scene.prevSlide = scene.slide; scene.slide = cur; scene.slideAt = now; }
    else if (cur) scene.slide = cur;
    ctx.save();
    roundRect(ctx, S.ix, S.iy, S.iw, S.ih, 4);
    ctx.clip();
    ctx.fillStyle = '#141213';
    ctx.fillRect(S.ix, S.iy, S.iw, S.ih);
    // 앞 화면이 어두워졌다가 다음 화면이 밝아져요 (글자가 겹치지 않게)
    var p = clamp((now - scene.slideAt) / 900, 0, 1);
    if (p < 0.5) {
      drawSlide(ctx, scene.prevSlide, t);
      ctx.fillStyle = 'rgba(20,18,19,' + (p * 2).toFixed(3) + ')';
      ctx.fillRect(S.ix, S.iy, S.iw, S.ih);
    } else {
      drawSlide(ctx, scene.slide, t);
      if (p < 1) {
        ctx.fillStyle = 'rgba(20,18,19,' + (1 - (p - 0.5) * 2).toFixed(3) + ')';
        ctx.fillRect(S.ix, S.iy, S.iw, S.ih);
      }
    }
    // 떠오르는 한마디
    var fs = Math.round(clamp(S.ih * 0.1, 11, 20));
    var photoW = scene.slide && S.iw / S.ih > 1.25 ? Math.min(S.ih, S.iw * 0.52) : S.iw;
    ctx.font = fs + 'px "Gowun Batang", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    scene.floaters = scene.floaters.filter(function (f) {
      var fp = (now - f.t0) / 2800;
      if (fp >= 1) return false;
      var fy = lerp(S.iy + S.ih * 0.86, S.iy + S.ih * 0.2, fp);
      var fx = S.ix + photoW * (0.2 + f.x * 0.6);
      ctx.globalAlpha = fp < 0.15 ? fp / 0.15 : 1 - Math.max(0, (fp - 0.6) / 0.4);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText(f.text, fx + 1, fy + 1);
      ctx.fillStyle = '#fffaf0';
      ctx.fillText(f.text, fx, fy);
      return true;
    });
    ctx.globalAlpha = 1;
    var gl = ctx.createLinearGradient(S.ix, S.iy, S.ix + S.iw * 0.6, S.iy + S.ih);
    gl.addColorStop(0, 'rgba(255,255,255,.08)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(S.ix, S.iy, S.iw, S.ih);
    ctx.restore();
  }

  function drawSlide(ctx, slide, t) {
    var S = scene.G.screen;
    var ix = S.ix, iy = S.iy, iw = S.iw, ih = S.ih;
    if (!slide) {
      var eg = ctx.createLinearGradient(ix, iy, ix, iy + ih);
      eg.addColorStop(0, '#2b2a33');
      eg.addColorStop(1, '#1a1a20');
      ctx.fillStyle = eg;
      ctx.fillRect(ix, iy, iw, ih);
      for (var i = 0; i < 18; i++) {
        var sx = ix + ((i * 97) % 100) / 100 * iw, sy = iy + ((i * 53) % 100) / 100 * ih * 0.7;
        ctx.fillStyle = 'rgba(255,248,225,' + (0.25 + 0.5 * Math.abs(Math.sin(t + i))).toFixed(3) + ')';
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f5ecdc';
      ctx.font = '700 ' + Math.round(clamp(ih * 0.14, 14, 30)) + 'px "Gowun Batang", serif';
      ctx.fillText('꼬리별 추모관', ix + iw / 2, iy + ih * 0.42);
      ctx.fillStyle = 'rgba(245,236,220,.7)';
      ctx.font = Math.round(clamp(ih * 0.075, 10, 15)) + 'px "Gowun Dodum", sans-serif';
      ctx.fillText(fitText(ctx, '사진을 올리면 이 화면에서 우리 아이를 소개해요', iw - 20), ix + iw / 2, iy + ih * 0.62);
      return;
    }
    var tr = slide.t;
    var land = iw / ih > 1.25;
    var pw, ph, px = ix, py = iy;
    if (land) { ph = ih; pw = Math.min(ih, iw * 0.52); } else { pw = iw; ph = ih * 0.62; }
    var img = getImg(tr);
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    if (img) drawCover(ctx, img, px, py, pw, ph);
    else {
      var pg = ctx.createRadialGradient(px + pw / 2, py + ph * 0.7, 0, px + pw / 2, py + ph * 0.7, pw);
      pg.addColorStop(0, '#f1e6d4');
      pg.addColorStop(1, '#d9cbb6');
      ctx.fillStyle = pg;
      ctx.fillRect(px, py, pw, ph);
      drawPetFront(ctx, { species: tr.species, color: tr.color }, px + pw / 2, py + ph * 0.86, ph * 0.62, { time: t, phase: 0, bow: 0, wag: 0, walk: 0, walking: false, flip: 1 });
    }
    // 근조 리본 (사진 오른쪽 위)
    var rb = Math.max(3, pw * 0.04);
    ctx.fillStyle = '#121010';
    [0, 1].forEach(function (k) {
      ctx.save();
      ctx.translate(px + pw, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-pw, pw * (0.12 + k * 0.07), pw * 2, rb);
      ctx.restore();
    });
    ctx.restore();

    var pad = Math.max(8, iw * 0.035);
    var tx, ty, tw;
    if (land) { tx = ix + pw + pad; ty = iy + pad * 1.2; tw = iw - pw - pad * 2; } else { tx = ix + pad; ty = iy + ph + pad * 0.6; tw = iw - pad * 2; }
    var nameSize = Math.round(clamp(ih * 0.15, 14, 34));
    var subSize = Math.round(clamp(ih * 0.072, 9.5, 14));
    var msgSize = Math.round(clamp(ih * 0.092, 11, 20));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = slide.kind === 'spot' ? '#e8c27a' : '#b9ab98';
    ctx.font = subSize + 'px "Gowun Dodum", sans-serif';
    ctx.fillText(fitText(ctx, slide.kind === 'spot' ? '오늘 함께하는 아이' : '함께 기억해요', tw), tx, ty);
    ty += subSize * 1.7;
    ctx.fillStyle = '#fbf3e6';
    ctx.font = '700 ' + nameSize + 'px "Gowun Batang", serif';
    ctx.fillText(fitText(ctx, tr.name, tw), tx, ty);
    ty += nameSize * 1.25;
    ctx.fillStyle = '#b9ab98';
    ctx.font = subSize + 'px "Gowun Dodum", sans-serif';
    ctx.fillText(fitText(ctx, subline(tr), tw), tx, ty);
    ty += subSize * 1.9;
    if (tr.message) {
      ctx.fillStyle = '#f3e8d6';
      ctx.font = msgSize + 'px "Gowun Batang", serif';
      var maxLines = land ? Math.max(1, Math.floor((iy + ih - pad * 2.6 - ty) / (msgSize * 1.35))) : 1;
      wrapLines(ctx, tr.message, tw, Math.min(3, maxLines)).forEach(function (line) {
        ctx.fillText(line, tx, ty);
        ty += msgSize * 1.35;
      });
    }
    // 국화 수
    var fy = land ? iy + ih - pad - subSize : Math.min(ty + 2, iy + ih - subSize - 6);
    var fx = land ? tx : ix + iw - pad - subSize * 6;
    drawMum(ctx, fx + subSize * 0.55, fy + subSize * 0.55, subSize * 0.6);
    ctx.fillStyle = '#d9ceb9';
    ctx.font = subSize + 'px "Gowun Dodum", sans-serif';
    ctx.fillText('국화 ' + (tr.flowers || 0) + '송이', fx + subSize * 1.4, fy);
    // 진행 막대
    var prog = clamp((serverNow() - slide.start) / slide.dur, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(ix, iy + ih - 2, iw, 2);
    ctx.fillStyle = slide.kind === 'spot' ? 'rgba(232,194,122,.8)' : 'rgba(255,255,255,.4)';
    ctx.fillRect(ix, iy + ih - 2, iw * prog, 2);
  }

  function drawFrames(ctx) {
    var G = scene.G;
    if (!G.frames.length) return;
    var list = state.tributes.slice().reverse();
    G.frames.forEach(function (f, i) {
      var tr = list[i];
      if (!tr) return;
      var ix = f.x + 5, iy = f.y + 5, iw = f.w - 10, ih = f.h - 10 - f.h * 0.16;
      var img = getImg(tr);
      ctx.save();
      ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
      if (img) drawCover(ctx, img, ix, iy, iw, ih);
      else { ctx.fillStyle = '#e7dccb'; ctx.fillRect(ix, iy, iw, ih); }
      ctx.restore();
      ctx.fillStyle = '#5a4a3c';
      ctx.font = Math.round(clamp(f.w * 0.17, 8.5, 12)) + 'px "Gowun Batang", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, tr.name, iw), f.x + f.w / 2, f.y + f.h - f.h * 0.12);
    });
  }

  function drawTable(ctx, now, t) {
    var G = scene.G, T = G.table;
    var n = Math.min(state.flowersTotal, 36);
    var rand = rng(77);
    var s = clamp(T.h * 0.8, 6, 12);
    for (var i = 0; i < n; i++) {
      var row = i % 3;
      var fx = T.x + T.w * 0.12 + rand() * T.w * 0.76;
      if (Math.abs(fx - G.cx) < T.h * 1.4) fx += T.h * 2.8 * (fx < G.cx ? -1 : 1);
      drawLyingMum(ctx, fx, T.y - s * 0.2 + row * 1.2, s, (rand() - 0.5) * 0.7);
    }
    [-1, 1].forEach(function (k) {
      var cx = G.cx + k * T.w * 0.42, ch = T.h * 2.2;
      var fl = 1 + Math.sin(t * 13 + k) * 0.08 + Math.sin(t * 7.3 + k * 2) * 0.06;
      var fy = T.y - 3 - ch - T.h * 0.45;
      var gg = ctx.createRadialGradient(cx, fy, 0, cx, fy, T.h * 2.4);
      gg.addColorStop(0, 'rgba(255,200,110,.4)');
      gg.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - T.h * 2.4, fy - T.h * 2.4, T.h * 4.8, T.h * 4.8);
      ctx.fillStyle = '#ffc56e';
      ellipse(ctx, cx, fy, T.h * 0.22 * fl, T.h * 0.5 * fl); ctx.fill();
      ctx.fillStyle = '#fff4d6';
      ellipse(ctx, cx, fy + T.h * 0.12, T.h * 0.1, T.h * 0.22); ctx.fill();
    });
    var ix = G.cx, iy = T.y - T.h * 0.6;
    if (!scene.lastSmoke || now - scene.lastSmoke > 160) {
      scene.lastSmoke = now;
      scene.smoke.push({ t0: now, p: Math.random() * TAU });
      if (scene.smoke.length > 34) scene.smoke.shift();
    }
    ctx.strokeStyle = '#8a7a66';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ix, iy - T.h * 1.6); ctx.stroke();
    ctx.fillStyle = '#ff9a5a';
    ctx.beginPath(); ctx.arc(ix, iy - T.h * 1.6, 1.3, 0, TAU); ctx.fill();
    scene.smoke.forEach(function (sm) {
      var age = (now - sm.t0) / 4200;
      if (age > 1) return;
      ctx.fillStyle = 'rgba(160,150,170,' + (0.13 * (1 - age)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(ix + Math.sin(age * 5 + sm.p) * 6 * age, iy - T.h * 1.7 - age * T.h * 6, 1.5 + age * 6, 0, TAU);
      ctx.fill();
    });
  }

  // ---------- 아이 그리기 ----------
  var INK = '#2a1d17';
  function eyes(ctx, x1, x2, y, r, closed) {
    if (closed) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, r * 0.55);
      [x1, x2].forEach(function (x) { ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 0.9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); });
      return;
    }
    ctx.fillStyle = INK;
    [x1, x2].forEach(function (x) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
    ctx.fillStyle = '#fff';
    [x1, x2].forEach(function (x) { ctx.beginPath(); ctx.arc(x + r * 0.35, y - r * 0.35, r * 0.35, 0, TAU); ctx.fill(); });
  }
  function blush(ctx, x1, x2, y, r) {
    ctx.fillStyle = 'rgba(255,140,150,.32)';
    [x1, x2].forEach(function (x) { ellipse(ctx, x, y, r, r * 0.6); ctx.fill(); });
  }
  function tailStroke(ctx, w, col, lw) {
    ctx.lineWidth = w; ctx.strokeStyle = col.line; ctx.stroke();
    ctx.lineWidth = Math.max(1, w - lw * 2); ctx.strokeStyle = col.fill; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = col.line;
  }

  function drawPetFront(ctx, pet, x, y, u, a) {
    var col = PS.color(pet.color);
    var light = shade(col.fill, pet.color === 'black' ? 0.25 : 0.5);
    var t = a.time;
    var lw = Math.max(1, u * 0.04);
    var bob = a.walking ? -Math.abs(Math.sin(a.walk)) * u * 0.07 : Math.sin(t * 1.7 + a.phase) * u * 0.008;
    var step = a.walking ? Math.sin(a.walk) : 0;
    var hx = a.walking ? a.flip * u * 0.035 : 0;
    var drop = (a.bow || 0) * u * 0.13;
    var blink = Math.sin(t * 0.9 + a.phase * 3) > 0.985;
    var closed = (a.bow || 0) > 0.3 || blink;
    var sway = Math.sin(t * (a.wag > 0 ? 17 : 2.4) + a.phase) * (0.2 + a.wag * 0.6);
    var paw = function (sx, lift) {
      ellipse(ctx, sx, -u * 0.05 - lift * u * 0.06, u * 0.09, u * 0.065);
      ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
    };

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = col.line;
    if (a.walking) ctx.rotate(a.flip * 0.05);

    var sp = pet.species;
    if (sp === 'cat') {
      ctx.save(); ctx.beginPath();
      ctx.moveTo(-a.flip * u * 0.18, -u * 0.12);
      ctx.bezierCurveTo(-a.flip * u * 0.45, -u * 0.16, -a.flip * u * 0.48, -u * 0.4, -a.flip * (u * 0.4 + sway * u * 0.08), -u * 0.62);
      tailStroke(ctx, u * 0.09, col, lw); ctx.restore();
      ellipse(ctx, 0, -u * 0.34, u * 0.29, u * 0.33); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -u * 0.3, u * 0.14, u * 0.2); ctx.fillStyle = light; ctx.fill();
      paw(-u * 0.12, step > 0 ? step : 0); paw(u * 0.12, step < 0 ? -step : 0);
      var cy = -u * 0.82 + drop;
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(hx + s * u * 0.27, cy - u * 0.04);
        ctx.lineTo(hx + s * u * 0.21, cy - u * 0.36);
        ctx.lineTo(hx + s * u * 0.03, cy - u * 0.24);
        ctx.closePath(); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx + s * u * 0.22, cy - u * 0.08);
        ctx.lineTo(hx + s * u * 0.2, cy - u * 0.28);
        ctx.lineTo(hx + s * u * 0.09, cy - u * 0.21);
        ctx.closePath(); ctx.fillStyle = 'rgba(255,160,170,.55)'; ctx.fill();
      });
      ctx.beginPath(); ctx.arc(hx, cy, u * 0.28, 0, TAU); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      eyes(ctx, hx - u * 0.1, hx + u * 0.1, cy - u * 0.02, u * 0.04, closed);
      ctx.fillStyle = '#e88a98';
      ctx.beginPath(); ctx.moveTo(hx - u * 0.03, cy + u * 0.06); ctx.lineTo(hx + u * 0.03, cy + u * 0.06); ctx.lineTo(hx, cy + u * 0.095); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA('#3a2a20', 0.45); ctx.lineWidth = Math.max(0.6, u * 0.012);
      [-1, 1].forEach(function (s) {
        for (var k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(hx + s * u * 0.12, cy + u * 0.09 + k * u * 0.03); ctx.lineTo(hx + s * u * 0.32, cy + u * 0.07 + k * u * 0.05); ctx.stroke(); }
      });
      blush(ctx, hx - u * 0.17, hx + u * 0.17, cy + u * 0.08, u * 0.045);
    } else if (sp === 'rabbit') {
      ellipse(ctx, 0, -u * 0.32, u * 0.3, u * 0.31); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -u * 0.28, u * 0.15, u * 0.19); ctx.fillStyle = light; ctx.fill();
      paw(-u * 0.11, step > 0 ? step : 0); paw(u * 0.11, step < 0 ? -step : 0);
      var ry = -u * 0.8 + drop;
      var droop = (a.bow || 0) * 0.5;
      [-1, 1].forEach(function (s) {
        ctx.save();
        ctx.translate(hx + s * u * 0.1, ry - u * 0.18);
        ctx.rotate(s * (0.1 + droop) + Math.sin(t * 1.3 + a.phase + s) * 0.03);
        ellipse(ctx, 0, -u * 0.26, u * 0.08, u * 0.28); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
        ellipse(ctx, 0, -u * 0.24, u * 0.035, u * 0.19); ctx.fillStyle = 'rgba(255,160,170,.55)'; ctx.fill();
        ctx.restore();
      });
      ctx.beginPath(); ctx.arc(hx, ry, u * 0.27, 0, TAU); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      eyes(ctx, hx - u * 0.1, hx + u * 0.1, ry - u * 0.01, u * 0.038, closed);
      ellipse(ctx, hx, ry + u * 0.07, u * 0.035, u * 0.025); ctx.fillStyle = '#e88a98'; ctx.fill();
      ctx.strokeStyle = hexA('#3a2a20', 0.6); ctx.lineWidth = Math.max(0.8, u * 0.018);
      ctx.beginPath(); ctx.moveTo(hx, ry + u * 0.09); ctx.lineTo(hx, ry + u * 0.13); ctx.moveTo(hx, ry + u * 0.13); ctx.lineTo(hx - u * 0.04, ry + u * 0.15); ctx.moveTo(hx, ry + u * 0.13); ctx.lineTo(hx + u * 0.04, ry + u * 0.15); ctx.stroke();
      blush(ctx, hx - u * 0.16, hx + u * 0.16, ry + u * 0.08, u * 0.045);
    } else if (sp === 'hamster') {
      var hy = -u * 0.42 + drop * 0.5;
      [-1, 1].forEach(function (s) {
        ctx.beginPath(); ctx.arc(hx + s * u * 0.22, hy - u * 0.33, u * 0.085, 0, TAU); ctx.fillStyle = col.shade; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx + s * u * 0.22, hy - u * 0.33, u * 0.045, 0, TAU); ctx.fillStyle = 'rgba(255,160,170,.6)'; ctx.fill();
      });
      ellipse(ctx, 0, hy, u * 0.4, u * 0.4); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ellipse(ctx, hx * 0.5, hy + u * 0.07, u * 0.27, u * 0.27); ctx.fillStyle = light; ctx.fill();
      eyes(ctx, hx - u * 0.13, hx + u * 0.13, hy - u * 0.1, u * 0.042, closed);
      ellipse(ctx, hx, hy - u * 0.02, u * 0.03, u * 0.022); ctx.fillStyle = '#e88a98'; ctx.fill();
      blush(ctx, hx - u * 0.22, hx + u * 0.22, hy + u * 0.02, u * 0.05);
      [-1, 1].forEach(function (s) { ellipse(ctx, hx + s * u * 0.08, hy + u * 0.16, u * 0.05, u * 0.04); ctx.fillStyle = '#f2c0b8'; ctx.fill(); });
      paw(-u * 0.14, step > 0 ? step : 0); paw(u * 0.14, step < 0 ? -step : 0);
    } else if (sp === 'bird') {
      ctx.beginPath(); ctx.moveTo(-u * 0.06, -u * 0.2); ctx.lineTo(0, u * 0.04); ctx.lineTo(u * 0.06, -u * 0.2); ctx.closePath();
      ctx.fillStyle = col.shade; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e09a4a'; ctx.lineWidth = Math.max(1, u * 0.03);
      [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.moveTo(s * u * 0.07, -u * 0.1); ctx.lineTo(s * u * 0.07, -u * 0.01 - (s * step > 0 ? step * u * 0.04 : 0)); ctx.stroke(); });
      ctx.strokeStyle = col.line; ctx.lineWidth = lw;
      ellipse(ctx, 0, -u * 0.42, u * 0.26, u * 0.33); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -u * 0.38, u * 0.16, u * 0.23); ctx.fillStyle = light; ctx.fill();
      var flap = a.walking ? Math.sin(a.walk * 2) * 0.25 : 0;
      [-1, 1].forEach(function (s) { ellipse(ctx, s * u * 0.23, -u * 0.44, u * 0.08, u * 0.2, -s * (0.25 + flap)); ctx.fillStyle = col.shade; ctx.fill(); ctx.stroke(); });
      var by = -u * 0.85 + drop;
      ctx.beginPath(); ctx.arc(hx, by, u * 0.21, 0, TAU); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - u * 0.01, by - u * 0.2); ctx.quadraticCurveTo(hx + u * 0.03, by - u * 0.36, hx + u * 0.11, by - u * 0.3); ctx.stroke();
      eyes(ctx, hx - u * 0.08, hx + u * 0.08, by - u * 0.02, u * 0.032, closed);
      ctx.beginPath(); ctx.moveTo(hx - u * 0.045, by + u * 0.04); ctx.lineTo(hx + u * 0.045, by + u * 0.04); ctx.lineTo(hx, by + u * 0.12); ctx.closePath();
      ctx.fillStyle = '#f0a347'; ctx.fill();
      blush(ctx, hx - u * 0.13, hx + u * 0.13, by + u * 0.05, u * 0.035);
    } else {
      // 강아지
      ctx.save(); ctx.beginPath();
      ctx.moveTo(-a.flip * u * 0.2, -u * 0.26);
      ctx.quadraticCurveTo(-a.flip * u * 0.4, -u * 0.28, -a.flip * (u * 0.4 + sway * u * 0.1), -u * 0.52);
      tailStroke(ctx, u * 0.11, col, lw); ctx.restore();
      ellipse(ctx, 0, -u * 0.33, u * 0.33, u * 0.31); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -u * 0.29, u * 0.17, u * 0.2); ctx.fillStyle = light; ctx.fill();
      paw(-u * 0.13, step > 0 ? step : 0); paw(u * 0.13, step < 0 ? -step : 0);
      var dy = -u * 0.8 + drop;
      ctx.beginPath(); ctx.arc(hx, dy, u * 0.3, 0, TAU); ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
      [-1, 1].forEach(function (s) {
        ellipse(ctx, hx + s * u * 0.27, dy + u * 0.02, u * 0.1, u * 0.21, s * (0.35 + (a.bow || 0) * 0.2) + (a.walking ? Math.sin(a.walk + s) * 0.12 : 0));
        ctx.fillStyle = col.shade; ctx.fill(); ctx.stroke();
      });
      ellipse(ctx, hx, dy + u * 0.1, u * 0.13, u * 0.095); ctx.fillStyle = light; ctx.fill();
      eyes(ctx, hx - u * 0.11, hx + u * 0.11, dy - u * 0.04, u * 0.038, closed);
      ellipse(ctx, hx, dy + u * 0.06, u * 0.05, u * 0.036); ctx.fillStyle = INK; ctx.fill();
      ctx.strokeStyle = hexA('#3a2a20', 0.6); ctx.lineWidth = Math.max(0.8, u * 0.018);
      ctx.beginPath(); ctx.moveTo(hx, dy + u * 0.095); ctx.lineTo(hx, dy + u * 0.13); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx - u * 0.035, dy + u * 0.13, u * 0.035, 0, Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx + u * 0.035, dy + u * 0.13, u * 0.035, 0, Math.PI); ctx.stroke();
      blush(ctx, hx - u * 0.19, hx + u * 0.19, dy + u * 0.08, u * 0.05);
    }
    ctx.restore();
  }

  function drawPetBack(ctx, pet, x, y, u, a) {
    var col = PS.color(pet.color);
    var t = a.time;
    var bow = a.bow || 0;
    var bob = a.walking ? -Math.abs(Math.sin(a.walk)) * u * 0.07 : 0;
    var breathe = Math.sin(t * 1.7 + a.phase) * 0.014;
    var drop = bow * u * 0.34;
    var lw = Math.max(1, u * 0.04);
    var sway = Math.sin(t * (a.wag > 0 ? 17 : 2.4) + a.phase) * (0.22 + a.wag * 0.7);
    ctx.save();
    ctx.translate(x, y + bob);
    if (a.walking) ctx.rotate(Math.sin(a.walk) * 0.05);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = col.line;
    var sq = 1 - bow * 0.07 + breathe;
    var fill = function (c) { ctx.fillStyle = c; ctx.fill(); ctx.stroke(); };
    switch (pet.species) {
      case 'cat': {
        var hy = -u * 0.84 + drop, hr = u * 0.27;
        [-1, 1].forEach(function (s) {
          ctx.beginPath();
          ctx.moveTo(s * hr * 0.92, hy - hr * 0.2); ctx.lineTo(s * hr * 0.66, hy - hr * 1.3); ctx.lineTo(s * hr * 0.08, hy - hr * 0.82);
          ctx.closePath(); fill(col.fill);
        });
        ctx.beginPath(); ctx.arc(0, hy, hr, 0, TAU); fill(col.fill);
        ellipse(ctx, 0, -u * 0.37 * sq, u * 0.36, u * 0.4 * sq); fill(col.fill);
        ctx.save(); ctx.translate(u * 0.2, -u * 0.06); ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(u * 0.3, u * 0.04, u * 0.44, -u * 0.06, u * 0.4 + sway * u * 0.12, -u * 0.36);
        tailStroke(ctx, u * 0.1, col, lw); ctx.restore();
        break;
      }
      case 'rabbit': {
        var ry = -u * 0.82 + drop, rr = u * 0.26, droop = bow * 0.45;
        [-1, 1].forEach(function (s) {
          ctx.save(); ctx.translate(s * u * 0.09, ry - rr * 0.6); ctx.rotate(s * (0.14 + droop));
          ellipse(ctx, 0, -u * 0.3, u * 0.085, u * 0.3); fill(col.fill); ctx.restore();
        });
        ctx.beginPath(); ctx.arc(0, ry, rr, 0, TAU); fill(col.fill);
        ellipse(ctx, 0, -u * 0.35 * sq, u * 0.4, u * 0.37 * sq); fill(col.fill);
        ctx.beginPath(); ctx.arc(0, -u * 0.14, u * 0.1, 0, TAU); ctx.fillStyle = '#fffaf2'; ctx.fill();
        break;
      }
      case 'hamster': {
        var h2 = -u * 0.64 + drop * 0.55;
        [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.arc(s * u * 0.19, h2 - u * 0.24, u * 0.075, 0, TAU); fill(col.shade); });
        ctx.save(); ctx.lineWidth = lw * 2;
        ctx.beginPath(); ctx.arc(0, h2, u * 0.3, 0, TAU); ctx.stroke();
        ellipse(ctx, 0, -u * 0.34 * sq, u * 0.43, u * 0.36 * sq); ctx.stroke();
        ctx.fillStyle = col.fill;
        ctx.beginPath(); ctx.arc(0, h2, u * 0.3, 0, TAU); ctx.fill();
        ellipse(ctx, 0, -u * 0.34 * sq, u * 0.43, u * 0.36 * sq); ctx.fill();
        ctx.restore();
        break;
      }
      case 'bird': {
        ctx.beginPath(); ctx.moveTo(-u * 0.08, -u * 0.22); ctx.lineTo(sway * u * 0.03, u * 0.14); ctx.lineTo(u * 0.08, -u * 0.22); ctx.closePath(); fill(col.shade);
        ellipse(ctx, 0, -u * 0.47 * sq, u * 0.26, u * 0.38 * sq); fill(col.fill);
        var by = -u * 0.88 + drop * 1.1;
        ctx.beginPath(); ctx.arc(0, by, u * 0.2, 0, TAU); fill(col.fill);
        [-1, 1].forEach(function (s) { ellipse(ctx, s * u * 0.16, -u * 0.46 * sq, u * 0.11, u * 0.26, s * 0.18 - s * bow * 0.2); fill(col.shade); });
        break;
      }
      default: {
        var dy = -u * 0.86 + drop, dr = u * 0.3;
        ctx.beginPath(); ctx.arc(0, dy, dr, 0, TAU); fill(col.fill);
        [-1, 1].forEach(function (s) { ellipse(ctx, s * dr * 0.98, dy + dr * 0.18, u * 0.11, u * 0.22, -s * (0.38 + bow * 0.25)); fill(col.shade); });
        ellipse(ctx, 0, -u * 0.36 * sq, u * 0.42, u * 0.38 * sq); fill(col.fill);
        ctx.save(); ctx.translate(u * 0.16, -u * 0.1); ctx.rotate(sway * 0.7);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(u * 0.3, -u * 0.02, u * 0.33, -u * 0.32);
        tailStroke(ctx, u * 0.12, col, lw); ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---------- 아이(접속자) 움직임 ----------
  var SPEED = 115; // px/s
  function makePeer(p) {
    return {
      id: p.id, pet: p.pet, tid: p.tid || null,
      x: p.x, y: p.y, tx: p.x, ty: p.y,
      facing: 'back', flip: 1, walk: 0, walking: false, arrived: true,
      anim: { bow: 0, wag: 0, join: 0, leave: 0 }, phase: (hash(p.id) % 1000) / 160, bubble: null
    };
  }
  function addPeer(p, quiet) {
    var peer = state.peers.get(p.id) || makePeer(p);
    peer.pet = p.pet;
    peer.tid = p.tid || null;
    peer.x = peer.tx = p.x;
    peer.y = peer.ty = p.y;
    peer.anim.leave = 0;
    if (!quiet) peer.anim.join = nowMs();
    state.peers.set(p.id, peer);
    updateCount();
    return peer;
  }
  function removePeer(id) {
    var p = state.peers.get(id);
    if (!p) return;
    p.anim.leave = nowMs();
    setTimeout(function () { if (state.peers.get(id) === p && p.anim.leave) state.peers.delete(id); updateCount(); }, 700);
  }
  function setTarget(peer, nx, ny) { peer.tx = nx; peer.ty = ny; peer.arrived = false; }

  function updatePeers(dt) {
    if (!scene.G) return;
    state.peers.forEach(function (p) {
      var a = toPx(p.x, p.y), b = toPx(p.tx, p.ty);
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.hypot(dx, dy);
      if (d > 0.8) {
        var stepPx = Math.min(d, SPEED * dt * lerp(0.85, 1.05, p.y));
        var n = toNorm(a.x + dx / d * stepPx, a.y + dy / d * stepPx);
        p.x = n.x; p.y = n.y;
        p.walking = true;
        p.walk += stepPx * 0.22;
        if (Math.abs(dx) > 1) p.flip = dx < 0 ? -1 : 1;
        p.facing = dy < -Math.abs(dx) * 0.5 ? 'back' : 'front';
      } else if (!p.arrived) {
        p.x = p.tx; p.y = p.ty;
        p.walking = false;
        p.arrived = true;
        if (p.y < 0.25) p.facing = 'back';
      }
    });
    var pf = state.pendingFlower;
    if (pf) {
      var me = state.peers.get(state.myId);
      if (!me || me.arrived || Date.now() > pf.deadline) {
        state.pendingFlower = null;
        if (me) me.facing = 'back';
        net.send({ t: 'flower', tid: pf.tid });
        playFlower(state.myId);
        setTimeout(function () { playAct(state.myId, 'bow'); net.send({ t: 'act', a: 'bow' }); }, 900);
      }
    }
  }

  function playAct(id, act) {
    var p = state.peers.get(id);
    if (!p) return;
    if (act === 'bow') { if (!p.anim.bow) p.anim.bow = nowMs(); }
    else if (act === 'tail') {
      p.anim.wag = nowMs();
      var pos = toPx(p.x, p.y), u = unitAt(p.y);
      addFx({ kind: 'heart', x: pos.x + u * 0.3, y: pos.y - u * 1.1, s: clamp(u * 0.2, 6, 12), dur: 1300 });
    }
  }
  function showBubble(id, text) {
    var p = state.peers.get(id);
    if (!p || !text) return;
    p.bubble = { text: text, t0: nowMs() };
    scene.floaters.push({ text: text, t0: nowMs(), x: Math.random() });
    if (scene.floaters.length > 8) scene.floaters.shift();
  }
  function playFlower(id) {
    var p = state.peers.get(id);
    if (!p || !scene.G) return;
    var pos = toPx(p.x, p.y), u = unitAt(p.y), T = scene.G.table;
    var tx = clamp(pos.x, T.x + T.w * 0.15, T.x + T.w * 0.85);
    if (Math.abs(tx - scene.G.cx) < T.h * 1.6) tx += T.h * 3 * (tx < scene.G.cx ? -1 : 1);
    addFx({ kind: 'flower', x0: pos.x, y0: pos.y - u * 0.7, x1: tx, y1: T.y - 2, s: clamp(u * 0.16, 5, 9), dur: 800 });
    if (id === state.myId) audio.bell();
  }

  // ---------- 효과 ----------
  function addFx(f) { f.t0 = nowMs(); scene.fx.push(f); }
  function drawHeart(ctx, x, y, s) {
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.4, y - s * 0.85, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.4, y - s * 0.85, x + s * 0.9, y - s * 0.2, x, y + s * 0.35);
    ctx.fill();
  }
  function drawFx(ctx, now) {
    scene.fx = scene.fx.filter(function (f) {
      var p = (now - f.t0) / f.dur;
      if (p >= 1) return false;
      if (f.kind === 'heart') {
        ctx.globalAlpha = 1 - p;
        drawHeart(ctx, f.x + Math.sin(p * 8) * 4, f.y - p * 34, f.s * (0.8 + p * 0.3));
        ctx.globalAlpha = 1;
      } else if (f.kind === 'flower') {
        var e = easeInOut(p);
        var cx = (f.x0 + f.x1) / 2, cy = Math.min(f.y0, f.y1) - 40;
        var x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * cx + e * e * f.x1;
        var y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * cy + e * e * f.y1;
        drawLyingMum(ctx, x, y, f.s, p * 2);
      }
      return true;
    });
  }

  function drawPeer(ctx, p, now, t) {
    var pos = toPx(p.x, p.y), u = unitAt(p.y);
    var a = p.anim, alpha = 1;
    var bow = 0;
    if (a.bow) { var bp = (now - a.bow) / 1500; if (bp >= 1) a.bow = 0; else bow = Math.sin(Math.PI * easeInOut(bp)); }
    var wag = 0;
    if (a.wag) { var wp = (now - a.wag) / 1400; if (wp >= 1) a.wag = 0; else wag = 1 - wp; }
    var hop = 0;
    if (a.join) { var jp = (now - a.join) / 600; if (jp >= 1) a.join = 0; else { hop = Math.sin(Math.PI * jp) * u * 0.3; alpha = clamp(jp * 3, 0, 1); } }
    if (a.leave) alpha = clamp(1 - (now - a.leave) / 600, 0, 1);
    var me = p.id === state.myId;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(60,40,20,.2)';
    ellipse(ctx, pos.x, pos.y, u * 0.34, u * 0.09); ctx.fill();
    if (me) {
      ctx.strokeStyle = 'rgba(77,122,93,' + (0.55 + Math.sin(t * 2.4) * 0.25).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ellipse(ctx, pos.x, pos.y, u * 0.44, u * 0.13); ctx.stroke();
    }
    var opts = { time: t, phase: p.phase, bow: bow, wag: wag, walk: p.walk, walking: p.walking, flip: p.flip };
    if (p.facing === 'back') drawPetBack(ctx, p.pet, pos.x, pos.y - hop, u, opts);
    else drawPetFront(ctx, p.pet, pos.x, pos.y - hop, u, opts);
    // 이름표
    var fs = Math.round(clamp(u * 0.25, 10, 13.5));
    ctx.font = (me ? '700 ' : '') + fs + 'px "Gowun Dodum", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var label = fitText(ctx, p.pet.name, u * 2.2);
    ctx.fillStyle = 'rgba(255,252,246,.85)';
    var lwid = ctx.measureText(label).width + 10;
    roundRect(ctx, pos.x - lwid / 2, pos.y + u * 0.12, lwid, fs + 6, (fs + 6) / 2); ctx.fill();
    ctx.fillStyle = me ? '#3f6a4e' : '#4a3f36';
    ctx.fillText(label, pos.x, pos.y + u * 0.12 + 3);
    // 말풍선
    if (p.bubble) {
      var bp2 = (now - p.bubble.t0) / 3200;
      if (bp2 >= 1) p.bubble = null;
      else {
        var bfs = Math.round(clamp(u * 0.3, 11, 14));
        ctx.font = bfs + 'px "Gowun Batang", serif';
        var bw = ctx.measureText(p.bubble.text).width + 18, bh = bfs + 14;
        var bx = pos.x - bw / 2, by = pos.y - u * 1.35 - bh - hop;
        ctx.globalAlpha = alpha * (bp2 > 0.85 ? (1 - bp2) / 0.15 : 1);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(70,52,36,.25)';
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos.x - 5, by + bh - 0.5); ctx.lineTo(pos.x, by + bh + 6); ctx.lineTo(pos.x + 5, by + bh - 0.5); ctx.fill();
        ctx.fillStyle = '#3d342d';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.bubble.text, pos.x, by + bh / 2 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 매 프레임 ----------
  var lastFrame = nowMs();
  function frame(now) {
    var dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    updatePeers(dt);
    draw(now);
    requestAnimationFrame(frame);
  }
  function draw(now) {
    var ctx = scene.ctx, G = scene.G;
    if (!G) return;
    var t = now / 1000;
    ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
    ctx.drawImage(scene.bg, 0, 0, G.W, G.H);
    drawScreen(ctx, now, t);
    drawFrames(ctx);
    drawTable(ctx, now, t);
    if (scene.marker) {
      var mp = (now - scene.marker.t0) / 700;
      if (mp >= 1) scene.marker = null;
      else {
        ctx.strokeStyle = 'rgba(77,122,93,' + (0.8 * (1 - mp)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ellipse(ctx, scene.marker.x, scene.marker.y, 10 + mp * 14, (10 + mp * 14) * 0.32); ctx.stroke();
      }
    }
    var list = Array.from(state.peers.values()).sort(function (a, b) { return a.y - b.y; });
    list.forEach(function (p) { drawPeer(ctx, p, now, t); });
    drawFx(ctx, now);
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
    return new URL(p, ws.replace(/^ws/, 'http').replace(/ws$/, '')).href;
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
      var self = this, ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.onClosed(); return; }
      this.ws = ws;
      var guard = setTimeout(function () { if (ws.readyState !== 1) ws.close(); }, 7000);
      ws.onopen = function () { clearTimeout(guard); self.everOpened = true; self.retry = 0; self.hello(); };
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(m); };
      ws.onclose = function (e) { clearTimeout(guard); if (self.ws !== ws) return; self.ws = null; self.onClosed(e); };
      ws.onerror = function () { /* onclose 에서 처리 */ };
    },
    onClosed: function (e) {
      if (this.local) return;
      if (!this.everOpened) { this.goSolo(); return; }
      if (e && e.code === 4003) { this.goSolo(true); return; }
      setMode('reconnecting');
      var self = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.open(); }, Math.min(15000, 800 * Math.pow(2, this.retry++)));
    },
    hello: function () {
      var me = state.peers.get(state.myId);
      var tribute = state.pendingTribute;
      this.send({
        t: 'hello', v: 2, pet: state.pet,
        room: state.wantRoom || state.room.id || urlRoom(),
        pos: me ? { x: me.tx, y: me.ty } : undefined,
        tribute: tribute || undefined,
        resume: tribute ? undefined : (state.mine || store.get('mine', null) || undefined),
        again: state.welcomed
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
      toast(full ? '지금 모든 추모실이 가득 찼어요. 잠시 혼자 있어요.' : '지금은 서버에 연결되지 않아 혼자 둘러봐요.');
    }
  };

  // 서버 없이 쓰는 혼자 모드: 서버와 같은 메시지를 흉내 내요. 다른 사람은 만들지 않아요.
  var localHub = {
    flowers: 0,
    list: function () {
      return (store.get('soloTributes', []) || []).filter(function (t) { return Date.now() - t.ts < 7 * 864e5; });
    },
    save: function (list) {
      while (list.length && !store.set('soloTributes', list)) list.shift();
    },
    create: function (input) {
      var t = {
        id: 'local-' + Date.now().toString(36), name: state.pet.name, species: state.pet.species, color: state.pet.color,
        photoUrl: input.photoUrl, message: input.message || '', since: input.since || null, until: input.until || null,
        ts: Date.now(), flowers: 0
      };
      var list = this.list();
      list.push(t);
      this.save(list.slice(-6));
      state.mine = { tid: t.id, token: null };
      return t;
    },
    hello: function () {
      var spot = null;
      if (state.pendingTribute) { var t = this.create(state.pendingTribute); spot = { tid: t.id, at: Date.now() }; }
      var fl = store.get('soloFlowers', { day: '', n: 0 });
      this.flowers = fl.day === new Date().toDateString() ? fl.n : 0;
      onMessage({
        t: 'welcome', now: Date.now(),
        you: { id: 'me', x: 0.5, y: 0.8, tid: state.mine ? state.mine.tid : null, token: null },
        room: { id: 'solo', cap: 30, public: false, flowers: this.flowers },
        peers: [], tributes: this.list(), spot: spot, stats: null
      });
    },
    handle: function (msg) {
      if (msg.t === 'flower') {
        var list = this.list();
        var t = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === msg.tid) t = list[i];
        if (!t) return;
        t.flowers += 1;
        this.save(list);
        this.flowers += 1;
        store.set('soloFlowers', { day: new Date().toDateString(), n: this.flowers });
        onMessage({ t: 'flower', id: 'me', tid: t.id, n: t.flowers, total: this.flowers });
      } else if (msg.t === 'spot' && state.mine) {
        onMessage({ t: 'spot', tid: state.mine.tid, at: Date.now() });
      } else if (msg.t === 'tribute') {
        var nt = this.create(msg);
        onMessage({ t: 'tribute', tr: nt, at: nt.ts, by: 'me' });
      }
    }
  };

  function onMessage(m) {
    switch (m.t) {
      case 'welcome': {
        state.clockOffset = (m.now || Date.now()) - Date.now();
        state.myId = m.you.id;
        state.room = m.room;
        state.flowersTotal = m.room.flowers || 0;
        state.wantRoom = null;
        state.pendingTribute = null;
        state.welcomed = true;
        if (!net.local) {
          if (m.you.tid && m.you.token) { state.mine = { tid: m.you.tid, token: m.you.token }; store.set('mine', state.mine); }
          else if (!m.you.tid) { state.mine = null; store.set('mine', null); }
        }
        state.tributes = (m.tributes || []).slice().sort(function (a, b) { return a.ts - b.ts; });
        state.spot = m.spot || null;
        if (m.stats) state.stats = m.stats;
        state.peers.clear();
        var me = addPeer({ id: m.you.id, pet: state.pet, x: m.you.x, y: m.you.y, tid: m.you.tid }, false);
        me.facing = 'back';
        (m.peers || []).forEach(function (p) { addPeer(p, true); });
        if (!net.local) setMode('live');
        updateRoomUI();
        updateMineLabel();
        if (m.notice === 'room-full') toast('그 추모실은 자리가 다 찼어요. 옆 추모실로 안내했어요.');
        else if (m.spot && m.you.tid && m.spot.tid === m.you.tid) toast('큰 화면에 ' + objJosa(state.pet.name) + ' 소개했어요.');
        if (state.pendingShare) { state.pendingShare = false; shareRoom(); }
        break;
      }
      case 'join': addPeer(m.p, false); break;
      case 'leave': removePeer(m.id); break;
      case 'move': { var mp = state.peers.get(m.id); if (mp) setTarget(mp, m.x, m.y); break; }
      case 'act': playAct(m.id, m.a); break;
      case 'say': showBubble(m.id, PS.WORDS[m.w] || ''); break;
      case 'flower': {
        state.flowersTotal = m.total;
        var ft = findTribute(m.tid);
        if (ft) ft.flowers = m.n;
        if (m.id !== state.myId) playFlower(m.id);
        break;
      }
      case 'spot': state.spot = { tid: m.tid, at: m.at }; break;
      case 'tribute': {
        if (!findTribute(m.tr.id)) state.tributes.push(m.tr);
        state.tributes.sort(function (a, b) { return a.ts - b.ts; });
        state.spot = { tid: m.tr.id, at: m.at };
        var owner = state.peers.get(m.by);
        if (owner) owner.tid = m.tr.id;
        if (m.by === state.myId) { toast('큰 화면에 ' + objJosa(m.tr.name) + ' 소개했어요.'); updateMineLabel(); }
        else flashStatus('새로 온 아이 ‘' + m.tr.name + '’를 소개하고 있어요');
        break;
      }
      case 'mine':
        state.mine = { tid: m.tid, token: m.token };
        if (!net.local) store.set('mine', state.mine);
        updateMineLabel();
        break;
      case 'hide': {
        state.tributes = state.tributes.filter(function (t) { return t.id !== m.tid; });
        if (state.mine && state.mine.tid === m.tid) {
          state.mine = null;
          store.set('mine', null);
          updateMineLabel();
          toast('신고가 쌓여 사진이 내려갔어요.');
        }
        break;
      }
      case 'stats': state.stats = m.stats; break;
      case 'error':
        if (m.code === 'rate') toast(Math.ceil((m.wait || 0) / 1000) + '초 뒤에 다시 할 수 있어요.');
        else if (m.code === 'photo') { toast('사진을 화면에 올리지 못했어요. 다시 올려 주세요.'); updateMineLabel(); }
        else if (m.code === 'message') toast('한마디에 쓸 수 없는 말이 있어서 사진을 올리지 못했어요.');
        else if (m.code === 'name' || m.code === 'name-empty') showEntry('그 이름은 쓸 수 없어요. 다른 이름을 적어 주세요.');
        break;
      default:
    }
  }

  function setMode(mode) {
    state.mode = mode;
    var line = $('status-line');
    if (mode === 'reconnecting') { line.textContent = '연결이 잠시 끊겼어요. 다시 잇는 중…'; line.hidden = false; }
    else if (mode === 'connecting') { line.textContent = '추모관으로 들어가는 중…'; line.hidden = false; }
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
    flashTimer = setTimeout(function () { if (state.mode === 'live') line.hidden = true; }, 3500);
  }
  function updateCount() {
    var n = 0;
    state.peers.forEach(function (p) { if (!p.anim.leave) n++; });
    var pill = $('online-pill');
    if (state.mode === 'solo') {
      pill.classList.add('solo');
      $('online-n').textContent = '혼자';
      $('online-unit').textContent = '';
    } else {
      pill.classList.remove('solo');
      $('online-n').textContent = String(n);
      $('online-unit').textContent = '명';
    }
  }
  function updateRoomUI() {
    $('room-name').textContent = net.local ? '혼자 둘러보기' : PS.roomLabel(state.room.id);
    updateCount();
    if (!net.local && state.room.id) {
      try {
        var u = new URL(location.href);
        u.searchParams.set('room', state.room.id);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* 주소를 못 바꿔도 괜찮아요 */ }
    }
  }
  function updateMineLabel() {
    $('mine-label').textContent = state.mine && findTribute(state.mine.tid) ? '우리 아이' : '사진 올리기';
  }

  // ---------- 행동 ----------
  function myPeer() { return state.peers.get(state.myId); }
  function moveMe(nx, ny) {
    var me = myPeer();
    if (!me) return;
    setTarget(me, nx, ny);
    net.send({ t: 'move', x: nx, y: ny });
  }

  function doFlower(tid) {
    if (!state.myId) return;
    var slide = currentSlide();
    tid = tid || (slide && slide.t.id);
    if (!tid || !findTribute(tid)) { toast('지금 화면에 소개된 아이가 없어요. 사진을 올려 아이를 소개해 보세요.'); return; }
    if (Date.now() < state.readyAt.flower || state.pendingFlower) return;
    state.readyAt.flower = Date.now() + PS.LIMITS.flowerCooldownMs + 1500;
    var me = myPeer();
    moveMe(clamp(me.x, 0.32, 0.68) + (Math.random() - 0.5) * 0.06, 0);
    state.pendingFlower = { tid: tid, deadline: Date.now() + 5000 };
    vibrate(10);
  }

  function act(kind) {
    if (!state.joined || !state.myId) return;
    audio.unlock();
    if (kind === 'flower') doFlower();
    else if (kind === 'bow') {
      playAct(state.myId, 'bow');
      net.send({ t: 'act', a: 'bow' });
      vibrate(12);
    } else if (kind === 'say') openSheet('sheet-say');
    else if (kind === 'mine') {
      if (!state.mine || !findTribute(state.mine.tid)) { showEntry(null, true); return; }
      var wait = state.readyAt.spot - Date.now();
      if (wait > 0) { toast(Math.ceil(wait / 1000) + '초 뒤에 다시 띄울 수 있어요.'); return; }
      state.readyAt.spot = Date.now() + PS.LIMITS.spotCooldownMs;
      net.send({ t: 'spot' });
      toast('큰 화면에 ' + objJosa(state.pet.name) + ' 다시 띄웠어요.');
    } else if (kind === 'wall') openWall();
  }

  function buildWords() {
    var box = $('word-chips');
    PS.WORDS.forEach(function (w, i) {
      var b = el('button', 'chip', w);
      b.type = 'button';
      b.addEventListener('click', function () {
        closeSheet();
        if (Date.now() < state.readyAt.say) return;
        state.readyAt.say = Date.now() + PS.LIMITS.sayCooldownMs;
        showBubble(state.myId, w);
        net.send({ t: 'say', w: i });
        vibrate(8);
      });
      box.appendChild(b);
    });
  }

  // ---------- 화면 누르기 ----------
  var press = null;
  scene.canvas.addEventListener('pointerdown', function (e) { press = { x: e.clientX, y: e.clientY }; });
  scene.canvas.addEventListener('pointerup', function (e) {
    if (!press) return;
    var moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    press = null;
    if (moved < 14) tap(e.clientX, e.clientY);
  });

  function inRect(x, y, r, pad) { pad = pad || 0; return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad; }

  function tap(x, y) {
    if (!state.joined || !scene.G) return;
    hidePop();
    var G = scene.G;
    var list = Array.from(state.peers.values()).sort(function (a, b) { return b.y - a.y; });
    for (var i = 0; i < list.length; i++) {
      var p = list[i], pos = toPx(p.x, p.y), u = unitAt(p.y);
      if (Math.hypot(x - pos.x, y - (pos.y - u * 0.5)) < u * 0.6) {
        if (p.id === state.myId) { playAct(p.id, 'tail'); net.send({ t: 'act', a: 'tail' }); vibrate(6); }
        else showPeerPop(p, pos.x, pos.y - u * 1.3);
        return;
      }
    }
    if (inRect(x, y, G.screen)) { var s = currentSlide(); if (s) openTribute(s.t); else showEntry(null, true); return; }
    for (var fi = 0; fi < G.frames.length; fi++) {
      if (inRect(x, y, G.frames[fi])) {
        var tr = state.tributes.slice().reverse()[fi];
        if (tr) openTribute(tr); else openWall();
        return;
      }
    }
    if (inRect(x, y, G.table, 12)) { doFlower(); return; }
    if (y > G.floorY) {
      var n = toNorm(x, y);
      moveMe(n.x, n.y);
      var pp = toPx(n.x, n.y);
      scene.marker = { x: pp.x, y: pp.y, t0: nowMs() };
    }
  }

  var popTimer = null;
  function showPeerPop(p, x, y) {
    var pop = $('pop');
    pop.textContent = '';
    pop.appendChild(el('b', null, p.pet.name));
    pop.appendChild(el('span', 'm', PS.species(p.pet.species).label));
    var tr = p.tid && findTribute(p.tid);
    if (tr) {
      var b = el('button', null, '소개 보기');
      b.type = 'button';
      b.addEventListener('click', function () { hidePop(); openTribute(tr); });
      pop.appendChild(b);
    }
    pop.hidden = false;
    var w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = clamp(x, w / 2 + 8, scene.w - w / 2 - 8) + 'px';
    pop.style.top = Math.max(70, y - h - 10) + 'px';
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 4000);
  }
  function hidePop() { $('pop').hidden = true; }

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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  var sheetTribute = null;
  function openTribute(t) {
    sheetTribute = t;
    var url = photoUrl(t);
    var img = $('tribute-img');
    if (url) { img.src = url; img.hidden = false; } else img.hidden = true;
    img.alt = t.name + ' 사진';
    $('tribute-name').textContent = t.name;
    $('tribute-sub').textContent = subline(t);
    $('tribute-msg').textContent = t.message || '';
    $('tribute-flowers').textContent = '국화 ' + (t.flowers || 0) + '송이';
    var here = !!findTribute(t.id);
    var fb = $('tribute-flower');
    fb.disabled = !here;
    fb.textContent = here ? '국화 한 송이 올리기' : '다른 추모실에 있는 아이예요';
    var own = state.mine && state.mine.tid === t.id;
    var rep = $('tribute-report');
    rep.hidden = net.local || !!own;
    var done = state.reported.indexOf(t.id) !== -1;
    rep.disabled = done;
    rep.textContent = done ? '신고했어요' : '이 사진 신고하기';
    openSheet('sheet-tribute');
  }
  $('tribute-flower').addEventListener('click', function () {
    if (!sheetTribute) return;
    var id = sheetTribute.id;
    closeSheet();
    doFlower(id);
  });
  $('tribute-report').addEventListener('click', function () {
    if (!sheetTribute) return;
    net.send({ t: 'report', tid: sheetTribute.id });
    state.reported.push(sheetTribute.id);
    store.set('reported', state.reported.slice(-200));
    this.textContent = '신고했어요';
    this.disabled = true;
    toast('신고했어요. 여러 명이 신고하면 바로 내려가요.');
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

  function openWall() {
    openSheet('sheet-wall');
    var grid = $('wall-grid');
    grid.textContent = '';
    $('wall-sub').textContent = '불러오는 중…';
    var p = net.local ? Promise.resolve({ tributes: localHub.list().reverse() }) : getJson('api/tributes?limit=60');
    p.then(function (d) {
      var items = (d && d.tributes) || state.tributes.slice().reverse();
      $('wall-sub').textContent = net.local ? '이 기기에서 올린 아이들이에요.' : '최근 7일 동안 꼬리별 추모관에 올라온 아이들 ' + items.length + '명';
      if (!items.length) { grid.appendChild(el('li', 'empty', '아직 올라온 아이가 없어요.')); return; }
      items.forEach(function (t) {
        var local = findTribute(t.id);
        if (local) t = local;
        var li = el('li');
        var b = el('button');
        b.type = 'button';
        var frame = el('span', 'frame');
        var url = photoUrl(t);
        if (url) { var im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = url; frame.appendChild(im); }
        b.appendChild(frame);
        b.appendChild(el('span', 'n', t.name));
        b.appendChild(el('span', 'm', years(t) || PS.species(t.species).label));
        b.addEventListener('click', function () { openTribute(t); });
        li.appendChild(b);
        grid.appendChild(li);
      });
    });
  }

  function openRooms() {
    openSheet('sheet-rooms');
    var grid = $('room-grid');
    grid.textContent = '';
    $('private-room').hidden = !!net.local;
    if (net.local) { $('rooms-sub').textContent = '지금은 서버에 연결되지 않아 혼자 둘러보고 있어요.'; return; }
    $('rooms-sub').textContent = '불러오는 중…';
    getJson('api/stats').then(function (s) {
      if (!s) { $('rooms-sub').textContent = '추모실 목록을 불러오지 못했어요.'; return; }
      $('rooms-sub').textContent = '지금 모든 추모실에 ' + s.online + '명 · 오늘 국화 ' + s.today.flowers + '송이';
      var rooms = s.rooms.slice();
      var maxN = rooms.reduce(function (m, r) { return Math.max(m, parseInt(r.id.slice(5), 10)); }, 0);
      rooms.push({ id: 'hall-' + (maxN + 1), n: 0 });
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
    var id = 'family-' + Math.random().toString(36).slice(2, 8);
    state.wantRoom = id;
    state.pendingShare = true;
    net.send({ t: 'room', room: id });
    closeSheet();
  });

  function shareRoom() {
    var u = new URL(location.href);
    if (!net.local && state.room.id) u.searchParams.set('room', state.room.id);
    var name = state.pet ? state.pet.name : '';
    var text = name ? '꼬리별 추모관에서 ' + objJosa(name) + ' 같이 기억해 주세요.' : '꼬리별 추모관에서 같이 기억해요.';
    if (navigator.share) { navigator.share({ title: PS.BRAND, text: text, url: u.href }).catch(function () { /* 닫음 */ }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(u.href).then(function () { toast('링크를 복사했어요. 붙여넣어 보내 주세요.'); }, function () { toast(u.href); });
    } else toast(u.href);
  }

  $('room-btn').addEventListener('click', openRooms);
  $('menu-btn').addEventListener('click', function () { openSheet('sheet-menu'); });
  document.querySelectorAll('[data-menu]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-menu');
      closeSheet();
      if (k === 'share') shareRoom();
      else if (k === 'wall') openWall();
      else if (k === 'rooms') openRooms();
      else if (k === 'sound') openSheet('sheet-sound');
      else if (k === 'pet') showEntry();
      else if (k === 'info') openSheet('sheet-info');
    });
  });
  document.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
  });

  // ---------- 소리 (모두 기기에서 만들어요. 녹음 파일 없음) ----------
  var audio = {
    ctx: null, master: null, noise: null, nodes: {}, timers: {},
    on: store.get('soundOn', false),
    prefs: Object.assign({ music: true, rain: false, bell: true }, store.get('soundPrefs', {})),
    unlock: function () { return this.on ? this.ensure() : null; },
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
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
      $('sound-btn').setAttribute('aria-pressed', String(v));
      $('sound-btn').setAttribute('aria-label', v ? '소리 끄기' : '소리 켜기');
      if (v) { this.ensure(); this.apply(); } else this.stopAll();
    },
    setPref: function (k, v) {
      this.prefs[k] = v;
      store.set('soundPrefs', this.prefs);
      if (v && !this.on) { this.setOn(true); return; }
      this.apply();
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
      n.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      setTimeout(function () { try { n.src.stop(); } catch (e) { /* 이미 멈춤 */ } }, 2000);
      delete this.nodes[k];
    },
    apply: function () {
      if (!this.on || !this.ensure()) return;
      var self = this, c = this.ctx;
      if (this.prefs.rain && !this.nodes.rain) {
        var src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
        var g = c.createGain(); g.gain.value = 0;
        src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(this.master);
        src.start();
        g.gain.setTargetAtTime(0.14, c.currentTime, 1.2);
        this.nodes.rain = { src: src, gain: g };
      } else if (!this.prefs.rain && this.nodes.rain) this.fadeOut('rain');
      clearTimeout(this.timers.music);
      if (this.prefs.music) {
        // 오르골: 느린 5음계 멜로디와 가끔 낮은 화음
        var scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
        var idx = 2, beat = 0;
        var tick = function () {
          if (!self.on || !self.prefs.music) return;
          idx = clamp(idx + Math.floor(Math.random() * 5) - 2, 0, scale.length - 1);
          self.tone(scale[idx], 0.045, 2.2, 'triangle');
          self.tone(scale[idx] * 2, 0.012, 1.2, 'sine');
          if (beat % 8 === 0) { self.tone(130.81, 0.03, 5, 'sine'); self.tone(196, 0.02, 5, 'sine'); }
          beat += 1;
          self.timers.music = setTimeout(tick, 650 + Math.random() * 700);
        };
        tick();
      }
    },
    env: function (g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    },
    tone: function (freq, peak, decay, type, when) {
      var c = this.ctx;
      var o = c.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
      var g = c.createGain();
      o.connect(g); g.connect(this.master);
      var t = c.currentTime + (when || 0);
      this.env(g, t, peak, 0.01, decay);
      o.start(t); o.stop(t + decay + 0.1);
    },
    bell: function () {
      if (!this.on || !this.prefs.bell || !this.ensure()) return;
      var self = this;
      [1046.5, 1318.5].forEach(function (f, i) {
        self.tone(f, 0.06, 2.6, 'sine', i * 0.12);
        self.tone(f * 2.76, 0.018, 1.2, 'sine', i * 0.12);
      });
    }
  };
  $('sound-btn').addEventListener('click', function () { audio.setOn(!audio.on); });
  document.querySelectorAll('[data-sound]').forEach(function (inp) {
    var k = inp.getAttribute('data-sound');
    inp.checked = !!audio.prefs[k];
    inp.addEventListener('change', function () { audio.setPref(k, inp.checked); });
  });
  document.addEventListener('visibilitychange', function () {
    if (!audio.ctx) return;
    if (document.hidden) audio.ctx.suspend(); else if (audio.on) audio.ctx.resume();
  });

  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3400);
  }

  // ---------- 사진 준비와 올리기 ----------
  // 기기에서 크기를 줄이고 JPEG로 다시 저장해요. 이때 위치 같은 촬영 정보(EXIF)가 빠져요.
  function prepPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = PS.LIMITS.photoMaxSide;
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var q = 0.86;
        (function attempt() {
          c.toBlob(function (b) {
            if (!b) { reject(new Error('encode')); return; }
            if (b.size > PS.LIMITS.photoMaxBytes && q > 0.45) { q -= 0.12; attempt(); return; }
            resolve({ blob: b, canvas: c, preview: URL.createObjectURL(b) });
          }, 'image/jpeg', q);
        })();
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function uploadPhoto(blob) {
    var u = apiUrl('api/photos');
    if (!u) return Promise.reject(new Error('no server'));
    return fetch(u, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .then(function (j) { return j.id; });
  }

  // ---------- 들어가기 화면 ----------
  function composeMessage() {
    var custom = (draft.custom || '').trim();
    if (custom) return custom;
    var name = (draft.name || '').trim();
    var phrase = PS.MESSAGES[draft.msgIdx];
    if (!phrase) return '';
    return name ? PS.vocative(name) + ' ' + phrase : phrase;
  }
  function buildEntry() {
    var mc = $('message-chips');
    PS.MESSAGES.forEach(function (m, i) {
      var b = el('button', 'chip', m);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.i = String(i);
      b.addEventListener('click', function () { draft.msgIdx = i; draft.custom = ''; $('message-custom').value = ''; syncEntry(); });
      mc.appendChild(b);
    });
    $('message-custom').addEventListener('input', function () { draft.custom = this.value; syncEntry(); });
    ['since', 'until'].forEach(function (id) {
      var sel = $(id);
      sel.appendChild(new Option(id === 'since' ? '처음 만난 해' : '떠난 해', ''));
      for (var y = thisYear; y >= 1990; y--) sel.appendChild(new Option(y + '년', String(y)));
      sel.addEventListener('change', function () { draft[id] = sel.value; });
    });
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
    $('pet-name').value = draft.name;
    $('pet-name').addEventListener('input', function () { draft.name = this.value; $('entry-err').hidden = true; syncEntry(); });
    $('photo-input').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      $('photo-empty').querySelector('b').textContent = '사진 준비 중…';
      prepPhoto(file).then(function (p) {
        if (draft.photo && draft.photo.preview) URL.revokeObjectURL(draft.photo.preview);
        draft.photo = p;
        syncEntry();
      }, function () {
        toast('이 사진은 열 수 없어요. 다른 사진을 골라 주세요.');
        syncEntry();
      });
    });
    $('photo-clear').addEventListener('click', function () {
      if (draft.photo && draft.photo.preview) URL.revokeObjectURL(draft.photo.preview);
      draft.photo = null;
      syncEntry();
    });
    $('entry-form').addEventListener('submit', function (e) { e.preventDefault(); enter(); });
    syncEntry();
  }
  function syncEntry() {
    var has = !!draft.photo;
    $('photo-preview').hidden = !has;
    if (has) $('photo-preview').src = draft.photo.preview;
    $('photo-empty').hidden = has;
    $('photo-empty').querySelector('b').textContent = '사진 고르기';
    $('photo-drop').classList.toggle('has-photo', has);
    $('photo-clear').hidden = !has;
    document.querySelectorAll('#message-chips .chip').forEach(function (b) {
      b.setAttribute('aria-checked', String(!draft.custom && b.dataset.i === String(draft.msgIdx)));
    });
    $('message-preview').textContent = has ? composeMessage() : '';
    $('message-field').hidden = !has;
    document.querySelectorAll('#species-chips .chip').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.id === draft.species)); });
    document.querySelectorAll('#color-swatches .swatch').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.id === draft.color)); });
    $('entry-hint').hidden = has || !!(state.joined && state.mine);
  }
  var previewWag = 0;
  $('preview').addEventListener('pointerdown', function () { previewWag = nowMs(); });
  (function previewLoop(now) {
    if (!$('entry').hidden) {
      var pv = $('preview');
      var c = pv.getContext('2d');
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (pv.width !== 120 * dpr) { pv.width = 120 * dpr; pv.height = 120 * dpr; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, 120, 120);
      var tt = (now || 0) / 1000;
      c.fillStyle = 'rgba(60,40,20,.15)';
      ellipse(c, 60, 104, 26, 7); c.fill();
      var wag = previewWag ? clamp(1 - ((now || 0) - previewWag) / 1400, 0, 1) : 0;
      drawPetFront(c, { species: draft.species, color: draft.color }, 60, 104, 66, {
        time: tt, phase: 0, bow: 0, wag: wag, walk: tt * 9, walking: Math.sin(tt * 0.6) > 0.2, flip: Math.sin(tt * 0.3) > 0 ? 1 : -1
      });
    }
    requestAnimationFrame(previewLoop);
  })();

  function showEntry(err, photoFocus) {
    closeSheet();
    $('entry').hidden = false;
    $('entry').scrollTop = 0;
    $('entry-err').hidden = !err;
    if (err) $('entry-err').textContent = err;
    $('enter-btn').textContent = state.joined ? (photoFocus ? '사진 올리기' : '이대로 다시 들어가기') : '추모관 들어가기';
    syncEntry();
  }

  var busy = false;
  function showErr(text) { $('entry-err').textContent = text; $('entry-err').hidden = false; }
  function enter() {
    if (busy) return;
    var check = PS.cleanName(draft.name);
    if (!check.ok) {
      showErr(check.reason === 'empty' ? '아이 이름을 적어 주세요.' : check.reason === 'chars' ? '이름에는 한글, 영문, 숫자만 쓸 수 있어요.' : '그 이름은 쓸 수 없어요. 다른 이름을 적어 주세요.');
      $('pet-name').focus();
      return;
    }
    var msg = PS.cleanMessage(composeMessage());
    if (draft.photo && !msg.ok) { showErr('한마디에 쓸 수 없는 말이 있어요. 다른 말로 바꿔 주세요.'); return; }
    var newPet = { name: check.name, species: draft.species, color: draft.color };
    var petChanged = !state.pet || state.pet.name !== newPet.name || state.pet.species !== newPet.species || state.pet.color !== newPet.color;
    state.pet = newPet;
    store.set('pet', newPet);
    var base = { message: msg.ok ? msg.text : '', since: draft.since ? parseInt(draft.since, 10) : null, until: draft.until ? parseInt(draft.until, 10) : null };
    var photo = draft.photo;
    var serverMode = !!wsUrl() && !net.local;
    var go = function (tribute) {
      busy = false;
      $('enter-btn').disabled = false;
      if (photo) { if (photo.preview) URL.revokeObjectURL(photo.preview); draft.photo = null; }
      $('entry').hidden = true;
      $('topbar').hidden = false;
      $('actions').hidden = false;
      audio.setOn(audio.on);
      if (document.activeElement) document.activeElement.blur();
      computeLayout();
      if (!state.joined) {
        state.joined = true;
        state.pendingTribute = tribute;
        net.start();
      } else if (petChanged) {
        state.pendingTribute = tribute;
        net.restart();
      } else if (tribute) {
        net.send(Object.assign({ t: 'tribute' }, tribute));
      }
    };
    if (!photo) { go(null); return; }
    if (!serverMode) {
      go(Object.assign({ photoUrl: photo.canvas.toDataURL('image/jpeg', 0.8) }, base));
      return;
    }
    busy = true;
    $('enter-btn').disabled = true;
    $('enter-btn').textContent = '사진 올리는 중…';
    uploadPhoto(photo.blob).then(function (id) {
      go(Object.assign({ photo: id }, base));
    }, function () {
      busy = false;
      $('enter-btn').disabled = false;
      $('enter-btn').textContent = state.joined ? '사진 올리기' : '추모관 들어가기';
      showErr('사진을 올리지 못했어요. 잠시 뒤 다시 하거나, 사진을 빼고 들어가 주세요.');
    });
  }

  function loadLiveCount() {
    getJson('api/stats').then(function (s) {
      if (!s || $('entry').hidden) return;
      if (s.online > 0) { $('live-n').textContent = String(s.online); $('live-count').hidden = false; }
    });
  }

  // ---------- 시작 ----------
  window.addEventListener('resize', resize);
  buildEntry();
  buildWords();
  resize();
  $('sound-btn').setAttribute('aria-pressed', String(audio.on));
  loadLiveCount();
  requestAnimationFrame(frame);
}());
