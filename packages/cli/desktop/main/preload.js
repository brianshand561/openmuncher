const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('openmuncher', {
  munch: (mascotName) => ipcRenderer.send('munch-clicked', mascotName),
  dismiss: () => ipcRenderer.send('overlay-dismiss'),
  onMunchResult: (cb) => ipcRenderer.on('munch-result', (_e, payload) => cb(payload)),
  copy: (text) => clipboard.writeText(text),
  burnInAi: () => ipcRenderer.send('burn-in-ai'),
  onBurnResult: (cb) => ipcRenderer.on('burn-result', (_e, payload) => cb(payload)),
  getTargetApp: () => ipcRenderer.invoke('get-target-app'),
  setTargetApp: (name) => ipcRenderer.send('set-target-app', name),
  detectTargets: () => ipcRenderer.invoke('detect-targets'),
  readCliConfig: () => ipcRenderer.invoke('read-cli-config'),
});
