'use strict';
// 꼬리별 추모관 서버: 정적 파일 + 사진 올리기 + 실시간(WebSocket) 추모실. `node server.js` 로 실행해요.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Hub } = require('./lib/hub');
const S = require('./public/shared.js');

const env = process.env;
const PORT = parseInt(env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PHOTO_UPLOADS_PER_10MIN = parseInt(env.PHOTO_UPLOADS_PER_10MIN || '12', 10);
const TRUST_PROXY = env.TRUST_PROXY === '1' || !!env.RENDER || !!env.FLY_APP_NAME;
// 회사·통신사는 여러 사람이 IP 하나를 같이 써요. 너무 낮추면 같은 사무실 사람이 못 들어와요.
const MAX_CONN_PER_IP = parseInt(env.MAX_CONN_PER_IP || '60', 10);
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MSG_BURST = 40; // 5초 안에 이보다 많이 보내면 연결을 끊어요

const hub = new Hub({
  capacity: env.ROOM_CAPACITY,
  maxRooms: env.MAX_ROOMS,
  reportsToHide: env.REPORTS_TO_HIDE,
  tributeTtlMs: (parseFloat(env.TRIBUTE_TTL_DAYS || '7') || 7) * 24 * 60 * 60 * 1000
});

// ---------- 저장 (추모 카드와 하루 통계는 state.json, 사진은 photos/ 폴더) ----------
function loadState() {
  try {
    hub.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    console.log(`[state] loaded ${hub.tributes.size} tributes`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[state] load failed:', e.message);
  }
}
function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(hub.toJSON()));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.warn('[state] save failed:', e.message);
  }
}
function removePhotos(ids) {
  for (const id of ids) {
    if (!S.PHOTO_ID.test(id)) continue;
    fs.unlink(path.join(PHOTO_DIR, id + '.jpg'), () => {});
  }
}
function cleanupPhotoDir() {
  try {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const keep = hub.keptPhotos();
    const stale = fs.readdirSync(PHOTO_DIR).map((f) => f.replace(/\.jpg$/, '')).filter((id) => !keep.has(id));
    removePhotos(stale);
  } catch (e) {
    console.warn('[photos] cleanup failed:', e.message);
  }
}
loadState();
cleanupPhotoDir();

// ---------- 정적 파일 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'SAMEORIGIN'
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function originOf(req) {
  const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function sendJson(res, status, body, extra) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  }, SECURITY_HEADERS, extra || {}));
  res.end(data);
}

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(400); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
      res.end('찾는 페이지가 없어요.');
      return;
    }
    const ext = path.extname(file);
    let body = buf;
    if (ext === '.html') {
      // 공유 미리보기(OG) 이미지는 절대 주소여야 해서 요청한 주소로 바꿔 넣어요.
      body = buf.toString('utf8').replace(/content="og\.png"/g, `content="${originOf(req)}/og.png"`);
    }
    const cache = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest'
      ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache }, SECURITY_HEADERS));
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from('Bearer ' + ADMIN_TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function readBody(req, limit = 2048, raw = false) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { const b = Buffer.concat(chunks); resolve(raw ? b : b.toString('utf8')); });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.warn('[http] error:', e.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' }); else res.end();
  });
});

// ---------- 사진 ----------
// 브라우저가 미리 줄이고 다시 저장한 JPEG만 받아요(위치 정보 같은 EXIF가 빠져요).
const uploadsPerIp = new Map();
async function uploadPhoto(req, res) {
  const ip = clientIp(req);
  const t = Date.now();
  const recent = (uploadsPerIp.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000);
  if (recent.length >= PHOTO_UPLOADS_PER_10MIN) { sendJson(res, 429, { error: 'too many' }); return; }
  if (!/^image\/jpeg\b/.test(String(req.headers['content-type'] || ''))) { sendJson(res, 415, { error: 'jpeg only' }); return; }
  let buf;
  try { buf = await readBody(req, S.LIMITS.photoMaxBytes, true); } catch (e) { sendJson(res, 413, { error: 'too large' }); return; }
  if (buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) { sendJson(res, 400, { error: 'not a jpeg' }); return; }
  const id = crypto.randomBytes(8).toString('hex');
  try {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(path.join(PHOTO_DIR, id + '.jpg'), buf);
  } catch (e) {
    sendJson(res, 500, { error: 'save failed' });
    return;
  }
  recent.push(t);
  uploadsPerIp.set(ip, recent);
  hub.registerPhoto(id);
  sendJson(res, 200, { id });
}

function servePhoto(req, res, id) {
  if (!hub.photoAllowed(id)) { res.writeHead(404, SECURITY_HEADERS); res.end(); return; }
  fs.readFile(path.join(PHOTO_DIR, id + '.jpg'), (err, buf) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); res.end(); return; }
    res.writeHead(200, Object.assign({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src 'none'"
    }, SECURITY_HEADERS));
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
    res.end();
    return;
  }
  if (p === '/healthz') { sendJson(res, 200, { ok: true }); return; }
  if (p === '/api/stats') { sendJson(res, 200, Object.assign(hub.stats(), hub.roomList())); return; }
  if (p === '/api/tributes') {
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
    sendJson(res, 200, { tributes: hub.recentTributes(limit) });
    return;
  }
  if (p === '/api/photos' && req.method === 'POST') { await uploadPhoto(req, res); return; }
  const photo = /^\/photos\/([a-f0-9]{16})\.jpg$/.exec(p);
  if (photo) { servePhoto(req, res, photo[1]); return; }
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    if (p === '/api/admin/stats') {
      sendJson(res, 200, { now: hub.stats(), days: hub.dailyHistory() });
      return;
    }
    if (p === '/api/admin/hide' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, { hidden: hub.hide(String(body.id || '')) });
      } catch (e) {
        sendJson(res, 400, { error: 'bad request' });
      }
      return;
    }
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, p);
}

// ---------- 실시간 ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
const connPerIp = new Map();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin) && origin !== originOf(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const ip = clientIp(req);
  if ((connPerIp.get(ip) || 0) >= MAX_CONN_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
});

wss.on('connection', (ws, req, ip) => {
  connPerIp.set(ip, (connPerIp.get(ip) || 0) + 1);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let peerId = null;
  let windowStart = Date.now();
  let count = 0;
  const send = (str) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 512 * 1024) { ws.terminate(); return; }
    ws.send(str);
  };

  ws.on('message', (data, isBinary) => {
    const t = Date.now();
    if (t - windowStart > 5000) { windowStart = t; count = 0; }
    count += 1;
    if (count > MSG_BURST || isBinary) { ws.close(4008, 'slow down'); return; }
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (!peerId) {
      if (msg.t !== 'hello') return;
      const r = hub.join(send, msg, { ip });
      if (r.error) {
        send(JSON.stringify({ t: 'error', code: r.error }));
        if (r.error === 'full') ws.close(4003, 'full');
        return;
      }
      peerId = r.peer.id;
      return;
    }
    hub.handle(peerId, msg);
  });

  ws.on('close', () => {
    const n = (connPerIp.get(ip) || 1) - 1;
    if (n <= 0) connPerIp.delete(ip); else connPerIp.set(ip, n);
    if (peerId) hub.leave(peerId);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* 이미 끊긴 연결 */ }
  }
}, 25000);

setInterval(() => {
  const t = Date.now();
  for (const [ip, list] of uploadsPerIp) if (!list.some((x) => t - x < 10 * 60 * 1000)) uploadsPerIp.delete(ip);
}, 10 * 60 * 1000).unref();

const statsTimer = setInterval(() => {
  hub._rollDay();
  hub._broadcastAll({ t: 'stats', stats: hub.stats() });
}, 10000);

const housekeeping = setInterval(() => { removePhotos(hub.prune()); saveState(); }, 60000);

server.listen(PORT, () => {
  console.log(`꼬리별 추모관 서버가 http://localhost:${PORT} 에서 기다리는 중 (추모실당 ${hub.capacity}명)`);
  if (!ADMIN_TOKEN) console.log('[admin] ADMIN_TOKEN 이 없어서 관리자 API는 꺼져 있어요.');
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(statsTimer);
  clearInterval(housekeeping);
  saveState();
  for (const ws of wss.clients) ws.close(1012, 'restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
