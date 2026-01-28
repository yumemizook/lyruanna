const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const iconv = require('iconv-lite');
const crypto = require('crypto');

let mainWindow;
let DB_PATH;
let FOLDERS_PATH;

function initPaths() {
    if (!DB_PATH) {
        DB_PATH = path.join(app.getPath('userData'), 'library.json');
        FOLDERS_PATH = path.join(app.getPath('userData'), 'folders.json');
        COURSES_PATH = path.join(app.getPath('userData'), 'courses.json');
    }
}

function calculateMD5(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

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
    initPaths();
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
            const md5 = calculateMD5(content);
            // Decode as Shift-JIS (most common encoding for BMS files)
            const text = iconv.decode(content, 'Shift_JIS');

            const titleMatch = text.match(/#TITLE\s+(.+)/i);
            const artistMatch = text.match(/#ARTIST\s+(.+)/i);
            const diffMatch = text.match(/#DIFFICULTY\s+(\d+)/i);
            const levelMatch = text.match(/#PLAYLEVEL\s+(\d+)/i);

            // Detect key mode
            let keyMode = '7'; // Default
            const isPMS = file.toLowerCase().endsWith('.pms');
            const playerMatch = text.match(/#PLAYER\s+(\d+)/i);
            const player = playerMatch ? parseInt(playerMatch[1]) : 1;

            const has2P = text.match(/#\d{3}2[1-9]:/);
            const has9K = isPMS || text.match(/#\d{3}1[79]:/) || text.match(/#\d{3}1[1-9]:/);

            if (isPMS) {
                keyMode = '9';
            } else if (player === 3 || has2P) {
                keyMode = has2P ? '14' : '10';
            } else {
                const has7K = text.match(/#\d{3}1[6-9]:/);
                keyMode = has7K ? '7' : '5';
            }

            const cleanStr = (s) => s ? s.replace(/\r/g, '').trim() : 'Unknown';

            songs.push({
                path: file,
                rootDir: rootDir,
                md5,
                title: titleMatch ? cleanStr(titleMatch[1]) : 'Unknown',
                artist: artistMatch ? cleanStr(artistMatch[1]) : 'Unknown',
                difficulty: diffMatch ? parseInt(diffMatch[1]) : 2,
                level: levelMatch ? parseInt(levelMatch[1]) : 0,
                keyMode: keyMode
            });
        } catch (e) {
            console.error("Error parsing", file, e);
        }
    }

    // Save to JSON DB
    await fs.writeJson(DB_PATH, songs);

    // Scan for and parse courses
    const courseFiles = await glob.glob('**/*.lr2crs', { cwd: rootDir, nocase: true, absolute: true });
    const courses = [];
    for (const cf of courseFiles) {
        try {
            const content = await fs.readFile(cf);
            const text = iconv.decode(content, 'Shift_JIS');
            // Simplified XML parsing via regex
            const courseMatches = text.matchAll(/<course>([\s\S]*?)<\/course>/gi);
            for (const cm of courseMatches) {
                const cText = cm[1];
                const title = cText.match(/<title>(.*?)<\/title>/i)?.[1].trim() || 'Unknown Course';
                const hashMatches = Array.from(cText.matchAll(/<hash>([a-f0-9]{32})<\/hash>/gi)).map(m => m[1]);
                if (hashMatches.length > 0) {
                    courses.push({ title, hashes: hashMatches });
                }
            }
        } catch (e) { console.error("Error parsing course", cf, e); }
    }
    await fs.writeJson(COURSES_PATH, courses);

    return { songs, courses };
});

// Update handle('get-library')
ipcMain.handle('get-library', async () => {
    initPaths();
    let library = { songs: [], courses: [] };
    if (await fs.pathExists(DB_PATH)) {
        library.songs = await fs.readJson(DB_PATH);
    }
    if (await fs.pathExists(COURSES_PATH)) {
        library.courses = await fs.readJson(COURSES_PATH);
    }
    return library;
});

ipcMain.handle('import-course', async (event, filePath) => {
    initPaths();
    try {
        const content = await fs.readFile(filePath);
        // Try Shift_JIS first (common for LR2)
        let text = iconv.decode(content, 'Shift_JIS');
        let courseMatches = Array.from(text.matchAll(/<course>([\s\S]*?)<\/course>/gi));

        // If no matches, try UTF-8
        if (courseMatches.length === 0) {
            text = iconv.decode(content, 'utf8');
            courseMatches = Array.from(text.matchAll(/<course>([\s\S]*?)<\/course>/gi));
        }

        let imported = [];
        for (const cm of courseMatches) {
            const cText = cm[1];
            const title = cText.match(/<title>(.*?)<\/title>/i)?.[1].trim() || 'Unknown Course';
            const hashMatches = Array.from(cText.matchAll(/<hash>([a-f0-9]{32})<\/hash>/gi)).map(m => m[1]);
            if (hashMatches.length > 0) {
                imported.push({ title, hashes: hashMatches });
            }
        }

        if (imported.length > 0) {
            let existing = [];
            if (await fs.pathExists(COURSES_PATH)) {
                existing = await fs.readJson(COURSES_PATH);
            }
            existing.push(...imported);
            await fs.writeJson(COURSES_PATH, existing);
        }
        return imported.length;
    } catch (e) { console.error("Error importing course", e); return 0; }
});

// 3. Read File (Binary)
ipcMain.handle('read-file', async (event, filePath) => {
    return await fs.readFile(filePath);
});

// 4. Resolve Path (for finding audio relative to BMS file)
ipcMain.handle('resolve-path', async (event, bmsPath, audioFilename) => {
    if (!audioFilename) return null;

    const dir = path.dirname(bmsPath);
    const audioPath = path.join(dir, audioFilename);

    // Check exact match
    if (await fs.pathExists(audioPath)) return audioPath;

    // Fuzzy extension check (common in BMS - file might have different extension)
    const base = path.basename(audioFilename, path.extname(audioFilename)).toLowerCase();

    try {
        const siblings = await fs.readdir(dir);

        for (const f of siblings) {
            const siblingBase = path.basename(f, path.extname(f)).toLowerCase();
            // Match exact base name (case-insensitive) with any audio extension
            if (siblingBase === base && /\.(wav|ogg|mp3|flac)$/i.test(f)) {
                return path.join(dir, f);
            }
        }
    } catch (e) {
        console.error('Error reading directory for audio resolution:', dir, e);
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

// 6. Get Library Folders
ipcMain.handle('get-library-folders', async () => {
    initPaths();
    if (await fs.pathExists(FOLDERS_PATH)) {
        return await fs.readJson(FOLDERS_PATH);
    }
    return [];
});

// 7. Add Library Folder
ipcMain.handle('add-library-folder', async () => {
    initPaths();
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (result.canceled) return null;

    const folder = result.filePaths[0];
    let folders = [];
    if (await fs.pathExists(FOLDERS_PATH)) {
        folders = await fs.readJson(FOLDERS_PATH);
    }

    if (!folders.includes(folder)) {
        folders.push(folder);
        await fs.writeJson(FOLDERS_PATH, folders);
    }

    return folder;
});

// 8. Remove Library Folder
ipcMain.handle('remove-library-folder', async (event, folder) => {
    initPaths();
    let folders = [];
    if (await fs.pathExists(FOLDERS_PATH)) {
        folders = await fs.readJson(FOLDERS_PATH);
    }
    folders = folders.filter(f => f !== folder);
    await fs.writeJson(FOLDERS_PATH, folders);
    return folders;
});

// 9. Rescan All Folders (with progress)
ipcMain.handle('rescan-all-folders', async () => {
    initPaths();
    let folders = [];
    if (await fs.pathExists(FOLDERS_PATH)) {
        folders = await fs.readJson(FOLDERS_PATH);
    }

    if (folders.length === 0) {
        await fs.writeJson(DB_PATH, []);
        return [];
    }

    // Collect all files first
    let allFiles = [];
    for (const folder of folders) {
        try {
            const files = await glob.glob('**/*.+(bms|bme|bml|pms)', { cwd: folder, nocase: true, absolute: true });
            files.forEach(f => allFiles.push({ file: f, rootDir: folder }));
        } catch (e) {
            console.error("Error scanning folder", folder, e);
        }
    }

    const totalFiles = allFiles.length;
    const songs = [];

    // Send initial progress
    mainWindow.webContents.send('scan-progress', { current: 0, total: totalFiles, status: 'Starting scan...' });

    let lastProgressTime = 0;
    // Parse each file
    for (let i = 0; i < allFiles.length; i++) {
        if (mainWindow.isDestroyed()) break;
        const { file, rootDir } = allFiles[i];
        try {
            const content = await fs.readFile(file);
            const md5 = calculateMD5(content);
            const text = iconv.decode(content, 'Shift_JIS');

            const titleMatch = text.match(/#TITLE\s+(.+)/i);
            const artistMatch = text.match(/#ARTIST\s+(.+)/i);
            const diffMatch = text.match(/#DIFFICULTY\s+(\d+)/i);
            const levelMatch = text.match(/#PLAYLEVEL\s+(\d+)/i);

            // Detect key mode
            let keyMode = '7'; // Default
            const isPMS = file.toLowerCase().endsWith('.pms');
            const playerMatch = text.match(/#PLAYER\s+(\d+)/i);
            const player = playerMatch ? parseInt(playerMatch[1]) : 1;

            const has2P = text.match(/#\d{3}2[1-9]:/);
            const has9K = isPMS || text.match(/#\d{3}1[79]:/) || text.match(/#\d{3}1[1-9]:/);

            if (isPMS) {
                keyMode = '9';
            } else if (player === 3 || has2P) {
                keyMode = has2P ? '14' : '10';
            } else {
                const has7K = text.match(/#\d{3}1[6-9]:/);
                keyMode = has7K ? '7' : '5';
            }

            const cleanStr = (s) => s ? s.replace(/\r/g, '').trim() : 'Unknown';

            songs.push({
                path: file,
                rootDir: rootDir,
                md5,
                title: titleMatch ? cleanStr(titleMatch[1]) : 'Unknown',
                artist: artistMatch ? cleanStr(artistMatch[1]) : 'Unknown',
                difficulty: diffMatch ? parseInt(diffMatch[1]) : 2,
                level: levelMatch ? parseInt(levelMatch[1]) : 0,
                keyMode: keyMode
            });
        } catch (e) {
            console.error("Error parsing", file, e);
        }

        // Send progress update (throttle to every 50ms)
        const now = Date.now();
        if (now - lastProgressTime > 50) {
            if (!mainWindow.isDestroyed()) {
                mainWindow.webContents.send('scan-progress', {
                    current: i + 1,
                    total: totalFiles,
                    status: `Loading chart ${i + 1} of ${totalFiles}...`
                });
            }
            lastProgressTime = now;
        }
    }

    // Send completion
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', { current: totalFiles, total: totalFiles, status: 'Complete!' });
    }

    // Scan for and parse courses
    const courses = [];
    for (const folder of folders) {
        const courseFiles = await glob.glob('**/*.lr2crs', { cwd: folder, nocase: true, absolute: true });
        for (const cf of courseFiles) {
            try {
                const content = await fs.readFile(cf);
                const text = iconv.decode(content, 'Shift_JIS');
                const courseMatches = text.matchAll(/<course>([\s\S]*?)<\/course>/gi);
                for (const cm of courseMatches) {
                    const cText = cm[1];
                    const title = cText.match(/<title>(.*?)<\/title>/i)?.[1].trim() || 'Unknown Course';
                    const hashMatches = Array.from(cText.matchAll(/<hash>([a-f0-9]{32})<\/hash>/gi)).map(m => m[1]);
                    if (hashMatches.length > 0) {
                        courses.push({ title, hashes: hashMatches });
                    }
                }
            } catch (e) { console.error("Error parsing course", cf, e); }
        }
    }
    await fs.writeJson(COURSES_PATH, courses);

    // Save and return
    await fs.writeJson(DB_PATH, songs);
    return { songs, courses };
});

// 10. Open Course Dialog
ipcMain.handle('open-course-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'LR2 Course File', extensions: ['lr2crs'] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
});

app.whenReady().then(createWindow);
