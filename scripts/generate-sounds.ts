/*
 * generate-sounds.ts
 *
 * Submit, poll, and download sound assets from the kie.ai Suno Sounds API
 * into `public/sounds/`.
 *
 * Usage:
 *   tsx scripts/generate-sounds.ts                 # generate all missing sounds
 *   tsx scripts/generate-sounds.ts --only=lock-in  # one slug
 *   tsx scripts/generate-sounds.ts --only=a,b,c    # multiple slugs
 *   tsx scripts/generate-sounds.ts --force         # regenerate even if mp3 exists
 *   tsx scripts/generate-sounds.ts --dry-run       # print plan, no API call
 *   tsx scripts/generate-sounds.ts --model=V5      # override model (default V5_5)
 *
 * Env:
 *   KIE_API_KEY  required (read from process.env)
 *
 * Notes:
 *  - Idempotent: existing `public/sounds/<slug>.mp3` is skipped unless --force.
 *  - Polls task status every 30 s up to 10 minutes (kie recommendation).
 *  - On success, downloads `audioUrl` to `public/sounds/<slug>.mp3` and updates
 *    `public/sounds/manifest.json`.
 *  - Cached task IDs go to `public/sounds/.tasks/<slug>.json` so a re-run after
 *    a crash resumes the existing task instead of paying for a new one.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SOUNDS, type SoundSpec } from './sounds-manifest';

const API_BASE = 'https://api.kie.ai';
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'sounds');
const TASK_DIR = path.join(OUT_DIR, '.tasks');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

type Args = {
  only: string[] | null;
  force: boolean;
  dryRun: boolean;
  model: 'V5' | 'V5_5';
};

function parseArgs(argv: string[]): Args {
  const out: Args = { only: null, force: false, dryRun: false, model: 'V5_5' };
  for (const a of argv.slice(2)) {
    if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--only=')) {
      out.only = a
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--model=')) {
      const m = a.slice('--model='.length);
      if (m !== 'V5' && m !== 'V5_5') {
        throw new Error(`unknown --model: ${m} (expected V5 or V5_5)`);
      }
      out.model = m;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`generate-sounds — submit, poll, and download Suno Sounds for INPUT/OUTPUT.

Usage:
  tsx scripts/generate-sounds.ts [flags]

Flags:
  --only=<slug[,slug...]>   Generate only listed slugs.
  --force                   Regenerate even if mp3 already exists.
  --dry-run                 Print the plan without calling the API.
  --model=V5|V5_5           Suno model. Default V5_5.
  -h, --help                This message.

Slugs:
${SOUNDS.map((s) => `  - ${s.slug.padEnd(22)} ${s.label}`).join('\n')}`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

type SubmitResp = {
  code: number;
  msg: string;
  data?: { taskId?: string };
};

async function submit(spec: SoundSpec, model: 'V5' | 'V5_5', apiKey: string): Promise<string> {
  const body: Record<string, unknown> = {
    prompt: spec.prompt,
    model,
    soundLoop: spec.soundLoop,
  };
  if (spec.soundTempo !== undefined) body.soundTempo = spec.soundTempo;
  if (spec.soundKey !== undefined) body.soundKey = spec.soundKey;

  const res = await fetch(`${API_BASE}/api/v1/generate/sounds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: SubmitResp;
  try {
    json = JSON.parse(text) as SubmitResp;
  } catch {
    throw new Error(`submit ${spec.slug}: non-JSON response (HTTP ${res.status}): ${text}`);
  }
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(
      `submit ${spec.slug}: code=${json.code} msg=${json.msg ?? '(no msg)'} body=${text}`,
    );
  }
  return json.data.taskId;
}

type SunoTrack = {
  id?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
  prompt?: string;
};

type RecordInfoResp = {
  code: number;
  msg: string;
  data?: {
    taskId?: string;
    status?: string;
    response?: { sunoData?: SunoTrack[] };
    errorMessage?: string;
  };
};

async function pollOnce(taskId: string, apiKey: string): Promise<RecordInfoResp> {
  const url = `${API_BASE}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  let json: RecordInfoResp;
  try {
    json = JSON.parse(text) as RecordInfoResp;
  } catch {
    throw new Error(`poll ${taskId}: non-JSON response (HTTP ${res.status}): ${text}`);
  }
  return json;
}

async function pollUntilReady(taskId: string, apiKey: string): Promise<SunoTrack> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    attempt += 1;
    const json = await pollOnce(taskId, apiKey);
    const status = json.data?.status ?? 'UNKNOWN';
    const tracks = json.data?.response?.sunoData ?? [];
    const ready = tracks.find((t) => t.audioUrl);
    console.log(
      `  [poll #${attempt}] status=${status} tracks=${tracks.length}` +
        (ready ? ` audioUrl=ready` : ''),
    );
    if (status === 'SUCCESS' && ready) return ready;
    if (status === 'FIRST_SUCCESS' && ready) return ready;
    if (
      status === 'CREATE_TASK_FAILED' ||
      status === 'GENERATE_AUDIO_FAILED' ||
      status === 'CALLBACK_EXCEPTION' ||
      status === 'SENSITIVE_WORD_ERROR'
    ) {
      throw new Error(
        `task ${taskId} failed: status=${status} msg=${json.msg} err=${json.data?.errorMessage ?? '(none)'}`,
      );
    }
    if (json.code !== 200) {
      throw new Error(`task ${taskId}: code=${json.code} msg=${json.msg}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

async function downloadTo(url: string, dest: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

type ManifestEntry = {
  slug: string;
  label: string;
  surface: string;
  file: string;
  loop: boolean;
  durationSec?: number;
  bpm?: number;
  key?: string;
  prompt: string;
  taskId: string;
  trackId?: string;
  model: string;
  generatedAt: string;
};

type Manifest = {
  generatedAt: string;
  model: string;
  entries: Record<string, ManifestEntry>;
};

async function readManifest(): Promise<Manifest> {
  if (!(await exists(MANIFEST_PATH))) {
    return { generatedAt: '', model: '', entries: {} };
  }
  const text = await readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(text) as Manifest;
}

async function writeManifest(m: Manifest): Promise<void> {
  await writeFile(MANIFEST_PATH, `${JSON.stringify(m, null, 2)}\n`);
}

async function readCachedTaskId(slug: string): Promise<string | null> {
  const p = path.join(TASK_DIR, `${slug}.json`);
  if (!(await exists(p))) return null;
  try {
    const obj = JSON.parse(await readFile(p, 'utf8')) as { taskId?: string };
    return obj.taskId ?? null;
  } catch {
    return null;
  }
}

async function writeCachedTaskId(slug: string, taskId: string): Promise<void> {
  await mkdir(TASK_DIR, { recursive: true });
  await writeFile(
    path.join(TASK_DIR, `${slug}.json`),
    `${JSON.stringify({ taskId, savedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

async function generate(
  spec: SoundSpec,
  args: Args,
  apiKey: string,
  manifest: Manifest,
): Promise<void> {
  const dest = path.join(OUT_DIR, `${spec.slug}.mp3`);
  if (!args.force && (await exists(dest))) {
    console.log(`✓ ${spec.slug} — already exists, skipping (use --force to regenerate)`);
    return;
  }

  console.log(`→ ${spec.slug} — ${spec.label}`);
  if (args.dryRun) {
    console.log(`  [dry-run] would POST /api/v1/generate/sounds`);
    console.log(`  prompt: ${spec.prompt}`);
    console.log(
      `  loop=${spec.soundLoop} bpm=${spec.soundTempo ?? '-'} key=${spec.soundKey ?? '-'} model=${args.model}`,
    );
    return;
  }

  let taskId = await readCachedTaskId(spec.slug);
  if (taskId) {
    console.log(`  resuming cached task ${taskId}`);
  } else {
    taskId = await submit(spec, args.model, apiKey);
    await writeCachedTaskId(spec.slug, taskId);
    console.log(`  submitted, taskId=${taskId}`);
  }

  const track = await pollUntilReady(taskId, apiKey);
  if (!track.audioUrl) throw new Error(`task ${taskId} returned no audioUrl`);
  console.log(`  downloading ${track.audioUrl}`);
  const bytes = await downloadTo(track.audioUrl, dest);
  console.log(`  ✓ wrote ${path.relative(ROOT, dest)} (${(bytes / 1024).toFixed(1)} KB)`);

  manifest.entries[spec.slug] = {
    slug: spec.slug,
    label: spec.label,
    surface: spec.surface,
    file: `/sounds/${spec.slug}.mp3`,
    loop: spec.soundLoop,
    durationSec: track.duration,
    bpm: spec.soundTempo,
    key: spec.soundKey,
    prompt: spec.prompt,
    taskId,
    trackId: track.id,
    model: args.model,
    generatedAt: new Date().toISOString(),
  };
  manifest.generatedAt = new Date().toISOString();
  manifest.model = args.model;
  await writeManifest(manifest);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey && !args.dryRun) {
    console.error('error: KIE_API_KEY env var is required (set in ~/.zshrc or .env.local).');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await readManifest();

  const targets = args.only ? SOUNDS.filter((s) => args.only!.includes(s.slug)) : SOUNDS;
  if (args.only && targets.length !== args.only.length) {
    const known = new Set(SOUNDS.map((s) => s.slug));
    const missing = args.only.filter((s) => !known.has(s));
    if (missing.length) throw new Error(`unknown slugs: ${missing.join(', ')}`);
  }
  if (!targets.length) {
    console.log('nothing to do.');
    return;
  }

  console.log(
    `generate-sounds: ${targets.length} target(s), model=${args.model}` +
      (args.force ? ' [force]' : '') +
      (args.dryRun ? ' [dry-run]' : ''),
  );
  console.log('');

  let ok = 0;
  let failed = 0;
  for (const spec of targets) {
    try {
      await generate(spec, args, apiKey ?? '', manifest);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`✗ ${spec.slug} — ${(err as Error).message}`);
    }
    console.log('');
  }

  console.log(`done. ${ok} succeeded, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error((err as Error).stack ?? err);
  process.exit(1);
});
