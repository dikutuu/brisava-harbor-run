[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/dikutuu/brisava-harbor-run/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/dikutuu/brisava-harbor-run/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Brisava: Harbor Run

An original open-world crime game in the browser — a 2.5D top-down Canvas 2D city built with
plain JavaScript ES modules. No libraries, no build step, no network.

You are **Mara Venn**, a freelance driver working off the debts of Eli Rook's little garage
while the port contractor **Meridian Quay** — fronted by the smiling Iris Vale — rigs every
shipment in the city. Four connected districts: **Sunline Coast** (turquoise sea, promenade,
palms, pastel blocks), **Old Mercado** (dense streets, the market, alleys, murals),
**Meridian Docks** (containers, cranes, warehouses) and **Ridgeview** (hillside streets, a
park, quiet houses).

What's in the city:

- **On foot and behind the wheel** — walk, sprint on stamina, aim and shoot with the mouse,
  melee, reload; steal three classes of car (balanced sedan, fast drifty coupe, heavy van)
  plus the odd police cruiser, each with its own acceleration, grip, damage and wreck state.
- **A living city** — lane-following traffic with safe distances and stuck recovery, and
  pedestrians who stroll the sidewalks, dodge cars and flee gunfire.
- **A real wanted system** — crimes raise heat (theft, assault, gunfire, ramming a cruiser);
  police patrol, investigate, pursue on line of sight (buildings break it), search your last
  known position, and disengage. Three stars bring three cruisers and foot officers.
- **A six-mission story** — First Fare, Borrowed Wheels, Market Pressure, Vanishing Point,
  Coastline Circuit and the Harbor Run finale — plus repeatable delivery jobs, a garage shop
  (ammo, repairs, a permanent turbo), and autosaves at mission ends and the safehouse.
- **Synthesized sound** — engine, horn, gunshots, sirens and chimes from Web Audio. No files.

## Controls

| Keys | Action |
| --- | --- |
| WASD / arrows | Move · drive |
| Shift | Sprint (stamina) |
| Mouse + click | Aim and shoot |
| F / R | Melee / reload |
| E | Interact · enter/exit a car · take a job |
| Space / H | Handbrake / horn |
| B / J | Garage shop / delivery job (at the garage) |
| M / Esc | City map / pause |

## Run it locally

```sh
node serve.ts
```

then open <http://localhost:8080>. To package the entry the way the grader does:

```sh
node main.ts   # copies game/ + screenshots/ to /output and writes dossier.json
```

Entered in make.fun's [Make GTA 6 bounty](https://make.fun/bounty/gta6-01).
