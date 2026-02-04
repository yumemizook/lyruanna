class Renderer7K {
    constructor(canvas, ctx, state, actions, channels) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.state = state;
        this.actions = actions;
        this.channels = channels;

        // Caching for GC reduction
        this.notePool = new window.ObjectPool(() => ({ x: 0, y: 0, w: 0 }), 100);
        this.noteBatches = {
            scratch: [],
            white: [],
            blue: []
        };

        // Cache Gradients
        this.beamGradients = {};
        this.lastHitY = -1;
        this.lastBeamH = -1;
        this.lastTime = 0;
    }

    getBeamGradient(ctx, hitY, beamH, isScratch) {
        // If dimensions changed, clear cache
        if (hitY !== this.lastHitY || beamH !== this.lastBeamH) {
            this.beamGradients = {};
            this.lastHitY = hitY;
            this.lastBeamH = beamH;
        }

        const key = isScratch ? 'scratch' : 'normal';
        if (!this.beamGradients[key]) {
            const g = ctx.createLinearGradient(0, hitY, 0, hitY - beamH);
            if (isScratch) {
                g.addColorStop(0, 'rgba(255, 50, 50, 1)');
                g.addColorStop(1, 'rgba(255, 0, 0, 0)');
            } else {
                g.addColorStop(0, 'rgba(200, 255, 255, 1)');
                g.addColorStop(1, 'rgba(0, 255, 255, 0)');
            }
            this.beamGradients[key] = g;
        }
        return this.beamGradients[key];
    }

    render(time) {
        const { ctx, canvas, state, actions, channels } = this;

        // Calculate Delta Time (in seconds)
        const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0.016;
        this.lastTime = time;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const wScratch = 60; const wKey = 40;
        const p1Total = wScratch + (wKey * 7);
        const startX = 30; // Left position
        const hitY = canvas.height * 0.75; // Shifted to 75% from top

        // Scroll speed logic
        let refBpm = 150;
        if (state.hiSpeedFix === 'CONSTANT') refBpm = state.currentBpm;
        else if (state.hiSpeedFix === 'MAX') refBpm = state.loadedSong.maxBpm;
        else if (state.hiSpeedFix === 'MIN') refBpm = state.loadedSong.minBpm;
        else if (state.hiSpeedFix === 'AVG') refBpm = state.loadedSong.avgFixBpm;
        else if (state.hiSpeedFix === 'START') refBpm = state.loadedSong.initialBpm;
        else if (state.hiSpeedFix === 'MAIN') refBpm = state.loadedSong.mainBpm;

        const speed = (state.speed * 0.375) * (Math.max(0.001, state.currentBpm) / Math.max(0.001, refBpm));
        const baseSpeed = speed; // Alias for clarity in calculations below

        ctx.save();
        ctx.translate(startX, 0);

        // Helper to map key index for beam array
        // Scratch is index 0. Keys 1-7 match index 1-7.
        const drawLane = (actList, x, w, isBlack, isBlue, isScratch, beamIndex) => {
            const actionList = Array.isArray(actList) ? actList : [actList];
            const active = actionList.some(a => state.activeActions.has(a));

            // Beam Opacity Logic (Frame Rate Independent)
            // Target speed: +0.2 per frame (assume 60fps) => +12.0 per sec
            // Decay: -0.1 per frame => -6.0 per sec
            const speedUp = 12.0;
            const speedDown = 6.0;

            if (active) {
                state.beamOpacity[beamIndex] = Math.min(1.0, state.beamOpacity[beamIndex] + (speedUp * dt));
            } else {
                state.beamOpacity[beamIndex] = Math.max(0.0, state.beamOpacity[beamIndex] - (speedDown * dt));
            }

            if (isScratch) ctx.fillStyle = '#200';
            else if (isBlue) ctx.fillStyle = '#000510';
            else ctx.fillStyle = '#111';
            ctx.fillRect(x, 0, w, hitY + 50); // Trim height
            ctx.strokeStyle = '#333'; ctx.strokeRect(x, 0, w, hitY + 50);

            // Draw Beam (Laser) if opacity > 0
            if (state.beamOpacity[beamIndex] > 0.01) {
                const beamH = hitY * 0.2;
                const alpha = state.beamOpacity[beamIndex];

                // Use Cached Gradient with Global Alpha
                // Note: Clearing the gradient cache if hitY changes (resize) checks would be needed in a robust engine,
                // but hitY is recalculated locally. Ideally store hitY in `this` and check change.
                // For now, assume consistent hitY or recreation isn't bottleneck.
                // Actually, I'll invalid cache if hitY matches.

                // Using method call for cleaner code
                const grad = this.getBeamGradient(ctx, hitY, beamH, isScratch);

                ctx.save();
                ctx.globalAlpha = isScratch ? alpha * 0.6 : alpha * 0.5;
                ctx.fillStyle = grad;
                ctx.fillRect(x, hitY - beamH, w, beamH);
                ctx.restore();

                // Add a bright line at receptor for impact
                if (active) {
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
                    ctx.fillRect(x, hitY - 2, w, 4);
                }
            }
        };

        // Draw Lanes
        drawLane([actions.P1_SC_CCW, actions.P1_SC_CW], 0, wScratch, false, false, true, 0);
        let curX = wScratch;
        for (let i = 1; i <= 7; i++) {
            const isBlue = (i === 2 || i === 4 || i === 6);
            drawLane(actions[`P1_${i}`], curX, wKey, !isBlue, isBlue, false, i);
            curX += wKey;
        }

        // Hit Line
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(0, hitY, p1Total, 15);

        // [ASSIST] Judge Area: Draw a subtle guideline at the receptor
        if (state.assistJudgeArea) {
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-10, hitY - 2, p1Total + 20, 19);
        }

        // --- Note Rendering ---

        // Calculate visible range
        const maxTimeOffset = (canvas.height + 100) / baseSpeed;
        const minTime = time - 200; // Just past hit line
        const maxTime = time + maxTimeOffset;

        // Find visible notes
        let startIdx = state.logicCursor || 0;
        if (startIdx >= state.loadedSong.notes.length) startIdx = state.loadedSong.notes.length - 1;

        // Backtrack
        while (startIdx > 0 && state.loadedSong.notes[startIdx] && state.loadedSong.notes[startIdx].time > minTime) {
            startIdx--;
        }
        // Forward track
        while (startIdx < state.loadedSong.notes.length && state.loadedSong.notes[startIdx].time < minTime) {
            startIdx++;
        }

        let endIdx = startIdx;
        while (endIdx < state.loadedSong.notes.length && state.loadedSong.notes[endIdx].time < maxTime) {
            endIdx++;
        }

        // Recycle note batches
        this.notePool.reset();
        const noteBatches = this.noteBatches;
        noteBatches.scratch.length = 0;
        noteBatches.white.length = 0;
        noteBatches.blue.length = 0;

        for (let i = startIdx; i < endIdx; i++) {
            const n = state.loadedSong.notes[i];
            if (n.hit && !n.isMissed) continue;
            if (n.isMissed && (time - n.missTime > 1000)) continue;

            let x = -1, w = wKey, isSc = false, isBlue = false;
            const ch = n.ch;

            // Mappings (could be cached map but this is fast enough)
            if (channels.P1.SCRATCH.includes(ch)) { x = 0; w = wScratch; isSc = true; }
            else if (channels.P1.KEY1.includes(ch)) { x = wScratch; }
            else if (channels.P1.KEY2.includes(ch)) { x = wScratch + wKey; isBlue = true; }
            else if (channels.P1.KEY3.includes(ch)) { x = wScratch + wKey * 2; }
            else if (channels.P1.KEY4.includes(ch)) { x = wScratch + wKey * 3; isBlue = true; }
            else if (channels.P1.KEY5.includes(ch)) { x = wScratch + wKey * 4; }
            else if (channels.P1.KEY6.includes(ch)) { x = wScratch + wKey * 5; isBlue = true; }
            else if (channels.P1.KEY7.includes(ch)) { x = wScratch + wKey * 6; }

            if (x === -1) continue;

            const dist = (n.time - time) * baseSpeed;
            let y = hitY - dist;

            // Stop at receptor if falling past
            if (y > hitY && !n.isMissed) {
                y = hitY;
            }

            if (n.isMissed) {
                y = hitY; // Clamp to receptor
            }

            if (y < -50 || y > canvas.height + 50) continue;

            const noteObj = this.notePool.borrow();
            noteObj.x = x + 1;
            noteObj.y = y;
            noteObj.w = w - 2;

            if (isSc) noteBatches.scratch.push(noteObj);
            else if (isBlue) noteBatches.blue.push(noteObj);
            else noteBatches.white.push(noteObj);
        }

        // Draw Batches
        const drawNoteBatch = (batch, color) => {
            ctx.fillStyle = color;
            batch.forEach(n => {
                ctx.fillRect(n.x, n.y, n.w, 15);
                if (state.assistLegacyNote) {
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(n.x, n.y, n.w, 15);
                }
            });
        };

        drawNoteBatch(noteBatches.white, '#fff');
        drawNoteBatch(noteBatches.blue, '#0cf');
        drawNoteBatch(noteBatches.scratch, '#f00');

        // [ASSIST] BPM Guide: Draw horizontal lines at BPM changes
        if (state.assistBPMGuide && state.loadedSong.bpmEvents) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            state.loadedSong.bpmEvents.forEach(evt => {
                const dist = (evt.time - time) * baseSpeed;
                const y = hitY - dist;
                if (y > 0 && y < hitY) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(p1Total, y);
                    ctx.stroke();
                    // Optional: Label BPM
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.font = '10px "Outfit"';
                    ctx.fillText(Math.round(evt.bpm), -25, y + 3);
                }
            });
            ctx.restore();
        }

        // --- Lane Covers (SUDDEN+ / LIFT) ---
        // Draw lane covers AFTER notes so they hide notes behind them
        const rangeMode = state.rangeMode || 'OFF';
        const suddenPercent = state.suddenPlus || 0; // 0-100%
        const liftPercent = state.lift || 0; // 0-100%

        if (rangeMode === 'SUDDEN+' || rangeMode === 'LIFT-SUD+') {
            // SUDDEN+: Cover from top of notefield down to suddenPercent% of the way to hitY
            const suddenHeight = hitY * (suddenPercent / 100);
            if (suddenHeight > 0) {
                // Gradient for smooth edge
                const grad = ctx.createLinearGradient(0, suddenHeight - 30, 0, suddenHeight);
                grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
                grad.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, p1Total, suddenHeight - 30);
                ctx.fillStyle = grad;
                ctx.fillRect(0, suddenHeight - 30, p1Total, 30);

                // White line indicator at bottom edge
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(0, suddenHeight - 2, p1Total, 2);
            }
        }

        if (rangeMode === 'LIFT' || rangeMode === 'LIFT-SUD+') {
            // LIFT: Cover from bottom of notefield up to liftPercent% from hitY
            const liftHeight = (canvas.height - hitY) * (liftPercent / 100);
            const liftTop = hitY + 15 - liftHeight; // Start above receptor
            if (liftHeight > 0) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, liftTop, p1Total, liftHeight + 50);

                // White line indicator at top edge
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(0, liftTop, p1Total, 2);
            }
        }

        ctx.restore();

        // Draw Judgement
        if (window.drawJudgement) window.drawJudgement(time);
    }
}
