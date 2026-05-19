export type AnswerIndex = 0 | 1 | 2 | 3;

export type QuestionType = "multiple" | "truefalse";

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct: AnswerIndex;
  timeLimit: number;
  doublePoints: boolean;
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

export type GamePhase =
  | "lobby"
  | "question"
  | "locked"
  | "reveal"
  | "leaderboard"
  | "final";

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
  };
  startedAt?: number;
  endsAt?: number;
  reveal?: {
    correct: AnswerIndex;
    distribution: number[];
    totalAnswers: number;
  };
  paused?: {
    reason: "host-disconnected";
    resumeBy: number;
  };
  endedReason?: "host-left";
  playerCount?: number;
  cap?: {
    hard: number;
    soft: number;
    upsell: boolean;
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
}

export type JoinErrorCode = "full" | "nickname-rejected";

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: JoinErrorCode;
  playerId?: string;
}
