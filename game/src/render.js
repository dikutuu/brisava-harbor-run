// The 2.5D look: a top-down city with lifted roofs. Buildings are drawn as a footprint
// extruded up-left (shadow, two shaded faces, a roof with detail), everything solid is
// y-sorted against the people and cars so Mara can walk "behind" a building — and a building
// she stands behind fades, so she is never hidden unfairly. Ground, roads, the promenade and
// the sea come from the same world data the physics uses.

import {
  DISTRICTS, H_ROADS, PLACES, PROMENADE_Y, SAND_Y, SEA_Y, V_ROADS, WORLD_H, WORLD_W,
  districtAt, solids, stalls, trees,
} from './world.js';

function shade(hex, f) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function drawGround(ctx, G) {
  const cam = G.camera;
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(Math.max(d.x0, cam.x), Math.max(d.y0, cam.y), Math.min(d.x1, cam.x + cam.w) - Math.max(d.x0, cam.x), Math.min(d.y1, cam.y + cam.h) - Math.max(d.y0, cam.y));
  }
  // Park lawn and market plaza paving (decorative, matching the landmark blocks).
  ctx.fillStyle = '#639657';
  ctx.fillRect(2726, 326, 508, 508);
  ctx.fillStyle = '#c2a878';
  ctx.fillRect(926, 326, 508, 508);
  ctx.fillStyle = '#a8a29a';
  ctx.fillRect(1526, 1526, 1708, 508); // dock yard concrete
  ctx.fillStyle = '#d8c49a';
  ctx.fillRect(926, 1710, 508, 180); // garage forecourt
  // Sand and sea.
  ctx.fillStyle = '#ecd9a8';
  ctx.fillRect(0, SAND_Y, WORLD_W, SEA_Y - SAND_Y);
  const grad = ctx.createLinearGradient(0, SEA_Y, 0, WORLD_H);
  grad.addColorStop(0, '#2e9db4');
  grad.addColorStop(1, '#166e8c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, SEA_Y, WORLD_W, WORLD_H - SEA_Y);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < WORLD_W; x += 90) {
    const y = SEA_Y + 26 + Math.sin(G.time * 1.3 + x * 0.05) * 5;
    ctx.moveTo(x, y); ctx.lineTo(x + 44, y);
  }
  ctx.stroke();
  // Roads: asphalt with pavement edges and dashed centre lines.
  ctx.fillStyle = '#565d66';
  for (const cx of V_ROADS) ctx.fillRect(cx - 58, 0, 116, PROMENADE_Y + 58);
  for (const cy of [...H_ROADS, PROMENADE_Y]) ctx.fillRect(0, cy - 58, WORLD_W, 116);
  ctx.fillStyle = '#4a5058';
  for (const cx of V_ROADS) ctx.fillRect(cx - 46, 0, 92, PROMENADE_Y + 46);
  for (const cy of [...H_ROADS, PROMENADE_Y]) ctx.fillRect(0, cy - 46, WORLD_W, 92);
  ctx.strokeStyle = 'rgba(240,230,190,0.55)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 30]);
  ctx.beginPath();
  for (const cx of V_ROADS) { ctx.moveTo(cx, 8); ctx.lineTo(cx, PROMENADE_Y); }
  for (const cy of [...H_ROADS, PROMENADE_Y]) { ctx.moveTo(8, cy); ctx.lineTo(WORLD_W - 8, cy); }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBuilding(ctx, G, b) {
  const lift = b.height;
  const px = G.player.x, py = G.player.y;
  const playerBehind = !G.player.car && px > b.x - 14 && px < b.x + b.w + 14 && py < b.y + b.h && py > b.y - 46;
  ctx.save();
  if (playerBehind) ctx.globalAlpha = 0.32;
  ctx.fillStyle = 'rgba(30,25,20,0.20)';
  ctx.fillRect(b.x + 9, b.y + 12, b.w, b.h);
  // South and east faces, then the lifted roof.
  ctx.fillStyle = shade(b.color, 0.62);
  ctx.fillRect(b.x, b.y + b.h - lift, b.w, lift);
  ctx.fillStyle = shade(b.color, 0.78);
  ctx.fillRect(b.x + b.w - lift * 0.6, b.y, lift * 0.6, b.h);
  ctx.fillStyle = b.color;
  ctx.fillRect(b.x, b.y, b.w, b.h - lift);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, Math.max(2, b.h - lift - 12));
  if (b.kind === 'garage') {
    ctx.fillStyle = '#37414c';
    ctx.fillRect(b.x + 18, b.y + b.h - lift - 34, b.w - 36, 30);
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("ELI'S GARAGE", b.x + b.w / 2, b.y + 26);
  } else if (b.kind === 'warehouse') {
    ctx.fillStyle = 'rgba(20,26,34,0.5)';
    for (let x = b.x + 16; x < b.x + b.w - 30; x += 46) ctx.fillRect(x, b.y + b.h - lift - 26, 30, 22);
    ctx.fillStyle = '#e8e4da';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MERIDIAN QUAY', b.x + b.w / 2, b.y + 24);
  } else if (b.kind === 'safehouse') {
    ctx.fillStyle = '#2e7d4f';
    ctx.fillRect(b.x + b.w / 2 - 11, b.y + b.h - lift - 26, 22, 26);
  } else if (b.kind === 'mural') {
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath(); ctx.arc(b.x + 70, b.y + 20, 13, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#f6f0e6';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BRISAVA', b.x + b.w / 2 + 30, b.y + 26);
  } else if (b.kind === 'container') {
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    for (let x = b.x + 12; x < b.x + b.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, b.y + 3); ctx.lineTo(x, b.y + b.h - lift - 3); ctx.stroke(); }
  }
  ctx.restore();
}

function drawVehicle(ctx, G, v) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  ctx.fillStyle = 'rgba(20,20,20,0.25)';
  ctx.fillRect(-v.w / 2 + 3, -v.h / 2 + 5, v.w, v.h);
  ctx.fillStyle = v.wrecked ? '#5a5a5c' : v.color;
  ctx.beginPath();
  ctx.roundRect(-v.w / 2, -v.h / 2, v.w, v.h, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(15,20,28,0.85)';
  ctx.fillRect(v.w * 0.08, -v.h / 2 + 3, v.w * 0.2, v.h - 6); // windshield
  ctx.fillRect(-v.w * 0.3, -v.h / 2 + 3, v.w * 0.14, v.h - 6); // rear window
  ctx.fillStyle = '#15161a';
  const ww = 8, wh = 5;
  ctx.fillRect(-v.w / 2 + 3, -v.h / 2 - 2, ww, wh);
  ctx.fillRect(v.w / 2 - ww - 3, -v.h / 2 - 2, ww, wh);
  ctx.fillRect(-v.w / 2 + 3, v.h / 2 - wh + 2, ww, wh);
  ctx.fillRect(v.w / 2 - ww - 3, v.h / 2 - wh + 2, ww, wh);
  if (v.cls === 'van') {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-v.w / 2 + 4, -v.h / 2 + 4, v.w * 0.5, v.h - 8);
  }
  if (v.cls === 'cruiser') {
    ctx.fillStyle = '#eef1f4';
    ctx.fillRect(-v.w * 0.12, -v.h / 2, v.w * 0.24, v.h);
    const flash = Math.floor(G.time * 4) % 2 === 0;
    ctx.fillStyle = flash ? '#ff4444' : '#3355ff';
    ctx.fillRect(-4, -v.h / 2 + 2, 8, 5);
    ctx.fillStyle = flash ? '#3355ff' : '#ff4444';
    ctx.fillRect(-4, v.h / 2 - 7, 8, 5);
  }
  ctx.restore();
  if (v.wrecked) { // smoke column, phased by the car's id so wrecks differ
    for (let i = 0; i < 3; i += 1) {
      const t = (G.time * 0.7 + i / 3 + v.id * 0.37) % 1;
      ctx.fillStyle = `rgba(60,60,60,${0.34 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(v.x + Math.sin(t * 9 + v.id) * 6, v.y - 8 - t * 34, 5 + t * 11, 0, 6.29);
      ctx.fill();
    }
  } else if (v.hp < v.maxHp * 0.45 && G.time - v.lastHitAt < 4) {
    ctx.fillStyle = 'rgba(70,70,70,0.35)';
    ctx.beginPath(); ctx.arc(v.x, v.y - 10, 6, 0, 6.29); ctx.fill();
  }
}

function drawPerson(ctx, x, y, angle, shirt, phase, opts = {}) {
  const bob = Math.sin(phase) * 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(20,20,20,0.22)';
  ctx.beginPath(); ctx.ellipse(0, 5, 9, 4.5, 0, 0, 6.29); ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.roundRect(-5, -7 + bob * 0.2, 12, 14, 5); ctx.fill();
  ctx.fillStyle = opts.skin || '#c98d64';
  ctx.beginPath(); ctx.arc(3, bob * 0.2, 5.2, 0, 6.29); ctx.fill();
  if (opts.cap) { ctx.fillStyle = '#20304f'; ctx.beginPath(); ctx.arc(3, bob * 0.2, 5.4, Math.PI * 0.7, Math.PI * 1.9); ctx.fill(); }
  if (opts.gun) {
    ctx.strokeStyle = '#1c1e24'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(17, 2); ctx.stroke();
  }
  ctx.restore();
}

export function drawWorld(ctx, G) {
  const cam = G.camera;
  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
  drawGround(ctx, G);
  // Stalls and trees (low, drawn under the y-sorted pass).
  for (const s of stalls) {
    if (s.x + s.w < cam.x - 60 || s.x > cam.x + cam.w + 60 || s.y + s.h < cam.y - 60 || s.y > cam.y + cam.h + 60) continue;
    ctx.fillStyle = 'rgba(20,20,20,0.18)';
    ctx.fillRect(s.x + 4, s.y + 6, s.w, s.h);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x, s.y, s.w, s.h - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(s.x, s.y, s.w, 7);
  }
  // Y-sorted pass: buildings, cars, people — so everyone can pass behind a roofline.
  const items = [];
  for (const b of solids) {
    if (b.x + b.w < cam.x - 80 || b.x > cam.x + cam.w + 80 || b.y + b.h < cam.y - 80 || b.y > cam.y + cam.h + 80) continue;
    items.push({ y: b.y + b.h, draw: () => drawBuilding(ctx, G, b) });
  }
  for (const t of trees) {
    if (t.x < cam.x - 60 || t.x > cam.x + cam.w + 60 || t.y < cam.y - 60 || t.y > cam.y + cam.h + 60) continue;
    items.push({ y: t.y + 6, draw: () => {
      ctx.fillStyle = 'rgba(20,20,20,0.18)';
      ctx.beginPath(); ctx.ellipse(t.x + 5, t.y + 6, t.r, t.r * 0.4, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#7a5c38';
      ctx.fillRect(t.x - 2.5, t.y - 4, 5, 10);
      ctx.fillStyle = '#4e7d3a';
      ctx.beginPath(); ctx.arc(t.x, t.y - 6, t.r, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#5d9046';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.5, t.r * 0.62, 0, 6.29); ctx.fill();
    } });
  }
  for (const v of G.vehicles) items.push({ y: v.y + v.h, draw: () => drawVehicle(ctx, G, v) });
  for (const p of G.peds) items.push({ y: p.y + 6, draw: () => drawPerson(ctx, p.x, p.y, p.angle, p.shirt, p.phase) });
  for (const o of G.officers) items.push({ y: o.y + 6, draw: () => drawPerson(ctx, o.x, o.y, o.angle, '#2c4a7c', o.phase, { cap: true }) });
  for (const g of G.guards) {
    items.push({ y: g.y + 6, draw: () => {
      drawPerson(ctx, g.x, g.y, g.angle, g.hitFlash > 0 ? '#f2f2f2' : '#3a3f46', g.phase, { gun: true });
      if (g.hp < g.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(g.x - 13, g.y - 22, 26, 4);
        ctx.fillStyle = '#d94f3d'; ctx.fillRect(g.x - 13, g.y - 22, 26 * Math.max(0, g.hp / g.maxHp), 4);
      }
    } });
  }
  if (!G.player.car && !G.player.dead) {
    const p = G.player;
    items.push({ y: p.y + 6, draw: () => {
      drawPerson(ctx, p.x, p.y, p.aimAngle !== undefined && (G.input.mouse.down || p.recoil > 0) ? p.aimAngle : p.angle, '#1f7a8c', p.walkPhase, { gun: true, skin: '#a06a42' });
      if (p.meleeSwing > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 24, p.aimAngle - 0.7, p.aimAngle + 0.7); ctx.stroke();
      }
    } });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  // Bullets as short tracers.
  ctx.strokeStyle = '#ffd34d';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (const b of G.bullets) {
    ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // The ledger, while Market Pressure is at the grab step.
  const active = G.missionsApi.state.active;
  if (active && active.def.id === 'm3' && active.stepIndex === 1) {
    const pulse = 1 + Math.sin(G.time * 5) * 0.15;
    ctx.save();
    ctx.translate(PLACES.market.x, PLACES.market.y - 14 + Math.sin(G.time * 3) * 3);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(-9, -12, 18, 24);
    ctx.fillStyle = '#7a4d12';
    ctx.fillRect(-9, -12, 4, 24);
    ctx.restore();
  }
  // Objective marker: a bobbing diamond with a light beam, visible through the city.
  const marker = G.mode === 'play' ? G.missionsApi.objectiveMarker() : null;
  if (marker) {
    const bob = Math.sin(G.time * 3.2) * 6;
    ctx.fillStyle = 'rgba(255,211,77,0.16)';
    ctx.fillRect(marker.x - 7, marker.y - 190, 14, 190);
    ctx.save();
    ctx.translate(marker.x, marker.y - 34 + bob);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.fillStyle = '#8a6410';
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  }
  ctx.restore();
  void districtAt;
}
