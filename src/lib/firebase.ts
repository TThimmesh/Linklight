import type { FirebaseOptions } from 'firebase/app';
import { settings } from './settings';

/** Email domains allowed in (from config.js). Empty = any account an admin has created. */
export const ALLOWED_EMAIL_DOMAINS = (settings.allowedEmailDomains ?? []).map(d => d.toLowerCase().replace(/^@/, ''));

export function emailAllowed(email: string | null | undefined): boolean {
  if (!ALLOWED_EMAIL_DOMAINS.length) return true;
  const e = (email ?? '').toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.some(d => e.endsWith(`@${d}`));
}

/**
 * Firebase web config comes from public/config.js when filled in; otherwise,
 * when the site is served by Firebase Hosting, from the reserved
 * /__/firebase/init.json URL Hosting provides automatically.
 */
export async function loadFirebaseConfig(): Promise<FirebaseOptions | null> {
  const cfg = window.LINKLIGHT_FIREBASE;
  if (cfg?.apiKey && cfg?.projectId) return cfg;
  try {
    const res = await fetch('/__/firebase/init.json');
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()) as FirebaseOptions;
  } catch { /* not on Firebase Hosting */ }
  return null;
}
