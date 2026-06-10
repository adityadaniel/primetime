// Q&A session creation (MID-333). Mirrors app/api/wordcloud/route.ts: host
// auth required, shared PIN allocator so a PIN can never collide across the
// quiz, word-cloud, and Q&A routes, session created in OPEN status.

import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { allocatePin, createSession, QA_DESCRIPTION_MAX, QA_TITLE_MAX } from '@/lib/qa-repo';

const PRIVACY_MODES = [
  'ANONYMOUS_BY_DEFAULT',
  'ALWAYS_ANONYMOUS',
  'NAMED_BY_DEFAULT',
  'NAME_REQUIRED',
] as const;
type PrivacyMode = (typeof PRIVACY_MODES)[number];

const QUESTION_CHAR_LIMITS = [140, 280, 500] as const;
const QUESTION_CHAR_LIMIT_DEFAULT = 280;

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
  const {
    title,
    description,
    privacyMode,
    moderationEnabled,
    participantRepliesEnabled,
    downvotesEnabled,
    questionCharLimit,
  } = body as {
    title?: unknown;
    description?: unknown;
    privacyMode?: unknown;
    moderationEnabled?: unknown;
    participantRepliesEnabled?: unknown;
    downvotesEnabled?: unknown;
    questionCharLimit?: unknown;
  };

  if (typeof title !== 'string') {
    return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle.length < 1 || trimmedTitle.length > QA_TITLE_MAX) {
    return NextResponse.json({ error: `title_length_1_to_${QA_TITLE_MAX}` }, { status: 400 });
  }

  let trimmedDescription: string | null = null;
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 });
    }
    trimmedDescription = description.trim() || null;
    if (trimmedDescription && trimmedDescription.length > QA_DESCRIPTION_MAX) {
      return NextResponse.json({ error: `description_max_${QA_DESCRIPTION_MAX}` }, { status: 400 });
    }
  }

  let mode: PrivacyMode = 'ANONYMOUS_BY_DEFAULT';
  if (privacyMode !== undefined) {
    if (typeof privacyMode !== 'string' || !PRIVACY_MODES.includes(privacyMode as PrivacyMode)) {
      return NextResponse.json({ error: 'invalid_privacy_mode' }, { status: 400 });
    }
    mode = privacyMode as PrivacyMode;
  }

  if (moderationEnabled !== undefined && typeof moderationEnabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_moderation_enabled' }, { status: 400 });
  }
  if (participantRepliesEnabled !== undefined && typeof participantRepliesEnabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_participant_replies_enabled' }, { status: 400 });
  }
  if (downvotesEnabled !== undefined && typeof downvotesEnabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_downvotes_enabled' }, { status: 400 });
  }

  let charLimit: number = QUESTION_CHAR_LIMIT_DEFAULT;
  if (questionCharLimit !== undefined) {
    if (
      typeof questionCharLimit !== 'number' ||
      !QUESTION_CHAR_LIMITS.includes(questionCharLimit as (typeof QUESTION_CHAR_LIMITS)[number])
    ) {
      return NextResponse.json({ error: 'invalid_question_char_limit' }, { status: 400 });
    }
    charLimit = questionCharLimit;
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
      privacyMode: mode,
      moderationEnabled: moderationEnabled ?? false,
      participantRepliesEnabled: participantRepliesEnabled ?? false,
      downvotesEnabled: downvotesEnabled ?? false,
      questionCharLimit: charLimit,
      hostUserId: userId,
    });
    return NextResponse.json({ pin: created.pin, sessionId: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'create_failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
