import type { Backend } from '../lib/backend';
import { createDemoBackend } from '../lib/demoBackend';
import { buildBundles, type LegacyData } from '../lib/importer';

// Development-only entry points (main.tsx only imports this when
// import.meta.env.DEV is true, so none of it ships in production builds).
//
//   ?demo            a fictional property in two racks
//   ?demo=migration  preview of a Patchwork import: a seed.sql export run
//                    through the real importer (+ the local rack plan, if any).
//                    Needs src/data/legacy-snapshot.local.json (npm run snapshot).

const snapshots = import.meta.glob<{ default: LegacyData }>('../data/legacy-snapshot.local.json');

export async function startDemo(variant: string): Promise<Backend> {
  if (variant !== 'migration') return createDemoBackend('sample');
  const backend = createDemoBackend('empty');
  const load = snapshots['../data/legacy-snapshot.local.json'];
  if (!load) throw new Error('No snapshot found — run `npm run snapshot` first.');
  const legacy = (await load()).default;
  const { bundles, reports } = buildBundles(legacy, { arrange: true, credentials: false });
  for (const b of bundles) await backend.importSite(b);
  console.table(reports);
  return backend;
}
