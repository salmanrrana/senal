// SEÑAL — WebGL2 renderer. One fullscreen quad, one fragment shader,
// six interfering gratings posterized into screenprint inks.

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_focus;      // tracked face / object, 0..1
uniform float u_proximity;  // 0 = far, 1 = face fills frame -> trip depth
uniform float u_dayness;    // 0 night ground .. 1 day ground
uniform float u_geoPhase;   // lat/lon fold, 0 if not granted
uniform float u_strain;     // machine struggling -> heavier lines
uniform vec2  u_tilt;       // gyroscope, radians-ish
uniform float u_warp;
uniform float u_bands;
uniform float u_grain;
uniform float u_kaleido;    // seeded petal count for the chrysanthemum fold
uniform float u_hue;        // seeded hue-crawl speed
uniform vec3  u_ink0;
uniform vec3  u_ink1;
uniform vec3  u_ink2;
uniform vec3  u_groundNight;
uniform vec3  u_groundDay;

// per-grating: freq, angle, phase, kind (0 linear, 1 radial, 2 rings)
uniform vec4 u_g[6];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// iq cosine palette — the rainbow crawl. Phase vector comes from the inks
// so even the hallucination stays seeded to this device.
vec3 acid(float h, vec3 phase) {
  return 0.5 + 0.5 * cos(6.28318 * (h + phase));
}

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

// One grating's wave value at p, in [-1, 1].
float grating(vec2 p, vec4 g, vec2 focus, float t) {
  float kind = g.w;
  if (kind < 0.5) {
    vec2 dir = vec2(cos(g.y), sin(g.y));
    return sin(dot(p, dir) * g.x + g.z + t);
  } else if (kind < 1.5) {
    vec2 d = p - (focus * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
    return sin(length(d) * g.x + g.z - t * 1.4);
  } else {
    vec2 d = abs(p);
    float r = max(d.x, d.y);
    return sin(r * g.x + g.z + t * 0.7);
  }
}

// The whole interference field at a point — pulled out so we can sample it
// three times at slightly split coordinates for the RGB fringe.
float field(vec2 p, float t) {
  float a = grating(p, u_g[0], u_focus, t);
  float b = grating(p, u_g[1], u_focus, t * 1.03);
  float c = grating(p, u_g[2], u_focus, t * 0.85);
  float d = grating(p, u_g[3], u_focus, t);
  float e = grating(p, u_g[4], u_focus, t * 0.92);
  float f = grating(p, u_g[5], u_focus, t * 0.78);
  float hw  = a * b + c * 0.6;
  float net = d * f + e * 0.5;
  float fld = mix(hw, net, 0.45 + 0.25 * sin(t * 0.21));
  fld += u_strain * 0.4 * sin(fld * 3.0);
  return fld;
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(aspect, 1.0);
  float t = u_time;

  // Trip depth: baseline trip + camera proximity pushes deeper.
  float trip = 0.55 + u_proximity * 0.45;

  // Gyroscope shears space; geolocation folds it.
  p += u_tilt * 0.6;
  float fold = u_warp + u_geoPhase;
  p = mix(p, vec2(
    p.x * cos(fold) - p.y * sin(fold),
    p.x * sin(fold) + p.y * cos(fold)
  ), 0.85);

  // ---- BREATHING: the walls inhale and exhale. Two beat frequencies so
  // it never quite settles, like lungs that forgot their rhythm.
  float breathe = 1.0 + 0.10 * trip * sin(t * 0.43) + 0.05 * trip * sin(t * 0.97 + 1.7);
  p *= breathe * (1.0 + u_proximity * 1.2);

  // ---- LIQUID SPACE: domain warp. Space flows before the gratings even
  // get drawn — two chained warps, the second feeding on the first.
  vec2 w1 = vec2(
    sin(p.y * 1.9 + t * 0.60) + sin(p.y * 3.7 - t * 0.34),
    sin(p.x * 2.3 - t * 0.52) + sin(p.x * 3.1 + t * 0.41)
  );
  p += w1 * 0.14 * trip;
  vec2 w2 = vec2(
    sin((p.y + w1.x) * 4.3 + t * 0.83),
    sin((p.x + w1.y) * 3.9 - t * 0.71)
  );
  p += w2 * 0.06 * trip;

  // ---- CHRYSANTHEMUM + TUNNEL: kaleidoscopic fold around the tracked
  // face, and a slow endless fall toward it — the Blueberry vortex.
  // log(r) makes the inward rush perspective-correct: an infinite tunnel.
  vec2 fc = (u_focus * 2.0 - 1.0) * vec2(aspect, 1.0);
  vec2 rel = p - fc;
  float r = length(rel);
  float ang = atan(rel.y, rel.x) + t * 0.05 + r * 0.35 * trip;
  float seg = 6.28318 / u_kaleido;
  ang = abs(mod(ang, seg * 2.0) - seg); // mirror fold
  // Tunnel: radius flows inward forever, serpentine wobble on the way.
  float rr = r * (1.0 + 0.22 * trip * sin(log(r + 0.05) * 3.0 - t * 0.9));
  vec2 kp = fc + vec2(cos(ang), sin(ang)) * rr;
  // Blend the fold in — mandala in a ring around the face; the very center
  // and the far edges stay pure moiré so the eye always has crisp lines.
  float kmix = smoothstep(1.6, 0.15, r) * smoothstep(0.04, 0.28, r) * (0.35 + 0.65 * trip);
  p = mix(p, kp, kmix);

  // ---- RGB FRINGE: sample the field three times, coordinates split along
  // a slowly rotating axis. Edges refract into spectra.
  vec2 ca = vec2(cos(t * 0.23), sin(t * 0.23)) * (0.006 + 0.020 * trip);
  float fR = field(p + ca, t);
  float fG = field(p, t);
  float fB = field(p - ca, t);

  float bands = max(u_bands, 2.0);
  vec3 q3 = clamp(vec3(
    floor((fR * 0.5 + 0.5) * bands),
    floor((fG * 0.5 + 0.5) * bands),
    floor((fB * 0.5 + 0.5) * bands)
  ) / (bands - 1.0), 0.0, 1.0);
  float q = q3.g;

  // Ink assignment from the green (center) sample.
  float band = floor((fG * 0.5 + 0.5) * bands);
  float sel = mod(band, 3.0);
  vec3 ink = sel < 0.5 ? u_ink0 : (sel < 1.5 ? u_ink1 : u_ink2);

  // ---- INK CRAWL: the trip stays in this device's desert colorway.
  // Instead of a generic rainbow, color flows around the ink triangle —
  // sunset -> teal -> pink -> sunset — driven by time, radius, and band.
  // Same three inks, but they slither between the contours like snakes.
  float crawl = t * u_hue + r * 1.4 + band * 0.9 + fG * 0.6;
  float ph = fract(crawl * 0.159) * 3.0;
  vec3 inkCycle = ph < 1.0 ? mix(u_ink0, u_ink1, ph)
                : ph < 2.0 ? mix(u_ink1, u_ink2, ph - 1.0)
                           : mix(u_ink2, u_ink0, ph - 2.0);
  // Small hue wobble around each ink — heat-haze iridescence, not rainbow.
  ink = hueShift(ink, sin(crawl * 0.5) * 0.55 * trip);
  ink = mix(ink, inkCycle, 0.45 * trip);

  vec3 ground = mix(u_groundNight, u_groundDay, u_dayness);
  // The ground breathes warm — night violet leans ember, never neon.
  ground = mix(ground, hueShift(ground, sin(t * 0.31) * 0.6), 0.3 * trip);

  float coverage = smoothstep(0.08, 0.22, q);
  vec3 col = mix(ground, ink, coverage * (0.55 + 0.45 * q));

  // The RGB split lands here: per-channel band values tint the result so
  // every contour wears a spectral halo.
  col += (q3 - q) * vec3(0.9, 0.0, 0.9) * trip;

  // Shimmer where the two split fields almost agree — hot desert chrome:
  // the brightest ink white-heated, like sun off a car hood in Marfa.
  float shimmer = smoothstep(0.80, 0.99, abs(fR * fB));
  vec3 shimmerInk = mix(inkCycle, vec3(1.0, 0.97, 0.9), 0.45);
  col = mix(col, shimmerInk, shimmer * 0.75);

  // ---- STROBE-FREE PULSE: brightness swells with the breath (kept gentle
  // and slow — hypnotic, not seizure-inducing).
  col *= 0.92 + 0.08 * sin(t * 0.43);

  // ---- ACID PUNCH: drive saturation and contrast hard so the inks stay
  // electric through all the warping — silkscreen, not watercolor.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.45 + 0.25 * trip);   // oversaturate
  col = (col - 0.5) * 1.12 + 0.5;                  // contrast
  col = clamp(col, 0.0, 1.0);

  // Print grain / misregistration.
  float g1 = hash(gl_FragCoord.xy + fract(t) * 100.0);
  col += (g1 - 0.5) * u_grain;

  // Vignette toward the tracked focus — attention has gravity.
  vec2 fv = v_uv - u_focus;
  col *= 1.0 - dot(fv, fv) * 0.22;

  outColor = vec4(col, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('webgl2-unavailable');
    this.gl = gl;

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const name of [
      'u_res', 'u_time', 'u_focus', 'u_proximity', 'u_dayness', 'u_geoPhase',
      'u_strain', 'u_tilt', 'u_warp', 'u_bands', 'u_grain', 'u_kaleido', 'u_hue',
      'u_ink0', 'u_ink1', 'u_ink2', 'u_groundNight', 'u_groundDay', 'u_g',
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
  }

  setGenome(g) {
    const gl = this.gl;
    gl.uniform3fv(this.u.u_ink0, g.inks[0].rgb);
    gl.uniform3fv(this.u.u_ink1, g.inks[1].rgb);
    gl.uniform3fv(this.u.u_ink2, g.inks[2].rgb);
    gl.uniform3fv(this.u.u_groundNight, [0.055, 0.031, 0.102]);
    gl.uniform3fv(this.u.u_groundDay, [0.965, 0.937, 0.878]);
    gl.uniform1f(this.u.u_warp, g.warp);
    gl.uniform1f(this.u.u_bands, g.bands);
    gl.uniform1f(this.u.u_grain, g.grainAmp);
    gl.uniform1f(this.u.u_kaleido, g.kaleido);
    gl.uniform1f(this.u.u_hue, g.hueSpeed);
    const packed = new Float32Array(24);
    g.gratings.forEach((gr, i) => {
      packed.set([gr.freq * 0.28, gr.angle, gr.phase, gr.kind], i * 4);
    });
    gl.uniform4fv(this.u.u_g, packed);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  draw(state) {
    const gl = this.gl;
    this.resize();
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_time, state.t);
    gl.uniform2f(this.u.u_focus, state.focus[0], 1.0 - state.focus[1]);
    gl.uniform1f(this.u.u_proximity, state.proximity);
    gl.uniform1f(this.u.u_dayness, state.dayness);
    gl.uniform1f(this.u.u_geoPhase, state.geoPhase);
    gl.uniform1f(this.u.u_strain, state.strain);
    gl.uniform2f(this.u.u_tilt, state.tilt[0], state.tilt[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
