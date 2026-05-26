'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { type Fixture, fixtures, SURFACES, type Surface } from '@/lib/dev-fixtures';
import { ControlView } from '../../host/[pin]/control/control-views';
import { DisplayView } from '../../host/[pin]/display/display-views';
import { PlayerView } from '../../play/[pin]/player-views';

const DEFAULT_SURFACE: Surface = 'display';

function isSurface(v: string | null): v is Surface {
  return v === 'display' || v === 'control' || v === 'player';
}

export default function FixturesBrowser() {
  const router = useRouter();
  const params = useSearchParams();

  const surface: Surface = useMemo(() => {
    const s = params.get('surface');
    return isSurface(s) ? s : DEFAULT_SURFACE;
  }, [params]);

  const selectedId = params.get('id') ?? fixtures[0]?.id ?? '';
  const selected: Fixture | undefined = fixtures.find((f) => f.id === selectedId) ?? fixtures[0];

  const groups = useMemo(() => {
    const order: Array<Fixture['category']> = ['shared', 'display', 'control', 'player'];
    const map = new Map<Fixture['category'], Fixture[]>();
    for (const c of order) map.set(c, []);
    for (const f of fixtures) {
      const list = map.get(f.category);
      if (list) list.push(f);
    }
    return order.map((c) => ({ category: c, items: map.get(c) ?? [] }));
  }, []);

  function setQuery(next: { id?: string; surface?: Surface }) {
    const sp = new URLSearchParams(params.toString());
    if (next.id !== undefined) sp.set('id', next.id);
    if (next.surface !== undefined) sp.set('surface', next.surface);
    router.replace(`/dev/fixtures?${sp.toString()}`);
  }

  const showPlayer = surface === 'player';
  const showControl = surface === 'control';
  const showDisplay = surface === 'display';

  return (
    <div className="min-h-screen flex" style={{ background: '#fafafa', color: '#111' }}>
      <aside
        className="border-r overflow-y-auto"
        style={{ width: 240, borderColor: '#ddd', background: '#fff' }}
      >
        <div className="px-3 py-3 border-b" style={{ borderColor: '#ddd' }}>
          <p className="text-[11px] uppercase tracking-widest opacity-60">Dev fixtures</p>
          <p className="text-sm font-medium">{fixtures.length} scenarios</p>
        </div>
        {groups.map((g) =>
          g.items.length === 0 ? null : (
            <div key={g.category} className="py-2">
              <p
                className="px-3 py-1 text-[10px] uppercase tracking-widest opacity-50"
                style={{ letterSpacing: '0.1em' }}
              >
                {g.category}
              </p>
              <ul>
                {g.items.map((f) => {
                  const active = selected?.id === f.id;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setQuery({ id: f.id })}
                        className="w-full text-left px-3 py-1.5 text-sm"
                        style={{
                          background: active ? '#111' : 'transparent',
                          color: active ? '#fff' : '#111',
                        }}
                      >
                        {f.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </aside>

      <main className="flex-1 flex flex-col">
        <div
          className="flex items-center gap-3 px-4 py-2 border-b"
          style={{ borderColor: '#ddd', background: '#fff' }}
        >
          <span className="text-[11px] uppercase tracking-widest opacity-60">Surface</span>
          <div
            role="tablist"
            aria-label="Surface"
            className="inline-flex border"
            style={{ borderColor: '#bbb' }}
          >
            {SURFACES.map((s) => {
              const active = surface === s;
              return (
                <button
                  type="button"
                  key={s}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setQuery({ surface: s })}
                  className="px-3 py-1.5 text-xs uppercase tracking-widest"
                  style={{
                    background: active ? '#111' : '#fff',
                    color: active ? '#fff' : '#111',
                    borderRight: s !== 'player' ? '1px solid #bbb' : 'none',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <div className="ml-auto text-xs opacity-60">
            {selected ? `${selected.id} · ${selected.category}` : ''}
          </div>
        </div>

        {selected?.notes && (
          <div
            className="px-4 py-2 text-xs border-b"
            style={{ borderColor: '#ddd', background: '#fff8e1' }}
          >
            <span className="opacity-60 mr-2">notes</span>
            {selected.notes}
          </div>
        )}

        <div className="flex-1 overflow-auto" style={{ background: '#f0f0f0' }}>
          {selected ? (
            <div className="p-4">
              <div
                className="mx-auto bg-white"
                style={{
                  border: '1px solid #ccc',
                  minHeight: 'calc(100vh - 140px)',
                  maxWidth: showPlayer ? 480 : 1600,
                }}
              >
                {showDisplay && (
                  <DisplayView state={selected.state} pin={selected.pin ?? selected.state.pin} />
                )}
                {showControl && (
                  <ControlView state={selected.state} pin={selected.pin ?? selected.state.pin} />
                )}
                {showPlayer && (
                  <PlayerView
                    state={selected.state}
                    personal={selected.personal ?? null}
                    nickname="QA"
                    pin={selected.pin ?? selected.state.pin}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="p-6 text-sm opacity-60">No fixture selected.</p>
          )}
        </div>
      </main>
    </div>
  );
}
