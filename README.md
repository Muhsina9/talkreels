# TalkReel

Character pictures + a script in, one talking video out. Credits are limited, and people earn more by
watching a rewarded ad or finishing small tasks.

## Run it

```
node server/index.js        # needs Node 20+ and ffmpeg on the PATH; no npm install
open http://localhost:8787
```
Click **Try the sample cast**, then **Make video**. Run the checks with `node test/e2e.mjs` while the server
is up (start it with `AD_MIN_MS=1500 AD_COOLDOWN_MS=1000` so the ad test is quick).

## What is real and what is a stand-in

| Part | State |
|---|---|
| Cast, script parser (names, feelings, scenes, narrator), shot planning, cost estimate | Working |
| Credits ledger, signup bonus, ads (nonce, minimum watch time, cooldown, daily cap), tasks, referrals | Working, tested |
| Job queue, shot-by-shot progress, join into one MP4, thumbnail, refunds on failure, range requests | Working, tested |
| Video engine `mock` (default) | Animates the picture, burns captions, adds a placeholder voice. **No real speech or lip sync.** |
| Video engine `fal` | Written, **not run against a live key**. Test one short shot first. |
| Ad network | Demo ad. Replace `completeAd` in `server/economy.js` with your network's server-side reward callback. |
| Accounts | Anonymous token in the browser. Add real sign-in before launch, or credits can be farmed with new tokens. |

## Turn on real talking video

```
VIDEO_PROVIDER=fal FAL_KEY=... FAL_MODEL_DRAFT=<model id> FAL_MODEL_STANDARD=<model id> FAL_MODEL_PREMIUM=<model id> node server/index.js
```
Pick image-to-video models that take a first frame and speak quoted dialogue (the market research found Veo 3.1,
Seedance 2.x, Kling 3.0 and Happy Horse doing this). Field names differ per model; adjust `server/providers/fal.js`
or pass `FAL_EXTRA_JSON`. Keep the same reference image for a character in every shot to keep the face consistent.

## Credits and the money

Defaults (`server/config.js`): signup 30, ad +6 (max 10 a day), draft 2 / standard 6 / premium 14 credits per second.
One ad is about 3 seconds of draft video.

Be careful here. Hosted models were quoted at roughly $0.03 to $0.14 per second of output in the research, while a rewarded
ad usually pays a few cents at most (this figure is my assumption, not from the research; check your network's eCPM, and
expect less in India). So ads alone will not pay for hosted video. Plan on: self-hosted or very cheap model for Draft,
paid credit packs or a subscription for Standard and Premium, and watermark-free export as a paid perk.

## Next things to build

1. Real lip-sync engine wired and tested; separate TTS voices per character.
2. Re-render a single shot without paying for the whole video.
3. Sign-in, payments, and a real ad network (AdMob for an Android app, a web network for the site).
4. Moderation of uploaded faces and scripts, plus a "report" button.
5. Move `db.json` to Postgres and jobs to a real queue before more than one server.
