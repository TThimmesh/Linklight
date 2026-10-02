// Shared app types. Field names are camelCase here; src/lib/backend.ts maps
// them to the snake_case Postgres columns.

export type DeviceType =
  | 'switch' | 'router' | 'ap' | 'security' | 'av'
  | 'patchpanel' | 'power' | 'external' | 'endpoint';

export type FormFactor = 'rack' | 'desktop' | 'offrack';
export type PortKind = 'rj45' | 'sfp' | 'sfp+';
export type PortOrder = 'odd-even' | 'sequential';
export type PoeStandard = 'none' | 'af' | 'at' | 'bt';
export type RackKind = 'floor' | 'wall' | 'open' | 'shelf';
export type Status = 'confirmed' | 'to-confirm' | 'flagged';

/** A run of identical ports on a faceplate, e.g. "48x 1G PoE+" or "X1-X4 SFP+". */
export interface PortGroup {
  id: string;
  label: string;
  kind: PortKind;
  /** Ignored when `names` is non-empty. */
  count: number;
  /** First port number. Ignored when `names` is non-empty. */
  start: number;
  /** Prepended to generated numbers, e.g. "X" → X1, X2… */
  prefix: string;
  /** Explicit port names (e.g. WAN, DMZ, eth0). Overrides count/start/prefix. */
  names: string[];
  rows: 1 | 2;
  /** odd-even: 1 top / 2 below / 3 top… (real switch layout). sequential: fill the top row first. */
  order: PortOrder;
  /** Ports per visual block (e.g. 12). 0 = one continuous block. */
  blockSize: number;
  speed: string;
  /** Which ports supply PoE: "all", "1-24", "1-8, 13", "WAN"… Empty = none. */
  poePorts: string;
  poeStandard: PoeStandard;
}

export interface EquipmentModel {
  id: string;
  manufacturer: string;
  name: string;
  category: DeviceType;
  formFactor: FormFactor;
  rackUnits: number;
  widthIn: number;
  depthIn: number;
  faceColor: string;
  poeBudgetW: number | null;
  portGroups: PortGroup[];
  notes: string;
}

export interface Property {
  id: string;
  name: string;
  code: string;
  address: string;
}

export interface Rack {
  propertyId: string;
  id: string;
  name: string;
  location: string;
  kind: RackKind;
  units: number;
  sort: number;
  notes: string;
}

export interface Device {
  propertyId: string;
  id: string;
  name: string;
  type: string;
  groupName: string;
  location: string;
  status: Status;
  notes: string;
  /** Free-text model from the original Patchwork data. */
  model: string;
  modelId: string | null;
  rackId: string | null;
  rackU: number | null;
  ip: string;
  mac: string;
  /** Device photo carried over from the original Patchwork (a photo doc id). */
  photoId?: string | null;
}

export interface Link {
  propertyId: string;
  id: string;
  fromDevice: string;
  toDevice: string | null;
  toExternal: string;
  fromPort: string;
  toPort: string;
  cableColor: string;
  status: Status;
  notes: string;
  cableLabel: string;
  speed: string;
  poe: boolean;
  poeWatts: number | null;
}

export interface PhotoRef {
  path: string;
  name: string;
  uploadedAt: string;
}

export interface PortRecord {
  propertyId: string;
  deviceId: string;
  portKey: string;
  label: string;
  notes: string;
  photos: PhotoRef[];
}

export interface SiteData {
  property: Property;
  racks: Rack[];
  devices: Device[];
  links: Link[];
  ports: PortRecord[];
}

export const DEVICE_TYPES: { v: DeviceType; label: string }[] = [
  { v: 'switch', label: 'Switch' },
  { v: 'router', label: 'Router / Gateway' },
  { v: 'ap', label: 'Access point' },
  { v: 'security', label: 'Security appliance' },
  { v: 'av', label: 'DVR / AV / KVM' },
  { v: 'patchpanel', label: 'Patch panel' },
  { v: 'power', label: 'Power / UPS' },
  { v: 'external', label: 'External / ISP' },
  { v: 'endpoint', label: 'Endpoint / other' },
];

export const RACK_KINDS: { v: RackKind; label: string; defaultUnits: number }[] = [
  { v: 'floor', label: 'Floor rack / cabinet', defaultUnits: 42 },
  { v: 'wall', label: 'Wall-mount cabinet', defaultUnits: 12 },
  { v: 'open', label: 'Open frame / 2-post', defaultUnits: 24 },
  { v: 'shelf', label: 'Shelf / no rack', defaultUnits: 6 },
];

export const STATUSES: { v: Status; label: string }[] = [
  { v: 'confirmed', label: 'Confirmed' },
  { v: 'to-confirm', label: 'To confirm' },
  { v: 'flagged', label: 'Flagged' },
];

export const CABLE_COLORS = ['blue', 'purple', 'green', 'red', 'white', 'yellow', 'orange', 'black', 'gray'] as const;
export const CABLE_HEX: Record<string, string> = {
  blue: '#3B82F6', purple: '#A855F7', green: '#22C55E', red: '#EF4444', white: '#CBD5E1',
  yellow: '#EAB308', orange: '#F97316', black: '#334155', gray: '#94A3B8',
};
export const DEFAULT_CABLE_HEX = '#64748B';

export const SPEEDS = ['', '10M', '100M', '1G', '2.5G', '5G', '10G', '25G'];
export const POE_LABEL: Record<PoeStandard, string> = { none: 'No PoE', af: 'PoE (af)', at: 'PoE+ (at)', bt: 'PoE++ (bt)' };

export function typeLabel(t: string): string {
  return DEVICE_TYPES.find(x => x.v === t)?.label ?? 'Device';
}

export function modelLabel(m: EquipmentModel | undefined | null): string {
  if (!m) return 'No model';
  return m.manufacturer && m.manufacturer !== 'Generic' ? `${m.manufacturer} ${m.name}` : m.name;
}
