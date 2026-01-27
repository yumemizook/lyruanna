const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const iconv = require('iconv-lite');

let mainWindow;
const DB_PATH = path.join(app.getPath('userData'), 'library.json');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        backgroundColor: '#121212',
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
}

// --- IPC HANDLERS ---

// Window Controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.on('window-close', () => mainWindow.close());

// 1. Scan Library
ipcMain.handle('scan-library', async () => {
    // Open folder dialog
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (result.canceled) return [];

    const rootDir = result.filePaths[0];
    // Find all BMS files recursively
    const files = await glob.glob('**/*.+(bms|bme|bml|pms)', { cwd: rootDir, nocase: true, absolute: true });

    const songs = [];

    // Parse Headers for Metadata
    for (const file of files) {
        try {
            const content = await fs.readFile(file);
            // Decode as Shift-JIS (most common encoding for BMS files)
            const text = iconv.decode(content, 'Shift_JIS');

            const titleMatch = text.match(/#TITLE\s+(.+)/i);
            const artistMatch = text.match(/#ARTIST\s+(.+)/i);

            // Clean up extracted values (remove \r and trim)
            const cleanStr = (s) => s ? s.replace(/\r/g, '').trim() : 'Unknown';

            songs.push({
                path: file,
                title: titleMatch ? cleanStr(titleMatch[1]) : 'Unknown',
                artist: artistMatch ? cleanStr(artistMatch[1]) : 'Unknown'
            });
        } catch (e) {
            console.error("Error parsing", file, e);
        }
    }

    // Save to JSON DB
    await fs.writeJson(DB_PATH, songs);
    return songs;
});

// 2. Get Library (On Launch)
ipcMain.handle('get-library', async () => {
    if (await fs.pathExists(DB_PATH)) {
        return await fs.readJson(DB_PATH);
    }
    return [];
});

// 3. Read File (Binary)
ipcMain.handle('read-file', async (event, filePath) => {
    return await fs.readFile(filePath);
});

// 4. Resolve Path (for finding audio relative to BMS file)
ipcMain.handle('resolve-path', async (event, bmsPath, audioFilename) => {
    const dir = path.dirname(bmsPath);
    const audioPath = path.join(dir, audioFilename);

    // Check exact match
    if (await fs.pathExists(audioPath)) return audioPath;

    // Fuzzy extension check (common in BMS)
    const base = path.basename(audioFilename, path.extname(audioFilename));
    const siblings = await fs.readdir(dir);

    for (const f of siblings) {
        if (f.toLowerCase().startsWith(base.toLowerCase() + '.')) {
            return path.join(dir, f);
        }
    }
    return null;
});

// 5. Resolve Image/Video (returns base64 data URL)
ipcMain.handle('resolve-image', async (event, bmsPath, filename) => {
    if (!filename) return null;

    const dir = path.dirname(bmsPath);
    let filePath = path.join(dir, filename);

    // Check exact match
    if (!await fs.pathExists(filePath)) {
        // Fuzzy extension check
        const base = path.basename(filename, path.extname(filename));
        const siblings = await fs.readdir(dir);
        const match = siblings.find(f => f.toLowerCase().startsWith(base.toLowerCase() + '.'));
        if (match) {
            filePath = path.join(dir, match);
        } else {
            return null;
        }
    }

    try {
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();

        // Determine MIME type
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.bmp': 'image/bmp',
            '.gif': 'image/gif',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.avi': 'video/x-msvideo',
            '.wmv': 'video/x-ms-wmv',
            '.mpg': 'video/mpeg',
            '.mpeg': 'video/mpeg'
        };

        const mime = mimeTypes[ext] || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return `data:${mime};base64,${base64}`;
    } catch (e) {
        console.error('Error loading image:', filePath, e);
        return null;
    }
});

app.whenReady().then(createWindow);
