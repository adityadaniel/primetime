// Pure text→word-frequency analysis for WonderWall room insights (word cloud).
// Feeds the existing layout engine (lib/wordcloud-layout.ts `layoutWords`).
// No DB, no network, no React — fully unit-testable.
//
// Operates on LinkedIn post BODIES fetched via Apify (DECISIONS.md 2026-06-21
// "WonderWall content analysis"). Tokenization mirrors lib/wordcloud.ts
// normalization (lowercase + NFD diacritic strip), then splits on non-word
// characters, drops stopwords + very short tokens, and counts frequencies.

import { isStopword } from './stopwords';
import type { LayoutInputWord } from './wordcloud-layout';

const COMBINING_RE = /\p{M}/gu;
// Split on anything that is not a letter, number, or in-word mark (' or -).
const TOKEN_SPLIT_RE = /[^\p{L}\p{N}'-]+/u;
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const MIN_TOKEN_LEN = 2;
// Drop pure-number tokens (years can stay if >2 digits? keep simple: drop all-digit).
const ALL_DIGITS_RE = /^\d+$/;

/** Tokenize one text into normalized, stopword-filtered words. */
export function tokenize(text: string): string[] {
  if (typeof text !== 'string' || !text) return [];
  const lowered = text.toLowerCase().normalize('NFD').replace(COMBINING_RE, '');
  const out: string[] = [];
  for (const raw of lowered.split(TOKEN_SPLIT_RE)) {
    const token = raw.replace(EDGE_PUNCT_RE, '');
    if (token.length < MIN_TOKEN_LEN) continue;
    if (ALL_DIGITS_RE.test(token)) continue;
    if (isStopword(token)) continue;
    out.push(token);
  }
  return out;
}

/**
 * Turn a batch of post texts into sorted word counts ready for `layoutWords`.
 * Tokens are already lowercased/normalized, so `display === normalized`.
 */
export function textToWordCounts(texts: string[]): LayoutInputWord[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const words: LayoutInputWord[] = [];
  for (const [normalized, count] of counts) {
    words.push({ display: normalized, normalized, count });
  }

  words.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.normalized.localeCompare(b.normalized);
  });
  return words;
}
