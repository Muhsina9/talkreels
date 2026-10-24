// End-to-end check against a running server: node test/e2e.mjs  (server started with AD_MIN_MS=1500 AD_COOLDOWN_MS=1000)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const B = process.env.BASE || 'http://localhost:8787';
let token = '', fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (p, body) => {
  const r = await fetch(B + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-token': token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await api('/session', {});
token = s.token;
ok(s.me.credits === 30, 'signup bonus is 30 credits');

const up = async (f) => (await api('/upload', { dataUrl: 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64') }));
const maya = await up('public/samples/maya.jpg'), leo = await up('public/samples/leo.jpg');
ok(maya.id && leo.id, 'uploads accepted');
const bad = await api('/upload', { dataUrl: 'data:image/jpeg;base64,' + Buffer.from('not an image').toString('base64') });
ok(bad.status === 400, 'non-image upload rejected');

const body = { title: 'Test', aspect: '9:16', tier: 'draft', captions: true, consent: true,
  cast: [{ name: 'Maya', imageId: maya.id, voice: 'bright' }, { name: 'Leo', imageId: leo.id, voice: 'deep' }],
  script: '# Roof\nMAYA (excited): We did it!\nLEO: Told you.\nNARRATOR: The end.' };
const est = await api('/estimate', body);
ok(est.shots.length === 3 && est.cost > 0, `estimate: ${est.shots.length} shots, ${est.cost} credits, ${est.totalSeconds}s`);
const unk = await api('/estimate', { ...body, script: 'ZED: hi there' });
ok(unk.warnings.length === 1, 'unknown speaker gives a warning');
const noConsent = await api('/jobs', { ...body, consent: false });
ok(noConsent.status === 400, 'consent required');
const tooPricey = await api('/jobs', { ...body, tier: 'premium', script: 'MAYA: ' + 'word '.repeat(60) });
ok(tooPricey.status === 402, 'insufficient credits blocked (402)');

const job = await api('/jobs', body);
ok(['queued','running'].includes(job.job?.status) && job.me.credits === 30 - est.cost, 'credits charged up front');
const second = await api('/jobs', body);
ok(second.status === 429, 'only one active video at a time');
let j;
for (let i = 0; i < 90; i++) { await sleep(1000); j = (await api('/jobs/' + job.job.id)).job; if (['done', 'failed'].includes(j.status)) break; }
ok(j.status === 'done', 'job finished: ' + j.status + (j.error ? ' ' + j.error : ''));
if (j.status === 'done') {
  const buf = Buffer.from(await (await fetch(B + j.video)).arrayBuffer());
  fs.mkdirSync('test/out', { recursive: true }); fs.writeFileSync('test/out/final.mp4', buf);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', 'test/out/final.mp4']));
  const types = probe.streams.map((x) => x.codec_type).sort().join(',');
  ok(types === 'audio,video', 'mp4 has audio and video streams');
  ok(Math.abs(Number(probe.format.duration) - j.totalSeconds) < 1.2, `duration ${Number(probe.format.duration).toFixed(1)}s ~ planned ${j.totalSeconds}s`);
  const v = probe.streams.find((x) => x.codec_type === 'video');
  ok(v.height > v.width, `vertical ${v.width}x${v.height}`);
  const r = await fetch(B + j.video, { headers: { Range: 'bytes=0-99' } });
  ok(r.status === 206, 'range requests work (seeking)');
}

// credits economy
let me = (await api('/me'));
const ad1 = await api('/ads/start', {});
const early = await api('/ads/complete', { nonce: ad1.nonce });
ok(early.status === 400, 'ad completed too early gets nothing');
await sleep(1200);
const ad2 = await api('/ads/start', {});
await sleep((ad2.minWatchMs || 1500) + 300);
const before = (await api('/me')).credits;
const done = await api('/ads/complete', { nonce: ad2.nonce });
ok(done.reward === 6 && done.me.credits === before + 6, 'full ad grants 6 credits');
const replay = await api('/ads/complete', { nonce: ad2.nonce });
ok(replay.status === 400, 'ad nonce cannot be replayed');
const ci = await api('/tasks/daily_checkin/claim', {});
ok(ci.reward === 4, 'daily check-in grants credits');
const ci2 = await api('/tasks/daily_checkin/claim', {});
ok(ci2.status === 400, 'daily check-in only once a day');
const sh = await api('/tasks/first_share/claim', {});
ok(sh.reward === 10, 'first_share unlocked after a finished video');
const ref = await fetch(B + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: (await api('/me')).refCode }) }).then((r) => r.json());
ok(ref.me.credits === 40, 'referral gives the new user +10');
const trav = await fetch(B + '/media/..%2f..%2fdb.json');
ok(trav.status !== 200, 'path traversal blocked (' + trav.status + ')');
console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
