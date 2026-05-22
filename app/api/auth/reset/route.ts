import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const Body = z.object({ email: z.string().email().max(254) });

const TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function buildResetUrl(req: Request, token: string): string {
  const origin =
    req.headers.get('origin') ??
    (() => {
      const proto = req.headers.get('x-forwarded-proto') ?? 'http';
      const host = req.headers.get('host') ?? 'localhost';
      return `${proto}://${host}`;
    })();
  return `${origin}/reset/${token}`;
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const dev = process.env.NODE_ENV !== 'production';

  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const raw = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(raw);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  const url = buildResetUrl(req, raw);
  console.log('[reset]', url);

  return NextResponse.json(dev ? { ok: true, devUrl: url } : { ok: true });
}
