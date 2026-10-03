// 퀘스트 게시판 장식 캔버스. 등불 먼지와 선택/수령 순간의 짧은 연출만 그린다.
// 글자와 버튼은 모두 DOM에 있고, 캔버스는 aria-hidden + pointer-events:none 이다.
(() => {
    const MAX_DPR = 2;
    const MAX_PIXELS = 4000000;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const effects = [];
    let canvas = null, ctx = null, sprite = null, observer = null;
    let width = 0, height = 0, frame = 0, lastTime = 0, clock = 0;
    let motes = [];

    const ease = p => 1 - Math.pow(1 - p, 3);

    // 먼지와 불꽃이 함께 쓰는 빛 알갱이. 한 번만 만들어 매 프레임 재사용한다.
    function makeSprite() {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,240,205,1)');
        grad.addColorStop(0.22, 'rgba(255,206,128,.6)');
        grad.addColorStop(1, 'rgba(255,170,70,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return c;
    }

    function newMote(anywhere) {
        return {
            x: width * Math.pow(Math.random(), 1.5),
            y: anywhere ? Math.random() * height : height + 10,
            r: 0.8 + Math.random() * 1.8,
            vy: -(4 + Math.random() * 10),
            sway: 6 + Math.random() * 14,
            phase: Math.random() * Math.PI * 2,
            alpha: 0.15 + Math.random() * 0.35
        };
    }

    function mount() {
        const node = document.getElementById('questBoardFx');
        if (!node) return false;
        if (node !== canvas) {
            if (observer) observer.disconnect();
            canvas = node;
            ctx = canvas.getContext('2d');
            sprite = sprite || makeSprite();
            observer = new ResizeObserver(resize);
            observer.observe(canvas.parentElement);
            resize();
        }
        return true;
    }

    function resize() {
        const box = canvas.parentElement;
        width = box.clientWidth;
        height = box.clientHeight;
        if (!width || !height) return;
        let dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        if (width * height * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (width * height));
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const count = Math.min(36, Math.round(width * height / 26000));
        while (motes.length < count) motes.push(newMote(true));
        motes.length = count;
        motes.forEach(m => { if (m.x > width || m.y > height + 10) Object.assign(m, newMote(true)); });
        wake();
    }

    function visible() {
        return !document.hidden && canvas.isConnected && canvas.closest('.page')?.classList.contains('active')
            && canvas.offsetParent !== null && width > 0;
    }

    function draw(dt) {
        clock += dt;
        ctx.clearRect(0, 0, width, height);
        const glow = Math.min(width, 900) * 0.9;
        ctx.globalAlpha = 0.1 + Math.sin(clock * 2.3) * 0.015 + Math.sin(clock * 5.1) * 0.01;
        ctx.drawImage(sprite, -glow * 0.45, -glow * 0.4, glow, glow);

        for (const m of motes) {
            m.y += m.vy * dt;
            m.phase += dt * 0.6;
            if (m.y < -10) Object.assign(m, newMote(false));
            const size = m.r * 6;
            ctx.globalAlpha = m.alpha * (0.6 + 0.4 * Math.sin(m.phase * 2.1)) * (1 - 0.55 * m.x / width);
            ctx.drawImage(sprite, m.x + Math.sin(m.phase) * m.sway - size / 2, m.y - size / 2, size, size);
        }

        for (let i = effects.length - 1; i >= 0; i--) {
            const fx = effects[i];
            fx.t += dt;
            const p = fx.t / fx.life;
            if (p >= 1) { effects.splice(i, 1); continue; }
            if (fx.kind === 'sweep') {
                ctx.globalAlpha = 0.4 * (1 - p);
                ctx.drawImage(sprite, fx.x - 24, fx.y + fx.h * ease(p) - 18, fx.w + 48, 36);
            } else if (fx.kind === 'ring') {
                ctx.globalAlpha = 0.8 * (1 - p);
                ctx.strokeStyle = '#ffd98c';
                ctx.lineWidth = 1 + 3 * (1 - p);
                ctx.beginPath();
                ctx.arc(fx.x, fx.y, 12 + 80 * ease(p), 0, Math.PI * 2);
                ctx.stroke();
            } else {
                fx.vy += 140 * dt;
                fx.x += fx.vx * dt;
                fx.y += fx.vy * dt;
                const size = fx.size * (1 - p * 0.5);
                ctx.globalAlpha = 1 - p;
                ctx.drawImage(sprite, fx.x - size / 2, fx.y - size / 2, size, size);
            }
        }
        ctx.globalAlpha = 1;
    }

    function loop(now) {
        frame = 0;
        if (reducedMotion.matches || !visible()) return;
        draw(Math.min(0.05, Math.max(0, (now - lastTime) / 1000)));
        lastTime = now;
        frame = requestAnimationFrame(loop);
    }

    function wake() {
        if (!mount()) return;
        if (reducedMotion.matches) {
            effects.length = 0;
            ctx.clearRect(0, 0, width, height);
            return;
        }
        if (!frame && visible()) {
            lastTime = performance.now();
            frame = requestAnimationFrame(loop);
        }
    }

    // kind: 'select' (두루마리가 펼쳐지는 빛) | 'claim' (봉인 주변 불꽃)
    function flourish(kind, target) {
        if (!target || !mount() || reducedMotion.matches || !width) return;
        const base = canvas.getBoundingClientRect(), r = target.getBoundingClientRect();
        const x = r.left - base.left, y = r.top - base.top;
        if (kind === 'claim') {
            const cx = x + r.width / 2, cy = y + r.height / 2;
            effects.push({ kind: 'ring', x: cx, y: cy, t: 0, life: 0.8 });
            for (let i = 0; i < 22; i++) {
                const angle = Math.random() * Math.PI * 2, speed = 60 + Math.random() * 120;
                effects.push({ kind: 'spark', x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, t: 0, life: 0.7 + Math.random() * 0.6, size: 5 + Math.random() * 6 });
            }
        } else {
            effects.push({ kind: 'sweep', x, y, w: r.width, h: r.height, t: 0, life: 0.5 });
            for (let i = 0; i < 10; i++) {
                effects.push({ kind: 'spark', x: x + Math.random() * r.width, y, vx: (Math.random() - 0.5) * 30, vy: -(15 + Math.random() * 35), t: 0, life: 0.9 + Math.random() * 0.6, size: 4 + Math.random() * 4 });
            }
        }
        if (effects.length > 120) effects.splice(0, effects.length - 120);
        wake();
    }

    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    reducedMotion.addEventListener('change', wake);
    window.QuestBoardEffects = { wake, flourish };
})();
