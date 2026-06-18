// WonderWall session creation (MID-398). Mirrors app/api/q-and-a/route.ts and
// app/api/wordcloud/route.ts: host auth required, shared PIN allocator so a PIN
// can never collide across the quiz, word-cloud, Q&A, and WonderWall routes.
// The session is created in the repo-default DRAFT status; submissions arrive
// later via /play/[pin]/wonderwall and start PENDING/canDisplay=false.

import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  allocatePin,
  createSession,
  WONDERWALL_DESCRIPTION_MAX,
  WONDERWALL_INSTRUCTIONS_MAX,
  WONDERWALL_TITLE_MAX,
} from '@/lib/wonderwall-repo';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { title, description, instructions } = body as {
    title?: unknown;
    description?: unknown;
    instructions?: unknown;
  };

  if (typeof title !== 'string') {
    return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle.length < 1 || trimmedTitle.length > WONDERWALL_TITLE_MAX) {
    return NextResponse.json(
      { error: `title_length_1_to_${WONDERWALL_TITLE_MAX}` },
      { status: 400 },
    );
  }

  let trimmedDescription: string | null = null;
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 });
    }
    trimmedDescription = description.trim() || null;
    if (trimmedDescription && trimmedDescription.length > WONDERWALL_DESCRIPTION_MAX) {
      return NextResponse.json(
        { error: `description_max_${WONDERWALL_DESCRIPTION_MAX}` },
        { status: 400 },
      );
    }
  }

  let trimmedInstructions: string | null = null;
  if (instructions !== undefined && instructions !== null) {
    if (typeof instructions !== 'string') {
      return NextResponse.json({ error: 'invalid_instructions' }, { status: 400 });
    }
    trimmedInstructions = instructions.trim() || null;
    if (trimmedInstructions && trimmedInstructions.length > WONDERWALL_INSTRUCTIONS_MAX) {
      return NextResponse.json(
        { error: `instructions_max_${WONDERWALL_INSTRUCTIONS_MAX}` },
        { status: 400 },
      );
    }
  }

  let pin: string;
  try {
    pin = await allocatePin();
  } catch {
    return NextResponse.json({ error: 'pin_unavailable' }, { status: 503 });
  }

  try {
    const created = await createSession({
      pin,
      title: trimmedTitle,
      description: trimmedDescription,
      instructions: trimmedInstructions,
      hostUserId: userId,
    });
    return NextResponse.json({ pin: created.pin, sessionId: created.id });
  } catch {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}
