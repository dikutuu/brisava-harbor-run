// Pedestrians: Brisava's walkers. They stroll the sidewalks (the pavement strips alongside
// each road), pause at corners, step aside for cars, and run from gunfire and police chases.
// They spawn on sidewalks off-camera near the player and despawn far away, so the streets
// near you are always alive at a steady 50–60 FPS.

import { V_ROADS, allHRoads, PROMENADE_Y, angleLerp, clamp, collideCircle, dist } from './world.js';

const TARGET_PEDS = 32;
const SIDEWALK = 62; // offset from a road's centre line: just outside the asphalt
const SHIRT = ['#c94f36', '#3f7d5c', '#405e8c', '#d9903a', '#8c4fa3', '#e3e0d8', '#2e8f86', '#b8526b'];

/** A sidewalk route: walk along one road at a fixed offset, toward a target coordinate. */
function pickRoute(G, p) {
  const alongV = G.rng() < 0.5;
  if (alongV) {
    const cx = V_ROADS[Math.floor(G.rng() * V_ROADS.length)];
    p.side = G.rng() < 0.5 ? -1 : 1;
    p.x = cx + p.side * SIDEWALK;
    p.axis = 'v';
    p.target = 140 + G.rng() * (PROMENADE_Y - 200);
  } else {
    const cy = allHRoads()[Math.floor(G.rng() * allHRoads().length)];
    p.side = G.rng() < 0.5 ? -1 : 1;
    p.y = cy + p.side * SIDEWALK;
    p.axis = 'h';
    p.target = 140 + G.rng() * 3300;
  }
}

function spawnPed(G, nearPlayer) {
  const p = {
    x: 0, y: 0, angle: 0, speed: 0, state: 'walk', pauseFor: 0, fleeFor: 0, fleeAngle: 0,
    shirt: SHIRT[Math.floor(G.rng() * SHIRT.length)], axis: 'h', side: 1, target: 0, phase: G.rng() * 6.28,
  };
  for (let tries = 0; tries < 10; tries += 1) {
    pickRoute(G, p);
    if (p.axis === 'v') p.y = clamp(G.player.y + (G.rng() - 0.5) * 1500, 120, PROMENADE_Y - 60);
    else p.x = clamp(G.player.x + (G.rng() - 0.5) * 1500, 120, 3480);
    const d = dist(p.x, p.y, G.camera.x, G.camera.y);
    if (nearPlayer && (d < 640 || d > 1250)) continue;
    if (!nearPlayer && d < 500) continue;
    break;
  }
  collideCircle(p, 9);
  G.peds.push(p);
  return p;
}

export function initPeds(G) {
  for (let i = 0; i < TARGET_PEDS; i += 1) spawnPed(G, false);
}

/** Something frightening happened at (x, y): nearby walkers run from it. */
export function scarePeds(G, x, y, radius) {
  for (const p of G.peds) {
    if (dist(p.x, p.y, x, y) < radius) {
      p.state = 'flee';
      p.fleeFor = 2.2 + G.rng() * 1.4;
      p.fleeAngle = Math.atan2(p.y - y, p.x - x);
    }
  }
}

export function updatePeds(G, dt) {
  for (let i = G.peds.length - 1; i >= 0; i -= 1) {
    const p = G.peds[i];
    const dCam = dist(p.x, p.y, G.camera.x, G.camera.y);
    if (dCam > 1600) { G.peds.splice(i, 1); continue; }
    let vx = 0, vy = 0, wantSpeed = 0;
    if (p.state === 'flee') {
      p.fleeFor -= dt;
      wantSpeed = 175;
      vx = Math.cos(p.fleeAngle); vy = Math.sin(p.fleeAngle);
      if (p.fleeFor <= 0) p.state = 'walk';
    } else if (p.pauseFor > 0) {
      p.pauseFor -= dt;
      wantSpeed = 0;
    } else {
      // Walk the sidewalk toward the target; at the end, pause or pick a new street.
      const along = p.axis === 'v' ? p.y : p.x;
      const dir = Math.sign(p.target - along) || 1;
      if (Math.abs(p.target - along) < 14) {
        if (G.rng() < 0.4) p.pauseFor = 0.8 + G.rng() * 2.2;
        pickRoute(G, p);
        if (p.axis === 'v') p.x = clamp(p.x, 60, 3540); else p.y = clamp(p.y, 60, 2330);
      } else {
        wantSpeed = 62 + (p.phase % 1) * 22;
        if (p.axis === 'v') { vx = 0; vy = dir; } else { vx = dir; vy = 0; }
        // Drift back onto the pavement line if a scare or a shove pushed them off it.
        if (p.axis === 'v') {
          const cx = V_ROADS.reduce((a, b) => Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a, V_ROADS[0]);
          vx += clamp((cx + p.side * SIDEWALK - p.x) * 0.04, -0.5, 0.5);
        } else {
          const cy = allHRoads().reduce((a, b) => Math.abs(b - p.y) < Math.abs(a - p.y) ? b : a, allHRoads()[0]);
          vy += clamp((cy + p.side * SIDEWALK - p.y) * 0.04, -0.5, 0.5);
        }
      }
      // Step aside: a car bearing down on the pavement edge clears a path.
      for (const v of G.vehicles) {
        if (v.wrecked) continue;
        const d = dist(p.x, p.y, v.x, v.y);
        if (d < 52 && Math.abs(v.speed) > 30) {
          const away = Math.atan2(p.y - v.y, p.x - v.x);
          vx += Math.cos(away) * 1.4; vy += Math.sin(away) * 1.4;
          wantSpeed = 150;
        }
      }
    }
    const mag = Math.hypot(vx, vy);
    if (mag > 0.01 && wantSpeed > 0) {
      vx = (vx / mag) * wantSpeed; vy = (vy / mag) * wantSpeed;
      p.x += vx * dt; p.y += vy * dt;
      p.angle = angleLerp(p.angle, Math.atan2(vy, vx), Math.min(1, 10 * dt));
      p.speed = wantSpeed;
    } else p.speed = 0;
    collideCircle(p, 9);
    p.phase += dt * (p.speed > 0 ? 9 : 1.5);
  }
  if (G.peds.length < TARGET_PEDS && G.rng() < 0.12) spawnPed(G, true);
}
