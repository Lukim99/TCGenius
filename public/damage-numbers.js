// 전투 수치(피해·회복·처치 등) 표시. 필드, 낙원, PVP, 월드보스가 함께 쓴다.
// 화면은 기준점(x, y: 화면 비율)과 뜻(kind, critical, received …)만 넘기고, 글꼴·색·움직임·겹침 피하기는 여기서 정한다.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DamageNumbers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const comma = value => Math.round(Number(value || 0)).toLocaleString('ko-KR');
    const easeOut = (p, power) => 1 - Math.pow(1 - clamp(p, 0, 1), power || 3);

    // 색: 위, 가운데, 아래(세로 그라데이션)와 외곽선.
    const TONES = {
        normal: ['#fffbd6', '#ffd84a', '#ff9a16', '#2a1200'],
        crit: ['#fff2a8', '#ff8a34', '#ef1f1f', '#360404'],
        destiny: ['#f7eaff', '#c58bff', '#7a3df2', '#1c0838'],
        received: ['#ffe1dc', '#ff8f87', '#e2463d', '#330909'],
        fixed: ['#ffffff', '#f1f4fa', '#b9c4d6', '#131923'],
        shield: ['#f3f8ff', '#b8d8ff', '#7fa9e6', '#0d1b30'],
        dot: ['#fff0cc', '#ffc56c', '#e58524', '#2a1300'],
        hp: ['#eefff3', '#63f29b', '#17b865', '#04281a'],
        mp: ['#eaf6ff', '#65b9ff', '#2a7de8', '#061d3a'],
        guard: ['#ffffff', '#dbe8ff', '#9fb9e6', '#101a2c'],
        kill: ['#fff3c4', '#ffcf68', '#e8962a', '#2a1500'],
        miss: ['#f4f7fb', '#cdd6e2', '#8e9bb0', '#141a22'],
        proxy: ['#e6fdff', '#61e7ff', '#1fa9d6', '#04222c'],
        reflect: ['#f6e8ff', '#d7a2ff', '#9a5be0', '#200a36'],
        total: ['#ffffff', '#fff1c2', '#ffc85a', '#1c1206']
    };
    const TAG_TONE = { '운명': 'destiny', '치명타': 'crit' };
    const FLARE = { crit: '255,150,60', destiny: '190,130,255', fixed: '225,235,255', received: '255,120,110' };

    // 수치 하나의 글, 색, 크기(넓은 화면 기준 px), 움직임을 정한다.
    function describe(spec) {
        const kind = spec.kind || 'damage', n = comma(spec.amount);
        const out = { text: n, tone: 'normal', size: 38, tags: [], label: spec.label || '', motion: 'punch', life: 1050, hot: false, weigh: false, sum: false };
        if (kind === 'heal') Object.assign(out, { text: 'HP +' + n, tone: 'hp', size: 27, motion: 'float' });
        else if (kind === 'mana') Object.assign(out, { text: 'MP +' + n, tone: 'mp', size: 26, motion: 'float' });
        else if (kind === 'guard') Object.assign(out, { text: '+' + n + ' 보호막', tone: 'guard', size: 25, motion: 'float' });
        else if (kind === 'kill') Object.assign(out, { text: '+' + n + ' 처치', tone: 'kill', size: 27 });
        else if (kind === 'miss') Object.assign(out, { text: '회피', tone: 'miss', size: 27, motion: 'float' });
        else if (kind === 'proxy') Object.assign(out, { text: '대행 ' + n, tone: 'proxy', size: spec.dot ? 23 : 25, motion: spec.dot ? 'dot' : 'float' });
        else if (kind === 'absorb') Object.assign(out, { text: '흡수 ' + n, tone: 'shield', size: spec.minor ? 23 : 25, motion: 'float' });
        else if (kind === 'reflect') Object.assign(out, { text: '-' + n, tone: 'reflect', size: 26 });
        else if (spec.shield) Object.assign(out, { text: '(-' + n + ')', tone: 'shield', size: spec.dot ? 23 : 27, motion: spec.dot ? 'dot' : 'float', label: '' });
        else {
            const critical = !!spec.critical, destiny = !!spec.destiny, dot = !!spec.dot, received = !!spec.received, minor = !!spec.minor;
            out.tone = spec.fixed ? 'fixed' : destiny ? 'destiny' : received ? 'received' : critical ? 'crit' : dot || minor ? 'dot' : 'normal';
            out.text = (received ? '-' : '') + n;
            out.size = dot ? (critical ? 28 : 23) : minor ? (critical ? 32 : 27) : received ? (critical ? 36 : 30) : critical ? 52 : 38;
            if (dot) { out.motion = 'dot'; out.life = 820; } else if (critical) out.life = 1250;
            if (destiny) out.tags.push('운명');
            if (critical) out.tags.push('치명타');
            out.hot = critical && !dot && !minor; out.weigh = !dot && !minor; out.sum = !received && !dot && !minor;
        }
        if (spec.text != null) out.text = String(spec.text);
        return out;
    }
    // 대상 최대 HP에 견준 피해가 클수록 숫자를 키운다(최대 1.32배). 비율을 모르면 그대로다.
    const weight = ratio => ratio > 0 ? 1 + .32 * clamp(Math.sqrt(ratio / .3), 0, 1) : 1;

    let scratch = null, displayReady = false, displayAsked = false;
    const sprites = new Map(), flares = new Map();
    const scratchContext = () => scratch || (scratch = document.createElement('canvas').getContext('2d'));
    // 숫자 글꼴(Black Han Sans)이 아직 안 왔으면 Pretendard로 그리고, 오면 다시 그린다.
    function displayFont() {
        if (displayReady || !document.fonts) return displayReady;
        try {
            displayReady = document.fonts.check('400 24px "Black Han Sans"');
            if (!displayReady && !displayAsked) { displayAsked = true; document.fonts.load('400 24px "Black Han Sans"', '0123 치명타').then(() => { displayAsked = false; }, () => {}); }
        } catch (_) { displayReady = false; }
        return displayReady;
    }
    const numberFont = (size, display) => display ? '400 ' + size + 'px "Black Han Sans", Pretendard, sans-serif' : '900 ' + size + 'px Pretendard, sans-serif';

    function paintNumber(c, text, x, y, size, tone, display) {
        const t = TONES[tone] || TONES.normal, edge = Math.max(3, size * .17);
        c.font = numberFont(size, display); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = edge;
        c.strokeStyle = 'rgba(0,0,0,.5)'; c.strokeText(text, x, y + size * .08);
        c.strokeStyle = t[3]; c.strokeText(text, x, y);
        const g = c.createLinearGradient(0, y - size * .38, 0, y + size * .38);
        g.addColorStop(0, t[0]); g.addColorStop(.5, t[1]); g.addColorStop(1, t[2]);
        c.fillStyle = g; c.fillText(text, x, y);
    }
    function paintSmall(c, text, x, y, size, color) {
        c.font = '800 ' + size + 'px Pretendard, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
        c.lineWidth = 3; c.strokeStyle = 'rgba(8,6,4,.86)'; c.strokeText(text, x, y);
        c.fillStyle = color; c.fillText(text, x, y);
    }

    // 수치 한 개(꼬리표 + 숫자 + 아래 이름)를 한 장으로 미리 그려 둔다. 매 프레임에는 이 그림만 옮겨 찍는다.
    function sprite(d, size, dpr) {
        const display = displayFont(), key = [d.text, d.tone, size, d.tags.join('/'), d.label, dpr, display ? 1 : 0].join('|');
        const cached = sprites.get(key);
        if (cached) return cached;
        const m = scratchContext(), edge = Math.max(3, size * .17);
        m.font = numberFont(size, display);
        const numW = m.measureText(d.text).width;
        const tagSize = clamp(Math.round(size * .3), 10, 14), tagH = d.tags.length ? tagSize + 7 : 0;
        m.font = '900 ' + tagSize + 'px Pretendard, sans-serif';
        const tagWs = d.tags.map(tag => Math.ceil(m.measureText(tag).width) + 16), tagsW = tagWs.reduce((sum, w) => sum + w + 4, -4);
        const labSize = clamp(Math.round(size * .3), 9, 12), labH = d.label ? labSize + 8 : 0;
        m.font = '800 ' + labSize + 'px Pretendard, sans-serif';
        const labW = d.label ? m.measureText(d.label).width + 8 : 0;
        const W = Math.ceil(Math.max(numW + edge * 2 + 8, tagsW + 8, labW)), cx = W / 2, cy = 4 + tagH + edge * .5 + size * .46;
        const H = Math.ceil(cy + size * .46 + (labH || edge * .5 + 4));
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(W * dpr); canvas.height = Math.ceil(H * dpr);
        const c = canvas.getContext('2d');
        c.scale(dpr, dpr);
        paintNumber(c, d.text, cx, cy, size, d.tone, display);
        let tx = cx - tagsW / 2;
        const ty = cy - size * .44 - tagH;
        d.tags.forEach((tag, index) => {
            const t = TONES[TAG_TONE[tag]] || TONES.normal, w = tagWs[index];
            c.beginPath(); c.moveTo(tx + 4, ty); c.lineTo(tx + w, ty); c.lineTo(tx + w - 4, ty + tagH); c.lineTo(tx, ty + tagH); c.closePath();
            const g = c.createLinearGradient(0, ty, 0, ty + tagH); g.addColorStop(0, t[0]); g.addColorStop(1, t[1]);
            c.fillStyle = g; c.fill(); c.lineWidth = 1.5; c.strokeStyle = t[3]; c.stroke();
            c.font = '900 ' + tagSize + 'px Pretendard, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = t[3];
            c.fillText(tag, tx + w / 2, ty + tagH / 2 + .5);
            tx += w + 4;
        });
        if (d.label) paintSmall(c, d.label, cx, cy + size * .46 + labSize * .5 + 3, labSize, '#f3e8d0');
        // bw, bh: 겹침을 따질 때 쓰는 몸통 크기. up, down: 기준점에서 위아래로 차지하는 높이.
        const made = { canvas, w: W, h: H, ax: cx, ay: cy, bw: Math.max(numW + edge, tagsW, labW), up: size * .4 + tagH, down: size * .4 + labH };
        if (sprites.size >= 120) sprites.delete(sprites.keys().next().value);
        sprites.set(key, made);
        return made;
    }
    function flare(tone) {
        let canvas = flares.get(tone);
        if (canvas) return canvas;
        canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
        const c = canvas.getContext('2d'), g = c.createRadialGradient(64, 64, 0, 64, 64, 64), rgb = FLARE[tone] || FLARE.crit;
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.22, 'rgba(' + rgb + ',.7)'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
        flares.set(tone, canvas);
        return canvas;
    }

    // 같은 자리에 수치가 몰릴 때 살펴볼 빈자리: 기준점 둘레의 격자를 가까운 순서로 본다. 먼저 뜬 수치는 위로 올라가 있으므로 위쪽보다 옆과 아래를 조금 더 먼저 고른다.
    const SLOTS = [];
    for (let sx = -4; sx <= 4; sx++) for (let sy = -4; sy <= 4; sy++) SLOTS.push([sx, sy]);
    SLOTS.sort((a, b) => a[0] * a[0] * 1.6 + a[1] * a[1] * (a[1] < 0 ? 1.25 : 1) - b[0] * b[0] * 1.6 - b[1] * b[1] * (b[1] < 0 ? 1.25 : 1) || Math.abs(a[0]) - Math.abs(b[0]) || b[0] - a[0]);

    class Layer {
        constructor(options) {
            const o = options || {};
            this.reduced = o.reducedMotion != null ? !!o.reducedMotion : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
            this.pops = []; this.totals = []; this.flip = 0; this.seed = 7;
        }
        get count() { return this.pops.length; }
        // spec: { x, y, start|delay, kind, amount, text, critical, destiny, fixed, dot, minor, shield, received, label, ratio, chain }
        // kind: damage(기본) heal mana guard kill miss proxy absorb reflect. minor: 소환수 같은 작은 타격.
        // chain: 한 행동의 타격들이 함께 쥐는 객체 { size }. 3타 이상이면 합계를 따로 센다.
        add(spec) {
            const now = performance.now();
            this.seed = this.seed * 16807 % 2147483647;
            this.pops.push({ spec, d: describe(spec), x: Number(spec.x), y: Number(spec.y), start: spec.start != null ? Number(spec.start) : now + (Number(spec.delay) || 0), live: false, ox: 0, oy: 0, rand: this.seed / 2147483647 });
        }
        clear() { this.pops = []; this.totals = []; }
        totalPoint(total, w, h) { const narrow = w < 650; return { x: clamp(w * total.x, 80, w - 80), y: Math.max(narrow ? 96 : 76, h * total.y - (narrow ? 100 : 128)) }; }
        // 수치가 처음 보이는 순간: 그림을 만들고, 아직 떠 있는 다른 수치와 겹치지 않는 자리를 고른다.
        start(pop, w, h, now) {
            const narrow = w < 650, d = pop.d, spec = pop.spec;
            const size = Math.max(12, Math.round(d.size * (narrow ? .78 : 1) * (d.weigh ? weight(Number(spec.ratio)) : 1)));
            const s = pop.sprite = sprite(d, size, Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
            pop.size = size; pop.live = true;
            // 다른 수치가 지금 있는 자리와 다 떠오른 뒤에 머물 자리(나란히 떠오르므로 처음 자리의 차이가 끝까지 간다)를 모두 피한다.
            const boxes = [], rise = 64 * (narrow ? .82 : 1);
            this.pops.forEach(other => {
                if (!other.live || other === pop || now - other.start >= other.d.life * .72) return;
                const o = other.sprite, mid = (o.down - o.up) / 2, box = { x: w * other.x + other.ox, y: h * other.y + other.oy + mid, w: o.bw, h: o.up + o.down };
                boxes.push(box);
                if (other.cy != null && Math.abs(other.cy + mid - box.y) > 6) boxes.push({ x: other.cx, y: other.cy + mid, w: o.bw, h: o.up + o.down });
            });
            this.totals.forEach(total => { if (total.hits >= 1 && total.chain.size >= 3) { const at = this.totalPoint(total, w, h); boxes.push({ x: at.x, y: at.y - 8 + rise / 2, w: 170, h: 60 + rise }); } });
            const stepX = s.bw * .52 + 8, stepY = (s.up + s.down) * .52 + 2, shift = (s.down - s.up) / 2, flip = this.flip++ % 2 ? -1 : 1;
            const spot = slot => ({ x: clamp(w * pop.x + slot[0] * flip * stepX, Math.min(w / 2, s.bw / 2 + 6), Math.max(w / 2, w - s.bw / 2 - 6)), y: clamp(h * pop.y + slot[1] * stepY, Math.min(h / 2, s.up + 8 + rise), Math.max(h / 2, h - s.down - 8)) });
            const free = at => boxes.every(box => Math.abs(box.x - at.x) >= (box.w + s.bw) * .5 || Math.abs(box.y - (at.y + shift)) >= (box.h + s.up + s.down) * .5);
            const at = spot(SLOTS.find(slot => free(spot(slot))) || SLOTS[1 + this.flip % 8]);
            pop.ox = at.x - w * pop.x; pop.oy = at.y - h * pop.y;
            const chain = spec.chain;
            if (d.sum && chain && chain.size >= 3) {
                let total = this.totals.find(item => item.chain === chain);
                if (!total) this.totals.push(total = { chain, x: chain.x != null ? chain.x : pop.x, y: chain.y != null ? chain.y : pop.y, value: 0, from: 0, hits: 0, bump: now, shownAt: 0, done: 0 });
                total.from = this.totalShown(total, now); total.value += Number(spec.amount) || 0; total.hits++; total.bump = now;
                if (total.hits === 2) total.shownAt = now;
                if (total.hits >= chain.size) total.done = now;
            }
        }
        totalShown(total, now) { return this.reduced ? total.value : total.from + (total.value - total.from) * easeOut((now - total.bump) / 170, 2); }
        draw(ctx, w, h, time) {
            const now = time != null ? time : performance.now(), reduced = this.reduced, narrow = w < 650;
            this.pops = this.pops.filter(pop => {
                const t = now - pop.start;
                if (t < 0) return true;
                if (t >= pop.d.life) return false;
                if (!pop.live) this.start(pop, w, h, now);
                const d = pop.d, s = pop.sprite, p = t / d.life, lift = narrow ? .82 : 1;
                let x = w * pop.x + pop.ox, y = h * pop.y + pop.oy, scale = 1, turn = 0, alpha = clamp(t / 45, 0, 1) * clamp((1 - p) / .26, 0, 1);
                if (reduced) { alpha = clamp(t / 90, 0, 1) * clamp((1 - p) / .3, 0, 1); y -= 24 * p; }
                else if (d.motion === 'dot') {
                    // 지속 피해: 옆으로 작게 튀어 올랐다 떨어진다.
                    x += (pop.rand < .5 ? -1 : 1) * 20 * p * lift; y -= (Math.sin(p * Math.PI) * 28 + p * 8) * lift; scale = .82 + .18 * easeOut(t / 120);
                } else if (d.motion === 'float') {
                    y -= 52 * lift * easeOut(p); scale = .8 + .2 * easeOut(t / 160) + .06 * Math.sin(clamp(t / 260, 0, 1) * Math.PI);
                } else {
                    // 타격: 크게 내리찍고 살짝 눌렸다가, 느려지며 떠오른 뒤 줄어들며 사라진다.
                    const big = d.hot ? 1.5 : .85, slam = clamp(t / 90, 0, 1), settle = clamp((t - 90) / 130, 0, 1);
                    scale = 1 + big * Math.pow(1 - slam, 3) - (d.hot ? .1 : .07) * Math.sin(settle * Math.PI);
                    y -= (pop.spec.received ? 40 : d.hot ? 70 : 58) * lift * easeOut((t - 60) / (d.life - 60));
                    x += (pop.rand - .5) * 22 * easeOut(p, 2);
                    turn = (pop.rand - .5) * (d.hot ? .12 : .06);
                    const shake = d.hot ? 240 : pop.spec.received ? 170 : 0;
                    if (t < shake) x += Math.sin(t * .11) * (d.hot ? 6 : 4) * (1 - t / shake);
                    scale *= .86 + .14 * clamp((1 - p) / .26, 0, 1);
                }
                pop.cx = x; pop.cy = y;
                ctx.save();
                ctx.translate(x, y);
                // 치명타: 숫자 뒤로 짧은 섬광과 가로 베임이 지나간다.
                if (d.hot && !reduced && t < 320) {
                    const f = t / 320, image = flare(d.tone), burst = pop.size * (1.5 + 2.4 * easeOut(f)), cut = pop.size * (2 + 5 * easeOut(f, 4));
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = (1 - f) * .7; ctx.drawImage(image, -burst / 2, -burst / 2, burst, burst);
                    ctx.rotate(-.3); ctx.globalAlpha = (1 - f) * .95; ctx.drawImage(image, -cut / 2, -pop.size * .1 * (1 - f), cut, pop.size * .2 * (1 - f)); ctx.rotate(.3);
                    ctx.globalCompositeOperation = 'source-over';
                }
                if (turn) ctx.rotate(turn);
                ctx.scale(scale, scale);
                ctx.globalAlpha = alpha;
                ctx.drawImage(s.canvas, -s.ax, -s.ay, s.w, s.h);
                // 닿는 순간 하얗게 달아올랐다 식는다.
                if (!reduced && d.motion === 'punch' && t < 120) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * (1 - t / 120) * .75; ctx.drawImage(s.canvas, -s.ax, -s.ay, s.w, s.h); }
                ctx.restore();
                return true;
            });
            // 연타 합계: 타격이 닿을 때마다 올라가고, 마지막 타에서 한 번 크게 뛴 뒤 사라진다.
            this.totals = this.totals.filter(total => {
                if (!total.done && now - total.bump > 1300) total.done = total.bump + 400;
                const end = total.done ? total.done + 1000 : Infinity;
                if (now >= end) return false;
                if (total.hits < 2) return true;
                const at = this.totalPoint(total, w, h), size = narrow ? 26 : 34;
                const alpha = clamp((now - total.shownAt) / 110, 0, 1) * clamp((end - now) / 240, 0, 1);
                const scale = reduced ? 1 : 1 + .14 * Math.pow(1 - clamp((now - total.bump) / 150, 0, 1), 2) + (total.done ? .3 * Math.pow(1 - clamp((now - total.done) / 280, 0, 1), 2) : 0);
                ctx.save(); ctx.globalAlpha = alpha; ctx.translate(at.x, at.y); ctx.scale(scale, scale);
                paintSmall(ctx, total.hits + '연타', 0, -size * .5 - 9, narrow ? 10 : 12, '#ffe6a8');
                paintNumber(ctx, comma(this.totalShown(total, now)), 0, 0, size, 'total', displayFont());
                ctx.restore();
                return true;
            });
        }
    }

    return { create: options => new Layer(options), describe, weight, TONES };
});
