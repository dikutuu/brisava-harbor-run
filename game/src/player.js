// Mara Venn: on foot she walks and sprints (stamina permitting), aims with the mouse, and
// interacts with whatever is closest — a car door, the garage counter, a mission marker. In a
// car she is the car. The camera follows with a dead zone on foot and a speed look-ahead
// behind the wheel, so driving fast never means driving blind.

import { PLACES, angleLerp, clamp, collideCircle, dist } from './world.js';
import { damageVehicle, doorSpot, driveVehicle, nearestVehicle } from './vehicles.js';
import { ejectDriverOfficer } from './police.js';
import { hurtPlayer } from './combat.js';

export function createPlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2, hp: 100, maxHp: 100, stamina: 100,
    car: null, lastCar: null, money: 60, ammo: 12, reserve: 36,
    reloadFor: 0, reloadDone: false, fireFor: 0, meleeFor: 0, meleeSwing: 0,
    aimAngle: 0, recoil: 0, hurtFlash: 0, dead: null, walkPhase: 0, speedNow: 0,
  };
}

const WALK = 148, SPRINT = 238;

export function updatePlayerOnFoot(G, input, dt) {
  const p = G.player;
  let mx = 0, my = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) my -= 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) my += 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) mx -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) mx += 1;
  const mag = Math.hypot(mx, my);
  const wantSprint = (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) && mag > 0;
  if (wantSprint && p.stamina > 1) p.stamina = Math.max(0, p.stamina - 26 * dt);
  else p.stamina = Math.min(100, p.stamina + 15 * dt);
  const sprinting = wantSprint && p.stamina > 1;
  let speed = 0;
  if (mag > 0) {
    mx /= mag; my /= mag;
    speed = sprinting ? SPRINT : WALK;
    p.x += mx * speed * dt;
    p.y += my * speed * dt;
    p.angle = angleLerp(p.angle, Math.atan2(my, mx), Math.min(1, 14 * dt));
    p.walkPhase += dt * (sprinting ? 13 : 10);
  }
  p.speedNow = speed;
  collideCircle(p, 11);
  // Traffic is dangerous: a moving car that reaches Mara knocks her down.
  for (const v of G.vehicles) {
    if (v.wrecked || Math.abs(v.speed) < 130) continue;
    if (dist(p.x, p.y, v.x, v.y) < v.h + 12) {
      hurtPlayer(G, 16);
      p.x += Math.cos(Math.atan2(p.y - v.y, p.x - v.x)) * 22;
      p.y += Math.sin(Math.atan2(p.y - v.y, p.x - v.x)) * 22;
      G.toast = 'Run over! Watch the traffic.';
      break;
    }
  }
  if (input.pressed.has('KeyE')) tryInteract(G);
  if (input.pressed.has('KeyB') && dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 90) G.shopOpen = true;
}

export function updatePlayerDriving(G, input, dt) {
  const p = G.player;
  const v = p.car;
  const drive = {
    throttle: (input.keys.has('KeyW') || input.keys.has('ArrowUp') ? 1 : 0) + (input.keys.has('KeyS') || input.keys.has('ArrowDown') ? -1 : 0),
    steer: (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? -1 : 0) + (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0),
    handbrake: input.keys.has('Space'),
  };
  driveVehicle(G, v, drive, dt);
  p.x = v.x; p.y = v.y; p.angle = v.angle;
  p.speedNow = Math.abs(v.speed);
  G.audio.engine(clamp(Math.abs(v.speed) / v.def.maxSpeed, 0, 1), true);
  if (input.pressed.has('KeyH')) G.audio.horn();
  // Running people down and smashing traffic are crimes, noticed by updateCollisions via policeReport hooks there.
  if (input.pressed.has('KeyE')) exitVehicle(G);
}

export function enterVehicle(G, v) {
  const p = G.player;
  if (v.occupied && v.driver === 'traffic') {
    // Steal it out from under its driver: he is put on the pavement, unhurt and furious.
    v.occupied = false;
    G.toast = 'Driver ejected! The car is yours.';
  }
  if (v.kind === 'police' && v.driver === 'police') {
    v.driver = null;
    ejectDriverOfficer(G, v); // the officer is put on the pavement and gives chase on foot
  }
  v.driver = 'player';
  v.occupied = true;
  if (v.kind === 'traffic') v.kind = 'player';
  p.car = v;
  p.lastCar = v;
  G.audio.engine(0, true);
  // Taking a car that was never yours is a crime — once. Re-entering your own ride is not.
  if (!v.takenByPlayer && !v.noHeat) G.policeReport('theft');
  v.takenByPlayer = true;
}

export function exitVehicle(G) {
  const p = G.player;
  const v = p.car;
  if (!v) return;
  const spot = doorSpot(G, v);
  p.x = spot.x; p.y = spot.y;
  p.car = null;
  v.driver = null;
  v.occupied = false;
  if (v.kind === 'player') v.kind = 'parked';
  v.speed = 0;
  G.audio.engine(0, false);
}

/** E key: mission interact first, then the garage counter, then the nearest car door. */
export function tryInteract(G) {
  const p = G.player;
  if (G.missionsApi.tryInteract(G)) return;
  const v = nearestVehicle(G, p.x, p.y, 40);
  if (v && !v.wrecked) { enterVehicle(G, v); return; }
  if (v && v.wrecked) { G.toast = 'That one is wrecked. Find another ride.'; return; }
  if (dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 80) {
    G.shopOpen = true;
    return;
  }
  if (dist(p.x, p.y, PLACES.safehouse.doorX, PLACES.safehouse.doorY) < 70) {
    G.saveGame('safehouse');
    G.toast = 'Game saved at the safehouse.';
    p.hp = Math.min(p.maxHp, p.hp + 40);
  }
}

/** What the E key would do right now — the HUD's contextual hint. */
export function interactHint(G) {
  const p = G.player;
  if (p.car) return 'E — get out · Space — handbrake · H — horn';
  const mh = G.missionsApi.interactHint(G);
  if (mh) return mh;
  const v = nearestVehicle(G, p.x, p.y, 40);
  if (v && !v.wrecked) return v.occupied ? 'E — steal the ' + v.def.name : 'E — drive the ' + v.def.name;
  if (dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 80) return 'E — garage counter (repairs, ammo, upgrades) · B — shop';
  if (dist(p.x, p.y, PLACES.safehouse.doorX, PLACES.safehouse.doorY) < 70) return 'E — rest at the safehouse (save + heal)';
  return '';
}

/** Camera: dead zone on foot, look-ahead with speed in a car, always inside the world. */
export function updateCamera(G, dt, viewW, viewH) {
  const p = G.player;
  const cam = G.camera;
  let tx = p.x - viewW / 2, ty = p.y - viewH / 2;
  if (p.car) {
    tx += Math.cos(p.car.angle) * clamp(p.car.speed * 0.42, -190, 190);
    ty += Math.sin(p.car.angle) * clamp(p.car.speed * 0.42, -190, 190);
  } else {
    // Small dead zone: the camera only drifts once Mara leaves the middle of the screen.
    const dx = p.x - (cam.x + viewW / 2), dy = p.y - (cam.y + viewH / 2);
    if (Math.abs(dx) < 90 && Math.abs(dy) < 70) { tx = cam.x; ty = cam.y; }
  }
  const k = Math.min(1, (p.car ? 5.2 : 7) * dt);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.x = clamp(cam.x, 0, Math.max(0, 3600 - viewW));
  cam.y = clamp(cam.y, 0, Math.max(0, 2600 - viewH));
  cam.w = viewW; cam.h = viewH;
}

/**
 * The garage counter (G.shopOpen): keys 1–3 buy, Esc/E/B close. Real money, real effects —
 * ammunition restocks the reserve, a repair makes a wrecked car whole again, and the turbo is
 * a one-time permanent upgrade for every car Mara drives.
 */
export const SHOP_ITEMS = [
  { key: 'Digit1', name: 'Ammo box (+48 reserve)', price: 40 },
  { key: 'Digit2', name: 'Full repair (your last car)', price: 70 },
  { key: 'Digit3', name: 'Turbo upgrade (permanent)', price: 300 },
];

export function updateShop(G, input) {
  const p = G.player;
  if (input.pressed.has('Escape') || input.pressed.has('KeyE') || input.pressed.has('KeyB')) {
    G.shopOpen = false;
    return;
  }
  for (const item of SHOP_ITEMS) {
    if (!input.pressed.has(item.key)) continue;
    if (p.money < item.price) { G.toast = `Not enough money for ${item.name} ($${item.price}).`; G.toastAt = G.time; return; }
    if (item.key === 'Digit1') {
      p.reserve += 48;
      p.money -= item.price;
      G.audio.cash();
      G.toast = 'Ammo restocked (+48).';
    } else if (item.key === 'Digit2') {
      const v = p.lastCar && !p.car ? p.lastCar : nearestVehicle(G, p.x, p.y, 260);
      if (!v) { G.toast = 'No car nearby to repair.'; G.toastAt = G.time; return; }
      v.hp = v.maxHp; v.wrecked = false;
      p.money -= item.price;
      G.audio.cash();
      G.toast = `${v.def.name} repaired to full.`;
    } else if (item.key === 'Digit3') {
      if (G.upgrades.turbo) { G.toast = 'Turbo already fitted.'; G.toastAt = G.time; return; }
      G.upgrades.turbo = true;
      p.money -= item.price;
      G.audio.cash();
      G.toast = 'Turbo fitted! Every car you drive pulls harder.';
    }
    G.toastAt = G.time;
  }
}

/** Pedestrian casualties from the player's driving: checked after car movement. */
export function checkPlayerRoadkill(G) {
  const p = G.player;
  if (!p.car || Math.abs(p.car.speed) < 60) return;
  for (const ped of G.peds) {
    if (dist(p.x, p.y, ped.x, ped.y) < p.car.h + 10) {
      ped.state = 'flee'; ped.fleeFor = 3;
      ped.x += (ped.x - p.car.x) * 0.4; ped.y += (ped.y - p.car.y) * 0.4;
      G.policeReport('assault');
      damageVehicle(G, p.car, 2, G.time);
      G.toast = 'You hit a pedestrian!';
      break;
    }
  }
}
