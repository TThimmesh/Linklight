import { useEffect, useMemo, useRef, useState } from 'react';
import { compressImage } from '../lib/backend';
import { genId } from '../lib/ids';
import { portSummary } from '../lib/ports';
import { checkFit, deviceUnits, farEnd, farEndLabel, linkSpan, portId, type Placement, type PortConn, type SiteIndex } from '../lib/site';
import {
  CABLE_HEX, POE_LABEL, SPEEDS, STATUSES, modelLabel, typeLabel,
  type Device, type Link, type PortRecord, type Rack, type SiteData, type Status,
} from '../lib/types';
import type { Selection } from '../three/RackScene';
import { CableSwatches, Field, Lightbox, PhotoThumb, StatusPill, errorText, useApp } from './ui';

interface InspectorProps {
  site: SiteData;
  idx: SiteIndex;
  rack: Rack | null;
  placements: Placement[];
  selection: Selection | null;
  onSelect(sel: Selection | null): void;
  onEditRack(): void;
  onDeletedRack(): void;
}

export function Inspector(props: InspectorProps) {
  const { selection, idx } = props;
  let content;
  if (selection?.type === 'port' && idx.devicesById.has(selection.deviceId)) {
    content = <PortPanel key={`${selection.deviceId}:${selection.key}`} {...props} deviceId={selection.deviceId} portKey={selection.key} />;
  } else if (selection?.type === 'device' && idx.devicesById.has(selection.deviceId)) {
    content = <DevicePanel key={selection.deviceId} {...props} deviceId={selection.deviceId} />;
  } else if (selection?.type === 'link' && props.site.links.some(l => l.id === selection.linkId)) {
    content = <LinkPanel key={selection.linkId} {...props} linkId={selection.linkId} />;
  } else if (props.rack) {
    content = <RackPanel {...props} rack={props.rack} />;
  } else {
    content = <div className="panel-scroll"><div className="empty-note">Add a rack to get started.</div></div>;
  }
  return <aside className="inspector">{content}</aside>;
}

function useSaved(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return [saved, () => { setSaved(true); clearTimeout(t.current); t.current = setTimeout(() => setSaved(false), 1800); }];
}

// ---------------------------------------------------------------------------
// Rack
// ---------------------------------------------------------------------------

function RackPanel({ rack, placements, idx, onSelect, onEditRack, onDeletedRack, site }: InspectorProps & { rack: Rack }) {
  const { backend } = useApp();
  const usedU = placements.reduce((s, p) => s + (p.desktop ? 0 : p.units), 0) + new Set(placements.filter(p => p.desktop).map(p => p.device.rackU)).size;
  const sorted = [...placements].sort((a, b) => (b.device.rackU ?? 0) - (a.device.rackU ?? 0));
  let ports = 0;
  let used = 0;
  for (const p of placements) {
    for (const s of idx.portSpecs.get(p.device.id) ?? []) {
      ports++;
      if (idx.connsByPort.has(portId(p.device.id, s.key))) used++;
    }
  }
  const del = async () => {
    if (!confirm(`Delete rack “${rack.name}”? The ${placements.length} device(s) in it stay documented and move to “Not in a rack”.`)) return;
    try {
      await backend.deleteRack(rack.propertyId, rack.id);
      await backend.logActivity(site.property.id, `Deleted rack “${rack.name}”.`);
      onDeletedRack();
    } catch (e) { alert(errorText(e)); }
  };
  return (
    <>
      <div className="panel-head">
        <h2>{rack.name}</h2>
        <div className="sub">{[rack.location, `${rack.units}U`, kindLabel(rack.kind)].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="panel-scroll">
        <div className="section">
          <div className="section-title">Space</div>
          <div className="meter"><div style={{ width: `${Math.min(100, (usedU / rack.units) * 100)}%` }} /></div>
          <div className="small muted" style={{ marginTop: 6 }}>{usedU} of {rack.units}U used · {used} of {ports} ports connected</div>
        </div>
        <div className="section">
          <div className="section-title">Equipment</div>
          {!sorted.length && <div className="empty-note">Empty. Click an empty slot in the rack, or use “Add equipment”.</div>}
          <div className="list">
            {sorted.map(p => (
              <button key={p.device.id} className="list-item" onClick={() => onSelect({ type: 'device', deviceId: p.device.id })}>
                <span className="mono faint" style={{ width: 38, fontSize: 12 }}>U{p.device.rackU}</span>
                <span className="grow">
                  <div className="title">{p.device.name}</div>
                  <div className="meta">{modelLabel(p.model)}</div>
                </span>
                <StatusPill status={p.device.status} />
              </button>
            ))}
          </div>
        </div>
        {rack.notes && <div className="section"><div className="section-title">Notes</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{rack.notes}</div></div>}
      </div>
      <div className="panel-actions">
        <button className="btn" onClick={onEditRack}>Edit rack</button>
        <span className="grow" />
        <button className="btn danger" onClick={del}>Delete rack</button>
      </div>
    </>
  );
}

function kindLabel(k: Rack['kind']) {
  return { floor: 'Floor rack', wall: 'Wall cabinet', open: 'Open frame', shelf: 'Shelf' }[k];
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

function DevicePanel({ site, idx, deviceId, onSelect }: InspectorProps & { deviceId: string }) {
  const { backend, models, modelsById } = useApp();
  const d = idx.devicesById.get(deviceId)!;
  const model = d.modelId ? modelsById.get(d.modelId) : undefined;
  const [name, setName] = useState(d.name);
  const [status, setStatus] = useState<Status>(d.status);
  const [ip, setIp] = useState(d.ip);
  const [mac, setMac] = useState(d.mac);
  const [notes, setNotes] = useState(d.notes);
  const [modelId, setModelId] = useState(d.modelId ?? '');
  const [rackId, setRackId] = useState(d.rackId ?? '');
  const [u, setU] = useState(d.rackU ? String(d.rackU) : '');
  const [err, setErr] = useState('');
  const [saved, markSaved] = useSaved();
  const [photo, setPhoto] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let live = true;
    backend.devicePhoto(site.property.id, deviceId).then(p => { if (live) setPhoto(p); }, () => undefined);
    return () => { live = false; };
  }, [backend, site.property.id, deviceId]);

  // keep the position fields in step with moves made elsewhere (nudges, other people)
  useEffect(() => { setRackId(d.rackId ?? ''); setU(d.rackU ? String(d.rackU) : ''); }, [d.rackId, d.rackU]);

  /** Moves to the next free position up or down the rack. */
  const nudge = async (dir: 1 | -1) => {
    const rack = site.racks.find(r => r.id === d.rackId);
    if (!rack || !d.rackU || !model) return;
    for (let next = d.rackU + dir; next >= 1 && next <= rack.units; next += dir) {
      if (checkFit(rack, next, model, site.devices, modelsById, deviceId).ok) {
        setErr('');
        try { await backend.updateDevice(site.property.id, deviceId, { rackU: next }); } catch (e) { setErr(errorText(e)); }
        return;
      }
    }
    setErr(`No free space ${dir > 0 ? 'above' : 'below'} ${d.name}.`);
  };

  const specs = idx.portSpecs.get(deviceId) ?? [];
  const usedCount = specs.filter(s => idx.connsByPort.has(portId(deviceId, s.key))).length;
  const poeW = specs.reduce((sum, s) => {
    const c = idx.connsByPort.get(portId(deviceId, s.key))?.find(x => x.link.poe);
    return sum + (s.poe !== 'none' && c?.link.poeWatts ? c.link.poeWatts : 0);
  }, 0);

  const save = async () => {
    setErr('');
    const patch: Partial<Device> = { name: name.trim() || d.name, status, ip: ip.trim(), mac: mac.trim(), notes };
    const newModel = modelId ? modelsById.get(modelId) : undefined;
    const placeChanged = modelId !== (d.modelId ?? '') || rackId !== (d.rackId ?? '') || u !== (d.rackU ? String(d.rackU) : '');
    if (placeChanged) {
      patch.modelId = modelId || null;
      if (rackId && newModel) {
        const rack = site.racks.find(r => r.id === rackId)!;
        const uNum = Math.floor(Number(u));
        const fit = checkFit(rack, uNum, newModel, site.devices, modelsById, deviceId);
        if (!fit.ok) { setErr(fit.reason ?? 'Doesn\'t fit there.'); return; }
        patch.rackId = rackId;
        patch.rackU = uNum;
      } else {
        patch.rackId = null;
        patch.rackU = null;
      }
    }
    try {
      await backend.updateDevice(site.property.id, deviceId, patch);
      if (placeChanged && patch.rackId) {
        const r = site.racks.find(x => x.id === patch.rackId)!;
        await backend.logActivity(site.property.id, `Moved ${patch.name} to ${r.name}, U${patch.rackU}.`);
      } else {
        await backend.logActivity(site.property.id, `Updated ${patch.name}.`);
      }
      markSaved();
    } catch (e) { setErr(errorText(e)); }
  };

  const unplace = async () => {
    try {
      await backend.updateDevice(site.property.id, deviceId, { rackId: null, rackU: null });
      await backend.logActivity(site.property.id, `Removed ${d.name} from its rack.`);
      onSelect(null);
    } catch (e) { setErr(errorText(e)); }
  };

  const remove = async () => {
    if (!confirm(`Delete ${d.name} entirely? Its cable runs and port notes are deleted too. This can't be undone.`)) return;
    try {
      await backend.deleteDevice(site.property.id, deviceId);
      await backend.logActivity(site.property.id, `Deleted ${d.name}.`);
      onSelect(null);
    } catch (e) { setErr(errorText(e)); }
  };

  const selectedModel = modelId ? modelsById.get(modelId) : undefined;
  const rackForU = site.racks.find(r => r.id === rackId);

  return (
    <>
      <div className="panel-head">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <h2>{d.name}</h2>
          <StatusPill status={d.status} />
        </div>
        <div className="sub">{modelLabel(model)} · {typeLabel(d.type)}</div>
      </div>
      <div className="panel-scroll">
        {specs.length > 0 && (
          <div className="section">
            <div className="section-title">Ports <span>{usedCount}/{specs.length}</span></div>
            <div className="meter"><div style={{ width: `${(usedCount / specs.length) * 100}%`, background: 'var(--ok)' }} /></div>
            {model?.poeBudgetW ? (
              <div className="small muted" style={{ marginTop: 6 }}>PoE: {poeW.toFixed(1)} W documented of {model.poeBudgetW} W budget</div>
            ) : null}
            <table className="port-table" style={{ marginTop: 8 }}>
              <tbody>
                {specs.map(s => {
                  const conns = idx.connsByPort.get(portId(deviceId, s.key));
                  const rec = idx.portRecords.get(portId(deviceId, s.key));
                  const c = conns?.[0];
                  const to = c ? farEndLabel(farEnd(idx, c)) : null;
                  const poe = !!c?.link.poe && s.poe !== 'none';
                  return (
                    <tr key={s.groupId + s.key} onClick={() => onSelect({ type: 'port', deviceId, key: s.key })}>
                      <td className="k"><span className={`led ${c ? 'on' : ''}`} style={{ marginRight: 5 }} />{s.key}</td>
                      <td>
                        {to ? <>{to.title}{to.port && <span className="faint"> · {to.port}</span>}</> : <span className="faint">—</span>}
                        {rec?.label && <div className="faint small">{rec.label}</div>}
                      </td>
                      <td style={{ width: 18 }}>{poe && <span className="led poe" title="PoE" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="section stack">
          <div className="section-title">Details</div>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <div className="row">
            <Field label="Status">
              <select value={status} onChange={e => setStatus(e.target.value as Status)}>
                {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="IP address"><input className="mono" value={ip} onChange={e => setIp(e.target.value)} placeholder="10.0.0.2" /></Field>
            <Field label="MAC"><input className="mono" value={mac} onChange={e => setMac(e.target.value)} placeholder="aa:bb:cc:…" /></Field>
          </div>
          <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>

        <div className="section stack">
          <div className="section-title">Model & position</div>
          <Field label="Model" hint={selectedModel ? portSummary(selectedModel) : undefined}>
            <select value={modelId} onChange={e => setModelId(e.target.value)}>
              <option value="">No model</option>
              {models.map(m => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
            </select>
          </Field>
          {selectedModel?.formFactor !== 'offrack' && (
            <div className="row">
              <Field label="Rack">
                <select value={rackId} onChange={e => setRackId(e.target.value)}>
                  <option value="">Not in a rack</option>
                  {site.racks.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label={selectedModel && deviceUnits(selectedModel) > 1 ? 'Lowest U' : 'U'}>
                <input type="number" min={1} max={rackForU?.units ?? 60} value={u} onChange={e => setU(e.target.value)} disabled={!rackId} />
              </Field>
            </div>
          )}
          {d.rackId && model && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <button className="btn sm shrink" onClick={() => void nudge(1)}>▲ Move up</button>
              <button className="btn sm shrink" onClick={() => void nudge(-1)}>▼ Move down</button>
            </div>
          )}
        </div>

        {photo && (
          <div className="section">
            <div className="section-title">Photo</div>
            <img className="device-photo" src={photo} alt={d.name} onClick={() => setZoom(true)} />
            {zoom && <Lightbox src={photo} onClose={() => setZoom(false)} />}
          </div>
        )}
        {err && <div className="banner bad" style={{ marginTop: 14 }}>{err}</div>}
      </div>
      <div className="panel-actions">
        <button className="btn primary" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
        {d.rackId && <button className="btn" onClick={unplace}>Remove from rack</button>}
        <span className="grow" />
        <button className="btn danger" onClick={remove}>Delete</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

function PortPanel({ site, idx, deviceId, portKey, onSelect }: InspectorProps & { deviceId: string; portKey: string }) {
  const { backend, modelsById } = useApp();
  const d = idx.devicesById.get(deviceId)!;
  const spec = idx.portSpecs.get(deviceId)?.find(p => p.key === portKey);
  const conns = idx.connsByPort.get(portId(deviceId, portKey)) ?? [];
  const rec = idx.portRecords.get(portId(deviceId, portKey));
  const isPatch = d.type === 'patchpanel';
  const [connIdx, setConnIdx] = useState(0);
  const conn = conns[connIdx] ?? null;

  // port docs
  const [label, setLabel] = useState(rec?.label ?? '');
  const [pnotes, setPNotes] = useState(rec?.notes ?? '');
  const photos = rec?.photos ?? [];
  const [uploading, setUploading] = useState(false);

  // connection form
  const initial = useMemo(() => connForm(conn, idx), [conn, idx]);
  const [target, setTarget] = useState(initial.target);
  const [farPort, setFarPort] = useState(initial.farPort);
  const [external, setExternal] = useState(initial.external);
  const [cableColor, setCableColor] = useState(initial.cableColor);
  const [cableLabel, setCableLabel] = useState(initial.cableLabel);
  const [speed, setSpeed] = useState(initial.speed);
  const [poe, setPoe] = useState(initial.poe);
  const [poeWatts, setPoeWatts] = useState(initial.poeWatts);
  const [status, setStatus] = useState<Status>(initial.status);
  const [notes, setNotes] = useState(initial.notes);
  const [err, setErr] = useState('');
  const [saved, markSaved] = useSaved();

  useEffect(() => {
    setTarget(initial.target); setFarPort(initial.farPort); setExternal(initial.external);
    setCableColor(initial.cableColor); setCableLabel(initial.cableLabel); setSpeed(initial.speed);
    setPoe(initial.poe); setPoeWatts(initial.poeWatts); setStatus(initial.status); setNotes(initial.notes);
  }, [initial]);

  const targetDevice = target.startsWith('dev:') ? idx.devicesById.get(target.slice(4)) : undefined;
  const targetKeys = targetDevice ? idx.portSpecs.get(targetDevice.id)?.map(p => p.key) ?? [] : [];
  const span = conn ? linkSpan(idx, conn) : [];
  const placed = site.devices.filter(x => x.id !== deviceId && x.rackId);
  const unplacedDevs = site.devices.filter(x => x.id !== deviceId && !x.rackId);

  const portRecord = (over: Partial<PortRecord>): PortRecord => ({
    propertyId: site.property.id, deviceId, portKey, label: rec?.label ?? '', notes: rec?.notes ?? '', photos, ...over,
  });

  const save = async () => {
    setErr('');
    try {
      if (label !== (rec?.label ?? '') || pnotes !== (rec?.notes ?? '')) {
        await backend.savePort(portRecord({ label: label.trim(), notes: pnotes }));
      }
      const watts = poeWatts.trim() === '' ? null : Number(poeWatts);
      if (watts != null && Number.isNaN(watts)) { setErr('PoE watts must be a number.'); return; }
      if (target === '') {
        if (conn) {
          await backend.deleteLink(site.property.id, conn.link.id);
          await backend.logActivity(site.property.id, `Disconnected ${d.name} port ${portKey}.`);
        }
      } else {
        if (target === 'ext' && !external.trim()) { setErr('Describe where the cable goes.'); return; }
        // Written from this port's point of view. Legacy multi-port entries keep their original port text.
        const thisSide = span.length > 1 && conn ? (conn.side === 'from' ? conn.link.fromPort : conn.link.toPort) : portKey;
        const fields: Omit<Link, 'propertyId' | 'id'> = {
          fromDevice: deviceId, fromPort: thisSide,
          toDevice: targetDevice ? targetDevice.id : null,
          toPort: targetDevice ? farPort.trim() : '',
          toExternal: targetDevice ? '' : external.trim(),
          cableColor, cableLabel: cableLabel.trim(), speed, poe, poeWatts: poe ? watts : null, status, notes,
        };
        const toText = targetDevice ? `${targetDevice.name}${farPort ? ` port ${farPort}` : ''}` : external.trim();
        if (conn) {
          await backend.updateLink(site.property.id, conn.link.id, fields);
          await backend.logActivity(site.property.id, `Updated ${d.name} port ${portKey} → ${toText}.`);
        } else {
          await backend.createLink({ propertyId: site.property.id, id: genId(), ...fields });
          await backend.logActivity(site.property.id, `Connected ${d.name} port ${portKey} → ${toText}.`);
        }
      }
      markSaved();
    } catch (e) { setErr(errorText(e)); }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const added = [];
      for (const f of Array.from(files)) {
        const blob = await compressImage(f);
        added.push(await backend.uploadPhoto(site.property.id, deviceId, portKey, blob, f.name));
      }
      await backend.savePort(portRecord({ photos: [...photos, ...added] }));
      await backend.logActivity(site.property.id, `Added ${added.length} photo${added.length > 1 ? 's' : ''} to ${d.name} port ${portKey}.`);
    } catch (e) { setErr(errorText(e)); }
    setUploading(false);
  };

  const removePhoto = async (path: string) => {
    if (!confirm('Remove this photo?')) return;
    try {
      await backend.savePort(portRecord({ photos: photos.filter(p => p.path !== path) }));
      // imported photos can be shared between ports — only delete the image once nothing uses it
      const sharedElsewhere = site.ports.some(p =>
        !(p.deviceId === deviceId && p.portKey === portKey) && p.photos.some(x => x.path === path));
      if (!sharedElsewhere) await backend.deletePhoto(path).catch(() => undefined);
    } catch (e) { setErr(errorText(e)); }
  };

  const specLine = spec
    ? [spec.kind === 'rj45' ? 'RJ45' : spec.kind.toUpperCase(), spec.speed, spec.poe !== 'none' ? POE_LABEL[spec.poe] : ''].filter(Boolean).join(' · ')
    : 'Port not in this model';
  const targetModel = targetDevice?.modelId ? modelsById.get(targetDevice.modelId) : undefined;

  return (
    <>
      <div className="panel-head">
        <div className="small muted"><button className="btn ghost sm" style={{ padding: '0 4px', marginLeft: -4 }} onClick={() => onSelect({ type: 'device', deviceId })}>← {d.name}</button></div>
        <h2>Port {portKey}</h2>
        <div className="sub mono">{specLine}</div>
      </div>
      <div className="panel-scroll">
        {conns.length > 1 && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            {conns.length} connections are documented on this port. Editing:
            <select style={{ marginTop: 6 }} value={connIdx} onChange={e => setConnIdx(Number(e.target.value))}>
              {conns.map((c, i) => <option key={c.link.id} value={i}>{farEndLabel(farEnd(idx, c)).title}</option>)}
            </select>
          </div>
        )}

        <div className="section stack">
          <div className="section-title">Connection</div>
          <Field label="Plugged into">
            <select value={target} onChange={e => { setTarget(e.target.value); setFarPort(''); }}>
              <option value="">Not connected</option>
              {placed.length > 0 && (
                <optgroup label="In a rack">
                  {placed.map(x => <option key={x.id} value={`dev:${x.id}`}>{x.name}</option>)}
                </optgroup>
              )}
              {unplacedDevs.length > 0 && (
                <optgroup label="Other devices at this site">
                  {unplacedDevs.map(x => <option key={x.id} value={`dev:${x.id}`}>{x.name}</option>)}
                </optgroup>
              )}
              <option value="ext">Somewhere else (not tracked)…</option>
            </select>
          </Field>
          {targetDevice && (
            targetKeys.length ? (
              <Field label={`${targetDevice.name} port`} hint={targetModel ? modelLabel(targetModel) : undefined}>
                <select value={targetKeys.includes(farPort) ? farPort : farPort ? '__text' : ''} onChange={e => setFarPort(e.target.value === '__text' ? farPort : e.target.value)}>
                  <option value="">—</option>
                  {targetKeys.map(k => {
                    const busy = (idx.connsByPort.get(portId(targetDevice.id, k)) ?? []).some(c => c.link.id !== conn?.link.id);
                    return <option key={k} value={k}>{k}{busy ? '  • in use' : ''}</option>;
                  })}
                  {farPort && !targetKeys.includes(farPort) && <option value="__text">{farPort} (as written)</option>}
                </select>
              </Field>
            ) : (
              <Field label={`${targetDevice.name} port`} hint="free text — this device has no model yet">
                <input value={farPort} onChange={e => setFarPort(e.target.value)} placeholder="e.g. LAN, eth0" />
              </Field>
            )
          )}
          {target === 'ext' && (
            <Field label="Goes to"><input value={external} onChange={e => setExternal(e.target.value)} placeholder="Room 214 wall plate, ISP hand-off…" /></Field>
          )}
          {span.length > 1 && <div className="banner info small">This connection was documented for ports {span.join(', ')} together. Changes apply to all of them.</div>}

          {target !== '' && (
            <>
              <Field label="Cable color"><CableSwatches value={cableColor} onChange={setCableColor} /></Field>
              <div className="row">
                <Field label="Cable label"><input className="mono" value={cableLabel} onChange={e => setCableLabel(e.target.value)} placeholder="e.g. WVB-101" /></Field>
                <Field label="Speed">
                  <select value={speed} onChange={e => setSpeed(e.target.value)}>
                    {SPEEDS.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                  </select>
                </Field>
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                <label className="check shrink">
                  <input type="checkbox" checked={poe} onChange={e => setPoe(e.target.checked)} />
                  Powers a device (PoE)
                </label>
                {poe && <Field label="Watts"><input type="number" step="0.1" min={0} value={poeWatts} onChange={e => setPoeWatts(e.target.value)} /></Field>}
              </div>
              {poe && spec && spec.poe === 'none' && <div className="banner warn small">This port isn't PoE-capable in its model, so it won't light amber.</div>}
              <Field label="Status">
                <select value={status} onChange={e => setStatus(e.target.value as Status)}>
                  {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Connection notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
            </>
          )}
        </div>

        <div className="section stack">
          <div className="section-title">Port</div>
          <Field label={isPatch ? 'Room / plate label' : 'Label'}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder={isPatch ? 'Rm 214' : 'e.g. what the sticker says'} />
          </Field>
          <Field label="Port notes"><textarea value={pnotes} onChange={e => setPNotes(e.target.value)} /></Field>
        </div>

        <div className="section">
          <div className="section-title">Photos {uploading && <span className="spinner" />}</div>
          <div className="photos">
            {photos.map(p => <PhotoThumb key={p.path} backend={backend} path={p.path} onRemove={() => removePhoto(p.path)} />)}
            <label className="photo-add">
              <input type="file" accept="image/*" multiple hidden onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }} />
              + Add photos
            </label>
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>Photos save as soon as they're added.</div>
        </div>
        {err && <div className="banner bad" style={{ marginTop: 14 }}>{err}</div>}
      </div>
      <div className="panel-actions">
        <button className="btn primary" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
        {conn && <button className="btn" onClick={() => onSelect({ type: 'link', linkId: conn.link.id })}>View cable</button>}
      </div>
    </>
  );
}

function connForm(conn: PortConn | null, idx: SiteIndex) {
  if (!conn) {
    return { target: '', farPort: '', external: '', cableColor: '', cableLabel: '', speed: '', poe: false, poeWatts: '', status: 'confirmed' as Status, notes: '' };
  }
  const fe = farEnd(idx, conn);
  const l = conn.link;
  return {
    target: fe.device ? `dev:${fe.device.id}` : 'ext',
    farPort: fe.keys.length === 1 ? fe.keys[0] : fe.portText,
    external: fe.external,
    cableColor: l.cableColor, cableLabel: l.cableLabel, speed: l.speed, poe: l.poe,
    poeWatts: l.poeWatts == null ? '' : String(l.poeWatts), status: l.status, notes: l.notes,
  };
}

// ---------------------------------------------------------------------------
// Cable
// ---------------------------------------------------------------------------

function LinkPanel({ site, idx, linkId, onSelect }: InspectorProps & { linkId: string }) {
  const { backend } = useApp();
  const l = site.links.find(x => x.id === linkId)!;
  const k = idx.linkKeys.get(linkId) ?? { from: [], to: [] };
  const from = idx.devicesById.get(l.fromDevice);
  const to = l.toDevice ? idx.devicesById.get(l.toDevice) : null;
  const del = async () => {
    if (!confirm('Delete this connection?')) return;
    try {
      await backend.deleteLink(site.property.id, linkId);
      await backend.logActivity(site.property.id, `Removed the cable from ${from?.name ?? 'a device'}.`);
      onSelect(null);
    } catch (e) { alert(errorText(e)); }
  };
  const end = (deviceName: string, keys: string[], text: string, deviceId: string | null) => (
    <div className="list-item" style={{ cursor: keys.length === 1 && deviceId ? 'pointer' : 'default' }}
      onClick={() => { if (keys.length === 1 && deviceId) onSelect({ type: 'port', deviceId, key: keys[0] }); }}>
      <span className={`led ${keys.length ? 'on' : ''}`} />
      <span className="grow">
        <div className="title">{deviceName}</div>
        <div className="meta">{keys.length === 1 ? `Port ${keys[0]}` : text || 'No port recorded'}</div>
      </span>
    </div>
  );
  return (
    <>
      <div className="panel-head">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <h2>Cable{l.cableLabel ? ` “${l.cableLabel}”` : ''}</h2>
          <StatusPill status={l.status} />
        </div>
        <div className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {l.cableColor && <span className="swatch" style={{ background: CABLE_HEX[l.cableColor] }} />}
          {[l.cableColor, l.speed, l.poe ? `PoE${l.poeWatts != null ? ` ${l.poeWatts} W` : ''}` : ''].filter(Boolean).join(' · ') || 'No cable details yet'}
        </div>
      </div>
      <div className="panel-scroll">
        <div className="section">
          <div className="section-title">Ends</div>
          <div className="list">
            {end(from?.name ?? l.fromDevice, k.from, l.fromPort, l.fromDevice)}
            {to ? end(to.name, k.to, l.toPort, to.id) : end(l.toExternal || 'Untracked destination', [], '', null)}
          </div>
        </div>
        {l.notes && <div className="section"><div className="section-title">Notes</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{l.notes}</div></div>}
      </div>
      <div className="panel-actions">
        <span className="grow" />
        <button className="btn danger" onClick={del}>Delete connection</button>
      </div>
    </>
  );
}
