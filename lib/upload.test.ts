import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uploadLocal } from './upload';

const TMP_DIR = join(__dirname, '..', '..', 'tmp', 'upload-tests');

async function setup() {
  await mkdir(TMP_DIR, { recursive: true });
}

async function cleanup() {
  await rm(TMP_DIR, { recursive: true, force: true });
}

function fakeFile(opts: { name?: string; type?: string; size?: number; content?: Buffer }): File {
  const type = opts.type ?? 'image/png';
  const size = opts.size ?? opts.content?.length ?? 100;
  const blob = new Blob([opts.content ?? Buffer.alloc(size)], { type });
  return new File([blob], opts.name ?? 'test.png', { type });
}

describe('uploadLocal', () => {
  it('rejects files exceeding maxBytes', async () => {
    await setup();
    const file = fakeFile({ size: 1024, type: 'image/png' });
    const result = await uploadLocal(file, { uploadDir: TMP_DIR, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('too large');
    }
    await cleanup();
  });

  it('rejects disallowed MIME types', async () => {
    await setup();
    const file = fakeFile({ type: 'application/pdf', size: 100 });
    const result = await uploadLocal(file, { uploadDir: TMP_DIR });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('image/png');
    }
    await cleanup();
  });

  it('accepts a valid PNG file', async () => {
    await setup();
    const file = fakeFile({ type: 'image/png', size: 200 });
    const result = await uploadLocal(file, { uploadDir: TMP_DIR });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toMatch(/^\/uploads\/[a-f0-9]+\.png$/);
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(200);
    }
    await cleanup();
  });

  it('accepts a valid JPEG file', async () => {
    await setup();
    const file = fakeFile({ type: 'image/jpeg', size: 200 });
    const result = await uploadLocal(file, { uploadDir: TMP_DIR });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toMatch(/^\/uploads\/[a-f0-9]+\.jpg$/);
    }
    await cleanup();
  });

  it('uses custom uploadDir', async () => {
    const customDir = join(TMP_DIR, 'custom');
    await mkdir(customDir, { recursive: true });
    const file = fakeFile({ type: 'image/webp', size: 100 });
    const result = await uploadLocal(file, { uploadDir: customDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filePath).toContain('custom');
    }
    await cleanup();
  });

  it('writes files to a subdirectory when subdir is given', async () => {
    await setup();
    const file = fakeFile({ type: 'image/png', size: 100 });
    const result = await uploadLocal(file, { uploadDir: TMP_DIR }, 'quiz-covers');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urlPath).toContain('/uploads/quiz-covers/');
    }
    await cleanup();
  });

  it('generates unique filenames', async () => {
    await setup();
    const file1 = fakeFile({ type: 'image/png', size: 100 });
    const file2 = fakeFile({ type: 'image/png', size: 100 });
    const [r1, r2] = await Promise.all([
      uploadLocal(file1, { uploadDir: TMP_DIR }),
      uploadLocal(file2, { uploadDir: TMP_DIR }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.urlPath).not.toBe(r2.urlPath);
    }
    await cleanup();
  });
});
