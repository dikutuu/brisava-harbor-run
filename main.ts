// Brisava: Harbor Run — a gta6-01 entry (Node 22, standard library only). The game is this
// directory's game/ folder: plain static files a desktop browser loads offline (game/index.html
// and its ES modules, no library, no network), an original 2.5D top-down open-world crime game
// — four districts, stealable cars, traffic, pedestrians, a wanted system with real police AI,
// mouse-aim combat and a six-mission story. This program packages it: it validates the entry
// with its own checks first, copies game/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_SCREENSHOT_BYTES = 262144;

/** Every file under a directory, as paths relative to it. */
function listFiles(dir: string, prefix = ''): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) names.push(rel);
  }
  return names;
}

// My own gate before anything is copied: the entry must be the game I think it is. A missing
// entry point, the wrong number of screenshots, or one oversized screenshot would be refused
// by the scorer anyway — better to fail here, in my own words, before a byte is packaged.
const gameDir = join(here, 'game');
if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('brisava: game/index.html is missing — there is no game to package.');
}
const gameFiles = listFiles(gameDir);
const shotsDir = join(here, 'screenshots');
const shotFiles = existsSync(shotsDir) ? listFiles(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f)) : [];
if (shotFiles.length < 3 || shotFiles.length > 4) {
  throw new Error(`brisava: screenshots/ must hold 3 or 4 images, found ${shotFiles.length} (${shotFiles.join(', ') || 'none'}).`);
}
let shotBytes = 0;
for (const name of shotFiles) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > MAX_SCREENSHOT_BYTES) {
    throw new Error(`brisava: screenshot ${name} is ${size} bytes, over the ${MAX_SCREENSHOT_BYTES}-byte cap.`);
  }
  shotBytes += size;
}
const gameBytes = gameFiles.reduce((sum, f) => sum + statSync(join(gameDir, f)).size, 0);
console.log(`brisava: packaging ${gameFiles.length} game files (${gameBytes} bytes) and ${shotFiles.length} screenshots (${shotBytes} bytes): ${shotFiles.join(', ')}`);

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
console.log('brisava: dossier.json written.');
