// Saving: one localStorage slot, versioned, written on mission completion and at the
// safehouse. A save holds progression (which mission is next, story done), money, the turbo
// upgrade, and a safe standing position — never transient state like wanted heat, bullets or
// a half-wrecked car, so loading always puts Mara somewhere sane: on her feet, unhurt enough
// to play, at the garage or the safehouse. If storage is unavailable or the data is corrupt,
// the game says so honestly instead of pretending to have saved.

import { PLACES } from './world.js';

export const SAVE_KEY = 'brisava-save';
export const SAVE_VERSION = 1;

/** Serialize the durable parts of the state. Returns true only if the write really happened. */
export function saveGame(G, reason) {
  const data = {
    version: SAVE_VERSION,
    nextMission: G.missionsApi.state.nextIndex,
    storyDone: G.missionsApi.state.storyDone,
    money: G.player.money,
    turbo: !!G.upgrades.turbo,
    sideJobsDone: G.sideJobsDone || 0,
    x: Math.round(G.player.x),
    y: Math.round(G.player.y),
    reason: reason || 'auto',
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    G.toast = reason === 'safehouse' ? 'Game saved at the safehouse.' : 'Game saved.';
    G.toastAt = G.time;
    return true;
  } catch {
    G.toast = 'Saving unavailable in this browser — progress lasts this session only.';
    G.toastAt = G.time;
    return false;
  }
}

/** Read and validate a save; returns null when there is none or it is unusable. */
export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    if (!Number.isFinite(data.money) || !Number.isFinite(data.nextMission)) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() { return readSave() !== null; }

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

/**
 * Apply a save to a fresh state: Mara stands at the saved spot if it is safe ground, else at
 * the garage; her car, wanted level and wounds do not carry over — she walks out clean.
 */
export function applySave(G, data) {
  const p = G.player;
  p.money = Math.max(0, Math.floor(data.money));
  G.upgrades.turbo = !!data.turbo;
  G.sideJobsDone = data.sideJobsDone || 0;
  G.missionsApi.state.nextIndex = Math.max(0, Math.min(6, Math.floor(data.nextMission)));
  G.missionsApi.state.storyDone = !!data.storyDone || G.missionsApi.state.nextIndex >= 6;
  let x = data.x, y = data.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || G.worldPointBlocked(x, y, 14)) {
    x = PLACES.garage.x; y = PLACES.garage.y + 40;
  }
  p.x = x; p.y = y;
  p.hp = p.maxHp;
  p.ammo = 12; p.reserve = Math.max(p.reserve, 24);
}
