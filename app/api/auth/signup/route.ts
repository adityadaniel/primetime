import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCredentialsUser } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: 'An account already exists with that email' },
      { status: 409 },
    );
  }
  await createCredentialsUser(email, parsed.data.password, parsed.data.name);
  return NextResponse.json({ ok: true });
}
