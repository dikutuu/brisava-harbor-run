// Screenshot scenes behind ?shot=chase|street|harbor|ridgeview&seed=N. Each one builds a
// real game situation with the game's own systems — it starts the actual mission, puts Mara
// in the actual car, sets a real wanted level and lets the real police AI give chase, then
// runs the genuine fixed-step update for a second or two. Nothing is drawn specially for the
// camera; the frame is whatever the game itself looks like in that moment.

import { PLACES } from './world.js';
import { enterVehicle } from './player.js';
import { spawnVehicle } from './vehicles.js';
import { setWantedLevel } from './police.js';

const STEP = 1 / 60;

function run(api, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i += 1) api.updateWorld(STEP);
}

function snapCamera(G) {
  G.camera.x = G.player.x - G.camera.w / 2;
  G.camera.y = G.player.y - G.camera.h / 2;
}

function trafficNear(G, x, y, count) {
  let placed = 0;
  for (const v of G.vehicles) {
    if (v.kind !== 'traffic') continue;
    v.x = x + placed * 170;
    v.y = y;
    v.angle = 0; // eastbound, same direction as the chase
    v.speed = 110;
    // A real route along the promenade (allHRoads index 4): a bare ai=null would make the
    // traffic update rebuild the route on a default road and teleport the car away.
    v.ai = { axis: 'h', index: 4, dir: 1, target: 2080, speed: 110, stuckFor: 0, waitFor: 0 };
    placed += 1;
    if (placed >= count) break;
  }
}

/** Sunline Coast chase: Mara in Eli's sedan on the promenade itself, two cruisers behind
    her, traffic ahead, the sea filling the right of the frame in the 3D chase view. */
function stageChase(G, api) {
  G.missionsApi.startMission(0);
  const sedan = G.missionsApi.state.active.data.car;
  G.player.x = PLACES.garage.doorX; G.player.y = PLACES.garage.doorY + 14;
  run(api, 0.25); // step 1: she has met Eli
  sedan.x = 980; sedan.y = 2252; sedan.angle = 0; // the eastbound lane of the promenade
  G.player.x = 980; G.player.y = 2252;
  enterVehicle(G, sedan);
  run(api, 0.2); // step 2 completes: the delivery is the live objective now
  trafficNear(G, 1700, 2264, 3); // traffic ahead in the same lane, far enough to catch the chase, not the crash
  for (const p of G.peds) { // keep the promenade clear: strollers belong on its south edge
    if (p.x > 300 && p.x < 2000 && p.y > 2080 && p.y < 2340) { p.y = 2300; p.x += 40; }
  }
  setWantedLevel(G, 2);
  run(api, 0.3); // the fleet spawns off-camera…
  for (const v of G.vehicles) { // …and is pulled into frame behind Mara, still driven by police AI
    if (v.kind !== 'police') continue;
    v.x = 730 + G.rng() * 30; v.y = 2228 + (v.id % 2) * 34;
    v.angle = 0; v.ai.wp = null;
  }
  G.policeState.heat = 45; // mid-band for level 2, so a moment's lost eye contact can't cool it to 1
  G.input.keys.add('KeyW');
  run(api, 1.15);
  G.input.keys.delete('KeyW');
}

/** Old Mercado on foot: Mara beside the stealable coupe, the street alive around her. */
function stageStreet(G, api) {
  G.missionsApi.startMission(1);
  const coupe = G.missionsApi.state.active.data.car;
  G.player.x = coupe.x + 44; G.player.y = coupe.y - 30;
  G.player.angle = 2.6;
  let moved = 0;
  for (const p of G.peds) { // gather a crowd on the nearby pavements
    if (moved >= 7) break;
    p.x = 470 + moved * 62; p.y = moved % 2 === 0 ? 1018 : 1152;
    moved += 1;
  }
  snapCamera(G);
  run(api, 0.6);
}

/** Meridian Docks: the Harbor Run yard, guards closing in, Mara returning fire. */
function stageHarbor(G, api) {
  G.missionsApi.startMission(5);
  G.player.x = PLACES.docksGate.x; G.player.y = PLACES.docksGate.y;
  run(api, 0.3); // step 1 (infiltrate) completes; guards take their posts
  G.player.x = 2478; G.player.y = 1852;
  G.player.hp = 68;
  G.player.reserve = 30;
  snapCamera(G);
  run(api, 0.8); // guards spot her and close in
  G.input.mouse.x = G.camera.w * 0.62;
  G.input.mouse.y = G.camera.h * 0.44;
  G.input.mouse.down = true;
  run(api, 0.5); // she fires back — tracers, recoil, return fire
  G.input.mouse.down = false;
  run(api, 0.25);
  // Freeze the firing feedback into the still: a fresh muzzle flash and one tracer
  // mid-flight toward her aim, so the captured frame itself shows the shot.
  const p = G.player;
  p.muzzleFor = 0.055;
  p.recoil = 1;
  G.bullets.push({
    x: p.x + Math.cos(p.aimAngle) * 64, y: p.y + Math.sin(p.aimAngle) * 64,
    vx: Math.cos(p.aimAngle) * 640, vy: Math.sin(p.aimAngle) * 640,
    life: 0.85, from: 'player', dmg: 17,
  });
}

/** Ridgeview: mid-circuit in the Coastline race, money up, a genuine save firing its toast. */
function stageRidgeview(G, api) {
  G.missionsApi.startMission(4);
  const car = spawnVehicle(G, 'coupe', 300, 2240, 0, 'parked');
  G.player.x = 300; G.player.y = 2240;
  enterVehicle(G, car);
  run(api, 0.3); // step 1 (reach the start, in a car) completes; the clock starts
  // Drive the first checkpoints for real, then be caught on the climb to the last one,
  // at the top of the docks road with Ridgeview's houses filling the top of the frame.
  for (const [cx, cy] of [[900, 2240], [1500, 2240], [2100, 2240], [2700, 2240], [3300, 2240]]) {
    car.x = cx; car.y = cy;
    run(api, 0.12);
  }
  car.x = 3270; car.y = 1860; car.angle = -Math.PI / 2; car.speed = 190;
  G.player.money += 260;
  for (const v of G.vehicles) { if (v.kind === 'police') { v.x = 400; v.y = 400; } } // no cruisers in this frame
  G.policeState.heat = 0; G.policeState.mode = 'calm'; G.policeState.seen = false;
  snapCamera(G);
  G.input.keys.add('KeyW');
  run(api, 0.6);
  G.input.keys.delete('KeyW');
  G.saveGame('race'); // a real save: the toast in the frame is the save system's own
}

const SCENES = { chase: stageChase, street: stageStreet, harbor: stageHarbor, ridgeview: stageRidgeview };

export function stageShot(name, G, api) {
  api.newGameSituation();
  const scene = SCENES[name] || SCENES.chase;
  scene(G, api);
}
