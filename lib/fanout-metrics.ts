import { type IntervalHistogram, monitorEventLoopDelay, performance } from 'node:perf_hooks';

// Env-gated instrumentation for the realtime answer/fanout PR gate
// (.github/PULL_REQUEST_TEMPLATE.md, docs/120-player-answer-stress-test.md).
// Off by default — every record call is a no-op unless the server runs with
// FANOUT_METRICS=1. scripts/load-fanout.ts reads snapshots over
// GET /__fanout-metrics?reset=1 between answer bursts.

export const fanoutMetricsEnabled =
  process.env.FANOUT_METRICS === '1' || process.env.FANOUT_METRICS === 'true';

/** Why a full room broadcast happened. `answer` = coalesced answer-driven
 * tick; `phase` = game phase actually changed; `membership` = join/leave/
 * attach traffic; `other` = anything untagged. */
export type BroadcastReason = 'answer' | 'phase' | 'membership' | 'other';

interface ReasonCounters {
  answer: number;
  phase: number;
  membership: number;
  other: number;
}

interface FanoutCounters {
  /** One per `io.to(room).emit('state')` call, by cause. */
  stateEmits: ReasonCounters;
  /** Socket deliveries those state emits fan out to (room size at emit time). */
  stateDeliveries: ReasonCounters;
  /** Per-player `personal` emits issued inside full broadcasts, by cause. */
  personalEmits: ReasonCounters;
  /** Targeted `personal` sent only to the answering socket. */
  personalTargetedEmits: number;
  /** player:answer handler-entry → ack-callback durations. */
  ackTimingsMs: number[];
  /** player:answer rejections by reason. */
  rejections: Record<string, number>;
}

function emptyReasons(): ReasonCounters {
  return { answer: 0, phase: 0, membership: 0, other: 0 };
}

function emptyCounters(): FanoutCounters {
  return {
    stateEmits: emptyReasons(),
    stateDeliveries: emptyReasons(),
    personalEmits: emptyReasons(),
    personalTargetedEmits: 0,
    ackTimingsMs: [],
    rejections: {},
  };
}

let counters = emptyCounters();

const loopDelay: IntervalHistogram | null = fanoutMetricsEnabled
  ? monitorEventLoopDelay({ resolution: 10 })
  : null;
loopDelay?.enable();

export function nowMs(): number {
  return performance.now();
}

export function recordBroadcast(
  reason: BroadcastReason,
  roomSize: number,
  personals: number,
): void {
  if (!fanoutMetricsEnabled) return;
  counters.stateEmits[reason] += 1;
  counters.stateDeliveries[reason] += roomSize;
  counters.personalEmits[reason] += personals;
}

export function recordTargetedPersonal(): void {
  if (!fanoutMetricsEnabled) return;
  counters.personalTargetedEmits += 1;
}

export function recordAnswerAck(ms: number, rejectionReason?: string): void {
  if (!fanoutMetricsEnabled) return;
  // Bounded so a long-lived instrumented server can't grow this without a
  // reset; percentiles over the first 100k samples are signal enough.
  if (counters.ackTimingsMs.length < 100_000) counters.ackTimingsMs.push(ms);
  if (rejectionReason) {
    counters.rejections[rejectionReason] = (counters.rejections[rejectionReason] ?? 0) + 1;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function snapshotFanoutMetrics(reset: boolean) {
  const acks = [...counters.ackTimingsMs].sort((a, b) => a - b);
  const round = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
  const nsToMs = (v: number) => Math.round(v / 1000) / 1000;
  const snapshot = {
    enabled: fanoutMetricsEnabled,
    ackTimingMs: {
      count: acks.length,
      p50: round(percentile(acks, 50)),
      p95: round(percentile(acks, 95)),
      p99: round(percentile(acks, 99)),
      max: round(acks.at(-1) ?? null),
    },
    eventLoopDelayMs: loopDelay
      ? {
          p50: nsToMs(loopDelay.percentile(50)),
          p95: nsToMs(loopDelay.percentile(95)),
          p99: nsToMs(loopDelay.percentile(99)),
          max: nsToMs(loopDelay.max),
        }
      : null,
    stateEmits: counters.stateEmits,
    stateDeliveries: counters.stateDeliveries,
    personalEmits: counters.personalEmits,
    personalTargetedEmits: counters.personalTargetedEmits,
    rejections: counters.rejections,
  };
  if (reset) {
    counters = emptyCounters();
    loopDelay?.reset();
  }
  return snapshot;
}
