# Hill Fort — a WebGPU power‑armour FPS demo

A single‑level first‑person shooter for the browser, written against raw
**WebGPU** with no engine or third‑party runtime dependencies. You play a
soldier in power armour with a regenerating energy shield. Your objective is to
capture the flag of a wooden hill fort held by four defenders, each carrying a
different weapon.

The whole game ships at about **1.4 MB** against a 100 MB budget (`npm run check-size`).

## Running

```bash
npm run build    # regenerate levels/*/models.bin + level.json (only needed after editing tools/)
npm run serve    # static server on http://localhost:8080
```

Any static file server works (`python3 -m http.server`, nginx, GitHub Pages…).
The page has to be served over `http://localhost` or HTTPS, because WebGPU
needs a secure context. Use a browser with WebGPU enabled, such as current
Chrome or Edge, or Safari/Firefox with WebGPU turned on.

### Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Left click / right click | Fire / aim down sights |
| Shift | Sprint |
| Space | Jump; hold it in the air to fire the jump jets |
| R | Reload |
| E (hold) | Capture the flag while standing at the pole |
| Esc | Pause |

## The level

* **Approach**: a forested hill with a dirt road that climbs to the fort gate,
  with sandbags and crates along the way for cover.
* **The fort**: a 44 × 44 m log palisade with a gatehouse fighting platform,
  a corner watchtower, a two‑room **barracks**, a two‑room **HQ hut**, an open
  storage shed, and crates and barrels across the courtyard. Stairs lead up to
  the gatehouse and the tower.
* **The defenders** (each has a unique gun):

  | Soldier | Weapon | Behaviour |
  | --- | --- | --- |
  | Sgt. Vosk | Breaching **shotgun** (8 pellets, falls off with range) | Guards the barracks and charges into close quarters |
  | Cpl. Hale | **Bullpup rifle** (3‑round bursts) | Sentry on the gatehouse platform |
  | Pvt. Marr | **Assault carbine** (long automatic bursts) | Patrols the courtyard and strafes when engaged |
  | Lt. Okafor | **Marksman rifle** (heavy single shots) | Watchtower sniper. A red laser warns you before each shot |

  Soldiers take longer to spot you at range, react to gunfire, and radio
  nearby allies. They stay leashed to their posts and won't walk off ledges.
* **Win**: stand at the flagpole and hold **E**. When the capture completes,
  the remaining defenders stand down, the flag descends the pole, and the
  screen fades to black before the *Mission complete* summary appears.
* **Lose**: your shield absorbs damage and recharges after 3 s without taking
  hits, but armour does not regenerate. If your armour reaches zero, you can retry.

## Project layout

```
index.html              UI shell: loading screen, briefing, HUD, end screens
src/
  main.js               boot, loading (byte progress), screens, main loop
  loader.js             streamed fetch with downloaded-bytes reporting
  modelpack.js          binary model pack format (shared with the build tools)
  renderer.js           WebGPU renderer: sky, shadow map, lit/emissive meshes, viewmodel pass
  world.js              colliders, terrain heightfield, ray casts, character movement
  game.js               one play session: objective, flag capture, end sequence
  player.js             power armour: shield/armour, jump jets, pulse rifle
  enemies.js            defender AI, perception, weapons, animation
  weapons.js            player + enemy weapon definitions
  effects.js audio.js hud.js input.js terrain.js math.js
levels/
  manifest.json         ordered level list with byte sizes (drives the loading bar)
  hillfort/level.json   layout: instances, enemies, flag, pickups, lighting
  hillfort/models.bin   every mesh the level uses + terrain heightfield
tools/
  build-levels.mjs      generates levels/* from the level scripts
  levels/hillfort.mjs   level 1 definition (terrain, layout, enemies)
  lib/mesh.mjs          mesh builder + model pack writer
  lib/props.mjs         reusable procedural models (soldiers, guns, buildings, props)
  serve.mjs             zero-dependency static server
  check-size.mjs        enforces the 100 MB download budget
```

### Asset format

Each level's models live in their own `models.bin`, separate from the code and
the layout. The file starts with a JSON header that lists each model's
index range, bounds, collision boxes, and metadata such as muzzle points.
Packed vertex data follows (20 bytes per vertex: position, snorm8 normal,
unorm8 colour with a "tintable" flag in alpha), then 32‑bit indices and the
terrain heightfield. The loader streams `level.json` and `models.bin` and shows
*Downloaded X MB of Y MB*.

## Extending to more levels

The engine is level‑agnostic. To add a level:

1. Create `tools/levels/<id>.mjs` that exports `id` and `build()`, returning
   `{ models, blobs, level }`. Use `hillfort.mjs` as a template; the props in
   `tools/lib/props.mjs` can be reused.
2. Add the module to `LEVELS` in `tools/build-levels.mjs` (order = play order).
3. Run `npm run build`. The manifest gets the new entry, the end screen shows
   **Next level**, and `?level=<id>` opens a level directly.

New enemy weapons go in `ENEMY_WEAPONS` (`src/weapons.js`). Levels choose an
enemy's weapon, role (`breacher`, `sentry`, `patrol`, `marksman`), uniform tint,
post, leash radius, and optional patrol route in `level.json`.
