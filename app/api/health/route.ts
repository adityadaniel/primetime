import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const buildSha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.BUILD_SHA ??
    'dev';

  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // DB unreachable — still return 200 so the health endpoint itself works,
    // but report db: false so monitoring can alert.
  }

  return NextResponse.json(
    {
      status: 'ok',
      buildSha,
      db: dbOk,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
