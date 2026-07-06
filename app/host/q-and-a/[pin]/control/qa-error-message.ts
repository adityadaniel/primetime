import { QA_HOST_REPLY_CHAR_LIMIT, QA_LABEL_NAME_LIMIT } from '@/lib/qa-input';

export type QaErrorContext =
  | 'attach'
  | 'moderation'
  | 'highlight'
  | 'edit'
  | 'reply'
  | 'label'
  | 'control'
  | 'displaySettings';

function baseModerationMessage(error: string): string {
  switch (error) {
    case 'invalid_transition':
      return 'That question already moved on.';
    case 'unknown_question':
      return "That question isn't in this session.";
    case 'persistence_failed':
      return "Couldn't save — try again.";
    case 'forbidden':
      return 'This control room belongs to another host.';
    default:
      return "Couldn't update the question — try again.";
  }
}

export function qaErrorMessage(context: QaErrorContext, error: string): string {
  switch (context) {
    case 'attach':
      switch (error) {
        case 'forbidden':
          return 'This control room belongs to another host.';
        case 'not_found':
          return "That session isn't on the air.";
        case 'session_mismatch':
          return 'Session credentials are stale — reopen from the studio.';
        default:
          return "Couldn't take the control room — try reloading.";
      }
    case 'highlight':
      return error === 'not_live'
        ? 'Only live questions can go on air.'
        : baseModerationMessage(error);
    case 'edit':
      switch (error) {
        case 'empty_text':
          return 'A question needs some words.';
        case 'text_too_long':
          return 'Too long — trim the copy.';
        case 'invalid_status':
          return 'That question already settled.';
        default:
          return baseModerationMessage(error);
      }
    case 'reply':
      switch (error) {
        case 'empty_text':
          return 'A reply needs some words.';
        case 'text_too_long':
          return `Keep replies under ${QA_HOST_REPLY_CHAR_LIMIT} characters.`;
        case 'invalid_status':
          return 'That question already settled — restore it to reply.';
        case 'unknown_reply':
          return 'That reply is gone — refresh the thread.';
        case 'not_host_reply':
          return 'Only your own replies can be rewritten.';
        case 'session_ended':
          return 'The session has ended.';
        default:
          return baseModerationMessage(error);
      }
    case 'label':
      switch (error) {
        case 'empty_label':
          return 'A label needs a name.';
        case 'label_too_long':
          return `Keep labels under ${QA_LABEL_NAME_LIMIT} characters.`;
        case 'duplicate_label':
          return 'That label already exists.';
        case 'unknown_label':
          return "That label isn't in this session.";
        case 'session_ended':
          return 'The session has ended.';
        default:
          return baseModerationMessage(error);
      }
    case 'control':
      switch (error) {
        case 'invalid_transition':
          return 'That session move is not allowed.';
        case 'session_ended':
          return 'The session has already ended.';
        default:
          return baseModerationMessage(error);
      }
    case 'displaySettings':
      switch (error) {
        case 'unknown_label':
          return "That display label isn't in this session.";
        case 'private_label':
          return 'Only audience-visible labels can filter the projection.';
        default:
          return baseModerationMessage(error);
      }
    case 'moderation':
      return baseModerationMessage(error);
  }
}
