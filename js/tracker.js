// SEÑAL — the eye. Camera-based person tracking + gyroscope + geolocation.
//
// Tracking strategy, in order of preference:
//   1. FaceDetector API (Chrome/Android — free, fast, built in)
//   2. MediaPipe FaceDetection from CDN (works most places)
//   3. Luma-centroid fallback: no ML at all — track the brightest/most-moving
//      region of the frame. "Closest object" ≈ biggest luma mass.
// Camera luminance is always sampled as the ambient-light signal.

export class Tracker {
  constructor() {
    this.video = null;
    this.stream = null;
    this.mode = 'off';
    // Smoothed outputs, all 0..1
    this.focusX = 0.5;
    this.focusY = 0.5;
    this.proximity = 0;
    this.luma = null;
    // Gyro
    this.tiltX = 0;
    this.tiltY = 0;
    this.gyroOn = false;
    // Geo
    this.geoLat = null;
    this.geoLon = null;

    this._targetX = 0.5;
    this._targetY = 0.5;
    this._targetProx = 0;
    this._sample = document.createElement('canvas');
    this._sample.width = 64;
    this._sample.height = 48;
    this._sctx = this._sample.getContext('2d', { willReadFrequently: true });
    this._prevLuma = null;
    this._faceDetector = null;
    this._detBusy = false;
  }

  // ---- camera -------------------------------------------------------------
  async startCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.srcObject = this.stream;
    await v.play();
    this.video = v;

    if ('FaceDetector' in window) {
      try {
        this._faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
        this.mode = 'face-native';
      } catch { /* fall through */ }
    }
    if (!this._faceDetector) {
      const ok = await this._tryMediaPipe();
      this.mode = ok ? 'face-ml' : 'luma';
    }
    this._loop();
    return this.mode;
  }

  stopCamera() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    this.mode = 'off';
    this.luma = null;
    this._targetProx = 0;
  }

  async _tryMediaPipe() {
    try {
      const vision = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
      );
      const files = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      this._mp = await vision.FaceDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        },
        runningMode: 'VIDEO',
      });
      return true;
    } catch (e) {
      console.warn('mediapipe unavailable, using luma tracking', e);
      return false;
    }
  }

  _loop() {
    if (!this.video) return;
    this._sampleFrame();
    if (this.mode === 'face-native') this._detectNative();
    else if (this.mode === 'face-ml') this._detectMP();
    setTimeout(() => this._loop(), 66); // ~15 Hz detection is plenty
  }

  // Sample a tiny frame: ambient luminance always; centroid when in luma mode.
  _sampleFrame() {
    const v = this.video;
    if (!v || v.readyState < 2) return;
    const w = this._sample.width, h = this._sample.height;
    this._sctx.drawImage(v, 0, 0, w, h);
    const data = this._sctx.getImageData(0, 0, w, h).data;

    let total = 0;
    let cx = 0, cy = 0, mass = 0;
    const prev = this._prevLuma;
    const cur = new Float32Array(w * h);

    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      cur[i] = l;
      total += l;
      if (prev) {
        // motion energy: what moved is what's alive in frame
        const m = Math.abs(l - prev[i]);
        if (m > 0.06) {
          const x = i % w, y = (i / w) | 0;
          cx += x * m; cy += y * m; mass += m;
        }
      }
    }
    this._prevLuma = cur;
    this.luma = total / (w * h);

    if (this.mode === 'luma' && mass > 0.5) {
      // mirror x — front camera is a mirror
      this._targetX = 1 - cx / mass / w;
      this._targetY = cy / mass / h;
      this._targetProx = Math.min(1, mass / (w * h * 0.08));
    }
  }

  async _detectNative() {
    if (this._detBusy || !this.video) return;
    this._detBusy = true;
    try {
      const faces = await this._faceDetector.detect(this.video);
      this._applyFaces(faces.map((f) => f.boundingBox));
    } catch { /* frame not ready */ }
    this._detBusy = false;
  }

  _detectMP() {
    if (!this._mp || !this.video || this.video.readyState < 2) return;
    try {
      const res = this._mp.detectForVideo(this.video, performance.now());
      this._applyFaces(
        (res.detections || []).map((d) => d.boundingBox).filter(Boolean)
          .map((b) => ({ x: b.originX, y: b.originY, width: b.width, height: b.height }))
      );
    } catch { /* model warming up */ }
  }

  // Pick the CLOSEST person = biggest box.
  _applyFaces(boxes) {
    if (!boxes.length || !this.video) return;
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    let best = boxes[0];
    for (const b of boxes) if (b.width * b.height > best.width * best.height) best = b;
    // mirror x for front camera
    this._targetX = 1 - (best.x + best.width / 2) / vw;
    this._targetY = (best.y + best.height / 2) / vh;
    // proximity: face width relative to frame. ~0.15 far, ~0.6 nose-on-screen.
    this._targetProx = Math.min(1, Math.max(0, (best.width / vw - 0.1) / 0.45));
  }

  // ---- gyroscope ----------------------------------------------------------
  async startGyro() {
    // iOS needs an explicit permission request from a user gesture.
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('denied');
    }
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null) return;
      // beta: front-back tilt, gamma: left-right. Normalize to ~[-1,1].
      this.tiltY = Math.max(-1, Math.min(1, (e.beta - 45) / 60));
      this.tiltX = Math.max(-1, Math.min(1, (e.gamma || 0) / 45));
      this.gyroOn = true;
    });
    return true;
  }

  // ---- geolocation --------------------------------------------------------
  startGeo() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.geoLat = pos.coords.latitude;
          this.geoLon = pos.coords.longitude;
          resolve(pos.coords);
        },
        (err) => reject(err),
        { timeout: 12000, maximumAge: 600000 }
      );
    });
  }

  // Called every render frame: ease toward targets so motion feels organic.
  update(dt) {
    const k = 1 - Math.exp(-dt * 3.2);
    this.focusX += (this._targetX - this.focusX) * k;
    this.focusY += (this._targetY - this.focusY) * k;
    this.proximity += (this._targetProx - this.proximity) * k * 0.7;
  }

  // Desktop mouse = the "person" when there's no camera.
  pointTo(x, y) {
    if (this.mode === 'off') {
      this._targetX = x;
      this._targetY = y;
    }
  }
}
