export type AnswerIndex = 0 | 1 | 2 | 3;

export type QuestionType = 'multiple' | 'truefalse';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct: AnswerIndex;
  timeLimit: number;
  doublePoints: boolean;
  /** Optional public URL of an image shown with the question (MID-278). */
  imageUrl?: string;
}

export interface Quiz {
  title: string;
  description?: string;
  questions: Question[];
}

export interface Player {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  connected: boolean;
  disconnectedAt?: number;
}

export type GamePhase = 'lobby' | 'question' | 'locked' | 'reveal' | 'leaderboard' | 'final';

export interface AnswerRecord {
  playerId: string;
  optionIndex: AnswerIndex;
  msFromStart: number;
  awarded: number;
  correct: boolean;
}

export interface PublicGameState {
  pin: string;
  phase: GamePhase;
  questionIndex: number;
  totalQuestions: number;
  question?: {
    text: string;
    type: QuestionType;
    options: string[];
    timeLimit: number;
    doublePoints: boolean;
    imageUrl?: string;
  };
  startedAt?: number;
  endsAt?: number;
  reveal?: {
    correct: AnswerIndex;
    distribution: number[];
    totalAnswers: number;
  };
  paused?: {
    reason: 'host-disconnected';
    resumeBy: number;
  };
  endedReason?: 'host-left';
  playerCount?: number;
  cap?: {
    /** Configured max players for this game (OSS code-level cap). */
    max: number;
  };
  players: Array<{ id: string; nickname: string; score: number; connected: boolean }>;
  podium?: Array<{ id: string; nickname: string; score: number; rank: number }>;
}

export interface PersonalState {
  hasAnswered: boolean;
  lastAnswer?: AnswerIndex;
  lastAwarded?: number;
  lastCorrect?: boolean;
  rank?: number;
  total?: number;
  score?: number;
}

export type JoinErrorCode = 'full' | 'nickname-rejected';

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: JoinErrorCode;
  playerId?: string;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  options: string[];
  correct: AnswerIndex;
  timeLimit: number;
  doublePoints: boolean;
  imageUrl?: string;
}

export interface QuizSummary {
  id: string;
  title: string;
  questionCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Q&A live activity (MID-332). String-literal twins of the Prisma enums so the
// in-memory state module stays pure and testable without @prisma/client.
// ---------------------------------------------------------------------------

/** Live session lifecycle. Prisma's ARCHIVED collapses to ENDED in memory. */
export type QASessionStatus = 'OPEN' | 'CLOSED' | 'ENDED';

export type QAQuestionStatus =
  | 'IN_REVIEW'
  | 'LIVE'
  | 'ANSWERED'
  | 'ARCHIVED'
  | 'DISMISSED'
  | 'WITHDRAWN';

export type QAPrivacyMode =
  | 'ANONYMOUS_BY_DEFAULT'
  | 'ALWAYS_ANONYMOUS'
  | 'NAMED_BY_DEFAULT'
  | 'NAME_REQUIRED';

export type QAVoteType = 'UP' | 'DOWN';

export interface QASettings {
  title: string;
  description: string | null;
  privacyMode: QAPrivacyMode;
  moderationEnabled: boolean;
  participantRepliesEnabled: boolean;
  downvotesEnabled: boolean;
  questionCharLimit: number;
}

export interface QAPublicLabel {
  id: string;
  name: string;
  participantSelectable: boolean;
}

export type QADisplaySortMode = 'popular' | 'recent' | 'oldest';

/** Public-safe display/presentation controls for the Q&A projector. */
export interface QADisplaySettings {
  sort: QADisplaySortMode;
  /** Null means no label filter. Only public label ids should be selected. */
  labelFilter: string | null;
  /** Number of questions to project on the board; server clamps to 1..6. */
  visibleCount: number;
  showTicker: boolean;
  /** When true, the highlighted question takes over the projection. */
  highlightFullscreen: boolean;
}

/**
 * A reply that is safe to show to everyone. Replies never expose participant
 * identity; only the host marker is public.
 */
export interface QAPublicReply {
  id: string;
  isHostReply: boolean;
  text: string;
  createdAt: number;
}

/**
 * Display/participant-safe question. Only LIVE questions are projected, so
 * IN_REVIEW, DISMISSED, WITHDRAWN, ANSWERED, and ARCHIVED never leak here.
 * Anonymous questions carry a null author name.
 */
export interface QAPublicQuestion {
  id: string;
  text: string;
  isAnonymous: boolean;
  authorDisplayName: string | null;
  score: number;
  upvotes: number;
  downvotes: number;
  labelIds: string[];
  replyCount: number;
  /**
   * All replies here are public by construction (only LIVE questions project,
   * so private in-review replies never enter this state). Display/projection
   * surfaces must still not RENDER replies (PRD §4.8) — threads are a
   * participant/host reading surface, not a room-projection one.
   */
  replies: QAPublicReply[];
  highlighted: boolean;
  submittedAt: number;
}

/**
 * Compact per-question score delta. Vote bursts coalesce into one `qa:scores`
 * emit per room per tick (server.ts) instead of a full `qa:state` per vote;
 * clients patch the matching questions and re-sort locally.
 */
export interface QAQuestionScore {
  questionId: string;
  score: number;
  upvotes: number;
  downvotes: number;
}

/** Projection broadcast to displays and participants. */
export interface QAPublicState {
  pin: string;
  title: string;
  description: string | null;
  privacyMode: QAPrivacyMode;
  status: QASessionStatus;
  submissionsOpen: boolean;
  votingOpen: boolean;
  downvotesEnabled: boolean;
  participantRepliesEnabled: boolean;
  questionCharLimit: number;
  participantCount: number;
  questionCount: number;
  highlightedQuestionId: string | null;
  labels: QAPublicLabel[];
  displaySettings: QADisplaySettings;
  questions: QAPublicQuestion[];
}

/**
 * Board row for the host control surface (MID-337): the public projection
 * plus the question status, so the host can see LIVE and IN_REVIEW questions
 * side by side. Anonymous stays anonymous — no participant linkage here.
 */
export interface QAHostQuestion extends QAPublicQuestion {
  status: QAQuestionStatus;
}

/** Question counts by state for the host session header. */
export interface QAHostCounts {
  live: number;
  inReview: number;
  answered: number;
  archived: number;
  dismissed: number;
}

/**
 * Projection targeted at the host socket only (`qa:host:state`). Never
 * broadcast to the mixed qa:${pin} room: it includes IN_REVIEW and DISMISSED
 * questions, which must stay invisible to displays and other participants.
 */
export interface QAHostState {
  pin: string;
  title: string;
  description: string | null;
  privacyMode: QAPrivacyMode;
  moderationEnabled: boolean;
  status: QASessionStatus;
  submissionsOpen: boolean;
  votingOpen: boolean;
  downvotesEnabled: boolean;
  participantRepliesEnabled: boolean;
  questionCharLimit: number;
  participantCount: number;
  counts: QAHostCounts;
  highlightedQuestionId: string | null;
  labels: QAPublicLabel[];
  displaySettings: QADisplaySettings;
  /**
   * Every non-WITHDRAWN question, popular order (score desc, oldest first).
   * DISMISSED rows exist so the host can restore them to review (MID-338);
   * ANSWERED/ARCHIVED rows exist so the host can restore them to the live
   * board (MID-339). All host-only — never reach public projections.
   */
  questions: QAHostQuestion[];
}

/**
 * The participant's own question in any status, including pending review and
 * withdrawn, with all replies (private host replies included — they are only
 * ever sent to the owner).
 */
export interface QAPersonalQuestion {
  id: string;
  text: string;
  status: QAQuestionStatus;
  isAnonymous: boolean;
  submittedAt: number;
  replies: QAPublicReply[];
}

/** Projection targeted at a single participant. Never broadcast. */
export interface QAPersonalState {
  participantId: string;
  displayName: string | null;
  questions: QAPersonalQuestion[];
  /** questionId -> this participant's current vote. */
  votes: Record<string, QAVoteType>;
}
