// Sound asset manifest for PRIMETIME.
//
// Each entry maps 1:1 to a function in `lib/sfx.ts` (loops or one-shots).
// The Suno Sounds API ("kie.ai") generates each as an mp3 in
// `public/sounds/<slug>.mp3`, with metadata captured in
// `public/sounds/manifest.json`.
//
// IMPORTANT — keep this file in sync with `public/sounds/manifest.json`.
// `lib/sfx-assets.test.ts` enforces that the slug set, loop flags, and
// label/surface metadata match between source and committed manifest. See
// `scripts/generate-sounds.ts` for the regeneration path; manual edits to
// individual entries are fine as long as the test passes.
//
// Aesthetic anchor: late-60s/early-70s broadcast control room.
// See `DESIGN.md`.

export type SoundSpec = {
  /** Filename slug. Becomes `public/sounds/<slug>.mp3` and the manifest key. */
  slug: string;
  /** Suno prompt (max 500 chars). Describe sound only — no lyrics. */
  prompt: string;
  /** Loops cleanly back-to-back when `true`. Background beds use this. */
  soundLoop: boolean;
  /** BPM hint, optional. Useful for rhythmic loops. 1–300. */
  soundTempo?: number;
  /** Musical key hint, optional. Suno enum: Cm, C#m, ..., B. */
  soundKey?: string;
  /** Human label for the docs / UI. */
  label: string;
  /** Where it plays in the app — for the docs map. */
  surface: string;
};

export const SOUNDS: SoundSpec[] = [
  // ───────────────────────── LOOPS ─────────────────────────
  {
    slug: 'lobby-ambience',
    label: 'Lobby jazz',
    surface: 'host display + player lobby',
    prompt: 'Manual lobby jazz replacement for the host display + player lobby ambience.',
    soundLoop: true,
    soundTempo: 70,
    soundKey: 'Am',
  },
  {
    slug: 'question-tension',
    label: 'Question tension bed',
    surface: 'host display + player + control during question phase',
    prompt:
      'Tense pulsing broadcast sub-bass loop. Slow heartbeat-like analog synth pulse on every beat, faint metallic ride cymbal accent, distant ticking metronome. Urgent but restrained — like a 1970s game show countdown bed. No melody, no vocals, no drums. Loops cleanly.',
    soundLoop: true,
    soundTempo: 120,
    soundKey: 'Cm',
  },
  {
    slug: 'question-tension-long',
    label: 'Question tension bed (long)',
    surface: 'host display + player + control during question phase',
    prompt:
      'Tense pulsing broadcast sub-bass loop. Slow heartbeat-like analog synth pulse on every beat, faint metallic ride cymbal accent, distant ticking metronome. Urgent but restrained — like a 1970s game show countdown bed. No melody, no vocals, no drums. Loops cleanly.',
    soundLoop: true,
    soundTempo: 120,
    soundKey: 'Cm',
  },
  {
    slug: 'final-bed',
    label: 'Final / podium bed',
    surface: 'final leaderboard, host display + player',
    prompt:
      'Soft warm broadcast sign-off pad. Sustained brass-tinged synth chord, mellow analog strings, gentle slow rotary speaker movement, faint vinyl crackle. Triumphant but understated — like the closing seconds of a 1970s evening news broadcast. No drums, no vocals, no melody. Loops cleanly.',
    soundLoop: true,
    soundTempo: 80,
    soundKey: 'C',
  },

  // ───────────────────────── ONE-SHOTS ─────────────────────────
  {
    slug: 'lock-in',
    label: 'Answer lock-in',
    surface: 'player — when answer is submitted',
    prompt:
      'Short tactile sound effect: a producer rubber stamp hitting paper with a firm thunk, followed by a tiny paper crinkle. Dry, close-mic, no reverb. About 250 milliseconds total. Vintage broadcast feel.',
    soundLoop: false,
  },
  {
    slug: 'correct',
    label: 'Correct answer cue',
    surface: 'player — answer reveal when correct',
    prompt:
      'Short broadcast cue chime: three rising bell tones, like a 1970s game show "right answer" sting. Bright, clear, glassy bell timbre. About 600 milliseconds. No reverb tail. No vocals.',
    soundLoop: false,
  },
  {
    slug: 'wrong',
    label: 'Wrong answer buzzer',
    surface: 'player — answer reveal when incorrect',
    prompt:
      'Short vintage game show wrong-answer buzzer. Two dry, low-pitched analog square-wave buzzes back-to-back, slightly detuned, no reverb. About 400 milliseconds total. Disappointing but not harsh. 1970s TV game show style.',
    soundLoop: false,
  },
  {
    slug: 'tick',
    label: 'Countdown tick (normal)',
    surface: 'host display + player — one tick per second on countdown',
    prompt:
      'A single dry analog studio clock tick. Wooden, mechanical, close-mic, no reverb. About 60 milliseconds. Like the second hand of a 1970s broadcast control-room wall clock.',
    soundLoop: false,
  },
  {
    // Despite the slug, this is generated/used as a continuous ~12s ticking
    // loop — `lib/sfx.ts` arms it via `crossfadeToUrgent` during the final 3
    // seconds of the countdown rather than firing per-second one-shots.
    slug: 'tick-urgent',
    label: 'Countdown tick (last 3 seconds)',
    surface: 'host display + player — last 3 seconds of countdown (looped)',
    prompt:
      'A sharper, harder analog studio clock tick. Mechanical, slightly metallic, close-mic, no reverb. About 80 milliseconds. Tense, last-three-seconds-of-countdown energy. 1970s broadcast control-room style.',
    soundLoop: true,
  },
  {
    slug: 'time-up',
    label: 'Time up alert',
    surface: 'host display + player — when timer expires',
    prompt:
      'Short broadcast alert klaxon. Two short low-pitched analog horn pulses back to back, urgent but not alarming, no reverb. About 700 milliseconds total. 1970s TV news alert tone style. No vocals.',
    soundLoop: false,
  },
  {
    slug: 'leaderboard-sweep',
    label: 'Leaderboard sweep',
    surface: 'host display — when leaderboard reveals',
    prompt:
      'Short vintage teletype roll, about a second long, settling into a soft single chime at the end. Mechanical paper-fed teletype clatter, then a clear glass bell hit. Like a 1970s broadcast chyron settling into place. No reverb. No vocals.',
    soundLoop: false,
  },
  {
    slug: 'reveal-flash',
    label: 'Answer reveal flash',
    surface: 'host display — when correct answer is revealed',
    prompt:
      'Short camera shutter snap followed immediately by a brief tape-reel stop. Dry, close-mic, no reverb. About 250 milliseconds total. Mechanical, photographic, vintage broadcast graphics feel.',
    soundLoop: false,
  },
];

export function findSound(slug: string): SoundSpec | undefined {
  return SOUNDS.find((s) => s.slug === slug);
}
