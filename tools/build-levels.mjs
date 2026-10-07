#!/usr/bin/env node
// Builds every level listed below into levels/<id>/{models.bin, level.json}
// and writes levels/manifest.json (level order + byte sizes for the loader).
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeModelPack } from './lib/mesh.mjs';
import * as hillfort from './levels/hillfort.mjs';

const LEVELS = [hillfort]; // add new level modules here, in play order

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = { version: 1, levels: [] };

for (const mod of LEVELS) {
  const t0 = performance.now();
  const { models, blobs, level } = mod.build();
  for (const inst of level.instances ?? []) {
    if (!models[inst.model]) throw new Error(`${mod.id}: instance references unknown model "${inst.model}"`);
  }
  const dir = join(root, 'levels', mod.id);
  mkdirSync(dir, { recursive: true });
  const pack = writeModelPack(models, blobs);
  writeFileSync(join(dir, level.models), pack);
  writeFileSync(join(dir, 'level.json'), JSON.stringify(level, null, 1) + '\n');
  const files = ['level.json', level.models].map((f) => ({ path: `levels/${mod.id}/${f}`, bytes: statSync(join(dir, f)).size }));
  manifest.levels.push({ id: mod.id, name: level.name, files });
  const kb = (files.reduce((s, f) => s + f.bytes, 0) / 1024).toFixed(1);
  console.log(`built ${mod.id}: ${Object.keys(models).length} models, ${level.instances.length} instances, ${kb} KiB (${(performance.now() - t0).toFixed(0)} ms)`);
}

writeFileSync(join(root, 'levels', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
