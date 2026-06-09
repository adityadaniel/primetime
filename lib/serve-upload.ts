import { extname, join, normalize, sep } from 'node:path';

/**
 * Static serving for uploaded media (question stills, etc.).
 *
 * Uploads are written under `config.uploadDir` at runtime. Next.js only serves
 * files that exist in `public/` when the server boots, so runtime-written
 * uploads 404 if left to the Next request handler. The custom server in
 * `server.ts` intercepts `/uploads/*` and streams from disk instead — these
 * pure helpers carry the URL parsing and path-traversal guard so they can be
 * unit-tested without booting the server.
 */

export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Extract the path of an `/uploads/...` request relative to the upload root,
 * or null if the URL is not an uploads request. The returned value is still
 * untrusted — pass it through {@link resolveUploadFilePath} before touching the
 * filesystem.
 */
export function matchUploadsPath(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split('?')[0];
  if (!path.startsWith('/uploads/')) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(path.slice('/uploads/'.length));
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0')) return null;
  return rel;
}

/**
 * Resolve a relative uploads path against `baseDir`, refusing anything that
 * escapes it (path traversal). Returns the absolute file path, or null if the
 * request tries to break out of the upload root. `normalize()` collapses `..`
 * segments so the prefix check is meaningful.
 */
export function resolveUploadFilePath(baseDir: string, relPath: string): string | null {
  const resolved = join(baseDir, normalize(relPath));
  const baseWithSep = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
    return null;
  }
  return resolved;
}

/** Content-Type for an uploaded file by extension; octet-stream when unknown. */
export function uploadContentType(filePath: string): string {
  return UPLOAD_CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
