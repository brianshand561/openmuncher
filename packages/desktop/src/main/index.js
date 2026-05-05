/**
 * OpenMuncher Desktop — Electron main process.
 *
 * Tray icon (a 🪵 in monochrome) sits in the menu bar. Click → spawn a small
 * always-on-top transparent overlay window that follows the cursor. Click in the
 * overlay → mascot chomps + cycles to the next animal + invokes the openmuncher
 * CLI as a child process to record a real munch (if openmuncher is on PATH;
 * otherwise just the visual gag plays).
 *
 * Cross-platform: macOS, Linux, Windows. Tray icon paths vary; cursor tracking
 * uses Electron's screen.getCursorScreenPoint() which is portable.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

let tray = null;
let overlay = null;

const OVERLAY_W = 240;
const OVERLAY_H = 240;
const FOLLOW_INTERVAL_MS = 16; // ~60fps

function trayIconPath() {
  // Same icon for all platforms; macOS template-mode is set below.
  return path.join(__dirname, '..', '..', 'assets', 'tray.png');
}

function createOverlay() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.show();
    overlay.focus();
    return overlay;
  }
  overlay = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlay.on('closed', () => { overlay = null; });

  // Cursor follower.
  const follow = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    // Offset so the overlay anchors near the cursor without covering it.
    overlay.setBounds({
      x: Math.round(point.x + 16),
      y: Math.round(point.y + 16),
      width: OVERLAY_W,
      height: OVERLAY_H,
    });
  };
  follow();
  const interval = setInterval(follow, FOLLOW_INTERVAL_MS);
  overlay.on('closed', () => clearInterval(interval));
  return overlay;
}

function dismissOverlay() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.close();
    overlay = null;
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Spawn Muncher', click: () => createOverlay() },
    { label: 'Dismiss Muncher', click: () => dismissOverlay() },
    { type: 'separator' },
    { label: 'About OpenMuncher', click: () => {
        require('electron').shell.openExternal('https://github.com/brianshand561/OpenMuncher');
      } },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

function setupTray() {
  let img = nativeImage.createFromPath(trayIconPath());
  if (img.isEmpty()) {
    // Fallback for missing icon: draw a tiny placeholder so the tray still appears.
    img = nativeImage.createFromBuffer(Buffer.from(FALLBACK_PNG_BASE64, 'base64'));
  }
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img.resize({ width: 18, height: 18 }));
  tray.setToolTip('OpenMuncher');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (overlay && !overlay.isDestroyed()) dismissOverlay();
    else createOverlay();
  });
}

// Tiny 16x16 transparent PNG with a 🪵 silhouette dot, used only when assets/tray.png is missing.
const FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAOElEQVR42mNgGAWjYBSMglEwCkbBKBgFw4DTw8QAxv8GBgZGwSgYBaNgFIyCUTAKRsEoGAUjBQAA1GoAAQ50pYwAAAAASUVORK5CYII=';

ipcMain.on('munch-clicked', (_event, mascotName) => {
  // Spawn the openmuncher CLI as a side effect so each click is a real burn.
  // Failures are silent — the app still works as a visual toy without the CLI.
  try {
    const cli = spawn('openmuncher', ['--no-animation', '--intensity', 'light'], {
      stdio: 'ignore',
      detached: true,
    });
    cli.unref();
  } catch {
    // No-op.
  }
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('munch-fired', mascotName);
  }
});

ipcMain.on('overlay-dismiss', () => dismissOverlay());

app.whenReady().then(() => {
  // No dock icon on macOS — this is a tray-only app.
  if (app.dock) app.dock.hide();
  setupTray();
});

app.on('window-all-closed', (e) => {
  // Don't quit when the overlay closes — stay alive in the tray.
  e.preventDefault?.();
});
