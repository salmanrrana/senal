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
uniform float u_proximity;  // 0 = far, 1 = face fills frame
uniform float u_dayness;    // 0 night ground .. 1 day ground
uniform float u_geoPhase;   // lat/lon fold, 0 if not granted
uniform float u_strain;     // machine struggling -> heavier lines
uniform vec2  u_tilt;       // gyroscope, radians-ish
uniform float u_warp;
uniform float u_bands;
uniform float u_grain;
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

// One grating's wave value at p, in [-1, 1].
float grating(vec2 p, vec4 g, vec2 focus, float t) {
  float kind = g.w;
  if (kind < 0.5) {
    // linear
    vec2 dir = vec2(cos(g.y), sin(g.y));
    return sin(dot(p, dir) * g.x + g.z + t);
  } else if (kind < 1.5) {
    // radial, centered on the tracked focus
    vec2 d = p - (focus * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
    return sin(length(d) * g.x + g.z - t * 1.4);
  } else {
    // square rings
    vec2 d = abs(p);
    float r = max(d.x, d.y);
    return sin(r * g.x + g.z + t * 0.7);
  }
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(aspect, 1.0);

  // Gyroscope shears space; geolocation folds it.
  p += u_tilt * 0.6;
  float fold = u_warp + u_geoPhase;
  p = mix(p, vec2(
    p.x * cos(fold) - p.y * sin(fold),
    p.x * sin(fold) + p.y * cos(fold)
  ), 0.85);

  // Proximity: the closer the person, the denser space itself gets.
  float zoom = 1.0 + u_proximity * 1.6;
  p *= zoom;

  float t = u_time;

  // Interference: sum of gratings — the classic moiré beat is the
  // product/sum of near-frequency waves.
  float a = grating(p, u_g[0], u_focus, t);
  float b = grating(p, u_g[1], u_focus, t * 1.03);
  float c = grating(p, u_g[2], u_focus, t * 0.85);
  float d = grating(p, u_g[3], u_focus, t);
  float e = grating(p, u_g[4], u_focus, t * 0.92);
  float f = grating(p, u_g[5], u_focus, t * 0.78);

  // Two interference fields: hardware field and network field.
  float hw  = a * b + c * 0.6;             // gpu × cores beat + ram rings
  float net = d * f + e * 0.5;             // network ripple × load ripple + screen

  // Strain thickens the dark line mass.
  float field = mix(hw, net, 0.45 + 0.25 * sin(t * 0.21));
  field += u_strain * 0.4 * sin(field * 3.0);

  // Posterize into hard screenprint bands.
  float bands = max(u_bands, 2.0);
  float q = floor((field * 0.5 + 0.5) * bands) / (bands - 1.0);
  q = clamp(q, 0.0, 1.0);

  // Ink assignment: which band gets which ink, cycling through 3 inks.
  float band = floor((field * 0.5 + 0.5) * bands);
  float sel = mod(band, 3.0);
  vec3 ink = sel < 0.5 ? u_ink0 : (sel < 1.5 ? u_ink1 : u_ink2);

  // Ground shifts with real light through the camera.
  vec3 ground = mix(u_groundNight, u_groundDay, u_dayness);

  // Lowest band = bare ground (paper shows through), like a real print.
  float coverage = smoothstep(0.08, 0.22, q);
  vec3 col = mix(ground, ink, coverage * (0.55 + 0.45 * q));

  // Second interference pass: multiply fields where they overlap hard,
  // the "shimmer" where two gratings almost agree.
  float shimmer = smoothstep(0.75, 0.98, abs(hw * net));
  vec3 shimmerInk = mix(u_ink1, u_ink2, step(0.0, sin(t * 0.5)));
  col = mix(col, shimmerInk, shimmer * 0.65);

  // Print grain / misregistration.
  float g1 = hash(gl_FragCoord.xy + fract(t) * 100.0);
  col += (g1 - 0.5) * u_grain;

  // Slight vignette toward the tracked focus — attention has gravity.
  vec2 fv = v_uv - u_focus;
  col *= 1.0 - dot(fv, fv) * 0.25;

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
      'u_strain', 'u_tilt', 'u_warp', 'u_bands', 'u_grain',
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
