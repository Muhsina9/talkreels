import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, PORT, ECON } from './config.js';
import { db, save, uid } from './store.js';
import { createUser, spend, adStatus, startAd, completeAd, claimTask, taskList } from './economy.js';
import { parseScript, priceShots, norm } from './script.js';
import { enqueue, providerName } from './pipeline.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.json': 'application/json' };
const VOICES = ['warm', 'bright', 'deep', 'soft'];
const ASPECTS = ['9:16', '16:9', '1:1'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readJson(req, limit = 8 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'That file is too large.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Request was not valid JSON.'); }
}

function authed(req) {
  const t = req.headers['x-token'];
  const id = t && db.tokens[t];
  const user = id && db.users[id];
  if (!user) throw new HttpError(401, 'Your session expired. Reload the page.');
  return user;
}

function publicUser(u) {
  return {
    name: u.name, credits: u.credits, refCode: u.refCode, invites: u.invites,
    ads: adStatus(u), tasks: taskList(u), ledger: u.ledger.slice(0, 15),
  };
}

function publicJob(j) {
  const { userId, cast, ...rest } = j;
  return { ...rest, cast: cast.map((c) => ({ name: c.name, voice: c.voice })) };
}

function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

// Builds a validated, priced plan from the request. Used for both estimate and create.
function plan(user, body) {
  const L = ECON.limits;
  const script = String(body.script || '').slice(0, L.maxScriptChars);
  const tier = ECON.costPerSecond[body.tier] ? body.tier : 'draft';
  const aspect = ASPECTS.includes(body.aspect) ? body.aspect : '9:16';
  const castIn = Array.isArray(body.cast) ? body.cast.slice(0, L.maxCharacters) : [];
  const cast = [];
  for (const c of castIn) {
    const name = String(c.name || '').trim().slice(0, 24);
    const up = db.uploads[c.imageId];
    if (!name || !up || up.userId !== user.id) continue;
    if (cast.some((x) => norm(x.name) === norm(name))) continue;
    cast.push({ name, imageId: c.imageId, voice: VOICES.includes(c.voice) ? c.voice : 'warm' });
  }
  const parsed = parseScript(script, cast.map((c) => c.name));
  const cost = priceShots(parsed.shots, tier);
  return { script, tier, aspect, cast, ...parsed, cost, captions: body.captions !== false, style: String(body.style || '').slice(0, 120) };
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/config') {
    return send(res, 200, { provider: providerName, costPerSecond: ECON.costPerSecond, tierInfo: ECON.tierInfo, limits: ECON.limits, ad: ECON.ad, referral: ECON.referral, voices: VOICES });
  }
  if (route === 'POST /api/session') {
    const body = await readJson(req);
    const t = req.headers['x-token'];
    if (t && db.tokens[t] && db.users[db.tokens[t]]) return send(res, 200, { token: t, me: publicUser(db.users[db.tokens[t]]) });
    const { user, token } = createUser({ ref: body.ref });
    return send(res, 200, { token, me: publicUser(user) });
  }

  const user = authed(req);

  if (route === 'GET /api/me') return send(res, 200, publicUser(user));

  if (route === 'POST /api/upload') {
    const body = await readJson(req);
    const m = /^data:image\/(?:jpeg|png);base64,(.+)$/.exec(body.dataUrl || '');
    if (!m) throw new HttpError(400, 'Upload a JPG or PNG picture.');
    const buf = Buffer.from(m[1], 'base64');
    const ext = sniffImage(buf);
    if (!ext || buf.length > 6 * 1024 * 1024) throw new HttpError(400, 'Upload a JPG or PNG picture under 6 MB.');
    if (Object.values(db.uploads).filter((u) => u.userId === user.id).length >= 40) throw new HttpError(400, 'Upload limit reached.');
    const id = uid(8);
    const file = `${id}.${ext}`;
    const dir = path.join(DATA_DIR, 'uploads', user.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), buf);
    db.uploads[id] = { userId: user.id, file };
    save();
    return send(res, 200, { id, url: `/uploads/${user.id}/${file}` });
  }

  if (route === 'POST /api/estimate') {
    const p = plan(user, await readJson(req));
    return send(res, 200, { shots: p.shots, warnings: p.warnings, totalSeconds: p.totalSeconds, cost: p.cost, canAfford: user.credits >= p.cost });
  }

  if (route === 'POST /api/jobs') {
    const body = await readJson(req);
    if (body.consent !== true) throw new HttpError(400, 'Confirm you have the right to use these pictures.');
    const active = Object.values(db.jobs).filter((j) => j.userId === user.id && (j.status === 'queued' || j.status === 'running'));
    if (active.length) throw new HttpError(429, 'One video at a time. Wait for the current one to finish.');
    const p = plan(user, body);
    const L = ECON.limits;
    if (!p.cast.length) throw new HttpError(400, 'Add at least one character with a picture.');
    if (!p.shots.length) throw new HttpError(400, 'Write at least one line of dialogue.');
    if (p.warnings.some((w) => w.msg.includes('no character picture'))) throw new HttpError(400, 'Every speaker needs a character picture. Check the warnings.');
    if (p.shots.length > L.maxShots) throw new HttpError(400, `Too many shots (${p.shots.length}). The limit is ${L.maxShots}.`);
    if (p.totalSeconds > L.maxSecondsPerVideo) throw new HttpError(400, `Too long (${p.totalSeconds}s). The limit is ${L.maxSecondsPerVideo}s.`);
    if (!spend(user, p.cost, 'video', {})) throw new HttpError(402, `You need ${p.cost} credits and have ${user.credits}. Earn more or pick a cheaper quality.`);
    const id = uid(9);
    db.jobs[id] = {
      id, userId: user.id, title: String(body.title || 'Untitled video').slice(0, 60), created: Date.now(),
      status: 'queued', stage: 'Waiting for a free slot', progress: 0, tier: p.tier, aspect: p.aspect,
      captions: p.captions, style: p.style, cast: p.cast, cost: p.cost, totalSeconds: p.totalSeconds,
      shots: p.shots.map((s) => ({ ...s, status: 'pending' })), provider: providerName,
    };
    save();
    enqueue(id);
    return send(res, 200, { job: publicJob(db.jobs[id]), me: publicUser(user) });
  }

  if (route === 'GET /api/jobs') {
    const mine = Object.values(db.jobs).filter((j) => j.userId === user.id).sort((a, b) => b.created - a.created).slice(0, 20);
    return send(res, 200, { jobs: mine.map(publicJob) });
  }
  const jm = /^\/api\/jobs\/([\w-]+)$/.exec(url.pathname);
  if (jm && req.method === 'GET') {
    const j = db.jobs[jm[1]];
    if (!j || j.userId !== user.id) throw new HttpError(404, 'Video not found.');
    return send(res, 200, { job: publicJob(j), me: publicUser(user) });
  }

  if (route === 'POST /api/ads/start') {
    const r = startAd(user);
    return send(res, r.error ? 429 : 200, r);
  }
  if (route === 'POST /api/ads/complete') {
    const body = await readJson(req);
    const r = completeAd(user, String(body.nonce || ''));
    return send(res, r.error ? 400 : 200, { ...r, me: publicUser(user) });
  }
  const tm = /^\/api\/tasks\/(\w+)\/claim$/.exec(url.pathname);
  if (tm && req.method === 'POST') {
    const body = await readJson(req);
    const r = claimTask(user, tm[1], body, (user.finished || 0) > 0);
    return send(res, r.error ? 400 : 200, { ...r, me: publicUser(user) });
  }

  throw new HttpError(404, 'Not found.');
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': file.startsWith(DATA_DIR) ? 'private, max-age=3600' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const inside = (base, target) => target === base || target.startsWith(base + path.sep);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let rel = decodeURIComponent(url.pathname);
    let base = PUBLIC, file;
    if (rel.startsWith('/media/') || rel.startsWith('/uploads/')) { base = path.join(DATA_DIR); file = path.join(base, rel); }
    else file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
    file = path.normalize(file);
    if (!inside(base, file)) { res.writeHead(403); return res.end('Forbidden'); }
    return serveFile(req, res, file);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Something went wrong on our side. Try again.' : e.message });
  }
}).listen(PORT, () => console.log(`TalkReel running at http://localhost:${PORT} (engine: ${providerName})`));
