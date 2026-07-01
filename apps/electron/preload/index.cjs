const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentDesktop', {
  getBackendConnection: () => ipcRenderer.invoke('backend:get-connection'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  openFileDialog: (options) => ipcRenderer.invoke('dialog:open-file', options),
  showNotification: (options) => ipcRenderer.invoke('notification:show', options),
  onBackendStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('backend:status', listener);
    return () => ipcRenderer.removeListener('backend:status', listener);
  }
});
