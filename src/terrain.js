// Heightfield sampling shared by the runtime and the level build tools so that
// props placed at build time sit exactly on the surface the player walks on.

export class Heightfield {
  // heights: Float32Array(res*res), row-major with z as the row index.
  constructor(heights, res, size) {
    this.h = heights;
    this.res = res;
    this.size = size;
    this.half = size / 2;
    this.cell = size / (res - 1);
  }

  at(ix, iz) {
    const r = this.res;
    ix = ix < 0 ? 0 : ix >= r ? r - 1 : ix;
    iz = iz < 0 ? 0 : iz >= r ? r - 1 : iz;
    return this.h[iz * r + ix];
  }

  // Bilinear height at world (x, z).
  sample(x, z) {
    const fx = (x + this.half) / this.cell;
    const fz = (z + this.half) / this.cell;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h00 = this.at(ix, iz), h10 = this.at(ix + 1, iz);
    const h01 = this.at(ix, iz + 1), h11 = this.at(ix + 1, iz + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  normal(x, z) {
    const e = 0.5;
    const dx = this.sample(x + e, z) - this.sample(x - e, z);
    const dz = this.sample(x, z + e) - this.sample(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    return [-dx / l, (2 * e) / l, -dz / l];
  }
}
