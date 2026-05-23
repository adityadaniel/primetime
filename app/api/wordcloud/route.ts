import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { allocatePin, createSession } from '@/lib/wordcloud-repo';

// TODO MID-75: enforce free-tier 250-submission cap
const FREE_TIER_SUBMISSION_CAP = 250;
void FREE_TIER_SUBMISSION_CAP;

const PROMPT_MAX = 140;

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
  const { prompt, wordsPerPlayer, profanityFilter } = body as {
    prompt?: unknown;
    wordsPerPlayer?: unknown;
    profanityFilter?: unknown;
  };

  if (typeof prompt !== 'string') {
    return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 });
  }
  const trimmed = prompt.trim();
  if (trimmed.length < 1 || trimmed.length > PROMPT_MAX) {
    return NextResponse.json({ error: 'prompt_length_1_to_140' }, { status: 400 });
  }
  if (
    typeof wordsPerPlayer !== 'number' ||
    !Number.isInteger(wordsPerPlayer) ||
    wordsPerPlayer < 1 ||
    wordsPerPlayer > 5
  ) {
    return NextResponse.json({ error: 'invalid_words_per_player' }, { status: 400 });
  }
  if (typeof profanityFilter !== 'boolean') {
    return NextResponse.json({ error: 'invalid_profanity_filter' }, { status: 400 });
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
      prompt: trimmed,
      wordsPerPlayer,
      profanityFilter,
      hostUserId: userId,
    });
    return NextResponse.json({ pin: created.pin, sessionId: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'create_failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
