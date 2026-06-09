import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchUploadsPath, resolveUploadFilePath, uploadContentType } from './serve-upload';

describe('matchUploadsPath', () => {
  it('returns the relative path for an uploads URL', () => {
    expect(matchUploadsPath('/uploads/quiz-images/abc123.png')).toBe('quiz-images/abc123.png');
    expect(matchUploadsPath('/uploads/abc123.png')).toBe('abc123.png');
  });

  it('strips the query string', () => {
    expect(matchUploadsPath('/uploads/abc.png?v=2')).toBe('abc.png');
  });

  it('decodes percent-encoded segments', () => {
    expect(matchUploadsPath('/uploads/a%20b.png')).toBe('a b.png');
  });

  it('returns null for non-uploads URLs', () => {
    expect(matchUploadsPath('/host/123456/display')).toBeNull();
    expect(matchUploadsPath('/uploads')).toBeNull();
    expect(matchUploadsPath('/uploadsx/a.png')).toBeNull();
    expect(matchUploadsPath(undefined)).toBeNull();
  });

  it('returns null for an empty file path or a null byte', () => {
    expect(matchUploadsPath('/uploads/')).toBeNull();
    expect(matchUploadsPath('/uploads/%00.png')).toBeNull();
  });

  it('returns null for malformed percent-encoding', () => {
    expect(matchUploadsPath('/uploads/%E0%A4%A.png')).toBeNull();
  });
});

describe('resolveUploadFilePath', () => {
  const base = join('/srv', 'uploads');

  it('resolves a normal file under the base dir', () => {
    expect(resolveUploadFilePath(base, 'quiz-images/abc.png')).toBe(
      join(base, 'quiz-images/abc.png'),
    );
  });

  it('refuses traversal that escapes the base dir', () => {
    expect(resolveUploadFilePath(base, '../secrets.env')).toBeNull();
    expect(resolveUploadFilePath(base, '../../etc/passwd')).toBeNull();
    expect(resolveUploadFilePath(base, 'quiz-images/../../escape.png')).toBeNull();
  });

  it('does not confuse a sibling dir with the base prefix', () => {
    // `/srv/uploads-evil` shares the `/srv/uploads` string prefix but is a
    // different directory; traversal into it must be refused.
    expect(resolveUploadFilePath(base, '../uploads-evil/x.png')).toBeNull();
  });

  it('keeps in-dir paths that merely contain dot segments', () => {
    expect(resolveUploadFilePath(base, 'a/./b.png')).toBe(join(base, 'a/b.png'));
  });
});

describe('uploadContentType', () => {
  it('maps known image extensions', () => {
    expect(uploadContentType('/x/a.png')).toBe('image/png');
    expect(uploadContentType('/x/a.JPG')).toBe('image/jpeg');
    expect(uploadContentType('a.jpeg')).toBe('image/jpeg');
    expect(uploadContentType('a.gif')).toBe('image/gif');
    expect(uploadContentType('a.webp')).toBe('image/webp');
    expect(uploadContentType('a.svg')).toBe('image/svg+xml');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(uploadContentType('a.bin')).toBe('application/octet-stream');
    expect(uploadContentType('a')).toBe('application/octet-stream');
  });
});
