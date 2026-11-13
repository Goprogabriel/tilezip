import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
async function check(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(relative);
    else if (/\.(js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, relative)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      count++;
    }
  }
}
await check('src');
await check('scripts');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs.');
const code = await readFile(path.join(root, 'src/app.js'), 'utf8');
for (const match of code.matchAll(/\$\('([^']+)'\)/g)) {
  if (!ids.includes(match[1])) throw new Error(`Missing element: #${match[1]}`);
}
for (const file of ['assets/favicon.svg', 'assets/desert-study.jpg', 'assets/social-card.png', '.github/workflows/deploy.yml']) await access(path.join(root, file));
console.log(`Checked ${count} JavaScript files, ${ids.length} HTML IDs and required static assets.`);
