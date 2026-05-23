// Deterministic editorial-pile layout for the word cloud display surface.
// Pure function, no DOM, no React. Same seed + same words ⇒ identical output.

export type LayoutColor = 'ink' | 'ink-pink' | 'ink-blue';

export type LayoutInputWord = {
  display: string;
  normalized: string;
  count: number;
};

export type LayoutInput = {
  words: LayoutInputWord[];
  seed: string;
  viewport: { width: number; height: number };
  /**
   * Hard cap on visible words. Anything beyond this is dropped from the
   * placement loop and surfaced via the returned `omitted` count so the
   * display can render a "+N more" indicator (F9).
   */
  maxWords?: number;
};

export type LayoutPlacement = {
  word: string;
  normalized: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  rotation: number;
  color: LayoutColor;
};

export type LayoutResult = {
  placements: LayoutPlacement[];
  omitted: number;
};

const MIN_FONT = 24;
const MAX_FONT_TOP = 200; // ranks 0-4
const MAX_FONT_MID = 90; // ranks 5-19
const MAX_FONT_TAIL = 50; // ranks 20+
const BASELINE_VIEWPORT_WIDTH = 1920;
const ROTATION_BUCKETS: readonly number[] = [-15, -7, 0, 0, 0, 7, 15];
// Spiral retries — bumped from 60 to 240 so 150+ unique words can find a slot
// (F9). Combined with a tighter padding it gets us past the 87% placement bar.
const COLLISION_RETRY_LIMIT = 240;
const SPIRAL_STEP = 14;
const SPIRAL_GROWTH = 0.55;
// Approximate width-per-character ratio for serif display type at the chosen
// font sizes. We don't measure text on the server — we only need a stable
// estimate so collision boxes are roughly right.
const CHAR_WIDTH_RATIO = 0.55;
const LINE_HEIGHT_RATIO = 1.05;
// Padding tightened from (10, 6) → (8, 5) so smaller words can sit closer
// without visually colliding (F9).
const PAD_X = 8;
const PAD_Y = 5;
const DEFAULT_MAX_WORDS = 150;

export function layoutWords(input: LayoutInput): LayoutPlacement[] {
  return layoutWordsDetailed(input).placements;
}

export function layoutWordsDetailed(input: LayoutInput): LayoutResult {
  if (input.words.length === 0) return { placements: [], omitted: 0 };

  const { width, height } = input.viewport;
  const scale = Math.min(1, width / BASELINE_VIEWPORT_WIDTH);
  const minFont = MIN_FONT * scale;

  const sorted = [...input.words].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.normalized.localeCompare(b.normalized);
  });
  const maxCount = sorted[0].count;
  const cap = input.maxWords ?? DEFAULT_MAX_WORDS;
  const omitted = sorted.length > cap ? sorted.length - cap : 0;
  const visible = sorted.slice(0, cap);

  const seedHash = hashString(input.seed);
  const rand = mulberry32(seedHash);

  const placements: LayoutPlacement[] = [];
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < visible.length; i++) {
    const word = visible[i];
    const fontSize = perceptualFontSize(i, word.count, maxCount, minFont, scale);
    const rotation = pickRotation(input.seed, word.normalized);
    const color = pickColor(i);
    const box = boundingBox(word.display, fontSize, rotation);

    const placement = placeWithCollisionAvoidance({
      cx,
      cy,
      box,
      width,
      height,
      placements,
      rand,
      index: i,
    });
    if (!placement) continue;

    placements.push({
      word: word.display,
      normalized: word.normalized,
      x: placement.x,
      y: placement.y,
      width: box.width,
      height: box.height,
      fontSize,
      rotation,
      color,
    });
  }

  return { placements, omitted };
}

// Tiered font scale (F9). Top 5 words use the original sqrt curve at the full
// 200px max so they remain dominant. Ranks 5-19 cap at MAX_FONT_MID, ranks 20+
// cap at MAX_FONT_TAIL — this is what lets a 150-word cloud actually fit.
function perceptualFontSize(
  rank: number,
  count: number,
  maxCount: number,
  minFont: number,
  scale: number,
): number {
  const cap = rank <= 4 ? MAX_FONT_TOP : rank <= 19 ? MAX_FONT_MID : MAX_FONT_TAIL;
  const maxFont = cap * scale;
  if (maxCount <= 0) return minFont;
  const ratio = Math.sqrt(Math.max(0, count) / maxCount);
  return minFont + ratio * (maxFont - minFont);
}

function pickRotation(seed: string, normalized: string): number {
  const h = hashString(`${seed}::${normalized}`);
  const idx = h % ROTATION_BUCKETS.length;
  return ROTATION_BUCKETS[idx];
}

function pickColor(rank: number): LayoutColor {
  if (rank === 0) return 'ink-pink';
  if (rank >= 2 && rank <= 6 && rank % 2 === 0) return 'ink-blue';
  return 'ink';
}

type Box = { width: number; height: number };

function boundingBox(text: string, fontSize: number, rotationDeg: number): Box {
  const len = Math.max(1, text.length);
  const baseWidth = len * fontSize * CHAR_WIDTH_RATIO + PAD_X * 2;
  const baseHeight = fontSize * LINE_HEIGHT_RATIO + PAD_Y * 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: baseWidth * cos + baseHeight * sin,
    height: baseWidth * sin + baseHeight * cos,
  };
}

type PlaceArgs = {
  cx: number;
  cy: number;
  box: Box;
  width: number;
  height: number;
  placements: LayoutPlacement[];
  rand: () => number;
  index: number;
};

function placeWithCollisionAvoidance(args: PlaceArgs): { x: number; y: number } | null {
  const { cx, cy, box, width, height, placements, rand, index } = args;

  // Top word lands dead-center; everything else spirals out from a slightly
  // jittered start angle so placements don't all collide on the same axis.
  const startAngle = index === 0 ? 0 : rand() * Math.PI * 2;

  for (let attempt = 0; attempt < COLLISION_RETRY_LIMIT; attempt++) {
    const t = attempt;
    const radius = index === 0 ? 0 : SPIRAL_STEP + t * SPIRAL_GROWTH * SPIRAL_STEP;
    const angle = startAngle + t * 0.6;
    const ex = cx + Math.cos(angle) * radius;
    const ey = cy + Math.sin(angle) * radius;

    const x = ex - box.width / 2;
    const y = ey - box.height / 2;

    if (x < 0 || y < 0 || x + box.width > width || y + box.height > height) {
      continue;
    }
    if (!collides(x, y, box, placements)) {
      return { x, y };
    }
  }
  return null;
}

function collides(x: number, y: number, box: Box, placements: LayoutPlacement[]): boolean {
  for (const p of placements) {
    if (x + box.width <= p.x) continue;
    if (x >= p.x + p.width) continue;
    if (y + box.height <= p.y) continue;
    if (y >= p.y + p.height) continue;
    return true;
  }
  return false;
}

// 32-bit FNV-1a — small, deterministic, fine for layout seeding.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 PRNG. ~10 lines, deterministic, good enough for layout jitter.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
