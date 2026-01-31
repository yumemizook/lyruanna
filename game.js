/**
 * ============================================================================
 * ENGINE CORE
 * ============================================================================
 */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// ----------------------------------------------------------------------------
// CONSTANTS & HELPERS
// ----------------------------------------------------------------------------
const LAMPS = {
    NO_PLAY: { id: 0, name: 'NO PLAY', class: 'no-play' },
    FAILED: { id: 1, name: 'FAILED', class: 'failed' },
    ASSIST: { id: 2, name: 'ASSIST EASY', class: 'assist' },
    EASY: { id: 3, name: 'EASY', class: 'easy' },
    CLEAR: { id: 4, name: 'CLEAR', class: 'clear' },
    HARD: { id: 5, name: 'HARD', class: 'hard' },
    EXHARD: { id: 6, name: 'EX-HARD', class: 'ex-hard' },
    FC: { id: 7, name: 'FULL COMBO', class: 'fc' },
    PERFECT: { id: 8, name: 'PERFECT', class: 'perfect' },
    MAX: { id: 9, name: 'MAX', class: 'max' }
};

// Must be defined early for storage functions
const IS_DESKTOP = !!window.electronAPI;

// ============================================================================
// PERSISTENT DATA STORAGE
// ============================================================================
// New file formats:
//   scores.db    - merged lamps + best scores per chart
//   replays/*.rep - individual replay files (no more replays.json)
//   options.sav  - merged keybinds + player options

// In-memory cache for scores (merged lamps + scores)
// Format: { [fileRef]: { exScore, rate, rank, lampId } }
let _scoresDb = {};

// In-memory cache for replays (loaded on demand from .rep files)
let _replaysCache = {};

// Flag to track if data has been loaded
let _dataLoaded = false;

// Initialize persistent data from files (desktop) or localStorage (web)
async function initPersistentData() {
    if (_dataLoaded) return;

    if (IS_DESKTOP && window.electronAPI.readUserData) {
        // Try to load new format first
        let scoresDb = await window.electronAPI.readUserData('scores.db');

        if (scoresDb) {
            _scoresDb = scoresDb;
        } else {
            // Migration: check for old separate files
            const [oldLamps, oldScores] = await Promise.all([
                window.electronAPI.readUserData('lamps.json'),
                window.electronAPI.readUserData('best_scores.json')
            ]);

            // Merge old data into new format
            if (oldLamps || oldScores) {
                const lamps = oldLamps || {};
                const scores = oldScores || {};

                // Combine all keys from both
                const allKeys = new Set([...Object.keys(lamps), ...Object.keys(scores)]);
                for (const key of allKeys) {
                    const scoreEntry = scores[key] || {};
                    const lampId = lamps[key] || 0;

                    // Handle legacy number format
                    if (typeof scoreEntry === 'number') {
                        _scoresDb[key] = { exScore: scoreEntry, rate: 0, rank: 'F', lampId };
                    } else {
                        _scoresDb[key] = {
                            exScore: scoreEntry.exScore || 0,
                            rate: scoreEntry.rate || 0,
                            rank: scoreEntry.rank || 'F',
                            lampId: Math.max(scoreEntry.lampId || 0, lampId)
                        };
                    }
                }

                // Save merged data
                window.electronAPI.writeUserData('scores.db', _scoresDb);
                console.log('Migrated lamps.json + best_scores.json → scores.db');
            }

            // Also try localStorage as fallback
            if (Object.keys(_scoresDb).length === 0) {
                const localLamps = JSON.parse(localStorage.getItem('lamps') || '{}');
                const localScores = JSON.parse(localStorage.getItem('best_scores') || '{}');
                const allKeys = new Set([...Object.keys(localLamps), ...Object.keys(localScores)]);
                for (const key of allKeys) {
                    const scoreEntry = localScores[key] || {};
                    const lampId = localLamps[key] || 0;
                    if (typeof scoreEntry === 'number') {
                        _scoresDb[key] = { exScore: scoreEntry, rate: 0, rank: 'F', lampId };
                    } else {
                        _scoresDb[key] = {
                            exScore: scoreEntry.exScore || 0,
                            rate: scoreEntry.rate || 0,
                            rank: scoreEntry.rank || 'F',
                            lampId: Math.max(scoreEntry.lampId || 0, lampId)
                        };
                    }
                }
                if (Object.keys(_scoresDb).length > 0) {
                    window.electronAPI.writeUserData('scores.db', _scoresDb);
                    console.log('Migrated localStorage → scores.db');
                }
            }
        }

        // Replays: migrate from replays.json to individual .rep files
        const oldReplays = await window.electronAPI.readUserData('replays.json');
        if (oldReplays && Object.keys(oldReplays).length > 0) {
            console.log('Migrating replays.json to individual .rep files...');
            const userData = await window.electronAPI.getAppPath('userData');
            for (const [fileRef, replayData] of Object.entries(oldReplays)) {
                const safeName = fileRef.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const repPath = `${userData}/replays/${safeName}.rep`;
                await window.electronAPI.writeFile(repPath, JSON.stringify(replayData));
                _replaysCache[fileRef] = replayData;
            }
            console.log(`Migrated ${Object.keys(oldReplays).length} replays to .rep files`);
        }
    } else {
        // Web mode: use localStorage (keep old format for web compatibility)
        const localLamps = JSON.parse(localStorage.getItem('lamps') || '{}');
        const localScores = JSON.parse(localStorage.getItem('best_scores') || '{}');
        const allKeys = new Set([...Object.keys(localLamps), ...Object.keys(localScores)]);
        for (const key of allKeys) {
            const scoreEntry = localScores[key] || {};
            const lampId = localLamps[key] || 0;
            if (typeof scoreEntry === 'number') {
                _scoresDb[key] = { exScore: scoreEntry, rate: 0, rank: 'F', lampId };
            } else {
                _scoresDb[key] = {
                    exScore: scoreEntry.exScore || 0,
                    rate: scoreEntry.rate || 0,
                    rank: scoreEntry.rank || 'F',
                    lampId: Math.max(scoreEntry.lampId || 0, lampId)
                };
            }
        }
        _replaysCache = JSON.parse(localStorage.getItem('replays') || '{}');
    }

    _dataLoaded = true;
    console.log('Persistent data loaded');
}

function getLamp(fileRef) {
    const entry = _scoresDb[fileRef];
    if (!entry) return LAMPS.NO_PLAY;
    const lampId = entry.lampId || 0;
    return Object.values(LAMPS).find(l => l.id === lampId) || LAMPS.NO_PLAY;
}

function saveLamp(fileRef, newLamp) {
    const entry = _scoresDb[fileRef] || { exScore: 0, rate: 0, rank: 'F', lampId: 0 };
    const currentLampId = entry.lampId || 0;
    if (newLamp.id > currentLampId) {
        entry.lampId = newLamp.id;
        _scoresDb[fileRef] = entry;
        _saveScoresDb();
    }
}

function getBestScore(fileRef) {
    const entry = _scoresDb[fileRef];
    return entry || { exScore: 0, rate: 0, rank: 'F', lampId: 0 };
}

// Rank priority for comparison (higher is better)
const RANK_PRIORITY = { 'F': 0, 'E': 1, 'D': 2, 'C': 3, 'B': 4, 'A': 5, 'AA': 6, 'AAA': 7 };

function saveScore(fileRef, exScore, rate, rank, lampId) {
    let entry = _scoresDb[fileRef] || { exScore: 0, rate: 0, rank: 'F', lampId: 0 };
    let changed = false;

    if (exScore > entry.exScore) {
        entry.exScore = exScore;
        changed = true;
    }
    if (rate > entry.rate) {
        entry.rate = rate;
        changed = true;
    }
    if ((RANK_PRIORITY[rank] || 0) > (RANK_PRIORITY[entry.rank] || 0)) {
        entry.rank = rank;
        changed = true;
    }
    if (lampId > (entry.lampId || 0)) {
        entry.lampId = lampId;
        changed = true;
    }

    if (changed) {
        _scoresDb[fileRef] = entry;
        _saveScoresDb();
    }
}

function _saveScoresDb() {
    if (IS_DESKTOP && window.electronAPI.writeUserData) {
        window.electronAPI.writeUserData('scores.db', _scoresDb);
    } else {
        // Web: save in old format for compatibility
        const lamps = {};
        const scores = {};
        for (const [key, entry] of Object.entries(_scoresDb)) {
            if (entry.lampId) lamps[key] = entry.lampId;
            scores[key] = { exScore: entry.exScore, rate: entry.rate, rank: entry.rank, lampId: entry.lampId };
        }
        localStorage.setItem('lamps', JSON.stringify(lamps));
        localStorage.setItem('best_scores', JSON.stringify(scores));
    }
}

function saveReplay(fileRef, log, score, lamp, isFC) {
    if (STATE.autoplay) return;
    if (STATE.replaySaveType === 'NONE') return;

    const existing = getReplay(fileRef);
    let shouldSave = false;

    if (!existing) {
        shouldSave = true;
    } else {
        if (STATE.replaySaveType === 'BEST_EX') {
            if (score > existing.score) shouldSave = true;
        } else if (STATE.replaySaveType === 'BEST_LAMP') {
            if (lamp.id > existing.lampId) shouldSave = true;
            else if (lamp.id === existing.lampId && score > existing.score) shouldSave = true;
        } else if (STATE.replaySaveType === 'FULL_COMBO') {
            if (isFC) {
                if (!existing.isFC) shouldSave = true;
                else if (score > existing.score) shouldSave = true;
            }
        }
    }

    if (shouldSave) {
        const replayData = {
            score: score,
            lampId: lamp.id,
            isFC: isFC,
            log: log,
            timestamp: Date.now()
        };
        _replaysCache[fileRef] = replayData;

        if (IS_DESKTOP && window.electronAPI.writeFile) {
            // Save only to .rep file (no more replays.json)
            (async () => {
                const userData = await window.electronAPI.getAppPath('userData');
                const safeName = fileRef.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const repPath = `${userData}/replays/${safeName}.rep`;
                await window.electronAPI.writeFile(repPath, JSON.stringify(replayData));
                console.log("Replay saved:", repPath);
            })();
        } else {
            localStorage.setItem('replays', JSON.stringify(_replaysCache));
        }

        console.log("Replay saved!", replayData);
    }
}

function getReplay(fileRef) {
    return _replaysCache[fileRef] || null;
}

// ----------------------------------------------------------------------------
// ABSTRACTION LAYER (WEB VS DESKTOP)
// ----------------------------------------------------------------------------
// IS_DESKTOP defined earlier for storage functions

class DataLayer {
    constructor() {
        this.webFiles = {}; // Map<filename, File>
    }

    async readFile(ref) {
        if (IS_DESKTOP) {
            // ref is absolute path string
            const data = await window.electronAPI.readFile(ref);
            // Ensure we have a Uint8Array for TextDecoder
            let uint8;
            if (data instanceof Uint8Array) {
                uint8 = data;
            } else if (data instanceof ArrayBuffer) {
                uint8 = new Uint8Array(data);
            } else if (data && typeof data === 'object') {
                uint8 = new Uint8Array(Object.values(data));
            } else {
                throw new Error('Unexpected data format from readFile');
            }
            return new TextDecoder('shift-jis').decode(uint8);
        } else {
            // ref is File object
            const buffer = await ref.arrayBuffer();
            return new TextDecoder('shift-jis').decode(buffer);
        }
    }

    async readAudio(ref) {
        let arrayBuffer;
        if (IS_DESKTOP) {
            const data = await window.electronAPI.readFile(ref);
            // Electron IPC serializes Node.js Buffer as Uint8Array or object
            // We need to convert it to a proper ArrayBuffer for decodeAudioData
            if (data instanceof ArrayBuffer) {
                arrayBuffer = data;
            } else if (data instanceof Uint8Array) {
                // Uint8Array - get its underlying buffer (may need to slice if offset/length differ)
                arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            } else if (data && data.buffer) {
                // Buffer-like object with buffer property
                arrayBuffer = data.buffer;
            } else if (data && typeof data === 'object') {
                // Plain object serialization - convert to Uint8Array then to ArrayBuffer
                const uint8 = new Uint8Array(Object.values(data));
                arrayBuffer = uint8.buffer;
            } else {
                throw new Error('Unexpected data format from readFile');
            }
        } else {
            arrayBuffer = await ref.arrayBuffer();
        }
        return await audioCtx.decodeAudioData(arrayBuffer);
    }
}

const dataLayer = new DataLayer();

// ----------------------------------------------------------------------------
// DATA STRUCTURES
// ----------------------------------------------------------------------------

const CHANNELS = {
    P1: {
        SCRATCH: [0x16, 0x56],
        KEY1: [0x11, 0x51], KEY2: [0x12, 0x52], KEY3: [0x13, 0x53], KEY4: [0x14, 0x54],
        KEY5: [0x15, 0x55], KEY6: [0x18, 0x58], KEY7: [0x19, 0x59]
    },
    P2: {
        SCRATCH: [0x26, 0x66],
        KEY1: [0x21, 0x61], KEY2: [0x22, 0x62], KEY3: [0x23, 0x63], KEY4: [0x24, 0x64],
        KEY5: [0x25, 0x65], KEY6: [0x28, 0x68], KEY7: [0x29, 0x69]
    },
    BGM: 0x01
};

// Sprite Constants for judgement.png (1231x1488)
// GREAT rows 0-6: labels at x=0, digits at x=272
// Non-GREAT rows start at y=992
const J_ROW_H = 124;        // Row height
const J_WORD_W = 264;       // Label width
const J_DIGIT_START = 272;  // X where digits start
const J_DIGIT_W = 96;       // Digit width
const J_DIGIT_H = 124;      // Digit height

const JUDGE_SPRITES = {
    PGREAT: Array.from({ length: 6 }, (_, i) => ({
        label: { x: 0, y: i * J_ROW_H, w: J_WORD_W, h: J_ROW_H },
        digits: Array.from({ length: 10 }, (_, d) => ({ x: J_DIGIT_START + d * J_DIGIT_W, y: i * J_ROW_H, w: J_DIGIT_W, h: J_DIGIT_H }))
    })),
    GREAT: {
        label: { x: 0, y: 6 * J_ROW_H, w: J_WORD_W, h: J_ROW_H },
        digits: Array.from({ length: 10 }, (_, d) => ({ x: J_DIGIT_START + d * J_DIGIT_W, y: 6 * J_ROW_H, w: J_DIGIT_W, h: J_DIGIT_H }))
    },
    GOOD: { x: 0, y: 992, w: J_WORD_W, h: J_ROW_H },
    BAD: { x: 0, y: 1116, w: J_WORD_W, h: J_ROW_H },
    POOR: { x: 0, y: 1240, w: J_WORD_W, h: J_ROW_H },
    FAIL: { x: 0, y: 1364, w: J_WORD_W, h: J_ROW_H }
};

// --- NEW OPTIONS DATA ---
const OPTIONS_KEYS = {
    'wheel-mode': {
        key: 'keyModeFilter',
        items: [
            { val: 'ALL', lbl: 'ALL' }, { val: '单', lbl: 'SINGLE' }, { val: '5', lbl: '5KEY' },
            { val: '7', lbl: '7KEY' }, { val: '9', lbl: '9KEY' }, { val: '双', lbl: 'DOUBLE' },
            { val: '10', lbl: '10KEY' }, { val: '14', lbl: '14KEY' }
        ]
    },
    'wheel-style': {
        key: 'modifier',
        items: [
            { val: 'OFF', lbl: 'OFF' }, { val: 'MIRROR', lbl: 'MIRROR' }, { val: 'RANDOM', lbl: 'RANDOM' },
            { val: 'S-RANDOM', lbl: 'S-RANDOM' }, { val: 'H-RANDOM', lbl: 'H-RANDOM' },
            { val: 'R-RANDOM', lbl: 'R-RANDOM' }, { val: 'ALL-SCRATCH', lbl: 'ALL-SCRATCH' }
        ]
    },
    'wheel-gauge': {
        key: 'gaugeType',
        items: [
            { val: 'ASSIST', lbl: 'ASSIST EASY' }, { val: 'EASY', lbl: 'EASY' }, { val: 'GROOVE', lbl: 'GROOVE' },
            { val: 'HARD', lbl: 'HARD' }, { val: 'EXHARD', lbl: 'EX-HARD' }, { val: 'HAZARD', lbl: 'HAZARD' }
        ]
    },
    'wheel-assist': {
        key: 'assistMode',
        items: [
            { val: 'OFF', lbl: 'OFF' }, { val: 'A-SCR', lbl: 'AUTO-SCRATCH' },
            { val: 'EX-JUDGE', lbl: 'EXTEND JUDGE' }, { val: 'BOTH', lbl: 'A-SCR + EX-JDG' }
        ]
    },
    'wheel-range': {
        key: 'rangeMode',
        items: [
            { val: 'OFF', lbl: 'OFF' }, { val: 'SUDDEN+', lbl: 'SUDDEN+' },
            { val: 'LIFT', lbl: 'LIFT' }, { val: 'LIFT-SUD+', lbl: 'LIFT & SUD+' }
        ]
    },
    'wheel-hsfix': {
        key: 'hiSpeedFix',
        items: [
            { val: 'NONE', lbl: 'NONE' }, { val: 'MIN', lbl: 'MIN BPM' }, { val: 'MAX', lbl: 'MAX BPM' },
            { val: 'AVG', lbl: 'AVG BPM' }, { val: 'CONSTANT', lbl: 'CONSTANT' },
            { val: 'START', lbl: 'START BPM' }, { val: 'MAIN', lbl: 'MAIN BPM' }
        ]
    }
};

const PACEMAKER_TARGETS = ['OFF', 'AAA', 'AA', 'A', 'NEXT', 'MY BEST'];

function rotatePacemakerTarget(delta) {
    const setSize = PACEMAKER_TARGETS.length;
    // Ensure visual index is initialized
    if (typeof STATE.pacemakerVisualIndex === 'undefined') {
        const currentLogicIdx = PACEMAKER_TARGETS.indexOf(STATE.pacemakerTarget);
        STATE.pacemakerVisualIndex = (setSize * 2) + Math.max(0, currentLogicIdx);
    }

    STATE.pacemakerVisualIndex += delta;

    // Logic index
    let idx = ((STATE.pacemakerVisualIndex % setSize) + setSize) % setSize;
    STATE.pacemakerTarget = PACEMAKER_TARGETS[idx];

    updateOptionsUI();
}

function updatePacemaker(now) {
    if (STATE.pacemakerTarget === 'OFF' || !STATE.loadedSong) {
        ui.pacemaker.style.display = 'none';
        return;
    }
    ui.pacemaker.style.display = 'flex';

    const totalNotes = STATE.loadedSong.notes.length;
    const maxEx = totalNotes * 2;
    const bestScoreData = getBestScore(STATE.currentFileRef);
    const bestExScore = bestScoreData.exScore;

    // Calculate target fraction
    let targetRatio = 0;
    let currentLabel = STATE.pacemakerTarget;

    if (STATE.pacemakerTarget === 'AAA') targetRatio = 8 / 9;
    else if (STATE.pacemakerTarget === 'AA') targetRatio = 7 / 9;
    else if (STATE.pacemakerTarget === 'A') targetRatio = 6 / 9;
    else if (STATE.pacemakerTarget === 'MY BEST') {
        targetRatio = bestExScore / Math.max(1, maxEx);
    }
    else if (STATE.pacemakerTarget === 'NEXT') {
        const ranks = [
            { name: 'AAA', ratio: 8 / 9 },
            { name: 'AA', ratio: 7 / 9 },
            { name: 'A', ratio: 6 / 9 },
            { name: 'B', ratio: 5 / 9 },
            { name: 'C', ratio: 4 / 9 },
            { name: 'D', ratio: 3 / 9 },
            { name: 'E', ratio: 2 / 9 }
        ];
        let next = ranks.find(r => (STATE.score / Math.max(1, maxEx)) < r.ratio);
        if (!next) next = { name: 'MAX', ratio: 1.0 };
        targetRatio = next.ratio;
        currentLabel = next.name;
    }

    // Estimate how many notes should have been passed by 'now'
    const notesPassed = STATE.loadedSong.notes.filter(n => n.time <= now).length;
    const noteProgress = notesPassed / Math.max(1, totalNotes);

    const targetScoreCurrent = Math.floor(maxEx * targetRatio * noteProgress);
    const bestScoreCurrent = Math.floor(bestExScore * noteProgress);

    const diffTarget = STATE.score - targetScoreCurrent;
    const diffBest = STATE.score - bestScoreCurrent;

    // Update UI
    ui.paceScoreYou.textContent = STATE.score;
    ui.paceScoreTarget.textContent = targetScoreCurrent;
    ui.paceTargetName.textContent = currentLabel;

    ui.paceBarYou.style.height = ((STATE.score / Math.max(1, maxEx)) * 100) + '%';
    ui.paceBarTarget.style.height = (targetRatio * noteProgress * 100) + '%';
    ui.paceBarBest.style.height = (bestExScore / Math.max(1, maxEx) * 100) + '%';

    ui.paceDiffTarget.textContent = (diffTarget >= 0 ? '+' : '') + diffTarget;
    ui.paceDiffTarget.className = 'val ' + (diffTarget >= 0 ? 'plus' : 'minus');
    ui.paceDiffBest.textContent = (diffBest >= 0 ? '+' : '') + diffBest;
    ui.paceDiffBest.className = 'val ' + (diffBest >= 0 ? 'plus' : 'minus');

    ui.paceGhostLabel.textContent = 'vs ' + currentLabel;
}

const ACTIONS = {
    P1_SC_CCW: 'p1_sc_ccw', P1_SC_CW: 'p1_sc_cw',
    P1_1: 'p1_1', P1_2: 'p1_2', P1_3: 'p1_3', P1_4: 'p1_4', P1_5: 'p1_5', P1_6: 'p1_6', P1_7: 'p1_7',
    P2_SC_CCW: 'p2_sc_ccw', P2_SC_CW: 'p2_sc_cw',
    P2_1: 'p2_1', P2_2: 'p2_2', P2_3: 'p2_3', P2_4: 'p2_4', P2_5: 'p2_5', P2_6: 'p2_6', P2_7: 'p2_7',
    START: 'start', SELECT: 'select'
};

const DEFAULT_KEYBINDS = {
    [ACTIONS.P1_SC_CCW]: 'ShiftLeft',
    [ACTIONS.P1_SC_CW]: 'ControlLeft',
    [ACTIONS.P1_1]: 'KeyZ', [ACTIONS.P1_2]: 'KeyS', [ACTIONS.P1_3]: 'KeyX', [ACTIONS.P1_4]: 'KeyD',
    [ACTIONS.P1_5]: 'KeyC', [ACTIONS.P1_6]: 'KeyF', [ACTIONS.P1_7]: 'KeyV',

    [ACTIONS.P2_SC_CCW]: 'ShiftRight',
    [ACTIONS.P2_SC_CW]: 'ControlRight',
    [ACTIONS.P2_1]: 'KeyN', [ACTIONS.P2_2]: 'KeyJ', [ACTIONS.P2_3]: 'KeyM', [ACTIONS.P2_4]: 'KeyK',
    [ACTIONS.P2_5]: 'Comma', [ACTIONS.P2_6]: 'KeyL', [ACTIONS.P2_7]: 'Period',
    [ACTIONS.START]: 'Digit1', [ACTIONS.SELECT]: 'Digit2'
};

// ============================================================================
// OPTIONS STORAGE (options.sav)
// ============================================================================
// Unified options file: { keybinds: {...}, options: {...} }

// In-memory keybinds cache
let _keybindsCache = null;

// Load keybinds and player options from options.sav (desktop) or localStorage (web)
async function loadKeybindsAsync() {
    if (IS_DESKTOP && window.electronAPI.readUserData) {
        // Try new unified format first
        const optionsSav = await window.electronAPI.readUserData('options.sav');

        if (optionsSav && optionsSav.keybinds) {
            _keybindsCache = { ...DEFAULT_KEYBINDS, ...optionsSav.keybinds };
        } else {
            // Migration: check for old keybinds.json
            const oldKeybinds = await window.electronAPI.readUserData('keybinds.json');
            if (oldKeybinds) {
                _keybindsCache = { ...DEFAULT_KEYBINDS, ...oldKeybinds };
                console.log('Will migrate keybinds.json → options.sav');
            } else if (localStorage.getItem('lyruanna_keybinds')) {
                // Migration from localStorage
                _keybindsCache = { ...DEFAULT_KEYBINDS, ...JSON.parse(localStorage.getItem('lyruanna_keybinds')) };
                console.log('Will migrate localStorage keybinds → options.sav');
            } else {
                _keybindsCache = { ...DEFAULT_KEYBINDS };
            }
        }
    } else {
        const saved = localStorage.getItem('lyruanna_keybinds');
        if (saved) {
            try {
                _keybindsCache = { ...DEFAULT_KEYBINDS, ...JSON.parse(saved) };
            } catch (e) {
                console.warn('Failed to parse saved keybinds, using defaults');
                _keybindsCache = { ...DEFAULT_KEYBINDS };
            }
        } else {
            _keybindsCache = { ...DEFAULT_KEYBINDS };
        }
    }
    // Update KEYBINDS object in place
    Object.assign(KEYBINDS, _keybindsCache);
    // Rebuild key-to-action mapping after loading keybinds
    if (typeof rebuildInputMap === 'function') {
        rebuildInputMap();
    }
}

// Synchronous fallback for initial load
function loadKeybinds() {
    const saved = localStorage.getItem('lyruanna_keybinds');
    if (saved) {
        try {
            return { ...DEFAULT_KEYBINDS, ...JSON.parse(saved) };
        } catch (e) {
            console.warn('Failed to parse saved keybinds, using defaults');
        }
    }
    return { ...DEFAULT_KEYBINDS };
}

function saveKeybinds() {
    _saveOptions();
}

const KEYBINDS = loadKeybinds();

function savePlayerOptions() {
    _saveOptions();
}

// Unified save function for options.sav
function _saveOptions() {
    const optionsData = {
        keybinds: KEYBINDS,
        options: {
            speed: STATE.speed,
            gaugeType: STATE.gaugeType,
            difficultyFilter: STATE.difficultyFilter,
            keyModeFilter: STATE.keyModeFilter,
            hiSpeedFix: STATE.hiSpeedFix,
            sortMode: STATE.sortMode,
            modifier: STATE.modifier,
            assistMode: STATE.assistMode,
            rangeMode: STATE.rangeMode,
            pacemakerTarget: STATE.pacemakerTarget,
            fullscreen: STATE.fullscreen,
            resolution: STATE.resolution,
            replaySaveType: STATE.replaySaveType,
            showTally: STATE.showTally
        }
    };

    if (IS_DESKTOP && window.electronAPI.writeUserData) {
        window.electronAPI.writeUserData('options.sav', optionsData);
    } else {
        // Web: keep old format for compatibility
        localStorage.setItem('lyruanna_keybinds', JSON.stringify(KEYBINDS));
        localStorage.setItem('lyruanna_player_options', JSON.stringify(optionsData.options));
    }
}

async function loadPlayerOptionsAsync() {
    let options = null;

    if (IS_DESKTOP && window.electronAPI.readUserData) {
        // Try new unified format first
        const optionsSav = await window.electronAPI.readUserData('options.sav');

        if (optionsSav && optionsSav.options) {
            options = optionsSav.options;
        } else {
            // Migration: check for old player_options.json
            const oldOptions = await window.electronAPI.readUserData('player_options.json');
            if (oldOptions) {
                options = oldOptions;
                console.log('Will migrate player_options.json → options.sav');
            } else if (localStorage.getItem('lyruanna_player_options')) {
                options = JSON.parse(localStorage.getItem('lyruanna_player_options'));
                console.log('Will migrate localStorage options → options.sav');
            }
        }

        // Save unified format if migrated
        if (options && !optionsSav) {
            Object.assign(STATE, options);
            _saveOptions();
            console.log('Migrated to options.sav');
            applyWindowSettings(true);
            return; // Already applied
        }
    } else {
        const saved = localStorage.getItem('lyruanna_player_options');
        if (saved) {
            try {
                options = JSON.parse(saved);
            } catch (e) {
                console.warn('Failed to parse saved player options');
            }
        }
    }

    if (options) {
        Object.assign(STATE, options);
        applyWindowSettings(true);
    }
}

// Synchronous fallback for initial load
function loadPlayerOptions() {
    const saved = localStorage.getItem('lyruanna_player_options');
    if (saved) {
        try {
            const options = JSON.parse(saved);
            Object.assign(STATE, options);
            applyWindowSettings(true);
        } catch (e) {
            console.warn('Failed to parse saved player options');
        }
    }
}

function applyWindowSettings(skipIPC = false) {
    if (!IS_DESKTOP) return;

    // Only handle titlebar toggle and IPC here.
    // Internal layout of #app (padding, top, etc) should NOT be touched
    // as it breaks the 1920x1080 scaling assumption.
    if (STATE.fullscreen) {
        if (ui.titlebar) ui.titlebar.style.display = 'none';
        if (!skipIPC) window.electronAPI.setFullscreen(true);
    } else {
        if (ui.titlebar) ui.titlebar.style.display = 'flex';
        if (!skipIPC) {
            const [w, h] = STATE.resolution.split('x').map(Number);
            window.electronAPI.setResolution(w, h);
        }
    }
    // Always update scaling after settings change
    updateScaling();
}

function renderSettings() {
    document.getElementById('opt-fullscreen').checked = STATE.fullscreen;
    document.getElementById('opt-resolution').value = STATE.resolution;
    document.getElementById('opt-show-tally').checked = STATE.showTally;
    document.getElementById('opt-replay-type').value = STATE.replaySaveType || 'BEST_EX';

    // Keybindings can be added here if needed
}

const ACTION_TO_CHANNELS = {
    [ACTIONS.P1_SC_CCW]: CHANNELS.P1.SCRATCH,
    [ACTIONS.P1_SC_CW]: CHANNELS.P1.SCRATCH,
    [ACTIONS.P1_1]: CHANNELS.P1.KEY1, [ACTIONS.P1_2]: CHANNELS.P1.KEY2, [ACTIONS.P1_3]: CHANNELS.P1.KEY3,
    [ACTIONS.P1_4]: CHANNELS.P1.KEY4, [ACTIONS.P1_5]: CHANNELS.P1.KEY5, [ACTIONS.P1_6]: CHANNELS.P1.KEY6, [ACTIONS.P1_7]: CHANNELS.P1.KEY7,

    [ACTIONS.P2_SC_CCW]: CHANNELS.P2.SCRATCH,
    [ACTIONS.P2_SC_CW]: CHANNELS.P2.SCRATCH,
    [ACTIONS.P2_1]: CHANNELS.P2.KEY1, [ACTIONS.P2_2]: CHANNELS.P2.KEY2, [ACTIONS.P2_3]: CHANNELS.P2.KEY3,
    [ACTIONS.P2_4]: CHANNELS.P2.KEY4, [ACTIONS.P2_5]: CHANNELS.P2.KEY5, [ACTIONS.P2_6]: CHANNELS.P2.KEY6, [ACTIONS.P2_7]: CHANNELS.P2.KEY7
};

// TIMING WINDOWS (ms +/-)
const JUDGE_WINDOWS = {
    0: { PG: 8, GR: 24, GD: 40, BD: 100, PR: 200 },
    1: { PG: 15, GR: 32, GD: 60, BD: 100, PR: 200 },
    2: { PG: 18, GR: 40, GD: 80, BD: 100, PR: 200 },
    3: { PG: 21, GR: 60, GD: 120, BD: 200, PR: 200 }
};

const STATE = {
    files: {}, // Web: File objects. Desktop: Path strings
    charts: [], // { title, artist, fileRef, ... }
    loadedSong: null,
    audioBuffers: {},
    currentFileRef: null,
    escapePressTime: 0,
    tooltipTimeout: null,

    // Player Options
    speed: 4.0,
    gaugeType: 'GROOVE',
    suddenPlus: 0,
    lift: 0,
    modifier: 'OFF',
    assistMode: 'OFF', // OFF, A-SCR, EX-JUDGE, BOTH
    autoplay: false,
    showTally: true,
    difficultyFilter: 'ALL', // ALL, BEGINNER, NORMAL, HYPER, ANOTHER, LEGGENDARIA
    keyModeFilter: 'ALL', // ALL, 单, 5, 7, 9, 双, 10, 14
    hiSpeedFix: 'NONE', // NONE, MIN, MAX, AVG, CONSTANT, START, MAIN
    pacemakerTarget: 'OFF', // OFF, AAA, AA, A, NEXT, MY BEST
    fullscreen: false,
    resolution: '1280x720',
    rangeMode: 'OFF',
    sortMode: 'DEFAULT', // DEFAULT, TITLE, LEVEL, LAMP
    startHoldTimer: null,
    isOptionsOpen: false,
    isOptionsPersistent: false,
    optionsChangedFilter: false,

    // Game State
    isPlaying: false,
    isStarting: false,
    startTime: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    gauge: 0,
    gaugeTick: 0,

    // Judgement Tally
    judgeCounts: { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0 },
    fastSlow: { fast: 0, slow: 0 },
    comboBreaks: 0,

    // BGA
    bgaDefinitions: {},
    bgaEvents: [],
    bgaCursor: 0,
    stagefileUrl: null,
    bannerUrl: null,

    activeSources: new Set(), // Track active audio sources

    activeActions: new Set(),
    judgement: { type: null, time: 0, combo: 0, isEmpty: false },
    judgementImage: null,

    // History for Results
    history: {
        gauge: [],
        score: []
    },
    lastNoteTime: 0,

    // System Audio & Navigation
    systemAudio: {},
    systemMapping: {},
    currentFolder: null, // name of current folder or null for root
    selectBgmSource: null,

    // Course / Autoplay
    courses: [],
    activeCourse: null,
    courseIndex: 0,
    replayFileRef: null,

    // Navigation
    selectedIndex: 0,
    currentList: [], // Array of { type: 'folder'|'chart'|'back', data: any, el: HTMLElement }
    loadingComplete: false, // Flag to prevent audio during loading
    isFadingOut: false, // Flag to block inputs during fade out animation
    currentParseId: 0 // Counter to track and abort stale parsing requests
};

function rebuildInputMap() {
    STATE.keyCodeToAction = {};
    for (const [action, code] of Object.entries(KEYBINDS)) {
        if (!STATE.keyCodeToAction[code]) {
            STATE.keyCodeToAction[code] = [];
        }
        STATE.keyCodeToAction[code].push(action);
    }
}
rebuildInputMap();

// ----------------------------------------------------------------------------
// PARSER
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// PARSER (WORKER)
// ----------------------------------------------------------------------------
// Use absolute URL resolution for Worker to avoid relative path issues in Electron
const workerUrl = new URL('./bms-parser.worker.js', window.location.href);
const parserWorker = new Worker(workerUrl);

function parseChartAsync(text) {
    // Increment parse ID to invalidate any pending parses
    const parseId = ++STATE.currentParseId;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Worker timed out"));
        }, 60000);

        // One-off handler
        const handler = (e) => {
            clearTimeout(timeout);
            parserWorker.removeEventListener('message', handler);

            // Check if this parse is still the current one
            if (parseId !== STATE.currentParseId) {
                reject(new Error("Parse abandoned - newer request pending"));
                return;
            }

            if (e.data.success) resolve(e.data.data);
            else reject(new Error(e.data.error));
        };

        const errHandler = (e) => {
            clearTimeout(timeout);
            parserWorker.removeEventListener('error', errHandler);
            reject(new Error("Worker error: " + (e.message || e)));
        };

        parserWorker.addEventListener('message', handler);
        parserWorker.addEventListener('error', errHandler);
        parserWorker.postMessage(text);
    });
}

// ----------------------------------------------------------------------------
// UI & LOGIC
// ----------------------------------------------------------------------------
const ui = {
    // Song Select
    songList: document.getElementById('song-list'),
    songCount: document.getElementById('song-count'),
    selectBg: document.getElementById('select-bg'),
    bannerArea: document.getElementById('banner-area'),
    stagefileArea: document.getElementById('stagefile-area'),
    titleMain: document.getElementById('song-title-main'),
    subtitle: document.getElementById('song-subtitle'),
    artistGenre: document.getElementById('song-artist-genre'),
    diffDisplay: document.getElementById('difficulty-display'),
    diffLevel: document.getElementById('diff-level'),
    diffTier: document.getElementById('diff-tier'),
    diffStars: document.getElementById('diff-stars'),
    songStats: document.getElementById('song-stats'),
    statBpm: document.getElementById('stat-bpm'),
    statNotes: document.getElementById('stat-notes'),
    statNpsStart: document.getElementById('stat-nps-start'),
    statNpsAvg: document.getElementById('stat-nps-avg'),
    statNpsMax: document.getElementById('stat-nps-max'),
    statRank: document.getElementById('stat-rank'),
    songMarkers: document.getElementById('song-markers'),
    btnStart: document.getElementById('btn-start'),

    // Game HUD
    score: document.getElementById('hud-score'),
    maxCombo: document.getElementById('hud-max-combo'),
    rate: document.getElementById('hud-rate'),
    gaugeBar: document.getElementById('gauge-bar'),
    gaugeVal: document.getElementById('gauge-val'),
    gaugeGrade: document.getElementById('gauge-grade'),
    tally: document.getElementById('hud-tally'),
    tallyPg: document.getElementById('tally-pg'),
    tallyGr: document.getElementById('tally-gr'),
    tallyGd: document.getElementById('tally-gd'),
    tallyBd: document.getElementById('tally-bd'),
    tallyPr: document.getElementById('tally-pr'),
    tallyFast: document.getElementById('tally-fast'),
    tallySlow: document.getElementById('tally-slow'),
    tallyCb: document.getElementById('tally-cb'),

    // Game BGA
    gameBg: document.getElementById('game-bg'),
    gameBga: document.getElementById('game-bga'),
    bgaImg: document.getElementById('bga-img'),
    bgaVideo: document.getElementById('bga-video'),
    laneCoverTop: document.getElementById('lane-cover-top'),
    laneCoverBottom: document.getElementById('lane-cover-bottom'),

    // Modals
    modalSettings: document.getElementById('modal-settings'),
    modalOptions: document.getElementById('modal-options'),
    targetWheel: document.getElementById('iidx-target-wheel'),
    pacemaker: document.getElementById('hud-pacemaker'),
    paceBarYou: document.getElementById('pace-bar-you'),
    paceBarTarget: document.getElementById('pace-bar-target'),
    paceBarBest: document.getElementById('pace-bar-best'),
    paceScoreYou: document.getElementById('pace-score-you'),
    paceScoreTarget: document.getElementById('pace-score-target'),
    paceTargetName: document.getElementById('pace-target-name'),
    paceDiffTarget: document.getElementById('pace-diff-target'),
    paceDiffBest: document.getElementById('pace-diff-best'),
    paceGhostLabel: document.getElementById('pace-ghost-label'),

    // Decide Screen
    screenDecide: document.getElementById('screen-decide'),
    decideTitle: document.getElementById('decide-title'),
    decideArtist: document.getElementById('decide-artist'),

    // Loading Screen
    screenLoading: document.getElementById('screen-loading'),
    loadingBar: document.getElementById('loading-bar'),
    loadingStatus: document.getElementById('loading-status'),

    // Global
    titlebar: document.getElementById('titlebar'),

    // Progress Bar
    progressBar: document.getElementById('song-progress-bar'),
    progressFill: document.getElementById('song-progress-fill')
};

// --- INITIALIZATION ---
if (IS_DESKTOP) {
    // Hide custom titlebar during loading (will show after scan completes)
    document.getElementById('titlebar').style.display = 'none';

    // Wire up window control buttons
    document.getElementById('btn-close').onclick = () => window.electronAPI.closeWindow();

    // Handle scan progress
    // Handle scan progress
    let lastScanCurrent = 0;
    let lastScanTotal = 0;
    window.electronAPI.onScanProgress((data) => {
        if (data.total > 0) {
            // Reset if explicitly 0 (start of scan)
            if (data.current === 0) {
                lastScanCurrent = 0;
                lastScanTotal = data.total;
            }
            // Reset if total changes (new scan)
            else if (data.total !== lastScanTotal) {
                lastScanTotal = data.total;
                lastScanCurrent = 0;
            }
            // Enforce monotonic increase
            else if (data.current > lastScanCurrent) {
                lastScanCurrent = data.current;
            }

            const percent = (lastScanCurrent / lastScanTotal) * 100;

            // Forward only logic (bar)
            const currentWidth = parseFloat(ui.loadingBar.style.width) || 0;
            if (percent > currentWidth) {
                ui.loadingBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
            }

            // Construct consistent status string
            if (lastScanCurrent === lastScanTotal) {
                ui.loadingStatus.textContent = "COMPLETE!";
            } else {
                ui.loadingStatus.textContent = `LOADING CHART ${lastScanCurrent} OF ${lastScanTotal}...`;
            }
        } else {
            ui.loadingStatus.textContent = data.status;
        }
    });

    // Trigger startup scan
    ui.screenLoading.style.display = 'flex';
    window.electronAPI.rescanAllFolders().then(data => {
        loadLibraryFromDesktop(data);
        STATE.loadingComplete = true; // Mark loading as complete

        // Show titlebar now that loading is complete
        document.getElementById('titlebar').style.display = 'flex';

        // Add transition class for smooth fade
        ui.screenLoading.classList.add('fade-out');
        setTimeout(() => {
            ui.screenLoading.style.display = 'none';
            ui.screenLoading.classList.remove('fade-out');
            // Start BGM if not already playing
            if (!STATE.selectBgmSource) {
                STATE.selectBgmSource = playSystemSound('select', true);
            }
        }, 500);
    });
}

// Drag & Drop Course Import
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const lr2crs = files.filter(f => f.name.toLowerCase().endsWith('.lr2crs'));
    if (lr2crs.length > 0 && IS_DESKTOP) {
        for (const f of lr2crs) {
            const path = window.electronAPI.getPathForFile(f);
            await window.electronAPI.importCourse(path);
        }
        const lib = await window.electronAPI.getLibrary();
        loadLibraryFromDesktop(lib);
    }
});

// --- AUTOPLAY / REPLAY BINDINGS ---
document.getElementById('btn-autoplay').onclick = () => {
    if (!STATE.loadedSong) return;
    triggerDecideScreen(true);
};

document.getElementById('btn-replay').onclick = () => {
    if (!STATE.loadedSong) return;
    playSystemSound('scratch');
    // Re-load current chart & enter
    enterGame();
};

// Button Handlers
document.getElementById('btn-settings').onclick = () => {
    playSystemSound('o-open');
    renderSettings();
    renderConfig(); // Renders keybindings
    ui.modalSettings.classList.add('open');
};
document.getElementById('btn-save-settings').onclick = () => {
    playSystemSound('o-close');
    ui.modalSettings.classList.remove('open');
    STATE.fullscreen = document.getElementById('opt-fullscreen').checked;
    STATE.resolution = document.getElementById('opt-resolution').value;
    STATE.showTally = document.getElementById('opt-show-tally').checked;
    STATE.replaySaveType = document.getElementById('opt-replay-type').value;

    savePlayerOptions();
    applyWindowSettings();
    saveKeybinds();
    rebuildInputMap();
};

// Manual Course Import
document.getElementById('btn-import-course').onclick = async () => {
    const paths = await window.electronAPI.openCourseDialog();
    if (paths && paths.length > 0) {
        let count = 0;
        for (const p of paths) {
            const added = await window.electronAPI.importCourse(p);
            count += added;
        }
        const lib = await window.electronAPI.getLibrary();
        loadLibraryFromDesktop(lib);
        alert(`Imported ${count} course(s).`);
    }
};

document.getElementById('btn-options').onclick = () => {
    playSystemSound('o-open');
    STATE.isOptionsOpen = true;
    STATE.isOptionsPersistent = true;
    ui.modalOptions.classList.add('open');
    updateOptionsUI();
    setTimeout(drawWiringLines, 50); // Delay to allow layout to render
};
document.getElementById('btn-save-options').onclick = () => {
    const savedIndex = STATE.selectedIndex; // Preserve selection
    playSystemSound('o-close');
    ui.modalOptions.classList.remove('open');
    STATE.isOptionsOpen = false;
    STATE.isOptionsPersistent = false;
    savePlayerOptions();
    renderSongList(); // Refresh in case key mode filter changed
    STATE.selectedIndex = Math.min(savedIndex, STATE.currentList.length - 1); // Restore selection
    updateSelection();
};

// Filter button handlers
document.getElementById('btn-diff-filter').onclick = () => {
    playSystemSound('difficulty');
    const filters = ['ALL', 'BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];
    let idx = filters.indexOf(STATE.difficultyFilter);
    STATE.difficultyFilter = filters[(idx + 1) % filters.length];
    savePlayerOptions();
    renderSongList();
};

document.getElementById('btn-km-filter').onclick = () => {
    playSystemSound('o-change');
    const filters = ['ALL', '单', '5', '7', '9', '双', '10', '14'];
    let idx = filters.indexOf(STATE.keyModeFilter);
    STATE.keyModeFilter = filters[(idx + 1) % filters.length];
    savePlayerOptions();
    renderSongList();
};

document.getElementById('btn-sort').onclick = () => {
    playSystemSound('o-change');
    const modes = ['DEFAULT', 'TITLE', 'LEVEL', 'LAMP'];
    let idx = modes.indexOf(STATE.sortMode);
    STATE.sortMode = modes[(idx + 1) % modes.length];
    savePlayerOptions();
    renderSongList();
};

// Scan Library button - Open Library Folders Modal
document.getElementById('btn-scan-lib').onclick = async () => {
    if (IS_DESKTOP) {
        playSystemSound('o-open');
        document.getElementById('modal-folders').classList.add('open');
        await renderFolderList();
    } else {
        document.getElementById('file-picker').click();
    }
};

// Library Folders Modal Handlers
const folderListEl = document.getElementById('folder-list');
const progressSection = document.getElementById('progress-section');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressStatus = document.getElementById('progress-status');

async function renderFolderList() {
    const folders = await window.electronAPI.getLibraryFolders();
    folderListEl.innerHTML = '';

    if (folders.length === 0) {
        folderListEl.innerHTML = '<div class="no-folders">No folders added yet</div>';
        return;
    }

    folders.forEach(folder => {
        const div = document.createElement('div');
        div.className = 'folder-item';
        div.innerHTML = `
                    <span class="folder-path">${folder}</span>
                    <button class="folder-remove-btn" data-folder="${folder}">Remove</button>
                `;
        folderListEl.appendChild(div);
    });

    // Wire up remove buttons
    folderListEl.querySelectorAll('.folder-remove-btn').forEach(btn => {
        btn.onclick = async () => {
            await window.electronAPI.removeLibraryFolder(btn.dataset.folder);
            await renderFolderList();
        };
    });
}

document.getElementById('btn-add-folder').onclick = async () => {
    const folder = await window.electronAPI.addLibraryFolder();
    if (folder) {
        await renderFolderList();
        // Auto-rescan after adding
        await rescanAllFolders();
    }
};

document.getElementById('btn-rescan-all').onclick = async () => {
    await rescanAllFolders();
};

document.getElementById('btn-close-folders').onclick = () => {
    playSystemSound('o-close');
    document.getElementById('modal-folders').classList.remove('open');
};

async function rescanAllFolders() {
    progressSection.style.display = 'block';
    progressBarFill.style.width = '0%';
    progressStatus.textContent = 'Starting scan...';

    const songs = await window.electronAPI.rescanAllFolders();
    loadLibraryFromDesktop(songs);

    // Hide progress after a short delay
    setTimeout(() => {
        progressSection.style.display = 'none';
    }, 1500);
}

// Listen for progress updates from main process
if (IS_DESKTOP) {
    window.electronAPI.onScanProgress((data) => {
        const percent = data.total > 0 ? (data.current / data.total * 100) : 0;
        progressBarFill.style.width = `${percent}%`;
        progressStatus.textContent = data.status;
    });
}

// File picker (Web mode)
document.getElementById('file-picker').addEventListener('change', async (e) => {
    STATE.files = {};
    STATE.charts = [];
    ui.songList.innerHTML = '';

    const list = Array.from(e.target.files);
    for (let f of list) dataLayer.webFiles[f.name.toLowerCase()] = f;

    const bmsFiles = list.filter(f => f.name.match(/\.(bms|bme|bml|pms)$/i));

    for (let f of bmsFiles) {
        try {
            const txt = await dataLayer.readFile(f);
            const titleMatch = txt.match(/#TITLE\s+(.+)/i);
            const artistMatch = txt.match(/#ARTIST\s+(.+)/i);
            const levelMatch = txt.match(/#PLAYLEVEL\s+(\d+)/i);
            const diffMatch = txt.match(/#DIFFICULTY\s+(\d+)/i);

            // Determine key mode from filename or channels
            let keyMode = '7'; // Default
            const fname = f.name.toLowerCase();
            if (fname.includes('_dp') || fname.includes('14k') || fname.match(/\d{2}14/)) keyMode = '14';
            else if (fname.includes('_10k') || fname.includes('10k')) keyMode = '10';
            else if (fname.includes('_9k') || fname.includes('9k') || fname.endsWith('.pms')) keyMode = '9';
            else if (fname.includes('_5k') || fname.includes('5k')) keyMode = '5';
            else if (fname.includes('_7k') || fname.includes('7k')) keyMode = '7';

            STATE.charts.push({
                fileRef: f,
                title: titleMatch ? titleMatch[1].trim() : 'Unknown',
                artist: artistMatch ? artistMatch[1].trim() : 'Unknown',
                level: levelMatch ? parseInt(levelMatch[1]) : 0,
                difficulty: diffMatch ? parseInt(diffMatch[1]) : 0,
                keyMode: keyMode,
                raw: txt
            });
        } catch (e) { }
    }
    renderSongList();
});

// Start button
ui.btnStart.onclick = () => triggerDecideScreen(false);

function triggerDecideScreen(isAutoplay) {
    if (STATE.isStarting || STATE.isPlaying) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (STATE.loadedSong) {
        STATE.isStarting = true;
        STATE.autoplay = isAutoplay;
        STATE.isDecideActive = true;

        // Stop select loop
        if (STATE.selectBgmSource) {
            try { STATE.selectBgmSource.stop(); } catch (e) { }
            STATE.selectBgmSource = null;
        }

        playSystemSound('decide');

        // Set text
        ui.decideTitle.textContent = ui.titleMain.textContent;
        ui.decideArtist.textContent = STATE.loadedSong.headers['ARTIST'] || 'Unknown';

        // Update Window Title for Gameplay
        updateWindowTitle(STATE.loadedSong);

        // Show screen
        ui.screenDecide.style.display = 'flex';
        ui.screenDecide.classList.remove('fade-out');

        // Decide screen skip handler
        const skipDecide = () => {
            if (!STATE.isDecideActive) return;
            clearTimeout(STATE.decideTimeout);
            STATE.isDecideActive = false;
            ui.screenDecide.classList.add('fade-out');
            enterGame();
            setTimeout(() => {
                ui.screenDecide.style.display = 'none';
                // Removed premature isStarting reset
            }, 500);
            window.removeEventListener('keydown', decideKeyHandler);
        };

        // Cancel decide and return to select
        const cancelDecide = () => {
            if (!STATE.isDecideActive) return;
            clearTimeout(STATE.decideTimeout);
            STATE.isDecideActive = false;
            STATE.isStarting = false;
            ui.screenDecide.classList.add('fade-out');
            setTimeout(() => {
                ui.screenDecide.style.display = 'none';
                // Restart select BGM
                if (!STATE.selectBgmSource) {
                    STATE.selectBgmSource = playSystemSound('select', true);
                }
                updateWindowTitle(null);
            }, 500);
            window.removeEventListener('keydown', decideKeyHandler);
        };

        const decideKeyHandler = (e) => {
            if (!STATE.isDecideActive) return;
            if (e.code === 'Escape') {
                cancelDecide();
            } else {
                skipDecide();
            }
        };

        // Add listener for skip/cancel
        setTimeout(() => {
            window.addEventListener('keydown', decideKeyHandler);
        }, 100); // Small delay to avoid catching the triggering key

        // Normal timeout transition
        STATE.decideTimeout = setTimeout(() => {
            if (!STATE.isDecideActive) return;
            STATE.isDecideActive = false;
            ui.screenDecide.classList.add('fade-out');
            enterGame();
            setTimeout(() => {
                ui.screenDecide.style.display = 'none';
                // Removed premature isStarting reset
            }, 500);
            window.removeEventListener('keydown', decideKeyHandler);
        }, 1500);
    }
}

function updateWindowTitle(chart) {
    const base = "LYRUANNA - BMS Player";
    let newTitle = base;

    if (chart) {
        const title = chart.headers['TITLE'] || 'Unknown';
        const subtitle = chart.headers['SUBTITLE'] || '';
        newTitle = `LYRUANNA - ${title}${subtitle ? ' [' + subtitle + ']' : ''}`;
    }

    // Update custom HTML titlebar
    const titlebarText = document.querySelector('.titlebar-title');
    if (titlebarText) titlebarText.textContent = newTitle;

    // Update Electron window title
    if (IS_DESKTOP && window.electronAPI.setWindowTitle) {
        window.electronAPI.setWindowTitle(newTitle);
    }
}

function loadLibraryFromDesktop(data) {
    const songs = data.songs || data; // handle both formats
    STATE.charts = songs.map(s => ({
        title: s.title,
        artist: s.artist,
        level: s.level || 0,
        difficulty: s.difficulty || 0,
        keyMode: s.keyMode || '7',
        md5: s.md5, // New
        fileRef: s.path,
        rootDir: s.rootDir,
        raw: null
    }));
    STATE.courses = data.courses || [];
    renderSongList();
}

function renderSongList() {
    ui.songList.innerHTML = '';
    STATE.currentList = [];

    const getCategoryName = (c) => {
        if (IS_DESKTOP) {
            const f = c.fileRef.replace(/\\/g, '/');
            const r = (c.rootDir || '').replace(/\\/g, '/').replace(/\/$/, '');
            const parentDir = f.substring(0, f.lastIndexOf('/'));
            const grandDir = parentDir.substring(0, parentDir.lastIndexOf('/'));
            if (!r || grandDir.toLowerCase().length <= r.toLowerCase().length) {
                const rootParts = r.split('/').filter(p => p);
                return rootParts[rootParts.length - 1] || 'Library';
            }
            return grandDir.substring(grandDir.lastIndexOf('/') + 1);
        } else {
            const parts = c.fileRef.webkitRelativePath ? c.fileRef.webkitRelativePath.split('/') : [];
            return parts.length >= 3 ? parts[parts.length - 3] : 'Library';
        }
    };
    const addToList = (type, data, el) => {
        STATE.currentList.push({ type, data, el });
        ui.songList.appendChild(el);
    };

    // 1. Root Directory View
    if (STATE.currentFolder === null) {
        // ALWAYS show CLASS folder first
        const classDiv = document.createElement('div');
        classDiv.className = 'song-card folder folder-class';
        classDiv.innerHTML = `
                    <div class="song-card-lamp"></div>
                    <div class="song-card-content">
                        <div class="song-card-title">CLASS</div>
                        <div class="song-card-artist">COURSES</div>
                    </div>
                `;
        classDiv.onclick = () => { STATE.currentFolder = 'CLASS'; STATE.selectedIndex = 0; playSystemSound('f-open'); renderSongList(); };
        addToList('folder', { name: 'CLASS', count: STATE.courses.length, type: 'COURSE' }, classDiv);

        const folderSet = new Set();
        STATE.charts.forEach(c => folderSet.add(getCategoryName(c)));

        Array.from(folderSet).sort().forEach(folder => {
            const count = STATE.charts.filter(c => getCategoryName(c) === folder).length;
            const div = document.createElement('div');
            div.className = 'song-card folder';
            div.innerHTML = `
                        <div class="song-card-lamp"></div>
                        <div class="song-card-content">
                            <div class="song-card-title">${folder}</div>
                            <div class="song-card-artist">FOLDER</div>
                        </div>
                    `;
            div.onclick = () => { STATE.currentFolder = folder; STATE.selectedIndex = 0; playSystemSound('f-open'); renderSongList(); };
            addToList('folder', { name: folder, count: count, type: 'CATEGORY' }, div);
        });
        ui.songCount.textContent = STATE.currentList.length;
    }
    // 2. CLASS (Courses) View
    else if (STATE.currentFolder === 'CLASS') {
        // Back navigation is now via Escape key only - no '..' folder shown

        STATE.courses.forEach(course => {
            const div = document.createElement('div');
            div.className = 'song-card folder-class';
            div.innerHTML = `<div class="song-card-lamp"></div><div class="song-card-content"><div class="song-card-title">${course.title}</div><div class="song-card-artist">${course.hashes.length} STAGES</div></div>`;
            div.onclick = () => {
                STATE.activeCourse = course; STATE.courseIndex = 0;
                const song = STATE.charts.find(c => c.md5 === course.hashes[0]);
                if (song) loadChart(STATE.charts.indexOf(song), div, true);
            };
            addToList('course', course, div);
        });
        ui.songCount.textContent = STATE.courses.length;
    }
    // 3. Category (Songs) View
    else {
        // Back navigation is now via Escape key only - no '..' folder shown

        const diffTierNames = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];
        const diffIdx = diffTierNames.indexOf(STATE.difficultyFilter) + 1;
        const filtered = STATE.charts.filter(c => {
            if (getCategoryName(c) !== STATE.currentFolder) return false;
            if (STATE.difficultyFilter !== 'ALL' && c.difficulty !== diffIdx) return false;
            if (STATE.keyModeFilter !== 'ALL') {
                if (STATE.keyModeFilter === '单' && (c.keyMode === '10' || c.keyMode === '14')) return false;
                if (STATE.keyModeFilter === '双' && (c.keyMode !== '10' && c.keyMode !== '14')) return false;
                if (['5', '7', '9', '10', '14'].includes(STATE.keyModeFilter) && c.keyMode !== STATE.keyModeFilter) return false;
            }
            return true;
        });

        const sortModes = {
            TITLE: (a, b) => a.title.localeCompare(b.title),
            LEVEL: (a, b) => (b.level || 0) - (a.level || 0),
            LAMP: (a, b) => {
                const order = { 'max': 9, 'perfect': 8, 'fc': 7, 'ex-hard': 6, 'hard': 5, 'clear': 4, 'easy': 3, 'assist': 2, 'failed': 1, 'no-play': 0 };
                return (order[getLamp(b.fileRef).class] || 0) - (order[getLamp(a.fileRef).class] || 0);
            }
        };
        if (sortModes[STATE.sortMode]) filtered.sort(sortModes[STATE.sortMode]);

        const diffColors = ['#5ff', '#0f0', '#fa0', '#f00', '#f0f'];
        filtered.forEach(c => {
            const lamp = getLamp(c.fileRef);
            const diffColor = c.difficulty > 0 && c.difficulty <= 5 ? diffColors[c.difficulty - 1] : '#888';
            const div = document.createElement('div');
            div.className = 'song-card';

            div.innerHTML = `
                        <div class="song-card-lamp ${lamp.class}"></div>
                        <div class="song-card-content">
                            <div class="song-card-title">${c.title}</div>
                            <div class="song-card-artist">${c.artist}</div>
                        </div>
                        <div class="song-card-info">
                            <span class="song-card-level" style="color:${diffColor}; background:transparent; font-size:24px; font-family: 'Century Gothic', monospace; font-weight: 900;">${(c.level !== undefined && c.level !== null) ? c.level : '?'}</span>
                            <span class="song-card-keymode">${c.keyMode || '7'}K</span>
                        </div>
                    `;
            div.onclick = () => {
                // Find the index in the current list and update selection
                const listIndex = STATE.currentList.findIndex(item => item.type === 'chart' && item.data === c);
                if (listIndex !== -1) {
                    STATE.selectedIndex = listIndex;
                    updateSelection();
                }
            };
            addToList('chart', c, div);
        });
        ui.songCount.textContent = filtered.length;
    }

    // Update filter displays
    document.getElementById('diff-filter').textContent = STATE.difficultyFilter;
    const kmFilterEl = document.getElementById('km-filter');
    if (kmFilterEl) kmFilterEl.textContent = STATE.keyModeFilter === '单' ? 'SINGLE' : (STATE.keyModeFilter === '双' ? 'DOUBLE' : STATE.keyModeFilter);
    const sortModeEl = document.getElementById('sort-mode');
    if (sortModeEl) sortModeEl.textContent = STATE.sortMode;

    if (STATE.selectedIndex >= STATE.currentList.length) STATE.selectedIndex = Math.max(0, STATE.currentList.length - 1);
    updateSelection();
}

function updateSelection() {
    STATE.currentList.forEach((item, idx) => {
        item.el.classList.toggle('focused', idx === STATE.selectedIndex);
        if (idx === STATE.selectedIndex) {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            updateInfoCard(item);
        }
    });
}

async function updateInfoCard(item) {
    if (item.type === 'chart') {
        const chart = item.data;
        loadChart(STATE.charts.indexOf(chart), item.el, true); // true = focus only
        ui.bannerArea.innerHTML = '<span class="banner-placeholder">Category selected</span>';

        // Display Best Score
        const bestScoreData = getBestScore(chart.fileRef);
        const lamp = getLamp(chart.fileRef);
        const bestArea = document.getElementById('song-best-score');
        const bestContent = document.getElementById('best-score-content');
        const bestEmpty = document.getElementById('best-score-empty');

        if (bestArea) {
            bestArea.style.opacity = '1';
            bestArea.style.height = 'auto';

            if (bestScoreData && bestScoreData.exScore > 0) {
                // Show score content, hide empty message
                if (bestContent) bestContent.style.display = 'flex';
                if (bestEmpty) bestEmpty.style.display = 'none';

                const lampEl = document.getElementById('best-lamp');
                lampEl.className = 'lamp ' + lamp.class;

                const totalNotes = chart.noteCount || 100;
                const rate = bestScoreData.rate || ((bestScoreData.exScore / Math.max(1, totalNotes * 2)) * 100);
                const grade = bestScoreData.rank || calculateRank(rate);

                document.getElementById('best-grade').textContent = grade;
                document.getElementById('best-grade').style.color = getRankColor(grade);
                document.getElementById('best-ex-score').textContent = bestScoreData.exScore;
                document.getElementById('best-rate').textContent = rate.toFixed(2) + '%';
            } else {
                // Hide score content, show empty message
                if (bestContent) bestContent.style.display = 'none';
                if (bestEmpty) bestEmpty.style.display = 'block';
            }
        }
    } else if (item.type === 'course') {
        ui.titleMain.textContent = item.data.title;
        ui.subtitle.textContent = 'COURSE';
        ui.artistGenre.textContent = `${item.data.hashes.length} STAGES`;
        ui.diffDisplay.style.display = 'none';
        ui.songStats.style.display = 'none';
        ui.songMarkers.innerHTML = '';
        ui.btnStart.disabled = true; // Can implement course play later
        ui.stagefileArea.style.backgroundImage = '';
        ui.selectBg.style.backgroundImage = '';

        // Hide best score for courses
        const bestArea = document.getElementById('song-best-score');
        if (bestArea) {
            bestArea.style.opacity = '0';
            bestArea.style.height = '0';
        }

        // Verify Songs
        let html = '<div style="font-size:14px; text-align:left; padding:10px;">';
        let missingCount = 0;

        item.data.hashes.forEach((hash, idx) => {
            const song = STATE.charts.find(c => c.md5 === hash);
            const color = song ? '#4f4' : '#f44';
            const title = song ? `${song.title} <span style="font-size:0.8em; color:#888;">/ ${song.artist}</span>` : 'MISSING DATA (Not in library)';
            html += `<div style="margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="color:#888; margin-right:8px;">STAGE ${idx + 1}</span>
                        <span style="color:${color}; font-weight:bold;">${song ? 'FOUND' : 'MISSING'}</span>
                        <span style="margin-left:8px;">${title}</span>
                    </div>`;
            if (!song) missingCount++;
        });

        if (missingCount > 0) {
            html += `<div style="margin-top:10px; color:#f44; font-weight:bold; border-top:1px solid #444; padding-top:5px;">
                        ⚠️ ${missingCount} song(s) missing from library.
                    </div>`;
        } else {
            html += `<div style="margin-top:10px; color:#4f4; font-weight:bold; border-top:1px solid #444; padding-top:5px;">
                        Contains all songs. Ready!
                    </div>`;
        }
        html += '</div>';
        ui.bannerArea.innerHTML = html;
    } else if (item.type === 'folder') {
        ui.titleMain.textContent = item.data.name;
        ui.subtitle.textContent = 'CATEGORY';
        ui.artistGenre.textContent = `${item.data.count} ITEMS`;
        ui.diffDisplay.style.display = 'none';
        ui.songStats.style.display = 'none';
        ui.songMarkers.innerHTML = '';
        ui.btnStart.disabled = true;
        ui.stagefileArea.style.backgroundImage = '';
        ui.selectBg.style.backgroundImage = '';
        ui.bannerArea.innerHTML = '<span class="banner-placeholder">Category selected</span>';

        // Hide best score for folders
        const bestArea = document.getElementById('song-best-score');
        if (bestArea) {
            bestArea.style.opacity = '0';
            bestArea.style.height = '0';
        }
    } else if (item.type === 'back') {
        ui.titleMain.textContent = '.. [BACK]';
        ui.subtitle.textContent = 'RETURN';
        ui.artistGenre.textContent = 'Go up one level';
        ui.diffDisplay.style.display = 'none';
        ui.songStats.style.display = 'none';
        ui.btnStart.disabled = true;

        // Hide best score for back item
        const bestArea = document.getElementById('song-best-score');
        if (bestArea) {
            bestArea.style.opacity = '0';
            bestArea.style.height = '0';
        }
    }
}

function updateOptionsUI() {
    if (!STATE.isOptionsOpen) return;

    const hsValEl = document.getElementById('opt-hispeed-val');
    if (hsValEl) hsValEl.textContent = STATE.speed.toFixed(1);
    const hsFixEl = document.getElementById('opt-hsfix-val');
    if (hsFixEl) hsFixEl.textContent = `FIX: ${STATE.hiSpeedFix}`;

    // Render Wheels
    Object.keys(OPTIONS_KEYS).forEach(wheelId => {
        renderWheel(wheelId);
    });

    // Target Wheel (Seamless with Snapping)
    if (ui.targetWheel) {
        const totalSets = 5;
        const setSize = PACEMAKER_TARGETS.length;
        const itemHeight = 40;
        const centerOffset = 80;

        // 1. Initialize logic/DOM if needed
        if (typeof STATE.pacemakerVisualIndex === 'undefined') {
            const currentLogicIdx = PACEMAKER_TARGETS.indexOf(STATE.pacemakerTarget);
            STATE.pacemakerVisualIndex = (setSize * 2) + Math.max(0, currentLogicIdx);
        }

        if (ui.targetWheel.children.length !== setSize * totalSets) {
            ui.targetWheel.innerHTML = '';
            for (let s = 0; s < totalSets; s++) {
                PACEMAKER_TARGETS.forEach(target => {
                    const item = document.createElement('div');
                    item.className = 'iidx-target-item';
                    item.textContent = target;
                    ui.targetWheel.appendChild(item);
                });
            }
            // Disable transition for initialization
            ui.targetWheel.classList.add('no-transition');
            const targetPos = STATE.pacemakerVisualIndex * itemHeight;
            ui.targetWheel.style.transform = `translateY(${centerOffset - targetPos}px)`;
            ui.targetWheel.offsetHeight; // force reflow
            ui.targetWheel.classList.remove('no-transition');
        }

        // 2. Snapping Logic: Only snap if we drift to the extreme sets (0 or 4)
        // We want to allow smooth scrolling into Set 1 or Set 3.
        if (STATE.pacemakerVisualIndex < setSize || STATE.pacemakerVisualIndex >= setSize * 4) {
            ui.targetWheel.classList.add('no-transition');

            // Equivalent position in Set 2
            const modIdx = ((STATE.pacemakerVisualIndex % setSize) + setSize) % setSize;
            STATE.pacemakerVisualIndex = (setSize * 2) + modIdx;

            const snapPos = STATE.pacemakerVisualIndex * itemHeight;
            ui.targetWheel.style.transform = `translateY(${centerOffset - snapPos}px)`;
            ui.targetWheel.offsetHeight; // force reflow
            ui.targetWheel.classList.remove('no-transition');
        }

        // 3. Final Position Update (with transition if it was a user click)
        const targetPos = STATE.pacemakerVisualIndex * itemHeight;
        ui.targetWheel.style.transform = `translateY(${centerOffset - targetPos}px)`;

        // 4. Update highlights
        Array.from(ui.targetWheel.children).forEach((child, i) => {
            child.classList.toggle('selected', i === STATE.pacemakerVisualIndex);
        });
    }
}

function renderWheel(wheelId) {
    const container = document.getElementById(wheelId);
    if (!container) return;
    const strip = container.querySelector('.option-wheel-strip');
    if (!strip) return;

    const config = OPTIONS_KEYS[wheelId];
    if (!config) return;

    const currentVal = STATE[config.key];
    const idx = config.items.findIndex(i => i.val === currentVal);
    const len = config.items.length;

    // Calculate cyclic indices
    const prevIdx = (idx - 1 + len) % len;
    const nextIdx = (idx + 1) % len;

    // Create visible items: Prev, Curr, Next
    // We rebuild DOM for simplicity in cyclic logic
    strip.innerHTML = '';

    const visibleIndices = [prevIdx, idx, nextIdx];
    visibleIndices.forEach((i, pos) => {
        const item = config.items[i];
        const el = document.createElement('div');
        el.className = 'option-wheel-item';
        el.textContent = item.lbl;

        if (pos === 1) el.classList.add('selected'); // Middle item

        // Allow clicking adjacent items to scroll
        if (pos === 0) el.onclick = (e) => { e.stopPropagation(); stepOption(config.key, -1); };
        if (pos === 2) el.onclick = (e) => { e.stopPropagation(); stepOption(config.key, 1); };

        strip.appendChild(el);
    });

    // Reset transform calculation since we are now statically placing 3 items
    // But strict placement: Item height 40px. 
    // 3 items stack: 0-40, 40-80, 80-120.
    // This fills the 120px container perfectly.
    strip.style.transform = 'none';
}

function setOption(key, val) {
    STATE[key] = val;
    savePlayerOptions();
    updateOptionsUI();

    if (key === 'keyModeFilter' || key === 'difficultyFilter') {
        STATE.optionsChangedFilter = true;
    }
}

// Wheel Interaction (Click on top/bottom areas to scroll)
// Delegate click for the wheel box to handle prev/next if clicking empty space
document.addEventListener('click', (e) => {
    const box = e.target.closest('.option-wheel-box');
    if (!box) return;
    const wheelId = box.id;
    const config = OPTIONS_KEYS[wheelId];
    if (!config) return;

    // If clicked directly on the box (not on an item, though items cover most),
    // or we might want to support clicking transparent areas.
    // But let's rely on item clicks logic above. 
    // We can add simple wheel scroll support
});

document.addEventListener('wheel', (e) => {
    const box = e.target.closest('.option-wheel-box');
    if (!box) return;
    if (!STATE.isOptionsOpen) return;

    const wheelId = box.id;
    const config = OPTIONS_KEYS[wheelId];
    if (!config) return;

    e.preventDefault();

    if (e.deltaY > 0) stepOption(config.key, 1); // Down -> Next
    else if (e.deltaY < 0) stepOption(config.key, -1); // Up -> Prev
}, { passive: false });

function stepOption(key, dir) {
    // Find which wheel
    let wheelId = null;
    let config = null;
    for (const [id, c] of Object.entries(OPTIONS_KEYS)) {
        if (c.key === key) { config = c; wheelId = id; break; }
    }
    if (!config) return;

    const currentVal = STATE[key];
    const idx = config.items.findIndex(i => i.val === currentVal);

    // Cyclic Wrapping
    let nextIdx = (idx + dir) % config.items.length;
    if (nextIdx < 0) nextIdx += config.items.length;

    if (nextIdx !== idx) {
        setOption(key, config.items[nextIdx].val);
        playSystemSound('o-change');
    }
}

function closeOptions() {
    if (!STATE.isOptionsOpen) return;
    playSystemSound('o-close');
    ui.modalOptions.classList.remove('open');
    STATE.isOptionsOpen = false;

    if (STATE.optionsChangedFilter) {
        renderSongList();
        STATE.optionsChangedFilter = false;
    }
}

function drawWiringLines() {
    const svg = document.getElementById('iidx-wiring-svg');
    const guide = document.getElementById('iidx-keyboard-guide');
    const grid = document.querySelector('.iidx-options-grid');
    if (!svg || !guide || !grid) return;

    svg.innerHTML = '';
    const guideRect = guide.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();

    // Key-to-Column mapping
    // Columns IDs are still the same, but now we map keys to wheel functionality
    // 1->mode, 2->style, 4->gauge, 6->assist, 6+7->range
    // 5->hispeed, 7->hispeed
    const keyToCol = {
        1: 'sec-mode',
        2: 'sec-style',
        3: 'sec-battle',
        4: 'sec-gauge',
        5: 'sec-hispeed',
        6: 'sec-assist',
        7: 'sec-hispeed'
    };

    const keys = guide.querySelectorAll('.iidx-key');
    let lineIndex = 0;
    keys.forEach(key => {
        const keyNum = parseInt(key.dataset.key);
        const colId = keyToCol[keyNum];
        const colEl = document.getElementById(colId);
        if (!colEl) return; // Should exist

        const keyRect = key.getBoundingClientRect();
        const colRect = colEl.getBoundingClientRect();

        // Calculate positions
        const x1 = keyRect.left + keyRect.width / 2 - guideRect.left;
        const y1 = keyRect.bottom - guideRect.top + 5;

        // Align to center of column
        const x2 = colRect.left + colRect.width / 2 - guideRect.left;

        // Adjust Y2 to point to the wheel box top, not the section text
        // Attempt to find the wheel box inside
        let y2 = gridRect.top - guideRect.top; // default top of grid
        const wheelBox = colEl.querySelector('.option-wheel-box');
        if (wheelBox) {
            const wbRect = wheelBox.getBoundingClientRect();
            y2 = wbRect.top - guideRect.top;
        }

        // 90-degree turn
        const midY = y1 + 10 + lineIndex * 6;
        lineIndex++;

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', `${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`);
        svg.appendChild(polyline);
    });
}

async function loadChart(idx, el, focusOnly = false) {
    if (el) {
        document.querySelectorAll('.song-card').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
    }

    const c = STATE.charts[idx];
    let bmsText = c.raw;
    if (!bmsText) {
        // Show loading indicator locally if not from desktop scan
        if (!IS_DESKTOP) ui.loadingStatus.textContent = "Reading file...";
        bmsText = await dataLayer.readFile(c.fileRef);
        c.raw = bmsText;
    }

    // Parse using Worker
    if (!focusOnly) {
        ui.screenLoading.classList.remove('gameplay-loading');
        ui.screenLoading.style.display = 'flex';
        ui.screenLoading.style.opacity = '1';
        ui.loadingStatus.textContent = "Parsing Chart...";
        ui.loadingBar.style.width = '20%';
    }

    // Clear stale stagefile/banner immediately to prevent carryover
    ui.stagefileArea.style.backgroundImage = '';
    ui.selectBg.style.backgroundImage = '';
    ui.bannerArea.innerHTML = '<span class="banner-placeholder">Loading...</span>';
    STATE.stagefileUrl = null;
    STATE.bannerUrl = null;

    // Display library metadata immediately while parsing (prevents freeze appearance)
    ui.titleMain.textContent = c.title || 'Loading...';
    ui.artistGenre.textContent = c.artist || '...';
    ui.subtitle.textContent = '';
    ui.diffLevel.textContent = c.level !== undefined ? c.level : '?';
    ui.songStats.style.display = 'none'; // Hide stats until parsed

    try {
        const data = await parseChartAsync(bmsText); // Worker call

        // STALENESS CHECK: If this card is no longer active (user selected another), discard
        if (el && !el.classList.contains('active')) {
            // console.log("Discarding stale chart load:", c.title);
            return;
        }

        STATE.baseSongData = data; // Immutable source
        // Propagate detected keyMode from library to base data
        STATE.baseSongData.keyMode = c.keyMode || '7';

        STATE.loadedSong = structuredClone(data); // Working copy
        // Also ensures loadedSong has it immediately (though clone should carry it if set above)
        STATE.loadedSong.keyMode = STATE.baseSongData.keyMode;

        STATE.currentFileRef = c.fileRef;
        STATE.replayFileRef = c.fileRef;

        ui.titleMain.textContent = c.title;
        ui.subtitle.textContent = data.headers['SUBTITLE'] || '';
        const genre = data.headers['GENRE'] || '';
        ui.artistGenre.textContent = genre ? `${c.artist} | ${genre}` : c.artist;

        const level = data.headers['PLAYLEVEL'] || data.headers['DIFFICULTY'] || '?';
        const diffTier = parseInt(data.headers['DIFFICULTY']) || 2;
        const tierNames = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];
        const tierColors = ['#5ff', '#0f0', '#fa0', '#f00', '#f0f'];

        ui.diffLevel.textContent = level;
        ui.diffLevel.style.color = tierColors[Math.min(diffTier - 1, 4)] || '#fff';
        ui.diffTier.textContent = tierNames[Math.min(diffTier - 1, 4)] || 'NORMAL';

        // Star Logic
        const numLevel = parseInt(level) || 0;
        ui.diffStars.className = 'diff-stars'; // Reset class
        ui.diffStars.innerHTML = ''; // Reset content

        if (c.keyMode === '9' || (c.keyMode === '10' && c.level > 12) || (c.keyMode === '14' && c.level > 12)) {
            // 9-Key / PMS Logic
            // "10 bars of 5" -> 50 stars max.
            const maxStars = 50;
            const starsToShow = Math.max(0, Math.min(numLevel, maxStars));

            let starStr = '';
            for (let i = 0; i < starsToShow; i++) {
                if (i > 0 && i % 5 === 0) starStr += '<span style="display:inline-block; width:8px;"></span>';
                starStr += '★';
            }
            ui.diffStars.innerHTML = starStr;
            ui.diffStars.style.whiteSpace = 'nowrap'; // Ensure single line
            // ui.diffStars.style.fontSize = '10px'; // Keep smaller size for fitting 50 stars
            ui.diffStars.style.fontSize = '10px';
            ui.diffStars.style.lineHeight = '';

            if (numLevel > 50) {
                ui.diffStars.classList.add('rainbow-text');
            }
        } else if (c.keyMode === '5') {
            // 5-Key Logic (Max 9)
            const maxStars = 9;
            const starsToShow = Math.max(0, Math.min(numLevel, maxStars));
            ui.diffStars.textContent = '★'.repeat(starsToShow);
            ui.diffStars.style.lineHeight = '';
            ui.diffStars.style.fontSize = '';

            if (numLevel > 9) {
                ui.diffStars.classList.add('rainbow-text');
            }
        } else {
            // Standard Logic
            const maxStars = 12;
            const starsToShow = Math.max(0, Math.min(numLevel, maxStars));
            ui.diffStars.textContent = '★'.repeat(starsToShow);
            ui.diffStars.style.lineHeight = '';
            ui.diffStars.style.fontSize = ''; // Reset

            if (numLevel > 12) {
                ui.diffStars.classList.add('rainbow-text');
            }
        }

        ui.diffDisplay.style.display = 'flex';

        const rankName = ["VERY HARD", "HARD", "NORMAL", "EASY"][data.rank] || "EASY";
        const bpms = data.bpmEvents.map(e => e.bpm);
        bpms.push(data.initialBpm);
        const minBpm = Math.min(...bpms);
        const maxBpm = Math.max(...bpms);
        ui.statBpm.textContent = minBpm === maxBpm ? Math.round(minBpm) : `${Math.round(minBpm)} - ${Math.round(maxBpm)}`;
        ui.statNotes.textContent = data.noteCount;
        ui.statNpsAvg.textContent = data.avgNps.toFixed(1);
        ui.statNpsMax.textContent = data.maxNps;
        ui.statRank.textContent = rankName;
        ui.songStats.style.display = 'grid';

        ui.songMarkers.innerHTML = '';
        if (data.headers['LNTYPE'] || data.headers['LNOBJ']) ui.songMarkers.innerHTML += '<span class="marker marker-ln">LN</span>';
        if (data.headers['RANDOM']) ui.songMarkers.innerHTML += '<span class="marker marker-ran">RAN</span>';

        if (IS_DESKTOP) {
            const stagefileUrl = await window.electronAPI.resolveImage(STATE.currentFileRef, data.headers['STAGEFILE']);
            const bannerUrl = await window.electronAPI.resolveImage(STATE.currentFileRef, data.headers['BANNER']);

            // Re-check staleness after async image resolution
            if (el && !el.classList.contains('active')) return;

            if (stagefileUrl) {
                ui.stagefileArea.style.backgroundImage = `url('${stagefileUrl}')`;
                ui.selectBg.style.backgroundImage = `url('${stagefileUrl}')`;
                STATE.stagefileUrl = stagefileUrl;
            } else {
                ui.stagefileArea.style.backgroundImage = '';
                ui.selectBg.style.backgroundImage = '';
                STATE.stagefileUrl = null;
            }
            if (bannerUrl) {
                ui.bannerArea.innerHTML = `<img src="${bannerUrl}">`;
                STATE.bannerUrl = bannerUrl;
            } else {
                ui.bannerArea.innerHTML = '<span class="banner-placeholder">No Banner</span>';
                STATE.bannerUrl = null;
            }
        }

        ui.btnStart.disabled = false;

        // Replay Button Logic
        const replayData = getReplay(c.fileRef);
        const btnReplay = document.getElementById('btn-replay');
        if (btnReplay) {
            btnReplay.disabled = !replayData;
            btnReplay.style.opacity = replayData ? '1' : '0.5';
            btnReplay.title = replayData ? `Replay: ${replayData.score} (${replayData.isFC ? 'FC' : 'Clear'})` : 'No Replay Data';
        }

        if (!focusOnly) {
            await loadAudioResources(data);
        }

    } catch (e) {
        if (el && !el.classList.contains('active')) return; // Ignore error for stale
        console.error("Chart Load Error:", e);
        ui.loadingStatus.textContent = "Error loading chart!";
        setTimeout(() => { ui.screenLoading.style.display = 'none'; }, 2000);
    }
}

async function loadAudioResources(data) {
    STATE.audioBuffers = {};
    STATE.bgaDefinitions = {};
    STATE.isLoadingCancelled = false; // Reset cancellation flag

    // Cancellation Handler
    const cancelHandler = (e) => {
        if (e.code === 'Escape') {
            STATE.isLoadingCancelled = true;
            console.log("Loading cancelled by user.");
        }
    };
    window.addEventListener('keydown', cancelHandler);

    try {
        // Collect Audio & BGA Files
        const loadingTasks = [];
        for (let k in data.headers) {
            if (k.startsWith('WAV')) {
                loadingTasks.push({ type: 'audio', key: k, id: k.substring(3).toUpperCase(), filename: data.headers[k] });
            }
            if (k.startsWith('BMP')) {
                let id = k.substring(3).toUpperCase();
                // Normalize to 2-chars if 1-char (e.g., #BMP1 -> id 01)
                if (id.length === 1) id = '0' + id;
                loadingTasks.push({ type: 'bga', key: k, id: id, filename: data.headers[k] });
            }
        }

        // CHUNKED LOADING
        const isGameplay = ui.screenLoading.classList.contains('gameplay-loading');
        const totalTasks = loadingTasks.length;
        const statusPrefix = isGameplay ? 'Now Loading: ' : 'Loading Resources (0/' + totalTasks + ')...';

        if (isGameplay) ui.loadingStatus.textContent = statusPrefix + '0%';
        else ui.loadingStatus.textContent = statusPrefix;

        console.log(`DEBUG: Loading tasks: ${totalTasks}`);
        const CHUNK_SIZE = 12;
        for (let i = 0; i < totalTasks; i += CHUNK_SIZE) {
            // Check cancellation
            if (STATE.isLoadingCancelled) {
                throw new Error("CANCELLED");
            }

            const chunk = loadingTasks.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(task => {
                if (task.type === 'audio') {
                    let filePromise;
                    if (IS_DESKTOP) {
                        filePromise = window.electronAPI.resolvePath(STATE.currentFileRef, task.filename).then(ref => {
                            if (ref) return dataLayer.readAudio(ref);
                            return null;
                        });
                    } else {
                        const f = dataLayer.webFiles[task.filename.toLowerCase()];
                        if (f) filePromise = dataLayer.readAudio(f);
                        else filePromise = Promise.resolve(null);
                    }

                    return filePromise.then(ab => {
                        if (ab) STATE.audioBuffers[task.id] = ab;
                    }).catch(e => console.warn(`Audio ${task.id} error:`, e.message));
                } else {
                    // BGA Task
                    if (IS_DESKTOP) {
                        return window.electronAPI.resolveImage(STATE.currentFileRef, task.filename).then(url => {
                            if (url) STATE.bgaDefinitions[task.id] = {
                                url,
                                isVideo: /\.(mp4|webm|avi|wmv|mpg|mpeg|m4v)$/i.test(task.filename),
                                filename: task.filename
                            };
                        }).catch(e => console.warn(`BGA ${task.id} error:`, e.message));
                    } else {
                        const filename = task.filename.toLowerCase();
                        const file = dataLayer.webFiles[filename];
                        if (file) {
                            const url = URL.createObjectURL(file);
                            STATE.bgaDefinitions[task.id] = { url, isVideo: /\.(mp4|webm|avi|wmv|mpg|mpeg|m4v)$/i.test(filename) };
                        }
                        return Promise.resolve();
                    }
                }
            }));

            // Update Progress
            const progress = Math.min(100, Math.floor(((i + CHUNK_SIZE) / totalTasks) * 100));

            if (isGameplay) {
                ui.loadingStatus.textContent = statusPrefix + progress + '%';
                // Hint for cancellation
                ui.loadingStatus.innerHTML += '<br><span style="font-size:10px; color:#666;">PRESS ESC TO CANCEL</span>';
            } else {
                const uiProgress = Math.min(100, 20 + ((i + CHUNK_SIZE) / totalTasks * 80));
                ui.loadingBar.style.width = `${uiProgress}%`;
                ui.loadingStatus.textContent = `Loading Resources (${Math.min(i + CHUNK_SIZE, totalTasks)}/${totalTasks})...`;
            }

            // Small yield to UI
            await new Promise(r => setTimeout(r, 0));
        }
        console.log("DEBUG: Resource load finished");

        // Done
        // We don't hide the screen here if it's part of a gameplay transition
        // enterGame handles its own hiding. For other callers:
        if (!ui.screenLoading.classList.contains('gameplay-loading')) {
            ui.screenLoading.style.display = 'none';
        }
    } finally {
        window.removeEventListener('keydown', cancelHandler);
    }
}

function renderConfig() {
    const p1 = document.getElementById('col-p1'); const p2 = document.getElementById('col-p2');
    p1.innerHTML = '<h4 style="margin:0 0 10px 0; color:#888;">Player 1</h4>';
    p2.innerHTML = '<h4 style="margin:0 0 10px 0; color:#888;">Player 2</h4>';
    const renderBtn = (action, label, container) => {
        const div = document.createElement('div'); div.className = 'key-row';
        div.innerHTML = `<span>${label}</span>`;
        const btn = document.createElement('button'); btn.className = 'key-btn';
        btn.textContent = KEYBINDS[action];
        btn.onclick = () => {
            btn.textContent = '...'; btn.classList.add('listening');
            const h = (e) => { e.preventDefault(); KEYBINDS[action] = e.code; btn.textContent = e.code; btn.classList.remove('listening'); window.removeEventListener('keydown', h); };
            window.addEventListener('keydown', h, { once: true });
        };
        div.appendChild(btn); container.appendChild(div);
    };
    const global = document.createElement('div');
    global.style.gridColumn = 'span 2';
    global.style.borderTop = '1px solid #333';
    global.style.paddingTop = '10px';
    global.innerHTML = '<h4 style="margin:0 0 10px 0; color:#888;">Global Controls</h4>';
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '20px';
    global.appendChild(row);

    renderBtn(ACTIONS.START, 'START', row);
    renderBtn(ACTIONS.SELECT, 'SELECT', row);
    p1.parentNode.appendChild(global);
    renderBtn(ACTIONS.P1_SC_CCW, "Scratch ↶", p1);
    renderBtn(ACTIONS.P1_SC_CW, "Scratch ↷", p1);
    for (let i = 1; i <= 7; i++) renderBtn(ACTIONS[`P1_${i}`], `Key ${i}`, p1);
    renderBtn(ACTIONS.P2_SC_CCW, "Scratch ↶", p2);
    renderBtn(ACTIONS.P2_SC_CW, "Scratch ↷", p2);
    for (let i = 1; i <= 7; i++) renderBtn(ACTIONS[`P2_${i}`], `Key ${i}`, p2);
}

// ----------------------------------------------------------------------------
// GAME LOOP
// ----------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

async function enterGame() {
    document.getElementById('screen-select').style.display = 'none';
    document.getElementById('screen-game').style.display = 'block';
    resize();

    // Restore fresh chart data from base
    if (STATE.baseSongData) {
        STATE.loadedSong = structuredClone(STATE.baseSongData);
    }

    // Ensure AudioContext is running
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    // Show Loading UI (Centered for gameplay transition)
    ui.screenLoading.classList.add('gameplay-loading');
    ui.screenLoading.style.display = 'flex';
    ui.screenLoading.style.opacity = '1';
    ui.loadingBar.style.width = '0%';
    ui.loadingStatus.textContent = "Preparing Stage...";

    // Load Resources - This now happens AFTER select screen is gone
    try {
        await loadAudioResources(STATE.loadedSong);
    } catch (e) {
        if (e.message === "CANCELLED") {
            console.log("Game Start Cancelled by User");
            // Cleanup UI and Return
            ui.screenLoading.style.display = 'none';
            ui.screenLoading.classList.remove('gameplay-loading');
            document.getElementById('screen-game').style.display = 'none';
            document.getElementById('screen-select').style.display = 'block';
            STATE.isPlaying = false;
            STATE.isStarting = false;

            // Restart BGM
            if (!STATE.selectBgmSource) {
                STATE.selectBgmSource = playSystemSound('select', true);
            }
            return; // Exit enterGame
        } else {
            console.error("Critical Load Error:", e);
            // maybe show error UI?
        }
    }

    // Once resources are ready, hide loading
    ui.screenLoading.style.opacity = '0';
    setTimeout(() => {
        ui.screenLoading.style.display = 'none';
        ui.screenLoading.classList.remove('gameplay-loading');
    }, 500);

    // Show READY notification for 1 second before starting game
    const readyEl = document.getElementById('hud-ready');
    readyEl.classList.add('show');
    await new Promise(r => setTimeout(r, 1000));
    readyEl.classList.remove('show');

    STATE.isPlaying = true;
    STATE.isStarting = false; // [FIX] Reset starting flag only after playing state is set
    STATE.isResults = false;
    STATE.startTime = audioCtx.currentTime + 1.0; // Start in 1s to allow animations to settle if needed, but 2s total from Ready start
    STATE.score = 0;
    STATE.combo = 0;
    STATE.maxCombo = 0;
    STATE.activeActions.clear();

    // Initialize Renderer
    if (STATE.loadedSong.keyMode === '5') {
        STATE.renderer = new Renderer5K(canvas, ctx, STATE, ACTIONS, CHANNELS);
    } else if (STATE.loadedSong.keyMode === '9') {
        STATE.renderer = new Renderer9K(canvas, ctx, STATE, ACTIONS, CHANNELS);
    } else if (STATE.loadedSong.keyMode === '14') {
        STATE.renderer = new Renderer14K(canvas, ctx, STATE, ACTIONS, CHANNELS);
    } else if (STATE.loadedSong.keyMode === '10') {
        STATE.renderer = new Renderer10K(canvas, ctx, STATE, ACTIONS, CHANNELS);
    } else {
        // Default to 7K for now (covers 7K, and potentially others as fallback)
        STATE.renderer = new Renderer7K(canvas, ctx, STATE, ACTIONS, CHANNELS);
    }

    STATE.currentBpm = STATE.loadedSong.initialBpm;
    STATE.loadedSong.notes.forEach(n => {
        n.hit = false;
        n.isMissed = false;
        n.missTime = undefined;
    });
    STATE.bgmCursor = 0;
    STATE.bgaCursor = 0;
    STATE.bpmCursor = 0;
    STATE.bpmCursor = 0;
    STATE.logicCursor = 0; // [NEW] Logic optimization cursor
    STATE.inputLog = []; // Reset replay log
    STATE.currentMaxScore = 0; // [NEW] Running average denominator

    // Show Autoplay Indicator
    const apEl = document.getElementById('hud-autoplay');
    if (apEl) apEl.style.display = STATE.autoplay ? 'block' : 'none';

    // Initialize beam opacity states for 8 lanes (Scratch + 7 Keys)
    // Indices: 0=Scratch, 1-7=Keys
    STATE.beamOpacity = new Array(8).fill(0);

    // Apply Style (Mirror/Random/R-Random/S-Random/H-Random/All-Scratch)
    if (STATE.modifier !== 'OFF') {
        const p1Keys = [0x11, 0x12, 0x13, 0x14, 0x15, 0x18, 0x19];

        if (STATE.modifier === 'MIRROR') {
            const reversed = [...p1Keys].reverse();
            let mapping = {};
            p1Keys.forEach((k, i) => mapping[k] = reversed[i]);
            STATE.loadedSong.notes.forEach(n => { if (mapping[n.ch]) n.ch = mapping[n.ch]; });
        } else if (STATE.modifier === 'RANDOM') {
            const shuffled = [...p1Keys].sort(() => Math.random() - 0.5);
            let mapping = {};
            p1Keys.forEach((k, i) => mapping[k] = shuffled[i]);
            STATE.loadedSong.notes.forEach(n => { if (mapping[n.ch]) n.ch = mapping[n.ch]; });
        } else if (STATE.modifier === 'R-RANDOM') {
            const offset = 1 + Math.floor(Math.random() * 6);
            let mapping = {};
            p1Keys.forEach((k, i) => mapping[k] = p1Keys[(i + offset) % 7]);
            STATE.loadedSong.notes.forEach(n => { if (mapping[n.ch]) n.ch = mapping[n.ch]; });
        } else if (STATE.modifier === 'S-RANDOM') {
            STATE.loadedSong.notes.forEach(n => {
                if (p1Keys.includes(n.ch)) n.ch = p1Keys[Math.floor(Math.random() * 7)];
                if (p1Keys.map(k => k + 0x40).includes(n.ch)) n.ch = p1Keys[Math.floor(Math.random() * 7)] + 0x40;
            });
        } else if (STATE.modifier === 'H-RANDOM') {
            let lastLane = -1;
            let lastTime = -1;
            STATE.loadedSong.notes.forEach(n => {
                const isLN = n.ch >= 0x51 && n.ch <= 0x59;
                const baseKeys = isLN ? p1Keys.map(k => k + 0x40) : p1Keys;
                if (baseKeys.includes(n.ch)) {
                    let available = [...baseKeys];
                    if (lastLane !== -1 && Math.abs(n.time - lastTime) < 50) {
                        available = available.filter(k => k !== lastLane);
                    }
                    const picked = available[Math.floor(Math.random() * available.length)];
                    n.ch = picked;
                    lastLane = picked;
                    lastTime = n.time;
                }
            });
        } else if (STATE.modifier === 'ALL-SCRATCH') {
            const scratchTimes = new Set();
            STATE.loadedSong.notes.forEach(n => {
                if (n.ch === 0x16 || n.ch === 0x56) scratchTimes.add(Math.round(n.time));
            });

            const newNotes = [];
            STATE.loadedSong.notes.forEach(n => {
                if (p1Keys.includes(n.ch)) {
                    if (!scratchTimes.has(Math.round(n.time))) {
                        n.ch = 0x16;
                        scratchTimes.add(Math.round(n.time));
                        newNotes.push(n);
                    }
                } else if (p1Keys.map(k => k + 0x40).includes(n.ch)) {
                    if (!scratchTimes.has(Math.round(n.time))) {
                        n.ch = 0x56;
                        scratchTimes.add(Math.round(n.time));
                        newNotes.push(n);
                    }
                } else {
                    newNotes.push(n);
                }
            });
            STATE.loadedSong.notes = newNotes.sort((a, b) => a.time - b.time);
        }
    }

    // Reset tally
    STATE.judgeCounts = { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0 };
    STATE.fastSlow = { fast: 0, slow: 0 };
    STATE.comboBreaks = 0;
    updateTallyDisplay();

    // Show/hide tally based on settings
    ui.tally.classList.toggle('hidden', !STATE.showTally);

    // Set lane covers / Range
    let sudden = 0;
    let lift = 0;
    if (STATE.rangeMode === 'SUDDEN+') sudden = 30; // Default SUD+
    if (STATE.rangeMode === 'LIFT') lift = 20; // Default LIFT
    if (STATE.rangeMode === 'LIFT-SUD+') { sudden = 20; lift = 20; }

    ui.laneCoverTop.style.height = sudden + '%';
    ui.laneCoverBottom.style.height = lift + '%';

    // Set game background from stagefile
    if (STATE.stagefileUrl) {
        ui.gameBg.style.backgroundImage = `url('${STATE.stagefileUrl}')`;
    } else {
        ui.gameBg.style.backgroundImage = '';
    }

    const rawTick = STATE.loadedSong.total / Math.max(1, STATE.loadedSong.noteCount);
    STATE.gaugeTick = rawTick;

    // GAUGE INIT
    ui.gaugeBar.className = 'gauge-fill no-transition'; // Disable transitions during gameplay

    // Set gauge clear marker position (80% for normal+, 60% for easy/assist)
    const clearMarker = document.querySelector('.hud-gauge-container .gauge-marker');
    if (clearMarker) {
        const threshold = (STATE.gaugeType === 'ASSIST' || STATE.gaugeType === 'EASY') ? 60 : 80;
        clearMarker.style.left = `${threshold}%`;
        // Hide marker for survival gauges
        clearMarker.style.display = (STATE.gaugeType === 'HARD' || STATE.gaugeType === 'EXHARD' || STATE.gaugeType === 'HAZARD') ? 'none' : 'block';
    }

    if (STATE.gaugeType === 'HARD' || STATE.gaugeType === 'EXHARD' || STATE.gaugeType === 'HAZARD') {
        STATE.gauge = 100;
        ui.gaugeBar.classList.add(STATE.gaugeType.toLowerCase());
    } else {
        STATE.gauge = 20;
        if (STATE.gaugeType === 'ASSIST') ui.gaugeBar.classList.add('assist');
        else if (STATE.gaugeType === 'EASY') ui.gaugeBar.classList.add('easy');
        else ui.gaugeBar.classList.add('normal');
    }
    updateGaugeDisplay();
    updateHud();

    // Reset history
    STATE.history = { gauge: [], score: [] };
    const lastNote = STATE.loadedSong.notes[STATE.loadedSong.notes.length - 1];
    STATE.lastNoteTime = lastNote ? lastNote.time : 0;

    requestAnimationFrame(loop);
}

function exitGame() {
    STATE.isPlaying = false;
    document.getElementById('screen-select').style.display = 'flex';
    document.getElementById('screen-game').style.display = 'none';

    // Re-enable gauge transitions
    ui.gaugeBar.classList.remove('no-transition');

    // Restart select loop
    if (!STATE.selectBgmSource) {
        STATE.selectBgmSource = playSystemSound('select', true);
    }

    // Stop BGA video if playing
    ui.bgaVideo.pause();
    ui.bgaVideo.style.display = 'none';
    ui.bgaImg.style.display = 'none';

    // Reset Window Title
    updateWindowTitle(null);
}

// BATCHED HUD UPDATES - Defers DOM updates to next animation frame
let hudDirty = false;
function markHudDirty() {
    if (!hudDirty) {
        hudDirty = true;
        requestAnimationFrame(flushHud);
    }
}
function flushHud() {
    hudDirty = false;
    updateTallyDisplay();
    updateGaugeDisplay();
    updateHud();
}

function updateTallyDisplay() {
    ui.tallyPg.textContent = STATE.judgeCounts.pgreat;
    ui.tallyGr.textContent = STATE.judgeCounts.great;
    ui.tallyGd.textContent = STATE.judgeCounts.good;
    ui.tallyBd.textContent = STATE.judgeCounts.bad;
    ui.tallyPr.textContent = STATE.judgeCounts.poor;
    ui.tallyFast.textContent = STATE.fastSlow.fast;
    ui.tallySlow.textContent = STATE.fastSlow.slow;
    ui.tallyCb.textContent = STATE.comboBreaks;
}

function playSound(id) {
    if (STATE.audioBuffers[id]) {
        const s = audioCtx.createBufferSource();
        s.buffer = STATE.audioBuffers[id];
        s.connect(audioCtx.destination);
        s.start(0);

        // Track source for stopping
        if (!STATE.activeSources) STATE.activeSources = new Set();
        STATE.activeSources.add(s);
        s.onended = () => {
            if (STATE.activeSources) STATE.activeSources.delete(s);
        };
    }
}

function stopAllAudio() {
    if (STATE.activeSources) {
        STATE.activeSources.forEach(s => {
            try { s.stop(); } catch (e) { }
        });
        STATE.activeSources.clear();
    }
}

function playSystemSound(id, loop = false) {
    if (STATE.systemAudio[id]) {
        const s = audioCtx.createBufferSource();
        s.buffer = STATE.systemAudio[id];
        s.connect(audioCtx.destination);
        s.loop = loop;
        s.start(0);
        return s;
    }
    return null;
}

async function updateBGA(id) {
    const def = STATE.bgaDefinitions[id];
    if (!def) return;

    if (def.isVideo && !STATE.bgaDefinitions[id].useStream && /\.(mp4|webm)$/i.test(def.url)) {
        // Modern formats: Use native video element (better performance if supported)
        // BUT: if we want to guarantee everything works, we could force stream.
        // For now, let's keep MP4 native as an optimization, others use stream.
        ui.bgaImg.style.display = 'none';
        ui.bgaVideo.src = def.url;
        ui.bgaVideo.style.display = 'block';
        ui.bgaVideo.play().catch(() => { });
    } else {
        // Legacy formats (AVI, MPG) or forced stream or Image
        // If it's a video file but we determined it needs streaming (or it's legacy extension)
        if (/\.(avi|mpg|mpeg|wmv|m4v)$/i.test(def.filename) || def.isVideo) {
            // Use Image Element with MJPEG Stream
            console.log("Streaming BGA via FFmpeg:", def.filename);
            if (!STATE.streamBaseUrl) {
                STATE.streamBaseUrl = await window.electronAPI.getStreamUrl();
            }

            if (STATE.streamBaseUrl) {
                // Construct Stream URL
                // Extract path from file:// URL if present, or use raw path?
                // resolve-image returned file:// URL. We need valid OS path for ffmpeg.
                // We can't easily reverse file:// to path in browser securely without helper.
                // BUT: We stored 'url' which is file://...
                // We also have def.filename, but that's relative.
                // We need the absolute path.
                // Let's rely on resolve-image returning the path in a new field?
                // OR: Just parse the file:// URL.

                let videoPath = def.url.replace('file://', '');
                // On Windows, /C:/... -> C:/...
                if (videoPath.startsWith('/') && videoPath[2] === ':') videoPath = videoPath.substring(1);
                // Decode URI chars
                videoPath = decodeURIComponent(videoPath);

                const streamUrl = `${STATE.streamBaseUrl}?path=${encodeURIComponent(videoPath)}`;

                ui.bgaVideo.pause();
                ui.bgaVideo.style.display = 'none';
                ui.bgaImg.src = streamUrl;
                ui.bgaImg.style.display = 'block';
            } else {
                console.warn("Stream server not ready");
            }
        } else {
            // Standard Image
            ui.bgaVideo.pause();
            ui.bgaVideo.style.display = 'none';
            ui.bgaImg.src = def.url;
            ui.bgaImg.style.display = 'block';
        }
    }
}

const SYSTEM_SOUND_FILES = [
    'sfx/clear.ogg',
    'sfx/difficulty.ogg',
    'sfx/fail.ogg',
    'sfx/f-open.ogg',
    'sfx/f-close.ogg',
    'sfx/o-open.ogg',
    'sfx/o-close.ogg',
    'sfx/o-change.ogg',
    'sfx/playstop.ogg',
    'sfx/scratch.ogg',
    'sfx/screenshot.ogg',
    'sfx/course_clear.ogg',
    'sfx/course_fail.ogg',
    'bgm/select.wav',
    'bgm/decide.wav'
];

async function loadSystemSounds() {
    for (const filePath of SYSTEM_SOUND_FILES) {
        const id = filePath.split('/').pop().split('.')[0];
        try {
            // Assuming dataLayer.readAudio handles the path correctly
            const fullPath = `soundset/${filePath}`;
            const buffer = await dataLayer.readAudio(fullPath);
            STATE.systemAudio[id] = buffer;
        } catch (e) {
            console.warn("Failed to load system sound:", filePath, e);
        }
    }
}

function loop() {
    if (!STATE.isPlaying) return;
    const now = (audioCtx.currentTime - STATE.startTime) * 1000;

    // Update progress bar
    if (STATE.lastNoteTime > 0 && ui.progressFill) {
        const progress = Math.min(100, Math.max(0, (now / STATE.lastNoteTime) * 100));
        ui.progressFill.style.height = `${progress}%`;
    }

    const bgm = STATE.loadedSong.bgm;
    while (STATE.bgmCursor < bgm.length && bgm[STATE.bgmCursor].time <= now) {
        playSound(bgm[STATE.bgmCursor].id);
        STATE.bgmCursor++;
    }

    const bpms = STATE.loadedSong.bpmEvents;
    while (STATE.bpmCursor < bpms.length && bpms[STATE.bpmCursor].time <= now) {
        STATE.currentBpm = Math.max(0.001, bpms[STATE.bpmCursor].bpm);
        STATE.bpmCursor++;
        ui.statBpm.textContent = Math.round(STATE.currentBpm);
    }

    const bgas = STATE.loadedSong.bgaEvents;
    while (STATE.bgaCursor < bgas.length && bgas[STATE.bgaCursor].time <= now) {
        updateBGA(bgas[STATE.bgaCursor].id);
        STATE.bgaCursor++;
    }

    const notes = STATE.loadedSong.notes;
    let win = JUDGE_WINDOWS[STATE.loadedSong.rank] || JUDGE_WINDOWS[3];

    // Apply Extended Judge if enabled
    if (STATE.assistMode === 'EX-JUDGE' || STATE.assistMode === 'BOTH') {
        win = { PG: win.PG * 1.5, GR: win.GR * 1.5, GD: win.GD * 1.5, BD: win.BD * 1.5, PR: win.PR };
    }

    // OPTIMIZED: Sliding Window for Logic
    // Start from logicCursor and stop when notes are too far in future
    for (let i = STATE.logicCursor; i < notes.length; i++) {
        const n = notes[i];
        if (n.hit) {
            // Update cursor if this note is already processed
            if (i === STATE.logicCursor) STATE.logicCursor++;
            continue;
        }

        const diff = now - n.time;

        // Stop if we are too far in the future (beyond poor window of 200ms)
        // -200 means note is 200ms in the future
        if (diff < -1000) break; // Optimization: Stop checking if note is >1s away

        // Autoplay
        if (STATE.autoplay && diff >= 0) {
            n.hit = true;
            playSound(n.id);
            handleJudgment('PGREAT', 0);
            if (i === STATE.logicCursor) STATE.logicCursor++;

            // Trigger Beam
            let targetIdx = -1;
            if (CHANNELS.P1.SCRATCH.includes(n.ch)) targetIdx = 0;
            else if (CHANNELS.P1.KEY1.includes(n.ch)) targetIdx = 1;
            else if (CHANNELS.P1.KEY2.includes(n.ch)) targetIdx = 2;
            else if (CHANNELS.P1.KEY3.includes(n.ch)) targetIdx = 3;
            else if (CHANNELS.P1.KEY4.includes(n.ch)) targetIdx = 4;
            else if (CHANNELS.P1.KEY5.includes(n.ch)) targetIdx = 5;
            else if (CHANNELS.P1.KEY6.includes(n.ch)) targetIdx = 6;
            else if (CHANNELS.P1.KEY7.includes(n.ch)) targetIdx = 7;

            if (targetIdx !== -1) STATE.beamOpacity[targetIdx] = 1.0;
        }
        // Miss Detection
        else if (!STATE.autoplay && diff > win.BD) {
            // Passed Bad Window -> POOR
            n.hit = true;
            n.isMissed = true;
            n.missTime = now;
            handleJudgment('POOR', diff);
            if (i === STATE.logicCursor) STATE.logicCursor++;
        }
    }

    render(now);

    // Sampling history for graphs (approx every 100ms)
    if (Math.floor(now / 100) > STATE.history.gauge.length) {
        STATE.history.gauge.push(STATE.gauge);
        STATE.history.score.push(STATE.score);
    }

    updatePacemaker(now);

    // End of song check
    if (now > STATE.lastNoteTime + 2000) {
        const isClear = (STATE.gaugeType === 'HARD' || STATE.gaugeType === 'EXHARD') ? (STATE.gauge > 0) : (STATE.gauge >= 80);
        showResults(isClear);
        return;
    }

    requestAnimationFrame(loop);
}

function render(time) {
    if (STATE.renderer) {
        STATE.renderer.render(time);
    } else {
        // Fallback if no renderer (should not happen)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// ----------------------------------------------------------------------------
// JUDGEMENT SYSTEM
// ----------------------------------------------------------------------------
function handleJudgment(result, diffMs, isEmptyPoor = false) {
    // Scoring
    let scoreAdd = 0;
    if (result === 'PGREAT') scoreAdd = 2;
    else if (result === 'GREAT') scoreAdd = 1;
    STATE.score += scoreAdd;

    // Combo
    if (!isEmptyPoor) {
        if (result === 'BAD' || result === 'POOR') {
            if (STATE.combo > 0) {
                STATE.comboBreaks++;
            }
            STATE.combo = 0;
        } else {
            STATE.combo++;
            if (STATE.combo > STATE.maxCombo) STATE.maxCombo = STATE.combo;

            // Track fast/slow (only for PGREAT/GREAT/GOOD)
            if (diffMs < 0) STATE.fastSlow.fast++;
            else if (diffMs > 0) STATE.fastSlow.slow++;
        }

        // Track judgement counts
        if (result === 'PGREAT') STATE.judgeCounts.pgreat++;
        else if (result === 'GREAT') STATE.judgeCounts.great++;
        else if (result === 'GOOD') STATE.judgeCounts.good++;
        else if (result === 'BAD') STATE.judgeCounts.bad++;
        else if (result === 'POOR') STATE.judgeCounts.poor++;

        // Mark HUD dirty (batched update)
    }

    // Update Max Score for Running Average (ignore empty poors)
    if (!isEmptyPoor) {
        STATE.currentMaxScore += 2;
    }

    // Gauge Logic
    let damage = 0;
    let recover = 0;

    if (STATE.gaugeType === 'EXHARD') {
        // EX-HARD
        if (isEmptyPoor) damage = 8.0;
        else if (result === 'PGREAT') recover = 0.1;
        else if (result === 'GREAT') recover = 0.1;
        else if (result === 'GOOD') recover = 0.1;
        else if (result === 'BAD') damage = 10.0;
        else if (result === 'POOR') damage = 18.0;

        STATE.gauge = STATE.gauge + recover - damage;
    }
    else if (STATE.gaugeType === 'HARD') {
        // HARD
        if (isEmptyPoor) damage = 2.0;
        else if (result === 'PGREAT') recover = 0.1;
        else if (result === 'GREAT') recover = 0.1;
        else if (result === 'GOOD') recover = 0.1;
        else if (result === 'BAD') damage = 6.0;
        else if (result === 'POOR') damage = 10.0;

        // LR2 Hard Gauge Adjustment
        if (damage > 0 && STATE.gauge <= 30) {
            damage *= 0.6;
        }

        STATE.gauge = STATE.gauge + recover - damage;
    }
    else if (STATE.gaugeType === 'EASY') {
        // EASY
        if (isEmptyPoor) damage = 1.6;
        else if (result === 'PGREAT' || result === 'GREAT') recover = STATE.gaugeTick;
        else if (result === 'GOOD') recover = (STATE.gaugeTick / 2);
        else if (result === 'BAD') damage = 1.6;
        else if (result === 'POOR') damage = 4.8;

        STATE.gauge = STATE.gauge + recover - damage;
    }
    else {
        // GROOVE (Normal)
        if (isEmptyPoor) damage = 2.0;
        else if (result === 'PGREAT' || result === 'GREAT') recover = STATE.gaugeTick;
        else if (result === 'GOOD') recover = (STATE.gaugeTick / 2);
        else if (result === 'BAD') damage = 2.0;
        else if (result === 'POOR') damage = 6.0;

        STATE.gauge = STATE.gauge + recover - damage;
    }

    // Fail Check for Hard/ExHard/Hazard
    if ((STATE.gaugeType === 'HARD' || STATE.gaugeType === 'EXHARD') && STATE.gauge <= 0) {
        STATE.gauge = 0;
        triggerHardFail();
        return;
    }

    // Hazard mode: combo break fails (except empty POORs)
    if (STATE.gaugeType === 'HAZARD' && !isEmptyPoor && (result === 'BAD' || result === 'POOR')) {
        STATE.gauge = 0;
        triggerHardFail();
        return;
    }

    // Clamp
    if (STATE.gauge > 100) STATE.gauge = 100;
    if (STATE.gaugeType !== 'HARD' && STATE.gaugeType !== 'EXHARD' && STATE.gaugeType !== 'HAZARD' && STATE.gauge < 2) STATE.gauge = 2;

    // BATCHED: Mark HUD dirty instead of updating immediately
    markHudDirty();

    showJudge(result, diffMs, isEmptyPoor);
}

function showJudge(text, diff, isEmpty = false) {
    STATE.judgement = {
        type: text,
        time: performance.now(),
        combo: STATE.combo,
        isEmpty: isEmpty,
        diff: diff
    };
}

function drawJudgement(now) {
    if (!STATE.judgement.type || !STATE.judgementImage) return;

    const elapsed = performance.now() - STATE.judgement.time;
    if (elapsed > 1000) {
        STATE.judgement.type = null;
        return;
    }

    let type = STATE.judgement.type;
    if (type === 'POOR' && STATE.judgement.isEmpty) type = 'FAIL';

    // Animation Params
    const isPg = (type === 'PGREAT');
    const isCbBreak = (type === 'BAD' || type === 'POOR' || type === 'FAIL');
    const blinkFast = isCbBreak;
    const blinkRate = blinkFast ? 50 : 100; // ms per blink
    const visible = (Math.floor(elapsed / blinkRate) % 2 === 0);
    if (!isPg && !visible) {
        // Still draw FAST/SLOW even when judgement is not visible (blink off)
        // Need to calculate positioning for FAST/SLOW
        let tempSprite;
        if (type === 'GREAT' || type === 'GOOD') {
            tempSprite = type === 'GOOD' ? JUDGE_SPRITES.GOOD : JUDGE_SPRITES.GREAT.label;
        } else {
            tempSprite = JUDGE_SPRITES[type];
        }
        if (tempSprite && !isPg && !isCbBreak && STATE.judgement.diff !== 0) {
            const tempSCALE = 0.8;
            const tempComboStr = STATE.judgement.combo > 0 ? STATE.judgement.combo.toString() : '';
            const tempDigitAdvance = (60 - 55) * tempSCALE;
            const tempComboW = tempComboStr ? tempComboStr.length * tempDigitAdvance : 0;
            const tempGap = (10 * tempSCALE) - 50;
            const tempTotalW = (tempSprite.w * tempSCALE) + (tempComboStr ? tempGap + tempComboW : 0);
            const tempStartX = -tempTotalW / 2;
            const tempDrawX = 30 + (60 + 40 * 7) / 2;
            const tempDrawY = canvas.height * 0.75 - 210;

            ctx.save();
            ctx.translate(tempDrawX, tempDrawY);
            drawFastSlow(type, STATE.judgement.diff, tempSprite, tempSCALE, tempStartX, tempTotalW, ctx);
            ctx.restore();
        }
        return;
    }

    // Determine Sprite
    let sprite;
    let digitSpriteSet;
    if (isPg) {
        // Cycle through 6 rows
        const cycleIdx = Math.floor(elapsed / (1000 / 60)) % 6;
        sprite = JUDGE_SPRITES.PGREAT[cycleIdx].label;
        digitSpriteSet = JUDGE_SPRITES.PGREAT[cycleIdx].digits;
    } else if (type === 'GREAT' || type === 'GOOD') {
        sprite = JUDGE_SPRITES.GREAT.label;
        digitSpriteSet = JUDGE_SPRITES.GREAT.digits;
        if (type === 'GOOD') {
            sprite = JUDGE_SPRITES.GOOD;
        }
    } else {
        sprite = JUDGE_SPRITES[type];
    }

    // Draw Position
    const fieldCenterX = 30 + (60 + 40 * 7) / 2;
    const drawX = fieldCenterX;
    const drawY = canvas.height * 0.75 - 210; // Moved up 90px (was -120)

    const SCALE = 0.8; // Reduce size

    // Setup Combo
    const comboStr = (!isCbBreak && STATE.judgement.combo > 0) ? STATE.judgement.combo.toString() : '';
    // Decrease spacing by another 20px (was 35, now 55 overlap)
    const digitOverlap = 55;
    const digitAdvance = (J_DIGIT_W - digitOverlap) * SCALE;

    const comboW = comboStr ? comboStr.length * digitAdvance : 0;
    const gap = (10 * SCALE) - 50;
    const totalW = (sprite.w * SCALE) + (comboStr ? gap + comboW : 0);

    ctx.save();
    ctx.translate(drawX, drawY);

    // Draw unit centered
    const startX = -totalW / 2;

    // Draw Label
    ctx.drawImage(
        STATE.judgementImage,
        sprite.x, sprite.y, sprite.w, sprite.h,
        startX, (-sprite.h * SCALE) / 2, sprite.w * SCALE, sprite.h * SCALE
    );

    // Draw Combo
    if (comboStr) {
        let curX = startX + (sprite.w * SCALE) + gap;
        for (let i = 0; i < comboStr.length; i++) {
            const digit = parseInt(comboStr[i]);
            const ds = digitSpriteSet[digit];
            ctx.drawImage(
                STATE.judgementImage,
                ds.x, ds.y, ds.w, ds.h,
                curX, (-ds.h * SCALE) / 2, ds.w * SCALE, ds.h * SCALE
            );
            curX += digitAdvance;
        }
    }

    ctx.restore();
}

// Separate function for FAST/SLOW to avoid blinking
function drawFastSlow(type, diff, sprite, SCALE, startX, totalW, ctx) {
    const isPg = (type === 'PGREAT');
    const isCbBreak = (type === 'BAD' || type === 'POOR' || type === 'FAIL');

    if (isCbBreak || isPg || diff === 0) return false;

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Outfit", sans-serif';
    ctx.shadowBlur = 4;

    if (diff < 0) {
        // FAST
        ctx.fillStyle = '#88f'; // Bluish
        ctx.shadowColor = '#00f';
        ctx.fillText('FAST', startX + (totalW / 2), (-sprite.h * SCALE) / 2 - 20);
    } else if (diff > 0) {
        // SLOW
        ctx.fillStyle = '#f88'; // Reddish
        ctx.shadowColor = '#f00';
        ctx.fillText('SLOW', startX + (totalW / 2), (-sprite.h * SCALE) / 2 - 20);
    }
    ctx.shadowBlur = 0; // Reset
    return true;
}

function updateGaugeDisplay() {
    ui.gaugeBar.style.width = `${STATE.gauge}%`;

    // Decimal formatting: big whole, small decimal
    const valStr = STATE.gauge.toFixed(1);
    const [whole, decimal] = valStr.split('.');
    ui.gaugeVal.innerHTML = `<span class="whole">${whole}</span><span class="decimal">.${decimal}%</span>`;

    // Grade display next to groove %
    // Use Running Average for Live Grade
    const currentMax = Math.max(2, STATE.currentMaxScore); // Avoid divide by zero
    const percent = (STATE.score / currentMax) * 100;
    const grade = calculateRank(percent);
    ui.gaugeGrade.textContent = grade;
    ui.gaugeGrade.style.color = getRankColor(grade);

    if (STATE.gaugeType !== 'HARD' && STATE.gaugeType !== 'EXHARD' && STATE.gaugeType !== 'HAZARD') {
        const threshold = (STATE.gaugeType === 'ASSIST' || STATE.gaugeType === 'EASY') ? 60 : 80;
        if (STATE.gauge >= threshold) ui.gaugeBar.classList.add('cleared');
        else ui.gaugeBar.classList.remove('cleared');
    }
}

function updateHud() {
    ui.score.textContent = STATE.score;
    ui.maxCombo.textContent = STATE.maxCombo;

    // Use Running Average for Live Rate
    const currentMax = Math.max(2, STATE.currentMaxScore); // Avoid divide by zero
    const percent = (STATE.score / currentMax) * 100;
    ui.rate.textContent = percent.toFixed(2) + '%';
}

// ----------------------------------------------------------------------------
// RESULTS SYSTEM
// ----------------------------------------------------------------------------
function showResults(isClear, statusText) {
    STATE.isPlaying = false;
    STATE.isResults = true;

    if (isClear) playSystemSound('clear');
    else if (statusText !== 'ABORT') playSystemSound('fail');

    // Calculate score data for saving
    const maxEx = STATE.loadedSong.notes.length * 2;
    const percent = (STATE.score / Math.max(1, maxEx)) * 100;
    const rank = calculateRank(percent);
    const lamp = determineClearLamp(isClear);

    // Save score data (only overwrites individual values if higher)
    saveScore(STATE.currentFileRef, STATE.score, percent, rank, lamp.id);
    // Also save lamp separately for backward compatibility with lamp display
    saveLamp(STATE.currentFileRef, lamp);

    // Save Replay
    const isFC = (STATE.comboBreaks === 0 && STATE.judgeCounts.bad === 0 && STATE.judgeCounts.poor === 0);
    saveReplay(STATE.currentFileRef, STATE.inputLog, STATE.score, lamp, isFC);

    document.getElementById('screen-game').style.display = 'none';
    document.getElementById('screen-results').style.display = 'flex';
    document.getElementById('screen-results').classList.remove('fade-out'); // Reset fade state



    // UI Text
    const statusEl = document.getElementById('res-status');
    if (statusText === 'ABORT') {
        statusEl.textContent = ''; // Hide failed text for manual abort
    } else {
        statusEl.textContent = isClear ? 'CLEARED' : 'FAILED';
        statusEl.style.color = isClear ? 'var(--accent)' : '#f44';
    }
    document.getElementById('res-song-title').textContent = STATE.loadedSong.headers['TITLE'] || 'Unknown';

    document.getElementById('res-rank').textContent = calculateRank(percent);
    document.getElementById('res-rank').style.color = getRankColor(calculateRank(percent));

    const nextRank = getNextRankInfo(percent, maxEx);
    document.getElementById('res-rank-next').textContent = nextRank ? `NEXT RANK: ${nextRank.name} (-${nextRank.diff})` : 'MAX RANK ACHIEVED';

    // Tally
    document.getElementById('res-pg').textContent = STATE.judgeCounts.pgreat;
    document.getElementById('res-gr').textContent = STATE.judgeCounts.great;
    document.getElementById('res-gd').textContent = STATE.judgeCounts.good;
    document.getElementById('res-bd').textContent = STATE.judgeCounts.bad;
    document.getElementById('res-pr').textContent = STATE.judgeCounts.poor;
    document.getElementById('res-fast').textContent = STATE.fastSlow.fast;
    document.getElementById('res-slow').textContent = STATE.fastSlow.slow;
    document.getElementById('res-max-combo').textContent = STATE.maxCombo;

    // Score
    document.getElementById('res-ex-score').textContent = STATE.score;
    document.getElementById('res-percent').textContent = percent.toFixed(2) + '%';

    // Lamps
    const lampEl = document.getElementById('res-lamp');
    lampEl.className = 'lamp ' + lamp.class;
    document.getElementById('res-lamp-text').textContent = lamp.name;
    document.getElementById('res-lamp-text').style.color = getComputedStyle(lampEl).backgroundColor;

    // Update song list UI if needed (proactive) - preserve selection
    // Update song list UI if needed (proactive) - preserve selection
    const savedIndex = STATE.selectedIndex;
    const targetRef = STATE.currentFileRef;

    renderSongList();

    let foundIndex = -1;
    // Only search for song if not in a course (courses maintain index on their own)
    if (!STATE.activeCourse) {
        foundIndex = STATE.currentList.findIndex(item => item.type === 'chart' && item.data.fileRef === targetRef);
    }

    if (foundIndex !== -1) {
        STATE.selectedIndex = foundIndex;
    } else {
        STATE.selectedIndex = Math.min(savedIndex, STATE.currentList.length - 1);
    }
    updateSelection();

    // Graphs - Gauge graph uses two-color with clear threshold
    const clearThreshold = (STATE.gaugeType === 'ASSIST' || STATE.gaugeType === 'EASY') ? 60 : 80;
    drawGaugeGraph('graph-gauge', STATE.history.gauge, [2, 100], clearThreshold, STATE.gaugeType);
    drawGraph('graph-score', STATE.history.score, [0, maxEx], '#55aaff');

    // Global listener to exit results
    let isFadingResults = false;
    const resultsScreen = document.getElementById('screen-results');

    const returnHandler = (e) => {
        const blackKeyHeld = STATE.activeActions.has(ACTIONS.P1_2) ||
            STATE.activeActions.has(ACTIONS.P1_4) ||
            STATE.activeActions.has(ACTIONS.P1_6);
        const whiteKeyPressed = [ACTIONS.P1_1, ACTIONS.P1_3, ACTIONS.P1_5, ACTIONS.P1_7].some(
            a => STATE.keyCodeToAction[e.code]?.includes(a)
        );

        if (blackKeyHeld && whiteKeyPressed && !STATE.activeCourse) {
            // Quick restart with same random seed
            // Allow restart even if fading (it just cuts it short)
            window.removeEventListener('keydown', returnHandler);

            // Trigger restart - fade out first or immediate?
            // User wanted fade out animation for results screen exit normally
            // But for quick restart, usually it's instant or specific.
            // The original code started fade-out for restart too.
            // Let's keep it but ensure we don't return early due to isFadingResults check.

            isFadingResults = true;
            resultsScreen.classList.add('fade-out');

            setTimeout(() => {
                resultsScreen.classList.remove('fade-out');
                resultsScreen.style.display = 'none';
                enterGame(); // Re-enter with same loaded song
            }, 500);
            return;
        }

        // Ignore keypresses during fade animation (for normal exit)
        if (isFadingResults) return;

        // Normal exit with fade animation
        isFadingResults = true;
        resultsScreen.classList.add('fade-out');
        window.removeEventListener('keydown', returnHandler);

        setTimeout(() => {
            resultsScreen.classList.remove('fade-out');
            resultsScreen.style.display = 'none';

            if (STATE.activeCourse) {
                STATE.courseIndex++;
                if (STATE.courseIndex < STATE.activeCourse.hashes.length) {
                    const nextHash = STATE.activeCourse.hashes[STATE.courseIndex];
                    const song = STATE.charts.find(c => c.md5 === nextHash);
                    if (song) {
                        loadChart(STATE.charts.indexOf(song), { classList: { add: () => { } }, classList: { remove: () => { } }, style: {} }, true);
                        enterGame();
                    } else {
                        alert('Next song in course not found! Hash: ' + nextHash);
                        STATE.activeCourse = null;
                        exitToSelect();
                    }
                } else {
                    STATE.activeCourse = null;
                    exitToSelect();
                }
            } else {
                exitToSelect();
            }
        }, 500);
    };

    function exitToSelect() {
        STATE.isResults = false;
        document.getElementById('screen-select').style.display = 'flex';
        if (!STATE.selectBgmSource) {
            STATE.selectBgmSource = playSystemSound('select', true);
        }
        updateWindowTitle(null);
    }

    setTimeout(() => {
        window.addEventListener('keydown', returnHandler);
    }, 500);
}

function calculateRank(p) {
    if (p >= 88.88) return 'AAA'; // 8/9
    if (p >= 77.77) return 'AA';  // 7/9
    if (p >= 66.66) return 'A';   // 6/9
    if (p >= 55.55) return 'B';   // 5/9
    if (p >= 44.44) return 'C';   // 4/9
    if (p >= 33.33) return 'D';   // 3/9
    if (p >= 22.22) return 'E';   // 2/9
    return 'F';
}

function getRankColor(rank) {
    const colors = { 'AAA': '#fff700', 'AA': '#c0c0c0', 'A': '#cd7f32', 'B': '#00ff00', 'C': '#0000ff', 'D': '#ff00ff', 'E': '#ff0000', 'F': '#888' };
    return colors[rank] || '#fff';
}

function getNextRankInfo(p, maxEx) {
    // Standard BMS rank thresholds are exactly these ninths:
    const exactThresholds = [
        { name: 'E', ratio: 2 / 9 },
        { name: 'D', ratio: 3 / 9 },
        { name: 'C', ratio: 4 / 9 },
        { name: 'B', ratio: 5 / 9 },
        { name: 'A', ratio: 6 / 9 },
        { name: 'AA', ratio: 7 / 9 },
        { name: 'AAA', ratio: 8 / 9 }
    ];

    for (let t of exactThresholds) {
        const targetScore = Math.ceil(maxEx * t.ratio);
        if (STATE.score < targetScore) {
            const diff = targetScore - STATE.score;
            return { name: t.name, diff: diff };
        }
    }
    // If we are AAA, show MAX diff
    if (calculateRank(p) === 'AAA') {
        const diff = maxEx - STATE.score;
        if (diff > 0) return { name: 'MAX', diff: diff };
    }
    return null;
}

function triggerHardFail() {
    STATE.isPlaying = false;
    stopAllAudio();
    playSystemSound('fail');

    // Show Fail Screen
    const failScreen = document.getElementById('screen-failed');
    if (failScreen) failScreen.style.display = 'flex';

    // Set gauge to 0 and update display
    STATE.gauge = 0;
    updateGaugeDisplay();

    setTimeout(() => {
        if (failScreen) failScreen.style.display = 'none';
        showResults(false);
    }, 3000);
}

function determineClearLamp(isClear) {
    // CRITICAL: Check failure FIRST before any clear lamp logic
    if (!isClear) return LAMPS.FAILED;

    const maxEx = STATE.loadedSong.notes.length * 2;
    const isPerfect = (STATE.judgeCounts.pgreat === STATE.loadedSong.notes.length); // All PGREAT
    const isNoBadPoor = (STATE.judgeCounts.bad === 0 && STATE.judgeCounts.poor === 0);
    const isFC = (STATE.comboBreaks === 0 && isNoBadPoor); // Full Combo: no combo breaks AND no bad/poor

    // Correction: Perfect is 100% EX score. 
    // The user says: Perfect (only PGreat and Great) -> MAX (100%)
    // So: Perfect is FC + only PG/GR. MAX is all PG.

    const onlyPGGR = (STATE.judgeCounts.good === 0 && STATE.judgeCounts.bad === 0 && STATE.judgeCounts.poor === 0);
    const isMax = (STATE.score === maxEx);

    if (isMax) return LAMPS.MAX;
    if (onlyPGGR && isFC) return LAMPS.PERFECT;
    if (isFC) return LAMPS.FC;

    // Gauge based clears
    if (STATE.gaugeType === 'EXHARD') return LAMPS.EXHARD;
    if (STATE.gaugeType === 'HARD') return LAMPS.HARD;
    if (STATE.gaugeType === 'EASY' || STATE.gaugeType === 'ASSIST') {
        if (STATE.gaugeType === 'ASSIST') return LAMPS.ASSIST;
        return LAMPS.EASY;
    }
    return LAMPS.CLEAR;
}

function drawGraph(canvasId, data, range, color) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    if (data.length < 2) return;

    const [min, max] = range;
    const stepX = w / (data.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const val = (data[i] - min) / (max - min);
        const x = i * stepX;
        const y = h - (val * h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill area
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);

    let colorStart = color;
    let colorEnd = 'rgba(0,0,0,0)';

    if (color.startsWith('#')) {
        colorStart = color + '66'; // 40% alpha
        colorEnd = color + '00';   // 0% alpha
    } else if (color.startsWith('rgb')) {
        colorStart = color.replace('rgb', 'rgba').replace(')', ', 0.4)');
        colorEnd = color.replace('rgb', 'rgba').replace(')', ', 0)');
    }

    grad.addColorStop(0, colorStart);
    grad.addColorStop(1, colorEnd);
    ctx.fillStyle = grad;
    ctx.fill();
}

// Two-color gauge graph: green below threshold, red above
function drawGaugeGraph(canvasId, data, range, threshold, gaugeType) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const [min, max] = range;
    const thresholdY = h - ((threshold - min) / (max - min)) * h;

    // Draw threshold line
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, thresholdY);
    ctx.lineTo(w, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (data.length < 2) return;

    const stepX = w / (data.length - 1);
    const isHardMode = (gaugeType === 'HARD' || gaugeType === 'EXHARD' || gaugeType === 'HAZARD');

    // Build path for line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const val = (data[i] - min) / (max - min);
        const x = i * stepX;
        const y = h - (val * h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }

    if (isHardMode) {
        // All red for hard modes
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill with red gradient
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#ff444466');
        grad.addColorStop(1, '#ff444400');
        ctx.fillStyle = grad;
        ctx.fill();
    } else {
        // Two-color: green below, red above threshold
        ctx.strokeStyle = '#00ff9d';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Below threshold: green
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, thresholdY, w, h - thresholdY);
        ctx.clip();

        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const val = (data[i] - min) / (max - min);
            const x = i * stepX;
            const y = h - (val * h);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const greenGrad = ctx.createLinearGradient(0, thresholdY, 0, h);
        greenGrad.addColorStop(0, '#00ff9d66');
        greenGrad.addColorStop(1, '#00ff9d00');
        ctx.fillStyle = greenGrad;
        ctx.fill();
        ctx.restore();

        // Above threshold: red
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, thresholdY);
        ctx.clip();

        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const val = (data[i] - min) / (max - min);
            const x = i * stepX;
            const y = h - (val * h);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, thresholdY);
        ctx.lineTo(0, thresholdY);
        ctx.closePath();
        const redGrad = ctx.createLinearGradient(0, 0, 0, thresholdY);
        redGrad.addColorStop(0, '#ff444466');
        redGrad.addColorStop(1, '#ff444433');
        ctx.fillStyle = redGrad;
        ctx.fill();
        ctx.restore();
    }
}

// ----------------------------------------------------------------------------
// INPUT
// ----------------------------------------------------------------------------
window.addEventListener('keydown', e => {
    // Handle Escape key first (before actions check)
    if (e.code === 'Escape' && STATE.isPlaying) {
        const screenGame = document.getElementById('screen-game');
        if (screenGame.classList.contains('fade-out')) return;

        // Block inputs during fade out
        STATE.isFadingOut = true;
        STATE.isPlaying = false; // Stop game loop
        screenGame.classList.add('fade-out');

        // Check if should skip results screen
        // Only count actual hits (not misses/POOR) - BAD is still a hit
        const notesActuallyHit = STATE.judgeCounts.pgreat + STATE.judgeCounts.great + STATE.judgeCounts.good + STATE.judgeCounts.bad;
        const skipResults = STATE.autoplay || notesActuallyHit === 0;

        setTimeout(() => {
            stopAllAudio();
            STATE.isFadingOut = false;
            screenGame.classList.remove('fade-out');

            if (skipResults) {
                // Return directly to song select without results
                screenGame.style.display = 'none';
                document.getElementById('screen-select').style.display = 'flex';
                STATE.isStarting = false;
                STATE.isResults = false;
                // Restart select BGM
                if (!STATE.selectBgmSource) {
                    STATE.selectBgmSource = playSystemSound('select', true);
                }
                updateWindowTitle(null);
            } else {
                showResults(false, 'ABORT'); // Pass ABORT status
            }
        }, 500);
        return;
    }

    // Block all inputs during fade out animation
    if (STATE.isFadingOut) return;

    // Replay Recording
    if (STATE.isPlaying && !STATE.autoplay && !e.repeat) {
        STATE.inputLog.push({
            t: (audioCtx.currentTime - STATE.startTime) * 1000,
            k: e.code,
            d: true
        });
    }

    // Arrow keys for song navigation (song select only)
    // Arrow keys for song navigation (song select only)
    if (!STATE.isPlaying && !STATE.isStarting && !STATE.isOptionsOpen && !STATE.isDecideActive && !STATE.isResults && !STATE.isFadingOut) {
        if (e.code === 'ArrowUp') {
            e.preventDefault();
            STATE.selectedIndex = (STATE.selectedIndex - 1 + STATE.currentList.length) % STATE.currentList.length;
            playSystemSound('scratch');
            updateSelection();
            return;
        }
        if (e.code === 'ArrowDown') {
            e.preventDefault();
            STATE.selectedIndex = (STATE.selectedIndex + 1) % STATE.currentList.length;
            playSystemSound('scratch');
            updateSelection();
            return;
        }
        // Escape to go up folder or exit game at root
        if (e.code === 'Escape') {
            e.preventDefault();
            if (STATE.currentFolder !== null) {
                STATE.currentFolder = null;
                STATE.selectedIndex = 0;
                playSystemSound('f-close');
                renderSongList();
            } else {
                // At root level - exit the game (HOLD REQUIRED)
                if (!STATE.exitTimeout) {
                    STATE.escapePressTime = Date.now(); // Track press time
                    const overlay = document.getElementById('exit-overlay');
                    if (overlay) overlay.classList.add('visible');
                    STATE.exitTimeout = setTimeout(() => {
                        if (IS_DESKTOP && window.electronAPI && window.electronAPI.closeWindow) {
                            window.electronAPI.closeWindow();
                        }
                        // If not desktop or failed, cleanup
                        if (overlay) overlay.classList.remove('visible');
                        STATE.exitTimeout = null;
                    }, 2000);
                }
            }
            return;
        }
    }

    const actions = STATE.keyCodeToAction[e.code];
    if (!actions) return;

    // Block input in Autoplay
    if (STATE.autoplay && STATE.isPlaying) return;

    // Immediate START open (if Settings not open)
    if (actions.includes(ACTIONS.START) && !STATE.isPlaying) {
        if (ui.modalSettings.classList.contains('open')) return; // Block if Settings is open
        if (!STATE.isOptionsOpen) {
            playSystemSound('o-open'); // SFX Fix
            STATE.isOptionsOpen = true;
            STATE.startOpenedOptions = true; // Track that START was used to open options
            ui.modalOptions.classList.add('open');
            updateOptionsUI();
            drawWiringLines();
        }
    }

    // Options menu navigation
    if (STATE.isOptionsOpen) {
        e.preventDefault();
        actions.forEach(action => {
            // Update active actions for multi-key combos (like 5+7 or 6+7)
            STATE.activeActions.add(action);

            const has5 = STATE.activeActions.has(ACTIONS.P1_5);
            const has7 = STATE.activeActions.has(ACTIONS.P1_7);
            const has6 = STATE.activeActions.has(ACTIONS.P1_6);

            // Key 1: Mode Cycle
            if (action === ACTIONS.P1_1) {
                const modes = ['ALL', '单', '5', '7', '9', '双', '10', '14'];
                let idx = modes.indexOf(STATE.keyModeFilter);
                STATE.keyModeFilter = modes[(idx + 1) % modes.length];
                STATE.optionsChangedFilter = true;
            }
            // Key 2: Style Cycle
            if (action === ACTIONS.P1_2) {
                const styles = ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'H-RANDOM', 'R-RANDOM', 'ALL-SCRATCH'];
                let idx = styles.indexOf(STATE.modifier);
                STATE.modifier = styles[(idx + 1) % styles.length];
            }
            // Key 3: Battle Placeholder
            if (action === ACTIONS.P1_3) { /* placeholder */ }
            // Key 4: Gauge Cycle
            if (action === ACTIONS.P1_4) {
                stepOption('gaugeType', 1);
            }
            // Key 5/7: HS / Fix
            if (action === ACTIONS.P1_5) {
                if (has7) {
                    const fixes = ['NONE', 'MIN', 'MAX', 'AVG', 'CONSTANT', 'START', 'MAIN'];
                    let idx = fixes.indexOf(STATE.hiSpeedFix);
                    STATE.hiSpeedFix = fixes[(idx + 1) % fixes.length];
                } else {
                    STATE.speed = Math.max(0.5, STATE.speed - 0.5);
                }
            }
            if (action === ACTIONS.P1_7) {
                if (has5) {
                    const fixes = ['NONE', 'MIN', 'MAX', 'AVG', 'CONSTANT', 'START', 'MAIN'];
                    let idx = fixes.indexOf(STATE.hiSpeedFix);
                    STATE.hiSpeedFix = fixes[(idx + 1) % fixes.length];
                } else if (has6) {
                    const ranges = ['OFF', 'SUDDEN+', 'LIFT', 'LIFT-SUD+'];
                    let idx = ranges.indexOf(STATE.rangeMode);
                    STATE.rangeMode = ranges[(idx + 1) % ranges.length];
                } else {
                    STATE.speed = Math.min(10, STATE.speed + 0.5);
                }
            }
            // Key 6: Assist / Range
            if (action === ACTIONS.P1_6) {
                if (has7) {
                    const ranges = ['OFF', 'SUDDEN+', 'LIFT', 'LIFT-SUD+'];
                    let idx = ranges.indexOf(STATE.rangeMode);
                    STATE.rangeMode = ranges[(idx + 1) % ranges.length];
                } else {
                    const assists = ['OFF', 'A-SCR', 'EX-JUDGE', 'BOTH'];
                    let idx = assists.indexOf(STATE.assistMode);
                    STATE.assistMode = assists[(idx + 1) % assists.length];
                }
            }

            // SCRATCH: Pacemaker Target
            if (action === ACTIONS.P1_SC_CCW) {
                rotatePacemakerTarget(-1);
            }
            if (action === ACTIONS.P1_SC_CW) {
                rotatePacemakerTarget(1);
            }

            // Play change sound for relevant keys
            // Note: P1_4 uses stepOption which plays sound/saves internally, so it's excluded here
            if ([ACTIONS.P1_1, ACTIONS.P1_2, ACTIONS.P1_5, ACTIONS.P1_6, ACTIONS.P1_7, ACTIONS.P1_SC_CCW, ACTIONS.P1_SC_CW].includes(action)) {
                playSystemSound('o-change');
                savePlayerOptions();
            }
        });
        updateOptionsUI();
        return;
    }

    if (ui.modalSettings.classList.contains('open')) {
        return;
    }

    e.preventDefault();
    actions.forEach(action => {
        STATE.activeActions.add(action);

        // [FIX] Block selection inputs if Decide screen is active or game is starting
        if (!STATE.isPlaying && !STATE.isOptionsOpen && !STATE.isResults && !STATE.isDecideActive && !STATE.isStarting && !STATE.isFadingOut) {
            // SCRATCH NAVIGATION
            if (action === ACTIONS.P1_SC_CCW) {
                STATE.selectedIndex = (STATE.selectedIndex - 1 + STATE.currentList.length) % STATE.currentList.length;
                playSystemSound('scratch');
                updateSelection();
                return;
            }
            if (action === ACTIONS.P1_SC_CW) {
                STATE.selectedIndex = (STATE.selectedIndex + 1) % STATE.currentList.length;
                playSystemSound('scratch');
                updateSelection();
                return;
            }

            // FOLDER CONTROLS (NUMERICAL)
            const item = STATE.currentList[STATE.selectedIndex];
            const isOpenKey = [ACTIONS.P1_1, ACTIONS.P1_3, ACTIONS.P1_5, ACTIONS.P1_7].includes(action);
            const isCloseKey = [ACTIONS.P1_2, ACTIONS.P1_4, ACTIONS.P1_6].includes(action);

            if (isOpenKey) {
                if (item.type === 'back') {
                    STATE.currentFolder = null; STATE.selectedIndex = 0; playSystemSound('f-close'); renderSongList();
                } else if (item.type === 'folder' || item.type === 'course') {
                    item.el.click();
                } else if (item.type === 'chart') {
                    if (ui.btnStart.disabled === false) triggerDecideScreen(false);
                }
                return;
            }

            if (isCloseKey && STATE.currentFolder !== null) {
                STATE.currentFolder = null; STATE.selectedIndex = 0; playSystemSound('f-close'); renderSongList();
                return;
            }
        }

        // SELECT KEY CYCLE LOGIC
        if (action === ACTIONS.SELECT && !STATE.isPlaying) {
            const filters = ['ALL', 'BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];
            let idx = filters.indexOf(STATE.difficultyFilter);
            STATE.difficultyFilter = filters[(idx + 1) % filters.length];
            renderSongList();
            return;
        }

        if (!STATE.isPlaying || e.repeat) return;

        const targets = ACTION_TO_CHANNELS[action];
        if (!targets) return;

        const now = (audioCtx.currentTime - STATE.startTime) * 1000;
        let win = JUDGE_WINDOWS[STATE.loadedSong.rank] || JUDGE_WINDOWS[3];
        if (STATE.assistMode === 'EX-JUDGE' || STATE.assistMode === 'BOTH') {
            win = { PG: win.PG * 1.5, GR: win.GR * 1.5, GD: win.GD * 1.5, BD: win.BD * 1.5, PR: win.PR };
        }

        // OPTIMIZED: Sliding window note lookup instead of full array scan
        // Uses logicCursor to limit search range from O(n) to O(~150) constant time
        const notes = STATE.loadedSong.notes;
        const scanStart = Math.max(0, (STATE.logicCursor || 0) - 20);
        const scanEnd = Math.min(notes.length, (STATE.logicCursor || 0) + 150);

        let noteIdx = -1;
        for (let i = scanStart; i < scanEnd; i++) {
            const n = notes[i];
            if (!n.hit && targets.includes(n.ch) && Math.abs(now - n.time) <= win.BD) {
                noteIdx = i;
                break;
            }
        }

        if (noteIdx !== -1) {
            const note = notes[noteIdx];
            note.hit = true;
            playSound(note.id);
            const diff = now - note.time;
            const absDiff = Math.abs(diff);
            let res = 'BAD';
            if (absDiff <= win.PG) res = 'PGREAT';
            else if (absDiff <= win.GR) res = 'GREAT';
            else if (absDiff <= win.GD) res = 'GOOD';
            handleJudgment(res, diff);
        } else {
            // OPTIMIZED: Same sliding window for empty poor detection
            let hasUpcoming = false;
            for (let i = scanStart; i < scanEnd; i++) {
                const n = notes[i];
                const timeDiff = n.time - now;
                if (!n.hit && targets.includes(n.ch) && timeDiff > win.BD && timeDiff <= 1000) {
                    hasUpcoming = true;
                    break;
                }
            }
            if (hasUpcoming) {
                handleJudgment('POOR', 0, true);
            }
        }
    });
});

window.addEventListener('keyup', e => {
    // Escape Cancel Logic
    if (e.code === 'Escape') {
        if (STATE.exitTimeout) {
            clearTimeout(STATE.exitTimeout);
            STATE.exitTimeout = null;
            const overlay = document.getElementById('exit-overlay');
            if (overlay) overlay.classList.remove('visible');

            // Show tooltip if short press and at root
            if (STATE.currentFolder === null && !STATE.isPlaying && !STATE.isOptionsOpen &&
                (Date.now() - STATE.escapePressTime < 2000)) {

                const tooltip = document.getElementById('exit-tooltip');
                if (tooltip) {
                    tooltip.classList.add('show');
                    if (STATE.tooltipTimeout) clearTimeout(STATE.tooltipTimeout);
                    STATE.tooltipTimeout = setTimeout(() => {
                        tooltip.classList.remove('show');
                    }, 2000);
                }
            }
        }
    }
    const actions = STATE.keyCodeToAction[e.code];

    // Replay Recording (Release)
    if (STATE.isPlaying && !STATE.autoplay) {
        STATE.inputLog.push({
            t: (audioCtx.currentTime - STATE.startTime) * 1000,
            k: e.code,
            d: false
        });
    }

    if (!actions) return;

    actions.forEach(action => {
        STATE.activeActions.delete(action);

        if (action === ACTIONS.START) {
            const optionsWereOpen = STATE.isOptionsOpen;
            // Close options on release (if held or if we're tapping to close)
            if (STATE.isOptionsOpen && (!STATE.isOptionsPersistent || optionsWereOpen)) {
                closeOptions();
            }
            // Reset persistence
            STATE.isOptionsPersistent = false;

            // Reset the flag
            STATE.startOpenedOptions = false;
        }

        // White keys to start game
        if ([ACTIONS.P1_1, ACTIONS.P1_3, ACTIONS.P1_5, ACTIONS.P1_7,
        ACTIONS.P2_1, ACTIONS.P2_3, ACTIONS.P2_5, ACTIONS.P2_7].includes(action)) {
            if (!STATE.isPlaying && !STATE.isStarting && !STATE.isOptionsOpen && !STATE.isResults) {
                if (ui.btnStart.disabled === false) triggerDecideScreen(false);
            }
        }
    });
});

function updateScaling() {
    const baseW = 1600;
    const baseH = 900;
    const winW = window.innerWidth;
    const titlebarH = (IS_DESKTOP && ui.titlebar && ui.titlebar.style.display !== 'none') ? 32 : 0;
    const winH = window.innerHeight - titlebarH;

    const scale = Math.min(winW / baseW, winH / baseH);
    const left = (winW - baseW * scale) / 2;
    const top = titlebarH + (winH - baseH * scale) / 2;

    const app = document.getElementById('app');
    if (app) app.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
}

function resize() {
    canvas.width = 1600;  // Internal resolution stays constant
    canvas.height = 900;
    updateScaling();
}
window.addEventListener('resize', resize);

// INITIALIZATION
(async () => {
    // Load persistent data from files (desktop) or localStorage (web)
    await initPersistentData();
    await loadKeybindsAsync();
    await loadPlayerOptionsAsync();
    await loadSystemSounds();

    // Load Judgement Image
    STATE.judgementImage = new Image();
    STATE.judgementImage.src = 'judgement.png';
    await new Promise(r => STATE.judgementImage.onload = r);

    // Resume/Start BGM on first interaction
    const startBgm = () => {
        // Don't play BGM during loading process
        if (!STATE.loadingComplete) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!STATE.selectBgmSource) {
            STATE.selectBgmSource = playSystemSound('select', true);
        }
        window.removeEventListener('keydown', startBgm);
        window.removeEventListener('mousedown', startBgm);
    };
    window.addEventListener('keydown', startBgm);
    window.addEventListener('mousedown', startBgm);

    document.getElementById('btn-save-options').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeOptions();
    };

    // Initial Settings Sync & Scaling (settings already loaded from options.sav via loadPlayerOptionsAsync)
    if (IS_DESKTOP) {
        applyWindowSettings(true); // Apply UI state without re-triggering IPC
    }
    resize();

    if (IS_DESKTOP) {
        // Auto-rescan library on startup
        console.log("Startup: Rescanning library...");
        await rescanAllFolders();
    }
})();

