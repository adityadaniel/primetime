import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { DELETE, GET } from '@/app/api/quiz/[id]/route';
import { auth } from '@/auth';
import { deleteQuiz, getQuiz } from '@/lib/repos/quiz';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/repos/quiz', () => ({
  deleteQuiz: vi.fn(),
  getQuiz: vi.fn(),
  updateQuiz: vi.fn(),
}));

type SessionLike = { user?: { id?: string }; expires: string } | null;

describe('quiz id route ownership responses', () => {
  it('returns 404 for a non-owner GET without leaking existence', async () => {
    const authMock = vi.mocked(auth as unknown as () => Promise<SessionLike>);
    authMock.mockResolvedValue({
      user: { id: 'bob' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(getQuiz).mockResolvedValue(null);

    const res = await GET(new Request('http://test.local/api/quiz/alice-quiz') as NextRequest, {
      params: Promise.resolve({ id: 'alice-quiz' }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
    expect(getQuiz).toHaveBeenCalledWith('alice-quiz', 'bob');
  });

  it('returns 404 and does not delete for a non-owner DELETE', async () => {
    const authMock = vi.mocked(auth as unknown as () => Promise<SessionLike>);
    authMock.mockResolvedValue({
      user: { id: 'bob' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(deleteQuiz).mockResolvedValue(false);

    const res = await DELETE(new Request('http://test.local/api/quiz/alice-quiz') as NextRequest, {
      params: Promise.resolve({ id: 'alice-quiz' }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
    expect(deleteQuiz).toHaveBeenCalledWith('alice-quiz', 'bob');
  });
});
