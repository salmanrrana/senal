// SEÑAL — pattern genome.
// Turns raw signals into the parameter set the shader renders.

import { mulberry32, seedFromSignals, saltFromSignals } from './signals.js';

// Desert-acid pool. Screenprint inks, not gradients.
// Joshua Tree sunset / Warhol silkscreen / Marfa neon / Endless Summer poster.
const INKS = [
  { name: 'yucca pink',     rgb: [0.996, 0.176, 0.573] },
  { name: 'cadmium sun',    rgb: [1.000, 0.800, 0.000] },
  { name: 'agave teal',     rgb: [0.000, 0.808, 0.788] },
  { name: 'sunset orange',  rgb: [1.000, 0.372, 0.122] },
  { name: 'prada violet',   rgb: [0.545, 0.361, 0.965] },
  { name: 'bone white',     rgb: [0.980, 0.953, 0.898] },
  { name: 'basquiat green', rgb: [0.290, 0.871, 0.502] },
  { name: 'radio red',      rgb: [0.937, 0.267, 0.267] },
];

const GROUNDS = {
  night: { name: 'far-west night', rgb: [0.055, 0.031, 0.102] },
  day:   { name: 'alkali flat',    rgb: [0.965, 0.937, 0.878] },
};

function pick(rand, arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

// Map a value into [lo, hi] with wraparound so weird inputs still land in range.
function span(v, lo, hi) {
  const t = Math.abs(v) % 1;
  return lo + t * (hi - lo);
}

export function buildGenome(signals) {
  const seed = seedFromSignals(signals);
  const salt = saltFromSignals(signals);
  const rand = mulberry32(seed);
  const drift = mulberry32(seed ^ salt);

  // World: device hash decides night or day ground; camera light can override later.
  const world = rand() < 0.55 ? 'night' : 'day';

  // Inks: 3 per device, seeded — your machine always prints in its own colorway.
  const inks = pick(rand, INKS, 3);

  // Six gratings. Each one is owned by a specific hardware signal so the
  // readout panel can honestly say "this line family = your CPU".
  const gratings = [
    { // 0 — GPU: base linear grating. Frequency from renderer hash.
      owner: 'gpu',
      kind: 0, // linear
      freq: 40 + (seed % 90),
      angle: rand() * Math.PI,
      phase: rand() * 6.283,
    },
    { // 1 — CPU cores: second linear set. The beat between 0 and 1 IS the moiré.
      owner: 'cores',
      kind: 0,
      freq: 40 + (seed % 90) + signals.cores * 1.7,
      angle: rand() * Math.PI + span(signals.cores / 32, 0.02, 0.14),
      phase: rand() * 6.283,
    },
    { // 2 — RAM: square/ring grating. More memory = denser rings.
      owner: 'memoryGB',
      kind: 2,
      freq: 24 + (signals.memoryGB || 4) * 6 + drift() * 10,
      angle: rand() * Math.PI,
      phase: rand() * 6.283,
    },
    { // 3 — network: radial grating centered on the tracked face/object.
      owner: 'network',
      kind: 1,
      freq: 30 + Math.min(signals.downlink * 6, 60) + Math.min(signals.rtt * 0.1, 30),
      angle: 0,
      phase: rand() * 6.283,
    },
    { // 4 — screen: linear, angle from aspect ratio, freq from pixel density.
      owner: 'screen',
      kind: 0,
      freq: 30 + signals.dpr * 22 + (signals.screenW % 47),
      angle: Math.atan2(signals.screenH, signals.screenW),
      phase: rand() * 6.283,
    },
    { // 5 — load time: radial too; slow connections make wide slow ripples.
      owner: 'loadMs',
      kind: 1,
      freq: Math.max(12, 70 - Math.min(signals.loadMs / 40, 55)) + drift() * 8,
      angle: 0,
      phase: drift() * 6.283,
    },
  ];

  // Motion tempo: battery + hour of day. Low battery = slower organism.
  const batteryFactor = signals.battery == null ? 0.8 : 0.35 + signals.battery * 0.85;
  const tempo = signals.reducedMotion ? 0.06 : (0.35 + drift() * 0.5) * batteryFactor;

  // Posterization bands: color depth + timezone → 3..7 hard screenprint steps.
  const bands = 3 + ((signals.colorDepth + Math.abs(signals.tzOffset)) % 5);

  // Warp: timezone offset bends space; languages count adds swirl.
  const warp = span(signals.tzOffset / 720, 0.05, 0.5) + signals.langs * 0.015;

  // Trip geometry: petal count of the kaleidoscope fold comes from CPU
  // cores (odd counts look more organic), hue-crawl speed from network.
  const kaleido = [5, 7, 9, 11][signals.cores % 4] || 7;
  const hueSpeed = 0.25 + span(signals.downlink / 20, 0.05, 0.35);

  return {
    seed, salt, world, inks, gratings, tempo, bands, warp,
    kaleido, hueSpeed,
    ground: GROUNDS[world],
    grainAmp: 0.05 + drift() * 0.05,
  };
}

// Live mutation: called every frame with the current live-signal state.
// Returns uniform-ready numbers. This is what makes it "alive".
export function liveState(genome, live) {
  // live: { focusX, focusY, proximity, luma, tiltX, tiltY, fps, geoLat, geoLon, time }
  const g = genome;

  // Camera luminance drags the world toward day; darkness toward night.
  const dayness = live.luma == null
    ? (g.world === 'day' ? 1 : 0)
    : Math.min(1, Math.max(0, live.luma * 1.6 - 0.15));

  // Geolocation, when granted, becomes a fixed spatial warp — the piece is
  // literally different in Marfa than in Tokyo.
  const geoPhase = live.geoLat == null
    ? 0
    : (live.geoLat * 0.031 + live.geoLon * 0.017);

  // FPS is a live signal too: a struggling machine draws heavier lines.
  const strain = live.fps ? Math.min(1, Math.max(0, (60 - live.fps) / 45)) : 0;

  return {
    focus: [live.focusX ?? 0.5, live.focusY ?? 0.5],
    proximity: live.proximity ?? 0,
    dayness,
    geoPhase,
    strain,
    tilt: [live.tiltX ?? 0, live.tiltY ?? 0],
    t: live.time * g.tempo,
  };
}
