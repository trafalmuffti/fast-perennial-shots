// Short-lived visual effects: tracers, muzzle flashes, impact sparks, lasers.
import { mat4, v3 } from './math.js';
import { MODE_EMISSIVE } from './renderer.js';

export class Effects {
  constructor() {
    this.items = [];
  }

  tracer(from, to, color, speed = 260) {
    const d = v3.sub(to, from);
    const len = v3.len(d);
    if (len < 0.5) return;
    this.items.push({ kind: 'tracer', from, dir: v3.scale(d, 1 / len), len, t: 0, speed, color });
  }

  flash(matrixFn, color = [1, 0.8, 0.4], life = 0.05, view = false) {
    this.items.push({ kind: 'flash', matrixFn, color, t: 0, life, view, rot: Math.random() * Math.PI });
  }

  sparks(pos, normal, color = [1, 0.75, 0.35], n = 6) {
    for (let i = 0; i < n; i++) {
      const v = v3.add(v3.scale(normal, 2 + Math.random() * 3), [(Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4]);
      this.items.push({ kind: 'spark', pos: [...pos], vel: v, t: 0, life: 0.25 + Math.random() * 0.25, color });
    }
  }

  dust(pos, normal, color = [0.55, 0.48, 0.38], n = 5) {
    for (let i = 0; i < n; i++) {
      const v = v3.add(v3.scale(normal, 1 + Math.random() * 2), [(Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2]);
      this.items.push({ kind: 'dust', pos: [...pos], vel: v, t: 0, life: 0.4 + Math.random() * 0.4, color });
    }
  }

  update(dt) {
    for (const e of this.items) {
      e.t += dt;
      if (e.vel) {
        e.vel[1] -= (e.kind === 'dust' ? 3 : 14) * dt;
        e.pos[0] += e.vel[0] * dt;
        e.pos[1] += e.vel[1] * dt;
        e.pos[2] += e.vel[2] * dt;
      }
    }
    this.items = this.items.filter((e) => (e.kind === 'tracer' ? e.t * e.speed < e.len + 6 : e.t < e.life));
  }

  draw(r) {
    for (const e of this.items) {
      if (e.kind === 'tracer') {
        const head = Math.min(e.t * e.speed, e.len);
        const tail = Math.max(0, head - 5);
        const p = v3.madd(e.from, e.dir, head);
        r.draw('fx_box', mat4.alignNegZ(p, v3.scale(e.dir, -1), 0.025, 0.025, head - tail), tint(e.color));
      } else if (e.kind === 'flash') {
        const k = 1 - e.t / e.life;
        const m = mat4.chain(e.matrixFn(), mat4.rotationZ(e.rot), mat4.scaling(0.6 + k * 0.6));
        r.draw('fx_flash', m, tint(e.color), e.view);
      } else {
        const k = 1 - e.t / e.life;
        const s = e.kind === 'dust' ? 0.12 * (1 + e.t * 2) : 0.04 * k + 0.01;
        const col = e.kind === 'dust' ? [e.color[0], e.color[1], e.color[2], 0] : [e.color[0] * k, e.color[1] * k, e.color[2] * k, MODE_EMISSIVE];
        r.draw('fx_spark', mat4.chain(mat4.translation(e.pos[0], e.pos[1], e.pos[2]), mat4.scaling(s)), col);
      }
    }
  }
}

const tint = (c) => [c[0], c[1], c[2], MODE_EMISSIVE];
