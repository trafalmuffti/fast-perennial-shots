// Procedural mesh construction + model pack writer used by level build scripts.
import { mat4, v3, rng } from '../../src/math.js';
import { MAGIC, VERSION, VERTEX_STRIDE } from '../../src/modelpack.js';

export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

export class MeshBuilder {
  constructor(seed = 1) {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
    this.stack = [mat4.create()];
    this.rand = rng(seed);
    this.tint = false; // when true, emitted vertices are tintable per instance
  }

  get m() {
    return this.stack[this.stack.length - 1];
  }

  push(m) {
    this.stack.push(mat4.multiply(this.m, m));
    return this;
  }

  pop() {
    this.stack.pop();
    return this;
  }

  with(m, fn) {
    this.push(m);
    fn(this);
    this.pop();
    return this;
  }

  tinted(fn) {
    const prev = this.tint;
    this.tint = true;
    fn(this);
    this.tint = prev;
    return this;
  }

  jitterColor(c, j) {
    if (!j) return c;
    const k = 1 + (this.rand() - 0.5) * j;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  vert(p, n, c) {
    const wp = mat4.transformPoint(this.m, p);
    const wn = v3.norm(mat4.transformDir(this.m, n));
    this.pos.push(wp);
    this.nrm.push(wn);
    this.col.push([c[0], c[1], c[2], this.tint ? 1 : 0]);
    return this.pos.length - 1;
  }

  // Triangle by indices; flips winding so the face is CCW when seen from `hint`.
  tri(a, b, c, hint) {
    const pa = this.pos[a], pb = this.pos[b], pc = this.pos[c];
    const n = v3.cross(v3.sub(pb, pa), v3.sub(pc, pa));
    if (hint && v3.dot(n, hint) < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  // Flat-shaded quad (local coords). Winding fixed against the given normal.
  quad(p0, p1, p2, p3, n, c) {
    const a = this.vert(p0, n, c), b = this.vert(p1, n, c);
    const d = this.vert(p2, n, c), e = this.vert(p3, n, c);
    const wn = v3.norm(mat4.transformDir(this.m, n));
    this.tri(a, b, d, wn);
    this.tri(a, d, e, wn);
  }

  // Axis aligned box given center + size in local coords.
  box(cx, cy, cz, sx, sy, sz, color, jitter = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const c = () => this.jitterColor(color, jitter);
    const top = c(), side = c();
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], top);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], v3.scale(side, 0.7));
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], side);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], v3.scale(side, 0.92));
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], v3.scale(side, 0.92));
    return this;
  }

  boxMinMax(min, max, color, jitter = 0) {
    return this.box(
      (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
      max[0] - min[0], max[1] - min[1], max[2] - min[2], color, jitter,
    );
  }

  // Cylinder / cone / frustum along +Y starting at (cx, cy, cz).
  cylinder(cx, cy, cz, r, h, seg, color, { r2 = r, capTop = true, capBottom = false, jitter = 0 } = {}) {
    const col = this.jitterColor(color, jitter);
    const slope = (r - r2) / h;
    const ring0 = [], ring1 = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const n = v3.norm([ca, slope, sa]);
      const shade = 0.85 + 0.15 * Math.max(0, ca);
      const c = v3.scale(col, shade);
      ring0.push(this.vert([cx + ca * r, cy, cz + sa * r], n, c));
      ring1.push(this.vert([cx + ca * r2, cy + h, cz + sa * r2], n, c));
    }
    for (let i = 0; i < seg; i++) {
      const a = (i / seg + 0.5 / seg) * Math.PI * 2;
      const hint = v3.norm(mat4.transformDir(this.m, [Math.cos(a), 0, Math.sin(a)]));
      this.tri(ring0[i], ring0[i + 1], ring1[i + 1], hint);
      this.tri(ring0[i], ring1[i + 1], ring1[i], hint);
    }
    const cap = (y, rr, up) => {
      if (rr <= 0) return;
      const n = [0, up ? 1 : -1, 0];
      const c = v3.scale(col, up ? 1.05 : 0.7);
      const center = this.vert([cx, y, cz], n, c);
      const ring = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vert([cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr], n, c));
      }
      const hint = v3.norm(mat4.transformDir(this.m, n));
      for (let i = 0; i < seg; i++) this.tri(center, ring[i], ring[i + 1], hint);
    };
    if (capTop) cap(cy + h, r2, true);
    if (capBottom) cap(cy, r, false);
    return this;
  }

  // Cylinder between two local points (logs, beams, barrels, limbs).
  rod(a, b, r, seg, color, opts = {}) {
    const d = v3.sub(b, a);
    const len = v3.len(d);
    this.with(mat4.alignY(a, d), () => this.cylinder(0, 0, 0, r, len, seg, color, { capBottom: true, ...opts }));
    return this;
  }

  // Low poly UV sphere.
  sphere(cx, cy, cz, r, seg, rings, color, sy = 1) {
    const grid = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      const row = [];
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
        row.push(this.vert([cx + n[0] * r, cy + n[1] * r * sy, cz + n[2] * r], n, color));
      }
      grid.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const phi = ((j + 0.5) / rings) * Math.PI, th = ((i + 0.5) / seg) * Math.PI * 2;
        const hint = v3.norm(mat4.transformDir(this.m, [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]));
        this.tri(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], hint);
        this.tri(grid[j][i], grid[j + 1][i + 1], grid[j + 1][i], hint);
      }
    }
    return this;
  }

  // Double sided subdivided plane in XY, origin at bottom-left. colorFn(u,v) -> rgb.
  cloth(w, h, nx, ny, colorFn) {
    for (const side of [1, -1]) {
      const n = [0, 0, side];
      const ids = [];
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, v = j / ny;
          ids.push(this.vert([u * w, v * h, 0], n, colorFn(Math.min(u, 0.999), Math.min(v, 0.999))));
        }
      }
      const hint = v3.norm(mat4.transformDir(this.m, n));
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i;
          this.tri(ids[a], ids[a + 1], ids[a + nx + 2], hint);
          this.tri(ids[a], ids[a + nx + 2], ids[a + nx + 1], hint);
        }
      }
    }
    return this;
  }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.pos) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
    return { min: min.map(round3), max: max.map(round3) };
  }
}

const round3 = (x) => Math.round(x * 1000) / 1000;

const clampByte = (x) => Math.max(0, Math.min(255, Math.round(x)));

// models: { name: { mesh: MeshBuilder, colliders?: [{min,max}], meta?: {} } }
// blobs:  { name: Float32Array }
export function writeModelPack(models, blobs = {}) {
  let vertexCount = 0, indexCount = 0;
  const entries = {};
  for (const [name, m] of Object.entries(models)) {
    entries[name] = {
      baseVertex: vertexCount,
      firstIndex: indexCount,
      indexCount: m.mesh.idx.length,
      bounds: m.mesh.bounds(),
      colliders: (m.colliders || []).map((c) => ({ min: c.min.map(round3), max: c.max.map(round3) })),
      ...(m.meta ? { meta: m.meta } : {}),
    };
    vertexCount += m.mesh.pos.length;
    indexCount += m.mesh.idx.length;
  }

  const vertexByteOffset = 0;
  const indexByteOffset = vertexCount * VERTEX_STRIDE;
  let off = indexByteOffset + indexCount * 4;
  const blobEntries = {};
  for (const [name, arr] of Object.entries(blobs)) {
    blobEntries[name] = { byteOffset: off, count: arr.length };
    off += arr.length * 4;
  }
  const header = { vertexCount, indexCount, vertexByteOffset, indexByteOffset, models: entries, blobs: blobEntries };
  let json = JSON.stringify(header);
  while ((json.length + 12) % 4) json += ' ';
  const headerBytes = Buffer.from(json, 'utf8');
  // Pad again in case of multi-byte chars.
  const headerLen = Math.ceil(headerBytes.length / 4) * 4;
  const total = 12 + headerLen + off;
  const buf = Buffer.alloc(total, 0x20);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, headerLen, true);
  headerBytes.copy(buf, 12);
  const base = 12 + headerLen;

  let v = base + vertexByteOffset;
  for (const m of Object.values(models)) {
    const { pos, nrm, col } = m.mesh;
    for (let i = 0; i < pos.length; i++) {
      dv.setFloat32(v, pos[i][0], true);
      dv.setFloat32(v + 4, pos[i][1], true);
      dv.setFloat32(v + 8, pos[i][2], true);
      dv.setInt8(v + 12, Math.round(nrm[i][0] * 127));
      dv.setInt8(v + 13, Math.round(nrm[i][1] * 127));
      dv.setInt8(v + 14, Math.round(nrm[i][2] * 127));
      dv.setInt8(v + 15, 0);
      dv.setUint8(v + 16, clampByte(col[i][0] * 255));
      dv.setUint8(v + 17, clampByte(col[i][1] * 255));
      dv.setUint8(v + 18, clampByte(col[i][2] * 255));
      dv.setUint8(v + 19, col[i][3] ? 255 : 0);
      v += VERTEX_STRIDE;
    }
  }
  let ix = base + indexByteOffset;
  for (const m of Object.values(models)) {
    for (const i of m.mesh.idx) {
      dv.setUint32(ix, i, true);
      ix += 4;
    }
  }
  for (const [name, arr] of Object.entries(blobs)) {
    let o = base + blobEntries[name].byteOffset;
    for (const x of arr) {
      dv.setFloat32(o, x, true);
      o += 4;
    }
  }
  return buf;
}
