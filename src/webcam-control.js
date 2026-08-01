/**
 * webcam-control.js
 * Controls the Subway Surfer character using body movement via MediaPipe Pose.
 *
 * GESTURES:
 *   - Lean LEFT  → move left  (left arrow)
 *   - Lean RIGHT → move right (right arrow)
 *   - Jump UP    → jump       (spacebar)
 *   - Duck/Squat → duck       (down arrow)
 *
 * A small webcam preview is shown in the corner so you can see yourself.
 */

(function () {
  // ─── CONFIG ───────────────────────────────────────────────────────────────
  const LEAN_THRESHOLD   = 0.08;  // shoulder midpoint X shift to trigger left/right
  const JUMP_THRESHOLD   = 0.06;  // shoulder midpoint Y rise to trigger jump
  const DUCK_THRESHOLD   = 0.06;  // shoulder midpoint Y drop to trigger duck
  const COOLDOWN_MS      = 350;   // ms between repeated gesture triggers
  const CALIBRATION_FRAMES = 45;  // frames to average for baseline

  // ─── STATE ────────────────────────────────────────────────────────────────
  let baseline       = null;  // { x, y } neutral shoulder midpoint
  let calibFrames    = [];
  let lastAction     = { left: 0, right: 0, jump: 0, duck: 0 };
  let poseReady      = false;

  // ─── UI: webcam preview overlay ──────────────────────────────────────────
  const videoEl = document.createElement('video');
  videoEl.id        = 'webcam-preview';
  videoEl.autoplay  = true;
  videoEl.muted     = true;
  videoEl.playsInline = true;
  Object.assign(videoEl.style, {
    position:   'fixed',
    bottom:     '10px',
    right:      '10px',
    width:      '180px',
    height:     '135px',
    borderRadius: '8px',
    border:     '2px solid #00ff88',
    objectFit:  'cover',
    transform:  'scaleX(-1)',  // mirror
    zIndex:     '9999',
    opacity:    '0.85',
  });

  const statusEl = document.createElement('div');
  statusEl.id = 'webcam-status';
  Object.assign(statusEl.style, {
    position:   'fixed',
    bottom:     '150px',
    right:      '10px',
    color:      '#00ff88',
    background: 'rgba(0,0,0,0.6)',
    padding:    '4px 10px',
    borderRadius: '6px',
    fontSize:   '13px',
    fontFamily: 'monospace',
    zIndex:     '9999',
  });
  statusEl.innerText = '📷 Cam: starting...';

  document.body.appendChild(videoEl);
  document.body.appendChild(statusEl);

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function fireKey(keyCode) {
    const evt = new KeyboardEvent('keydown', {
      keyCode,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(evt);
  }

  function now() { return performance.now(); }

  function canFire(action) {
    return (now() - lastAction[action]) > COOLDOWN_MS;
  }

  function triggerAction(action, keyCode) {
    if (canFire(action)) {
      lastAction[action] = now();
      fireKey(keyCode);
      statusEl.innerText = '📷 ' + action.toUpperCase() + '!';
    }
  }

  // ─── POSE CALLBACK ────────────────────────────────────────────────────────
  function onPoseResults(results) {
    if (!results.poseLandmarks) return;

    const lm = results.poseLandmarks;
    // Left shoulder = 11, Right shoulder = 12 (MediaPipe indices)
    const ls = lm[11];
    const rs = lm[12];
    if (!ls || !rs) return;

    // Mirror: MediaPipe gives mirrored coords when using selfie cam
    // x goes 0 (left of frame) → 1 (right of frame)
    const midX = (ls.x + rs.x) / 2;
    const midY = (ls.y + rs.y) / 2;

    // Calibration: average first N frames to set baseline
    if (!baseline) {
      calibFrames.push({ x: midX, y: midY });
      const pct = Math.round((calibFrames.length / CALIBRATION_FRAMES) * 100);
      statusEl.innerText = `📷 Calibrating… ${pct}%`;
      if (calibFrames.length >= CALIBRATION_FRAMES) {
        baseline = {
          x: calibFrames.reduce((s, f) => s + f.x, 0) / calibFrames.length,
          y: calibFrames.reduce((s, f) => s + f.y, 0) / calibFrames.length,
        };
        statusEl.innerText = '📷 Ready! Move to play';
        poseReady = true;
      }
      return;
    }

    if (!poseReady) return;

    const dx = midX - baseline.x;  // positive = moved right in frame
    const dy = midY - baseline.y;  // positive = moved down in frame

    // Lean RIGHT in frame = character moves LEFT (mirrored cam)
    if (dx > LEAN_THRESHOLD) {
      triggerAction('left', 37);  // LEFT arrow
    }
    // Lean LEFT in frame = character moves RIGHT
    else if (dx < -LEAN_THRESHOLD) {
      triggerAction('right', 39); // RIGHT arrow
    }

    // Jump: shoulders rise = dy becomes negative
    if (dy < -JUMP_THRESHOLD) {
      triggerAction('jump', 32);  // SPACE
    }
    // Duck: shoulders drop = dy becomes positive
    else if (dy > DUCK_THRESHOLD) {
      triggerAction('duck', 40);  // DOWN arrow
    }
  }

  // ─── INIT MEDIAPIPE ───────────────────────────────────────────────────────
  async function initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      videoEl.srcObject = stream;

      const pose = new Pose({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 0,       // 0 = lite, fast on low-end machines
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.6,
        minTrackingConfidence:  0.5,
      });

      pose.onResults(onPoseResults);

      const camera = new Camera(videoEl, {
        onFrame: async () => { await pose.send({ image: videoEl }); },
        width: 320,
        height: 240,
      });

      camera.start();
      statusEl.innerText = '📷 Pose loaded, calibrating…';
    } catch (err) {
      console.error('Webcam error:', err);
      statusEl.innerText = '⚠️ Camera denied';
      statusEl.style.color = '#ff4444';
    }
  }

  // ─── LOAD MEDIAPIPE CDN SCRIPTS THEN INIT ────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function bootstrap() {
    statusEl.innerText = '📷 Loading pose model…';
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
      initCamera();
    } catch (e) {
      statusEl.innerText = '⚠️ Failed to load MediaPipe';
      console.error(e);
    }
  }

  // Start after page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
