import { useMemo, useState } from 'react';
import type { ImportBundle } from '../lib/backend';
import type { Route } from '../lib/hooks';
import { normalizeModel } from '../lib/ports';
import { LEGACY_SUPABASE, buildBundles, plannedModelIds, plannedProperties, readLegacy, type LegacyData } from '../lib/importer';
import { settings } from '../lib/settings';
import { missingModels, parseSiteFile, type SiteFileSummary } from '../lib/siteFile';
import type { EquipmentModel } from '../lib/types';
import library from '../data/equipment-library.json';
import { Field, errorText, useApp } from '../components/ui';

const starter = (library as Partial<EquipmentModel>[]).map(m => normalizeModel(m as EquipmentModel));

export function ImportPage({ go, onDone }: { go(r: Route): void; onDone(): void }) {
  return (
    <div className="home">
      <div className="home-inner" style={{ maxWidth: 760 }}>
        <h1>Import</h1>
        <p className="muted">Bring a documented site into Linklight. Sites that are already here are never overwritten.</p>
        <SiteFileCard go={go} onDone={onDone} />
        {settings.patchworkImport && <PatchworkCard go={go} onDone={onDone} />}
      </div>
    </div>
  );
}

function Log({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return <div className="banner info small mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{lines.join('\n')}</div>;
}

// ---------------------------------------------------------------------------
// Site file (.linklight.json)
// ---------------------------------------------------------------------------

function SiteFileCard({ go, onDone }: { go(r: Route): void; onDone(): void }) {
  const { backend, models, reloadModels } = useApp();
  const [parsed, setParsed] = useState<{ bundle: ImportBundle; models: EquipmentModel[]; summary: SiteFileSummary } | null>(null);
  const [fileName, setFileName] = useState('');
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const missing = parsed ? missingModels(parsed.bundle, parsed.models, models) : [];
  const newModels = parsed ? parsed.models.filter(m => !models.some(x => x.id === m.id)) : [];

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setErr(''); setParsed(null); setDone(false); setLog([]); setFileName(file.name);
    try {
      const result = parseSiteFile(await file.text());
      setExists(await backend.propertyExists(result.summary.propertyId));
      setParsed(result);
    } catch (e) { setErr(errorText(e)); }
  };

  const run = async () => {
    if (!parsed) return;
    setErr(''); setBusy(true); setLog([]);
    const say = (m: string) => setLog(l => [...l, m]);
    try {
      for (const m of newModels) {
        await backend.saveModel(m, true);
        say(`Added ${m.manufacturer} ${m.name} to the library.`);
      }
      if (newModels.length) reloadModels();
      say(`Importing ${parsed.summary.name}…`);
      await backend.importSite(parsed.bundle, say);
      say(`✓ ${parsed.summary.name}`);
      setDone(true);
      onDone();
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };

  const s = parsed?.summary;
  return (
    <div className="card stack" style={{ cursor: 'default', marginTop: 18 }}>
      <h3>Site file</h3>
      <p className="muted small" style={{ margin: 0 }}>
        A <span className="mono">.linklight.json</span> file describing one site: racks, equipment, cable runs, port labels and photos.
      </p>
      {!done && (
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <input type="file" accept=".json,application/json" hidden onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
          {fileName ? 'Choose a different file…' : 'Choose site file…'}
        </label>
      )}
      {s && !done && (
        <>
          <div className="small muted mono">{fileName}</div>
          <table className="port-table" style={{ fontSize: 13 }}>
            <thead>
              <tr className="faint" style={{ cursor: 'default' }}>
                <td>Site</td><td>Racks</td><td>Devices</td><td>Cable runs</td><td>Photos</td><td />
              </tr>
            </thead>
            <tbody>
              <tr style={{ cursor: 'default' }}>
                <td><b>{s.name}</b><div className="faint small mono">{s.propertyId}</div></td>
                <td>{s.racks}</td>
                <td>{s.devices} <span className="faint">({s.placed} in racks)</span></td>
                <td>{s.links}</td>
                <td>{s.photos}</td>
                <td>{exists ? <span className="pill neutral">Already here</span> : <span className="pill confirmed">New</span>}</td>
              </tr>
            </tbody>
          </table>
          {newModels.length > 0 && (
            <div className="small muted">Adds {newModels.length} model{newModels.length === 1 ? '' : 's'} to the library: {newModels.map(m => `${m.manufacturer} ${m.name}`).join(', ')}.</div>
          )}
          {exists && <div className="banner warn small">A site with the id “{s.propertyId}” already exists, so this file can't be imported. Delete that site first, or change the id in the file.</div>}
          {missing.length > 0 && <div className="banner bad small">These equipment models aren't in the file or the library: {missing.join(', ')}.</div>}
          <Log lines={log} />
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={run} disabled={busy || exists || missing.length > 0}>
            {busy ? 'Importing…' : `Import ${s.name}`}
          </button>
        </>
      )}
      {err && <div className="banner bad small" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
      {done && s && (
        <>
          <Log lines={log} />
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <button className="btn primary shrink" onClick={() => go({ page: 'site', propertyId: s.propertyId, rackId: null })}>Open {s.name}</button>
            <button className="btn shrink" onClick={() => { setParsed(null); setDone(false); setFileName(''); setLog([]); }}>Import another</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// From the original Patchwork (only when configured in config.js)
// ---------------------------------------------------------------------------

function PatchworkCard({ go, onDone }: { go(r: Route): void; onDone(): void }) {
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
    <div className="card stack" style={{ cursor: 'default', marginTop: 18 }}>
      <h3>From Patchwork</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Copies every property, device (with its photo{credentials ? ' and saved credentials' : ''}), cable run and activity entry from a
        Patchwork database. Patchwork is only read; nothing there changes.
      </p>

      {!legacy && (
        <>
          <div className="row">
            <Field label="Patchwork email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></Field>
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
            {busy ? 'Reading…' : 'Read Patchwork data'}
          </button>
        </>
      )}

      {legacy && preview && !done && (
        <>
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
          <Log lines={log} />
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <button className="btn primary shrink" onClick={run} disabled={busy || !toImport.length}>
              {busy ? 'Importing…' : toImport.length ? `Import ${toImport.length} propert${toImport.length === 1 ? 'y' : 'ies'}` : 'Nothing new to import'}
            </button>
            <button className="btn shrink" onClick={() => setLegacy(null)} disabled={busy}>Back</button>
          </div>
        </>
      )}

      {done && (
        <>
          <p className="muted" style={{ margin: 0 }}>Imported {done.length} propert{done.length === 1 ? 'y' : 'ies'}. Devices that weren't placed by a rack plan are listed under “Not in a rack”, ready to place.</p>
          <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            {done.map(pid => (
              <button key={pid} className="btn shrink" onClick={() => go({ page: 'site', propertyId: pid, rackId: null })}>
                Open {preview?.reports.find(r => r.propertyId === pid)?.name ?? pid}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
