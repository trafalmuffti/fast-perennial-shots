// Reusable model generators shared across levels (soldiers, weapons, props,
// effects). Each returns { mesh, colliders?, meta? } ready for writeModelPack.
import { MeshBuilder, hex } from './mesh.mjs';
import { mat4 } from '../../src/math.js';

const WOOD = hex(0x7a5a3a);
const WOOD_DARK = hex(0x5a4129);
const WOOD_LIGHT = hex(0x9c7a52);
const METAL = hex(0x2d3034);
const SKIN = hex(0xc49a7a);
const BLACK = hex(0x1d1e1f);
const WHITE = [1, 1, 1];

let seedCounter = 100;
const mb = () => new MeshBuilder(seedCounter++);

// ---------------------------------------------------------------- structures

export function palisade({ height = 4.4, width = 2, logs = 4, seed = 1 } = {}) {
  const m = new MeshBuilder(seed);
  const spacing = width / logs;
  for (let i = 0; i < logs; i++) {
    const x = -width / 2 + spacing * (i + 0.5);
    const h = height + (m.rand() - 0.5) * 0.5;
    const r = 0.24 + m.rand() * 0.04;
    const col = m.jitterColor(WOOD, 0.3);
    m.cylinder(x, -0.3, 0, r, h + 0.3, 7, col, { capTop: false });
    m.cylinder(x, h, 0, r, 0.5, 7, v3s(col, 0.9), { r2: 0.02 });
  }
  // Horizontal braces on the inner (+Z) side.
  m.rod([-width / 2, 1.2, 0.3], [width / 2, 1.2, 0.3], 0.09, 5, WOOD_DARK);
  m.rod([-width / 2, height - 0.9, 0.3], [width / 2, height - 0.9, 0.3], 0.09, 5, WOOD_DARK);
  return { mesh: m, colliders: [{ min: [-width / 2, 0, -0.3], max: [width / 2, height + 0.1, 0.3] }] };
}

const v3s = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// A straight wall run along X (centered at origin, thickness along Z) with
// rectangular openings. Emits boxes + colliders into `out`.
function wallX(m, out, x0, x1, z, height, thick, openings, color) {
  const pieces = [];
  let cursor = x0;
  const sorted = [...openings].sort((a, b) => a.a - b.a);
  for (const o of sorted) {
    if (o.a > cursor) pieces.push([cursor, o.a, 0, height]);
    if (o.y0 > 0) pieces.push([o.a, o.b, 0, o.y0]);
    if (o.y1 < height) pieces.push([o.a, o.b, o.y1, height]);
    cursor = o.b;
  }
  if (cursor < x1) pieces.push([cursor, x1, 0, height]);
  for (const [a, b, y0, y1] of pieces) {
    const min = [a, y0, z - thick / 2], max = [b, y1, z + thick / 2];
    m.boxMinMax(min, max, color, 0.12);
    out.push({ min, max });
  }
  // Vertical plank seams for some texture.
  for (let x = x0 + 0.5; x < x1; x += 0.5) {
    if (sorted.some((o) => x > o.a - 0.05 && x < o.b + 0.05)) continue;
    m.box(x, height / 2, z - thick / 2 - 0.01, 0.04, height, 0.02, v3s(color, 0.75));
    m.box(x, height / 2, z + thick / 2 + 0.01, 0.04, height, 0.02, v3s(color, 0.75));
  }
}

// Same as wallX but running along Z at fixed X.
function wallZ(m, out, z0, z1, x, height, thick, openings, color) {
  const rot = mat4.rotationY(Math.PI / 2); // local X -> world -Z
  const local = [];
  m.with(rot, () => wallX(m, local, -z1, -z0, x, height, thick, openings.map((o) => ({ ...o, a: -o.b, b: -o.a })), color));
  // Convert colliders back: under RotY(90°) local (x,y,z) -> world (z, y, -x)… rotationY(a) maps x→(c,0,-s) => (0,0,-1); z→(s,0,c) => (1,0,0).
  for (const c of local) {
    out.push({ min: [c.min[2], c.min[1], -c.max[0]], max: [c.max[2], c.max[1], -c.min[0]] });
  }
}

// Rectangular building with optional partition, door/window openings, roof.
// spec: { w, d, h, walls: { n:[openings], s:[], e:[], w:[] }, partitions: [{axis:'x'|'z', at, from, to, openings}] }
export function building(spec) {
  const m = mb();
  const col = [];
  const { w, d, h } = spec;
  const t = 0.3;
  const wallCol = WOOD;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  // Floor boards.
  m.boxMinMax([x0, 0, z0], [x1, 0.06, z1], WOOD_LIGHT, 0.1);
  wallX(m, col, x0, x1, z0 + t / 2, h, t, spec.walls.n || [], wallCol);
  wallX(m, col, x0, x1, z1 - t / 2, h, t, spec.walls.s || [], wallCol);
  wallZ(m, col, z0 + t, z1 - t, x0 + t / 2, h, t, spec.walls.w || [], wallCol);
  wallZ(m, col, z0 + t, z1 - t, x1 - t / 2, h, t, spec.walls.e || [], wallCol);
  for (const p of spec.partitions || []) {
    if (p.axis === 'x') wallX(m, col, p.from, p.to, p.at, h, 0.2, p.openings || [], WOOD_DARK);
    else wallZ(m, col, p.from, p.to, p.at, h, 0.2, p.openings || [], WOOD_DARK);
  }
  // Corner posts.
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    m.cylinder(cx, 0, cz, 0.22, h + 0.2, 6, WOOD_DARK);
  }
  // Gable roof along X axis.
  const pitch = 0.42;
  const over = 0.5;
  const halfD = d / 2 + over;
  const slopeLen = halfD / Math.cos(pitch);
  const ridge = h + Math.tan(pitch) * halfD;
  for (const side of [-1, 1]) {
    m.with(mat4.chain(mat4.translation(0, (h + ridge) / 2 + 0.08, (side * halfD) / 2), mat4.rotationX(side * pitch)), () => {
      for (let i = 0; i < 6; i++) {
        const z = -slopeLen / 2 + (slopeLen / 6) * (i + 0.5);
        m.box(0, 0, z, w + over * 2, 0.14, slopeLen / 6 + 0.02, hex(0x6b5034), 0.25);
      }
    });
  }
  // Gable end triangles (approximated by stacked boxes).
  for (const x of [x0 + 0.05, x1 - 0.05]) {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const y = h + ((ridge - h) * i) / steps;
      const hd = (d / 2) * (1 - (i + 0.5) / steps);
      m.box(x, y + (ridge - h) / steps / 2, 0, 0.2, (ridge - h) / steps, hd * 2, WOOD_DARK, 0.1);
    }
  }
  col.push({ min: [x0, h, z0], max: [x1, h + 0.4, z1] });
  return { mesh: m, colliders: col };
}

export function stairs({ steps = 12, rise = 0.4, run = 0.6, width = 2 } = {}) {
  const m = mb();
  const col = [];
  for (let i = 0; i < steps; i++) {
    const min = [-width / 2, 0, -(i + 1) * run], max = [width / 2, (i + 1) * rise, -i * run];
    // Visual: a tread plank and a riser, plus solid support underneath.
    m.boxMinMax([min[0], max[1] - 0.08, min[2]], [max[0], max[1], max[2] + 0.04], WOOD_LIGHT, 0.2);
    m.boxMinMax([min[0] + 0.1, max[1] - rise, max[2] - 0.06], [max[0] - 0.1, max[1] - 0.08, max[2] - 0.02], WOOD_DARK, 0.1);
    col.push({ min, max });
  }
  // Stringers.
  for (const x of [-width / 2 + 0.06, width / 2 - 0.06]) {
    m.rod([x, 0, 0], [x, steps * rise, -steps * run], 0.08, 5, WOOD_DARK);
  }
  // Support posts.
  for (let i = 3; i < steps; i += 4) {
    for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) m.cylinder(x, 0, -(i + 0.5) * run, 0.1, (i + 1) * rise, 5, WOOD_DARK);
  }
  return { mesh: m, colliders: col };
}

// Square watch tower. Platform top at `deck`, opening on local +X side
// between z = openA..openB for stairs.
export function watchtower({ size = 5, deck = 6, openA = -1, openB = 1 } = {}) {
  const m = mb();
  const col = [];
  const hs = size / 2;
  const legIn = hs - 0.3;
  const roofY = deck + 2.6;
  for (const [x, z] of [[-legIn, -legIn], [legIn, -legIn], [-legIn, legIn], [legIn, legIn]]) {
    m.cylinder(x, -0.3, z, 0.25, roofY + 0.3, 7, WOOD, { jitter: 0.2 });
    col.push({ min: [x - 0.25, 0, z - 0.25], max: [x + 0.25, roofY, z + 0.25] });
  }
  // Cross braces.
  for (const [a, b] of [
    [[-legIn, 0.5, -legIn], [legIn, deck - 0.5, -legIn]],
    [[legIn, 0.5, legIn], [-legIn, deck - 0.5, legIn]],
    [[-legIn, 0.5, legIn], [-legIn, deck - 0.5, -legIn]],
    [[legIn, 0.5, -legIn], [legIn, deck - 0.5, legIn]],
  ]) m.rod(a, b, 0.09, 5, WOOD_DARK);
  // Deck.
  const deckMin = [-hs, deck - 0.3, -hs], deckMax = [hs, deck, hs];
  for (let i = 0; i < 8; i++) {
    const z0 = -hs + (size / 8) * i;
    m.boxMinMax([-hs, deck - 0.3, z0], [hs, deck, z0 + size / 8 - 0.02], WOOD_LIGHT, 0.25);
  }
  col.push({ min: deckMin, max: deckMax });
  // Parapets (1.1 m), +X side has a gap for the stairs.
  const ph = 1.1;
  const para = (min, max) => {
    m.boxMinMax(min, max, WOOD, 0.15);
    col.push({ min, max });
  };
  para([-hs, deck, -hs], [hs, deck + ph, -hs + 0.15]);
  para([-hs, deck, hs - 0.15], [hs, deck + ph, hs]);
  para([-hs, deck, -hs], [-hs + 0.15, deck + ph, hs]);
  if (openA > -hs) para([hs - 0.15, deck, -hs], [hs, deck + ph, openA]);
  if (openB < hs) para([hs - 0.15, deck, openB], [hs, deck + ph, hs]);
  // Pyramid roof.
  m.with(mat4.translation(0, roofY, 0), () => {
    m.boxMinMax([-hs - 0.4, 0, -hs - 0.4], [hs + 0.4, 0.15, hs + 0.4], hex(0x6b5034), 0.1);
    m.with(mat4.rotationY(Math.PI / 4), () => m.cylinder(0, 0.15, 0, hs * 1.5, 1.6, 4, hex(0x5e4630), { r2: 0.05, capTop: false }));
  });
  col.push({ min: [-hs - 0.4, roofY, -hs - 0.4], max: [hs + 0.4, roofY + 1.2, hs + 0.4] });
  return { mesh: m, colliders: col, meta: { deck } };
}

// Gate house: two posts either side of the opening and a fighting platform
// above it. Local +Z is outside the fort.
export function gatehouse({ deck = 4.6, halfW = 4.6, zIn = -2.6, zOut = 1.2, stairZ = [-2.6, -0.6] } = {}) {
  const m = mb();
  const col = [];
  const solid = (min, max, c = WOOD, j = 0.15) => {
    m.boxMinMax(min, max, c, j);
    col.push({ min, max });
  };
  const roofY = deck + 2.8;
  for (const x of [-2.3, 2.3]) {
    m.cylinder(x, -0.3, 0, 0.38, roofY + 0.3, 8, WOOD_DARK, { jitter: 0.1 });
    col.push({ min: [x - 0.38, 0, -0.38], max: [x + 0.38, roofY, 0.38] });
  }
  for (const [x, z] of [[-halfW + 0.2, zIn + 0.2], [halfW - 0.2, zIn + 0.2]]) {
    m.cylinder(x, -0.3, z, 0.2, roofY + 0.3, 6, WOOD, { jitter: 0.2 });
    col.push({ min: [x - 0.2, 0, z - 0.2], max: [x + 0.2, roofY, z + 0.2] });
  }
  for (const [x, z] of [[-halfW + 0.2, zOut - 0.2], [halfW - 0.2, zOut - 0.2]]) {
    m.cylinder(x, deck, z, 0.16, roofY - deck, 6, WOOD, { jitter: 0.2 });
  }
  // Lintel beam over the gate.
  m.rod([-3.2, deck - 0.5, 0], [3.2, deck - 0.5, 0], 0.22, 6, WOOD_DARK);
  // Deck planks.
  for (let i = 0; i < 10; i++) {
    const x0 = -halfW + ((halfW * 2) / 10) * i;
    m.boxMinMax([x0, deck - 0.3, zIn], [x0 + (halfW * 2) / 10 - 0.02, deck, zOut], WOOD_LIGHT, 0.25);
  }
  col.push({ min: [-halfW, deck - 0.3, zIn], max: [halfW, deck, zOut] });
  // Parapets.
  solid([-halfW, deck, zOut - 0.18], [halfW, deck + 1.15, zOut]);
  solid([-halfW, deck, zIn], [-halfW + 0.15, deck + 1.15, zOut]);
  solid([halfW - 0.15, deck, stairZ[1]], [halfW, deck + 1.15, zOut]);
  // Inner railing (low, can shoot over it).
  m.rod([-halfW, deck + 0.95, zIn + 0.05], [halfW - 2.4, deck + 0.95, zIn + 0.05], 0.06, 5, WOOD_DARK);
  // Roof.
  m.with(mat4.chain(mat4.translation(0, roofY, (zIn + zOut) / 2), mat4.rotationX(-0.12)), () => {
    m.boxMinMax([-halfW - 0.4, 0, (zIn - zOut) / 2 - 0.5], [halfW + 0.4, 0.15, (zOut - zIn) / 2 + 0.5], hex(0x6b5034), 0.2);
  });
  col.push({ min: [-halfW - 0.4, roofY - 0.3, zIn - 0.5], max: [halfW + 0.4, roofY + 0.4, zOut + 0.5] });
  return { mesh: m, colliders: col };
}

export function gateDoor() {
  const m = mb();
  for (let i = 0; i < 5; i++) {
    m.boxMinMax([i * 0.4, 0, -0.06], [i * 0.4 + 0.38, 3.6 + (i % 2) * 0.1, 0.06], WOOD, 0.25);
  }
  m.boxMinMax([0, 0.6, 0.06], [2, 0.8, 0.12], WOOD_DARK);
  m.boxMinMax([0, 2.8, 0.06], [2, 3.0, 0.12], WOOD_DARK);
  m.rod([0.1, 0.8, 0.09], [1.9, 2.8, 0.09], 0.06, 4, WOOD_DARK);
  return { mesh: m, colliders: [{ min: [0, 0, -0.08], max: [2, 3.7, 0.12] }] };
}

// Lean-to shelter: posts + sloped roof, open sides.
export function shed({ w = 7, d = 4, h = 3 } = {}) {
  const m = mb();
  const col = [];
  for (const [x, z, hh] of [[-w / 2, -d / 2, h + 0.6], [w / 2, -d / 2, h + 0.6], [-w / 2, d / 2, h], [w / 2, d / 2, h], [0, d / 2, h], [0, -d / 2, h + 0.6]]) {
    m.cylinder(x, 0, z, 0.15, hh, 6, WOOD_DARK);
    col.push({ min: [x - 0.15, 0, z - 0.15], max: [x + 0.15, hh, z + 0.15] });
  }
  const a = Math.atan2(0.6, d);
  m.with(mat4.chain(mat4.translation(0, h + 0.38, 0), mat4.rotationX(a)), () => {
    for (let i = 0; i < 6; i++) {
      const x0 = -w / 2 - 0.4 + ((w + 0.8) / 6) * i;
      m.boxMinMax([x0, 0, -d / 2 - 0.4], [x0 + (w + 0.8) / 6 - 0.03, 0.1, d / 2 + 0.4], hex(0x6b5034), 0.25);
    }
  });
  col.push({ min: [-w / 2 - 0.4, h, -d / 2 - 0.4], max: [w / 2 + 0.4, h + 0.75, d / 2 + 0.4] });
  return { mesh: m, colliders: col };
}

// ---------------------------------------------------------------- props

export function crate(size = 1.2, color = WOOD_LIGHT) {
  const m = mb();
  const s = size;
  m.box(0, s / 2, 0, s, s, s, color, 0.15);
  const e = 0.09;
  const dark = v3s(color, 0.65);
  // Edge frame.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    m.box((x * (s - e)) / 2, s / 2, (z * (s - e)) / 2, e + 0.02, s + 0.02, e + 0.02, dark);
  }
  for (const y of [e / 2, s - e / 2]) {
    m.box(0, y, (s - e) / 2, s + 0.02, e + 0.02, e + 0.02, dark);
    m.box(0, y, -(s - e) / 2, s + 0.02, e + 0.02, e + 0.02, dark);
    m.box((s - e) / 2, y, 0, e + 0.02, e + 0.02, s + 0.02, dark);
    m.box(-(s - e) / 2, y, 0, e + 0.02, e + 0.02, s + 0.02, dark);
  }
  // Diagonal braces on two faces.
  m.with(mat4.chain(mat4.translation(0, s / 2, s / 2 + 0.02), mat4.rotationZ(Math.PI / 4)), () => m.box(0, 0, 0, s * 1.25, e, 0.03, dark));
  m.with(mat4.chain(mat4.translation(0, s / 2, -s / 2 - 0.02), mat4.rotationZ(-Math.PI / 4)), () => m.box(0, 0, 0, s * 1.25, e, 0.03, dark));
  return { mesh: m, colliders: [{ min: [-s / 2, 0, -s / 2], max: [s / 2, s, s / 2] }] };
}

export function longCrate() {
  const m = mb();
  m.box(0, 0.45, 0, 2.2, 0.9, 0.9, hex(0x5c6b45), 0.1);
  for (const x of [-0.9, 0, 0.9]) m.box(x, 0.45, 0, 0.12, 0.94, 0.94, hex(0x3e4a2e));
  m.box(0, 0.6, 0.46, 0.8, 0.18, 0.01, hex(0xd8c87a));
  return { mesh: m, colliders: [{ min: [-1.1, 0, -0.45], max: [1.1, 0.9, 0.45] }] };
}

export function barrel() {
  const m = mb();
  m.cylinder(0, 0, 0, 0.36, 1.1, 10, hex(0x6d4c2e), { jitter: 0.1 });
  for (const y of [0.15, 0.55, 0.95]) m.cylinder(0, y, 0, 0.375, 0.07, 10, METAL, { capTop: false });
  return { mesh: m, colliders: [{ min: [-0.36, 0, -0.36], max: [0.36, 1.1, 0.36] }] };
}

export function sandbags(len = 3) {
  const m = mb();
  const n = Math.round(len / 0.6);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < n - (row % 2); i++) {
      const x = -len / 2 + 0.3 + i * 0.6 + (row % 2) * 0.3;
      m.with(mat4.translation(x, 0.17 + row * 0.3, 0), () => m.sphere(0, 0, 0, 0.32, 7, 4, m.jitterColor(hex(0xa69a72), 0.15), 0.5));
    }
  }
  return { mesh: m, colliders: [{ min: [-len / 2, 0, -0.35], max: [len / 2, 0.95, 0.35] }] };
}

export function bunk() {
  const m = mb();
  for (const [x, z] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) m.box(x, 0.9, z, 0.08, 1.8, 0.08, WOOD_DARK);
  for (const y of [0.35, 1.35]) {
    m.box(0, y, 0, 2.0, 0.08, 0.9, WOOD);
    m.box(0, y + 0.1, 0, 1.85, 0.12, 0.8, hex(0x6a6e5a), 0.1);
    m.box(-0.75, y + 0.2, 0, 0.3, 0.1, 0.6, hex(0xd8d4c4));
  }
  return { mesh: m, colliders: [{ min: [-1, 0, -0.45], max: [1, 1.8, 0.45] }] };
}

export function table() {
  const m = mb();
  m.box(0, 0.78, 0, 1.8, 0.07, 0.9, WOOD_LIGHT, 0.1);
  for (const [x, z] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]]) m.box(x, 0.39, z, 0.08, 0.78, 0.08, WOOD_DARK);
  // Map + radio on the table.
  m.box(-0.2, 0.82, 0, 0.8, 0.01, 0.55, hex(0xd9cfa8));
  m.box(-0.35, 0.83, -0.05, 0.25, 0.01, 0.18, hex(0x6f8f5a));
  m.box(0.55, 0.9, 0.1, 0.35, 0.2, 0.25, hex(0x46503d));
  m.rod([0.65, 1.0, 0.15], [0.7, 1.5, 0.18], 0.01, 3, BLACK);
  return { mesh: m, colliders: [{ min: [-0.9, 0, -0.45], max: [0.9, 0.85, 0.45] }] };
}

export function ammoBox() {
  const m = mb();
  m.box(0, 0.2, 0, 0.7, 0.4, 0.4, hex(0x4f5d3a), 0.05);
  m.box(0, 0.42, 0, 0.5, 0.05, 0.1, BLACK);
  m.box(0, 0.25, 0.205, 0.6, 0.08, 0.01, hex(0xffd23a));
  m.box(0, 0.25, -0.205, 0.6, 0.08, 0.01, hex(0xffd23a));
  return { mesh: m };
}

export function pine(seed, h = 9) {
  const m = new MeshBuilder(seed);
  m.cylinder(0, -0.3, 0, 0.28, h * 0.45, 6, hex(0x4e3726));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const y = h * 0.18 + i * h * 0.19;
    const r = (1 - i / tiers) * h * 0.28 + 0.6;
    m.cylinder(0, y, 0, r, h * 0.36, 8, m.jitterColor(hex(0x2f5230), 0.25), { r2: 0.05, capBottom: true, capTop: false });
  }
  return { mesh: m, colliders: [{ min: [-0.3, 0, -0.3], max: [0.3, h * 0.6, 0.3] }] };
}

export function rock(seed) {
  const m = new MeshBuilder(seed);
  m.sphere(0, 0.3, 0, 1, 7, 5, hex(0x7b7870), 0.65);
  // Wobble vertices for an irregular silhouette.
  for (const p of m.pos) {
    const k = 0.75 + m.rand() * 0.5;
    p[0] *= k; p[2] *= k; p[1] = Math.max(p[1] * (0.8 + m.rand() * 0.4), -0.2);
  }
  return { mesh: m, colliders: [{ min: [-0.8, 0, -0.8], max: [0.8, 0.85, 0.8] }] };
}

// ---------------------------------------------------------------- flag

export function flagpole(height = 9.5) {
  const m = mb();
  m.cylinder(0, 0, 0, 0.09, height, 8, hex(0xb8b8b0), { r2: 0.06 });
  m.sphere(0, height + 0.08, 0, 0.13, 8, 5, hex(0xd8b04a));
  // Rope and cleat.
  m.rod([0.1, 1.2, 0], [0.1, height - 0.1, 0], 0.012, 3, hex(0xe0dcc8));
  m.box(0.12, 1.2, 0, 0.05, 0.2, 0.05, METAL);
  return { mesh: m, colliders: [{ min: [-0.12, 0, -0.12], max: [0.12, height, 0.12] }], meta: { height } };
}

// Flag cloth: hoist edge at x=0, extends +X. Waves in the vertex shader.
export function flagCloth(w = 2.4, h = 1.5) {
  const m = mb();
  const red = hex(0x8d1d1d), black = hex(0x1c1c1c), bone = hex(0xe6dcc0);
  m.cloth(w, h, 16, 6, (u, v) => {
    const x = u * w, y = v * h;
    const dx = x - w * 0.36, dy = y - h * 0.5;
    if (Math.hypot(dx, dy) < h * 0.26 && Math.hypot(dx, dy) > h * 0.17) return bone;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < h * 0.26) return bone;
    if (Math.abs(y - h * 0.12) < 0.07 || Math.abs(y - h * 0.88) < 0.07) return black;
    return red;
  });
  return { mesh: m, meta: { w, h } };
}

export function dais() {
  const m = mb();
  m.box(0, 0.2, 0, 3.2, 0.4, 3.2, hex(0x8a8478), 0.12);
  m.box(0, 0.45, 0, 1.4, 0.1, 1.4, hex(0x9a9488), 0.05);
  return { mesh: m, colliders: [{ min: [-1.6, 0, -1.6], max: [1.6, 0.45, 1.6] }] };
}

// ---------------------------------------------------------------- soldiers
// Origin conventions: legs/torso pivot at the hip (0.92 m above the feet),
// arms pivot at the shoulder line (0.5 m above the hip). Forward is -Z.
// Tinted vertices take the per-soldier uniform colour.

export function soldierTorso() {
  const m = mb();
  const UNIFORM = [0.9, 0.9, 0.9];
  m.tinted(() => {
    m.box(0, 0.06, 0, 0.4, 0.2, 0.24, UNIFORM);
    m.box(0, 0.34, 0, 0.44, 0.44, 0.26, UNIFORM);
    // Helmet in uniform colour (darker).
    m.sphere(0, 0.79, 0.01, 0.15, 8, 4, [0.6, 0.6, 0.6], 0.85);
    m.box(0, 0.72, 0.01, 0.31, 0.03, 0.31, [0.55, 0.55, 0.55]);
  });
  m.box(0, 0.33, 0, 0.47, 0.34, 0.3, hex(0x3b3e34), 0.05); // vest
  m.box(0.12, 0.26, -0.16, 0.12, 0.14, 0.04, hex(0x2f3229)); // pouches
  m.box(-0.12, 0.26, -0.16, 0.12, 0.14, 0.04, hex(0x2f3229));
  m.box(0, 0.0, 0, 0.42, 0.06, 0.26, BLACK); // belt
  m.box(0, 0.33, 0.2, 0.34, 0.4, 0.14, hex(0x4a4a3a)); // backpack
  m.box(0, 0.6, 0, 0.12, 0.1, 0.12, SKIN); // neck
  m.box(0, 0.73, 0, 0.21, 0.23, 0.23, SKIN); // head
  m.box(0, 0.75, -0.115, 0.17, 0.05, 0.02, hex(0x101418)); // goggles
  return { mesh: m };
}

export function soldierLeg() {
  const m = mb();
  m.tinted(() => {
    m.box(0, -0.23, 0, 0.18, 0.46, 0.2, [0.85, 0.85, 0.85]);
    m.box(0, -0.63, 0.01, 0.16, 0.4, 0.18, [0.8, 0.8, 0.8]);
  });
  m.box(0, -0.4, -0.1, 0.17, 0.1, 0.03, hex(0x2b2b2b)); // knee pad
  m.box(0, -0.87, -0.04, 0.18, 0.11, 0.3, BLACK); // boot
  return { mesh: m };
}

export const GUN_ATTACH = [0.04, -0.1, -0.42];

export function soldierArms() {
  const m = mb();
  m.tinted(() => {
    m.rod([0.25, 0, 0], [0.22, -0.26, -0.12], 0.065, 5, [0.85, 0.85, 0.85]);
    m.rod([0.22, -0.26, -0.12], [0.07, -0.12, -0.38], 0.055, 5, [0.85, 0.85, 0.85]);
    m.rod([-0.25, 0, 0], [-0.2, -0.2, -0.28], 0.065, 5, [0.85, 0.85, 0.85]);
    m.rod([-0.2, -0.2, -0.28], [-0.02, -0.08, -0.6], 0.055, 5, [0.85, 0.85, 0.85]);
  });
  m.sphere(0.07, -0.12, -0.4, 0.055, 6, 4, BLACK);
  m.sphere(-0.02, -0.08, -0.62, 0.055, 6, 4, BLACK);
  m.sphere(0.25, 0, 0, 0.09, 6, 4, hex(0x3b3e34));
  m.sphere(-0.25, 0, 0, 0.09, 6, 4, hex(0x3b3e34));
  return { mesh: m, meta: { gunAttach: GUN_ATTACH } };
}

// Guns: origin at the grip, barrel along -Z.
export function gunShotgun() {
  const m = mb();
  m.box(0, 0.05, -0.15, 0.07, 0.1, 0.34, METAL);
  m.rod([0, 0.08, -0.3], [0, 0.08, -0.86], 0.024, 6, METAL);
  m.rod([0, 0.03, -0.38], [0, 0.03, -0.78], 0.034, 6, WOOD_LIGHT); // pump
  m.box(0, -0.02, 0.17, 0.06, 0.13, 0.32, WOOD);
  m.box(0, -0.05, 0.0, 0.05, 0.12, 0.06, WOOD); // grip
  return { mesh: m, meta: { muzzle: [0, 0.08, -0.88] } };
}

export function gunBullpup() {
  const m = mb();
  const TAN = hex(0x9b8a66);
  m.box(0, 0.04, -0.06, 0.075, 0.15, 0.64, TAN);
  m.box(0, -0.06, 0.12, 0.05, 0.16, 0.08, METAL); // mag behind grip
  m.box(0, -0.06, -0.06, 0.05, 0.1, 0.05, TAN); // grip
  m.box(0, 0.15, -0.12, 0.03, 0.06, 0.32, METAL); // carry handle optic
  m.rod([0, 0.18, -0.3], [0, 0.18, -0.06], 0.025, 6, BLACK);
  m.rod([0, 0.06, -0.38], [0, 0.06, -0.64], 0.018, 6, METAL);
  return { mesh: m, meta: { muzzle: [0, 0.06, -0.66] } };
}

export function gunCarbine() {
  const m = mb();
  m.box(0, 0.05, -0.12, 0.06, 0.1, 0.4, BLACK);
  m.box(0, 0.05, -0.42, 0.07, 0.085, 0.24, hex(0x3a3d33));
  m.rod([0, 0.06, -0.5], [0, 0.06, -0.74], 0.016, 6, METAL);
  m.with(mat4.chain(mat4.translation(0, -0.06, -0.18), mat4.rotationX(0.25)), () => m.box(0, 0, 0, 0.045, 0.2, 0.08, METAL));
  m.box(0, -0.04, -0.01, 0.045, 0.12, 0.05, BLACK);
  m.rod([0, 0.06, 0.06], [0, 0.04, 0.3], 0.012, 4, METAL);
  m.box(0, 0.02, 0.3, 0.04, 0.12, 0.04, BLACK);
  m.box(0, 0.12, -0.12, 0.03, 0.04, 0.1, hex(0x7a1c1c)); // red dot
  return { mesh: m, meta: { muzzle: [0, 0.06, -0.76] } };
}

export function gunDMR() {
  const m = mb();
  m.box(0, 0.04, -0.15, 0.065, 0.11, 0.5, WOOD_DARK);
  m.box(0, 0.0, 0.2, 0.06, 0.15, 0.36, WOOD);
  m.rod([0, 0.06, -0.4], [0, 0.06, -1.06], 0.019, 6, METAL);
  m.rod([0, 0.16, -0.38], [0, 0.16, 0.02], 0.032, 8, BLACK); // scope
  m.cylinder(0, 0.16, -0.4, 0.042, 0.02, 8, BLACK);
  m.box(0, 0.11, -0.18, 0.02, 0.05, 0.04, METAL);
  m.box(0, -0.06, -0.12, 0.04, 0.12, 0.09, METAL); // box mag
  return { mesh: m, meta: { muzzle: [0, 0.06, -1.08] } };
}

// Player weapon held by power-armour gauntlets; camera-space model.
export function playerRifle() {
  const m = mb();
  const GUN = hex(0x66707a), PLATE = hex(0x6f7d68), GLOW = hex(0x5fe8ff);
  m.box(0, 0, -0.12, 0.11, 0.14, 0.6, GUN);
  m.box(0, 0.09, -0.12, 0.05, 0.03, 0.5, hex(0x30353b)); // rail
  m.box(0, 0.13, -0.05, 0.06, 0.06, 0.14, hex(0x23272c)); // sight
  m.box(0, 0.14, -0.12, 0.012, 0.03, 0.01, GLOW);
  m.box(0, -0.01, -0.5, 0.13, 0.12, 0.26, hex(0x4a525b)); // shroud
  for (const z of [-0.42, -0.5, -0.58]) m.box(0, -0.01, z, 0.135, 0.02, 0.02, GLOW);
  m.rod([0, 0.0, -0.62], [0, 0.0, -0.74], 0.03, 8, BLACK);
  m.box(0, -0.13, -0.05, 0.07, 0.16, 0.1, hex(0x2b2f35)); // mag
  m.box(0.057, 0.0, -0.18, 0.005, 0.03, 0.3, GLOW);
  m.box(0, -0.04, 0.2, 0.09, 0.13, 0.12, hex(0x4a525b)); // butt
  // Right gauntlet (power armour forearm) and hand.
  m.rod([0.12, -0.32, 0.5], [0.04, -0.1, 0.1], 0.085, 7, PLATE);
  m.box(0.05, -0.1, 0.08, 0.13, 0.12, 0.15, hex(0x4b5749));
  m.box(0.1, -0.2, 0.32, 0.03, 0.08, 0.25, hex(0xc6a53a));
  // Left gauntlet supporting the shroud.
  m.rod([-0.3, -0.38, 0.2], [-0.04, -0.08, -0.42], 0.085, 7, PLATE);
  m.box(-0.02, -0.08, -0.45, 0.14, 0.11, 0.14, hex(0x4b5749));
  return { mesh: m, meta: { muzzle: [0, 0.0, -0.76] } };
}

// ---------------------------------------------------------------- effects
// Effect meshes are white & tintable; instances draw them emissive.

export function fxBox() {
  const m = mb();
  m.tinted(() => m.box(0, 0, -0.5, 1, 1, 1, WHITE));
  return { mesh: m };
}

export function fxFlash() {
  const m = mb();
  m.tinted(() => {
    for (let i = 0; i < 3; i++) {
      m.with(mat4.rotationZ((i * Math.PI) / 3), () => {
        m.box(0, 0, -0.1, 0.5, 0.06, 0.06, WHITE);
      });
    }
    m.with(mat4.rotationX(-Math.PI / 2), () => m.cylinder(0, 0, 0, 0.12, 0.45, 6, WHITE, { r2: 0.0 }));
  });
  return { mesh: m };
}

export function fxSpark() {
  const m = mb();
  m.tinted(() => m.box(0, 0, 0, 1, 1, 1, WHITE));
  return { mesh: m };
}

export function fxShield() {
  const m = mb();
  m.tinted(() => m.sphere(0, 0, 0, 1, 12, 8, WHITE));
  return { mesh: m };
}

export { WOOD, WOOD_DARK, WOOD_LIGHT };
