// Fort defenders: perception, simple combat AI, weapon handling, animation.
import { mat4, v3, clamp, angleDiff, yawTo } from './math.js';
import { ENEMY_WEAPONS } from './weapons.js';
import { rayBox, raySphere } from './world.js';
import { MODE_LIT, MODE_EMISSIVE } from './renderer.js';

const HIP = 0.92;
const SHOULDER = 1.42;
const EYE = 1.62;
const MAX_HEALTH = 100;

const ROLE = {
  // move: combat movement style, speed: m/s, turn: rad/s, view: detection range
  breacher: { move: 'charge', speed: 3.6, turn: 6, view: 45, fov: 1.4 },
  sentry: { move: 'strafe', speed: 1.8, turn: 4, view: 70, fov: 1.2 },
  patrol: { move: 'strafe', speed: 2.6, turn: 5, view: 70, fov: 1.3 },
  marksman: { move: 'hold', speed: 0.8, turn: 2.5, view: 75, fov: 1.0 },
};

export class Enemy {
  constructor(def, models) {
    this.def = def;
    this.name = def.name;
    this.weapon = ENEMY_WEAPONS[def.weapon];
    if (!this.weapon) throw new Error(`Unknown enemy weapon "${def.weapon}"`);
    this.role = ROLE[def.role] || ROLE.patrol;
    this.post = [...def.pos];
    this.baseYaw = def.yaw || 0;
    this.yaw = this.baseYaw;
    this.pitch = -0.3;
    this.health = MAX_HEALTH;
    this.state = 'idle';
    this.body = { pos: [...def.pos], vel: [0, 0, 0], radius: 0.35, height: 1.85, gravity: 20, onGround: true };
    this.pos = this.body.pos;
    this.patrolIdx = 0;
    this.patrolWait = 0;
    this.mag = this.weapon.magazine;
    this.burstLeft = 0;
    this.cooldown = 0;
    this.reloadT = 0;
    this.laserT = 0;
    this.reaction = 0;
    this.aimError = 0.15;
    this.sees = false;
    this.awareness = 0; // 0..1 build-up before an idle soldier spots the player
    this.lastSeen = null;
    this.lostTime = 0;
    this.searchTime = 0;
    this.thinkT = Math.random() * 0.2;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 1 + Math.random() * 2;
    this.walkPhase = 0;
    this.recoil = 0;
    this.hitFlash = 0;
    this.deadT = 0;
    this.time = Math.random() * 10;
    this.gunModel = models[this.weapon.model];
    this.muzzleLocal = this.gunModel?.meta?.muzzle || [0, 0, -0.7];
    this.gunAttach = models.soldier_arms?.meta?.gunAttach || [0.04, -0.1, -0.42];
    this.aimDir = [0, 0, -1];
  }

  get alive() {
    return this.state !== 'dead';
  }

  eye() {
    return [this.pos[0], this.pos[1] + EYE, this.pos[2]];
  }

  // Ray test from the player's weapon. Returns { t, head } or null.
  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    const p = this.pos;
    const fwd = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    const head = [p[0] + fwd[0] * 0.02, p[1] + 1.66, p[2] + fwd[2] * 0.02];
    const th = raySphere(o, d, head, 0.17, maxT);
    const hb = rayBox(o, d, [p[0] - 0.3, p[1], p[2] - 0.3], [p[0] + 0.3, p[1] + 1.52, p[2] + 0.3], maxT);
    if (th !== null && (!hb || th <= hb.t + 0.05)) return { t: th, head: true };
    if (hb) return { t: hb.t, head: false };
    return null;
  }

  takeDamage(amount, game, fromPos) {
    if (!this.alive) return false;
    this.health -= amount;
    this.hitFlash = 0.12;
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dead';
      this.deadT = 0;
      this.laserT = 0;
      this.body.vel[0] = this.body.vel[2] = 0;
      return true;
    }
    if (this.state !== 'combat' && this.state !== 'surrender') this.#engage(game, fromPos, 0.25);
    else this.lastSeen = [...fromPos];
    return false;
  }

  // Heard gunfire / radio call: become alert and investigate.
  alert(game, pos, reaction = 0.8) {
    if (!this.alive || this.state === 'combat' || this.state === 'surrender') return;
    this.#engage(game, pos, reaction);
  }

  surrender() {
    if (this.alive) {
      this.state = 'surrender';
      this.laserT = 0;
    }
  }

  #engage(game, pos, reaction) {
    const wasIdle = this.state === 'idle';
    this.state = 'combat';
    this.lastSeen = [...pos];
    this.reaction = reaction + Math.random() * 0.3;
    this.aimError = 0.14;
    if (wasIdle) {
      game.audio.alert(this.eye());
      game.radio(this, pos);
    }
  }

  update(dt, game) {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.state === 'dead') {
      this.deadT += dt;
      this.body.vel[0] = this.body.vel[2] = 0;
      game.world.move(this.body, dt);
      return;
    }
    const player = game.player;
    const target = [player.pos[0], player.pos[1] + 1.2, player.pos[2]];
    const eye = this.eye();
    const toP = v3.sub(target, eye);
    const dist = v3.len(toP);

    // Perception (throttled).
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.12;
      this.sees = false;
      if (player.alive && this.state !== 'surrender') {
        const facing = Math.abs(angleDiff(this.yaw, yawTo(toP[0], toP[2])));
        const inCone = this.state === 'combat' || facing < this.role.fov;
        const inRange = dist < (this.state === 'combat' ? this.role.view * 1.3 : this.role.view);
        if (inCone && inRange) {
          this.sees = game.world.lineOfSight(eye, [player.pos[0], player.pos[1] + player.eyeHeight, player.pos[2]]) ||
            game.world.lineOfSight(eye, target);
        }
        if (this.sees && this.state === 'combat') {
          this.lastSeen = [...player.pos];
          this.lostTime = 0;
        } else if (this.sees) {
          // Spotting takes longer at range; sprinting or jetting players stand out.
          const conspicuous = Math.hypot(player.body.vel[0], player.body.vel[2]) > 6 || player.jetting ? 1.6 : 1;
          this.awareness += 0.12 * clamp(28 / dist, 0.25, 6) * conspicuous;
          if (this.awareness >= 1) {
            this.#engage(game, player.pos, this.weapon.reaction);
            this.lostTime = 0;
          }
        } else if (dist < 6 && this.state === 'idle') {
          // Power armour is loud up close.
          this.#engage(game, player.pos, 0.6);
        }
        if (!this.sees) this.awareness = Math.max(0, this.awareness - 0.12 * 0.15);
      }
    }

    let wish = [0, 0];
    let speed = 0;
    if (this.state === 'idle') {
      [wish, speed] = this.#idle(dt);
      this.pitch += (-0.3 - this.pitch) * Math.min(1, dt * 3);
    } else if (this.state === 'surrender') {
      this.pitch += (-1.1 - this.pitch) * Math.min(1, dt * 3);
    } else {
      [wish, speed] = this.#combat(dt, game, dist, toP);
    }

    // Leash back to post.
    const fromPost = [this.pos[0] - this.post[0], this.pos[2] - this.post[2]];
    const postDist = Math.hypot(fromPost[0], fromPost[1]);
    if (postDist > this.def.leash && this.state !== 'idle') {
      wish = [-fromPost[0] / postDist, -fromPost[1] / postDist];
      speed = Math.max(speed, this.role.speed * 0.8);
    }

    // Don't walk off ledges.
    if (speed > 0) {
      const ahead = [this.pos[0] + wish[0] * 0.7, this.pos[2] + wish[1] * 0.7];
      const support = game.world.supportHeight(ahead[0], ahead[1], 0.2, this.pos[1] + 0.55);
      if (support < this.pos[1] - 0.7) {
        speed = 0;
        this.strafeDir *= -1;
      }
    }
    const k = Math.min(1, dt * 8);
    this.body.vel[0] += (wish[0] * speed - this.body.vel[0]) * k;
    this.body.vel[2] += (wish[1] * speed - this.body.vel[2]) * k;
    this.body.hitWall = false;
    game.world.move(this.body, dt);
    if (this.body.hitWall) this.strafeT = Math.min(this.strafeT, 0.05);
    const hs = Math.hypot(this.body.vel[0], this.body.vel[2]);
    this.walkPhase += hs * dt * 3.2;
    this.moveSpeed = hs;
  }

  #idle(dt) {
    const pts = this.def.patrol;
    if (pts?.length) {
      if (this.patrolWait > 0) {
        this.patrolWait -= dt;
        this.yaw += angleDiff(this.yaw, this.yaw + Math.sin(this.time * 0.8) * 0.5) * dt;
        return [[0, 0], 0];
      }
      const p = pts[this.patrolIdx];
      const dx = p[0] - this.pos[0], dz = p[1] - this.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.6 || (this.body.hitWall && this.stuckT > 2)) {
        this.patrolIdx = (this.patrolIdx + 1) % pts.length;
        this.patrolWait = 1.2 + Math.random() * 1.5;
        this.stuckT = 0;
        return [[0, 0], 0];
      }
      this.stuckT = this.body.hitWall ? (this.stuckT || 0) + dt : 0;
      this.#turnTo(yawTo(dx, dz), dt, 3);
      return [[dx / d, dz / d], 1.7];
    }
    const look = this.baseYaw + Math.sin(this.time * 0.35) * 0.7;
    this.#turnTo(look, dt, 0.8);
    return [[0, 0], 0];
  }

  #combat(dt, game, dist, toP) {
    const w = this.weapon;
    const player = game.player;
    if (this.sees) {
      this.aimError = Math.max(w.aimError, this.aimError - dt * 0.05);
    } else {
      this.lostTime += dt;
      this.aimError = Math.min(0.14, this.aimError + dt * 0.03);
      this.laserT = 0;
    }
    const focus = this.sees ? [player.pos[0], player.pos[1] + 1.2, player.pos[2]] : this.lastSeen ? [this.lastSeen[0], this.lastSeen[1] + 1.2, this.lastSeen[2]] : null;
    if (focus) {
      const e = this.eye();
      const d = v3.sub(focus, e);
      this.#turnTo(yawTo(d[0], d[2]), dt, this.role.turn);
      const tp = Math.atan2(d[1] - 0.2, Math.hypot(d[0], d[2]));
      this.pitch += (tp - this.pitch) * Math.min(1, dt * 8);
    }
    if (this.lostTime > 14) {
      this.state = 'idle';
      this.aimError = 0.15;
      return [[0, 0], 0];
    }

    // Weapon.
    this.cooldown -= dt;
    this.reaction -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = w.magazine;
    } else if (this.sees && this.reaction <= 0 && dist < w.range && player.alive) {
      const facing = Math.abs(angleDiff(this.yaw, yawTo(toP[0], toP[2])));
      if (facing < 0.2) {
        if (w.laser) {
          if (this.cooldown <= 0) {
            if (this.laserT === 0) game.audio.laser(this.eye());
            this.laserT += dt;
            if (this.laserT >= w.laser) {
              this.#fire(game);
              this.laserT = 0;
              this.cooldown = w.interval * (0.85 + Math.random() * 0.3);
            }
          }
        } else if (this.cooldown <= 0) {
          if (this.burstLeft <= 0) this.burstLeft = w.burst;
          this.#fire(game);
          this.burstLeft--;
          this.cooldown = this.burstLeft > 0 ? w.burstInterval : w.interval * (0.8 + Math.random() * 0.4);
        }
      }
    }

    // Movement.
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeDir *= -1;
      this.strafeT = 1.2 + Math.random() * 2;
    }
    const fwd = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
    const side = [fwd[1] * this.strafeDir, -fwd[0] * this.strafeDir];
    const [near, far] = w.preferredRange;
    if (!this.sees && this.lastSeen) {
      // Investigate last known position.
      const dx = this.lastSeen[0] - this.pos[0], dz = this.lastSeen[2] - this.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 1.5 && this.role.move !== 'hold') return [[dx / d, dz / d], this.role.speed * 0.8];
      return [[0, 0], 0];
    }
    if (this.reloadT > 0 && this.role.move !== 'hold') return [side, this.role.speed];
    switch (this.role.move) {
      case 'charge':
        if (dist > far) return [norm2([fwd[0] + side[0] * 0.3, fwd[1] + side[1] * 0.3]), this.role.speed];
        if (dist < near) return [[-fwd[0], -fwd[1]], this.role.speed * 0.6];
        return [side, this.role.speed * 0.5];
      case 'strafe':
        if (dist > far) return [norm2([fwd[0] + side[0], fwd[1] + side[1]]), this.role.speed];
        if (dist < near) return [norm2([-fwd[0] + side[0], -fwd[1] + side[1]]), this.role.speed];
        return [side, this.role.speed];
      default:
        return [side, this.role.speed * (this.laserT > 0 ? 0 : 1)];
    }
  }

  #turnTo(target, dt, rate) {
    const d = angleDiff(this.yaw, target);
    this.yaw += clamp(d, -rate * dt, rate * dt);
  }

  #fire(game) {
    const w = this.weapon;
    const player = game.player;
    if (this.mag <= 0) return;
    this.mag--;
    if (this.mag <= 0) this.reloadT = w.reloadTime;
    this.recoil = 1;
    const origin = this.eye();
    origin[1] -= 0.15;
    const muzzle = this.muzzleWorld();
    const target = [player.pos[0], player.pos[1] + 1.15, player.pos[2]];
    const base = v3.norm(v3.sub(target, origin));
    const moveErr = Math.hypot(player.body.vel[0], player.body.vel[2]) * 0.006;
    const err = this.aimError + moveErr;
    // Aim error is shared by all pellets of one shot; spread is per pellet.
    const aimed = jitter(base, err);
    let totalDamage = 0;
    for (let i = 0; i < w.pellets; i++) {
      const dir = jitter(aimed, w.spread);
      const wall = game.world.raycast(origin, dir, w.range);
      const maxT = wall ? wall.t : w.range;
      const hit = rayBox(origin, dir, [player.pos[0] - 0.45, player.pos[1], player.pos[2] - 0.45], [player.pos[0] + 0.45, player.pos[1] + 2.0, player.pos[2] + 0.45], maxT);
      const endT = hit ? hit.t : maxT;
      const end = v3.madd(origin, dir, endT);
      if (i < 4 || Math.random() < 0.3) game.effects.tracer(muzzle, end, w.tracer, 180);
      if (hit && player.alive) {
        let dmg = w.damage;
        if (w.pellets > 1) dmg *= clamp(1 - (hit.t - 8) / 24, 0.25, 1);
        totalDamage += dmg;
      } else if (wall) {
        game.effects.dust(wall.point, wall.normal, undefined, 2);
      }
    }
    if (totalDamage > 0) game.damagePlayer(totalDamage, this.pos, this);
    game.audio.shot(w.sound, muzzle);
    const mz = this.muzzleLocal;
    game.effects.flash(() => mat4.multiply(this.gunMatrix(), mat4.translation(mz[0], mz[1], mz[2])), [1, 0.75, 0.35], 0.06);
  }

  // ---------------------------------------------------------- transforms

  rootMatrix() {
    const fall = this.state === 'dead' ? Math.min(1, (this.deadT / 0.7) ** 2) * (Math.PI / 2 - 0.12) : 0;
    const m = mat4.chain(mat4.translation(this.pos[0], this.pos[1], this.pos[2]), mat4.rotationY(this.yaw), mat4.rotationX(fall));
    if (fall > 0) m[13] += Math.sin(fall) * 0.12;
    return m;
  }

  armsMatrix(root = this.rootMatrix()) {
    const pitch = this.state === 'dead' ? -0.6 : this.pitch + this.recoil * 0.08;
    return mat4.chain(root, mat4.translation(0, SHOULDER, this.recoil * 0.04), mat4.rotationX(clamp(pitch, -1.2, 1.2)));
  }

  gunMatrix(arms = this.armsMatrix()) {
    const a = this.gunAttach;
    return mat4.multiply(arms, mat4.translation(a[0], a[1], a[2]));
  }

  muzzleWorld() {
    return mat4.transformPoint(this.gunMatrix(), this.muzzleLocal);
  }

  draw(r, game) {
    const root = this.rootMatrix();
    const t = this.def.tint;
    const f = this.hitFlash > 0 ? 3 : 1;
    const tint = [t[0] * f, t[1] * f, t[2] * f, MODE_LIT];
    const swing = Math.sin(this.walkPhase) * 0.6 * Math.min(1, (this.moveSpeed || 0) / 2);
    r.draw('soldier_torso', mat4.multiply(root, mat4.translation(0, HIP, 0)), tint);
    r.draw('soldier_leg', mat4.chain(root, mat4.translation(-0.11, HIP, 0), mat4.rotationX(swing)), tint);
    r.draw('soldier_leg', mat4.chain(root, mat4.translation(0.11, HIP, 0), mat4.rotationX(-swing)), tint);
    const arms = this.armsMatrix(root);
    r.draw('soldier_arms', arms, tint);
    const gun = this.gunMatrix(arms);
    r.draw(this.weapon.model, gun);

    if (this.laserT > 0 && this.alive) {
      // Marksman's aiming laser.
      const from = mat4.transformPoint(gun, this.muzzleLocal);
      const p = game.player;
      const to = [p.pos[0], p.pos[1] + 1.3, p.pos[2]];
      const dir = v3.norm(v3.sub(to, from));
      const hit = game.world.raycast(from, dir, 250);
      const len = hit ? Math.min(hit.t, v3.dist(from, to) + 30) : v3.dist(from, to) + 30;
      const k = 0.5 + 0.5 * Math.min(1, this.laserT / this.weapon.laser);
      const flick = this.laserT > this.weapon.laser * 0.7 ? (Math.sin(this.time * 60) > 0 ? 1.3 : 0.7) : 1;
      r.draw('fx_box', mat4.alignNegZ(from, dir, 0.012, 0.012, len), [1.0 * k * flick, 0.05, 0.05, MODE_EMISSIVE]);
    }
  }
}

function norm2(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

// Random cone deviation (roughly gaussian) around a direction.
function jitter(dir, amount) {
  if (amount <= 0) return dir;
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
  const ref = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const a = v3.norm(v3.cross(dir, ref));
  const b = v3.cross(a, dir);
  return v3.norm(v3.add(dir, v3.add(v3.scale(a, g() * amount), v3.scale(b, g() * amount))));
}
export { jitter };
