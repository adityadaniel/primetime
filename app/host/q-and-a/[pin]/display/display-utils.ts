import { QA_DISPLAY_VISIBLE_COUNT_MAX } from '@/lib/qa';
import type { QADisplaySettings, QAPublicQuestion } from '@/lib/types';

const SORTERS: Record<
  QADisplaySettings['sort'],
  (a: QAPublicQuestion, b: QAPublicQuestion) => number
> = {
  popular: (a, b) => b.score - a.score || a.submittedAt - b.submittedAt || a.id.localeCompare(b.id),
  recent: (a, b) => b.submittedAt - a.submittedAt || a.id.localeCompare(b.id),
  oldest: (a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id),
};

export function selectQADisplayQuestions(
  questions: QAPublicQuestion[],
  settings: QADisplaySettings,
): QAPublicQuestion[] {
  const filtered = settings.labelFilter
    ? questions.filter((question) => question.labelIds.includes(settings.labelFilter ?? ''))
    : questions;
  return [...filtered]
    .sort(SORTERS[settings.sort])
    .slice(0, Math.min(QA_DISPLAY_VISIBLE_COUNT_MAX, Math.max(1, settings.visibleCount)));
}
