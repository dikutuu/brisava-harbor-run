// Cars: three stealable classes plus the police cruiser, one shared arcade driving model
// (acceleration, drag, braking, reverse, speed-sensitive steering, handbrake slides) and a
// damage model that ends in a smoking wreck — never a soft-lock: a wrecked car can still be
// pushed out of, exited, and its driver walks away. Traffic and police drive these same cars
// through their own controllers; only the player-driven one reads the keyboard.

import { clamp, collideCircle, dist, pointBlocked } from './world.js';

export const CAR_CLASSES = {
  sedan: { name: 'Marina Sedan', accel: 300, maxSpeed: 335, maxReverse: 110, grip: 5.2, turn: 2.5, hp: 110, w: 44, h: 21, colors: ['#c8553d', '#3d6e9e', '#7a8b6f', '#b8b0a4', '#5d5a8c'] },
  coupe: { name: 'Vela Coupe', accel: 395, maxSpeed: 445, maxReverse: 120, grip: 3.1, turn: 2.9, hp: 85, w: 42, h: 19, colors: ['#e0a81c', '#c22f4e', '#22242c', '#2e8f86'] },
  van: { name: 'Hauler Van', accel: 215, maxSpeed: 285, maxReverse: 95, grip: 4.6, turn: 2.0, hp: 175, w: 52, h: 24, colors: ['#cfd4d8', '#7d8a96', '#a34d2e'] },
  cruiser: { name: 'BPD Cruiser', accel: 360, maxSpeed: 415, maxReverse: 115, grip: 4.9, turn: 2.6, hp: 130, w: 45, h: 21, colors: ['#20242e'] },
};

let nextId = 1;

/** Create a vehicle. kind: 'parked' | 'traffic' | 'police' | 'mission'. */
export function spawnVehicle(G, cls, x, y, angle, kind) {
  const def = CAR_CLASSES[cls];
  const v = {
    id: nextId++, cls, def, x, y, angle: angle || 0, speed: 0, steer: 0,
    w: def.w, h: def.h, hp: def.hp, maxHp: def.hp, wrecked: false,
    color: cls === 'cruiser' ? def.colors[0] : def.colors[Math.floor(G.rng() * def.colors.length)],
    kind: kind || 'parked', driver: null, occupied: false,
    ai: null, missionTag: null, slideX: 0, slideY: 0, hornAt: 0, lastHitAt: -9,
  };
  G.vehicles.push(v);
  return v;
}

export function removeVehicle(G, v) {
  const i = G.vehicles.indexOf(v);
  if (i >= 0) G.vehicles.splice(i, 1);
}

/** Damage a car; past zero it wrecks: engine dead, smoke, but the doors still open. */
export function damageVehicle(G, v, amount, now) {
  if (v.wrecked) return;
  v.hp -= amount;
  if (amount > 6) { v.lastHitAt = now; G.audio.hit(); }
  if (v.hp <= 0) {
    v.hp = 0; v.wrecked = true; v.speed = 0;
    if (v.driver === 'player') G.toast = 'Wrecked! Get out (E) and find another ride.';
  }
}

/**
 * Advance one car with driver inputs {throttle -1..1, steer -1..1, handbrake}. Shared by the
 * player and (through simpler inputs) nobody else — traffic and police are kinematic so the
 * city stays stable, but collisions and damage apply to everyone alike.
 */
export function driveVehicle(G, v, input, dt) {
  if (v.wrecked) { v.speed = 0; return; }
  const def = v.def;
  const up = G.upgrades.turbo && v.driver === 'player' ? 1.25 : 1;
  if (input.throttle > 0) v.speed += def.accel * up * input.throttle * dt;
  else if (input.throttle < 0) {
    if (v.speed > 12) v.speed -= 620 * dt; // braking
    else v.speed = Math.max(-def.maxReverse, v.speed + def.accel * 0.7 * input.throttle * dt);
  }
  // Drag and rolling resistance settle the car at its class top speed.
  const dragK = def.accel * up / def.maxSpeed;
  v.speed -= v.speed * dragK * dt * (input.throttle > 0 ? 1 : 1.9);
  if (input.handbrake) v.speed -= v.speed * 1.6 * dt;
  if (Math.abs(v.speed) < 2 && input.throttle === 0) v.speed = 0;
  const speedRatio = clamp(Math.abs(v.speed) / 190, 0, 1);
  const steerTarget = input.steer * def.turn * speedRatio * (v.speed < 0 ? -1 : 1);
  const grip = input.handbrake ? def.grip * 0.45 : def.grip;
  v.steer += (steerTarget - v.steer) * Math.min(1, grip * dt);
  v.angle += v.steer * dt * clamp(Math.abs(v.speed) / 120, 0, 1) * Math.sign(v.speed || 1);
  const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
  // Lateral slide: velocity keeps a memory of sideways motion, more with the handbrake (the coupe drifts most).
  const latX = -fy, latY = fx;
  const latSpeed = v.slideX * latX + v.slideY * latY;
  const keep = input.handbrake ? 0.86 : Math.max(0, 1 - def.grip * 0.55 * dt * 8);
  v.slideX = latX * latSpeed * keep; v.slideY = latY * latSpeed * keep;
  const before = { x: v.x, y: v.y };
  v.x += (fx * v.speed + v.slideX) * dt;
  v.y += (fy * v.speed + v.slideY) * dt;
  collideCircle(v, v.h + 4);
  // If a wall stopped us dead while moving fast, that is a crash: damage and a bounce of speed.
  const moved = dist(before.x, before.y, v.x, v.y);
  const expected = Math.abs(v.speed) * dt;
  if (expected > 2.2 && moved < expected * 0.35 && Math.abs(v.speed) > 130) {
    damageVehicle(G, v, Math.abs(v.speed) * 0.055, G.time);
    G.audio.crash(Math.abs(v.speed) > 260);
    v.speed *= -0.18;
    v.slideX = 0; v.slideY = 0;
  } else if (expected > 2.2 && moved < expected * 0.4) {
    v.speed *= 0.55;
  }
}

/** Circle-vs-circle car contact: push apart, trade a little speed, dent both on hard hits. */
export function collideVehicles(G, dt) {
  const vs = G.vehicles;
  for (let i = 0; i < vs.length; i += 1) {
    for (let j = i + 1; j < vs.length; j += 1) {
      const a = vs[i], b = vs[j];
      const rr = a.h + b.h + 6;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (rr - d) / 2;
      const nx = dx / d, ny = dy / d;
      if (!a.wrecked) { a.x -= nx * push; a.y -= ny * push; }
      if (!b.wrecked) { b.x += nx * push; b.y += ny * push; }
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 120 && G.time - Math.max(a.lastHitAt, b.lastHitAt) > 0.4) {
        damageVehicle(G, a, rel * 0.05, G.time);
        damageVehicle(G, b, rel * 0.05, G.time);
        G.audio.crash(rel > 240);
        // Only the player's own hit on a cruiser is a crime: cruisers piling into traffic
        // or each other while they converge is their own accident, and blaming Mara for it
        // would pin her heat at maximum forever (she could never lose a tail).
        if ((a === G.player.car || b === G.player.car) && (a.kind === 'police' || b.kind === 'police')) {
          G.policeReport('hitPoliceCar', a.kind === 'police' ? a : b);
        }
      }
      const avg = (a.speed + b.speed) / 2;
      if (!a.wrecked) a.speed = avg * 0.9;
      if (!b.wrecked) b.speed = avg * 0.9;
    }
  }
}

/** The nearest vehicle whose door the player can reach, parked or occupied. */
export function nearestVehicle(G, x, y, maxDist) {
  let best = null, bestD = maxDist;
  for (const v of G.vehicles) {
    const d = dist(x, y, v.x, v.y) - v.h;
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

/** A safe on-foot spot beside a car: try both doors, then front and back; never inside a wall. */
export function doorSpot(G, v) {
  const c = Math.cos(v.angle), s = Math.sin(v.angle);
  const spots = [
    { x: v.x - s * (v.h + 16), y: v.y + c * (v.h + 16) },
    { x: v.x + s * (v.h + 16), y: v.y - c * (v.h + 16) },
    { x: v.x + c * (v.w / 2 + 16), y: v.y + s * (v.w / 2 + 16) },
    { x: v.x - c * (v.w / 2 + 16), y: v.y - s * (v.w / 2 + 16) },
  ];
  for (const p of spots) if (!pointBlocked(p.x, p.y, 4)) return p;
  return spots[0];
}
