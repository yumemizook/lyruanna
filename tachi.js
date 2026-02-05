/**
 * ============================================================================
 * TACHI IR INTEGRATION MODULE
 * ============================================================================
 * Handles communication with Tachi (boku.tachi.ac) for Internet Ranking
 * - Score submission via ir/direct-manual endpoint
 * - Player stats/rating fetch
 * - User profile fetch
 */

// Tachi API Configuration
const TACHI_BASE_URL = 'https://boku.tachi.ac';
const TACHI_API_VERSION = 'v1';
const TACHI_SERVICE_NAME = 'Lyruanna';

// Lamp ID to Tachi Lamp String mapping
const LAMP_MAP = {
    0: 'FAILED',
    1: 'ASSIST CLEAR',
    2: 'EASY CLEAR',
    3: 'CLEAR',
    4: 'HARD CLEAR',
    5: 'EX HARD CLEAR',
    6: 'FULL COMBO',
    7: 'FULL COMBO' // Treat PERFECT same as FC for Tachi
};

// Cached user ID (fetched from /status)
let _cachedUserId = null;
// Submission Pause Timer
let _submissionDisabledUntil = 0;

/**
 * Pause score submission for a duration
 * @param {number} minutes - Minutes to add to the pause timer
 */
function pauseSubmission(minutes) {
    const now = Date.now();
    if (_submissionDisabledUntil < now) {
        _submissionDisabledUntil = now;
    }
    _submissionDisabledUntil += minutes * 60 * 1000;
    return _submissionDisabledUntil;
}

/**
 * Resume score submission immediately
 */
function resumeSubmission() {
    _submissionDisabledUntil = 0;
}

/**
 * Get the timestamp when submission will be resumed
 * @returns {number} Timestamp or 0 if active
 */
function getSubmissionResumeTime() {
    return Math.max(0, _submissionDisabledUntil);
}

/**
 * Get the Tachi API Key from settings
 * @returns {string|null}
 */
function getTachiApiKey() {
    if (typeof localStorage !== 'undefined') {
        try {
            const settings = JSON.parse(localStorage.getItem('lyruanna_settings') || '{}');
            return settings.tachiApiKey || null;
        } catch (e) {
            return null;
        }
    }
    return null;
}

/**
 * Save the Tachi API Key to settings
 * @param {string} apiKey 
 */
function setTachiApiKey(apiKey) {
    if (typeof localStorage !== 'undefined') {
        try {
            const settings = JSON.parse(localStorage.getItem('lyruanna_settings') || '{}');
            settings.tachiApiKey = apiKey;
            localStorage.setItem('lyruanna_settings', JSON.stringify(settings));
        } catch (e) {
            console.error('[Tachi] Error saving API key:', e);
        }
    }
}

/**
 * Check if Tachi integration is enabled (API key is set)
 * @returns {boolean}
 */
function isTachiEnabled() {
    const key = getTachiApiKey();
    return key && key.trim().length > 0;
}

/**
 * Build headers for Tachi API requests
 * @returns {Object}
 */
function getTachiHeaders() {
    const apiKey = getTachiApiKey();
    return {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-User-Intent': 'true'
    };
}

/**
 * Submit a score to Tachi via ir/direct-manual
 * @param {Object} scoreData - Score data object
 * @returns {Promise<Object>} - Result with success/error info
 */
async function submitTachiScore(scoreData) {
    if (!isTachiEnabled()) {
        return { success: false, error: 'Tachi API key not configured' };
    }

    if (Date.now() < _submissionDisabledUntil) {
        return { success: false, error: 'Submission paused by user', skipped: true };
    }

    const {
        chartMd5,
        playtype, // '7K' or '14K'
        score,    // EX Score
        lampId,   // Internal lamp ID (0-7)
        judgements, // { pgreat, great, good, bad, poor }
        maxCombo,
        comboBreaks // BP (bad + poor for missed notes)
    } = scoreData;

    const batchManualPayload = {
        meta: {
            game: 'bms',
            playtype: playtype,
            service: TACHI_SERVICE_NAME
        },
        scores: [{
            score: score,
            lamp: LAMP_MAP[lampId] || 'FAILED',
            matchType: 'bmsChartHash',
            identifier: chartMd5,
            judgements: {
                pgreat: judgements.pgreat || 0,
                great: judgements.great || 0,
                good: judgements.good || 0,
                bad: judgements.bad || 0,
                poor: judgements.poor || 0
            },
            optional: {
                maxCombo: maxCombo || 0,
                bp: comboBreaks || 0
            }
        }]
    };

    try {
        // Use IPC if available (Electron), otherwise fetch directly
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.submitTachiScore) {
            const result = await window.electronAPI.submitTachiScore(batchManualPayload, getTachiApiKey());
            return result;
        } else {
            // Direct fetch (for testing or web builds)
            const response = await fetch(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/ir/direct-manual/import`, {
                method: 'POST',
                headers: getTachiHeaders(),
                body: JSON.stringify(batchManualPayload)
            });

            const data = await response.json();
            if (data.success) {
                return { success: true, data: data.body };
            } else {
                return { success: false, error: data.description || 'Unknown error' };
            }
        }
    } catch (e) {
        console.error('[Tachi] Score submission error:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch the current user's Tachi player stats
 * @param {string} playtype - '7K' or '14K'
 * @returns {Promise<Object>} - Player stats or error
 */
async function fetchTachiPlayerStats(playtype = '7K') {
    if (!isTachiEnabled()) {
        return { success: false, error: 'Tachi API key not configured' };
    }

    try {
        // Use IPC if available (Electron)
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getTachiPlayerStats) {
            const result = await window.electronAPI.getTachiPlayerStats(getTachiApiKey(), playtype);
            return result;
        } else {
            // Direct fetch fallback
            // Step 1: Get user ID from /status
            const statusRes = await fetch(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/status`, {
                headers: getTachiHeaders()
            });
            const statusData = await statusRes.json();
            if (!statusData.success || !statusData.body.whoami) {
                return { success: false, error: 'Could not identify user' };
            }
            const userId = statusData.body.whoami;

            // Step 2: Fetch game stats
            const statsRes = await fetch(`${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/games/bms/${playtype}`, {
                headers: getTachiHeaders()
            });
            const statsData = await statsRes.json();
            if (!statsData.success) {
                return { success: false, error: statsData.description || 'Failed to fetch stats' };
            }

            return {
                success: true,
                userId: userId,
                gameStats: statsData.body.gameStats,
                rankingData: statsData.body.rankingData
            };
        }
    } catch (e) {
        console.error('[Tachi] Stats fetch error:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Get Sieglinde rating from player stats
 * @param {Object} gameStats - gameStats object from Tachi
 * @returns {number|null}
 */
function getSieglinde(gameStats) {
    if (gameStats && gameStats.ratings && typeof gameStats.ratings.sieglinde === 'number') {
        return gameStats.ratings.sieglinde;
    }
    return null;
}

/**
 * Get ranking info from ranking data
 * @param {Object} rankingData - rankingData object from Tachi
 * @returns {Object|null} - { ranking, outOf }
 */
function getSieglindeRank(rankingData) {
    if (rankingData && rankingData.sieglinde) {
        return {
            ranking: rankingData.sieglinde.ranking,
            outOf: rankingData.sieglinde.outOf
        };
    }
    return null;
}

/**
 * Fetch basic user profile (username, pfp)
 */
async function fetchTachiUserProfile(userId) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.getTachiUserProfile) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    return await window.electronAPI.getTachiUserProfile(apiKey, userId);
}

/**
 * Fetch user PFP as Data URI
 */
async function fetchTachiUserPfp(userId) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.getTachiUserPfp) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    return await window.electronAPI.getTachiUserPfp(apiKey, userId);
}

/**
 * Fetch recent scores for a user
 * @param {number|string} userId 
 * @param {string} playtype 
 * @param {number} limit 
 */
async function fetchTachiRecentScores(userId, playtype = '7K', limit = 50) {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };

    // Tachi v1 BMS playtypes are '7K' and '14K'
    const pt = playtype;

    try {
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/games/bms/${pt}/scores/recent`;

        const res = await fetch(url, { headers: getTachiHeaders() });
        const data = await res.json();

        if (data.success) {
            // Return full body for metadata resolution (songs, charts, etc.)
            return { success: true, body: data.body };
        } else {
            return { success: false, error: data.description };
        }
    } catch (e) {
        console.error('[Tachi] Error fetching recent scores:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch best scores (PBs)
 * @param {number|string} userId 
 * @param {string} playtype 
 * @param {number} limit 
 */
async function fetchTachiBestScores(userId, playtype = '7K', limit = 50) {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };

    // Tachi v1 BMS playtypes are '7K' and '14K'
    const pt = playtype;

    try {
        // Correct Endpoint for Top 100 PBs sorted by rating
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/games/bms/${pt}/pbs/best`;

        const res = await fetch(url, { headers: getTachiHeaders() });
        const data = await res.json();

        if (data.success) {
            // Return full body for metadata resolution
            return { success: true, body: data.body };
        } else {
            return { success: false, error: data.description };
        }
    } catch (e) {
        console.error('[Tachi] Error fetching best scores:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch chart leaderboard (PBs for a specific chart)
 * @param {string} chartId - Tachi chart ID
 * @param {string} playtype - '7K' or '14K'
 * @returns {Promise<Object>} - Leaderboard data
 */
async function fetchChartLeaderboard(chartId, playtype = '7K') {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };

    try {
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/games/bms/${playtype}/charts/${chartId}/pbs`;
        const res = await fetch(url, { headers: getTachiHeaders() });
        const data = await res.json();

        if (data.success) {
            return { success: true, pbs: data.body.pbs || [], users: data.body.users || [] };
        } else {
            return { success: false, error: data.description };
        }
    } catch (e) {
        console.error('[Tachi] Error fetching chart leaderboard:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch global Sieglinde rating leaderboard
 * @param {string} playtype - '7K' or '14K'
 * @returns {Promise<Object>} - Leaderboard with gameStats and users
 */
async function fetchSieglindeLeaderboard(playtype = '7K') {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };

    try {
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/games/bms/${playtype}/leaderboard?alg=sieglinde`;
        const res = await fetch(url, { headers: getTachiHeaders() });
        const data = await res.json();

        if (data.success) {
            return { success: true, gameStats: data.body.gameStats || [], users: data.body.users || [] };
        } else {
            return { success: false, error: data.description };
        }
    } catch (e) {
        console.error('[Tachi] Error fetching Sieglinde leaderboard:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch a specific user's PB on a chart by MD5 hash
 * Uses the score search endpoint with bmsChartHash matching
 * @param {string|number} userId - User ID
 * @param {string} chartMd5 - Chart MD5 hash
 * @param {string} playtype - '7K' or '14K'
 * @returns {Promise<Object>} - User's PB on the chart
 */
async function fetchUserChartPB(userId, chartMd5, playtype = '7K') {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };

    try {
        // Search user's PBs for matching chart hash
        const url = `${TACHI_BASE_URL}/api/${TACHI_API_VERSION}/users/${userId}/games/bms/${playtype}/pbs?search=${chartMd5}`;
        const res = await fetch(url, { headers: getTachiHeaders() });
        const data = await res.json();

        if (data.success && data.body.pbs && data.body.pbs.length > 0) {
            // Find matching chart by MD5
            const matchingPB = data.body.pbs.find(pb => {
                const chart = data.body.charts?.find(c => c.chartID === pb.chartID);
                return chart && chart.data?.hashMD5 === chartMd5;
            });
            if (matchingPB) {
                return { success: true, pb: matchingPB };
            }
        }
        return { success: false, error: 'No PB found for this chart' };
    } catch (e) {
        console.error('[Tachi] Error fetching user chart PB:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch PBs for multiple rivals on a specific chart
 * @param {Array<string|number>} rivalIds - Array of rival user IDs
 * @param {string} chartMd5 - Chart MD5 hash
 * @param {string} playtype - '7K' or '14K'
 * @returns {Promise<Object>} - Rival PBs
 */
async function fetchRivalsPBs(rivalIds, chartMd5, playtype = '7K') {
    if (!isTachiEnabled()) return { success: false, error: 'No API Key' };
    if (!rivalIds || rivalIds.length === 0) return { success: false, error: 'No rivals configured' };

    const results = [];
    for (const rivalId of rivalIds.slice(0, 3)) { // Max 3 rivals
        const result = await fetchUserChartPB(rivalId, chartMd5, playtype);
        if (result.success) {
            results.push({ userId: rivalId, pb: result.pb });
        } else {
            results.push({ userId: rivalId, pb: null });
        }
    }
    return { success: true, rivals: results };
}

/**
 * Fetch user banner as Data URI
 */
async function fetchTachiUserBanner(userId) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.getTachiUserBanner) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    return await window.electronAPI.getTachiUserBanner(apiKey, userId);
}

/**
 * Upload a new avatar image
 * @param {number} userId - User ID
 * @param {ArrayBuffer} imageBuffer - Image data as ArrayBuffer
 * @param {string} mimeType - MIME type (e.g., 'image/jpeg', 'image/png')
 */
async function uploadTachiAvatar(userId, imageBuffer, mimeType) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.uploadTachiPfp) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    return await window.electronAPI.uploadTachiPfp(apiKey, userId, imageBuffer, mimeType);
}

/**
 * Delete the current avatar
 * @param {number} userId - User ID
 */
async function deleteTachiAvatar(userId) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.deleteTachiPfp) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    return await window.electronAPI.deleteTachiPfp(apiKey, userId);
}

/**
 * Upload a new banner image
 * @param {number} userId - User ID
 * @param {ArrayBuffer} imageBuffer - Image data as ArrayBuffer
 * @param {string} mimeType - MIME type (e.g., 'image/jpeg', 'image/png')
 */
async function uploadTachiBanner(userId, imageBuffer, mimeType) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.uploadTachiBanner) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    return await window.electronAPI.uploadTachiBanner(apiKey, userId, imageBuffer, mimeType);
}

/**
 * Delete the current banner
 * @param {number} userId - User ID
 */
async function deleteTachiBanner(userId) {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.deleteTachiBanner) {
        return { success: false, error: 'IPC not available' };
    }

    const apiKey = getTachiApiKey();
    if (!apiKey) return { success: false, error: 'No API key' };
    if (!userId) return { success: false, error: 'No User ID' };

    return await window.electronAPI.deleteTachiBanner(apiKey, userId);
}

// Export for use in game.js
if (typeof window !== 'undefined') {
    window.TachiIR = {
        getTachiApiKey,
        setTachiApiKey,
        isTachiEnabled,
        getTachiHeaders,
        submitTachiScore,
        fetchTachiPlayerStats,
        fetchTachiUserProfile,
        fetchTachiUserPfp,
        fetchTachiUserBanner,
        uploadTachiAvatar,
        deleteTachiAvatar,
        uploadTachiBanner,
        deleteTachiBanner,
        getSieglinde,
        getSieglindeRank,
        pauseSubmission,
        resumeSubmission,
        getSubmissionResumeTime,
        fetchTachiRecentScores,
        fetchTachiBestScores,
        fetchChartLeaderboard,
        fetchSieglindeLeaderboard,
        fetchUserChartPB,
        fetchRivalsPBs,
        LAMP_MAP
    };
}

