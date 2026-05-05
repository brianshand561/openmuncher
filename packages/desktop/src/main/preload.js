const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('openmuncher', {
  munch: (mascotName) => ipcRenderer.send('munch-clicked', mascotName),
  dismiss: () => ipcRenderer.send('overlay-dismiss'),
  onMunchResult: (cb) => ipcRenderer.on('munch-result', (_e, payload) => cb(payload)),
  copy: (text) => clipboard.writeText(text),
});
