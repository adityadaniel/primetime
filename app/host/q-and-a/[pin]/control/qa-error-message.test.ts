import { describe, expect, it } from 'vitest';
import { qaErrorMessage } from './qa-error-message';

describe('qaErrorMessage', () => {
  it('keeps attach fallback distinct from moderation fallback', () => {
    expect(qaErrorMessage('attach', 'unknown')).toBe(
      "Couldn't take the control room — try reloading.",
    );
    expect(qaErrorMessage('moderation', 'unknown')).toBe(
      "Couldn't update the question — try again.",
    );
  });

  it('maps attach errors to the existing copy', () => {
    expect(qaErrorMessage('attach', 'forbidden')).toBe(
      'This control room belongs to another host.',
    );
    expect(qaErrorMessage('attach', 'not_found')).toBe("That session isn't on the air.");
    expect(qaErrorMessage('attach', 'session_mismatch')).toBe(
      'Session credentials are stale — reopen from the studio.',
    );
  });

  it('maps moderation and contextual action errors to the existing copy', () => {
    expect(qaErrorMessage('moderation', 'invalid_transition')).toBe(
      'That question already moved on.',
    );
    expect(qaErrorMessage('moderation', 'unknown_question')).toBe(
      "That question isn't in this session.",
    );
    expect(qaErrorMessage('moderation', 'persistence_failed')).toBe("Couldn't save — try again.");
    expect(qaErrorMessage('moderation', 'forbidden')).toBe(
      'This control room belongs to another host.',
    );
    expect(qaErrorMessage('highlight', 'not_live')).toBe('Only live questions can go on air.');
    expect(qaErrorMessage('highlight', 'unknown_question')).toBe(
      "That question isn't in this session.",
    );
    expect(qaErrorMessage('control', 'invalid_transition')).toBe(
      'That session move is not allowed.',
    );
    expect(qaErrorMessage('control', 'session_ended')).toBe('The session has already ended.');
    expect(qaErrorMessage('control', 'unknown')).toBe("Couldn't update the question — try again.");
  });

  it('maps edit, reply, label, and display-settings errors to the existing copy', () => {
    expect(qaErrorMessage('edit', 'empty_text')).toBe('A question needs some words.');
    expect(qaErrorMessage('edit', 'text_too_long')).toBe('Too long — trim the copy.');
    expect(qaErrorMessage('edit', 'invalid_status')).toBe('That question already settled.');
    expect(qaErrorMessage('reply', 'empty_text')).toBe('A reply needs some words.');
    expect(qaErrorMessage('reply', 'text_too_long')).toBe('Keep replies under 1000 characters.');
    expect(qaErrorMessage('reply', 'invalid_status')).toBe(
      'That question already settled — restore it to reply.',
    );
    expect(qaErrorMessage('reply', 'unknown_reply')).toBe(
      'That reply is gone — refresh the thread.',
    );
    expect(qaErrorMessage('reply', 'not_host_reply')).toBe(
      'Only your own replies can be rewritten.',
    );
    expect(qaErrorMessage('reply', 'session_ended')).toBe('The session has ended.');
    expect(qaErrorMessage('label', 'empty_label')).toBe('A label needs a name.');
    expect(qaErrorMessage('label', 'label_too_long')).toBe('Keep labels under 50 characters.');
    expect(qaErrorMessage('label', 'duplicate_label')).toBe('That label already exists.');
    expect(qaErrorMessage('label', 'unknown_label')).toBe("That label isn't in this session.");
    expect(qaErrorMessage('label', 'session_ended')).toBe('The session has ended.');
    expect(qaErrorMessage('displaySettings', 'unknown_label')).toBe(
      "That display label isn't in this session.",
    );
    expect(qaErrorMessage('displaySettings', 'private_label')).toBe(
      'Only audience-visible labels can filter the projection.',
    );
  });
});
