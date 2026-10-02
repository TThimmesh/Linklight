import { useEffect, useMemo, useState } from 'react';
import type { Route } from '../lib/hooks';
import { genId, slugify } from '../lib/ids';
import { duplicateKeys, normalizeGroup, portSummary } from '../lib/ports';
import {
  DEVICE_TYPES, POE_LABEL, SPEEDS, modelLabel,
  type EquipmentModel, type FormFactor, type PoeStandard, type PortGroup, type PortKind,
} from '../lib/types';
import { ModelPreview } from '../three/ModelPreview';
import { Field, errorText, useApp } from '../components/ui';

const FACE_PRESETS = ['#24282d', '#15191e', '#2b3037', '#bfc3c7', '#d6d9dc', '#f2f3f4', '#1d2733', '#2e3a4a'];

function blankModel(): EquipmentModel {
  return {
    id: '', manufacturer: '', name: '', category: 'switch', formFactor: 'rack', rackUnits: 1, widthIn: 17.5,
    depthIn: 10, faceColor: '#24282d', poeBudgetW: null, notes: '',
    portGroups: [normalizeGroup({ id: 'g1', kind: 'rj45', count: 24, start: 1, rows: 2, blockSize: 12 }, 0)],
  };
}

export function LibraryPage({ modelId, go }: { modelId: string | null; go(r: Route, replace?: boolean): void }) {
  const { backend, models, reloadModels } = useApp();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<EquipmentModel | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  const current = models.find(m => m.id === modelId) ?? null;
  useEffect(() => {
    if (isNew) return;
    setDraft(current ? structuredClone(current) : null);
    setErr('');
    // only when switching models — realtime refreshes shouldn't clobber unsaved edits
  }, [modelId, current === null]);
  useEffect(() => {
    if (!modelId && !isNew && models.length) go({ page: 'library', modelId: models[0].id }, true);
  }, [modelId, isNew, models, go]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = models.filter(m => !q || `${m.manufacturer} ${m.name}`.toLowerCase().includes(q));
    return DEVICE_TYPES.map(t => ({ t, items: list.filter(m => m.category === t.v) })).filter(g => g.items.length);
  }, [models, query]);

  const startNew = (from?: EquipmentModel) => {
    const base = from ? { ...structuredClone(from), name: `${from.name} (copy)` } : blankModel();
    setDraft({ ...base, id: '' });
    setIsNew(true);
    setErr('');
  };

  const pick = (id: string) => { setIsNew(false); go({ page: 'library', modelId: id }); };

  const update = (patch: Partial<EquipmentModel>) => setDraft(d => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    setErr('');
    if (!draft.name.trim()) { setErr('Give the model a name.'); return; }
    const dups = duplicateKeys(draft);
    if (dups.length) { setErr(`Port names must be unique — repeated: ${dups.join(', ')}`); return; }
    const m: EquipmentModel = {
      ...draft,
      manufacturer: draft.manufacturer.trim(),
      name: draft.name.trim(),
      widthIn: draft.formFactor === 'rack' ? 17.5 : draft.widthIn,
      id: isNew ? `${slugify(`${draft.manufacturer} ${draft.name}`) || 'model'}-${genId().slice(0, 4)}` : draft.id,
    };
    try {
      await backend.saveModel(m, isNew);
      reloadModels();
      setIsNew(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      go({ page: 'library', modelId: m.id }, true);
    } catch (e) { setErr(errorText(e)); }
  };

  const remove = async () => {
    if (!draft || isNew) return;
    try {
      const n = await backend.countModelUsage(draft.id);
      const msg = n
        ? `${n} device${n === 1 ? ' uses' : 's use'} this model. Deleting it leaves ${n === 1 ? 'that device' : 'them'} with no model (and out of the 3D view) until another is picked. Delete anyway?`
        : `Delete ${modelLabel(draft)} from the library?`;
      if (!confirm(msg)) return;
      await backend.deleteModel(draft.id);
      reloadModels();
      go({ page: 'library', modelId: null }, true);
    } catch (e) { setErr(errorText(e)); }
  };

  return (
    <div className="page">
      <aside className="sidebar lib-list">
        <div className="panel-head">
          <h2>Equipment library</h2>
          <div className="sub">Shared by every site</div>
          <div className="row" style={{ marginTop: 10 }}>
            <input placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
            <button className="btn primary shrink" onClick={() => startNew()}>+ New</button>
          </div>
        </div>
        <div className="panel-scroll">
          {grouped.map(({ t, items }) => (
            <div key={t.v} className="section" style={{ marginTop: 12 }}>
              <div className="section-title">{t.label}</div>
              <div className="list">
                {items.map(m => (
                  <button key={m.id} className={`list-item ${!isNew && m.id === modelId ? 'active' : ''}`} onClick={() => pick(m.id)}>
                    <span className="swatch" style={{ background: m.faceColor, width: 14, height: 14 }} />
                    <span className="grow">
                      <div className="title">{modelLabel(m)}</div>
                      <div className="meta">{m.formFactor === 'rack' ? `${m.rackUnits}U` : m.formFactor === 'desktop' ? 'Desktop' : 'Off-rack'} · {portSummary(m)}</div>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="lib-preview">
        {draft ? <ModelPreview model={draft} deviceName={draft.name ? 'SW01' : 'NEW'} showLinks={showLinks} /> : null}
        {draft && (
          <div className="overlay tl">
            <div className="glass rack-title">
              <h1>{modelLabel(draft) || 'New model'}</h1>
              <div className="sub">{portSummary(draft)}</div>
            </div>
            <div className="glass toolbar">
              <button className={`btn sm ${showLinks ? 'primary' : ''}`} onClick={() => setShowLinks(v => !v)}>Example links {showLinks ? 'on' : 'off'}</button>
            </div>
          </div>
        )}
      </div>

      <aside className="inspector lib-editor">
        {draft ? (
          <>
            <div className="panel-head">
              <h2>{isNew ? 'New model' : 'Edit model'}</h2>
              <div className="sub">Changes apply everywhere this model is used.</div>
            </div>
            <div className="panel-scroll stack">
              <div className="row">
                <Field label="Manufacturer"><input value={draft.manufacturer} onChange={e => update({ manufacturer: e.target.value })} placeholder="Ruckus" /></Field>
                <Field label="Model"><input value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="ICX7150-48P" /></Field>
              </div>
              <div className="row">
                <Field label="Type">
                  <select value={draft.category} onChange={e => update({ category: e.target.value as EquipmentModel['category'] })}>
                    {DEVICE_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Mounting">
                  <select value={draft.formFactor} onChange={e => {
                    const ff = e.target.value as FormFactor;
                    update({ formFactor: ff, widthIn: ff === 'rack' ? 17.5 : Math.min(draft.widthIn, 10) });
                  }}>
                    <option value="rack">Rack-mount</option>
                    <option value="desktop">Desktop / shelf</option>
                    <option value="offrack">Off-rack (AP, camera…)</option>
                  </select>
                </Field>
              </div>
              <div className="row">
                <Field label="Height" hint="U">
                  <input type="number" min={1} max={10} value={draft.rackUnits} onChange={e => update({ rackUnits: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
                </Field>
                {draft.formFactor !== 'rack' && (
                  <Field label="Width" hint="in">
                    <input type="number" min={1} max={17.5} step={0.1} value={draft.widthIn} onChange={e => update({ widthIn: Math.max(1, Math.min(17.5, Number(e.target.value) || 1)) })} />
                  </Field>
                )}
                <Field label="Depth" hint="in">
                  <input type="number" min={1} max={36} step={0.5} value={draft.depthIn} onChange={e => update({ depthIn: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
              </div>
              <Field label="Faceplate color">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="color" value={draft.faceColor} onChange={e => update({ faceColor: e.target.value })} />
                  {FACE_PRESETS.map(c => (
                    <button key={c} type="button" className="btn icon" title={c} style={{ width: 26, height: 26, padding: 0, background: c, borderColor: draft.faceColor === c ? 'var(--accent)' : undefined, borderWidth: 2 }} onClick={() => update({ faceColor: c })} />
                  ))}
                </div>
              </Field>
              <Field label="PoE budget" hint="watts, optional">
                <input type="number" min={0} value={draft.poeBudgetW ?? ''} onChange={e => update({ poeBudgetW: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>

              <div className="section-title" style={{ marginTop: 6 }}>
                Port groups
                <button className="btn ghost sm" onClick={() => update({
                  portGroups: [...draft.portGroups, normalizeGroup({ id: `g${Date.now().toString(36)}`, kind: 'rj45', count: 4, start: nextStart(draft) }, draft.portGroups.length)],
                })}>+ Add group</button>
              </div>
              {!draft.portGroups.length && <div className="empty-note">No network ports (e.g. a UPS or power conditioner).</div>}
              {draft.portGroups.map((g, i) => (
                <GroupEditor
                  key={g.id}
                  group={g}
                  index={i}
                  count={draft.portGroups.length}
                  onChange={ng => update({ portGroups: draft.portGroups.map(x => (x.id === g.id ? ng : x)) })}
                  onRemove={() => update({ portGroups: draft.portGroups.filter(x => x.id !== g.id) })}
                  onMove={dir => {
                    const arr = [...draft.portGroups];
                    const j = i + dir;
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                    update({ portGroups: arr });
                  }}
                />
              ))}
              <Field label="Notes"><textarea value={draft.notes} onChange={e => update({ notes: e.target.value })} /></Field>
              {err && <div className="banner bad">{err}</div>}
            </div>
            <div className="panel-actions">
              <button className="btn primary" onClick={save}>{saved ? 'Saved ✓' : isNew ? 'Add to library' : 'Save'}</button>
              {isNew ? (
                <button className="btn" onClick={() => { setIsNew(false); setDraft(current ? structuredClone(current) : null); }}>Cancel</button>
              ) : (
                <button className="btn" onClick={() => startNew(draft)}>Duplicate</button>
              )}
              <span className="grow" />
              {!isNew && <button className="btn danger" onClick={remove}>Delete</button>}
            </div>
          </>
        ) : (
          <div className="panel-scroll"><div className="empty-note">Pick a model, or add a new one.</div></div>
        )}
      </aside>
    </div>
  );
}

function nextStart(m: EquipmentModel): number {
  let max = 0;
  for (const g of m.portGroups) if (!g.names.length && !g.prefix) max = Math.max(max, g.start + g.count - 1);
  return max + 1;
}

function GroupEditor({ group: g, index, count, onChange, onRemove, onMove }: {
  group: PortGroup; index: number; count: number;
  onChange(g: PortGroup): void; onRemove(): void; onMove(dir: -1 | 1): void;
}) {
  const [namesText, setNamesText] = useState(g.names.join(', '));
  const named = g.names.length > 0 || namesText.trim() !== '';
  const [mode, setMode] = useState<'numbered' | 'named'>(named ? 'named' : 'numbered');
  const set = (patch: Partial<PortGroup>) => onChange({ ...g, ...patch });

  return (
    <div className="group-card">
      <div className="gc-head">
        <strong>Group {index + 1}</strong>
        <input style={{ flex: 1 }} value={g.label} placeholder="Label (optional), e.g. 10G SFP+" onChange={e => set({ label: e.target.value })} />
        <button className="btn ghost icon sm" disabled={index === 0} onClick={() => onMove(-1)} title="Move left">↑</button>
        <button className="btn ghost icon sm" disabled={index === count - 1} onClick={() => onMove(1)} title="Move right">↓</button>
        <button className="btn ghost icon sm danger" onClick={onRemove} title="Remove group">✕</button>
      </div>
      <div className="row">
        <Field label="Connector">
          <div className="seg">
            {(['rj45', 'sfp', 'sfp+'] as PortKind[]).map(k => (
              <button type="button" key={k} className={g.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>{k === 'rj45' ? 'RJ45' : k.toUpperCase()}</button>
            ))}
          </div>
        </Field>
        <Field label="Ports are">
          <div className="seg">
            <button type="button" className={mode === 'numbered' ? 'on' : ''} onClick={() => { setMode('numbered'); setNamesText(''); set({ names: [], count: g.count || g.names.length || 1 }); }}>Numbered</button>
            <button type="button" className={mode === 'named' ? 'on' : ''} onClick={() => setMode('named')}>Named</button>
          </div>
        </Field>
      </div>
      {mode === 'numbered' ? (
        <div className="row">
          <Field label="How many"><input type="number" min={1} max={96} value={g.count} onChange={e => set({ count: Math.max(0, Math.min(96, Number(e.target.value) || 0)) })} /></Field>
          <Field label="First #"><input type="number" min={0} value={g.start} onChange={e => set({ start: Number(e.target.value) || 0 })} /></Field>
          <Field label="Prefix" hint="e.g. X"><input value={g.prefix} onChange={e => set({ prefix: e.target.value })} /></Field>
        </div>
      ) : (
        <Field label="Port names" hint="comma-separated, in order">
          <input value={namesText} placeholder="WAN1, WAN2, DMZ, LAN" onChange={e => {
            setNamesText(e.target.value);
            set({ names: e.target.value.split(',').map(s => s.trim()).filter(Boolean) });
          }} />
        </Field>
      )}
      <div className="row">
        <Field label="Rows">
          <div className="seg">
            {[1, 2].map(r => <button type="button" key={r} className={g.rows === r ? 'on' : ''} onClick={() => set({ rows: r as 1 | 2 })}>{r}</button>)}
          </div>
        </Field>
        {g.rows === 2 && (
          <Field label="Numbering">
            <div className="seg">
              <button type="button" className={g.order === 'odd-even' ? 'on' : ''} onClick={() => set({ order: 'odd-even' })} title="1 on top, 2 below, 3 on top…">Odd top</button>
              <button type="button" className={g.order === 'sequential' ? 'on' : ''} onClick={() => set({ order: 'sequential' })} title="Top row first, then bottom row">Row by row</button>
            </div>
          </Field>
        )}
        <Field label="Per block" hint="0 = none"><input type="number" min={0} max={48} value={g.blockSize} onChange={e => set({ blockSize: Math.max(0, Number(e.target.value) || 0) })} /></Field>
      </div>
      <div className="row">
        <Field label="Speed">
          <select value={g.speed} onChange={e => set({ speed: e.target.value })}>
            {SPEEDS.map(s => <option key={s} value={s}>{s || '—'}</option>)}
          </select>
        </Field>
        <Field label="PoE">
          <select value={g.poeStandard} onChange={e => {
            const std = e.target.value as PoeStandard;
            set({ poeStandard: std, poePorts: std === 'none' ? '' : g.poePorts || 'all' });
          }}>
            {(Object.keys(POE_LABEL) as PoeStandard[]).map(k => <option key={k} value={k}>{POE_LABEL[k]}</option>)}
          </select>
        </Field>
        {g.poeStandard !== 'none' && (
          <Field label="PoE ports" hint="all, 1-8, 13"><input value={g.poePorts} onChange={e => set({ poePorts: e.target.value })} /></Field>
        )}
      </div>
    </div>
  );
}
