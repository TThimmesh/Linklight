interface Window {
  /** Firebase web config from public/config.js. Optional when hosted on Firebase Hosting. */
  LINKLIGHT_FIREBASE?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  /** Optional per-deployment settings from public/config.js — see src/lib/settings.ts. */
  LINKLIGHT_SETTINGS?: import('./lib/settings').LinklightSettings;
}
