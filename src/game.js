// One play session of a level: owns the player, enemies, pickups, effects and
// the flag objective, and drives the end-of-level sequence.
import { mat4, v3, yawTo, smoothstep, rng } from './math.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { Effects } from './effects.js';
import { MODE_WAVE, MODE_GRASS, WHITE_LIT } from './renderer.js';

export class Game {
  // assets: { level, pack, world? } — world can be reused between restarts.
  constructor({ level, pack, world }, renderer, audio, hud, callbacks) {
    this.level = level;
    this.pack = pack;
    this.renderer = renderer;
    this.audio = audio;
    this.hud = hud;
    this.cb = callbacks; // { onComplete(stats), onDeath(stats) }
    this.world = world || new World(level, pack);
    this.player = new Player(level.player.spawn, level.player.yaw, pack.models);
    this.enemies = level.enemies.map((d) => new Enemy(d, pack.models));
    this.effects = new Effects();
    this.pickups = (level.pickups || []).map((p) => ({ ...p, taken: false }));
    this.time = 0;
    this.state = 'playing'; // playing | lowering | ending | dead | done
    this.stateT = 0;
    const f = level.flag;
    this.flag = {
      ...f,
      top: f.poleHeight - 1.65,
      bottom: 0.9,
      y: f.poleHeight - 1.65,
      progress: 0,
    };
    this.controlsEnabled = true;
    this.fade = 0;
    // Static scenery matrices are built once.
    this.statics = level.instances.map((i) => ({ model: i.model, m: mat4.trs(i.pos, i.rot || 0, i.scale || 1) }));
    // ?scatter=0.5 halves grass/bush density (0 disables) for weaker GPUs.
    const density = Number(new URLSearchParams(location.search).get('scatter') ?? 1);
    if (density > 0) this.statics.push(...scatterDecor(level, this.world, pack.models, density));
    hud.setObjective('OBJECTIVE: Capture the fort\'s flag');
    hud.message(level.name.toUpperCase(), 3.5);
  }

  // ------------------------------------------------------------ events

  radio(caller, pos) {
    for (const e of this.enemies) {
      if (e !== caller && e.alive && v3.dist(e.pos, caller.pos) < 40) {
        setTimeout(() => this.state === 'playing' && e.alert(this, pos, 0.6), 600 + Math.random() * 900);
      }
    }
  }

  noise(pos, radius) {
    for (const e of this.enemies) {
      if (e.alive && v3.dist(e.pos, pos) < radius) e.alert(this, this.player.pos, 0.9);
    }
  }

  damagePlayer(amount, fromPos) {
    if (this.state !== 'playing') return;
    const p = this.player;
    const shielded = p.shield > 0;
    const died = p.takeDamage(amount);
    if (shielded) {
      if (p.shield <= 0) this.audio.shieldBreak();
      else this.audio.shieldHit();
    } else this.audio.hullHit();
    this.hud.damage(yawTo(fromPos[0] - p.pos[0], fromPos[2] - p.pos[2]), shielded);
    if (died) {
      this.state = 'dead';
      this.stateT = 0;
      this.controlsEnabled = false;
      this.hud.message('ARMOUR BREACHED', 4);
    }
  }

  onEnemyKilled(enemy) {
    this.player.stats.kills++;
    this.hud.feed(`${enemy.name} neutralised — ${enemy.weapon.name}`);
    if (this.enemies.every((e) => !e.alive)) this.hud.message('ALL DEFENDERS DOWN — TAKE THE FLAG', 4);
  }

  // Player weapon ray: nearest of world geometry and enemies.
  hitScan(o, d, range) {
    const wall = this.world.raycast(o, d, range);
    let best = wall ? { t: wall.t, point: wall.point, normal: wall.normal } : null;
    for (const e of this.enemies) {
      const h = e.hitTest(o, d, best ? best.t : range);
      if (h && (!best || h.t < best.t)) best = { t: h.t, point: v3.madd(o, d, h.t), enemy: e, head: h.head };
    }
    return best;
  }

  // ------------------------------------------------------------ update

  update(dt, input) {
    this.time += dt;
    this.stateT += dt;
    this.renderer.time = this.time;
    const p = this.player;
    p.update(dt, input, this);
    for (const e of this.enemies) e.update(dt, this);
    this.effects.update(dt);
    this.audio.setListener(p.eye(), p.yaw);

    // Pickups.
    for (const k of this.pickups) {
      if (k.taken) continue;
      if (Math.hypot(k.pos[0] - p.pos[0], k.pos[2] - p.pos[2]) < 1.5 && Math.abs(k.pos[1] - p.pos[1]) < 2 && k.type === 'ammo') {
        if (p.addAmmo(k.amount)) {
          k.taken = true;
          this.audio.pickup();
          this.hud.feed(`+${k.amount} pulse rounds`);
        }
      }
    }

    this.#updateFlag(dt, input);

    if (this.state === 'dead' && this.stateT > 2.5 && !this.reported) {
      this.reported = true;
      this.cb.onDeath(this.summary());
    }
    this.hud.update(dt, this);
  }

  #updateFlag(dt, input) {
    const f = this.flag, p = this.player;
    if (this.state === 'playing') {
      const dx = p.pos[0] - f.pole[0], dz = p.pos[2] - f.pole[2];
      const inZone = Math.hypot(dx, dz) < f.captureRadius && Math.abs(p.pos[1] - f.pole[1]) < 2.5 && p.alive;
      const holding = inZone && this.controlsEnabled && input.down('KeyE');
      if (holding) {
        const before = Math.floor(f.progress * 10);
        f.progress += dt / f.captureTime;
        if (Math.floor(f.progress * 10) !== before) this.audio.captureTick();
      } else {
        f.progress = Math.max(0, f.progress - dt / f.captureTime * 1.5);
      }
      this.hud.setPrompt(inZone ? (holding ? 'CAPTURING…' : 'HOLD [E] TO CAPTURE THE FLAG') : '');
      this.hud.setCapture(f.progress);
      if (f.progress >= 1) {
        this.state = 'lowering';
        this.stateT = 0;
        this.hud.setPrompt('');
        this.hud.setCapture(0);
        this.hud.message('FLAG CAPTURED', 5);
        this.hud.setObjective('OBJECTIVE COMPLETE');
        this.audio.fanfare();
        for (const e of this.enemies) e.surrender();
        this.captureTime = this.time;
      }
    } else if (this.state === 'lowering') {
      const t = Math.min(1, this.stateT / f.lowerTime);
      f.y = f.top + (f.bottom - f.top) * smoothstep(t);
      if (t >= 1 && this.stateT > f.lowerTime + 0.8) {
        this.state = 'ending';
        this.stateT = 0;
        this.controlsEnabled = false;
      }
    } else if (this.state === 'ending') {
      this.fade = Math.min(1, this.stateT / 2.5);
      if (this.fade >= 1 && !this.reported) {
        this.reported = true;
        this.state = 'done';
        this.cb.onComplete(this.summary());
      }
    }
  }

  summary() {
    const s = this.player.stats;
    return {
      time: this.captureTime ?? this.time,
      kills: s.kills,
      enemies: this.enemies.length,
      accuracy: s.shots ? Math.round((s.hits / s.shots) * 100) : 0,
      headshots: s.headshots,
      damageTaken: Math.round(s.damageTaken),
    };
  }

  // ------------------------------------------------------------ render

  render() {
    const r = this.renderer;
    const aspect = r.resize();
    const cam = this.player.camera(aspect);
    for (const s of this.statics) r.draw(s.model, s.m, s.tint);

    // Flag cloth (wave mode) at its current height on the pole.
    const f = this.flag;
    r.draw(f.clothModel, mat4.translation(f.pole[0] + 0.1, f.pole[1] + f.y, f.pole[2]), [1, 1, 1, MODE_WAVE]);

    for (const k of this.pickups) {
      if (k.taken) continue;
      const bob = Math.sin(this.time * 2 + k.pos[0]) * 0.08;
      r.draw('ammo_box', mat4.trs([k.pos[0], k.pos[1] + 0.1 + bob, k.pos[2]], this.time * 0.8), WHITE_LIT);
    }
    for (const e of this.enemies) e.draw(r, this);
    this.effects.draw(r);

    if (this.player.alive) r.draw(this.player.weapon.model, this.player.viewmodelMatrix(cam.world), WHITE_LIT, true);

    let flash = [0, 0, 0, 0];
    if (this.state === 'ending' || this.state === 'done') flash = [0, 0, 0, this.fade];
    else if (this.state === 'dead') flash = [0.25, 0.0, 0.0, Math.min(0.85, this.stateT / 2.5)];
    r.render(cam, flash);
  }
}

// Decorative clutter (grass, bushes) placed deterministically at load time
// from the level's `scatter` rules, so the level file stays small.
function scatterDecor(level, world, models, density = 1) {
  const out = [];
  for (const rule of level.scatter || []) {
    const rand = rng(rule.seed || 1);
    const grass = [1, 1, 1, MODE_GRASS];
    let placed = 0, guard = 0;
    const count = Math.round(rule.count * density);
    while (placed < count && guard++ < count * 4) {
      const x = (rand() * 2 - 1) * rule.radius, z = (rand() * 2 - 1) * rule.radius;
      const r = Math.hypot(x, z);
      if (r > rule.radius || r < (rule.minRadius || 0)) continue;
      if ((rule.exclude || []).some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
      const n = world.terrain.normal(x, z);
      if (n[1] < 0.8) continue; // not on cliffs
      const model = rule.models[Math.floor(rand() * rule.models.length)];
      const [s0, s1] = rule.scale || [1, 1];
      const y = world.terrain.sample(x, z) - (rule.sink || 0);
      const tint = model.startsWith('grass') ? grass : WHITE_LIT;
      out.push({ model, m: mat4.trs([x, y, z], rand() * Math.PI * 2, s0 + rand() * (s1 - s0)), tint });
      placed++;
    }
  }
  return out;
}
