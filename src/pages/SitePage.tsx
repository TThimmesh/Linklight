import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setHover, useSite, type Route } from '../lib/hooks';
import { buildIndex, layoutRack } from '../lib/site';
import { useTheme } from '../lib/theme';
import { useFullscreen } from '../lib/useFullscreen';
import { DEVICE_TYPES, RACK_KINDS, modelLabel, type Device, type Rack } from '../lib/types';
import { RackScene, type CameraApi, type Selection } from '../three/RackScene';
import { AddDeviceDialog, RackDialog } from '../components/dialogs';
import { HoverCard } from '../components/HoverCard';
import { Inspector } from '../components/Inspector';
import { errorText, useApp } from '../components/ui';

type Dialog =
  | { type: 'rack'; rack?: Rack }
  | { type: 'add'; u: number | null; existing?: Device };

export function SitePage({ propertyId, rackId, go }: { propertyId: string; rackId: string | null; go(r: Route, replace?: boolean): void }) {
  const { backend, models, modelsById } = useApp();
  const site = useSite(backend, propertyId);
  const data = site.data?.property.id === propertyId ? site.data : null;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { full, toggle: toggleFull, exit: exitFull } = useFullscreen(stageRef);
  const theme = useTheme();

  const idx = useMemo(() => (data ? buildIndex(data, models) : null), [data, models]);
  const racks = useMemo(() => (data ? [...data.racks].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) : []), [data]);
  const rack = racks.find(r => r.id === rackId) ?? racks[0] ?? null;
  const placements = useMemo(() => (rack && data ? layoutRack(rack, data.devices, modelsById) : []), [rack, data, modelsById]);

  useEffect(() => {
    if (data && rack && rack.id !== rackId) go({ page: 'site', propertyId, rackId: rack.id }, true);
  }, [data, rack, rackId, propertyId, go]);

  useEffect(() => { setSelection(null); setHover(null); }, [rack?.id]);

  const select = useCallback((sel: Selection | null) => {
    setSelection(sel);
    if (sel?.type === 'device') cameraRef.current?.focusDevice(sel.deviceId);
  }, []);

  // F toggles full screen; Esc also leaves the window-filling fallback (the browser handles Esc for real full screen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFull(); }
      else if (e.key === 'Escape' && full && !document.fullscreenElement) exitFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, full, toggleFull, exitFull]);

  const openRack = (id: string) => go({ page: 'site', propertyId, rackId: id });

  if (site.error && !data) {
    return <div className="center-fill"><div className="banner bad">{errorText(site.error)}</div></div>;
  }
  if (!data || !idx) return <div className="center-fill"><div className="spinner" /></div>;

  const byLocation = new Map<string, Rack[]>();
  for (const r of racks) {
    const k = r.location || 'No location';
    byLocation.set(k, [...(byLocation.get(k) ?? []), r]);
  }
  const unplaced = data.devices.filter(d => !d.rackId);
  const kind = rack ? RACK_KINDS.find(k => k.v === rack.kind)?.label : '';

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="panel-head">
          {data.property.code && <div className="mono small" style={{ color: 'var(--accent)' }}>{data.property.code}</div>}
          <h2>{data.property.name}</h2>
          {data.property.address && <div className="sub">{data.property.address}</div>}
        </div>
        <div className="panel-scroll">
          <div className="section">
            <div className="section-title">
              Racks
              <button className="btn ghost sm" onClick={() => setDialog({ type: 'rack' })}>+ Add</button>
            </div>
            {!racks.length && <div className="empty-note">No racks yet.</div>}
            {[...byLocation.entries()].map(([loc, rs]) => (
              <div key={loc} style={{ marginBottom: 8 }}>
                {byLocation.size > 1 || loc !== 'No location' ? <div className="faint small" style={{ margin: '4px 9px' }}>{loc}</div> : null}
                <div className="list">
                  {rs.map(r => {
                    const n = data.devices.filter(d => d.rackId === r.id).length;
                    return (
                      <button key={r.id} className={`list-item ${rack?.id === r.id ? 'active' : ''}`} onClick={() => openRack(r.id)}>
                        <span className="rack-icon" />
                        <span className="grow">
                          <div className="title">{r.name}</div>
                          <div className="meta">{r.units}U · {n} device{n === 1 ? '' : 's'}</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {unplaced.length > 0 && (
            <div className="section">
              <div className="section-title">Not in a rack <span>{unplaced.length}</span></div>
              {DEVICE_TYPES.map(t => {
                const ds = unplaced.filter(d => d.type === t.v);
                if (!ds.length) return null;
                return (
                  <div key={t.v} style={{ marginBottom: 6 }}>
                    <div className="faint small" style={{ margin: '4px 9px' }}>{t.label}</div>
                    <div className="list">
                      {ds.map(d => {
                        const m = d.modelId ? modelsById.get(d.modelId) : undefined;
                        return (
                          <div key={d.id} className={`list-item ${selection?.type === 'device' && selection.deviceId === d.id ? 'active' : ''}`}
                            onClick={() => setSelection({ type: 'device', deviceId: d.id })}>
                            <span className="grow">
                              <div className="title">{d.name}</div>
                              <div className="meta">{m ? modelLabel(m) : d.location || 'No model yet'}</div>
                            </span>
                            {racks.length > 0 && m?.formFactor !== 'offrack' && (
                              <button className="btn sm" onClick={e => { e.stopPropagation(); setDialog({ type: 'add', u: null, existing: d }); }}>Place</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div ref={stageRef} className={`stage ${full ? 'full' : ''}`}>
        <div className="viewport">
          {rack ? (
            <>
              <RackScene
                rack={rack}
                placements={placements}
                links={data.links}
                idx={idx}
                selection={selection}
                onSelect={select}
                onEmptySlot={u => setDialog({ type: 'add', u })}
                cameraRef={cameraRef}
                theme={theme}
              />
              <div className="overlay tl">
                <div className="glass rack-title">
                  <h1>{rack.name}</h1>
                  <div className="sub">{[rack.location, `${rack.units}U`, kind].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="glass toolbar">
                  <button className="btn sm" onClick={() => cameraRef.current?.angle()} title="3/4 view">Angle</button>
                  <button className="btn sm" onClick={() => cameraRef.current?.front()} title="Straight-on view for port work">Front</button>
                  <button className="btn sm" onClick={toggleFull} title={full ? 'Exit full screen (F or Esc)' : 'Full screen (F)'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {full
                        ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                        : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                    </svg>
                    {full ? 'Exit full screen' : 'Full screen'}
                  </button>
                  <span className="sep" />
                  <button className="btn sm primary" onClick={() => setDialog({ type: 'add', u: null })}>+ Add equipment</button>
                </div>
              </div>
              <div className="overlay bl">
                <div className="glass legend">
                  <span><span className="led on" /> In use</span>
                  <span><span className="led poe" /> PoE powering</span>
                  <span className="faint">Drag to orbit · scroll to zoom · right-drag to pan · F full screen</span>
                </div>
              </div>
              <HoverCard idx={idx} placements={placements} rack={rack} links={data.links} />
            </>
          ) : (
            <div className="scene-empty">
              <div>
                <h2>No racks at this site yet</h2>
                <p>Add the first rack, cabinet or shelf, then fill it with equipment.</p>
                <button className="btn primary" onClick={() => setDialog({ type: 'rack' })}>+ Add a rack</button>
              </div>
            </div>
          )}
        </div>

        {/* In full screen the inspector floats over the 3D view and only shows while something is selected. */}
        <div className={`drawer ${full && !selection ? 'hidden' : ''}`}>
          {full && (
            <div className="drawer-bar">
              <span>Details</span>
              <button className="btn ghost icon sm" onClick={() => setSelection(null)} aria-label="Close details">✕</button>
            </div>
          )}
          <Inspector
            site={data}
            idx={idx}
            rack={rack}
            placements={placements}
            selection={selection}
            onSelect={select}
            onEditRack={() => rack && setDialog({ type: 'rack', rack })}
            onDeletedRack={() => go({ page: 'site', propertyId, rackId: null }, true)}
          />
        </div>

        {dialog?.type === 'rack' && (
          <RackDialog
            propertyId={propertyId}
            racks={racks}
            rack={dialog.rack}
            onClose={() => setDialog(null)}
            onSaved={r => { setDialog(null); site.reload(); openRack(r.id); }}
          />
        )}
        {dialog?.type === 'add' && (
          <AddDeviceDialog
            site={data}
            rackId={rack?.id ?? null}
            u={dialog.u}
            existing={dialog.existing}
            onClose={() => setDialog(null)}
            onSaved={(deviceId, rid) => {
              setDialog(null);
              site.reload();
              if (rid && rid !== rack?.id) openRack(rid);
              setSelection({ type: 'device', deviceId });
            }}
          />
        )}
      </div>
    </div>
  );
}
