// The wanted system and the Brisava PD. Real crimes raise heat — stealing a car, hurting a
// pedestrian, firing a gun where people can hear, ramming a cruiser — and heat sets the level:
// 1 star brings one cruiser, 2 bring two, 3 bring three plus foot officers. Officers work a
// state machine: patrol, investigate a report, pursue on sight (buildings break line of
// sight), search the last known position, then disengage. Heat only cools while nobody can
// see you, so alleys and direction changes are how you actually escape.

import { angleLerp, clamp, collideCircle, dist, junctions, lineOfSightBlocked, randomRoadPoint } from './world.js';
import { spawnVehicle, removeVehicle, doorSpot } from './vehicles.js';

export const CRIME_HEAT = { theft: 22, assault: 26, gunshot: 12, hitPoliceCar: 30, reckless: 10, guardDown: 16 };

export function createPoliceState() {
  return {
    heat: 0, wanted: 0, mode: 'calm', seenNow: false,
    lastKnown: { x: 0, y: 0 }, unseenFor: 99, searchFor: 0, bust: 0, reportAt: -99, recklessAt: -99,
  };
}

export function wantedForHeat(heat) { return heat >= 55 ? 3 : heat >= 30 ? 2 : heat >= 12 ? 1 : 0; }

/** Record a crime at the player's position. Called through G.policeReport from every system. */
export function reportCrime(G, kind, at) {
  const P = G.policeState;
  P.heat = Math.min(100, P.heat + (CRIME_HEAT[kind] || 8));
  P.lastKnown = { x: G.player.x, y: G.player.y };
  P.reportAt = G.time;
  if (P.mode === 'calm') P.mode = 'investigate';
  if (at) P.lastKnown = { x: at.x, y: at.y };
}

/** Script a wanted level directly (missions): heat is set to the level's floor exactly,
    so a scripted beat (the M4 manhunt, the M6 van alarm) starts at the level it names
    regardless of whatever heat the player carried in. */
export function setWantedLevel(G, level) {
  const P = G.policeState;
  P.heat = [0, 12, 30, 55][level] || 0;
  P.lastKnown = { x: G.player.x, y: G.player.y };
  P.mode = level > 0 ? 'investigate' : P.mode;
}

export function clearWanted(G) {
  const P = G.policeState;
  P.heat = 0; P.mode = 'calm'; P.bust = 0;
}

function cruisers(G) { return G.vehicles.filter((v) => v.kind === 'police'); }

function spawnCruiser(G) {
  for (let tries = 0; tries < 8; tries += 1) {
    const p = randomRoadPoint(G.rng);
    const d = dist(p.x, p.y, G.player.x, G.player.y);
    if (d < 820 || d > 1500) continue;
    const v = spawnVehicle(G, 'cruiser', p.x, p.y, 0, 'police');
    v.driver = 'police';
    v.ai = { wp: null, wpAt: 0, blockedFor: 0, detour: null, officersOut: false };
    return v;
  }
  return null;
}

/** Steer a cruiser toward (tx, ty) kinematically, routing via a junction when a building blocks the way. */
function driveCruiser(G, v, tx, ty, maxSpeed, dt) {
  const ai = v.ai;
  ai.wpAt -= dt;
  if (ai.wpAt <= 0 || !ai.wp) {
    ai.wpAt = 0.5;
    if (!lineOfSightBlocked(v.x, v.y, tx, ty)) ai.wp = { x: tx, y: ty };
    else {
      let best = null, bestScore = Infinity;
      for (const j of junctions()) {
        const score = dist(j.x, j.y, tx, ty) + dist(j.x, j.y, v.x, v.y) * 0.35;
        if (score < bestScore) { bestScore = score; best = j; }
      }
      ai.wp = best || { x: tx, y: ty };
    }
  }
  const wp = ai.wp;
  const want = Math.atan2(wp.y - v.y, wp.x - v.x);
  let da = want - v.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  v.angle += clamp(da, -2.6 * dt, 2.6 * dt);
  const facing = Math.max(0, Math.cos(da));
  const near = dist(v.x, v.y, tx, ty) < 90;
  const targetSpeed = v.wrecked ? 0 : maxSpeed * (0.25 + 0.75 * facing) * (near ? 0.45 : 1);
  v.speed += clamp(targetSpeed - v.speed, -500 * dt, 240 * dt);
  const before = { x: v.x, y: v.y };
  v.x += Math.cos(v.angle) * v.speed * dt;
  v.y += Math.sin(v.angle) * v.speed * dt;
  collideCircle(v, v.h + 4);
  const moved = dist(before.x, before.y, v.x, v.y);
  if (Math.abs(v.speed) > 60 && moved < Math.abs(v.speed) * dt * 0.3) ai.blockedFor += dt; else ai.blockedFor = Math.max(0, ai.blockedFor - dt * 2);
  if (ai.blockedFor > 1.4) { // wedged on a wall: reverse out and pick another junction
    v.speed = -120;
    ai.blockedFor = 0;
    ai.wpAt = 0;
    ai.wp = null;
  }
}

function spawnOfficer(G, cruiser) {
  const spot = doorSpot(G, cruiser);
  G.officers.push({ x: spot.x, y: spot.y, angle: cruiser.angle, speed: 0, car: cruiser, phase: G.rng() * 6 });
}

/** The player just stole an occupied cruiser: its driver ends up on the pavement. */
export function ejectDriverOfficer(G, cruiser) {
  spawnOfficer(G, cruiser);
}

function updateOfficers(G, dt) {
  const P = G.policeState;
  for (let i = G.officers.length - 1; i >= 0; i -= 1) {
    const o = G.officers[i];
    const dPlayer = dist(o.x, o.y, G.player.x, G.player.y);
    const dCam = dist(o.x, o.y, G.camera.x, G.camera.y);
    if (dCam > 1700 || P.wanted === 0) { G.officers.splice(i, 1); continue; }
    let tx = G.player.x, ty = G.player.y, speed = 152;
    if (G.player.car && Math.abs(G.player.car.speed) > 120) { tx = o.car.x; ty = o.car.y; speed = 165; } // can't chase a moving car: back to the cruiser
    const d = dist(o.x, o.y, tx, ty);
    if (d > 12) {
      const a = Math.atan2(ty - o.y, tx - o.x);
      o.angle = angleLerp(o.angle, a, Math.min(1, 9 * dt));
      o.x += Math.cos(a) * speed * dt;
      o.y += Math.sin(a) * speed * dt;
      o.speed = speed;
    } else o.speed = 0;
    collideCircle(o, 9);
    o.phase += dt * 10;
    if (dPlayer < 300 && !lineOfSightBlocked(o.x, o.y, G.player.x, G.player.y)) P.seenNow = true;
  }
}

export function updatePolice(G, dt) {
  const P = G.policeState;
  const player = G.player;
  const px = player.car ? player.car.x : player.x;
  const py = player.car ? player.car.y : player.y;

  // Who can see the player right now?
  P.seenNow = false;
  for (const v of cruisers(G)) {
    if (dist(v.x, v.y, px, py) < 540 && !lineOfSightBlocked(v.x, v.y, px, py)) P.seenNow = true;
  }
  if (P.seenNow) {
    P.lastKnown = { x: px, y: py };
    P.unseenFor = 0;
    if (P.wanted > 0) P.mode = 'pursue';
    // Handbrake slides at speed right under a cruiser's nose count as reckless (throttled).
    if (player.car && Math.abs(player.car.speed) > 260 && G.input.keys.has('Space') && G.time - P.recklessAt > 2.5) {
      P.recklessAt = G.time;
      reportCrime(G, 'reckless');
    }
  } else {
    P.unseenFor += dt;
    if (P.mode === 'pursue' && P.unseenFor > 3) { P.mode = 'search'; P.searchFor = 10; }
  }
  if (P.mode === 'search') {
    P.searchFor -= dt;
    if (P.searchFor <= 0) P.mode = 'investigate';
  }
  // Heat cools only while unseen, all the way to zero — gating this on wanted > 0 would
  // strand heat just under the 1-star threshold forever (wanted reads 0 at heat < 12,
  // so the last 12 points could never cool and "lose the police" could never complete).
  // The cooling is quick once eyes are off her (a friendly tuning): two seconds out of
  // sight, then the manhunt bleeds away fast enough that alleys genuinely save you.
  if (!P.seenNow && P.unseenFor > 2 && P.heat > 0) P.heat = Math.max(0, P.heat - 5.6 * dt);
  P.wanted = wantedForHeat(P.heat);
  if (P.wanted === 0 && P.mode !== 'calm') { P.mode = 'calm'; P.bust = 0; }

  // Fleet size follows the level (plus one ambient patrol car when calm).
  const fleet = cruisers(G);
  const wantCount = P.wanted > 0 ? P.wanted : 1;
  if (fleet.length < wantCount) spawnCruiser(G);
  for (let i = fleet.length - 1; i >= 0; i -= 1) {
    const v = fleet[i];
    if (fleet.length - i > wantCount && dist(v.x, v.y, G.camera.x, G.camera.y) > 1500) removeVehicle(G, v);
  }

  // Drive the fleet.
  for (const v of cruisers(G)) {
    if (v.driver === 'player') continue; // a stolen cruiser is the player's problem now
    if (!v.ai) v.ai = { wp: null, wpAt: 0, blockedFor: 0, detour: null, officersOut: false };
    // Pursuit steers at the last KNOWN position, never the player's live coordinates:
    // lastKnown refreshes every frame while a cruiser can actually see Mara, so the chase
    // is just as tight in the open — but once she breaks line of sight the fleet converges
    // on where she was, and she can genuinely slip away. Steering at live coordinates
    // would make hiding impossible no matter how good the cover is.
    if (P.mode === 'pursue') driveCruiser(G, v, P.lastKnown.x, P.lastKnown.y, 385, dt);
    else if (P.mode === 'search') driveCruiser(G, v, P.lastKnown.x + Math.sin(G.time * 0.3 + v.id) * 130, P.lastKnown.y + Math.cos(G.time * 0.23 + v.id) * 130, 210, dt);
    else if (P.mode === 'investigate') driveCruiser(G, v, P.lastKnown.x, P.lastKnown.y, 260, dt);
    else { // patrol: amble between junctions
      if (!v.ai.wp || dist(v.x, v.y, v.ai.wp.x, v.ai.wp.y) < 60) {
        const js = junctions();
        v.ai.wp = js[Math.floor(G.rng() * js.length)];
      }
      driveCruiser(G, v, v.ai.wp.x, v.ai.wp.y, 140, dt);
    }
    // At 3 stars, stopped cruisers near the player put officers on foot.
    if (P.wanted >= 3 && P.mode === 'pursue' && !v.ai.officersOut && Math.abs(v.speed) < 45 && dist(v.x, v.y, px, py) < 210) {
      v.ai.officersOut = true;
      spawnOfficer(G, v);
      spawnOfficer(G, v);
    }
    if (Math.abs(v.speed) > 90) v.ai.officersOut = v.ai.officersOut && dist(v.x, v.y, px, py) < 320;
  }
  updateOfficers(G, dt);

  // The bust meter: close, slow and seen is how you get caught.
  let pressure = false;
  if (P.wanted > 0 && P.seenNow) {
    for (const v of cruisers(G)) {
      const near = dist(v.x, v.y, px, py) < (player.car ? 58 : 42);
      const slow = player.car ? Math.abs(player.car.speed) < 30 : true;
      if (near && slow && Math.abs(v.speed) < 90) pressure = true;
    }
    for (const o of G.officers) if (dist(o.x, o.y, player.x, player.y) < 38 && !player.car) pressure = true;
  }
  if (pressure) P.bust = Math.min(1, P.bust + dt / 2.3);
  else P.bust = Math.max(0, P.bust - dt * 0.7);
  if (P.bust >= 1 && !player.dead) {
    player.dead = 'busted';
    G.audio.fail();
  }

  // Siren loudness follows the nearest active cruiser.
  let nearest = Infinity;
  for (const v of cruisers(G)) nearest = Math.min(nearest, dist(v.x, v.y, px, py));
  G.audio.siren(P.wanted > 0 && nearest < 700, clamp(1 - nearest / 700, 0, 1));
}
