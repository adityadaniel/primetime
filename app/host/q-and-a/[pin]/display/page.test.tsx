import { describe, expect, it } from 'vitest';
import type { QADisplaySettings, QAPublicQuestion } from '@/lib/types';
import { selectQADisplayQuestions } from './display-utils';

function question(
  overrides: Partial<QAPublicQuestion> & Pick<QAPublicQuestion, 'id'>,
): QAPublicQuestion {
  return {
    id: overrides.id,
    text: overrides.text ?? `Question ${overrides.id}`,
    isAnonymous: overrides.isAnonymous ?? true,
    authorDisplayName: overrides.authorDisplayName ?? null,
    score: overrides.score ?? 0,
    upvotes: overrides.upvotes ?? 0,
    downvotes: overrides.downvotes ?? 0,
    labelIds: overrides.labelIds ?? [],
    replyCount: overrides.replyCount ?? 0,
    replies: overrides.replies ?? [],
    highlighted: overrides.highlighted ?? false,
    submittedAt: overrides.submittedAt ?? 0,
  };
}

const baseSettings: QADisplaySettings = {
  sort: 'popular',
  labelFilter: null,
  visibleCount: 4,
  showTicker: true,
  highlightFullscreen: true,
};

describe('selectQADisplayQuestions', () => {
  it('filters to the active public label and clamps visible questions to six', () => {
    const questions = [
      question({ id: 'q1', score: 1, submittedAt: 1, labelIds: ['roadmap'] }),
      question({ id: 'q2', score: 9, submittedAt: 2, labelIds: ['private'] }),
      question({ id: 'q3', score: 8, submittedAt: 3, labelIds: ['roadmap'] }),
      question({ id: 'q4', score: 7, submittedAt: 4, labelIds: ['roadmap'] }),
      question({ id: 'q5', score: 6, submittedAt: 5, labelIds: ['roadmap'] }),
      question({ id: 'q6', score: 5, submittedAt: 6, labelIds: ['roadmap'] }),
      question({ id: 'q7', score: 4, submittedAt: 7, labelIds: ['roadmap'] }),
      question({ id: 'q8', score: 3, submittedAt: 8, labelIds: ['roadmap'] }),
    ];

    expect(
      selectQADisplayQuestions(questions, {
        ...baseSettings,
        labelFilter: 'roadmap',
        visibleCount: 99,
      }).map((q) => q.id),
    ).toEqual(['q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  });

  it('sorts recent and oldest modes deterministically', () => {
    const questions = [
      question({ id: 'q1', submittedAt: 10 }),
      question({ id: 'q2', submittedAt: 30 }),
      question({ id: 'q3', submittedAt: 20 }),
    ];

    expect(
      selectQADisplayQuestions(questions, { ...baseSettings, sort: 'recent' }).map((q) => q.id),
    ).toEqual(['q2', 'q3', 'q1']);
    expect(
      selectQADisplayQuestions(questions, { ...baseSettings, sort: 'oldest' }).map((q) => q.id),
    ).toEqual(['q1', 'q3', 'q2']);
  });
});
