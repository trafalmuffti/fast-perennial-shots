// The player: power armour with a regenerating energy shield over armour
// plating, jump jets, and the PA-9 pulse rifle.
import { mat4, v3, clamp, lerp, forwardFromYawPitch } from './math.js';
import { PLAYER_WEAPON } from './weapons.js';
import { jitter } from './enemies.js';

const WALK = 5.4, SPRINT = 8.4, AIM_SPEED = 3.4;
const JUMP = 7.2, JET_THRUST = 30, JET_DRAIN = 42, JET_REGEN = 28;
const SHIELD_MAX = 100, HULL_MAX = 100, SHIELD_DELAY = 3.2, SHIELD_RATE = 32;
const FOV = (72 * Math.PI) / 180, FOV_AIM = (46 * Math.PI) / 180;

export class Player {
  constructor(spawn, yaw, models) {
    this.body = { pos: [...spawn], vel: [0, 0, 0], radius: 0.45, height: 2.0, gravity: 22, onGround: true };
    this.pos = this.body.pos;
    this.yaw = yaw;
    this.pitch = 0;
    this.eyeHeight = 1.82;
    this.eyeOffset = 0; // smoothed step-up / landing dip
    this.shield = SHIELD_MAX;
    this.hull = HULL_MAX;
    this.shieldMax = SHIELD_MAX;
    this.hullMax = HULL_MAX;
    this.shieldDelay = 0;
    this.shieldWasEmpty = false;
    this.fuel = 100;
    this.fuelDelay = 0;
    this.jetting = false;
    this.alive = true;
    this.weapon = PLAYER_WEAPON;
    this.mag = PLAYER_WEAPON.magazine;
    this.reserve = PLAYER_WEAPON.reserve;
    this.cooldown = 0;
    this.reloadT = 0;
    this.aim = 0;
    this.kick = 0; // viewmodel recoil
    this.bob = 0;
    this.stride = 0;
    this.shake = 0;
    this.sway = [0, 0];
    this.muzzleLocal = models[PLAYER_WEAPON.model]?.meta?.muzzle || [0, 0, -0.75];
    this.stats = { shots: 0, hits: 0, kills: 0, damageTaken: 0, headshots: 0 };
  }

  eye() {
    return [this.pos[0], this.pos[1] + this.eyeHeight + this.eyeOffset, this.pos[2]];
  }

  forward() {
    return forwardFromYawPitch(this.yaw, this.pitch);
  }

  cameraMatrix() {
    const e = this.eye();
    const sh = this.shake;
    return mat4.chain(
      mat4.translation(e[0], e[1], e[2]),
      mat4.rotationY(this.yaw + (Math.random() - 0.5) * sh * 0.02),
      mat4.rotationX(this.pitch + (Math.random() - 0.5) * sh * 0.02),
    );
  }

  camera(aspect) {
    const world = this.cameraMatrix();
    return {
      view: mat4.invert(world),
      proj: mat4.perspective(lerp(FOV, FOV_AIM, this.aim), aspect, 0.05, 700),
      pos: this.eye(),
      world,
    };
  }

  viewmodelMatrix(camWorld) {
    const a = this.aim;
    const reload = this.reloadT > 0 ? Math.sin(Math.PI * (1 - this.reloadT / this.weapon.reloadTime)) : 0;
    const bx = Math.sin(this.bob) * 0.012 * (1 - a * 0.8);
    const by = Math.abs(Math.cos(this.bob)) * 0.012 * (1 - a * 0.8);
    const off = [
      lerp(0.24, 0.0, a) + bx + this.sway[0],
      lerp(-0.25, -0.131, a) - by + this.sway[1] - reload * 0.1,
      lerp(-0.52, -0.4, a) + this.kick * 0.045,
    ];
    return mat4.chain(
      camWorld,
      mat4.translation(off[0], off[1], off[2]),
      mat4.rotationY(lerp(0.04, 0, a)),
      mat4.rotationX(this.kick * 0.08 - reload * 0.6),
      mat4.rotationZ(reload * 0.5),
      mat4.scaling(0.8),
    );
  }

  update(dt, input, game) {
    if (!this.alive) {
      this.body.vel[0] *= 0.9;
      this.body.vel[2] *= 0.9;
      game.world.move(this.body, dt);
      return;
    }
    const controls = game.controlsEnabled;
    // Look.
    if (controls) {
      const sens = input.sensitivity * (1 - this.aim * 0.45);
      this.yaw -= input.mouse.dx * sens;
      this.pitch = clamp(this.pitch - input.mouse.dy * sens, -1.5, 1.5);
      this.sway[0] = clamp(this.sway[0] - input.mouse.dx * 0.00008, -0.02, 0.02);
      this.sway[1] = clamp(this.sway[1] + input.mouse.dy * 0.00008, -0.02, 0.02);
    }
    this.sway[0] *= Math.exp(-dt * 8);
    this.sway[1] *= Math.exp(-dt * 8);

    // Move.
    const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
    const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    let mx = 0, mz = 0;
    if (controls) {
      if (input.down('KeyW')) { mx += f[0]; mz += f[1]; }
      if (input.down('KeyS')) { mx -= f[0]; mz -= f[1]; }
      if (input.down('KeyD')) { mx += r[0]; mz += r[1]; }
      if (input.down('KeyA')) { mx -= r[0]; mz -= r[1]; }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    const aiming = controls && input.mouse.right && this.reloadT <= 0;
    this.aim += ((aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    const sprinting = controls && input.down('ShiftLeft') && !aiming && input.down('KeyW');
    const speed = aiming ? AIM_SPEED : sprinting ? SPRINT : WALK;
    const accel = this.body.onGround ? 14 : 2.5;
    const v = this.body.vel;
    v[0] += (mx * speed - v[0]) * Math.min(1, dt * accel);
    v[2] += (mz * speed - v[2]) * Math.min(1, dt * accel);

    // Jump + jump jets.
    this.jetting = false;
    if (controls && input.wasPressed('Space') && this.body.onGround) {
      v[1] = JUMP;
      this.body.onGround = false;
      game.audio.footstep(0.7);
    } else if (controls && input.down('Space') && !this.body.onGround && this.fuel > 0 && v[1] < 5.5) {
      v[1] += JET_THRUST * dt;
      this.fuel = Math.max(0, this.fuel - JET_DRAIN * dt);
      this.fuelDelay = 0.8;
      this.jetting = true;
    }
    if (this.body.onGround) {
      this.fuelDelay -= dt;
      if (this.fuelDelay <= 0) this.fuel = Math.min(100, this.fuel + JET_REGEN * dt);
    }
    game.audio.jets(this.jetting);

    this.body.landSpeed = 0;
    this.body.stepUp = 0;
    game.world.move(this.body, dt);
    if (this.body.landSpeed > 6) {
      this.eyeOffset -= Math.min(0.35, this.body.landSpeed * 0.03);
      this.shake = Math.min(1, this.body.landSpeed * 0.06);
      game.audio.footstep(1.4);
    }
    if (this.body.stepUp > 0) this.eyeOffset -= this.body.stepUp;
    this.eyeOffset *= Math.exp(-dt * 10);
    this.shake *= Math.exp(-dt * 6);

    // Footsteps + head bob.
    const hs = Math.hypot(v[0], v[2]);
    if (this.body.onGround && hs > 0.5) {
      this.bob += hs * dt * 1.25;
      this.stride += hs * dt;
      if (this.stride > (sprinting ? 2.6 : 2.1)) {
        this.stride = 0;
        game.audio.footstep(sprinting ? 1 : 0.8);
      }
    }

    // Shield regeneration.
    this.shieldDelay -= dt;
    if (this.shieldDelay <= 0 && this.shield < SHIELD_MAX) {
      if (this.shieldWasEmpty) {
        game.audio.shieldRecharge();
        this.shieldWasEmpty = false;
      }
      this.shield = Math.min(SHIELD_MAX, this.shield + SHIELD_RATE * dt);
    }

    this.#weapon(dt, input, game, controls, hs);
  }

  #weapon(dt, input, game, controls, moveSpeed) {
    const w = this.weapon;
    this.cooldown -= dt;
    this.kick *= Math.exp(-dt * 14);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const take = Math.min(w.magazine - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
      }
      return;
    }
    const wantReload = controls && input.wasPressed('KeyR') && this.mag < w.magazine && this.reserve > 0;
    if (wantReload || (this.mag === 0 && this.reserve > 0 && controls && input.mouse.left)) {
      this.reloadT = w.reloadTime;
      game.audio.reload();
      return;
    }
    if (!controls || !input.mouse.left || this.cooldown > 0 || this.mag <= 0) return;

    this.cooldown = w.interval;
    this.mag--;
    this.stats.shots++;
    const eye = this.eye();
    const spread = lerp(w.spreadHip, w.spreadAim, this.aim) + Math.min(1, moveSpeed / 8) * w.spreadMove * (1 - this.aim * 0.6);
    const dir = jitter(this.forward(), spread);
    const hit = game.hitScan(eye, dir, w.range);
    const cam = this.cameraMatrix();
    const vm = this.viewmodelMatrix(cam);
    const muzzle = mat4.transformPoint(vm, this.muzzleLocal);
    const end = hit ? hit.point : v3.madd(eye, dir, w.range);
    game.effects.tracer(muzzle, end, w.tracer, 320);
    const mz = this.muzzleLocal;
    game.effects.flash(() => mat4.multiply(this.viewmodelMatrix(this.cameraMatrix()), mat4.translation(mz[0], mz[1], mz[2])), [0.5, 0.95, 1.0], 0.05, true);
    game.audio.shot(w.sound);
    game.noise(eye, 60);

    if (hit?.enemy) {
      this.stats.hits++;
      const dmg = w.damage * (hit.head ? w.headMultiplier : 1);
      if (hit.head) this.stats.headshots++;
      const killed = hit.enemy.takeDamage(dmg, game, this.pos);
      game.effects.sparks(hit.point, v3.scale(dir, -1), [1, 0.35, 0.2], 5);
      game.hud.hitMarker(killed || hit.head);
      game.audio.hitMarker(killed);
      if (killed) game.onEnemyKilled(hit.enemy);
    } else if (hit) {
      game.effects.sparks(hit.point, hit.normal, [0.6, 0.95, 1.0], 5);
      game.effects.dust(hit.point, hit.normal, undefined, 3);
      game.audio.impact(hit.point);
    }
    this.kick = Math.min(1.5, this.kick + 1);
    this.pitch = clamp(this.pitch + w.recoil * (0.7 + Math.random() * 0.6) * (1 - this.aim * 0.5), -1.5, 1.5);
    this.yaw += (Math.random() - 0.5) * w.recoil * 0.6;
  }

  // Returns true if the player died.
  takeDamage(amount) {
    if (!this.alive) return false;
    this.stats.damageTaken += Math.min(amount, this.shield + this.hull);
    this.shieldDelay = SHIELD_DELAY;
    let toHull = amount;
    const hadShield = this.shield > 0;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      toHull = amount - absorbed;
    }
    if (hadShield && this.shield <= 0) this.shieldWasEmpty = true;
    this.hull = Math.max(0, this.hull - toHull);
    this.shake = Math.min(1, this.shake + amount * 0.03);
    if (this.hull <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  addAmmo(n) {
    const room = this.weapon.reserve * 1.5 - this.reserve;
    if (room <= 0) return false;
    this.reserve += Math.min(room, n);
    return true;
  }
}
