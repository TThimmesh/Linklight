import type { Device, EquipmentModel, Link, PortRecord, Rack, SiteData } from './types';
import { expandPorts, resolvePortRefs, type PortSpec } from './ports';

export const portId = (deviceId: string, key: string) => `${deviceId}\u0000${key}`;

export interface PortConn {
  link: Link;
  /** Which end of the link this port is. */
  side: 'from' | 'to';
}

export interface FarEnd {
  device: Device | null;
  /** Resolved port keys on the far device (empty if free text or untracked). */
  keys: string[];
  /** Raw port text as written in the link. */
  portText: string;
  external: string;
}

export interface SiteIndex {
  devicesById: Map<string, Device>;
  modelsById: Map<string, EquipmentModel>;
  portSpecs: Map<string, PortSpec[]>;
  connsByPort: Map<string, PortConn[]>;
  linkKeys: Map<string, { from: string[]; to: string[] }>;
  portRecords: Map<string, PortRecord>;
}

export function buildIndex(site: SiteData, models: EquipmentModel[]): SiteIndex {
  const modelsById = new Map(models.map(m => [m.id, m]));
  const devicesById = new Map(site.devices.map(d => [d.id, d]));
  const portSpecs = new Map<string, PortSpec[]>();
  for (const d of site.devices) {
    const m = d.modelId ? modelsById.get(d.modelId) : undefined;
    if (m) portSpecs.set(d.id, expandPorts(m));
  }
  const keysOf = (deviceId: string | null) =>
    (deviceId && portSpecs.get(deviceId)?.map(p => p.key)) || [];

  const connsByPort = new Map<string, PortConn[]>();
  const linkKeys = new Map<string, { from: string[]; to: string[] }>();
  const add = (deviceId: string, key: string, conn: PortConn) => {
    const id = portId(deviceId, key);
    const list = connsByPort.get(id);
    if (list) list.push(conn); else connsByPort.set(id, [conn]);
  };
  for (const l of site.links) {
    const from = resolvePortRefs(l.fromPort, keysOf(l.fromDevice));
    const to = l.toDevice ? resolvePortRefs(l.toPort, keysOf(l.toDevice)) : [];
    linkKeys.set(l.id, { from, to });
    for (const k of from) add(l.fromDevice, k, { link: l, side: 'from' });
    if (l.toDevice) for (const k of to) add(l.toDevice, k, { link: l, side: 'to' });
  }

  const portRecords = new Map(site.ports.map(p => [portId(p.deviceId, p.portKey), p]));
  return { devicesById, modelsById, portSpecs, connsByPort, linkKeys, portRecords };
}

export function farEnd(idx: SiteIndex, conn: PortConn): FarEnd {
  const l = conn.link;
  const keys = idx.linkKeys.get(l.id) ?? { from: [], to: [] };
  if (conn.side === 'from') {
    return {
      device: l.toDevice ? idx.devicesById.get(l.toDevice) ?? null : null,
      keys: keys.to,
      portText: l.toPort,
      external: l.toDevice ? '' : l.toExternal,
    };
  }
  return {
    device: idx.devicesById.get(l.fromDevice) ?? null,
    keys: keys.from,
    portText: l.fromPort,
    external: '',
  };
}

export function farEndLabel(fe: FarEnd): { title: string; port: string } {
  if (!fe.device) return { title: fe.external || 'Untracked destination', port: '' };
  const port = fe.keys.length === 1 ? `Port ${fe.keys[0]}` : fe.portText ? fe.portText : '';
  return { title: fe.device.name, port };
}

/** The ports a link covers on this side — more than one for legacy entries like "1–10". */
export function linkSpan(idx: SiteIndex, conn: PortConn): string[] {
  const k = idx.linkKeys.get(conn.link.id);
  if (!k) return [];
  return conn.side === 'from' ? k.from : k.to;
}

// ---------------------------------------------------------------------------
// Rack placement
// ---------------------------------------------------------------------------

export const U = 1.75;
export const RACK_INNER_W = 17.5;
export const RAIL_W = 19;
export const DESKTOP_GAP = 0.3;

export interface Placement {
  device: Device;
  model: EquipmentModel | null;
  /** Center x of the device body. */
  x: number;
  /** Bottom y of the device's U span. */
  y0: number;
  units: number;
  width: number;
  height: number;
  depth: number;
  desktop: boolean;
}

export function deviceUnits(m: EquipmentModel | null | undefined): number {
  return m ? Math.max(1, m.rackUnits) : 1;
}

export function layoutRack(rack: Rack, devices: Device[], modelsById: Map<string, EquipmentModel>): Placement[] {
  const inRack = devices
    .filter(d => d.rackId === rack.id && d.rackU != null)
    .sort((a, b) => (a.rackU! - b.rackU!) || a.name.localeCompare(b.name));
  const desktopCursor = new Map<number, number>();
  return inRack.map(d => {
    const model = d.modelId ? modelsById.get(d.modelId) ?? null : null;
    const units = deviceUnits(model);
    const desktop = model?.formFactor === 'desktop';
    const y0 = (d.rackU! - 1) * U;
    if (desktop) {
      const width = Math.min(RACK_INNER_W - 0.2, model!.widthIn);
      const left = desktopCursor.get(d.rackU!) ?? -RACK_INNER_W / 2 + 0.2;
      desktopCursor.set(d.rackU!, left + width + DESKTOP_GAP);
      return {
        device: d, model, units, desktop,
        x: left + width / 2, y0, width,
        height: units * U * 0.72, depth: model!.depthIn,
      };
    }
    return {
      device: d, model, units, desktop: false,
      x: 0, y0, width: RACK_INNER_W,
      height: units * U - 0.04, depth: model?.depthIn ?? 10,
    };
  });
}

export interface FitCheck { ok: boolean; reason?: string }

/** Can `model` go at U `u` in `rack`, ignoring `ignoreDeviceId` (when moving)? */
export function checkFit(
  rack: Rack, u: number, model: EquipmentModel, devices: Device[],
  modelsById: Map<string, EquipmentModel>, ignoreDeviceId?: string,
): FitCheck {
  if (model.formFactor === 'offrack') return { ok: false, reason: 'This model is off-rack gear (e.g. an AP) and can\'t go in a rack.' };
  const units = deviceUnits(model);
  if (u < 1 || u + units - 1 > rack.units) return { ok: false, reason: `Needs U${u}–U${u + units - 1}, but this rack only has ${rack.units}U.` };
  const others = devices.filter(d => d.rackId === rack.id && d.rackU != null && d.id !== ignoreDeviceId);
  let desktopWidth = 0;
  for (const d of others) {
    const m = d.modelId ? modelsById.get(d.modelId) ?? null : null;
    const du = deviceUnits(m);
    const overlaps = d.rackU! <= u + units - 1 && u <= d.rackU! + du - 1;
    if (!overlaps) continue;
    const bothDesktop = model.formFactor === 'desktop' && m?.formFactor === 'desktop' && d.rackU === u && du === units;
    if (!bothDesktop) return { ok: false, reason: `That space is taken by ${d.name}.` };
    desktopWidth += m!.widthIn + DESKTOP_GAP;
  }
  if (model.formFactor === 'desktop' && desktopWidth + model.widthIn > RACK_INNER_W - 0.2) {
    return { ok: false, reason: 'Not enough shelf width left at that U.' };
  }
  return { ok: true };
}

export function firstFreeU(rack: Rack, model: EquipmentModel, devices: Device[], modelsById: Map<string, EquipmentModel>): number | null {
  for (let u = rack.units - deviceUnits(model) + 1; u >= 1; u--) {
    if (checkFit(rack, u, model, devices, modelsById).ok) return u;
  }
  return null;
}

/** Which U numbers have no rack-mounted gear (desktop shelves count as occupied). */
export function emptyUnits(rack: Rack, placements: Placement[]): number[] {
  const used = new Set<number>();
  for (const p of placements) for (let i = 0; i < p.units; i++) used.add(p.device.rackU! + i);
  const out: number[] = [];
  for (let u = 1; u <= rack.units; u++) if (!used.has(u)) out.push(u);
  return out;
}

/** Guess a library model for an existing (e.g. imported) device from its name/model/notes. */
export function guessModel(d: Device, models: EquipmentModel[]): EquipmentModel | null {
  const hay = `${d.name} ${d.model} ${d.notes}`.toLowerCase();
  let best: EquipmentModel | null = null;
  let bestScore = 0;
  for (const m of models) {
    if (m.category !== d.type && !(d.type === 'external' && m.category === 'router')) continue;
    const tokens = `${m.manufacturer} ${m.name}`.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && t !== 'generic' && t !== 'port');
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += t.length;
    if (m.category === d.type) score += 1;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}
