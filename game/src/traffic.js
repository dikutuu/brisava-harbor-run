// Ambient traffic: a dozen-plus cars that live on the road graph. Each follows its lane
// (right-hand traffic), picks a new heading at junctions, keeps a safe distance from the car
// ahead, brakes for the player's car and for pedestrians crossing, and recovers when boxed in
// (a stuck car waits, then quietly reroutes; one that stays stuck despawns off-camera and is
// replaced). Cars spawn on roads away from the camera and leave when far away, so the city
// feels populated without ever pop-in popping in front of the player.

import { V_ROADS, allHRoads, clamp, dist, laneOffset, randomRoadPoint } from './world.js';
import { spawnVehicle, removeVehicle } from './vehicles.js';

const TARGET_TRAFFIC = 15;
const CLASSES = ['sedan', 'sedan', 'sedan', 'coupe', 'van'];

/** A traffic car's route state: which road, which way, and the junction it is heading for. */
function newRoute(G, v, point) {
  const dir = G.rng() < 0.5 ? 1 : -1;
  v.ai = {
    axis: point.axis, index: point.index, dir,
    target: nextJunctionAlong(point, dir, v),
    speed: 0, stuckFor: 0, waitFor: 0,
  };
  placeInLane(v);
}

function roadCenter(ai) {
  return ai.axis === 'v' ? V_ROADS[ai.index] : allHRoads()[ai.index];
}

function placeInLane(v) {
  const c = roadCenter(v.ai);
  if (v.ai.axis === 'v') v.x = c - laneOffset(v.ai.dir); // heading south, your lane is the west one
  else v.y = c + laneOffset(v.ai.dir);
}

/** Coordinate of the next junction ahead of the car along its road, or the road's end. */
function nextJunctionAlong(point, dir, v) {
  const cross = point.axis === 'v' ? allHRoads() : V_ROADS;
  const along = point.axis === 'v' ? v.y : v.x;
  let best = dir > 0 ? Infinity : -Infinity;
  for (const c of cross) {
    if (dir > 0 && c > along + 4 && c < best) best = c;
    if (dir < 0 && c < along - 4 && c > best) best = c;
  }
  if (!Number.isFinite(best)) best = dir > 0 ? (point.axis === 'v' ? 2240 : 3560) : 60;
  return best;
}

function spawnTrafficCar(G) {
  for (let tries = 0; tries < 8; tries += 1) {
    const p = randomRoadPoint(G.rng);
    if (dist(p.x, p.y, G.camera.x, G.camera.y) < 760) continue; // never appear on camera
    const cls = CLASSES[Math.floor(G.rng() * CLASSES.length)];
    const v = spawnVehicle(G, cls, p.x, p.y, 0, 'traffic');
    v.driver = 'traffic';
    newRoute(G, v, p);
    v.angle = v.ai.axis === 'h' ? (v.ai.dir > 0 ? 0 : Math.PI) : (v.ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    return v;
  }
  return null;
}

export function initTraffic(G) {
  for (let i = 0; i < TARGET_TRAFFIC; i += 1) spawnTrafficCar(G);
}

/** Distance to the nearest obstacle ahead in this car's lane (car, player car, or crossing ped). */
function gapAhead(G, v) {
  const ai = v.ai;
  let gap = 190;
  const ahead = (o) => {
    if (o === v) return;
    const along = ai.axis === 'v' ? (o.y - v.y) * ai.dir : (o.x - v.x) * ai.dir;
    const lat = ai.axis === 'v' ? Math.abs(o.x - v.x) : Math.abs(o.y - v.y);
    if (along > 0 && along < gap && lat < 30) gap = along;
  };
  for (const o of G.vehicles) ahead(o);
  for (const p of G.peds) {
    const onRoad = Math.abs((ai.axis === 'v' ? p.x - v.x : p.y - v.y)) < 34;
    const along = ai.axis === 'v' ? (p.y - v.y) * ai.dir : (p.x - v.x) * ai.dir;
    if (onRoad && along > 0 && along < gap) gap = along;
  }
  if (G.player.car === null && !G.player.dead) {
    const along = ai.axis === 'v' ? (G.player.y - v.y) * ai.dir : (G.player.x - v.x) * ai.dir;
    const lat = ai.axis === 'v' ? Math.abs(G.player.x - v.x) : Math.abs(G.player.y - v.y);
    if (along > 0 && along < gap && lat < 30) gap = along;
  }
  return gap;
}

/** At a junction: often turn onto the crossing road, else continue; at a road's end, turn around. */
function chooseAtJunction(G, v) {
  const ai = v.ai;
  const junctionAlong = ai.target; // the cross-coordinate of the junction just reached
  const crossList = ai.axis === 'v' ? allHRoads() : V_ROADS;
  const crossIndex = crossList.indexOf(junctionAlong);
  if (crossIndex >= 0 && G.rng() < 0.45) {
    ai.axis = ai.axis === 'v' ? 'h' : 'v';
    ai.index = crossIndex;
    ai.dir = G.rng() < 0.5 ? 1 : -1;
    const probe = ai.axis === 'v' ? { x: junctionAlong, y: v.y } : { x: v.x, y: junctionAlong };
    ai.target = nextJunctionAlong({ axis: ai.axis, index: ai.index }, ai.dir, probe);
    return;
  }
  const next = nextJunctionAlong({ axis: ai.axis, index: ai.index }, ai.dir, v);
  const along = ai.axis === 'v' ? v.y : v.x;
  if ((ai.dir > 0 && next <= along + 4) || (ai.dir < 0 && next >= along - 4)) {
    ai.dir = -ai.dir; // road's end: U-turn into the opposite lane
    ai.target = nextJunctionAlong({ axis: ai.axis, index: ai.index }, ai.dir, v);
  } else {
    ai.target = next;
  }
}

export function updateTraffic(G, dt) {
  let count = 0;
  for (let i = G.vehicles.length - 1; i >= 0; i -= 1) {
    const v = G.vehicles[i];
    if (v.kind !== 'traffic') continue;
    count += 1;
    const dCam = dist(v.x, v.y, G.camera.x, G.camera.y);
    if (dCam > 1750) { removeVehicle(G, v); count -= 1; continue; }
    if (v.wrecked) continue;
    const ai = v.ai;
    if (!ai) { newRoute(G, v, { axis: 'h', index: 1 }); continue; }
    const cruise = 150 + (v.id % 5) * 14;
    const gap = gapAhead(G, v);
    let want = cruise;
    if (gap < 90) want = 0;
    else if (gap < 150) want = cruise * 0.45;
    if (ai.waitFor > 0) { ai.waitFor -= dt; want = 0; }
    ai.speed += clamp(want - ai.speed, -420 * dt, 130 * dt);
    if (Math.abs(ai.speed) < 4 && want > 0) ai.stuckFor += dt; else ai.stuckFor = 0;
    if (ai.stuckFor > 3.5) { // boxed in: wait a beat, then pick a different way at the next junction
      ai.waitFor = 1.2; ai.stuckFor = 0;
      ai.target = nextJunctionAlong({ axis: ai.axis, index: ai.index }, ai.dir, v);
    }
    const step = ai.speed * dt;
    if (ai.axis === 'v') v.y += step * ai.dir; else v.x += step * ai.dir;
    placeInLaneSmooth(v);
    const along = ai.axis === 'v' ? v.y : v.x;
    if ((ai.dir > 0 && along >= ai.target) || (ai.dir < 0 && along <= ai.target)) {
      if (ai.axis === 'v') v.y = ai.target; else v.x = ai.target;
      chooseAtJunction(G, v);
    }
    const targetAngle = ai.axis === 'h' ? (ai.dir > 0 ? 0 : Math.PI) : (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    let da = targetAngle - v.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    v.angle += da * Math.min(1, 5 * dt);
    v.speed = ai.speed;
  }
  if (count < TARGET_TRAFFIC && G.rng() < 0.1) spawnTrafficCar(G);
}

/** Ease the car onto its lane centre so turns look like arcs, not teleports. */
function placeInLaneSmooth(v) {
  const c = roadCenter(v.ai);
  if (v.ai.axis === 'v') {
    const laneX = c - laneOffset(v.ai.dir);
    v.x += (laneX - v.x) * 0.12;
  } else {
    const laneY = c + laneOffset(v.ai.dir);
    v.y += (laneY - v.y) * 0.12;
  }
}
