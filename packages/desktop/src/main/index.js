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
const { spawn, execFile } = require('node:child_process');

let tray = null;
let overlay = null;

const OVERLAY_W = 320;
const OVERLAY_H = 480;

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
  // Spawn at the cursor's current position. We deliberately do NOT follow the
  // cursor afterwards — otherwise the overlay would dodge the user's click.
  const point = screen.getCursorScreenPoint();
  overlay = new BrowserWindow({
    x: Math.round(point.x - OVERLAY_W / 2),
    y: Math.round(point.y - OVERLAY_H / 2),
    width: OVERLAY_W,
    height: OVERLAY_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true, // user can drag it
    // CRITICAL: focusable: false → mouse clicks still register but the overlay
    // never steals keyboard focus from the user's AI app. Required for the
    // auto-burn flow to inject keystrokes into the right target.
    focusable: false,
    acceptFirstMouse: true,
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

function parseFooter(text) {
  const totalCostMatch = text.match(/Total cost:\s+~?\$([\d,.]+)/);
  const lifetimeMatch = text.match(/Lifetime:\s+([\d,]+)\s+tokens\s+·\s+\$([\d,.]+)/);
  const globalMatch = text.match(/Global:\s+([\d,]+)\s+tokens\s+·\s+\$([\d,.]+)/);
  const num = (s) => Number(String(s).replace(/,/g, ''));
  return {
    totalCostUsd: totalCostMatch ? num(totalCostMatch[1]) : null,
    lifetimeTokens: lifetimeMatch ? num(lifetimeMatch[1]) : null,
    lifetimeCostUsd: lifetimeMatch ? num(lifetimeMatch[2]) : null,
    globalTokens: globalMatch ? num(globalMatch[1]) : null,
    globalCostUsd: globalMatch ? num(globalMatch[2]) : null,
  };
}

ipcMain.on('munch-clicked', (_event, mascotName) => {
  log('munch:', mascotName);
  const sendResult = (payload) => {
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('munch-result', { mascotName, ...payload });
    }
  };
  let stdoutBuf = '';
  let stderrBuf = '';
  let cli;
  try {
    cli = spawn('openmuncher', ['--no-animation', '--intensity', 'light'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    log('CLI spawn failed:', err && err.message);
    sendResult({ ok: false, error: 'CLI not found on PATH' });
    return;
  }
  cli.on('error', (err) => {
    log('CLI error:', err.message);
    sendResult({ ok: false, error: err.message });
  });
  cli.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
  cli.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
  cli.on('close', (code) => {
    if (code !== 0) {
      log('CLI exit', code, 'stderr:', stderrBuf.slice(0, 200));
      sendResult({ ok: false, error: stderrBuf.trim() || `exit ${code}` });
      return;
    }
    const parsed = parseFooter(stdoutBuf);
    log('munch result:', parsed);
    sendResult({ ok: true, ...parsed });
  });
});

ipcMain.on('overlay-dismiss', () => dismissOverlay());

/**
 * Inject `openmuncher --intensity heavy` as keystrokes into whatever app is
 * frontmost. The renderer runs a 3-second countdown before calling this so the
 * user can cmd-tab to their AI client. macOS uses osascript / System Events;
 * Linux/Windows are not implemented in v0.1.
 *
 * macOS will prompt for Automation permission the first time. The prompt
 * targets the parent process (Terminal during dev, Electron when packaged).
 */
ipcMain.on('burn-in-ai', () => {
  log('burn-in-ai requested');
  const send = (payload) => {
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('burn-result', payload);
    }
  };
  if (process.platform !== 'darwin') {
    send({ ok: false, error: 'auto-burn only supported on macOS in v0.1' });
    return;
  }

  // Capture which app is currently frontmost BEFORE we run the keystroke
  // script. If it's our own app, fail loudly instead of typing into ourselves.
  const probe = [
    'tell application "System Events"',
    '  set frontApp to name of first application process whose frontmost is true',
    'end tell',
    'return frontApp',
  ].join('\n');

  execFile('osascript', ['-e', probe], (probeErr, probeStdout, probeStderr) => {
    if (probeErr) {
      log('frontmost-app probe failed:', probeErr.message, probeStderr);
      const denied = /not authoriz|not allowed assistive|1002|1743|denied|-1743/i.test(
        `${probeErr.message} ${probeStderr}`,
      );
      const hint = denied
        ? 'Permission denied. Open System Settings → Privacy & Security → Automation → expand your terminal app → enable "System Events". Or relaunch via packaged app.'
        : (probeStderr || probeErr.message).slice(0, 160);
      send({ ok: false, error: hint });
      return;
    }
    const frontApp = probeStdout.trim();
    log('frontmost app at fire time:', frontApp);
    if (/electron|openmuncher/i.test(frontApp)) {
      send({
        ok: false,
        error: `Frontmost is "${frontApp}" — switch to your AI app DURING the countdown so keystrokes go there.`,
      });
      return;
    }

    const command = 'openmuncher --intensity heavy';
    const script = [
      'tell application "System Events"',
      `  keystroke "${command}"`,
      '  delay 0.12',
      '  key code 36',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script], (err, _stdout, stderr) => {
      if (err) {
        log('keystroke osascript failed:', err.message, stderr);
        const denied = /not authoriz|not allowed assistive|1002|1743|denied|-1743/i.test(
          `${err.message} ${stderr}`,
        );
        const hint = denied
          ? 'Permission denied for System Events. System Settings → Privacy & Security → Automation.'
          : (stderr || err.message).slice(0, 160);
        send({ ok: false, error: hint });
        return;
      }
      log(`keystrokes sent into "${frontApp}"`);
      send({ ok: true, frontApp });
    });
  });
});

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
