// Brisava's city: four districts on one street grid, generated once from a fixed seed so the
// world is identical on every load (saves and screenshots depend on that). This module owns the
// shared geometry — roads and their lanes, buildings, the sea — and the questions every other
// system asks of it: collision, line of sight, "where is the road", "which district is this".
// The renderer and both maps (minimap and big map) draw from the same data, so what you see
// is what you hit.

export const WORLD_W = 3600;
export const WORLD_H = 2600;

/** Road centre lines. Vertical roads run from the north edge down to the promenade; the sea is south. */
export const V_ROADS = [280, 880, 1480, 2080, 2680, 3280];
export const H_ROADS = [280, 880, 1480, 2080];
export const PROMENADE_Y = 2240;
export const ROAD_HALF = 46;
export const SEA_Y = 2400;
export const SAND_Y = 2286;

/** The four districts, split by the middle of the grid. `mapGround` is the dark block
    colour the city map paints the district in (the 3D ground uses the lighter `ground`);
    `blurb` is its one-line map description, shown under the big map's title. */
export const DISTRICTS = [
  { id: 'mercado', name: 'Old Mercado', x0: 0, y0: 0, x1: 1780, y1: 1180, ground: '#b8a888', park: '#5d8f4e', mapGround: '#57503f', blurb: 'Market streets, murals and tenements around the plaza.' },
  { id: 'ridgeview', name: 'Ridgeview', x0: 1780, y0: 0, x1: 3600, y1: 1180, ground: '#a9b184', park: '#639657', mapGround: '#4c5138', blurb: 'Quiet hillside homes and the big green park.' },
  { id: 'coast', name: 'Sunline Coast', x0: 0, y0: 1180, x1: 1780, y1: 2600, ground: '#c9b995', park: '#6da357', mapGround: '#5d5138', blurb: "Promenade, palms and Eli's garage by the sand." },
  { id: 'docks', name: 'Meridian Docks', x0: 1780, y0: 1180, x1: 3600, y1: 2600, ground: '#9aa0a2', park: '#7a8a72', mapGround: '#43484c', blurb: 'Cranes, container yards and the Meridian Quay warehouses.' },
];

/** Places the story and the HUD care about. Points sit on pavement or road, never inside a wall. */
export const PLACES = {
  garage: { x: 1110, y: 1800, doorX: 1110, doorY: 1736, name: "Eli's Garage" },
  safehouse: { x: 510, y: 612, doorX: 510, doorY: 566, name: 'Safehouse' },
  market: { x: 1180, y: 580, name: 'Old Mercado Market' },
  docksGate: { x: 2150, y: 1560, name: 'Meridian Docks Gate' },
  vanYard: { x: 2560, y: 1900, name: 'Warehouse Yard' },
  playerStart: { x: 1110, y: 1840 },
};

/** Deterministic RNG (mulberry32): same seed, same city, every time. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function districtAt(x, y) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  return DISTRICTS[0];
}

/** All horizontal road centre lines, promenade included, north to south. */
export function allHRoads() { return [...H_ROADS, PROMENADE_Y]; }

/** Junctions: every crossing of a vertical and a horizontal road. */
export function junctions() {
  const out = [];
  for (const x of V_ROADS) for (const y of allHRoads()) out.push({ x, y });
  return out;
}

export function isOnRoad(x, y) {
  if (y >= SEA_Y) return false;
  for (const cx of V_ROADS) if (Math.abs(x - cx) <= ROAD_HALF && y <= PROMENADE_Y + ROAD_HALF) return true;
  for (const cy of allHRoads()) if (Math.abs(y - cy) <= ROAD_HALF) return true;
  return false;
}

/** The lane centre for travelling along a road: right-hand traffic, offset from the centre line. */
export function laneOffset(dir) { return dir > 0 ? 24 : -24; }

/** Buildings, containers and other solid AABBs. Filled by buildWorld(). */
export const solids = [];
/** Decorative trees (no collision): {x, y, r}. */
export const trees = [];
/** Market stalls: low AABBs that block movement but not sight or bullets. */
export const stalls = [];

const MERCADO_WALLS = ['#d98a68', '#c96f52', '#e0a37c', '#b85c48', '#e5b98a'];
const COAST_WALLS = ['#f2d8b3', '#f6c9a0', '#f9e3c2', '#f0b8a2', '#fdf0d5'];
const RIDGE_WALLS = ['#e8ddc4', '#dcc7a8', '#efe6d0', '#d5bd96'];
const DOCKS_WALLS = ['#8d99a4', '#7c8894', '#9aa7ae', '#6f7d88'];

function addBuilding(x, y, w, h, color, district, kind) {
  const b = { x, y, w, h, color, district, kind: kind || 'block', height: 14 + ((x * 7 + y * 13) % 22) };
  solids.push(b);
  return b;
}

/** Blocks (city-block rectangles) between consecutive roads, as [x0, x1] and [y0, y1] ranges. */
function blockRanges() {
  const xs = [[0, V_ROADS[0] - ROAD_HALF]];
  for (let i = 0; i < V_ROADS.length - 1; i += 1) xs.push([V_ROADS[i] + ROAD_HALF, V_ROADS[i + 1] - ROAD_HALF]);
  xs.push([V_ROADS[V_ROADS.length - 1] + ROAD_HALF, WORLD_W]);
  const ys = [[0, H_ROADS[0] - ROAD_HALF]];
  for (let i = 0; i < H_ROADS.length - 1; i += 1) ys.push([H_ROADS[i] + ROAD_HALF, H_ROADS[i + 1] - ROAD_HALF]);
  ys.push([H_ROADS[H_ROADS.length - 1] + ROAD_HALF, PROMENADE_Y - ROAD_HALF]);
  return { xs, ys };
}

/** Hand-placed blocks the generator must leave alone, keyed "xi,yi" (garage, safehouse, market, park, dock warehouses). */
const RESERVED = new Set(['2,3', '1,1', '2,1', '5,1', '3,3', '4,3', '5,3']);

function fillBlock(rng, bx0, by0, bx1, by1, districtId) {
  const inset = 30;
  const x0 = bx0 + inset, y0 = by0 + inset, x1 = bx1 - inset, y1 = by1 - inset;
  if (x1 - x0 < 90 || y1 - y0 < 90) return;
  const palette = districtId === 'mercado' ? MERCADO_WALLS : districtId === 'coast' ? COAST_WALLS : districtId === 'ridgeview' ? RIDGE_WALLS : DOCKS_WALLS;
  const cell = districtId === 'mercado' ? 118 : districtId === 'ridgeview' ? 168 : 148;
  for (let cx = x0; cx + 70 <= x1; cx += cell) {
    for (let cy = y0; cy + 70 <= y1; cy += cell) {
      if (rng() < 0.14) { // an alley gap or a little yard with a tree
        if (rng() < 0.6) trees.push({ x: cx + cell / 2, y: cy + cell / 2, r: 15 + rng() * 9 });
        continue;
      }
      const w = Math.min(cell - 26 - rng() * 18, x1 - cx);
      const h = Math.min(cell - 26 - rng() * 18, y1 - cy);
      if (w < 56 || h < 56) continue;
      addBuilding(cx + 6, cy + 6, w, h, palette[Math.floor(rng() * palette.length)], districtId);
    }
  }
}

function buildLandmarks(rng) {
  // Eli's garage: one wide low building with a forecourt on its south side (block x 926..1434, y 1526..2034).
  addBuilding(990, 1560, 240, 150, '#e8b04b', 'coast', 'garage').height = 16;
  addBuilding(1300, 1560, 96, 110, COAST_WALLS[1], 'coast');
  addBuilding(960, 1900, 130, 96, COAST_WALLS[2], 'coast');
  // Safehouse in Old Mercado (block x 326..834, y 326..834): a plain tenement with a green door.
  addBuilding(420, 420, 180, 130, '#c96f52', 'mercado', 'safehouse').height = 24;
  addBuilding(660, 420, 130, 130, MERCADO_WALLS[3], 'mercado');
  addBuilding(420, 640, 150, 120, MERCADO_WALLS[1], 'mercado');
  // Market plaza (block x 926..1434, y 326..834): a mural wall along the north, stalls in rows.
  addBuilding(956, 330, 420, 54, '#b8526b', 'mercado', 'mural').height = 20;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const sx = 990 + col * 108, sy = 450 + row * 118;
      if (row === 1 && col === 1) continue; // the ledger stall stands open in the middle
      stalls.push({ x: sx, y: sy, w: 62, h: 40, color: ['#c94f36', '#d9903a', '#3f7d5c', '#405e8c'][(row + col) % 4] });
    }
  }
  trees.push({ x: 1000, y: 740, r: 17 }, { x: 1360, y: 740, r: 15 });
  // Ridgeview park (block x 2726..3234, y 326..834): lawns and trees, one small café.
  addBuilding(2760, 360, 92, 70, '#efe6d0', 'ridgeview', 'cafe').height = 10;
  for (let i = 0; i < 16; i += 1) trees.push({ x: 2780 + rng() * 420, y: 350 + rng() * 440, r: 14 + rng() * 11 });
  // Meridian Docks: warehouses in the two eastern blocks of the dock row, container yards between.
  addBuilding(2180, 1560, 340, 170, DOCKS_WALLS[0], 'docks', 'warehouse').height = 26;
  addBuilding(2790, 1560, 330, 170, DOCKS_WALLS[2], 'docks', 'warehouse').height = 26;
  addBuilding(1560, 1560, 300, 170, DOCKS_WALLS[1], 'docks', 'warehouse').height = 24;
  const contColors = ['#b8492f', '#2f6db8', '#3f8a52', '#c9862e', '#6a4fa3'];
  const yards = [[1900, 1830], [1980, 1830], [2060, 1830], [2260, 1830], [2860, 1830], [2940, 1830], [1620, 1830], [1700, 1830], [2380, 1960], [3020, 1960]];
  yards.forEach(([x, y], i) => {
    const c = { x, y, w: 74, h: 30, color: contColors[i % contColors.length], district: 'docks', kind: 'container', height: 9 };
    solids.push(c);
  });
}

/** Build the whole city once. Called at boot with the fixed city seed. */
export function buildWorld() {
  solids.length = 0; trees.length = 0; stalls.length = 0;
  const rng = createRng(20261123);
  buildLandmarks(rng);
  const { xs, ys } = blockRanges();
  for (let xi = 0; xi < xs.length; xi += 1) {
    for (let yi = 0; yi < ys.length; yi += 1) {
      if (RESERVED.has(`${xi},${yi}`)) continue;
      const cx = (xs[xi][0] + xs[xi][1]) / 2, cy = (ys[yi][0] + ys[yi][1]) / 2;
      fillBlock(rng, xs[xi][0], ys[yi][0], xs[xi][1], ys[yi][1], districtAt(cx, cy).id);
    }
  }
  // Promenade palms along the sand.
  for (let x = 140; x < WORLD_W - 80; x += 170) trees.push({ x: x + (x % 3) * 7, y: 2330, r: 13 });
}

function pointInRect(x, y, r, pad) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

/** Is a point inside any solid (buildings and containers), optionally padded? */
export function pointBlocked(x, y, pad = 0) {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > SEA_Y + 40) return true;
  for (const s of solids) if (pointInRect(x, y, s, pad)) return true;
  return false;
}

/**
 * Move a circle (centre + radius) out of every solid and the sea edge; returns the corrected
 * position. Shared by the player, pedestrians and cars so everything collides the same way.
 */
export function collideCircle(pos, radius) {
  pos.x = Math.max(radius, Math.min(WORLD_W - radius, pos.x));
  pos.y = Math.max(radius, Math.min(SEA_Y - radius + 60, pos.y));
  if (pos.y > SEA_Y - radius && !isOnRoad(pos.x, pos.y)) pos.y = SEA_Y - radius;
  for (const s of solids) resolveRect(pos, radius, s);
  for (const s of stalls) resolveRect(pos, radius, s);
  return pos;
}

function resolveRect(pos, radius, r) {
  const nx = Math.max(r.x, Math.min(pos.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(pos.y, r.y + r.h));
  const dx = pos.x - nx, dy = pos.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    pos.x = nx + (dx / d) * radius;
    pos.y = ny + (dy / d) * radius;
  } else { // centre inside the rect: push out through the nearest face
    const left = pos.x - r.x, right = r.x + r.w - pos.x, top = pos.y - r.y, bottom = r.y + r.h - pos.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = r.x - radius; else if (m === right) pos.x = r.x + r.w + radius;
    else if (m === top) pos.y = r.y - radius; else pos.y = r.y + r.h + radius;
  }
}

/** Buildings and containers block sight; stalls and trees do not. Sampled along the segment. */
export function lineOfSightBlocked(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(dist / 22));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x0 + dx * t, y = y0 + dy * t;
    for (const s of solids) if (pointInRect(x, y, s, 0)) return true;
  }
  return false;
}

/** A random point on a road, used for spawning traffic and police off-camera. */
export function randomRoadPoint(rng) {
  if (rng() < 0.5) {
    const cx = V_ROADS[Math.floor(rng() * V_ROADS.length)];
    return { x: cx, y: 140 + rng() * (PROMENADE_Y - 140), axis: 'v', index: V_ROADS.indexOf(cx) };
  }
  const cy = allHRoads()[Math.floor(rng() * allHRoads().length)];
  return { x: 140 + rng() * (WORLD_W - 280), y: cy, axis: 'h', index: allHRoads().indexOf(cy) };
}

export function dist(x0, y0, x1, y1) { return Math.hypot(x1 - x0, y1 - y0); }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
/** Shortest-arc angle interpolation. */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
