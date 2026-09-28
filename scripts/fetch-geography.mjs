import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Pin the source so regenerating the assets never silently changes the world.
const revision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const base = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/`;
const directory = new URL('../data/geography/', import.meta.url);
await mkdir(directory, { recursive: true });
const manifest = { source: 'Natural Earth', revision, license: 'Public domain', assets: [] };
for (const name of ['land', 'lakes', 'rivers_lake_centerlines']) {
  const source = `${base}geojson/ne_10m_${name}.geojson`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source}: ${response.status}`);
  const collection = await response.json();
  // Keep geometry and names for inspection; discard unrelated cartographic metadata.
  for (const feature of collection.features) {
    feature.properties = { name: feature.properties.name ?? null };
  }
  const contents = JSON.stringify(collection);
  await writeFile(new URL(`${name}.json`, directory), contents);
  manifest.assets.push({ file: `${name}.json`, source, sha256: createHash('sha256').update(contents).digest('hex') });
}
await writeFile(new URL('sources.json', directory), JSON.stringify(manifest, null, 2) + '\n');
console.log('Saved pinned Natural Earth land, lakes and rivers.');
