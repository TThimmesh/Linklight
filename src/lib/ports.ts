import type { EquipmentModel, PortGroup, PortKind, PoeStandard } from './types';

// ---------------------------------------------------------------------------
// Normalizing library rows (the JSON / DB may omit defaulted fields)
// ---------------------------------------------------------------------------

export function normalizeGroup(g: Partial<PortGroup>, i: number): PortGroup {
  const names = Array.isArray(g.names) ? g.names.map(String).filter(s => s.trim() !== '') : [];
  return {
    id: g.id || `g${i + 1}`,
    label: g.label ?? '',
    kind: (g.kind as PortKind) || 'rj45',
    count: Math.max(0, Math.floor(Number(g.count ?? names.length) || 0)),
    start: Math.floor(Number(g.start ?? 1) || 1),
    prefix: g.prefix ?? '',
    names,
    rows: g.rows === 2 ? 2 : 1,
    order: g.order === 'sequential' ? 'sequential' : 'odd-even',
    blockSize: Math.max(0, Math.floor(Number(g.blockSize ?? 0) || 0)),
    speed: g.speed ?? '1G',
    poePorts: g.poePorts ?? '',
    poeStandard: (g.poeStandard as PoeStandard) || 'none',
  };
}

export function normalizeModel(m: Partial<EquipmentModel> & { id: string }): EquipmentModel {
  const formFactor = m.formFactor === 'desktop' || m.formFactor === 'offrack' ? m.formFactor : 'rack';
  return {
    id: m.id,
    manufacturer: m.manufacturer ?? '',
    name: m.name ?? '',
    category: m.category ?? 'switch',
    formFactor,
    rackUnits: Math.max(1, Math.floor(Number(m.rackUnits ?? 1) || 1)),
    widthIn: Number(m.widthIn ?? (formFactor === 'rack' ? 17.5 : 8)) || 8,
    depthIn: Number(m.depthIn ?? 10) || 10,
    faceColor: m.faceColor || '#2a2f36',
    poeBudgetW: m.poeBudgetW == null || (m.poeBudgetW as unknown) === '' ? null : Number(m.poeBudgetW),
    portGroups: (m.portGroups ?? []).map(normalizeGroup),
    notes: m.notes ?? '',
  };
}

// ---------------------------------------------------------------------------
// Port keys
// ---------------------------------------------------------------------------

export interface PortSpec {
  key: string;
  groupId: string;
  groupLabel: string;
  kind: PortKind;
  speed: string;
  poe: PoeStandard;
}

export function groupKeys(g: PortGroup): string[] {
  if (g.names.length) return g.names;
  return Array.from({ length: g.count }, (_, i) => `${g.prefix}${g.start + i}`);
}

function splitKey(key: string): { prefix: string; num: number | null } {
  const m = key.match(/^(.*?)(\d+)$/);
  if (!m) return { prefix: key.toLowerCase(), num: null };
  return { prefix: m[1].trim().toLowerCase(), num: Number(m[2]) };
}

/**
 * Matches free-text tokens like "1-24", "X1-X4", "13", "WAN" against a key list.
 * Unknown tokens are ignored.
 */
function matchTokens(tokens: string[], keys: string[]): string[] {
  const out: string[] = [];
  const byLower = new Map(keys.map(k => [k.toLowerCase(), k]));
  const parsed = keys.map(k => ({ key: k, ...splitKey(k) }));
  for (const raw of tokens) {
    const t = raw.trim().replace(/^ports?\s*/i, '').trim();
    if (!t) continue;
    const exact = byLower.get(t.toLowerCase());
    if (exact) { out.push(exact); continue; }
    const range = t.match(/^([A-Za-z]*)\s*(\d+)\s*[-–—]\s*([A-Za-z]*)\s*(\d+)$/);
    if (range) {
      const prefix = range[1].toLowerCase();
      const a = Number(range[2]);
      const b = Number(range[4]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (const p of parsed) {
        if (p.num != null && p.prefix === prefix && p.num >= lo && p.num <= hi) out.push(p.key);
      }
    }
  }
  return [...new Set(out)];
}

export function poeKeys(g: PortGroup): Set<string> {
  const keys = groupKeys(g);
  if (g.poeStandard === 'none' || !g.poePorts.trim()) return new Set();
  if (g.poePorts.trim().toLowerCase() === 'all') return new Set(keys);
  return new Set(matchTokens(g.poePorts.split(','), keys));
}

export function expandPorts(model: EquipmentModel): PortSpec[] {
  const out: PortSpec[] = [];
  for (const g of model.portGroups) {
    const poe = poeKeys(g);
    for (const key of groupKeys(g)) {
      out.push({
        key,
        groupId: g.id,
        groupLabel: g.label,
        kind: g.kind,
        speed: g.speed,
        poe: poe.has(key) ? g.poeStandard : 'none',
      });
    }
  }
  return out;
}

export function duplicateKeys(model: EquipmentModel): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const p of expandPorts(model)) {
    const k = p.key.toLowerCase();
    if (seen.has(k)) dups.add(p.key);
    seen.add(k);
  }
  return [...dups];
}

/**
 * Resolves a free-text port reference from link data to real port keys.
 * Handles the forms already in the original Patchwork data:
 *   "12", "Port 2 (DHCP)", "1 (uplink)", "43/44", "Port 13/22", "3–6 (Tie Cables)",
 *   "Internet/WAN", "LAN 1 (via …)".
 */
export function resolvePortRefs(raw: string | null | undefined, keys: string[]): string[] {
  if (!raw || !keys.length) return [];
  const byLower = new Map(keys.map(k => [k.toLowerCase(), k]));
  const trimmed = raw.trim();
  const exact = byLower.get(trimmed.toLowerCase());
  if (exact) return [exact];
  const cleaned = trimmed.replace(/\([^)]*\)/g, ' ').replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanedExact = byLower.get(cleaned.toLowerCase());
  if (cleanedExact) return [cleanedExact];
  const tokens = cleaned.replace(/^ports?\s*/i, '').split(/\s*(?:\/|,|&|\band\b)\s*/i);
  return matchTokens(tokens, keys);
}

// ---------------------------------------------------------------------------
// Faceplate layout (inches, origin at faceplate center, +y up)
// ---------------------------------------------------------------------------

const DIMS: Record<PortKind, { w: number; h: number; pitch: number }> = {
  rj45: { w: 0.5, h: 0.44, pitch: 0.565 },
  sfp: { w: 0.6, h: 0.4, pitch: 0.67 },
  'sfp+': { w: 0.6, h: 0.4, pitch: 0.67 },
};
const BLOCK_GAP = 0.24;
const GROUP_GAP = 0.45;
const NUMBER_H = 0.16;

export interface PortSlot extends PortSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bottom row of an odd/even pair — drawn mirrored, number label below. */
  flip: boolean;
  labelAbove: boolean;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface FaceLayout {
  slots: PortSlot[];
  blocks: Rect[];
  scale: number;
  /** Left text area width; 0 means draw the brand small across the top. */
  brandW: number;
  numberH: number;
}

export function layoutFace(model: EquipmentModel, faceW: number, faceH: number): FaceLayout {
  const specs = new Map(expandPorts(model).map(p => [p.key + '\u0000' + p.groupId, p]));
  const groups = model.portGroups.map(g => {
    const keys = groupKeys(g);
    const n = keys.length;
    const rows: 1 | 2 = g.rows === 2 && n > 1 ? 2 : 1;
    const cols = Math.ceil(n / rows);
    const colsPerBlock = g.blockSize > 0 ? Math.max(1, Math.ceil(g.blockSize / rows)) : cols;
    const nBlocks = Math.max(1, Math.ceil(cols / colsPerBlock));
    const d = DIMS[g.kind] ?? DIMS.rj45;
    // sequential rows each carry their own number strip, so they need more room between
    const rowGap = rows === 2 ? (g.order === 'sequential' ? NUMBER_H + 0.08 : 0.1) : 0;
    const width = n === 0 ? 0 : (cols - 1) * d.pitch + d.w + (nBlocks - 1) * BLOCK_GAP;
    const height = rows * d.h + (rows - 1) * rowGap;
    return { g, keys, n, rows, cols, colsPerBlock, d, rowGap, width, height };
  }).filter(x => x.n > 0);

  const total = groups.reduce((s, x) => s + x.width, 0) + Math.max(0, groups.length - 1) * GROUP_GAP;
  const maxH = groups.reduce((s, x) => Math.max(s, x.height), 0);
  const brandW = model.category !== 'patchpanel' && faceW >= 11 ? 2.6 : 0;
  const topBand = brandW === 0 && model.category !== 'patchpanel' ? 0.32 : 0;
  const availW = faceW - brandW - 0.6;
  const availH = faceH - 0.16 - topBand;
  const scale = total === 0 ? 1 : Math.min(1, availW / total, availH / (maxH + NUMBER_H * 2 + 0.04));
  const vOff = -topBand / 2;

  let cursor = brandW > 0 ? faceW / 2 - 0.3 - total * scale : -(total * scale) / 2;
  const slots: PortSlot[] = [];
  const blocks: Rect[] = [];

  for (const G of groups) {
    const { g, keys, rows, cols, colsPerBlock, d, rowGap } = G;
    const colX = (c: number) => cursor + (c * d.pitch + Math.floor(c / colsPerBlock) * BLOCK_GAP + d.w / 2) * scale;
    const rowY = (r: number) => vOff + (rows === 2 ? (r === 0 ? 1 : -1) * ((d.h + rowGap) / 2) * scale : 0);

    keys.forEach((key, i) => {
      let col: number;
      let row: number;
      if (rows === 2 && g.order === 'odd-even') { col = Math.floor(i / 2); row = i % 2; }
      else { row = Math.floor(i / cols); col = i % cols; }
      const spec = specs.get(key + '\u0000' + g.id)!;
      const flip = rows === 2 && g.order === 'odd-even' && row === 1;
      slots.push({ ...spec, x: colX(col), y: rowY(row), w: d.w * scale, h: d.h * scale, flip, labelAbove: !flip });
    });

    const nBlocks = Math.ceil(cols / colsPerBlock);
    for (let b = 0; b < nBlocks; b++) {
      const c0 = b * colsPerBlock;
      const c1 = Math.min(cols, c0 + colsPerBlock) - 1;
      const x0 = colX(c0) - (d.w / 2) * scale;
      const x1 = colX(c1) + (d.w / 2) * scale;
      const pad = 0.05 * scale;
      blocks.push({ x: (x0 + x1) / 2, y: vOff, w: x1 - x0 + pad * 2, h: G.height * scale + pad * 2 });
    }
    cursor += G.width * scale + GROUP_GAP * scale;
  }

  return { slots, blocks, scale, brandW, numberH: NUMBER_H * scale };
}

export function portSummary(model: EquipmentModel): string {
  const ports = expandPorts(model);
  if (!ports.length) return 'No network ports';
  const poe = ports.filter(p => p.poe !== 'none').length;
  const parts = [`${ports.length} port${ports.length === 1 ? '' : 's'}`];
  if (poe) parts.push(`${poe} PoE`);
  if (model.poeBudgetW) parts.push(`${model.poeBudgetW} W budget`);
  return parts.join(' · ');
}
