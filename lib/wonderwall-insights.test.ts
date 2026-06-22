import { describe, expect, it } from 'vitest';
import { textToWordCounts, tokenize } from './wonderwall-insights';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords + short tokens', () => {
    expect(tokenize('The QUICK brown fox!')).toEqual(['quick', 'brown', 'fox']);
  });

  it('strips diacritics', () => {
    expect(tokenize('Café résumé')).toEqual(['cafe', 'resume']);
  });

  it('drops all-digit and single-char tokens', () => {
    // 'a' + 'i' are stopwords; 'x' is a single char; '2026' is all digits.
    expect(tokenize('a 2026 ok I x')).toEqual(['ok']);
  });

  it('keeps hashtag words (after stripping the #)', () => {
    expect(tokenize('We are #hiring now')).toEqual(['hiring']);
  });

  it('returns [] for empty / non-string', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null as unknown as string)).toEqual([]);
  });
});

describe('textToWordCounts', () => {
  it('counts across texts, sorted by count desc then alphabetically', () => {
    const out = textToWordCounts(['AI builds AI', 'builds great products', 'AI AI']);
    expect(out[0]).toEqual({ display: 'ai', normalized: 'ai', count: 4 });
    expect(out[1]).toEqual({ display: 'builds', normalized: 'builds', count: 2 });
    expect(out.map((w) => w.normalized)).toEqual(['ai', 'builds', 'great', 'products']);
  });

  it('yields [] when only stopwords/short words are present', () => {
    expect(textToWordCounts(['the and of to a I', ''])).toEqual([]);
  });
});
