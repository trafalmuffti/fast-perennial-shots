// Level 1 — "Hill Fort". Generates the level's model pack (terrain + every
// mesh the level uses) and its layout description (level.json).
import { MeshBuilder, hex } from '../lib/mesh.mjs';
import * as P from '../lib/props.mjs';
import { Heightfield } from '../../src/terrain.js';
import { rng, smoothstep } from '../../src/math.js';

export const id = 'hillfort';

const H0 = 10; // plateau height the fort sits on
const TERRAIN_SIZE = 260;
const TERRAIN_RES = 129;
const HALF_PI = Math.PI / 2;

// ------------------------------------------------------------------ terrain

function hash2(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const tx = x - xi, tz = z - zi;
  const fx = tx * tx * (3 - 2 * tx), fz = tz * tz * (3 - 2 * tz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
function fbm(x, z) {
  let s = 0, a = 0.55, f = 1;
  for (let o = 0; o < 4; o++) {
    s += valueNoise(x * f, z * f) * a;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = H0 * (1 - smoothstep((r - 34) / 54));
  h += fbm(x * 0.025 + 3.1, z * 0.025 - 1.7) * 3.2 * smoothstep((r - 37) / 14);
  h += smoothstep((Math.max(Math.abs(x), Math.abs(z)) - 95) / 30) * 9; // enclosing rim
  // Soften the approach road south of the gate.
  const road = smoothstep(1 - Math.abs(x) / 9) * smoothstep((z - 30) / 8);
  if (road > 0) h = h * (1 - road * 0.4) + (H0 * (1 - smoothstep((r - 34) / 54))) * road * 0.4;
  return h;
}

function buildTerrain() {
  const res = TERRAIN_RES, size = TERRAIN_SIZE, half = size / 2, cell = size / (res - 1);
  const heights = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) heights[j * res + i] = heightAt(-half + i * cell, -half + j * cell);
  }
  const hf = new Heightfield(heights, res, size);
  const m = new MeshBuilder(7);
  const grassA = hex(0x4d7330), grassB = hex(0x6f8c3c), dirt = hex(0x7d6748), rockC = hex(0x6f6a62), road = hex(0x8a7454);
  const ids = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + i * cell, z = -half + j * cell;
      const n = hf.normal(x, z);
      const g = fbm(x * 0.08, z * 0.08) * 0.5 + 0.5;
      let c = [grassA[0] + (grassB[0] - grassA[0]) * g, grassA[1] + (grassB[1] - grassA[1]) * g, grassA[2] + (grassB[2] - grassA[2]) * g];
      if (n[1] < 0.86) {
        const t = smoothstep((0.86 - n[1]) / 0.12);
        c = c.map((v, k) => v + (rockC[k] - v) * t);
      }
      const inFort = Math.max(Math.abs(x), Math.abs(z)) < 24;
      if (inFort) c = dirt.map((v) => v * (0.9 + g * 0.2));
      const roadMask = (1 - smoothstep((Math.abs(x + Math.sin(z * 0.08) * 1.5) - 2.2) / 2)) * (z > 20 ? 1 : 0);
      if (roadMask > 0) c = c.map((v, k) => v + (road[k] * (0.9 + g * 0.2) - v) * roadMask);
      ids.push(m.vert([x, heights[j * res + i], z], n, c));
    }
  }
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i;
      m.tri(ids[a], ids[a + res], ids[a + res + 1], [0, 1, 0]);
      m.tri(ids[a], ids[a + res + 1], ids[a + 1], [0, 1, 0]);
    }
  }
  return { hf, heights, mesh: m };
}

// ------------------------------------------------------------------ build

export function build() {
  const terrain = buildTerrain();
  const hf = terrain.hf;

  const models = {
    terrain: { mesh: terrain.mesh, meta: { heightBlob: 'heights', res: TERRAIN_RES, size: TERRAIN_SIZE } },
    palisade_a: P.palisade({ seed: 11 }),
    palisade_b: P.palisade({ seed: 12 }),
    palisade_c: P.palisade({ seed: 13 }),
    palisade_low: P.palisade({ seed: 14, height: 3.4 }),
    gatehouse: P.gatehouse(),
    gate_door: P.gateDoor(),
    watchtower: P.watchtower({ openA: -0.1, openB: 2.1 }),
    stairs_12: P.stairs({ steps: 12, rise: 4.6 / 12, run: 0.6 }),
    stairs_15: P.stairs({ steps: 15, rise: 0.4, run: 0.6 }),
    barracks: P.building({
      w: 10, d: 8, h: 3,
      walls: {
        e: [{ a: -0.8, b: 0.8, y0: 0, y1: 2.4 }, { a: 2.2, b: 3.1, y0: 1.2, y1: 2.0 }],
        n: [{ a: -3.2, b: -2.2, y0: 1.2, y1: 2.0 }, { a: 1.5, b: 2.5, y0: 1.2, y1: 2.0 }],
        s: [{ a: -3.2, b: -2.2, y0: 1.2, y1: 2.0 }, { a: 1.5, b: 2.5, y0: 1.2, y1: 2.0 }],
      },
      partitions: [{ axis: 'z', at: -1, from: -3.7, to: 3.7, openings: [{ a: -2.6, b: -1.4, y0: 0, y1: 2.4 }] }],
    }),
    hq_hut: P.building({
      w: 8, d: 9, h: 3,
      walls: {
        w: [{ a: 2.0, b: 3.6, y0: 0, y1: 2.4 }, { a: -2.5, b: -1.5, y0: 1.1, y1: 2.0 }],
        s: [{ a: -1, b: 1, y0: 1.1, y1: 2.0 }],
        n: [{ a: 1, b: 2, y0: 1.2, y1: 2.0 }],
        e: [{ a: 0, b: 1, y0: 1.2, y1: 2.0 }],
      },
      partitions: [{ axis: 'x', at: -0.5, from: -3.7, to: 3.7, openings: [{ a: 1.0, b: 2.4, y0: 0, y1: 2.4 }] }],
    }),
    shed: P.shed(),
    crate: P.crate(1.2),
    crate_small: P.crate(0.8, hex(0x8f7550)),
    crate_long: P.longCrate(),
    barrel: P.barrel(),
    sandbags: P.sandbags(3),
    bunk: P.bunk(),
    table: P.table(),
    ammo_box: P.ammoBox(),
    pine_a: P.pine(31, 9),
    pine_b: P.pine(32, 12),
    rock_a: P.rock(41),
    rock_b: P.rock(42),
    dais: P.dais(),
    flagpole: P.flagpole(9.5),
    flag_cloth: P.flagCloth(),
    soldier_torso: P.soldierTorso(),
    soldier_leg: P.soldierLeg(),
    soldier_arms: P.soldierArms(),
    gun_shotgun: P.gunShotgun(),
    gun_bullpup: P.gunBullpup(),
    gun_carbine: P.gunCarbine(),
    gun_dmr: P.gunDMR(),
    player_rifle: P.playerRifle(),
    fx_box: P.fxBox(),
    fx_flash: P.fxFlash(),
    fx_spark: P.fxSpark(),
    fx_shield: P.fxShield(),
  };

  const instances = [];
  const place = (model, x, y, z, rot = 0, opts = {}) => {
    instances.push({ model, pos: [r3(x), r3(y), r3(z)], rot: r3(rot), ...(opts.solid === false ? { solid: false } : { solid: true }), ...(opts.scale ? { scale: opts.scale } : {}) });
  };
  // Ground height under a footprint (lowest corner so nothing floats).
  const ground = (x, z, rad = 0.6) => Math.min(hf.sample(x - rad, z - rad), hf.sample(x + rad, z - rad), hf.sample(x - rad, z + rad), hf.sample(x + rad, z + rad));

  place('terrain', 0, 0, 0, 0, { solid: false });

  // Palisade: 2 m segments, local +Z faces the fort interior.
  const variants = ['palisade_a', 'palisade_b', 'palisade_c'];
  let vi = 0;
  for (let c = -21; c <= 21; c += 2) {
    place(variants[vi++ % 3], c, H0, -22, 0);
    place(variants[vi++ % 3], -22, H0, c, HALF_PI);
    place(variants[vi++ % 3], 22, H0, c, -HALF_PI);
    if (Math.abs(c) <= 1) continue; // gate opening
    place(Math.abs(c) <= 5 ? 'palisade_low' : variants[vi++ % 3], c, H0, 22, Math.PI);
  }
  place('gatehouse', 0, H0, 22);
  place('gate_door', -2.0, H0, 21.7, HALF_PI);
  place('gate_door', 2.0, H0, 21.7, HALF_PI);
  place('stairs_12', 11.8, H0, 20.4, HALF_PI);

  place('watchtower', -19, H0, 19);
  place('stairs_15', -7.5, H0, 20, HALF_PI);

  // Buildings and their interiors.
  place('barracks', -15, H0, 0);
  place('bunk', -13, H0, -3.1);
  place('bunk', -13, H0, 3.1);
  place('table', -14, H0, 1.2, HALF_PI);
  place('crate', -19, H0, -3);
  place('crate', -19, H0, 3);
  place('crate_long', -18.6, H0, 0.2, HALF_PI);
  place('crate_small', -19, H0 + 1.2, 3);

  place('hq_hut', 15, H0, -6);
  place('table', 16, H0, -4);
  place('crate', 18, H0, -2.4);
  place('crate', 17.6, H0, -9.6);
  place('crate_small', 12.4, H0, -9.6);
  place('barrel', 18.2, H0, -7.6);

  place('shed', 15, H0, 12);
  place('crate', 13.4, H0, 12.2);
  place('crate_small', 15, H0, 12.6);
  place('barrel', 17, H0, 11.2);
  place('barrel', 17.7, H0, 12.1);
  place('crate_long', 14.6, H0, 10.6);

  // Courtyard cover.
  place('dais', 0, H0, -10);
  place('flagpole', 0, H0 + 0.5, -10, 0);
  place('crate', 3.5, H0, 5.5);
  place('crate', 2.3, H0, 5.8);
  place('crate_small', 3.2, H0 + 1.2, 5.6);
  place('crate_long', -3, H0, 7);
  place('crate', -7, H0, -12);
  place('crate', -5.8, H0, -12.5);
  place('barrel', -8.2, H0, -10.6);
  place('crate', 7, H0, -14);
  place('crate_long', 8, H0, -6, HALF_PI);
  place('barrel', 9.9, H0, -1);
  place('barrel', 10.1, H0, 0.2);
  place('crate_small', -9, H0, 14);
  place('crate', -10.2, H0, 14.3);

  // Outside the gate.
  for (const [model, x, z, rot] of [
    ['sandbags', -5, 27, 0], ['sandbags', 5.5, 28.5, 0], ['crate', 3, 33, 0], ['crate_small', -7.5, 31, 0],
    ['crate', -3, 45, 0], ['crate_small', -2.2, 45.6, 0], ['sandbags', 4, 52, 0], ['crate_long', -6, 62, HALF_PI],
    ['crate', 6, 70, 0], ['sandbags', -4, 78, 0],
  ]) {
    place(model, x, ground(x, z, 1.4), z, rot);
  }

  // Forest ring.
  const rand = rng(1234);
  let trees = 0, guard = 0;
  while (trees < 90 && guard++ < 3000) {
    const x = (rand() * 2 - 1) * 118, z = (rand() * 2 - 1) * 118;
    const r = Math.hypot(x, z);
    if (r < 41) continue;
    if (Math.abs(x) < 11 && z > 15) continue; // keep the approach road clear
    if (Math.hypot(x, z - 100) < 14) continue;
    place(rand() < 0.5 ? 'pine_a' : 'pine_b', x, ground(x, z, 0.3), z, rand() * Math.PI * 2, { scale: r3(0.8 + rand() * 0.5) });
    trees++;
  }
  let rocks = 0;
  guard = 0;
  while (rocks < 30 && guard++ < 3000) {
    const x = (rand() * 2 - 1) * 115, z = (rand() * 2 - 1) * 115;
    if (Math.hypot(x, z) < 38) continue;
    if (Math.abs(x) < 6 && z > 20) continue;
    place(rand() < 0.5 ? 'rock_a' : 'rock_b', x, ground(x, z, 0.5) - 0.2, z, rand() * Math.PI * 2, { scale: r3(0.7 + rand() * 1.1) });
    rocks++;
  }

  const spawnZ = 100;
  const level = {
    id,
    name: 'Hill Fort',
    briefing: 'A timber hill fort holds the ridge. Four veteran soldiers guard it, each with a different weapon. Breach the fort and capture their flag.',
    models: 'models.bin',
    terrain: { model: 'terrain', blob: 'heights', res: TERRAIN_RES, size: TERRAIN_SIZE },
    bounds: { min: [-120, -10, -120], max: [120, 80, 120] },
    environment: {
      sunDir: [0.45, 0.72, 0.38],
      sunColor: [1.0, 0.92, 0.78],
      sunIntensity: 2.6,
      skyTop: [0.26, 0.45, 0.72],
      skyHorizon: [0.72, 0.8, 0.86],
      groundAmbient: [0.36, 0.32, 0.26],
      ambient: 0.55,
      fogDensity: 0.0065,
      shadowCenter: [0, H0, 10],
      shadowRadius: 75,
    },
    player: { spawn: [0, r3(hf.sample(0, spawnZ)), spawnZ], yaw: 0 },
    flag: {
      pole: [0, H0 + 0.5, -10],
      poleHeight: 9.5,
      clothModel: 'flag_cloth',
      captureRadius: 3.2,
      captureTime: 2.5,
      lowerTime: 4.5,
    },
    pickups: [
      { type: 'ammo', pos: [-17.4, H0, -2.4], amount: 96 },
      { type: 'ammo', pos: [14, H0, -8.4], amount: 96 },
      { type: 'ammo', pos: [-7.5, r3(ground(-7.5, 31) + 0.8), 31], amount: 64 },
    ],
    enemies: [
      {
        name: 'Sgt. Vosk', role: 'breacher', weapon: 'shotgun', tint: [0.42, 0.36, 0.3],
        pos: [-12.5, H0, -0.5], yaw: -HALF_PI, leash: 18,
      },
      {
        name: 'Cpl. Hale', role: 'sentry', weapon: 'bullpup', tint: [0.62, 0.55, 0.4],
        pos: [0, H0 + 4.6, 22.2], yaw: Math.PI, leash: 3.6,
      },
      {
        name: 'Pvt. Marr', role: 'patrol', weapon: 'carbine', tint: [0.35, 0.42, 0.3],
        pos: [6, H0, -4], yaw: Math.PI, leash: 22,
        patrol: [[6, -4], [6, 10], [-6, 10], [-6, -4]],
      },
      {
        name: 'Lt. Okafor', role: 'marksman', weapon: 'dmr', tint: [0.3, 0.32, 0.38],
        pos: [-19.6, H0 + 6, 19.4], yaw: r3(Math.atan2(-19.6, -40)), leash: 1.2,
      },
    ],
    instances,
  };

  return { models, blobs: { heights: terrain.heights }, level };
}

const r3 = (x) => Math.round(x * 1000) / 1000;
