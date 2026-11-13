/** Copies only site assets; no bundler, network requests or dependency install. */
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'src', 'assets', '.nojekyll']) {
  await cp(path.join(root, name), path.join(dist, name), { recursive: true });
}
const repository = process.env.GITHUB_REPOSITORY;
if (repository && /^[\w.-]+\/[\w.-]+$/.test(repository)) {
  const [owner, repo] = repository.split('/');
  const origin = `https://${owner.toLowerCase()}.github.io`;
  const homepage = repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `${origin}/` : `${origin}/${repo}/`;
  const htmlFile = path.join(dist, 'index.html');
  let html = await readFile(htmlFile, 'utf8');
  html = html.replaceAll('https://goprogabriel.github.io/tilezip/', homepage)
    .replaceAll('https://github.com/Goprogabriel/tilezip', `https://github.com/${repository}`);
  await writeFile(htmlFile, html);
  const configFile = path.join(dist, 'src/config.js');
  const config = (await readFile(configFile, 'utf8')).replace("'Goprogabriel/tilezip'", `'${repository}'`);
  await writeFile(configFile, config);
}
console.log('Built dist/ — a completely static site, ready for GitHub Pages.');
