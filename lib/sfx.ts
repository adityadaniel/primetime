'use client';

const MUTE_KEY = 'bc:sfx:muted';
const VOL_KEY = 'bc:sfx:vol';
const DEFAULT_VOLUME = 0.6;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let masterVolume = DEFAULT_VOLUME;

const loops: { [k: string]: { stop: () => void } | null } = {
  lobby: null,
  question: null,
  final: null,
};

function readPersisted() {
  if (typeof window === 'undefined') return;
  try {
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

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {}
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

export function sfxClick(): void {
  blip(4000, 0.03, 'sine', { peak: 0.25, attack: 0.002, release: 0.028 });
}

export function sfxLockIn(): void {
  const env = ensureCtx();
  if (!env || muted) return;
  blip(880, 0.06, 'square', { peak: 0.3, attack: 0.003, release: 0.057 }, undefined, 0);
  blip(1320, 0.06, 'square', { peak: 0.3, attack: 0.003, release: 0.057 }, undefined, 0.06);
}

export function sfxTick(urgent = false): void {
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

export function sfxCorrect(): void {
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

export function sfxWrong(): void {
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

export function sfxTimeUp(): void {
  const pattern = [0, 0.1, 0.2, 0.3];
  for (const t of pattern) {
    blip(220, 0.06, 'square', { peak: 0.35, attack: 0.001, release: 0.058 }, undefined, t);
    blip(110, 0.06, 'square', { peak: 0.35, attack: 0.001, release: 0.058 }, undefined, t);
  }
}

export function sfxLeaderboardSweep(): void {
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

export function sfxFinalFanfare(): void {
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

export function startLobbyAmbience(): void {
  if (muted) return;
  if (loops.lobby) return;
  const made = makeLoopGain(0.06);
  if (!made) return;
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
  loops.lobby = {
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

export function stopLobbyAmbience(): void {
  loops.lobby?.stop();
  loops.lobby = null;
}

export function startQuestionTension(): void {
  if (muted) return;
  if (loops.question) return;
  const made = makeLoopGain(0.12);
  if (!made) return;
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
  loops.question = {
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

export function stopQuestionTension(): void {
  loops.question?.stop();
  loops.question = null;
}

export function startFinalLoop(): void {
  if (muted) return;
  if (loops.final) return;
  const made = makeLoopGain(0.06);
  if (!made) return;
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
  loops.final = {
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

export function stopFinalLoop(): void {
  loops.final?.stop();
  loops.final = null;
}

export function stopAllLoops(): void {
  stopLobbyAmbience();
  stopQuestionTension();
  stopFinalLoop();
}
