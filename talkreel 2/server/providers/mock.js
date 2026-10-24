// Preview engine. Renders a real MP4 per shot with ffmpeg: slow push-in on the character picture,
// a name tag, burned-in caption, a speech waveform and a placeholder voice track.
// It does NOT animate a face or speak real words. Use the 'fal' provider for that.
import fs from 'node:fs';
import { ffmpeg, pickFont } from '../ffmpeg.js';
import { ECON } from '../config.js';

const VOICES = { warm: 150, bright: 230, deep: 105, soft: 190 };
const FONT = pickFont();

export function dims(aspect, tier) {
  const short = ECON.tierInfo[tier].short;
  const even = (n) => Math.round(n / 2) * 2;
  if (aspect === '16:9') return { w: even((short * 16) / 9), h: short };
  if (aspect === '1:1') return { w: short, h: short };
  return { w: short, h: even((short * 16) / 9) }; // 9:16
}

function wrap(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

export default {
  name: 'mock',
  async generateShot({ shot, character, imagePath, aspect, tier, outPath, tmpDir, captions, watermark }) {
    const { w, h } = dims(aspect, tier);
    const dur = shot.seconds;
    const portrait = h > w;
    const base = VOICES[character?.voice] || VOICES.warm;
    const capFile = `${tmpDir}/cap-${shot.index}.txt`;
    const nameFile = `${tmpDir}/name-${shot.index}.txt`;
    fs.writeFileSync(capFile, wrap(shot.text, portrait ? 24 : 46));
    fs.writeFileSync(nameFile, shot.speaker + (shot.emotion ? ` (${shot.emotion})` : ''));
    const fs_ = Math.round(h / (portrait ? 34 : 20));
    const font = FONT ? `fontfile='${esc(FONT)}':` : '';
    const tag = (file, size, color, x, y, box) =>
      `drawtext=${font}textfile='${esc(file)}':expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:box=1:boxcolor=${box}:boxborderw=${Math.round(size * 0.45)}`;

    const parts = [
      `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(1+0.0009*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=25,format=yuv420p[bg]`,
      `[1:a]asplit[a1][a2]`,
      `[a2]showwaves=s=${Math.round(w * 0.5)}x${Math.round(h * 0.06)}:mode=cline:colors=white:rate=25,format=yuva420p[wv]`,
      `[bg][wv]overlay=x=(W-w)/2:y=H-h-${Math.round(h * 0.035)}[v1]`,
      `[v1]${tag(nameFile, Math.round(fs_ * 0.7), 'white', Math.round(w * 0.05), Math.round(h * 0.04), '0x2F2BE8@0.9')}[v2]`,
    ];
    let last = 'v2';
    if (captions) {
      parts.push(`[${last}]${tag(capFile, fs_, 'white', '(w-text_w)/2', 'h*0.68', 'black@0.55')}[v3]`);
      last = 'v3';
    }
    if (watermark && FONT) {
      const wm = `${tmpDir}/wm.txt`;
      fs.writeFileSync(wm, 'TalkReel');
      parts.push(`[${last}]drawtext=fontfile='${esc(FONT)}':textfile='${esc(wm)}':fontsize=${Math.round(fs_ * 0.6)}:fontcolor=white@0.6:x=w-text_w-${Math.round(w * 0.04)}:y=${Math.round(h * 0.04)}[v4]`);
      last = 'v4';
    }
    // Placeholder "voice": syllable-like bursts at the speaker's pitch.
    const syl = (3.6 + (shot.text.length % 5) * 0.35).toFixed(2);
    const aud = `aevalsrc='0.30*sin(2*PI*(${base}+30*sin(2*PI*2.3*t))*t)*pow(abs(sin(PI*${syl}*t)),0.6)':s=44100:d=${dur}`;

    await ffmpeg([
      '-loop', '1', '-framerate', '25', '-t', String(dur), '-i', imagePath,
      '-f', 'lavfi', '-i', aud,
      '-filter_complex', parts.join(';'),
      '-map', `[${last}]`, '-map', '[a1]',
      '-t', String(dur), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath,
    ]);
    return outPath;
  },
};
