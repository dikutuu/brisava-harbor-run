// The story of Brisava in six jobs, plus the engine that runs them. Missions are data: an
// ordered list of steps, each with HUD text, a map marker, and an update that reports done or
// failed. The tuning is deliberately friendly — generous trigger radii, a long clock on the
// circuit, few and soft-hearted guards — so a casual player finishes the story. The engine
// handles the lifecycle — available at Eli's garage door, active, completed
// (reward, chime, autosave), failed (retry from a checkpoint that restores the mission's
// entities and a fair minimum of health, ammo and money, so a failed job can never soft-lock
// the run). A repeatable delivery side job reuses the same reach-a-point machinery.

import { PLACES, dist, pointBlocked } from './world.js';
import { spawnVehicle, removeVehicle } from './vehicles.js';
import { spawnGuard, removeGuards } from './combat.js';
import { setWantedLevel } from './police.js';
import { saveGame } from './save.js';

/* ---------- step constructors ---------- */

function reach(x, y, r, text, opts = {}) {
  return {
    text, marker: { x, y },
    update(G) {
      const p = G.player;
      if (opts.inCar && !p.car) return null;
      if (opts.onFoot && p.car) return null;
      const t = opts.vehicle || p.car || p;
      return dist(t.x, t.y, x, y) < r ? 'done' : null;
    },
  };
}

function checkpoints(rawPoints, seconds, label) {
  const points = rawPoints.map(([x, y]) => ({ x, y }));
  return {
    text: (run) => `${label} — checkpoint ${Math.min(run.data.i + 1, points.length)}/${points.length} · ${Math.max(0, Math.ceil(run.data.left))}s`,
    marker: (run) => points[Math.min(run.data.i, points.length - 1)],
    onEnter(G, run) { run.data.i = 0; run.data.left = seconds; },
    update(G, run, dt) {
      if (!G.player.car) return null;
      run.data.left -= dt;
      if (run.data.left <= 0) { run.failReason = 'Out of time. The circuit is reset — try again.'; return 'fail'; }
      const pt = points[run.data.i];
      if (dist(G.player.car.x, G.player.car.y, pt.x, pt.y) < 130) {
        run.data.i += 1;
        G.audio.pickup();
        if (run.data.i >= points.length) return 'done';
      }
      return null;
    },
  };
}

/* ---------- the six missions ---------- */

const PROMENADE_START_Y = 2240;

const MISSIONS = [
  {
    id: 'm1', title: 'First Fare', reward: 120,
    brief: 'Eli needs a package driven across town. Take his sedan and deliver it to Ridgeview.',
    setup(G, run) {
      const v = spawnVehicle(G, 'sedan', 1050, 1790, 0, 'mission');
      v.noHeat = true; v.missionTag = 'm1';
      run.data.car = v;
    },
    steps: [
      { text: 'Meet Eli at the garage', marker: { x: PLACES.garage.doorX, y: PLACES.garage.doorY },
        update: (G) => dist(G.player.x, G.player.y, PLACES.garage.doorX, PLACES.garage.doorY) < 120 ? 'done' : null },
      { text: "Take Eli's sedan (E at the door)", marker: (run) => ({ x: run.data.car.x, y: run.data.car.y }),
        update: (G, run) => G.player.car === run.data.car ? 'done' : null },
      reach(3180, 880, 120, 'Deliver the package to the Ridgeview address', { inCar: true }),
    ],
  },
  {
    id: 'm2', title: 'Borrowed Wheels', reward: 180,
    brief: 'A Vela Coupe is parked up in Old Mercado. Eli wants it. Bring it to the garage.',
    setup(G, run) {
      // The coupe is parked somewhere reachable in the blocks around (600, 1050): scan
      // outward for the first spot no building covers, so it never hides inside a wall.
      let spot = { x: 600, y: 1050 };
      outer: for (let r = 0; r <= 280; r += 28) {
        for (let a = 0; a < 8; a += 1) {
          const x = 600 + Math.cos(a * Math.PI / 4) * r;
          const y = 1050 + Math.sin(a * Math.PI / 4) * r;
          if (!pointBlocked(x, y, 26)) { spot = { x, y }; break outer; }
        }
      }
      const v = spawnVehicle(G, 'coupe', spot.x, spot.y, Math.PI / 2, 'mission');
      v.missionTag = 'm2';
      run.data.car = v;
    },
    steps: [
      { text: 'Find the Vela Coupe in Old Mercado', marker: (run) => ({ x: run.data.car.x, y: run.data.car.y }),
        update: (G, run) => dist(G.player.x, G.player.y, run.data.car.x, run.data.car.y) < 110 ? 'done' : null },
      { text: 'Steal the coupe (E)', marker: (run) => ({ x: run.data.car.x, y: run.data.car.y }),
        update: (G, run) => G.player.car === run.data.car ? 'done' : null },
      { text: "Bring the coupe to Eli's garage", marker: { x: PLACES.garage.x, y: PLACES.garage.y },
        update: (G, run) => {
          if (run.data.car.wrecked) { run.failReason = 'The coupe is wrecked. Eli wanted a car, not a sculpture.'; return 'fail'; }
          return dist(run.data.car.x, run.data.car.y, PLACES.garage.x, PLACES.garage.y) < 120 ? 'done' : null;
        } },
    ],
  },
  {
    id: 'm3', title: 'Market Pressure', reward: 220,
    brief: 'Meridian keeps its real ledger in a market stall. Take it back — and get out alive.',
    setup() {},
    steps: [
      reach(PLACES.market.x, PLACES.market.y, 145, 'Go to the Old Mercado market'),
      { text: 'Grab the ledger from the stall (on foot)', marker: { x: PLACES.market.x, y: PLACES.market.y },
        onEnter(G) {
          spawnGuard(G, 1030, 470, { missionTag: 'm3' });
          spawnGuard(G, 1330, 470, { missionTag: 'm3' });
          spawnGuard(G, 1030, 690, { missionTag: 'm3' });
          G.toast = 'Meridian guards! Grab the ledger and run.';
        },
        update: (G) => (!G.player.car && dist(G.player.x, G.player.y, PLACES.market.x, PLACES.market.y) < 55) ? 'done' : null },
      reach(PLACES.safehouse.doorX, PLACES.safehouse.doorY, 110, 'Escape to the safehouse'),
    ],
  },
  {
    id: 'm4', title: 'Vanishing Point', reward: 200,
    brief: 'A camera caught the market job. The whole force is looking for you. Disappear.',
    setup(G) { setWantedLevel(G, 2); },
    steps: [
      { text: 'Break line of sight and lose the police (alleys help)', marker: null,
        update: (G) => G.policeState.wanted === 0 && G.policeState.heat <= 0 ? 'done' : null },
      { text: "Report to Eli at the garage", marker: { x: PLACES.garage.doorX, y: PLACES.garage.doorY },
        update: (G) => dist(G.player.x, G.player.y, PLACES.garage.doorX, PLACES.garage.doorY) < 120 ? 'done' : null },
    ],
  },
  {
    id: 'm5', title: 'Coastline Circuit', reward: 260,
    brief: 'A timed run along the promenade and up through the docks. Beat the clock, keep the car.',
    setup() {},
    steps: [
      reach(300, PROMENADE_START_Y, 130, 'Reach the circuit start on the promenade (in a car)', { inCar: true }),
      checkpoints([[900, 2240], [1500, 2240], [2100, 2240], [2700, 2240], [3300, 2240], [3300, 1480]], 240, 'Coastline Circuit'),
    ],
  },
  {
    id: 'm6', title: 'Harbor Run', reward: 400,
    brief: 'The evidence van sits in Meridian’s yard. Steal it, survive the chase, deliver it to Eli.',
    setup(G, run) {
      const v = spawnVehicle(G, 'van', PLACES.vanYard.x, PLACES.vanYard.y, -Math.PI / 2, 'mission');
      v.missionTag = 'm6';
      run.data.car = v;
    },
    steps: [
      reach(PLACES.docksGate.x, PLACES.docksGate.y, 130, 'Infiltrate Meridian Docks'),
      { text: 'Steal the evidence van (E)', marker: (run) => ({ x: run.data.car.x, y: run.data.car.y }),
        onEnter(G) {
          spawnGuard(G, 2460, 1830, { missionTag: 'm6', alert: true });
          spawnGuard(G, 2660, 1830, { missionTag: 'm6', alert: true });
          G.toast = 'Yard guards! Get to the van.';
        },
        update: (G, run) => {
          if (G.player.car === run.data.car) { setWantedLevel(G, 3); return 'done'; }
          return null;
        } },
      { text: 'Deliver the van to Eli — survive the chase', marker: { x: PLACES.garage.x, y: PLACES.garage.y },
        update: (G, run) => {
          if (run.data.car.wrecked) { run.failReason = 'The evidence van is wrecked — the evidence is gone.'; return 'fail'; }
          return dist(run.data.car.x, run.data.car.y, PLACES.garage.x, PLACES.garage.y) < 135 ? 'done' : null;
        } },
    ],
  },
];

/* ---------- engine ---------- */

export function createMissionsApi(G) {
  const state = { nextIndex: 0, active: null, storyDone: false };
  let sideJob = null;

  function cleanupMissionEntities(id) {
    for (let i = G.vehicles.length - 1; i >= 0; i -= 1) {
      if (G.vehicles[i].missionTag === id && G.player.car !== G.vehicles[i]) removeVehicle(G, G.vehicles[i]);
    }
    removeGuards(G, id);
  }

  function startMission(index) {
    const def = MISSIONS[index];
    const run = { def, stepIndex: 0, data: {}, failReason: null, startedAt: G.time };
    state.active = run;
    def.setup(G, run);
    const first = def.steps[0];
    if (first.onEnter) first.onEnter(G, run);
    G.toast = `Mission: ${def.title} — ${def.brief}`;
    G.toastAt = G.time;
    G.audio.click();
    return run;
  }

  function completeMission() {
    const run = state.active;
    const p = G.player;
    removeGuards(G, run.def.id); // the job is done: its guards stand down and stay at their posts
    p.money += run.def.reward;
    G.audio.chime();
    G.audio.cash();
    G.toast = `${run.def.title} complete! +$${run.def.reward}`;
    G.toastAt = G.time;
    state.active = null;
    state.nextIndex += 1;
    if (run.def.id === 'm6') {
      state.storyDone = true;
      G.storyCompleteAt = G.time;
    }
    saveGame(G, 'mission');
  }

  function failMission(reason) {
    const run = state.active;
    if (!run) return;
    removeGuards(G, run.def.id); // a failed job resets its guards too — retry starts clean
    G.missionFailed = { title: run.def.title, reason: reason || run.failReason || 'It went wrong.' };
    G.audio.fail();
  }

  /** Retry after a failure or a death mid-mission: entities restored, resources floored. */
  function retryMission() {
    const run = state.active;
    if (!run) return;
    cleanupMissionEntities(run.def.id);
    const p = G.player;
    if (p.car) { p.car = null; }
    p.x = PLACES.garage.x; p.y = PLACES.garage.y + 40;
    p.hp = p.maxHp;
    p.ammo = Math.max(p.ammo, 12);
    p.reserve = Math.max(p.reserve, 24);
    p.dead = null;
    G.policeState.heat = 0;
    G.policeState.mode = 'calm';
    G.bullets.length = 0;
    const fresh = { def: run.def, stepIndex: 0, data: {}, failReason: null, startedAt: G.time };
    state.active = fresh;
    run.def.setup(G, fresh);
    const first = run.def.steps[0];
    if (first.onEnter) first.onEnter(G, fresh);
    G.toast = `Retry: ${run.def.title}`;
    G.toastAt = G.time;
  }

  function currentStep() {
    const run = state.active;
    return run ? run.def.steps[run.stepIndex] : null;
  }

  function stepText() {
    const run = state.active;
    if (!run) return null;
    const s = currentStep();
    return typeof s.text === 'function' ? s.text(run) : s.text;
  }

  function stepMarker() {
    const run = state.active;
    if (!run) return null;
    const s = currentStep();
    if (!s.marker) return null;
    return typeof s.marker === 'function' ? s.marker(run) : s.marker;
  }

  function update(dt) {
    const run = state.active;
    if (run && !G.player.dead) {
      const s = currentStep();
      const verdict = s.update(G, run, dt);
      if (verdict === 'done') {
        G.audio.pickup();
        run.stepIndex += 1;
        if (run.stepIndex >= run.def.steps.length) completeMission();
        else {
          const next = currentStep();
          if (next.onEnter) next.onEnter(G, run);
        }
      } else if (verdict === 'fail') failMission();
    }
    if (sideJob) {
      if (dist(G.player.x, G.player.y, sideJob.x, sideJob.y) < 85 && G.player.car) {
        G.player.money += sideJob.pay;
        G.sideJobsDone = (G.sideJobsDone || 0) + 1;
        G.audio.cash();
        G.toast = `Delivery done! +$${sideJob.pay}`;
        G.toastAt = G.time;
        sideJob = null;
        saveGame(G, 'sidejob');
      }
    }
  }

  /** E-key hook used by the player: starting the next job at Eli's door is the main one. */
  function tryInteract() {
    if (state.active) return false;
    const p = G.player;
    if (state.nextIndex < MISSIONS.length && dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 85) {
      startMission(state.nextIndex);
      return true;
    }
    return false;
  }

  function interactHint() {
    if (state.active) return '';
    const p = G.player;
    if (state.nextIndex < MISSIONS.length && dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 85) {
      return `E — start job: ${MISSIONS[state.nextIndex].title}`;
    }
    if (dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) < 85 && !sideJob) return 'J — take a delivery job ($90)';
    return '';
  }

  /** J key: a repeatable delivery across town, offered at the garage between story jobs. */
  function trySideJob() {
    if (state.active || sideJob) return false;
    const p = G.player;
    if (dist(p.x, p.y, PLACES.garage.doorX, PLACES.garage.doorY) >= 85) return false;
    const drops = [[3180, 280], [300, 880], [3300, 880], [280, 2240], [3300, 2240], [2080, 280], [1480, 1480]];
    const d = drops[Math.floor(G.rng() * drops.length)];
    sideJob = { x: d[0], y: d[1], pay: 90 };
    G.toast = 'Delivery job: drive the marker across town. $90 on arrival.';
    G.toastAt = G.time;
    return true;
  }

  function objectiveText() {
    if (state.active) return `${state.active.def.title}: ${stepText()}`;
    if (sideJob) return 'Delivery: reach the yellow marker in a car ($90)';
    if (state.nextIndex < MISSIONS.length) return `New job at Eli's Garage: ${MISSIONS[state.nextIndex].title}`;
    return 'Free roam — Brisava is yours. Deliveries pay at the garage (J).';
  }

  function objectiveMarker() {
    if (state.active) return stepMarker();
    if (sideJob) return { x: sideJob.x, y: sideJob.y };
    if (state.nextIndex < MISSIONS.length) return { x: PLACES.garage.doorX, y: PLACES.garage.doorY };
    return null;
  }

  return {
    state, MISSIONS,
    startMission, completeMission, failMission, retryMission,
    update, tryInteract, interactHint, trySideJob,
    objectiveText, objectiveMarker,
    get sideJob() { return sideJob; },
  };
}
