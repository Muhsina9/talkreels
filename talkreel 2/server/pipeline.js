// Job runner: render each shot with the provider, join them, make a thumbnail.
// A failed job refunds every credit it took, so people never pay for a broken video.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PROVIDER, ECON } from './config.js';
import { db, save } from './store.js';
import { grant } from './economy.js';
import { ffmpeg, hasAudio, duration } from './ffmpeg.js';
import { dims } from './providers/mock.js';
import mock from './providers/mock.js';
import fal from './providers/fal.js';
import { norm } from './script.js';

const provider = PROVIDER === 'fal' ? fal : mock;
export const providerName = provider.name;

const queue = [];
let running = 0;
const MAX_JOBS = 2;

export function enqueue(jobId) {
  queue.push(jobId);
  pump();
}

function pump() {
  while (running < MAX_JOBS && queue.length) {
    const id = queue.shift();
    running++;
    runJob(id).catch((e) => console.error('job crashed', e)).finally(() => { running--; pump(); });
  }
}

async function normaliseAndJoin(files, { w, h }, outPath) {
  const inputs = [];
  const filters = [];
  for (let i = 0; i < files.length; i++) {
    let f = files[i];
    if (!(await hasAudio(f))) {
      const withA = f.replace(/\.mp4$/, '-a.mp4');
      const d = await duration(f);
      await ffmpeg(['-i', f, '-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=stereo', '-c:v', 'copy', '-c:a', 'aac', '-shortest', withA]);
      f = withA;
    }
    inputs.push('-i', f);
    filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=25,setsar=1,format=yuv420p[v${i}]`);
    filters.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
  }
  const cat = files.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${files.length}:v=1:a=1[v][a]`;
  await ffmpeg([...inputs, '-filter_complex', [...filters, cat].join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath]);
}

async function runJob(id) {
  const job = db.jobs[id];
  if (!job) return;
  const user = db.users[job.userId];
  const dir = path.join(DATA_DIR, 'media', id);
  fs.mkdirSync(dir, { recursive: true });
  job.status = 'running';
  job.stage = 'Rendering shots';
  save();
  try {
    const byName = new Map(job.cast.map((c) => [norm(c.name), c]));
    const fallback = job.cast[0];
    const files = [];
    for (const shot of job.shots) {
      shot.status = 'running';
      save();
      const character = shot.narrator ? fallback : byName.get(norm(shot.speaker)) || fallback;
      const imagePath = path.join(DATA_DIR, 'uploads', job.userId, db.uploads[character.imageId].file);
      const out = path.join(dir, `shot-${shot.index}.mp4`);
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await provider.generateShot({ shot, character, imagePath, aspect: job.aspect, tier: job.tier, outPath: out, tmpDir: dir, captions: job.captions, watermark: ECON.watermark, sceneStyle: job.style });
          lastErr = null;
          break;
        } catch (e) { lastErr = e; }
      }
      if (lastErr) throw lastErr;
      shot.status = 'done';
      job.progress = Math.round(((shot.index + 1) / job.shots.length) * 90);
      files.push(out);
      save();
    }
    job.stage = 'Joining shots';
    save();
    const final = path.join(dir, 'final.mp4');
    await normaliseAndJoin(files, dims(job.aspect, job.tier), final);
    await ffmpeg(['-ss', '0.6', '-i', final, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, 'thumb.jpg')]);
    job.video = `/media/${id}/final.mp4`;
    job.thumb = `/media/${id}/thumb.jpg`;
    job.status = 'done';
    job.stage = 'Ready';
    job.progress = 100;
    user.finished = (user.finished || 0) + 1;
  } catch (e) {
    console.error('job failed', id, e.message);
    job.status = 'failed';
    job.stage = 'Failed';
    job.error = String(e.message).slice(0, 300);
    if (!job.refunded) { job.refunded = true; grant(user, job.cost, 'refund_failed_job', { job: id }); }
  }
  save();
}
