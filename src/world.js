// Static level geometry for gameplay: AABB colliders built from model
// colliders + instance transforms, the terrain heightfield, ray casts and
// character movement.
import { Heightfield } from './terrain.js';
import { mat4 } from './math.js';

const STEP_HEIGHT = 0.55;

export class World {
  constructor(level, pack) {
    const t = level.terrain;
    this.terrain = new Heightfield(pack.blobs[t.blob], t.res, t.size);
    this.bounds = level.bounds;
    this.boxes = [];
    for (const inst of level.instances) {
      if (inst.solid === false) continue;
      const model = pack.models[inst.model];
      if (!model?.colliders?.length) continue;
      const m = mat4.trs(inst.pos, inst.rot || 0, inst.scale || 1);
      for (const c of model.colliders) this.boxes.push(transformBox(m, c.min, c.max));
    }
    this.dynamic = []; // extra boxes owned by gameplay (none in level 1, kept for doors etc.)
    this.#buildGrid();
  }

  // Uniform XZ grid for broad-phase queries.
  #buildGrid() {
    this.cell = 8;
    this.grid = new Map();
    this.boxes.forEach((b, i) => {
      for (let x = Math.floor(b.min[0] / this.cell); x <= Math.floor(b.max[0] / this.cell); x++) {
        for (let z = Math.floor(b.min[2] / this.cell); z <= Math.floor(b.max[2] / this.cell); z++) {
          const k = x * 4096 + z;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(i);
        }
      }
    });
    this.stamp = new Uint32Array(this.boxes.length);
    this.stampId = 0;
  }

  // Boxes overlapping an XZ rectangle.
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const id = ++this.stampId;
    for (let x = Math.floor(minX / this.cell); x <= Math.floor(maxX / this.cell); x++) {
      for (let z = Math.floor(minZ / this.cell); z <= Math.floor(maxZ / this.cell); z++) {
        const list = this.grid.get(x * 4096 + z);
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const b = this.boxes[i];
          if (b.max[0] > minX && b.min[0] < maxX && b.max[2] > minZ && b.min[2] < maxZ) out.push(b);
        }
      }
    }
    return out;
  }

  groundHeight(x, z) {
    return this.terrain.sample(x, z);
  }

  // Highest support (terrain or box top) under a cylinder footprint at or below maxY.
  supportHeight(x, z, r, maxY) {
    let h = Math.max(
      this.terrain.sample(x, z),
      this.terrain.sample(x + r * 0.7, z), this.terrain.sample(x - r * 0.7, z),
      this.terrain.sample(x, z + r * 0.7), this.terrain.sample(x, z - r * 0.7),
    );
    for (const b of this.query(x - r, z - r, x + r, z + r, this._q || (this._q = []))) {
      if (b.max[1] <= maxY && b.max[1] > h) h = b.max[1];
    }
    return h;
  }

  // Move a vertical cylinder (feet at body.pos) by its velocity; resolves
  // collisions with sliding, step-up and gravity. Mutates body.
  move(body, dt) {
    const steps = Math.max(1, Math.ceil((Math.hypot(body.vel[0], body.vel[2]) * dt) / 0.2));
    const h = dt / steps;
    body.wasGround = body.onGround;
    body.onGround = false;
    for (let s = 0; s < steps; s++) this.#moveStep(body, h);
    const bmin = this.bounds.min, bmax = this.bounds.max;
    body.pos[0] = Math.min(Math.max(body.pos[0], bmin[0]), bmax[0]);
    body.pos[2] = Math.min(Math.max(body.pos[2], bmin[2]), bmax[2]);
  }

  #moveStep(body, dt) {
    const p = body.pos, v = body.vel, r = body.radius;
    p[0] += v[0] * dt;
    p[2] += v[2] * dt;
    // Horizontal push-out against boxes blocking the body above step height.
    const list = this._m || (this._m = []);
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (const b of this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, list)) {
        if (b.max[1] <= p[1] + STEP_HEIGHT || b.min[1] >= p[1] + body.height) continue;
        const ox1 = p[0] + r - b.min[0], ox2 = b.max[0] - (p[0] - r);
        const oz1 = p[2] + r - b.min[2], oz2 = b.max[2] - (p[2] - r);
        if (ox1 <= 0 || ox2 <= 0 || oz1 <= 0 || oz2 <= 0) continue;
        const px = ox1 < ox2 ? -ox1 : ox2;
        const pz = oz1 < oz2 ? -oz1 : oz2;
        if (Math.abs(px) < Math.abs(pz)) {
          p[0] += px;
          if (Math.sign(v[0]) === -Math.sign(px)) v[0] = 0;
        } else {
          p[2] += pz;
          if (Math.sign(v[2]) === -Math.sign(pz)) v[2] = 0;
        }
        pushed = true;
        body.hitWall = true;
      }
      if (!pushed) break;
    }
    // Vertical.
    v[1] -= body.gravity * dt;
    p[1] += v[1] * dt;
    const support = this.supportHeight(p[0], p[2], r * 0.8, p[1] + STEP_HEIGHT);
    if (p[1] <= support + 0.001) {
      if (v[1] <= 0) {
        if (support - p[1] > 0.05) body.stepUp = (body.stepUp || 0) + (support - p[1]);
        p[1] = support;
        if (v[1] < -0.5) body.landSpeed = -v[1];
        v[1] = 0;
        body.onGround = true;
      }
    } else if (v[1] <= 0 && body.wasGround && p[1] - support < 0.45) {
      // Snap down small drops (walking down stairs / slopes).
      p[1] = support;
      v[1] = 0;
      body.onGround = true;
    }
    // Ceiling.
    if (v[1] > 0) {
      for (const b of this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, list)) {
        const top = p[1] + body.height;
        if (b.min[1] < top && b.min[1] > p[1] + STEP_HEIGHT && b.max[1] > top) {
          p[1] = b.min[1] - body.height;
          v[1] = 0;
        }
      }
    }
  }

  // Ray against boxes + terrain. Returns { t, point, normal } or null.
  raycast(o, d, maxDist) {
    let best = maxDist, normal = null;
    // Broad phase over the ray's XZ extent.
    const ex = o[0] + d[0] * maxDist, ez = o[2] + d[2] * maxDist;
    const cand = this.query(Math.min(o[0], ex) - 0.1, Math.min(o[2], ez) - 0.1, Math.max(o[0], ex) + 0.1, Math.max(o[2], ez) + 0.1, this._r || (this._r = []));
    for (const b of cand) {
      const hit = rayBox(o, d, b.min, b.max, best);
      if (hit) {
        best = hit.t;
        normal = hit.n;
      }
    }
    const th = this.#rayTerrain(o, d, best);
    if (th !== null) {
      best = th;
      const p = [o[0] + d[0] * th, o[1] + d[1] * th, o[2] + d[2] * th];
      normal = this.terrain.normal(p[0], p[2]);
    }
    if (!normal) return null;
    return { t: best, point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], normal };
  }

  #rayTerrain(o, d, maxDist) {
    const step = 0.6;
    let prevT = 0;
    let prevAbove = o[1] - this.terrain.sample(o[0], o[2]);
    if (prevAbove < 0) return null;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const y = o[1] + d[1] * tt;
      const above = y - this.terrain.sample(o[0] + d[0] * tt, o[2] + d[2] * tt);
      if (above < 0) {
        // Linear refine between the two samples.
        const k = prevAbove / (prevAbove - above);
        return prevT + (tt - prevT) * k;
      }
      prevT = tt;
      prevAbove = above;
      if (tt >= maxDist) break;
    }
    return null;
  }

  // True when nothing blocks the segment a→b.
  lineOfSight(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) return true;
    d[0] /= len; d[1] /= len; d[2] /= len;
    return !this.raycast(a, d, len - 0.05);
  }
}

function transformBox(m, min, max) {
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < 8; i++) {
    const p = mat4.transformPoint(m, [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k], p[k]);
      out.max[k] = Math.max(out.max[k], p[k]);
    }
  }
  return out;
}

// Slab test. Returns { t, n } of the entry point, or null.
export function rayBox(o, d, min, max, maxT) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    const inv = 1 / d[k];
    let t1 = (min[k] - o[k]) * inv, t2 = (max[k] - o[k]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // origin inside the box
  const n = [0, 0, 0];
  n[axis] = sign;
  return { t: tmin, n };
}

// Ray vs sphere; returns distance or null.
export function raySphere(o, d, c, r, maxT) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : null;
}
