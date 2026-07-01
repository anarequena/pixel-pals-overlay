# 🐾 Pixel Pals Overlay

A fun, always-on-top desktop overlay for Windows that docks to the right edge of
your screen and shows your **daily plan + to-do list in real time**. Cute pixel
animals roam around, the task you should focus on **right now** is highlighted
and tagged by a ⭐ leader pal, and there's a built-in **Pomodoro timer with lofi
music**.

![pixel pals](assets/icon.png)

## ✨ Features

- **Right-edge overlay** — transparent, frameless, always-on-top, spans the full
  screen height. Drag the header to nudge it.
- **Reserves screen space (docking)** — registers as a Windows **AppBar**, so
  maximized / snapped windows stop at the overlay's edge instead of sliding
  underneath it. Toggle it from the tray ("Reserve screen space"). The
  reservation is **self-healing**: if Windows clears it (a full-screen app,
  sleep/wake, or a resolution change), the overlay detects the loss and
  re-reserves the strip automatically, so it keeps pushing other windows over
  even after running for days. It also **cleans up after itself**: releasing the
  strip is verified on quit, and if a previous run was force-killed or crashed
  (leaving the reserved strip stuck on screen), the next launch clears the
  orphaned reservation before re-registering — so the right edge never stays
  blocked once the app is closed.
- **Live daily plan** — automatically reads your latest
  `DailyPlan-YYYY-MM-DD.md` from your `DailyWorkPlans` folder and live-reloads
  whenever the file changes. Parses **Top 5 Priorities**, **Do Now**,
  **Do Later Today**, and **Defer / Monitor**.
- **Clickable links** — PR and work-item links in your plan render as clickable
  chips (🔗 PRs, 📋 work items) that open in your browser.
- **Schedule-driven focus** — uses the timestamps in your **Time-Blocked
  Schedule** to auto-pick what you should be working on *right now*, and shows
  what's next. Doing something unplanned? Hit ✎ to type a custom focus, ★ to pin
  a specific task, or ↻ to snap back to the schedule.
- **Add / edit / complete / delete** tasks right in the overlay — changes are
  written back into your DailyPlan `.md` file (or saved locally if you have no
  plan yet).
- **Drag tasks between sections** — grab a plan task and drop it into Do Now,
  Top 5 Priorities, Do Later, or Defer (or reorder within a section). The move
  is rewritten into the `.md`, with the Top 5 list auto-renumbered and any
  embedded links preserved.
- **One cute pixel pal** 🐱🐰🐸🐥🦊 — a single animal sits on the focus card,
  hopping livelier (💪) during work sessions and dozing (😴) on breaks.
- **Pomodoro timer** — 25 / 5 cycles (long break every 4th round) with a
  progress ring, desktop notifications, and a soft chime on phase changes.
- **Lofi music** — a built-in *procedurally generated* lofi loop (copyright-safe),
  playback of any `.mp3`/`.wav`/`.ogg` you drop into the `music/` folder, **and
  YouTube lofi streams** (preset stations + paste your own link) via YouTube's
  official embedded player.
- **Click-through mode** — let the mouse pass through the overlay so it never
  gets in your way; hovering an actual panel re-enables interaction.
- **System tray** — show/hide, toggle click-through, reserve screen space,
  reload plan, open folders.

## 🚀 Run it

```powershell
cd D:\daily-app
npm install      # first time only (installs Electron)
npm start
```

The overlay appears on the right edge of your primary monitor and a 🐾 icon
appears in the system tray.

## 🖥️ Use it like a normal app (no `npm start`)

After the one-time `npm install`, you don't need the terminal again. Create
click-to-launch shortcuts:

```powershell
cd D:\daily-app
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

This adds **Pixel Pals Overlay** to your **Desktop** and **Start Menu**. Both run
the silent launcher (`Launch Pixel Pals.vbs`) — the app starts with no terminal
window. You can also just double-click `Launch Pixel Pals.vbs` directly.

- **Auto-start at login:** right-click the tray icon → check **Start with
  Windows**. It'll be running and docked every time you sign in.
- **Remove the shortcuts:** `...\install-shortcuts.ps1 -Uninstall`.

> The app still lives in this folder (so your daily plans stay live and you can
> drop music files into `music/`). If you'd rather have a fully standalone
> installer/`.exe`, you can add [`electron-builder`](https://www.electron.build/)
> later — but for personal use the launcher + auto-start above is simpler and
> keeps the music drop-in folder editable.

## ⌨️ Shortcuts

| Action | Shortcut |
|---|---|
| Toggle click-through | `Ctrl + Alt + P` |
| Show / hide overlay  | `Ctrl + Alt + O` |

Tray icon: **left-click** toggles show/hide, **right-click** opens the menu.

## 🗂️ Where tasks come from

Tasks are merged from two sources:

1. **Your DailyPlan file** — the newest
   `…\Documents\DailyWorkPlans\DailyPlan-YYYY-MM-DD\DailyPlan-YYYY-MM-DD.md`.
   Generate one anytime with your `planday` workflow. Edits to the file show up
   in the overlay within a moment (live file watching). **You can now add, edit,
   check off, and delete plan tasks right from the overlay — every change is
   written straight back into the markdown file**, so the `.md` stays the single
   source of truth (line endings preserved, numbered priorities auto-renumbered).
   New tasks added with the box land in the **Do Now** section. Editing a plan
   task opens its raw markdown so embedded PR / work-item links survive. **Drag a
   task onto another section** (or to a new spot within one) to move it — that
   reorder is written back into the `.md` too.
2. **In-app tasks** — if no plan file exists yet, anything you add with the
   `+ Add a task…` box is stored locally in Electron's `userData` folder
   (`tasks.json`) until you generate a plan.

## 🎵 Music

- The default track is a built-in generated lofi loop — no files needed.
- Drop real tracks into `music/` (see `music/README.txt`) and use ⏭ to cycle.
- **YouTube lofi**: tap a preset station chip (Lofi Girl, Chillhop, …) or paste any
  YouTube link into the box and hit **+** to add it. ⏭ cycles through every source —
  generator, local files, and YouTube stations alike.
- Volume is shared across the generator, your files, and YouTube and is remembered.

> **About YouTube:** streams play through YouTube's *official* embedded IFrame
> player — nothing is downloaded or ripped, and creators keep their views/revenue.
> The renderer is served from a local `http://127.0.0.1` origin (not `file://`)
> because YouTube blocks embedded playback from `file://` origins. A few preset
> livestream IDs rotate over time; if one stops, just paste a fresh link.

> Note: the app intentionally ships **no copyrighted audio**. The "bundled"
> sound is synthesized at runtime with the Web Audio API.

## 🛠️ Project layout

```
main.js            Electron main process: overlay window, tray, file watch, IPC
preload.js         Secure bridge exposing window.overlay to the renderer
src/
  index.html       Overlay markup
  styles.css       Retro pixel-glass theme
  renderer.js      UI orchestration + schedule focus + links + click-through
  planParser.js    DailyPlan markdown -> tasks + links + time-blocked schedule
  planWriter.js    Writes task add/edit/delete/done/move back into the DailyPlan .md
  taskStore.js     Merge plan + local tasks, persist completion
  pomodoro.js      Work/break cycle timer
  audio.js         Procedural lofi generator + music-folder player
  animals.js       Single focus-card pixel pal (window.FocusPal)
  winAppBar.js     Windows AppBar reservation via SHAppBarMessage (koffi)
assets/icon.png    Tray / app icon (generated by gen-icon.js)
music/             Drop-in audio folder
```

## 🔧 Customize

- **Overlay width / pomodoro lengths / volume** are stored in `settings.json` in
  Electron's `userData` directory and can be tuned there.
- **Animals**: edit the sprite grids in `src/animals.js` (each character maps to
  a colour; rows auto-pad so tweaking is forgiving).
- **Regenerate the icon**: `node gen-icon.js`.

Made for focused, cozy work days. 🐾☁️
