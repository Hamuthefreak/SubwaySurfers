/**
 * motion_controller.js
 * Webcam-based body motion controller for SubwaySurfers
 * Uses MediaPipe Pose for robust body tracking
 * Features: calibration, smoothing, jump sensitivity, tutorial mode, auto-pause
 */

const MotionController = (function () {

  // ─── CONFIG (can be overridden by settings panel) ───────────────────────────
  const CFG = {
    leanThreshold:     0.045,   // shoulder X deviation to trigger lane change
    jumpThreshold:     0.05,    // shoulder Y rise  (adjustable per sensitivity)
    duckThreshold:     0.06,    // shoulder Y drop
    jumpEnabled:       true,    // can be toggled off for seated/accessibility
    jumpSensitivity:   1.0,     // multiplier: 0.5 = harder to trigger, 2.0 = easy
    smoothingFrames:   5,       // number of frames to average
    cooldownMs:        350,     // ms between repeated same-command fires
    visibilityMin:     0.55,    // minimum mediapipe landmark visibility to trust
    mirrorCamera:      true,    // flip so it feels like a mirror
    debugOverlay:      false,   // draw skeleton on camera preview
    autoPause:         true,    // pause when player leaves frame
    seatedMode:        false,   // disables jump, uses head-nod instead
    preset:            'Normal' // Kids | Normal | Fitness
  };

  const PRESETS = {
    Kids:    { leanThreshold: 0.03, jumpThreshold: 0.03, duckThreshold: 0.04, jumpSensitivity: 2.0,  cooldownMs: 500 },
    Normal:  { leanThreshold: 0.045, jumpThreshold: 0.05, duckThreshold: 0.06, jumpSensitivity: 1.0, cooldownMs: 350 },
    Fitness: { leanThreshold: 0.06, jumpThreshold: 0.07, duckThreshold: 0.08, jumpSensitivity: 0.6,  cooldownMs: 250 }
  };

  // ─── STATE ──────────────────────────────────────────────────────────────────
  let pose         = null;
  let camera       = null;
  let videoEl      = null;
  let canvasEl     = null;
  let canvasCtx    = null;
  let active       = false;
  let calibrated   = false;
  let inFrame      = false;

  // Calibration baselines (normalised 0-1 coordinates)
  let baseline = { shoulderMidX: 0.5, shoulderMidY: 0.35, hipMidY: 0.65, headY: 0.1 };
  let calibFrames = [];
  const CALIB_NEEDED = 45;   // ~1.5 s at 30 fps

  // Pose history ring buffer for smoothing
  let history = [];

  // Cooldown timestamps
  const lastFired = { left: 0, right: 0, jump: 0, duck: 0, pause: 0 };

  // ─── CALLBACKS (set by game) ─────────────────────────────────────────────
  let onLeft  = () => {};
  let onRight = () => {};
  let onJump  = () => {};
  let onDuck  = () => {};
  let onPause = () => {};
  let onResume= () => {};
  let onCalibrationDone = () => {};
  let onLowLight = () => {};

  // ─── PUBLIC API ──────────────────────────────────────────────────────────
  function init(callbacks) {
    onLeft            = callbacks.onLeft  || onLeft;
    onRight           = callbacks.onRight || onRight;
    onJump            = callbacks.onJump  || onJump;
    onDuck            = callbacks.onDuck  || onDuck;
    onPause           = callbacks.onPause || onPause;
    onResume          = callbacks.onResume|| onResume;
    onCalibrationDone = callbacks.onCalibrationDone || onCalibrationDone;
    onLowLight        = callbacks.onLowLight || onLowLight;

    _buildUI();
    _loadMediaPipe();
  }

  function setPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    CFG.preset = name;
    Object.assign(CFG, p);
    _updateSettingsUI();
  }

  function toggleJump(enabled) {
    CFG.jumpEnabled = enabled;
  }

  function setJumpSensitivity(val) {
    CFG.jumpSensitivity = parseFloat(val);
  }

  function recalibrate() {
    calibrated  = false;
    calibFrames = [];
    history     = [];
    _showCalibrationPrompt();
  }

  function startCamera() {
    if (camera) { camera.start(); active = true; }
  }

  function stopCamera() {
    if (camera) { camera.stop(); active = false; }
  }

  // ─── MEDIAPIPE LOADER ────────────────────────────────────────────────────
  function _loadMediaPipe() {
    // Dynamically inject the MediaPipe scripts so game works even without them
    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js'
    ];
    let loaded = 0;
    scripts.forEach(src => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => { loaded++; if (loaded === scripts.length) _setupPose(); };
      s.onerror = () => console.warn('[MotionCtrl] Failed to load', src);
      document.head.appendChild(s);
    });
  }

  function _setupPose() {
    if (typeof Pose === 'undefined') {
      console.error('[MotionCtrl] MediaPipe Pose not available.');
      return;
    }

    pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    pose.setOptions({
      modelComplexity:       1,      // 0=fast, 1=balanced, 2=accurate
      smoothLandmarks:       true,
      enableSegmentation:    false,
      smoothSegmentation:    false,
      minDetectionConfidence: 0.55,
      minTrackingConfidence:  0.55
    });

    pose.onResults(_onPoseResults);

    camera = new Camera(videoEl, {
      onFrame: async () => { await pose.send({ image: videoEl }); },
      width: 320,
      height: 240
    });

    _showCalibrationPrompt();
    camera.start();
    active = true;
  }

  // ─── POSE RESULT HANDLER ─────────────────────────────────────────────────
  function _onPoseResults(results) {
    _drawDebug(results);

    if (!results.poseLandmarks || results.poseLandmarks.length < 29) {
      _handleMissingPose();
      return;
    }

    const lm = results.poseLandmarks;

    // Key landmarks: 11=L shoulder, 12=R shoulder, 23=L hip, 24=R hip, 0=nose
    const lSh = lm[11], rSh = lm[12];
    const lHip= lm[23], rHip= lm[24];
    const nose= lm[0];

    // Require minimum visibility on shoulders (most reliable upper-body landmarks)
    if (lSh.visibility < CFG.visibilityMin || rSh.visibility < CFG.visibilityMin) {
      _handleMissingPose();
      return;
    }

    // Check for low-light (MediaPipe visibility drops on dark frames)
    const avgVis = (lSh.visibility + rSh.visibility + lHip.visibility + rHip.visibility) / 4;
    if (avgVis < 0.4) onLowLight();

    inFrame = true;
    if (CFG.autoPause && _wasMissingPose()) onResume();
    _wasMissing = false;

    // Mirror X if needed (so player leaning left moves char left)
    const flip = CFG.mirrorCamera ? (x => 1 - x) : (x => x);

    const frame = {
      shoulderMidX: flip((lSh.x + rSh.x) / 2),
      shoulderMidY: (lSh.y + rSh.y) / 2,
      hipMidY:      (lHip.y + rHip.y) / 2,
      headY:        nose.y,
      shoulderWidth: Math.abs(lSh.x - rSh.x),  // used to normalise distance
    };

    if (!calibrated) {
      _accumulateCalibration(frame);
      return;
    }

    history.push(frame);
    if (history.length > CFG.smoothingFrames) history.shift();
    if (history.length < 2) return;

    const smooth = _smoothedFrame();
    _interpretGesture(smooth);
  }

  // ─── CALIBRATION ─────────────────────────────────────────────────────────
  function _accumulateCalibration(frame) {
    calibFrames.push(frame);
    const pct = Math.min(100, Math.round((calibFrames.length / CALIB_NEEDED) * 100));
    const bar = document.getElementById('mc-calib-bar');
    if (bar) bar.style.width = pct + '%';

    if (calibFrames.length >= CALIB_NEEDED) {
      baseline.shoulderMidX = _avg(calibFrames, 'shoulderMidX');
      baseline.shoulderMidY = _avg(calibFrames, 'shoulderMidY');
      baseline.hipMidY      = _avg(calibFrames, 'hipMidY');
      baseline.headY        = _avg(calibFrames, 'headY');
      calibrated = true;
      calibFrames = [];
      _hideCalibrationPrompt();
      onCalibrationDone();
      console.log('[MotionCtrl] Calibrated:', baseline);
    }
  }

  // ─── GESTURE INTERPRETER ─────────────────────────────────────────────────
  function _interpretGesture(s) {
    const now = Date.now();

    // ── LEAN LEFT / RIGHT ──────────────────────────────────────────────────
    const xDelta = s.shoulderMidX - baseline.shoulderMidX;
    if (xDelta < -CFG.leanThreshold && _canFire('left', now)) {
      lastFired.left = now;
      onLeft();
    } else if (xDelta > CFG.leanThreshold && _canFire('right', now)) {
      lastFired.right = now;
      onRight();
    }

    // ── JUMP (shoulder rise above baseline) ───────────────────────────────
    if (CFG.jumpEnabled && !CFG.seatedMode) {
      const yRise = baseline.shoulderMidY - s.shoulderMidY;  // positive = rose
      const thresh = CFG.jumpThreshold / CFG.jumpSensitivity;
      if (yRise > thresh && _canFire('jump', now)) {
        lastFired.jump = now;
        onJump();
      }
    }

    // ── SEATED MODE: head nod down = jump ────────────────────────────────
    if (CFG.seatedMode && CFG.jumpEnabled) {
      const headDrop = s.headY - baseline.headY;  // positive = moved down
      const thresh = 0.04 / CFG.jumpSensitivity;
      if (headDrop > thresh && _canFire('jump', now)) {
        lastFired.jump = now;
        onJump();
      }
    }

    // ── DUCK (shoulder drop below baseline) ──────────────────────────────
    const yDrop = s.shoulderMidY - baseline.shoulderMidY;  // positive = dropped
    if (yDrop > CFG.duckThreshold && _canFire('duck', now)) {
      lastFired.duck = now;
      onDuck();
    }

    // ── AUTO-PAUSE: both hands raised above head ──────────────────────────
    // (Use wrist landmarks 15=L wrist, 16=R wrist)
    // NOTE: wrists checked only if tracked
  }

  let _wasMissing = false;
  function _handleMissingPose() {
    if (!_wasMissing && CFG.autoPause && inFrame) {
      onPause();
      _wasMissing = true;
      inFrame = false;
    }
  }
  function _wasMissingPose() { return _wasMissing; }

  // ─── SMOOTHING ────────────────────────────────────────────────────────────
  function _smoothedFrame() {
    const keys = ['shoulderMidX','shoulderMidY','hipMidY','headY'];
    const out = {};
    keys.forEach(k => { out[k] = _avg(history, k); });
    return out;
  }

  function _avg(arr, key) {
    return arr.reduce((s, f) => s + f[key], 0) / arr.length;
  }

  function _canFire(action, now) {
    return (now - lastFired[action]) > CFG.cooldownMs;
  }

  // ─── DEBUG OVERLAY ───────────────────────────────────────────────────────
  function _drawDebug(results) {
    if (!canvasCtx || !CFG.debugOverlay) return;
    canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!results.poseLandmarks) return;
    if (typeof drawConnectors !== 'undefined') {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
        { color: '#00FF00', lineWidth: 2 });
      drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: '#FF0000', lineWidth: 1, radius: 3 });
    }
  }

  // ─── UI BUILDER ──────────────────────────────────────────────────────────
  function _buildUI() {
    // Create hidden video for camera input
    videoEl = document.createElement('video');
    videoEl.id = 'mc-video';
    videoEl.style.cssText = 'position:absolute;right:10px;top:10px;width:200px;height:150px;border-radius:8px;border:2px solid #0f0;object-fit:cover;z-index:100;transform:scaleX(-1);';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    document.body.appendChild(videoEl);

    // Debug canvas overlay on camera
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'mc-canvas';
    canvasEl.width  = 200;
    canvasEl.height = 150;
    canvasEl.style.cssText = 'position:absolute;right:10px;top:10px;width:200px;height:150px;z-index:101;pointer-events:none;transform:scaleX(-1);';
    canvasCtx = canvasEl.getContext('2d');
    document.body.appendChild(canvasEl);

    // Settings Panel
    const panel = document.createElement('div');
    panel.id = 'mc-panel';
    panel.innerHTML = `
      <div id="mc-panel-inner">
        <h3 style="margin:0 0 10px;color:#0f0;">&#127916; Webcam Controls</h3>

        <div class="mc-row">
          <label>Mode</label>
          <select id="mc-preset" onchange="MotionController.setPreset(this.value)">
            <option>Kids</option>
            <option selected>Normal</option>
            <option>Fitness</option>
          </select>
        </div>

        <div class="mc-row">
          <label>Jump</label>
          <input type="checkbox" id="mc-jump-toggle" checked
            onchange="MotionController.toggleJump(this.checked)"> Enabled
        </div>

        <div class="mc-row">
          <label>Jump Sensitivity</label>
          <input type="range" id="mc-jump-sens" min="0.3" max="2.5" step="0.1" value="1.0"
            oninput="MotionController.setJumpSensitivity(this.value); document.getElementById('mc-jump-val').innerText=parseFloat(this.value).toFixed(1)">
          <span id="mc-jump-val">1.0</span>
        </div>

        <div class="mc-row">
          <label>Seated Mode</label>
          <input type="checkbox" id="mc-seated"
            onchange="MotionController._setCfg('seatedMode', this.checked)"> (head-nod jump)
        </div>

        <div class="mc-row">
          <label>Mirror Camera</label>
          <input type="checkbox" id="mc-mirror" checked
            onchange="MotionController._setCfg('mirrorCamera', this.checked)">
        </div>

        <div class="mc-row">
          <label>Debug Skeleton</label>
          <input type="checkbox" id="mc-debug"
            onchange="MotionController._setCfg('debugOverlay', this.checked)">
        </div>

        <div class="mc-row">
          <label>Auto-pause on exit</label>
          <input type="checkbox" id="mc-autopause" checked
            onchange="MotionController._setCfg('autoPause', this.checked)">
        </div>

        <button onclick="MotionController.recalibrate()" class="mc-btn">&#128247; Recalibrate</button>
        <button onclick="MotionController._togglePanel()" class="mc-btn mc-btn-close">&#10005; Close</button>
      </div>
    `;
    panel.style.cssText = 'display:none;position:fixed;top:170px;right:10px;background:#111;color:#eee;border:1px solid #0f0;border-radius:8px;padding:14px;z-index:200;font-family:monospace;font-size:13px;min-width:230px;';
    document.body.appendChild(panel);

    // Panel styles
    const style = document.createElement('style');
    style.textContent = `
      .mc-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
      .mc-row label { width:130px; color:#aaa; }
      .mc-btn { background:#0f0; color:#000; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; margin:4px 4px 0 0; font-weight:bold; }
      .mc-btn-close { background:#f44; color:#fff; }
      #mc-settings-toggle { position:fixed; top:170px; right:10px; z-index:199; background:#111; color:#0f0; border:1px solid #0f0; border-radius:4px; padding:4px 8px; cursor:pointer; font-size:12px; font-family:monospace; }
      #mc-status-badge { position:fixed; top:10px; right:220px; z-index:200; background:rgba(0,0,0,0.7); color:#0f0; border-radius:4px; padding:4px 8px; font-size:12px; font-family:monospace; }
      #mc-lowlight-warn { display:none; position:fixed; top:40px; right:220px; z-index:200; background:#f90; color:#000; border-radius:4px; padding:4px 10px; font-size:12px; font-family:monospace; }
      #mc-calib-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.82); z-index:500; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; font-family:monospace; }
      #mc-calib-overlay h2 { color:#0f0; margin-bottom:10px; }
      #mc-calib-track { width:300px; height:12px; background:#333; border-radius:6px; overflow:hidden; margin:12px 0; }
      #mc-calib-bar { height:100%; width:0%; background:#0f0; transition:width 0.15s; }
      #mc-tutorial-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:400; pointer-events:none; }
      .mc-tut-card { position:absolute; top:38%; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.88); border:2px solid #0f0; border-radius:12px; padding:24px 36px; color:#fff; font-family:monospace; text-align:center; font-size:18px; }
      .mc-tut-card .mc-tut-icon { font-size:52px; display:block; margin-bottom:8px; }
      .mc-gesture-indicator { position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:300; background:rgba(0,200,0,0.18); border:2px solid #0f0; border-radius:20px; padding:8px 28px; color:#0f0; font-size:16px; font-family:monospace; opacity:0; transition:opacity 0.2s; pointer-events:none; }
    `;
    document.head.appendChild(style);

    // Gear/toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'mc-settings-toggle';
    toggleBtn.innerHTML = '&#9881; Cam Settings';
    toggleBtn.onclick = () => _togglePanel();
    document.body.appendChild(toggleBtn);

    // Status badge
    const badge = document.createElement('div');
    badge.id = 'mc-status-badge';
    badge.innerText = '&#x1F4F7; Loading...';
    document.body.appendChild(badge);

    // Low light warning
    const llWarn = document.createElement('div');
    llWarn.id = 'mc-lowlight-warn';
    llWarn.innerText = '⚠ Low light detected — move to better lighting';
    document.body.appendChild(llWarn);

    // Gesture feedback indicator
    const gInd = document.createElement('div');
    gInd.id = 'mc-gesture-indicator';
    gInd.className = 'mc-gesture-indicator';
    document.body.appendChild(gInd);

    // Tutorial overlay
    const tutOverlay = document.createElement('div');
    tutOverlay.id = 'mc-tutorial-overlay';
    tutOverlay.innerHTML = '<div class="mc-tut-card" id="mc-tut-card"></div>';
    document.body.appendChild(tutOverlay);

    // Calibration overlay
    const calibOverlay = document.createElement('div');
    calibOverlay.id = 'mc-calib-overlay';
    calibOverlay.innerHTML = `
      <h2>&#128247; Stand Back & Strike a Neutral Pose</h2>
      <p>Keep your arms relaxed at your sides.<br>Make sure your full upper body is visible.</p>
      <div id="mc-calib-track"><div id="mc-calib-bar"></div></div>
      <p id="mc-calib-hint" style="color:#aaa;font-size:13px;">Calibrating… hold still</p>
    `;
    document.body.appendChild(calibOverlay);
  }

  function _togglePanel() {
    const p = document.getElementById('mc-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
  }

  function _showCalibrationPrompt() {
    const o = document.getElementById('mc-calib-overlay');
    if (o) o.style.display = 'flex';
  }

  function _hideCalibrationPrompt() {
    const o = document.getElementById('mc-calib-overlay');
    if (o) o.style.display = 'none';
    _setStatus('🟢 Cam Active');
  }

  function _setStatus(msg) {
    const b = document.getElementById('mc-status-badge');
    if (b) b.innerText = msg;
  }

  function _updateSettingsUI() {
    const ps = document.getElementById('mc-preset');
    if (ps) ps.value = CFG.preset;
    const js = document.getElementById('mc-jump-sens');
    if (js) { js.value = CFG.jumpSensitivity; document.getElementById('mc-jump-val').innerText = CFG.jumpSensitivity.toFixed(1); }
  }

  // Expose for inline handlers
  function _setCfg(key, val) { CFG[key] = val; }

  // ─── GESTURE FLASH INDICATOR ────────────────────────────────────────────
  function _flashGesture(label) {
    const el = document.getElementById('mc-gesture-indicator');
    if (!el) return;
    el.innerText = label;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 600);
  }

  // Wrap callbacks to flash indicator
  const _origInit = init;

  // ─── LOW LIGHT DEBOUNCE ─────────────────────────────────────────────────
  let _llTimer = null;
  function _handleLowLight() {
    const w = document.getElementById('mc-lowlight-warn');
    if (w) w.style.display = 'block';
    clearTimeout(_llTimer);
    _llTimer = setTimeout(() => { if (w) w.style.display = 'none'; }, 4000);
  }

  return {
    init,
    setPreset,
    toggleJump,
    setJumpSensitivity,
    recalibrate,
    startCamera,
    stopCamera,
    _setCfg,
    _togglePanel,
    _flashGesture,
    _handleLowLight,
    CFG
  };

})();
