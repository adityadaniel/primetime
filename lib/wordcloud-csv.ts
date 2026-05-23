import { csvEscape } from './game';

export type WordCloudCsvSubmission = {
  createdAt: Date;
  rawText: string;
  normalized: string;
  removed: boolean;
  player: { nickname: string };
};

const HEADER = 'timestamp,nickname,raw_text,normalized,removed';

export function exportSubmissionsCsv(submissions: WordCloudCsvSubmission[]): string {
  const sorted = [...submissions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const rows: string[] = [HEADER];
  for (const s of sorted) {
    rows.push(
      [
        csvEscape(s.createdAt.toISOString()),
        csvEscape(s.player.nickname),
        csvEscape(s.rawText),
        csvEscape(s.normalized),
        s.removed ? 'true' : 'false',
      ].join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

const SLUG_MAX = 40;

export function promptSlug(prompt: string): string {
  const ascii = prompt
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) return 'wordcloud';
  return ascii.slice(0, SLUG_MAX).replace(/-+$/g, '') || 'wordcloud';
}
