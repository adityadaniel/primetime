import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uploadLocal } from './upload';

let sandboxDir: string;
let uploadDir: string;

async function cleanup() {
  await rm(sandboxDir, { recursive: true, force: true });
}

function fakeFile(opts: { name?: string; type?: string; size?: number }): File {
  const type = opts.type ?? 'image/png';
  const size = opts.size ?? 100;
  const blob = new Blob(['x'.repeat(size)], { type });
  return new File([blob], opts.name ?? 'test.png', { type });
}

describe('uploadLocal', () => {
  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'upload-tests-'));
    uploadDir = join(sandboxDir, 'uploads');
    await mkdir(uploadDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('rejects files exceeding maxBytes', async () => {
    const file = fakeFile({ size: 1024, type: 'image/png' });
    const result = await uploadLocal(file, { uploadDir, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('too large');
    }
  });

  it('rejects disallowed MIME types', async () => {
    const file = fakeFile({ type: 'application/pdf', size: 100 });
    const result = await uploadLocal(file, { uploadDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('image/png');
    }
  });

  it('accepts a valid PNG file', async () => {
    const file = fakeFile({ type: 'image/png', size: 200 });
    const result = await uploadLocal(file, { uploadDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toMatch(/^\/uploads\/[a-f0-9]+\.png$/);
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(200);
    }
  });

  it('accepts a valid JPEG file', async () => {
    const file = fakeFile({ type: 'image/jpeg', size: 200 });
    const result = await uploadLocal(file, { uploadDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toMatch(/^\/uploads\/[a-f0-9]+\.jpg$/);
    }
  });

  it('uses custom uploadDir', async () => {
    const customDir = join(uploadDir, 'custom');
    await mkdir(customDir, { recursive: true });
    const file = fakeFile({ type: 'image/webp', size: 100 });
    const result = await uploadLocal(file, { uploadDir: customDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filePath).toContain('custom');
    }
  });

  it('writes files to a subdirectory when subdir is given', async () => {
    const file = fakeFile({ type: 'image/png', size: 100 });
    const result = await uploadLocal(file, { uploadDir }, 'quiz-covers');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toContain('/uploads/quiz-covers/');
    }
  });

  it.each([
    '../evil',
    'a/b',
    '..',
    '.',
    'x/../../y',
    'quiz\\covers',
  ])('rejects traversal subdir %s and writes nothing', async (bad) => {
    const result = await uploadLocal(
      fakeFile({ type: 'image/png', size: 100 }),
      { uploadDir },
      bad,
    );
    expect(result).toEqual({ ok: false, error: 'invalid_subdir' });
    expect(await readdir(uploadDir)).toHaveLength(0);
  });

  it('accepts a simple safe subdir', async () => {
    const result = await uploadLocal(
      fakeFile({ type: 'image/png', size: 100 }),
      { uploadDir },
      'quiz-images',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toContain('/uploads/quiz-images/');
    }
  });

  it('works with no subdir', async () => {
    const result = await uploadLocal(fakeFile({ type: 'image/png', size: 100 }), { uploadDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toMatch(/^\/uploads\/[a-f0-9]+\.png$/);
    }
  });

  it('generates unique filenames', async () => {
    const file1 = fakeFile({ type: 'image/png', size: 100 });
    const file2 = fakeFile({ type: 'image/png', size: 100 });
    const [r1, r2] = await Promise.all([
      uploadLocal(file1, { uploadDir }),
      uploadLocal(file2, { uploadDir }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.urlPath).not.toBe(r2.urlPath);
    }
  });
});
