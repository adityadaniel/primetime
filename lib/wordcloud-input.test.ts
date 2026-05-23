import { describe, expect, it } from 'vitest';
import { validateWordInput, WORDCLOUD_INPUT_MAX } from './wordcloud-input';

describe('validateWordInput', () => {
  it('accepts a plain word and returns the trimmed value', () => {
    expect(validateWordInput('hello')).toEqual({ ok: true, value: 'hello' });
  });

  it('trims leading and trailing whitespace', () => {
    expect(validateWordInput('  excited  ')).toEqual({ ok: true, value: 'excited' });
  });

  it('preserves original casing (server normalizes for clustering)', () => {
    expect(validateWordInput('Excited')).toEqual({ ok: true, value: 'Excited' });
    expect(validateWordInput('HELLO')).toEqual({ ok: true, value: 'HELLO' });
  });

  it('preserves diacritics for the display layer', () => {
    expect(validateWordInput('café')).toEqual({ ok: true, value: 'café' });
  });

  it('accepts words with leading/trailing punctuation as long as letters remain', () => {
    expect(validateWordInput('!hello!')).toEqual({ ok: true, value: '!hello!' });
  });

  it('rejects strings that are blank after trimming', () => {
    expect(validateWordInput('')).toEqual({ ok: false, reason: 'blank' });
    expect(validateWordInput('   ')).toEqual({ ok: false, reason: 'blank' });
  });

  it('rejects strings that have only punctuation (nothing left after edge strip)', () => {
    expect(validateWordInput('!!!')).toEqual({ ok: false, reason: 'blank' });
    expect(validateWordInput('...')).toEqual({ ok: false, reason: 'blank' });
  });

  it('rejects strings longer than 30 chars after trim', () => {
    expect(validateWordInput('a'.repeat(WORDCLOUD_INPUT_MAX + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('accepts the boundary length (exactly 30)', () => {
    expect(validateWordInput('a'.repeat(WORDCLOUD_INPUT_MAX))).toEqual({
      ok: true,
      value: 'a'.repeat(WORDCLOUD_INPUT_MAX),
    });
  });

  it('rejects internal newlines or carriage returns', () => {
    expect(validateWordInput('hello\nworld')).toEqual({ ok: false, reason: 'multiline' });
    expect(validateWordInput('hello\r\nworld')).toEqual({ ok: false, reason: 'multiline' });
  });

  it('rejects non-string input defensively', () => {
    expect(validateWordInput(undefined as unknown as string)).toEqual({
      ok: false,
      reason: 'blank',
    });
    expect(validateWordInput(null as unknown as string)).toEqual({ ok: false, reason: 'blank' });
  });
});
