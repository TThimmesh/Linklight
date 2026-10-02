/**
 * Per-deployment settings from public/config.js (copy public/config.example.js).
 * Everything is optional; a deployment with no config.js still works on
 * Firebase Hosting with the defaults below.
 */
export interface LinklightSettings {
  /**
   * Only accounts with these email domains may use the app, e.g. ["example.com"].
   * Empty or missing = any account an admin has created. This is the in-app
   * check; firestore.rules enforces access on the server.
   */
  allowedEmailDomains?: string[];
  /** Line shown under the logo on the sign-in screen. */
  tagline?: string;
  /** Turns on "Import from Patchwork" and pre-fills its connection details. */
  patchworkImport?: { supabaseUrl: string; supabaseKey: string };
}

export const settings: LinklightSettings = window.LINKLIGHT_SETTINGS ?? {};
