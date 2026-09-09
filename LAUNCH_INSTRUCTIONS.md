# 🎮 How to Launch Subway Surfers (Auto-Update Edition)

These scripts **automatically pull the latest game updates from GitHub** and then launch the game in your browser.

---

## 🪟 Windows — `launch.bat`

### First-time setup
1. Install **Git**: https://git-scm.com/download/win
2. Install **Python**: https://www.python.org/downloads/ *(tick "Add to PATH" during install)*
3. Make sure your folder was cloned from GitHub (not just downloaded as a ZIP).
   - If you downloaded a ZIP, delete it and run this instead:
     ```
     git clone -b webcam-motion-controls https://github.com/Hamuthefreak/SubwaySurfers.git
     ```

### Every time you want to play
- Just **double-click `launch.bat`** — it will:
  1. Pull the latest code from GitHub automatically
  2. Start a local web server
  3. Open the game in your browser

### Create a Desktop Shortcut
1. Right-click `launch.bat` → **Send to** → **Desktop (create shortcut)**
2. Right-click the shortcut → **Properties** → change the icon if you like
3. Double-click the shortcut on your desktop to play anytime!

---

## 🍎 Mac / 🐧 Linux — `launch.sh`

### First-time setup
1. Install **Git**:
   - Mac: `brew install git` or it comes with Xcode tools
   - Linux: `sudo apt install git`
2. Install **Python 3** (usually already installed)
3. Make the script executable — run this **once** in Terminal:
   ```bash
   chmod +x launch.sh
   ```
4. Make sure your folder was cloned (not downloaded as ZIP):
   ```bash
   git clone -b webcam-motion-controls https://github.com/Hamuthefreak/SubwaySurfers.git
   ```

### Every time you want to play
```bash
./launch.sh
```

### Create a Desktop Shortcut (Mac)
1. Open **Automator** → New Document → **Application**
2. Add action: **Run Shell Script**
3. Paste:
   ```bash
   cd /path/to/your/SubwaySurfers && ./launch.sh
   ```
4. Save as an app to your Desktop — double-click to play!

### Create a Desktop Shortcut (Linux)
Create a file `SubwaySurfers.desktop` on your Desktop:
```ini
[Desktop Entry]
Name=Subway Surfers
Exec=bash -c "cd /path/to/SubwaySurfers && ./launch.sh"
Icon=/path/to/SubwaySurfers/static/icon.png
Type=Application
Terminal=true
```

---

## ❓ Why do I need a local server?

The game uses **WebGL textures** (images loaded by the browser). Browsers block loading local image files for security reasons unless served over `http://`. The scripts spin up a tiny Python server just for this — it only runs while you're playing.

---

## 🔄 What "auto-update" means

Every time you launch, the script runs `git pull origin webcam-motion-controls`. This downloads any new changes (bug fixes, new features) from GitHub before starting. If you have no internet, it skips the update and plays with the current version.
