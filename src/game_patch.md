# game.js Speed Patch Instructions

To enable slow-motion tutorial mode, add the following one-liner inside the `render` function in `src/game.js`.

## Step 1 — Find the render function (around line 40)

```js
function render(now) {
  now *= 0.001;
  const deltaTime = now - then;
  then = now;
  // ADD THIS LINE:
  const effectiveDelta = deltaTime * (window._gameSpeedFactor || 1.0);

  tickElements(gl);
  drawScene(gl, effectiveDelta);  // pass effectiveDelta instead of deltaTime
  requestAnimationFrame(render);
}
```

## Step 2 — In tickElements, wrap the keydown listener

The keydown listener is currently registered on every tick (a bug in the original game).
Replace the `document.addEventListener('keydown', ...)` block in `tickElements` with a
one-time registration at the top of `initBuffers` instead:

```js
// At the top of initBuffers(gl), add:
document.addEventListener('keydown', function(event) {
  if (window._gameSpeedFactor === 0) return;   // paused
  if(event.keyCode == 37)      surfer.moveLeft();
  else if(event.keyCode == 39) surfer.moveRight();
  else if(event.keyCode == 32) surfer.jump();
  else if(event.keyCode == 40) surfer.duck();
});
```

Then remove the `document.addEventListener('keydown', ...)` block from inside `tickElements`.

## Step 3 — Speed up / slow down world objects

For proper slow-mo, pass `effectiveDelta` to all `.draw()` calls in `drawScene` instead of `deltaTime`.
All the object draw functions already accept deltaTime as a parameter so no other changes are needed.

## Notes
- `window._gameSpeedFactor` is set by `tutorial.js` and `motion_controller.js`.
- Setting it to `0` pauses the game (used for auto-pause when player leaves frame).
- Setting it to `0.25` creates the tutorial slow-motion effect.
- Setting it to `1.0` restores full speed.
