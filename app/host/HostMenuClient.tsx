'use client';

import Link from 'next/link';
import { useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { publicUrl } from '@/lib/public-origin';
import type { QASessionSummary } from '@/lib/qa-repo';
import type { QuizSummary } from '@/lib/types';
import type { WonderWallSessionSummary } from '@/lib/wonderwall-repo';

export default function HostMenuClient({
  initialQuizzes,
  initialRooms,
  initialQaRooms,
}: {
  initialQuizzes: QuizSummary[];
  initialRooms: WonderWallSessionSummary[];
  initialQaRooms: QASessionSummary[];
}) {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>(initialQuizzes);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);
  const [copiedPin, setCopiedPin] = useState<string | null>(null);

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · ACTIVITIES" number="00" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-8 pt-8 max-w-[1400px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          QUICK ACTIVITIES · STANDALONE
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            href="/host/wordcloud/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                WORD CLOUD · LIVE PROMPT
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Run a Word Cloud.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Take the room's temperature. Players type a word, the display piles them up by
              frequency.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>

          <Link
            href="/host/q-and-a/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                Q&A · OPEN FLOOR
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Run an Audience Q&A.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Collect questions from the room, let upvotes pick the order, answer the best ones on
              air.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>

          <Link
            href="/host/quiz/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                QUIZ · CUE SHEET
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Build a Quiz.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Pick a topic, write the cues, run the room. Multiple choice and true/false,
              server-scored, projector-ready.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>

          <Link
            href="/host/wonderwall/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                WONDERWALL · LINKEDIN POSTS
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Run a WonderWall.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Turn the room into a feed. Players draft LinkedIn-style posts, you review the queue,
              the best ones go up on the wall.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>
        </div>
      </section>

      <section className="px-8 pt-10 max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
              WONDERWALL ROOMS · REUSABLE
            </p>
            <h2
              className="font-editorial leading-none"
              style={{ fontSize: 'clamp(30px, 4vw, 52px)' }}
            >
              Reopen a room, reshare its link.
            </h2>
          </div>
          <Link
            href="/host/wonderwall/new"
            className="hidden sm:inline-flex ink-border ticker text-[11px] tracking-widest px-4 py-3"
            style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          >
            + NEW ROOM
          </Link>
        </div>

        <div className="ink-border" style={{ background: 'var(--bone)' }}>
          <div
            className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_140px_150px_300px] gap-3 px-4 py-2 border-b-2 ticker text-[10px] tracking-widest opacity-70"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span>ROOM</span>
            <span className="hidden md:block">PIN</span>
            <span className="hidden md:block">ON AIR / SUB</span>
            <span className="hidden md:block">UPDATED</span>
            <span>ACTIONS</span>
          </div>

          {initialRooms.length === 0 && (
            <div className="p-5">
              <p className="font-editorial italic text-lg">No WonderWall rooms yet</p>
              <p className="ticker text-[11px] tracking-widest opacity-70 mt-2">
                RUN A WONDERWALL ABOVE — IT APPEARS HERE, AND ITS LINK STAYS LIVE FOR LATER
                MEETINGS.
              </p>
            </div>
          )}

          {initialRooms.map((room) => (
            <div
              key={room.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_140px_150px_300px] gap-3 px-4 py-3 border-b-2 last:border-b-0 items-center"
              style={{ borderColor: 'var(--ink)' }}
            >
              <div className="min-w-0">
                <p className="font-editorial text-xl leading-tight truncate">{room.title}</p>
                <p className="md:hidden ticker text-[10px] tracking-widest opacity-70 mt-1">
                  PIN {room.pin} · {room.approvedCount}/{room.submissionCount} ON AIR ·{' '}
                  {formatUpdated(room.updatedAt)}
                </p>
              </div>
              <span className="hidden md:block display-num text-lg tabular-nums">{room.pin}</span>
              <span className="hidden md:block ticker text-[12px] tracking-widest opacity-70">
                {String(room.approvedCount).padStart(2, '0')} /{' '}
                {String(room.submissionCount).padStart(2, '0')}
              </span>
              <span className="hidden md:block ticker text-[12px] tracking-widest opacity-70">
                {formatUpdated(room.updatedAt)}
              </span>
              <div className="flex items-center justify-end gap-2">
                <Link
                  href={`/host/wonderwall/${room.pin}/control`}
                  className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                  style={{ background: 'var(--ink)', color: 'var(--bone)' }}
                >
                  CONTROL
                </Link>
                <Link
                  href={`/host/wonderwall/${room.pin}/display`}
                  className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                  style={{ background: 'var(--bone)', color: 'var(--ink)' }}
                >
                  DISPLAY
                </Link>
                <button
                  type="button"
                  onClick={() => copyJoinLink(room.pin)}
                  className="ticker text-[11px] tracking-widest px-3 py-2"
                  style={{
                    background: 'transparent',
                    border: '2px solid var(--vermilion)',
                    color: 'var(--vermilion)',
                  }}
                >
                  {copiedPin === room.pin ? 'COPIED' : 'COPY LINK'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-8 pt-10 max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
              Q&amp;A ROOMS · REUSABLE
            </p>
            <h2
              className="font-editorial leading-none"
              style={{ fontSize: 'clamp(30px, 4vw, 52px)' }}
            >
              Prepare ahead, reopen on the day.
            </h2>
          </div>
          <Link
            href="/host/q-and-a/new"
            className="hidden sm:inline-flex ink-border ticker text-[11px] tracking-widest px-4 py-3"
            style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          >
            + NEW ROOM
          </Link>
        </div>

        <div className="ink-border" style={{ background: 'var(--bone)' }}>
          <div
            className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_120px_120px_150px_300px] gap-3 px-4 py-2 border-b-2 ticker text-[10px] tracking-widest opacity-70"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span>ROOM</span>
            <span className="hidden md:block">PIN</span>
            <span className="hidden md:block">STATUS</span>
            <span className="hidden md:block">QUESTIONS</span>
            <span className="hidden md:block">UPDATED</span>
            <span>ACTIONS</span>
          </div>

          {initialQaRooms.length === 0 && (
            <div className="p-5">
              <p className="font-editorial italic text-lg">No Q&amp;A rooms yet</p>
              <p className="ticker text-[11px] tracking-widest opacity-70 mt-2">
                CREATE A Q&amp;A ABOVE — IT APPEARS HERE, READY TO REOPEN WHEN YOUR EVENT STARTS.
              </p>
            </div>
          )}

          {initialQaRooms.map((room) => (
            <div
              key={room.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_120px_120px_150px_300px] gap-3 px-4 py-3 border-b-2 last:border-b-0 items-center"
              style={{ borderColor: 'var(--ink)' }}
            >
              <div className="min-w-0">
                <p className="font-editorial text-xl leading-tight truncate">{room.title}</p>
                <p className="md:hidden ticker text-[10px] tracking-widest opacity-70 mt-1">
                  PIN {room.pin} · {room.status} · {room.questionCount} Q ·{' '}
                  {formatUpdated(room.updatedAt)}
                </p>
              </div>
              <span className="hidden md:block display-num text-lg tabular-nums">{room.pin}</span>
              <span className="hidden md:block ticker text-[11px] tracking-widest opacity-70">
                {room.status}
              </span>
              <span className="hidden md:block ticker text-[12px] tracking-widest opacity-70">
                {String(room.questionCount).padStart(2, '0')}
              </span>
              <span className="hidden md:block ticker text-[12px] tracking-widest opacity-70">
                {formatUpdated(room.updatedAt)}
              </span>
              <div className="flex items-center justify-end gap-2">
                <Link
                  href={`/host/q-and-a/${room.pin}/control`}
                  className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                  style={{ background: 'var(--ink)', color: 'var(--bone)' }}
                >
                  CONTROL
                </Link>
                <Link
                  href={`/host/q-and-a/${room.pin}/display`}
                  className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                  style={{ background: 'var(--bone)', color: 'var(--ink)' }}
                >
                  DISPLAY
                </Link>
                <button
                  type="button"
                  onClick={() => copyJoinLink(room.pin)}
                  className="ticker text-[11px] tracking-widest px-3 py-2"
                  style={{
                    background: 'transparent',
                    border: '2px solid var(--vermilion)',
                    color: 'var(--vermilion)',
                  }}
                >
                  {copiedPin === room.pin ? 'COPIED' : 'COPY LINK'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-8 pt-10 max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
              SAVED QUIZZES · CUE SHEETS
            </p>
            <h2
              className="font-editorial leading-none"
              style={{ fontSize: 'clamp(30px, 4vw, 52px)' }}
            >
              Pick up where you left off.
            </h2>
          </div>
          <Link
            href="/host/quiz/new"
            className="hidden sm:inline-flex ink-border ticker text-[11px] tracking-widest px-4 py-3"
            style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          >
            + NEW QUIZ
          </Link>
        </div>

        <div className="ink-border" style={{ background: 'var(--bone)' }}>
          <div
            className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_190px_240px] gap-3 px-4 py-2 border-b-2 ticker text-[10px] tracking-widest opacity-70"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span>TITLE</span>
            <span className="hidden md:block">QUESTIONS</span>
            <span className="hidden md:block">UPDATED</span>
            <span>ACTIONS</span>
          </div>

          {deleteError && (
            <p
              className="p-4 border-b-2 ticker text-[12px] tracking-widest"
              style={{ borderColor: 'var(--ink)', color: 'var(--vermilion)' }}
            >
              {deleteError}
            </p>
          )}

          {quizzes.length === 0 && (
            <div className="p-5">
              <p className="font-editorial italic text-lg">No saved quizzes yet</p>
              <p className="ticker text-[11px] tracking-widest opacity-70 mt-2">
                BUILD A QUIZ, HIT SAVE, AND IT WILL APPEAR HERE.
              </p>
            </div>
          )}

          {quizzes.map((quiz) => (
            <div
              key={quiz.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_190px_240px] gap-3 px-4 py-3 border-b-2 last:border-b-0 items-center"
              style={{ borderColor: 'var(--ink)' }}
            >
              <div className="min-w-0">
                <p className="font-editorial text-xl leading-tight truncate">{quiz.title}</p>
                <p className="md:hidden ticker text-[10px] tracking-widest opacity-70 mt-1">
                  {quiz.questionCount} Q · {formatUpdated(quiz.updatedAt)}
                </p>
              </div>
              <span className="hidden md:block ticker text-[12px] tracking-widest">
                {String(quiz.questionCount).padStart(2, '0')}
              </span>
              <span className="hidden md:block ticker text-[12px] tracking-widest opacity-70">
                {formatUpdated(quiz.updatedAt)}
              </span>
              <div className="flex items-center justify-end gap-2">
                <Link
                  href={`/host/quiz/new?quiz=${quiz.id}`}
                  className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                  style={{ background: 'var(--ink)', color: 'var(--bone)' }}
                >
                  EDIT
                </Link>
                <button
                  type="button"
                  onClick={() => deleteQuiz(quiz)}
                  disabled={deletingQuizId === quiz.id}
                  className="ticker text-[11px] tracking-widest px-3 py-2 disabled:opacity-50"
                  style={{
                    background: 'transparent',
                    border: '2px solid var(--vermilion)',
                    color: 'var(--vermilion)',
                  }}
                >
                  {deletingQuizId === quiz.id ? 'DELETING' : 'DELETE'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );

  async function deleteQuiz(quiz: QuizSummary) {
    const ok = window.confirm(`Delete "${quiz.title}"? This cannot be undone.`);
    if (!ok) return;
    setDeletingQuizId(quiz.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/quiz/${quiz.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? res.statusText);
      }
      setQuizzes((list) => list.filter((item) => item.id !== quiz.id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete quiz');
    } finally {
      setDeletingQuizId(null);
    }
  }

  // Copy the room's persistent join link (the PIN never changes), so the host can
  // reshare the same URL for the next meeting. Uses publicUrl() so it prefers the
  // configured live/tunnel origin (NEXT_PUBLIC_SITE_URL) when set.
  async function copyJoinLink(pin: string) {
    const origin = typeof window === 'undefined' ? null : window.location.origin;
    const url = publicUrl(`/join?pin=${pin}`, origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPin(pin);
      window.setTimeout(() => setCopiedPin((current) => (current === pin ? null : current)), 1500);
    } catch {
      // Clipboard can be blocked (permissions/insecure context); fail silently.
    }
  }
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'UNKNOWN';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .toUpperCase();
}
