// Combat: Mara's pistol (mouse aim, magazine, reload), a one-button melee, and the people who
// fight back — Meridian's guards and anyone the missions set on you. Bullets are stopped by
// buildings, hurt what they hit with a little knockback, and gunfire is a crime the whole
// neighbourhood hears: it scares pedestrians and, if anyone official is near, raises heat.

import { angleLerp, collideCircle, dist, lineOfSightBlocked, pointBlocked } from './world.js';
import { scarePeds } from './pedestrians.js';

export const MAG_SIZE = 12;

/** A mission guard: stands a post until alerted, then closes in and shoots. */
export function spawnGuard(G, x, y, opts = {}) {
  const g = {
    x, y, angle: opts.angle || 0, hp: 34, maxHp: 34, state: opts.alert ? 'chase' : 'idle',
    post: { x, y }, shootAt: 0, phase: G.rng() * 6.28, missionTag: opts.missionTag || null,
    speed: 0, hitFlash: 0,
  };
  G.guards.push(g);
  return g;
}

export function removeGuards(G, tag) {
  G.guards = G.guards.filter((g) => g.missionTag !== tag);
}

/** The player pulls the trigger (or swings). Called from the player update with the input state. */
export function updatePlayerWeapons(G, input, dt) {
  const p = G.player;
  if (p.car || p.dead) return;
  p.reloadFor = Math.max(0, p.reloadFor - dt);
  p.fireFor = Math.max(0, p.fireFor - dt);
  p.meleeFor = Math.max(0, p.meleeFor - dt);
  if (input.pressed.has('KeyR') && p.reloadFor <= 0 && p.ammo < MAG_SIZE && p.reserve > 0) startReload(G);
  const wx = G.camera.x + input.mouse.x, wy = G.camera.y + input.mouse.y;
  p.aimAngle = Math.atan2(wy - p.y, wx - p.x);
  if (input.mouse.down && p.fireFor <= 0 && p.reloadFor <= 0) {
    if (p.ammo <= 0) {
      G.audio.dryFire();
      p.fireFor = 0.3;
      if (p.reserve > 0) startReload(G);
    } else {
      p.ammo -= 1;
      p.fireFor = 0.21;
      const spread = (G.rng() - 0.5) * 0.05;
      const a = p.aimAngle + spread;
      G.bullets.push({ x: p.x + Math.cos(p.aimAngle) * 16, y: p.y + Math.sin(p.aimAngle) * 16, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, life: 0.85, from: 'player', dmg: 17 });
      G.audio.gunshot();
      scarePeds(G, p.x, p.y, 300);
      G.policeReport('gunshot');
      p.recoil = 1;
    }
  }
  if (input.pressed.has('KeyF') && p.meleeFor <= 0) {
    p.meleeFor = 0.42;
    p.meleeSwing = 1;
    G.audio.hit();
    for (const g of G.guards) {
      if (dist(p.x, p.y, g.x, g.y) < 40 && Math.abs(angDiff(g, p)) > -1) hurtGuard(G, g, 15, p.aimAngle);
    }
    for (const ped of G.peds) {
      if (dist(p.x, p.y, ped.x, ped.y) < 36) {
        scarePeds(G, p.x, p.y, 200);
        G.policeReport('assault');
      }
    }
  }
}

function angDiff(a, b) { return Math.atan2(a.y - b.y, a.x - b.x); }

function startReload(G) {
  const p = G.player;
  p.reloadFor = 1.05;
  G.audio.reload();
  p.reloadDone = true;
}

function finishReloadIfDue(G) {
  const p = G.player;
  if (p.reloadDone && p.reloadFor <= 0) {
    const take = Math.min(MAG_SIZE - p.ammo, p.reserve);
    p.ammo += take; p.reserve -= take;
    p.reloadDone = false;
  }
}

export function hurtGuard(G, g, dmg, angle) {
  g.hp -= dmg;
  g.hitFlash = 0.15;
  g.state = 'chase';
  g.x += Math.cos(angle) * 5;
  g.y += Math.sin(angle) * 5;
  if (g.hp <= 0 && !g.dead) {
    g.dead = true;
    G.policeReport('guardDown');
    G.player.money += 15; // his wallet. Mara is not proud of it.
  }
}

/** Guard brains: hold a post, chase on sight or damage, keep a shooting distance, fire in bursts. */
export function updateGuards(G, dt) {
  const p = G.player;
  for (let i = G.guards.length - 1; i >= 0; i -= 1) {
    const g = G.guards[i];
    if (g.dead) { G.guards.splice(i, 1); continue; }
    g.hitFlash = Math.max(0, g.hitFlash - dt);
    g.phase += dt * (g.speed > 0 ? 10 : 2);
    const target = p.car ? p.car : p;
    const d = dist(g.x, g.y, target.x, target.y);
    const sees = d < 250 && !lineOfSightBlocked(g.x, g.y, target.x, target.y);
    if (g.state === 'idle' && sees && !p.dead) g.state = 'chase';
    // Leash: a guard who has been dragged far from his post, or left far behind, gives up
    // and drifts back — otherwise one alerted guard would hunt Mara across the whole map
    // for the rest of the run, long after his job ended.
    if (g.state === 'chase' && (dist(g.x, g.y, g.post.x, g.post.y) > 760 || d > 950)) g.state = 'idle';
    if (g.state === 'chase' && !p.dead) {
      const want = Math.atan2(target.y - g.y, target.x - g.x);
      g.angle = angleLerp(g.angle, want, Math.min(1, 8 * dt));
      if (d > 132) {
        g.x += Math.cos(want) * 128 * dt;
        g.y += Math.sin(want) * 128 * dt;
        g.speed = 128;
      } else if (d < 84) {
        g.x -= Math.cos(want) * 80 * dt;
        g.y -= Math.sin(want) * 80 * dt;
        g.speed = 80;
      } else g.speed = 0;
      collideCircle(g, 10);
      g.shootAt -= dt;
      if (sees && d < 240 && g.shootAt <= 0) {
        g.shootAt = 1.05 + G.rng() * 0.5;
        const a = want + (G.rng() - 0.5) * 0.16;
        G.bullets.push({ x: g.x + Math.cos(want) * 15, y: g.y + Math.sin(want) * 15, vx: Math.cos(a) * 540, vy: Math.sin(a) * 540, life: 0.7, from: 'guard', dmg: 7 });
        G.audio.gunshot();
      }
    } else {
      // Drift back to the post.
      const dp = dist(g.x, g.y, g.post.x, g.post.y);
      if (dp > 8) {
        const a = Math.atan2(g.post.y - g.y, g.post.x - g.x);
        g.x += Math.cos(a) * 55 * dt; g.y += Math.sin(a) * 55 * dt;
        g.angle = angleLerp(g.angle, a, Math.min(1, 6 * dt));
        g.speed = 55;
      } else g.speed = 0;
    }
  }
}

/** Bullets fly, hit walls, cars, guards, pedestrians and the player. */
export function updateBullets(G, dt) {
  finishReloadIfDue(G);
  const p = G.player;
  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    b.life -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    let dead = b.life <= 0;
    if (!dead && pointBlocked(b.x, b.y, -2)) dead = true;
    if (!dead && b.from === 'player') {
      for (const g of G.guards) {
        if (!g.dead && dist(b.x, b.y, g.x, g.y) < 13) { hurtGuard(G, g, b.dmg, Math.atan2(b.vy, b.vx)); dead = true; break; }
      }
      if (!dead) for (const v of G.vehicles) {
        if (dist(b.x, b.y, v.x, v.y) < v.h + 8) {
          if (v.kind === 'police') G.policeReport('hitPoliceCar');
          dead = true; break;
        }
      }
      if (!dead) for (const ped of G.peds) {
        if (dist(b.x, b.y, ped.x, ped.y) < 10) { scarePeds(G, b.x, b.y, 260); G.policeReport('assault'); dead = true; break; }
      }
    }
    if (!dead && b.from === 'guard' && !p.dead) {
      const target = p.car || p;
      const rr = p.car ? p.car.h + 8 : 12;
      if (dist(b.x, b.y, target.x, target.y) < rr) {
        hurtPlayer(G, b.dmg);
        dead = true;
      }
    }
    if (dead) G.bullets.splice(i, 1);
  }
  p.recoil = Math.max(0, (p.recoil || 0) - dt * 5);
  p.meleeSwing = Math.max(0, (p.meleeSwing || 0) - dt * 3);
}

/** Damage to Mara, with a fair floor of knockback-free fairness: death is handled by main. */
export function hurtPlayer(G, dmg) {
  const p = G.player;
  if (p.dead) return;
  p.hp -= dmg;
  p.hurtFlash = 0.25;
  G.audio.hit();
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = 'wasted';
    G.audio.fail();
  }
}
