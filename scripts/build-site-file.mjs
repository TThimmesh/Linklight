// Builds a Linklight site file from a folder:
//
//   <folder>/site.json      the site description (see docs/site-spec.example.json)
//   <folder>/photos/*.jpg   photos referenced by name from site.json
//
//   npm run site-file -- "path/to/folder"
//
// Writes <folder>/<property id>.linklight.json, which is imported from the
// app's Import page. Equipment models used by devices are copied in from
// src/data/equipment-library.json automatically; custom ones can be listed
// under "models" in site.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npm run site-file -- "path/to/folder"   (the folder must contain site.json)');
  process.exit(1);
}
const dir = path.resolve(folder);
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
const library = JSON.parse(fs.readFileSync(path.join(root, 'src/data/equipment-library.json'), 'utf8'));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const problems = [];
let photoCount = 0;

function photo(name) {
  const candidates = [path.join(dir, name), path.join(dir, 'photos', name)];
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) { problems.push(`Photo not found: ${name}`); return null; }
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) { problems.push(`Unsupported photo type: ${name}`); return null; }
  photoCount++;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const devices = (spec.devices ?? []).map(({ photo: p, ...d }) => ({ ...d, photoData: p ? photo(p) : null }));
const ports = (spec.ports ?? []).map(({ photos = [], ...p }) => ({
  ...p,
  photoData: photos.map(name => ({ name, data: photo(name) })).filter(x => x.data),
}));

// equipment models: custom ones from site.json + any library model a device uses
const models = [...(spec.models ?? [])];
const wanted = new Set([...(spec.includeModels ?? []), ...devices.map(d => d.modelId).filter(Boolean)]);
for (const id of wanted) {
  if (models.some(m => m.id === id)) continue;
  const m = library.find(x => x.id === id);
  if (m) models.push(m); else problems.push(`Model "${id}" isn't in site.json "models" or the starter library.`);
}

if (problems.length) {
  console.error('Problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const out = {
  linklightSite: 1,
  models,
  property: spec.property,
  racks: spec.racks ?? [],
  devices,
  links: spec.links ?? [],
  ports,
  activity: spec.activity ?? [],
};
const file = path.join(dir, `${spec.property.id}.linklight.json`);
fs.writeFileSync(file, JSON.stringify(out));
const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${file} (${mb} MB)`);
console.log(`  ${out.racks.length} racks, ${devices.length} devices (${devices.filter(d => d.rackId).length} in racks), ${out.links.length} cable runs, ${photoCount} photos, ${models.length} models`);
