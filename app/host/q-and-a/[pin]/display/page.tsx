'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useState } from 'react';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { publicHost, publicUrl } from '@/lib/public-origin';
import { useSocket } from '@/lib/socket';
import type {
  QADisplaySettings,
  QAPublicQuestion,
  QAPublicState,
  QAQuestionScore,
  QASessionStatus,
} from '@/lib/types';
import { selectQADisplayQuestions } from './display-utils';

const DEFAULT_DISPLAY_SETTINGS: QADisplaySettings = {
  sort: 'popular',
  labelFilter: null,
  visibleCount: 4,
  showTicker: true,
  highlightFullscreen: true,
};

type DisplayAttachAck = { state: QAPublicState } | { error: string };

export default function QAndADisplay({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState('');
  const [state, setState] = useState<QAPublicState | null>(null);
  const [settings, setSettings] = useState<QADisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState('');
  const [joinHost, setJoinHost] = useState('primetime.local');

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (typeof window === 'undefined' || !pin) return;
    setJoinUrl(publicUrl(`/join?pin=${pin}`, window.location.origin));
    setJoinHost(publicHost(window.location.origin));
  }, [pin]);

  useEffect(() => {
    if (!socket || !pin) return;
    let disposed = false;

    const applyState = (snapshot: QAPublicState) => {
      if (snapshot.pin !== pin) return;
      setState(snapshot);
      setSettings({ ...DEFAULT_DISPLAY_SETTINGS, ...snapshot.displaySettings });
      setAttachError(null);
    };

    const attach = () => {
      socket.emit('qa:display:attach', { pin }, (res: DisplayAttachAck) => {
        if (disposed) return;
        if ('error' in res) {
          setAttachError(res.error);
          return;
        }
        applyState(res.state);
      });
    };

    const onScores = (delta: { pin: string; scores: QAQuestionScore[] }) => {
      if (delta.pin !== pin) return;
      setState((prev) => {
        if (!prev) return prev;
        const byId = new Map(delta.scores.map((score) => [score.questionId, score]));
        return {
          ...prev,
          questions: prev.questions.map((question) => {
            const score = byId.get(question.id);
            return score
              ? {
                  ...question,
                  score: score.score,
                  upvotes: score.upvotes,
                  downvotes: score.downvotes,
                }
              : question;
          }),
        };
      });
    };

    const onSettings = (next: QADisplaySettings) => {
      setSettings({ ...DEFAULT_DISPLAY_SETTINGS, ...next });
    };

    socket.on('qa:state', applyState);
    socket.on('qa:scores', onScores);
    socket.on('qa:display:settings', onSettings);
    socket.on('connect', attach);
    if (socket.connected) attach();

    return () => {
      disposed = true;
      socket.off('qa:state', applyState);
      socket.off('qa:scores', onScores);
      socket.off('qa:display:settings', onSettings);
      socket.off('connect', attach);
    };
  }, [socket, pin]);

  const labelNames = useMemo(
    () => new Map((state?.labels ?? []).map((label) => [label.id, label.name])),
    [state?.labels],
  );

  const board = useMemo(
    () => selectQADisplayQuestions(state?.questions ?? [], settings),
    [state?.questions, settings],
  );

  const highlighted = useMemo(() => {
    const highlightedId = state?.highlightedQuestionId;
    if (!highlightedId) return null;
    return (state?.questions ?? []).find((question) => question.id === highlightedId) ?? null;
  }, [state?.highlightedQuestionId, state?.questions]);

  const status: QASessionStatus = state?.status ?? 'OPEN';
  const statusCopy =
    status === 'ENDED'
      ? 'SESSION ENDED · FINAL BOARD'
      : status === 'CLOSED'
        ? 'QUESTIONS CLOSED · ANSWERING LIVE'
        : state?.submissionsOpen === false
          ? 'QUESTIONS CLOSED · ANSWERING LIVE'
          : 'QUESTIONS OPEN · COLLECTING';
  const showFullscreenHighlight = Boolean(settings.highlightFullscreen && highlighted);
  const totalQuestions = state?.questionCount ?? 0;

  if (attachError) {
    return (
      <main className="relative grid h-[100dvh] place-items-center overflow-hidden grain px-6">
        <div className="max-w-xl text-center">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            DISPLAY SIGNAL LOST
          </p>
          <h1 className="font-editorial text-5xl leading-none">
            {displayAttachError(attachError)}
          </h1>
          <p className="ticker mt-6 text-[12px] tracking-widest opacity-70">
            PIN {pin || '······'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden grain">
      <header className="shrink-0 px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · AUDIENCE Q&A" number="QA" />
        <div className="flex items-center gap-7">
          <FrameCounter index={Math.min(999, totalQuestions)} />
          <Clock />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3 shrink-0" />

      <section className="relative flex-1 min-h-0 px-10 py-7 max-w-[1800px] w-full mx-auto flex flex-col">
        {showFullscreenHighlight && highlighted ? (
          <HighlightedQuestion
            question={highlighted}
            labels={labelNames}
            statusCopy={statusCopy}
            ticker={settings.showTicker}
          />
        ) : board.length > 0 ? (
          <QuestionBoard
            title={state?.title ?? 'Audience Q&A'}
            description={state?.description ?? null}
            questions={board}
            labels={labelNames}
            participantCount={state?.participantCount ?? 0}
            questionCount={totalQuestions}
            ticker={settings.showTicker}
            activeLabel={
              settings.labelFilter ? (labelNames.get(settings.labelFilter) ?? null) : null
            }
          />
        ) : (
          <CollectingLobby
            title={state?.title ?? 'Audience Q&A'}
            description={state?.description ?? null}
            pin={pin}
            joinUrl={joinUrl}
            joinHost={joinHost}
            participantCount={state?.participantCount ?? 0}
            questionCount={totalQuestions}
            statusCopy={statusCopy}
            ended={status === 'ENDED'}
          />
        )}
      </section>

      <footer className="shrink-0 px-8 pb-5 flex items-center justify-between gap-6 ticker text-[11px] tracking-widest opacity-75">
        <span>{statusCopy}</span>
        <span>JOIN · {joinHost ? `${joinHost}/join` : joinUrl || 'STANDBY'}</span>
      </footer>
    </main>
  );
}

function displayAttachError(error: string) {
  switch (error) {
    case 'not_found':
      return "That Q&A session isn't on air.";
    case 'invalid_pin':
      return 'Invalid Q&A PIN.';
    default:
      return 'Display could not attach.';
  }
}

function CollectingLobby({
  title,
  description,
  pin,
  joinUrl,
  joinHost,
  participantCount,
  questionCount,
  statusCopy,
  ended,
}: {
  title: string;
  description: string | null;
  pin: string;
  joinUrl: string;
  joinHost: string;
  participantCount: number;
  questionCount: number;
  statusCopy: string;
  ended: boolean;
}) {
  return (
    <div className="grid flex-1 min-h-0 grid-rows-[auto_1fr_auto]">
      <div className="flex items-start justify-between gap-8">
        <div>
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            {ended ? 'FINAL TRANSMISSION' : 'STAND BY · COLLECTING QUESTIONS'}
          </p>
          <h1
            className="font-editorial leading-none"
            style={{ fontSize: 'clamp(52px, 7vw, 118px)' }}
          >
            {title}
          </h1>
          {description && (
            <p className="font-editorial italic text-3xl mt-4 opacity-75">{description}</p>
          )}
        </div>
        <div className="ink-border p-4 shrink-0" style={{ background: 'var(--bone)' }}>
          {joinUrl ? (
            <QRCodeSVG
              value={joinUrl}
              size={180}
              bgColor="transparent"
              fgColor="var(--ink)"
              level="M"
            />
          ) : (
            <div style={{ width: 180, height: 180 }} aria-hidden />
          )}
        </div>
      </div>

      <div className="grid place-items-center text-center">
        <div>
          <p className="ticker text-[14px] tracking-widest opacity-70">GAME PIN · JOIN AT</p>
          <p
            className="display-num ticker mt-4 tabular-nums"
            style={{
              fontSize: 'clamp(150px, 23vw, 350px)',
              lineHeight: 0.82,
              letterSpacing: '0.06em',
            }}
          >
            {pin || '······'}
          </p>
          <p className="font-editorial italic text-3xl mt-6">
            join at <span className="not-italic">{joinHost || 'primetime.local'}/join</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <DisplayStat label="AUDIENCE" value={participantCount} />
        <DisplayStat label="LIVE QUESTIONS" value={questionCount} />
        <DisplayStat label="STATUS" text={statusCopy} />
      </div>
    </div>
  );
}

function QuestionBoard({
  title,
  description,
  questions,
  labels,
  participantCount,
  questionCount,
  ticker,
  activeLabel,
}: {
  title: string;
  description: string | null;
  questions: QAPublicQuestion[];
  labels: Map<string, string>;
  participantCount: number;
  questionCount: number;
  ticker: boolean;
  activeLabel: string | null;
}) {
  // Scale type with board density so cards never paint over each other:
  // fewer questions get poster type, a full board drops to one clamped line.
  // Short screens (e.g. 720p projectors) shift one density tier down.
  const [shortScreen, setShortScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-height: 899px)');
    const update = () => setShortScreen(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Vermilion pill is reserved for the current top score so the board reads
  // as a ranking at a glance; with no votes yet, every pill stays neutral.
  const topScore = Math.max(...questions.map((question) => question.score));

  const density = questions.length + (shortScreen ? 2 : 0);
  const dense = density >= 5;
  const clampLines = density <= 3 ? 'line-clamp-2' : 'line-clamp-1';
  const questionFontSize =
    density <= 2
      ? 'clamp(36px, 4.5vw, 76px)'
      : density <= 4
        ? 'clamp(24px, 2.4vw, 46px)'
        : 'clamp(18px, 1.7vw, 32px)';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="shrink-0 flex items-end justify-between gap-8">
        <div>
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            QUESTION BOARD · LIVE WIRE
          </p>
          <h1
            className="font-editorial leading-none"
            style={{ fontSize: 'clamp(44px, 5vw, 86px)' }}
          >
            {title}
          </h1>
          {description && (
            <p className="font-editorial italic text-2xl mt-2 opacity-70">{description}</p>
          )}
        </div>
        <div className="text-right ticker text-[12px] tracking-widest opacity-75">
          <p>
            {String(participantCount).padStart(2, '0')} AUDIENCE ·{' '}
            {String(questionCount).padStart(2, '0')} QUESTIONS
          </p>
          {activeLabel && <p>FILTER · {activeLabel.toUpperCase()}</p>}
        </div>
      </div>

      <div
        className="mt-7 grid flex-1 min-h-0 overflow-hidden grid-cols-12 gap-4"
        style={{ gridAutoRows: 'minmax(min-content, 1fr)' }}
      >
        {questions.map((question, index) => (
          <article
            key={question.id}
            className={`col-span-12 overflow-hidden ink-border flex flex-col ${
              dense
                ? 'p-4 justify-center gap-2'
                : density <= 2
                  ? 'p-5 justify-between'
                  : 'p-4 justify-between'
            }`}
            style={{
              background: question.highlighted ? 'var(--ink)' : 'var(--bone)',
              color: question.highlighted ? 'var(--bone)' : 'var(--ink)',
            }}
          >
            <div className="shrink-0 flex items-center justify-between gap-6">
              <div className="flex items-baseline gap-4 min-w-0">
                <span className="ticker text-[13px] tracking-widest opacity-70">
                  #{String(index + 1).padStart(2, '0')}
                </span>
                {dense && (
                  <QuestionMeta
                    question={question}
                    labels={labels}
                    inverted={question.highlighted}
                    compact
                  />
                )}
              </div>
              <ScorePill
                question={question}
                inverted={question.highlighted}
                small={dense}
                numberOnly
                accent={question.score === topScore && topScore > 0}
              />
            </div>
            <p
              className={`font-editorial leading-tight shrink-0 ${dense ? '' : 'mt-2'} ${clampLines}`}
              style={{ fontSize: questionFontSize }}
            >
              {question.text}
            </p>
            {!dense && (
              <QuestionMeta
                question={question}
                labels={labels}
                inverted={question.highlighted}
                tight={density > 2}
              />
            )}
          </article>
        ))}
      </div>

      {ticker && (
        <div className="shrink-0 mt-5 ticker text-[12px] tracking-widest opacity-75 overflow-hidden whitespace-nowrap">
          {questions.map((question) => question.text).join('  ·  ')}
        </div>
      )}
    </div>
  );
}

function HighlightedQuestion({
  question,
  labels,
  statusCopy,
  ticker,
}: {
  question: QAPublicQuestion;
  labels: Map<string, string>;
  statusCopy: string;
  ticker: boolean;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col justify-between text-center">
      <div className="shrink-0 flex items-center justify-between ticker text-[13px] tracking-widest opacity-75">
        <span>ON AIR · CURRENT QUESTION</span>
        <span>{statusCopy}</span>
      </div>
      <div className="grid flex-1 min-h-0 place-items-center px-8">
        <div className="max-w-[1400px]">
          <ScorePill question={question} large />
          <h1
            className="font-editorial leading-[0.98] mt-8"
            style={{ fontSize: 'clamp(70px, 9vw, 170px)' }}
          >
            {question.text}
          </h1>
          <div className="mt-8 flex justify-center">
            <QuestionMeta question={question} labels={labels} centered />
          </div>
        </div>
      </div>
      {ticker && (
        <div className="shrink-0 ticker text-[12px] tracking-widest opacity-70">
          ANSWERING NOW · {question.authorDisplayName ?? 'ANONYMOUS'} · {question.upvotes} UPVOTES
        </div>
      )}
    </div>
  );
}

function ScorePill({
  question,
  inverted = false,
  large = false,
  small = false,
  numberOnly = false,
  accent = true,
}: {
  question: QAPublicQuestion;
  inverted?: boolean;
  large?: boolean;
  small?: boolean;
  numberOnly?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-3 ink-border ticker tracking-widest"
      style={{
        background: accent ? (inverted ? 'var(--bone)' : 'var(--vermilion)') : 'transparent',
        color: accent ? (inverted ? 'var(--ink)' : 'var(--bone)') : 'inherit',
        borderColor: !accent && inverted ? 'var(--bone)' : undefined,
        padding: large ? '12px 18px' : small ? '4px 10px' : '8px 12px',
        fontSize: large ? 15 : small ? 11 : 12,
      }}
    >
      {!numberOnly && <span>SCORE</span>}
      <span className="tabular-nums">
        {question.score >= 0 ? `+${question.score}` : question.score}
      </span>
    </div>
  );
}

function QuestionMeta({
  question,
  labels,
  inverted = false,
  centered = false,
  compact = false,
  tight = false,
}: {
  question: QAPublicQuestion;
  labels: Map<string, string>;
  inverted?: boolean;
  centered?: boolean;
  compact?: boolean;
  tight?: boolean;
}) {
  const visibleLabels = question.labelIds
    .map((labelId) => labels.get(labelId))
    .filter((label): label is string => Boolean(label));
  return (
    <div
      className={`${compact ? 'min-w-0' : tight ? 'mt-2' : 'mt-5'} shrink-0 flex flex-wrap gap-2 ${centered ? 'justify-center' : 'items-center'}`}
    >
      <span className="ticker text-[12px] tracking-widest opacity-70">
        {question.authorDisplayName ?? 'ANONYMOUS'} · {question.upvotes} UP
        {question.downvotes > 0 ? ` · ${question.downvotes} DOWN` : ''}
      </span>
      {visibleLabels.map((label) => (
        <span
          key={label}
          className="ink-border ticker text-[10px] tracking-widest px-2 py-1"
          style={{
            background: inverted ? 'var(--bone)' : 'transparent',
            color: inverted ? 'var(--ink)' : undefined,
          }}
        >
          {label.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function DisplayStat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="ink-border p-4" style={{ background: 'var(--bone)' }}>
      <p className="chyron opacity-70">{label}</p>
      <p className="ticker mt-2 text-3xl tracking-widest tabular-nums">
        {text ?? String(value ?? 0).padStart(2, '0')}
      </p>
    </div>
  );
}
