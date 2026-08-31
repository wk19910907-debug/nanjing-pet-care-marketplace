import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, access, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
if (output === root) throw new Error('Build output must not overwrite source');
const manifest = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'));
const entries = ['app', ...manifest.pages];
if (!entries.every((entry) => /^(app|pages\/[a-z0-9/-]+)$/.test(entry) && !entry.includes('..'))) throw new Error('Invalid declared entry');
const indexPath = path.join(output, '.mini-generated.json');
const previous = await readFile(indexPath, 'utf8').then(JSON.parse).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (!Array.isArray(previous)) throw new Error('Invalid previous build manifest');
const generated = entries.map((entry) => `${entry}.js`);
await build({ absWorkingDir: root, entryPoints: entries.map((entry) => `${entry}.ts`),
  outdir: output, outbase: root, bundle: true, platform: 'browser', format: 'iife',
  target: 'es2020', sourcemap: false, minify: true, legalComments: 'eof' });
for (const entry of entries) {
  if (!/^(app|pages\/[a-z0-9/-]+)$/.test(entry)) throw new Error('Invalid declared entry');
  for (const extension of entry === 'app' ? ['.json', '.wxss'] : ['.json', '.wxml', '.wxss']) {
    const source = path.join(root, `${entry}${extension}`);
    if (!await access(source).then(() => true).catch(() => false)) continue;
    const target = path.join(output, `${entry}${extension}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    generated.push(`${entry}${extension}`);
  }
}
const realOutput = await realpath(output);
for (const filename of previous) {
  if (generated.includes(filename)) continue;
  if (typeof filename !== 'string' || !/^(app|pages\/[a-z0-9/-]+)\.(js|json|wxml|wxss)$/.test(filename)
    || filename.includes('..')) throw new Error('Unsafe previous build path');
  const target = path.resolve(output, filename);
  if (!await access(target).then(() => true).catch(() => false)) continue;
  const realParent = await realpath(path.dirname(target));
  if (realParent !== realOutput && !realParent.startsWith(`${realOutput}${path.sep}`)) throw new Error('Build cleanup escapes output');
  await unlink(target);
}
await writeFile(indexPath, JSON.stringify(generated, null, 2));
process.stdout.write(`Built ${entries.length} mini-program entrypoints.\n`);
