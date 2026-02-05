const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const iconv = require('iconv-lite');
const crypto = require('crypto');
const url = require('url');
const http = require('http');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg path
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

// Difficulty Inference Helper
const inferDifficulty = (title, filename) => {
    const t = (title || '').toLowerCase();
    const f = (filename || '').toLowerCase();
    if (f.endsWith('_b') || t.includes('beginner')) return 1;
    if (f.endsWith('_n') || t.includes('normal') || t.includes('light')) return 2;
    if (f.endsWith('_h') || t.includes('hyper')) return 3;
    if (f.endsWith('_l') || t.includes('leggendaria') || t.includes('insane') || t.includes('black another')) return 5;
    if (f.endsWith('_a') || t.includes('another')) return 4;
    return 0; // Unknown fallback
};

// Global Streaming Server
let streamServer;
let streamPort = 0;

function startStreamServer() {
    streamServer = http.createServer((req, res) => {
        const u = url.parse(req.url, true);
        if (u.pathname === '/video') {
            const filePath = u.query.path;
            if (!filePath) {
                res.statusCode = 400;
                res.end('Missing path');
                return;
            }

            console.log(`[Stream] Request for: ${filePath}`);

            // Validate path exists
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.end('File not found');
                return;
            }

            // MJPEG Header
            res.writeHead(200, {
                'Content-Type': 'multipart/x-mixed-replace; boundary=--ffmpeg',
                'Cache-Control': 'no-cache',
                'Connection': 'close',
                'Pragma': 'no-cache'
            });

            const command = ffmpeg(filePath)
                .inputOptions([
                    '-hwaccel', 'auto',        // Use hardware acceleration if available
                    '-re'                      // Read at native framerate
                ])
                .outputOptions([
                    '-f', 'mjpeg',             // Output format MJPEG
                    '-q:v', '15',              // Lower quality (15) for better performance as BG
                    '-vf', 'scale=480:-1',     // Further downscale (480p) for legacy content
                    '-r', '15',                // Limit framerate to 15fps as background is enough
                    '-threads', '2',           // Limit threads
                    '-tune', 'zerolatency'     // Optimize for streaming latency
                ])
                // Pipe to response
                .on('start', (cmd) => console.log('[FFmpeg] Started:', cmd))
                .on('error', (err) => {
                    console.error('[FFmpeg] Error:', err.message);
                    if (!res.writableEnded) res.end();
                })
                .on('end', () => {
                    console.log('[FFmpeg] Finished');
                    if (!res.writableEnded) res.end();
                });

            // Pipe stream to response
            const stream = command.pipe();
            stream.on('data', (chunk) => {
                res.write('--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-Length: ' + chunk.length + '\r\n\r\n');
                res.write(chunk);
                res.write('\r\n');
            });

            // Clean up on disconnect
            res.on('close', () => {
                console.log('[Stream] Client disconnected');
                command.kill('SIGKILL');
            });
        } else {
            res.statusCode = 404;
            res.end();
        }
    });

    streamServer.listen(0, '127.0.0.1', () => {
        streamPort = streamServer.address().port;
        console.log(`[Stream] Server listening on port ${streamPort}`);
    });
}


let mainWindow;
let DB_PATH;
let FOLDERS_PATH;
let COURSES_PATH;
let SETTINGS_PATH;

function initPaths() {
    if (!DB_PATH) {
        const userData = app.getPath('userData');
        DB_PATH = path.join(userData, 'library.json');
        FOLDERS_PATH = path.join(userData, 'folders.json');
        COURSES_PATH = path.join(userData, 'courses.json');
        SETTINGS_PATH = path.join(userData, 'window-settings.json');
    }
}

function calculateMD5(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

function createWindow() {
    initPaths();
    if (!streamServer) startStreamServer();

    // Default settings
    let width = 1280;
    let height = 720;
    let fullscreen = false;

    // Load saved settings
    try {
        if (fs.pathExistsSync(SETTINGS_PATH)) {
            const saved = fs.readJsonSync(SETTINGS_PATH);
            if (saved.width && saved.height) {
                width = saved.width;
                height = saved.height;
            }
            if (saved.fullscreen !== undefined) {
                fullscreen = saved.fullscreen;
            }
        }
    } catch (e) {
        console.error("Failed to load window settings", e);
    }

    // Factor in display scaling (DPI) for initial window
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor;
    const logicalWidth = Math.round(width / scaleFactor);
    const logicalHeight = Math.round(height / scaleFactor);

    let splash;

    // Create Splash Window
    splash = new BrowserWindow({
        width: 600,
        height: 400,
        backgroundColor: '#121212',
        frame: false,
        alwaysOnTop: false,
        icon: path.join(__dirname, 'icon/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    splash.loadFile('splash.html');
    splash.center();

    ipcMain.once('start-game', () => {
        mainWindow = new BrowserWindow({
            width: logicalWidth,
            height: logicalHeight,
            fullscreen: fullscreen,
            backgroundColor: '#121212',
            frame: false,
            resizable: false,
            show: false, // Don't show immediately
            icon: path.join(__dirname, 'icon/icon.png'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        mainWindow.loadFile('index.html');

        ipcMain.once('app-ready', () => {
            if (splash && !splash.isDestroyed()) {
                splash.destroy();
                splash = null;
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
            }
        });
    });
}

// --- IPC HANDLERS ---

// Window Controls
ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
    else app.quit();
});
ipcMain.on('window-set-title', (event, title) => {
    if (mainWindow) mainWindow.setTitle(title);
});
ipcMain.on('window-set-fullscreen', (event, flag) => {
    if (mainWindow) {
        mainWindow.setFullScreen(flag);
        // Save to file
        try {
            let current = { width: 1280, height: 720 };
            if (fs.pathExistsSync(SETTINGS_PATH)) current = fs.readJsonSync(SETTINGS_PATH);
            current.fullscreen = flag;
            fs.writeJsonSync(SETTINGS_PATH, current);
        } catch (e) { }
    }
});
ipcMain.on('window-set-resolution', (event, width, height) => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        mainWindow.setFullScreen(false);
        mainWindow.setResizable(true);

        // Factor in display scaling (DPI)
        const primaryDisplay = screen.getPrimaryDisplay();
        const scaleFactor = primaryDisplay.scaleFactor;
        const logicalWidth = Math.round(width / scaleFactor);
        const logicalHeight = Math.round(height / scaleFactor);

        mainWindow.setSize(logicalWidth, logicalHeight);
        mainWindow.setAspectRatio(16 / 9);
        mainWindow.setResizable(false);
        mainWindow.center();

        // Save to file
        try {
            fs.writeJsonSync(SETTINGS_PATH, { width, height, fullscreen: false });
        } catch (e) { }
    }
});

ipcMain.handle('get-window-settings', async () => {
    initPaths();
    if (await fs.pathExists(SETTINGS_PATH)) {
        return await fs.readJson(SETTINGS_PATH);
    }
    return { width: 1280, height: 720, fullscreen: false };
});

// 1. Scan Library
ipcMain.handle('scan-library', async () => {
    initPaths();
    // Open folder dialog
    const result = await dialog.showOpenDialog(mainWindow || null, {
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

            const has2PChannels = text.match(/#\d{3}2[1-9]:/); // 21-29

            if (isPMS) {
                keyMode = '9';
            } else if (player === 3 || has2PChannels) {
                const hasP1_Ext = text.match(/#\d{3}1[89]:/); // P1 6,7
                const hasP2_Left = text.match(/#\d{3}2[12]:/); // P2 1,2
                const hasP2_Right = text.match(/#\d{3}2[89]:/); // P2 6,7

                if (hasP1_Ext || (hasP2_Left && hasP2_Right)) {
                    keyMode = '14';
                } else {
                    keyMode = '10';
                }
            } else {
                const has7KSpecific = text.match(/#\d{3}1[89]:/);
                keyMode = has7KSpecific ? '7' : '5';
            }
            const cleanStr = (s) => s ? s.replace(/\r/g, '').trim() : 'Unknown';

            // Simple note count estimation for metadata
            const notesMatch = text.matchAll(/#\d{3}(1|2|5|6)[1-9]:(\w+)/g);
            let noteCount = 0;
            for (const nm of notesMatch) {
                const data = nm[2];
                for (let i = 0; i < data.length; i += 2) {
                    if (data[i] !== '0' || data[i + 1] !== '0') noteCount++;
                }
            }

            songs.push({
                path: file,
                rootDir: rootDir,
                md5,
                title: titleMatch ? cleanStr(titleMatch[1]) : 'Unknown',
                artist: artistMatch ? cleanStr(artistMatch[1]) : 'Unknown',
                difficulty: diffMatch ? parseInt(diffMatch[1]) : inferDifficulty(titleMatch ? titleMatch[1] : '', path.basename(file, path.extname(file))),
                level: levelMatch ? parseInt(levelMatch[1]) : 0,
                keyMode: keyMode,
                noteCount: noteCount
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
    const finalPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    return await fs.readFile(finalPath);
});

// 3.1 Write File (Binary or String)
ipcMain.handle('write-file', async (event, filePath, data) => {
    await fs.ensureDir(path.dirname(filePath));
    if (typeof data === 'string') {
        await fs.writeFile(filePath, data);
    } else {
        // data is likely a Uint8Array from the renderer
        if (data && data.buffer) {
            await fs.writeFile(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        } else {
            await fs.writeFile(filePath, data);
        }
    }
    return true;
});

ipcMain.handle('get-app-path', async (event, type) => {
    return app.getPath(type || 'userData');
});

// Read JSON file from userData
ipcMain.handle('read-user-data', async (event, filename) => {
    initPaths();
    const userData = app.getPath('userData');
    const filePath = path.join(userData, filename);
    if (await fs.pathExists(filePath)) {
        return await fs.readJson(filePath);
    }
    return null;
});

// Write JSON file to userData
ipcMain.handle('write-user-data', async (event, filename, data) => {
    initPaths();
    const userData = app.getPath('userData');
    const filePath = path.join(userData, filename);
    await fs.writeJson(filePath, data);
    return true;
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

// 5. Resolve Image/Video (returns file:// URL)
// 5. Resolve Image/Video (returns file:// URL)
ipcMain.handle('resolve-image', async (event, bmsPath, filename, type = 'any') => {
    if (!filename) return null;

    const dir = path.dirname(bmsPath);
    const base = path.basename(filename, path.extname(filename));

    // Extensions lists
    const imgExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif'];
    const vidExts = ['.mp4', '.webm', '.avi', '.wmv', '.mpg', '.mpeg', '.m4v'];

    const getFileType = (f) => {
        const ext = path.extname(f).toLowerCase();
        if (imgExts.includes(ext)) return 'image';
        if (vidExts.includes(ext)) return 'video';
        return 'other';
    };

    let targetPath = null;

    // 1. Try exact match first
    let exactPath = path.join(dir, filename);
    if (await fs.pathExists(exactPath)) {
        // If we require a specific type, check it
        const fType = getFileType(filename);
        if (type === 'any' || type === fType) {
            targetPath = exactPath;
        }
    }

    // 2. If not found or type mismatch, try fuzzy search
    if (!targetPath) {
        try {
            const siblings = await fs.readdir(dir);
            // Find valid matches
            const validMatches = siblings.filter(f => {
                if (!f.toLowerCase().startsWith(base.toLowerCase() + '.')) return false;
                const fType = getFileType(f);
                if (type === 'image' && fType !== 'image') return false;
                if (type === 'video' && fType !== 'video') return false;
                // If type is 'any', we accept anything in our lists
                if (type === 'any' && fType === 'other') return false;
                return true;
            });

            // Prioritize: if we asked for 'any', prefer video, then image? Or just pick first?
            // Let's pick the first valid one
            if (validMatches.length > 0) {
                targetPath = path.join(dir, validMatches[0]);
            }
        } catch (e) {
            console.error('Error reading dir for fuzzy check:', e);
        }
    }

    if (targetPath) {
        const fileUrl = url.pathToFileURL(targetPath).href;
        console.log(`[resolve-image] FOUND (${type}): ${targetPath}`);
        return fileUrl;
    }

    console.log(`[resolve-image] NOT FOUND (${type}): ${filename} in ${dir}`);
    return null;
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
    const result = await dialog.showOpenDialog(mainWindow || null, {
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

// 11. Get Stream URL
ipcMain.handle('get-stream-url', async () => {
    if (!streamPort) return null;
    return `http://127.0.0.1:${streamPort}/video`;
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
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', { current: 0, total: totalFiles, status: 'Starting scan...' });
    }

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

            const has2PChannels = text.match(/#\d{3}2[1-9]:/);

            if (isPMS) {
                keyMode = '9';
            } else if (player === 3 || has2PChannels) {
                const hasP1_Ext = text.match(/#\d{3}1[89]:/); // P1 6,7
                const hasP2_Left = text.match(/#\d{3}2[12]:/); // P2 1,2
                const hasP2_Right = text.match(/#\d{3}2[89]:/); // P2 6,7

                if (hasP1_Ext || (hasP2_Left && hasP2_Right)) {
                    keyMode = '14';
                } else {
                    keyMode = '10';
                }
            } else {
                const has7KSpecific = text.match(/#\d{3}1[89]:/);
                keyMode = has7KSpecific ? '7' : '5';
            }

            const cleanStr = (s) => s ? s.replace(/\r/g, '').trim() : 'Unknown';

            // Simple note count estimation for metadata
            const notesMatch = text.matchAll(/#\d{3}(1|2|5|6)[1-9]:(\w+)/g);
            let noteCount = 0;
            for (const nm of notesMatch) {
                const data = nm[2];
                for (let i = 0; i < data.length; i += 2) {
                    if (data[i] !== '0' || data[i + 1] !== '0') noteCount++;
                }
            }

            songs.push({
                path: file,
                rootDir: rootDir,
                md5,
                title: titleMatch ? cleanStr(titleMatch[1]) : 'Unknown',
                artist: artistMatch ? cleanStr(artistMatch[1]) : 'Unknown',
                difficulty: diffMatch ? parseInt(diffMatch[1]) : inferDifficulty(titleMatch ? titleMatch[1] : '', path.basename(file, path.extname(file))),
                level: levelMatch ? parseInt(levelMatch[1]) : 0,
                keyMode: keyMode,
                noteCount: noteCount
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
    const result = await dialog.showOpenDialog(mainWindow || null, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'LR2 Course File', extensions: ['lr2crs'] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
});

// ============================================================================
// TACHI IR INTEGRATION
// ============================================================================
const axios = require('axios');
const TACHI_BASE_URL = 'https://boku.tachi.ac';
const TACHI_API_VERSION = 'v1';

// Cached user ID for Tachi
let _tachiCachedUserId = null;

// Submit score to Tachi via ir/direct-manual
ipcMain.handle('tachi-submit-score', async (event, payload, apiKey) => {
    if (!apiKey) {
        return { success: false, error: 'No API key provided' };
    }

    try {
        const response = await axios.post(
            `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/ir/direct-manual/import`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-User-Intent': 'true'
                }
            }
        );

        const data = response.data;
        console.log('[Tachi] Submit response:', data);

        if (data.success) {
            return { success: true, data: data.body };
        } else {
            return { success: false, error: data.description || 'Unknown error' };
        }
    } catch (e) {
        console.error('[Tachi] Submit error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Get player stats from Tachi
ipcMain.handle('tachi-get-player-stats', async (event, apiKey, playtype = '7K') => {
    if (!apiKey) {
        return { success: false, error: 'No API key provided' };
    }

    try {
        // Step 1: Get user ID from /status (use cache if available)
        let userId = _tachiCachedUserId;

        if (!userId) {
            const statusRes = await axios.get(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/status`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            const statusData = statusRes.data;
            console.log('[Tachi] Status response:', statusData);

            if (!statusData.success || !statusData.body.whoami) {
                return { success: false, error: 'Could not identify user. Check your API key.' };
            }
            userId = statusData.body.whoami;
            _tachiCachedUserId = userId;
        }

        // Step 2: Fetch game stats
        const statsRes = await axios.get(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/games/bms/${playtype}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        const statsData = statsRes.data;
        console.log('[Tachi] Stats response:', statsData);

        if (!statsData.success) {
            return { success: false, error: statsData.description || 'Failed to fetch stats' };
        }

        return {
            success: true,
            userId: userId,
            gameStats: statsData.body.gameStats,
            rankingData: statsData.body.rankingData
        };
    } catch (e) {
        console.error('[Tachi] Stats fetch error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Get user profile (username, pfp)
ipcMain.handle('tachi-get-user-profile', async (event, apiKey, userId) => {
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    try {
        const response = await axios.get(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = response.data;

        if (data.success) {
            return { success: true, user: data.body };
        } else {
            return { success: false, error: data.description || 'Unknown error' };
        }
    } catch (e) {
        console.error('[Tachi] Profile fetch error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Get user PFP as Data URI (handling redirects and binary data)
ipcMain.handle('tachi-get-user-pfp', async (event, apiKey, userId) => {
    if (!userId) return { success: false, error: 'No User ID' };

    try {
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/pfp`;
        const fetchHeaders = {};
        if (apiKey) fetchHeaders['Authorization'] = `Bearer ${apiKey}`;

        // Fetch image data as buffer
        const response = await axios.get(url, {
            headers: fetchHeaders,
            responseType: 'arraybuffer'
        });

        // Get content type (e.g., image/jpeg, image/png)
        const contentType = response.headers['content-type'] || 'image/png';

        // Convert to Base64 Data URI
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        return { success: true, dataUrl };

    } catch (e) {
        console.error('[Tachi] PFP fetch error:', e);
        return { success: false, error: e.message };
    }
});

// Get user Banner as Data URI
ipcMain.handle('tachi-get-user-banner', async (event, apiKey, userId) => {
    if (!userId) return { success: false, error: 'No User ID' };

    try {
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/banner`;
        const fetchHeaders = {};
        if (apiKey) fetchHeaders['Authorization'] = `Bearer ${apiKey}`;

        const response = await axios.get(url, {
            headers: fetchHeaders,
            responseType: 'arraybuffer'
        });

        const contentType = response.headers['content-type'] || 'image/png';
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        return { success: true, dataUrl };

    } catch (e) {
        // 404 means no banner set, which is not an error
        if (e.response && e.response.status === 404) {
            return { success: true, dataUrl: null };
        }
        console.error('[Tachi] Banner fetch error:', e);
        return { success: false, error: e.message };
    }
});

// Upload Avatar (multipart form data)
ipcMain.handle('tachi-upload-pfp', async (event, apiKey, userId, imageBuffer, mimeType) => {
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };
    if (!imageBuffer) return { success: false, error: 'No image data' };

    try {
        const FormData = require('form-data');
        const form = new FormData();

        // Determine file extension from mime type
        const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'jpg';
        form.append('pfp', Buffer.from(imageBuffer), {
            filename: `avatar.${ext}`,
            contentType: mimeType || 'image/jpeg'
        });

        const response = await axios.put(
            `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/pfp`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        if (response.data.success) {
            return { success: true, get: response.data.body.get };
        }
        return { success: false, error: response.data.description || 'Upload failed' };

    } catch (e) {
        console.error('[Tachi] PFP upload error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Delete Avatar
ipcMain.handle('tachi-delete-pfp', async (event, apiKey, userId) => {
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    try {
        await axios.delete(
            `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/pfp`,
            {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            }
        );
        return { success: true };
    } catch (e) {
        console.error('[Tachi] PFP delete error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Upload Banner (multipart form data)
ipcMain.handle('tachi-upload-banner', async (event, apiKey, userId, imageBuffer, mimeType) => {
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };
    if (!imageBuffer) return { success: false, error: 'No image data' };

    try {
        const FormData = require('form-data');
        const form = new FormData();

        const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'jpg';
        form.append('banner', Buffer.from(imageBuffer), {
            filename: `banner.${ext}`,
            contentType: mimeType || 'image/jpeg'
        });

        const response = await axios.put(
            `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/banner`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        if (response.data.success) {
            return { success: true, get: response.data.body.get };
        }
        return { success: false, error: response.data.description || 'Upload failed' };

    } catch (e) {
        console.error('[Tachi] Banner upload error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});

// Delete Banner
ipcMain.handle('tachi-delete-banner', async (event, apiKey, userId) => {
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    try {
        await axios.delete(
            `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/banner`,
            {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            }
        );
        return { success: true };
    } catch (e) {
        // 404 is okay - means no banner was set
        if (e.response && e.response.status === 404) {
            return { success: true };
        }
        console.error('[Tachi] Banner delete error:', e);
        const errorMsg = e.response?.data?.description || e.message;
        return { success: false, error: errorMsg };
    }
});


// ============================================================================
// TACHI AUTH POPUP WINDOW
// ============================================================================
// Client File Flow URL - opens a window for user to generate their API key
// Note: You need to register a Tachi API Client and replace the clientId below
const TACHI_CLIENT_ID = 'CI3ae80802ccac6e1d4cafa80ba74f80bdea4d8f0c'; // Lyruanna client ID

let tachiAuthWindow = null;

ipcMain.handle('open-tachi-auth', async () => {
    // Close existing window if open
    if (tachiAuthWindow && !tachiAuthWindow.isDestroyed()) {
        tachiAuthWindow.focus();
        return { success: true, message: 'Window already open' };
    }

    const authUrl = `${TACHI_BASE_URL}/client-file-flow/${TACHI_CLIENT_ID}`;

    tachiAuthWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: 'Tachi - Get API Key',
        parent: mainWindow,
        modal: false,
        resizable: true,
        minimizable: true,
        maximizable: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    tachiAuthWindow.loadURL(authUrl);

    tachiAuthWindow.on('closed', () => {
        tachiAuthWindow = null;
    });

    return { success: true };
});

app.whenReady().then(createWindow);
