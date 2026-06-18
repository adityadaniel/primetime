import type { WonderWallPost } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildWonderWallSubmissionsCsv,
  escapeCsvCell,
  neutralizeSpreadsheetFormula,
  WONDERWALL_EXPORT_COLUMNS,
} from './wonderwall-export';

// Minimal WonderWallPost factory. Only fields the exporter reads matter; the
// rest are present so the object satisfies the Prisma type.
function post(overrides: Partial<WonderWallPost> = {}): WonderWallPost {
  return {
    id: 'wwp_1',
    sessionId: 'sess_1',
    originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789',
    urn: 'urn:li:activity:1234567890123456789',
    embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1234567890123456789',
    status: 'PENDING',
    canDisplay: false,
    position: null,
    submitterName: null,
    submitterKey: null,
    rejectionReason: null,
    failureReason: null,
    reviewedAt: null,
    reviewedByHostUserId: null,
    approvedAt: null,
    rejectedAt: null,
    hiddenAt: null,
    restoredAt: null,
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    ...overrides,
  } as WonderWallPost;
}

function rows(csv: string): string[] {
  // Split on the CRLF terminator and drop the trailing empty segment.
  return csv.split('\r\n').filter((line, i, all) => !(i === all.length - 1 && line === ''));
}

describe('escapeCsvCell', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell('urn:li:activity:1')).toBe('urn:li:activity:1');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes values containing a comma', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles embedded double-quotes', () => {
    expect(escapeCsvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes values containing LF or CR', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\rline2')).toBe('"line1\rline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('stringifies non-string values', () => {
    expect(escapeCsvCell(0)).toBe('0');
    expect(escapeCsvCell(true)).toBe('true');
  });
});

describe('neutralizeSpreadsheetFormula', () => {
  it('prefixes a single quote for each dangerous leading character', () => {
    expect(neutralizeSpreadsheetFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula('+1')).toBe("'+1");
    expect(neutralizeSpreadsheetFormula('-1')).toBe("'-1");
    expect(neutralizeSpreadsheetFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeSpreadsheetFormula('\tcmd')).toBe("'\tcmd");
    expect(neutralizeSpreadsheetFormula('\rcmd')).toBe("'\rcmd");
  });

  it('leaves safe values untouched', () => {
    expect(neutralizeSpreadsheetFormula('hello')).toBe('hello');
    expect(neutralizeSpreadsheetFormula('https://www.linkedin.com/x')).toBe(
      'https://www.linkedin.com/x',
    );
    expect(neutralizeSpreadsheetFormula('')).toBe('');
  });
});

describe('buildWonderWallSubmissionsCsv', () => {
  it('emits the exact header row in the documented column order', () => {
    const csv = buildWonderWallSubmissionsCsv([]);
    expect(rows(csv)).toEqual([WONDERWALL_EXPORT_COLUMNS.join(',')]);
    expect(rows(csv)[0]).toBe(
      'submittedAt,status,canDisplay,originalUrl,urn,embedUrl,submitterName,submitterKey,reviewedAt,reviewedByHostUserId,rejectionReason,displayOrder,failureReason',
    );
  });

  it('terminates every row (including the last) with CRLF', () => {
    const csv = buildWonderWallSubmissionsCsv([post()]);
    expect(csv.endsWith('\r\n')).toBe(true);
    // header + 1 data row, CRLF-delimited and CRLF-terminated.
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('includes every status when present, preserving input order', () => {
    const statuses: WonderWallPost['status'][] = [
      'PENDING',
      'APPROVED',
      'REJECTED',
      'HIDDEN',
      'FAILED',
    ];
    const posts = statuses.map((status, i) =>
      post({ id: `wwp_${i}`, status, canDisplay: status === 'APPROVED', position: i }),
    );
    const dataRows = rows(buildWonderWallSubmissionsCsv(posts)).slice(1);
    expect(dataRows).toHaveLength(5);
    expect(dataRows.map((r) => r.split(',')[1])).toEqual(statuses);
  });

  it('writes displayOrder for approved/displayable rows and blanks it otherwise', () => {
    const approved = post({ status: 'APPROVED', canDisplay: true, position: 3 });
    const pending = post({ status: 'PENDING', canDisplay: false, position: null });
    const [approvedRow, pendingRow] = rows(
      buildWonderWallSubmissionsCsv([approved, pending]),
    ).slice(1);
    // displayOrder is the 12th column (index 11).
    expect(approvedRow.split(',')[11]).toBe('3');
    expect(pendingRow.split(',')[11]).toBe('');
  });

  it('does not write displayOrder for a hidden post that still has a position', () => {
    const hidden = post({ status: 'HIDDEN', canDisplay: false, position: 2 });
    const [hiddenRow] = rows(buildWonderWallSubmissionsCsv([hidden])).slice(1);
    expect(hiddenRow.split(',')[11]).toBe('');
  });

  it('serializes review metadata for rejected and approved rows', () => {
    const reviewedAt = new Date('2026-06-18T12:00:00.000Z');
    const rejected = post({
      status: 'REJECTED',
      canDisplay: false,
      rejectionReason: 'Off topic',
      reviewedAt,
      reviewedByHostUserId: 'host-1',
    });
    const [row] = rows(buildWonderWallSubmissionsCsv([rejected])).slice(1);
    const cells = row.split(',');
    expect(cells[0]).toBe('2026-06-18T00:00:00.000Z'); // submittedAt
    expect(cells[1]).toBe('REJECTED');
    expect(cells[2]).toBe('false'); // canDisplay
    expect(cells[8]).toBe('2026-06-18T12:00:00.000Z'); // reviewedAt
    expect(cells[9]).toBe('host-1'); // reviewedByHostUserId
    expect(cells[10]).toBe('Off topic'); // rejectionReason
    expect(cells[12]).toBe(''); // failureReason
  });

  it('escapes commas, quotes, and newlines in cell values', () => {
    const tricky = post({
      status: 'REJECTED',
      rejectionReason: 'has, comma and "quotes"\nand newline',
    });
    const csv = buildWonderWallSubmissionsCsv([tricky]);
    expect(csv).toContain('"has, comma and ""quotes""\nand newline"');
  });

  it('neutralizes spreadsheet-formula cells before CSV escaping', () => {
    const evil = post({
      submitterName: '=cmd|/c calc',
      rejectionReason: '@SUM(A1)',
    });
    const csv = buildWonderWallSubmissionsCsv([evil]);
    // submitterName had no CSV-special char after neutralization → bare prefix.
    expect(csv).toContain("'=cmd|/c calc");
    expect(csv).toContain("'@SUM(A1)");
  });

  it('neutralizes a formula AND CSV-quotes when the value also contains a comma', () => {
    const evil = post({ submitterName: '=1,2' });
    const csv = buildWonderWallSubmissionsCsv([evil]);
    // neutralize first ('=1,2 → '=1,2), then quote because of the comma.
    expect(csv).toContain('"\'=1,2"');
  });

  it('never exposes columns for post body, author, reactions, comments, or images', () => {
    const header = WONDERWALL_EXPORT_COLUMNS.map((c) => c.toLowerCase());
    for (const forbidden of ['body', 'text', 'author', 'profile', 'reaction', 'comment', 'image']) {
      expect(header.some((c) => c.includes(forbidden))).toBe(false);
    }
  });
});
