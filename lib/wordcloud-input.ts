export const WORDCLOUD_INPUT_MAX = 30;

export type WordCloudInputResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'blank' | 'too_long' | 'multiline' };

const PUNCT_EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Client-side validation for word-cloud submissions. Asks "is this submittable
 * at all?" — distinct from `normalizeWord` in lib/wordcloud.ts, which decides
 * the cluster key on the server. Casing and diacritics are preserved here so
 * the server still gets the player's original spelling.
 */
export function validateWordInput(raw: string): WordCloudInputResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'blank' };
  if (/[\r\n]/.test(raw)) return { ok: false, reason: 'multiline' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'blank' };
  if (trimmed.length > WORDCLOUD_INPUT_MAX) return { ok: false, reason: 'too_long' };
  const stripped = trimmed.replace(PUNCT_EDGE_RE, '');
  if (!stripped) return { ok: false, reason: 'blank' };
  return { ok: true, value: trimmed };
}
