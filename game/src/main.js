// Brisava: Harbor Run — boot and the one loop. The world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one, a capped accumulator so a stalled tab never
// fast-forwards), input is read every frame, and the renderer paints what is there. This
// module owns the mode machine (menu, play, pause, map, shop, busted/wasted, failed,
// complete), the death/respawn rules, and the wiring between the systems.

import { PLACES, buildWorld, createRng, pointBlocked } from './world.js';
import { createAudio } from './audio.js';
import { createPlayer, enterVehicle, exitVehicle, interactHint, tryInteract, updateCamera, updatePlayerDriving, updatePlayerOnFoot, updateShop, checkPlayerRoadkill } from './player.js';
import { spawnVehicle, collideVehicles } from './vehicles.js';
import { initTraffic, updateTraffic } from './traffic.js';
import { initPeds, updatePeds } from './pedestrians.js';
import { createPoliceState, reportCrime, updatePolice } from './police.js';
import { updateBullets, updateGuards, updatePlayerWeapons } from './combat.js';
import { createMissionsApi } from './missions.js';
import { applySave, clearSave, hasSave, readSave, saveGame } from './save.js';
import { drawWorld } from './render.js';
import { createRenderer3D } from './render3d.js';
import * as HUD from './hud.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// The 3D view renders the world on the WebGL canvas under the HUD overlay. If WebGL is
// unavailable the game quietly keeps the original 2D renderer — same simulation either way.
// It is created after buildWorld() below, because it builds its static city from the
// world's building data; the declaration lives here so resize() can already see it.
let renderer3d = null;

window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push(String(e.message || e.error));
  if (statusEl) statusEl.textContent = 'Error: ' + String(e.message || e.error);
});

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (renderer3d) renderer3d.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

/* ---------- input ---------- */

const input = {
  keys: new Set(), pressed: new Set(),
  mouse: { x: 0, y: 0, down: false, clicked: false },
};
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) input.pressed.add(e.code);
  input.keys.add(e.code);
  G.audio.unlock();
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.pressed.clear(); input.mouse.down = false; });
// Mouse input is heard on the window, not one canvas: after the WebGL/HUD canvas split
// no stacking or overlay quirk can swallow a press before it reaches the game.
window.addEventListener('mousemove', (e) => { input.mouse.x = e.clientX; input.mouse.y = e.clientY; });
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  input.mouse.x = e.clientX;
  input.mouse.y = e.clientY;
  input.mouse.down = true;
  input.mouse.clicked = true;
  G.audio.unlock();
});
window.addEventListener('mouseup', () => { input.mouse.down = false; });

/* ---------- game state ---------- */

buildWorld();

try {
  renderer3d = createRenderer3D(document.getElementById('gl'));
  renderer3d.resize(window.innerWidth, window.innerHeight);
} catch (err) {
  renderer3d = null;
  console.warn('brisava: WebGL unavailable, using the 2D renderer.', err);
}

const G = {
  time: 0,
  rng: createRng(Number.isInteger(seedParam) ? seedParam * 7919 + 11 : 987654321),
  mode: 'menu',
  menuFrom: 'menu',
  camera: { x: PLACES.garage.x - 640, y: PLACES.garage.y - 360, w: canvas.width, h: canvas.height },
  player: createPlayer(PLACES.playerStart.x, PLACES.playerStart.y),
  vehicles: [], peds: [], guards: [], officers: [], bullets: [],
  policeState: createPoliceState(),
  upgrades: { turbo: false },
  audio: createAudio(),
  buttons: [],
  input,
  toast: '', toastAt: -99,
  hintText: '',
  frameDt: 1 / 30,
  aimWorld: null,
  viewMode: null,
  shopOpen: false,
  missionFailed: null,
  deathPenalty: 0,
  sideJobsDone: 0,
  storyCompleteAt: 0,
  completeShown: false,
  deathAt: 0,
  worldPointBlocked: pointBlocked,
};
G.missionsApi = createMissionsApi(G);
G.policeReport = (kind, at) => reportCrime(G, kind, at);
G.saveGame = (reason) => saveGame(G, reason);
window.__brisava = G; // a handle for automated play-tests and the screenshot harness

/** A fresh city population: ambient traffic, walkers, and a scatter of parked cars. */
function populate() {
  G.vehicles.length = 0; G.peds.length = 0; G.guards.length = 0; G.officers.length = 0; G.bullets.length = 0;
  initTraffic(G);
  initPeds(G);
  const parked = [
    ['sedan', 1200, 1900, 0.4], ['van', 2000, 1900, 0], ['sedan', 2900, 2000, -0.3],
    ['coupe', 2700, 905, 0], ['sedan', 505, 2210, 0], ['van', 640, 1450, Math.PI],
    ['sedan', 1750, 330, Math.PI / 2], ['coupe', 3350, 1500, -Math.PI / 2],
  ];
  for (const [cls, x, y, a] of parked) spawnVehicle(G, cls, x, y, a, 'parked');
}

function resetRun() {
  G.player = createPlayer(PLACES.playerStart.x, PLACES.playerStart.y);
  G.policeState = createPoliceState();
  G.upgrades = { turbo: false };
  G.missionsApi = createMissionsApi(G);
  G.sideJobsDone = 0;
  G.missionFailed = null;
  G.shopOpen = false;
  G.storyCompleteAt = 0;
  G.completeShown = false;
  populate();
  G.camera.x = PLACES.garage.x - G.camera.w / 2;
  G.camera.y = PLACES.garage.y - G.camera.h / 2;
}

function newGame() {
  clearSave();
  resetRun();
  G.mode = 'play';
  G.toast = "Mara's back in Brisava. Eli is waiting at the garage — follow the marker.";
  G.toastAt = G.time;
}

function continueGame() {
  const data = readSave();
  if (!data) { newGame(); return; }
  resetRun();
  applySave(G, data);
  G.mode = 'play';
  G.toast = 'Welcome back to Brisava.';
  G.toastAt = G.time;
}

/** Death or arrest: a fair money penalty, then a checkpoint retry or a safehouse wake-up. */
function respawn() {
  const p = G.player;
  if (p.car) {
    const v = p.car;
    p.car = null;
    v.driver = null; v.occupied = false;
    if (v.kind === 'player') v.kind = 'parked';
  }
  p.dead = null;
  G.audio.engine(0, false);
  if (G.missionsApi.state.active) {
    G.missionsApi.retryMission();
  } else {
    p.x = PLACES.safehouse.x; p.y = PLACES.safehouse.y;
    p.hp = p.maxHp;
    G.policeState.heat = 0;
    G.policeState.mode = 'calm';
    G.bullets.length = 0;
  }
  G.mode = 'play';
}

/* ---------- per-frame updates ---------- */

function updateWorld(dt, withPlayer) {
  G.time += dt;
  updateTraffic(G, dt);
  updatePeds(G, dt);
  if (withPlayer) {
    if (G.shopOpen) {
      updateShop(G, input);
    } else if (!G.player.dead) {
      if (G.player.car) updatePlayerDriving(G, input, dt);
      else {
        updatePlayerOnFoot(G, input, dt);
        updatePlayerWeapons(G, input, dt);
      }
      checkPlayerRoadkill(G);
      if (input.pressed.has('KeyJ')) G.missionsApi.trySideJob();
      G.missionsApi.update(dt);
    }
    collideVehicles(G, dt);
    updateGuards(G, dt);
    updateBullets(G, dt);
    updatePolice(G, dt);
    // Death sequence: a beat of stillness, then the verdict screen.
    if (G.player.dead && !G.deathAt) {
      G.deathAt = G.time;
      const p = G.player;
      G.deathPenalty = Math.min(p.money, Math.max(20, Math.floor(p.money * 0.12)));
      p.money -= G.deathPenalty;
      G.audio.engine(0, false);
    }
    if (G.player.dead && G.time - G.deathAt > 1.5) { G.deathAt = 0; G.mode = 'over'; }
    if (!G.player.dead && G.missionFailed) G.mode = 'failed';
    if (G.storyCompleteAt && !G.completeShown && G.time - G.storyCompleteAt > 1.4) {
      G.completeShown = true;
      G.mode = 'complete';
    }
    const ih = G.player.car ? interactHint(G) : (interactHint(G) || (G.time < 14 ? 'WASD move · Shift sprint · mouse aim — hold + drag to aim · click to shoot · F melee · R reload · M map' : ''));
    G.hintText = G.shopOpen ? '' : ih;
    updateCamera(G, dt, canvas.width, canvas.height);
  } else {
    // Menu backdrop: the city lives on behind the title.
    G.camera.x = 500 + Math.sin(G.time * 0.05) * 260;
    G.camera.y = 1330 + Math.cos(G.time * 0.037) * 120;
    G.camera.w = canvas.width; G.camera.h = canvas.height;
  }
  G.player.hurtFlash = Math.max(0, G.player.hurtFlash - dt);
}

function handleAction(action) {
  // A menu click must never become the first shot of a run: entering play clears the
  // latched click (and the held state) so firing starts on the player's own press.
  if (action === 'new' || action === 'continue' || action === 'resume') {
    input.mouse.clicked = false;
    input.mouse.down = false;
  }
  const audio = G.audio;
  switch (action) {
    case 'new': newGame(); break;
    case 'continue': continueGame(); break;
    case 'controls': G.menuFrom = G.mode; G.mode = 'controls'; break;
    case 'audio': G.menuFrom = G.mode; G.mode = 'audio'; break;
    case 'back': G.mode = G.menuFrom === 'pause' ? 'pause' : 'menu'; break;
    case 'resume': G.mode = 'play'; break;
    case 'restart': G.missionFailed = null; G.missionsApi.retryMission(); G.mode = 'play'; break;
    case 'retry-mission': G.missionFailed = null; G.missionsApi.retryMission(); G.mode = 'play'; break;
    case 'menu': G.mode = 'menu'; break;
    case 'respawn': respawn(); break;
    case 'freeroam': G.mode = 'play'; break;
    case 'vol-up': audio.setVolume(audio.settings.volume + 0.1); audio.click(); break;
    case 'vol-down': audio.setVolume(audio.settings.volume - 0.1); audio.click(); break;
    case 'mute': audio.setMuted(!audio.settings.muted); break;
    default: break;
  }
}

function handleKeys() {
  if (input.mouse.clicked) {
    for (const b of G.buttons) {
      if (input.mouse.x >= b.x && input.mouse.x <= b.x + b.w && input.mouse.y >= b.y && input.mouse.y <= b.y + b.h) {
        handleAction(b.action);
        break;
      }
    }
  }
  if (G.mode === 'play') {
    if (input.pressed.has('Escape')) {
      if (G.shopOpen) G.shopOpen = false;
      else G.mode = 'pause';
    } else if (input.pressed.has('KeyM')) G.mode = 'map';
    else if (input.pressed.has('KeyC') && renderer3d) {
      renderer3d.cycle();
      G.toast = `Camera: ${renderer3d.label()}`;
      G.toastAt = G.time;
      G.audio.click();
    }
  } else if (G.mode === 'map') {
    if (input.pressed.has('KeyM') || input.pressed.has('Escape')) G.mode = 'play';
  } else if (G.mode === 'pause') {
    if (input.pressed.has('Escape')) G.mode = 'play';
  } else if (G.mode === 'controls' || G.mode === 'audio') {
    if (input.pressed.has('Escape')) handleAction('back');
  } else if (G.mode === 'menu') {
    if (input.pressed.has('Enter')) newGame();
  }
}

function draw() {
  G.buttons = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (renderer3d) {
    renderer3d.render(G, G.frameDt);
    G.viewMode = renderer3d.label();
  } else {
    drawWorld(ctx, G);
    G.viewMode = null;
  }
  const w = canvas.width, h = canvas.height;
  if (G.mode === 'play' || G.mode === 'map') {
    HUD.drawHUD(ctx, G, w, h);
    if (G.shopOpen) HUD.drawShop(ctx, G, w, h);
    if (G.mode === 'map') HUD.drawBigMap(ctx, G, w, h);
  } else if (G.mode === 'menu') HUD.drawMenu(ctx, G, w, h, hasSave());
  else if (G.mode === 'pause') { HUD.drawHUD(ctx, G, w, h); HUD.drawPause(ctx, G, w, h); }
  else if (G.mode === 'controls') HUD.drawControls(ctx, G, w, h);
  else if (G.mode === 'audio') HUD.drawAudio(ctx, G, w, h);
  else if (G.mode === 'over') HUD.drawOver(ctx, G, w, h);
  else if (G.mode === 'failed') { HUD.drawHUD(ctx, G, w, h); HUD.drawFailed(ctx, G, w, h); }
  else if (G.mode === 'complete') HUD.drawComplete(ctx, G, w, h);
}

/* ---------- boot ---------- */

populate();

if (shotName) {
  resetRun();
  if (renderer3d) {
    renderer3d.setMode(params.get('cam') || 'chase');
    renderer3d.snap(); // a still frame has no time to glide: start on the staged camera
  }
  stageShot(shotName, G, {
    newGameSituation: () => { G.mode = 'play'; },
    updateWorld: (dt) => updateWorld(dt, true),
    draw: () => draw(),
  });
  if (renderer3d) renderer3d.snap(G); // compose the still on the staged state, heading included
  let painted = 0;
  const paint = () => {
    draw();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else { window.__shotReady = true; if (statusEl) statusEl.textContent = 'shot ready: ' + shotName; }
  };
  requestAnimationFrame(paint);
} else {
  let accumulator = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    G.frameDt = dt;
    accumulator += dt;
    last = now;
    handleKeys();
    if (G.mode === 'play' || G.mode === 'menu') {
      while (accumulator >= STEP) {
        updateWorld(STEP, G.mode === 'play');
        accumulator -= STEP;
        // A press is ONE action: only the first fixed step of a frame may consume it.
        // Clearing here stops a hitched frame (several steps per rAF) from buying a
        // whole shelf in one shop tap or entering and instantly exiting a car on E.
        input.pressed.clear();
        input.mouse.clicked = false;
      }
    } else accumulator = 0;
    draw();
    input.pressed.clear();
    input.mouse.clicked = false;
  }
  requestAnimationFrame(frame);
}

export { G, enterVehicle, exitVehicle };
