import { describe, expect, it } from 'vitest';
import { QA_QUESTION_DEFAULT_CHAR_LIMIT, validateQuestionInput } from './qa-input';

describe('validateQuestionInput', () => {
  it('trims surrounding whitespace and accepts the trimmed text', () => {
    expect(validateQuestionInput('  What comes next?  ')).toEqual({
      ok: true,
      value: 'What comes next?',
    });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(validateQuestionInput('')).toEqual({ ok: false, reason: 'empty_text' });
    expect(validateQuestionInput('   ')).toEqual({ ok: false, reason: 'empty_text' });
    expect(validateQuestionInput('\n\t ')).toEqual({ ok: false, reason: 'empty_text' });
  });

  it('rejects non-string input as empty', () => {
    expect(validateQuestionInput(undefined as unknown as string)).toEqual({
      ok: false,
      reason: 'empty_text',
    });
    expect(validateQuestionInput(42 as unknown as string)).toEqual({
      ok: false,
      reason: 'empty_text',
    });
  });

  it('enforces the default 280-character limit on the trimmed text', () => {
    expect(QA_QUESTION_DEFAULT_CHAR_LIMIT).toBe(280);
    expect(validateQuestionInput('a'.repeat(280)).ok).toBe(true);
    expect(validateQuestionInput('a'.repeat(281))).toEqual({
      ok: false,
      reason: 'text_too_long',
    });
    // Surrounding whitespace does not count against the limit.
    expect(validateQuestionInput(`  ${'a'.repeat(280)}  `).ok).toBe(true);
  });

  it('enforces a custom per-session limit', () => {
    expect(validateQuestionInput('a'.repeat(10), 10).ok).toBe(true);
    expect(validateQuestionInput('a'.repeat(11), 10)).toEqual({
      ok: false,
      reason: 'text_too_long',
    });
  });

  it('does not censor or rewrite the question text', () => {
    // Moderation is the PRD mechanism for unwanted questions — validation
    // must never silently alter what the participant wrote.
    const spicy = 'Why is the damn build broken?! (seriously...)';
    expect(validateQuestionInput(spicy)).toEqual({ ok: true, value: spicy });
    const multiline = 'Two part question:\n1) why?\n2) how?';
    expect(validateQuestionInput(multiline)).toEqual({ ok: true, value: multiline });
  });
});
