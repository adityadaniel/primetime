import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCredentialsUser } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80).optional(),
  inviteCode: z.string().trim().min(1).max(80).optional(),
});

const SIGNUP_RATE_LIMIT = { limit: 5, windowMs: 15 * 60_000 };

function inviteRequired(): boolean {
  // Default OFF for OSS self-host: open signup. Operators can flip
  // REQUIRE_INVITE_CODE=true to gate signups behind a beta access code.
  return (process.env.REQUIRE_INVITE_CODE ?? 'false').toLowerCase() === 'true';
}

function configuredInviteCodes(): string[] {
  const raw = process.env.BETA_INVITE_CODES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isValidInviteCode(candidate: string, codes: readonly string[]): boolean {
  if (!candidate) return false;
  const candidateBuf = Buffer.from(candidate, 'utf8');
  let matched = false;
  for (const code of codes) {
    const codeBuf = Buffer.from(code, 'utf8');
    // timingSafeEqual requires equal-length buffers. Pad the shorter one with zeros
    // so we always pay the comparison cost, then still require an exact length match
    // before declaring success — zero-padding could otherwise mask length mismatches.
    const len = Math.max(candidateBuf.length, codeBuf.length);
    const a = Buffer.alloc(len);
    const b = Buffer.alloc(len);
    candidateBuf.copy(a);
    codeBuf.copy(b);
    const equal = timingSafeEqual(a, b);
    if (equal && candidateBuf.length === codeBuf.length) {
      matched = true;
      // Don't early-return — keep the loop constant-cost across configured codes.
    }
  }
  return matched;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  return 'unknown';
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();

  // Apply the rate-limit check before the invite-code check so brute-forcers
  // can't bypass it by spamming guesses.
  const ip = clientIp(req);
  const rateKey = `signup:${ip}:${email}`;
  const rate = checkRateLimit(rateKey, SIGNUP_RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many signup attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  if (inviteRequired()) {
    const codes = configuredInviteCodes();
    if (codes.length === 0) {
      // Misconfiguration: gate is required but no codes are configured. Refuse to lock
      // every user out silently. Do not leak the env var name in the response body.
      console.error(
        '[signup] REQUIRE_INVITE_CODE=true but BETA_INVITE_CODES is empty or missing. Refusing signups until configured.',
      );
      return NextResponse.json(
        { ok: false, error: 'Signup is temporarily unavailable. Please try again later.' },
        { status: 503 },
      );
    }
    const supplied = parsed.data.inviteCode?.toLowerCase() ?? '';
    if (!isValidInviteCode(supplied, codes)) {
      return NextResponse.json({ ok: false, error: 'Invite code not recognized' }, { status: 403 });
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: 'An account already exists with that email' },
      { status: 409 },
    );
  }
  await createCredentialsUser(email, parsed.data.password, parsed.data.name);
  return NextResponse.json({ ok: true });
}
