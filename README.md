# SEÑAL

**Your machine, printed as interference.**

A living moiré organism. It reads every signal your browser gives up without
asking — GPU renderer, CPU cores, device memory, screen geometry, pixel
density, network speed and latency, page load time, timezone, language,
battery — hashes them into a seed, and grows six interference gratings from
it. Every device prints a different specimen. Every visit drifts a little.

Grant it more and it comes further alive:

- **camera** — finds the closest face (biggest face wins); their head position
  steers the radial ripples, proximity densifies the lines, and real light
  through the lens shifts the ground from far-west night to alkali day.
  Falls back to a dependency-free motion-centroid tracker if ML models
  can't load. On desktop with no camera, your pointer is the person.
- **motion** — gyroscope tilt shears the gratings.
- **location** — latitude/longitude fold the space; the print only exists
  where you are.

Even your frame rate is a signal: a struggling machine draws heavier lines.

Palette: seeded from a desert-acid ink pool — Joshua Tree, Warhol silkscreen,
Basquiat, Marfa, Endless Summer. After Vera Molnár.

**Privacy:** nothing leaves your device. Signals are drawn, never sent.
No analytics, no storage, no network calls with your data.

## Run

Static site, no build step:

```sh
npx serve .
```

Camera/gyro require HTTPS (or localhost).

## Stack

Vanilla ES modules + WebGL2 fragment shader. Optional MediaPipe face
detection loaded from CDN at grant time only.
