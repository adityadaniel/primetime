import { describe, expect, it } from 'vitest';
import { exportSubmissionsCsv, promptSlug, type WordCloudCsvSubmission } from './wordcloud-csv';

function sub(args: {
  at: string;
  nickname: string;
  rawText: string;
  normalized?: string;
  removed?: boolean;
}): WordCloudCsvSubmission {
  return {
    createdAt: new Date(args.at),
    rawText: args.rawText,
    normalized: args.normalized ?? args.rawText.toLowerCase(),
    removed: args.removed ?? false,
    player: { nickname: args.nickname },
  };
}

describe('exportSubmissionsCsv', () => {
  it('returns header-only CSV for empty input', () => {
    const out = exportSubmissionsCsv([]);
    expect(out).toBe('timestamp,nickname,raw_text,normalized,removed\r\n');
  });

  it('includes the canonical header row', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:00Z', nickname: 'Alice', rawText: 'apple' }),
    ]);
    const lines = out.split('\r\n');
    expect(lines[0]).toBe('timestamp,nickname,raw_text,normalized,removed');
  });

  it('orders rows by createdAt ascending regardless of input order', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:30Z', nickname: 'Bob', rawText: 'beta' }),
      sub({ at: '2026-05-23T10:00:10Z', nickname: 'Alice', rawText: 'alpha' }),
      sub({ at: '2026-05-23T10:00:20Z', nickname: 'Carol', rawText: 'charlie' }),
    ]);
    const rows = out.split('\r\n').filter((l) => l.length > 0);
    expect(rows[1]).toContain('Alice');
    expect(rows[2]).toContain('Carol');
    expect(rows[3]).toContain('Bob');
  });

  it('writes removed=true for trashed submissions', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:00Z', nickname: 'Alice', rawText: 'apple', removed: true }),
      sub({ at: '2026-05-23T10:00:01Z', nickname: 'Bob', rawText: 'beta' }),
    ]);
    const rows = out.split('\r\n').filter((l) => l.length > 0);
    expect(rows[1].endsWith(',true')).toBe(true);
    expect(rows[2].endsWith(',false')).toBe(true);
  });

  it('neutralizes CSV formula injection in raw_text and normalized', () => {
    const out = exportSubmissionsCsv([
      sub({
        at: '2026-05-23T10:00:00Z',
        nickname: 'Alice',
        rawText: '=SUM(A1)',
        normalized: '=sum(a1)',
      }),
      sub({
        at: '2026-05-23T10:00:01Z',
        nickname: 'Bob',
        rawText: '+1+1',
        normalized: '+1+1',
      }),
      sub({
        at: '2026-05-23T10:00:02Z',
        nickname: 'Carol',
        rawText: '-2+3',
        normalized: '-2+3',
      }),
      sub({
        at: '2026-05-23T10:00:03Z',
        nickname: 'Dave',
        rawText: '@CMD',
        normalized: '@cmd',
      }),
    ]);
    expect(out).toContain("'=SUM(A1)");
    expect(out).toContain("'=sum(a1)");
    expect(out).toContain("'+1+1");
    expect(out).toContain("'-2+3");
    expect(out).toContain("'@CMD");
    expect(out).toContain("'@cmd");
    expect(/(^|,)=SUM/.test(out)).toBe(false);
    expect(/(^|,)\+1\+1/.test(out)).toBe(false);
    expect(/(^|,)-2\+3/.test(out)).toBe(false);
    expect(/(^|,)@CMD/.test(out)).toBe(false);
  });

  it('neutralizes formula prefix in nickname column', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:00Z', nickname: '=evil', rawText: 'word' }),
    ]);
    expect(out).toContain("'=evil");
    expect(/(^|,)=evil/.test(out)).toBe(false);
  });

  it('escapes commas, double quotes, and newlines per RFC4180', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:00Z', nickname: 'Smith, Jane', rawText: 'a,b' }),
      sub({ at: '2026-05-23T10:00:01Z', nickname: 'Quoter', rawText: 'he said "hi"' }),
      sub({
        at: '2026-05-23T10:00:02Z',
        nickname: 'NL',
        rawText: 'line1\nline2',
        normalized: 'line1 line2',
      }),
    ]);
    expect(out).toContain('"Smith, Jane"');
    expect(out).toContain('"a,b"');
    expect(out).toContain('"he said ""hi"""');
    expect(out).toContain('"line1\nline2"');
  });

  it('writes ISO timestamps in column 0', () => {
    const out = exportSubmissionsCsv([
      sub({ at: '2026-05-23T10:00:00.000Z', nickname: 'Alice', rawText: 'apple' }),
    ]);
    const rows = out.split('\r\n').filter((l) => l.length > 0);
    expect(rows[1].startsWith('2026-05-23T10:00:00.000Z,')).toBe(true);
  });
});

describe('promptSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(promptSlug('What snack?')).toBe('what-snack');
  });

  it('strips diacritics and punctuation', () => {
    expect(promptSlug("Café déjà vu — what's up?")).toBe('cafe-deja-vu-what-s-up');
  });

  it('truncates to 40 characters and trims trailing hyphens', () => {
    const long = 'a'.repeat(60);
    const out = promptSlug(long);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('falls back to "wordcloud" when prompt has no ascii alnum', () => {
    expect(promptSlug('!!!')).toBe('wordcloud');
    expect(promptSlug('')).toBe('wordcloud');
  });
});
