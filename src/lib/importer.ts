import type { ImportBundle } from './backend';
import { genId, nowIso } from './ids';
import { settings } from './settings';
import type { PortRecord, Rack, RackKind, Status } from './types';

// Carries data over from the original Supabase-backed Patchwork app. Reading
// happens in the browser with the person's own Patchwork login, so no service
// keys are involved; the old database is only read, never changed.

/** Optional defaults for the import form, from config.js (see public/config.example.js). */
export const LEGACY_SUPABASE = {
  url: settings.patchworkImport?.supabaseUrl ?? '',
  key: settings.patchworkImport?.supabaseKey ?? '',
};

/**
 * Optional rack plan: arranges imported devices into racks. Kept in
 * src/data/migration-plan.local.json (gitignored) because it describes real
 * sites — see docs/migration-plan.example.json for the format.
 */
export interface MigrationPlan {
  racks: { property: string; id: string; name: string; location: string; kind: string; units: number; sort: number; notes: string }[];
  newDevices: { property: string; id: string; name: string; type: string; group: string; notes: string }[];
  placements: { property: string; device: string; model: string; rack?: string; u?: number }[];
  poeLinks: { property: string; link: string }[];
  linkFixes: { property: string; link: string; ifToPort?: string; toPort?: string; cableLabel?: string }[];
  portLabels: { property: string; device: string; port: string; label: string }[];
}

const EMPTY_PLAN: MigrationPlan = { racks: [], newDevices: [], placements: [], poeLinks: [], linkFixes: [], portLabels: [] };
const planFiles = import.meta.glob<{ default: Partial<MigrationPlan> }>('../data/migration-plan.local.json', { eager: true });
const plan: MigrationPlan = { ...EMPTY_PLAN, ...(Object.values(planFiles)[0]?.default ?? {}) };

/** Which properties the local rack plan covers (empty when there's no plan file). */
export const plannedProperties = [...new Set(plan.racks.map(r => r.property))];

type Row = Record<string, unknown>;

export interface LegacyData {
  properties: Row[];
  devices: Row[];
  links: Row[];
  activity: Row[];
}

export async function readLegacy(email: string, password: string, url = LEGACY_SUPABASE.url, key = LEGACY_SUPABASE.key): Promise<LegacyData> {
  if (!url || !key) throw new Error('Enter the Supabase URL and publishable key of the Patchwork project to import from.');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Old Patchwork sign-in failed: ${authError.message}`);
  const all = async (table: string): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select('*').range(from, from + 999);
      if (error) throw new Error(`Reading ${table}: ${error.message}`);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  try {
    const [properties, devices, links, activity] = await Promise.all([all('properties'), all('devices'), all('links'), all('activity')]);
    return { properties, devices, links, activity };
  } finally {
    await client.auth.signOut();
  }
}

export interface ImportOptions {
  /** Arrange devices into racks using the local rack plan, if there is one. */
  arrange: boolean;
  /** Carry over saved device credentials. */
  credentials: boolean;
}

export interface BundleReport {
  propertyId: string;
  name: string;
  devices: number;
  links: number;
  photos: number;
  racks: number;
  placed: number;
  /** Planned placements whose device wasn't found (renamed or deleted since). */
  missing: string[];
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const status = (v: unknown): Status => (v === 'confirmed' || v === 'flagged' ? v : 'to-confirm');

export function buildBundles(legacy: LegacyData, opts: ImportOptions): { bundles: ImportBundle[]; reports: BundleReport[] } {
  const bundles: ImportBundle[] = [];
  const reports: BundleReport[] = [];
  for (const p of legacy.properties) {
    const pid = s(p.id);
    const bundle: ImportBundle = {
      property: {
        id: pid, name: s(p.name) || pid, code: s(p.code), address: s(p.address),
        owningLLC: s(p.owning_llc), preparedBy: s(p.prepared_by), notes: s(p.notes), findings: arr(p.findings),
        createdAt: s(p.created_at) || nowIso(), updatedAt: s(p.updated_at) || nowIso(),
      },
      racks: [],
      devices: legacy.devices.filter(d => d.property_id === pid).map(d => ({
        propertyId: pid, id: s(d.id), name: s(d.name), type: s(d.type) || 'endpoint', groupName: s(d.group_name),
        location: s(d.location), status: status(d.status), notes: s(d.notes), model: s(d.model),
        modelId: null, rackId: null, rackU: null, ip: s(d.ip), mac: s(d.mac), photoId: null,
        tags: arr(d.tags), credentials: opts.credentials ? arr(d.credentials) : [],
        photoData: typeof d.photo === 'string' && d.photo.startsWith('data:image') ? d.photo : null,
      })),
      links: legacy.links.filter(l => l.property_id === pid).map(l => ({
        propertyId: pid, id: s(l.id), fromDevice: s(l.from_device), toDevice: l.to_device ? s(l.to_device) : null,
        toExternal: s(l.to_external), fromPort: s(l.from_port), toPort: s(l.to_port), cableColor: s(l.cable_color),
        status: status(l.status), notes: s(l.notes), cableLabel: s(l.cable_label), speed: s(l.speed),
        poe: l.poe === true, poeWatts: l.poe_watts == null ? null : Number(l.poe_watts),
      })),
      ports: [],
      activity: legacy.activity.filter(a => a.property_id === pid).map(a => ({ id: s(a.id), text: s(a.text), ts: s(a.ts) || nowIso() })),
    };
    const report: BundleReport = {
      propertyId: pid, name: bundle.property.name, devices: bundle.devices.length, links: bundle.links.length,
      photos: bundle.devices.filter(d => d.photoData).length, racks: 0, placed: 0, missing: [],
    };
    if (opts.arrange) applyPlan(bundle, report);
    bundle.activity.push({ id: genId(), text: 'Imported from the original Patchwork into Linklight.', ts: nowIso() });
    bundles.push(bundle);
    reports.push(report);
  }
  return { bundles, reports };
}

/** Model ids the plan places devices as — these must exist in the library before importing. */
export function plannedModelIds(): string[] {
  return [...new Set(plan.placements.map(p => p.model))];
}

function applyPlan(b: ImportBundle, report: BundleReport) {
  const pid = b.property.id;
  const mine = <T extends { property: string }>(xs: T[]) => xs.filter(x => x.property === pid);

  for (const r of mine(plan.racks)) {
    const rack: Rack = { propertyId: pid, id: r.id, name: r.name, location: r.location, kind: r.kind as RackKind, units: r.units, sort: r.sort, notes: r.notes };
    b.racks.push(rack);
  }
  report.racks = b.racks.length;

  for (const n of mine(plan.newDevices)) {
    if (b.devices.some(d => d.id === n.id)) continue;
    b.devices.push({
      propertyId: pid, id: n.id, name: n.name, type: n.type, groupName: n.group, location: n.group, status: 'to-confirm',
      notes: n.notes, model: '', modelId: null, rackId: null, rackU: null, ip: '', mac: '', photoId: null,
      tags: [], credentials: [], photoData: null,
    });
  }

  for (const p of mine(plan.placements)) {
    const d = b.devices.find(x => x.id === p.device);
    if (!d) { report.missing.push(p.device); continue; }
    d.modelId = p.model;
    if (p.rack && p.u) { d.rackId = p.rack; d.rackU = p.u; }
    report.placed++;
  }

  for (const x of mine(plan.poeLinks)) {
    const l = b.links.find(y => y.id === x.link);
    if (l) l.poe = true;
  }

  for (const x of mine(plan.linkFixes)) {
    const l = b.links.find(y => y.id === x.link);
    if (!l) continue;
    if (x.toPort && (x.ifToPort === undefined || l.toPort === x.ifToPort)) l.toPort = x.toPort;
    if (x.cableLabel && !l.cableLabel) l.cableLabel = x.cableLabel;
  }

  for (const x of mine(plan.portLabels)) {
    if (!b.devices.some(d => d.id === x.device)) continue;
    const rec: PortRecord = { propertyId: pid, deviceId: x.device, portKey: x.port, label: x.label, notes: '', photos: [] };
    b.ports.push(rec);
  }
}
