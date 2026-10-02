import { useMemo, useState } from 'react';
import { genId } from '../lib/ids';
import { checkFit, firstFreeU, guessModel } from '../lib/site';
import { portSummary } from '../lib/ports';
import {
  DEVICE_TYPES, RACK_KINDS, STATUSES, modelLabel,
  type Device, type EquipmentModel, type Property, type Rack, type RackKind, type SiteData, type Status,
} from '../lib/types';
import { Field, Modal, errorText, useApp } from './ui';

// ---------------------------------------------------------------------------

export function NewSiteDialog({ onClose, onCreated }: { onClose(): void; onCreated(p: Property): void }) {
  const { backend } = useApp();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!name.trim()) { setErr('Give the site a name.'); return; }
    setBusy(true);
    try {
      const p: Property = { id: genId(), name: name.trim(), code: code.trim().toUpperCase(), address: address.trim() };
      await backend.createProperty(p);
      await backend.logActivity(p.id, 'Site created in the rack view.');
      onCreated(p);
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="New site" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>Create site</button>
    </>}>
      <div className="stack">
        <Field label="Property name"><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Main Street Office" /></Field>
        <div className="row">
          <Field label="Code"><input value={code} onChange={e => setCode(e.target.value)} placeholder="MSO" className="mono" /></Field>
        </div>
        <Field label="Address"><input value={address} onChange={e => setAddress(e.target.value)} /></Field>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function RackDialog({ propertyId, racks, rack, onClose, onSaved }: {
  propertyId: string; racks: Rack[]; rack?: Rack; onClose(): void; onSaved(r: Rack): void;
}) {
  const { backend } = useApp();
  const [name, setName] = useState(rack?.name ?? (racks.length ? `Rack ${racks.length + 1}` : 'Main Rack'));
  const [location, setLocation] = useState(rack?.location ?? (racks[0]?.location ?? 'MDF'));
  const [kind, setKind] = useState<RackKind>(rack?.kind ?? 'floor');
  const [units, setUnits] = useState(String(rack?.units ?? 42));
  const [notes, setNotes] = useState(rack?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locations = [...new Set(racks.map(r => r.location).filter(Boolean))];

  const pickKind = (k: RackKind) => {
    setKind(k);
    if (!rack) setUnits(String(RACK_KINDS.find(x => x.v === k)!.defaultUnits));
  };

  const save = async () => {
    const u = Math.floor(Number(units));
    if (!name.trim()) { setErr('Give the rack a name.'); return; }
    if (!(u >= 1 && u <= 60)) { setErr('Height must be between 1 and 60U.'); return; }
    setBusy(true);
    try {
      const r: Rack = {
        propertyId, id: rack?.id ?? genId(), name: name.trim(), location: location.trim(), kind, units: u,
        sort: rack?.sort ?? racks.length, notes,
      };
      await backend.saveRack(r, !rack);
      await backend.logActivity(propertyId, rack ? `Updated rack “${r.name}”.` : `Added rack “${r.name}” (${u}U, ${location || 'no location'}).`);
      onSaved(r);
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };

  return (
    <Modal title={rack ? 'Edit rack' : 'Add a rack'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>{rack ? 'Save' : 'Add rack'}</button>
    </>}>
      <div className="stack">
        <Field label="Type">
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {RACK_KINDS.map(k => (
              <button type="button" key={k.v} className={kind === k.v ? 'on' : ''} onClick={() => pickKind(k.v)}>{k.label}</button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label="Name"><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Height" hint="U"><input type="number" min={1} max={60} value={units} onChange={e => setUnits(e.target.value)} /></Field>
        </div>
        <Field label="Closet / location" hint="racks with the same location are grouped">
          <input list="rack-locations" value={location} onChange={e => setLocation(e.target.value)} placeholder="1st Floor MDF" />
          <datalist id="rack-locations">{locations.map(l => <option key={l} value={l} />)}</datalist>
        </Field>
        <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function AddDeviceDialog({ site, rackId, u, existing, onClose, onSaved }: {
  site: SiteData;
  rackId: string | null;
  u: number | null;
  /** Place an existing (unplaced) device instead of creating a new one. */
  existing?: Device;
  onClose(): void;
  onSaved(deviceId: string, rackId: string | null): void;
}) {
  const { backend, models, modelsById } = useApp();
  const unplaced = site.devices.filter(d => !d.rackId);
  const [mode, setMode] = useState<'new' | 'existing'>(existing ? 'existing' : 'new');
  const [existingId, setExistingId] = useState(existing?.id ?? '');
  const ex = site.devices.find(d => d.id === existingId);
  const [modelId, setModelId] = useState<string>(() => (existing ? (existing.modelId ?? guessModel(existing, models)?.id ?? '') : ''));
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('confirmed');
  const [targetRack, setTargetRack] = useState(rackId ?? site.racks[0]?.id ?? '');
  const [uText, setUText] = useState(u ? String(u) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const model = modelsById.get(modelId);
  const rack = site.racks.find(r => r.id === targetRack);
  const offrack = model?.formFactor === 'offrack';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(m => !q || `${m.manufacturer} ${m.name} ${m.category}`.toLowerCase().includes(q));
  }, [models, query]);

  const effectiveU = (() => {
    if (uText.trim()) return Math.floor(Number(uText));
    if (rack && model && !offrack) return firstFreeU(rack, model, site.devices, modelsById);
    return null;
  })();
  const fit = rack && model && !offrack && effectiveU
    ? checkFit(rack, effectiveU, model, site.devices, modelsById, mode === 'existing' ? existingId : undefined)
    : null;

  const pickModel = (m: EquipmentModel) => {
    setModelId(m.id);
    if (!name.trim() || models.some(x => modelLabel(x) === name)) setName(modelLabel(m));
  };

  const pickExisting = (id: string) => {
    setExistingId(id);
    const d = site.devices.find(x => x.id === id);
    if (d && !modelId) setModelId(d.modelId ?? guessModel(d, models)?.id ?? '');
  };

  const save = async () => {
    setErr('');
    if (!model) { setErr('Pick an equipment model.'); return; }
    if (mode === 'existing' && !ex) { setErr('Pick the device to place.'); return; }
    if (!offrack) {
      if (!rack) { setErr('Add a rack first.'); return; }
      if (!effectiveU) { setErr('There\'s no free space for this in the rack.'); return; }
      if (fit && !fit.ok) { setErr(fit.reason ?? 'Doesn\'t fit there.'); return; }
    }
    setBusy(true);
    try {
      const place = offrack ? { rackId: null, rackU: null } : { rackId: rack!.id, rackU: effectiveU! };
      const where = offrack ? '' : `${rack!.name}, U${effectiveU}`;
      if (mode === 'existing') {
        await backend.updateDevice(site.property.id, ex!.id, {
          modelId: model.id, ...place,
          ...(ex!.model ? {} : { model: modelLabel(model) }),
        });
        await backend.logActivity(site.property.id, offrack ? `Set ${ex!.name}'s model to ${modelLabel(model)}.` : `Placed ${ex!.name} in ${where}.`);
        onSaved(ex!.id, place.rackId);
      } else {
        const d: Device = {
          propertyId: site.property.id, id: genId(), name: name.trim() || modelLabel(model), type: model.category,
          groupName: rack?.location ?? '', location: where, status, notes: '', model: modelLabel(model),
          modelId: model.id, ...place, ip: '', mac: '',
        };
        await backend.createDevice(d);
        await backend.logActivity(site.property.id, `Added ${d.name} (${modelLabel(model)})${where ? ` to ${where}` : ''}.`);
        onSaved(d.id, place.rackId);
      }
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };

  return (
    <Modal wide title={mode === 'existing' ? 'Place existing device' : 'Add equipment'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>{mode === 'existing' ? (offrack ? 'Set model' : 'Place in rack') : 'Add to rack'}</button>
    </>}>
      <div className="stack">
        {!existing && unplaced.length > 0 && (
          <div className="seg">
            <button type="button" className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>New equipment</button>
            <button type="button" className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>Existing device ({unplaced.length})</button>
          </div>
        )}

        {mode === 'existing' && (
          <Field label="Device">
            <select value={existingId} onChange={e => pickExisting(e.target.value)} disabled={!!existing}>
              <option value="">Choose…</option>
              {DEVICE_TYPES.map(t => {
                const ds = unplaced.filter(d => d.type === t.v || (existing && d.id === existing.id && d.type === t.v));
                if (!ds.length) return null;
                return <optgroup key={t.v} label={t.label}>{ds.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>;
              })}
            </select>
          </Field>
        )}

        <Field label="Equipment model" hint={model ? portSummary(model) : 'from the shared library'}>
          <input placeholder="Search models…" value={query} onChange={e => setQuery(e.target.value)} />
        </Field>
        <div className="model-pick">
          {filtered.map(m => (
            <button type="button" key={m.id} className={m.id === modelId ? 'on' : ''} onClick={() => pickModel(m)}>
              <div className="t">{modelLabel(m)}</div>
              <div className="m">
                {m.formFactor === 'offrack' ? 'Off-rack' : m.formFactor === 'desktop' ? 'Desktop' : `${m.rackUnits}U`} · {portSummary(m)}
              </div>
            </button>
          ))}
          {!filtered.length && <div className="empty-note">No models match. Add one in the Library.</div>}
        </div>

        {mode === 'new' && (
          <div className="row">
            <Field label="Name" hint="shown on the label tape"><input value={name} onChange={e => setName(e.target.value)} placeholder={model ? modelLabel(model) : 'SW01'} /></Field>
            <Field label="Status">
              <select value={status} onChange={e => setStatus(e.target.value as Status)}>
                {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </Field>
          </div>
        )}

        {offrack ? (
          <div className="banner info">Off-rack gear (like APs) isn't placed in a rack — this just records which model it is.</div>
        ) : (
          <div className="row">
            <Field label="Rack">
              <select value={targetRack} onChange={e => { setTargetRack(e.target.value); setUText(''); }}>
                {site.racks.map(r => <option key={r.id} value={r.id}>{r.name}{r.location ? ` — ${r.location}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Position" hint={model && model.rackUnits > 1 ? 'lowest U' : 'U'}>
              <input type="number" min={1} max={rack?.units ?? 60} value={uText} placeholder={effectiveU ? String(effectiveU) : '—'} onChange={e => setUText(e.target.value)} />
            </Field>
          </div>
        )}
        {fit && !fit.ok && <div className="banner warn">{fit.reason}</div>}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
