// Script format (plain text, one line per beat):
//   # Rooftop at dusk            <- scene heading (also: SCENE: ..., INT. ..., EXT. ...)
//   MAYA (excited): We did it!   <- speaker, optional emotion, then the line
//   NARRATOR: Three weeks later. <- voice-over; uses the scene's current picture
import { ECON } from './config.js';

const LINE = /^([\p{L}][\p{L}\p{N} .'_-]{0,23}?)\s*(?:\(([^)]{1,30})\))?\s*:\s*(.+)$/u;
const SCENE = /^(?:#+\s*(.+)|SCENE\s*:\s*(.+)|((?:INT|EXT)\.?.+))$/i;

export const norm = (s) => String(s).trim().toLowerCase();

function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function estimateSeconds(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const s = words / 2.6 + 0.6;
  return Math.max(2, Math.ceil(s * 2) / 2);
}

function packSentences(text, maxSec) {
  const out = [];
  let cur = '';
  for (const s of splitSentences(text)) {
    const next = cur ? cur + ' ' + s : s;
    if (cur && estimateSeconds(next) > maxSec) { out.push(cur); cur = s; } else cur = next;
  }
  if (cur) out.push(cur);
  // A single very long sentence: break on word count.
  return out.flatMap((chunk) => {
    if (estimateSeconds(chunk) <= maxSec) return [chunk];
    const w = chunk.split(/\s+/);
    const per = Math.max(4, Math.floor((maxSec - 0.6) * 2.6));
    const res = [];
    for (let i = 0; i < w.length; i += per) res.push(w.slice(i, i + per).join(' '));
    return res;
  });
}

export function parseScript(text, castNames = []) {
  const cast = new Map(castNames.map((n) => [norm(n), n]));
  const warnings = [];
  const shots = [];
  let scene = '';
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const sc = line.match(SCENE);
    if (sc) { scene = (sc[1] || sc[2] || sc[3]).trim(); return; }
    const m = line.match(LINE);
    if (!m) { warnings.push({ line: i + 1, msg: 'Skipped. Start the line with a name and a colon, like MAYA: Hello.' }); return; }
    const key = norm(m[1]);
    const narrator = key === 'narrator' || key === 'narration' || key === 'vo';
    if (!narrator && !cast.has(key)) {
      warnings.push({ line: i + 1, msg: `${m[1].trim()} has no character picture yet. Add them to the cast.` });
    }
    const speaker = narrator ? 'Narrator' : cast.get(key) || m[1].trim();
    for (const chunk of packSentences(m[3].trim(), ECON.limits.maxShotSeconds)) {
      shots.push({ index: shots.length, scene, speaker, narrator, known: narrator || cast.has(key), emotion: (m[2] || '').trim(), text: chunk, seconds: estimateSeconds(chunk), line: i + 1 });
    }
  });
  const total = shots.reduce((a, s) => a + s.seconds, 0);
  return { shots, warnings, totalSeconds: total };
}

export function priceShots(shots, tier) {
  const rate = ECON.costPerSecond[tier];
  shots.forEach((s) => { s.credits = Math.ceil(s.seconds * rate); });
  return shots.reduce((a, s) => a + s.credits, 0);
}
