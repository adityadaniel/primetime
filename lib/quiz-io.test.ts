import { describe, expect, it } from 'vitest';
import { parseQuiz, serializeQuiz } from './quiz-io';

const baseQuestion = {
  type: 'multiple' as const,
  text: 'Q1',
  options: ['a', 'b', 'c', 'd'],
  correct: 0,
  timeLimit: 10,
  doublePoints: false,
};

describe('quiz-io imageUrl round-trip (MID-278)', () => {
  it('serializes imageUrl when present', () => {
    const json = serializeQuiz({
      title: 'T',
      questions: [{ ...baseQuestion, imageUrl: '/uploads/quiz-images/pic.png' }],
    });
    const parsed = JSON.parse(json);
    expect(parsed.questions[0].imageUrl).toBe('/uploads/quiz-images/pic.png');
  });

  it('omits imageUrl from output when absent', () => {
    const json = serializeQuiz({ title: 'T', questions: [baseQuestion] });
    const parsed = JSON.parse(json);
    expect('imageUrl' in parsed.questions[0]).toBe(false);
  });

  it('preserves imageUrl through parseQuiz', () => {
    const json = serializeQuiz({
      title: 'T',
      questions: [{ ...baseQuestion, imageUrl: '/uploads/quiz-images/pic.png' }],
    });
    const result = parseQuiz(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.questions[0].imageUrl).toBe('/uploads/quiz-images/pic.png');
    }
  });

  it('still accepts legacy text-only quizzes without imageUrl', () => {
    const json = serializeQuiz({ title: 'T', questions: [baseQuestion] });
    const result = parseQuiz(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.questions[0].imageUrl).toBeUndefined();
    }
  });
});
