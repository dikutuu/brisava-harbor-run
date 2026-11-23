// The real 3D view: a Three.js scene (vendored under game/vendor/, loaded offline) that
// draws the SAME world and entity state the simulation keeps — this module forks no game
// logic. World x stays x, world y becomes z, and height is up. Buildings rise as tinted
// boxes from the world's own building data, cars and people are small low-poly models, and
// three cameras (C cycles them): CHASE behind the action, TOP high above, STREET down at
// pavement level. If WebGL is unavailable the constructor throws and main.js falls back to
// the 2D renderer, so the game never breaks.

import * as THREE from '../vendor/three.module.min.js';
import {
  DISTRICTS, H_ROADS, PLACES, PROMENADE_Y, SAND_Y, SEA_Y, V_ROADS, WORLD_H, WORLD_W,
  angleLerp, clamp, pointBlocked, solids, stalls, trees,
} from './world.js';

const CAMERA_MODES = ['chase', 'top', 'street'];
const CAMERA_LABELS = { chase: 'CHASE', top: 'TOP', street: 'STREET' };

function shade(hex, f) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Building height in 3D units from the world's 2D lift value; containers stay container-sized. */
function height3d(b) {
  if (b.kind === 'container') return 25;
  return Math.max(22, b.height * 3.4);
}

/* ---------- ground texture: the whole city painted once onto a canvas ---------- */

function makeGroundTexture() {
  const S = 0.5;
  const cv = document.createElement('canvas');
  cv.width = WORLD_W * S; cv.height = WORLD_H * S;
  const c = cv.getContext('2d');
  c.scale(S, S);
  for (const d of DISTRICTS) { c.fillStyle = d.ground; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); }
  c.fillStyle = '#639657'; c.fillRect(2726, 326, 508, 508); // Ridgeview park lawn
  c.fillStyle = '#c2a878'; c.fillRect(926, 326, 508, 508); // market plaza
  c.fillStyle = '#a8a29a'; c.fillRect(1526, 1526, 1708, 508); // dock yard concrete
  c.fillStyle = '#d8c49a'; c.fillRect(926, 1710, 508, 180); // garage forecourt
  c.fillStyle = '#ecd9a8'; c.fillRect(0, SAND_Y, WORLD_W, SEA_Y - SAND_Y); // sand
  const grad = c.createLinearGradient(0, SEA_Y, 0, WORLD_H);
  grad.addColorStop(0, '#2e9db4'); grad.addColorStop(1, '#166e8c');
  c.fillStyle = grad; c.fillRect(0, SEA_Y, WORLD_W, WORLD_H - SEA_Y);
  c.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 30; x < WORLD_W; x += 130) c.fillRect(x, SEA_Y + 3, 52, 3); // foam line
  // Roads: pavement edge, asphalt, dashed centre lines.
  c.fillStyle = '#565d66';
  for (const cx of V_ROADS) c.fillRect(cx - 58, 0, 116, PROMENADE_Y + 58);
  for (const cy of [...H_ROADS, PROMENADE_Y]) c.fillRect(0, cy - 58, WORLD_W, 116);
  c.fillStyle = '#4a5058';
  for (const cx of V_ROADS) c.fillRect(cx - 46, 0, 92, PROMENADE_Y + 46);
  for (const cy of [...H_ROADS, PROMENADE_Y]) c.fillRect(0, cy - 46, WORLD_W, 92);
  c.strokeStyle = 'rgba(240,230,190,0.55)';
  c.lineWidth = 3; c.setLineDash([26, 30]);
  c.beginPath();
  for (const cx of V_ROADS) { c.moveTo(cx, 8); c.lineTo(cx, PROMENADE_Y); }
  for (const cy of [...H_ROADS, PROMENADE_Y]) { c.moveTo(8, cy); c.lineTo(WORLD_W - 8, cy); }
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A near-white window grid that instance colours tint into each district's palette. */
function makeWallTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#f7f4ee'); grad.addColorStop(1, '#ddd8cf');
  c.fillStyle = grad; c.fillRect(0, 0, 128, 128);
  c.fillStyle = 'rgba(28,38,52,0.6)';
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) c.fillRect(10 + col * 30, 12 + row * 24, 17, 13);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- small model builders ---------- */

const matCache = new Map();
function lambert(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
const glassMat = new THREE.MeshLambertMaterial({ color: 0x18222e });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const skinMats = ['#c98d64', '#a06a42', '#8a5a34'].map((s) => lambert(s));

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A car: body, cabin glass, wheels; cruisers get a light bar whose halves flash. */
function makeVehicleMesh(v) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: v.wrecked ? '#5a5a5c' : v.color });
  const long = v.w, wide = v.h;
  if (v.cls === 'van') {
    g.add(box(long, 15, wide, bodyMat, 0, 10.5, 0));
    g.add(box(long * 0.2, 8, wide * 0.9, glassMat, long * 0.36, 9, 0));
  } else {
    g.add(box(long, 8.5, wide, bodyMat, 0, 6.8, 0));
    g.add(box(long * 0.46, 6.5, wide * 0.84, v.cls === 'cruiser' ? lambert('#232833') : glassMat, -long * 0.03, 13.8, 0));
  }
  if (v.cls === 'cruiser') {
    g.add(box(long * 0.26, 8.7, wide + 0.6, lambert('#eef1f4'), -long * 0.02, 6.8, 0)); // white door band
    const bar = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: 0x881111, emissive: 0xff2222, emissiveIntensity: 1 });
    const blue = new THREE.MeshLambertMaterial({ color: 0x111188, emissive: 0x2244ff, emissiveIntensity: 0.15 });
    const rl = box(5, 3, wide * 0.34, red, 0, 18.6, -wide * 0.2);
    const bl = box(5, 3, wide * 0.34, blue, 0, 18.6, wide * 0.2);
    rl.castShadow = bl.castShadow = false;
    bar.add(rl, bl);
    bar.userData = { red, blue };
    g.add(bar);
    g.userData.lightBar = bar.userData;
  }
  const wheelGeo = new THREE.CylinderGeometry(4.6, 4.6, 3.2, 10);
  wheelGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.position.set(sx * long * 0.33, 4.6, sz * (wide / 2 + 0.4));
    g.add(w);
  }
  g.userData.bodyMat = bodyMat;
  g.userData.baseColor = v.color;
  return g;
}

/** A person: capsule body, sphere head, optional cap or gun. Body material is per-figure
    so a guard's hit flash can whiten him without touching anyone else. */
function makeFigure(shirt, opts = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: shirt });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(4.4, 8.5, 3, 8), bodyMat);
  body.position.y = 10.5;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(4.1, 10, 8), opts.skinMat || skinMats[0]);
  head.position.y = 21.5;
  head.castShadow = true;
  g.add(head);
  if (opts.cap) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.6, 2.2, 10), lambert('#20304f'));
    cap.position.y = 24.6;
    g.add(cap);
  }
  if (opts.gun) {
    const gun = box(11, 1.8, 1.8, lambert('#1c1e24'), 7, 13.5, 0);
    gun.castShadow = false;
    g.add(gun);
  }
  // A guard's health, drawn as two flat bars overhead (readable from chase and top views).
  if (opts.healthBar) {
    const bg = new THREE.Mesh(new THREE.BoxGeometry(26, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0x10131a }));
    bg.position.y = 30;
    const fg = new THREE.Mesh(new THREE.BoxGeometry(25, 0.9, 3.4), new THREE.MeshBasicMaterial({ color: 0xd94f3d }));
    fg.position.y = 30;
    g.add(bg, fg);
    g.userData.hpFg = fg;
  }
  g.userData.bodyMat = bodyMat;
  g.userData.shirt = shirt;
  return g;
}

/** A dock crane: two legs, a beam, a jib and a hanging hook — pure set dressing. */
function makeCrane(x, z, rotY) {
  const steel = lambert('#d9903a');
  const dark = lambert('#37414c');
  const g = new THREE.Group();
  for (const sx of [-16, 16]) for (const sz of [-10, 10]) g.add(box(4.5, 62, 4.5, steel, sx, 31, sz));
  g.add(box(42, 5, 26, dark, 0, 63, 0));
  const jib = box(96, 3.5, 3.5, steel, 30, 68, 0);
  g.add(jib);
  g.add(box(26, 3.5, 3.5, steel, -32, 68, 0));
  g.add(box(1.2, 30, 1.2, dark, 66, 52, 0));
  g.add(box(7, 7, 7, dark, 66, 34, 0));
  g.add(box(9, 8, 9, glassMat, 12, 58, 6));
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  return g;
}

/* ---------- the renderer ---------- */

export function createRenderer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfdde8);
  scene.fog = new THREE.Fog(0xcfdde6, 1300, 4600);
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 7000);

  const sun = new THREE.DirectionalLight(0xffe0b0, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -560; sun.shadow.camera.right = 560;
  sun.shadow.camera.top = 560; sun.shadow.camera.bottom = -560;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 0.95));

  /* Static city (built once from the same world data the physics uses). */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W, WORLD_H),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.geometry.rotateX(-Math.PI / 2);
  ground.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const dummy = new THREE.Object3D();
  const buildings = solids.filter((b) => b.kind !== 'container');
  const containers = solids.filter((b) => b.kind === 'container');
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: makeWallTexture() }), buildings.length);
  const roofs = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), buildings.length);
  buildings.forEach((b, i) => {
    const h = height3d(b);
    dummy.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    dummy.scale.set(b.w, h, b.h);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
    walls.setColorAt(i, new THREE.Color(b.color));
    dummy.position.y = h;
    dummy.scale.set(b.w + 3, 2.6, b.h + 3);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, new THREE.Color(shade(b.color, 1.22)));
  });
  walls.castShadow = true; walls.receiveShadow = true;
  scene.add(walls, roofs);

  const contMesh = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), containers.length);
  containers.forEach((b, i) => {
    dummy.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    dummy.scale.set(b.w, height3d(b), b.h);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    contMesh.setMatrixAt(i, dummy.matrix);
    contMesh.setColorAt(i, new THREE.Color(b.color));
  });
  contMesh.castShadow = true;
  scene.add(contMesh);

  const stallMesh = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, stalls.length));
  stalls.forEach((s, i) => {
    dummy.position.set(s.x + s.w / 2, 0, s.y + s.h / 2);
    dummy.scale.set(s.w, 11, s.h);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    stallMesh.setMatrixAt(i, dummy.matrix);
    stallMesh.setColorAt(i, new THREE.Color(s.color));
  });
  stallMesh.castShadow = true;
  scene.add(stallMesh);

  const trunkGeo = new THREE.CylinderGeometry(1.7, 2.3, 10, 6);
  trunkGeo.translate(0, 5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert('#7a5c38'), Math.max(1, trees.length));
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, trees.length));
  trees.forEach((t, i) => {
    dummy.position.set(t.x, 0, t.y);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 10 + t.r * 0.55;
    dummy.scale.set(t.r * 0.95, t.r * 0.8, t.r * 0.95);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
    canopies.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#5d9046' : '#4e7d3a'));
  });
  canopies.castShadow = true;
  scene.add(trunks, canopies);
  scene.add(makeCrane(2650, 1652, 0.35), makeCrane(1995, 2005, -0.55));

  /* The mission marker and the market ledger, mirroring the 2D renderer's props. */
  const markerGroup = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 200, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 100;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(11), new THREE.MeshLambertMaterial({ color: 0xffd34d, emissive: 0x8a6410 }));
  gem.position.y = 44;
  markerGroup.add(beam, gem);
  scene.add(markerGroup);
  const ledger = box(15, 19, 4, lambert('#ffd34d'), PLACES.market.x, 12, PLACES.market.y - 14);
  scene.add(ledger);

  /* Bullets as one line segments buffer, refilled each frame. */
  const MAX_BULLETS = 128;
  const bulletPos = new Float32Array(MAX_BULLETS * 6);
  const bulletGeo = new THREE.BufferGeometry();
  bulletGeo.setAttribute('position', new THREE.BufferAttribute(bulletPos, 3));
  const bulletLines = new THREE.LineSegments(bulletGeo, new THREE.LineBasicMaterial({ color: 0xffd34d }));
  bulletLines.frustumCulled = false;
  scene.add(bulletLines);

  /* Muzzle flash: an additive sprite that pops at the gun tip for a few frames per shot. */
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64; flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const fgrad = fctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  fgrad.addColorStop(0, 'rgba(255,246,218,1)');
  fgrad.addColorStop(0.35, 'rgba(255,205,110,0.85)');
  fgrad.addColorStop(1, 'rgba(255,160,60,0)');
  fctx.fillStyle = fgrad; fctx.fillRect(0, 0, 64, 64);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(flashCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  flash.scale.set(30, 30, 1);
  flash.visible = false;
  scene.add(flash);

  /* The aim anchor reticle: an amber ring lying on the ground at the tracked point. */
  const reticle = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(9.5, 12.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 16),
    new THREE.MeshBasicMaterial({ color: 0xffc861, depthWrite: false }),
  );
  dot.rotation.x = -Math.PI / 2;
  reticle.add(ring, dot);
  reticle.visible = false;
  scene.add(reticle);

  /* Dynamic entity pools, keyed by the simulation's own objects. */
  const vehicleMeshes = new Map();
  const figureMeshes = new Map();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  let mode = 'chase';
  let heading = -Math.PI / 2;
  let snapped = false;
  const curPos = new THREE.Vector3(900, 300, 2100);
  const curLook = new THREE.Vector3(1100, 0, 1800);

  function focusOf(G) {
    const p = G.player;
    return p.car ? { x: p.car.x, y: p.car.y } : { x: p.x, y: p.y };
  }

  /** Where the camera wants to be this frame, and what it wants to look at. */
  function desiredCamera(G) {
    if (G.mode === 'menu') { // the title backdrop: a slow high pan over the living city
      return {
        pos: new THREE.Vector3(G.camera.x + G.camera.w / 2, 760, G.camera.y + G.camera.h / 2 + 170),
        look: new THREE.Vector3(G.camera.x + G.camera.w / 2, 0, G.camera.y + G.camera.h / 2),
      };
    }
    const p = G.player;
    const f = focusOf(G);
    const dirX = Math.cos(heading), dirZ = Math.sin(heading);
    if (mode === 'top') {
      return { pos: new THREE.Vector3(f.x, 840, f.y + 150), look: new THREE.Vector3(f.x, 0, f.y) };
    }
    if (mode === 'street') {
      const back = p.car ? 100 : 60;
      const h = p.car ? 27 : 17;
      return {
        pos: new THREE.Vector3(f.x - dirX * back, h, f.y - dirZ * back),
        look: new THREE.Vector3(f.x + dirX * 95, 15, f.y + dirZ * 95),
      };
    }
    const back = p.car ? 168 : 122;
    const h = p.car ? 102 : 88;
    return {
      pos: new THREE.Vector3(f.x - dirX * back, h, f.y - dirZ * back),
      look: new THREE.Vector3(f.x + dirX * 72, 12, f.y + dirZ * 72),
    };
  }

  /** Lift the camera out of any building it would sit inside (street view in alleys). */
  function liftOutOfBuildings(pos) {
    let guard = 0;
    while (pointBlocked(pos.x, pos.z, 4) && pos.y < 170 && guard < 14) { pos.y += 12; guard += 1; }
    pos.x = clamp(pos.x, -80, WORLD_W + 80);
    pos.z = clamp(pos.z, -80, WORLD_H + 80);
    return pos;
  }

  function syncVehicles(G) {
    const alive = new Set();
    for (const v of G.vehicles) {
      alive.add(v.id);
      let m = vehicleMeshes.get(v.id);
      if (!m) { m = makeVehicleMesh(v); vehicleMeshes.set(v.id, m); scene.add(m); }
      m.position.set(v.x, 0, v.y);
      m.rotation.y = -v.angle;
      const want = v.wrecked ? '#5a5a5c' : m.userData.baseColor;
      if (m.userData.shownColor !== want) { m.userData.bodyMat.color.set(want); m.userData.shownColor = want; }
      if (m.userData.lightBar) {
        const flash = Math.floor(G.time * 4) % 2 === 0;
        m.userData.lightBar.red.emissiveIntensity = flash ? 1.6 : 0.12;
        m.userData.lightBar.blue.emissiveIntensity = flash ? 0.12 : 1.6;
      }
    }
    for (const [id, m] of vehicleMeshes) {
      if (!alive.has(id)) { scene.remove(m); m.userData.bodyMat.dispose(); vehicleMeshes.delete(id); }
    }
  }

  function syncFigure(map, obj, makeOpts, x, y, angle, phase, moving, flash) {
    let m = map.get(obj);
    if (!m) { m = makeFigure(makeOpts.shirt, makeOpts); map.set(obj, m); scene.add(m); }
    m.visible = true;
    m.position.set(x, moving ? Math.abs(Math.sin(phase)) * 1.7 : 0, y);
    m.rotation.y = -angle;
    if (flash !== undefined) m.userData.bodyMat.color.set(flash ? '#f2f2f2' : m.userData.shirt);
    return m;
  }

  function syncPeople(G) {
    const seen = new Set();
    const p = G.player;
    if (!p.car && !p.dead) {
      seen.add(p);
      const aiming = G.input.mouse.down || p.recoil > 0 || p.muzzleFor > 0;
      syncFigure(figureMeshes, p, { shirt: '#1f7a8c', skinMat: skinMats[1], gun: true },
        p.x, p.y, aiming ? p.aimAngle : p.angle, p.walkPhase, p.speedNow > 0);
    }
    for (const ped of G.peds) {
      seen.add(ped);
      syncFigure(figureMeshes, ped, { shirt: ped.shirt }, ped.x, ped.y, ped.angle, ped.phase, ped.speed > 0);
    }
    for (const o of G.officers) {
      seen.add(o);
      syncFigure(figureMeshes, o, { shirt: '#2c4a7c', cap: true }, o.x, o.y, o.angle, o.phase, o.speed > 0);
    }
    for (const g of G.guards) {
      seen.add(g);
      const m = syncFigure(figureMeshes, g, { shirt: '#3a3f46', gun: true, healthBar: true },
        g.x, g.y, g.angle, g.phase, g.speed > 0, g.hitFlash > 0);
      if (m.userData.hpFg) {
        const ratio = Math.max(0, g.hp / g.maxHp);
        m.userData.hpFg.visible = g.hp < g.maxHp;
        m.userData.hpFg.scale.x = Math.max(0.001, ratio);
        m.userData.hpFg.position.x = -(1 - ratio) * 12.5;
      }
    }
    for (const [obj, m] of figureMeshes) {
      if (!seen.has(obj)) { scene.remove(m); m.userData.bodyMat.dispose(); figureMeshes.delete(obj); }
    }
  }

  function syncProps(G) {
    const marker = G.mode === 'play' && G.missionsApi ? G.missionsApi.objectiveMarker() : null;
    markerGroup.visible = !!marker;
    if (marker) {
      markerGroup.position.set(marker.x, 0, marker.y);
      gem.position.y = 44 + Math.sin(G.time * 3.2) * 6;
      gem.rotation.y = G.time * 1.6;
    }
    const active = G.missionsApi ? G.missionsApi.state.active : null;
    ledger.visible = !!(active && active.def.id === 'm3' && active.stepIndex === 1);
    let n = 0;
    for (const b of G.bullets) {
      if (n >= MAX_BULLETS) break;
      bulletPos[n * 6] = b.x - b.vx * 0.016; bulletPos[n * 6 + 1] = 11; bulletPos[n * 6 + 2] = b.y - b.vy * 0.016;
      bulletPos[n * 6 + 3] = b.x; bulletPos[n * 6 + 4] = 11; bulletPos[n * 6 + 5] = b.y;
      n += 1;
    }
    bulletGeo.setDrawRange(0, n * 2);
    bulletGeo.attributes.position.needsUpdate = true;
    // Firing feedback and the aim anchor, mirrored from the simulation state.
    const p = G.player;
    flash.visible = !p.car && !p.dead && p.muzzleFor > 0;
    if (flash.visible) {
      flash.position.set(p.x + Math.cos(p.aimAngle) * 22, 14, p.y + Math.sin(p.aimAngle) * 22);
      const s = 24 + Math.max(0, 0.055 - p.muzzleFor) * 260;
      flash.scale.set(s, s, 1);
    }
    reticle.visible = G.mode === 'play' && !p.car && !p.dead && !!G.aimAnchor;
    if (reticle.visible) {
      reticle.position.set(G.aimAnchor.x, 1.4, G.aimAnchor.y);
      const pulse = 1 + Math.sin(G.time * 6) * 0.07;
      reticle.scale.set(pulse, 1, pulse);
    }
  }

  function render(G, dt) {
    const step = Math.min(dt || 1 / 30, 0.1);
    // Smooth the follow heading toward whatever Mara (or her car) faces.
    const p = G.player;
    const targetHeading = p.car ? p.car.angle
      : (G.input.mouse.down || p.recoil > 0) ? p.aimAngle : p.angle;
    heading = angleLerp(heading, targetHeading, Math.min(1, 3.6 * step));
    const want = desiredCamera(G);
    liftOutOfBuildings(want.pos);
    if (!snapped || curPos.distanceTo(want.pos) > 950) {
      curPos.copy(want.pos); curLook.copy(want.look); snapped = true;
    } else {
      const k = 1 - Math.exp(-4.4 * step);
      curPos.lerp(want.pos, k);
      curLook.lerp(want.look, k);
    }
    camera.position.copy(curPos);
    camera.lookAt(curLook);
    // The sun (and its shadow box) travels with the focus so shadows stay crisp and local.
    const f = focusOf(G);
    const sx = Math.round(f.x / 24) * 24, sz = Math.round(f.y / 24) * 24;
    sun.position.set(sx + 300, 460, sz + 170);
    sun.target.position.set(sx, 0, sz);
    syncVehicles(G);
    syncPeople(G);
    syncProps(G);
    // Publish the mouse's ground point so combat aims where the player actually points.
    ndc.set((G.input.mouse.x / window.innerWidth) * 2 - 1, -(G.input.mouse.y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) G.aimWorld = { x: hitPoint.x, y: hitPoint.z, sx: G.input.mouse.x, sy: G.input.mouse.y };
    renderer.render(scene, camera);
  }

  return {
    render,
    mode: () => mode,
    label: () => CAMERA_LABELS[mode],
    cycle() { mode = CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]; },
    setMode(name) { if (CAMERA_MODES.includes(name)) mode = name; },
    /** Jump straight to the current desired camera (used by the screenshot staging);
        with G given, the follow heading snaps too, so a still frame is composed now. */
    snap(G) {
      if (G) {
        const p = G.player;
        heading = p.car ? p.car.angle : (G.input.mouse.down || p.recoil > 0) ? p.aimAngle : p.angle;
      }
      snapped = false;
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
