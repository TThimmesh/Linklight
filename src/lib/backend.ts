import type { Device, EquipmentModel, Link, PhotoRef, PortRecord, Property, Rack, SiteData } from './types';

/** Everything the UI needs from storage. Implemented by Firebase (live) and an in-memory demo. */
export interface Backend {
  mode: 'firebase' | 'demo';
  listProperties(): Promise<Property[]>;
  propertyExists(id: string): Promise<boolean>;
  createProperty(p: Property): Promise<void>;
  updateProperty(id: string, patch: Partial<Omit<Property, 'id'>>): Promise<void>;
  loadSite(propertyId: string): Promise<SiteData>;
  /** URL (or data URL) of the device photo carried over from the original Patchwork. */
  devicePhoto(propertyId: string, deviceId: string): Promise<string | null>;

  listModels(): Promise<EquipmentModel[]>;
  saveModel(m: EquipmentModel, isNew: boolean): Promise<void>;
  deleteModel(id: string): Promise<void>;
  countModelUsage(id: string): Promise<number>;
  /** Adds the starter library the first time the app runs against an empty database. */
  ensureLibrary(starter: EquipmentModel[]): Promise<void>;

  saveRack(r: Rack, isNew: boolean): Promise<void>;
  deleteRack(propertyId: string, id: string): Promise<void>;

  createDevice(d: Device): Promise<void>;
  updateDevice(propertyId: string, id: string, patch: Partial<Device>): Promise<void>;
  deleteDevice(propertyId: string, id: string): Promise<void>;

  createLink(l: Link): Promise<void>;
  updateLink(propertyId: string, id: string, patch: Partial<Link>): Promise<void>;
  deleteLink(propertyId: string, id: string): Promise<void>;

  savePort(p: PortRecord): Promise<void>;
  uploadPhoto(propertyId: string, deviceId: string, portKey: string, file: Blob, name: string): Promise<PhotoRef>;
  photoUrl(path: string): Promise<string>;
  deletePhoto(path: string): Promise<void>;

  /** Writes one whole property — from a site file (src/lib/siteFile.ts) or the Patchwork importer. */
  importSite(bundle: ImportBundle, onProgress?: (msg: string) => void): Promise<void>;

  logActivity(propertyId: string, text: string): Promise<void>;
  /** Calls onChange (debounced) whenever anything for this property — or the library — changes. */
  subscribe(propertyId: string | null, onChange: () => void): () => void;
}

/** A property as carried over from the original Patchwork, ready to write. */
export interface ImportBundle {
  property: Property & {
    owningLLC: string;
    preparedBy: string;
    notes: string;
    findings: unknown[];
    createdAt: string;
    updatedAt: string;
  };
  racks: Rack[];
  devices: (Device & { tags: unknown[]; credentials: unknown[]; photoData: string | null })[];
  links: Link[];
  /** `photoData` holds new photos (data URLs) to store and attach to the port. */
  ports: (PortRecord & { photoData?: { name: string; data: string }[] })[];
  activity: { id: string; text: string; ts: string }[];
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** Downsizes photos before saving so phone pictures stay small (each is kept well under Firestore's 1 MB document limit). */
export async function compressImage(file: Blob, maxDim = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn\'t an image.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process image.'))), 'image/jpeg', quality),
  );
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read file.'));
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
