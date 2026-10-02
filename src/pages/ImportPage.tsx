import { useMemo, useState } from 'react';
import type { Route } from '../lib/hooks';
import { normalizeModel } from '../lib/ports';
import { LEGACY_SUPABASE, buildBundles, plannedModelIds, plannedProperties, readLegacy, type LegacyData } from '../lib/importer';
import type { EquipmentModel } from '../lib/types';
import library from '../data/equipment-library.json';
import { Field, errorText, useApp } from '../components/ui';

const starter = (library as Partial<EquipmentModel>[]).map(m => normalizeModel(m as EquipmentModel));

export function ImportPage({ go, onDone }: { go(r: Route): void; onDone(): void }) {
  const { backend, models, reloadModels } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(!LEGACY_SUPABASE.url || !LEGACY_SUPABASE.key);
  const [url, setUrl] = useState(LEGACY_SUPABASE.url);
  const [key, setKey] = useState(LEGACY_SUPABASE.key);
  const [legacy, setLegacy] = useState<LegacyData | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [arrange, setArrange] = useState(plannedProperties.length > 0);
  const [credentials, setCredentials] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string[] | null>(null);

  const preview = useMemo(() => (legacy ? buildBundles(legacy, { arrange, credentials }) : null), [legacy, arrange, credentials]);
  const toImport = preview?.bundles.filter(b => !existing.has(b.property.id)) ?? [];

  const read = async () => {
    setErr(''); setBusy(true);
    try {
      const data = await readLegacy(email.trim(), password, url.trim(), key.trim());
      const ex = new Set<string>();
      for (const p of data.properties) if (await backend.propertyExists(String(p.id))) ex.add(String(p.id));
      setExisting(ex);
      setLegacy(data);
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };

  const run = async () => {
    if (!preview) return;
    setErr(''); setBusy(true); setLog([]);
    const say = (m: string) => setLog(l => [...l, m]);
    try {
      // the rack plan places devices as specific library models — make sure they exist
      const have = new Set(models.map(m => m.id));
      for (const id of plannedModelIds()) {
        const m = starter.find(x => x.id === id);
        if (m && !have.has(id)) { await backend.saveModel(m, true); say(`Added ${m.manufacturer} ${m.name} to the library.`); }
      }
      reloadModels();
      const imported: string[] = [];
      for (const b of toImport) {
        say(`Importing ${b.property.name}…`);
        await backend.importSite(b, say);
        imported.push(b.property.id);
        say(`✓ ${b.property.name}`);
      }
      setDone(imported);
      onDone();
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };

  return (
    <div className="home">
      <div className="home-inner" style={{ maxWidth: 760 }}>
        <h1>Import from the original Patchwork</h1>
        <p className="muted">
          Copies every property, device (with its photo{credentials ? ' and saved credentials' : ''}), cable run and activity entry from the original
          Supabase-backed Patchwork into this app. The original site is only read — nothing there changes, and it keeps working on its own.
          Properties that are already here are skipped.
        </p>

        {!legacy && (
          <div className="card stack" style={{ cursor: 'default', marginTop: 18 }}>
            <h3>1 · Sign in to the original Patchwork</h3>
            <div className="row">
              <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></Field>
              <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter') void read(); }} /></Field>
            </div>
            <div className="small faint">This login is only used to read the old data in your browser; it isn't stored.</div>
            {advanced ? (
              <div className="row">
                <Field label="Supabase URL"><input className="mono" value={url} onChange={e => setUrl(e.target.value)} /></Field>
                <Field label="Publishable key"><input className="mono" value={key} onChange={e => setKey(e.target.value)} /></Field>
              </div>
            ) : (
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(true)}>Different Supabase project…</button>
            )}
            {err && <div className="banner bad">{err}</div>}
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={read} disabled={busy || !email || !password}>
              {busy ? 'Reading…' : 'Read old data'}
            </button>
          </div>
        )}

        {legacy && preview && !done && (
          <div className="card stack" style={{ cursor: 'default', marginTop: 18 }}>
            <h3>2 · Review</h3>
            <table className="port-table" style={{ fontSize: 13 }}>
              <thead>
                <tr className="faint" style={{ cursor: 'default' }}>
                  <td>Property</td><td>Devices</td><td>Cable runs</td><td>Photos</td><td>Racks</td><td />
                </tr>
              </thead>
              <tbody>
                {preview.reports.map(r => (
                  <tr key={r.propertyId} style={{ cursor: 'default' }}>
                    <td><b>{r.name}</b>{r.missing.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>Not found for rack plan: {r.missing.join(', ')}</div>}</td>
                    <td>{r.devices}</td>
                    <td>{r.links}</td>
                    <td>{r.photos}</td>
                    <td>{r.racks ? `${r.racks} (${r.placed} placed)` : '—'}</td>
                    <td>{existing.has(r.propertyId) ? <span className="pill neutral">Already here — skip</span> : <span className="pill confirmed">New</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plannedProperties.length > 0 && (
              <label className="check"><input type="checkbox" checked={arrange} onChange={e => setArrange(e.target.checked)} />
                Arrange {plannedProperties.join(', ').toUpperCase()} into racks using the local rack plan</label>
            )}
            <label className="check"><input type="checkbox" checked={credentials} onChange={e => setCredentials(e.target.checked)} />
              Include saved device credentials</label>
            {err && <div className="banner bad">{err}</div>}
            {log.length > 0 && <div className="banner info small mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{log.join('\n')}</div>}
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <button className="btn primary shrink" onClick={run} disabled={busy || !toImport.length}>
                {busy ? 'Importing…' : toImport.length ? `Import ${toImport.length} propert${toImport.length === 1 ? 'y' : 'ies'}` : 'Nothing new to import'}
              </button>
              <button className="btn shrink" onClick={() => setLegacy(null)} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {done && (
          <div className="card stack" style={{ cursor: 'default', marginTop: 18 }}>
            <h3>Done</h3>
            <p className="muted" style={{ margin: 0 }}>Imported {done.length} propert{done.length === 1 ? 'y' : 'ies'}. Open each site to check it; devices that weren't placed by a rack plan are listed under “Not in a rack”, ready to place.</p>
            <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              {done.map(pid => (
                <button key={pid} className="btn shrink" onClick={() => go({ page: 'site', propertyId: pid, rackId: null })}>
                  Open {preview?.reports.find(r => r.propertyId === pid)?.name ?? pid}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
