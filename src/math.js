// Minimal vector / matrix helpers. Matrices are column-major Float32Array(16),
// projection matrices target WebGPU clip space (depth 0..1).

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  madd: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
// Shortest signed angle from a to b.
export const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
// Yaw convention: yaw 0 looks down -Z, positive yaw turns left (towards -X).
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export const forwardFromYawPitch = (yaw, pitch) => {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
};

// Deterministic PRNG (mulberry32).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  multiply(a, b, out = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  },
  // Multiply a chain of matrices left to right.
  chain(...ms) {
    let r = ms[0];
    for (let i = 1; i < ms.length; i++) r = mat4.multiply(r, ms[i]);
    return r;
  },
  translation(x, y, z) {
    const m = mat4.create();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },
  scaling(x, y = x, z = x) {
    const m = mat4.create();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  },
  rotationX(a) {
    const c = Math.cos(a), s = Math.sin(a), m = mat4.create();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },
  rotationY(a) {
    const c = Math.cos(a), s = Math.sin(a), m = mat4.create();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },
  rotationZ(a) {
    const c = Math.cos(a), s = Math.sin(a), m = mat4.create();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },
  // Translate * RotY * Scale — the common case for placed props.
  trs(pos, rotY = 0, scale = 1) {
    const c = Math.cos(rotY), s = Math.sin(rotY), m = new Float32Array(16);
    const sx = typeof scale === 'number' ? scale : scale[0];
    const sy = typeof scale === 'number' ? scale : scale[1];
    const sz = typeof scale === 'number' ? scale : scale[2];
    m[0] = c * sx; m[2] = -s * sx;
    m[5] = sy;
    m[8] = s * sz; m[10] = c * sz;
    m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
    return m;
  },
  // Basis that maps +Y onto `dir` and places origin at `pos`.
  alignY(pos, dir, scaleXZ = 1, lengthY = 1) {
    const y = v3.norm(dir);
    const ref = Math.abs(y[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    const x = v3.norm(v3.cross(ref, y));
    const z = v3.cross(x, y);
    return new Float32Array([
      x[0] * scaleXZ, x[1] * scaleXZ, x[2] * scaleXZ, 0,
      y[0] * lengthY, y[1] * lengthY, y[2] * lengthY, 0,
      z[0] * scaleXZ, z[1] * scaleXZ, z[2] * scaleXZ, 0,
      pos[0], pos[1], pos[2], 1,
    ]);
  },
  // Basis mapping -Z onto `dir` (the "forward" convention), origin at `pos`.
  alignNegZ(pos, dir, sx = 1, sy = 1, lengthZ = 1) {
    const f = v3.norm(dir);
    const ref = Math.abs(f[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    const x = v3.norm(v3.cross(ref, [-f[0], -f[1], -f[2]]));
    const y = v3.cross([-f[0], -f[1], -f[2]], x);
    return new Float32Array([
      x[0] * sx, x[1] * sx, x[2] * sx, 0,
      y[0] * sy, y[1] * sy, y[2] * sy, 0,
      -f[0] * lengthZ, -f[1] * lengthZ, -f[2] * lengthZ, 0,
      pos[0], pos[1], pos[2], 1,
    ]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = (near * far) / (near - far);
    return m;
  },
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = 1 / (n - f);
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[14] = n / (n - f);
    m[15] = 1;
    return m;
  },
  lookAt(eye, target, up = [0, 1, 0]) {
    const z = v3.norm(v3.sub(eye, target));
    const x = v3.norm(v3.cross(up, z));
    const y = v3.cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1,
    ]);
  },
  invert(m, out = new Float32Array(16)) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return mat4.create();
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
  transformPoint(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
  transformDir(m, d) {
    return [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ];
  },
};
