# Subway Surfers — Webcam Exercise Edition

A browser-based Subway Surfers clone where **your body IS the controller**. No keyboard needed — lean, jump, and duck in front of your webcam to control the runner.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📷 Webcam Motion Control | MediaPipe Pose tracks your shoulders, hips, and head |
| ⬅️ ➡️ Lane Change | Lean your torso left or right |
| ⬆️ Jump | Rise on your toes / jump (adjustable sensitivity) |
| ⬇️ Duck | Drop your shoulders / squat |
| 🎓 Tutorial Mode | Slow-motion onboarding that teaches gestures in-game |
| 🔧 Jump Sensitivity Slider | Tune how high you need to jump; or disable entirely |
| 🪑 Seated Mode | Head-nod triggers jump — accessible for seated players |
| 👶 Presets | Kids / Normal / Fitness difficulty |
| 🌑 Low-Light Warning | Warns when camera conditions are poor |
| ⏸️ Auto-Pause | Pauses when you leave the camera frame |
| 🟢 Debug Skeleton | Toggle skeleton overlay to fine-tune calibration |
| ⌨️ Keyboard Fallback | Arrow keys + Space still work if webcam is off |

---

## 🚀 How to Run Locally

> **Important:** You must serve the files through a local web server. Opening `index.html` directly via `file://` will block webcam access and texture loading.

### Option A — VS Code Live Server (easiest)
1. Open the project folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html` → **Open with Live Server**.
4. Allow camera access in the browser prompt.

### Option B — Python (no install needed)
```bash
# Python 3
python -m http.server 8080
# Then open http://localhost:8080 in Chrome or Edge
```

### Option C — Node.js
```bash
npx serve .
# Then open the URL shown in your terminal
```

---

## 📷 Webcam Setup Tips

- Stand **1.5–2.5 m** away so your full upper body (head to hips) is visible.
- Make sure you are **front-lit** — avoid bright windows behind you.
- After clicking **Start Webcam**, hold a neutral standing pose for ~1.5 seconds during calibration.
- All movements are relative to *your* calibrated pose, so different body types work out of the box.
- If tracking feels off, click **Recalibrate** in the settings panel.

---

## 🎮 Controls

| Action | Webcam Gesture | Keyboard |
|---|---|---|
| Move Left | Lean torso left | ← Arrow |
| Move Right | Lean torso right | → Arrow |
| Jump | Rise up / jump | Space |
| Duck | Drop shoulders / squat | ↓ Arrow |

---

## ⚙️ Settings Panel

Click **⚙ Cam Settings** in the toolbar to open the panel:

- **Mode Preset** — Kids (easy), Normal, Fitness (hard)
- **Jump toggle** — disable jump for people who cannot jump
- **Jump Sensitivity** — 0.3 (barely move) → 2.5 (full jump required)
- **Seated Mode** — head-nod activates jump instead
- **Mirror Camera** — flip left/right (on by default)
- **Debug Skeleton** — draw green skeleton on camera feed
- **Auto-pause** — pause when you leave frame

---

## 📦 Creating a Release on GitHub

1. Merge the `webcam-motion-controls` branch into `main`.
2. Go to your repo → **Releases** → **Draft a new release**.
3. Choose **Create a new tag** (e.g. `v1.0.0`) on `main`.
4. Add a title like *"Webcam Exercise Edition v1.0.0"* and paste the feature list.
5. Click **Publish release** — GitHub auto-generates `.zip` and `.tar.gz` source archives.
6. Share the release link and tell users to run it with **Live Server** or `python -m http.server`.

---

## 🧩 Architecture

```
index.html            ← main entry, UI toolbar, webcam toggle button
src/
  game.js             ← WebGL render loop, collision, keyboard input
  surfer.js           ← player object (moveLeft, moveRight, jump, duck)
  motion_controller.js← MediaPipe pose → game action bridge (NEW)
  tutorial.js         ← slow-mo tutorial overlay (NEW)
  [other src files]   ← game objects (coins, trains, walls, etc.)
static/               ← textures
```

---

## 🛠️ game.js Speed Patch

See `src/game_patch.md` for the 3 small edits needed in `game.js` to activate slow-motion tutorial mode and fix a duplicate event-listener bug from the original code.

---

## License

Forked from the original SubwaySurfers WebGL project. Webcam layer © 2026 Harman Lakhian.
