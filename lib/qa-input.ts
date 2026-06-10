// Shared validation for Q&A question text (MID-335). Used by the participant
// page for inline feedback and by lib/qa.ts as the server-side gate, so the
// two can never drift. Reason strings are a subset of QAErrorReason.
//
// Deliberately minimal: trim, reject empty, enforce the session char limit.
// No profanity filtering or rewriting — moderation (PRD §4.5) is the
// mechanism for unwanted questions, and validation must never silently
// censor what a participant wrote. Multi-line questions are allowed.

export const QA_QUESTION_DEFAULT_CHAR_LIMIT = 280;

export type QAQuestionInputResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty_text' | 'text_too_long' };

export function validateQuestionInput(
  raw: string,
  charLimit: number = QA_QUESTION_DEFAULT_CHAR_LIMIT,
): QAQuestionInputResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty_text' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty_text' };
  if (trimmed.length > charLimit) return { ok: false, reason: 'text_too_long' };
  return { ok: true, value: trimmed };
}

// Label name validation (MID-340). Shared by the session-creation form, the
// host control room, the API route, and lib/qa.ts so the limit can never
// drift from the DB column (QALabel.name VarChar(50)).
export const QA_LABEL_NAME_LIMIT = 50;

export type QALabelNameResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty_label' | 'label_too_long' };

export function validateLabelName(raw: string): QALabelNameResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty_label' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty_label' };
  if (trimmed.length > QA_LABEL_NAME_LIMIT) return { ok: false, reason: 'label_too_long' };
  return { ok: true, value: trimmed };
}
