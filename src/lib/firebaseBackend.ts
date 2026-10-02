import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, initializeFirestore, onSnapshot,
  persistentLocalCache, persistentMultipleTabManager, query, setDoc, updateDoc, where, writeBatch,
  type DocumentData, type Firestore, type QueryDocumentSnapshot, type WriteBatch,
} from 'firebase/firestore';
import { blobToDataUrl, compressImage, type Backend } from './backend';
import { genId, nowIso } from './ids';
import { normalizeModel } from './ports';
import type { Device, EquipmentModel, Link, PortRecord, Property, Rack, SiteData, Status } from './types';

// Firestore layout:
//   models/{modelId}                      shared equipment library
//   meta/library                          marks the starter library as seeded
//   properties/{pid}                      one per site
//   properties/{pid}/racks|devices|links|activity/{id}
//   properties/{pid}/ports/{deviceId~portKey}
//   properties/{pid}/photos/{photoId}     JPEG data URLs (port photos + carried-over device photos)

const MAX_PHOTO_CHARS = 950_000; // keep each photo doc under Firestore's 1 MiB limit

type Row = DocumentData;

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

function deviceFrom(pid: string, id: string, x: Row): Device {
  return {
    propertyId: pid, id, name: str(x.name), type: str(x.type, 'endpoint'), groupName: str(x.groupName),
    location: str(x.location), status: (str(x.status, 'to-confirm') as Status), notes: str(x.notes), model: str(x.model),
    modelId: x.modelId ?? null, rackId: x.rackId ?? null, rackU: numOrNull(x.rackU), ip: str(x.ip), mac: str(x.mac),
    photoId: x.photoId ?? null,
  };
}
function linkFrom(pid: string, id: string, x: Row): Link {
  return {
    propertyId: pid, id, fromDevice: str(x.fromDevice), toDevice: x.toDevice ?? null, toExternal: str(x.toExternal),
    fromPort: str(x.fromPort), toPort: str(x.toPort), cableColor: str(x.cableColor), status: (str(x.status, 'to-confirm') as Status),
    notes: str(x.notes), cableLabel: str(x.cableLabel), speed: str(x.speed), poe: !!x.poe, poeWatts: numOrNull(x.poeWatts),
  };
}
function rackFrom(pid: string, id: string, x: Row): Rack {
  return {
    propertyId: pid, id, name: str(x.name), location: str(x.location), kind: x.kind ?? 'floor',
    units: Number(x.units ?? 42), sort: Number(x.sort ?? 0), notes: str(x.notes),
  };
}
function portFrom(pid: string, x: Row): PortRecord {
  return {
    propertyId: pid, deviceId: str(x.deviceId), portKey: str(x.portKey), label: str(x.label), notes: str(x.notes),
    photos: Array.isArray(x.photos) ? x.photos : [],
  };
}
function propertyFrom(id: string, x: Row): Property {
  return { id, name: str(x.name), code: str(x.code), address: str(x.address) };
}

/** Drops the key fields that live in the document path. */
function body<T extends { propertyId?: string; id?: string }>(o: T): Omit<T, 'propertyId' | 'id'> {
  const { propertyId: _p, id: _i, ...rest } = o;
  return rest;
}

export const portDocId = (deviceId: string, key: string) => `${deviceId}~${encodeURIComponent(key)}`;

interface SiteCache {
  property?: Property;
  racks?: Rack[];
  devices?: Device[];
  links?: Link[];
  ports?: PortRecord[];
}

export function createFirebaseBackend(options: FirebaseOptions): { backend: Backend; auth: Auth } {
  const app = initializeApp(options);
  const auth = getAuth(app);
  const db: Firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });

  const P = (pid: string) => doc(db, 'properties', pid);
  const sub = (pid: string, name: string) => collection(db, 'properties', pid, name);
  const caches = new Map<string, SiteCache>();
  const photoCache = new Map<string, string>();

  /** Commits writes in chunks under Firestore's 500-operation batch limit. */
  async function chunked(ops: ((b: WriteBatch) => void)[]) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      ops.slice(i, i + 400).forEach(op => op(b));
      await b.commit();
    }
  }

  async function readSite(pid: string): Promise<SiteData> {
    const c = caches.get(pid);
    if (c?.property && c.racks && c.devices && c.links && c.ports) {
      return structuredClone({ property: c.property, racks: c.racks, devices: c.devices, links: c.links, ports: c.ports });
    }
    const [p, racks, devices, links, ports] = await Promise.all([
      getDoc(P(pid)), getDocs(sub(pid, 'racks')), getDocs(sub(pid, 'devices')), getDocs(sub(pid, 'links')), getDocs(sub(pid, 'ports')),
    ]);
    if (!p.exists()) throw new Error('That site no longer exists.');
    return {
      property: propertyFrom(p.id, p.data()),
      racks: racks.docs.map(d => rackFrom(pid, d.id, d.data())),
      devices: devices.docs.map(d => deviceFrom(pid, d.id, d.data())),
      links: links.docs.map(d => linkFrom(pid, d.id, d.data())),
      ports: ports.docs.map(d => portFrom(pid, d.data())),
    };
  }

  async function storePhoto(pid: string, blob: Blob, meta: Record<string, unknown>): Promise<string> {
    let data = await blobToDataUrl(await compressImage(blob));
    if (data.length > MAX_PHOTO_CHARS) data = await blobToDataUrl(await compressImage(blob, 1100, 0.72));
    if (data.length > MAX_PHOTO_CHARS) throw new Error('That photo is too large even after shrinking it.');
    const id = genId();
    await setDoc(doc(sub(pid, 'photos'), id), { data, uploadedAt: nowIso(), ...meta });
    const path = `${pid}/${id}`;
    photoCache.set(path, data);
    return path;
  }

  const backend: Backend = {
    mode: 'firebase',

    async listProperties() {
      const snap = await getDocs(collection(db, 'properties'));
      return snap.docs.map(d => propertyFrom(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
    },

    async propertyExists(id) {
      return (await getDoc(P(id))).exists();
    },

    async createProperty(p) {
      await setDoc(P(p.id), {
        name: p.name, code: p.code, address: p.address, owningLLC: '', preparedBy: '', notes: '', findings: [],
        createdAt: nowIso(), updatedAt: nowIso(),
      });
    },

    loadSite: readSite,

    async devicePhoto(pid, deviceId) {
      const d = await getDoc(doc(sub(pid, 'devices'), deviceId));
      const photoId = d.data()?.photoId as string | undefined;
      return photoId ? backend.photoUrl(photoId) : null;
    },

    async listModels() {
      const snap = await getDocs(collection(db, 'models'));
      return snap.docs
        .map(d => normalizeModel({ ...(d.data() as Partial<EquipmentModel>), id: d.id }))
        .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name));
    },

    async saveModel(m) {
      await setDoc(doc(db, 'models', m.id), { ...body(m), updatedAt: nowIso() });
    },

    async deleteModel(id) {
      const props = await getDocs(collection(db, 'properties'));
      const ops: ((b: WriteBatch) => void)[] = [];
      for (const p of props.docs) {
        const using = await getDocs(query(sub(p.id, 'devices'), where('modelId', '==', id)));
        using.docs.forEach(d => ops.push(b => b.update(d.ref, { modelId: null })));
      }
      ops.push(b => b.delete(doc(db, 'models', id)));
      await chunked(ops);
    },

    async countModelUsage(id) {
      const props = await getDocs(collection(db, 'properties'));
      let n = 0;
      for (const p of props.docs) {
        n += (await getCountFromServer(query(sub(p.id, 'devices'), where('modelId', '==', id)))).data().count;
      }
      return n;
    },

    async ensureLibrary(starter) {
      const marker = doc(db, 'meta', 'library');
      if ((await getDoc(marker)).exists()) return;
      const existing = new Set((await getDocs(collection(db, 'models'))).docs.map(d => d.id));
      const ops: ((b: WriteBatch) => void)[] = starter
        .filter(m => !existing.has(m.id))
        .map(m => b => b.set(doc(db, 'models', m.id), { ...body(m), updatedAt: nowIso() }));
      ops.push(b => b.set(marker, { seeded: true, at: nowIso() }));
      await chunked(ops);
    },

    async saveRack(r) {
      await setDoc(doc(sub(r.propertyId, 'racks'), r.id), body(r));
    },

    async deleteRack(pid, id) {
      const inRack = await getDocs(query(sub(pid, 'devices'), where('rackId', '==', id)));
      await chunked([
        ...inRack.docs.map(d => (b: WriteBatch) => b.update(d.ref, { rackId: null, rackU: null })),
        b => b.delete(doc(sub(pid, 'racks'), id)),
      ]);
    },

    async createDevice(d) {
      await setDoc(doc(sub(d.propertyId, 'devices'), d.id), { ...body(d), tags: [], credentials: [] });
    },

    async updateDevice(pid, id, patch) {
      await updateDoc(doc(sub(pid, 'devices'), id), body(patch));
    },

    async deleteDevice(pid, id) {
      const [from, to, ports, photos] = await Promise.all([
        getDocs(query(sub(pid, 'links'), where('fromDevice', '==', id))),
        getDocs(query(sub(pid, 'links'), where('toDevice', '==', id))),
        getDocs(query(sub(pid, 'ports'), where('deviceId', '==', id))),
        getDocs(query(sub(pid, 'photos'), where('deviceId', '==', id))),
      ]);
      const refs = [...from.docs, ...to.docs, ...ports.docs, ...photos.docs].map((d: QueryDocumentSnapshot) => d.ref);
      await chunked([...refs.map(r => (b: WriteBatch) => b.delete(r)), b => b.delete(doc(sub(pid, 'devices'), id))]);
    },

    async createLink(l) {
      await setDoc(doc(sub(l.propertyId, 'links'), l.id), body(l));
    },

    async updateLink(pid, id, patch) {
      await updateDoc(doc(sub(pid, 'links'), id), body(patch));
    },

    async deleteLink(pid, id) {
      await deleteDoc(doc(sub(pid, 'links'), id));
    },

    async savePort(p) {
      await setDoc(doc(sub(p.propertyId, 'ports'), portDocId(p.deviceId, p.portKey)), {
        deviceId: p.deviceId, portKey: p.portKey, label: p.label, notes: p.notes, photos: p.photos, updatedAt: nowIso(),
      });
    },

    async uploadPhoto(pid, deviceId, portKey, file, name) {
      const path = await storePhoto(pid, file, { name, deviceId, portKey });
      return { path, name, uploadedAt: nowIso() };
    },

    async photoUrl(path) {
      const hit = photoCache.get(path);
      if (hit) return hit;
      const [pid, id] = path.split('/');
      const snap = await getDoc(doc(sub(pid, 'photos'), id));
      const data = snap.data()?.data as string | undefined;
      if (!data) throw new Error('Photo not found.');
      photoCache.set(path, data);
      return data;
    },

    async deletePhoto(path) {
      const [pid, id] = path.split('/');
      photoCache.delete(path);
      await deleteDoc(doc(sub(pid, 'photos'), id));
    },

    async importSite(bundle, onProgress) {
      const pid = bundle.property.id;
      const { id: _id, ...prop } = bundle.property;
      const devices = [];
      let n = 0;
      for (const d of bundle.devices) {
        let photoId: string | null = d.photoId ?? null;
        if (d.photoData) {
          onProgress?.(`${bundle.property.name}: photo ${++n} (${d.name})`);
          photoId = await storePhoto(pid, await (await fetch(d.photoData)).blob(), { name: `${d.name}.jpg`, deviceId: d.id });
        }
        const { photoData: _pd, ...rest } = d;
        devices.push({ ...rest, photoId });
      }
      onProgress?.(`${bundle.property.name}: saving ${devices.length} devices, ${bundle.links.length} cable runs…`);
      await chunked([
        b => b.set(P(pid), prop),
        ...bundle.racks.map(r => (b: WriteBatch) => b.set(doc(sub(pid, 'racks'), r.id), body(r))),
        ...devices.map(d => (b: WriteBatch) => b.set(doc(sub(pid, 'devices'), d.id), body(d))),
        ...bundle.links.map(l => (b: WriteBatch) => b.set(doc(sub(pid, 'links'), l.id), body(l))),
        ...bundle.ports.map(p => (b: WriteBatch) => b.set(doc(sub(pid, 'ports'), portDocId(p.deviceId, p.portKey)), {
          deviceId: p.deviceId, portKey: p.portKey, label: p.label, notes: p.notes, photos: p.photos, updatedAt: nowIso(),
        })),
        ...bundle.activity.map(a => (b: WriteBatch) => b.set(doc(sub(pid, 'activity'), a.id), { text: a.text, ts: a.ts })),
      ]);
    },

    async logActivity(pid, text) {
      try {
        await setDoc(doc(sub(pid, 'activity'), genId()), { text, ts: nowIso() });
      } catch { /* never block the edit that triggered it */ }
    },

    subscribe(pid, onChange) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 100); };
      if (!pid) {
        const off = onSnapshot(collection(db, 'models'), fire, () => undefined);
        return () => { clearTimeout(timer); off(); };
      }
      const cache: SiteCache = {};
      caches.set(pid, cache);
      const offs = [
        onSnapshot(P(pid), s => { if (s.exists()) cache.property = propertyFrom(s.id, s.data()); fire(); }, () => undefined),
        onSnapshot(sub(pid, 'racks'), s => { cache.racks = s.docs.map(d => rackFrom(pid, d.id, d.data())); fire(); }, () => undefined),
        onSnapshot(sub(pid, 'devices'), s => { cache.devices = s.docs.map(d => deviceFrom(pid, d.id, d.data())); fire(); }, () => undefined),
        onSnapshot(sub(pid, 'links'), s => { cache.links = s.docs.map(d => linkFrom(pid, d.id, d.data())); fire(); }, () => undefined),
        onSnapshot(sub(pid, 'ports'), s => { cache.ports = s.docs.map(d => portFrom(pid, d.data())); fire(); }, () => undefined),
      ];
      return () => {
        clearTimeout(timer);
        offs.forEach(off => off());
        if (caches.get(pid) === cache) caches.delete(pid);
      };
    },
  };

  return { backend, auth };
}
