import { spawn } from 'node:child_process';
import fs from 'node:fs';

export function run(cmd, args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.split('\n').slice(-6).join(' ')}`));
    });
  });
}

export const ffmpeg = (args, o) => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], o);

export async function hasAudio(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return out.trim().length > 0;
}

export async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim()) || 0;
}

export function pickFont() {
  const c = [
    '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
  ];
  return c.find((f) => fs.existsSync(f)) || null;
}
