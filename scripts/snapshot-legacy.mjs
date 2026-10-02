// Dev helper: turns a Patchwork seed.sql export into
// src/data/legacy-snapshot.local.json (gitignored) so `?demo=migration` can
// preview an import locally. Credentials are left out.
//
//   npm run snapshot -- "path/to/seed.sql"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run snapshot -- "path/to/seed.sql"');
  process.exit(1);
}
const sql = fs.readFileSync(file, 'utf8');

function parseValues(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      let v = '';
      i++;
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; continue; }
        if (s[i] === "'") { i++; break; }
        v += s[i++];
      }
      out.push(v);
    } else if (/[A-Za-z0-9-]/.test(c)) {
      let v = '';
      while (i < s.length && /[A-Za-z0-9_.:-]/.test(s[i])) v += s[i++];
      out.push(v === 'NULL' ? null : v);
    } else i++;
  }
  return out;
}

const tables = { properties: [], devices: [], links: [], activity: [] };
for (const line of sql.split(/\r?\n/)) {
  const m = line.match(/^insert into (\w+) \(([^)]*)\) values \((.*)\);$/);
  if (!m || !tables[m[1]]) continue;
  const names = m[2].split(',').map(x => x.trim());
  const vals = parseValues(m[3].replace(/::\w+/g, ''));
  const row = {};
  names.forEach((n, k) => { row[n] = vals[k]; });
  for (const k of ['findings', 'tags', 'credentials']) if (typeof row[k] === 'string') row[k] = JSON.parse(row[k]);
  delete row.credentials;
  tables[m[1]].push(row);
}

const out = path.join(root, 'src/data/legacy-snapshot.local.json');
fs.writeFileSync(out, JSON.stringify(tables));
console.log(`Wrote ${out}: ${Object.entries(tables).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
