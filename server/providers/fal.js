// Hosted image-to-video through fal.ai's queue API. The model decides the voice, the lip sync
// and the motion; we send the character picture plus a prompt with the line in quotes.
//
// Setup:   VIDEO_PROVIDER=fal  FAL_KEY=...  FAL_MODEL_STANDARD=<model id from fal.ai>
// Each tier can use a different model: FAL_MODEL_DRAFT, FAL_MODEL_STANDARD, FAL_MODEL_PREMIUM.
// Input field names differ per model, so check the model's page and, if needed, add or rename
// fields with FAL_EXTRA_JSON='{"generate_audio":true}'.
// NOTE: this adapter has not been run against a live key in this build. Test one short shot first.
import fs from 'node:fs';
import { ffmpeg } from '../ffmpeg.js';
import { dims } from './mock.js';

const KEY = process.env.FAL_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function modelFor(tier) {
  const m = process.env['FAL_MODEL_' + tier.toUpperCase()] || process.env.FAL_MODEL;
  if (!m) throw new Error(`No model set for the ${tier} tier. Set FAL_MODEL_${tier.toUpperCase()} (see README).`);
  return m;
}

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function buildPrompt(shot, character, sceneStyle) {
  const who = shot.narrator ? 'A narrator speaks off camera while the picture stays calm' : `${character.name} faces the camera and says`;
  const mood = shot.emotion ? ` in a ${shot.emotion} tone` : '';
  const scene = shot.scene ? ` Setting: ${shot.scene}.` : '';
  return `${who}${mood}: "${shot.text}" Natural lip sync, subtle head and hand motion, steady framing, same face and outfit as the reference image.${scene}${sceneStyle ? ' Style: ' + sceneStyle : ''}`;
}

export default {
  name: 'fal',
  async generateShot({ shot, character, imagePath, aspect, tier, outPath, tmpDir, sceneStyle }) {
    if (!KEY) throw new Error('FAL_KEY is not set.');
    const model = modelFor(tier);
    const image = 'data:image/jpeg;base64,' + fs.readFileSync(imagePath).toString('base64');
    const extra = process.env.FAL_EXTRA_JSON ? JSON.parse(process.env.FAL_EXTRA_JSON) : {};
    const input = {
      prompt: buildPrompt(shot, character, sceneStyle),
      image_url: image,
      duration: String(Math.max(3, Math.ceil(shot.seconds))),
      aspect_ratio: aspect,
      ...extra,
    };
    const job = await api(`https://queue.fal.run/${model}`, { method: 'POST', body: JSON.stringify(input) });
    for (let i = 0; i < 180; i++) {
      await sleep(4000);
      const st = await api(job.status_url);
      if (st.status === 'COMPLETED') break;
      if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error('The video model reported a failure.');
      if (i === 179) throw new Error('The video model took too long.');
    }
    const result = await api(job.response_url);
    const url = result?.video?.url || result?.video_url || result?.output?.video?.url;
    if (!url) throw new Error('The model finished but returned no video URL.');
    const raw = `${tmpDir}/raw-${shot.index}.mp4`;
    const dl = await fetch(url);
    if (!dl.ok) throw new Error('Could not download the generated clip.');
    fs.writeFileSync(raw, Buffer.from(await dl.arrayBuffer()));
    // Trim to the planned length and normalise size so shots join cleanly.
    const { w, h } = dims(aspect, tier);
    await ffmpeg(['-i', raw, '-t', String(shot.seconds), '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=25`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outPath]);
    return outPath;
  },
};
