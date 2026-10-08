// Reusable model generators shared across levels (soldiers, weapons, props,
// effects). Each returns { mesh, colliders?, meta? } ready for writeModelPack.
// Every surface carries a material id so the shader can add procedural detail.
import { MeshBuilder, hex } from './mesh.mjs';
import { mat4, v3, rng } from '../../src/math.js';
import { MAT } from '../../src/materials.js';

const WOOD = hex(0x8a6a44);
const WOOD_DARK = hex(0x66492c);
const WOOD_LIGHT = hex(0xa98a5e);
const WOOD_GREY = hex(0x8c7d66); // weathered timber
const METAL = hex(0x3a3d42);
const GUNMETAL = hex(0x2a2d31);
const SKIN = hex(0xc9a083);
const BLACK = hex(0x1d1e1f);
const WHITE = [1, 1, 1];

let seedCounter = 100;
const mb = () => new MeshBuilder(seedCounter++);
const v3s = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const HALF_PI = Math.PI / 2;

// Bark-like radial noise for logs: a few lumps plus fine ridges.
const barkBump = (rand, amount = 0.08) => {
  const ph = rand() * 7, ph2 = rand() * 7;
  return (u, end) => 1 + amount * (Math.sin(u * Math.PI * 2 * 3 + ph) * 0.5 + Math.sin(u * Math.PI * 2 * 7 + ph2 + end) * 0.3 + (rand() - 0.5) * 0.4);
};

// ---------------------------------------------------------------- structures

// One 2 m palisade section: upright logs with sharpened tops, bark bumps,
// rope lashings and horizontal braces on the inner (+Z) side.
export function palisade({ height = 4.4, width = 2, logs = 4, seed = 1 } = {}) {
  const m = new MeshBuilder(seed);
  const spacing = width / logs;
  m.material(MAT.LOG, () => {
    for (let i = 0; i < logs; i++) {
      const x = -width / 2 + spacing * (i + 0.5);
      const h = height + (m.rand() - 0.5) * 0.5;
      const r = 0.235 + m.rand() * 0.03;
      const col = m.jitterColor(m.rand() < 0.3 ? WOOD_GREY : WOOD, 0.3);
      const bump = barkBump(m.rand, 0.06);
      m.cylinder(x, -0.3, 0, r, h + 0.3, 9, col, { capTop: false, bump });
      m.cylinder(x, h, 0, r, 0.55, 9, v3s(col, 0.92), { r2: 0.015, bump });
    }
  });
  m.material(MAT.CANVAS, () => {
    for (const y of [1.25, height - 0.85]) {
      for (let i = 0; i < logs; i++) {
        const x = -width / 2 + spacing * (i + 0.5);
        m.cylinder(x, y - 0.1, 0, 0.29, 0.14, 9, hex(0xb9a67c), { capTop: false, capBottom: false });
      }
    }
  });
  m.material(MAT.LOG, () => {
    m.rod([-width / 2, 1.2, 0.33], [width / 2, 1.2, 0.33], 0.085, 6, WOOD_DARK);
    m.rod([-width / 2, height - 0.9, 0.33], [width / 2, height - 0.9, 0.33], 0.085, 6, WOOD_DARK);
  });
  return { mesh: m, colliders: [{ min: [-width / 2, 0, -0.3], max: [width / 2, height + 0.1, 0.3] }] };
}

// A straight log-cabin wall run along X (centred at origin, thickness along
// Z) with rectangular openings. Emits stacked logs + colliders into `out`.
function wallX(m, out, x0, x1, z, height, thick, openings, color, rand) {
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
  const course = 0.3;
  m.material(MAT.LOG, () => {
    for (const [a, b, y0, y1] of pieces) {
      const min = [a, y0, z - thick / 2], max = [b, y1, z + thick / 2];
      out.push({ min, max });
      const rows = Math.max(1, Math.round((y1 - y0) / course));
      const rh = (y1 - y0) / rows;
      for (let i = 0; i < rows; i++) {
        const y = y0 + rh * (i + 0.5);
        const over = (Math.round(y / course) % 2 === 0) ? 0.22 : 0.0;
        const ea = a === x0 ? over : 0, eb = b === x1 ? over : 0;
        const col = m.jitterColor(color, 0.22);
        m.rod([a - ea, y, z], [b + eb, y, z], rh * 0.56, 7, col, { capTop: true, capBottom: true, bump: barkBump(rand, 0.05) });
      }
    }
  });
  // Frames around openings.
  m.material(MAT.PLANK, () => {
    for (const o of sorted) {
      const f = 0.07, t2 = thick / 2 + 0.03;
      const col = v3s(color, 0.8);
      m.boxMinMax([o.a - f, o.y0, z - t2], [o.a, o.y1, z + t2], col);
      m.boxMinMax([o.b, o.y0, z - t2], [o.b + f, o.y1, z + t2], col);
      m.boxMinMax([o.a - f, o.y1, z - t2], [o.b + f, o.y1 + f, z + t2], col);
      if (o.y0 > 0) m.boxMinMax([o.a - f, o.y0 - f, z - t2], [o.b + f, o.y0, z + t2], col);
    }
  });
}

// Same as wallX but running along Z at fixed X.
function wallZ(m, out, z0, z1, x, height, thick, openings, color, rand) {
  const rot = mat4.rotationY(HALF_PI); // local X -> world -Z
  const local = [];
  m.with(rot, () => wallX(m, local, -z1, -z0, x, height, thick, openings.map((o) => ({ ...o, a: -o.b, b: -o.a })), color, rand));
  for (const c of local) {
    out.push({ min: [c.min[2], c.min[1], -c.max[0]], max: [c.max[2], c.max[1], -c.min[0]] });
  }
}

// Rectangular log building with optional partition, openings and shingled roof.
export function building(spec) {
  const m = mb();
  const col = [];
  const { w, d, h } = spec;
  const t = 0.3;
  const wallCol = spec.color || WOOD;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  // Floor boards.
  m.material(MAT.PLANK, () => {
    const n = Math.round(w / 0.3);
    for (let i = 0; i < n; i++) {
      const a = x0 + (w / n) * i;
      m.boxMinMax([a, 0, z0], [a + w / n - 0.01, 0.06, z1], m.jitterColor(WOOD_LIGHT, 0.12));
    }
  });
  wallX(m, col, x0, x1, z0 + t / 2, h, t, spec.walls.n || [], wallCol, m.rand);
  wallX(m, col, x0, x1, z1 - t / 2, h, t, spec.walls.s || [], wallCol, m.rand);
  wallZ(m, col, z0 + t, z1 - t, x0 + t / 2, h, t, spec.walls.w || [], wallCol, m.rand);
  wallZ(m, col, z0 + t, z1 - t, x1 - t / 2, h, t, spec.walls.e || [], wallCol, m.rand);
  for (const p of spec.partitions || []) {
    if (p.axis === 'x') wallX(m, col, p.from, p.to, p.at, h, 0.2, p.openings || [], WOOD_DARK, m.rand);
    else wallZ(m, col, p.from, p.to, p.at, h, 0.2, p.openings || [], WOOD_DARK, m.rand);
  }
  // Gable roof along X axis with overlapping shingle rows.
  const pitch = 0.46;
  const over = 0.55;
  const halfD = d / 2 + over;
  const slopeLen = halfD / Math.cos(pitch);
  const ridge = h + Math.tan(pitch) * halfD;
  m.material(MAT.PLANK, () => {
    for (const side of [-1, 1]) {
      m.with(mat4.chain(mat4.translation(0, (h + ridge) / 2 + 0.1, (side * halfD) / 2), mat4.rotationX(side * pitch)), () => {
        const rows = 9;
        const rl = slopeLen / rows;
        for (let i = 0; i < rows; i++) {
          const z = -slopeLen / 2 + rl * (i + 0.5);
          const cols = Math.round((w + over * 2) / 0.6);
          for (let c = 0; c < cols; c++) {
            const x = -(w + over * 2) / 2 + ((w + over * 2) / cols) * (c + 0.5) + (i % 2) * 0.15;
            m.box(x, 0.02 * (i % 2), z, (w + over * 2) / cols - 0.02, 0.08, rl + 0.12, m.jitterColor(hex(0x6e5238), 0.3));
          }
        }
        // Rafters underneath.
        for (let c = 0; c <= 5; c++) m.box(-w / 2 - 0.3 + ((w + 0.6) / 5) * c, -0.1, 0, 0.12, 0.14, slopeLen, WOOD_DARK);
      });
    }
    // Ridge cap.
    m.rod([-w / 2 - over, ridge + 0.15, 0], [w / 2 + over, ridge + 0.15, 0], 0.12, 6, WOOD_DARK);
  });
  // Gable ends: vertical planks.
  m.material(MAT.PLANK, () => {
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      const n = Math.round(d / 0.28);
      for (let i = 0; i < n; i++) {
        const z = z0 + (d / n) * (i + 0.5);
        const top = h + (ridge - h) * (1 - Math.abs(z) / (d / 2)) - 0.05;
        m.box(x, (h + top) / 2, z, 0.1, top - h, d / n - 0.015, m.jitterColor(WOOD_DARK, 0.2));
      }
    }
  });
  col.push({ min: [x0, h, z0], max: [x1, h + 0.4, z1] });
  return { mesh: m, colliders: col };
}

export function stairs({ steps = 12, rise = 0.4, run = 0.6, width = 2 } = {}) {
  const m = mb();
  const col = [];
  m.material(MAT.PLANK, () => {
    for (let i = 0; i < steps; i++) {
      const min = [-width / 2, 0, -(i + 1) * run], max = [width / 2, (i + 1) * rise, -i * run];
      m.boxMinMax([min[0], max[1] - 0.07, min[2] - 0.03], [max[0], max[1], max[2] + 0.05], m.jitterColor(WOOD_LIGHT, 0.2));
      m.boxMinMax([min[0] + 0.1, max[1] - rise, max[2] - 0.06], [max[0] - 0.1, max[1] - 0.07, max[2] - 0.02], m.jitterColor(WOOD_DARK, 0.1));
      col.push({ min, max });
    }
  });
  m.material(MAT.LOG, () => {
    for (const x of [-width / 2 + 0.06, width / 2 - 0.06]) {
      m.rod([x, 0, 0], [x, steps * rise, -steps * run], 0.08, 6, WOOD_DARK);
      // Handrail.
      m.rod([x, 1.0, -run], [x, steps * rise + 1.0, -steps * run], 0.04, 5, WOOD);
    }
    for (let i = 1; i < steps; i += 3) {
      for (const x of [-width / 2 + 0.06, width / 2 - 0.06]) {
        m.cylinder(x, 0, -(i + 0.5) * run, 0.07, (i + 1) * rise, 5, WOOD_DARK);
        m.cylinder(x, (i + 1) * rise, -(i + 0.5) * run, 0.035, 1.0, 5, WOOD);
      }
    }
  });
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
  m.material(MAT.LOG, () => {
    for (const [x, z] of [[-legIn, -legIn], [legIn, -legIn], [-legIn, legIn], [legIn, legIn]]) {
      m.cylinder(x, -0.3, z, 0.26, roofY + 0.3, 9, m.jitterColor(WOOD, 0.2), { bump: barkBump(m.rand, 0.05) });
      col.push({ min: [x - 0.25, 0, z - 0.25], max: [x + 0.25, roofY, z + 0.25] });
    }
    for (const [a, b] of [
      [[-legIn, 0.5, -legIn], [legIn, deck - 0.5, -legIn]],
      [[legIn, 0.5, legIn], [-legIn, deck - 0.5, legIn]],
      [[-legIn, 0.5, legIn], [-legIn, deck - 0.5, -legIn]],
      [[legIn, 0.5, -legIn], [legIn, deck - 0.5, legIn]],
    ]) m.rod(a, b, 0.09, 6, WOOD_DARK);
    // Deck joists.
    for (let i = 0; i <= 4; i++) m.rod([-hs, deck - 0.4, -legIn + (legIn * 2 * i) / 4], [hs, deck - 0.4, -legIn + (legIn * 2 * i) / 4], 0.1, 6, WOOD_DARK);
  });
  const deckMin = [-hs, deck - 0.3, -hs], deckMax = [hs, deck, hs];
  m.material(MAT.PLANK, () => {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const z0 = -hs + (size / n) * i;
      m.boxMinMax([-hs, deck - 0.3, z0], [hs, deck, z0 + size / n - 0.02], m.jitterColor(WOOD_LIGHT, 0.25));
    }
  });
  col.push({ min: deckMin, max: deckMax });
  // Parapets as planks with posts (1.1 m); +X side has a gap for the stairs.
  const ph = 1.1;
  const para = (min, max) => {
    m.material(MAT.PLANK, () => {
      const along = max[0] - min[0] > max[2] - min[2] ? 0 : 2;
      const len = max[along] - min[along];
      const n = Math.max(1, Math.round(len / 0.3));
      for (let i = 0; i < n; i++) {
        const a = min[along] + (len / n) * i, b = a + len / n - 0.02;
        const pmin = [...min], pmax = [...max];
        pmin[along] = a; pmax[along] = b;
        pmax[1] = max[1] - (i % 2) * 0.08;
        m.boxMinMax(pmin, pmax, m.jitterColor(WOOD, 0.2));
      }
      // Top rail.
      m.boxMinMax([min[0] - 0.03, max[1], min[2] - 0.03], [max[0] + 0.03, max[1] + 0.06, max[2] + 0.03], WOOD_DARK);
    });
    col.push({ min, max });
  };
  para([-hs, deck, -hs], [hs, deck + ph, -hs + 0.15]);
  para([-hs, deck, hs - 0.15], [hs, deck + ph, hs]);
  para([-hs, deck, -hs], [-hs + 0.15, deck + ph, hs]);
  if (openA > -hs) para([hs - 0.15, deck, -hs], [hs, deck + ph, openA]);
  if (openB < hs) para([hs - 0.15, deck, openB], [hs, deck + ph, hs]);
  // Pyramid roof with shingle rings.
  m.material(MAT.PLANK, () => {
    m.with(mat4.translation(0, roofY, 0), () => {
      m.boxMinMax([-hs - 0.4, 0, -hs - 0.4], [hs + 0.4, 0.15, hs + 0.4], hex(0x6e5238), 0.1);
      m.with(mat4.rotationY(Math.PI / 4), () => {
        const tiers = 5;
        for (let i = 0; i < tiers; i++) {
          const r0 = (hs + 0.5) * 1.42 * (1 - i / tiers), r1 = (hs + 0.5) * 1.42 * (1 - (i + 1) / tiers);
          m.cylinder(0, 0.15 + (1.6 / tiers) * i, 0, r0, 1.6 / tiers + 0.08, 4, m.jitterColor(hex(0x65492f), 0.15), { r2: r1, capTop: false });
        }
      });
    });
  });
  col.push({ min: [-hs - 0.4, roofY, -hs - 0.4], max: [hs + 0.4, roofY + 1.2, hs + 0.4] });
  return { mesh: m, colliders: col, meta: { deck } };
}

// Gate house: two posts either side of the opening and a fighting platform
// above it. Local +Z is outside the fort.
export function gatehouse({ deck = 4.6, halfW = 4.6, zIn = -2.6, zOut = 1.2, stairZ = [-2.6, -0.6] } = {}) {
  const m = mb();
  const col = [];
  const roofY = deck + 2.8;
  m.material(MAT.LOG, () => {
    for (const x of [-2.3, 2.3]) {
      m.cylinder(x, -0.3, 0, 0.4, roofY + 0.3, 10, m.jitterColor(WOOD_DARK, 0.1), { bump: barkBump(m.rand, 0.05) });
      col.push({ min: [x - 0.38, 0, -0.38], max: [x + 0.38, roofY, 0.38] });
    }
    for (const [x, z] of [[-halfW + 0.2, zIn + 0.2], [halfW - 0.2, zIn + 0.2]]) {
      m.cylinder(x, -0.3, z, 0.21, roofY + 0.3, 8, m.jitterColor(WOOD, 0.2), { bump: barkBump(m.rand, 0.05) });
      col.push({ min: [x - 0.2, 0, z - 0.2], max: [x + 0.2, roofY, z + 0.2] });
    }
    for (const [x, z] of [[-halfW + 0.2, zOut - 0.2], [halfW - 0.2, zOut - 0.2], [0, zOut - 0.2]]) {
      m.cylinder(x, deck, z, 0.16, roofY - deck, 7, m.jitterColor(WOOD, 0.2));
    }
    // Lintel beam over the gate + joists.
    m.rod([-3.2, deck - 0.5, 0], [3.2, deck - 0.5, 0], 0.24, 8, WOOD_DARK, { bump: barkBump(m.rand, 0.04) });
    for (let i = 0; i <= 5; i++) m.rod([-halfW + ((halfW * 2) / 5) * i, deck - 0.4, zIn], [-halfW + ((halfW * 2) / 5) * i, deck - 0.4, zOut], 0.09, 6, WOOD_DARK);
  });
  m.material(MAT.PLANK, () => {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const x0 = -halfW + ((halfW * 2) / n) * i;
      m.boxMinMax([x0, deck - 0.3, zIn], [x0 + (halfW * 2) / n - 0.02, deck, zOut], m.jitterColor(WOOD_LIGHT, 0.25));
    }
  });
  col.push({ min: [-halfW, deck - 0.3, zIn], max: [halfW, deck, zOut] });
  // Parapets: planks + crenellation.
  const solid = (min, max) => {
    m.material(MAT.PLANK, () => {
      const along = max[0] - min[0] > max[2] - min[2] ? 0 : 2;
      const len = max[along] - min[along];
      const n = Math.max(1, Math.round(len / 0.3));
      for (let i = 0; i < n; i++) {
        const pmin = [...min], pmax = [...max];
        pmin[along] = min[along] + (len / n) * i;
        pmax[along] = pmin[along] + len / n - 0.02;
        pmax[1] = max[1] - (Math.floor(i / 3) % 2) * 0.25;
        m.boxMinMax(pmin, pmax, m.jitterColor(WOOD, 0.2));
      }
    });
    col.push({ min, max });
  };
  solid([-halfW, deck, zOut - 0.18], [halfW, deck + 1.15, zOut]);
  solid([-halfW, deck, zIn], [-halfW + 0.15, deck + 1.15, zOut]);
  solid([halfW - 0.15, deck, stairZ[1]], [halfW, deck + 1.15, zOut]);
  m.material(MAT.LOG, () => {
    m.rod([-halfW, deck + 0.95, zIn + 0.05], [halfW - 2.4, deck + 0.95, zIn + 0.05], 0.06, 5, WOOD_DARK);
    for (let x = -halfW + 0.6; x < halfW - 2.4; x += 1.2) m.cylinder(x, deck, zIn + 0.05, 0.05, 0.95, 5, WOOD_DARK);
  });
  // Roof: shingle rows sloping to the outside.
  m.material(MAT.PLANK, () => {
    m.with(mat4.chain(mat4.translation(0, roofY, (zIn + zOut) / 2), mat4.rotationX(-0.14)), () => {
      const depth = zOut - zIn + 1.0;
      const rows = 6, rl = depth / rows;
      for (let i = 0; i < rows; i++) {
        const z = -depth / 2 + rl * (i + 0.5);
        const cols = 18;
        for (let c = 0; c < cols; c++) {
          const x = -halfW - 0.4 + ((halfW * 2 + 0.8) / cols) * (c + 0.5) + (i % 2) * 0.12;
          m.box(x, 0.02 * (i % 2), z, (halfW * 2 + 0.8) / cols - 0.02, 0.08, rl + 0.12, m.jitterColor(hex(0x6e5238), 0.3));
        }
      }
    });
  });
  col.push({ min: [-halfW - 0.4, roofY - 0.3, zIn - 0.5], max: [halfW + 0.4, roofY + 0.4, zOut + 0.5] });
  return { mesh: m, colliders: col };
}

export function gateDoor() {
  const m = mb();
  m.material(MAT.PLANK, () => {
    for (let i = 0; i < 5; i++) {
      m.boxMinMax([i * 0.4, 0, -0.06], [i * 0.4 + 0.38, 3.6 + (i % 2) * 0.1, 0.06], m.jitterColor(WOOD, 0.25));
    }
    m.boxMinMax([0, 0.6, 0.06], [2, 0.8, 0.12], WOOD_DARK);
    m.boxMinMax([0, 2.8, 0.06], [2, 3.0, 0.12], WOOD_DARK);
    m.rod([0.1, 0.8, 0.09], [1.9, 2.8, 0.09], 0.06, 5, WOOD_DARK);
  });
  m.material(MAT.METAL, () => {
    for (const y of [0.7, 2.9]) {
      m.box(0.5, y, 0.13, 0.9, 0.08, 0.02, METAL);
      for (let x = 0.2; x < 2; x += 0.4) m.cylinder(x, y - 0.03, 0.13, 0.025, 0.02, 5, GUNMETAL);
    }
  });
  return { mesh: m, colliders: [{ min: [0, 0, -0.08], max: [2, 3.7, 0.12] }] };
}

// Lean-to shelter: posts + sloped shingle roof, open sides.
export function shed({ w = 7, d = 4, h = 3 } = {}) {
  const m = mb();
  const col = [];
  m.material(MAT.LOG, () => {
    for (const [x, z, hh] of [[-w / 2, -d / 2, h + 0.6], [w / 2, -d / 2, h + 0.6], [-w / 2, d / 2, h], [w / 2, d / 2, h], [0, d / 2, h], [0, -d / 2, h + 0.6]]) {
      m.cylinder(x, 0, z, 0.15, hh, 7, m.jitterColor(WOOD_DARK, 0.2), { bump: barkBump(m.rand, 0.05) });
      col.push({ min: [x - 0.15, 0, z - 0.15], max: [x + 0.15, hh, z + 0.15] });
    }
    m.rod([-w / 2, h + 0.55, -d / 2], [w / 2, h + 0.55, -d / 2], 0.1, 6, WOOD_DARK);
    m.rod([-w / 2, h - 0.05, d / 2], [w / 2, h - 0.05, d / 2], 0.1, 6, WOOD_DARK);
  });
  const a = Math.atan2(0.6, d);
  m.material(MAT.PLANK, () => {
    m.with(mat4.chain(mat4.translation(0, h + 0.38, 0), mat4.rotationX(a)), () => {
      const rows = 5, depth = d + 0.8, rl = depth / rows;
      for (let i = 0; i < rows; i++) {
        const z = -depth / 2 + rl * (i + 0.5);
        for (let c = 0; c < 12; c++) {
          const x = -w / 2 - 0.4 + ((w + 0.8) / 12) * (c + 0.5) + (i % 2) * 0.15;
          m.box(x, 0.02 * (i % 2), z, (w + 0.8) / 12 - 0.03, 0.08, rl + 0.12, m.jitterColor(hex(0x6e5238), 0.3));
        }
      }
      for (let c = 0; c <= 4; c++) m.box(-w / 2 + ((w) / 4) * c, -0.1, 0, 0.12, 0.14, depth, WOOD_DARK);
    });
  });
  col.push({ min: [-w / 2 - 0.4, h, -d / 2 - 0.4], max: [w / 2 + 0.4, h + 0.75, d / 2 + 0.4] });
  return { mesh: m, colliders: col };
}

// ---------------------------------------------------------------- props

// Slatted wooden crate with corner frame, diagonal braces and a stencil.
export function crate(size = 1.2, color = WOOD_LIGHT) {
  const m = mb();
  const s = size;
  const e = 0.09;
  const dark = v3s(color, 0.6);
  m.material(MAT.PLANK, () => {
    // Slats on each face with small gaps, then a solid inner box so gaps aren't see-through.
    m.box(0, s / 2, 0, s - 0.06, s - 0.06, s - 0.06, v3s(color, 0.45));
    const slats = 4;
    for (let i = 0; i < slats; i++) {
      const y = e + ((s - 2 * e) / slats) * (i + 0.5);
      const w = (s - 2 * e) / slats - 0.025;
      const c = m.jitterColor(color, 0.18);
      m.box(0, y, s / 2 - 0.02, s - 0.04, w, 0.04, c);
      m.box(0, y, -s / 2 + 0.02, s - 0.04, w, 0.04, c);
      m.box(s / 2 - 0.02, y, 0, 0.04, w, s - 0.04, c);
      m.box(-s / 2 + 0.02, y, 0, 0.04, w, s - 0.04, c);
    }
    for (let i = 0; i < slats; i++) {
      const z = -s / 2 + e + ((s - 2 * e) / slats) * (i + 0.5);
      m.box(0, s - 0.02, z, s - 0.04, 0.04, (s - 2 * e) / slats - 0.025, m.jitterColor(color, 0.18));
    }
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      m.box((x * (s - e)) / 2, s / 2, (z * (s - e)) / 2, e + 0.02, s + 0.02, e + 0.02, dark);
    }
    for (const y of [e / 2, s - e / 2]) {
      m.box(0, y, (s - e) / 2, s + 0.02, e + 0.02, e + 0.02, dark);
      m.box(0, y, -(s - e) / 2, s + 0.02, e + 0.02, e + 0.02, dark);
      m.box((s - e) / 2, y, 0, e + 0.02, e + 0.02, s + 0.02, dark);
      m.box(-(s - e) / 2, y, 0, e + 0.02, e + 0.02, s + 0.02, dark);
    }
    m.with(mat4.chain(mat4.translation(0, s / 2, s / 2 + 0.03), mat4.rotationZ(Math.PI / 4)), () => m.box(0, 0, 0, s * 1.2, e, 0.03, dark));
    m.with(mat4.chain(mat4.translation(0, s / 2, -s / 2 - 0.03), mat4.rotationZ(-Math.PI / 4)), () => m.box(0, 0, 0, s * 1.2, e, 0.03, dark));
  });
  m.material(MAT.PAINT, () => {
    m.box(s * 0.22, s * 0.62, s / 2 + 0.045, s * 0.28, s * 0.05, 0.004, hex(0x2d2a26));
    m.box(s * 0.22, s * 0.5, s / 2 + 0.045, s * 0.18, s * 0.05, 0.004, hex(0x2d2a26));
  });
  return { mesh: m, colliders: [{ min: [-s / 2, 0, -s / 2], max: [s / 2, s, s / 2] }] };
}

export function longCrate() {
  const m = mb();
  m.material(MAT.PAINT, () => {
    m.box(0, 0.45, 0, 2.2, 0.9, 0.9, hex(0x5a6a44), 0.1);
    for (const x of [-0.9, 0, 0.9]) m.box(x, 0.45, 0, 0.12, 0.94, 0.94, hex(0x3b472c));
    for (const x of [-0.45, 0.45]) m.box(x, 0.92, 0, 0.3, 0.05, 0.12, hex(0x2f3a24)); // handles
    m.box(0, 0.6, 0.46, 0.9, 0.2, 0.01, hex(0xd8c87a));
    m.box(0, 0.58, 0.467, 0.7, 0.04, 0.005, hex(0x2d2a26));
  });
  m.material(MAT.METAL, () => {
    for (const x of [-1.05, 1.05]) for (const y of [0.15, 0.75]) m.box(x, y, 0.42, 0.12, 0.12, 0.06, METAL);
  });
  return { mesh: m, colliders: [{ min: [-1.1, 0, -0.45], max: [1.1, 0.9, 0.45] }] };
}

// Bulging stave barrel with iron hoops.
export function barrel() {
  const m = mb();
  m.material(MAT.PLANK, () => {
    const staves = 14;
    const bump = (u) => 1 + 0.02 * Math.cos(u * Math.PI * 2 * staves);
    m.cylinder(0, 0, 0, 0.33, 0.55, staves * 2, hex(0x7a5634), { r2: 0.37, bump, capTop: false, capBottom: true, jitter: 0.1 });
    m.cylinder(0, 0.55, 0, 0.37, 0.55, staves * 2, hex(0x7a5634), { r2: 0.33, bump, jitter: 0.1 });
  });
  m.material(MAT.METAL, () => {
    for (const [y, r] of [[0.12, 0.345], [0.5, 0.385], [0.95, 0.345]]) m.cylinder(0, y, 0, r, 0.07, 16, METAL, { capTop: false, capBottom: false });
  });
  return { mesh: m, colliders: [{ min: [-0.36, 0, -0.36], max: [0.36, 1.1, 0.36] }] };
}

export function sandbags(len = 3) {
  const m = mb();
  const n = Math.round(len / 0.6);
  m.material(MAT.CANVAS, () => {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < n - (row % 2); i++) {
        const x = -len / 2 + 0.3 + i * 0.6 + (row % 2) * 0.3;
        const squash = 0.5 - row * 0.03;
        m.with(mat4.chain(mat4.translation(x, 0.17 + row * 0.29, (m.rand() - 0.5) * 0.08), mat4.rotationY((m.rand() - 0.5) * 0.3)), () =>
          m.sphere(0, 0, 0, 0.33, 9, 5, m.jitterColor(hex(0xa89c74), 0.18), squash, { bump: (u, v) => 1 + 0.04 * Math.sin(u * 12) }),
        );
      }
    }
  });
  return { mesh: m, colliders: [{ min: [-len / 2, 0, -0.35], max: [len / 2, 0.95, 0.35] }] };
}

export function bunk() {
  const m = mb();
  m.material(MAT.PLANK, () => {
    for (const [x, z] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) m.box(x, 0.9, z, 0.08, 1.8, 0.08, WOOD_DARK);
    for (const y of [0.35, 1.35]) {
      m.box(0, y, 0, 2.0, 0.08, 0.9, WOOD);
      for (let i = 0; i < 6; i++) m.box(-0.8 + i * 0.32, y - 0.06, 0, 0.1, 0.04, 0.9, WOOD_DARK);
    }
  });
  m.material(MAT.CLOTH, () => {
    for (const y of [0.35, 1.35]) {
      m.box(0, y + 0.1, 0, 1.85, 0.12, 0.8, hex(0x6a6e5a), 0.1);
      m.box(0.1, y + 0.2, 0, 1.4, 0.06, 0.75, hex(0x4f5a47)); // folded blanket
      m.box(-0.72, y + 0.2, 0, 0.32, 0.1, 0.58, hex(0xd8d4c4)); // pillow
    }
  });
  return { mesh: m, colliders: [{ min: [-1, 0, -0.45], max: [1, 1.8, 0.45] }] };
}

export function table() {
  const m = mb();
  m.material(MAT.PLANK, () => {
    for (let i = 0; i < 4; i++) m.box(0, 0.78, -0.34 + i * 0.225, 1.8, 0.07, 0.21, m.jitterColor(WOOD_LIGHT, 0.12));
    for (const [x, z] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]]) m.box(x, 0.39, z, 0.08, 0.78, 0.08, WOOD_DARK);
    m.box(0, 0.7, 0, 1.7, 0.05, 0.05, WOOD_DARK);
  });
  m.material(MAT.PAINT, () => {
    m.box(-0.2, 0.82, 0, 0.8, 0.012, 0.55, hex(0xd9cfa8)); // map
    m.box(-0.35, 0.83, -0.05, 0.25, 0.01, 0.18, hex(0x6f8f5a));
    m.box(-0.05, 0.83, 0.12, 0.3, 0.01, 0.02, hex(0x8a3a2a));
    m.box(0.55, 0.9, 0.1, 0.35, 0.2, 0.25, hex(0x46503d)); // radio
    m.box(0.55, 0.9, 0.23, 0.2, 0.08, 0.01, hex(0x1d1e1f));
  });
  m.material(MAT.METAL, () => {
    m.rod([0.65, 1.0, 0.15], [0.7, 1.5, 0.18], 0.01, 4, BLACK);
    m.cylinder(0.45, 1.0, 0.0, 0.025, 0.03, 6, hex(0x9a9a9a));
    m.cylinder(0.6, 0.82, -0.3, 0.05, 0.1, 8, hex(0x8a8a86)); // tin mug
  });
  return { mesh: m, colliders: [{ min: [-0.9, 0, -0.45], max: [0.9, 0.85, 0.45] }] };
}

export function ammoBox() {
  const m = mb();
  m.material(MAT.PAINT, () => {
    m.box(0, 0.2, 0, 0.7, 0.4, 0.4, hex(0x4f5d3a), 0.05);
    m.box(0, 0.25, 0.205, 0.6, 0.08, 0.01, hex(0xffd23a));
    m.box(0, 0.25, -0.205, 0.6, 0.08, 0.01, hex(0xffd23a));
    m.box(0, 0.25, 0.212, 0.4, 0.03, 0.004, hex(0x2d2a26));
  });
  m.material(MAT.METAL, () => {
    m.box(0, 0.42, 0, 0.5, 0.05, 0.1, hex(0x2a2a2a));
    for (const x of [-0.3, 0.3]) m.box(x, 0.2, 0, 0.03, 0.42, 0.42, hex(0x3b3f35));
  });
  return { mesh: m };
}

// Conifer: bark trunk with knots, five jagged foliage tiers, bare lower branches.
export function pine(seed, h = 9) {
  const m = new MeshBuilder(seed);
  const rand = rng(seed * 7 + 1);
  m.material(MAT.BARK, () => {
    m.cylinder(0, -0.3, 0, 0.3, h * 0.5, 8, hex(0x4e3a2a), { r2: 0.12, bump: barkBump(rand, 0.1), jitter: 0.15 });
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, y = h * (0.12 + i * 0.05);
      m.rod([0, y, 0], [Math.cos(a) * 1.2, y + 0.3, Math.sin(a) * 1.2], 0.05, 4, hex(0x4e3a2a));
    }
  });
  const tiers = 5;
  const green = hex(0x2f5a30), greenLight = hex(0x4f7b3a);
  m.material(MAT.FOLIAGE, () => {
    for (let i = 0; i < tiers; i++) {
      const y = h * 0.16 + i * h * 0.17;
      const r = (1 - i / tiers) * h * 0.26 + 0.5;
      const seg = 12;
      const jag = Array.from({ length: seg }, () => 0.75 + rand() * 0.45);
      const bump = (u) => jag[Math.floor(u * seg) % seg];
      const base = m.jitterColor(i % 2 ? green : greenLight, 0.2);
      m.cylinder(0, y, 0, r, h * 0.3, seg, base, { r2: 0.03, bump, capBottom: true, capTop: false, colorFn: (u) => v3s(base, 0.85 + 0.3 * bump(u)) });
      // Drooping underside skirt.
      m.cylinder(0, y - h * 0.03, 0, r * 0.85, h * 0.04, seg, v3s(base, 0.7), { r2: r, bump, capBottom: true, capTop: false });
    }
  });
  return { mesh: m, colliders: [{ min: [-0.3, 0, -0.3], max: [0.3, h * 0.6, 0.3] }] };
}

// Boulder with noisy displacement and mossy top.
export function rock(seed) {
  const m = new MeshBuilder(seed);
  const rand = rng(seed * 3 + 5);
  const lumps = Array.from({ length: 6 }, () => [rand() * Math.PI * 2, rand() * Math.PI, 0.1 + rand() * 0.2]);
  const bump = (u, v) => {
    const th = u * Math.PI * 2, phi = v * Math.PI;
    let k = 1;
    for (const [a, b, s] of lumps) {
      const d = Math.hypot(Math.cos(th) * Math.sin(phi) - Math.cos(a) * Math.sin(b), Math.cos(phi) - Math.cos(b), Math.sin(th) * Math.sin(phi) - Math.sin(a) * Math.sin(b));
      k += s * Math.max(0, 1 - d / 0.8);
    }
    return k;
  };
  const grey = hex(0x7a766d), moss = hex(0x5a6b3a);
  m.material(MAT.STONE, () => {
    m.sphere(0, 0.25, 0, 1, 12, 7, grey, 0.65, { bump, colorFn: (u, v) => (v < 0.3 ? v3s(moss, 0.9 + rand() * 0.2) : v3s(grey, 0.85 + rand() * 0.3)) });
  });
  return { mesh: m, colliders: [{ min: [-0.8, 0, -0.8], max: [0.8, 0.85, 0.8] }] };
}

// Leafy bush: a few overlapping lumpy spheres.
export function bush(seed) {
  const m = new MeshBuilder(seed);
  const rand = rng(seed * 11 + 3);
  const base = hex(0x3f6a2e);
  m.material(MAT.FOLIAGE, () => {
    for (let i = 0; i < 4; i++) {
      const x = (rand() - 0.5) * 0.8, z = (rand() - 0.5) * 0.8, r = 0.5 + rand() * 0.35;
      const c = m.jitterColor(base, 0.3);
      m.sphere(x, r * 0.75, z, r, 9, 6, c, 0.85, { bump: (u, v) => 1 + 0.12 * Math.sin(u * 19 + v * 7) * Math.sin(v * 11), colorFn: (u, v) => v3s(c, 0.75 + 0.5 * (1 - v)) });
    }
  });
  return { mesh: m };
}

// Grass tuft: several bent blades, dark at the root and lighter at the tip.
export function grassTuft(seed) {
  const m = new MeshBuilder(seed);
  const rand = rng(seed * 5 + 9);
  const root = hex(0x3d6b22), tip = hex(0xa8c45a);
  m.material(MAT.GRASS, () => {
    const blades = 7;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + rand() * 0.8;
      const lean = 0.25 + rand() * 0.45;
      const h = 0.35 + rand() * 0.35;
      const w = 0.035 + rand() * 0.02;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const side = [-dir[2] * w, 0, dir[0] * w];
      const bx = dir[0] * 0.08, bz = dir[2] * 0.08;
      const p0 = [bx - side[0], 0, bz - side[2]], p1 = [bx + side[0], 0, bz + side[2]];
      const mid = [bx + dir[0] * lean * h * 0.35, h * 0.55, bz + dir[2] * lean * h * 0.35];
      const m0 = [mid[0] - side[0] * 0.7, mid[1], mid[2] - side[2] * 0.7], m1 = [mid[0] + side[0] * 0.7, mid[1], mid[2] + side[2] * 0.7];
      const tp = [bx + dir[0] * lean * h, h, bz + dir[2] * lean * h];
      const n = [-dir[2], 0.3, dir[0]];
      const c0 = m.jitterColor(root, 0.2), c1 = m.jitterColor(tip, 0.2);
      const cm = v3.lerp(c0, c1, 0.5);
      for (const flip of [1, -1]) {
        const nn = v3s(n, flip);
        const a0 = m.vert(p0, nn, c0), a1 = m.vert(p1, nn, c0);
        const b0 = m.vert(m0, nn, cm), b1 = m.vert(m1, nn, cm);
        const t = m.vert(tp, nn, c1);
        m.tri(a0, a1, b1, nn); m.tri(a0, b1, b0, nn); m.tri(b0, b1, t, nn);
      }
    }
  });
  return { mesh: m };
}

// ---------------------------------------------------------------- flag

export function flagpole(height = 9.5) {
  const m = mb();
  m.material(MAT.METAL, () => {
    m.cylinder(0, 0, 0, 0.09, height, 10, hex(0xc4c4bc), { r2: 0.055 });
    m.cylinder(0, 0, 0, 0.14, 0.5, 10, hex(0x8a8a86), { r2: 0.1 });
    m.sphere(0, height + 0.1, 0, 0.14, 10, 6, hex(0xd8b04a));
    m.box(0.13, 1.2, 0, 0.05, 0.2, 0.05, METAL);
  });
  m.material(MAT.CANVAS, () => m.rod([0.11, 1.2, 0], [0.11, height - 0.1, 0], 0.012, 4, hex(0xe0dcc8)));
  return { mesh: m, colliders: [{ min: [-0.12, 0, -0.12], max: [0.12, height, 0.12] }], meta: { height } };
}

// Flag cloth: hoist edge at x=0, extends +X. Waves in the vertex shader.
export function flagCloth(w = 2.4, h = 1.5) {
  const m = mb();
  const red = hex(0x9a2222), black = hex(0x1c1c1c), bone = hex(0xe6dcc0);
  m.material(MAT.CLOTH, () => {
    m.cloth(w, h, 24, 10, (u, v) => {
      const x = u * w, y = v * h;
      const dx = x - w * 0.36, dy = y - h * 0.5;
      if (Math.hypot(dx, dy) < h * 0.26 && Math.hypot(dx, dy) > h * 0.17) return bone;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < h * 0.26) return bone;
      if (Math.abs(y - h * 0.12) < 0.07 || Math.abs(y - h * 0.88) < 0.07) return black;
      return red;
    });
  });
  return { mesh: m, meta: { w, h } };
}

export function dais() {
  const m = mb();
  m.material(MAT.STONE, () => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m.box(-1.05 + i * 1.05, 0.2, -1.05 + j * 1.05, 1.02, 0.4, 1.02, m.jitterColor(hex(0x8a8478), 0.15));
      }
    }
    m.box(0, 0.45, 0, 1.4, 0.1, 1.4, hex(0x9a9488), 0.05);
  });
  return { mesh: m, colliders: [{ min: [-1.6, 0, -1.6], max: [1.6, 0.45, 1.6] }] };
}

// ---------------------------------------------------------------- soldiers
// Origin conventions: legs/torso pivot at the hip (0.92 m above the feet),
// arms pivot at the shoulder line (0.5 m above the hip). Forward is -Z.
// Tinted vertices take the per-soldier uniform colour.

export function soldierTorso() {
  const m = mb();
  const UNIFORM = [0.9, 0.9, 0.9];
  m.material(MAT.CLOTH, () => {
    m.tinted(() => {
      m.box(0, 0.06, 0, 0.4, 0.2, 0.24, UNIFORM);
      m.box(0, 0.34, 0, 0.44, 0.44, 0.26, UNIFORM);
      m.sphere(0.24, 0.5, 0, 0.1, 7, 4, [0.85, 0.85, 0.85]); // shoulders
      m.sphere(-0.24, 0.5, 0, 0.1, 7, 4, [0.85, 0.85, 0.85]);
      // Helmet: dome + brim + cover texture.
      m.sphere(0, 0.79, 0.01, 0.16, 10, 5, [0.62, 0.62, 0.62], 0.85);
      m.cylinder(0, 0.715, 0.01, 0.17, 0.03, 10, [0.55, 0.55, 0.55]);
    });
    // Sleeves / collar.
    m.box(0, 0.56, 0, 0.2, 0.06, 0.2, hex(0x3b3e34));
  });
  m.material(MAT.CANVAS, () => {
    m.box(0, 0.33, 0, 0.47, 0.34, 0.3, hex(0x3b3e34), 0.05); // plate carrier
    for (const x of [-0.13, 0, 0.13]) m.box(x, 0.24, -0.17, 0.1, 0.14, 0.05, hex(0x2f3229)); // mag pouches
    m.box(0, 0.42, -0.165, 0.2, 0.05, 0.02, hex(0x2a2c24)); // strap
    m.box(0, 0.33, 0.2, 0.34, 0.4, 0.14, hex(0x4a4a3a)); // backpack
    m.box(0, 0.5, 0.2, 0.3, 0.06, 0.16, hex(0x3b3b2e)); // bedroll
  });
  m.material(MAT.LEATHER, () => {
    m.box(0, 0.0, 0, 0.42, 0.06, 0.26, BLACK); // belt
    m.box(0.16, -0.03, 0.05, 0.08, 0.14, 0.06, hex(0x2a2622)); // holster
    for (const x of [-0.12, 0.12]) m.box(x, 0.35, 0, 0.05, 0.4, 0.31, hex(0x2a2c24)); // shoulder straps
  });
  m.material(MAT.SKIN, () => {
    m.cylinder(0, 0.55, 0, 0.06, 0.1, 7, SKIN); // neck
    m.box(0, 0.72, 0, 0.2, 0.22, 0.22, SKIN); // head
    m.box(0, 0.68, -0.115, 0.04, 0.05, 0.02, v3s(SKIN, 0.92)); // nose
    m.box(0.045, 0.6, -0.08, 0.08, 0.02, 0.06, v3s(SKIN, 0.85)); // jaw shade
  });
  m.material(MAT.PAINT, () => {
    m.box(0, 0.75, -0.115, 0.17, 0.05, 0.02, hex(0x101418)); // goggles
    m.box(0, 0.75, -0.125, 0.19, 0.055, 0.005, hex(0x1b2a30));
    m.box(0, 0.75, 0, 0.26, 0.02, 0.26, hex(0x1c1c1c)); // goggle strap
  });
  m.material(MAT.METAL, () => m.box(0.0, 0.62, 0.12, 0.08, 0.1, 0.04, hex(0x5a5a52))); // radio
  return { mesh: m };
}

export function soldierLeg() {
  const m = mb();
  m.material(MAT.CLOTH, () => {
    m.tinted(() => {
      m.cylinder(0, -0.45, 0, 0.1, 0.47, 8, [0.85, 0.85, 0.85], { r2: 0.085 });
      m.cylinder(0, -0.84, 0.01, 0.085, 0.4, 8, [0.8, 0.8, 0.8], { r2: 0.075 });
    });
    m.box(0.07, -0.3, -0.02, 0.06, 0.14, 0.12, hex(0x3b3e34)); // cargo pocket
  });
  m.material(MAT.LEATHER, () => {
    m.box(0, -0.42, -0.08, 0.14, 0.11, 0.05, hex(0x2b2b2b)); // knee pad
    m.box(0, -0.86, -0.04, 0.17, 0.12, 0.3, hex(0x242220)); // boot
    m.box(0, -0.9, -0.04, 0.18, 0.03, 0.31, hex(0x121212)); // sole
    m.box(0, -0.78, 0.0, 0.16, 0.06, 0.2, hex(0x2d2a26)); // cuff
  });
  return { mesh: m };
}

export const GUN_ATTACH = [0.04, -0.1, -0.42];

export function soldierArms() {
  const m = mb();
  m.material(MAT.CLOTH, () => {
    m.tinted(() => {
      m.rod([0.25, 0, 0], [0.22, -0.26, -0.12], 0.065, 7, [0.85, 0.85, 0.85], { r2: 0.055 });
      m.rod([0.22, -0.26, -0.12], [0.07, -0.12, -0.38], 0.055, 7, [0.85, 0.85, 0.85], { r2: 0.045 });
      m.rod([-0.25, 0, 0], [-0.2, -0.2, -0.28], 0.065, 7, [0.85, 0.85, 0.85], { r2: 0.055 });
      m.rod([-0.2, -0.2, -0.28], [-0.02, -0.08, -0.6], 0.055, 7, [0.85, 0.85, 0.85], { r2: 0.045 });
    });
    m.sphere(0.22, -0.26, -0.12, 0.065, 6, 4, hex(0x3b3e34)); // elbow pads
    m.sphere(-0.2, -0.2, -0.28, 0.065, 6, 4, hex(0x3b3e34));
  });
  m.material(MAT.LEATHER, () => {
    m.sphere(0.07, -0.12, -0.4, 0.055, 7, 5, hex(0x2a2622)); // gloves
    m.sphere(-0.02, -0.08, -0.62, 0.055, 7, 5, hex(0x2a2622));
  });
  return { mesh: m, meta: { gunAttach: GUN_ATTACH } };
}

// Guns: origin at the grip, barrel along -Z.
export function gunShotgun() {
  const m = mb();
  m.material(MAT.METAL, () => {
    m.box(0, 0.05, -0.15, 0.07, 0.1, 0.34, GUNMETAL);
    m.rod([0, 0.08, -0.3], [0, 0.08, -0.86], 0.024, 8, GUNMETAL);
    m.rod([0, 0.03, -0.3], [0, 0.03, -0.8], 0.02, 8, METAL); // tube magazine
    m.box(0, 0.11, -0.84, 0.01, 0.02, 0.02, hex(0xd8b04a)); // bead
    m.box(0, 0.0, 0.0, 0.03, 0.06, 0.03, METAL); // trigger guard
  });
  m.material(MAT.PLANK, () => {
    m.rod([0, 0.03, -0.42], [0, 0.03, -0.72], 0.036, 8, WOOD_LIGHT); // pump
    m.box(0, -0.02, 0.17, 0.06, 0.13, 0.32, WOOD);
    m.box(0, -0.06, 0.0, 0.05, 0.12, 0.06, WOOD); // grip
  });
  return { mesh: m, meta: { muzzle: [0, 0.08, -0.88] } };
}

export function gunBullpup() {
  const m = mb();
  const TAN = hex(0x9b8a66);
  m.material(MAT.PAINT, () => {
    m.box(0, 0.04, -0.06, 0.075, 0.15, 0.64, TAN);
    m.box(0, -0.06, -0.06, 0.05, 0.1, 0.05, TAN); // grip
    m.box(0, 0.0, -0.18, 0.06, 0.03, 0.08, v3s(TAN, 0.8)); // trigger guard
    m.box(0, 0.15, -0.12, 0.03, 0.06, 0.32, GUNMETAL); // carry handle optic
  });
  m.material(MAT.METAL, () => {
    m.box(0, -0.06, 0.12, 0.05, 0.16, 0.08, GUNMETAL); // mag behind grip
    m.rod([0, 0.18, -0.3], [0, 0.18, -0.06], 0.025, 8, BLACK);
    m.rod([0, 0.06, -0.38], [0, 0.06, -0.64], 0.018, 8, GUNMETAL);
    m.cylinder(0, 0.055, -0.66, 0.022, 0.05, 8, BLACK); // flash hider
  });
  return { mesh: m, meta: { muzzle: [0, 0.06, -0.66] } };
}

export function gunCarbine() {
  const m = mb();
  m.material(MAT.METAL, () => {
    m.box(0, 0.05, -0.12, 0.06, 0.1, 0.4, GUNMETAL);
    m.box(0, 0.11, -0.2, 0.03, 0.03, 0.5, hex(0x202224)); // top rail
    m.rod([0, 0.06, -0.5], [0, 0.06, -0.74], 0.016, 8, GUNMETAL);
    m.with(mat4.chain(mat4.translation(0, -0.06, -0.18), mat4.rotationX(0.25)), () => m.box(0, 0, 0, 0.045, 0.2, 0.08, METAL));
    m.rod([0, 0.06, 0.06], [0, 0.04, 0.3], 0.012, 5, METAL);
    m.box(0, 0.02, 0.3, 0.04, 0.12, 0.04, BLACK);
  });
  m.material(MAT.PAINT, () => {
    m.box(0, 0.05, -0.42, 0.07, 0.085, 0.24, hex(0x3a3d33)); // handguard
    m.box(0, -0.04, -0.01, 0.045, 0.12, 0.05, BLACK); // grip
    m.box(0, 0.14, -0.12, 0.035, 0.05, 0.1, hex(0x2b2b2b)); // red dot body
    m.box(0, 0.145, -0.17, 0.028, 0.03, 0.004, hex(0xc43a2a)); // red dot lens
  });
  return { mesh: m, meta: { muzzle: [0, 0.06, -0.76] } };
}

export function gunDMR() {
  const m = mb();
  m.material(MAT.PLANK, () => {
    m.box(0, 0.04, -0.15, 0.065, 0.11, 0.5, WOOD_DARK);
    m.box(0, 0.0, 0.2, 0.06, 0.15, 0.36, WOOD);
    m.box(0, -0.05, 0.36, 0.065, 0.16, 0.04, hex(0x2a2622)); // butt pad
  });
  m.material(MAT.METAL, () => {
    m.rod([0, 0.06, -0.4], [0, 0.06, -1.06], 0.019, 8, GUNMETAL);
    m.rod([0, 0.16, -0.38], [0, 0.16, 0.02], 0.032, 10, BLACK); // scope
    m.cylinder(0, 0.16, -0.4, 0.042, 0.02, 10, BLACK);
    m.box(0, 0.11, -0.18, 0.02, 0.05, 0.04, METAL);
    m.box(0, 0.11, 0.0, 0.02, 0.05, 0.04, METAL);
    m.box(0, -0.06, -0.12, 0.04, 0.12, 0.09, GUNMETAL); // box mag
    m.cylinder(0, 0.055, -1.08, 0.024, 0.06, 8, BLACK); // muzzle brake
    m.rod([0.05, -0.02, -0.5], [0.05, -0.2, -0.5], 0.008, 4, METAL); // bipod legs
    m.rod([-0.05, -0.02, -0.5], [-0.05, -0.2, -0.5], 0.008, 4, METAL);
  });
  return { mesh: m, meta: { muzzle: [0, 0.06, -1.08] } };
}

// Player weapon held by power-armour gauntlets; camera-space model.
export function playerRifle() {
  const m = mb();
  const GUN = hex(0x6a737c), PLATE = hex(0x6f7d68), GLOW = hex(0x5fe8ff), DARK = hex(0x30353b);
  m.material(MAT.METAL, () => {
    m.box(0, 0, -0.12, 0.11, 0.14, 0.6, GUN);
    m.box(0, 0.09, -0.12, 0.05, 0.03, 0.5, DARK); // rail
    for (let z = -0.34; z < 0.1; z += 0.04) m.box(0, 0.105, z, 0.05, 0.006, 0.02, hex(0x1e2226)); // rail slots
    m.box(0, 0.13, -0.05, 0.06, 0.06, 0.14, hex(0x23272c)); // sight
    m.box(0, -0.01, -0.5, 0.13, 0.12, 0.26, hex(0x4a525b)); // shroud
    for (let z = -0.4; z > -0.62; z -= 0.045) m.box(0, 0.055, z, 0.1, 0.01, 0.02, hex(0x2a2f35)); // vents
    m.rod([0, 0.0, -0.62], [0, 0.0, -0.74], 0.03, 10, BLACK);
    m.cylinder(0, 0, -0.75, 0.035, 0.01, 10, hex(0x1a1c1f));
    m.box(0, -0.13, -0.05, 0.07, 0.16, 0.1, hex(0x2b2f35)); // mag
    m.box(0, -0.04, 0.2, 0.09, 0.13, 0.12, hex(0x4a525b)); // butt
    m.box(0, -0.085, -0.22, 0.03, 0.04, 0.03, hex(0x23272c)); // trigger guard
  });
  m.material(MAT.PAINT, () => {
    m.box(0, 0.14, -0.12, 0.012, 0.03, 0.01, GLOW);
    for (const z of [-0.42, -0.5, -0.58]) m.box(0, -0.01, z, 0.135, 0.02, 0.02, GLOW);
    m.box(0.057, 0.0, -0.18, 0.005, 0.03, 0.3, GLOW);
    m.box(0.06, 0.03, 0.0, 0.004, 0.02, 0.12, hex(0xc6a53a)); // ammo counter strip
  });
  // Right gauntlet (power armour forearm) and hand.
  m.material(MAT.PAINT, () => {
    m.rod([0.12, -0.32, 0.5], [0.04, -0.1, 0.1], 0.085, 9, PLATE, { r2: 0.07 });
    m.box(0.09, -0.24, 0.35, 0.16, 0.1, 0.28, v3s(PLATE, 1.1)); // forearm plate
    m.box(0.05, -0.1, 0.08, 0.13, 0.12, 0.15, hex(0x4b5749)); // hand
    for (let i = 0; i < 3; i++) m.box(0.0 + i * 0.035, -0.14, 0.02, 0.03, 0.03, 0.1, hex(0x3e4a3c)); // fingers
    m.box(0.1, -0.2, 0.32, 0.03, 0.08, 0.25, hex(0xc6a53a));
    // Left gauntlet supporting the shroud.
    m.rod([-0.3, -0.38, 0.2], [-0.04, -0.08, -0.42], 0.085, 9, PLATE, { r2: 0.07 });
    m.box(-0.2, -0.26, -0.05, 0.16, 0.1, 0.3, v3s(PLATE, 1.1));
    m.box(-0.02, -0.08, -0.45, 0.14, 0.11, 0.14, hex(0x4b5749));
    for (let i = 0; i < 3; i++) m.box(-0.05 + i * 0.035, -0.1, -0.52, 0.03, 0.09, 0.03, hex(0x3e4a3c));
  });
  m.material(MAT.METAL, () => {
    m.box(0.12, -0.3, 0.52, 0.12, 0.12, 0.06, hex(0x4a4f55)); // wrist servo
    m.box(-0.28, -0.36, 0.22, 0.12, 0.12, 0.06, hex(0x4a4f55));
  });
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
