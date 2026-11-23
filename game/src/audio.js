// Every sound in Brisava is synthesized with Web Audio — no audio files, no network. The
// context is created lazily on the first user gesture (a menu click or keypress), as browsers
// require. Continuous sounds (engine, siren) are small node graphs whose parameters the game
// updates each frame; one-shots (gunshot, horn, chimes) are built, played and dropped.

export function createAudio() {
  const settings = { volume: 0.7, muted: false };
  try {
    const raw = window.localStorage.getItem('brisava-audio');
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch { /* storage off: defaults apply */ }

  let ctx = null;
  let master = null;
  let engineNodes = null;
  let sirenNodes = null;

  function persist() {
    try { window.localStorage.setItem('brisava-audio', JSON.stringify(settings)); } catch { /* ignore */ }
  }

  /** Create/resume the context. Must be called from a user-gesture handler at least once. */
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.muted ? 0 : settings.volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, v));
    if (master && ctx) master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, ctx.currentTime, 0.03);
    persist();
  }

  function setMuted(m) {
    settings.muted = !!m;
    if (master && ctx) master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, ctx.currentTime, 0.02);
    persist();
  }

  function blip(freq, dur, type, gain, slideTo) {
    if (!ctx || settings.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, gain, filterFreq) {
    if (!ctx || settings.muted) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  /** Engine loop while driving: pitch follows speed. Call with speed 0 (or stopEngine) to end it. */
  function engine(speedRatio, running) {
    if (!ctx) return;
    if (!running || settings.muted) {
      if (engineNodes) { try { engineNodes.o.stop(); } catch { /* already stopped */ } engineNodes = null; }
      return;
    }
    if (!engineNodes) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'square';
      g.gain.value = 0.05;
      o.connect(g); o2.connect(g); g.connect(master);
      o.start(); o2.start();
      engineNodes = { o, o2, g };
    }
    const f = 55 + speedRatio * 165;
    engineNodes.o.frequency.setTargetAtTime(f, ctx.currentTime, 0.06);
    engineNodes.o2.frequency.setTargetAtTime(f * 0.5 + 2, ctx.currentTime, 0.06);
  }

  /** Two-tone siren while police are close and active. */
  function siren(active, closeness) {
    if (!ctx) return;
    if (!active || settings.muted) {
      if (sirenNodes) { try { sirenNodes.o.stop(); } catch { /* already stopped */ } sirenNodes = null; }
      return;
    }
    if (!sirenNodes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; g.gain.value = 0.0;
      o.connect(g); g.connect(master); o.start();
      sirenNodes = { o, g, t: 0 };
    }
    sirenNodes.t += 1 / 60;
    const tone = Math.floor(sirenNodes.t * 1.6) % 2 === 0 ? 660 : 880;
    sirenNodes.o.frequency.setTargetAtTime(tone, ctx.currentTime, 0.03);
    sirenNodes.g.gain.setTargetAtTime(0.028 + closeness * 0.05, ctx.currentTime, 0.1);
  }

  return {
    settings,
    unlock,
    setVolume,
    setMuted,
    isReady: () => !!ctx,
    engine,
    siren,
    horn: () => { blip(370, 0.28, 'square', 0.12); blip(466, 0.28, 'square', 0.09); },
    gunshot: () => noiseBurst(0.14, 0.5, 2600),
    dryFire: () => blip(1200, 0.05, 'square', 0.08),
    reload: () => { blip(500, 0.07, 'square', 0.1); setTimeout(() => blip(760, 0.07, 'square', 0.1), 120); },
    hit: () => noiseBurst(0.08, 0.25, 900),
    crash: (hard) => noiseBurst(hard ? 0.3 : 0.15, hard ? 0.5 : 0.25, 700),
    pickup: () => { blip(880, 0.09, 'sine', 0.14); setTimeout(() => blip(1320, 0.12, 'sine', 0.12), 70); },
    chime: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'sine', 0.13), i * 85)); },
    fail: () => { blip(330, 0.25, 'sawtooth', 0.1, 196); },
    cash: () => { blip(1568, 0.08, 'square', 0.09); setTimeout(() => blip(2093, 0.14, 'square', 0.09), 60); },
    click: () => blip(700, 0.05, 'sine', 0.1),
  };
}
