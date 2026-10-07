// DOM heads-up display (visor overlay).

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'),
      shield: $('shield-fill'),
      shieldVal: $('shield-val'),
      hull: $('hull-fill'),
      hullVal: $('hull-val'),
      jets: $('jets-fill'),
      ammo: $('ammo-mag'),
      reserve: $('ammo-reserve'),
      weapon: $('weapon-name'),
      reload: $('reload'),
      objective: $('objective'),
      hostiles: $('hostiles'),
      prompt: $('prompt'),
      capture: $('capture'),
      captureFill: $('capture-fill'),
      hitmarker: $('hitmarker'),
      crosshair: $('crosshair'),
      dirs: $('damage-dirs'),
      shieldFx: $('shield-fx'),
      hullFx: $('hull-fx'),
      message: $('message'),
      killfeed: $('killfeed'),
      compass: $('compass'),
    };
    this.hitT = 0;
    this.shieldFxT = 0;
    this.hullFxT = 0;
    this.dirs = [];
    this.msgT = 0;
  }

  show(on) {
    this.el.root.classList.toggle('hidden', !on);
  }

  hitMarker(strong) {
    this.hitT = 0.18;
    this.el.hitmarker.classList.toggle('strong', !!strong);
  }

  damage(fromAngle, shielded) {
    if (shielded) this.shieldFxT = 0.35;
    else this.hullFxT = 0.6;
    const el = document.createElement('div');
    el.className = 'dmg-dir' + (shielded ? ' shield' : '');
    this.el.dirs.appendChild(el);
    this.dirs.push({ el, angle: fromAngle, t: 1.2 });
  }

  message(text, seconds = 3) {
    this.el.message.textContent = text;
    this.el.message.classList.add('on');
    this.msgT = seconds;
  }

  feed(text) {
    const el = document.createElement('div');
    el.textContent = text;
    this.el.killfeed.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  update(dt, game) {
    const p = game.player, e = this.el;
    e.shield.style.width = `${(p.shield / p.shieldMax) * 100}%`;
    e.shieldVal.textContent = Math.ceil(p.shield);
    e.hull.style.width = `${(p.hull / p.hullMax) * 100}%`;
    e.hullVal.textContent = Math.ceil(p.hull);
    e.root.classList.toggle('shield-down', p.shield <= 0);
    e.root.classList.toggle('hull-low', p.hull < 35);
    e.jets.style.width = `${p.fuel}%`;
    e.ammo.textContent = p.mag;
    e.reserve.textContent = p.reserve;
    e.ammo.classList.toggle('low', p.mag <= 8);
    e.reload.classList.toggle('on', p.reloadT > 0 || (p.mag === 0 && p.reserve > 0));
    e.reload.textContent = p.reloadT > 0 ? 'RELOADING' : 'PRESS R TO RELOAD';
    if (p.mag === 0 && p.reserve === 0) {
      e.reload.classList.add('on');
      e.reload.textContent = 'NO AMMO';
    }
    const alive = game.enemies.filter((x) => x.alive).length;
    e.hostiles.textContent = `HOSTILES ${alive}/${game.enemies.length}`;
    e.crosshair.style.opacity = 1 - p.aim * 0.85;

    this.hitT -= dt;
    e.hitmarker.style.opacity = this.hitT > 0 ? 1 : 0;
    this.shieldFxT -= dt;
    this.hullFxT -= dt;
    e.shieldFx.style.opacity = Math.max(0, this.shieldFxT / 0.35);
    e.hullFx.style.opacity = Math.max(0, this.hullFxT / 0.6) * 0.9 + (p.hull < 35 ? 0.25 + 0.1 * Math.sin(performance.now() / 200) : 0);

    for (const d of this.dirs) {
      d.t -= dt;
      const rel = d.angle - p.yaw;
      d.el.style.transform = `translate(-50%, -50%) rotate(${-rel}rad) translateY(-140px)`;
      d.el.style.opacity = Math.max(0, Math.min(1, d.t));
      if (d.t <= 0) d.el.remove();
    }
    this.dirs = this.dirs.filter((d) => d.t > 0);

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) e.message.classList.remove('on');
    }

    // Compass heading (yaw 0 = north / -Z).
    const deg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    e.compass.style.backgroundPositionX = `${-deg * 2}px`;
    e.compass.dataset.heading = Math.round(deg);
  }

  setPrompt(text) {
    this.el.prompt.textContent = text || '';
    this.el.prompt.classList.toggle('on', !!text);
  }

  setCapture(progress) {
    const on = progress > 0;
    this.el.capture.classList.toggle('on', on);
    this.el.captureFill.style.width = `${Math.min(1, progress) * 100}%`;
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }
}
