import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface UploadConfig {
  /** Absolute path to the upload root directory. */
  uploadDir: string;
  /** Maximum file size in bytes. Default 5 MB. */
  maxBytes: number;
  /** Allowed MIME types. Default: common image types. */
  allowedMimeTypes: string[];
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

export interface UploadResult {
  ok: true;
  /** Public URL path to the uploaded file (e.g. /uploads/abc123.png). */
  urlPath: string;
  /** Server-side absolute file path. */
  filePath: string;
  /** File size in bytes. */
  size: number;
  mimeType: string;
}

export interface UploadError {
  ok: false;
  error: string;
}

export type UploadOutcome = UploadResult | UploadError;

const SAFE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/**
 * Generate a safe filename: random hex + correct extension from MIME type.
 * Never trusts the original filename from the client.
 */
function safeFilename(mimeType: string): string {
  const ext = SAFE_EXTENSIONS[mimeType] ?? '';
  const rand = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  );
  return `${rand}${ext}`;
}

/**
 * Validate a file against the upload policy (size + MIME type).
 * Returns an error string if invalid, or null if OK.
 */
function validateFile(
  file: File,
  cfg: Pick<UploadConfig, 'maxBytes' | 'allowedMimeTypes'>,
): string | null {
  if (file.size > cfg.maxBytes) {
    const maxMb = (cfg.maxBytes / (1024 * 1024)).toFixed(1);
    return `File too large (${(file.size / 1024).toFixed(0)} KB). Max: ${maxMb} MB.`;
  }
  if (!cfg.allowedMimeTypes.includes(file.type)) {
    return `File type "${file.type}" is not allowed. Allowed: ${cfg.allowedMimeTypes.join(', ')}.`;
  }
  return null;
}

/**
 * Upload a File to the local filesystem.
 *
 * @param file   - The file from a multipart form submission.
 * @param cfg    - Upload configuration (dir, max size, allowed MIME types).
 * @param subdir - Optional subdirectory within uploadDir (e.g. "quiz-covers").
 * @returns UploadOutcome with the public URL path on success.
 */
export async function uploadLocal(
  file: File,
  cfg: Partial<UploadConfig> = {},
  subdir?: string,
): Promise<UploadOutcome> {
  const uploadDir = cfg.uploadDir ?? join(process.cwd(), 'public', 'uploads');
  const maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedMimeTypes = cfg.allowedMimeTypes ?? DEFAULT_ALLOWED_TYPES;

  const validationError = validateFile(file, { maxBytes, allowedMimeTypes });
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // Constrain subdir to a single safe path segment. Without this, a value like
  // "../../x" escapes uploadDir via path.join normalization (path traversal).
  if (subdir !== undefined) {
    const SAFE_SUBDIR = /^[A-Za-z0-9._-]+$/;
    if (subdir === '.' || subdir === '..' || !SAFE_SUBDIR.test(subdir)) {
      return { ok: false, error: 'invalid_subdir' };
    }
  }

  const filename = safeFilename(file.type);
  const targetDir = subdir ? join(uploadDir, subdir) : uploadDir;
  const filePath = join(targetDir, filename);

  await mkdir(targetDir, { recursive: true });

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const urlPath = subdir ? `/uploads/${subdir}/${filename}` : `/uploads/${filename}`;

  return {
    ok: true,
    urlPath,
    filePath,
    size: file.size,
    mimeType: file.type,
  };
}
