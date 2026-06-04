# Sound generation

PRIMETIME ships with a small kit of broadcast-graphics sound effects and
ambient beds — countdown ticks, lock-in stamps, lobby ambience, podium pad,
and so on. The fallback is a fully synthesized Web Audio kit in `lib/sfx.ts`
(oscillators only — no assets). The richer flavour comes from real audio
generated with [kie.ai](https://docs.kie.ai/suno-api/generate-sounds.md)'s
Suno Sounds API and shipped as static `.mp3` files under `public/sounds/`.

> The `lib/sfx.ts` synthesis kit is the floor — sounds work even with
> `public/sounds/` empty. Generated audio is the ceiling.

## Quick start

```bash
# one-time: make sure KIE_API_KEY is in your env
echo $KIE_API_KEY    # should print 32 chars

# from repo root
npm run sounds:generate -- --dry-run                  # preview the plan
npm run sounds:generate -- --only=lock-in             # generate one
npm run sounds:generate                               # generate all missing
npm run sounds:generate -- --only=lock-in --force     # regenerate one
```

Outputs land in `public/sounds/<slug>.mp3` and a metadata index in
`public/sounds/manifest.json`.

## What gets generated

The full set lives in `scripts/sounds-manifest.ts`. Each entry maps 1:1 to a
function in `lib/sfx.ts`.

| Slug | Surface | Loop |
|------|---------|:----:|
| `lobby-ambience` | host display + player lobby | ✓ |
| `question-tension` | host display + player + control during question phase | ✓ |
| `final-bed` | final leaderboard | ✓ |
| `lock-in` | player — when answer is submitted | |
| `correct` | player — answer reveal when correct | |
| `wrong` | player — answer reveal when incorrect | |
| `tick` | countdown — every second | |
| `tick-urgent` | countdown — last 5 seconds | |
| `time-up` | when timer expires | |
| `leaderboard-sweep` | host display — leaderboard reveal | |
| `reveal-flash` | host display — answer reveal | |

The full prompts (which is what actually drives Suno's output) live in
`scripts/sounds-manifest.ts`. Treat that file as the source of truth for the
audio identity — edit prompts there, then `--force` regenerate.

## How the script works

`scripts/generate-sounds.ts` is a small driver around the kie.ai REST API:

1. **Submit** — `POST https://api.kie.ai/api/v1/generate/sounds` with
   `prompt`, `model`, `soundLoop`, optional `soundTempo` and `soundKey`.
   Auth is `Bearer $KIE_API_KEY`.
2. **Cache the taskId** to `public/sounds/.tasks/<slug>.json` so a re-run after
   a crash resumes the same task instead of paying for a new one.
3. **Poll** — `GET /api/v1/generate/record-info?taskId=…` every 30 seconds
   (kie's recommended cadence) until the response contains
   `data.response.sunoData[].audioUrl` and a non-failure status.
   Recognised statuses: `PENDING`, `TEXT_SUCCESS`, `FIRST_SUCCESS`, `SUCCESS`
   (success), and `CREATE_TASK_FAILED` / `GENERATE_AUDIO_FAILED` /
   `CALLBACK_EXCEPTION` / `SENSITIVE_WORD_ERROR` (fail).
4. **Download** the mp3 from `audioUrl` to `public/sounds/<slug>.mp3`.
5. **Update** `public/sounds/manifest.json` with the slug, file path,
   duration, prompt, taskId, trackId, and model.

The script is **idempotent**: if `public/sounds/<slug>.mp3` already exists,
the slug is skipped unless you pass `--force`.

## Flags

```
tsx scripts/generate-sounds.ts [flags]

  --only=<slug[,slug...]>   Generate only listed slugs.
  --force                   Regenerate even if mp3 already exists.
  --dry-run                 Print the plan without calling the API.
  --model=V5|V5_5           Suno model. Default V5_5.
  -h, --help                Show help including the slug list.
```

## Default model

We default to **V5_5** because it produces noticeably cleaner ambience and
shorter, less mushy one-shots than V5. Override with `--model=V5` if a sound
turns out badly on V5_5 — Suno output is non-deterministic, and sometimes the
older model nails a vintage timbre on the first try.

## Costs

Each sound generation = 1 Suno Sounds task. Pricing lives on
<https://kie.ai> (it's per-task, not per-second). The full kit is 11
generations. Re-runs only spend credits on slugs that don't already have an
mp3 (or `--force` ones). The `.tasks/` cache lets a crashed run resume
without re-spending.

## Editing prompts / regenerating

1. Open `scripts/sounds-manifest.ts`.
2. Edit the `prompt`, `soundLoop`, `soundTempo`, or `soundKey` for the slug.
3. `npm run sounds:generate -- --only=<slug> --force`
4. Listen at `public/sounds/<slug>.mp3` (or open the dev server and let the
   real surface play it). Repeat until happy.

If a generation comes back lifeless or off-tone, two reliable knobs:

- **Tempo and key** push the result further than the prompt does.
  `soundTempo: 70` + `soundKey: Am` is calmer than `120` / `Cm`.
- **Length implication** — saying "about 250 milliseconds" in the prompt
  reliably steers Suno toward a short stinger instead of a 30-second loop.

## Wiring into the app

Generated mp3s live under `public/sounds/` so they're served as static
assets at `/sounds/<slug>.mp3`. The `public/sounds/manifest.json` is
machine-readable — `lib/sfx.ts` (or any future sfx loader) can read it at
build time / runtime to know which slugs have real audio vs. synthesized
fallbacks.

> Today `lib/sfx.ts` plays only the synthesized kit. The follow-up task is to
> swap each function (`startLobbyAmbience`, `sfxLockIn`, etc.) over to play
> the corresponding `/sounds/<slug>.mp3` when present, and fall back to the
> oscillator path when not. Keep the existing mute / volume API surface.

## Source of truth

- **Prompts and metadata** — `scripts/sounds-manifest.ts`
- **Runner** — `scripts/generate-sounds.ts`
- **Generated artifacts** — `public/sounds/*.mp3`
- **Index** — `public/sounds/manifest.json`
- **Cached taskIds (gitignored)** — `public/sounds/.tasks/*.json`
- **Synthesized fallback** — `lib/sfx.ts`

API reference: <https://docs.kie.ai/suno-api/generate-sounds.md>
