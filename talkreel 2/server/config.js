// Everything you would tune in a real launch lives here: prices, ad rules, task rewards.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const PORT = Number(process.env.PORT || 8787);

// 'mock' renders a real MP4 locally with ffmpeg (animated image, captions, audio track) so the whole
// product works with no API key. 'fal' sends each shot to a hosted image-to-video model.
export const PROVIDER = process.env.VIDEO_PROVIDER || 'mock';

export const ECON = {
  signupBonus: 30,
  // Credits per second of finished video. Quality tiers map to different (cheaper/dearer) models.
  costPerSecond: { draft: 2, standard: 6, premium: 14 },
  tierInfo: {
    draft: { label: 'Draft', note: 'Fast and cheap. Best for checking your script.', short: 540 },
    standard: { label: 'Standard', note: 'Clean 720p for sharing.', short: 720 },
    premium: { label: 'Premium', note: 'Full 1080p with the best lip sync.', short: 1080 },
  },
  limits: { maxSecondsPerVideo: 60, maxShots: 24, maxCharacters: 4, maxScriptChars: 4000, maxShotSeconds: 8 },
  watermark: true, // free-plan videos carry a small mark; paid packs would remove it
  ad: {
    reward: 6,
    minWatchMs: Number(process.env.AD_MIN_MS || 15000), // server-enforced; the demo ad lasts this long
    cooldownMs: Number(process.env.AD_COOLDOWN_MS || 30000),
    dailyCap: 10,
  },
  tasks: [
    { id: 'daily_checkin', title: 'Daily check-in', desc: 'Come back every day.', reward: 4, repeat: 'daily' },
    { id: 'set_name', title: 'Set your creator name', desc: 'Shown on your videos.', reward: 8, repeat: 'once', input: 'name' },
    { id: 'feedback', title: 'Tell us what to build next', desc: 'At least 20 characters.', reward: 6, repeat: 'once', input: 'text' },
    { id: 'first_share', title: 'Share your first video', desc: 'Finish one video, then claim.', reward: 10, repeat: 'once', needsVideo: true },
  ],
  referral: { referrerReward: 20, refereeReward: 10, maxPerUser: 5 },
};
