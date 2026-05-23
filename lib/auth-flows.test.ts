import { createHash, randomBytes } from 'node:crypto';
import { compare } from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const userUpdate = vi.fn();
const tokenCreate = vi.fn();
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const txn = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (args: unknown) => userFindUnique(args),
      create: (args: unknown) => userCreate(args),
      update: (args: unknown) => userUpdate(args),
    },
    passwordResetToken: {
      create: (args: unknown) => tokenCreate(args),
      findUnique: (args: unknown) => tokenFindUnique(args),
      update: (args: unknown) => tokenUpdate(args),
    },
    $transaction: (ops: unknown[]) => txn(ops),
  },
}));

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { POST as resetTokenPOST } from '@/app/api/auth/reset/[token]/route';
import { POST as resetRequestPOST } from '@/app/api/auth/reset/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  userFindUnique.mockReset();
  userCreate.mockReset();
  userUpdate.mockReset();
  tokenCreate.mockReset();
  tokenFindUnique.mockReset();
  tokenUpdate.mockReset();
  txn.mockReset();
  __resetRateLimitForTests();
  // Default: invite gate OFF for legacy tests. Invite-specific tests opt in.
  process.env.REQUIRE_INVITE_CODE = 'false';
  process.env.BETA_INVITE_CODES = '';
});

afterEach(() => {
  delete process.env.REQUIRE_INVITE_CODE;
  delete process.env.BETA_INVITE_CODES;
});

describe('POST /api/auth/signup', () => {
  it('creates a user with a hashed password and lowercases email', async () => {
    userFindUnique.mockResolvedValue(null);
    type CreatedData = { email: string; passwordHash: string; name: string | null };
    const captured: { value: CreatedData | null } = { value: null };
    userCreate.mockImplementation(({ data }: { data: CreatedData }) => {
      captured.value = data;
      return { id: 'u1', ...data };
    });

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'Alice@Example.com',
        password: 'hunter22',
        name: 'Alice',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(captured.value).not.toBeNull();
    expect(captured.value?.email).toBe('alice@example.com');
    expect(captured.value?.passwordHash).not.toBe('hunter22');
    expect(captured.value?.passwordHash).toBeDefined();
    expect(await compare('hunter22', captured.value?.passwordHash ?? '')).toBe(true);
  });

  it('rejects an existing email with 409', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', email: 'alice@example.com' });

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'alice@example.com',
        password: 'hunter22',
      }),
    );

    expect(res.status).toBe(409);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 8 chars with 400', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'alice@example.com',
        password: 'short',
      }),
    );
    expect(res.status).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/signup — invite-code gate', () => {
  it('rejects signups without an invite code when the gate is on', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026,daniel';
    userFindUnique.mockResolvedValue(null);

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'Invite code not recognized' });
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rejects signups with an unknown invite code', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026,daniel';
    userFindUnique.mockResolvedValue(null);

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
        inviteCode: 'not-a-real-code',
      }),
    );

    expect(res.status).toBe(403);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('accepts signups with a valid invite code (case-insensitive, whitespace tolerant)', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026,daniel';
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'u1' });

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
        inviteCode: ' Academy2026 ',
      }),
    );

    expect(res.status).toBe(200);
    expect(userCreate).toHaveBeenCalledOnce();
  });

  it('skips the gate when REQUIRE_INVITE_CODE=false', async () => {
    process.env.REQUIRE_INVITE_CODE = 'false';
    process.env.BETA_INVITE_CODES = 'academy2026';
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'u1' });

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
      }),
    );

    expect(res.status).toBe(200);
    expect(userCreate).toHaveBeenCalledOnce();
  });

  it('rejects an invite code that differs by a single character (timing-safe)', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026';
    userFindUnique.mockResolvedValue(null);

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
        inviteCode: 'academy2027',
      }),
    );

    expect(res.status).toBe(403);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('returns 503 when invite gate is required but BETA_INVITE_CODES is empty', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = '';
    userFindUnique.mockResolvedValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new@example.com',
        password: 'hunter22',
        inviteCode: 'whatever',
      }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Signup is temporarily unavailable. Please try again later.',
    });
    expect(errSpy).toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns 503 when invite gate is required but BETA_INVITE_CODES is whitespace-only', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = '   ,  ,';
    userFindUnique.mockResolvedValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await signupPOST(
      jsonReq('http://localhost/api/auth/signup', {
        email: 'new2@example.com',
        password: 'hunter22',
        inviteCode: 'anything',
      }),
    );

    expect(res.status).toBe(503);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('POST /api/auth/signup — rate limiting', () => {
  it('returns 429 with Retry-After on the 6th attempt within the window', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026';
    userFindUnique.mockResolvedValue(null);

    const headers = { 'x-forwarded-for': '203.0.113.7' };
    const send = () =>
      signupPOST(
        jsonReq(
          'http://localhost/api/auth/signup',
          {
            email: 'brute@example.com',
            password: 'hunter22',
            inviteCode: 'wrong-guess',
          },
          headers,
        ),
      );

    for (let i = 0; i < 5; i += 1) {
      const r = await send();
      expect(r.status).toBe(403);
    }

    const limited = await send();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      ok: false,
      error: 'Too many signup attempts. Try again later.',
    });
    const retryAfter = limited.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('resets the limiter after the window expires (15min)', async () => {
    process.env.REQUIRE_INVITE_CODE = 'true';
    process.env.BETA_INVITE_CODES = 'academy2026';
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'u1' });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-23T10:00:00Z'));
      const headers = { 'x-forwarded-for': '203.0.113.8' };
      const badReq = () =>
        signupPOST(
          jsonReq(
            'http://localhost/api/auth/signup',
            {
              email: 'expire@example.com',
              password: 'hunter22',
              inviteCode: 'wrong-guess',
            },
            headers,
          ),
        );

      for (let i = 0; i < 5; i += 1) {
        const r = await badReq();
        expect(r.status).toBe(403);
      }
      const limited = await badReq();
      expect(limited.status).toBe(429);

      // Advance past the 15-minute window.
      vi.setSystemTime(new Date('2026-05-23T10:16:00Z'));

      const recovered = await signupPOST(
        jsonReq(
          'http://localhost/api/auth/signup',
          {
            email: 'expire@example.com',
            password: 'hunter22',
            inviteCode: 'academy2026',
          },
          headers,
        ),
      );
      expect(recovered.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/auth/reset', () => {
  it('returns 200 even when no user exists (no leak)', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await resetRequestPOST(
      jsonReq('http://localhost/api/auth/reset', { email: 'ghost@example.com' }),
    );
    expect(res.status).toBe(200);
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it('returns 200 and creates a token when user exists', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', email: 'alice@example.com' });
    tokenCreate.mockResolvedValue({ id: 't1' });

    const res = await resetRequestPOST(
      jsonReq(
        'http://localhost/api/auth/reset',
        { email: 'alice@example.com' },
        { origin: 'http://localhost:4321' },
      ),
    );

    expect(res.status).toBe(200);
    expect(tokenCreate).toHaveBeenCalledOnce();
    const args = tokenCreate.mock.calls[0][0] as {
      data: { userId: string; tokenHash: string; expires: Date };
    };
    expect(args.data.userId).toBe('u1');
    expect(args.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.data.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns 200 even on invalid email payload (no leak)', async () => {
    const res = await resetRequestPOST(
      jsonReq('http://localhost/api/auth/reset', { email: 'not-an-email' }),
    );
    expect(res.status).toBe(200);
    expect(tokenCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/reset/[token]', () => {
  function makeCtx(token: string) {
    return { params: Promise.resolve({ token }) };
  }

  it('rejects an invalid (unknown) token with 400', async () => {
    tokenFindUnique.mockResolvedValue(null);
    const raw = randomBytes(32).toString('base64url');
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: 'newpass99' }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an expired token with 400', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expires: new Date(Date.now() - 1000),
      used: false,
    });
    const raw = randomBytes(32).toString('base64url');
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: 'newpass99' }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
    expect(txn).not.toHaveBeenCalled();
  });

  it('rejects a used token with 400', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expires: new Date(Date.now() + 60_000),
      used: true,
    });
    const raw = randomBytes(32).toString('base64url');
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: 'newpass99' }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
    expect(txn).not.toHaveBeenCalled();
  });

  it('accepts a valid token, hashes the new password, marks token used', async () => {
    const raw = randomBytes(32).toString('base64url');
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      tokenHash: expectedHash,
      expires: new Date(Date.now() + 60_000),
      used: false,
    });
    txn.mockResolvedValue([{ email: 'alice@example.com' }, { id: 't1', used: true }]);

    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: 'newpass99' }),
      makeCtx(raw),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'alice@example.com' });
    expect(tokenFindUnique).toHaveBeenCalledWith({ where: { tokenHash: expectedHash } });
    expect(txn).toHaveBeenCalledOnce();
  });

  it('rejects weak passwords with 422', async () => {
    const raw = randomBytes(32).toString('base64url');
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: 'short' }),
      makeCtx(raw),
    );
    expect(res.status).toBe(422);
    expect(tokenFindUnique).not.toHaveBeenCalled();
  });
});
