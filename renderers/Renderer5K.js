class Renderer5K {
    constructor(canvas, ctx, state, actions, channels) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.state = state;
        this.actions = actions;
        this.channels = channels;
    }

    render(time) {
        const { ctx, canvas, state, actions, channels } = this;

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
        const baseSpeed = speed;

        ctx.save();
        ctx.translate(startX, 0);

        // Helper to map key index for beam array
        // Scratch is index 0. Keys 1-7 match index 1-7.
        const drawLane = (actList, x, w, isBlack, isBlue, isScratch, beamIndex, isDisabled) => {
            const actionList = Array.isArray(actList) ? actList : [actList];
            const active = actionList.some(a => state.activeActions.has(a));

            // Beam Opacity Logic - Disabled for 6/7
            if (!isDisabled) {
                if (active) {
                    state.beamOpacity[beamIndex] = Math.min(1.0, state.beamOpacity[beamIndex] + 0.2);
                } else {
                    state.beamOpacity[beamIndex] = Math.max(0.0, state.beamOpacity[beamIndex] - 0.1);
                }
            } else {
                state.beamOpacity[beamIndex] = 0;
            }

            if (isDisabled) {
                // Greyed out style
                ctx.fillStyle = '#080808';
            } else if (isScratch) {
                ctx.fillStyle = '#200';
            } else if (isBlue) {
                ctx.fillStyle = '#000510';
            } else {
                ctx.fillStyle = '#111';
            }

            ctx.fillRect(x, 0, w, hitY + 50); // Trim height
            ctx.strokeStyle = '#333';
            if (isDisabled) ctx.strokeStyle = '#222'; // Darker borders for disabled
            ctx.strokeRect(x, 0, w, hitY + 50);

            // Draw Beam (Laser) if opacity > 0
            if (state.beamOpacity[beamIndex] > 0.01 && !isDisabled) {
                const beamH = hitY * 0.2; // 20% of notefield height from receptor upwards
                // Gradient: Transparent -> Color (at receptor)
                const g = ctx.createLinearGradient(0, hitY, 0, hitY - beamH);
                // Set color based on active state or lingering opacity
                const alpha = state.beamOpacity[beamIndex];

                if (isScratch) {
                    g.addColorStop(0, `rgba(255, 50, 50, ${alpha * 0.6})`);
                    g.addColorStop(1, `rgba(255, 0, 0, 0)`);
                } else {
                    g.addColorStop(0, `rgba(200, 255, 255, ${alpha * 0.5})`);
                    g.addColorStop(1, `rgba(0, 255, 255, 0)`);
                }

                ctx.fillStyle = g;
                // Draw from hitY upwards
                ctx.fillRect(x, hitY - beamH, w, beamH);

                // Add a bright line at receptor for impact
                if (active) {
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
                    ctx.fillRect(x, hitY - 2, w, 4);
                }
            }
        };

        // Draw Lanes
        // Sc, 1, 2, 3, 4, 5 (Normal)
        // 6, 7 (Disabled)
        drawLane([actions.P1_SC_CCW, actions.P1_SC_CW], 0, wScratch, false, false, true, 0, false);
        let curX = wScratch;
        for (let i = 1; i <= 7; i++) {
            const isBlue = (i === 2 || i === 4 || i === 6);
            const isDisabled = (i === 6 || i === 7);
            drawLane(actions[`P1_${i}`], curX, wKey, !isBlue, isBlue, false, i, isDisabled);
            curX += wKey;
        }

        // Hit Line - Only for active range? Or full? 
        // 5K typically covers Sc+5Keys.
        // We will draw full line but darkened for disabled area?
        // Or just full line to keep it clean.
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(0, hitY, p1Total, 15);

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

        const noteBatches = {
            scratch: [],
            white: [],
            blue: []
        };

        for (let i = startIdx; i < endIdx; i++) {
            const n = state.loadedSong.notes[i];
            if (n.hit && !n.isMissed) continue;
            if (n.isMissed && (time - n.missTime > 1000)) continue;

            let x = -1, w = wKey, isSc = false, isBlue = false;
            const ch = n.ch;

            // Mappings for 5K: same as 7K
            // Lanes 6/7 shouldn't have notes in 5K mode normally, 
            // but if they do (due to weird chart), they will just fall in disabled lanes.

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

            if (isSc) noteBatches.scratch.push({ x: x + 1, y, w: w - 2 });
            else if (isBlue) noteBatches.blue.push({ x: x + 1, y, w: w - 2 });
            else noteBatches.white.push({ x: x + 1, y, w: w - 2 });
        }

        ctx.fillStyle = '#fff';
        noteBatches.white.forEach(n => ctx.fillRect(n.x, n.y, n.w, 15));

        ctx.fillStyle = '#0cf';
        noteBatches.blue.forEach(n => ctx.fillRect(n.x, n.y, n.w, 15));

        ctx.fillStyle = '#f00';
        noteBatches.scratch.forEach(n => ctx.fillRect(n.x, n.y, n.w, 15));

        ctx.restore();

        // Draw Judgement
        if (window.drawJudgement) window.drawJudgement(time);
    }
}
