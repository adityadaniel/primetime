'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { CHANNELS, Shape } from '@/components/Shape';
import { useSocket } from '@/lib/socket';
import type { AnswerIndex, Question, Quiz } from '@/lib/types';

type Draft = Quiz & { questions: Question[] };

const TIME_LIMITS = [10, 20, 30, 60];
const DEFAULT_TIME_LIMIT = 10;

function q() {
  return `q_${Math.random().toString(36).slice(2, 9)}`;
}

const STARTER: Draft = {
  title: 'QUIZ #001 — STUDIO PILOT',
  questions: [
    {
      id: q(),
      type: 'multiple',
      text: 'Which of these is broadcast in NTSC at 29.97 frames per second?',
      options: [
        'A 35mm film print',
        'A US color TV broadcast',
        'A PAL video signal',
        'A web-native MP4',
      ],
      correct: 1,
      timeLimit: DEFAULT_TIME_LIMIT,
      doublePoints: false,
    },
    {
      id: q(),
      type: 'truefalse',
      text: 'The first commercial color TV broadcast was in 1965.',
      options: ['TRUE', 'FALSE'],
      correct: 1,
      timeLimit: DEFAULT_TIME_LIMIT,
      doublePoints: false,
    },
    {
      id: q(),
      type: 'multiple',
      text: "Which channel is the diamond, in this network's signal kit?",
      options: ['CH.01', 'CH.02', 'CH.03', 'CH.04'],
      correct: 1,
      timeLimit: DEFAULT_TIME_LIMIT,
      doublePoints: true,
    },
  ],
};

export default function QuizNew() {
  const router = useRouter();
  const socket = useSocket();
  const [draft, setDraft] = useState<Draft>(STARTER);
  const [activeIdx, setActiveIdx] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const quizId = params.get('quiz');
    if (!quizId) return;
    fetch(`/api/quiz/${quizId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setDraft({
          title: data.title,
          questions: data.questions.map(
            (qq: {
              type: 'multiple' | 'truefalse';
              text: string;
              options: string[];
              correct: AnswerIndex;
              timeLimit: number;
              doublePoints: boolean;
              imageUrl?: string | null;
            }) => ({
              id: q(),
              type: qq.type,
              text: qq.text,
              options: qq.options,
              correct: qq.correct,
              timeLimit: qq.timeLimit,
              doublePoints: qq.doublePoints,
              imageUrl: qq.imageUrl ?? undefined,
            }),
          ),
        });
        setSavedId(quizId);
      });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on active-question change to clear any stale upload error.
  useEffect(() => {
    setUploadError(null);
  }, [activeIdx]);

  const active = draft.questions[activeIdx];
  const totalSeconds = useMemo(
    () => draft.questions.reduce((s, x) => s + x.timeLimit, 0),
    [draft.questions],
  );

  function patch<K extends keyof Question>(k: K, v: Question[K]) {
    setDraft((d) => {
      const qs = [...d.questions];
      qs[activeIdx] = { ...qs[activeIdx], [k]: v };
      return { ...d, questions: qs };
    });
  }

  function addQuestion(type: 'multiple' | 'truefalse' = 'multiple') {
    setDraft((d) => {
      const newQ: Question = {
        id: q(),
        type,
        text: '',
        options: type === 'truefalse' ? ['TRUE', 'FALSE'] : ['', '', '', ''],
        correct: 0,
        timeLimit: DEFAULT_TIME_LIMIT,
        doublePoints: false,
      };
      return { ...d, questions: [...d.questions, newQ] };
    });
    setActiveIdx(draft.questions.length);
  }

  function removeQuestion(i: number) {
    setDraft((d) => {
      if (d.questions.length <= 1) return d;
      const qs = d.questions.filter((_, idx) => idx !== i);
      return { ...d, questions: qs };
    });
    setActiveIdx((idx) => Math.max(0, Math.min(idx, draft.questions.length - 2)));
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    setDraft((d) => {
      if (from < 0 || from >= d.questions.length) return d;
      if (to < 0 || to >= d.questions.length) return d;
      const qs = [...d.questions];
      const [moved] = qs.splice(from, 1);
      qs.splice(to, 0, moved);
      return { ...d, questions: qs };
    });
    setActiveIdx((idx) => {
      if (idx === from) return to;
      if (from < idx && to >= idx) return idx - 1;
      if (from > idx && to <= idx) return idx + 1;
      return idx;
    });
  }

  function changeType(t: 'multiple' | 'truefalse') {
    if (t === active.type) return;
    setDraft((d) => {
      const qs = [...d.questions];
      qs[activeIdx] = {
        ...qs[activeIdx],
        type: t,
        options: t === 'truefalse' ? ['TRUE', 'FALSE'] : ['', '', '', ''],
        correct: 0,
      };
      return { ...d, questions: qs };
    });
  }

  function validate(): string | null {
    if (!draft.title.trim()) return 'Title required';
    for (const [i, qq] of draft.questions.entries()) {
      if (!qq.text.trim()) return `Question ${i + 1}: missing text`;
      if (qq.options.some((o) => !o.trim())) return `Question ${i + 1}: empty option`;
    }
    return null;
  }

  function launch() {
    const err = validate();
    if (err) {
      alert(err);
      return;
    }
    if (!socket) return;
    setLaunching(true);
    socket.emit('host:create', draft, (res: { pin: string }) => {
      window.open(`/host/${res.pin}/display`, '_blank', 'noopener');
      router.push(`/host/${res.pin}/control`);
    });
  }

  async function save() {
    const err = validate();
    if (err) {
      alert(err);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: draft.title,
        questions: draft.questions.map((qq) => ({
          type: qq.type,
          text: qq.text,
          options: qq.options,
          correct: qq.correct,
          timeLimit: qq.timeLimit,
          doublePoints: qq.doublePoints,
          imageUrl: qq.imageUrl,
        })),
      };
      const url = savedId ? `/api/quiz/${savedId}` : `/api/quiz`;
      const method = savedId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(`Save failed: ${e.error ?? res.statusText}`);
        return;
      }
      const { id } = await res.json();
      const wasNew = !savedId;
      setSavedId(id);
      if (wasNew) {
        const next = new URL(window.location.href);
        next.searchParams.set('quiz', id);
        window.history.replaceState({}, '', next.toString());
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/quiz/import', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Import failed: ${err.error ?? res.statusText}`);
      return;
    }
    const { id } = await res.json();
    window.location.href = `/host/quiz/new?quiz=${id}`;
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('subdir', 'quiz-images');
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setUploadError(err.error ?? res.statusText);
        return;
      }
      const { url } = await res.json();
      patch('imageUrl', url);
    } catch {
      setUploadError('Upload failed — check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    setUploadError(null);
    patch('imageUrl', undefined);
  }

  return (
    <main className="relative min-h-screen pb-24">
      <CornerMarks />
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="BUILDER · CUE SHEET" number="01" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <OnAir live={false} />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-8 pt-8 max-w-[1400px] mx-auto space-y-6">
        <div>
          <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
            CUE SHEET / WORKING DRAFT
          </p>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="display-num bg-transparent outline-none border-b-2 pb-1 w-full"
            style={{ borderColor: 'var(--ink)', fontSize: 'clamp(40px, 6vw, 84px)' }}
          />
        </div>
        <div
          className="ink-border p-4 flex items-center justify-between gap-6 flex-wrap"
          style={{ background: 'var(--bone)' }}
        >
          <div className="flex items-center gap-6">
            <Stat label="QUESTIONS" value={String(draft.questions.length).padStart(2, '0')} />
            <Stat label="RUNTIME" value={`${totalSeconds}s`} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ink-border stamp px-6 py-3 ticker tracking-widest text-[12px]"
              style={{ background: 'var(--ink)', color: 'var(--bone)' }}
            >
              {saving ? 'SAVING…' : savedFlash ? 'SAVED ✓' : 'SAVE'}
            </button>
            {savedId && (
              <a
                href={`/api/quiz/${savedId}/export`}
                download
                className="ink-border stamp px-6 py-3 ticker tracking-widest text-[12px]"
                style={{ background: 'var(--bone)', color: 'var(--ink)' }}
              >
                EXPORT
              </a>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="ink-border stamp px-6 py-3 ticker tracking-widest text-[12px]"
              style={{ background: 'var(--bone)', color: 'var(--ink)' }}
            >
              IMPORT
            </button>
            <button
              type="button"
              onClick={launch}
              disabled={launching}
              className="ink-border stamp px-6 py-3 ticker tracking-widest text-[12px]"
              style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
            >
              {launching ? 'ON AIR…' : '▶  GO LIVE'}
            </button>
          </div>
        </div>
      </section>

      <section className="px-8 mt-10 max-w-[1400px] mx-auto grid grid-cols-12 gap-6">
        <aside
          className="col-span-12 lg:col-span-4 ink-border"
          style={{ background: 'var(--bone)' }}
        >
          <div
            className="px-4 py-2 flex items-center justify-between border-b-2"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span className="chyron">RUN ORDER</span>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              {String(activeIdx + 1).padStart(2, '0')} /{' '}
              {String(draft.questions.length).padStart(2, '0')}
            </span>
          </div>
          <ol className="divide-y-2" style={{ borderColor: 'var(--ink)' }}>
            {draft.questions.map((qq, i) => {
              const isDragging = dragIdx === i;
              const isDragOver = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
              return (
                <li
                  key={qq.id}
                  className="flex items-stretch gap-2 px-2 py-2"
                  style={{
                    background: isDragOver ? 'var(--marigold)' : undefined,
                    opacity: isDragging ? 0.4 : 1,
                  }}
                  onDragOver={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverIdx !== i) setDragOverIdx(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx === null) return;
                    reorder(dragIdx, i);
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                >
                  <button
                    type="button"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    className="shrink-0 grid place-items-center w-6 ticker text-[12px] tracking-widest cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100"
                    style={{ touchAction: 'none' }}
                  >
                    ⋮⋮
                  </button>
                  <button
                    type="button"
                    className={`flex-1 min-w-0 text-left flex gap-3 items-start px-3 py-2 ${
                      i === activeIdx ? '' : 'hover:opacity-90'
                    }`}
                    style={{
                      background: i === activeIdx ? 'var(--ink)' : 'transparent',
                      color: i === activeIdx ? 'var(--bone)' : 'var(--ink)',
                    }}
                    onClick={() => setActiveIdx(i)}
                  >
                    <span className="display-num text-3xl" style={{ minWidth: 36 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-editorial text-[15px] leading-snug break-words"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {qq.text || <span className="opacity-50 italic">untitled cue</span>}
                      </p>
                      <p className="ticker text-[10px] tracking-widest mt-1 opacity-70">
                        {qq.type === 'truefalse' ? 'T/F' : 'MC'} · {qq.timeLimit}s
                        {qq.doublePoints ? ' · 2× PTS' : ''}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="p-3 flex gap-2 border-t-2" style={{ borderColor: 'var(--ink)' }}>
            <button
              type="button"
              onClick={() => addQuestion('multiple')}
              className="flex-1 ink-border py-2 ticker text-[11px] tracking-widest"
            >
              + MULTIPLE
            </button>
            <button
              type="button"
              onClick={() => addQuestion('truefalse')}
              className="flex-1 ink-border py-2 ticker text-[11px] tracking-widest"
            >
              + T/F
            </button>
          </div>
        </aside>

        <article
          className="col-span-12 lg:col-span-8 ink-border p-6 lg:p-8 relative"
          style={{ background: 'var(--bone)' }}
        >
          <div
            className="absolute -top-3 left-6 px-2 py-[2px] ticker text-[11px] tracking-widest"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            CUE {String(activeIdx + 1).padStart(2, '0')}
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="chyron">QUESTION TEXT · ≤120 CHARS</span>
            <button
              type="button"
              onClick={() => removeQuestion(activeIdx)}
              className="ticker text-[11px] tracking-widest"
              style={{ color: 'var(--vermilion)' }}
              disabled={draft.questions.length <= 1}
            >
              DELETE CUE ✕
            </button>
          </div>
          <textarea
            value={active.text}
            maxLength={120}
            onChange={(e) => patch('text', e.target.value)}
            rows={2}
            placeholder="What's the question?"
            className="w-full font-editorial text-2xl md:text-3xl bg-transparent outline-none border-b-2 pb-2"
            style={{ borderColor: 'var(--ink)' }}
          />
          <div className="ticker text-[11px] tracking-widest mt-1 opacity-60">
            {active.text.length}/120
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <span className="chyron">VISUAL · OPTIONAL STILL</span>
              <div className="flex items-center gap-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploading}
                  className="ink-border ticker text-[11px] tracking-widest px-3 h-9"
                  style={{ background: 'var(--bone)', color: 'var(--ink)' }}
                >
                  {uploading ? 'UPLOADING…' : active.imageUrl ? 'REPLACE' : '+ ADD STILL'}
                </button>
                {active.imageUrl && (
                  <button
                    type="button"
                    onClick={removeImage}
                    disabled={uploading}
                    className="ticker text-[11px] tracking-widest"
                    style={{ color: 'var(--vermilion)' }}
                  >
                    REMOVE ✕
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <p
                className="ticker text-[11px] tracking-widest mb-3"
                style={{ color: 'var(--vermilion)' }}
              >
                {uploadError}
              </p>
            )}
            {active.imageUrl ? (
              <div className="ink-border overflow-hidden" style={{ background: 'var(--ink)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={active.imageUrl}
                  alt="Question still"
                  className="w-full max-h-72 object-contain mx-auto"
                />
              </div>
            ) : (
              <div
                className="ink-border grid place-items-center py-8 font-editorial italic opacity-50"
                style={{ background: 'var(--bone)' }}
              >
                No still cued — text-only question.
              </div>
            )}
          </div>

          <div className="mt-8 grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-5">
              <span className="chyron">TYPE</span>
              <div className="flex mt-2 ink-border h-10">
                {(['multiple', 'truefalse'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => changeType(t)}
                    className="flex-1 ticker text-[11px] tracking-widest border-r-2 last:border-r-0"
                    style={{
                      background: active.type === t ? 'var(--ink)' : 'transparent',
                      color: active.type === t ? 'var(--bone)' : 'var(--ink)',
                      borderColor: 'var(--ink)',
                    }}
                  >
                    {t === 'multiple' ? 'MULTIPLE CHOICE' : 'TRUE / FALSE'}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-12 md:col-span-7">
              <span className="chyron">TIME LIMIT</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {TIME_LIMITS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => patch('timeLimit', s)}
                    className="ink-border ticker text-[11px] tracking-widest px-3 h-10"
                    style={{
                      background: active.timeLimit === s ? 'var(--ink)' : 'transparent',
                      color: active.timeLimit === s ? 'var(--bone)' : 'var(--ink)',
                    }}
                  >
                    {s}s
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => patch('doublePoints', !active.doublePoints)}
                  className="ink-border ticker text-[11px] tracking-widest px-3 h-10 flex items-center gap-2"
                  style={{
                    background: active.doublePoints ? 'var(--marigold)' : 'transparent',
                    color: 'var(--ink)',
                  }}
                  title="Toggle double points"
                >
                  <span>2×</span>
                  <span className="opacity-70">{active.doublePoints ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <span className="chyron">ANSWER OPTIONS</span>
            <div
              className={`mt-3 grid gap-3 ${
                active.type === 'truefalse'
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2'
              }`}
            >
              {active.options.map((opt, i) => {
                const ch = CHANNELS[i] ?? CHANNELS[0];
                const isCorrect = active.correct === i;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 ink-border"
                    style={{
                      background: isCorrect ? ch.color : 'var(--bone)',
                      color: isCorrect ? 'var(--bone)' : 'var(--ink)',
                    }}
                  >
                    <div
                      className="grid place-items-center w-14 h-14 shrink-0 border-r-2"
                      style={{ borderColor: 'var(--ink)', background: ch.color }}
                    >
                      <Shape kind={ch.key} fill="var(--bone)" stroke="var(--ink)" size={32} />
                    </div>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const opts = [...active.options];
                        opts[i] = e.target.value;
                        patch('options', opts);
                      }}
                      placeholder={`Option ${i + 1}`}
                      readOnly={active.type === 'truefalse'}
                      className="flex-1 min-w-0 bg-transparent outline-none py-3 pr-3 font-editorial text-lg"
                    />
                    <button
                      type="button"
                      onClick={() => patch('correct', i as AnswerIndex)}
                      className="ticker text-[11px] tracking-widest px-3 mr-3 py-1 ink-border shrink-0"
                      style={{
                        background: isCorrect ? 'var(--ink)' : 'transparent',
                        color: isCorrect ? 'var(--bone)' : 'var(--ink)',
                      }}
                    >
                      {isCorrect ? '✓ CORRECT' : 'MARK CORRECT'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      </section>

      <footer
        className="mt-16 px-8 max-w-[1400px] mx-auto flex justify-between items-center border-t-2 pt-4"
        style={{ borderColor: 'var(--ink)' }}
      >
        <Link href="/host" className="ticker text-[11px] tracking-widest">
          ← STUDIO MASTER
        </Link>
        <span className="font-editorial italic opacity-60">Save the cue, then roll tape.</span>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="chyron opacity-70">{label}</span>
      <span className="display-num text-3xl">{value}</span>
    </div>
  );
}
