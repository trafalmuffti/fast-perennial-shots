#!/usr/bin/env node
// Fails if the shipped game (everything the browser downloads) exceeds the budget.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET = 100 * 1024 * 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shipped = ['index.html', 'src', 'levels'];

let total = 0;
const rows = [];
const walk = (p) => {
  const s = statSync(p);
  if (s.isDirectory()) return readdirSync(p).forEach((f) => walk(join(p, f)));
  total += s.size;
  rows.push([p.slice(root.length + 1), s.size]);
};
shipped.forEach((p) => walk(join(root, p)));
rows.sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([p, s]) => console.log(`${(s / 1024).toFixed(1).padStart(9)} KiB  ${p}`));
const pct = ((total / BUDGET) * 100).toFixed(2);
console.log(`\nTotal shipped: ${(total / 1024 / 1024).toFixed(2)} MiB of 100 MiB budget (${pct}%)`);
if (total > BUDGET) {
  console.error('Size budget exceeded!');
  process.exit(1);
}
