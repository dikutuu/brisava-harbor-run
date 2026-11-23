// Everything drawn over the world: the HUD (health, stamina, ammo, money, wanted stars and
// their seen/searching state, objective text with distance, speed, contextual hints, toasts),
// the following minimap, the full city map, and all the menu screens — start, pause,
// controls, audio, shop, busted/wasted, mission failed and story complete. Buttons register
// their rectangles on G.buttons as they draw; the boot module turns clicks into actions.

import {
  DISTRICTS, H_ROADS, PLACES, PROMENADE_Y, ROAD_HALF, SAND_Y, SEA_Y, V_ROADS,
  WORLD_H, WORLD_W, dist, districtAt,
} from './world.js';
import { SHOP_ITEMS } from './player.js';

function panel(ctx, x, y, w, h, alpha = 0.55) {
  ctx.fillStyle = `rgba(12,16,22,${alpha})`;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 9); ctx.fill();
}

function bar(ctx, x, y, w, h, ratio, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, (w - 3) * Math.min(1, ratio), h - 3, (h - 3) / 2); ctx.fill();
  }
}

function button(ctx, G, x, y, w, h, label, action, opts = {}) {
  const hover = G.input.mouse.x >= x && G.input.mouse.x <= x + w && G.input.mouse.y >= y && G.input.mouse.y <= y + h;
  ctx.fillStyle = opts.disabled ? 'rgba(40,44,52,0.85)' : hover ? 'rgba(255,211,77,0.92)' : 'rgba(16,22,30,0.88)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = opts.disabled ? '#7d838c' : hover ? '#1c1a12' : '#f2ead8';
  ctx.font = `600 ${opts.size || 19}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + (opts.size || 19) * 0.36);
  if (!opts.disabled) G.buttons.push({ x, y, w, h, action });
  return hover;
}

/* ---------- the city map: static art painted once, blips drawn per frame ---------- */

const MAP_SCALE = 0.5;
let mapCanvas = null;

/** The whole city as map art, painted once from the same world data the physics uses:
    dark district blocks, light street bands, green park, the sand strip and the sea.
    Both maps blit this and draw only their dynamic blips per frame. */
function cityMap() {
  if (mapCanvas) return mapCanvas;
  const cv = document.createElement('canvas');
  cv.width = WORLD_W * MAP_SCALE;
  cv.height = WORLD_H * MAP_SCALE;
  const c = cv.getContext('2d');
  c.scale(MAP_SCALE, MAP_SCALE);
  for (const d of DISTRICTS) { c.fillStyle = d.mapGround; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); }
  c.fillStyle = '#3f7040'; c.fillRect(2726, 326, 508, 508); // Ridgeview park lawn
  c.fillStyle = '#8a7a52'; c.fillRect(926, 326, 508, 508); // market plaza
  c.fillStyle = '#596065'; c.fillRect(1526, 1526, 1708, 508); // dock yard concrete
  c.fillStyle = '#596065'; c.fillRect(926, 1710, 508, 180); // garage forecourt
  c.fillStyle = '#d9c48d'; c.fillRect(0, SAND_Y, WORLD_W, SEA_Y - SAND_Y); // the sand strip
  c.fillStyle = '#2b6ea8'; c.fillRect(0, SEA_Y, WORLD_W, WORLD_H - SEA_Y); // the sea
  // Streets: light bands over the dark blocks, the promenade included.
  c.fillStyle = '#c9ced4';
  for (const cx of V_ROADS) c.fillRect(cx - ROAD_HALF, 0, ROAD_HALF * 2, PROMENADE_Y + ROAD_HALF);
  for (const cy of [...H_ROADS, PROMENADE_Y]) c.fillRect(0, cy - ROAD_HALF, WORLD_W, ROAD_HALF * 2);
  c.strokeStyle = 'rgba(70,76,84,0.45)';
  c.lineWidth = 3;
  c.setLineDash([30, 34]);
  c.beginPath();
  for (const cx of V_ROADS) { c.moveTo(cx, 6); c.lineTo(cx, PROMENADE_Y); }
  for (const cy of [...H_ROADS, PROMENADE_Y]) { c.moveTo(6, cy); c.lineTo(WORLD_W - 6, cy); }
  c.stroke();
  mapCanvas = cv;
  return cv;
}

/** A round map badge with a letter in it (the garage's G). */
function letterBadge(ctx, x, y, r, fill, letter) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
  ctx.strokeStyle = 'rgba(10,12,16,0.85)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#14161c';
  ctx.font = `800 ${Math.round(r * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(letter, x, y + r * 0.48);
}

/** A round map badge with a tiny house glyph (the safehouse). */
function houseBadge(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
  ctx.strokeStyle = 'rgba(10,12,16,0.85)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#12240f';
  const s = r * 0.6;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.05); ctx.lineTo(x, y - s * 0.85); ctx.lineTo(x + s, y + s * 0.05);
  ctx.lineTo(x + s * 0.7, y + s * 0.05); ctx.lineTo(x + s * 0.7, y + s * 0.8);
  ctx.lineTo(x - s * 0.7, y + s * 0.8); ctx.lineTo(x - s * 0.7, y + s * 0.05);
  ctx.closePath(); ctx.fill();
}

/** The player arrow, pointing along `angle`, with a dark edge so it reads on any ground. */
function playerArrow(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(10,12,16,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(size, 0); ctx.lineTo(-size * 0.72, -size * 0.62); ctx.lineTo(-size * 0.72, size * 0.62);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

const MINIMAP_R = 72;
const MINIMAP_VIEW = 460; // world units from Mara to the ring

/** The following minimap: a north-up circular window on the city map, centred on
    Mara. Blips outside the window ride the ring, the way city maps do; while she is
    wanted the ring itself flashes the law's red and blue. */
export function drawMinimap(ctx, G, cx, cy) {
  const p = G.player;
  const scale = MINIMAP_R / MINIMAP_VIEW;
  const blip = (wx, wy) => {
    const dx = (wx - p.x) * scale, dy = (wy - p.y) * scale;
    const d = Math.hypot(dx, dy);
    if (d > MINIMAP_R - 11) { const k = (MINIMAP_R - 11) / d; return { x: cx + dx * k, y: cy + dy * k }; }
    return { x: cx + dx, y: cy + dy };
  };
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, MINIMAP_R + 5, 0, 6.29);
  ctx.fillStyle = 'rgba(10,13,18,0.78)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, MINIMAP_R, 0, 6.29); ctx.clip();
  ctx.fillStyle = '#22303c';
  ctx.fillRect(cx - MINIMAP_R, cy - MINIMAP_R, MINIMAP_R * 2, MINIMAP_R * 2);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-p.x, -p.y);
  ctx.drawImage(cityMap(), 0, 0, WORLD_W, WORLD_H);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, MINIMAP_R, 0, 6.29); ctx.clip();
  const og = blip(PLACES.garage.x, PLACES.garage.y);
  letterBadge(ctx, og.x, og.y, 8, '#ffd34d', 'G');
  const sh = blip(PLACES.safehouse.x, PLACES.safehouse.y);
  houseBadge(ctx, sh.x, sh.y, 8, '#7dd87d');
  if (G.policeState.wanted > 0) {
    for (const v of G.vehicles) {
      if (v.kind !== 'police') continue;
      const s = blip(v.x, v.y);
      ctx.fillStyle = '#5b8cff';
      ctx.beginPath(); ctx.arc(s.x, s.y, 4.4, 0, 6.29); ctx.fill();
      ctx.strokeStyle = '#eaf1ff'; ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
  for (const g of G.guards) {
    if (g.state !== 'chase') continue;
    const s = blip(g.x, g.y);
    ctx.fillStyle = '#ff5b4d';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.4, 0, 6.29); ctx.fill();
  }
  const marker = G.missionsApi.objectiveMarker();
  if (marker) {
    const s = blip(marker.x, marker.y);
    const pulse = 7.4 + Math.sin(G.time * 5) * 1.5;
    ctx.fillStyle = '#ffdf4d';
    ctx.beginPath(); ctx.arc(s.x, s.y, pulse, 0, 6.29); ctx.fill();
    ctx.strokeStyle = 'rgba(20,18,8,0.9)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#14161c';
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.3, 0, 6.29); ctx.fill();
  }
  playerArrow(ctx, cx, cy, p.angle, 8.5);
  ctx.restore();
  // The ring: quiet cream at peace, flashing red/blue while the law is looking.
  ctx.beginPath(); ctx.arc(cx, cy, MINIMAP_R + 2.5, 0, 6.29);
  if (G.policeState.wanted > 0) {
    ctx.strokeStyle = Math.floor(G.time * 2.4) % 2 === 0 ? 'rgba(255,74,54,0.9)' : 'rgba(84,132,255,0.9)';
    ctx.lineWidth = 4;
  } else {
    ctx.strokeStyle = 'rgba(240,234,216,0.8)';
    ctx.lineWidth = 2;
  }
  ctx.stroke();
  // North, fixed at the top of the ring — the map never rotates, Mara's arrow does.
  ctx.fillStyle = '#f2ead8';
  ctx.font = '800 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - MINIMAP_R + 14);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(districtAt(p.x, p.y).name, cx, cy + MINIMAP_R + 15);
}

/* District announcements: crossing into a new district raises its name in big
   letters at the lower right, once per crossing, fading after about 2.5 s. */
let lastDistrictId = null;
let announceName = '';
let announceAt = -99;

function drawDistrictAnnouncement(ctx, G, w, h) {
  if (G.mode !== 'play') return;
  const d = districtAt(G.player.x, G.player.y);
  if (lastDistrictId === null) { lastDistrictId = d.id; return; }
  if (d.id !== lastDistrictId) {
    lastDistrictId = d.id;
    announceName = d.name;
    announceAt = G.time;
  }
  const t = G.time - announceAt;
  if (!announceName || t > 2.5) return;
  const alpha = Math.min(1, t / 0.25) * Math.min(1, (2.5 - t) / 0.6);
  const label = announceName.toUpperCase();
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.textAlign = 'right';
  ctx.font = '800 31px system-ui, sans-serif';
  try { ctx.letterSpacing = '5px'; } catch { /* a canvas without tracking still reads fine */ }
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#f5efe0';
  ctx.fillText(label, w - 24, h - 238);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd34d';
  const tw = ctx.measureText(label).width;
  ctx.fillRect(w - 24 - tw, h - 224, tw, 3);
  ctx.restore();
}

export function drawHUD(ctx, G, w, h) {
  const p = G.player;
  // Camera mode, top left (3D view only): which of Chase / Top / Street is live, and its key.
  if (G.viewMode) {
    ctx.font = '600 12.5px system-ui, sans-serif';
    const label = `CAMERA: ${G.viewMode} (C)`;
    const lw = ctx.measureText(label).width + 22;
    panel(ctx, 16, 14, lw, 26, 0.5);
    ctx.fillStyle = '#f2ead8';
    ctx.textAlign = 'left';
    ctx.fillText(label, 27, 31);
  }
  // Objective, top centre, with the distance to its marker.
  const objective = G.missionsApi.objectiveText();
  ctx.font = '600 16px system-ui, sans-serif';
  const ow = Math.min(w - 340, ctx.measureText(objective).width + 74);
  panel(ctx, (w - ow) / 2, 14, ow, 40);
  ctx.fillStyle = '#ffd34d';
  ctx.textAlign = 'center';
  const marker = G.missionsApi.objectiveMarker();
  const distText = marker ? ` · ${Math.round(dist(p.x, p.y, marker.x, marker.y))}m` : '';
  ctx.fillText(objective + distText, w / 2, 40);
  // Health and stamina, bottom left.
  bar(ctx, 22, h - 58, 210, 15, p.hp / p.maxHp, p.hp > 30 ? '#58c96b' : '#d94f3d');
  bar(ctx, 22, h - 38, 210, 9, p.stamina / 100, '#e8c84a');
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MARA', 24, h - 66);
  // Money and wanted, top right.
  ctx.font = '700 21px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fe388';
  ctx.fillText(`$${p.money}`, w - 24, 40);
  const P = G.policeState;
  if (P.wanted > 0 || P.bust > 0) {
    ctx.font = '21px system-ui, sans-serif';
    let stars = '';
    for (let i = 0; i < 3; i += 1) stars += i < P.wanted ? '★' : '☆';
    ctx.fillStyle = P.seenNow ? '#ff6b57' : '#ffd34d';
    ctx.fillText(stars, w - 24, 68);
    ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.fillStyle = '#f2ead8';
    ctx.fillText(P.mode === 'pursue' ? 'SEEN — run!' : P.mode === 'search' ? 'SEARCHING — stay hidden' : P.mode === 'investigate' ? 'REPORTED' : '', w - 24, 88);
  }
  if (P.bust > 0.02) {
    const bw = 190;
    panel(ctx, (w - bw) / 2, 64, bw, 22);
    ctx.fillStyle = '#d94f3d';
    ctx.fillRect((w - bw) / 2 + 4, 68, (bw - 8) * P.bust, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED', w / 2, 79);
  }
  // Ammo / vehicle state, bottom right above the minimap.
  ctx.textAlign = 'right';
  if (p.car) {
    ctx.fillStyle = '#f2ead8';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText(`${Math.round(Math.abs(p.car.speed) * 0.36)} km/h`, w - 24, h - 196);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(p.car.def.name + (p.car.wrecked ? ' — WRECKED' : ''), w - 24, h - 176);
    bar(ctx, w - 224, h - 166, 200, 8, p.car.hp / p.car.maxHp, '#7db8d9');
  } else {
    ctx.fillStyle = p.ammo === 0 ? '#ff6b57' : '#f2ead8';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText(`🔫 ${p.ammo} / ${p.reserve}`, w - 24, h - 196);
    if (p.reloadFor > 0) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('RELOADING…', w - 24, h - 176);
    }
  }
  drawMinimap(ctx, G, w - 102, h - 92);
  // Contextual hint, bottom centre.
  const hint = G.hintText;
  if (hint) {
    ctx.font = '600 14.5px system-ui, sans-serif';
    const hw = ctx.measureText(hint).width + 30;
    panel(ctx, (w - hw) / 2, h - 40, hw, 28, 0.5);
    ctx.fillStyle = '#f2ead8';
    ctx.textAlign = 'center';
    ctx.fillText(hint, w / 2, h - 21);
  }
  // Toast.
  if (G.toast && G.time - G.toastAt < 4.2) {
    ctx.font = '600 16.5px system-ui, sans-serif';
    const tw = ctx.measureText(G.toast).width + 36;
    panel(ctx, (w - tw) / 2, 108, tw, 34, 0.66);
    ctx.fillStyle = '#ffe9a8';
    ctx.textAlign = 'center';
    ctx.fillText(G.toast, w / 2, 130);
  }
  // Hurt vignette.
  if (p.hurtFlash > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.36, w / 2, h / 2, h * 0.75);
    g.addColorStop(0, 'rgba(180,20,10,0)');
    g.addColorStop(1, `rgba(180,20,10,${0.4 * p.hurtFlash})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  drawDistrictAnnouncement(ctx, G, w, h);
}

export function drawBigMap(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.93)';
  ctx.fillRect(0, 0, w, h);
  const mw = Math.min(w - 120, 980, (h - 190) * (WORLD_W / WORLD_H));
  const mh = mw * (WORLD_H / WORLD_W);
  const x = (w - mw) / 2, y = (h - mh) / 2 - 8;
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  ctx.drawImage(cityMap(), x, y, mw, mh);
  ctx.strokeStyle = 'rgba(240,234,216,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, mw, mh);
  // District names in spaced capitals over each quarter of the city.
  ctx.textAlign = 'center';
  ctx.font = '800 19px system-ui, sans-serif';
  try { ctx.letterSpacing = '3px'; } catch { /* cosmetic only */ }
  for (const d of DISTRICTS) {
    const lx = x + (d.x0 + d.x1) / 2 * sx, ly = y + (d.y0 + d.y1) / 2 * sy;
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.fillText(d.name.toUpperCase(), lx + 1.5, ly + 1.5);
    ctx.fillStyle = 'rgba(245,239,224,0.92)';
    ctx.fillText(d.name.toUpperCase(), lx, ly);
  }
  try { ctx.letterSpacing = '0px'; } catch { /* cosmetic only */ }
  // Places, with their names beside them.
  const label = (wx, wy, text) => {
    ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(10,12,16,0.6)';
    ctx.fillText(text, x + wx * sx + 13.5, y + wy * sy + 4.5);
    ctx.fillStyle = '#f2ead8';
    ctx.fillText(text, x + wx * sx + 12, y + wy * sy + 3);
  };
  const om = G.missionsApi.objectiveMarker();
  letterBadge(ctx, x + PLACES.garage.x * sx, y + PLACES.garage.y * sy, 9, '#ffd34d', 'G');
  // When the objective IS the garage, its label already says where to go.
  if (!om || Math.hypot(om.x - PLACES.garage.x, om.y - PLACES.garage.y) > 90) {
    label(PLACES.garage.x, PLACES.garage.y, "Eli's Garage");
  }
  houseBadge(ctx, x + PLACES.safehouse.x * sx, y + PLACES.safehouse.y * sy, 9, '#7dd87d');
  label(PLACES.safehouse.x, PLACES.safehouse.y, 'Safehouse');
  if (om) {
    const ox = x + om.x * sx, oy = y + om.y * sy;
    const pulse = 8.6 + Math.sin(G.time * 5) * 1.7;
    ctx.fillStyle = '#ffdf4d';
    ctx.beginPath(); ctx.arc(ox, oy, pulse, 0, 6.29); ctx.fill();
    ctx.strokeStyle = 'rgba(20,18,8,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#14161c';
    ctx.beginPath(); ctx.arc(ox, oy, 2.6, 0, 6.29); ctx.fill();
    label(om.x, om.y, 'Objective');
  }
  if (G.policeState.wanted > 0) {
    for (const v of G.vehicles) {
      if (v.kind !== 'police') continue;
      ctx.fillStyle = '#5b8cff';
      ctx.beginPath(); ctx.arc(x + v.x * sx, y + v.y * sy, 5, 0, 6.29); ctx.fill();
      ctx.strokeStyle = '#eaf1ff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  playerArrow(ctx, x + G.player.x * sx, y + G.player.y * sy, G.player.angle, 11);
  // Legend, lower left over the water.
  const lx = x + 12, ly = y + mh - 144;
  panel(ctx, lx, ly, 184, 132, 0.88);
  ctx.textAlign = 'left';
  ctx.font = '600 12.5px system-ui, sans-serif';
  const row = (i, drawIcon, text) => {
    drawIcon(lx + 16, ly + 20 + i * 24);
    ctx.textAlign = 'left'; // the badge helpers centre their glyph and leave align centred
    ctx.fillStyle = '#f2ead8';
    ctx.fillText(text, lx + 32, ly + 24 + i * 24);
  };
  row(0, (ix, iy) => { ctx.fillStyle = '#ffdf4d'; ctx.beginPath(); ctx.arc(ix, iy - 4, 6, 0, 6.29); ctx.fill(); }, 'Objective');
  row(1, (ix, iy) => letterBadge(ctx, ix, iy - 4, 7.5, '#ffd34d', 'G'), "Eli's Garage");
  row(2, (ix, iy) => houseBadge(ctx, ix, iy - 4, 7.5, '#7dd87d'), 'Safehouse');
  row(3, (ix, iy) => { ctx.fillStyle = '#5b8cff'; ctx.beginPath(); ctx.arc(ix, iy - 4, 5.4, 0, 6.29); ctx.fill(); ctx.strokeStyle = '#eaf1ff'; ctx.lineWidth = 1.3; ctx.stroke(); }, 'Police');
  row(4, (ix, iy) => playerArrow(ctx, ix, iy - 4, -Math.PI / 2, 7), 'Mara (you)');
  // Title, then where Mara stands and what she is chasing.
  ctx.fillStyle = '#f2ead8';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BRISAVA', w / 2, y - 20);
  const here = districtAt(G.player.x, G.player.y);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(`${here.name} — ${here.blurb}`, w / 2, y + mh + 30);
  ctx.fillStyle = '#ffd34d';
  ctx.font = '600 14.5px system-ui, sans-serif';
  ctx.fillText(`Objective: ${G.missionsApi.objectiveText()}`, w / 2, y + mh + 54);
  ctx.fillStyle = 'rgba(242,234,216,0.75)';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('M or Esc — back to the streets', w / 2, y + mh + 76);
}

function titleBlock(ctx, w, title, sub) {
  ctx.fillStyle = '#ffd34d';
  ctx.font = '800 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, 150);
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.fillText(sub, w / 2, 184);
}

export function drawMenu(ctx, G, w, h, hasSaveGame) {
  ctx.fillStyle = 'rgba(10,14,20,0.45)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'BRISAVA: HARBOR RUN', 'One driver. One garage in debt. One port that cheats.');
  const bw = 300, bx = (w - bw) / 2;
  let y = 250;
  button(ctx, G, bx, y, bw, 50, 'New Game', 'new'); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Continue', 'continue', { disabled: !hasSaveGame }); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Controls', 'controls'); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Audio', 'audio'); y += 64;
  ctx.fillStyle = 'rgba(242,234,216,0.8)';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Mara Venn drives for Eli Rook. Meridian Quay rigs the port. Time to even the books.', w / 2, y + 26);
  ctx.fillStyle = 'rgba(255,233,168,0.9)';
  ctx.fillText('Now in 3D — press C for Chase / Top / Street cameras. A friendly story: generous timers, gentle guards, made to be finished.', w / 2, y + 50);
}

export function drawPause(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'PAUSED', G.missionsApi.objectiveText());
  const bw = 300, bx = (w - bw) / 2;
  let y = 250;
  button(ctx, G, bx, y, bw, 50, 'Resume', 'resume'); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Restart Mission', 'restart', { disabled: !G.missionsApi.state.active }); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Controls', 'controls'); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Audio', 'audio'); y += 64;
  button(ctx, G, bx, y, bw, 50, 'Main Menu', 'menu'); y += 64;
}

export function drawControls(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.9)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'CONTROLS', 'Everything Mara can do');
  const rows = [
    ['WASD / Arrows', 'Move · drive'],
    ['Shift', 'Sprint (stamina)'],
    ['Mouse', 'Aim — hold + drag to move the aim anchor · click / hold to shoot'],
    ['F', 'Melee'], ['R', 'Reload'],
    ['E', 'Interact · enter / exit a car · take a job'],
    ['C', 'Camera: Chase / Top / Street (3D view)'],
    ['Space', 'Handbrake (in a car)'], ['H', 'Horn'],
    ['B', 'Garage shop (at the counter)'], ['J', 'Delivery job (at the garage)'],
    ['M', 'City map'], ['Esc', 'Pause'],
  ];
  ctx.font = '600 16.5px system-ui, sans-serif';
  let y = 226;
  for (const [k, v] of rows) {
    ctx.fillStyle = '#ffd34d'; ctx.textAlign = 'right'; ctx.fillText(k, w / 2 - 16, y);
    ctx.fillStyle = '#f2ead8'; ctx.textAlign = 'left'; ctx.fillText(v, w / 2 + 16, y);
    y += 29;
  }
  ctx.fillStyle = 'rgba(255,233,168,0.9)';
  ctx.font = '600 14.5px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('The story is tuned to be friendly — big targets, a long clock, soft-hearted guards.', w / 2, y + 12);
  button(ctx, G, (w - 220) / 2, y + 26, 220, 48, 'Back', 'back');
}

export function drawAudio(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.9)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'AUDIO', 'All sounds are synthesized live — no audio files');
  const s = G.audio.settings;
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Volume: ${Math.round(s.volume * 100)}%${s.muted ? ' (muted)' : ''}`, w / 2, 268);
  const bw = 190, gap = 16, total = bw * 3 + gap * 2, bx = (w - total) / 2;
  button(ctx, G, bx, 300, bw, 48, 'Volume −', 'vol-down');
  button(ctx, G, bx + bw + gap, 300, bw, 48, 'Volume +', 'vol-up');
  button(ctx, G, bx + (bw + gap) * 2, 300, bw, 48, s.muted ? 'Unmute' : 'Mute', 'mute');
  button(ctx, G, (w - 220) / 2, 380, 220, 48, 'Back', 'back');
}

export function drawShop(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.78)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, "ELI'S GARAGE", `Your money: $${G.player.money} · press 1–3 to buy · Esc to leave`);
  ctx.font = '600 18px system-ui, sans-serif';
  let y = 250;
  SHOP_ITEMS.forEach((item, i) => {
    const owned = item.key === 'Digit3' && G.upgrades.turbo;
    ctx.fillStyle = '#ffd34d'; ctx.textAlign = 'right';
    ctx.fillText(`${i + 1}. ${item.name}`, w / 2 - 12, y);
    ctx.fillStyle = owned ? '#7dd87d' : '#f2ead8'; ctx.textAlign = 'left';
    ctx.fillText(owned ? 'FITTED' : `$${item.price}`, w / 2 + 12, y);
    y += 38;
  });
  ctx.fillStyle = 'rgba(242,234,216,0.85)';
  ctx.font = '14.5px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Repairs apply to the last car you drove (or the nearest one). Turbo is forever.', w / 2, y + 12);
}

export function drawOver(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(20,6,6,0.78)';
  ctx.fillRect(0, 0, w, h);
  const busted = G.player.dead === 'busted';
  titleBlock(ctx, w, busted ? 'BUSTED' : 'WASTED', busted ? 'The BPD takes you in. It costs you.' : 'Mara wakes up at the safehouse, lighter one wallet.');
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Penalty paid: $${G.deathPenalty || 0}${G.missionsApi.state.active ? ' · the mission restarts from its checkpoint' : ''}`, w / 2, 240);
  button(ctx, G, (w - 260) / 2, 290, 260, 52, G.missionsApi.state.active ? 'Retry Mission' : 'Continue', 'respawn');
}

export function drawFailed(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(20,10,6,0.78)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'MISSION FAILED', G.missionFailed ? G.missionFailed.title : '');
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(G.missionFailed ? G.missionFailed.reason : '', w / 2, 244);
  button(ctx, G, (w - 260) / 2, 296, 260, 52, 'Retry Mission', 'retry-mission');
}

export function drawComplete(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,16,12,0.82)';
  ctx.fillRect(0, 0, w, h);
  titleBlock(ctx, w, 'HARBOR RUN COMPLETE', 'The ledger is public, the yard is quiet, and the garage is out of debt.');
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Mara's money: $${G.player.money} · Deliveries done: ${G.sideJobsDone || 0} · Turbo: ${G.upgrades.turbo ? 'fitted' : 'not fitted'}`, w / 2, 250);
  ctx.fillText('Brisava is yours now — free roam, deliveries at the garage (J), and the whole map to burn rubber on.', w / 2, 284);
  button(ctx, G, (w - 260) / 2, 330, 260, 52, 'Free Roam', 'freeroam');
}
