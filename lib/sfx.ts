'use client';

import { getAsset, type SoundAsset } from './sfx-assets';

const MUTE_KEY = 'bc:sfx:muted';
const VOL_KEY = 'bc:sfx:vol';
const DEFAULT_VOLUME = 0.6;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let masterVolume = DEFAULT_VOLUME;

type LoopHandle = { stop: (fadeMs?: number) => void };

const loops: { [k: string]: LoopHandle | null } = {
  lobby: null,
  question: null,
  final: null,
  urgent: null,
};

// Per-slug AudioBuffer cache. Stores the in-flight promise so concurrent calls
// share one fetch/decode pass.
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
// Slugs whose fetch/decode failed once — we won't retry, just fall through to
// the oscillator path.
const unavailable = new Set<string>();

function preloadLoop(slug: string): void {
  const asset = getAsset(slug);
  if (!asset?.loop || unavailable.has(slug)) return;
  void loadBuffer(slug, asset);
}

function readPersisted() {
  if (typeof window === 'undefined') return;
  try {
    if (
      localStorage.getItem('bc:sfx:muted-host') !== null &&
      localStorage.getItem(MUTE_KEY) === '1'
    ) {
      localStorage.removeItem(MUTE_KEY);
    }
    const m = localStorage.getItem(MUTE_KEY);
    if (m === '1') muted = true;
    else if (m === '0') muted = false;
    const v = localStorage.getItem(VOL_KEY);
    if (v !== null) {
      const parsed = parseFloat(v);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) masterVolume = parsed;
    }
  } catch {}
}

readPersisted();

function ensureCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : masterVolume;
    masterGain.connect(ctx.destination);
  }
  return { ctx, master: masterGain! };
}

export async function unlockAudio(): Promise<void> {
  const env = ensureCtx();
  if (!env) return;
  if (env.ctx.state === 'suspended') {
    try {
      await env.ctx.resume();
    } catch {}
  }
}

export function isUnlocked(): boolean {
  return !!ctx && ctx.state === 'running';
}

export function setMuted(m: boolean, opts: { persist?: boolean } = {}): void {
  const persist = opts.persist ?? true;
  muted = m;
  if (persist) {
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {}
  }
  if (masterGain && ctx) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(m ? 0 : masterVolume, ctx.currentTime, 0.01);
  }
  if (m) stopAllLoops();
}

export function isMuted(): boolean {
  return muted;
}

export function setMasterVolume(v: number): void {
  masterVolume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOL_KEY, String(masterVolume));
  } catch {}
  if (masterGain && ctx && !muted) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.01);
  }
}

export function getMasterVolume(): number {
  return masterVolume;
}

// ---------------------------------------------------------------------------
// MP3 sample playback
// ---------------------------------------------------------------------------

function loadBuffer(slug: string, asset: SoundAsset): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(slug);
  if (cached) return cached;
  const env = ensureCtx();
  if (!env) return Promise.resolve(null);
  const { ctx: c } = env;
  const promise = (async () => {
    try {
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error(`fetch ${asset.url} -> ${res.status}`);
      const arr = await res.arrayBuffer();
      // Use callback signature for Safari compatibility (older WebKit).
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        try {
          const maybe = c.decodeAudioData(arr, resolve, reject);
          if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
            (maybe as Promise<AudioBuffer>).then(resolve, reject);
          }
        } catch (err) {
          reject(err);
        }
      });
      return buf;
    } catch {
      unavailable.add(slug);
      return null;
    }
  })();
  bufferCache.set(slug, promise);
  return promise;
}

/**
 * Try to play an MP3 sample for this slug. Returns true if the sample is being
 * played (or is queued to play after decode), false if no sample is available
 * and the caller should fall back to the oscillator path.
 *
 * If the buffer is already decoded, playback starts synchronously. If not, the
 * sample plays as soon as decoding finishes — for one-shot UI cues this means
 * the very first trigger may have a small latency, subsequent triggers are
 * instant.
 */
function tryPlaySample(slug: string): boolean {
  if (muted) return true; // pretend we played; nothing to do
  const asset = getAsset(slug);
  if (!asset || asset.loop) return false;
  if (unavailable.has(slug)) return false;
  const env = ensureCtx();
  if (!env) return false;
  const { ctx: c, master } = env;

  const cached = bufferCache.get(slug);
  if (cached === undefined) {
    // Kick off decode; play when it finishes.
    loadBuffer(slug, asset).then((buf) => {
      if (!buf || muted) return;
      playBufferOnce(c, master, buf);
    });
    return true;
  }

  // We have a pending or resolved entry; play when ready.
  cached.then((buf) => {
    if (!buf || muted) return;
    playBufferOnce(c, master, buf);
  });
  return true;
}

function playBufferOnce(c: AudioContext, master: GainNode, buf: AudioBuffer): void {
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.start();
  src.onended = () => {
    try {
      src.disconnect();
    } catch {}
  };
}

/**
 * Start a looped MP3 sample. Returns a stop handle, or null if the sample is
 * unavailable so the caller can fall back to the oscillator loop.
 */
function tryStartLoop(
  slug: string,
  opts: { peak?: number; fadeInMs?: number } = {},
): LoopHandle | null {
  const asset = getAsset(slug);
  if (!asset?.loop) return null;
  if (unavailable.has(slug)) return null;
  const env = ensureCtx();
  if (!env) return null;
  const { ctx: c, master } = env;

  const peak = opts.peak ?? 1;
  const fadeInMs = Math.max(0, opts.fadeInMs ?? 0);

  // Per-loop gain so we can fade out without touching masterGain (which carries
  // mute/volume).
  const loopGain = c.createGain();
  const startT = c.currentTime;
  if (fadeInMs > 0) {
    loopGain.gain.setValueAtTime(0, startT);
    loopGain.gain.linearRampToValueAtTime(peak, startT + fadeInMs / 1000);
  } else {
    loopGain.gain.value = peak;
  }
  loopGain.connect(master);

  let src: AudioBufferSourceNode | null = null;
  let stopped = false;

  const startWithBuffer = (buf: AudioBuffer | null) => {
    if (!buf || stopped) {
      try {
        loopGain.disconnect();
      } catch {}
      return;
    }
    src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(loopGain);
    src.start();
  };

  loadBuffer(slug, asset).then(startWithBuffer);

  return {
    stop: (fadeMs = 80) => {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      const fade = Math.max(0, fadeMs) / 1000;
      try {
        loopGain.gain.cancelScheduledValues(t);
        loopGain.gain.setValueAtTime(loopGain.gain.value, t);
        loopGain.gain.linearRampToValueAtTime(0, t + fade);
      } catch {}
      const cleanup = () => {
        try {
          src?.disconnect();
        } catch {}
        try {
          loopGain.disconnect();
        } catch {}
      };
      if (src) {
        try {
          src.stop(t + fade + 0.02);
          src.onended = cleanup;
        } catch {
          cleanup();
        }
      } else {
        // Source hadn't started yet; just clean up the gain node.
        cleanup();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Oscillator fallback primitives (unchanged)
// ---------------------------------------------------------------------------

type EnvOpts = {
  attack?: number;
  decay?: number;
  peak?: number;
  release?: number;
};

function blip(
  freq: number,
  dur: number,
  type: OscillatorType,
  opts: EnvOpts = {},
  filter?: { type: BiquadFilterType; frequency: number; q?: number },
  startOffset = 0,
) {
  const env = ensureCtx();
  if (!env || muted) return;
  const { ctx: c, master } = env;
  const now = c.currentTime + startOffset;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const g = c.createGain();
  const peak = opts.peak ?? 0.5;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? Math.max(0.01, dur - attack);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

  let out: AudioNode = g;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.frequency;
    if (filter.q !== undefined) f.Q.value = filter.q;
    g.connect(f);
    out = f;
  }
  osc.connect(g);
  out.connect(master);
  osc.start(now);
  osc.stop(now + attack + release + 0.05);
  osc.onended = () => {
    try {
      osc.disconnect();
    } catch {}
    try {
      g.disconnect();
    } catch {}
    if (filter) {
      try {
        (out as AudioNode).disconnect();
      } catch {}
    }
  };
}

function noiseBurst(dur: number, peak: number, lpFreq: number) {
  const env = ensureCtx();
  if (!env || muted) return;
  const { ctx: c, master } = env;
  const now = c.currentTime;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lpFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(now);
  src.stop(now + dur + 0.05);
  src.onended = () => {
    try {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    } catch {}
  };
}

// ---------------------------------------------------------------------------
// Public one-shot API — try MP3 first, fall back to oscillator.
// ---------------------------------------------------------------------------

export function sfxClick(): void {
  // No MP3 sample for click — straight to oscillator.
  blip(4000, 0.03, 'sine', { peak: 0.25, attack: 0.002, release: 0.028 });
}

export function sfxLockIn(): void {
  if (tryPlaySample('lock-in')) return;
  fallbackLockIn();
}

export function sfxTick(urgent = false): void {
  if (tryPlaySample(urgent ? 'tick-urgent' : 'tick')) return;
  fallbackTick(urgent);
}

export function sfxCorrect(): void {
  if (tryPlaySample('correct')) return;
  fallbackCorrect();
}

export function sfxWrong(): void {
  if (tryPlaySample('wrong')) return;
  fallbackWrong();
}

export function sfxTimeUp(): void {
  if (tryPlaySample('time-up')) return;
  fallbackTimeUp();
}

export function sfxLeaderboardSweep(): void {
  if (tryPlaySample('leaderboard-sweep')) return;
  fallbackLeaderboardSweep();
}

export function sfxFinalFanfare(): void {
  // The reveal-flash sample is a camera-shutter snap that doubles as the
  // fanfare cue here; the final-bed loop carries the held pad underneath.
  if (tryPlaySample('reveal-flash')) return;
  fallbackFinalFanfare();
}

// ---------------------------------------------------------------------------
// Oscillator fallbacks for one-shots (extracted from prior public functions).
// ---------------------------------------------------------------------------

function fallbackLockIn(): void {
  const env = ensureCtx();
  if (!env || muted) return;
  blip(880, 0.06, 'square', { peak: 0.3, attack: 0.003, release: 0.057 }, undefined, 0);
  blip(1320, 0.06, 'square', { peak: 0.3, attack: 0.003, release: 0.057 }, undefined, 0.06);
}

function fallbackTick(urgent: boolean): void {
  if (urgent) {
    blip(
      1320,
      0.08,
      'sawtooth',
      { peak: 0.35, attack: 0.001, release: 0.079 },
      { type: 'lowpass', frequency: 4000, q: 1 },
    );
  } else {
    blip(880, 0.06, 'sine', { peak: 0.25, attack: 0.003, release: 0.057 });
  }
}

function fallbackCorrect(): void {
  const notes = [523, 659, 784];
  notes.forEach((f, i) => {
    blip(
      f,
      0.09,
      'sine',
      { peak: 0.4, attack: 0.005, release: 0.085 },
      { type: 'bandpass', frequency: 1500, q: 1.2 },
      i * 0.09,
    );
  });
}

function fallbackWrong(): void {
  noiseBurst(0.05, 0.25, 800);
  blip(
    220,
    0.2,
    'sawtooth',
    { peak: 0.45, attack: 0.005, release: 0.195 },
    { type: 'lowpass', frequency: 600, q: 1 },
    0,
  );
  blip(
    175,
    0.2,
    'sawtooth',
    { peak: 0.45, attack: 0.005, release: 0.195 },
    { type: 'lowpass', frequency: 600, q: 1 },
    0.2,
  );
}

function fallbackTimeUp(): void {
  const pattern = [0, 0.1, 0.2, 0.3];
  for (const t of pattern) {
    blip(220, 0.06, 'square', { peak: 0.35, attack: 0.001, release: 0.058 }, undefined, t);
    blip(110, 0.06, 'square', { peak: 0.35, attack: 0.001, release: 0.058 }, undefined, t);
  }
}

function fallbackLeaderboardSweep(): void {
  const env = ensureCtx();
  if (!env || muted) return;
  const { ctx: c, master } = env;
  const now = c.currentTime;
  const dur = 0.4;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.4, now + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.05);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {}
  };
}

function fallbackFinalFanfare(): void {
  const chords = [
    [261.63, 329.63, 392.0], // C major
    [349.23, 440.0, 523.25], // F major
    [392.0, 493.88, 587.33], // G major
  ];
  chords.forEach((notes, i) => {
    const offset = i * 0.2;
    notes.forEach((f) => {
      blip(f, 0.2, 'sine', { peak: 0.18, attack: 0.005, release: 0.195 }, undefined, offset);
      blip(
        f,
        0.2,
        'sawtooth',
        { peak: 0.1, attack: 0.005, release: 0.195 },
        { type: 'lowpass', frequency: 2400, q: 0.7 },
        offset,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Loop helpers (oscillator) — used as fallback when no MP3 is present.
// ---------------------------------------------------------------------------

function makeLoopGain(peak: number) {
  const env = ensureCtx();
  if (!env) return null;
  const { ctx: c, master } = env;
  const g = c.createGain();
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(peak, c.currentTime + 0.08);
  g.connect(master);
  return { ctx: c, gain: g };
}

function fallbackStartLobby(): { stop: () => void } | null {
  const made = makeLoopGain(0.06);
  if (!made) return null;
  const { ctx: c, gain } = made;
  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = 110;
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = 165;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 1;
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.2;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 400;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  o1.connect(filter);
  o2.connect(filter);
  filter.connect(gain);
  const now = c.currentTime;
  o1.start(now);
  o2.start(now);
  lfo.start(now);
  return {
    stop: () => {
      const t = c.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      o1.stop(t + 0.1);
      o2.stop(t + 0.1);
      lfo.stop(t + 0.1);
      const cleanup = () => {
        try {
          o1.disconnect();
          o2.disconnect();
          lfo.disconnect();
          lfoGain.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {}
      };
      o2.onended = cleanup;
    },
  };
}

function fallbackStartQuestion(): { stop: () => void } | null {
  const made = makeLoopGain(0.12);
  if (!made) return null;
  const { ctx: c, gain } = made;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = 65;
  const pulse = c.createGain();
  pulse.gain.value = 0;
  o.connect(pulse);
  pulse.connect(gain);
  const now = c.currentTime;
  o.start(now);
  // 2Hz gate via scheduled ramps for ~10 minutes (will be stopped before that)
  const period = 0.5;
  const onTime = 0.18;
  const cycles = 1200;
  for (let i = 0; i < cycles; i++) {
    const t = now + i * period;
    pulse.gain.setValueAtTime(0, t);
    pulse.gain.linearRampToValueAtTime(1, t + 0.01);
    pulse.gain.linearRampToValueAtTime(0, t + onTime);
  }
  return {
    stop: () => {
      const t = c.currentTime;
      pulse.gain.cancelScheduledValues(t);
      pulse.gain.setValueAtTime(pulse.gain.value, t);
      pulse.gain.linearRampToValueAtTime(0, t + 0.05);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      o.stop(t + 0.1);
      o.onended = () => {
        try {
          o.disconnect();
          pulse.disconnect();
          gain.disconnect();
        } catch {}
      };
    },
  };
}

function fallbackStartFinal(): { stop: () => void } | null {
  const made = makeLoopGain(0.06);
  if (!made) return null;
  const { ctx: c, gain } = made;
  const freqs = [130.81, 164.81, 196.0, 261.63]; // C3 E3 G3 C4
  const oscs = freqs.map((f) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    return o;
  });
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.1;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.012; // ~±3dB at 0.06 base
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  const now = c.currentTime;
  oscs.forEach((o) => {
    o.start(now);
  });
  lfo.start(now);
  return {
    stop: () => {
      const t = c.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.15);
      oscs.forEach((o) => {
        o.stop(t + 0.18);
      });
      lfo.stop(t + 0.18);
      const cleanup = () => {
        try {
          oscs.forEach((o) => {
            o.disconnect();
          });
          lfo.disconnect();
          lfoGain.disconnect();
          gain.disconnect();
        } catch {}
      };
      oscs[0].onended = cleanup;
    },
  };
}

// ---------------------------------------------------------------------------
// Public loop API — try MP3 loop first, fall back to oscillator loop.
// ---------------------------------------------------------------------------

export function startLobbyAmbience(): void {
  if (muted) return;
  if (loops.lobby) return;
  loops.lobby = tryStartLoop('lobby-ambience') ?? fallbackStartLobby();
}

export function stopLobbyAmbience(): void {
  loops.lobby?.stop();
  loops.lobby = null;
}

export function startQuestionTension(): void {
  if (muted) return;
  preloadLoop('tick-urgent');
  if (loops.question) return;
  loops.question = tryStartLoop('question-tension-long') ?? fallbackStartQuestion();
}

export function stopQuestionTension(fadeMs?: number): void {
  loops.question?.stop(fadeMs);
  loops.question = null;
}

export function startFinalLoop(): void {
  if (muted) return;
  if (loops.final) return;
  loops.final = tryStartLoop('final-bed') ?? fallbackStartFinal();
}

export function stopFinalLoop(): void {
  loops.final?.stop();
  loops.final = null;
}

// ---------------------------------------------------------------------------
// Urgent tick loop — last 3 seconds of the question countdown.
//
// The Suno-generated `tick-urgent.mp3` is a ~12s continuous ticking loop, not
// a 60ms one-shot. We loop it under a higher-than-bed gain so the ticking
// itself carries the urgency without stacking overlapping one-shot ticks.
// ---------------------------------------------------------------------------

const URGENT_PEAK = 1.6;

function startUrgentFallbackInterval(): LoopHandle {
  fallbackTick(true);
  const id =
    typeof window !== 'undefined'
      ? window.setInterval(() => fallbackTick(true), 1000)
      : (setInterval(() => fallbackTick(true), 1000) as unknown as number);
  return {
    stop: () => {
      if (typeof window !== 'undefined') window.clearInterval(id);
      else clearInterval(id);
    },
  };
}

export function startUrgentTickLoop(durMs = 400): void {
  if (muted) return;
  if (loops.urgent) return;
  loops.urgent =
    tryStartLoop('tick-urgent', { peak: URGENT_PEAK, fadeInMs: durMs }) ??
    startUrgentFallbackInterval();
}

export function stopUrgentTickLoop(fadeMs?: number): void {
  loops.urgent?.stop(fadeMs);
  loops.urgent = null;
}

/**
 * Crossfade the question-tension bed into the tick-urgent loop over the given
 * duration. Idempotent — callers should arm a per-question flag and only fire
 * this once when the countdown first crosses the urgency threshold.
 */
export function crossfadeToUrgent(durMs = 400): void {
  if (muted) return;
  stopQuestionTension(durMs);
  startUrgentTickLoop(durMs);
}

export function stopAllLoops(): void {
  stopLobbyAmbience();
  stopQuestionTension();
  stopFinalLoop();
  stopUrgentTickLoop();
}
