// Credits: every change goes through grant()/spend() so the ledger always explains the balance.
import { ECON } from './config.js';
import { db, save, uid, today } from './store.js';

export function grant(user, amount, reason, meta = {}) {
  user.credits += amount;
  user.ledger.unshift({ at: Date.now(), delta: amount, reason, ...meta });
  user.ledger.length = Math.min(user.ledger.length, 200);
  save();
}

export function spend(user, amount, reason, meta = {}) {
  if (user.credits < amount) return false;
  user.credits -= amount;
  user.ledger.unshift({ at: Date.now(), delta: -amount, reason, ...meta });
  user.ledger.length = Math.min(user.ledger.length, 200);
  save();
  return true;
}

export function createUser({ ref } = {}) {
  const id = uid(8);
  const token = uid(24);
  const user = {
    id, created: Date.now(), name: '', credits: 0, ledger: [],
    refCode: uid(4).toUpperCase().replace(/[^A-Z0-9]/g, 'X'),
    invitedBy: null, invites: 0,
    ads: { day: today(), count: 0, lastAt: 0, pending: null },
    tasks: {},
  };
  db.users[id] = user;
  db.tokens[token] = id;
  db.refCodes[user.refCode] = id;
  grant(user, ECON.signupBonus, 'signup_bonus');
  const referrer = ref && db.users[db.refCodes[String(ref).toUpperCase()]];
  if (referrer && referrer.invites < ECON.referral.maxPerUser) {
    user.invitedBy = referrer.id;
    referrer.invites += 1;
    grant(user, ECON.referral.refereeReward, 'referral_welcome');
    grant(referrer, ECON.referral.referrerReward, 'referral_reward', { friend: id });
  }
  return { user, token };
}

function rollDay(user) {
  if (user.ads.day !== today()) user.ads = { day: today(), count: 0, lastAt: user.ads.lastAt, pending: null };
}

export function adStatus(user) {
  rollDay(user);
  const wait = Math.max(0, user.ads.lastAt + ECON.ad.cooldownMs - Date.now());
  return { watchedToday: user.ads.count, dailyCap: ECON.ad.dailyCap, cooldownMs: wait, reward: ECON.ad.reward };
}

export function startAd(user) {
  rollDay(user);
  if (user.ads.count >= ECON.ad.dailyCap) return { error: 'Daily ad limit reached. It resets tomorrow.' };
  const wait = user.ads.lastAt + ECON.ad.cooldownMs - Date.now();
  if (wait > 0) return { error: `Next ad is ready in ${Math.ceil(wait / 1000)}s.` };
  const nonce = uid(12);
  user.ads.pending = { nonce, startedAt: Date.now() };
  save();
  return { nonce, minWatchMs: ECON.ad.minWatchMs };
}

// With a real network (AdMob/AppLovin/etc.) this check is replaced by their server-to-server
// reward callback. The nonce, cooldown and daily cap stay the same.
export function completeAd(user, nonce) {
  rollDay(user);
  const p = user.ads.pending;
  if (!p || p.nonce !== nonce) return { error: 'This ad session is not valid.' };
  user.ads.pending = null;
  if (Date.now() - p.startedAt < ECON.ad.minWatchMs - 500) return { error: 'The ad was closed before it finished, so no credits were added.' };
  user.ads.count += 1;
  user.ads.lastAt = Date.now();
  grant(user, ECON.ad.reward, 'ad_reward');
  return { reward: ECON.ad.reward };
}

export function claimTask(user, id, body, hasFinishedVideo) {
  const t = ECON.tasks.find((x) => x.id === id);
  if (!t) return { error: 'Unknown task.' };
  const rec = user.tasks[id];
  if (t.repeat === 'once' && rec) return { error: 'You already claimed this one.' };
  if (t.repeat === 'daily' && rec === today()) return { error: 'Already claimed today. Come back tomorrow.' };
  if (t.needsVideo && !hasFinishedVideo) return { error: 'Finish a video first.' };
  if (t.input === 'name') {
    const name = String(body?.value || '').trim();
    if (name.length < 2 || name.length > 24) return { error: 'Use 2 to 24 characters.' };
    user.name = name;
  }
  if (t.input === 'text' && String(body?.value || '').trim().length < 20) return { error: 'Please write at least 20 characters.' };
  user.tasks[id] = t.repeat === 'daily' ? today() : Date.now();
  grant(user, t.reward, 'task_' + id);
  return { reward: t.reward };
}

export function taskList(user) {
  return ECON.tasks.map((t) => ({
    ...t,
    done: t.repeat === 'once' ? !!user.tasks[t.id] : user.tasks[t.id] === today(),
  }));
}
