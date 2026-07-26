/**
 * Copies non-TypeScript runtime assets (EJS views, static files) into dist/.
 * Runs as part of `npm run build`.
 */
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assets = ['views', 'public'];

await mkdir(path.join(root, 'dist'), { recursive: true });

for (const asset of assets) {
  const from = path.join(root, 'src', asset);
  if (!existsSync(from)) continue;
  await cp(from, path.join(root, 'dist', asset), { recursive: true });
  console.log(`[copy-assets] src/${asset} -> dist/${asset}`);
}
