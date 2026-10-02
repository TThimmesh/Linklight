import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Backend } from './backend';
import type { EquipmentModel, SiteData } from './types';

// ---------------------------------------------------------------------------
// Data loading with realtime refresh
// ---------------------------------------------------------------------------

export interface Loaded<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads once per `key`, then reloads whenever `subscribe` reports a change.
 * Stale responses (from a previous key or an older reload) are dropped.
 */
function useLoader<T>(key: string | null, load: () => Promise<T>, subscribe: (fn: () => void) => () => void): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: key != null });
  const seq = useRef(0);
  const latest = useRef({ load, subscribe });
  latest.current = { load, subscribe };

  const run = useCallback(() => {
    if (key == null) return;
    const my = ++seq.current;
    latest.current.load().then(
      data => { if (my === seq.current) setState({ data, error: null, loading: false }); },
      error => { if (my === seq.current) setState(s => ({ data: s.data, error, loading: false })); },
    );
  }, [key]);

  useEffect(() => {
    setState({ data: null, error: null, loading: key != null });
    if (key == null) return;
    run();
    return latest.current.subscribe(run);
  }, [key, run]);

  return { ...state, reload: run };
}

const backendKeys = new WeakMap<Backend, string>();
function backendKey(b: Backend): string {
  let k = backendKeys.get(b);
  if (!k) { k = Math.random().toString(36).slice(2); backendKeys.set(b, k); }
  return k;
}

export function useModels(backend: Backend): Loaded<EquipmentModel[]> {
  return useLoader(backendKey(backend), () => backend.listModels(), fn => backend.subscribe(null, fn));
}

export function useSite(backend: Backend, propertyId: string | null): Loaded<SiteData> {
  return useLoader(
    propertyId ? `${backendKey(backend)}:${propertyId}` : null,
    () => backend.loadSite(propertyId!),
    fn => backend.subscribe(propertyId, fn),
  );
}

// ---------------------------------------------------------------------------
// Tiny external stores (hover target + pointer position)
// ---------------------------------------------------------------------------

export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      subs.forEach(fn => fn());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}

export type Store<T> = ReturnType<typeof createStore<T>>;

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export type HoverTarget =
  | { type: 'port'; deviceId: string; key: string }
  | { type: 'device'; deviceId: string }
  | { type: 'link'; linkId: string }
  | { type: 'slot'; u: number };

export const hoverStore = createStore<HoverTarget | null>(null);
export const pointerStore = createStore<{ x: number; y: number }>({ x: 0, y: 0 });

export function sameHover(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'port': return b.type === 'port' && a.deviceId === b.deviceId && a.key === b.key;
    case 'device': return b.type === 'device' && a.deviceId === b.deviceId;
    case 'link': return b.type === 'link' && a.linkId === b.linkId;
    case 'slot': return b.type === 'slot' && a.u === b.u;
  }
}

export function setHover(t: HoverTarget | null) {
  if (!sameHover(hoverStore.get(), t)) hoverStore.set(t);
}

// ---------------------------------------------------------------------------
// Photo URLs (signed URLs are cached for most of their 1h lifetime)
// ---------------------------------------------------------------------------

const urlCache = new Map<string, { url: string; exp: number }>();

export function usePhotoUrl(backend: Backend, path: string | null): string | null {
  const cached = path ? urlCache.get(path) : undefined;
  const [url, setUrl] = useState<string | null>(cached && cached.exp > Date.now() ? cached.url : null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    const c = urlCache.get(path);
    if (c && c.exp > Date.now()) { setUrl(c.url); return; }
    let live = true;
    backend.photoUrl(path).then(u => {
      urlCache.set(path, { url: u, exp: Date.now() + 50 * 60 * 1000 });
      if (live) setUrl(u);
    }, () => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [backend, path]);
  return url;
}

// ---------------------------------------------------------------------------
// Hash routing:  #/  ·  #/site/:pid  ·  #/site/:pid/:rackId  ·  #/library  ·  #/library/:modelId
// ---------------------------------------------------------------------------

export type Route =
  | { page: 'home' }
  | { page: 'import' }
  | { page: 'site'; propertyId: string; rackId: string | null }
  | { page: 'library'; modelId: string | null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'site' && parts[1]) return { page: 'site', propertyId: parts[1], rackId: parts[2] ?? null };
  if (parts[0] === 'library') return { page: 'library', modelId: parts[1] ?? null };
  if (parts[0] === 'import') return { page: 'import' };
  return { page: 'home' };
}

export function routeHash(r: Route): string {
  if (r.page === 'site') return `#/site/${encodeURIComponent(r.propertyId)}${r.rackId ? `/${encodeURIComponent(r.rackId)}` : ''}`;
  if (r.page === 'library') return `#/library${r.modelId ? `/${encodeURIComponent(r.modelId)}` : ''}`;
  if (r.page === 'import') return '#/import';
  return '#/';
}

export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route, replace = false) => {
    const h = routeHash(r);
    if (replace) history.replaceState(null, '', window.location.pathname + window.location.search + h);
    else window.location.hash = h;
    setRoute(r);
  }, []);
  return [route, go];
}
