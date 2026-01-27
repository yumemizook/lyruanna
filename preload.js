const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanLibrary: () => ipcRenderer.invoke('scan-library'),
    getLibrary: () => ipcRenderer.invoke('get-library'),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    resolvePath: (base, file) => ipcRenderer.invoke('resolve-path', base, file),
    resolveImage: (base, file) => ipcRenderer.invoke('resolve-image', base, file),
    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close')
});
