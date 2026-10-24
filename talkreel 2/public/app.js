const $ = (s) => document.querySelector(s);
const COLORS = ['#2f2be8', '#e8742b', '#0c8a5f', '#c81e57', '#8a4fff', '#0a8fb5'];
const EXAMPLE = `# Rooftop at dusk
MAYA (excited): We finally did it! One picture, one script.
LEO (calm): Told you it would work.
MAYA (laughing): Now make me sound dramatic.
NARRATOR: And so it began.`;

let token = localStorage.getItem('tr_token') || '';
let cfg, me;
const S = JSON.parse(localStorage.getItem('tr_state') || 'null') || { title: '', script: '', cast: [], aspect: '9:16', tier: 'draft', captions: true };
let est = null, estTimer = null, polling = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const saveState = () => localStorage.setItem('tr_state', JSON.stringify(S));

async function api(path, body, method) {
  const res = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'x-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
  return data;
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

function setMe(m) {
  if (!m) return;
  const before = me?.credits;
  me = m;
  $('#creditCount').textContent = m.credits;
  if (before != null && m.credits > before) { const c = $('#coinBtn'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  if (est) renderCost();
}

/* ---------- cast ---------- */
function resizeToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1024, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('That file is not a picture we can read.'));
    img.src = url;
  });
}

async function uploadFile(file) {
  const dataUrl = await resizeToJpeg(file);
  return api('/upload', { dataUrl });
}

function renderCast() {
  const ul = $('#cast');
  ul.replaceChildren(...S.cast.map((c, i) => {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr', 'aria-label': `Picture for ${c.name || 'character'}`, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const up = await uploadFile(f); c.imageId = up.id; c.url = up.url; saveState(); renderCast(); scheduleEstimate(); } catch (err) { toast(err.message); }
    } });
    const pic = h('button', { class: 'char-pic', type: 'button', 'aria-label': c.url ? `Change picture for ${c.name}` : 'Choose a picture', onclick: () => input.click() },
      c.url ? [h('img', { src: c.url, alt: c.name || 'Character' }), h('span', { class: 'swap' }, 'Change')] : 'Choose picture');
    return h('li', { class: 'char' }, pic, input, h('div', { class: 'char-fields' },
      h('input', { value: c.name, maxlength: 24, placeholder: 'Name, e.g. MAYA', 'aria-label': 'Character name', oninput: (e) => { c.name = e.target.value; saveState(); scheduleEstimate(); } }),
      h('select', { 'aria-label': 'Voice', onchange: (e) => { c.voice = e.target.value; saveState(); } },
        cfg.voices.map((v) => h('option', { value: v, selected: v === c.voice }, v[0].toUpperCase() + v.slice(1) + ' voice'))),
      h('button', { class: 'rm', type: 'button', onclick: () => { S.cast.splice(i, 1); saveState(); renderCast(); scheduleEstimate(); } }, 'Remove')));
  }));
  $('#addCharBtn').disabled = S.cast.length >= cfg.limits.maxCharacters;
  $('#castHint').textContent = S.cast.length ? 'Each speaker in your script needs a picture. Faces stay the same in every shot.' : 'Add a character, or try the sample cast to see how it works.';
}

async function sampleCast() {
  $('#sampleBtn').disabled = true;
  try {
    const list = [['Maya', 'maya', 'bright'], ['Leo', 'leo', 'deep']];
    S.cast = [];
    for (const [name, file, voice] of list) {
      const blob = await (await fetch(`/samples/${file}.jpg`)).blob();
      const up = await uploadFile(blob);
      S.cast.push({ name, voice, imageId: up.id, url: up.url });
    }
    if (!S.script.trim()) { S.script = EXAMPLE; $('#script').value = S.script; }
    if (!S.title) { S.title = 'Rooftop at dusk'; $('#title').value = S.title; }
    saveState(); renderCast(); scheduleEstimate();
  } catch (e) { toast(e.message); }
  $('#sampleBtn').disabled = false;
}

/* ---------- estimate / storyboard ---------- */
function body() {
  return { title: S.title, script: S.script, cast: S.cast.filter((c) => c.imageId).map(({ name, imageId, voice }) => ({ name, imageId, voice })), aspect: S.aspect, tier: S.tier, captions: S.captions, consent: $('#consent').checked };
}
function scheduleEstimate() { clearTimeout(estTimer); estTimer = setTimeout(runEstimate, 350); }
async function runEstimate() {
  try { est = await api('/estimate', body()); } catch (e) { if (e.status === 401) return resetSession(); est = null; }
  renderShots(); renderCost();
}
function colorOf(name) {
  const names = [...new Set([...S.cast.map((c) => c.name.toLowerCase()), 'narrator'])];
  return COLORS[Math.max(0, names.indexOf(name.toLowerCase())) % COLORS.length];
}
function renderShots(live) {
  const ol = $('#shots');
  const shots = live || est?.shots || [];
  $('#totalTime').textContent = `${live ? live.reduce((a, s) => a + s.seconds, 0) : est?.totalSeconds || 0}s`;
  const wl = $('#warnings');
  wl.replaceChildren(...(est?.warnings || []).map((w) => h('li', {}, `Line ${w.line}: ${w.msg}`)));
  if (!shots.length) { ol.replaceChildren(h('li', { class: 'empty' }, 'Your shots appear here as you type.')); return; }
  let lastScene = null;
  const items = [];
  for (const s of shots) {
    if (s.scene && s.scene !== lastScene) { items.push(h('li', { class: 'scene' }, s.scene)); lastScene = s.scene; }
    items.push(h('li', { 'data-st': s.status || '' },
      h('span', { class: 'bar', style: `--c:${colorOf(s.speaker)}` }),
      h('div', {}, h('div', { class: 'who' }, s.speaker + (s.emotion ? ` · ${s.emotion}` : '')), h('div', { class: 'txt' }, s.text)),
      h('div', { class: 'meta' }, `${s.seconds}s`)));
  }
  ol.replaceChildren(...items);
}
function renderCost() {
  const cost = est?.cost || 0;
  $('#costN').textContent = cost;
  const short = cost > me.credits;
  $('#costNote').textContent = short ? `You have ${me.credits}. Earn ${cost - me.credits} more or pick a lower quality.` : cost ? `${me.credits - cost} left after this video` : '';
  $('#goBtn').textContent = short ? 'Get credits to continue' : 'Make video';
}
function renderTiers() {
  const box = $('#tiers');
  box.replaceChildren(...Object.entries(cfg.tierInfo).map(([k, t]) =>
    h('button', { class: 'tier', role: 'radio', 'aria-checked': String(S.tier === k), onclick: () => { S.tier = k; saveState(); renderTiers(); scheduleEstimate(); } },
      h('span', {}, h('b', {}, t.label), h('small', {}, t.note)), h('span', { class: 'rate' }, `${cfg.costPerSecond[k]} credits/sec`))));
}
function renderAspect() {
  document.querySelectorAll('#aspect button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === S.aspect)));
}

/* ---------- generate ---------- */
async function generate() {
  const err = $('#goErr'); err.textContent = '';
  if (!est) await runEstimate();
  if (est && est.cost > me.credits) return openEarn();
  if (!$('#consent').checked) { err.textContent = 'Tick the box to confirm you can use these pictures.'; return; }
  $('#goBtn').disabled = true;
  try {
    const r = await api('/jobs', body());
    setMe(r.me);
    showJob(r.job);
    poll(r.job.id);
  } catch (e) { err.textContent = e.message; if (e.status === 402) openEarn(); }
  $('#goBtn').disabled = false;
}
function poll(id) {
  clearInterval(polling);
  polling = setInterval(async () => {
    try {
      const r = await api('/jobs/' + id);
      setMe(r.me); showJob(r.job);
      if (r.job.status === 'done' || r.job.status === 'failed') { clearInterval(polling); loadHistory(); if (r.job.status === 'done') toast('Your video is ready.'); }
    } catch { clearInterval(polling); }
  }, 1500);
}
function showJob(j) {
  const card = $('#resultCard'); card.hidden = false;
  const b = $('#resultBody');
  if (j.status === 'done') {
    b.replaceChildren(
      h('video', { src: j.video, controls: true, playsinline: true, poster: j.thumb }),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-main', href: j.video, download: (j.title || 'talkreel') + '.mp4', style: 'width:auto' }, 'Download video'),
        h('button', { class: 'btn btn-quiet', onclick: () => navigator.clipboard?.writeText(location.origin + j.video).then(() => toast('Link copied.')) }, 'Copy link')),
      j.provider === 'mock' ? h('p', { class: 'note' }, 'This build uses the preview engine: your pictures are animated with captions and a placeholder voice. Connect a hosted video model (see the README) for real speech and lip sync.') : null);
    renderShots(j.shots);
  } else if (j.status === 'failed') {
    b.replaceChildren(h('p', { class: 'err' }, `This video could not be made. ${j.error || ''}`), h('p', { class: 'muted' }, `Your ${j.cost} credits were returned.`));
  } else {
    b.replaceChildren(h('p', {}, h('b', {}, j.stage), ` · ${j.shots.filter((s) => s.status === 'done').length} of ${j.shots.length} shots`),
      h('div', { class: 'prog', role: 'progressbar', 'aria-valuenow': j.progress, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${j.progress}%` })));
    renderShots(j.shots);
  }
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function loadHistory() {
  try {
    const { jobs } = await api('/jobs');
    const done = jobs.filter((j) => j.status === 'done');
    $('#histCard').hidden = !done.length;
    $('#hist').replaceChildren(...done.map((j) => h('li', {}, h('button', { onclick: () => showJob(j), 'aria-label': `Open ${j.title}` }, h('img', { src: j.thumb, alt: '' }), h('b', {}, j.title)))));
  } catch {}
}

/* ---------- earn ---------- */
function renderEarn() {
  const a = me.ads;
  $('#adInfo').textContent = `+${a.reward} credits per ad. ${a.watchedToday} of ${a.dailyCap} watched today.`;
  $('#adBtn').disabled = a.watchedToday >= a.dailyCap;
  $('#tasks').replaceChildren(...me.tasks.map((t) => {
    const li = h('li', { class: 'task' + (t.done ? ' done' : '') },
      h('div', {}, h('b', {}, t.title), h('div', { class: 'muted' }, t.desc)),
      h('div', {}, t.done ? h('span', { class: 'muted' }, 'Claimed') : h('span', { class: 'reward' }, `+${t.reward}`)));
    if (!t.done) {
      const input = t.input ? h('input', { placeholder: t.input === 'name' ? 'Your name' : 'Your idea', 'aria-label': t.title, required: true }) : null;
      li.append(h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await api(`/tasks/${t.id}/claim`, { value: input?.value }); setMe(r.me); toast(`+${r.reward} credits`); renderEarn(); }
        catch (err) { toast(err.message); }
      } }, input, h('button', { class: 'btn btn-quiet', type: 'submit' }, input ? 'Send' : 'Claim')));
    }
    return li;
  }));
  const link = `${location.origin}/?ref=${me.refCode}`;
  $('#refLink').value = link;
  $('#refInfo').textContent = `You both get credits when they join: +${cfg.referral.referrerReward} for you, +${cfg.referral.refereeReward} for them (up to ${cfg.referral.maxPerUser} friends). ${me.invites} joined so far.`;
  const names = { signup_bonus: 'Welcome bonus', ad_reward: 'Watched an ad', video: 'Made a video', refund_failed_job: 'Refund for a failed video', referral_reward: 'Friend joined', referral_welcome: 'Invite bonus' };
  $('#ledger').replaceChildren(...me.ledger.map((l) => h('li', {}, h('span', {}, names[l.reason] || l.reason.replace(/^task_/, '').replaceAll('_', ' ')), h('b', { class: l.delta > 0 ? 'pos' : '' }, (l.delta > 0 ? '+' : '') + l.delta))));
}
function openEarn() { renderEarn(); $('#earn').showModal(); }

let adTimer;
async function watchAd() {
  $('#adErr').textContent = '';
  let s;
  try { s = await api('/ads/start', {}); } catch (e) { $('#adErr').textContent = e.message; return; }
  const dlg = $('#adDlg'), fill = $('#adFill'), left = $('#adLeft');
  let finished = false;
  fill.style.width = '0%';
  dlg.showModal();
  const t0 = Date.now();
  adTimer = setInterval(async () => {
    const el = Date.now() - t0;
    fill.style.width = Math.min(100, (el / s.minWatchMs) * 100) + '%';
    left.textContent = `Reward in ${Math.max(0, Math.ceil((s.minWatchMs - el) / 1000))}s`;
    if (el >= s.minWatchMs + 300 && !finished) {
      finished = true; clearInterval(adTimer);
      try { const r = await api('/ads/complete', { nonce: s.nonce }); setMe(r.me); toast(`+${r.reward} credits`); }
      catch (e) { toast(e.message); }
      dlg.close(); renderEarn();
    }
  }, 250);
  $('#adClose').onclick = () => { if (!finished) { clearInterval(adTimer); dlg.close(); toast('Closed early, so no credits were added.'); } };
  dlg.addEventListener('cancel', () => clearInterval(adTimer), { once: true });
}

/* ---------- boot ---------- */
async function resetSession() { localStorage.removeItem('tr_token'); token = ''; S.cast = []; await boot(); }

async function boot() {
  cfg = await (await fetch('/api/config')).json();
  const ref = new URLSearchParams(location.search).get('ref');
  const r = await api('/session', { ref });
  token = r.token; localStorage.setItem('tr_token', token);
  if (ref) history.replaceState(null, '', '/');
  setMe(r.me);
  const eb = $('#engineBadge');
  eb.hidden = false; eb.textContent = cfg.provider === 'mock' ? 'Preview engine' : 'Live engine: ' + cfg.provider;
  $('#title').value = S.title; $('#script').value = S.script;
  $('#captions').checked = S.captions;
  renderTiers(); renderAspect(); renderCast(); loadHistory(); runEstimate();
}

$('#title').addEventListener('input', (e) => { S.title = e.target.value; saveState(); });
$('#script').addEventListener('input', (e) => { S.script = e.target.value; saveState(); scheduleEstimate(); });
$('#captions').addEventListener('change', (e) => { S.captions = e.target.checked; saveState(); });
$('#aspect').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.aspect = b.dataset.v; saveState(); renderAspect(); } });
$('#addCharBtn').addEventListener('click', () => { S.cast.push({ name: '', voice: 'warm', imageId: '', url: '' }); saveState(); renderCast(); });
$('#sampleBtn').addEventListener('click', sampleCast);
$('#exampleBtn').addEventListener('click', () => { S.script = EXAMPLE; $('#script').value = EXAMPLE; saveState(); scheduleEstimate(); });
$('#goBtn').addEventListener('click', generate);
$('#earnBtn').addEventListener('click', openEarn);
$('#coinBtn').addEventListener('click', openEarn);
$('#adBtn').addEventListener('click', watchAd);
$('#copyRef').addEventListener('click', () => navigator.clipboard?.writeText($('#refLink').value).then(() => toast('Invite link copied.')));

boot().catch((e) => toast(e.message));
