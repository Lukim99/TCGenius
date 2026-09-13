(function () {
    'use strict';

    // Frame-rendered chains and procedural metal/impact audio, exclusive to awakening.
    function create(stage, { reduced, context, output }) {
        const canvas = document.createElement('canvas');
        canvas.className = 'awakening-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        stage.append(canvas);
        const ctx = canvas.getContext('2d');
        const size = 720, center = size / 2;
        let phase = 'resonate', started = performance.now(), frame = 0, closed = false;
        const voices = new Set();
        const audioBus = context && output ? context.createDynamicsCompressor() : null;
        if (audioBus) {
            audioBus.threshold.value = -12; audioBus.knee.value = 8; audioBus.ratio.value = 5;
            audioBus.attack.value = .003; audioBus.release.value = .2;
            audioBus.connect(output);
        }
        const seed = n => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
        const clamp = n => Math.max(0, Math.min(1, n));
        const chains = [
            { angle: -.61, offset: -28, count: 43 },
            { angle: .65, offset: 26, count: 43 },
            { angle: -.08, offset: 48, count: 39 }
        ];
        const links = [false, true].map(edge => {
            const sprite = document.createElement('canvas');
            sprite.width = 64; sprite.height = 40;
            const pen = sprite.getContext('2d');
            const metal = pen.createLinearGradient(0, 8, 0, 33);
            [[0, '#eef3fa'], [.18, '#8997aa'], [.42, '#25313e'], [.65, '#5c6b7c'], [.82, '#c0ccda'], [1, '#111821']].forEach(([p, color]) => metal.addColorStop(p, color));
            pen.beginPath(); pen.ellipse(32, 20, edge ? 22 : 24, edge ? 4 : 12, 0, 0, Math.PI * 2);
            pen.strokeStyle = '#03060a'; pen.lineWidth = edge ? 9 : 10; pen.stroke();
            pen.strokeStyle = metal; pen.lineWidth = edge ? 5 : 6; pen.stroke();
            pen.beginPath(); pen.ellipse(32, 19, edge ? 22 : 24, edge ? 4 : 12, 0, Math.PI * 1.08, Math.PI * 1.82);
            pen.strokeStyle = '#ffffff91'; pen.lineWidth = 1; pen.stroke();
            return sprite;
        });
        function resize() {
            const width = stage.getBoundingClientRect().width;
            const pixels = Math.max(1, Math.round(width * Math.min(devicePixelRatio || 1, 2)));
            canvas.width = canvas.height = pixels;
            cancelAnimationFrame(frame);
            draw(performance.now());
        }
        const observer = new ResizeObserver(resize);
        observer.observe(stage);
        resize();

        // Noise, inharmonic resonances and falling sub-bass replace the old game samples.
        let noise;
        if (context) {
            noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
            const data = noise.getChannelData(0);
            let brown = 0;
            for (let i = 0; i < data.length; i++) {
                const white = seed(i + 21) * 2 - 1;
                brown = (brown + .035 * white) / 1.035;
                data[i] = white * .64 + brown * 2.4;
            }
        }
        function voice(source, volume, duration, delay, pan, filter) {
            const gain = context.createGain(), stereo = context.createStereoPanner();
            const time = context.currentTime + delay;
            gain.gain.setValueAtTime(.0001, time);
            gain.gain.exponentialRampToValueAtTime(volume, time + Math.min(.02, duration / 5));
            gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
            stereo.pan.value = pan;
            source.connect(filter || gain);
            if (filter) filter.connect(gain);
            gain.connect(stereo); stereo.connect(audioBus);
            voices.add(source);
            source.onended = () => { voices.delete(source); source.disconnect(); if (filter) filter.disconnect(); gain.disconnect(); stereo.disconnect(); };
            source.start(time); source.stop(time + duration + .025);
        }
        function tone(hz, endHz, volume, duration, delay = 0, pan = 0) {
            const source = context.createOscillator();
            source.frequency.setValueAtTime(hz, context.currentTime + delay);
            source.frequency.exponentialRampToValueAtTime(endHz, context.currentTime + delay + duration);
            voice(source, volume, duration, delay, pan);
        }
        function scrape(hz, endHz, volume, duration, delay = 0, pan = 0) {
            const source = context.createBufferSource(), filter = context.createBiquadFilter();
            source.buffer = noise;
            filter.type = 'bandpass'; filter.Q.value = 1.8;
            filter.frequency.setValueAtTime(hz, context.currentTime + delay);
            filter.frequency.exponentialRampToValueAtTime(endHz, context.currentTime + delay + duration);
            voice(source, volume, duration, delay, pan, filter);
        }
        function clang(delay, strength, pan, duration = .5) {
            [317, 563, 971, 1583, 2467, 3911].forEach((hz, i) => tone(hz, hz * .96, strength / (i + 2), duration / (1 + i * .2), delay, pan));
            scrape(6100, 2100, strength * .8, .12, delay, pan);
        }
        function sound(next) {
            if (!context || !output || context.state !== 'running' || document.hidden) return;
            if (next === 'resonate') {
                tone(63, 48, .4, .95);
                [.04, .27, .58].forEach((t, i) => clang(t, .22, (i - 1) * .6, .3));
            } else if (next === 'gather') {
                scrape(240, 4100, .8, 1.05, 0, -.25);
                scrape(490, 2200, .5, .85, .15, .3);
                tone(44, 110, .25, 1.1);
            } else if (next === 'seal') {
                scrape(1700, 620, .55, 1.1);
                [0, .23, .47, .65, .8, .91].forEach((t, i) => clang(t, .16 + i * .025, i % 2 ? .65 : -.65, .18));
                tone(72, 39, .35, 1.1);
            } else if (next === 'break') {
                clang(0, .75, -.55, .8); clang(.045, .7, .6, .7);
                scrape(7700, 900, 1.15, .35);
                tone(112, 31, .9, .55);
                [.18, .29, .43].forEach((t, i) => clang(t, .22, i % 2 ? -.8 : .8, .22));
            } else if (next === 'reveal') {
                tone(68, 32, .6, 1.45);
                scrape(600, 3700, .65, 1.5, 0, -.35);
                scrape(3300, 800, .45, 1.7, .08, .35);
                [827, 1423, 2309].forEach((hz, i) => tone(hz, hz * .99, .12 / (i + 1), 1.5, 0, (i - 1) * .45));
            }
        }

        function glow(x, y, radius, color, alpha) {
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
            ctx.globalAlpha = alpha; ctx.fillStyle = gradient;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        function draw(now) {
            if (!ctx || closed) return;
            const t = (now - started) / 1000;
            const breaking = phase === 'break' || phase === 'reveal';
            const breakTime = phase === 'reveal' ? t + .72 : t;
            const tension = phase === 'seal' ? clamp(t / 1.2) : breaking ? 1 : .15;
            const fade = breaking ? 1 - clamp(breakTime / 1.25) : phase === 'resonate' ? clamp(t * 1.5) : 1;
            ctx.setTransform(canvas.width / size, 0, 0, canvas.height / size, 0, 0);
            ctx.clearRect(0, 0, size, size);
            ctx.save();
            glow(center, center, 320, phase === 'seal' ? '#553837' : '#292453', .45 + tension * .12);
            ctx.globalAlpha = .22; ctx.strokeStyle = '#9caaca'; ctx.lineWidth = 1;
            for (let ring = 0; ring < 3; ring++) {
                ctx.beginPath(); ctx.arc(center, center, 215 + ring * 35, now / (ring % 2 ? -9000 : 12000), now / (ring % 2 ? -9000 : 12000) + Math.PI * 1.5); ctx.stroke();
            }
            for (let i = 0; i < 48; i++) {
                const angle = i * 2.399 + now / 34000;
                const radius = 232 + seed(i) * 64;
                ctx.globalAlpha = .18 + seed(i + 4) * .3;
                ctx.fillStyle = '#c5b9ec';
                ctx.fillRect(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, 1.4, 1.4);
            }
            if (phase === 'gather') {
                const p = clamp(t / 1.15);
                for (let i = 0; i < 80; i++) {
                    const angle = i * 2.399 + p * 4;
                    const radius = (80 + seed(i) * 255) * (1 - p);
                    ctx.globalAlpha = Math.sin(p * Math.PI) * .85;
                    ctx.strokeStyle = i % 3 ? '#c7ddff' : '#ebcda2'; ctx.lineWidth = i % 4 ? 1 : 2;
                    ctx.beginPath(); ctx.moveTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
                    ctx.lineTo(center + Math.cos(angle + .12) * (radius + 28), center + Math.sin(angle + .12) * (radius + 28)); ctx.stroke();
                }
            }
            chains.forEach((chain, row) => {
                for (let i = 0; i < chain.count; i++) {
                    const u = (i / (chain.count - 1) - .5) * 900;
                    const slack = (1 - tension) * Math.sin(i / (chain.count - 1) * Math.PI) * 27;
                    let x = center + Math.cos(chain.angle) * u;
                    let y = center + Math.sin(chain.angle) * u + chain.offset + slack;
                    let turn = chain.angle + Math.cos(i * .5 + now / 160) * (1 - tension) * .025;
                    if (phase === 'seal' && !reduced) { x += Math.sin(now / 22 + i) * tension * 1.5; y += Math.cos(now / 26 + i) * tension; }
                    if (breaking && !reduced) {
                        const direction = Math.sign(u || 1), speed = 140 + seed(i + row * 71) * 330;
                        x += direction * Math.cos(chain.angle) * speed * breakTime;
                        y += direction * Math.sin(chain.angle) * speed * breakTime + 210 * breakTime * breakTime;
                        turn += direction * breakTime * (1 + seed(i) * 6);
                    }
                    const edgeFade = clamp(Math.min(x, size - x, y, size - y) / 65);
                    ctx.save(); ctx.globalAlpha = reduced && breaking ? 0 : fade * edgeFade;
                    ctx.translate(x, y); ctx.rotate(turn);
                    ctx.drawImage(links[i % 2], -25, -15.625, 50, 31.25);
                    if (tension > .4 && Math.abs(u) < 115) {
                        ctx.globalCompositeOperation = 'screen';
                        glow(0, 0, 23, '#ffa95c', (tension - .4) * .6 * fade * edgeFade);
                    }
                    ctx.restore();
                }
            });
            if (phase === 'seal') {
                glow(center, center, 65 + tension * 45, '#eadbc5', tension * .32);
                ctx.globalAlpha = tension * .9; ctx.strokeStyle = '#ffe9bd'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(354, 296); ctx.lineTo(365, 329); ctx.lineTo(351, 356); ctx.lineTo(370, 378); ctx.lineTo(358, 423); ctx.stroke();
            }
            if (breaking && !reduced) {
                const shock = clamp(breakTime / .75);
                ctx.globalAlpha = (1 - shock) * .85; ctx.strokeStyle = '#e9d7b1'; ctx.lineWidth = 4 - shock * 3;
                ctx.beginPath(); ctx.ellipse(center, center, 40 + shock * 480, 10 + shock * 145, -.2, 0, Math.PI * 2); ctx.stroke();
                glow(center, center, 250, '#fff1d2', Math.max(0, 1 - breakTime * 4) * .8);
                for (let i = 0; i < 110; i++) {
                    const angle = seed(i + 2) * Math.PI * 2, speed = 80 + seed(i + 51) * 550;
                    const distance = speed * breakTime;
                    const x = center + Math.cos(angle) * distance, y = center + Math.sin(angle) * distance + 120 * breakTime * breakTime;
                    ctx.globalAlpha = (1 - clamp(breakTime / (1.1 + seed(i)))) * .95;
                    ctx.strokeStyle = i % 4 ? '#e6b67a' : '#f8f0d9'; ctx.lineWidth = 1 + seed(i + 4) * 2;
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(angle) * (5 + speed * .035), y - Math.sin(angle) * (5 + speed * .035)); ctx.stroke();
                }
            }
            if (phase === 'reveal') {
                glow(center, center, 250, '#8d83dd', .28);
                for (let i = 0; i < 44; i++) {
                    const x = 200 + seed(i + 10) * 320;
                    const y = 640 - ((t * (18 + seed(i) * 45) + seed(i + 20) * 560) % 560);
                    ctx.globalAlpha = .3 + seed(i + 44) * .4; ctx.fillStyle = i % 3 ? '#bfc1ef' : '#f6d7a4';
                    ctx.fillRect(x, y, 1.3, 3 + seed(i) * 3);
                }
            }
            ctx.restore(); ctx.globalAlpha = 1;
            if (!reduced && !(phase === 'reveal' && t > 4)) frame = requestAnimationFrame(draw);
        }
        function setPhase(next) {
            phase = next; started = performance.now();
            sound(next);
            cancelAnimationFrame(frame);
            draw(started);
        }
        function close() {
            closed = true; cancelAnimationFrame(frame); observer.disconnect();
            voices.forEach(source => source.stop()); voices.clear(); canvas.remove();
            if (audioBus) audioBus.disconnect();
        }
        return { setPhase, close };
    }
    window.AwakeningEffects = { create };
})();
