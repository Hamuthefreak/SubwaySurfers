#!/bin/bash

echo "=========================================="
echo "  Subway Surfers - Webcam Edition"
echo "  Auto-updating from GitHub..."
echo "=========================================="
echo

# Pull latest changes
if command -v git &> /dev/null; then
    git pull origin webcam-motion-controls
    if [ $? -ne 0 ]; then
        echo "[WARNING] Could not pull updates. Playing with current version."
    fi
else
    echo "[WARNING] Git not found. Skipping update."
fi

echo
echo "=========================================="
echo "  Starting local server + launching game"
echo "=========================================="
echo

PORT=8000

# Try python3 first, then python
if command -v python3 &> /dev/null; then
    SERVER_CMD="python3 -m http.server $PORT"
elif command -v python &> /dev/null; then
    SERVER_CMD="python -m http.server $PORT"
else
    echo "[ERROR] Python not found. Please install Python:"
    echo "  Mac:   brew install python"
    echo "  Linux: sudo apt install python3"
    exit 1
fi

# Small wait then open browser
(sleep 1.5 && open_url() {
    if command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:$PORT/index.html"   # Linux
    elif command -v open &> /dev/null; then
        open "http://localhost:$PORT/index.html"        # macOS
    fi
} && open_url) &

echo "Server running at http://localhost:$PORT"
echo "Press Ctrl+C to stop."
echo
$SERVER_CMD
