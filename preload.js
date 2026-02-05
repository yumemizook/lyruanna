const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanLibrary: () => ipcRenderer.invoke('scan-library'),
    getLibrary: () => ipcRenderer.invoke('get-library'),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    resolvePath: (base, file) => ipcRenderer.invoke('resolve-path', base, file),
    resolveImage: (base, file, type) => ipcRenderer.invoke('resolve-image', base, file, type),
    // Folder management
    getLibraryFolders: () => ipcRenderer.invoke('get-library-folders'),
    addLibraryFolder: () => ipcRenderer.invoke('add-library-folder'),
    removeLibraryFolder: (folder) => ipcRenderer.invoke('remove-library-folder', folder),
    rescanAllFolders: () => ipcRenderer.invoke('rescan-all-folders'),
    onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
    importCourse: (path) => ipcRenderer.invoke('import-course', path),
    openCourseDialog: () => ipcRenderer.invoke('open-course-dialog'),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // Window controls
    closeWindow: () => ipcRenderer.send('window-close'),
    setWindowTitle: (title) => ipcRenderer.send('window-set-title', title),
    setFullscreen: (flag) => ipcRenderer.send('window-set-fullscreen', flag),
    setResolution: (width, height) => ipcRenderer.send('window-set-resolution', width, height),
    getWindowSettings: () => ipcRenderer.invoke('get-window-settings'),
    getStreamUrl: () => ipcRenderer.invoke('get-stream-url'),
    writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
    getAppPath: (type) => ipcRenderer.invoke('get-app-path', type),
    readUserData: (filename) => ipcRenderer.invoke('read-user-data', filename),
    writeUserData: (filename, data) => ipcRenderer.invoke('write-user-data', filename, data),
    // Tachi IR Integration
    submitTachiScore: (payload, apiKey) => ipcRenderer.invoke('tachi-submit-score', payload, apiKey),
    getTachiPlayerStats: (apiKey, playtype) => ipcRenderer.invoke('tachi-get-player-stats', apiKey, playtype),
    getTachiUserProfile: (apiKey, userId) => ipcRenderer.invoke('tachi-get-user-profile', apiKey, userId),
    getTachiUserPfp: (apiKey, userId) => ipcRenderer.invoke('tachi-get-user-pfp', apiKey, userId),
    getTachiUserBanner: (apiKey, userId) => ipcRenderer.invoke('tachi-get-user-banner', apiKey, userId),
    uploadTachiPfp: (apiKey, userId, imageBuffer, mimeType) => ipcRenderer.invoke('tachi-upload-pfp', apiKey, userId, imageBuffer, mimeType),
    deleteTachiPfp: (apiKey, userId) => ipcRenderer.invoke('tachi-delete-pfp', apiKey, userId),
    uploadTachiBanner: (apiKey, userId, imageBuffer, mimeType) => ipcRenderer.invoke('tachi-upload-banner', apiKey, userId, imageBuffer, mimeType),
    deleteTachiBanner: (apiKey, userId) => ipcRenderer.invoke('tachi-delete-banner', apiKey, userId),
    openTachiAuth: () => ipcRenderer.invoke('open-tachi-auth'),
    startGame: () => ipcRenderer.send('start-game'),
    appReady: () => ipcRenderer.send('app-ready')
});
