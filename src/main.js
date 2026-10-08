import { Renderer } from './renderer.js';
import { parseModelPack } from './modelpack.js';
import { loadManifest, loadLevelFiles } from './loader.js';
import { World } from './world.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const screens = ['loading', 'start', 'pause', 'end', 'death'];
const showScreen = (name) => screens.forEach((s) => $(s).classList.toggle('hidden', s !== name));

const mb = (b) => (b / (1024 * 1024)).toFixed(2);

function setProgress(loaded, total, path) {
  const pct = total ? Math.min(100, (loaded / total) * 100) : 0;
  $('load-bar').style.width = `${pct}%`;
  $('load-text').textContent = `Downloaded ${mb(loaded)} MB of ${mb(total)} MB (${pct.toFixed(0)}%)`;
  if (path) $('load-file').textContent = path;
}

function fatal(msg) {
  showScreen('loading');
  $('load-error').textContent = msg;
  $('load-error').classList.remove('hidden');
}

async function boot() {
  showScreen('loading');
  if (!navigator.gpu) {
    fatal('This game needs WebGPU. Use a current Chrome, Edge, or another browser with WebGPU enabled.');
    return;
  }
  const manifest = await loadManifest();
  const wanted = new URLSearchParams(location.search).get('level');
  let index = Math.max(0, manifest.levels.findIndex((l) => l.id === wanted));
  const rendererP = Renderer.create(canvas);
  rendererP.catch(() => {});

  const assets = await loadLevel(manifest.levels[index]);
  const renderer = await rendererP;
  const input = new Input(canvas);
  const audio = new Audio();
  const hud = new Hud();
  renderer.loadModelPack(assets.pack);
  renderer.setEnvironment(assets.level.environment);
  const t = assets.level.terrain;
  renderer.setTerrain(assets.pack.blobs[t.blob], t.res, t.size);

  let game = null;
  let running = false; // game simulation active (pointer locked)
  let ended = false;

  const newGame = () => {
    game = new Game(assets, renderer, audio, hud, {
      onComplete(stats) {
        ended = true;
        input.unlock();
        hud.show(false);
        fillStats('end-stats', stats);
        const next = manifest.levels[index + 1];
        $('btn-next').classList.toggle('hidden', !next);
        $('end-next-note').classList.toggle('hidden', !!next);
        showScreen('end');
      },
      onDeath(stats) {
        ended = true;
        input.unlock();
        hud.show(false);
        fillStats('death-stats', stats);
        showScreen('death');
      },
    });
    window.__game = game; // handy for debugging in the console
    window.__input = input;
    ended = false;
  };
  newGame();

  $('level-name').textContent = assets.level.name;
  $('briefing').textContent = assets.level.briefing;
  showScreen('start');

  const deploy = () => {
    audio.unlock();
    input.lock();
  };
  $('btn-deploy').addEventListener('click', deploy);
  $('pause').addEventListener('click', deploy);
  $('btn-retry').addEventListener('click', () => { newGame(); deploy(); });
  $('btn-replay').addEventListener('click', () => { newGame(); deploy(); });
  $('btn-next').addEventListener('click', () => {
    const next = manifest.levels[index + 1];
    if (next) location.search = `?level=${encodeURIComponent(next.id)}`;
  });

  input.onLockChange = (locked) => {
    if (locked) {
      running = true;
      hud.show(true);
      showScreen(null);
    } else {
      running = false;
      if (!ended) {
        hud.show(false);
        showScreen('pause');
      }
    }
  };

  // Lightweight benchmark hook: ?autoplay runs the simulation without pointer lock.
  if (new URLSearchParams(location.search).has('autoplay')) {
    running = true;
    hud.show(true);
    showScreen(null);
  }

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running && game.state !== 'done') game.update(dt, input);
    game.render();
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  async function loadLevel(entry) {
    setProgress(0, entry.files.reduce((s, f) => s + f.bytes, 0), '');
    const files = await loadLevelFiles(entry, setProgress);
    const level = JSON.parse(new TextDecoder().decode(files['level.json']));
    const pack = parseModelPack(files[level.models]);
    $('load-file').textContent = 'Building level…';
    const world = new World(level, pack);
    return { level, pack, world };
  }
}

function fillStats(id, s) {
  const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60).toString().padStart(2, '0');
  $(id).innerHTML = `
    <div><span>Time</span><b>${mins}:${secs}</b></div>
    <div><span>Defenders neutralised</span><b>${s.kills} / ${s.enemies}</b></div>
    <div><span>Accuracy</span><b>${s.accuracy}%</b></div>
    <div><span>Headshots</span><b>${s.headshots}</b></div>
    <div><span>Damage absorbed</span><b>${s.damageTaken}</b></div>`;
}

boot().catch((e) => {
  console.error(e);
  fatal(e.message || String(e));
});
