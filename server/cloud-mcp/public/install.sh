#!/bin/bash
# Forge3D — one-line macOS installer (Apple Silicon).
#   curl -fsSL https://forge3d.duckdns.org/install.sh | bash
# Downloads the latest build, installs it to /Applications, strips the macOS
# quarantine flag (so you don't get "Forge3D is damaged"), and launches it.
set -euo pipefail

REPO="RewardGuard/Forge3D"
DEST="/Applications/Forge3D.app"
TMP="$(mktemp -d)"; MNT=""
cleanup(){ [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

[ "$(uname)" = "Darwin" ] || { echo "✗ This installer is for macOS."; exit 1; }
[ "$(uname -m)" = "arm64" ] || echo "⚠  This build is Apple Silicon (arm64); on Intel it may not run."

echo "→ Finding the latest Forge3D release…"
DMG_URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -oE 'https://[^"]+arm64\.dmg' | head -1)"
[ -n "$DMG_URL" ] || { echo "✗ Could not find the latest .dmg."; exit 1; }

echo "→ Downloading…"
curl -fL --progress-bar "$DMG_URL" -o "$TMP/Forge3D.dmg"

echo "→ Mounting…"
MNT="$(hdiutil attach "$TMP/Forge3D.dmg" -nobrowse | grep -oE '/Volumes/.*' | tail -1)"
SRC="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$SRC" ] || { echo "✗ No app found inside the .dmg."; exit 1; }

echo "→ Installing to /Applications (may ask for your password)…"
if rm -rf "$DEST" 2>/dev/null && ditto "$SRC" "$DEST" 2>/dev/null; then SUDO=""; else SUDO="sudo"; $SUDO rm -rf "$DEST"; $SUDO ditto "$SRC" "$DEST"; fi

echo "→ Clearing quarantine + signing…"
$SUDO xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
$SUDO codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true

echo "✓ Forge3D installed. Opening it now."
open "$DEST"
