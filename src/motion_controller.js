/**
 * motion_controller.js  —  Webcam body-motion controller for SubwaySurfers
 * Injects ALL UI as floating elements so the original game is 100% untouched.
 * Uses MediaPipe Pose for robust tracking at distance, angles & varied lighting.
 *
 * FIX: stopCamera() now properly releases all getUserMedia stream tracks so the
 *      camera light turns off and subsequent init() calls don't get "already in use".
 */
const MotionController = (function () {

  /* ─────────────────────────────  CONFIG  ────────────────────────────── */
  const CFG = {
    leanThreshold:    0.045,
    jumpThreshold:    0.05,
    duckThreshold:    0.06,
    jumpEnabled:      true,
    jumpSensitivity:  1.0,
    smoothingFrames:  5,
    cooldownMs:       350,
    visibilityMin:    0.50,
    mirrorCamera:     true,
    debugOverlay:     false,
    autoPause:        true,
    seatedMode:       false,
    preset:           'Normal'
  };

  const PRESETS = {
    Kids:    { leanThreshold:0.030, jumpThreshold:0.030, duckThreshold:0.04, jumpSensitivity:2.0, cooldownMs:500 },
    Normal:  { leanThreshold:0.045, jumpThreshold:0.050, duckThreshold:0.06, jumpSensitivity:1.0, cooldownMs:350 },
    Fitness: { leanThreshold:0.060, jumpThreshold:0.070, duckThreshold:0.08, jumpSensitivity:0.6, cooldownMs:250 }
  };

  /* ─────────────────────────────  STATE  ─────────────────────────────── */
  let pose=null, camera=null, videoEl=null, overlayCanvas=null, overlayCtx=null;
  let active=false, calibrated=false, inFrame=false, _wasMissing=false;
  let baseline = { shoulderMidX:0.5, shoulderMidY:0.35, hipMidY:0.65, headY:0.1 };
  let calibFrames=[], history=[];
  const CALIB_NEEDED = 45;
  const lastFired = { left:0, right:0, jump:0, duck:0 };
  let _llTimer=null;
  let _lastLM = null;
  let _lastState = { xDelta:0, yRise:0, yDrop:0, action:'' };
  // FIX: track the raw MediaStream so we can fully release it on stop
  let _rawStream = null;

  /* ────────────────────────── CALLBACKS ──────────────────────────────── */
  let onLeft=()=>{}, onRight=()=>{}, onJump=()=>{}, onDuck=()=>{};
  let onPause=()=>{}, onResume=()=>{}, onCalibrationDone=()=>{}, onLowLight=()=>{};

  /* ──────────────────────────  PUBLIC API  ───────────────────────────── */
  function init(cbs) {
    onLeft=cbs.onLeft||onLeft; onRight=cbs.onRight||onRight;
    onJump=cbs.onJump||onJump; onDuck=cbs.onDuck||onDuck;
    onPause=cbs.onPause||onPause; onResume=cbs.onResume||onResume;
    onCalibrationDone=cbs.onCalibrationDone||onCalibrationDone;
    onLowLight=cbs.onLowLight||onLowLight;
    if (!videoEl) { _buildUI(); }
    _loadMediaPipe();
  }

  function setPreset(n){ const p=PRESETS[n]; if(!p)return; CFG.preset=n; Object.assign(CFG,p); _updateSettingsUI(); }
  function toggleJump(v){ CFG.jumpEnabled=v; }
  function setJumpSensitivity(v){ CFG.jumpSensitivity=parseFloat(v); }
  function recalibrate(){ calibrated=false; calibFrames=[]; history=[]; _showCalibOverlay(); }

  /**
   * FIX: Fully stop the webcam.
   * 1. Stop the MediaPipe Camera wrapper.
   * 2. Stop every track on the raw getUserMedia stream → releases hardware.
   * 3. Clear the video src so the browser forgets the stream entirely.
   * 4. Reset _rawStream so the next init() starts fresh.
   */
  function stopCamera(){
    if (camera) {
      try { camera.stop(); } catch(e) {}
      camera = null;
    }
    if (_rawStream) {
      _rawStream.getTracks().forEach(t => t.stop());
      _rawStream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
    // Reset pose so it's re-created cleanly next init
    pose = null;
    active = false;
    calibrated = false;
    calibFrames = [];
    history = [];
    // Hide preview widgets
    const wrap = document.getElementById('mc-preview-wrap');
    const badge = document.getElementById('mc-status-badge');
    if (wrap)  wrap.style.display  = 'none';
    if (badge) badge.style.display = 'none';
  }

  /* ─────────────────────────  MEDIAPIPE  ─────────────────────────────── */
  function _loadMediaPipe(){
    // Show preview now that we're starting
    const wrap  = document.getElementById('mc-preview-wrap');
    const badge = document.getElementById('mc-status-badge');
    if (wrap)  wrap.style.display  = 'block';
    if (badge) badge.style.display = 'block';

    const needed = ['@mediapipe/camera_utils/camera_utils.js',
                    '@mediapipe/drawing_utils/drawing_utils.js',
                    '@mediapipe/pose/pose.js'];
    let done=0;
    needed.forEach(p=>{
      // Avoid re-adding scripts that already loaded
      if (document.querySelector(`script[src*="${p}"]`)) { done++; if(done===needed.length) _setupPose(); return; }
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/'+p;
      s.crossOrigin='anonymous';
      s.onload=()=>{ done++; if(done===needed.length) _setupPose(); };
      s.onerror=()=>{ console.warn('[MC] CDN fail:',p); done++; if(done===needed.length) _setupPose(); };
      document.head.appendChild(s);
    });
  }

  function _setupPose(){
    if(typeof Pose==='undefined'){ console.error('[MC] Pose not loaded'); return; }
    pose = new Pose({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    pose.setOptions({
      modelComplexity:1, smoothLandmarks:true,
      enableSegmentation:false, smoothSegmentation:false,
      minDetectionConfidence:0.5, minTrackingConfidence:0.5
    });
    pose.onResults(_patchedOnPoseResults);

    // FIX: intercept getUserMedia to capture the raw stream reference
    const _origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function(constraints) {
      const stream = await _origGetUserMedia(constraints);
      _rawStream = stream;
      // Restore the original so we don't stack wrappers on re-init
      navigator.mediaDevices.getUserMedia = _origGetUserMedia;
      return stream;
    };

    camera = new Camera(videoEl, {
      onFrame: async()=>{ if(pose) await pose.send({image:videoEl}); },
      width:320, height:240
    });
    _calibCanvas = document.getElementById('mc-calib-canvas');
    _calibCtx    = _calibCanvas ? _calibCanvas.getContext('2d') : null;
    _showCalibOverlay();
    camera.start();
    active = true;
  }

  /* ──────────────────────  POSE RESULT HANDLER  ──────────────────────── */
  function _patchedOnPoseResults(results){
    _drawCameraFrame(results);
    // Mirror to full-screen calib canvas if open
    if(calibOvVisible() && _calibCtx && videoEl){
      const W=320, H=240;
      _calibCtx.save(); _calibCtx.translate(W,0); _calibCtx.scale(-1,1);
      _calibCtx.drawImage(videoEl,0,0,W,H);
      _calibCtx.restore();
      if(results.poseLandmarks && typeof drawConnectors!=='undefined'){
        _calibCtx.save(); _calibCtx.translate(W,0); _calibCtx.scale(-1,1);
        drawConnectors(_calibCtx,results.poseLandmarks,POSE_CONNECTIONS,{color:'rgba(0,255,100,0.9)',lineWidth:3});
        drawLandmarks(_calibCtx,results.poseLandmarks,{color:'#ff3d3d',lineWidth:1,radius:5});
        _calibCtx.restore();
      }
    }
    if(!results.poseLandmarks||results.poseLandmarks.length<25){ _handleMissingPose(); return; }
    const lm=results.poseLandmarks;
    const lSh=lm[11],rSh=lm[12],lHip=lm[23],rHip=lm[24],nose=lm[0];
    if(lSh.visibility<CFG.visibilityMin||rSh.visibility<CFG.visibilityMin){ _handleMissingPose(); return; }
    const avgVis=(lSh.visibility+rSh.visibility+lHip.visibility+rHip.visibility)/4;
    if(avgVis<0.38) onLowLight();
    inFrame=true;
    if(_wasMissing&&CFG.autoPause) onResume();
    _wasMissing=false; _lastLM=lm;
    const flip=CFG.mirrorCamera?(x=>1-x):(x=>x);
    const frame={
      shoulderMidX:flip((lSh.x+rSh.x)/2),
      shoulderMidY:(lSh.y+rSh.y)/2,
      hipMidY:(lHip.y+rHip.y)/2,
      headY:nose.y
    };
    if(!calibrated){ _accumulateCalib(frame); return; }
    history.push(frame);
    if(history.length>CFG.smoothingFrames) history.shift();
    if(history.length<2) return;
    const s=_smooth();
    _interpret(s);
    _drawHUD(s);
  }

  /* ───────────────────────── CALIBRATION ─────────────────────────────── */
  function _accumulateCalib(frame){
    calibFrames.push(frame);
    const pct=Math.min(100,Math.round(calibFrames.length/CALIB_NEEDED*100));
    const bar=document.getElementById('mc-calib-bar');
    const pctTxt=document.getElementById('mc-calib-pct');
    if(bar) bar.style.width=pct+'%';
    if(pctTxt) pctTxt.innerText=pct+'%';
    if(calibFrames.length>=CALIB_NEEDED){
      baseline.shoulderMidX=_avg(calibFrames,'shoulderMidX');
      baseline.shoulderMidY=_avg(calibFrames,'shoulderMidY');
      baseline.hipMidY     =_avg(calibFrames,'hipMidY');
      baseline.headY       =_avg(calibFrames,'headY');
      calibrated=true; calibFrames=[];
      _hideCalibOverlay();
      onCalibrationDone();
    }
  }

  /* ──────────────────────── GESTURE LOGIC ────────────────────────────── */
  function _interpret(s){
    const now=Date.now();
    const xDelta=s.shoulderMidX-baseline.shoulderMidX;
    const yRise =baseline.shoulderMidY-s.shoulderMidY;
    const yDrop =s.shoulderMidY-baseline.shoulderMidY;
    _lastState={xDelta,yRise,yDrop,action:'—'};
    if(xDelta < -CFG.leanThreshold && _cd('left',now)){
      lastFired.left=now; _lastState.action='LEFT'; onLeft();
    } else if(xDelta > CFG.leanThreshold && _cd('right',now)){
      lastFired.right=now; _lastState.action='RIGHT'; onRight();
    }
    if(CFG.jumpEnabled && !CFG.seatedMode){
      const thresh=CFG.jumpThreshold/CFG.jumpSensitivity;
      if(yRise>thresh && _cd('jump',now)){ lastFired.jump=now; _lastState.action='JUMP'; onJump(); }
    }
    if(CFG.seatedMode && CFG.jumpEnabled){
      const headDrop=s.headY-baseline.headY;
      const thresh=0.04/CFG.jumpSensitivity;
      if(headDrop>thresh && _cd('jump',now)){ lastFired.jump=now; _lastState.action='JUMP'; onJump(); }
    }
    if(yDrop>CFG.duckThreshold && _cd('duck',now)){ lastFired.duck=now; _lastState.action='DUCK'; onDuck(); }
  }

  function _cd(a,now){ return (now-lastFired[a])>CFG.cooldownMs; }

  function _handleMissingPose(){
    if(!_wasMissing&&CFG.autoPause&&inFrame) onPause();
    _wasMissing=true; inFrame=false; _lastLM=null;
    const badge=document.getElementById('mc-status-badge');
    if(badge){ badge.innerText='\uD83D\uDFE1 No pose detected'; }
  }

  /* ─────────────────────── SMOOTHING HELPERS ─────────────────────────── */
  function _smooth(){ return { shoulderMidX:_avg(history,'shoulderMidX'), shoulderMidY:_avg(history,'shoulderMidY'), hipMidY:_avg(history,'hipMidY'), headY:_avg(history,'headY') }; }
  function _avg(arr,k){ return arr.reduce((s,f)=>s+f[k],0)/arr.length; }

  /* ───────────────────── CAMERA + SKELETON DRAW ──────────────────────── */
  function _drawCameraFrame(results){
    if(!overlayCtx) return;
    const W=overlayCanvas.width, H=overlayCanvas.height;
    overlayCtx.save();
    overlayCtx.translate(W,0); overlayCtx.scale(-1,1);
    overlayCtx.drawImage(videoEl,0,0,W,H);
    overlayCtx.restore();
    if(results.poseLandmarks && typeof drawConnectors!=='undefined'){
      overlayCtx.save();
      overlayCtx.translate(W,0); overlayCtx.scale(-1,1);
      drawConnectors(overlayCtx,results.poseLandmarks,POSE_CONNECTIONS,{color:'rgba(0,255,100,0.8)',lineWidth:2});
      drawLandmarks(overlayCtx,results.poseLandmarks,{color:'#ff3d3d',lineWidth:1,radius:3});
      overlayCtx.restore();
    }
    if(!calibrated){
      overlayCtx.fillStyle='rgba(0,0,0,0.35)';
      overlayCtx.fillRect(0,0,W,H);
      overlayCtx.fillStyle='#0f0';
      overlayCtx.font='bold 11px monospace';
      overlayCtx.textAlign='center';
      overlayCtx.fillText('CALIBRATING…',W/2,H-8);
    }
  }

  /* ─────────────────  HUD BARS  ───────────────────────────────────────── */
  function _drawHUD(s){
    if(!overlayCtx) return;
    const W=overlayCanvas.width, H=overlayCanvas.height;
    const xDelta=s.shoulderMidX-baseline.shoulderMidX;
    const yRise =baseline.shoulderMidY-s.shoulderMidY;
    const yDrop =s.shoulderMidY-baseline.shoulderMidY;
    const badge=document.getElementById('mc-status-badge');
    if(badge){
      badge.innerText = _lastState.action==='—' ? '\uD83D\uDFE2 Tracking' : '\uD83D\uDFE1 '+_lastState.action;
    }
    const barH=5, barY=H-barH-2, midX=W/2;
    overlayCtx.fillStyle='rgba(0,0,0,0.5)';
    overlayCtx.fillRect(0,barY-14,W,14);
    overlayCtx.fillStyle='#aaa';
    overlayCtx.font='9px monospace';
    overlayCtx.textAlign='left';
    overlayCtx.fillText('LEAN',2,barY-3);
    const leanPx=Math.min(Math.abs(xDelta)/0.15,1)*(W/2-4);
    const leanCol=Math.abs(xDelta)>CFG.leanThreshold?'#ff0':'#0af';
    overlayCtx.fillStyle=leanCol;
    if(xDelta<0) overlayCtx.fillRect(midX-leanPx,barY-12,leanPx,10);
    else         overlayCtx.fillRect(midX,barY-12,leanPx,10);
    overlayCtx.fillStyle='#fff';
    overlayCtx.fillRect(midX-1,barY-14,2,14);
    overlayCtx.fillStyle='rgba(0,0,0,0.5)';
    overlayCtx.fillRect(W-22,0,20,H);
    const jumpH=Math.min(yRise/0.15,1)*(H-4);
    overlayCtx.fillStyle=yRise>CFG.jumpThreshold/CFG.jumpSensitivity?'#ff0':'#0f0';
    overlayCtx.fillRect(W-18,H-2-jumpH,6,jumpH);
    overlayCtx.fillStyle='#aaa';
    overlayCtx.font='8px monospace';
    overlayCtx.textAlign='center';
    overlayCtx.fillText('JMP',W-15,H-4);
    overlayCtx.fillStyle='rgba(0,0,0,0.5)';
    overlayCtx.fillRect(2,0,20,H);
    const duckH=Math.min(yDrop/0.15,1)*(H-4);
    overlayCtx.fillStyle=yDrop>CFG.duckThreshold?'#f44':'#08f';
    overlayCtx.fillRect(4,H-2-duckH,6,duckH);
    overlayCtx.fillStyle='#aaa';
    overlayCtx.font='8px monospace';
    overlayCtx.textAlign='center';
    overlayCtx.fillText('DK',10,H-4);
  }

  /* ──────────────────────────── UI BUILDER ───────────────────────────── */
  function _buildUI(){
    const style=document.createElement('style');
    style.textContent=`
      #mc-preview-wrap {
        display:none;
        position:fixed; top:64px; right:10px; z-index:300;
        width:200px; border-radius:10px; overflow:hidden;
        border:1px solid rgba(0,255,100,0.4);
        box-shadow:0 0 20px rgba(0,255,100,0.2), 0 4px 24px rgba(0,0,0,0.6);
        background:#000;
      }
      #mc-overlay-canvas { display:block; width:200px; height:150px; }
      #mc-video { display:none; }
      #mc-status-badge {
        display:none;
        position:fixed; top:222px; right:10px; z-index:301;
        background:rgba(10,12,18,0.9);
        color:#0f0;
        border-radius:0 0 8px 8px;
        padding:4px 10px;
        font:bold 11px 'Inter',monospace;
        text-align:center; width:200px;
        border:1px solid rgba(0,255,100,0.3); border-top:none;
        backdrop-filter:blur(4px);
      }
      #mc-lowlight-warn {
        display:none; position:fixed; top:250px; right:10px; z-index:302;
        background:rgba(255,160,0,0.9); color:#000;
        border-radius:6px; padding:5px 12px;
        font:bold 11px 'Inter',sans-serif;
        backdrop-filter:blur(4px);
      }
      #mc-gesture-flash {
        position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
        z-index:350; pointer-events:none;
        background:rgba(0,0,0,0.75);
        color:#fff;
        border:2px solid rgba(255,255,255,0.3);
        border-radius:16px;
        padding:14px 36px;
        font:bold 30px 'Orbitron','Inter',monospace;
        opacity:0; transition:opacity 0.15s;
        text-align:center;
        backdrop-filter:blur(8px);
        box-shadow:0 0 40px rgba(0,0,0,0.6);
      }
      #mc-panel {
        display:none; position:fixed; top:64px; right:220px; z-index:400;
        background:rgba(12,14,22,0.97);
        color:#eee; border:1px solid rgba(0,255,100,0.25);
        border-radius:12px; padding:16px 18px;
        font:13px 'Inter',sans-serif; min-width:250px;
        box-shadow:0 8px 32px rgba(0,0,0,0.6);
        backdrop-filter:blur(12px);
      }
      #mc-panel h4 { color:#0f0; margin:0 0 12px; font-family:'Orbitron',monospace; font-size:13px; letter-spacing:1px; }
      .mc-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
      .mc-row label { width:150px; color:#999; font-size:12px; }
      .mc-row input[type=range]{ width:80px; accent-color:#0f0; }
      .mc-btn {
        background:rgba(0,255,100,0.15); color:#0f0;
        border:1px solid rgba(0,255,100,0.3);
        padding:6px 12px; border-radius:6px;
        cursor:pointer; margin:4px 4px 0 0;
        font-weight:600; font-size:12px;
        transition:all 0.15s;
      }
      .mc-btn:hover { background:rgba(0,255,100,0.25); }
      .mc-btn-red { background:rgba(255,60,60,0.15); color:#f66; border-color:rgba(255,60,60,0.3); }
      .mc-btn-red:hover { background:rgba(255,60,60,0.25); }
      #mc-calib-overlay {
        position:fixed; inset:0; z-index:600;
        background:rgba(5,5,12,0.92);
        display:none; flex-direction:row;
        align-items:center; justify-content:center; gap:40px;
        backdrop-filter:blur(6px);
      }
      #mc-calib-preview {
        border:1px solid rgba(0,255,100,0.4); border-radius:12px;
        overflow:hidden; width:320px; height:240px;
        background:#000; flex-shrink:0;
        box-shadow:0 0 30px rgba(0,255,100,0.15);
      }
      #mc-calib-canvas { width:320px; height:240px; display:block; }
      #mc-calib-text { color:#ddd; font:14px 'Inter',sans-serif; max-width:300px; }
      #mc-calib-text h2 { color:#0f0; margin:0 0 12px; font-family:'Orbitron',monospace; font-size:18px; }
      #mc-calib-track {
        width:100%; height:10px; background:#1a1a2a;
        border-radius:5px; overflow:hidden; margin:14px 0 6px;
      }
      #mc-calib-bar { height:100%; width:0%; background:linear-gradient(90deg,#00c44f,#0ff); transition:width 0.1s; border-radius:5px; }
      #mc-tutorial-overlay {
        display:none; position:fixed; inset:0; z-index:500;
        background:rgba(0,0,0,0.55); pointer-events:none;
      }
      .mc-tut-card {
        position:absolute; top:35%; left:50%; transform:translateX(-50%);
        background:rgba(8,10,18,0.95);
        border:1px solid rgba(255,255,255,0.15);
        border-radius:18px; padding:28px 48px;
        color:#fff; font:18px 'Inter',sans-serif; text-align:center;
        box-shadow:0 8px 60px rgba(0,0,0,0.8);
        backdrop-filter:blur(12px);
      }
      .mc-tut-icon { font-size:60px; display:block; margin-bottom:10px; }
    `;
    document.head.appendChild(style);

    videoEl=document.createElement('video');
    videoEl.id='mc-video'; videoEl.autoplay=true; videoEl.playsInline=true;
    document.body.appendChild(videoEl);

    const wrap=document.createElement('div'); wrap.id='mc-preview-wrap';
    overlayCanvas=document.createElement('canvas');
    overlayCanvas.id='mc-overlay-canvas';
    overlayCanvas.width=200; overlayCanvas.height=150;
    overlayCtx=overlayCanvas.getContext('2d');
    wrap.appendChild(overlayCanvas);
    document.body.appendChild(wrap);

    const badge=document.createElement('div'); badge.id='mc-status-badge';
    badge.innerText='\uD83D\uDD34 Camera starting…';
    document.body.appendChild(badge);

    const ll=document.createElement('div'); ll.id='mc-lowlight-warn';
    ll.innerText='\u26A0\uFE0F Low light — move to better lighting';
    document.body.appendChild(ll);

    const gf=document.createElement('div'); gf.id='mc-gesture-flash';
    document.body.appendChild(gf);

    const panel=document.createElement('div'); panel.id='mc-panel';
    panel.innerHTML=`
      <h4>&#9881; WEBCAM SETTINGS</h4>
      <div class="mc-row"><label>Preset</label>
        <select id="mc-preset" onchange="MotionController.setPreset(this.value)" style="background:#1a1a2a;color:#eee;border:1px solid #333;border-radius:4px;padding:2px 6px;">
          <option>Kids</option><option selected>Normal</option><option>Fitness</option>
        </select></div>
      <div class="mc-row"><label>Jump Enabled</label>
        <input type="checkbox" id="mc-jump-toggle" checked onchange="MotionController.toggleJump(this.checked)"></div>
      <div class="mc-row"><label>Jump Sensitivity</label>
        <input type="range" id="mc-jump-sens" min="0.3" max="2.5" step="0.1" value="1.0"
          oninput="MotionController.setJumpSensitivity(this.value);document.getElementById('mc-jval').innerText=parseFloat(this.value).toFixed(1)">
        <span id="mc-jval">1.0</span></div>
      <div class="mc-row"><label>Seated Mode</label>
        <input type="checkbox" id="mc-seated" onchange="MotionController._setCfg('seatedMode',this.checked)"> <small style="color:#666">(head-nod jump)</small></div>
      <div class="mc-row"><label>Mirror Camera</label>
        <input type="checkbox" id="mc-mirror" checked onchange="MotionController._setCfg('mirrorCamera',this.checked)"></div>
      <div class="mc-row"><label>Auto-pause if out of frame</label>
        <input type="checkbox" id="mc-autopause" checked onchange="MotionController._setCfg('autoPause',this.checked)"></div>
      <hr style="border-color:rgba(255,255,255,0.08);margin:12px 0;">
      <button onclick="MotionController.recalibrate()" class="mc-btn">&#128247; Recalibrate</button>
      <button onclick="MotionController._togglePanel()" class="mc-btn mc-btn-red">&#10005; Close</button>
    `;
    document.body.appendChild(panel);

    const gear=document.createElement('button');
    gear.id='mc-gear-btn';
    gear.innerHTML='&#9881;';
    gear.title='Webcam Settings';
    gear.style.cssText='display:none;position:fixed;top:64px;right:218px;z-index:399;background:rgba(10,12,20,0.85);color:rgba(0,255,100,0.7);border:1px solid rgba(0,255,100,0.2);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:14px;backdrop-filter:blur(4px);';
    gear.onclick=()=>_togglePanel();
    document.body.appendChild(gear);

    const calibOv=document.createElement('div'); calibOv.id='mc-calib-overlay';
    calibOv.innerHTML=`
      <div id="mc-calib-preview">
        <canvas id="mc-calib-canvas" width="320" height="240"></canvas>
      </div>
      <div id="mc-calib-text">
        <h2>&#128247; Calibration</h2>
        <p>Stand back so your <strong>head to hips</strong> are visible.<br>Keep arms relaxed. Hold a neutral pose.</p>
        <div id="mc-calib-track"><div id="mc-calib-bar"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:12px;">
          <span>0%</span><span id="mc-calib-pct" style="color:#0f0;font-weight:bold;">0%</span><span>100%</span>
        </div>
        <p style="color:#666;font-size:12px;">&#9888;&#65039; The green skeleton shows what the camera sees.<br>Make sure it covers your shoulders and hips.</p>
      </div>
    `;
    document.body.appendChild(calibOv);

    const tutOv=document.createElement('div'); tutOv.id='mc-tutorial-overlay';
    tutOv.innerHTML='<div class="mc-tut-card" id="mc-tut-card"></div>';
    document.body.appendChild(tutOv);

    _calibCanvas=document.getElementById('mc-calib-canvas');
    _calibCtx=_calibCanvas?_calibCanvas.getContext('2d'):null;
  }

  let _calibCanvas=null, _calibCtx=null;

  function calibOvVisible(){
    const o=document.getElementById('mc-calib-overlay');
    return o&&o.style.display!=='none';
  }

  function _showCalibOverlay(){
    const o=document.getElementById('mc-calib-overlay');
    if(o) o.style.display='flex';
    _setStatus('\uD83D\uDFE1 Calibrating…');
  }
  function _hideCalibOverlay(){
    const o=document.getElementById('mc-calib-overlay');
    if(o) o.style.display='none';
    const gear=document.getElementById('mc-gear-btn');
    if(gear) gear.style.display='block';
    _setStatus('\uD83D\uDFE2 Tracking');
  }
  function _togglePanel(){
    const p=document.getElementById('mc-panel');
    if(p) p.style.display=p.style.display==='none'?'block':'none';
  }
  function _setStatus(msg){
    const b=document.getElementById('mc-status-badge');
    if(b) b.innerText=msg;
  }
  function _updateSettingsUI(){
    const ps=document.getElementById('mc-preset'); if(ps) ps.value=CFG.preset;
    const js=document.getElementById('mc-jump-sens');
    if(js){ js.value=CFG.jumpSensitivity; const jv=document.getElementById('mc-jval'); if(jv) jv.innerText=CFG.jumpSensitivity.toFixed(1); }
  }
  function _setCfg(k,v){ CFG[k]=v; }

  function _flashGesture(label){
    const el=document.getElementById('mc-gesture-flash');
    if(!el) return;
    el.innerText=label;
    el.style.opacity='1';
    clearTimeout(el._t);
    el._t=setTimeout(()=>{ el.style.opacity='0'; },500);
  }

  function _handleLowLight(){
    const w=document.getElementById('mc-lowlight-warn');
    if(w) w.style.display='block';
    clearTimeout(_llTimer);
    _llTimer=setTimeout(()=>{ const w=document.getElementById('mc-lowlight-warn'); if(w) w.style.display='none'; },4000);
  }

  return {
    init, setPreset, toggleJump, setJumpSensitivity,
    recalibrate, stopCamera,
    _setCfg, _togglePanel, _flashGesture, _handleLowLight, CFG
  };

})();
