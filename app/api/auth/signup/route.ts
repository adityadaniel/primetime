import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCredentialsUser } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80).optional(),
  inviteCode: z.string().trim().min(1).max(80).optional(),
});

function inviteRequired(): boolean {
  // Default ON. Only the literal string "false" disables the gate.
  return (process.env.REQUIRE_INVITE_CODE ?? 'true').toLowerCase() !== 'false';
}

function validInviteCodes(): Set<string> {
  const raw = process.env.BETA_INVITE_CODES ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
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

  if (inviteRequired()) {
    const supplied = parsed.data.inviteCode?.toLowerCase() ?? '';
    const codes = validInviteCodes();
    if (!supplied || !codes.has(supplied)) {
      return NextResponse.json({ ok: false, error: 'Invite code not recognized' }, { status: 403 });
    }
  }

  const email = parsed.data.email.toLowerCase();
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
