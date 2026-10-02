import type { ImportBundle } from './backend';
import { genId, nowIso } from './ids';
import { normalizeModel } from './ports';
import type { Device, EquipmentModel, Link, RackKind, Status } from './types';

// A site file is one JSON document describing a whole property: racks,
// devices, cable runs, port labels and photos (as data URLs). It's produced by
// `npm run site-file` from a folder of notes and photos (see
// docs/site-spec.example.json) and imported from the app's Import page.

export interface SiteFile {
  linklightSite: 1;
  /** Equipment models the site uses. Added to the library if they're missing; existing ones are left alone. */
  models?: Partial<EquipmentModel>[];
  property: { id: string; name: string; code?: string; address?: string; notes?: string; preparedBy?: string };
  racks?: { id: string; name: string; location?: string; kind?: RackKind; units?: number; notes?: string }[];
  devices?: (Partial<Device> & { id: string; name: string; photoData?: string | null })[];
  links?: (Partial<Link> & { id?: string; fromDevice: string })[];
  ports?: { deviceId: string; portKey: string; label?: string; notes?: string; photoData?: { name: string; data: string }[] }[];
  activity?: { text: string; ts?: string }[];
}

export interface SiteFileSummary {
  propertyId: string;
  name: string;
  racks: number;
  devices: number;
  placed: number;
  links: number;
  photos: number;
  models: number;
}

const STATUS = new Set<Status>(['confirmed', 'to-confirm', 'flagged']);
const KINDS = new Set<RackKind>(['floor', 'wall', 'open', 'shelf']);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function parseSiteFile(text: string): { bundle: ImportBundle; models: EquipmentModel[]; summary: SiteFileSummary } {
  let f: SiteFile;
  try { f = JSON.parse(text); } catch { throw new Error('That file isn\'t valid JSON.'); }
  if (!f || f.linklightSite !== 1) throw new Error('That isn\'t a Linklight site file (missing "linklightSite": 1).');
  const p = f.property;
  if (!p?.id || !p?.name) throw new Error('The site file needs a property with an id and a name.');
  if (!/^[A-Za-z0-9_-]+$/.test(p.id)) throw new Error('The property id may only use letters, numbers, - and _.');

  const pid = p.id;
  const problems: string[] = [];
  const models = (f.models ?? []).filter(m => m?.id).map(m => normalizeModel(m as EquipmentModel));

  const racks = (f.racks ?? []).map((r, i) => {
    if (!r.id) problems.push(`Rack #${i + 1} has no id.`);
    const kind = r.kind && KINDS.has(r.kind) ? r.kind : 'floor';
    return { propertyId: pid, id: str(r.id), name: str(r.name) || `Rack ${i + 1}`, location: str(r.location), kind, units: Math.max(1, Math.min(60, Number(r.units ?? 42))), sort: i, notes: str(r.notes) };
  });
  const rackIds = new Set(racks.map(r => r.id));

  const seen = new Set<string>();
  const devices = (f.devices ?? []).map(d => {
    if (seen.has(d.id)) problems.push(`Device id "${d.id}" is used twice.`);
    seen.add(d.id);
    if (d.rackId && !rackIds.has(d.rackId)) problems.push(`${d.name} is placed in rack "${d.rackId}", which isn't in the file.`);
    if (d.rackId && !d.rackU) problems.push(`${d.name} has a rack but no U position.`);
    return {
      propertyId: pid, id: d.id, name: d.name, type: str(d.type) || 'endpoint', groupName: str(d.groupName), location: str(d.location),
      status: STATUS.has(d.status as Status) ? (d.status as Status) : 'confirmed', notes: str(d.notes), model: str(d.model),
      modelId: d.modelId ?? null, rackId: d.rackId ?? null, rackU: d.rackU ?? null, ip: str(d.ip), mac: str(d.mac), photoId: null,
      tags: [], credentials: [], photoData: typeof d.photoData === 'string' && d.photoData.startsWith('data:image') ? d.photoData : null,
    };
  });

  const links: Link[] = (f.links ?? []).map((l, i) => {
    if (!seen.has(l.fromDevice)) problems.push(`Cable #${i + 1} starts at "${l.fromDevice}", which isn't a device in the file.`);
    if (l.toDevice && !seen.has(l.toDevice)) problems.push(`Cable #${i + 1} goes to "${l.toDevice}", which isn't a device in the file.`);
    return {
      propertyId: pid, id: l.id || genId(), fromDevice: l.fromDevice, toDevice: l.toDevice ?? null, toExternal: str(l.toExternal),
      fromPort: str(l.fromPort), toPort: str(l.toPort), cableColor: str(l.cableColor), status: STATUS.has(l.status as Status) ? (l.status as Status) : 'confirmed',
      notes: str(l.notes), cableLabel: str(l.cableLabel), speed: str(l.speed), poe: !!l.poe, poeWatts: l.poeWatts == null ? null : Number(l.poeWatts),
    };
  });

  const ports = (f.ports ?? []).map(x => {
    if (!seen.has(x.deviceId)) problems.push(`Port notes for "${x.deviceId}" refer to a device that isn't in the file.`);
    return {
      propertyId: pid, deviceId: x.deviceId, portKey: str(x.portKey), label: str(x.label), notes: str(x.notes), photos: [],
      photoData: (x.photoData ?? []).filter(ph => typeof ph?.data === 'string' && ph.data.startsWith('data:image')),
    };
  });

  if (problems.length) throw new Error(`The site file has problems:\n• ${problems.slice(0, 8).join('\n• ')}${problems.length > 8 ? `\n• …and ${problems.length - 8} more` : ''}`);

  const bundle: ImportBundle = {
    property: {
      id: pid, name: p.name, code: str(p.code), address: str(p.address), owningLLC: '', preparedBy: str(p.preparedBy),
      notes: str(p.notes), findings: [], createdAt: nowIso(), updatedAt: nowIso(),
    },
    racks,
    devices,
    links,
    ports,
    activity: [
      ...(f.activity ?? []).map(a => ({ id: genId(), text: str(a.text), ts: a.ts || nowIso() })),
      { id: genId(), text: 'Imported into Linklight from a site file.', ts: nowIso() },
    ],
  };

  const summary: SiteFileSummary = {
    propertyId: pid,
    name: p.name,
    racks: racks.length,
    devices: devices.length,
    placed: devices.filter(d => d.rackId).length,
    links: links.length,
    photos: devices.filter(d => d.photoData).length + ports.reduce((s, x) => s + x.photoData.length, 0),
    models: models.length,
  };
  return { bundle, models, summary };
}

/** Model ids the site's devices use that are neither in the file nor in the library. */
export function missingModels(bundle: ImportBundle, fileModels: EquipmentModel[], library: EquipmentModel[]): string[] {
  const have = new Set([...fileModels, ...library].map(m => m.id));
  return [...new Set(bundle.devices.map(d => d.modelId).filter((id): id is string => !!id && !have.has(id)))];
}
