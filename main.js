const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  shell,
  globalShortcut,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const planParser = require('./src/planParser');
const planWriter = require('./src/planWriter');
const taskStore = require('./src/taskStore');
const appbar = require('./src/winAppBar');

let win = null;
let tray = null;
let planWatcher = null;
let currentPlanFile = null;
let currentParsed = null;
let localServer = null;
let baseUrl = null;

const DAILY_PLANS_DIR = path.join(
  app.getPath('home'),
  'OneDrive - Microsoft',
  'Documents',
  'DailyWorkPlans'
);

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  width: 360,
  clickThrough: false,
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  volume: 0.5,
  focus: { mode: 'auto' },
  collapsed: false,
  reserveSpace: true,
  ytStations: [],
  startWithWindows: false,
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

let settings = DEFAULT_SETTINGS;

function getOverlayBounds() {
  const display = screen.getPrimaryDisplay();
  // Use the FULL monitor bounds for the right edge so the window sits on the
  // strip the AppBar reserves. (workArea shrinks once we reserve space, so it
  // can't be used to compute our own x.) Use workArea only for the vertical
  // extent so we don't cover a top/bottom taskbar.
  const b = display.bounds;
  const wa = display.workArea;
  const w = Math.min(settings.width, b.width);
  return {
    x: b.x + b.width - w,
    y: wa.y,
    width: w,
    height: wa.height,
  };
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // Fallback 1x1 transparent so Tray still constructs.
    image = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
  }
  return image;
}

function createWindow() {
  const bounds = getOverlayBounds();
  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${baseUrl}/index.html`);

  applyClickThrough(settings.clickThrough);

  win.webContents.once('did-finish-load', () => {
    applyAppBar();
    if (process.argv.includes('--diag')) {
      const b = win.getBounds();
      console.log(`[diag] window bounds x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  // Auto-recover a crashed/unresponsive renderer so the overlay never gets
  // stuck as a blank, un-showable window (the single-instance shortcut can
  // only re-show an existing window, not rebuild a dead one).
  let lastRecover = 0;
  let recoverCount = 0;
  const recoverRenderer = (why) => {
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    if (now - lastRecover > 60000) recoverCount = 0; // reset window every minute
    if (recoverCount >= 3) {
      console.log('[recover] giving up after repeated renderer failures:', why);
      return;
    }
    lastRecover = now;
    recoverCount += 1;
    console.log(`[recover] reloading renderer (${why}), attempt ${recoverCount}`);
    try {
      win.webContents.reload();
    } catch (e) {
      console.log('[recover] reload failed', e && e.message);
    }
  };

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details && (details.reason === 'clean-exit' || details.reason === 'killed')) return;
    recoverRenderer('render-process-gone:' + (details && details.reason));
  });
  win.on('unresponsive', () => recoverRenderer('unresponsive'));

  if (process.argv.includes('--diag')) {
    win.webContents.on('did-finish-load', () =>
      console.log('[diag] renderer loaded OK')
    );
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log('[renderer:error]', message);
    });
    win.webContents.on('render-process-gone', (_e, details) =>
      console.log('[diag] render-process-gone', JSON.stringify(details))
    );
    win.webContents.on('did-fail-load', (_e, code, desc) =>
      console.log('[diag] did-fail-load', code, desc)
    );
  }

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function applyClickThrough(enabled) {
  if (!win) return;
  // forward:true lets the renderer still receive mouse-move so hovered panels
  // can re-enable interactivity via setIgnoreMouseEvents(false).
  win.setIgnoreMouseEvents(enabled, { forward: true });
}

function repositionWindow() {
  if (!win) return;
  win.setBounds(getOverlayBounds());
  applyAppBar();
}

// Compute the right-edge strip in PHYSICAL pixels for the AppBar reservation.
function getAppBarRectPhysical() {
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const b = display.bounds; // full monitor bounds in DIP
  const w = Math.min(settings.width, b.width);
  return {
    left: Math.round((b.x + b.width - w) * sf),
    top: Math.round(b.y * sf),
    right: Math.round((b.x + b.width) * sf),
    bottom: Math.round((b.y + b.height) * sf),
  };
}

function applyAppBar() {
  if (!win) return;
  if (settings.reserveSpace) {
    const rc = getAppBarRectPhysical();
    if (appbar.isRegistered()) appbar.update(rc);
    else appbar.register(win.getNativeWindowHandle(), rc);
  } else if (appbar.isRegistered()) {
    appbar.remove();
  }
}

function setReserveSpace(enabled) {
  settings.reserveSpace = enabled;
  saveSettings(settings);
  applyAppBar();
  refreshTrayMenu();
  if (win) win.webContents.send('settings:update', settings);
}

// ---------------- Plan loading + watching ----------------

function findLatestPlanFile() {
  try {
    const entries = fs.readdirSync(DAILY_PLANS_DIR, { withFileTypes: true });
    const candidates = [];
    for (const e of entries) {
      if (e.isDirectory() && /^DailyPlan-\d{4}-\d{2}-\d{2}$/.test(e.name)) {
        const md = path.join(DAILY_PLANS_DIR, e.name, `${e.name}.md`);
        if (fs.existsSync(md)) candidates.push({ name: e.name, file: md });
      }
    }
    candidates.sort((a, b) => (a.name < b.name ? 1 : -1));
    return candidates.length ? candidates[0].file : null;
  } catch {
    return null;
  }
}

function loadPlan() {
  const file = findLatestPlanFile();
  let parsed = { date: null, priorities: [], doNow: [], doLater: [], defer: [], schedule: [] };
  if (file) {
    try {
      const md = fs.readFileSync(file, 'utf8');
      parsed = planParser.parse(md);
    } catch (err) {
      console.error('Failed to parse plan:', err);
    }
  }
  currentPlanFile = file;
  currentParsed = parsed;
  return taskStore.merge(parsed, file);
}

// Find a plan task (by id) in the most recently parsed plan, returning the
// info planWriter needs (its line + raw bullet content) plus its group.
function findPlanTask(id) {
  if (!currentParsed) return null;
  for (const key of ['priorities', 'doNow', 'doLater', 'defer']) {
    const t = (currentParsed[key] || []).find((x) => x.id === id);
    if (t) return { task: t, group: key };
  }
  return null;
}

function pushPlan() {
  if (!win) return;
  const data = loadPlan();
  win.webContents.send('plan:update', data);
}

function watchPlan() {
  if (planWatcher) {
    planWatcher.close();
    planWatcher = null;
  }
  if (!fs.existsSync(DAILY_PLANS_DIR)) return;
  try {
    let debounce = null;
    // Watch the whole DailyWorkPlans tree (recursive) so a brand-new day's
    // folder — e.g. DailyPlan-2026-06-22 created while the app is running — is
    // detected automatically, not just edits to the folder that was newest at
    // launch. loadPlan() always re-selects the latest day, so a new folder
    // transparently becomes the active plan.
    planWatcher = fs.watch(
      DAILY_PLANS_DIR,
      { recursive: true },
      (_eventType, filename) => {
        const name = filename ? filename.toString() : '';
        if (name.endsWith('.md')) {
          clearTimeout(debounce);
          debounce = setTimeout(() => pushPlan(), 400);
        }
      }
    );
  } catch (err) {
    console.error('Failed to watch plan dir:', err);
  }
}

// ---------------- Tray ----------------

function buildTray() {
  tray = new Tray(createTrayIcon());
  refreshTrayMenu();
  tray.setToolTip('Pixel Pals Overlay');
  tray.on('click', () => toggleVisible());
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? 'Hide overlay' : 'Show overlay',
      click: () => toggleVisible(),
    },
    {
      label: 'Click-through',
      type: 'checkbox',
      checked: settings.clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: 'Reserve screen space (dock)',
      type: 'checkbox',
      checked: settings.reserveSpace,
      click: (item) => setReserveSpace(item.checked),
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.startWithWindows,
      click: (item) => setStartWithWindows(item.checked),
    },
    { label: 'Reload plan', click: () => pushPlan() },
    { type: 'separator' },
    {
      label: 'Open DailyWorkPlans folder',
      click: () => shell.openPath(DAILY_PLANS_DIR),
    },
    {
      label: 'Open music folder',
      click: () => shell.openPath(path.join(__dirname, 'music')),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.show();
  refreshTrayMenu();
}

function setClickThrough(enabled) {
  settings.clickThrough = enabled;
  applyClickThrough(enabled);
  saveSettings(settings);
  refreshTrayMenu();
  if (win) win.webContents.send('settings:update', settings);
}

// Register/unregister the app to launch automatically when the user signs in.
// In dev (unpackaged) we point the login item at electron.exe + the app folder;
// when packaged, Electron defaults to the built exe.
function applyLoginItem(enabled) {
  try {
    const opts = { openAtLogin: !!enabled };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [path.resolve(__dirname)];
    }
    app.setLoginItemSettings(opts);
  } catch (e) {
    console.error('Failed to set login item:', e.message);
  }
}

function setStartWithWindows(enabled) {
  settings.startWithWindows = enabled;
  applyLoginItem(enabled);
  saveSettings(settings);
  refreshTrayMenu();
}

// ---------------- IPC ----------------

function registerIpc() {
  ipcMain.handle('plan:get', () => loadPlan());
  ipcMain.handle('plan:reload', () => {
    // Re-arm the watcher in case the plans directory was created after launch,
    // then return the freshly loaded latest plan.
    watchPlan();
    return loadPlan();
  });
  ipcMain.handle('settings:get', () => settings);

  ipcMain.handle('settings:set', (_e, patch) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    if (typeof patch.width === 'number') repositionWindow();
    if (typeof patch.clickThrough === 'boolean') {
      applyClickThrough(settings.clickThrough);
      refreshTrayMenu();
    }
    if (typeof patch.reserveSpace === 'boolean') {
      applyAppBar();
      refreshTrayMenu();
    }
    return settings;
  });

  // Task mutations. When a plan (.md) file is loaded, these write straight back
  // into the markdown so the file stays the source of truth. Tasks that aren't
  // in the plan (ad-hoc "My tasks", or any task when no plan file exists) fall
  // back to the local JSON store.
  ipcMain.handle('tasks:add', (_e, title) => {
    const text = String(title || '').trim();
    if (!text) return loadPlan();
    if (currentPlanFile) {
      try {
        planWriter.addBullet(currentPlanFile, 'doNow', text, planParser.classifyHeading);
        return loadPlan();
      } catch (err) {
        console.error('Failed to add task to plan:', err);
      }
    }
    return taskStore.addLocal(text);
  });

  ipcMain.handle('tasks:toggle', (_e, id) => {
    const hit = findPlanTask(id);
    if (hit && currentPlanFile) {
      try {
        planWriter.setDone(currentPlanFile, hit.task.line, hit.task.raw, !hit.task.done);
        return loadPlan();
      } catch (err) {
        console.error('Failed to toggle plan task:', err);
      }
    }
    return taskStore.toggleComplete(id);
  });

  ipcMain.handle('tasks:edit', (_e, id, title) => {
    const text = String(title || '').trim();
    const hit = findPlanTask(id);
    if (hit && currentPlanFile && text) {
      try {
        planWriter.editBullet(currentPlanFile, hit.task.line, hit.task.raw, text);
        return loadPlan();
      } catch (err) {
        console.error('Failed to edit plan task:', err);
      }
    }
    return taskStore.editLocal(id, title);
  });

  ipcMain.handle('tasks:remove', (_e, id) => {
    const hit = findPlanTask(id);
    if (hit && currentPlanFile) {
      try {
        planWriter.removeBullet(currentPlanFile, hit.task.line, hit.task.raw);
        return loadPlan();
      } catch (err) {
        console.error('Failed to remove plan task:', err);
      }
    }
    return taskStore.removeLocal(id);
  });

  // Move a plan task to another section (or reorder within one) by rewriting the
  // markdown. Only plan-backed tasks participate; an optional beforeId places the
  // moved item directly above that task in the destination section.
  ipcMain.handle('tasks:move', (_e, id, targetGroup, beforeId) => {
    const valid = ['priorities', 'doNow', 'doLater', 'defer'];
    const hit = findPlanTask(id);
    if (hit && currentPlanFile && valid.includes(targetGroup)) {
      const before = beforeId ? findPlanTask(beforeId) : null;
      try {
        planWriter.moveBullet(
          currentPlanFile,
          hit.task,
          targetGroup,
          planParser.classifyHeading,
          before ? before.task : null
        );
        return loadPlan();
      } catch (err) {
        console.error('Failed to move plan task:', err);
      }
    }
    return loadPlan();
  });
  ipcMain.handle('focus:set', (_e, payload) => {
    settings.focus = payload && typeof payload === 'object' ? payload : { mode: 'auto' };
    saveSettings(settings);
    if (win) win.webContents.send('settings:update', settings);
    return settings;
  });

  ipcMain.handle('link:open', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Allow the renderer to enable/disable click-through dynamically when the
  // cursor enters/leaves an interactive panel (only while global click-through
  // mode is on).
  ipcMain.on('mouse:setIgnore', (_e, ignore) => {
    if (!win) return;
    if (settings.clickThrough) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('overlay:hide', () => {
    if (win) win.hide();
    refreshTrayMenu();
  });

  ipcMain.handle('music:list', () => {
    const dir = path.join(__dirname, 'music');
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f))
        .map((f) => ({ name: f, url: `${baseUrl}/music/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

function pathToFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
}

// Serve the renderer (src/) and the music/ folder from a loopback HTTP origin.
// A real http://127.0.0.1 origin is required for the embedded YouTube IFrame
// player: YouTube rejects file:// origins with playback error 153.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

function startLocalServer() {
  const srcDir = path.join(__dirname, 'src');
  const musicDir = path.join(__dirname, 'music');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

        let root = srcDir;
        let rel = urlPath;
        if (urlPath.startsWith('/music/')) {
          root = musicDir;
          rel = urlPath.slice('/music/'.length);
        } else {
          rel = urlPath.replace(/^\/+/, '');
        }

        const filePath = path.normalize(path.join(root, rel));
        if (!filePath.startsWith(root)) {
          res.writeHead(403);
          return res.end('Forbidden');
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            return res.end('Not found');
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
          });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end('Server error');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      localServer = server;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve(baseUrl);
    });
  });
}

// ---------------- App lifecycle ----------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
    }
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    taskStore.init(app.getPath('userData'));
    try {
      await startLocalServer();
    } catch (e) {
      console.error('Local server failed to start:', e.message);
    }
    registerIpc();
    createWindow();
    buildTray();
    watchPlan();
    applyLoginItem(settings.startWithWindows);

    globalShortcut.register('CommandOrControl+Alt+P', () => {
      setClickThrough(!settings.clickThrough);
    });
    globalShortcut.register('CommandOrControl+Alt+O', () => toggleVisible());

    screen.on('display-metrics-changed', repositionWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Keep running in tray on Windows.
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (planWatcher) planWatcher.close();
    if (localServer) { try { localServer.close(); } catch {} }
    appbar.remove();
  });
}
