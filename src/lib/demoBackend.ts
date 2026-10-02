import type { Backend } from './backend';
import { genId, nowIso } from './ids';
import { normalizeModel } from './ports';
import type { Device, EquipmentModel, Link, PortRecord, Property, Rack, SiteData, Status } from './types';
import library from '../data/equipment-library.json';

// In-memory backend for local development only (never included in production
// builds). The default variant is a fictional property arranged into two
// racks; the "empty" variant is filled by the importer to preview a migration.
// Nothing persists across reloads.

const PID = 'demo-example-inn';

function dev(id: string, name: string, type: string, modelId: string | null, rackId: string | null, rackU: number | null,
  status: Status = 'confirmed', extra: Partial<Device> = {}): Device {
  return {
    propertyId: PID, id, name, type, groupName: rackId === 'mdf' ? 'MDF' : 'Front Desk',
    location: '', status, notes: '', model: '', modelId, rackId, rackU, ip: '', mac: '', ...extra,
  };
}

function link(id: string, from: string, fromPort: string, to: string | null, toPort: string, color = '',
  status: Status = 'confirmed', extra: Partial<Link> = {}): Link {
  return {
    propertyId: PID, id, fromDevice: from, toDevice: to, toExternal: '', fromPort, toPort, cableColor: color,
    status, notes: '', cableLabel: '', speed: '', poe: false, poeWatts: null, ...extra,
  };
}

/** A fictional property that exercises every feature (racks, desktop shelves, legacy port text, PoE, conflicts). */
function seed(): SiteData {
  const property: Property = { id: PID, name: 'Example Inn & Suites (demo)', code: 'EXI', address: 'Demo data — changes are not saved' };
  const racks: Rack[] = [
    { propertyId: PID, id: 'mdf', name: 'MDF Rack', location: 'MDF', kind: 'floor', units: 24, sort: 0, notes: '' },
    { propertyId: PID, id: 'foh', name: 'Front Desk Cabinet', location: 'Front Desk', kind: 'wall', units: 6, sort: 1, notes: '' },
  ];
  const devices: Device[] = [
    dev('pp1', 'Patch Panel A', 'patchpanel', 'generic-patch-24', 'mdf', 24),
    dev('core', 'Core Switch SW01', 'switch', 'ruckus-icx7150-48p', 'mdf', 23, 'confirmed', {
      ip: '10.0.0.2', mac: '00:1A:2B:3C:4D:01', notes: 'Core switch for the property. Ports 1–10 feed the hallway APs.',
    }),
    dev('office-sw', 'Office Switch SW02', 'switch', 'hp-procurve-2510-24', 'mdf', 22, 'confirmed', {
      ip: '10.0.0.3', notes: 'Port 3 has a cable whose far end hasn\'t been traced yet.',
    }),
    dev('gateway', 'Guest Wi-Fi Gateway', 'security', 'summit360-gateway', 'mdf', 21, 'to-confirm', { ip: '10.0.0.1' }),
    dev('wan', 'WAN Bonding Appliance', 'external', 'velocity-vband', 'mdf', 20, 'to-confirm'),
    dev('office-rtr', 'Back-Office Router', 'router', 'tplink-router-desktop', 'mdf', 18, 'confirmed', { ip: '192.168.0.1' }),
    dev('small-sw', '5-Port Switch SW03', 'switch', 'tplink-tl-sg705', 'mdf', 18),
    dev('pms-fw', 'PMS Firewall', 'security', 'fortinet-fortigate-desktop', 'mdf', 17),
    dev('kvm-1', 'Remote KVM 1', 'av', 'jetkvm', 'mdf', 17, 'confirmed', { ip: '192.168.0.21' }),
    dev('kvm-2', 'Remote KVM 2', 'av', 'jetkvm', 'mdf', 17, 'confirmed', { ip: '192.168.0.22' }),
    dev('backup-rtr', 'Backup Router', 'router', 'ubiquiti-edgerouter-x', 'mdf', 16, 'flagged', {
      notes: 'Probably bypassed by the current setup — confirm whether it\'s still in use.',
    }),
    dev('isp-rtr', 'ISP Router', 'router', 'adtran-router', 'mdf', 16),
    dev('pbx', 'Phone System (PBX)', 'av', 'generic-pbx', 'mdf', 13),
    dev('nvr', 'Camera NVR', 'av', 'generic-dvr', 'mdf', 12, 'confirmed', { ip: '192.168.0.50', mac: '00:1A:2B:3C:4D:50' }),
    dev('dvr-2', 'DVR 2', 'av', 'generic-dvr', 'mdf', 11, 'to-confirm'),
    dev('dvr-1', 'DVR 1', 'av', 'generic-dvr', 'mdf', 10),
    dev('ups', 'UPS', 'power', 'generic-ups-2u', 'mdf', 1),
    dev('fd-patch', 'Front Desk Patch Panel', 'patchpanel', 'generic-patch-24', 'foh', 5),
    dev('legacy-t1', 'Legacy T1 Box', 'router', 'generic-modem-ont', 'foh', 3),
    dev('gm-pc', 'GM Office PC', 'endpoint', null, null, null, 'confirmed', { ip: '10.0.1.15' }),
    dev('ont', 'Fiber ONT', 'endpoint', null, null, null, 'to-confirm'),
    dev('pool-ctrl', 'Pool Controller', 'endpoint', null, null, null),
  ];
  const ext = (l: Link, text: string) => ({ ...l, toExternal: text });
  const links: Link[] = [
    // Written the loose way real documentation often is ("Port 2 (DHCP)", "1–10", "43/44")
    // to show how free-text ports are matched to real ports.
    ext(link('l00', 'wan', 'Port 1', null, ''), 'ISP hand-off (fiber)'),
    link('l01', 'wan', 'Port 2', 'office-rtr', 'Internet/WAN (DHCP)', 'blue'),
    link('l02', 'wan', 'Port 3', 'core', '48', 'blue'),
    link('l03', 'gateway', 'WAN2', 'core', '47', 'yellow'),
    link('l04', 'gateway', 'LAN', 'core', '45', 'red'),
    ext(link('l05', 'core', '1–10', null, '', 'blue', 'confirmed', { poe: true, speed: '1G' }), 'Hallway access points (property-wide)'),
    link('l06', 'core', '11', 'gm-pc', 'NIC'),
    link('l07', 'core', '12', 'dvr-2', 'LAN'),
    link('l08', 'core', '13', 'isp-rtr', 'WAN', '', 'confirmed', { cableLabel: 'ISP-WAN SW01 P13' }),
    link('l09', 'core', '14', 'pbx', 'LAN'),
    link('l10', 'core', '15', 'pms-fw', 'WAN', '', 'confirmed', { cableLabel: 'PMS-FW SW01 P15' }),
    link('l11', 'core', '16', 'dvr-1', 'LAN'),
    link('l12', 'core', '21', 'pms-fw', '3'),
    link('l13', 'core', '43/44', 'backup-rtr', '', '', 'flagged'),
    link('l15', 'office-rtr', 'Port 2', 'office-sw', 'Port 1 (uplink)', 'blue'),
    link('l16', 'office-rtr', 'Port 4', 'small-sw', 'Port 5 (uplink)', 'purple'),
    ext(link('l17', 'office-sw', 'Port 3', null, '', '', 'flagged'), 'Cable present — far end not traced yet'),
    ext(link('l18', 'office-sw', 'Port 6', null, ''), 'Front Desk / Back Office'),
    link('l19', 'office-sw', 'Port 10', 'ont', ''),
    link('l20', 'office-sw', 'Port 11', 'legacy-t1', 'LAN 1', 'yellow'),
    link('l21', 'office-sw', 'Port 13/22', 'fd-patch', 'Desk 1 / Desk 2 / Back office', 'white'),
    link('l23', 'small-sw', 'Port 1', 'nvr', 'LAN', 'blue'),
    link('l24', 'small-sw', 'Port 2', 'kvm-1', 'LAN', 'blue'),
    link('l25', 'small-sw', 'Port 3', 'kvm-2', 'LAN', 'blue'),
    link('l26', 'small-sw', 'Port 4', 'pool-ctrl', '', 'blue'),
    // Structured patch panel runs
    link('d01', 'core', '17', 'pp1', '1', 'blue', 'confirmed', { cableLabel: 'EX-101', speed: '1G', poe: true, poeWatts: 6.4 }),
    link('d02', 'core', '18', 'pp1', '2', 'blue', 'confirmed', { cableLabel: 'EX-105', speed: '1G', poe: true, poeWatts: 5.9 }),
    link('d03', 'core', '19', 'pp1', '3', 'blue', 'to-confirm', { cableLabel: 'EX-POOL', speed: '1G', poe: true, poeWatts: 7.1 }),
    link('d04', 'core', '20', 'pp1', '4', 'blue', 'confirmed', { cableLabel: 'EX-BKFST', speed: '1G', poe: true, poeWatts: 6.0 }),
    link('d05', 'core', '22', 'pp1', '5', 'white', 'confirmed', { cableLabel: 'FD-PC1', speed: '1G' }),
    link('d06', 'core', '24', 'pp1', '7', 'yellow', 'confirmed', { cableLabel: 'LOBBY-TV', speed: '100M' }),
  ];
  const port = (deviceId: string, portKey: string, label: string, notes = ''): PortRecord =>
    ({ propertyId: PID, deviceId, portKey, label, notes, photos: [] });
  const ports: PortRecord[] = [
    port('pp1', '1', 'Rm 101 — hallway AP'),
    port('pp1', '2', 'Rm 105 — hallway AP'),
    port('pp1', '3', 'Pool AP', 'Jack is behind the towel cabinet.'),
    port('pp1', '4', 'Breakfast room AP'),
    port('pp1', '5', 'Front desk PC 1'),
    port('pp1', '7', 'Lobby TV'),
    port('core', '11', 'GM Office'),
    port('office-sw', '6', 'Front Desk / Back Office'),
  ];
  return { property, racks, devices, links, ports };
}

/** A clearly-fake "photo" so the hover card has something to show in the demo. */
function samplePhoto(title: string, sub: string): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 640, 480);
  grad.addColorStop(0, '#2b3440');
  grad.addColorStop(1, '#0f1318');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#f4f1e6';
  g.fillRect(150, 170, 340, 110);
  g.fillStyle = '#111';
  g.font = '700 46px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.fillText(title, 320, 240);
  g.fillStyle = '#9aa7b6';
  g.font = '500 22px "IBM Plex Sans", sans-serif';
  g.fillText(sub, 320, 340);
  g.fillText('Sample photo (demo)', 320, 440);
  return c.toDataURL('image/jpeg', 0.85);
}

export function createDemoBackend(variant: 'sample' | 'empty' = 'sample'): Backend {
  const sites = new Map<string, SiteData>();
  let models: EquipmentModel[] = (library as Partial<EquipmentModel>[]).map(m => normalizeModel(m as EquipmentModel));
  const photos = new Map<string, string>();
  const devicePhotos = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => setTimeout(() => listeners.forEach(fn => fn()), 0);
  const clone = <T,>(v: T): T => structuredClone(v);
  const site = (pid: string) => {
    const s = sites.get(pid);
    if (!s) throw new Error('That site no longer exists.');
    return s;
  };

  if (variant === 'sample') {
    const db = seed();
    sites.set(PID, db);
    const addSample = (deviceId: string, portKey: string, title: string, sub: string) => {
      const path = `demo:${genId()}`;
      photos.set(path, samplePhoto(title, sub));
      db.ports.find(p => p.deviceId === deviceId && p.portKey === portKey)?.photos.push({ path, name: `${title}.jpg`, uploadedAt: nowIso() });
    };
    addSample('pp1', '1', 'EX-101', 'Patch Panel A · port 1 label');
    addSample('pp1', '3', 'EX-POOL', 'Pool AP jack');
  }

  return {
    mode: 'demo',
    async listProperties() { return [...sites.values()].map(s => clone(s.property)).sort((a, b) => a.name.localeCompare(b.name)); },
    async propertyExists(id) { return sites.has(id); },
    async createProperty(p) {
      sites.set(p.id, { property: clone(p), racks: [], devices: [], links: [], ports: [] });
      notify();
    },
    async updateProperty(pid, patch) {
      const s = site(pid);
      s.property = { ...s.property, ...clone(patch) };
      notify();
    },
    async loadSite(pid) { return clone(site(pid)); },
    async devicePhoto(pid, deviceId) { return devicePhotos.get(`${pid}/${deviceId}`) ?? null; },

    async listModels() { return clone(models); },
    async saveModel(m, isNew) {
      models = isNew ? [...models, clone(m)] : models.map(x => (x.id === m.id ? clone(m) : x));
      notify();
    },
    async deleteModel(id) {
      models = models.filter(m => m.id !== id);
      sites.forEach(s => s.devices.forEach(d => { if (d.modelId === id) d.modelId = null; }));
      notify();
    },
    async countModelUsage(id) {
      let n = 0;
      sites.forEach(s => { n += s.devices.filter(d => d.modelId === id).length; });
      return n;
    },
    async ensureLibrary() { /* the demo starts with the starter library */ },

    async saveRack(r, isNew) {
      const s = site(r.propertyId);
      s.racks = isNew ? [...s.racks, clone(r)] : s.racks.map(x => (x.id === r.id ? clone(r) : x));
      notify();
    },
    async deleteRack(pid, id) {
      const s = site(pid);
      s.devices.forEach(d => { if (d.rackId === id) { d.rackId = null; d.rackU = null; } });
      s.racks = s.racks.filter(r => r.id !== id);
      notify();
    },

    async createDevice(d) { site(d.propertyId).devices.push(clone(d)); notify(); },
    async updateDevice(pid, id, patch) {
      const s = site(pid);
      s.devices = s.devices.map(d => (d.id === id ? { ...d, ...clone(patch) } : d));
      notify();
    },
    async deleteDevice(pid, id) {
      const s = site(pid);
      s.links = s.links.filter(l => l.fromDevice !== id && l.toDevice !== id);
      s.ports = s.ports.filter(p => p.deviceId !== id);
      s.devices = s.devices.filter(d => d.id !== id);
      notify();
    },

    async createLink(l) { site(l.propertyId).links.push(clone(l)); notify(); },
    async updateLink(pid, id, patch) {
      const s = site(pid);
      s.links = s.links.map(l => (l.id === id ? { ...l, ...clone(patch) } : l));
      notify();
    },
    async deleteLink(pid, id) { const s = site(pid); s.links = s.links.filter(l => l.id !== id); notify(); },

    async savePort(p) {
      const s = site(p.propertyId);
      const i = s.ports.findIndex(x => x.deviceId === p.deviceId && x.portKey === p.portKey);
      if (i >= 0) s.ports[i] = clone(p); else s.ports.push(clone(p));
      notify();
    },
    async uploadPhoto(_pid, _d, _k, file, name) {
      const path = `demo:${genId()}`;
      photos.set(path, URL.createObjectURL(file));
      return { path, name, uploadedAt: nowIso() };
    },
    async photoUrl(path) {
      const url = photos.get(path);
      if (!url) throw new Error('Photo not found.');
      return url;
    },
    async deletePhoto(path) { photos.delete(path); },

    async importSite(bundle) {
      const pid = bundle.property.id;
      for (const d of bundle.devices) if (d.photoData) devicePhotos.set(`${pid}/${d.id}`, d.photoData);
      const stored = new Map<string, string>();
      const ports = bundle.ports.map(({ photoData, ...p }) => {
        const added = (photoData ?? []).map(ph => {
          let path = stored.get(ph.data);
          if (!path) {
            path = `demo:${genId()}`;
            photos.set(path, ph.data);
            stored.set(ph.data, path);
          }
          return { path, name: ph.name, uploadedAt: nowIso() };
        });
        return { ...clone(p), photos: [...p.photos, ...added] };
      });
      sites.set(pid, {
        property: { id: pid, name: bundle.property.name, code: bundle.property.code, address: bundle.property.address, notes: bundle.property.notes },
        racks: clone(bundle.racks),
        devices: bundle.devices.map(({ tags: _t, credentials: _c, photoData: _p, ...d }) => clone(d)),
        links: clone(bundle.links),
        ports,
      });
      notify();
    },

    async logActivity() { /* demo: no activity log */ },
    subscribe(_pid, onChange) {
      listeners.add(onChange);
      return () => { listeners.delete(onChange); };
    },
  };
}

