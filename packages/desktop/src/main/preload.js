const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openmuncher', {
  munch: (mascotName) => ipcRenderer.send('munch-clicked', mascotName),
  dismiss: () => ipcRenderer.send('overlay-dismiss'),
  onMunchFired: (cb) => ipcRenderer.on('munch-fired', (_e, name) => cb(name)),
});
