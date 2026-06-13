import { describe, expect, it } from 'vitest';
import type { QACsvQuestion } from './qa-csv';
import { exportQACsv, sessionSlug } from './qa-csv';

function makeQuestion(overrides: Partial<QACsvQuestion> = {}): QACsvQuestion {
  return {
    id: 'q1',
    text: 'How does auth work?',
    originalText: null,
    isAnonymous: false,
    authorDisplayName: 'Alice',
    status: 'LIVE',
    submittedAt: new Date('2026-01-01T10:00:00Z'),
    approvedAt: new Date('2026-01-01T10:00:05Z'),
    answeredAt: null,
    archivedAt: null,
    dismissedAt: null,
    withdrawnAt: null,
    votes: [],
    replies: [],
    labels: [],
    ...overrides,
  };
}

describe('exportQACsv', () => {
  it('produces a header row and one data row for a named question', () => {
    const csv = exportQACsv([makeQuestion()]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('question_id');
    expect(lines[1]).toContain('Alice');
    expect(lines[1]).toContain('named');
  });

  it('uses [anonymous] marker and privacy=anonymous for anonymous questions', () => {
    const csv = exportQACsv([makeQuestion({ isAnonymous: true, authorDisplayName: null })]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toContain('[anonymous]');
    expect(lines[1]).toContain(',anonymous,');
  });

  it('includes original text when question was edited', () => {
    const csv = exportQACsv([makeQuestion({ text: 'Edited text', originalText: 'Original text' })]);
    expect(csv).toContain('Original text');
  });

  it('computes score, upvotes, downvotes from vote array', () => {
    const csv = exportQACsv([
      makeQuestion({
        votes: [{ type: 'UP' }, { type: 'UP' }, { type: 'UP' }, { type: 'DOWN' }],
      }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    const cols = lines[1].split(',');
    // score=2, upvotes=3, downvotes=1
    const scoreIdx = lines[0].split(',').indexOf('score');
    expect(cols[scoreIdx]).toBe('2');
    expect(cols[scoreIdx + 1]).toBe('3');
    expect(cols[scoreIdx + 2]).toBe('1');
  });

  it('joins labels with semicolons', () => {
    const csv = exportQACsv([
      makeQuestion({
        labels: [{ label: { name: 'feature' } }, { label: { name: 'bug' } }],
      }),
    ]);
    expect(csv).toContain('feature; bug');
  });

  it('joins host replies with pipe and counts participant replies', () => {
    const csv = exportQACsv([
      makeQuestion({
        replies: [
          {
            isHostReply: true,
            text: 'Great question',
            createdAt: new Date('2026-01-01T10:01:00Z'),
          },
          { isHostReply: true, text: 'Follow up', createdAt: new Date('2026-01-01T10:02:00Z') },
          { isHostReply: false, text: 'Me too', createdAt: new Date('2026-01-01T10:03:00Z') },
          { isHostReply: false, text: 'Same here', createdAt: new Date('2026-01-01T10:04:00Z') },
        ],
      }),
    ]);
    expect(csv).toContain('Great question | Follow up');
    // participant_reply_count = 2 (last column)
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toMatch(/,2$/);
  });

  it('escapes commas, quotes, and newlines in text', () => {
    const csv = exportQACsv([makeQuestion({ text: 'Has "quotes", commas,\nand newlines' })]);
    // Should be wrapped in double-quotes with internal quotes doubled
    expect(csv).toContain('"Has ""quotes""');
  });

  it('sorts output by submittedAt ascending', () => {
    const csv = exportQACsv([
      makeQuestion({ id: 'late', submittedAt: new Date('2026-01-01T12:00:00Z') }),
      makeQuestion({ id: 'early', submittedAt: new Date('2026-01-01T08:00:00Z') }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toContain('early');
    expect(lines[2]).toContain('late');
  });
});

describe('sessionSlug', () => {
  it('converts title to a safe filename slug', () => {
    expect(sessionSlug('My First Q&A!')).toBe('my-first-q-a');
  });

  it('returns fallback for empty/symbolic input', () => {
    expect(sessionSlug('!!!')).toBe('q-and-a');
    expect(sessionSlug('')).toBe('q-and-a');
  });

  it('truncates at 40 chars', () => {
    const long = 'a'.repeat(60);
    expect(sessionSlug(long).length).toBeLessThanOrEqual(40);
  });
});
