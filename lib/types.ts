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
    /** Configured max players for this game (OSS PLAYER_CAP). */
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
