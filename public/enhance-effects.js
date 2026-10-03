/* 기존 강화 기계와 실제 장비 이미지로 그리는 강화 연출. 판정은 서버 응답만 사용한다. */
(() => {
    'use strict';
    const TAU = Math.PI * 2, GOLD = '#f2cf7a', CYAN = '#38d3e8';
    const colors = { great: GOLD, success: CYAN, protected: CYAN, down: '#e06a5f', fail: '#e06a5f', destroy: '#e0564f' };
    const MUTE_KEY = 'enhance-fx-muted';
    let muted = false;
    try {
        const saved = localStorage.getItem(MUTE_KEY);
        muted = saved == null ? JSON.parse(localStorage.getItem('pqSound') || '{}').sfx === 0 : saved === '1';
    } catch (_) {}
    const playing = new Set();
    function stopSound() { playing.forEach(a => a.pause()); playing.clear(); }
    function play(file, volume = .3) {
        if (muted || document.hidden) return;
        const audio = new Audio('/rpg-ui?file=' + encodeURIComponent('sfx/' + file + '.mp3'));
        audio.volume = volume;
        playing.add(audio);
        audio.onended = audio.onerror = () => playing.delete(audio);
        audio.play().catch(() => playing.delete(audio));
    }
    function soundButton() {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'enh-sound';
        button.setAttribute('aria-label', '강화 효과음');
        const sync = () => { button.textContent = muted ? '소리 끔' : '소리 켬'; button.setAttribute('aria-pressed', String(!muted)); };
        sync();
        button.onclick = () => {
            muted = !muted;
            try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) {}
            if (muted) stopSound();
            sync();
        };
        return button;
    }

    function mount(host, info) {
        const canvas = document.createElement('canvas');
        canvas.className = 'enh-forge-canvas'; canvas.setAttribute('aria-hidden', 'true');
        host.prepend(canvas);
        const ctx = canvas.getContext('2d');
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let width = 0, height = 0, raf = 0, disposed = false, phase = 'idle', kind = '', started = 0;
        const images = {};
        for (const [key, url] of Object.entries({ forge: '/rpg-ui?file=' + encodeURIComponent('강화.png'), frame: info.frameUrl, item: info.iconUrl })) {
            if (!url) continue;
            const image = new Image(); images[key] = image;
            image.onload = image.onerror = resume; image.src = url;
        }
        const sparks = Array.from({ length: 36 }, (_, i) => ({ angle: i / 36 * TAU + Math.random() * .12, speed: 75 + Math.random() * 105, size: 1 + Math.random() * 2 }));
        function arc(radius, color, thickness = 1, rotation = 0, ticks = false) {
            ctx.save(); ctx.rotate(rotation); ctx.strokeStyle = color; ctx.lineWidth = thickness;
            ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
            if (ticks) for (let i = 0; i < 12; i++) {
                ctx.rotate(TAU / 12); ctx.beginPath(); ctx.moveTo(0, -radius - 5); ctx.lineTo(0, -radius - 13); ctx.stroke();
                ctx.strokeRect(-3, -radius - 22, 6, 6);
            }
            ctx.restore();
        }
        function sprite(size) {
            for (const key of ['frame', 'item']) {
                const image = images[key];
                if (image?.naturalWidth) ctx.drawImage(image, -size / 2, -size / 2, size, size);
            }
            if (!images.item?.naturalWidth) {
                ctx.fillStyle = '#221e30'; ctx.fillRect(-size / 2, -size / 2, size, size);
                ctx.strokeStyle = GOLD; ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.font = '34px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = GOLD; ctx.fillText('◇', 0, 12);
            }
        }
        function draw(now) {
            if (!ctx || !width || disposed) return;
            const time = now / 1000, age = (now - started) / 1000, motion = !reduced.matches;
            const size = width < 420 ? 88 : 104, radius = size / 2 + 19;
            const background = ctx.createLinearGradient(0, 0, 0, height);
            background.addColorStop(0, '#221e30'); background.addColorStop(1, '#0b0a12');
            ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
            if (images.forge?.naturalWidth) {
                // 배경의 고정 문구를 제외하고 기계 그림만 사용한다.
                const scale = Math.max(width / 641, height / 185);
                ctx.globalAlpha = .55;
                ctx.drawImage(images.forge, 0, 32, 641, 185, (width - 641 * scale) / 2, (height - 185 * scale) / 2, 641 * scale, 185 * scale);
                ctx.globalAlpha = 1;
            }
            const shade = ctx.createRadialGradient(width / 2, height * .43, 16, width / 2, height * .43, width * .6);
            shade.addColorStop(0, 'rgba(11,10,18,.08)'); shade.addColorStop(1, 'rgba(11,10,18,.96)');
            ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
            ctx.save(); ctx.translate(width / 2, height * .43);
            const tint = colors[kind] || GOLD;
            const glow = ctx.createRadialGradient(0, 12, 0, 0, 12, radius * 1.7);
            glow.addColorStop(0, tint + (phase === 'idle' ? '25' : '55')); glow.addColorStop(1, tint + '00');
            ctx.fillStyle = glow; ctx.fillRect(-radius * 1.7, -radius * 1.7, radius * 3.4, radius * 3.4);
            const charge = phase === 'charge', brake = phase === 'brake', impact = phase === 'result';
            const ringRadius = brake ? radius + (30 - radius) * Math.min(age / .18, 1) : radius;
            ctx.globalAlpha = charge || brake ? .9 : .4;
            arc(ringRadius, tint, 1, motion ? time * (charge ? 2.3 : .1) : 0, true);
            if (brake) arc(Math.max(20, ringRadius - 14), CYAN, 2);
            if (charge) {
                arc(radius - 14, CYAN, 2, motion ? -time * 3 : 0);
                if (motion) for (let i = 0; i < 20; i++) {
                    const p = (age * 1.4 + i / 20) % 1;
                    ctx.globalAlpha = (1 - p) * .8; ctx.fillStyle = GOLD;
                    ctx.fillRect(Math.sin(i * 2.4) * radius * .8 + Math.sin(age * 3 + i) * 6, radius + 22 - p * radius * 2, 2, 2);
                }
            }
            ctx.globalAlpha = 1;
            ctx.save();
            if (motion && !impact) ctx.translate(0, Math.sin(time * 2) * 2);
            if (charge) { ctx.shadowColor = GOLD; ctx.shadowBlur = motion ? 10 + Math.min(age, 1.2) * 12 : 8; }
            if (impact && motion && (kind === 'down' || kind === 'fail') && age < .3) ctx.translate(Math.sin(age * 85) * 4 * (1 - age / .3), 0);
            if (impact && motion && (kind === 'great' || kind === 'success')) ctx.scale(1 + Math.sin(Math.min(age / .35, 1) * Math.PI) * .13, 1 + Math.sin(Math.min(age / .35, 1) * Math.PI) * .13);
            if (kind === 'down' || kind === 'fail') ctx.globalAlpha = .55;
            if (kind !== 'destroy') sprite(size);
            ctx.restore();
            if (impact) {
                if (motion && age < .12) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = (1 - age / .12) * .35; ctx.fillRect(-width / 2, -height, width, height * 2); }
                if (kind === 'great' || kind === 'success') {
                    ctx.globalAlpha = motion ? Math.max(0, 1 - age / .65) : .8;
                    arc(motion ? 30 + Math.min(age / .65, 1) * 140 : radius + 8, tint, 3);
                    if (motion) for (const s of sparks.slice(0, kind === 'great' ? 36 : 20)) {
                        ctx.fillStyle = tint; ctx.globalAlpha = Math.max(0, 1 - age / 1.05);
                        ctx.fillRect(Math.cos(s.angle) * s.speed * age, Math.sin(s.angle) * s.speed * age + age * age * 38, s.size * 2, s.size);
                    }
                } else if (kind === 'protected') {
                    ctx.globalAlpha = motion ? .55 + Math.max(0, 1 - age) * .45 : 1;
                    ctx.strokeStyle = CYAN; ctx.lineWidth = 3; ctx.beginPath();
                    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; const x = Math.cos(a) * radius, y = Math.sin(a) * radius; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
                    ctx.closePath(); ctx.stroke();
                } else if (kind === 'destroy') {
                    if (motion && age < .9) for (let i = 0; i < 7; i++) {
                        const angle = i / 7 * TAU, next = (i + 1) / 7 * TAU;
                        ctx.save(); ctx.translate(Math.cos(angle + .4) * age * 110, Math.sin(angle + .4) * age * 110 + age * age * 110); ctx.rotate(age * (i % 2 ? 2 : -2));
                        ctx.globalAlpha = 1 - age / .9; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size); ctx.lineTo(Math.cos(next) * size, Math.sin(next) * size); ctx.closePath(); ctx.clip(); sprite(size); ctx.restore();
                    }
                    ctx.globalAlpha = .65; arc(radius - 8, tint, 1);
                } else {
                    ctx.globalAlpha = .8; ctx.strokeStyle = tint; ctx.lineWidth = 2; ctx.beginPath();
                    ctx.moveTo(-size / 2, -18); ctx.lineTo(-13, -4); ctx.lineTo(4, -15); ctx.lineTo(16, 12); ctx.lineTo(size / 2, 21); ctx.stroke();
                }
            }
            ctx.restore(); ctx.globalAlpha = 1;
        }
        function frame(now) {
            raf = 0;
            if (disposed || document.hidden) return;
            draw(now);
            if (!reduced.matches && (phase !== 'result' || now - started < 1200)) raf = requestAnimationFrame(frame);
        }
        function resume() { if (disposed) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
        function resize() {
            width = host.clientWidth; height = host.clientHeight;
            const dpr = Math.min(devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
            ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); resume();
        }
        const observer = new ResizeObserver(resize); observer.observe(host);
        const visibility = () => { if (document.hidden) stopSound(); else resume(); };
        document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', resume);
        return {
            soundButton,
            start() { phase = 'charge'; kind = ''; started = performance.now(); play('start'); resume(); },
            async finish(outcome) {
                if (!reduced.matches) await new Promise(resolve => setTimeout(resolve, Math.max(0, 1200 - (performance.now() - started))));
                if (disposed) return;
                if (!reduced.matches) {
                    phase = 'brake'; started = performance.now(); play('skill', .22); resume();
                    await new Promise(resolve => setTimeout(resolve, 180));
                    if (disposed) return;
                }
                phase = 'result'; kind = outcome; started = performance.now();
                play(outcome === 'great' ? 'crit' : outcome === 'success' ? 'clear' : 'fail', outcome === 'protected' ? .18 : .3); resume();
                if (!reduced.matches) await new Promise(resolve => setTimeout(resolve, 300));
            },
            destroy() {
                disposed = true; cancelAnimationFrame(raf); observer.disconnect(); stopSound();
                document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', resume);
                Object.values(images).forEach(i => { i.onload = i.onerror = null; }); canvas.remove();
            }
        };
    }
    window.EnhanceEffects = { mount };
})();
