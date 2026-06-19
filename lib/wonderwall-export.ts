// Host-only CSV export for WonderWall submissions (MID-403). Pure functions so
// CSV escaping and spreadsheet-formula neutralization are testable without
// constructing a Next.js Response — the route just calls
// buildWonderWallSubmissionsCsv() with rows from listPostsForExport().
//
// Privacy boundary: this export carries ONLY URL/URN/embed/review metadata. It
// never includes LinkedIn post body, author/profile data, reactions, comments,
// or images — PRIMETIME does not store any of those (see schema + plan §3, §6.8).
// The columns below are the complete set of fields we persist per submission.

import type { WonderWallPost } from '@prisma/client';

export const WONDERWALL_EXPORT_COLUMNS = [
  'submittedAt',
  'status',
  'canDisplay',
  'originalUrl',
  'urn',
  'embedUrl',
  'submitterName',
  'submitterKey',
  'reviewedAt',
  'reviewedByHostUserId',
  'rejectionReason',
  'displayOrder',
  'failureReason',
] as const;

// RFC 4180 row delimiter. Spreadsheet apps expect CRLF; we also use it as the
// terminator after the final row.
const ROW_DELIMITER = '\r\n';

// Leading characters that turn a CSV cell into a live formula when opened in a
// spreadsheet app (=cmd, +cmd, -cmd, @cmd, and the tab/CR tricks that some
// parsers strip before evaluating). Neutralized by prefixing a single quote.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

// Cells that require RFC 4180 quoting: they contain a comma, double-quote, LF,
// or CR. Inside a quoted cell every embedded double-quote is doubled.
const CSV_SPECIAL = /[",\n\r]/;

// Prefix a single quote when the value would be interpreted as a formula, so the
// spreadsheet treats it as literal text. Runs BEFORE escapeCsvCell so the added
// quote is itself covered by CSV quoting if needed. Empty strings pass through.
export function neutralizeSpreadsheetFormula(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGER.test(value)) {
    return `'${value}`;
  }
  return value;
}

// RFC 4180 cell escaping. null/undefined become an empty cell; everything else
// is stringified. Cells containing a comma, quote, LF, or CR are wrapped in
// double-quotes with embedded quotes doubled.
export function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (CSV_SPECIAL.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Compose the two defenses in the required order: neutralize the formula
// trigger first, then apply CSV escaping to the (possibly quote-prefixed) value.
function formatCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return escapeCsvCell(neutralizeSpreadsheetFormula(str));
}

// displayOrder is meaningful only for rows actually on the projector: approved +
// canDisplay with a position assigned. Pending/rejected/hidden/failed rows have
// no display slot, so the column is blank for them.
function displayOrderCell(post: WonderWallPost): string {
  if (post.canDisplay && post.position !== null && post.position !== undefined) {
    return String(post.position);
  }
  return '';
}

function rowFor(post: WonderWallPost): string[] {
  return [
    post.createdAt.toISOString(),
    post.status,
    post.canDisplay ? 'true' : 'false',
    post.originalUrl,
    post.urn,
    post.embedUrl,
    post.submitterName ?? '',
    post.submitterKey ?? '',
    post.reviewedAt ? post.reviewedAt.toISOString() : '',
    post.reviewedByHostUserId ?? '',
    post.rejectionReason ?? '',
    displayOrderCell(post),
    post.failureReason ?? '',
  ];
}

// Build the full CSV document. Input order is preserved verbatim — the caller
// (listPostsForExport) already sorts by createdAt ASC then id ASC for a stable
// audit log, and every status (PENDING/APPROVED/REJECTED/HIDDEN/FAILED) is
// included. Output is header + one row per post, CRLF-delimited and
// CRLF-terminated.
export function buildWonderWallSubmissionsCsv(posts: WonderWallPost[]): string {
  const lines: string[] = [WONDERWALL_EXPORT_COLUMNS.map((col) => formatCell(col)).join(',')];
  for (const post of posts) {
    lines.push(
      rowFor(post)
        .map((cell) => formatCell(cell))
        .join(','),
    );
  }
  return `${lines.join(ROW_DELIMITER)}${ROW_DELIMITER}`;
}
