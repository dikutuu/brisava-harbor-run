// Everything drawn over the world: the HUD (health, stamina, ammo, money, wanted stars and
// their seen/searching state, objective text with distance, speed, contextual hints, toasts),
// the following minimap, the full city map, and all the menu screens — start, pause,
// controls, audio, shop, busted/wasted, mission failed and story complete. Buttons register
// their rectangles on G.buttons as they draw; the boot module turns clicks into actions.

import { DISTRICTS, PLACES, SEA_Y, WORLD_H, WORLD_W, dist } from './world.js';
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

export function drawMinimap(ctx, G, x, y, w, h) {
  const sx = w / WORLD_W, sy = h / WORLD_H;
  panel(ctx, x - 6, y - 6, w + 12, h + 12, 0.6);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip();
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(x + d.x0 * sx, y + d.y0 * sy, (d.x1 - d.x0) * sx, (d.y1 - d.y0) * sy);
  }
  ctx.fillStyle = '#2e9db4';
  ctx.fillRect(x, y + SEA_Y * sy, w, (WORLD_H - SEA_Y) * sy);
  ctx.strokeStyle = 'rgba(40,44,50,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const cx of [280, 880, 1480, 2080, 2680, 3280]) { ctx.moveTo(x + cx * sx, y); ctx.lineTo(x + cx * sx, y + 2240 * sy); }
  for (const cy of [280, 880, 1480, 2080, 2240]) { ctx.moveTo(x, y + cy * sy); ctx.lineTo(x + w, y + cy * sy); }
  ctx.stroke();
  const dot = (wx, wy, color, r = 3.4) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + wx * sx, y + wy * sy, r, 0, 6.29); ctx.fill(); };
  dot(PLACES.garage.x, PLACES.garage.y, '#ffd34d');
  dot(PLACES.safehouse.x, PLACES.safehouse.y, '#7dd87d');
  const marker = G.missionsApi.objectiveMarker();
  if (marker) {
    const pulse = 3.4 + Math.sin(G.time * 5) * 1.1;
    dot(marker.x, marker.y, '#ffdf4d', pulse + 1.6);
  }
  if (G.policeState.wanted > 0) for (const v of G.vehicles) if (v.kind === 'police') dot(v.x, v.y, '#5b8cff', 3);
  for (const g of G.guards) if (g.state === 'chase') dot(g.x, g.y, '#ff5b4d', 2.6);
  // Player arrow.
  const px = x + G.player.x * sx, py = y + G.player.y * sy;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(G.player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.4); ctx.lineTo(-5, 4.4); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.fillStyle = '#f2ead8';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(districtName(G), x + 2, y + h + 16);
}

function districtName(G) {
  const names = { mercado: 'Old Mercado', ridgeview: 'Ridgeview', coast: 'Sunline Coast', docks: 'Meridian Docks' };
  const d = DISTRICTS.find((dd) => G.player.x >= dd.x0 && G.player.x < dd.x1 && G.player.y >= dd.y0 && G.player.y < dd.y1);
  return d ? names[d.id] : '';
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
  drawMinimap(ctx, G, w - 216, h - 158, 196, 142);
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
}

export function drawBigMap(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(8,12,18,0.92)';
  ctx.fillRect(0, 0, w, h);
  const mw = Math.min(w - 120, 980), mh = mw * (WORLD_H / WORLD_W);
  const x = (w - mw) / 2, y = (h - mh) / 2 + 14;
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(x + d.x0 * sx, y + d.y0 * sy, (d.x1 - d.x0) * sx, (d.y1 - d.y0) * sy);
    ctx.fillStyle = 'rgba(20,22,26,0.75)';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.name.toUpperCase(), x + (d.x0 + d.x1) / 2 * sx, y + (d.y0 + d.y1) / 2 * sy);
  }
  ctx.fillStyle = '#2e9db4';
  ctx.fillRect(x, y + SEA_Y * sy, mw, (WORLD_H - SEA_Y) * sy);
  ctx.strokeStyle = '#454b54';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const cx of [280, 880, 1480, 2080, 2680, 3280]) { ctx.moveTo(x + cx * sx, y); ctx.lineTo(x + cx * sx, y + 2240 * sy); }
  for (const cy of [280, 880, 1480, 2080, 2240]) { ctx.moveTo(x, y + cy * sy); ctx.lineTo(x + mw, y + cy * sy); }
  ctx.stroke();
  const marker = (wx, wy, color, label) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x + wx * sx, y + wy * sy, 6, 0, 6.29); ctx.fill();
    ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.fillText(label, x + wx * sx, y + wy * sy - 11);
  };
  marker(PLACES.garage.x, PLACES.garage.y, '#ffd34d', "Eli's Garage");
  marker(PLACES.safehouse.x, PLACES.safehouse.y, '#7dd87d', 'Safehouse');
  const om = G.missionsApi.objectiveMarker();
  if (om) marker(om.x, om.y, '#ffdf4d', 'Objective');
  ctx.save();
  ctx.translate(x + G.player.x * sx, y + G.player.y * sy);
  ctx.rotate(G.player.angle);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#f2ead8';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BRISAVA', w / 2, y - 18);
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText('M or Esc — back to the streets', w / 2, y + mh + 30);
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
