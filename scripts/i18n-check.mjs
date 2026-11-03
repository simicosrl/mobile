// Lists the t('…') texts in src that have no French translation yet.
// Usage: node scripts/i18n-check.mjs [file-or-dir…]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fr from '../src/i18n/fr/index.js';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src'];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f)); return; }
  if (/\.(jsx?|mjs)$/.test(p) && !p.includes('/i18n/')) files.push(p);
};
roots.forEach(walk);

const re = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
let missing = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) {
    if (m[1] === '`' && m[2].includes('${')) { console.log(`${f}: template literal with \${} in t(): ${m[2]}`); missing++; continue; }
    const key = m[2].replace(/\\(['"`\\])/g, '$1');
    if (!(key in fr)) { console.log(`${f}: missing FR: ${key}`); missing++; }
  }
}
console.log(missing ? `${missing} missing` : 'all translated');
process.exit(missing ? 1 : 0);
