class Renderer10K {
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
        const sideW = wScratch + (wKey * 7); // 340
        const gap = 40; // Gap between P1 and P2
        const totalW = sideW * 2 + gap;
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

        // Helper to draw a single 7K side
        // isP2: if true, layout is Keys 1-7 then Scratch (Right Scratch)
        const drawSide = (offsetX, isP2) => {
            ctx.save();
            ctx.translate(offsetX, 0);

            // Per-lane drawer
            const drawSingleLane = (actList, x, w, isBlack, isBlue, isScratch, beamIndex, isDisabled) => {
                const actionList = Array.isArray(actList) ? actList : [actList];
                const active = actionList.some(a => state.activeActions.has(a));
                const realBeamIdx = isP2 ? beamIndex + 8 : beamIndex;

                // Beam Opacity Logic - Disabled if lane is disabled
                if (!isDisabled) {
                    if (active) {
                        state.beamOpacity[realBeamIdx] = Math.min(1.0, (state.beamOpacity[realBeamIdx] || 0) + 0.2);
                    } else {
                        state.beamOpacity[realBeamIdx] = Math.max(0.0, (state.beamOpacity[realBeamIdx] || 0) - 0.1);
                    }
                } else {
                    state.beamOpacity[realBeamIdx] = 0;
                }

                if (isDisabled) {
                    ctx.fillStyle = '#080808'; // Greyed out
                } else if (isScratch) {
                    ctx.fillStyle = '#200';
                } else if (isBlue) {
                    ctx.fillStyle = '#000510';
                } else {
                    ctx.fillStyle = '#111';
                }

                ctx.fillRect(x, 0, w, hitY + 50);
                ctx.strokeStyle = '#333';
                if (isDisabled) ctx.strokeStyle = '#222';
                ctx.strokeRect(x, 0, w, hitY + 50);

                if ((state.beamOpacity[realBeamIdx] || 0) > 0.01 && !isDisabled) {
                    const beamH = hitY * 0.2;
                    const g = ctx.createLinearGradient(0, hitY, 0, hitY - beamH);
                    const alpha = state.beamOpacity[realBeamIdx] || 0;

                    if (isScratch) {
                        g.addColorStop(0, `rgba(255, 50, 50, ${alpha * 0.6})`);
                        g.addColorStop(1, `rgba(255, 0, 0, 0)`);
                    } else {
                        g.addColorStop(0, `rgba(200, 255, 255, ${alpha * 0.5})`);
                        g.addColorStop(1, `rgba(0, 255, 255, 0)`);
                    }

                    ctx.fillStyle = g;
                    ctx.fillRect(x, hitY - beamH, w, beamH);

                    if (active) {
                        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
                        ctx.fillRect(x, hitY - 2, w, 4);
                    }
                }
            };

            // Draw Structure
            if (!isP2) {
                // P1: Scratch | 1 2 3 4 5 [6 7 Disabled]
                drawSingleLane([actions.P1_SC_CCW, actions.P1_SC_CW], 0, wScratch, false, false, true, 0, false);
                let cx = wScratch;
                for (let i = 1; i <= 7; i++) {
                    const isBlue = (i === 2 || i === 4 || i === 6);
                    const isDisabled = (i >= 6);
                    drawSingleLane(actions[`P1_${i}`], cx, wKey, !isBlue, isBlue, false, i, isDisabled);
                    cx += wKey;
                }
            } else {
                // P2: 1 2 3 4 5 [6 7 Disabled] | Scratch 
                // Wait, traditionally DP is mirrored? 
                // 14K was: 1 2 3 4 5 6 7 S
                // So for 10K P2: 1 2 3 4 5 [6 7] S ??
                // Or [6 7] 1 2 3 4 5 S ??
                // If keys 1-5 are used, then 1-5 should be active. 
                // So 1,2,3,4,5 active. 6,7 disabled.
                let cx = 0;
                for (let i = 1; i <= 7; i++) {
                    const isBlue = (i === 2 || i === 4 || i === 6);
                    const isDisabled = (i >= 6);
                    drawSingleLane(actions[`P2_${i}`], cx, wKey, !isBlue, isBlue, false, i, isDisabled);
                    cx += wKey;
                }
                // Scratch at end
                drawSingleLane([actions.P2_SC_CCW, actions.P2_SC_CW], cx, wScratch, false, false, true, 0, false);
            }

            // Hit Line
            ctx.fillStyle = '#ff0055';
            ctx.fillRect(0, hitY, sideW, 15);

            ctx.restore();
        };

        ctx.save();
        ctx.translate(startX, 0);

        drawSide(0, false); // P1
        drawSide(sideW + gap, true); // P2

        ctx.restore();

        // Note Rendering
        const maxTimeOffset = (canvas.height + 100) / baseSpeed;
        const minTime = time - 200;
        const maxTime = time + maxTimeOffset;

        let startIdx = state.logicCursor || 0;
        if (startIdx >= state.loadedSong.notes.length) startIdx = state.loadedSong.notes.length - 1;

        while (startIdx > 0 && state.loadedSong.notes[startIdx] && state.loadedSong.notes[startIdx].time > minTime) startIdx--;
        while (startIdx < state.loadedSong.notes.length && state.loadedSong.notes[startIdx].time < minTime) startIdx++;

        let endIdx = startIdx;
        while (endIdx < state.loadedSong.notes.length && state.loadedSong.notes[endIdx].time < maxTime) endIdx++;

        const drawNote = (x, y, w, isSc, isBlue) => {
            if (isSc) ctx.fillStyle = '#f00';
            else if (isBlue) ctx.fillStyle = '#0cf';
            else ctx.fillStyle = '#fff';
            ctx.fillRect(x, y, w, 15);
        };

        ctx.save();
        ctx.translate(startX, 0);

        for (let i = startIdx; i < endIdx; i++) {
            const n = state.loadedSong.notes[i];
            if (n.hit && !n.isMissed) continue;
            if (n.isMissed && (time - n.missTime > 1000)) continue;

            const ch = n.ch;
            let p1 = true;
            let lane = -1; // 0=Sc, 1-7=Key

            // Check P1
            if (channels.P1.SCRATCH.includes(ch)) lane = 0;
            else if (channels.P1.KEY1.includes(ch)) lane = 1;
            else if (channels.P1.KEY2.includes(ch)) lane = 2;
            else if (channels.P1.KEY3.includes(ch)) lane = 3;
            else if (channels.P1.KEY4.includes(ch)) lane = 4;
            else if (channels.P1.KEY5.includes(ch)) lane = 5;
            else if (channels.P1.KEY6.includes(ch)) lane = 6;
            else if (channels.P1.KEY7.includes(ch)) lane = 7;

            if (lane === -1) {
                p1 = false;
                if (channels.P2.SCRATCH.includes(ch)) lane = 0;
                else if (channels.P2.KEY1.includes(ch)) lane = 1;
                else if (channels.P2.KEY2.includes(ch)) lane = 2;
                else if (channels.P2.KEY3.includes(ch)) lane = 3;
                else if (channels.P2.KEY4.includes(ch)) lane = 4;
                else if (channels.P2.KEY5.includes(ch)) lane = 5;
                else if (channels.P2.KEY6.includes(ch)) lane = 6;
                else if (channels.P2.KEY7.includes(ch)) lane = 7;
            }

            if (lane === -1) continue;

            const dist = (n.time - time) * baseSpeed;
            let y = hitY - dist;
            if (y > hitY && !n.isMissed) y = hitY;
            if (n.isMissed) y = hitY;
            if (y < -50 || y > canvas.height + 50) continue;

            let x = 0;
            let w = wKey;

            if (p1) {
                // S 1 2 3 4 5 6 7
                if (lane === 0) { x = 0; w = wScratch; }
                else { x = wScratch + (lane - 1) * wKey; }
            } else {
                // Offset P2: sideW + gap
                // 1 2 3 4 5 6 7 S
                const offset = sideW + gap;
                if (lane === 0) { x = offset + (7 * wKey); w = wScratch; }
                else { x = offset + (lane - 1) * wKey; }
            }

            drawNote(x + 1, y, w - 2, lane === 0, (lane === 2 || lane === 4 || lane === 6));
        }

        // --- Lane Covers (SUDDEN+ / LIFT) ---
        const rangeMode = state.rangeMode || 'OFF';
        const suddenPercent = state.suddenPlus || 0;
        const liftPercent = state.lift || 0;

        if (rangeMode === 'SUDDEN+' || rangeMode === 'LIFT-SUD+') {
            const suddenHeight = hitY * (suddenPercent / 100);
            if (suddenHeight > 0) {
                const grad = ctx.createLinearGradient(0, suddenHeight - 30, 0, suddenHeight);
                grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
                grad.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, totalW, suddenHeight - 30);
                ctx.fillStyle = grad;
                ctx.fillRect(0, suddenHeight - 30, totalW, 30);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(0, suddenHeight - 2, totalW, 2);
            }
        }

        if (rangeMode === 'LIFT' || rangeMode === 'LIFT-SUD+') {
            const liftHeight = (canvas.height - hitY) * (liftPercent / 100);
            const liftTop = hitY + 15 - liftHeight;
            if (liftHeight > 0) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, liftTop, totalW, liftHeight + 50);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(0, liftTop, totalW, 2);
            }
        }

        ctx.restore();

        if (window.drawJudgement) window.drawJudgement(time);
    }
}
