// SEÑAL — the drone. Audible moiré.
//
// Two oscillators tuned a few Hz apart beat against each other exactly the
// way two gratings a few lines apart shimmer: interference you can hear.
// The same genome that draws your lines tunes these voices, so your
// machine has a chord the way it has a colorway.
//
// Chain per voice:  osc ×2 (detuned pair) → voice gain ┐
//                   vibrato LFO → osc.frequency        │
// Sum: voices → lowpass (slow oscillating cutoff) → dry ┬→ master → out
//                                        └→ convolver reverb (generated) ┘
// All signal-reactive: face position = stereo pan + filter, proximity =
// intensity, tilt = vibrato depth, light = brightness, fps strain = grit.

import { mulberry32 } from './signals.js';

// Desert pentatonic-ish ratio set — every interval consonant enough to
// drone forever, spicy enough to feel like border radio at 3am.
const RATIOS = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2];

export class Drone {
  constructor(genome, signals) {
    this.genome = genome;
    this.signals = signals;
    this.ctx = null;
    this.running = false;
    this.voices = [];
    this._analyserData = null;
  }

  // Must be called from a user gesture (autoplay policy).
  async start() {
    if (this.running) { return; }
    const ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const rand = mulberry32(this.genome.seed ^ 0xa0d10);
    const g = this.genome;
    const s = this.signals;
    const t0 = ctx.currentTime;

    // ---- master ----
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.0001, t0);
    this.master.gain.exponentialRampToValueAtTime(0.5, t0 + 4); // slow fade-in
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -18;
    this.limiter.knee.value = 20;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.01;
    this.limiter.release.value = 0.4;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // ---- the oscillating lowpass: "chill" lives here ----
    // Cutoff breathes on the same slow tempo family as the visual breathing.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 1.2;

    this.filterLFO = ctx.createOscillator();
    this.filterLFO.frequency.value = 0.06 + rand() * 0.05; // ~12-20s sweep
    this.filterLFOGain = ctx.createGain();
    this.filterLFOGain.gain.value = 450;
    this.filterLFO.connect(this.filterLFOGain);
    this.filterLFOGain.connect(this.filter.frequency);
    this.filterLFO.start();

    // ---- reverb: generated impulse, no samples. Big desert hall. ----
    // RAM sets the room size — more memory, longer tail (2.5s..7s).
    const tail = 2.5 + Math.min((s.memoryGB || 4), 16) * 0.28;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(ctx, tail, 2.2, rand);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.5;

    // stereo space
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const preOut = this.panner || this.master;
    this.filter.connect(this.dry);
    this.filter.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.dry.connect(preOut);
    this.wet.connect(preOut);
    if (this.panner) this.panner.connect(this.master);

    // ---- voices: one per grating family, seeded like the lines ----
    // Root pitch from the GPU-owned grating; low, warm. 55-ish Hz region.
    const root = 48 + (g.seed % 24); // 48..72 Hz
    // Beat rates come from the SAME freq deltas that make the visual moiré:
    // grating i vs grating i+1 difference, squashed into 0.4..7 Hz.
    // Each signal picks from the ratios *not yet taken*, so the chord always
    // has four distinct tones — no accidental unisons when two signals hash
    // to the same interval.
    const pool = RATIOS.slice(1); // root is reserved for the gpu voice
    const take = (n) => pool.splice(n % pool.length, 1)[0];
    const voiceDefs = [
      { ratio: RATIOS[0], owner: 'gpu' },
      { ratio: take(s.cores || 2), owner: 'cores' },
      { ratio: take(Math.round(s.memoryGB) || 4), owner: 'ram' },
      { ratio: take(Math.round(s.downlink * 10) || 1) * 2, owner: 'net' },
    ];

    this.voices = voiceDefs.map((def, i) => {
      const gr = g.gratings[i];
      const grNext = g.gratings[(i + 1) % g.gratings.length];
      const beat = 0.4 + (Math.abs(gr.freq - grNext.freq) % 33) * 0.2; // Hz

      const freq = root * def.ratio;
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      // triangle base = soft; net voice gets sawtooth through the filter for shimmer
      oscA.type = i === 3 ? 'sawtooth' : 'triangle';
      oscB.type = i === 3 ? 'sawtooth' : 'triangle';
      oscA.frequency.value = freq;
      oscB.frequency.value = freq + beat; // ← the audible moiré

      // vibrato LFO per voice — rate seeded, depth driven live by tilt
      const vib = ctx.createOscillator();
      vib.frequency.value = 2.5 + rand() * 3.5; // 2.5..6 Hz classic vibrato
      const vibGain = ctx.createGain();
      vibGain.gain.value = freq * 0.006; // gentle at rest
      vib.connect(vibGain);
      vibGain.connect(oscA.frequency);
      vibGain.connect(oscB.frequency);

      const vg = ctx.createGain();
      vg.gain.value = i === 3 ? 0.05 : 0.14 - i * 0.02;
      oscA.connect(vg);
      oscB.connect(vg);
      vg.connect(this.filter);

      oscA.start(); oscB.start(); vib.start();
      return { oscA, oscB, vib, vibGain, vg, freq, beat, def };
    });

    // battery tempo → filter LFO speed nudge (dying machine drones slower)
    if (s.battery != null) {
      this.filterLFO.frequency.value *= 0.6 + s.battery * 0.6;
    }

    this.running = true;
  }

  async stop() {
    if (!this.running || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const voices = this.voices;
    setTimeout(() => {
      voices.forEach((v) => { try { v.oscA.stop(); v.oscB.stop(); v.vib.stop(); } catch { /* already stopped */ } });
      try { this.filterLFO.stop(); } catch { /* already stopped */ }
    }, 1400);
    this.voices = [];
    this.running = false;
    // keep ctx for cheap restart
  }

  // Exponentially-decaying noise burst = perfectly serviceable hall impulse.
  _impulse(ctx, seconds, decay, rand) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // Called every render frame with the same live state the shader gets.
  update(live, dt) {
    if (!this.running || !this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, dt * 2.5); // smoothing

    // Face x → stereo pan. The person walks across your speakers.
    if (this.panner) {
      const target = (live.focus[0] - 0.5) * 1.6;
      this.panner.pan.value += (target - this.panner.pan.value) * k;
    }

    // Proximity → intensity: closer = hotter mix, more wet, wider vibrato.
    const prox = live.proximity;
    const wetTarget = 0.45 + prox * 0.4;          // deeper reverb up close
    this.wet.gain.value += (wetTarget - this.wet.gain.value) * k;

    // Face y → filter center: look up = open sky, look down = underground.
    const fY = 1 - live.focus[1];
    const cutTarget = 350 + fY * 1400 + live.dayness * 500 + prox * 800;
    // LFO adds ±450 around this; setTargetAtTime keeps it click-free.
    this.filter.frequency.setTargetAtTime(cutTarget, t, 0.35);

    // Tilt magnitude → vibrato depth (device shake = warble).
    const tiltMag = Math.min(1, Math.hypot(live.tilt[0], live.tilt[1]));
    for (const v of this.voices) {
      const depth = v.freq * (0.006 + tiltMag * 0.035 + prox * 0.012);
      v.vibGain.gain.value += (depth - v.vibGain.gain.value) * k;
    }

    // Strain (low fps) → the saw voice grits louder. Struggle is audible.
    const saw = this.voices[3];
    if (saw) {
      const gTarget = 0.05 + live.strain * 0.06;
      saw.vg.gain.value += (gTarget - saw.vg.gain.value) * k;
    }
  }
}
