/* global TL */
// E세계 대저택 레이드 60초 광고. renderFrame(t)는 t만으로 화면을 결정한다(병렬 렌더용).
(() => {
    'use strict';
    const W = 1920, H = 1080;
    const { S, beat, B1, B2, FINAL_HIT } = TL;
    const cvs = document.getElementById('c');
    const ctx = cvs.getContext('2d');

    const C = {
        ink: '#07060b', text: '#eceef2', text2: '#a39cad', text3: '#6c6578',
        violet: '#9b87d6', violetHi: '#d8ccff', gold: '#c9a25a', goldHi: '#f0cd87',
        blood: '#c4473d', bloodHi: '#ff7a6b', bronze: '#c7893f', bronzeHi: '#f3c58a',
        teal: '#62e6d6', acid: '#9dff7a', ok: '#7fc98a'
    };
    const F = {
        serif: '"Noto Serif KR"', sans: '"Noto Sans KR"', cinzel: 'Cinzel',
        cond: '"Barlow Condensed"', mono: '"JetBrains Mono"', game: '"Black Han Sans"'
    };
    const METAL = {
        bronze: [[0, '#ffe2b8'], [0.34, '#eda85a'], [0.54, '#86460f'], [0.68, '#f4bf74'], [1, '#4a2306']],
        steel: [[0, '#f4fffd'], [0.36, '#c4ece7'], [0.54, '#4a7880'], [0.68, '#dcfaf5'], [1, '#1d343a']],
        blood: [[0, '#ffe6e0'], [0.36, '#ff8e80'], [0.54, '#a8141b'], [0.68, '#ff6f61'], [1, '#380306']],
        gold: [[0, '#fffbe9'], [0.36, '#f7dc9a'], [0.54, '#a3762a'], [0.68, '#fae3aa'], [1, '#4a320e']],
        silver: [[0, '#ffffff'], [0.36, '#dfe1ea'], [0.54, '#80869a'], [0.68, '#eceef5'], [1, '#3e4252']]
    };

    // ---------- 수학 ----------
    const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
    const lerp = (a, b, t) => a + (b - a) * t;
    const prog = (t, a, b) => clamp((t - a) / (b - a));
    const E = {
        outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
        inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
        inOutExpo: t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
        outCubic: t => 1 - Math.pow(1 - t, 3),
        inCubic: t => t * t * t,
        inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        outQuart: t => 1 - Math.pow(1 - t, 4),
        outBack: t => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
        inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2
    };
    function hash(n) {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
        return x - Math.floor(x);
    }
    const rnd = (seed, a = 0, b = 1) => a + (b - a) * hash(seed);
    function noise1(x, s = 0) {
        const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
        return lerp(hash(i + s * 57.31), hash(i + 1 + s * 57.31), u) * 2 - 1;
    }
    let VIG = false;
    const pulse = (t, t0, decay) => (t < t0 ? 0 : Math.exp(-(t - t0) / decay));
    const fmt = n => Math.round(n).toLocaleString('en-US');
    function rgba(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    // ---------- 캔버스 도구 ----------
    function mk(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }
    const BUF = {};
    function buf(name, w, h) {
        let c = BUF[name];
        if (!c) c = BUF[name] = mk(w, h);
        if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
        }
        const g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.filter = 'none';
        g.shadowBlur = 0;
        g.shadowColor = 'transparent';
        g.letterSpacing = '0px';
        g.clearRect(0, 0, w, h);
        return [c, g];
    }
    function font(g, family, size, weight = 400, ls = 0) {
        g.font = `${weight} ${size}px ${family}`;
        g.letterSpacing = `${ls}px`;
    }
    let LS_TRAILS = true;
    const measureW = (g, s, ls) => g.measureText(s).width - (LS_TRAILS && s.length ? ls : 0);

    function text(str, x, y, o = {}) {
        const g = o.g || ctx;
        const a = o.alpha ?? 1;
        if (a <= 0.003) return 0;
        g.save();
        font(g, o.f || F.sans, o.size || 32, o.w || 700, o.ls || 0);
        g.textAlign = 'left';
        g.textBaseline = o.base || 'alphabetic';
        const wd = measureW(g, str, o.ls || 0);
        const dx = o.align === 'center' ? x - wd / 2 : o.align === 'right' ? x - wd : x;
        g.globalAlpha = a;
        if (o.comp) g.globalCompositeOperation = o.comp;
        if (o.glow) {
            g.shadowColor = o.glow;
            g.shadowBlur = o.glowBlur || 24;
        }
        if (o.stroke) {
            g.lineWidth = o.lw || 2;
            g.strokeStyle = o.stroke;
            g.lineJoin = 'round';
            if (o.dash) g.setLineDash(o.dash);
            g.strokeText(str, dx, y);
            g.setLineDash([]);
        }
        if (o.color !== null) {
            g.fillStyle = o.color || C.text;
            g.fillText(str, dx, y);
        }
        g.restore();
        return wd;
    }

    // 문자열을 버퍼에 그린다(금속 그라데이션·광택). 글자별 위치를 함께 돌려준다.
    function tbuf(name, str, o) {
        const size = o.size, ls = o.ls || 0, pad = Math.ceil(size * 0.3);
        const [, mg] = buf('_measure', 4, 4);
        font(mg, o.f, size, o.w, ls);
        const chars = Array.from(str);
        const tw = measureW(mg, str, ls);
        const w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.62);
        const xs = [], ws = [];
        let acc = '';
        for (const ch of chars) {
            const x0 = mg.measureText(acc).width + (!LS_TRAILS && acc ? ls : 0);
            xs.push(pad + x0);
            ws.push(mg.measureText(ch).width - (LS_TRAILS ? ls : 0));
            acc += ch;
        }
        const [c, g] = buf(name, w, h);
        font(g, o.f, size, o.w, ls);
        const by = Math.round(size * 1.16);
        if (o.stops) {
            const gr = g.createLinearGradient(0, by - size * 0.92, 0, by + size * 0.1);
            for (const [p, col] of o.stops) gr.addColorStop(p, col);
            g.fillStyle = gr;
        } else g.fillStyle = o.color || '#fff';
        g.fillText(str, pad, by);
        if (o.edge) {
            g.lineWidth = Math.max(1, size / 110);
            g.strokeStyle = o.edge;
            g.strokeText(str, pad, by);
        }
        if (o.sheen != null && o.sheen > -1) {
            g.globalCompositeOperation = 'source-atop';
            const sx = lerp(-0.35, 1.35, o.sheen) * w;
            const gr = g.createLinearGradient(sx - size * 0.9, 0, sx + size * 0.9, h);
            gr.addColorStop(0, 'rgba(255,255,255,0)');
            gr.addColorStop(0.5, `rgba(255,255,255,${o.sheenA ?? 0.85})`);
            gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr;
            g.fillRect(0, 0, w, h);
        }
        return { c, w, h, pad, by, xs, ws, tw, n: chars.length };
    }

    // 버퍼 문자열을 글자별 변형으로 그린다. (x, y) = 기준선 왼쪽.
    function drawTB(tb, x, y, o = {}) {
        const align = o.align || 'left';
        const ox = align === 'center' ? x - tb.tw / 2 - tb.pad : align === 'right' ? x - tb.tw - tb.pad : x - tb.pad;
        const oy = y - tb.by;
        const g = o.g || ctx;
        g.save();
        if (o.glow) {
            g.shadowColor = o.glow;
            g.shadowBlur = o.glowBlur || 30;
        }
        if (o.comp) g.globalCompositeOperation = o.comp;
        if (!o.char) {
            g.globalAlpha = o.alpha ?? 1;
            g.drawImage(tb.c, ox, oy);
        } else {
            for (let i = 0; i < tb.n; i++) {
                const st = o.char(i, tb.n);
                if (!st || st.a <= 0.003) continue;
                const m = 6;
                const sx = Math.max(0, tb.xs[i] - m), sw = Math.min(tb.w - sx, tb.ws[i] + m * 2);
                const cx = ox + sx + sw / 2 + (st.dx || 0), cy = oy + tb.h / 2 + (st.dy || 0);
                const s = st.s ?? 1;
                g.globalAlpha = (o.alpha ?? 1) * st.a;
                g.drawImage(tb.c, sx, 0, sw, tb.h, cx - (sw / 2) * s, cy - (tb.h / 2) * s, sw * s, tb.h * s);
            }
        }
        g.restore();
    }

    function cutPath(g, x, y, w, h, c) {
        g.beginPath();
        g.moveTo(x + c, y);
        g.lineTo(x + w, y);
        g.lineTo(x + w, y + h - c);
        g.lineTo(x + w - c, y + h);
        g.lineTo(x, y + h);
        g.lineTo(x, y + c);
        g.closePath();
    }

    const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%/+<>';
    function scramble(str, p, seed, t) {
        const n = str.length, done = Math.floor(p * n);
        let out = '';
        for (let i = 0; i < n; i++) {
            const ch = str[i];
            if (i < done || ch === ' ') out += ch;
            else if (i < done + 4) out += GLYPHS[Math.floor(hash(seed + i * 13 + Math.floor(t * 30) * 7) * GLYPHS.length)];
            else out += ' ';
        }
        return out;
    }

    function tag(x, y, label, color, o = {}) {
        const a = o.alpha ?? 1;
        if (a <= 0.003) return 0;
        const size = o.size || 17, ls = o.ls ?? 5;
        ctx.save();
        font(ctx, o.f || F.mono, size, o.fw || 700, ls);
        const tw = measureW(ctx, label, ls);
        const padX = 14, h = size + 18, w = tw + padX * 2;
        const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
        ctx.globalAlpha = a;
        cutPath(ctx, x0, y, w, h, 8);
        ctx.fillStyle = o.solid ? rgba(color, 0.92) : o.bg || 'rgba(10,8,14,0.55)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(color, 0.9);
        ctx.stroke();
        ctx.fillStyle = o.solid ? '#0b0910' : color;
        ctx.textBaseline = 'middle';
        ctx.fillText(o.shown ?? label, x0 + padX, y + h / 2 + 1);
        ctx.restore();
        return w;
    }

    function star(x, y, r, color, alpha = 1, rot = 0) {
        if (alpha <= 0) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.shadowColor = color;
        ctx.shadowBlur = r * 1.4;
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4 - Math.PI / 2;
            const rr = i % 2 === 0 ? (i % 4 === 0 ? r : r * 0.62) : r * 0.12;
            ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function glow(x, y, r, color, alpha = 1, comp = 'lighter') {
        if (alpha <= 0.003 || r <= 0) return;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(color, 1));
        g.addColorStop(0.35, rgba(color, 0.35));
        g.addColorStop(1, rgba(color, 0));
        ctx.save();
        ctx.globalCompositeOperation = comp;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
    }

    function fill(color, alpha = 1, comp = 'source-over') {
        if (alpha <= 0.003) return;
        ctx.save();
        ctx.globalCompositeOperation = comp;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    function vgrad(stops, alpha = 1, comp = 'source-over', y0 = 0, y1 = H) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        for (const [p, col] of stops) g.addColorStop(p, col);
        ctx.save();
        ctx.globalCompositeOperation = comp;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
        ctx.restore();
    }

    // 비네트는 장면 위, 글자 아래에 한 번 그린다.
    function vig() {
        if (VIG) return;
        VIG = true;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(PRE.vignette, 0, 0);
        ctx.restore();
    }

    // ---------- 에셋 ----------
    const IMG = {};
    const FILES = {
        field: 'field.jpg', cover: 'cover.jpg', sHall: 'sculptureHall.jpg', sScene: 'sculptureScene.png',
        wHall: 'whipHall.jpg', wScene: 'whipScene.png', eHall: 'echoHall.jpg', eScene: 'echoScene.png',
        shard: 'shard.png', mist: 'mist.png', artifact: 'artifact.png', fragment: 'fragment.png', potion: 'potion.png',
        petJogak: 'petJogak.png', petWhip: 'petWhip.png', pikachu: 'pikachu.jpg', aurora: 'aurora.jpg', justice: 'justice.jpg',
        t1: 'title1.png', t2: 'title2.png', t3: 'title3.png', t4: 'title4.png', t5: 'title5.png'
    };
    async function loadImages() {
        await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
            const im = new Image();
            im.src = '.cache/img/' + f;
            await im.decode();
            IMG[k] = im;
        }));
    }

    // 장면 이미지 배치. 초점(fx, fy)은 확대해도 화면의 같은 위치에 머문다.
    function cover(img, z = 1, fx = 0.5, fy = 0.5, px = 0, py = 0) {
        const s = Math.max(W / img.width, H / img.height) * z;
        const w = img.width * s, h = img.height * s;
        return { x: fx * W - fx * w + px, y: fy * H - fy * h + py, w, h, s };
    }
    const at = (p, u, v) => [p.x + u * p.w, p.y + v * p.h];
    function drawP(img, p, alpha = 1, g = ctx) {
        if (alpha <= 0.003) return;
        g.globalAlpha = alpha;
        g.drawImage(img, p.x, p.y, p.w, p.h);
        g.globalAlpha = 1;
    }
    // 배경과 같은 캔버스의 전경을 조금 더 확대해 시차를 만든다.
    function stage(hall, actor, z, fx, fy, o = {}) {
        const par = o.par ?? 0.035;
        const ph = cover(hall, z, fx, fy, o.px || 0, o.py || 0);
        drawP(hall, ph, o.alpha ?? 1);
        let pa = null;
        if (actor) {
            pa = cover(actor, z * (1 + par), fx, fy, (o.px || 0) * (1 + par * 3), (o.py || 0) * (1 + par * 3));
            if (o.kick && o.pivot) {
                const [px, py] = at(pa, o.pivot[0], o.pivot[1]);
                const k = 1 + o.kick;
                pa = { x: px + (pa.x - px) * k, y: py + (pa.y - py) * k, w: pa.w * k, h: pa.h * k, s: pa.s * k };
            }
            drawP(o.actorImg || actor, pa, o.actorAlpha ?? o.alpha ?? 1);
        }
        return { ph, pa };
    }

    // ---------- 사전 생성 ----------
    const PRE = {};
    function valueNoise(x, y, s) {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const h = (i, j) => hash(i * 157.31 + j * 311.71 + s * 91.13);
        return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
    }
    function makeFog(seed, w, h, thresh) {
        const c = mk(w, h), g = c.getContext('2d');
        const id = g.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = 0, amp = 0.5, fq = 1 / 48;
                for (let o = 0; o < 5; o++) {
                    v += amp * valueNoise(x * fq, y * fq, seed + o * 7);
                    amp *= 0.5;
                    fq *= 2;
                }
                const edge = Math.min(1, x / 40, (w - x) / 40, y / 30, (h - y) / 30);
                const a = clamp((v - thresh) * 2.6) * edge;
                const i = (y * w + x) * 4;
                id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
                id.data[i + 3] = a * 255;
            }
        }
        g.putImageData(id, 0, 0);
        return c;
    }
    function makeGrain(seed) {
        const w = 960, h = 540, c = mk(w, h), g = c.getContext('2d');
        const id = g.createImageData(w, h);
        let s = seed * 2654435761 >>> 0;
        for (let i = 0; i < w * h; i++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const v = 128 + ((s >>> 24) - 128) * 0.9;
            id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
            id.data[i * 4 + 3] = 255;
        }
        g.putImageData(id, 0, 0);
        return c;
    }
    function makeVignette() {
        const c = mk(W, H), g = c.getContext('2d');
        g.translate(W / 2, H / 2);
        g.scale(1, H / W);
        const gr = g.createRadialGradient(0, 0, W * 0.28, 0, 0, W * 0.62);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(0.7, 'rgba(0,0,0,0.35)');
        gr.addColorStop(1, 'rgba(0,0,0,0.82)');
        g.fillStyle = gr;
        g.fillRect(-W, -W, W * 2, W * 2);
        return c;
    }
    function makeBlurDark(img, blur, bright, z = 1.08) {
        const c = mk(W, H), g = c.getContext('2d');
        g.filter = `blur(${blur}px) brightness(${bright}) saturate(0.8)`;
        const p = cover(img, z);
        g.drawImage(img, p.x, p.y, p.w, p.h);
        return c;
    }
    function makeStone(img) {
        const c = mk(img.width, img.height), g = c.getContext('2d');
        g.filter = 'grayscale(1) contrast(1.2) brightness(0.78)';
        g.drawImage(img, 0, 0);
        g.filter = 'none';
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(150,140,128,0.25)';
        g.fillRect(0, 0, c.width, c.height);
        return c;
    }
    // 3단 그라데이션 맵(그림자/중간/하이라이트)으로 지원군 이미지를 통일한다.
    function duotone(img, c0, c1, c2) {
        const S0 = 720, c = mk(S0, S0), g = c.getContext('2d');
        g.drawImage(img, 0, 0, S0, S0);
        const id = g.getImageData(0, 0, S0, S0), d = id.data;
        const p = [c0, c1, c2].map(h => {
            const n = parseInt(h.slice(1), 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        });
        for (let i = 0; i < d.length; i += 4) {
            let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
            l = clamp((l - 0.08) / 0.86);
            l = l * l * (3 - 2 * l);
            const [a, b, u] = l < 0.5 ? [p[0], p[1], l * 2] : [p[1], p[2], (l - 0.5) * 2];
            d[i] = lerp(a[0], b[0], u);
            d[i + 1] = lerp(a[1], b[1], u);
            d[i + 2] = lerp(a[2], b[2], u);
        }
        g.putImageData(id, 0, 0);
        return c;
    }
    // 배경과 전경을 합친 원형 썸네일
    function makeThumb(hall, actor, u, v, span) {
        const R = 220, c = mk(R, R), g = c.getContext('2d');
        g.beginPath();
        g.arc(R / 2, R / 2, R / 2, 0, Math.PI * 2);
        g.clip();
        const sw = span * hall.width, sx = u * hall.width - sw / 2, sy = v * hall.height - sw / 2;
        g.drawImage(hall, sx * (hall.width / hall.width), sy, sw, sw, 0, 0, R, R);
        const k = actor.width / hall.width;
        g.drawImage(actor, sx * k, sy * (actor.height / hall.height), sw * k, sw * (actor.height / hall.height), 0, 0, R, R);
        return c;
    }
    function makeDot(color) {
        const c = mk(64, 64), g = c.getContext('2d');
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, rgba(color, 1));
        gr.addColorStop(0.18, rgba(color, 0.85));
        gr.addColorStop(0.45, rgba(color, 0.18));
        gr.addColorStop(1, rgba(color, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        return c;
    }

    async function prepare() {
        await loadImages();
        await Promise.all([
            ['900 100px "Noto Serif KR"', '조각위플래쉬잔향아티팩트지원군보상칭호난이도'],
            ['700 100px "Noto Serif KR"', '저택의 문이 열린다'],
            ['500 100px "Noto Sans KR"', '입장 인원 난이도'],
            ['700 100px "Noto Sans KR"', '1관문 2관문'],
            ['900 100px "Noto Sans KR"', '쏟아지는 조각'],
            ['500 100px Cinzel', 'A'], ['700 100px Cinzel', 'A'], ['900 100px Cinzel', 'A'],
            ['500 100px "Barlow Condensed"', '0'], ['600 100px "Barlow Condensed"', '0'],
            ['700 100px "Barlow Condensed"', '0'], ['800 100px "Barlow Condensed"', '0'],
            ['500 100px "JetBrains Mono"', 'A'], ['700 100px "JetBrains Mono"', 'A'],
            ['400 100px "Black Han Sans"', '그로기 지금 입장']
        ].map(([f, s]) => document.fonts.load(f, s)));
        await document.fonts.ready;

        const [, mg] = buf('_measure', 4, 4);
        font(mg, F.mono, 20, 500, 0);
        const w0 = mg.measureText('AB').width;
        font(mg, F.mono, 20, 500, 10);
        LS_TRAILS = Math.abs(mg.measureText('AB').width - w0 - 20) < 1;

        PRE.fogA = makeFog(3, 420, 236, 0.42);
        PRE.fogB = makeFog(11, 420, 236, 0.5);
        PRE.grain = [1, 2, 3, 4, 5, 6].map(makeGrain);
        PRE.vignette = makeVignette();
        PRE.sBlur = makeBlurDark(IMG.sHall, 10, 0.32);
        PRE.wBlur = makeBlurDark(IMG.wHall, 10, 0.3);
        PRE.fBlur = makeBlurDark(IMG.field, 8, 0.28);
        PRE.stone = makeStone(IMG.sScene);
        PRE.block = makeBlock();
        PRE.pika = duotone(IMG.pikachu, '#0b090e', '#8a6a12', '#ffe066');
        PRE.aurora = duotone(IMG.aurora, '#071512', '#1f8b78', '#b9ffe9');
        PRE.justice = duotone(IMG.justice, '#0b090e', '#7a5a26', '#ffe2a6');
        PRE.thumbBull = makeThumb(IMG.sHall, IMG.sScene, 0.5156, 0.53, 0.26);
        PRE.thumbWhip = makeThumb(IMG.wHall, IMG.wScene, 0.5, 0.38, 0.42);
        PRE.thumbEcho = makeThumb(IMG.eHall, IMG.eScene, 0.49, 0.34, 0.34);
        PRE.dot = {};
        for (const col of [C.bronzeHi, C.goldHi, C.teal, C.violetHi, C.bloodHi, '#ffffff', C.acid, '#ffb27a']) PRE.dot[col] = makeDot(col);
        PRE.cracks = makeCracks();
        PRE.tris = makeTris();
    }

    // ---------- 공통 효과 ----------
    function particles(t, n, seed, color, o = {}) {
        const dot = PRE.dot[color];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
            const s = seed + i * 17.13;
            const speed = rnd(s + 1, o.vMin ?? 18, o.vMax ?? 60);
            const x0 = rnd(s + 2) * W, y0 = rnd(s + 3) * (H + 200);
            const y = ((y0 - t * speed * (o.dir ?? 1)) % (H + 200) + H + 200) % (H + 200) - 100;
            const x = x0 + noise1(t * 0.4 + i, s) * (o.sway ?? 40);
            const r = rnd(s + 4, o.rMin ?? 3, o.rMax ?? 10);
            const tw = 0.55 + 0.45 * Math.sin(t * rnd(s + 5, 1.5, 4) + i);
            ctx.globalAlpha = (o.alpha ?? 0.7) * tw;
            ctx.drawImage(dot, x - r, y - r, r * 2, r * 2);
        }
        ctx.restore();
    }

    function fog(t, img, alpha, o = {}) {
        const sc = o.scale ?? 7;
        const w = img.width * sc, h = img.height * sc;
        const x = -((w - W) / 2) + (o.vx ?? 25) * t + (o.ox ?? 0);
        const y = (o.y ?? H * 0.35) - h * 0.3;
        ctx.save();
        ctx.globalCompositeOperation = o.comp || 'screen';
        ctx.globalAlpha = alpha;
        if (o.tint) {
            const [c, g] = buf('_fogTint', img.width, img.height);
            g.drawImage(img, 0, 0);
            g.globalCompositeOperation = 'source-in';
            g.fillStyle = o.tint;
            g.fillRect(0, 0, img.width, img.height);
            ctx.drawImage(c, x, y, w, h);
        } else ctx.drawImage(img, x, y, w, h);
        ctx.restore();
    }

    function boltPts(seed, x1, y1, x2, y2, disp, depth = 7) {
        let pts = [[x1, y1], [x2, y2]];
        for (let d = 0; d < depth; d++) {
            const np = [pts[0]];
            for (let i = 0; i < pts.length - 1; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
                const len = Math.hypot(bx - ax, by - ay) || 1;
                const off = (hash(seed * 13.7 + d * 97.1 + i * 7.31) - 0.5) * disp * len;
                np.push([(ax + bx) / 2 - ((by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], [bx, by]);
            }
            pts = np;
        }
        return pts;
    }
    function bolt(seed, x1, y1, x2, y2, color, alpha, width = 3) {
        if (alpha <= 0.01) return;
        const main = boltPts(seed, x1, y1, x2, y2, 0.55);
        const paths = [[main, width]];
        for (let b = 0; b < 4; b++) {
            const i = Math.floor(rnd(seed + b * 3.3, 0.15, 0.7) * main.length);
            const [sx, sy] = main[i];
            const ang = Math.atan2(y2 - y1, x2 - x1) + rnd(seed + b * 5.1, -0.9, 0.9);
            const L = Math.hypot(x2 - x1, y2 - y1) * rnd(seed + b * 2.7, 0.15, 0.35);
            paths.push([boltPts(seed + b * 11, sx, sy, sx + Math.cos(ang) * L, sy + Math.sin(ang) * L, 0.6, 5), width * 0.5]);
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const [pts, w] of paths) {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 40;
            ctx.globalAlpha = alpha * 0.55;
            ctx.lineWidth = w * 4;
            ctx.stroke();
            ctx.shadowBlur = 10;
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = alpha;
            ctx.lineWidth = w;
            ctx.stroke();
        }
        ctx.restore();
    }

    function dmgNum(str, x, y, age, o = {}) {
        if (age < 0 || age > 0.95) return;
        const pop = age < 0.09 ? lerp(1.7, 1, E.outCubic(age / 0.09)) : 1;
        const a = 1 - prog(age, 0.6, 0.95);
        const size = (o.crit ? 78 : 54) * (o.scale ?? 1);
        ctx.save();
        ctx.translate(x, y - age * 70);
        ctx.scale(pop, pop);
        ctx.globalAlpha = a;
        font(ctx, F.game, size, 400, 1);
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.13;
        ctx.strokeStyle = 'rgba(12,6,4,0.9)';
        ctx.strokeText(str, 0, 0);
        const gr = ctx.createLinearGradient(0, -size * 0.8, 0, 0);
        if (o.crit) {
            gr.addColorStop(0, '#fffbe2');
            gr.addColorStop(1, '#ffb53b');
        } else if (o.color) {
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(1, o.color);
        } else {
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(1, '#d6d9e4');
        }
        ctx.fillStyle = gr;
        if (o.crit) {
            ctx.shadowColor = 'rgba(255,170,40,0.8)';
            ctx.shadowBlur = 24;
        }
        ctx.fillText(str, 0, 0);
        ctx.restore();
    }

    // 패턴 이름 표기. 같은 위치·같은 문법으로 모든 패턴에 사용한다.
    function patternLabel(t, t0, t1, idx, name, accent, o = {}) {
        if (t < t0 || t > t1) return;
        const pin = E.outExpo(prog(t, t0, t0 + 0.5));
        const pout = E.inCubic(prog(t, t1 - 0.16, t1));
        const x = (o.x ?? 120) - pout * 40, y = o.y ?? 968;
        vig();
        ctx.save();
        ctx.globalAlpha = pin * (1 - pout) * 0.8;
        ctx.translate(x + 260, y - 30);
        ctx.scale(1, 0.32);
        const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 720);
        sg.addColorStop(0, 'rgba(0,0,0,0.75)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(-720, -720, 1440, 1440);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 1 - pout;
        const lineW = 54 * pin;
        ctx.fillStyle = accent;
        ctx.fillRect(x, y - 108, lineW, 2);
        text(`PATTERN ${idx}`, x + 68, y - 100, { f: F.mono, size: 18, w: 700, ls: 6, color: accent, alpha: prog(t, t0 + 0.08, t0 + 0.3) });
        const tb = tbuf('_pat', name, { f: F.sans, size: 76, w: 900, ls: -1, color: '#ffffff' });
        const clipW = (tb.tw + 40) * pin;
        ctx.beginPath();
        ctx.rect(x - 10, y - 110, clipW + 10, 140);
        ctx.clip();
        drawTB(tb, x + (1 - pin) * -30, y, { glow: rgba(accent, 0.45), glowBlur: 26 });
        ctx.restore();
        if (o.after) o.after(x + tb.tw + 34, y, pin * (1 - pout));
    }

    // 관문 표지 — 큰 숫자 외곽선, 보스 이름, 최대 HP
    function chapterCard(t, t0, o) {
        const lt = t - t0;
        vig();
        const right = o.align === 'right';
        const X = right ? W - 116 : 116;
        const al = right ? 'right' : 'left';
        const exit = E.inCubic(prog(t, o.t1 - 0.18, o.t1));
        ctx.save();
        ctx.globalAlpha = 1 - exit;
        if (right) ctx.translate(exit * 60, 0);
        else ctx.translate(-exit * 60, 0);

        // 배경 숫자
        const np = E.outCubic(prog(lt, 0.05, 1.6));
        text(o.num, right ? W - 70 : 70, 700, {
            f: F.cinzel, size: 430, w: 900, align: al, color: null, stroke: rgba(o.accent, 0.28 * np + 0.04),
            lw: 2, dash: [np * 2600, 2600]
        });
        // 태그
        const tagP = prog(lt, 0.08, 0.55);
        tag(X, 296, o.tag, o.accent, { align: al, shown: scramble(o.tag, tagP, 5, t), alpha: Math.min(1, tagP * 3) });
        // 이름
        const tb = tbuf('_name', o.name, { f: F.serif, size: o.size, w: 900, ls: o.ls ?? 4, stops: o.metal, sheen: prog(lt, 0.85, 1.75) * 1.0, edge: 'rgba(255,255,255,0.18)' });
        drawTB(tb, X, 548, {
            align: al, glow: rgba(o.accent, 0.35), glowBlur: 40,
            char: (i, n) => {
                const k = right ? n - 1 - i : i;
                const p = E.outExpo(prog(lt, 0.04 + k * 0.07, 0.62 + k * 0.07));
                return { a: Math.min(1, p * 1.8), s: lerp(1.45, 1, p), dy: 0 };
            }
        });
        // 규칙선 + 관문 이름
        const rp = E.outExpo(prog(lt, 0.3, 1.1));
        const gr = ctx.createLinearGradient(right ? X : X, 0, right ? X - 560 : X + 560, 0);
        gr.addColorStop(0, rgba(o.accent, 0.9));
        gr.addColorStop(1, rgba(o.accent, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(right ? X - 560 * rp : X, 590, 560 * rp, 2);
        text(o.gate, X, 646, { f: F.sans, size: 30, w: 700, ls: 10, align: al, color: C.text, alpha: prog(lt, 0.45, 0.8) });
        // 최대 HP
        const hp = o.hp * E.outExpo(prog(lt, 0.7, 1.75));
        text('MAX HP', X, 712, { f: F.mono, size: 16, w: 700, ls: 6, align: al, color: C.text3, alpha: prog(lt, 0.65, 0.9) });
        text(fmt(hp), X, 772, { f: F.cond, size: 60, w: 700, ls: 2, align: al, color: C.text, alpha: prog(lt, 0.7, 0.9) });
        ctx.restore();
    }

    // 구간 머리말: 영문 태그 + 한글 금속 제목
    function sectionHead(t, t0, en, ko, o = {}) {
        const a = o.alpha ?? 1;
        const p = E.outExpo(prog(t, t0, t0 + 0.45));
        const x = o.x ?? W / 2, y = o.y ?? 58, al = o.align || 'center';
        const col = o.color || C.violetHi;
        tag(x, y, en, col, { align: al, alpha: p * a, shown: scramble(en, prog(t, t0, t0 + 0.35), 3, t) });
        const tb = tbuf('_head', ko, { f: F.serif, size: 66, w: 900, ls: 16, stops: o.metal || METAL.silver, sheen: prog(t, t0 + 0.25, t0 + 1.3) });
        drawTB(tb, x, y + 126, {
            align: al, alpha: a, glow: rgba(col, 0.35), glowBlur: 30,
            char: i => {
                const pp = E.outExpo(prog(t, t0 + 0.05 + i * 0.06, t0 + 0.5 + i * 0.06));
                return { a: pp, dy: (1 - pp) * 24 };
            }
        });
    }

    // ---------- 카메라 흔들림·섬광·색수차 ----------
    const SHAKES = [];
    const FLASHES = [];
    const CA = [];
    const GLITCH = [];
    const CUTS = [];
    function buildEvents() {
        const g1 = beat.gate1, g2 = beat.gate2, e = beat.echo;
        SHAKES.push([g1(0), 16, 0.22], [g1(5), 11, 0.18], [g1(6), 13, 0.18], [g1(7), 20, 0.24], [g1(13), 7, 0.15]);
        TL.SCULPT_HITS.forEach((k, i) => SHAKES.push([g1(k), i % 2 ? 3 : 5, 0.09]));
        SHAKES.push([g1(17), 12, 0.2], [g2(0), 16, 0.22], [g2(7), 30, 0.3], [g2(8.5), 7, 0.12], [g2(9.5), 7, 0.12], [g2(10), 14, 0.5]);
        SHAKES.push([e(0), 26, 0.3], [e(5), 10, 0.2], [e(6), 8, 0.16], [e(8), 8, 0.14], [e(9), 8, 0.14], [e(10), 10, 0.16]);
        SHAKES.push([e(16), 6, 0.12], [e(17), 6, 0.12], [e(18), 6, 0.12], [e(20), 8, 0.2], [FINAL_HIT, 22, 0.3]);
        for (let i = 0; i < 12; i++) SHAKES.push([g2(16) + i * B2 * 0.33, i % 4 === 3 ? 7 : 4, 0.08]);

        FLASHES.push([g1(0), '#ffffff', 0.9, 0.16], [g2(0), '#ffffff', 0.85, 0.16], [g2(7), '#b9a3ff', 0.75, 0.16]);
        FLASHES.push([beat.intro(8), '#d9d0ff', 0.25, 0.08]);
        for (const k of [12, 13, 14]) FLASHES.push([beat.intro(k), '#ffffff', 0.75, 0.09]);
        FLASHES.push([e(0), '#ffd3cc', 0.5, 0.12], [FINAL_HIT, '#ffffff', 1, 0.28]);
        for (const k of [8, 9, 10, 16, 17, 18]) FLASHES.push([e(k), '#ffffff', 0.18, 0.08]);
        FLASHES.push([e(20), '#fff2c9', 0.45, 0.14], [g1(13), '#ffe2a8', 0.3, 0.12], [g1(17), '#ffe2a8', 0.22, 0.1]);
        for (let k = 0; k < 5; k++) FLASHES.push([beat.finale(k), '#ffffff', 0.22, 0.08]);

        CA.push([g2(7), 16, 0.28], [e(0), 10, 0.25], [FINAL_HIT, 12, 0.3], [beat.intro(14), 10, 0.2], [g1(7), 6, 0.15]);
        for (const k of [4, 12, 13, 14, 15]) CUTS.push([beat.intro(k), k === 4 ? 0.03 : 0.06]);
        for (const k of [0, 4, 8, 14, 18, 22]) CUTS.push([g1(k), 0.05]);
        for (const k of [0, 4, 8, 10, 12, 16]) CUTS.push([g2(k), 0.05]);
        for (const k of [0, 8, 16, 20]) CUTS.push([e(k), 0.06]);
        for (let k = 0; k < 5; k++) CUTS.push([beat.finale(k), 0.03]);
        CUTS.push([FINAL_HIT, 0.07]);
        GLITCH.push([beat.intro(14), 0.35], [e(0) + 0.02, 0.4], [e(1), 0.3], [e(4), 0.18], [e(6), 0.22]);
    }

    function shakeAt(t) {
        let dx = 0, dy = 0, mag = 0;
        for (const [t0, amp, dec] of SHAKES) {
            if (t < t0 || t > t0 + dec * 6) continue;
            const k = amp * Math.exp(-(t - t0) / dec);
            dx += noise1(t * 38 + t0 * 3, 1) * k;
            dy += noise1(t * 41 + t0 * 5, 2) * k;
            mag += k;
        }
        // 2관문 마지막 연타 동안의 잔떨림
        if (t > beat.gate2(16) && t < beat.gate2(19.7)) {
            dx += noise1(t * 30, 3) * 3;
            dy += noise1(t * 33, 4) * 3;
            mag += 3;
        }
        return [dx, dy, mag];
    }

    // ---------- 장면: 인트로 ----------
    function sIntro(t) {
        const b = beat.intro;
        if (t < b(12)) {
            if (t >= b(4) - 0.06) introMansion(t);
            if (t < b(4) + 0.7) introSeam(t);
        } else introFlashes(t);
    }

    function introSeam(t) {
        const b = beat.intro;
        const open = E.outExpo(prog(t, b(4) - 0.06, b(4) + 0.6));
        const lw = W * 0.36 * E.outExpo(prog(t, 0.15, 1.6));
        const flick = t < 0.55 ? (hash(Math.floor(t * 24)) > 0.35 ? 1 : 0.25) : 1;
        const cy = H / 2;
        const half = lerp(1, H / 2, open);
        const a = flick * (1 - prog(t, b(4) + 0.2, b(4) + 0.7));
        for (const sy of open > 0 ? [-1, 1] : [0]) {
            const y = cy + sy * half;
            const w = lw + open * W;
            const gr = ctx.createLinearGradient(W / 2 - w / 2, 0, W / 2 + w / 2, 0);
            gr.addColorStop(0, 'rgba(155,135,214,0)');
            gr.addColorStop(0.5, 'rgba(236,230,255,1)');
            gr.addColorStop(1, 'rgba(155,135,214,0)');
            ctx.save();
            ctx.globalAlpha = a;
            ctx.globalCompositeOperation = 'lighter';
            ctx.shadowColor = C.violet;
            ctx.shadowBlur = 24;
            ctx.fillStyle = gr;
            ctx.fillRect(W / 2 - w / 2, y - 1, w, 2);
            ctx.restore();
        }
        if (open <= 0) {
            const sp = E.outBack(prog(t, 0.35, 0.9));
            star(W / 2, cy, 20 * sp, C.violetHi, 0.95 * flick, t * 0.6);
            glow(W / 2, cy, 140, C.violet, 0.35 * sp);
            const la = 1 - prog(t, b(4) - 0.25, b(4) - 0.06);
            const lp = prog(t, 0.55, 1.15), lp2 = prog(t, 0.85, 1.4);
            text(scramble('RPGENIUS', lp, 9, t), W / 2, cy + 68, {
                f: F.mono, size: 22, w: 700, ls: 14, align: 'center', color: C.violetHi, alpha: Math.min(1, lp * 4) * la
            });
            text(scramble('NEW RAID', lp2, 19, t), W / 2, cy + 102, {
                f: F.mono, size: 15, w: 500, ls: 10, align: 'center', color: C.text2, alpha: Math.min(1, lp2 * 4) * la
            });
        }
    }

    function introMansion(t) {
        const b = beat.intro;
        const open = E.outExpo(prog(t, b(4) - 0.06, b(4) + 0.6));
        ctx.save();
        if (open < 1) {
            const half = lerp(1, H / 2, open);
            ctx.beginPath();
            ctx.rect(0, H / 2 - half, W, half * 2);
            ctx.clip();
        }
        const p = prog(t, b(4), b(12));
        const z = lerp(1.06, 1.17, E.inOutSine(p)) + (1 - open) * 0.08;
        const ph = cover(IMG.field, z, 0.6, 0.42, lerp(18, -18, p));
        drawP(IMG.field, ph);
        // 번개
        const fl = pulse(t, b(8), 0.09) + 0.6 * pulse(t, b(8) + 0.15, 0.06) + 0.3 * pulse(t, b(10) + 0.21, 0.05);
        if (fl > 0.01) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = Math.min(0.85, fl * 0.75);
            ctx.drawImage(IMG.field, ph.x, ph.y, ph.w, ph.h);
            ctx.restore();
            fill('#8f7ad8', fl * 0.22, 'lighter');
        }
        if (t >= b(8) && t < b(8) + 0.28) bolt(41, W * 0.29, -20, W * 0.355, H * 0.42, '#c8b6ff', 1 - prog(t, b(8) + 0.05, b(8) + 0.28), 3);
        if (t >= b(10) + 0.21 && t < b(10) + 0.4) bolt(77, W * 0.82, -20, W * 0.76, H * 0.3, '#c8b6ff', 0.7 * (1 - prog(t, b(10) + 0.25, b(10) + 0.4)), 2);
        // 색 정리
        fill('#3a2f66', 0.32, 'soft-light');
        vgrad([[0, 'rgba(10,8,20,0.0)'], [1, 'rgba(6,5,10,0.75)']], 1, 'source-over', H * 0.45, H);
        fog(t, PRE.fogA, 0.24, { vx: 26, y: H * 0.5, scale: 7 });
        fog(t, PRE.fogB, 0.16, { vx: -18, y: H * 0.62, scale: 6, ox: 200 });
        // 비
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 150; i++) {
            const sp = rnd(i + 0.3, 1700, 2500);
            const x = rnd(i + 0.7) * W * 1.2 - W * 0.1;
            const y = ((rnd(i + 0.9) * (H + 300) + t * sp) % (H + 300)) - 150;
            const len = rnd(i + 0.1, 30, 80);
            ctx.globalAlpha = rnd(i + 0.5, 0.05, 0.16);
            ctx.strokeStyle = '#c9c4ff';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - len * 0.22, y + len);
            ctx.stroke();
        }
        ctx.restore();
        ctx.restore();
        vig();
        // 문구
        const line = '저택의 문이 열린다';
        const tb = tbuf('_tag', line, { f: F.serif, size: 54, w: 700, ls: 20, color: '#f2efff' });
        const outP = prog(t, b(11), b(12) - 0.05);
        drawTB(tb, W / 2, H * 0.78, {
            align: 'center', glow: 'rgba(155,135,214,0.55)', glowBlur: 26, alpha: 1 - outP,
            char: i => {
                const pp = E.outCubic(prog(t, b(5) + i * 0.075, b(5) + i * 0.075 + 0.7));
                return { a: pp, dy: (1 - pp) * 16 - outP * 6 * (i - 4), s: 1 };
            }
        });
    }

    function introFlashes(t) {
        const b = beat.intro;
        const k = Math.min(3, Math.floor((t - b(12)) / B1));
        const lt = t - b(12 + k);
        const p = lt / B1;
        if (k === 0) {
            stage(IMG.sHall, IMG.sScene, lerp(2.2, 2.45, p), 0.5156, 0.5);
            fill('#c7893f', 0.3, 'soft-light');
            glow(W * 0.52, H * 0.45, 500, C.bronzeHi, 0.12);
        } else if (k === 1) {
            const { pa } = stage(IMG.wHall, IMG.wScene, lerp(2.0, 2.25, p), 0.5, 0.42);
            fill('#2f8f88', 0.25, 'soft-light');
            const [lx, ly] = at(pa, 0.4125, 0.311);
            glow(lx, ly, 160, C.acid, 0.6 + 0.4 * pulse(lt, 0, 0.12));
        } else if (k === 2) {
            stage(IMG.eHall, IMG.eScene, lerp(2.7, 2.95, p), 0.478, 0.33);
            fill('#b3121c', 0.3, 'soft-light');
            vgrad([[0, 'rgba(60,0,8,0.4)'], [1, 'rgba(0,0,0,0)']], 1, 'multiply', 0, H);
        } else {
            // 문이 열리는 빛의 틈
            fill('#040306');
            const op = E.inExpo(prog(lt, 0.0, B1));
            const w = lerp(3, W * 0.62, op);
            const gr = ctx.createLinearGradient(W / 2 - w / 2, 0, W / 2 + w / 2, 0);
            gr.addColorStop(0, 'rgba(120,100,200,0)');
            gr.addColorStop(0.35, 'rgba(200,185,255,0.8)');
            gr.addColorStop(0.5, 'rgba(255,255,255,1)');
            gr.addColorStop(0.65, 'rgba(200,185,255,0.8)');
            gr.addColorStop(1, 'rgba(120,100,200,0)');
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = gr;
            ctx.shadowColor = C.violet;
            ctx.shadowBlur = 60;
            ctx.fillRect(W / 2 - w / 2, 0, w, H);
            ctx.restore();
            // 틈에서 쏟아지는 먼지
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 70; i++) {
                const s = i * 3.7;
                const dir = hash(s) < 0.5 ? -1 : 1;
                const sp = rnd(s + 1, 300, 1400);
                const x = W / 2 + dir * (lt * sp * op + rnd(s + 2, 0, 20));
                const y = rnd(s + 3) * H;
                const r = rnd(s + 4, 2, 7);
                ctx.globalAlpha = 0.6 * (1 - prog(lt, 0.3, B1));
                ctx.drawImage(PRE.dot['#ffffff'], x - r, y - r, r * 2, r * 2);
            }
            ctx.restore();
            fill('#ffffff', E.inCubic(prog(lt, B1 * 0.75, B1)) * 0.9, 'lighter');
        }
    }

    // ---------- 장면: 1관문 조각 ----------
    const BULL = [0.5156, 0.5135];
    function sGate1(t) {
        const g = beat.gate1;
        if (t < g(4)) g1Card(t);
        else if (t < g(8)) g1Shards(t);
        else if (t < g(14)) g1Pillars(t);
        else if (t < g(18)) g1Sculpt(t);
        else if (t < g(22)) g1Dictation(t);
        else g1Harden(t);
    }
    function warmGrade() {
        fill('#c7893f', 0.24, 'soft-light');
        vgrad([[0, 'rgba(0,0,0,0)'], [1, 'rgba(10,5,2,0.7)']], 1, 'source-over', H * 0.55, H);
    }

    function g1Card(t) {
        const g = beat.gate1, lt = t - g(0);
        const z = 1.17 - 0.09 * E.outExpo(prog(lt, 0, 1.5)) - 0.025 * prog(lt, 0, 2.2);
        stage(IMG.sHall, IMG.sScene, z, BULL[0] + 0.06, 0.56, { par: 0.04 });
        warmGrade();
        particles(t, 55, 3, C.bronzeHi, { alpha: 0.5, rMax: 9 });
        // 왼쪽 가독성 그늘
        const gr = ctx.createLinearGradient(0, 0, W * 0.5, 0);
        gr.addColorStop(0, 'rgba(6,4,3,0.7)');
        gr.addColorStop(1, 'rgba(6,4,3,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W * 0.5, H);
        chapterCard(t, g(0), {
            t1: g(4), num: '01', tag: 'GATE 01', name: '조각', size: 236, metal: METAL.bronze, accent: C.bronzeHi,
            gate: '1관문', hp: 27000000
        });
    }

    function g1Shards(t) {
        const g = beat.gate1, lt = t - g(4);
        const z = 1.24 + 0.05 * prog(lt, 0, B1 * 4);
        stage(IMG.sHall, IMG.sScene, z, BULL[0], 0.44, { par: 0.04 });
        warmGrade();
        const shard = IMG.shard;
        const impacts = [];
        for (let w = 0; w < 3; w++) {
            const ti = g(5 + w);
            for (let j = 0; j < 13; j++) {
                const s = w * 100 + j * 7.7;
                const tl = ti + rnd(s, -0.05, 0.05);
                const xl = W * rnd(s + 1, 0.08, 0.92), yl = H * rnd(s + 2, 0.66, 0.92);
                const x0 = xl + rnd(s + 3, -260, 120), y0 = rnd(s + 4, -260, -80);
                const hy = rnd(s + 5, 40, 150);
                const appear = tl - 0.62, fallStart = tl - 0.24;
                if (t < appear || t > tl + 0.55) continue;
                const sc = rnd(s + 6, 0.17, 0.36);
                const rot = rnd(s + 7, -0.5, 0.4) + 0.35;
                let x, y, a = 1, tr = 0;
                if (t < fallStart) {
                    const ap = E.outCubic(prog(t, appear, appear + 0.25));
                    x = x0 + noise1(t * 20 + j, s) * 3;
                    y = lerp(y0 - 80, hy - 60, ap);
                    a = ap;
                } else if (t < tl) {
                    const fp = E.inCubic(prog(t, fallStart, tl));
                    x = lerp(x0, xl, fp);
                    y = lerp(hy - 60, yl, fp);
                    tr = fp;
                } else {
                    x = xl;
                    y = yl + 10 * E.outCubic(prog(t, tl, tl + 0.1));
                    a = 1 - prog(t, tl + 0.25, tl + 0.55);
                }
                const size = shard.width * sc;
                const ang = Math.atan2(yl - (hy - 60), xl - x0) - Math.PI / 2 + rot * 0.3;
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(ang);
                if (tr > 0.05) {
                    for (let k = 3; k >= 1; k--) {
                        ctx.globalAlpha = a * 0.12 * k * tr;
                        ctx.drawImage(shard, -size / 2, -size / 2 - k * 46 * tr, size, size);
                    }
                }
                ctx.globalAlpha = a;
                ctx.drawImage(shard, -size / 2, -size / 2, size, size);
                ctx.restore();
                if (t >= tl) impacts.push([xl, yl, t - tl, s]);
            }
        }
        // 착탄 먼지·불꽃
        for (const [x, y, age, s] of impacts) {
            glow(x, y, 160 * (1 + age * 2), C.bronzeHi, 0.7 * (1 - prog(age, 0, 0.3)));
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let k = 0; k < 7; k++) {
                const ang = -Math.PI * rnd(s + k, 0.05, 0.95);
                const sp = rnd(s + k + 0.5, 200, 700);
                const px = x + Math.cos(ang) * sp * age, py = y + Math.sin(ang) * sp * age + 900 * age * age;
                const r = 5 * (1 - prog(age, 0, 0.5));
                ctx.globalAlpha = 1 - prog(age, 0.1, 0.5);
                ctx.drawImage(PRE.dot['#ffb27a'], px - r * 2, py - r * 2, r * 4, r * 4);
            }
            ctx.restore();
        }
        // 피해 숫자
        const vals = [[0.3, 0.55, '4,920'], [0.62, 0.48, '5,104'], [0.45, 0.62, '9,840', true]];
        vals.forEach(([u, v, s, crit], w) => dmgNum(s, W * u, H * v, t - g(5 + w), { crit }));
        patternLabel(t, g(4), g(8), '01', '쏟아지는 조각', C.bronzeHi, {
            after: (x, y, a) => {
                for (let i = 0; i < 3; i++) {
                    const on = t >= g(5 + i);
                    const pp = pulse(t, g(5 + i), 0.15);
                    ctx.save();
                    ctx.globalAlpha = a;
                    ctx.translate(x + i * 36, y - 30);
                    ctx.rotate(Math.PI / 4);
                    ctx.fillStyle = on ? C.bronzeHi : 'rgba(255,255,255,0.18)';
                    if (on) {
                        ctx.shadowColor = C.bronzeHi;
                        ctx.shadowBlur = 14 + pp * 30;
                    }
                    const r = 9 + pp * 5;
                    ctx.fillRect(-r, -r, r * 2, r * 2);
                    ctx.restore();
                }
            }
        });
    }

    // 기둥 하중: 0/4/8/12 → 6/6/6/6
    const PILLAR_MOVES = [[3, 0], [2, 0], [3, 1], [3, 0], [2, 0], [3, 0], [3, 1], [3, 0]];
    function g1Pillars(t) {
        const g = beat.gate1, lt = t - g(8);
        ctx.drawImage(PRE.sBlur, 0, 0);
        fill('#c7893f', 0.15, 'soft-light');
        particles(t, 40, 9, C.bronzeHi, { alpha: 0.35, rMax: 7 });
        vig();
        const loads = [0, 4, 8, 12];
        const flights = [];
        PILLAR_MOVES.forEach(([from, to], j) => {
            const tm = g(8.5 + j * 0.5), ta = tm + 0.24;
            if (t >= tm) loads[from]--;
            if (t >= ta) loads[to]++;
            if (t >= tm && t < ta) flights.push([from, to, prog(t, tm, ta)]);
        });
        const done = t >= g(13);
        const succ = pulse(t, g(13), 0.4);
        const baseY = 860, shaftH = 400, pw = 104;
        const xs = [0, 1, 2, 3].map(i => W / 2 + (i - 1.5) * 250);
        const topY = baseY - shaftH;
        // 목표선(6)
        const ly = baseY - shaftH * 0.5;
        const lp = E.outExpo(prog(lt, 0.3, 0.9));
        ctx.save();
        ctx.setLineDash([10, 10]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = done ? rgba(C.goldHi, 0.9) : 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(xs[0] - 110, ly);
        ctx.lineTo(xs[0] - 110 + (xs[3] - xs[0] + 220) * lp, ly);
        ctx.stroke();
        ctx.restore();
        text('6', xs[3] + 130, ly + 12, { f: F.cond, size: 34, w: 700, color: done ? C.goldHi : C.text2, alpha: lp });
        xs.forEach((x, i) => {
            const rise = E.outExpo(prog(lt, i * 0.06, 0.5 + i * 0.06));
            const oy = (1 - rise) * 220;
            ctx.save();
            ctx.translate(0, oy);
            ctx.globalAlpha = rise;
            // 받침과 기둥머리
            const stone = ctx.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
            stone.addColorStop(0, '#2a2420');
            stone.addColorStop(0.35, '#6b5d50');
            stone.addColorStop(0.6, '#4a3f36');
            stone.addColorStop(1, '#1d1814');
            ctx.fillStyle = stone;
            ctx.fillRect(x - pw / 2 - 22, baseY, pw + 44, 34);
            ctx.fillRect(x - pw / 2 - 12, baseY - 14, pw + 24, 14);
            ctx.fillRect(x - pw / 2, topY, pw, shaftH);
            ctx.fillRect(x - pw / 2 - 18, topY - 30, pw + 36, 30);
            ctx.fillRect(x - pw / 2 - 8, topY - 44, pw + 16, 14);
            // 세로 홈
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            for (let f = -2; f <= 2; f++) ctx.fillRect(x + f * 18 - 2, topY + 6, 4, shaftH - 12);
            // 하중 빛
            const ld = clamp(loads[i] / 12);
            const fh = (shaftH - 16) * ld;
            const lg = ctx.createLinearGradient(0, baseY, 0, baseY - shaftH);
            lg.addColorStop(0, done ? '#fff1c4' : '#ffcf8a');
            lg.addColorStop(1, done ? '#f0b44c' : '#c7652a');
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = rise * (0.55 + succ * 0.45);
            ctx.shadowColor = done ? C.goldHi : C.bronze;
            ctx.shadowBlur = 30;
            ctx.fillStyle = lg;
            ctx.fillRect(x - pw / 2 + 10, baseY - 8 - fh, pw - 20, fh);
            ctx.restore();
            // 하중 숫자
            let pop = 0;
            PILLAR_MOVES.forEach(([from, to], j) => {
                const tm = g(8.5 + j * 0.5);
                if (from === i) pop = Math.max(pop, pulse(t, tm, 0.12) * 0.5);
                if (to === i) pop = Math.max(pop, pulse(t, tm + 0.24, 0.14));
            });
            pop = Math.max(pop, succ * 0.6);
            ctx.save();
            ctx.translate(x, topY - 84);
            ctx.scale(1 + pop * 0.35, 1 + pop * 0.35);
            text(String(loads[i]), 0, 0, {
                f: F.cond, size: 96, w: 800, align: 'center', color: done ? C.goldHi : '#ffffff',
                glow: done ? rgba(C.goldHi, 0.8) : rgba(C.bronzeHi, 0.4 + pop * 0.6), glowBlur: 30
            });
            ctx.restore();
            ctx.restore();
        });
        // 이동하는 하중 1
        for (const [from, to, p] of flights) {
            const x0 = xs[from], x1 = xs[to];
            const e = E.inOutCubic(p);
            const x = lerp(x0, x1, e);
            const y = topY - 150 - Math.sin(Math.PI * e) * 120;
            for (let k = 0; k < 6; k++) {
                const ek = E.inOutCubic(clamp(p - k * 0.04));
                const tx = lerp(x0, x1, ek), ty = topY - 150 - Math.sin(Math.PI * ek) * 120;
                glow(tx, ty, 26 - k * 3, C.bronzeHi, 0.5 - k * 0.07);
            }
            glow(x, y, 70, C.goldHi, 0.9);
            star(x, y, 18, '#fff4dc', 1, p * 3);
        }
        // 제한 시간 고리
        const remain = lerp(9.0, 2.6, prog(t, g(8.5), g(13)));
        const ra = E.outExpo(prog(lt, 0.1, 0.5));
        ctx.save();
        ctx.globalAlpha = ra;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(W / 2, 150, 52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = done ? C.goldHi : C.bronzeHi;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(W / 2, 150, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (remain / 9));
        ctx.stroke();
        ctx.restore();
        text(remain.toFixed(1), W / 2, 164, { f: F.mono, size: 34, w: 700, align: 'center', color: C.text, alpha: ra });
        // 성공 띠
        if (done) {
            const sp = E.outExpo(prog(t, g(13), g(13) + 0.35));
            ctx.save();
            ctx.globalAlpha = sp;
            const band = ctx.createLinearGradient(0, 0, W, 0);
            band.addColorStop(0, 'rgba(10,7,3,0)');
            band.addColorStop(0.5, 'rgba(10,7,3,0.82)');
            band.addColorStop(1, 'rgba(10,7,3,0)');
            ctx.fillStyle = band;
            ctx.fillRect(0, 470, W, 150);
            ctx.restore();
            const tb = tbuf('_groggy', '그로기', { f: F.game, size: 116, w: 400, ls: 24, stops: METAL.gold, sheen: prog(t, g(13) + 0.1, g(13.9)) });
            drawTB(tb, W / 2, 590, {
                align: 'center', glow: rgba(C.goldHi, 0.6), glowBlur: 40,
                char: i => {
                    const pp = E.outExpo(prog(t, g(13) + i * 0.04, g(13) + 0.35 + i * 0.04));
                    return { a: pp, s: lerp(1.6, 1, pp) };
                }
            });
        }
        patternLabel(t, g(8), g(14), '02', '기둥 하중 이동', C.bronzeHi);
    }

    // 조각 레이어 위로 광택 띠를 한 번 훑는다
    function sheenLayer(img, pa, sp, alpha, hi = 'rgba(255,245,220,1)', lo = 'rgba(255,220,160,0)') {
        if (sp <= 0 || sp >= 1) return;
        const [c, gg] = buf('_sheen', W, H);
        gg.drawImage(img, pa.x, pa.y, pa.w, pa.h);
        gg.globalCompositeOperation = 'source-atop';
        const [bx, by] = at(pa, BULL[0], BULL[1]);
        const span = pa.w * 0.18;
        const sx = bx - span + sp * span * 2;
        const gr = gg.createLinearGradient(sx - 140, by - 200, sx + 140, by + 200);
        gr.addColorStop(0, lo);
        gr.addColorStop(0.5, hi);
        gr.addColorStop(1, lo);
        gg.fillStyle = gr;
        gg.fillRect(0, 0, W, H);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.drawImage(c, 0, 0);
        ctx.restore();
    }

    // 석재 조형: 받침대 위 돌덩이를 정으로 쪼아 황소 조각을 드러낸다
    const BLOCK = { u0: 0.41, u1: 0.625, v0: 0.325, v1: 0.668, cols: 11, rows: 11 };
    function makeBlock() {
        const src = PRE.stone;
        const bx = Math.round(BLOCK.u0 * src.width), by = Math.round(BLOCK.v0 * src.height);
        const bw = Math.round((BLOCK.u1 - BLOCK.u0) * src.width), bh = Math.round((BLOCK.v1 - BLOCK.v0) * src.height);
        const c = mk(bw, bh), g = c.getContext('2d');
        const id = g.createImageData(bw, bh), d = id.data;
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const broad = valueNoise(x / 60, y / 60, 31);
                const mid = valueNoise(x / 9, y / 9, 37) * 0.6 + valueNoise(x / 4, y / 4, 41) * 0.4;
                const grain = hash(x * 13.1 + y * 71.7) - 0.5;
                const pit = hash(x * 3.7 + y * 19.3) > 0.985 ? 0.62 : 1;
                const light = 1.0 - 0.36 * (y / bh) + 0.1 * (1 - x / bw);
                const v = (0.56 + (broad - 0.5) * 0.22 + (mid - 0.5) * 0.2 + grain * 0.12) * light * pit;
                const i = (y * bw + x) * 4;
                d[i] = 110 * v;
                d[i + 1] = 108 * v;
                d[i + 2] = 106 * v;
                d[i + 3] = 255;
            }
        }
        g.putImageData(id, 0, 0);
        // 정으로 다듬은 자국
        g.lineCap = 'round';
        for (let k = 0; k < 160; k++) {
            const cx = rnd(k * 3.1, 0, bw), cy = rnd(k * 5.7, 0, bh);
            const a = -0.6 + rnd(k * 7.3, -0.35, 0.35), len = rnd(k * 2.9, 16, 46);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            g.lineWidth = rnd(k * 1.7, 2, 7);
            g.strokeStyle = k % 2 ? `rgba(255,238,215,${rnd(k, 0.05, 0.12)})` : `rgba(18,12,6,${rnd(k, 0.08, 0.18)})`;
            g.stroke();
        }
        // 윗면 빛
        const tg = g.createLinearGradient(0, 0, 0, bh * 0.14);
        tg.addColorStop(0, 'rgba(255,236,210,0.2)');
        tg.addColorStop(1, 'rgba(255,236,210,0)');
        g.fillStyle = tg;
        g.fillRect(0, 0, bw, bh * 0.14);
        const eg = g.createLinearGradient(0, 0, bw, 0);
        eg.addColorStop(0, 'rgba(0,0,0,0.25)');
        eg.addColorStop(0.15, 'rgba(0,0,0,0)');
        eg.addColorStop(0.85, 'rgba(0,0,0,0)');
        eg.addColorStop(1, 'rgba(0,0,0,0.4)');
        g.fillStyle = eg;
        g.fillRect(0, 0, bw, bh);
        // 꼭짓점을 흔든 격자로 돌 조각을 나눈다
        const { cols, rows } = BLOCK;
        const P = [];
        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= cols; i++) {
                const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
                let x = (i / cols) * bw + (ex ? 0 : (rnd(i * 17 + j * 3, -0.3, 0.3) * bw) / cols);
                let y = (j / rows) * bh + (ey ? 0 : (rnd(i * 5 + j * 23, -0.3, 0.3) * bh) / rows);
                if (j === 0) y += (rnd(i * 9.1, 0, 0.6) * bh) / rows;
                if (ex && !ey) x += ((i === 0 ? 1 : -1) * rnd(j * 4.3, 0, 0.5) * bw) / cols;
                P.push([x, y]);
            }
        }
        const alpha = src.getContext('2d').getImageData(bx, by, bw, bh).data;
        const solid = (x, y) => alpha[(clamp(Math.round(y), 0, bh - 1) * bw + clamp(Math.round(x), 0, bw - 1)) * 4 + 3] > 40;
        const cells = [];
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const a = P[j * (cols + 1) + i], b = P[j * (cols + 1) + i + 1];
                const cc = P[(j + 1) * (cols + 1) + i + 1], dd = P[(j + 1) * (cols + 1) + i];
                let cov = 0;
                for (let sy = 0; sy < 5; sy++) {
                    for (let sx = 0; sx < 5; sx++) {
                        if (solid(lerp(Math.min(a[0], dd[0]), Math.max(b[0], cc[0]), (sx + 0.5) / 5), lerp(Math.min(a[1], b[1]), Math.max(cc[1], dd[1]), (sy + 0.5) / 5))) cov++;
                    }
                }
                cells.push({ poly: [a, b, cc, dd], cx: (a[0] + b[0] + cc[0] + dd[0]) / 4, cy: (a[1] + b[1] + cc[1] + dd[1]) / 4, cov: cov / 25, seed: j * 31 + i });
            }
        }
        // 조각을 덮지 않는 돌부터 떨어지고, 나머지는 마지막 타격에 한꺼번에 깨진다
        const order = cells.slice().sort((p, q) => p.cov + hash(p.seed) * 0.3 - (q.cov + hash(q.seed) * 0.3));
        const early = Math.round(order.length * 0.58), n = TL.SCULPT_HITS.length;
        order.forEach((cell, k) => {
            cell.hit = k < early ? Math.min(n - 1, Math.floor((k / early) * n)) : n;
        });
        return { c, bx, by, bw, bh, cells };
    }

    function g1Sculpt(t) {
        const g = beat.gate1, lt = t - g(14);
        const hits = TL.SCULPT_HITS.map(k => g(k));
        const tFinal = g(17);
        const z = 1.24 + 0.08 * E.inOutSine(prog(lt, 0, B1 * 4)) + 0.04 * E.outExpo(prog(t, tFinal, tFinal + 0.6));
        const { pa } = stage(IMG.sHall, PRE.stone, z, BULL[0], 0.5, { par: 0.04, actorImg: PRE.stone });
        const B = PRE.block;
        const k = pa.w / PRE.stone.width;
        const X0 = pa.x + B.bx * k, Y0 = pa.y + B.by * k;
        const map = ([x, y]) => [X0 + x * k, Y0 + y * k];
        const polyPath = poly => {
            poly.forEach((pt, i) => {
                const [x, y] = map(pt);
                if (i) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
            });
            ctx.closePath();
        };
        const tOf = cell => (cell.hit < hits.length ? hits[cell.hit] : tFinal);
        // 아직 붙어 있는 돌
        const rest = B.cells.filter(cell => t < tOf(cell));
        if (rest.length) {
            // 두께: 오른쪽 위로 밀어낸 어두운 옆면
            ctx.save();
            for (let st = 7; st >= 1; st--) {
                ctx.save();
                ctx.translate(st * 2.2 * k, -st * 1.5 * k);
                ctx.beginPath();
                rest.forEach(cell => polyPath(cell.poly));
                ctx.fillStyle = st === 7 ? '#16120f' : '#2a2420';
                ctx.fill();
                ctx.restore();
            }
            ctx.beginPath();
            rest.forEach(cell => polyPath(cell.poly));
            ctx.clip();
            ctx.drawImage(B.c, X0, Y0, B.bw * k, B.bh * k);
            // 조각마다 기울기가 다른 깎인 면
            for (const cell of rest) {
                const hv = hash(cell.seed * 1.37);
                const [ax, ay] = map(cell.poly[0]), [cx2, cy2] = map(cell.poly[2]);
                const fg = ctx.createLinearGradient(ax, ay, cx2, cy2);
                fg.addColorStop(0, `rgba(255,244,230,${0.03 + hv * 0.07})`);
                fg.addColorStop(1, `rgba(0,0,0,${0.06 + (1 - hv) * 0.16})`);
                ctx.beginPath();
                polyPath(cell.poly);
                ctx.fillStyle = fg;
                ctx.fill();
            }
            ctx.beginPath();
            rest.forEach(cell => polyPath(cell.poly));
            ctx.strokeStyle = 'rgba(12,9,6,0.14)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // 곧 떨어질 돌에 먼저 금이 간다
            for (const cell of rest) {
                const fin = cell.hit >= hits.length;
                const lead = tOf(cell) - t, win = fin ? 0.3 : 0.28;
                if (lead > win) continue;
                const cp = 1 - lead / win;
                ctx.beginPath();
                polyPath(cell.poly);
                ctx.strokeStyle = `rgba(8,5,3,${(0.25 + 0.55 * cp) * (fin ? 0.6 : 1)})`;
                ctx.lineWidth = 1 + 1.6 * cp;
                ctx.stroke();
            }
            ctx.restore();
        }
        // 떨어져 나가는 돌 조각
        const ccx = B.bw / 2, ccy = B.bh * 0.45;
        for (const cell of B.cells) {
            const age = t - tOf(cell);
            if (age < 0 || age > 0.75) continue;
            const fin = cell.hit >= hits.length;
            const dx = cell.cx - ccx, dy = cell.cy - ccy, d = Math.hypot(dx, dy) || 1;
            const sp = rnd(cell.seed + 0.4, 260, 620) * (fin ? 1.7 : 1);
            const vx = (dx / d) * sp, vy = (dy / d) * sp - rnd(cell.seed + 0.9, 150, 380);
            const [cx, cy] = map([cell.cx, cell.cy]);
            const sc = 1 - 0.35 * prog(age, 0, 0.75);
            const rot = rnd(cell.seed + 1.3, -7, 7) * age;
            const tumble = 0.45 + 0.55 * Math.abs(Math.cos(rnd(cell.seed + 2.1, 4, 9) * age));
            ctx.save();
            ctx.globalAlpha = 1 - prog(age, 0.35, 0.75);
            ctx.translate(cx + vx * age, cy + vy * age + 1700 * age * age);
            ctx.rotate(rot);
            ctx.scale(sc * tumble, sc);
            ctx.translate(-cx, -cy);
            ctx.save();
            ctx.translate(4 * k, 3 * k);
            ctx.beginPath();
            polyPath(cell.poly);
            ctx.fillStyle = '#1c1714';
            ctx.fill();
            ctx.restore();
            ctx.beginPath();
            polyPath(cell.poly);
            ctx.save();
            ctx.clip();
            ctx.drawImage(B.c, X0, Y0, B.bw * k, B.bh * k);
            ctx.fillStyle = `rgba(0,0,0,${0.18 + 0.4 * (1 - tumble)})`;
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = 'rgba(30,20,12,0.55)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        }
        warmGrade();
        // 정이 닿는 자리: 불꽃, 정 자국, 돌가루
        hits.forEach((th, h) => {
            const age = t - th;
            if (age < 0 || age > 0.6) return;
            const grp = B.cells.filter(cell => cell.hit === h);
            if (!grp.length) return;
            const [x, y] = map([grp.reduce((a, cell) => a + cell.cx, 0) / grp.length, grp.reduce((a, cell) => a + cell.cy, 0) / grp.length]);
            glow(x, y - age * 60, 90 + 180 * age, '#d9cfc2', 0.4 * (1 - prog(age, 0, 0.6)), 'screen');
            glow(x, y, 150, '#fff3dc', 0.9 * pulse(t, th, 0.06));
            if (age < 0.12) {
                const a = rnd(h * 3.3, -2.6, -2.0);
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 1 - age / 0.12;
                ctx.strokeStyle = '#fff6e6';
                ctx.shadowColor = '#ffcf8a';
                ctx.shadowBlur = 18;
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(a) * 90, y + Math.sin(a) * 90);
                ctx.stroke();
                ctx.restore();
            }
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 12; i++) {
                const ang = rnd(h * 20 + i, -Math.PI, 0.2), v = rnd(h * 20 + i + 0.5, 250, 700);
                const r = 4 * (1 - prog(age, 0, 0.45));
                ctx.globalAlpha = 1 - prog(age, 0.1, 0.45);
                ctx.drawImage(PRE.dot['#ffb27a'], x + Math.cos(ang) * v * age - r * 2, y + Math.sin(ang) * v * age + 1200 * age * age - r * 2, r * 4, r * 4);
            }
            ctx.restore();
        });
        // 마지막 타격: 남은 돌이 한꺼번에 깨지며 조각이 드러난다
        if (t >= tFinal) {
            const age = t - tFinal;
            const [bx, by] = at(pa, BULL[0], BULL[1]);
            for (let i = 0; i < 7; i++) {
                glow(bx + rnd(i, -300, 300), by + 160 + rnd(i + 3, -60, 60) - age * 50, 200 + 280 * E.outCubic(prog(age, 0, 1.2)), '#b8ab9c', 0.22 * (1 - prog(age, 0.1, 1.3)), 'screen');
            }
            glow(bx, by, 600, C.goldHi, 0.25 * pulse(t, tFinal, 0.35) + 0.06);
            sheenLayer(PRE.stone, pa, prog(t, tFinal + 0.05, tFinal + 0.85), 0.22, 'rgba(255,246,228,1)', 'rgba(255,236,210,0)');
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 50; i++) {
                const x = bx + rnd(i * 2.7, -360, 360) + noise1(t + i, 9) * 20, y = by + rnd(i * 4.1, -120, 260) - age * rnd(i, 20, 90);
                const r = rnd(i * 1.9, 2, 5);
                ctx.globalAlpha = 0.55 * prog(age, 0, 0.2) * (1 - prog(age, 1.2, 2.2));
                ctx.drawImage(PRE.dot['#ffffff'], x - r * 2, y - r * 2, r * 4, r * 4);
            }
            ctx.restore();
        }
        vig();
        patternLabel(t, g(14), g(18), '03', '완성하면 안 되는 작품', C.bronzeHi);
    }

    const EDAA = ['e', 'd', 'a', 'a', 'c', 'b'];
    function g1Dictation(t) {
        const g = beat.gate1, lt = t - g(18);
        ctx.drawImage(PRE.sBlur, 0, 0);
        fill('#c7893f', 0.12, 'soft-light');
        particles(t, 30, 21, C.bronzeHi, { alpha: 0.3, rMax: 6 });
        vig();
        const n = EDAA.length;
        const sx = i => W / 2 + (i - (n - 1) / 2) * 150;
        const ap = E.outExpo(prog(lt, 0, 0.4));
        // 제한 시간 막대
        const tp = 1 - prog(t, g(18.25), g(22));
        ctx.save();
        ctx.globalAlpha = ap;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(W / 2 - 450, 600, 900, 4);
        ctx.fillStyle = tp < 0.3 ? C.bloodHi : C.bronzeHi;
        ctx.fillRect(W / 2 - 450, 600, 900 * tp, 4);
        ctx.restore();
        for (let i = 0; i < n; i++) {
            const tin = g(18.25 + i * 0.25);
            const tok = g(20 + i * 0.25);
            const ok = t >= tok;
            const pp = E.outExpo(prog(t, tin, tin + 0.22));
            const op = pulse(t, tok, 0.14);
            ctx.save();
            ctx.globalAlpha = ap;
            ctx.fillStyle = ok ? C.goldHi : 'rgba(255,255,255,0.35)';
            ctx.fillRect(sx(i) - 55, 548, 110, 3);
            ctx.restore();
            if (pp > 0) {
                ctx.save();
                ctx.translate(sx(i), 520);
                const s = lerp(1.6, 1, pp) + op * 0.25;
                ctx.scale(s, s);
                text(EDAA[i], 0, 0, {
                    f: F.mono, size: 150, w: 700, align: 'center', color: ok ? C.goldHi : '#ffffff', alpha: pp,
                    glow: ok ? rgba(C.goldHi, 0.8) : 'rgba(255,255,255,0.35)', glowBlur: ok ? 36 : 18
                });
                ctx.restore();
            }
        }
        // 입력 키
        const keys = ['a', 'b', 'c', 'd', 'e'];
        keys.forEach((k, j) => {
            const kx = W / 2 + (j - 2) * 150, ky = 690, ks = 116;
            let press = 0;
            EDAA.forEach((ch, i) => {
                if (ch === k) press = Math.max(press, pulse(t, g(20 + i * 0.25), 0.1));
            });
            const kp = E.outBack(prog(lt, 0.15 + j * 0.05, 0.5 + j * 0.05));
            if (kp <= 0) return;
            ctx.save();
            ctx.translate(kx, ky + ks / 2);
            ctx.scale(kp * (1 - press * 0.08), kp * (1 - press * 0.08));
            cutPath(ctx, -ks / 2, -ks / 2, ks, ks, 14);
            const kg = ctx.createLinearGradient(0, -ks / 2, 0, ks / 2);
            kg.addColorStop(0, press > 0.2 ? '#ffe9b8' : '#2b2420');
            kg.addColorStop(1, press > 0.2 ? '#d29a3e' : '#14100d');
            ctx.fillStyle = kg;
            ctx.shadowColor = C.bronzeHi;
            ctx.shadowBlur = press * 40;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = rgba(C.bronzeHi, 0.6);
            ctx.lineWidth = 2;
            ctx.stroke();
            text(k, 0, 22, { f: F.mono, size: 60, w: 700, align: 'center', color: press > 0.2 ? '#2a1a04' : C.text });
            ctx.restore();
        });
        // 성공 칩
        const cp = E.outExpo(prog(t, g(21.5), g(21.5) + 0.3));
        if (cp > 0) {
            ctx.save();
            ctx.globalAlpha = cp;
            ctx.translate(W / 2, 880);
            ctx.scale(lerp(1.3, 1, cp), lerp(1.3, 1, cp));
            text('최종 피해 +10%', 0, 0, { f: F.sans, size: 40, w: 900, align: 'center', color: C.goldHi, glow: rgba(C.goldHi, 0.7), glowBlur: 30 });
            ctx.restore();
        }
        patternLabel(t, g(18), g(22), '04', 'edaa 받아쓰기', C.bronzeHi);
    }

    function g1Harden(t) {
        const g = beat.gate1, lt = t - g(22);
        const rush = E.inExpo(prog(t, g(23), g(24)));
        const z = 1.48 + 0.08 * lt + rush * 2.6;
        const { pa } = stage(IMG.sHall, IMG.sScene, z, BULL[0], 0.5, { par: 0.05 });
        warmGrade();
        // 청동 광택이 몸을 훑는다
        const sp = prog(t, g(22) + 0.05, g(23.2));
        sheenLayer(IMG.sScene, pa, sp, 0.55);
        if (sp > 0 && sp < 1) {
            const [gx, gy] = at(pa, BULL[0] + 0.03, BULL[1] - 0.06);
            star(gx, gy, 34 * Math.sin(Math.PI * sp), '#fff6e0', 0.9, sp * 2);
        }
        fill('#ffffff', rush * 0.9, 'lighter');
        patternLabel(t, g(22), g(23.6), '05', '단단해지기', C.bronzeHi);
    }

    // ---------- 장면: 2관문 위플래쉬 ----------
    const CONE = [0.5, 0.475], LED = [0.4125, 0.311];
    function sGate2(t) {
        const g = beat.gate2;
        if (t < g(4)) g2Card(t);
        else if (t < g(12)) g2Patterns(t);
        else if (t < g(16)) g2Pulse(t);
        else g2Drain(t);
    }
    function thump(t, from, to, amt = 0.014) {
        let k = 0;
        for (let i = from; i < to; i++) k += pulse(t, beat.gate2(i), 0.14) * amt;
        return k;
    }
    function coolGrade() {
        fill('#2f8f88', 0.2, 'soft-light');
        vgrad([[0, 'rgba(0,0,0,0)'], [1, 'rgba(2,6,8,0.75)']], 1, 'source-over', H * 0.55, H);
    }
    function whipStage(t, z, fy, kick) {
        const r = stage(IMG.wHall, IMG.wScene, z, CONE[0], fy, { par: 0.04, kick, pivot: CONE });
        coolGrade();
        const [lx, ly] = at(r.pa, LED[0], LED[1]);
        glow(lx, ly, 90 * z, C.acid, 0.55 + 0.45 * Math.sin(t * 9) ** 2);
        return r;
    }

    function g2Card(t) {
        const g = beat.gate2, lt = t - g(0);
        const z = 1.2 - 0.12 * E.outExpo(prog(lt, 0, 1.5)) - 0.02 * prog(lt, 0, 2.2);
        whipStage(t, z, 0.48, thump(t, 0, 4));
        particles(t, 45, 31, C.teal, { alpha: 0.35, rMax: 7 });
        const gr = ctx.createLinearGradient(W, 0, W * 0.5, 0);
        gr.addColorStop(0, 'rgba(2,5,7,0.75)');
        gr.addColorStop(1, 'rgba(2,5,7,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(W * 0.5, 0, W * 0.5, H);
        chapterCard(t, g(0), {
            t1: g(4), num: '02', tag: 'GATE 02', name: '위플래쉬', size: 150, ls: 2, metal: METAL.steel, accent: C.teal,
            gate: '2관문', hp: 40000000, align: 'right'
        });
    }

    const PARTY = ['P1', 'P2', 'P3', 'P4'];
    function partyHP(t) {
        const g = beat.gate2;
        const hp = [1, 1, 1, 1];
        const dmgEv = [];
        const hit = (tt, idx, amt) => {
            for (const i of idx) {
                if (t >= tt) hp[i] -= amt * E.outCubic(prog(t, tt, tt + 0.2));
            }
            dmgEv.push([tt, idx]);
        };
        hit(g(7), [0, 1, 2, 3], 0.32);
        hit(g(8.5), [0, 2], 0.16);
        hit(g(9.5), [0, 2], 0.2);
        hit(g(10) + 0.15, [0, 1, 2, 3], 0.06);
        return hp.map(v => clamp(v, 0.05, 1));
    }
    function partyFrames(t, alpha, targets, tMark) {
        if (alpha <= 0) return [];
        const hp = partyHP(t);
        const out = [];
        PARTY.forEach((name, i) => {
            const x = 1520, y = 560 + i * 86, w = 330, h = 68;
            const p = E.outExpo(clamp(alpha * 1.4 - i * 0.12));
            const isT = targets.includes(i) && t >= tMark;
            ctx.save();
            ctx.globalAlpha = p;
            ctx.translate((1 - p) * 80, 0);
            cutPath(ctx, x, y, w, h, 10);
            ctx.fillStyle = 'rgba(14,12,18,0.82)';
            ctx.fill();
            ctx.lineWidth = isT ? 2 : 1;
            ctx.strokeStyle = isT ? C.goldHi : 'rgba(255,255,255,0.18)';
            ctx.stroke();
            text(name, x + 18, y + 30, { f: F.mono, size: 18, w: 700, ls: 3, color: C.text2 });
            if (isT) tag(x + w - 16, y + 9, '대상', C.goldHi, { align: 'right', size: 14, ls: 2, f: F.sans });
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(x + 18, y + 44, w - 36, 10);
            const hg = ctx.createLinearGradient(x, 0, x + w, 0);
            hg.addColorStop(0, '#53d18a');
            hg.addColorStop(1, '#a6f0b6');
            ctx.fillStyle = hp[i] < 0.4 ? C.bloodHi : hg;
            ctx.fillRect(x + 18, y + 44, (w - 36) * hp[i], 10);
            ctx.restore();
            out.push([x + 40, y + h / 2]);
        });
        return out;
    }

    function g2Patterns(t) {
        const g = beat.gate2;
        const lt = t - g(4);
        const z = 1.3 + 0.04 * prog(lt, 0, B2 * 8);
        // 울리는 벽: 가로 띠가 흔들린다
        const wallA = t >= g(10) ? 16 * pulse(t, g(10), 0.45) + 4 * (t < g(12) ? 1 : 0) : 0;
        whipStage(t, z, 0.47, thump(t, 4, 12));
        if (wallA > 0.5) {
            // 그린 장면을 가로 띠로 나눠 밀어 옮긴다
            const [c, gg] = buf('_wall', W, H);
            gg.drawImage(cvs, 0, 0);
            const bands = 40, bh = H / bands;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            for (let i = 0; i < bands; i++) {
                const off = Math.sin(i * 0.9 + t * 46) * wallA + noise1(i * 3 + t * 20, 7) * wallA * 0.5;
                ctx.drawImage(c, 0, i * bh, W, bh, off, i * bh, W, bh);
            }
            ctx.restore();
        }
        const pa = cover(IMG.wScene, z * 1.04, CONE[0], 0.47);
        const [cx, cy] = at(pa, CONE[0], CONE[1]);
        // 공명 폭발 — 신호음 고리 3번 후 폭발
        for (const k of [4, 5, 6]) {
            const age = t - g(k);
            if (age < 0 || age > 0.7) continue;
            const rr = 60 + 900 * E.outCubic(age / 0.7);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (1 - age / 0.7) * 0.9;
            ctx.strokeStyle = C.teal;
            ctx.shadowColor = C.teal;
            ctx.shadowBlur = 20;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(cx, cy, rr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            glow(cx, cy, 260, '#e6fffb', 0.6 * pulse(t, g(k), 0.1));
        }
        const te = g(7);
        if (t >= te && t < te + 0.9) {
            const age = t - te;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 4; i++) {
                const a2 = age - i * 0.05;
                if (a2 < 0) continue;
                const rr = 40 + 2300 * E.outCubic(clamp(a2 / 0.6));
                ctx.globalAlpha = (1 - clamp(a2 / 0.6)) * (i === 0 ? 1 : 0.5);
                ctx.lineWidth = 40 - i * 8;
                ctx.strokeStyle = i % 2 ? '#7d5cff' : '#efe9ff';
                ctx.shadowColor = '#7d5cff';
                ctx.shadowBlur = 60;
                ctx.beginPath();
                ctx.arc(cx, cy, rr, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
            glow(cx, cy, 900, '#9c7dff', 0.8 * pulse(t, te, 0.2));
        }
        vig();
        // 파티 프레임
        const fa = prog(t, g(4) + 0.1, g(4) + 0.6) * (1 - prog(t, g(11.7), g(12)));
        const targets = t >= g(8) ? [0, 2] : [];
        const slots = partyFrames(t, fa, targets, g(8));
        // 되울림 — 대상 둘에게 두 번
        for (const k of [8, 9]) {
            const t0 = g(k), t1 = g(k + 0.5);
            for (const i of [0, 2]) {
                const [sx, sy] = slots[i] || [0, 0];
                if (t >= t0 && t < t1) {
                    const p = E.inCubic(prog(t, t0, t1));
                    const x = lerp(cx, sx, p), y = lerp(cy, sy, p);
                    const ang = Math.atan2(sy - cy, sx - cx);
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.strokeStyle = C.goldHi;
                    ctx.shadowColor = C.goldHi;
                    ctx.shadowBlur = 24;
                    for (let a = 0; a < 3; a++) {
                        ctx.globalAlpha = 0.9 - a * 0.25;
                        ctx.lineWidth = 6 - a * 1.5;
                        ctx.beginPath();
                        ctx.arc(x - Math.cos(ang) * a * 26, y - Math.sin(ang) * a * 26, 46 + a * 14, ang - 0.7, ang + 0.7);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                if (t >= t1) glow(sx, sy, 140, C.goldHi, 0.8 * pulse(t, t1, 0.12));
                dmgNum(k === 8 ? '18,200' : '24,960', (slots[i] || [0])[0] - 120, (slots[i] || [0, 0])[1] - 10, t - t1, { crit: k === 9, scale: 0.75 });
            }
        }
        // 폭발 피해
        slots.forEach(([sx, sy], i) => dmgNum(['37,450', '35,980', '74,900', '36,210'][i], sx - 120, sy - 10, t - te - i * 0.03, { crit: i === 2, scale: 0.75, color: '#c9b8ff' }));
        // 벽 압력
        if (t >= g(10) && t < g(12)) {
            const wp = prog(t, g(10), g(12));
            for (const side of [0, 1]) {
                const gr = ctx.createLinearGradient(side ? W : 0, 0, side ? W - 520 : 520, 0);
                gr.addColorStop(0, rgba('#8d74ff', 0.55 * (1 - wp) + 0.15));
                gr.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = gr;
                ctx.fillRect(side ? W - 520 : 0, 0, 520, H);
                ctx.restore();
            }
            slots.forEach(([sx, sy]) => dmgNum('−6%', sx - 120, sy - 10, t - g(10) - 0.15, { scale: 0.7, color: '#c9b8ff' }));
        }
        patternLabel(t, g(4), g(8), '01', '공명 폭발', C.teal, {
            after: (x, y, a) => {
                const cp = prog(t, g(4), te), boom = t >= te;
                const bw = 280, by = y - 40;
                ctx.save();
                ctx.globalAlpha = a;
                cutPath(ctx, x, by, bw, 16, 5);
                ctx.fillStyle = 'rgba(8,10,12,0.85)';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = rgba(boom ? '#c9b8ff' : C.teal, 0.7);
                ctx.stroke();
                ctx.fillStyle = boom ? '#c9b8ff' : C.teal;
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 14 + (boom ? 30 * pulse(t, te, 0.2) : 0);
                ctx.fillRect(x + 3, by + 3, (bw - 6) * cp, 10);
                ctx.restore();
                text((3 - cp * 3).toFixed(1), x + bw + 18, by + 16, { f: F.mono, size: 24, w: 700, color: boom ? '#c9b8ff' : C.teal, alpha: a });
            }
        });
        patternLabel(t, g(8), g(10), '02', '되울림', C.teal);
        patternLabel(t, g(10), g(12), '03', '울리는 벽', C.teal);
    }
    // 맥동 제어: 기운이 모였다 흩어지는 맥동과 대상의 입력 버튼만 보여 준다(정답·결과 비공개)
    function g2Pulse(t) {
        const g = beat.gate2, lt = t - g(12);
        const z = 1.24 + 0.07 * prog(lt, 0, B2 * 4);
        const { pa } = whipStage(t, z, 0.47, thump(t, 12, 16, 0.01));
        fill('#020407', 0.4);
        vig();
        const [cx, cy] = at(pa, CONE[0], CONE[1]);
        const rise = prog(lt, 0, B2 * 4);
        const breathe = tt => 0.5 - 0.5 * Math.cos((Math.PI * (tt - g(12))) / B2);
        const cols = [C.teal, C.violetHi];
        const fadeIn = Math.min(1, prog(t, g(12), g(12) + 0.25) * 4);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 180; i++) {
            const s = i * 2.71;
            const base = rnd(s, 120, 460), ang0 = rnd(s + 1, 0, Math.PI * 2), r = rnd(s + 2, 4, 11);
            const dot = PRE.dot[cols[i % 2]];
            for (let k = 2; k >= 0; k--) {
                const tt = t - k * 0.03;
                const m = lerp(0.12, 1.15, breathe(tt)) * (0.85 + 0.15 * noise1(tt * 3 + i, 4));
                const ang = ang0 + (tt - g(12)) * (i % 2 ? 0.9 : -0.7);
                const x = cx + Math.cos(ang) * base * m, y = cy + Math.sin(ang) * base * m * 0.85;
                const rk = r * (k ? 0.7 : 1);
                ctx.globalAlpha = (k ? 0.22 / k : 0.9) * fadeIn * (0.6 + 0.4 * rise);
                ctx.drawImage(dot, x - rk, y - rk, rk * 2, rk * 2);
            }
        }
        ctx.restore();
        const m = breathe(t);
        glow(cx, cy, 120 + 130 * (1 - m), '#e9fffb', (0.3 + 0.55 * (1 - m)) * (0.6 + 0.4 * rise) * fadeIn);
        for (let k = 12; k < 16; k++) {
            const age = t - g(k);
            if (age < 0 || age > 0.5) continue;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (1 - age / 0.5) * 0.6;
            ctx.strokeStyle = C.teal;
            ctx.shadowColor = C.teal;
            ctx.shadowBlur = 20;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, 80 + 620 * E.outCubic(age / 0.5), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        partyFrames(t, prog(t, g(12) + 0.05, g(12) + 0.5) * (1 - prog(t, g(15.8), g(16))), [1], g(12.5));
        // 대상에게 뜨는 입력 버튼
        const bp = E.outBack(prog(t, g(13), g(13) + 0.35));
        if (bp > 0) {
            const bw = 230, bh = 86, gap = 28, by = 878;
            const tp = 1 - prog(t, g(13), g(16));
            ctx.save();
            ctx.globalAlpha = Math.min(1, bp);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(W / 2 - bw - gap / 2, by - 26, bw * 2 + gap, 4);
            ctx.fillStyle = tp < 0.3 ? C.bloodHi : C.teal;
            ctx.fillRect(W / 2 - bw - gap / 2, by - 26, (bw * 2 + gap) * tp, 4);
            ctx.restore();
            ['흡수', '방출'].forEach((label, i) => {
                const x = W / 2 + (i ? gap / 2 : -gap / 2 - bw);
                ctx.save();
                ctx.translate(x + bw / 2, by + bh / 2);
                ctx.scale(bp, bp);
                cutPath(ctx, -bw / 2, -bh / 2, bw, bh, 14);
                const bg = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
                bg.addColorStop(0, '#1b2a2c');
                bg.addColorStop(1, '#0b1213');
                ctx.fillStyle = bg;
                ctx.shadowColor = C.teal;
                ctx.shadowBlur = 18 + 14 * Math.sin(t * 6) ** 2;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.lineWidth = 2;
                ctx.strokeStyle = rgba(C.teal, 0.8);
                ctx.stroke();
                text(label, 0, 15, { f: F.game, size: 42, w: 400, ls: 8, align: 'center', color: '#e6fffb' });
                ctx.restore();
            });
        }
        patternLabel(t, g(12), g(16), '04', '맥동 제어', C.teal);
    }

    function g2Drain(t) {
        const g = beat.gate2, lt = t - g(16);
        const tEnd = g(19.7);
        const z = 1.12 + 0.05 * prog(lt, 0, B2 * 4);
        const hitTimes = [];
        for (let i = 0; i < 12; i++) hitTimes.push(g(16) + i * B2 * 0.33);
        let kick = 0;
        for (const ht of hitTimes) kick += pulse(t, ht, 0.06) * 0.006;
        const { pa } = whipStage(t, z, 0.5, kick);
        vig();
        const [cx, cy] = at(pa, CONE[0], CONE[1]);
        hitTimes.forEach((ht, i) => {
            const age = t - ht;
            if (age < 0) return;
            // 황금각 나선으로 흩뿌려 숫자끼리 겹치지 않게 한다
            const ang = i * 2.39996 + 0.6, rad = 170 + 34 * i;
            const x = cx + Math.cos(ang) * rad * 1.35, y = cy + 20 + Math.sin(ang) * rad * 0.62;
            glow(x, y, 180, i % 4 === 3 ? '#ffd27a' : '#ffffff', 0.55 * pulse(t, ht, 0.06));
            dmgNum(fmt(rnd(i, 180000, 420000) * (i % 4 === 3 ? 2.25 : 1)), x, y, age, { crit: i % 4 === 3 });
        });
        // 보스 체력
        const r = 1 - E.outCubic(prog(t, g(16), tEnd));
        const lines = 4000 * r;
        const cur = Math.floor(lines), frac = lines - cur;
        const ap = E.outExpo(prog(lt, 0, 0.3));
        const bx = 260, by = 156, bw = 1400, bh = 28;
        const pal = ['#7d5cff', '#3fb6ff', '#40d6a0', '#e6c450', '#ff8a4a'];
        ctx.save();
        ctx.globalAlpha = ap;
        text('위플래쉬', bx, by - 18, { f: F.sans, size: 30, w: 900, color: '#ffffff' });
        tag(bx + 150, by - 50, 'NIGHTMARE', C.violetHi, { size: 13, ls: 3 });
        cutPath(ctx, bx, by, bw, bh, 8);
        ctx.fillStyle = 'rgba(6,6,10,0.85)';
        ctx.fill();
        ctx.save();
        cutPath(ctx, bx, by, bw, bh, 8);
        ctx.clip();
        if (cur > 0) {
            ctx.fillStyle = pal[(cur - 1) % pal.length];
            ctx.globalAlpha = ap * 0.55;
            ctx.fillRect(bx, by, bw, bh);
        }
        ctx.globalAlpha = ap;
        ctx.fillStyle = pal[cur % pal.length];
        ctx.fillRect(bx, by, bw * (r <= 0 ? 0.004 : frac), bh);
        ctx.restore();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        cutPath(ctx, bx, by, bw, bh, 8);
        ctx.stroke();
        ctx.restore();
        const label = r <= 0 ? 'HP 1' : `×${fmt(Math.ceil(lines))}`;
        text(label, bx + bw, by - 14, { f: F.cond, size: 64, w: 800, align: 'right', color: r <= 0 ? C.bloodHi : '#ffffff', alpha: ap, glow: r <= 0 ? rgba(C.bloodHi, 0.8) : null });
    }

    // ---------- 4초 정지 ----------
    function makeCracks() {
        const out = [];
        for (let i = 0; i < 11; i++) {
            const ang = (i / 11) * Math.PI * 2 + rnd(i, -0.2, 0.2);
            const len = rnd(i + 1, 700, 1300);
            const pts = [[0, 0]];
            let x = 0, y = 0, a = ang;
            const steps = 14;
            for (let s = 1; s <= steps; s++) {
                a += rnd(i * 31 + s, -0.35, 0.35);
                x += Math.cos(a) * (len / steps);
                y += Math.sin(a) * (len / steps);
                pts.push([x, y]);
            }
            out.push(pts);
        }
        return out;
    }
    function drawCracks(cx, cy, amount, alpha) {
        if (amount <= 0 || alpha <= 0) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        for (const [i, pts] of PRE.cracks.entries()) {
            const n = Math.floor((pts.length - 1) * clamp(amount * rnd(i + 3, 0.7, 1.15)));
            if (n < 1) continue;
            ctx.beginPath();
            for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](pts[k][0], pts[k][1]);
            ctx.strokeStyle = '#ff3b2f';
            ctx.shadowColor = '#ff2a1c';
            ctx.shadowBlur = 30;
            ctx.globalAlpha = alpha * 0.7;
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.strokeStyle = '#ffe2d8';
            ctx.shadowBlur = 6;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }
    function frozen() {
        if (BUF._frozen) return [BUF._frozen, BUF._frozenGray];
        const tF = S.gate2[1] - 1 / 120;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        VIG = true;
        g2Drain(tF);
        VIG = false;
        ctx.restore();
        const a = mk(W, H);
        a.getContext('2d').drawImage(cvs, 0, 0);
        const b = mk(W, H);
        const bg = b.getContext('2d');
        bg.filter = 'grayscale(0.9) brightness(0.62) contrast(1.15)';
        bg.drawImage(a, 0, 0);
        BUF._frozen = a;
        BUF._frozenGray = b;
        return [a, b];
    }
    function sFreeze(t) {
        const f = beat.freeze, lt = t - f(0);
        const [a, b] = frozen();
        const z = 1 + 0.05 * E.inOutSine(prog(lt, 0, B2 * 5)) + 0.25 * E.inExpo(prog(t, f(4.6), f(6)));
        const pa = cover(IMG.wScene, (1.12 + 0.05) * 1.04, CONE[0], 0.5);
        const [cx, cy] = at(pa, CONE[0], CONE[1]);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(z, z);
        ctx.translate(-cx, -cy);
        ctx.drawImage(a, 0, 0);
        ctx.globalAlpha = E.outCubic(prog(lt, 0, 0.3));
        ctx.drawImage(b, 0, 0);
        ctx.restore();
        // 심장박동 붉은 테두리
        let hb = 0;
        for (const k of [1, 2, 3, 4]) hb += pulse(t, f(k), 0.18);
        ctx.save();
        ctx.globalAlpha = Math.min(1, hb * 0.8);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(PRE.vignette, 0, 0);
        ctx.restore();
        fill('#7a0a10', hb * 0.18, 'lighter');
        // 금
        const crack = [0, 0.18, 0.36, 0.55, 0.78, 1][Math.min(5, Math.floor(lt / B2))] + 0.18 * E.outCubic(prog(lt % B2, 0, 0.2)) * (lt > B2 ? 1 : 0);
        drawCracks(cx, cy, Math.min(1, crack), 0.95);
        // 표식과 카운트
        const tp = E.outExpo(prog(lt, 0.05, 0.4));
        tag(W / 2, H / 2 + 170, '전투 정지', C.bloodHi, { align: 'center', size: 22, ls: 8, f: F.sans, alpha: tp * (1 - prog(t, f(5), f(5.5))), bg: 'rgba(20,2,4,0.8)' });
        for (const k of [1, 2, 3, 4]) {
            const age = t - f(k);
            if (age < 0 || age > B2) continue;
            const pp = E.outExpo(clamp(age / 0.22));
            const a2 = 1 - prog(age, B2 * 0.55, B2);
            ctx.save();
            ctx.translate(W / 2, H / 2 + 110);
            ctx.scale(lerp(1.5, 1, pp), lerp(1.5, 1, pp));
            text(String(5 - k), 0, 0, { f: F.cond, size: 330, w: 800, align: 'center', color: '#ffffff', alpha: a2 * pp, glow: rgba(C.bloodHi, 0.9), glowBlur: 60 });
            ctx.restore();
        }
        // 마지막 박: 붉은 빛이 차오른다
        const sw = E.inCubic(prog(t, f(4.6), f(6)));
        fill('#ff3a2c', sw * 0.55, 'lighter');
        fill('#ffffff', E.inExpo(prog(t, f(5.5), f(6))) * 0.7, 'lighter');
    }

    // ---------- 잔향 ----------
    function makeTris() {
        const cols = 9, rows = 6, pts = [];
        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= cols; i++) {
                const edge = i === 0 || j === 0 || i === cols || j === rows;
                pts.push([(i / cols) * W + (edge ? 0 : rnd(i * 7 + j, -60, 60)), (j / rows) * H + (edge ? 0 : rnd(i * 3 + j * 11, -50, 50))]);
            }
        }
        const tris = [];
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const a = pts[j * (cols + 1) + i], b = pts[j * (cols + 1) + i + 1], c = pts[(j + 1) * (cols + 1) + i], d = pts[(j + 1) * (cols + 1) + i + 1];
                tris.push([a, b, d], [a, d, c]);
            }
        }
        return tris;
    }
    function shatter(t, t0) {
        const age = t - t0;
        if (age < 0 || age > 0.7) return;
        const [, gray] = frozen();
        const cx = W / 2, cy = H / 2;
        PRE.tris.forEach((tri, i) => {
            const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, my = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
            const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1;
            const delay = (d / 1100) * 0.12;
            const a2 = clamp(age - delay);
            const sp = rnd(i, 900, 2200) * E.outCubic(clamp(a2 / 0.7));
            const ox = (dx / d) * sp * 0.6 + 0, oy = (dy / d) * sp * 0.6 + 400 * a2 * a2;
            const rot = rnd(i + 0.5, -2, 2) * a2;
            const sc = 1 + a2 * 0.6;
            ctx.save();
            ctx.globalAlpha = 1 - clamp(a2 / 0.6);
            ctx.translate(mx + ox, my + oy);
            ctx.rotate(rot);
            ctx.scale(sc, sc);
            ctx.translate(-mx, -my);
            ctx.beginPath();
            ctx.moveTo(...tri[0]);
            ctx.lineTo(...tri[1]);
            ctx.lineTo(...tri[2]);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(gray, 0, 0);
            ctx.fillStyle = 'rgba(255,60,40,0.25)';
            ctx.fill();
            ctx.restore();
        });
    }

    function sEcho(t) {
        const e = beat.echo;
        if (t < e(8)) echoReveal(t);
        else if (t < e(16)) echoDifficulty(t);
        else if (t < e(20)) echoSupport(t);
        else echoReward(t);
    }

    function echoReveal(t) {
        const e = beat.echo, lt = t - e(0);
        const z = 1.13 - 0.07 * E.outExpo(prog(lt, 0, 1.6)) + 0.03 * prog(lt, 0, B2 * 8);
        const { pa } = stage(IMG.eHall, IMG.eScene, z, 0.56, 0.42, { par: 0.045 });
        fill('#b3121c', 0.26, 'soft-light');
        vgrad([[0, 'rgba(20,0,4,0)'], [1, 'rgba(12,0,3,0.85)']], 1, 'source-over', H * 0.5, H);
        // 연기와 불씨
        ctx.save();
        ctx.globalAlpha = 0.6;
        for (const [i, [x, y, s]] of [[-120, H - 380, 1.1], [W - 520, H - 420, 1.25], [W * 0.35, H - 260, 0.9]].entries()) {
            ctx.save();
            ctx.translate(x + 300 * s, y + 300 * s);
            ctx.rotate(t * 0.08 * (i % 2 ? 1 : -1));
            ctx.drawImage(IMG.mist, -320 * s, -320 * s, 640 * s, 640 * s);
            ctx.restore();
        }
        ctx.restore();
        particles(t, 80, 51, C.bloodHi, { alpha: 0.75, vMin: 40, vMax: 140, rMin: 3, rMax: 9, sway: 60 });
        // 파열·역전
        const [hx, hy] = at(pa, 0.7, 0.62);
        for (const k of [5]) {
            const age = t - e(k);
            if (age >= 0 && age < 0.7) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 1 - age / 0.7;
                ctx.strokeStyle = '#ff4a3a';
                ctx.shadowColor = '#ff2a1c';
                ctx.shadowBlur = 40;
                ctx.lineWidth = 16 * (1 - age / 0.7) + 2;
                ctx.beginPath();
                ctx.arc(hx, hy, 60 + 1400 * E.outCubic(age / 0.7), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }
        {
            const age = t - e(6);
            if (age >= 0 && age < 0.6) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 40; i++) {
                    const ang = rnd(i * 2.3, 0, Math.PI * 2);
                    const rr = lerp(rnd(i, 300, 700), 0, E.inCubic(age / 0.6));
                    const r = 8;
                    ctx.globalAlpha = 0.9;
                    ctx.drawImage(PRE.dot[C.bloodHi], hx + Math.cos(ang) * rr - r, hy + Math.sin(ang) * rr - r, r * 2, r * 2);
                }
                ctx.restore();
                glow(hx, hy, 300, '#ff5a48', 0.8 * prog(age, 0.3, 0.6));
            }
        }
        shatter(t, e(0));
        // 왼쪽 그늘
        const gr = ctx.createLinearGradient(0, 0, W * 0.45, 0);
        gr.addColorStop(0, 'rgba(8,0,2,0.8)');
        gr.addColorStop(1, 'rgba(8,0,2,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W * 0.45, H);
        vig();
        // 제목
        const X = 112;
        const tp = prog(lt, B2 * 0.9, B2 * 0.9 + 0.5);
        const ta = Math.min(1, prog(lt, 0.4, 0.6) * 3);
        const hw = tag(X, 300, 'HARD', C.bloodHi, { shown: scramble('HARD', prog(lt, 0.4, 0.7), 13, t), alpha: ta });
        tag(X + hw + 12, 300, 'NIGHTMARE', C.violetHi, { shown: scramble('NIGHTMARE', prog(lt, 0.5, 0.9), 17, t), alpha: ta });
        const tb = tbuf('_echo', '잔향', { f: F.serif, size: 250, w: 900, ls: 10, stops: METAL.blood, sheen: prog(lt, 1.6, 2.6), edge: 'rgba(255,200,190,0.2)' });
        drawTB(tb, X, 590, {
            glow: 'rgba(255,40,30,0.55)', glowBlur: 60,
            char: i => {
                const pp = E.outExpo(prog(lt, B2 + i * 0.09, B2 + 0.55 + i * 0.09));
                const gl = pulse(t, e(1) + i * 0.09, 0.08) + pulse(t, e(4), 0.06) + pulse(t, e(6), 0.06);
                return { a: pp, s: lerp(1.25, 1, pp), dx: noise1(t * 60 + i, 5) * gl * 24 };
            }
        });
        text('위플래쉬 잔향', X, 662, { f: F.sans, size: 32, w: 700, ls: 10, color: C.text, alpha: prog(lt, 1.1, 1.5) });
        text('MAX HP', X, 728, { f: F.mono, size: 16, w: 700, ls: 6, color: C.text3, alpha: prog(lt, 1.2, 1.5) });
        text(fmt(7000000 * E.outExpo(prog(lt, 1.25, 2.1))), X, 788, { f: F.cond, size: 60, w: 700, ls: 2, color: C.text, alpha: prog(lt, 1.25, 1.5) });
        // 광폭화
        const bp = E.outExpo(prog(t, e(3), e(3) + 0.4));
        const remain = 60 - Math.max(0, t - e(3));
        text('광폭화', W - 116, 128, { f: F.sans, size: 24, w: 900, ls: 6, align: 'right', color: C.bloodHi, alpha: bp });
        text(remain.toFixed(1), W - 116, 210, { f: F.mono, size: 76, w: 700, align: 'right', color: '#ffffff', alpha: bp, glow: rgba(C.bloodHi, 0.7), glowBlur: 30 });
        ctx.save();
        ctx.globalAlpha = bp;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(W - 116 - 300, 234, 300, 4);
        ctx.fillStyle = C.bloodHi;
        ctx.fillRect(W - 116 - 300 * (remain / 60), 234, 300 * (remain / 60), 4);
        ctx.restore();
        const chips = [[5, '잔향 파열'], [6, '봉인 역전']];
        chips.forEach(([k, label], i) => {
            const cp = E.outExpo(prog(t, e(k), e(k) + 0.3));
            if (cp <= 0) return;
            ctx.save();
            ctx.translate((1 - cp) * 60, 0);
            tag(W - 116, 280 + i * 58, label, i ? '#ffb4a8' : C.bloodHi, { align: 'right', size: 20, ls: 3, alpha: cp, bg: 'rgba(30,4,6,0.7)' });
            ctx.restore();
        });
    }

    const TIERS = [
        { en: 'NORMAL', ko: '노말', color: C.goldHi, hp: 25000000, bosses: ['thumbBull', 'thumbWhip'] },
        { en: 'HARD', ko: '하드', color: C.bloodHi, hp: 44000000, bosses: ['thumbBull', 'thumbWhip', 'thumbEcho'] },
        { en: 'NIGHTMARE', ko: '나이트메어', color: C.violetHi, hp: 74000000, bosses: ['thumbBull', 'thumbWhip', 'thumbEcho'] }
    ];
    function echoDifficulty(t) {
        const e = beat.echo, lt = t - e(8);
        const z = 1.08 + 0.03 * prog(lt, 0, B2 * 8);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(z, z);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(PRE.fBlur, 0, 0);
        ctx.restore();
        fill('#3a2f66', 0.3, 'soft-light');
        fog(t, PRE.fogA, 0.12, { vx: 30, y: H * 0.55, scale: 7 });
        vig();
        sectionHead(t, e(8), 'DIFFICULTY', '난이도');
        const cw = 470, ch = 590, top = 276;
        TIERS.forEach((tier, i) => {
            const ts = e(8 + i);
            const sp = E.outExpo(prog(t, ts, ts + 0.4));
            if (sp <= 0) return;
            const x0 = W / 2 + (i - 1) * 530 - cw / 2;
            const y0 = top + (1 - sp) * 90;
            const hl = e(12 + i);
            const fl = pulse(t, ts, 0.18) + 0.6 * pulse(t, hl, 0.3);
            ctx.save();
            ctx.globalAlpha = sp;
            ctx.translate(x0 + cw / 2, y0 + ch / 2);
            const s = lerp(1.08, 1, sp);
            ctx.scale(s, s);
            ctx.translate(-cw / 2, -ch / 2);
            cutPath(ctx, 0, 0, cw, ch, 18);
            const bg = ctx.createLinearGradient(0, 0, 0, ch);
            bg.addColorStop(0, rgba(tier.color, 0.16 + fl * 0.3));
            bg.addColorStop(0.35, 'rgba(14,11,18,0.92)');
            bg.addColorStop(1, 'rgba(10,8,13,0.95)');
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = rgba(tier.color, 0.65 + fl * 0.35);
            ctx.shadowColor = tier.color;
            ctx.shadowBlur = 16 + fl * 40 + (i === 2 ? 30 * prog(t, hl, hl + 0.5) : 0);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = tier.color;
            ctx.fillRect(18, 0, 120, 4);
            // 박마다 카드 하나씩 빛이 훑는다
            const sw = prog(t, hl - 0.05, hl + 0.5);
            if (sw > 0 && sw < 1) {
                ctx.save();
                cutPath(ctx, 0, 0, cw, ch, 18);
                ctx.clip();
                const sx = lerp(-260, cw + 260, E.inOutCubic(sw));
                const gr = ctx.createLinearGradient(sx - 180, 0, sx + 180, ch * 0.5);
                gr.addColorStop(0, rgba(tier.color, 0));
                gr.addColorStop(0.5, rgba(tier.color, 0.28));
                gr.addColorStop(1, rgba(tier.color, 0));
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = gr;
                ctx.fillRect(0, 0, cw, ch);
                ctx.restore();
            }
            text(tier.en, 40, 96, { f: F.cinzel, size: tier.en.length > 6 ? 40 : 46, w: 700, ls: 8, color: tier.color, glow: rgba(tier.color, 0.5), glowBlur: 20 });
            text(tier.ko, 40, 142, { f: F.sans, size: 26, w: 700, ls: 6, color: C.text2 });
            // 보스 순서
            const n = tier.bosses.length, gap = 128, bx0 = cw / 2 - ((n - 1) * gap) / 2;
            tier.bosses.forEach((key, j) => {
                const bp = E.outBack(prog(t, ts + 0.12 + j * 0.06, ts + 0.45 + j * 0.06));
                const bx = bx0 + j * gap, by = 280;
                if (j > 0) {
                    ctx.save();
                    ctx.globalAlpha = sp * bp;
                    ctx.strokeStyle = rgba(tier.color, 0.8);
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(bx - gap / 2 - 6, by - 9);
                    ctx.lineTo(bx - gap / 2 + 4, by);
                    ctx.lineTo(bx - gap / 2 - 6, by + 9);
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.save();
                ctx.globalAlpha = sp;
                ctx.translate(bx, by);
                ctx.scale(bp, bp);
                ctx.drawImage(PRE[key], -50, -50, 100, 100);
                ctx.beginPath();
                ctx.arc(0, 0, 51, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = rgba(tier.color, 0.8);
                ctx.stroke();
                ctx.restore();
            });
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(40, 392, cw - 80, 1);
            text('TOTAL HP', 40, 452, { f: F.mono, size: 16, w: 700, ls: 6, color: C.text3 });
            text(fmt(tier.hp * E.outExpo(prog(t, ts + 0.1, ts + 0.9))), 40, 528, { f: F.cond, size: 72, w: 800, ls: 1, color: '#ffffff' });
            ctx.restore();
        });
    }

    const SUPPORTS = [
        { key: 'pika', name: '피카츄', fx: ['고정 피해 1,100,000'], color: '#ffe066' },
        { key: 'aurora', name: '오로라', fx: ['HP 30% 회복', '보호막 50,000'], color: '#9cf5dc' },
        { key: 'justice', name: '눈뜬 장님', fx: ['스킬 쿨타임 초기화'], color: '#ffd795' }
    ];
    function echoSupport(t) {
        const e = beat.echo, lt = t - e(16);
        ctx.drawImage(PRE.fBlur, 0, 0);
        fill('#06050a', 0.55);
        // 위에서 내리는 빛
        const rg = ctx.createRadialGradient(W / 2, -200, 0, W / 2, -200, 1300);
        rg.addColorStop(0, 'rgba(216,204,255,0.28)');
        rg.addColorStop(1, 'rgba(216,204,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        vig();
        sectionHead(t, e(16), 'SUPPORT', '지원군');
        const cw = 440, ch = 620, top = 246;
        SUPPORTS.forEach((sp, i) => {
            const ts = e(16 + i);
            const p = E.outExpo(prog(t, ts, ts + 0.35));
            if (p <= 0) return;
            const fl = pulse(t, ts, 0.16) + 0.5 * pulse(t, e(19), 0.2);
            const x0 = W / 2 + (i - 1) * 500 - cw / 2, y0 = top + (1 - p) * 120;
            ctx.save();
            ctx.globalAlpha = p;
            ctx.translate(x0, y0);
            cutPath(ctx, 0, 0, cw, ch, 18);
            ctx.save();
            ctx.clip();
            ctx.fillStyle = '#0d0b11';
            ctx.fillRect(0, 0, cw, ch);
            const img = PRE[sp.key];
            const ih = 420;
            const zz = 1.05 + 0.05 * prog(t, ts, e(20));
            ctx.drawImage(img, (cw - cw * zz) / 2, (ih - cw * zz) / 2, cw * zz, cw * zz);
            const fade = ctx.createLinearGradient(0, ih - 160, 0, ih + 20);
            fade.addColorStop(0, 'rgba(13,11,17,0)');
            fade.addColorStop(1, 'rgba(13,11,17,1)');
            ctx.fillStyle = fade;
            ctx.fillRect(0, ih - 160, cw, ch - ih + 160);
            ctx.fillStyle = '#0d0b11';
            ctx.fillRect(0, ih + 20, cw, ch);
            if (fl > 0.01) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = rgba(sp.color, fl * 0.5);
                ctx.fillRect(0, 0, cw, ch);
            }
            ctx.restore();
            cutPath(ctx, 0, 0, cw, ch, 18);
            ctx.lineWidth = 2;
            ctx.strokeStyle = rgba(sp.color, 0.75);
            ctx.shadowColor = sp.color;
            ctx.shadowBlur = 14 + fl * 30;
            ctx.stroke();
            ctx.shadowBlur = 0;
            text(sp.name, 36, ih + 92, { f: F.sans, size: 54, w: 900, color: '#ffffff' });
            sp.fx.forEach((line, j) => text(line, 36, ih + 146 + j * 38, { f: F.sans, size: 28, w: 700, color: sp.color }));
            ctx.restore();
            if (i === 0 && t >= ts && t < ts + 0.3) bolt(5, x0 + cw * 0.85, y0 - 40, x0 + cw * 0.55, y0 + 260, '#fff2a0', 1 - prog(t, ts + 0.05, ts + 0.3), 2.5);
        });
    }

    const ITEMS = [
        { key: 'fragment', name: '이세계 파편', sub: '재료', color: '#7aa8ff' },
        { key: 'potion', name: '투신의 함성 포션', sub: '소모품', color: '#ff6b5e' },
        { key: 'petJogak', name: '조각', sub: '유니크 펫', color: '#c48bff' },
        { key: 'petWhip', name: '위플래쉬', sub: '레전더리 펫', color: C.goldHi }
    ];
    function echoReward(t) {
        const e = beat.echo, lt = t - e(20);
        fill('#07060a');
        const out = E.inExpo(prog(t, e(27.2), e(28)));
        // 다음 장면으로 밀고 들어간다
        ctx.translate(W / 2, H / 2);
        ctx.scale(1 + out * 0.18, 1 + out * 0.18);
        ctx.translate(-W / 2, -H / 2);
        const move = E.outExpo(prog(t, e(22), e(22) + 0.45));
        const hx = lerp(W / 2, W * 0.29, move), hy = 470;
        // 금빛 광선
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(t * 0.25);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
            ctx.rotate((Math.PI * 2) / 14);
            const gr = ctx.createLinearGradient(0, 0, 900, 0);
            gr.addColorStop(0, 'rgba(240,205,135,0.22)');
            gr.addColorStop(1, 'rgba(240,205,135,0)');
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(900, -50);
            ctx.lineTo(900, 50);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        glow(hx, hy, 420, C.goldHi, 0.35 + 0.4 * pulse(t, e(20), 0.3));
        particles(t, 50, 71, C.goldHi, { alpha: 0.5, rMax: 7, dir: -1 });
        vig();
        // 아티팩트
        const ap = E.outBack(prog(t, e(20), e(20) + 0.45));
        const fl = Math.sin(t * 2.2) * 8;
        ctx.save();
        ctx.translate(hx, hy + fl);
        ctx.scale(ap * (1 - out * 0.3), ap * (1 - out * 0.3));
        ctx.shadowColor = 'rgba(255,220,150,0.8)';
        ctx.shadowBlur = 60;
        ctx.drawImage(IMG.artifact, -250, -250, 500, 500);
        ctx.restore();
        sectionHead(t, e(20), 'REWARD', '보상', { x: 120, align: 'left', color: C.goldHi, metal: METAL.gold, alpha: 1 - out });
        const atb = tbuf('_art', '아티팩트', { f: F.serif, size: 92, w: 900, ls: 8, stops: METAL.gold, sheen: prog(t, e(20.6), e(22)) });
        drawTB(atb, hx, 850, {
            align: 'center', glow: rgba(C.goldHi, 0.45), glowBlur: 30, alpha: 1 - out,
            char: i => {
                const pp = E.outExpo(prog(t, e(20) + 0.1 + i * 0.05, e(20) + 0.5 + i * 0.05));
                return { a: pp, dy: (1 - pp) * 30 };
            }
        });
        // 등급 배지
        const rar = [['RARE', '#6aa8ff'], ['UNIQUE', '#c48bff'], ['LEGENDARY', C.goldHi]];
        font(ctx, F.cinzel, 22, 700, 6);
        const ws = rar.map(([s]) => measureW(ctx, s, 6) + 28);
        let rx = hx - (ws.reduce((a, b) => a + b, 0) + 2 * 16) / 2;
        const ra = (1 - out) * prog(lt, 0.2, 0.5);
        rar.forEach(([s, col], i) => {
            const on = t >= e(20.5 + i * 0.5);
            const pp = pulse(t, e(20.5 + i * 0.5), 0.2);
            if (on) glow(rx + ws[i] / 2, 908, 110, col, 0.5 * pp * ra);
            tag(rx, 888, s, on ? col : '#4a4552', { f: F.cinzel, size: 22, ls: 6, alpha: ra, bg: on ? rgba(col, 0.12) : 'rgba(10,8,14,0.55)' });
            rx += ws[i] + 16;
        });
        // 아이템 격자
        ITEMS.forEach((it, i) => {
            const ts = e(22 + i);
            const p = E.outBack(prog(t, ts, ts + 0.35));
            if (p <= 0) return;
            const cx = W * (i % 2 ? 0.83 : 0.6), cy = i < 2 ? 330 : 690;
            const fl2 = pulse(t, ts, 0.2);
            ctx.save();
            ctx.globalAlpha = Math.min(1, p) * (1 - out);
            ctx.translate(cx, cy);
            ctx.scale(p, p);
            cutPath(ctx, -130, -130, 260, 260, 14);
            const bg = ctx.createRadialGradient(0, -10, 0, 0, -10, 200);
            bg.addColorStop(0, rgba(it.color, 0.28 + fl2 * 0.3));
            bg.addColorStop(1, 'rgba(12,10,16,0.92)');
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = rgba(it.color, 0.7);
            ctx.stroke();
            ctx.drawImage(IMG[it.key], -120, -128, 240, 240);
            ctx.restore();
            const ia = Math.min(1, p) * (1 - out);
            text(it.sub, cx, cy + 168, { f: F.sans, size: 20, w: 700, ls: 4, align: 'center', color: it.color, alpha: ia });
            text(it.name, cx, cy + 206, { f: F.sans, size: 30, w: 900, align: 'center', color: '#ffffff', alpha: ia });
        });
        fill('#050308', out * 0.85);
    }

    // ---------- 칭호와 마지막 타이틀 ----------
    const TITLES = [
        ['t1', '대저택 레이드 클리어'], ['t2', '대저택 레이드 5회 클리어'], ['t3', '나이트메어 최초 클리어'],
        ['t4', '???'], ['t5', '???']
    ];
    function sFinale(t) {
        if (t < FINAL_HIT) finaleTitles(t);
        else finaleCover(t);
    }
    function finaleTitles(t) {
        const f = beat.finale, lt = t - f(0);
        fill('#08060f');
        const rg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 900);
        rg.addColorStop(0, 'rgba(90,60,170,0.35)');
        rg.addColorStop(1, 'rgba(90,60,170,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        fog(t, PRE.fogA, 0.1, { vx: 40, y: H * 0.6, scale: 7, tint: '#b9a3ff' });
        particles(t, 60, 91, C.violetHi, { alpha: 0.55, rMax: 7 });
        vig();
        sectionHead(t, f(0), 'TITLE', '칭호');
        const k = clamp(Math.floor(lt / B2), 0, 4);
        // 이전 칭호는 뒤로 물러난다
        for (let j = Math.max(0, k - 2); j < k; j++) {
            const age = k - j;
            const im = IMG[TITLES[j][0]];
            const mp = E.outExpo(prog(t, f(k), f(k) + 0.3));
            const side = j % 2 ? 1 : -1;
            const x = W / 2 + side * lerp(age - 1, age, mp) * 520;
            const s = lerp(0.62 - (age - 1) * 0.12, 0.62 - age * 0.12, mp) * (age === 1 ? lerp(1 / 0.62, 1, mp) : 1);
            ctx.save();
            ctx.globalAlpha = 0.35 / age;
            ctx.translate(x, 500 - age * 40);
            ctx.scale(s, s);
            ctx.drawImage(im, -512, -226);
            ctx.restore();
        }
        const im = IMG[TITLES[k][0]];
        const sp = E.outExpo(prog(t, f(k), f(k) + 0.3));
        ctx.save();
        ctx.translate(W / 2, 500);
        ctx.scale(lerp(1.3, 1, sp), lerp(1.3, 1, sp));
        ctx.globalAlpha = sp;
        ctx.shadowColor = 'rgba(190,160,255,0.6)';
        ctx.shadowBlur = 50;
        ctx.drawImage(im, -512, -226);
        ctx.restore();
        const cond = TITLES[k][1];
        const hidden = cond === '???';
        text(cond, W / 2, 742, {
            f: hidden ? F.cinzel : F.sans, size: hidden ? 54 : 34, w: hidden ? 900 : 700, ls: hidden ? 18 : 4, align: 'center',
            color: hidden ? C.violetHi : C.text, alpha: sp, glow: hidden ? rgba(C.violetHi, 0.7) : null, glowBlur: 26
        });
        fill('#ffffff', E.inExpo(prog(t, FINAL_HIT - 0.18, FINAL_HIT)) * 0.8, 'lighter');
    }

    function finaleCover(t) {
        const lt = t - FINAL_HIT;
        const z = 1 + 0.1 * (1 - E.outExpo(prog(lt, 0, 4.2)));
        const ph = cover(IMG.cover, z, 0.3, 0.5);
        drawP(IMG.cover, ph);
        // E 주변 번개
        const [ex, ey] = at(ph, 0.115, 0.37);
        const strikes = [0, 0.95, 2.1, 2.55, 3.6, 4.4];
        strikes.forEach((st, i) => {
            const age = lt - st;
            if (age < 0 || age > 0.24) return;
            const a = 1 - age / 0.24;
            const ang = rnd(i + 2, -2.6, -0.4);
            const L = rnd(i + 3, 160, 320) * z;
            bolt(100 + i, ex + rnd(i, -30, 30), ey + rnd(i + 1, -60, 60), ex + Math.cos(ang) * L, ey + Math.sin(ang) * L, '#b49bff', a, 2);
            glow(ex, ey, 300, '#9b87d6', a * 0.6);
        });
        fill('#2a2050', 0.18, 'soft-light');
        fog(t, PRE.fogB, 0.14, { vx: 20, y: H * 0.72, scale: 6 });
        vgrad([[0, 'rgba(5,4,9,0)'], [0.55, 'rgba(5,4,9,0.72)'], [1, 'rgba(5,4,9,0.94)']], 1, 'source-over', H * 0.66, H);
        vig();
        // 정보와 입장
        const ip = E.outExpo(prog(lt, 0.7, 1.4));
        const w1 = tag(116, 852, 'RPGENIUS', C.violetHi, { alpha: ip, shown: scramble('RPGENIUS', prog(lt, 0.7, 1.1), 21, t) });
        tag(116 + w1 + 10, 852, 'NEW RAID', C.violetHi, { alpha: ip, solid: true, shown: scramble('NEW RAID', prog(lt, 0.8, 1.2), 23, t) });
        const specs = [['입장', 'Lv.141 이상'], ['인원', '1–4인 파티'], ['난이도', null]];
        let ix = 116;
        specs.forEach(([label, value], i) => {
            const p = E.outExpo(prog(lt, 0.9 + i * 0.12, 1.5 + i * 0.12));
            const dy = (1 - p) * 18;
            text(label, ix, 936 + dy, { f: F.sans, size: 20, w: 500, ls: 4, color: C.text3, alpha: p });
            let w;
            if (value) w = text(value, ix, 984 + dy, { f: F.sans, size: 34, w: 700, ls: 1, color: C.text, alpha: p });
            else {
                let bx = ix;
                TIERS.forEach(tier => {
                    bx += tag(bx, 951 + dy, tier.ko, tier.color, { f: F.sans, size: 22, ls: 2, alpha: p, bg: rgba(tier.color, 0.1) }) + 10;
                });
                w = bx - ix;
            }
            ix += Math.max(w, 80) + 64;
        });
        const bp = E.outExpo(prog(lt, 1.3, 1.9));
        if (bp > 0) {
            const bw = 400, bh = 100, bx = W - 116 - bw, by = 900 + (1 - bp) * 30;
            ctx.save();
            ctx.globalAlpha = bp;
            cutPath(ctx, bx, by, bw, bh, 16);
            const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
            bg.addColorStop(0, '#3a2a10');
            bg.addColorStop(1, '#171007');
            ctx.fillStyle = bg;
            ctx.shadowColor = C.goldHi;
            ctx.shadowBlur = 30 + 20 * Math.sin(lt * 3) ** 2;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2;
            ctx.strokeStyle = C.goldHi;
            ctx.stroke();
            ctx.save();
            cutPath(ctx, bx, by, bw, bh, 16);
            ctx.clip();
            const sx = bx + (((lt - 1.6) * 0.6) % 1.4) * (bw + 300) - 150;
            const sg = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
            sg.addColorStop(0, 'rgba(255,240,200,0)');
            sg.addColorStop(0.5, 'rgba(255,240,200,0.35)');
            sg.addColorStop(1, 'rgba(255,240,200,0)');
            ctx.fillStyle = sg;
            ctx.fillRect(bx, by, bw, bh);
            ctx.restore();
            ctx.restore();
            const ttb = tbuf('_cta', '지금 입장', { f: F.game, size: 50, w: 400, ls: 10, stops: METAL.gold });
            drawTB(ttb, bx + bw / 2 - 18, by + 68, { align: 'center', alpha: bp });
            ctx.save();
            ctx.globalAlpha = bp;
            ctx.strokeStyle = C.goldHi;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            const ax = bx + bw - 62 + Math.sin(lt * 5) * 4;
            ctx.beginPath();
            ctx.moveTo(ax, by + 36);
            ctx.lineTo(ax + 14, by + 50);
            ctx.lineTo(ax, by + 64);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ---------- 후처리 ----------
    function postFX(t, frame) {
        // 색수차
        let ca = 0;
        for (const [t0, amt, dec] of CA) if (t >= t0 && t < t0 + dec * 5) ca += amt * Math.exp(-(t - t0) / dec);
        if (ca > 0.6) {
            const [src, sg] = buf('_caSrc', W, H);
            sg.drawImage(cvs, 0, 0);
            const ch = (name, col) => {
                const [c, g] = buf(name, W, H);
                g.drawImage(src, 0, 0);
                g.globalCompositeOperation = 'multiply';
                g.fillStyle = col;
                g.fillRect(0, 0, W, H);
                return c;
            };
            const r = ch('_caR', '#ff0000'), gch = ch('_caG', '#00ff00'), b = ch('_caB', '#0000ff');
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(r, -ca, 0);
            ctx.drawImage(gch, 0, 0);
            ctx.drawImage(b, ca, 0);
            ctx.restore();
        }
        // 글리치 띠
        let gl = 0;
        for (const [t0, dur] of GLITCH) if (t >= t0 && t < t0 + dur) gl = Math.max(gl, 1 - (t - t0) / dur);
        if (gl > 0.02) {
            const [src, sg] = buf('_glSrc', W, H);
            sg.drawImage(cvs, 0, 0);
            const fr = Math.floor(t * 30);
            for (let i = 0; i < 9; i++) {
                if (hash(fr * 3.1 + i) > gl * 0.9) continue;
                const y = hash(fr * 7.7 + i) * H, h = 8 + hash(fr * 5.3 + i) * 70;
                const dx = (hash(fr * 2.9 + i) - 0.5) * 160 * gl;
                ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
            }
        }
        if (!VIG) ctx.drawImage(PRE.vignette, 0, 0);
        // 섬광
        for (const [t0, col, peak, dec] of FLASHES) {
            if (t < t0 || t > t0 + dec * 6) continue;
            fill(col, peak * Math.exp(-(t - t0) / dec), 'lighter');
        }
        // 레터박스: 인트로와 4초 정지
        let lb = 0;
        if (t < S.intro[1]) lb = 1;
        else if (t < S.intro[1] + 0.4) lb = 1 - E.outExpo(prog(t, S.intro[1], S.intro[1] + 0.4));
        let lbh = 138;
        if (t >= S.freeze[0] && t < S.echo[0]) {
            lb = E.outExpo(prog(t, S.freeze[0], S.freeze[0] + 0.25));
            lbh = 84;
        }
        if (lb > 0) {
            const bh = lbh * lb;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, bh);
            ctx.fillRect(0, H - bh, W, bh);
        }
        // 필름 그레인
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.07;
        ctx.drawImage(PRE.grain[frame % PRE.grain.length], 0, 0, W, H);
        ctx.restore();
        // 시작과 끝
        const fade = Math.max(1 - prog(t, 0, 0.12), prog(t, 59.35, 59.95));
        if (fade > 0) fill('#000', fade);
    }

    function renderFrame(t, frame = Math.round(t * TL.FPS)) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        VIG = false;
        // 정지 화면 버퍼는 흔들림 없이 먼저 만든다
        if (t >= S.freeze[0] && t < S.echo[0] + 1) frozen();
        const [dx, dy, mag] = shakeAt(t);
        // 컷마다 짧게 밀고 들어오는 확대
        let punch = 0;
        for (const [tc, amt] of CUTS) if (t >= tc && t < tc + 0.4) punch += amt * (1 - E.outCubic(prog(t, tc, tc + 0.4)));
        ctx.save();
        if (mag > 0.2 || punch > 0.0005) {
            const k = 1 + (mag * 2.2) / W + punch;
            ctx.translate(W / 2 + dx, H / 2 + dy);
            ctx.scale(k, k);
            ctx.translate(-W / 2, -H / 2);
        }
        if (t < S.intro[1]) sIntro(t);
        else if (t < S.gate1[1]) sGate1(t);
        else if (t < S.gate2[1]) sGate2(t);
        else if (t < S.freeze[1]) sFreeze(t);
        else if (t < S.echo[1]) sEcho(t);
        else sFinale(t);
        ctx.restore();
        postFX(t, frame);
    }

    buildEvents();
    window.ready = prepare().then(() => true);
    window.renderFrame = renderFrame;
})();
