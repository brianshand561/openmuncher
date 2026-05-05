# 🪵 OpenMuncher Desktop

Tray-icon companion to the [`openmuncher`](https://www.npmjs.com/package/openmuncher) CLI. Click the tray icon to spawn a small overlay that follows your cursor; click the overlay's mascot to chomp and cycle to the next muncher (woodchipper → beaver → furnace → garbage compactor → lumberjack → goat → shark → repeat). Each click also spawns the `openmuncher` CLI in the background, so the visual gag is backed by a real token burn.

## Install

```
npm install -g openmuncher-desktop
openmuncher-desktop
```

The first run opens a tray icon (🪵 silhouette) in your menu bar / system tray. The dock is hidden — this is a tray-only app.

For real token burns on click, also install the CLI:

```
npm install -g openmuncher
```

(Without it, the overlay still cycles mascots and chomps; it just doesn't burn tokens.)

## What it does

- **Tray icon.** Click → spawn the overlay near your cursor. Click again → dismiss.
- **Cursor-following overlay.** A small transparent always-on-top window (240×240) anchors next to your cursor at ~60fps.
- **Click the mascot to chomp.** A spring animation, a splat emoji, the mascot cycles to the next animal, and `openmuncher --intensity light` is spawned in the background as a detached process.

## Controls

| Action | Result |
|---|---|
| Click tray icon | Spawn or dismiss the overlay |
| Click mascot | Chomp + cycle + fire a real munch (if `openmuncher` is on PATH) |
| Hover overlay → click `×` | Dismiss the overlay (stays in tray) |
| Tray menu → Quit | Quit the app |

## Platforms

- **macOS:** primary target. Tested on Apple Silicon. Tray icon uses template image so it adapts to light/dark menu bar.
- **Linux:** should work; tray support depends on the desktop environment (GNOME extensions, KDE Plasma, etc.).
- **Windows:** should work; not yet polished.

## License

MIT.
