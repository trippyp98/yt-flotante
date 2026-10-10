const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytf', {
  open: (text) => ipcRenderer.invoke('open', text),
  closeVideo: () => ipcRenderer.send('close-video'),
  hide: () => ipcRenderer.send('hide'),
  toggleAuto: () => ipcRenderer.send('toggle-auto'),
  cycleHover: () => ipcRenderer.send('cycle-hover'),
  opacity: (delta) => ipcRenderer.send('opacity', delta),
  pasteOpen: () => ipcRenderer.send('paste-open'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
});
