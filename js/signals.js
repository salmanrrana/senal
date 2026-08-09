// SEÑAL — signal collection.
// Everything the browser hands over without asking becomes geometry.

// xmur3 string hash → 32-bit seed
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// mulberry32 PRNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gpuInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { renderer: 'none', maxTex: 0 };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return { renderer: String(renderer), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  } catch {
    return { renderer: 'unknown', maxTex: 0 };
  }
}

function loadTiming() {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      return {
        loadMs: Math.max(1, Math.round(nav.domContentLoadedEventEnd - nav.startTime)) || 1,
        ttfbMs: Math.max(1, Math.round(nav.responseStart - nav.startTime)) || 1,
      };
    }
  } catch { /* older browsers */ }
  return { loadMs: Math.round(performance.now()) || 1, ttfbMs: 1 };
}

export async function collectSignals() {
  const gpu = gpuInfo();
  const timing = loadTiming();
  const conn = navigator.connection || {};
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const s = {
    gpu: gpu.renderer,
    maxTex: gpu.maxTex,
    cores: navigator.hardwareConcurrency || 2,
    memoryGB: navigator.deviceMemory || 0,   // Chrome-only, 0 elsewhere
    screenW: screen.width,
    screenH: screen.height,
    colorDepth: screen.colorDepth,
    dpr: window.devicePixelRatio || 1,
    tz,
    tzOffset: new Date().getTimezoneOffset(),
    lang: navigator.language || 'en',
    langs: (navigator.languages || []).length,
    platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '?',
    touchPoints: navigator.maxTouchPoints || 0,
    downlink: conn.downlink ?? 0,            // Mbit/s
    rtt: conn.rtt ?? 0,                      // ms
    effectiveType: conn.effectiveType || '?',
    loadMs: timing.loadMs,
    ttfbMs: timing.ttfbMs,
    battery: null,
    charging: null,
    hourOfDay: new Date().getHours(),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  // Battery needs no permission where it exists.
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      s.battery = b.level;
      s.charging = b.charging;
      s._batteryRef = b; // live updates
    }
  } catch { /* fine */ }

  return s;
}

// The device's identity string → seed. Two machines should basically never collide.
export function seedFromSignals(s) {
  const identity = [
    s.gpu, s.maxTex, s.cores, s.memoryGB, s.screenW, s.screenH,
    s.colorDepth, s.dpr, s.tz, s.lang, s.langs, s.platform,
    s.touchPoints, s.effectiveType, s.colorDepth,
  ].join('|');
  return xmur3(identity)();
}

// Session salt: timing + network make each *visit* drift a little,
// so the organism is recognizably yours but never frozen.
export function saltFromSignals(s) {
  const salt = [s.loadMs, s.ttfbMs, s.downlink, s.rtt, s.hourOfDay].join('|');
  return xmur3(salt)();
}
