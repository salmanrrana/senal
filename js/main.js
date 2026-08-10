// SEÑAL — orchestration. Signals → genome → shader, with the tracker
// feeding live focus/light/tilt/geo into every frame.

import { collectSignals } from './signals.js';
import { buildGenome, liveState } from './pattern.js';
import { Renderer } from './renderer.js';
import { Tracker } from './tracker.js';
import { Drone } from './audio.js';
import { mulberry32 } from './signals.js';

const canvas = document.getElementById('field');
const $ = (id) => document.getElementById(id);
const MODE = document.body.dataset.mode === 'moire' ? 'moire' : 'trip';

let signals, genome, renderer, drone;
const tracker = new Tracker();

// FPS meter — itself a signal fed back into the pattern.
let fps = 60, frames = 0, fpsClock = 0;

// Seeded wander for when no one has granted anything: the organism
// still breathes, moving its own focus around.
let wander;

function fmt(n, d = 0) {
  return n == null ? '—' : Number(n).toFixed(d);
}

function renderReadout() {
  const rows = [
    ['gpu', signals.gpu.length > 34 ? signals.gpu.slice(0, 34) + '…' : signals.gpu, 'linear grating · base freq'],
    ['cpu', `${signals.cores} cores`, 'beat grating · interference'],
    ['ram', signals.memoryGB ? `${signals.memoryGB} GB` : 'undisclosed', 'ring grating · density'],
    ['net', `${fmt(signals.downlink, 1)} Mb/s · ${signals.rtt} ms rtt`, 'radial ripple · freq'],
    ['screen', `${signals.screenW}×${signals.screenH} @${signals.dpr}x`, 'shear grating · angle'],
    ['load', `${signals.loadMs} ms`, 'slow ripple · wavelength'],
    ['zone', `${signals.tz}`, 'space fold · warp'],
    ['power', signals.battery == null ? 'undisclosed' : `${Math.round(signals.battery * 100)}%${signals.charging ? ' ⚡' : ''}`, 'tempo'],
  ];
  const readout = $('readout');
  readout.replaceChildren(...rows.map(([k, v, use]) => {
    const row = document.createElement('div');
    row.className = 'row';
    for (const [cls, text] of [['k', k], ['v', v], ['use', use]]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      row.appendChild(span);
    }
    return row;
  }));

  const inks = $('inks');
  inks.replaceChildren(
    ...genome.inks.map((i) => {
      const [r, g, b] = i.rgb.map((c) => Math.round(c * 255));
      const chip = document.createElement('span');
      chip.className = 'ink';
      chip.style.background = `rgb(${r},${g},${b})`;
      chip.title = i.name;
      return chip;
    })
  );
  const names = document.createElement('span');
  names.className = 'ink-names';
  names.textContent = genome.inks.map((i) => i.name).join(' / ');
  inks.appendChild(names);
  $('seed').textContent = `specimen №${(genome.seed >>> 0).toString(16).padStart(8, '0')} · ${genome.world === 'night' ? 'far-west night' : 'alkali day'}`;
}

function setPill(id, state, label) {
  const el = $(id);
  el.dataset.state = state;
  el.querySelector('.pill-status').textContent = label;
}

async function grantCamera() {
  setPill('perm-camera', 'wait', 'opening…');
  try {
    const mode = await tracker.startCamera();
    const label = mode === 'luma' ? 'watching · light' : 'watching · faces';
    setPill('perm-camera', 'on', label);
  } catch {
    setPill('perm-camera', 'err', 'denied');
  }
}

async function grantMotion() {
  setPill('perm-motion', 'wait', '…');
  try {
    await tracker.startGyro();
    setPill('perm-motion', 'on', 'feeling tilt');
  } catch {
    setPill('perm-motion', 'err', 'denied');
  }
}

async function grantGeo() {
  setPill('perm-geo', 'wait', 'locating…');
  try {
    const c = await tracker.startGeo();
    setPill('perm-geo', 'on', `${c.latitude.toFixed(2)}°, ${c.longitude.toFixed(2)}°`);
  } catch {
    setPill('perm-geo', 'err', 'denied');
  }
}

function bindUI() {
  $('perm-camera').addEventListener('click', () =>
    tracker.mode !== 'off'
      ? (tracker.stopCamera(), setPill('perm-camera', 'off', 'grant'))
      : grantCamera());
  $('perm-motion').addEventListener('click', grantMotion);
  $('perm-geo').addEventListener('click', grantGeo);

  $('toggle-panel').addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });

  $('toggle-sound').addEventListener('click', async () => {
    const btn = $('toggle-sound');
    if (!drone) {
      drone = new Drone(genome, signals);
      window.__senalDrone = drone; // debug/testing handle
    }
    if (drone.running) {
      await drone.stop();
      btn.setAttribute('aria-pressed', 'false');
      $('sound-label').textContent = 'drone off';
    } else {
      try {
        await drone.start();
        btn.setAttribute('aria-pressed', 'true');
        $('sound-label').textContent = 'drone on';
      } catch (e) {
        console.error('audio failed:', e);
        $('sound-label').textContent = 'no audio';
      }
    }
  });

  // Mouse/touch as stand-in person when camera is off.
  window.addEventListener('pointermove', (e) => {
    tracker.pointTo(e.clientX / innerWidth, e.clientY / innerHeight);
  });

  // Live network changes re-grow the network gratings mid-flight.
  if (navigator.connection) {
    navigator.connection.addEventListener('change', () => {
      signals.downlink = navigator.connection.downlink ?? signals.downlink;
      signals.rtt = navigator.connection.rtt ?? signals.rtt;
      genome = buildGenome(signals);
      renderer.setGenome(genome);
      renderReadout();
    });
  }
  if (signals._batteryRef) {
    const b = signals._batteryRef;
    const sync = () => {
      signals.battery = b.level;
      signals.charging = b.charging;
      renderReadout();
    };
    b.addEventListener('levelchange', sync);
    b.addEventListener('chargingchange', sync);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  frames++;
  fpsClock += dt;
  if (fpsClock >= 1) {
    fps = frames / fpsClock;
    frames = 0;
    fpsClock = 0;
    $('fps').textContent = `${Math.round(fps)} hz`;
  }

  // No camera, no pointer recently? Seeded wander keeps it alive.
  if (tracker.mode === 'off') {
    const t = now * 0.00013;
    const wx = 0.5 + 0.28 * Math.sin(t * (0.7 + wander * 0.6) + wander * 6);
    const wy = 0.5 + 0.24 * Math.cos(t * (0.9 + wander * 0.4) + wander * 3);
    tracker._targetX = tracker._targetX * 0.995 + wx * 0.005;
    tracker._targetY = tracker._targetY * 0.995 + wy * 0.005;
  }

  tracker.update(dt);

  const state = liveState(genome, {
    focusX: tracker.focusX,
    focusY: tracker.focusY,
    proximity: tracker.proximity,
    luma: tracker.luma,
    tiltX: tracker.tiltX,
    tiltY: tracker.tiltY,
    fps,
    geoLat: tracker.geoLat,
    geoLon: tracker.geoLon,
    time: now / 1000,
  });
  renderer.draw(state);
  if (drone) drone.update(state, dt);
  requestAnimationFrame(frame);
}

async function boot() {
  signals = await collectSignals();
  genome = buildGenome(signals);
  wander = mulberry32(genome.seed ^ 0x5eed)();

  try {
    renderer = new Renderer(canvas, MODE);
  } catch (e) {
    console.error('renderer failed:', e);
    $('nogl').hidden = false;
    return;
  }
  renderer.setGenome(genome);
  renderReadout();
  bindUI();
  requestAnimationFrame(frame);
}

boot();
