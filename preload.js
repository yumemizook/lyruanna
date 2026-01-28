const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanLibrary: () => ipcRenderer.invoke('scan-library'),
    getLibrary: () => ipcRenderer.invoke('get-library'),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    resolvePath: (base, file) => ipcRenderer.invoke('resolve-path', base, file),
    resolveImage: (base, file) => ipcRenderer.invoke('resolve-image', base, file),
    // Folder management
    getLibraryFolders: () => ipcRenderer.invoke('get-library-folders'),
    addLibraryFolder: () => ipcRenderer.invoke('add-library-folder'),
    removeLibraryFolder: (folder) => ipcRenderer.invoke('remove-library-folder', folder),
    rescanAllFolders: () => ipcRenderer.invoke('rescan-all-folders'),
    onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
    importCourse: (path) => ipcRenderer.invoke('import-course', path),
    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close')
});
