/**
 * tutorial.js — slow-motion gesture tutorial overlay
 * Floats above the original game without touching any game files.
 */
const Tutorial = (function(){

  const STEPS = [
    { icon:'⬅️',  text:'Lean LEFT to change lane!',     delay:3000 },
    { icon:'➡️',  text:'Lean RIGHT to change lane!',    delay:3000 },
    { icon:'⬆️',  text:'Jump to clear obstacles!',      delay:3000 },
    { icon:'⬇️',  text:'Squat to duck under boards!',   delay:3000 },
    { icon:'🏃',  text:'Now GO — use your body!',        delay:2000 },
  ];

  let running=false, stepIndex=0;
  let _onComplete=()=>{}, _onSetSpeed=()=>{};

  function start(cbs){
    _onComplete=cbs.onComplete||_onComplete;
    _onSetSpeed=cbs.onSetSpeed||_onSetSpeed;
    running=true; stepIndex=0;
    _step();
  }

  function _step(){
    if(stepIndex>=STEPS.length){ _finish(); return; }
    const s=STEPS[stepIndex];
    _onSetSpeed(0.25);  // slow-mo
    _showCard(s);
    setTimeout(()=>{ stepIndex++; _step(); }, s.delay);
  }

  function _showCard(s){
    const ov=document.getElementById('mc-tutorial-overlay');
    const card=document.getElementById('mc-tut-card');
    if(!ov||!card) return;
    ov.style.display='block';
    card.innerHTML=`
      <span class="mc-tut-icon">${s.icon}</span>
      <div>${s.text}</div>
      <div style="color:#888;font-size:12px;margin-top:8px;">● SLOW MOTION ●</div>
    `;
    card.style.opacity='0';
    card.style.transition='opacity 0.25s';
    requestAnimationFrame(()=>{ card.style.opacity='1'; });
  }

  function _finish(){
    running=false;
    _onSetSpeed(1.0);
    const ov=document.getElementById('mc-tutorial-overlay');
    const card=document.getElementById('mc-tut-card');
    if(card){ card.innerHTML='<span class="mc-tut-icon">🚀</span><div>GO!</div>'; }
    setTimeout(()=>{ if(ov) ov.style.display='none'; _onComplete(); }, 1500);
  }

  function isRunning(){ return running; }
  return { start, isRunning };

})();
