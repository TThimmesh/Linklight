/** Same id shape the original Patchwork site generates, so rows from either app look alike. */
export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function nowIso(): string {
  return new Date().toISOString();
}
