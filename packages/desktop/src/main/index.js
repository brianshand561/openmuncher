/**
 * OpenMuncher Desktop — Electron main process.
 *
 * Tray icon (a 🪵 in monochrome) sits in the menu bar. Click → spawn a small
 * always-on-top transparent overlay window that follows the cursor. Click in the
 * overlay → mascot chomps + cycles to the next animal + invokes the openmuncher
 * CLI as a child process to record a real munch (if openmuncher is on PATH;
 * otherwise just the visual gag plays).
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

let tray = null;
let overlay = null;

const OVERLAY_W = 240;
const OVERLAY_H = 240;
const FOLLOW_INTERVAL_MS = 16; // ~60fps

const log = (...args) => console.log('[openmuncher-desktop]', ...args);

function trayIconPath() {
  return path.join(__dirname, '..', '..', 'assets', 'tray.png');
}

function createOverlay() {
  log('createOverlay');
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

  const follow = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
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
    { label: 'OpenMuncher Desktop', enabled: false },
    { type: 'separator' },
    { label: 'Spawn Muncher', click: () => createOverlay() },
    { label: 'Dismiss Muncher', click: () => dismissOverlay() },
    { type: 'separator' },
    { label: 'View on GitHub', click: () => {
        require('electron').shell.openExternal('https://github.com/brianshand561/OpenMuncher');
      } },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

/**
 * Build a high-contrast 22×22 RGBA buffer programmatically so we don't depend
 * on a fragile PNG asset. Renders a chunky log silhouette readable at any
 * menu-bar size. Returns a NativeImage scaled to the platform's tray size.
 */
function buildTrayImage() {
  const W = 22, H = 22;
  const buf = Buffer.alloc(W * H * 4); // RGBA
  // Coordinates of a horizontal log: rounded-rect body from (3,8) to (18,14).
  const setPx = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const inLog = (x, y) => {
    if (y < 8 || y > 14) return false;
    if (x < 3 || x > 18) return false;
    // round the corners
    if ((y === 8 || y === 14) && (x === 3 || x === 18)) return false;
    return true;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inLog(x, y)) setPx(x, y, 0, 0, 0, 255);
    }
  }
  // Two grain rings on the left end (x≈5, y≈11).
  const drawRing = (cx, cy, rx, ry) => {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        const ratio = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (ratio > 0.7 && ratio < 1.1) {
          // Punch transparency through the body to suggest ring lines.
          setPx(cx + x, cy + y, 255, 255, 255, 0);
        }
      }
    }
  };
  drawRing(5, 11, 2, 2);
  return nativeImage.createFromBuffer(buf, { width: W, height: H });
}

function setupTray() {
  let img = nativeImage.createFromPath(trayIconPath());
  if (img.isEmpty()) {
    log('tray.png missing or unreadable, using procedural icon');
    img = buildTrayImage();
  } else {
    log('tray.png loaded from', trayIconPath());
  }
  // Always rebuild procedurally on macOS — guarantees it shows up regardless of
  // whether the asset PNG renders correctly as a template image.
  if (process.platform === 'darwin') {
    img = buildTrayImage();
    img.setTemplateImage(true);
  }
  tray = new Tray(img);
  // On macOS, also set a text title so the tray is visible even on cluttered menu bars.
  // This puts a literal 🪵 in the menu bar next to the icon.
  if (process.platform === 'darwin') {
    tray.setTitle('🪵');
  }
  tray.setToolTip('OpenMuncher — click to spawn the muncher');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    log('tray click');
    if (overlay && !overlay.isDestroyed()) dismissOverlay();
    else createOverlay();
  });
  log('tray installed; look for a 🪵 in your menu bar (top-right on macOS)');
}

ipcMain.on('munch-clicked', (_event, mascotName) => {
  log('munch:', mascotName);
  try {
    const cli = spawn('openmuncher', ['--no-animation', '--intensity', 'light'], {
      stdio: 'ignore',
      detached: true,
    });
    cli.unref();
  } catch (err) {
    log('openmuncher CLI not found; visual gag only', err && err.message);
  }
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('munch-fired', mascotName);
  }
});

ipcMain.on('overlay-dismiss', () => dismissOverlay());

app.whenReady().then(() => {
  log('app ready, platform:', process.platform);
  // Hide dock icon on macOS — this is a tray-only app.
  if (app.dock) app.dock.hide();
  try {
    setupTray();
  } catch (err) {
    log('FATAL: tray setup failed:', err && err.stack ? err.stack : err);
    app.quit();
  }
}).catch((err) => {
  log('FATAL: whenReady failed:', err && err.stack ? err.stack : err);
});

app.on('window-all-closed', (e) => {
  // Don't quit when the overlay closes — stay alive in the tray.
  e.preventDefault?.();
});
