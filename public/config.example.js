// Linklight — deployment settings (template).
//
// Copy this file to public/config.js and fill it in. public/config.js is
// gitignored, so each deployment keeps its own values out of the repo.
//
// On Firebase Hosting the LINKLIGHT_FIREBASE block can be left out entirely —
// the app reads the same values from Hosting automatically. It's needed for
// running locally with `npm run dev`.

// Firebase console → Project settings (gear) → General → Your apps → Web app → Config.
// These are public identifiers; firestore.rules is what protects the data.
window.LINKLIGHT_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// Optional. Delete anything you don't need.
window.LINKLIGHT_SETTINGS = {
  // Only accounts with these email domains may use the app (also set the same
  // domain in firestore.rules). Leave empty to allow any account you create.
  allowedEmailDomains: [],

  // Shown under the logo on the sign-in screen.
  // tagline: "Network documentation for Example Corp.",

  // Moving from the original Patchwork app? Fill this in to show
  // the "From Patchwork" import (see README → Migrating from Patchwork).
  // patchworkImport: { supabaseUrl: "https://xxxx.supabase.co", supabaseKey: "sb_publishable_..." },
};
