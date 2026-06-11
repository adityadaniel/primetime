// Q&A CSV export (MID-344). Produces a host-downloadable CSV with every
// PRD §4.11 field. Anonymous questions never reveal participant identity.

import { csvEscape } from './game';

export type QACsvReply = {
  isHostReply: boolean;
  text: string;
  createdAt: Date;
};

export type QACsvVote = {
  type: 'UP' | 'DOWN';
};

export type QACsvLabel = {
  name: string;
};

export type QACsvQuestion = {
  id: string;
  text: string;
  originalText: string | null;
  isAnonymous: boolean;
  authorDisplayName: string | null;
  status: string;
  submittedAt: Date;
  approvedAt: Date | null;
  answeredAt: Date | null;
  archivedAt: Date | null;
  dismissedAt: Date | null;
  withdrawnAt: Date | null;
  votes: QACsvVote[];
  replies: QACsvReply[];
  labels: { label: QACsvLabel }[];
};

const ANONYMOUS_MARKER = '[anonymous]';

const HEADER = [
  'question_id',
  'text',
  'original_text',
  'author',
  'privacy',
  'status',
  'submitted_at',
  'approved_at',
  'answered_at',
  'archived_at',
  'dismissed_at',
  'withdrawn_at',
  'score',
  'upvotes',
  'downvotes',
  'labels',
  'host_replies',
  'participant_reply_count',
].join(',');

export function exportQACsv(questions: QACsvQuestion[]): string {
  const sorted = [...questions].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const rows: string[] = [HEADER];

  for (const q of sorted) {
    const upvotes = q.votes.filter((v) => v.type === 'UP').length;
    const downvotes = q.votes.filter((v) => v.type === 'DOWN').length;
    const score = upvotes - downvotes;

    const author = q.isAnonymous ? ANONYMOUS_MARKER : (q.authorDisplayName ?? ANONYMOUS_MARKER);
    const privacy = q.isAnonymous ? 'anonymous' : 'named';

    const labelNames = q.labels.map((l) => l.label.name).join('; ');

    const hostReplies = q.replies
      .filter((r) => r.isHostReply)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => r.text)
      .join(' | ');

    const participantReplyCount = q.replies.filter((r) => !r.isHostReply).length;

    rows.push(
      [
        csvEscape(q.id),
        csvEscape(q.text),
        csvEscape(q.originalText ?? ''),
        csvEscape(author),
        privacy,
        q.status,
        csvEscape(q.submittedAt.toISOString()),
        q.approvedAt ? csvEscape(q.approvedAt.toISOString()) : '',
        q.answeredAt ? csvEscape(q.answeredAt.toISOString()) : '',
        q.archivedAt ? csvEscape(q.archivedAt.toISOString()) : '',
        q.dismissedAt ? csvEscape(q.dismissedAt.toISOString()) : '',
        q.withdrawnAt ? csvEscape(q.withdrawnAt.toISOString()) : '',
        score,
        upvotes,
        downvotes,
        csvEscape(labelNames),
        csvEscape(hostReplies),
        participantReplyCount,
      ].join(','),
    );
  }

  return `${rows.join('\r\n')}\r\n`;
}

const SLUG_MAX = 40;

export function sessionSlug(title: string): string {
  const ascii = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) return 'q-and-a';
  return ascii.slice(0, SLUG_MAX).replace(/-+$/g, '') || 'q-and-a';
}
