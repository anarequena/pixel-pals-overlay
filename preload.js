const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  // Plan + tasks
  getPlan: () => ipcRenderer.invoke('plan:get'),
  onPlanUpdate: (cb) =>
    ipcRenderer.on('plan:update', (_e, data) => cb(data)),
  addTask: (title) => ipcRenderer.invoke('tasks:add', title),
  toggleTask: (id) => ipcRenderer.invoke('tasks:toggle', id),
  editTask: (id, title) => ipcRenderer.invoke('tasks:edit', id, title),
  removeTask: (id) => ipcRenderer.invoke('tasks:remove', id),
  setFocusMode: (payload) => ipcRenderer.invoke('focus:set', payload),
  openLink: (url) => ipcRenderer.invoke('link:open', url),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettingsUpdate: (cb) =>
    ipcRenderer.on('settings:update', (_e, data) => cb(data)),

  // Music
  listMusic: () => ipcRenderer.invoke('music:list'),

  // Window interactivity
  setMouseIgnore: (ignore) => ipcRenderer.send('mouse:setIgnore', ignore),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
});
