/* BMS Parser Web Worker */

self.onmessage = function (e) {
    try {
        const result = BMSParser.parse(e.data);
        self.postMessage({ success: true, data: result });
    } catch (err) {
        self.postMessage({ success: false, error: err.message });
    }
};

class BMSParser {
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const headers = {};
        const bpmTable = {};
        const stopTable = {};
        const measureData = {}; // measure -> channel -> [data]
        let maxMeasure = 0;

        lines.forEach(line => {
            if (!line.startsWith('#')) return;

            // Improved Header Parsing
            const headerMatch = line.match(/^#(\w+)(?:\s+|　+)(.+)$/);
            if (headerMatch) {
                const key = headerMatch[1].toUpperCase();
                const val = headerMatch[2].trim();
                if (key.startsWith('BPM') && key.length > 3) {
                    bpmTable[key.substring(3)] = parseFloat(val);
                } else if (key.startsWith('STOP') && key.length > 4) {
                    stopTable[key.substring(4)] = parseFloat(val);
                } else if (isNaN(parseInt(key.substring(0, 3)))) {
                    headers[key] = val;
                }
            }

            // Channels
            const match = line.match(/^#(\d{3})(\w{2}):(.+)$/);
            if (match) {
                const mIdx = parseInt(match[1]);
                const chHex = parseInt(match[2], 16);
                if (mIdx > maxMeasure) maxMeasure = mIdx;
                if (!measureData[mIdx]) measureData[mIdx] = {};
                if (!measureData[mIdx][chHex]) measureData[mIdx][chHex] = [];
                measureData[mIdx][chHex].push(match[3]);
            }
        });

        const PLAYABLE_CHANNELS = new Set([
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, // P1 Hit
            0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x58, 0x59  // P1 LN
        ]);

        const notes = [];
        const bgm = [];
        const bgaEvents = [];
        const bpmEvents = [];

        let currentBpm = parseFloat(headers['BPM'] || 130);
        let currentTime = 0;
        let playableNoteCount = 0;

        // Process measure by measure
        for (let m = 0; m <= maxMeasure; m++) {
            const data = measureData[m] || {};
            const measureScaling = (data[0x02] && data[0x02][0]) ? parseFloat(data[0x02][0]) : 1.0;

            // Collect all events in this measure to sort them by position
            const eventsInMeasure = [];

            for (let ch in data) {
                const chNum = parseInt(ch);
                if (chNum === 0x02) continue; // Skip scaling channel

                data[ch].forEach(dataStr => {
                    const count = dataStr.length / 2;
                    for (let i = 0; i < count; i++) {
                        const val = dataStr.substr(i * 2, 2);
                        if (val === '00') continue;
                        eventsInMeasure.push({
                            pos: i / count,
                            ch: chNum,
                            val: val.toUpperCase()
                        });
                    }
                });
            }

            // Sort events by position in measure
            eventsInMeasure.sort((a, b) => a.pos - b.pos);

            // Calculate time for each event
            let lastPos = 0;
            eventsInMeasure.forEach(ev => {
                const posDiff = ev.pos - lastPos;
                // Duration of this slice: (beats in slice) * (ms per beat)
                // One measure is 4 beats. Measure length = 4 * scaling.
                const beatsInSlice = posDiff * 4 * measureScaling;
                const msPerBeat = 60000 / Math.max(0.001, currentBpm);
                currentTime += beatsInSlice * msPerBeat;
                lastPos = ev.pos;

                const id = ev.val;
                const chNum = ev.ch;

                if (PLAYABLE_CHANNELS.has(chNum)) {
                    notes.push({ time: currentTime, ch: chNum, id, hit: false });
                    playableNoteCount++;
                } else if (chNum === 0x03) {
                    currentBpm = Math.max(0.001, parseInt(id, 16));
                    bpmEvents.push({ time: currentTime, bpm: currentBpm });
                } else if (chNum === 0x08) {
                    const newBpm = bpmTable[id];
                    if (newBpm !== undefined) {
                        currentBpm = Math.max(0.001, newBpm);
                        bpmEvents.push({ time: currentTime, bpm: currentBpm });
                    }
                } else if (chNum === 0x09) {
                    const stopValue = stopTable[id];
                    if (stopValue !== undefined) {
                        const stopMs = (stopValue / 192) * 4 * (60000 / Math.max(0.001, currentBpm));
                        currentTime += stopMs;
                    }
                } else if (chNum === 0x01 || (chNum >= 0x21 && chNum <= 0x49) || (chNum >= 0x61 && chNum <= 0x69)) {
                    bgm.push({ time: currentTime, id });
                } else if (chNum === 0x04 || chNum === 0x06 || chNum === 0x07) {
                    bgaEvents.push({ time: currentTime, id, type: chNum });
                }
            });

            // Advance to end of measure
            const posDiff = 1.0 - lastPos;
            const beatsInSlice = posDiff * 4 * measureScaling;
            currentTime += beatsInSlice * (60000 / Math.max(0.001, currentBpm));
        }

        let total = parseFloat(headers['TOTAL']);
        if (isNaN(total)) total = 260;
        let rank = parseInt(headers['RANK']);
        if (isNaN(rank)) rank = 3;

        const songDuration = currentTime;
        const noteTimes = notes.map(n => n.time).sort((a, b) => a - b);
        const firstNoteTime = noteTimes.length > 0 ? noteTimes[0] : 0;
        const startNps = noteTimes.length > 0
            ? noteTimes.filter(t => t >= firstNoteTime && t <= firstNoteTime + 10000).length / 10
            : 0;
        const avgNps = songDuration > 0 ? (playableNoteCount / (songDuration / 1000)) : 0;

        let maxNps = 0;
        for (let i = 0; i < noteTimes.length; i++) {
            const start = noteTimes[i];
            const count = noteTimes.filter(t => t >= start && t < start + 1000).length;
            if (count > maxNps) maxNps = count;
        }

        const initialBpm = parseFloat(headers['BPM'] || 130);
        const allBpmEvents = [{ time: 0, bpm: initialBpm }, ...bpmEvents.sort((a, b) => a.time - b.time)];

        const bpmDurations = {}; // bpm -> total duration
        let maxBpm = -Infinity;
        let minBpm = Infinity;

        for (let i = 0; i < allBpmEvents.length; i++) {
            const current = allBpmEvents[i];
            const nextTime = (i < allBpmEvents.length - 1) ? allBpmEvents[i + 1].time : currentTime;
            const duration = nextTime - current.time;
            const b = current.bpm;

            if (b > maxBpm) maxBpm = b;
            if (b < minBpm) minBpm = b;

            bpmDurations[b] = (bpmDurations[b] || 0) + duration;
        }

        let mainBpm = initialBpm;
        let maxDuration = -1;
        for (const b in bpmDurations) {
            if (bpmDurations[b] > maxDuration) {
                maxDuration = bpmDurations[b];
                mainBpm = parseFloat(b);
            }
        }

        const avgFixBpm = (maxBpm + minBpm) / 2;

        return {
            headers,
            notes: notes.sort((a, b) => a.time - b.time),
            bgm: bgm.sort((a, b) => a.time - b.time),
            bgaEvents: bgaEvents.sort((a, b) => a.time - b.time),
            bpmEvents: bpmEvents.sort((a, b) => a.time - b.time),
            initialBpm,
            minBpm,
            maxBpm,
            mainBpm,
            avgFixBpm,
            total, rank, noteCount: playableNoteCount, songDuration,
            startNps, avgNps, maxNps
        };
    }
}
