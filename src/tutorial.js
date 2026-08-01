/**
 * tutorial.js
 * Slow-motion tutorial overlay for SubwaySurfers Webcam Mode
 * Plays automatically after calibration, then resumes normal speed.
 */

const Tutorial = (function () {

  const STEPS = [
    { icon: '⬅️',  text: 'Lean LEFT to dodge!',       gesture: 'left',  delay: 2800 },
    { icon: '➡️',  text: 'Lean RIGHT to dodge!',      gesture: 'right', delay: 2800 },
    { icon: '⬆️',  text: 'JUMP to clear obstacles!',  gesture: 'jump',  delay: 3000 },
    { icon: '⬇️',  text: 'DUCK to slide under!',      gesture: 'duck',  delay: 2800 },
    { icon: '🎮',  text: 'GO — use your body!',        gesture: null,    delay: 2000 },
  ];

  let running    = false;
  let stepIndex  = 0;
  let slowFactor = 0.25;   // game speed during tutorial (fraction of normal)
  let onComplete = () => {};
  let onSetSpeed = () => {};

  function start(callbacks) {
    onComplete = callbacks.onComplete || onComplete;
    onSetSpeed = callbacks.onSetSpeed || onSetSpeed;  // fn(factor)
    running    = true;
    stepIndex  = 0;
    _runStep();
  }

  function _runStep() {
    if (stepIndex >= STEPS.length) {
      _finish();
      return;
    }
    const step = STEPS[stepIndex];
    onSetSpeed(slowFactor);
    _showCard(step);
    setTimeout(() => {
      stepIndex++;
      _runStep();
    }, step.delay);
  }

  function _showCard(step) {
    const overlay = document.getElementById('mc-tutorial-overlay');
    const card    = document.getElementById('mc-tut-card');
    if (!overlay || !card) return;
    overlay.style.display = 'block';
    card.innerHTML = `
      <span class="mc-tut-icon">${step.icon}</span>
      <div>${step.text}</div>
      ${ step.gesture ? `<div style="color:#0f0;font-size:13px;margin-top:8px;">[ perform gesture now ]</div>` : '' }
      <div style="color:#888;font-size:11px;margin-top:6px;">SLOW MOTION</div>
    `;
    // Animate card in
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.3s';
    requestAnimationFrame(() => { card.style.opacity = '1'; });
  }

  function _finish() {
    running = false;
    onSetSpeed(1.0);
    const overlay = document.getElementById('mc-tutorial-overlay');
    if (overlay) {
      const card = document.getElementById('mc-tut-card');
      if (card) {
        card.innerHTML = `<span class="mc-tut-icon">🚀</span><div>GO GO GO!</div>`;
        card.style.opacity = '1';
      }
      setTimeout(() => { overlay.style.display = 'none'; }, 1400);
    }
    onComplete();
  }

  function isRunning() { return running; }

  return { start, isRunning };

})();
