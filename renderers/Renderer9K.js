class Renderer9K {
    constructor(canvas, ctx, state, actions, channels) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.state = state;
        this.actions = actions; // Note: ACTIONS might need 9K specific bindings later
        this.channels = channels;
    }

    render(time) {
        const { ctx, canvas, state, actions } = this;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // PMS Style: Centered 9 buttons
        // Button width slightly larger? 50px?
        const wKey = 50;
        const totalW = wKey * 9;
        const startX = (canvas.width - totalW) / 2; // Centered
        const hitY = canvas.height * 0.75;

        // Scroll speed logic
        let refBpm = 150;
        if (state.hiSpeedFix === 'CONSTANT') refBpm = state.currentBpm;
        else if (state.hiSpeedFix === 'MAX') refBpm = state.loadedSong.maxBpm;
        else if (state.hiSpeedFix === 'MIN') refBpm = state.loadedSong.minBpm;
        else if (state.hiSpeedFix === 'AVG') refBpm = state.loadedSong.avgFixBpm;
        else if (state.hiSpeedFix === 'START') refBpm = state.loadedSong.initialBpm;
        else if (state.hiSpeedFix === 'MAIN') refBpm = state.loadedSong.mainBpm;

        const speed = (state.speed * 0.375) * (Math.max(0.001, state.currentBpm) / Math.max(0.001, refBpm));
        const baseSpeed = speed;

        ctx.save();
        ctx.translate(startX, 0);

        // Colors
        // 1(W) 2(Y) 3(G) 4(B) 5(R) 6(B) 7(G) 8(Y) 9(W)
        const getKeyColor = (i) => {
            switch (i) {
                case 1: case 9: return '#fff'; // White
                case 2: case 8: return '#ff0'; // Yellow
                case 3: case 7: return '#0f0'; // Green
                case 4: case 6: return '#00f'; // Blue
                case 5: return '#f00'; // Red
                default: return '#fff';
            }
        };

        const drawLane = (i, x, w, beamIndex) => {
            // Mapping actions? 
            // We need P1_1 to P1_9?
            // Currently ACTIONS only goes to P1_7.
            // We'll rely on generic key checks or stub for now if actions miss 8/9.
            // Assuming ACTIONS will be updated or we use raw input checks if feasible.
            // For now, map:
            // 1-5 -> P1_1 to P1_5
            // 6-9 -> P1_6, P1_7, P2_1, P2_2 ?? No that's confusing.
            // Let's assume standard ACTIONS are used for verification, 
            // but we really need ACTIONS.P1_8 and P1_9.
            // For implementation safety, I'll just check P1_1..P1_7, and ignore 8/9 active state for now
            // until ACTIONS is updated.
            let action = null;
            if (i <= 7) action = actions[`P1_${i}`];

            const active = action && state.activeActions.has(action);

            // Beam Opacity
            if (active) {
                state.beamOpacity[beamIndex] = Math.min(1.0, state.beamOpacity[beamIndex] + 0.2);
            } else {
                state.beamOpacity[beamIndex] = Math.max(0.0, state.beamOpacity[beamIndex] - 0.1);
            }

            ctx.fillStyle = '#111'; // Lane bg
            ctx.fillRect(x, 0, w, hitY + 50);
            ctx.strokeStyle = '#333'; ctx.strokeRect(x, 0, w, hitY + 50);

            // Beam
            if (state.beamOpacity[beamIndex] > 0.01) {
                const beamH = hitY * 0.2;
                const g = ctx.createLinearGradient(0, hitY, 0, hitY - beamH);
                const alpha = state.beamOpacity[beamIndex];
                const color = getKeyColor(i);

                // Convert hex to rgb for opacity? 
                // Simplify: just white-ish beam with tint
                g.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.6})`);
                g.addColorStop(1, `rgba(255, 255, 255, 0)`);

                ctx.fillStyle = g;
                ctx.fillRect(x, hitY - beamH, w, beamH);

                if (active) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x, hitY - 2, w, 4);
                }
            }
        };

        let curX = 0;
        for (let i = 1; i <= 9; i++) {
            drawLane(i, curX, wKey, i);
            curX += wKey;
        }

        // Hit Line
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(0, hitY, totalW, 15);

        // Notes
        const maxTimeOffset = (canvas.height + 100) / baseSpeed;
        const minTime = time - 200;
        const maxTime = time + maxTimeOffset;

        let startIdx = state.logicCursor || 0;
        if (startIdx >= state.loadedSong.notes.length) startIdx = state.loadedSong.notes.length - 1;

        while (startIdx > 0 && state.loadedSong.notes[startIdx] && state.loadedSong.notes[startIdx].time > minTime) startIdx--;
        while (startIdx < state.loadedSong.notes.length && state.loadedSong.notes[startIdx].time < minTime) startIdx++;

        let endIdx = startIdx;
        while (endIdx < state.loadedSong.notes.length && state.loadedSong.notes[endIdx].time < maxTime) endIdx++;

        const notesToDraw = [];

        for (let i = startIdx; i < endIdx; i++) {
            const n = state.loadedSong.notes[i];
            if (n.hit && !n.isMissed) continue;
            if (n.isMissed && (time - n.missTime > 1000)) continue;

            const ch = n.ch;
            let laneIndex = -1;

            // Map 11-19 to 1-9
            if (ch >= 0x11 && ch <= 0x19) {
                laneIndex = ch - 0x11 + 1;
            } else if (ch >= 0x22 && ch <= 0x25) {
                // Extended channels sometimes used
                // 22->6, 23->7, 24->8, 25->9 ??
                // Let's stick to 11-19 for standard PMS
            }

            if (laneIndex === -1) continue;

            const x = (laneIndex - 1) * wKey;
            const dist = (n.time - time) * baseSpeed;
            let y = hitY - dist;

            if (y > hitY && !n.isMissed) y = hitY;
            if (n.isMissed) y = hitY;
            if (y < -50 || y > canvas.height + 50) continue;

            notesToDraw.push({ x: x + 1, y, w: wKey - 2, color: getKeyColor(laneIndex) });
        }

        notesToDraw.forEach(n => {
            ctx.fillStyle = n.color;
            ctx.fillRect(n.x, n.y, n.w, 15);
            // Border for visibility
            ctx.strokeStyle = '#000';
            ctx.strokeRect(n.x, n.y, n.w, 15);
        });

        ctx.restore();

        if (window.drawJudgement) window.drawJudgement(time);
    }
}
