import type {
  AnswerIndex,
  PersonalState,
  PublicGameState,
  Question,
  QuestionType,
} from '@/lib/types';

export interface FixturePlayer {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
}

export function makePlayer(i: number, overrides: Partial<FixturePlayer> = {}): FixturePlayer {
  return {
    id: `p${i}`,
    nickname: `Player ${i}`,
    score: 1000 - i * 50,
    connected: true,
    ...overrides,
  };
}

export function makePlayers(n: number, overrides: Partial<FixturePlayer> = {}): FixturePlayer[] {
  return Array.from({ length: n }, (_, i) => makePlayer(i + 1, overrides));
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'multiple',
    text: 'Which planet is closest to the sun?',
    options: ['Mercury', 'Venus', 'Earth', 'Mars'],
    correct: 0,
    timeLimit: 20,
    doublePoints: false,
    ...overrides,
  };
}

export interface MakeStateInput {
  pin?: string;
  phase: PublicGameState['phase'];
  questionIndex?: number;
  totalQuestions?: number;
  question?: Question | null;
  startedAt?: number;
  endsAt?: number;
  reveal?: PublicGameState['reveal'];
  paused?: PublicGameState['paused'];
  endedReason?: PublicGameState['endedReason'];
  players?: FixturePlayer[];
  podium?: PublicGameState['podium'];
  cap?: PublicGameState['cap'];
}

export function makeState(input: MakeStateInput): PublicGameState {
  const players = input.players ?? [];
  const totalQuestions = input.totalQuestions ?? 5;
  const questionIndex = input.questionIndex ?? 0;
  const baseQ = input.question === null ? undefined : (input.question ?? makeQuestion());

  const state: PublicGameState = {
    pin: input.pin ?? '123456',
    phase: input.phase,
    questionIndex,
    totalQuestions,
    players,
    playerCount: players.length,
    cap: input.cap ?? { max: 10 },
  };

  if (baseQ) {
    state.question = {
      text: baseQ.text,
      type: baseQ.type,
      options: baseQ.options,
      timeLimit: baseQ.timeLimit,
      doublePoints: baseQ.doublePoints,
      ...(baseQ.imageUrl ? { imageUrl: baseQ.imageUrl } : {}),
    };
  }
  if (input.startedAt !== undefined) state.startedAt = input.startedAt;
  if (input.endsAt !== undefined) state.endsAt = input.endsAt;
  if (input.reveal) state.reveal = input.reveal;
  if (input.paused) state.paused = input.paused;
  if (input.endedReason) state.endedReason = input.endedReason;
  if (input.podium) state.podium = input.podium;
  return state;
}

export function makePersonal(overrides: Partial<PersonalState> = {}): PersonalState {
  return {
    hasAnswered: false,
    ...overrides,
  };
}

export interface Fixture {
  id: string;
  label: string;
  category: 'display' | 'control' | 'player' | 'shared';
  state: PublicGameState;
  personal?: PersonalState;
  pin?: string;
  notes?: string;
}

const longStem =
  'In the early hours of an unremarkable Tuesday morning, when the broadcast tower above the studio was still humming with residual static from the overnight programming block, which historic event is generally credited with kicking off the modern era of live television quiz shows?';

const longOption =
  'A very long answer that probably needs to truncate cleanly inside the answer tile container';

const tfQ: Question = makeQuestion({
  type: 'truefalse',
  text: 'The sun is a star.',
  options: ['True', 'False'],
  correct: 0,
});

const longStemQ: Question = makeQuestion({
  text: longStem,
  options: ['Option A', 'Option B', 'Option C', 'Option D'],
});

const longOptsQ: Question = makeQuestion({
  text: 'Pick the most accurate description.',
  options: [longOption, longOption, longOption, longOption],
});

const shortOptsQ: Question = makeQuestion({
  text: 'Best answer?',
  options: ['A', 'B', 'C', '42'],
});

const dpQ: Question = makeQuestion({ doublePoints: true });

function buildPodium(players: FixturePlayer[]): PublicGameState['podium'] {
  return [...players]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((p, i) => ({ id: p.id, nickname: p.nickname, score: p.score, rank: i + 1 }));
}

const lobby0 = makeState({ phase: 'lobby', question: null, players: [] });
const lobby1 = makeState({
  phase: 'lobby',
  question: null,
  players: [makePlayer(1, { nickname: 'Alex', score: 0 })],
});
const lobby50 = makeState({
  phase: 'lobby',
  question: null,
  players: makePlayers(50, { score: 0 }),
});
const lobby150 = makeState({
  phase: 'lobby',
  question: null,
  players: makePlayers(150, { score: 0 }),
  cap: { max: 150 },
});

const fourPlayers = makePlayers(4);

const questionShort = makeState({
  phase: 'question',
  question: shortOptsQ,
  players: fourPlayers,
  startedAt: 1_700_000_000_000,
  endsAt: 1_700_000_020_000,
});

const imageQ: Question = makeQuestion({
  text: 'Identify the broadcast still shown on the monitor.',
  imageUrl: '/uploads/quiz-images/sample.png',
});

const questionImage = makeState({
  phase: 'question',
  question: imageQ,
  players: fourPlayers,
  startedAt: 1_700_000_000_000,
  endsAt: 1_700_000_020_000,
});

const questionLongOpts = makeState({
  phase: 'question',
  question: longOptsQ,
  players: fourPlayers,
});

const questionLongStem = makeState({
  phase: 'question',
  question: longStemQ,
  players: fourPlayers,
});

const questionTrueFalse = makeState({
  phase: 'question',
  question: tfQ,
  players: fourPlayers,
});

const questionDouble = makeState({
  phase: 'question',
  question: dpQ,
  players: fourPlayers,
});

function revealState(opts: {
  question?: Question;
  correct: AnswerIndex;
  distribution: number[];
  players?: FixturePlayer[];
}) {
  const players = opts.players ?? fourPlayers;
  const totalAnswers = opts.distribution.reduce((a, b) => a + b, 0);
  return makeState({
    phase: 'reveal',
    question: opts.question ?? makeQuestion(),
    players,
    reveal: { correct: opts.correct, distribution: opts.distribution, totalAnswers },
  });
}

const lockedPlayers = fourPlayers;

const leaderboard3Close = makeState({
  phase: 'leaderboard',
  question: makeQuestion(),
  players: [
    makePlayer(1, { nickname: 'Alex', score: 1450 }),
    makePlayer(2, { nickname: 'Bea', score: 1440 }),
    makePlayer(3, { nickname: 'Cas', score: 1420 }),
  ],
  podium: buildPodium([
    makePlayer(1, { nickname: 'Alex', score: 1450 }),
    makePlayer(2, { nickname: 'Bea', score: 1440 }),
    makePlayer(3, { nickname: 'Cas', score: 1420 }),
  ]),
});

const leaderboard10 = makeState({
  phase: 'leaderboard',
  question: makeQuestion(),
  players: makePlayers(10),
  podium: buildPodium(makePlayers(10)),
});

const leaderboardTie = makeState({
  phase: 'leaderboard',
  question: makeQuestion(),
  players: [
    makePlayer(1, { nickname: 'Alex', score: 1500 }),
    makePlayer(2, { nickname: 'Bea', score: 1500 }),
    makePlayer(3, { nickname: 'Cas', score: 1200 }),
  ],
  podium: buildPodium([
    makePlayer(1, { nickname: 'Alex', score: 1500 }),
    makePlayer(2, { nickname: 'Bea', score: 1500 }),
    makePlayer(3, { nickname: 'Cas', score: 1200 }),
  ]),
});

const leaderboardSingle = makeState({
  phase: 'leaderboard',
  question: makeQuestion(),
  players: [makePlayer(1, { nickname: 'Solo', score: 800 })],
  podium: buildPodium([makePlayer(1, { nickname: 'Solo', score: 800 })]),
});

const finalChampion = makeState({
  phase: 'final',
  question: null,
  players: [
    makePlayer(1, { nickname: 'Alex', score: 4200 }),
    makePlayer(2, { nickname: 'Bea', score: 3850 }),
    makePlayer(3, { nickname: 'Cas', score: 3600 }),
    makePlayer(4, { nickname: 'Dee', score: 2900 }),
  ],
});

const finalHostLeft = makeState({
  phase: 'final',
  question: null,
  players: makePlayers(4),
  endedReason: 'host-left',
});

const finalSingle = makeState({
  phase: 'final',
  question: null,
  players: [makePlayer(1, { nickname: 'Solo', score: 1500 })],
});

const pausedOverReveal = makeState({
  phase: 'reveal',
  question: makeQuestion(),
  players: fourPlayers,
  reveal: { correct: 0, distribution: [3, 1, 0, 0], totalAnswers: 4 },
  paused: { reason: 'host-disconnected', resumeBy: 1_700_000_030_000 },
});

export const fixtures: Fixture[] = [
  {
    id: 'lobby-empty',
    label: 'Lobby — 0 players',
    category: 'shared',
    state: lobby0,
    notes: 'Cold open: no one on the floor yet.',
  },
  {
    id: 'lobby-one',
    label: 'Lobby — 1 player',
    category: 'shared',
    state: lobby1,
  },
  {
    id: 'lobby-fifty',
    label: 'Lobby — 50 players',
    category: 'shared',
    state: lobby50,
    notes: 'Player overflow check on the lobby grid.',
  },
  {
    id: 'lobby-cap',
    label: 'Lobby — 150 players (cap)',
    category: 'shared',
    state: lobby150,
    notes: 'Player cap reached (lib/constants.ts PLAYER_CAP=150).',
  },

  {
    id: 'question-short',
    label: 'Question — short options',
    category: 'shared',
    state: questionShort,
  },
  {
    id: 'question-image',
    label: 'Question — with image',
    category: 'shared',
    state: questionImage,
    notes: 'Per-question still alongside stem (MID-278).',
  },
  {
    id: 'question-long-options',
    label: 'Question — long options',
    category: 'shared',
    state: questionLongOpts,
    notes: 'Tests answer-tile truncation.',
  },
  {
    id: 'question-long-stem',
    label: 'Question — long stem',
    category: 'shared',
    state: questionLongStem,
    notes: 'Stem ~200+ chars; presenter wrapping.',
  },
  {
    id: 'question-truefalse',
    label: 'Question — true/false',
    category: 'shared',
    state: questionTrueFalse,
    notes: 'Two-option layout.',
  },
  {
    id: 'question-double-points',
    label: 'Question — 2× points',
    category: 'shared',
    state: questionDouble,
  },

  {
    id: 'reveal-correct-0',
    label: 'Reveal — correct = 0',
    category: 'shared',
    state: revealState({ correct: 0, distribution: [4, 0, 0, 0] }),
  },
  {
    id: 'reveal-correct-1',
    label: 'Reveal — correct = 1',
    category: 'shared',
    state: revealState({ correct: 1, distribution: [1, 3, 0, 0] }),
  },
  {
    id: 'reveal-correct-2',
    label: 'Reveal — correct = 2',
    category: 'shared',
    state: revealState({ correct: 2, distribution: [1, 0, 2, 1] }),
  },
  {
    id: 'reveal-correct-3',
    label: 'Reveal — correct = 3',
    category: 'shared',
    state: revealState({ correct: 3, distribution: [0, 1, 1, 2] }),
  },
  {
    id: 'reveal-zero',
    label: 'Reveal — no answers',
    category: 'shared',
    state: revealState({ correct: 0, distribution: [0, 0, 0, 0] }),
    notes: 'Nobody answered.',
  },
  {
    id: 'reveal-even',
    label: 'Reveal — even split',
    category: 'shared',
    state: revealState({ correct: 0, distribution: [25, 25, 25, 25] }),
  },
  {
    id: 'reveal-skew',
    label: 'Reveal — heavy skew',
    category: 'shared',
    state: revealState({ correct: 0, distribution: [95, 2, 2, 1] }),
  },
  {
    id: 'reveal-all-wrong',
    label: 'Reveal — 100% wrong',
    category: 'shared',
    state: revealState({ correct: 0, distribution: [0, 100, 0, 0] }),
    notes: 'Everyone picked a wrong answer.',
  },
  {
    id: 'reveal-long-answer',
    label: 'Reveal — long correct',
    category: 'shared',
    state: revealState({ question: longOptsQ, correct: 1, distribution: [1, 5, 1, 1] }),
  },

  {
    id: 'player-locked-correct',
    label: 'Player — locked, will be correct',
    category: 'player',
    state: makeState({
      phase: 'question',
      question: makeQuestion(),
      players: lockedPlayers,
    }),
    personal: makePersonal({ hasAnswered: true, lastAnswer: 0 as AnswerIndex }),
    notes: 'Just locked-in feedback.',
  },
  {
    id: 'player-reveal-correct',
    label: 'Player — reveal: correct',
    category: 'player',
    state: revealState({ correct: 0, distribution: [3, 1, 0, 0] }),
    personal: makePersonal({
      hasAnswered: true,
      lastAnswer: 0 as AnswerIndex,
      lastCorrect: true,
      lastAwarded: 950,
      rank: 1,
      total: 4,
    }),
  },
  {
    id: 'player-reveal-high-score',
    label: 'Player — reveal: high score',
    category: 'player',
    state: revealState({ correct: 0, distribution: [3, 1, 0, 0] }),
    personal: makePersonal({
      hasAnswered: true,
      lastAnswer: 0 as AnswerIndex,
      lastCorrect: true,
      lastAwarded: 965,
      rank: 1,
      total: 1,
      score: 10_316,
    }),
    notes: 'Exercises five-digit score fitting inside the reveal stat card.',
  },
  {
    id: 'player-reveal-incorrect',
    label: 'Player — reveal: incorrect',
    category: 'player',
    state: revealState({ correct: 0, distribution: [1, 3, 0, 0] }),
    personal: makePersonal({
      hasAnswered: true,
      lastAnswer: 1 as AnswerIndex,
      lastCorrect: false,
      lastAwarded: 0,
      rank: 3,
      total: 4,
    }),
  },
  {
    id: 'player-reveal-timeout',
    label: 'Player — reveal: no answer',
    category: 'player',
    state: revealState({ correct: 0, distribution: [2, 1, 0, 0] }),
    personal: makePersonal({
      hasAnswered: false,
      rank: 4,
      total: 4,
    }),
    notes: 'Timed out without locking in.',
  },

  {
    id: 'leaderboard-1',
    label: 'Leaderboard — 1 player',
    category: 'shared',
    state: leaderboardSingle,
  },
  {
    id: 'leaderboard-3-close',
    label: 'Leaderboard — 3 close',
    category: 'shared',
    state: leaderboard3Close,
  },
  {
    id: 'leaderboard-10',
    label: 'Leaderboard — 10 players',
    category: 'shared',
    state: leaderboard10,
  },
  {
    id: 'leaderboard-tie',
    label: 'Leaderboard — tie at top',
    category: 'shared',
    state: leaderboardTie,
  },

  {
    id: 'final-champion',
    label: 'Final — champion + runners-up',
    category: 'shared',
    state: finalChampion,
  },
  {
    id: 'final-host-left',
    label: 'Final — host left',
    category: 'shared',
    state: finalHostLeft,
    notes: 'endedReason = host-left.',
  },
  {
    id: 'final-single',
    label: 'Final — single player',
    category: 'shared',
    state: finalSingle,
  },

  {
    id: 'paused-over-reveal',
    label: 'Paused — overlay over reveal',
    category: 'shared',
    state: pausedOverReveal,
    personal: makePersonal({
      hasAnswered: true,
      lastAnswer: 0 as AnswerIndex,
      lastCorrect: true,
      lastAwarded: 800,
      rank: 1,
      total: 4,
    }),
    notes: 'Paused overlay stacked on top of reveal phase.',
  },
];

export const SURFACES = ['display', 'control', 'player'] as const;
export type Surface = (typeof SURFACES)[number];

export function fixturesForSurface(surface: Surface): Fixture[] {
  return fixtures.filter((f) => f.category === 'shared' || f.category === surface);
}

export type { QuestionType };
