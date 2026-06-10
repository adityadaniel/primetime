// Real-browser measurement for the answer-button feedback path: tap →
// "LOCKING…" (optimistic render) and tap → "LOCKED" (server-confirmed
// personal), taken while BOTS socket players burst-answer the same question
// so the tap lands inside the fanout window the dead-button bug lived in.
//
// Requires a running server on :4321 with PLAYER_CAP > BOTS.
//   BOTS=119 npx tsx scripts/browser-lock-latency.ts

import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Quiz } from '../lib/types';

const URL = process.env.LOAD_URL ?? 'http://localhost:4321';
const BOTS = Number(process.env.BOTS ?? 119);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quiz: Quiz = {
  title: 'Browser Lock Latency',
  questions: [1, 2, 3].map((n) => ({
    id: `q${n}`,
    type: 'multiple' as const,
    text: `Round ${n}: pick anything`,
    options: ['A', 'B', 'C', 'D'],
    correct: 0,
    timeLimit: 120,
    doublePoints: false,
  })),
};

type Sock = ReturnType<typeof io>;

function connect(): Promise<Sock> {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function main() {
  console.log(`browser lock latency: 1 Chromium player + ${BOTS} bot players against ${URL}`);

  const host = await connect();
  let hostPhase = '';
  host.on('state', (s: { phase: string }) => {
    hostPhase = s.phase;
  });
  const { pin } = await new Promise<{ pin: string }>((r) => host.emit('host:create', quiz, r));
  if (!pin) throw new Error('host:create failed');
  console.log(`pin: ${pin}`);

  const bots: Sock[] = [];
  for (let start = 0; start < BOTS; start += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, BOTS - start) }, async (_, j) => {
        const s = await connect();
        const res = await new Promise<{ ok: boolean; error?: string }>((r) =>
          s.emit('player:join', pin, `BOT${String(start + j + 1).padStart(3, '0')}`, r),
        );
        if (!res.ok) throw new Error(`bot join failed: ${res.error}`);
        return s;
      }),
    );
    bots.push(...batch);
  }
  console.log(`${bots.length} bots joined`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // The play page rejoins from sessionStorage credentials on mount, so seed
  // them the way /join would have.
  await page.addInitScript(
    ({ p }: { p: string }) => {
      sessionStorage.setItem(`bc:player:${p}`, 'pending');
      sessionStorage.setItem(`bc:nick:${p}`, 'CHROMEKID');
    },
    { p: pin },
  );
  await page.goto(`${URL}/play/${pin}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=YOU’RE', { timeout: 60_000 }).catch(() => {});
  await sleep(500);
  // tsx runs this script through esbuild, whose serialized closures reference
  // the __name helper; it doesn't exist inside the page, so shim it.
  await page.evaluate('window.__name = (fn) => fn');

  const results: { round: number; tapToLocking: number | null; tapToLocked: number | null }[] = [];

  for (let q = 0; q < quiz.questions.length; q++) {
    if (q === 0) {
      host.emit('host:start', pin);
    } else {
      host.emit('host:advance', pin); // reveal -> leaderboard
      await sleep(300);
      host.emit('host:advance', pin); // leaderboard -> question
    }
    await page.waitForSelector('.answer-tile', { timeout: 60_000 });
    await sleep(200);
    if (hostPhase !== 'question') throw new Error(`expected question phase, got ${hostPhase}`);

    // Fire the bot burst, then tap from the browser while it is in flight.
    // One bot abstains so the browser's answer never completes the question:
    // otherwise the all-answered reveal cut can land in the same React commit
    // as the LOCKED confirmation and the stamp is never painted. This means
    // tap→LOCKED measures the targeted-personal path — the path every answer
    // takes except the question-closing one, whose confirmation rides the
    // phase-flip broadcast and is superseded by the reveal cut anyway.
    const abstainer = bots[bots.length - 1];
    const botAcks = bots.slice(0, -1).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.emit('player:answer', pin, Math.floor(Math.random() * 4), () => resolve());
        }),
    );
    await sleep(15);

    const marks = await page.evaluate(() => {
      return new Promise<{ tapToLocking: number | null; tapToLocked: number | null }>((resolve) => {
        let tLocking: number | null = null;
        let tLocked: number | null = null;
        const finish = () => {
          obs.disconnect();
          clearTimeout(bail);
          resolve({
            tapToLocking: tLocking === null ? null : tLocking - t0,
            tapToLocked: tLocked === null ? null : tLocked - t0,
          });
        };
        const check = () => {
          const txt = document.body.innerText;
          if (tLocking === null && txt.includes('LOCKING…')) tLocking = performance.now();
          if (tLocked === null && /\bLOCKED\b/.test(txt) && !txt.includes('LOCKING…')) {
            tLocked = performance.now();
          }
          if (tLocking !== null && tLocked !== null) finish();
        };
        const obs = new MutationObserver(check);
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        const bail = setTimeout(finish, 10_000);
        const btn = document.querySelector<HTMLButtonElement>('.answer-tile');
        if (!btn) {
          finish();
          return;
        }
        const t0 = performance.now();
        btn.click();
        check();
      });
    });

    await Promise.all(botAcks);
    // let the abstainer finish the question so the game can advance
    await new Promise<void>((resolve) => {
      abstainer.emit('player:answer', pin, 0, () => resolve());
    });
    results.push({ round: q + 1, ...marks });
    const fmt = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 10) / 10}ms`);
    console.log(
      `round ${q + 1}: tap→LOCKING… ${fmt(marks.tapToLocking)} · tap→LOCKED ${fmt(marks.tapToLocked)}`,
    );
    if (marks.tapToLocking === null || marks.tapToLocked === null) {
      console.warn(
        `round ${q + 1}: INCOMPLETE — a transition was not observed within 10s; treat this run's numbers as suspect`,
      );
    }
    await sleep(500);
  }

  const got = results.filter((r) => r.tapToLocking !== null);
  if (got.length === 0) throw new Error('LOCKING… was never observed — measurement failed');

  await browser.close();
  host.disconnect();
  for (const s of bots) s.disconnect();
  console.log(
    'harness shape: one Chromium (headless) + bot sockets in one Node process, loopback server',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

setTimeout(() => {
  console.error('[browser-lock-latency] hard timeout 180s');
  process.exit(2);
}, 180_000).unref();
