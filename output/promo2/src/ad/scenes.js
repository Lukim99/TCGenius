// RPGenius pop film ("딱 한 판만…") — 90 s, 1920x1080, 128 BPM. Every scene is a pure function of global time t.
(function () {
    'use strict';
    const { W, H, clamp, lerp, prog, E, kf, rng, noise1, el, css, vis, img } = K;
    const { BEAT, BAR, bt, spring, decay, pulse, xf, actor, echoes, idle, pic, popText, burst, disc, ring, confetti, loot, wipes, clock } = P;
    const A = '../assets/';
    const SZ = window.SIZES;
    const CUES = window.CUES;
    const sfx = (t, k, g = 1, i) => { CUES.sfx.push(i == null ? { t: +t.toFixed(4), k, g } : { t: +t.toFixed(4), k, g, i }); };
    const stage = document.getElementById('scenes');
    const world = document.getElementById('world');
    const fxHost = document.getElementById('fx');
    const hud = document.getElementById('hud');
    const flashEl = document.getElementById('flash');
    const fadeEl = document.getElementById('fade');
    const conf = confetti(fxHost, 320);
    const wp = wipes(document.getElementById('wipes'));
    const INK = '#16112b', PAPER = '#fff4e0', PINK = '#ff3d7f', YELLOW = '#ffd83d', BLUE = '#2f6bff', MINT = '#19e3b1', VIOLET = '#7a3cff', ORANGE = '#ff7a2f', NIGHT = '#1b1446';
    const TRAIL = [PINK, '#27c8ff', YELLOW];

    // ------------------------------------------------------------ registry & global effects
    const scenes = [];
    function scene(name, t0, t1, build) {
        const root = el('div', 'scene', stage);
        root.dataset.name = name;
        const s = { name, t0, t1, root };
        s.update = build(root, s) || (() => {});
        scenes.push(s);
        return s;
    }
    const shakes = [], punches = [], flashes = [];
    const shakeAt = (t, amp = 16, k = 9) => shakes.push({ t, amp, k });
    const punchAt = (t, amt = .035) => punches.push({ t, amt });
    const flashAt = (t, a = .8, d = .12, color = '#ffffff') => flashes.push({ t, a, d, color });

    // ------------------------------------------------------------ building blocks
    const size = (p, h) => { const s = SZ[p]; return s ? [s[0] * h / s[1], h] : [h, h]; };
    function sticker(root, path, h, o = {}) {
        const [w, hh] = size(path, h);
        return actor(root, A + path, Object.assign({ w, h: hh }, o));
    }
    function fill(root, color) { const d = el('div', 'abs', root); css(d, { width: '1920px', height: '1080px', background: color }); return d; }
    function halftone(root, dot, o = {}) {
        const d = el('div', 'halftone', root);
        d.style.setProperty('--dot', dot);
        if (o.size) d.style.backgroundSize = o.size + 'px ' + o.size + 'px';
        if (o.mask) { d.style.webkitMaskImage = o.mask; d.style.maskImage = o.mask; }
        return d;
    }
    function rays(root, sz, color) { const d = el('div', 'rays', root); css(d, { width: sz + 'px', height: sz + 'px' }); d.style.setProperty('--c1', color); return { node: d, set(p) { xf(d, p, sz, sz); } }; }
    function speed(root, color) { const d = el('div', 'speed', root); d.style.setProperty('--c1', color); return d; }
    function bgImg(root, name) { const n = img(A + 'bg/' + name + '.jpg', 'abs', root); css(n, { width: '1920px', height: '1080px', objectFit: 'cover' }); return n; }
    function frame(root, color = INK, w = 16) { const d = el('div', 'abs', root); css(d, { width: '1920px', height: '1080px', border: w + 'px solid ' + color }); return d; }
    function tag(root, html, bg = YELLOW, o = {}) {
        const d = el('div', 'abs', root);
        const inner = el('div', 'tag', d, html);
        css(inner, { background: bg, color: o.color || INK, fontSize: (o.size || 40) + 'px' });
        let wh = null;
        return { node: d, inner, set(p, ax = .5, ay = .5) { if (!wh) wh = [inner.offsetWidth, inner.offsetHeight]; xf(d, p, wh[0], wh[1], ax, ay); } };
    }
    function pill(root, html, o = {}) {
        const d = el('div', 'abs', root);
        const inner = el('div', 'pill', d, html);
        if (o.bg) inner.style.background = o.bg;
        if (o.color) inner.style.color = o.color;
        if (o.size) { inner.style.fontSize = o.size + 'px'; inner.style.height = Math.round(o.size * 2.05) + 'px'; inner.style.borderRadius = Math.round(o.size) + 'px'; }
        let wh = null;
        return { node: d, inner, set(p, ax = .5, ay = .5) { if (!wh) wh = [inner.offsetWidth, inner.offsetHeight]; xf(d, p, wh[0], wh[1], ax, ay); } };
    }
    // pop-in scale helper: 0 -> 1 with a big overshoot, optional pop-out
    const popS = (t, t0, dur = .3, tOut, outDur = .2) => {
        let s = t < t0 ? 0 : E.outBackBig(prog(t, t0, t0 + dur));
        if (tOut != null && t > tOut) s *= 1 - E.inBack(prog(t, tOut, tOut + outDur));
        return Math.max(0, s);
    };
    // damage numbers: build every popup up front, draw by time
    function numbers(root, list) {
        const nodes = list.map(n => {
            const pt = popText(root, n.text, { size: n.size || 76, color: n.color || '#ffffff', stroke: Math.round((n.size || 76) * .12) });
            return Object.assign({ pt }, n);
        });
        return {
            draw(t) {
                nodes.forEach(n => {
                    const dt = t - n.t;
                    if (dt < 0 || dt > (n.life || .9)) { vis(n.pt.box, 0); return; }
                    const s = E.outBackBig(prog(dt, 0, .18)) * (n.big ? 1.2 : 1);
                    const y = n.y - 120 * E.outCubic(prog(dt, 0, n.life || .9)) - (n.big ? 20 : 0);
                    n.pt.place({ x: n.x, y, s, r: n.r || 0, a: 1 - prog(dt, (n.life || .9) - .2, n.life || .9) });
                    n.pt.update(t, n.t, { mode: 'type', stagger: 0 });
                });
            }
        };
    }
    // monster reaction to a list of hit times: flash + knockback + squash
    function react(t, hits, k = 1) {
        let flash = 0, kx = 0, sq = 0;
        for (const h of hits) {
            if (t < h) continue;
            const dt = t - h;
            flash = Math.max(flash, dt < .05 ? 1 : Math.exp(-(dt - .05) * 22));
            kx += 46 * k * Math.exp(-dt * 9) * (dt < .04 ? dt / .04 : 1);
            sq += spring(t, h, 30, 11) * .12;
        }
        return { flash, kx, sq };
    }
    function onoma(root, text, o) {
        const pt = popText(root, text, { size: o.size || 170, color: o.color || YELLOW, shadowCss: o.shadowCss });
        return {
            pt, update(t) {
                if (t < o.t - .02 || t > o.t + (o.life || .8)) { vis(pt.box, 0); return; }
                const j = t < o.t + .25 ? noise1(t * 6, o.seed || 3) * 6 : 0;
                pt.place({ x: o.x + j, y: o.y, r: o.r || 0, s: 1 + .06 * decay(t, o.t + .2, 4), a: 1 - prog(t, o.t + (o.life || .8) - .15, o.t + (o.life || .8)) });
                pt.update(t, o.t, { mode: 'slam', stagger: .025, dur: .22 });
            }
        };
    }

    // ================================================================== A. night intro (0 – 7.5)
    scene('night', 0, 7.52, root => {
        fill(root, NIGHT);
        halftone(root, 'rgba(255,255,255,.07)', { size: 30 });
        const stars = Array.from({ length: 26 }, (_, i) => { const d = el('div', 'abs bhs', root, '★'); const R = rng(40 + i); css(d, { fontSize: (18 + R() * 30) + 'px', color: i % 3 ? PAPER : YELLOW, '--stroke': '0px', left: (R() * 1900) + 'px', top: (R() * 1040) + 'px' }); d.style.setProperty('--stroke', '0px'); return { d, ph: R() * 6 }; });
        const moon = disc(root, 230, YELLOW); moon.node.style.border = '12px solid ' + INK;
        const moonCut = disc(root, 200, NIGHT);
        const clk = clock(root, 430);
        const timeTag = tag(root, 'PM 11:58', YELLOW, { size: 44 });
        const l1 = popText(root, '오늘도', { size: 100, color: PAPER });
        const l2 = popText(root, '딱 한 판만', { size: 210, color: YELLOW, shadowCss: '10px 12px 0 #ff3d7f, 18px 21px 0 #16112b' });
        const l3 = popText(root, '하고 자야지.', { size: 118, color: PAPER });
        const really = tag(root, '(진짜로)', PINK, { size: 42, color: PAPER });
        // browser window
        const win = el('div', 'win', root); css(win, { width: '1180px', height: '700px' });
        const bar = el('div', 'bar', win); for (let i = 0; i < 3; i++) el('div', 'dot', bar);
        const url = el('div', 'url', bar, '');
        const winLogo = popText(win, 'RPGenius', { size: 150, color: PINK, shadowCss: '8px 9px 0 #16112b' });
        const btn = el('div', 'btn', win, '▶ 게임 시작'); css(btn, { left: '360px', top: '430px', width: '460px', height: '130px', fontSize: '62px' });
        const cursor = el('div', 'abs', root, '<svg width="110" height="130" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15 Z" fill="#fff" stroke="#16112b" stroke-width="2.2" stroke-linejoin="round"/></svg>');
        const URL = 'rpgenius.kro.kr';
        const LOCK = '<svg width="26" height="30" viewBox="0 0 24 28" style="margin-right:12px"><rect x="3" y="12" width="18" height="14" rx="3" fill="#ff3d7f" stroke="#16112b" stroke-width="3"/><path d="M7 12V8a5 5 0 0 1 10 0v4" fill="none" stroke="#16112b" stroke-width="3"/></svg>';
        for (let i = 0; i < 8; i++) sfx(bt(0, 1 + i * 2) , 'tick', .7);
        sfx(bt(0, 2), 'pop'); sfx(bt(1), 'hit', .8); shakeAt(bt(1), 10);
        for (let i = 0; i < 6; i++) sfx(bt(1, 3) + i * .07, 'type', .5);
        sfx(bt(2, 1), 'pop', .8); sfx(bt(2, 2), 'whoosh', .8); sfx(bt(2, 2.4), 'pop');
        for (let i = 0; i < URL.length; i++) sfx(5.16 + i * .05, 'type', .45);
        sfx(7.03, 'click', 1); sfx(7.1, 'riser_short', .9);
        return t => {
            stars.forEach((s, i) => { s.d.style.opacity = (.35 + .65 * Math.pow(Math.sin(t * 2.2 + s.ph) * .5 + .5, 2)).toFixed(3); });
            moon.set({ x: 1700, y: 170, s: popS(t, .2, .5) }); moonCut.set({ x: 1760, y: 130, s: popS(t, .2, .5) });
            // clock: pops in, ticks per beat, then exits left at 4.69
            const cOut = E.inBack(prog(t, 4.6, 5.0));
            const tick = Math.floor(t / BEAT);
            clk.set({ x: 560 - cOut * 1100, y: 560 + Math.sin(t * 2) * 6, s: popS(t, .1, .45), r: -4 + spring(t, tick * BEAT, 20, 8) * 3 }, 23 * 3600 + 58 * 60 + tick);
            timeTag.set({ x: 560 - cOut * 1100, y: 850, s: popS(t, .5, .3), r: -3 });
            // lines
            const outT = 4.55;
            l1.place({ x: 1060, y: 330 }, 0, .5); l1.update(t, bt(0, 2), { mode: 'pop', out: [outT, .25, .02], outMode: 'fly' });
            l2.place({ x: 1040, y: 480, r: -3 }, 0, .5); l2.update(t, bt(1), { mode: 'slam', stagger: .045, dur: .3, out: [outT + .05, .25, .02], outMode: 'fly' });
            l3.place({ x: 1060, y: 660 }, 0, .5); l3.update(t, bt(1, 3), { mode: 'type', stagger: .07, out: [outT + .1, .25, .02], outMode: 'fly' });
            really.set({ x: 1560, y: 790, r: -9, s: popS(t, bt(2, 1), .25, outT + .1) });
            // window
            const wIn = popS(t, bt(2, 2), .38);
            const push = E.inExpo(prog(t, 7.1, 7.52));
            const ws = wIn * (1 + push * 7);
            // zoom toward the button centre (window-local 590, 495)
            xf(win, { x: 960, y: 705, s: ws, r: (1 - E.outCubic(prog(t, bt(2, 2), bt(2, 2) + .4))) * -6 * (1 - push) }, 1180, 700, .5, 495 / 700);
            vis(win, t > bt(2, 2) ? 1 : 0);
            const n = t < 5.16 ? 0 : Math.min(URL.length, Math.floor((t - 5.16) / .05) + 1);
            url.innerHTML = LOCK + URL.slice(0, n) + (t < 6.2 && Math.floor(t * 4) % 2 ? '|' : '');
            winLogo.place({ x: 590, y: 250, s: popS(t, 5.4, .35) }); winLogo.update(t, 5.4, { mode: 'pop', stagger: .03 });
            const press = t >= 7.03 ? spring(t, 7.03, 26, 10) : 0;
            btn.style.transform = 'scale(' + (1 - .12 * Math.max(0, press) + .03 * Math.sin(t * 6)).toFixed(3) + ',' + (1 - .18 * Math.max(0, press)).toFixed(3) + ')';
            // cursor: glide in, click
            const cp = E.inOutCubic(prog(t, 6.1, 6.85));
            const cx = lerp(1900, 990, cp), cy = lerp(1100, 722, cp);
            const cs = 1 - .15 * pulse(t, 6.98, .14);
            xf(cursor, { x: cx, y: cy, s: cs * (1 - push), a: t > 6.05 && t < 7.4 ? 1 : 0 }, 110, 130, .1, .08);
        };
    });
    wp.add(7.5, 'circle', { x: 960, y: 705, color: YELLOW, dur: .3 });

    // ================================================================== B. the world opens (7.5 – 15)
    scene('world', 7.48, 15.02, root => {
        const bgw = bgImg(root, 'pirate');
        const hero = sticker(root, 'hero/star_st.png', 640, { ghosts: 4 });
        const mons = [['mon/a7_10_st.png', 1330, 905, 330, bt(4, 1)], ['mon/a7_00_st.png', 1590, 940, 290, bt(4, 2)], ['mon/a2_10_st.png', 1110, 975, 280, bt(4, 3)], ['mon/a7_11_st.png', 1735, 890, 330, bt(5, 2)]]
            .map(([p, x, y, h, t0], i) => ({ a: sticker(root, p, h), x, y, t0, i }));
        const dust = ring(root, 300, '#fff', 18), dust2 = ring(root, 300, INK, 10);
        const thud = onoma(root, '쿵!', { t: bt(5, 1), x: 560, y: 330, r: -10, size: 210 });
        // ribbons
        const rib1 = el('div', 'abs', root); css(rib1, { width: '1180px', height: '130px', background: PINK, border: '10px solid ' + INK, boxShadow: '12px 14px 0 ' + INK });
        const r1t = popText(rib1, '브라우저를 열면,', { size: 84, color: PAPER });
        const rib2 = el('div', 'abs', root); css(rib2, { width: '1100px', height: '150px', background: YELLOW, border: '10px solid ' + INK, boxShadow: '12px 14px 0 ' + INK });
        const r2t = popText(rib2, '모험이 바로 시작!', { size: 100, color: INK, shadow: false, stroke: 0 });
        // build: charging aura
        const flashBg = fill(root, ORANGE);
        const spd = speed(root, 'rgba(255,255,255,.55)');
        const fxs = ['fire', 'water', 'light', 'dark'].map(n => pic(root, A + 'fx/' + n + '.png', 900, 900));
        const aura = [ring(root, 400, YELLOW, 22), ring(root, 400, PINK, 22), ring(root, 400, '#27c8ff', 22)];
        const heroC = sticker(root, 'hero/star_st.png', 760, { ghosts: 0 });
        frame(root, INK, 16);
        mons.forEach(m => sfx(m.t0, 'pop', .9));
        sfx(bt(5), 'whoosh', 1); sfx(bt(5, 1), 'thud', 1.2); shakeAt(bt(5, 1), 24); flashAt(bt(5, 1), .35, .08);
        sfx(bt(5, 3.2), 'whoosh', .7); sfx(bt(6, .8), 'whoosh', .7);
        const land = bt(5, 1), fallT = bt(5);
        const heroPath = tt => {
            if (tt < fallT) return { x: 560, y: -700, sx: .9, sy: 1.15 };
            if (tt < land) { const p = prog(tt, fallT, land); return { x: 560, y: lerp(-700, 1000, E.inQuad(p)), sx: .88, sy: 1.18, r: 0 }; }
            const sp = spring(tt, land, 20, 7), id = idle(tt, 1);
            return { x: 560, y: 1000 + id.dy, sx: (1 + .18 * sp) * id.sx, sy: (1 - .24 * sp) * id.sy, r: id.r };
        };
        const cyc = [ORANGE, '#2fd0ff', YELLOW, VIOLET];
        return t => {
            const zoomIn = E.inExpo(prog(t, 13.1, 15.0));
            xf(bgw, { x: 960 + Math.sin(t * .4) * 12, y: 540, s: lerp(1.16, 1.02, E.outCubic(prog(t, 7.5, 9.4))) }, 1920, 1080);
            mons.forEach(m => {
                const id = idle(t, m.i * 1.7, .8);
                m.a.set({ x: m.x, y: m.y + id.dy, s: popS(t, m.t0, .32), sx: id.sx, sy: id.sy, r: id.r }, { shadow: { dx: 10, dy: 10 } });
            });
            const hp = heroPath(t);
            hero.set(hp, { shadow: { dx: 14, dy: 12 }, ghosts: t > fallT && t < land + .15 ? echoes(heroPath, t, 4, .035, TRAIL, .8) : [] });
            vis(hero.wrap, t > fallT - .05 && t < 13.12 ? 1 : 0);
            // dust rings on landing
            const dp = prog(t, land, land + .5);
            [dust, dust2].forEach((d, i) => { d.set({ x: 560, y: 990, sx: lerp(.3, 2.8 + i * .3, E.outCubic(dp)), sy: lerp(.1, .5, E.outCubic(dp)), a: dp > 0 && dp < 1 ? 1 - dp : 0 }); });
            thud.update(t);
            // ribbons slide in / out
            const r1 = E.outBackBig(prog(t, bt(6, .5), bt(6, .5) + .35)) - E.inBack(prog(t, bt(6, 3), bt(6, 3) + .3)) * 1.3;
            xf(rib1, { x: lerp(-700, 1120, r1), y: 140, r: -4 }, 1180, 130);
            r1t.place({ x: 590, y: 65 }); r1t.update(t, bt(6, .6), { mode: 'type', stagger: .045 });
            const r2 = E.outBackBig(prog(t, bt(6, 2), bt(6, 2) + .35)) - E.inBack(prog(t, bt(6, 3.2), bt(6, 3.2) + .3)) * 1.3;
            xf(rib2, { x: lerp(2700, 1180, r2), y: 290, r: 3 }, 1100, 150);
            r2t.place({ x: 550, y: 75 }); r2t.update(t, bt(6, 2.1), { mode: 'pop', stagger: .03 });
            // build (13.125 → 15): element flashes on 8ths then 16ths around a charging heroine
            const on = t >= 13.125;
            [flashBg, spd, heroC.wrap].forEach(n => vis(n, on ? 1 : 0));
            if (on) {
                const step = t < 14.06 ? BEAT / 2 : BEAT / 4;
                const k = t < 14.06 ? Math.floor((t - 13.125) / step) : 2 + Math.floor((t - 14.06) / step) + 2;
                flashBg.style.background = cyc[k % 4];
                fxs.forEach((f, i) => f.set({ x: 960, y: 520, s: i === k % 4 ? 1.1 + .25 * (1 - prog(t % step, 0, step)) : 0, r: t * 90 + i * 40, a: i === k % 4 ? 1 : 0 }));
                spd.style.transform = 'rotate(' + (t * 40).toFixed(1) + 'deg)';
                aura.forEach((r, i) => { const q = ((t - 13.125) / (BEAT / 2) + i / 3) % 1; r.set({ x: 960, y: 560, s: lerp(3.4, .2, q), a: on ? q : 0 }); });
                const id = idle(t, 2, 1.5);
                heroC.set({ x: 960 + noise1(t * 4, 5) * 6 * zoomIn, y: 1040 + id.dy, s: 1 + zoomIn * .5, sx: id.sx, sy: id.sy }, { shadow: { dx: 16, dy: 14, color: INK } });
            } else { fxs.forEach(f => vis(f.node, 0)); aura.forEach(r => vis(r.node, 0)); }
        };
    });
    flashAt(15.0, 1, .16);

    // ================================================================== C1. logo drop (15 – 16.9)
    scene('logo', 15.0, 16.9, root => {
        fill(root, YELLOW);
        const ry = rays(root, 2600, 'rgba(255,255,255,.55)');
        halftone(root, 'rgba(255,61,127,.28)', { size: 28, mask: 'radial-gradient(60% 60% at 50% 50%, transparent 30%, #000 80%)' });
        const bst = burst(root, 1100, PINK, { n: 16, inner: .78 });
        const logo = popText(root, 'RPGenius', { size: 300, color: PAPER, stroke: 26, shadowCss: '12px 12px 0 #ff3d7f, 24px 24px 0 #2f6bff, 36px 36px 0 #16112b' });
        const tagl = pill(root, '브라우저로 즐기는 카드 RPG', { size: 46 });
        conf.burst({ t: 15.0, x: 960, y: 520, n: 170, speed: 2600, life: 2.6 });
        sfx(15.0, 'boom', 1.2); sfx(15.0, 'crash', 1); shakeAt(15.0, 28, 7); punchAt(15.0, .06);
        return t => {
            ry.set({ x: 960, y: 540, r: t * 30 });
            bst.set({ x: 960, y: 500, s: popS(t, 15.0, .35) * (1 + .04 * Math.sin(t * 9)), r: t * 20 });
            logo.place({ x: 960, y: 470, r: -4, s: 1 - .12 * E.inBack(prog(t, 16.55, 16.9)) });
            logo.update(t, 15.0, { mode: 'slam', stagger: .03, dur: .28, out: [16.55, .25, .015] });
            tagl.set({ x: 960, y: 760, s: popS(t, 15.45, .3, 16.55), r: 2 });
        };
    });
    wp.add(16.875, 'bars', { dur: .24 });

    // ================================================================== HUD: chapter tabs + the night passing on a mini clock
    const chapters = [[16.95, '01', '나만의 캐릭터'], [22.55, '02', '스킬 & 전투'], [37.55, '03', '성장'], [52.55, '04', '보스 & 필드'], [67.55, '05', '함께 & 이벤트']];
    const tabs = chapters.map(([t0, num, title]) => {
        const d = el('div', 'abs', hud);
        d.innerHTML = '<div style="display:flex;align-items:center;height:92px;border:8px solid #16112b;border-radius:0 46px 46px 0;background:#16112b;box-shadow:8px 9px 0 rgba(22,17,43,.35)">' +
            '<span class="bhs" style="font-size:64px;color:#ffd83d;padding:0 16px 0 34px;--stroke:0px">' + num + '</span>' +
            '<span style="font-weight:900;font-size:38px;color:#fff4e0;padding:0 34px 0 8px;white-space:nowrap">' + title + '</span></div>';
        return { d, t0 };
    });
    const mini = clock(hud, 118);
    const miniTag = el('div', 'abs tag', hud); css(miniTag, { fontSize: '26px', padding: '6px 14px 8px', boxShadow: '5px 6px 0 #16112b' });
    function drawHud(t) {
        tabs.forEach(({ d, t0 }) => {
            const p = E.outBackBig(prog(t, t0, t0 + .4)) - E.inBack(prog(t, t0 + 2.6, t0 + 2.9));
            d.style.transform = 'translate(' + lerp(-640, -8, clamp(p, -.2, 1.2)).toFixed(1) + 'px, 36px)';
            vis(d, t > t0 - .01 && t < t0 + 3 ? 1 : 0);
        });
        // 00:05 at 16.9 s  ->  06:40 at 74.5 s
        const on = t > 16.9 && t < 74.6;
        const clockSecs = lerp(5 * 60, 6 * 3600 + 40 * 60, prog(t, 16.9, 74.5));
        const s = E.outBackBig(prog(t, 16.9, 17.3)) * (1 - E.inBack(prog(t, 74.2, 74.6)));
        mini.set({ x: 1800, y: 104, s, r: spring(t, Math.floor(t / BEAT) * BEAT, 20, 9) * 2 }, clockSecs);
        vis(mini.box, on ? 1 : 0);
        const hh = Math.floor(clockSecs / 3600), mm = Math.floor(clockSecs % 3600 / 60);
        miniTag.textContent = 'AM ' + (hh === 0 ? 12 : hh) + ':' + String(mm).padStart(2, '0');
        xf(miniTag, { x: 1800, y: 205, s, r: -3 }, 150, 50);
        vis(miniTag, on ? 1 : 0);
    }

    // ================================================================== C2. character: outfits + card fan (16.875 – 20.63)
    scene('chara', 16.85, 20.66, root => {
        const bg = fill(root, PINK);
        halftone(root, 'rgba(22,17,43,.13)', { size: 26 });
        const mq = el('div', 'marquee', root, '오버라이드 ★ '.repeat(8)); css(mq, { top: '30px', fontSize: '230px' }); mq.style.setProperty('--c1', 'rgba(255,255,255,.4)');
        const mq2 = el('div', 'marquee', root, 'OVERRIDE ★ '.repeat(10)); css(mq2, { top: '800px', fontSize: '210px' }); mq2.style.setProperty('--c1', 'rgba(22,17,43,.18)');
        const T0 = [16.875, 17.8125, 18.75];
        const outfits = ['base', 'job', 'star'].map(k => sticker(root, 'hero/' + k + '_st.png', 900));
        const sparks = Array.from({ length: 9 }, (_, i) => { const d = el('div', 'abs bhs', root, '★'); css(d, { fontSize: (54 + (i % 3) * 22) + 'px', color: [YELLOW, PAPER, MINT][i % 3] }); d.style.setProperty('--stroke', '8px'); return d; });
        const name = popText(root, '오버라이드', { size: 150, color: PAPER });
        const labels = [['기본', YELLOW, INK], ['전직!', MINT, INK], ['1억뷰 ★', YELLOW, INK]].map(([s, c, fc]) => tag(root, s, c, { size: 70, color: fc }));
        const cardKeys = ['c_nor5', 'c_nor6', 'c_nor7', 'c_job8', 'c_jobO'];
        const cards = cardKeys.map(k => { const d = el('div', 'card', root); css(d, { width: '340px', height: '439px', borderRadius: '16px' }); img(A + 'cards/' + k + '.png', '', d); return d; });
        const words = [['모으고', PINK, PAPER], ['전직하고', BLUE, PAPER], ['각성하라!', YELLOW, INK]].map(([s, c, fc]) => tag(root, s, c, { size: 74, color: fc }));
        T0.forEach((t0, i) => { sfx(t0, i ? 'swish' : 'pop', 1); if (i) sfx(t0 + .05, 'sparkle', .6); });
        sfx(16.95, 'whoosh', .6);
        cards.forEach((_, i) => sfx(19.0 + i * .117, 'card', .8));
        [19.22, 19.69, 20.16].forEach(t0 => sfx(t0, 'pop', 1));
        return t => {
            const k = t < T0[1] ? 0 : t < T0[2] ? 1 : 2;
            bg.style.background = [PINK, BLUE, VIOLET][k];
            mq.style.transform = 'translateX(' + (-(t * 240) % 1500).toFixed(1) + 'px)';
            mq2.style.transform = 'translateX(' + (-1500 + (t * 200) % 1500).toFixed(1) + 'px)';
            const heroX = lerp(600, 420, E.inOutCubic(prog(t, 18.9, 19.3)));
            outfits.forEach((o, i) => {
                const ts = T0[i], te = i < 2 ? T0[i + 1] : 99;
                const on = t >= ts - .01 && t < te + .08;
                vis(o.wrap, on ? 1 : 0);
                if (!on) return;
                const inP = i === 0 ? E.outBackBig(prog(t, ts, ts + .38)) : E.outBackBig(prog(t, ts, ts + .2));
                const outP = t >= te ? prog(t, te, te + .08) : 0;
                const id = idle(t, i, 1.2);
                o.set({ x: heroX, y: 1070 + id.dy + (i === 0 ? (1 - clamp(inP)) * 600 : 0), sx: (i === 0 ? 1 : inP) * (1 - outP) * id.sx, sy: id.sy * (i === 0 ? 1 : lerp(1.08, 1, clamp(inP))), r: id.r }, { shadow: { dx: 20, dy: 16 } });
            });
            // sparkles burst on each swap
            sparks.forEach((d, i) => {
                const ts = T0[Math.floor(i / 3)], dt = t - ts;
                const ang = (i * 137) % 360 * Math.PI / 180, dist = 260 + (i % 3) * 90;
                const p = E.outCubic(prog(dt, 0, .5));
                xf(d, { x: heroX + Math.cos(ang) * dist * p, y: 560 + Math.sin(ang) * dist * .8 * p, s: dt > 0 && dt < .6 ? 1 - prog(dt, .3, .6) : 0, r: dt * 200 }, 60, 60);
            });
            name.place({ x: 1360, y: 340, r: -3 }); name.update(t, 17.0, { mode: 'pop', out: [18.7, .2, .015] });
            labels.forEach((l, i) => l.set({ x: 1360, y: 540, r: [-6, 5, -4][i], s: popS(t, T0[i] + .08, .25, i < 2 ? T0[i + 1] - .02 : 18.95, .08) }));
            // card fan
            cards.forEach((c, i) => {
                const t0 = 19.0 + i * .117, p = E.outBackBig(prog(t, t0, t0 + .35));
                const ang = (i - 2) * 13;
                xf(c, { x: 1270 + (i - 2) * 30 * p, y: lerp(1800, 1080, clamp(p)) + Math.sin(t * 3 + i) * 5, r: ang * clamp(p), a: t > t0 ? 1 : 0, s: .98 + .02 * Math.sin(t * 5 + i) }, 340, 439, .5, 1.75);
            });
            words.forEach((w, i) => w.set({ x: 980 + i * 310, y: 900 + (i % 2) * 60, r: [-7, 5, -4][i], s: popS(t, [19.22, 19.69, 20.16][i], .25) }));
        };
    });

    // ================================================================== C3. awaken (20.625 – 22.5)
    scene('awaken', 20.6, 22.53, root => {
        const bgk = bgImg(root, 'cover_awaken');
        halftone(root, 'rgba(255,216,61,.22)', { size: 22, mask: 'radial-gradient(75% 75% at 50% 50%, transparent 45%, #000 100%)' });
        const fxp = pic(root, A + 'fx/phoenix.png', 1100, 1100, 'fxi');
        const word = popText(root, '각성!', { size: 300, color: YELLOW, shadowCss: '14px 14px 0 #ff3d7f, 28px 28px 0 #16112b' });
        const sub = pill(root, '각성 · 프레스티지 · 스킨', { size: 44 });
        frame(root, INK, 16);
        sfx(20.625, 'boom', 1); sfx(20.64, 'fire', .9); flashAt(20.625, .9, .1, '#ffe0a0'); shakeAt(20.625, 22); punchAt(20.625, .05);
        return t => {
            xf(bgk, { x: 960, y: 540, s: lerp(1.35, 1.08, E.outExpo(prog(t, 20.625, 21.4))) + .03 * prog(t, 21.4, 22.5) }, 1920, 1080);
            fxp.set({ x: 1380, y: 560, s: lerp(.3, 1.45, E.outExpo(prog(t, 20.625, 21.3))), r: -20 + t * 14, a: 1 - prog(t, 21.8, 22.4) });
            word.place({ x: 480, y: 470, r: -6 }); word.update(t, 20.66, { mode: 'slam', stagger: .07, dur: .3, out: [22.2, .2] });
            sub.set({ x: 480, y: 720, r: -2, s: popS(t, 21.1, .3, 22.2) });
        };
    });
    wp.add(22.5, 'slash', { dur: .26 });

    // ================================================================== D1. skill showcase (22.5 – 26.25)
    const SK = [
        { t: 22.5, bg: ORANGE, fx: 'phoenix', name: '불사조', ono: '화르륵!', pose: 'job', oc: YELLOW, s: 'fire' },
        { t: 23.4375, bg: '#27c8ff', fx: 'ice', name: '빙결', ono: '쩌저적!', pose: 'base', oc: PAPER, s: 'ice' },
        { t: 24.375, bg: MINT, fx: 'clover', name: '럭키펀치', ono: '럭키!', pose: 'star', oc: YELLOW, s: 'sparkle' },
        { t: 25.3125, bg: VIOLET, fx: 'cards', name: '포커 못 하시네', ono: '촤라락!', pose: 'job', oc: YELLOW, s: 'cards' }
    ];
    scene('skills', 22.48, 26.27, root => {
        const bg = fill(root, ORANGE);
        const sp = speed(root, 'rgba(22,17,43,.2)');
        halftone(root, 'rgba(255,255,255,.2)', { size: 30, mask: 'linear-gradient(90deg, #000, transparent 55%)' });
        const spot = disc(root, 880, INK);
        const spotRing = ring(root, 880, PAPER, 14);
        const heroes = {};
        ['base', 'job', 'star'].forEach(k => { heroes[k] = sticker(root, 'hero/' + k + '_st.png', 840, { ghosts: 3 }); });
        const fxs = SK.map(s => pic(root, A + 'fx/' + s.fx + '.png', 960, 960));
        const names = SK.map(s => tag(root, s.name, YELLOW, { size: 58 }));
        const onos = SK.map((s, i) => onoma(root, s.ono, { t: s.t + .16, x: 1330 + (i % 2 ? -40 : 40), y: 190, r: i % 2 ? 7 : -7, size: 150, color: s.oc, life: .75 }));
        SK.forEach(s => { sfx(s.t, 'whoosh', .8); sfx(s.t + .14, 'hit', 1.1); sfx(s.t + .15, s.s, 1); shakeAt(s.t + .14, 14); punchAt(s.t + .14, .03); });
        return t => {
            let i = SK.length - 1; while (i > 0 && t < SK[i].t) i--;
            const s = SK[i], lt = t - s.t;
            bg.style.background = s.bg;
            sp.style.transform = 'rotate(' + (t * 25).toFixed(1) + 'deg)';
            const pre = lt < .14;
            const x = 500 + (pre ? -46 * E.outQuad(lt / .14) : 80 * decay(t, s.t + .14, 6));
            const path = tt => { const l = tt - s.t; return { x: 500 + (l < .14 ? -46 * E.outQuad(Math.max(0, l) / .14) : 80 * decay(tt, s.t + .14, 6)), y: 1080, s: 1 }; };
            Object.keys(heroes).forEach(k => {
                const h = heroes[k], on = k === s.pose;
                vis(h.wrap, on ? 1 : 0);
                if (!on) return;
                const id = idle(t, i);
                h.set({ x, y: 1080 + id.dy, s: popS(t, s.t - .02, .16), sx: (pre ? .95 : 1 + .06 * decay(t, s.t + .14, 8)) * id.sx, sy: (pre ? 1.04 : 1 - .05 * decay(t, s.t + .14, 8)) * id.sy, r: id.r - (pre ? 3 : 0) },
                    { shadow: { dx: 20, dy: 16 }, ghosts: lt > .14 && lt < .4 ? echoes(path, t, 3, .03, TRAIL, .7) : [] });
            });
            const sp1 = E.outBackBig(prog(lt, .1, .35));
            spot.set({ x: 1300, y: 560, s: sp1 * (1 + .025 * Math.sin(t * 10)) });
            spotRing.set({ x: 1300, y: 560, s: sp1 * 1.03 });
            fxs.forEach((f, j) => {
                if (j !== i) { vis(f.node, 0); return; }
                f.set({ x: 1300, y: 560, s: lerp(.2, 1.02, E.outExpo(prog(lt, .12, .5))) + .04 * Math.sin(t * 8), r: lerp(40, 0, E.outExpo(prog(lt, .12, .6))) + t * 6, a: 1 });
            });
            names.forEach((n, j) => n.set({ x: 360, y: 150, r: -5, s: j === i ? popS(t, s.t + .04, .22) : 0 }));
            onos.forEach(o => o.update(t));
        };
    });

    // ================================================================== D2. manga panels (26.25 – 28.125)
    scene('panels', 26.23, 28.14, root => {
        fill(root, INK);
        const PN = [
            { t: 26.25, fx: 'bigbang', bg: '#27c8ff', pose: 'job', clip: 'polygon(0 0, 43% 0, 31% 100%, 0 100%)', cx: 380, dir: -1 },
            { t: 26.72, fx: 'explode', bg: ORANGE, pose: 'base', clip: 'polygon(45% 0, 72% 0, 60% 100%, 33% 100%)', cx: 960, dir: 1 },
            { t: 27.19, fx: 'burst54', bg: YELLOW, pose: 'star', clip: 'polygon(74% 0, 100% 0, 100% 100%, 62% 100%)', cx: 1560, dir: -1 }
        ].map(p => {
            const d = el('div', 'abs', root); css(d, { width: '1920px', height: '1080px', clipPath: p.clip, background: p.bg });
            halftone(d, 'rgba(22,17,43,.18)', { size: 24 });
            const f = pic(d, A + 'fx/' + p.fx + '.png', 760, 760);
            const h = sticker(d, 'hero/' + p.pose + '_st.png', 620);
            sfx(p.t, 'slash', 1); sfx(p.t + .02, 'hit', 1); shakeAt(p.t, 12);
            return Object.assign(p, { d, f, h });
        });
        const combo = popText(root, 'COMBO!', { size: 260, color: YELLOW, shadowCss: '12px 12px 0 #ff3d7f, 24px 24px 0 #16112b' });
        sfx(27.66, 'boom', .9); shakeAt(27.66, 24); flashAt(27.66, .5, .08);
        return t => {
            PN.forEach(p => {
                const e = E.outExpo(prog(t, p.t, p.t + .3));
                const on = t >= p.t;
                p.d.style.transform = 'translateY(' + ((1 - e) * 1100 * p.dir).toFixed(1) + 'px)';
                vis(p.d, on ? 1 : 0);
                p.f.set({ x: p.cx + 60, y: 430, s: lerp(.3, 1.1, E.outExpo(prog(t, p.t + .05, p.t + .45))), r: t * 30 });
                const id = idle(t, p.cx);
                p.h.set({ x: p.cx - 40, y: 1120 + id.dy, s: 1 + .03 * Math.sin(t * 4), sx: id.sx, sy: id.sy }, { shadow: { dx: 14, dy: 12 } });
            });
            combo.place({ x: 960, y: 540, r: -8, s: 1 + .05 * decay(t, 27.7, 5) }); combo.update(t, 27.66, { mode: 'slam', stagger: .03, dur: .25 });
        };
    });
    wp.add(28.125, 'bars', { dur: .22, colors: [YELLOW, PINK, BLUE, MINT, VIOLET, INK] });

    // ================================================================== D3. field battle (28.125 – 37.5)
    scene('battle', 28.1, 37.52, root => {
        const bgb = bgImg(root, 'resort');
        const dim = fill(root, INK); vis(dim, 0);
        const spd = speed(root, 'rgba(255,244,224,.75)'); vis(spd, 0);
        // wave 1 (sorted back to front)
        const W1 = [['mon/a7_20_st.png', 1720, 850, 280], ['mon/a7_10_st.png', 1390, 860, 290], ['mon/a7_00_st.png', 1170, 905, 260], ['mon/a2_10_st.png', 1560, 935, 270], ['mon/a7_11_st.png', 1340, 1015, 300]]
            .map(([p, x, y, h], i) => ({ a: sticker(root, p, h), x, y, i }));
        const W2 = [['mon/a4b_11_st.png', 1790, 880, 330], ['mon/a5_10_st.png', 1560, 935, 380], ['mon/a6_01_st.png', 1250, 985, 360]]
            .map(([p, x, y, h], i) => ({ a: sticker(root, p, h), x, y, i }));
        const hero = sticker(root, 'hero/star_st.png', 600, { ghosts: 4 });
        const fxSlash = pic(root, A + 'fx/crescent.png', 560, 560), fxFist = pic(root, A + 'fx/fist.png', 520, 520), fxClaw = pic(root, A + 'fx/redclaw.png', 560, 560);
        const fxRings = pic(root, A + 'fx/redrings.png', 760, 760), fxSky = pic(root, A + 'fx/skyburst.png', 900, 900), fxPhx = pic(root, A + 'fx/phoenix.png', 900, 900, 'fxi');
        // hit schedule: [time, targets(wave1 idx or 'g'+idx), numbers]
        const H1 = [[28.62, [2, 4]], [29.08, [1]], [29.55, [3, 0]], [30.52, [0, 1, 2, 3, 4]], [30.64, [0, 1, 2, 3, 4]], [30.76, [0, 1, 2, 3, 4]], [30.88, [0, 1, 2, 3, 4]]];
        const H2 = [[33.28, [2]], [33.43, [1]], [33.58, [0]]];
        const hitsFor = (list, i) => list.filter(h => h[1].includes(i)).map(h => h[0]);
        const R = rng(12);
        const nums = [];
        H1.forEach(([ht, tg], j) => tg.filter((_, q) => j < 3 || q % 2 === (j % 2)).slice(0, j < 3 ? 5 : 2).forEach(i => { const m = W1.find(w => w.i === i); const crit = j === 1; nums.push({ t: ht, x: m.x + (R() - .5) * 60, y: m.y - 300 - (j >= 3 ? (j - 3) * 70 : R() * 40), text: crit ? '57,858' : String(8000 + Math.floor(R() * 14000)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), size: crit ? 110 : 64, color: crit ? YELLOW : '#ffffff', big: crit, r: (R() - .5) * 14 }); }));
        H2.forEach(([ht, tg]) => tg.forEach(i => { const m = W2[i]; nums.push({ t: ht, x: m.x, y: m.y - 380, text: ['357,858', '412,090', '388,741'][i], size: 120, color: YELLOW, big: true, r: (R() - .5) * 10, life: 1.1 }); }));
        const numL = numbers(root, nums);
        const crits = [onoma(root, 'CRITICAL!', { t: 29.1, x: 1030, y: 330, r: -6, size: 110, color: PINK, life: .6 }), onoma(root, 'K.O!', { t: 31.95, x: 1350, y: 380, r: -8, size: 260, color: YELLOW, life: .9 }), onoma(root, '화르르륵!!', { t: 33.1, x: 1000, y: 260, r: -5, size: 170, color: YELLOW, life: .8 })];
        // combo HUD
        const comboBox = el('div', 'abs', root);
        const comboLbl = el('div', 'tag', comboBox, 'COMBO'); css(comboLbl, { fontSize: '34px', background: PINK, color: PAPER });
        const comboNum = el('div', 'abs bhs', comboBox, '0'); css(comboNum, { fontSize: '150px', color: YELLOW, left: '0px', top: '64px' }); comboNum.style.setProperty('--stroke', '14px');
        const allHits = [...H1.map(h => h[0]), ...H2.map(h => h[0])].sort((a, b) => a - b);
        // loot + rewards
        const lootIcons = ['items/gold.png', 'items/eq_115.png', 'items/gold.png', 'items/eq_025.png', 'items/pack5.png', 'items/gold.png', 'items/eq_039.png', 'items/eq_122.png', 'items/gold.png', 'items/eq_192.png'].map(p => A + p);
        const lootL = loot(root, lootIcons, { t: 33.8, x: 1450, y: 820, floor: 1000, size: 150, vx: 1500, vy: 1700, life: 3.6, stagger: .035, seed: 9 });
        const goldP = pill(root, '<img src="' + A + 'items/gold.png" style="width:56px;height:56px"> +248,920 G', { size: 44, bg: YELLOW, color: INK });
        const expP = pill(root, 'EXP +659,313', { size: 44, bg: MINT, color: INK });
        const lvRays = rays(root, 1500, 'rgba(255,216,61,.6)');
        const lvUp = popText(root, 'LEVEL UP!', { size: 210, color: YELLOW, shadowCss: '10px 10px 0 #ff3d7f, 20px 20px 0 #16112b' });
        const lvBadge = el('div', 'abs bhs', root, 'Lv. 287'); css(lvBadge, { fontSize: '96px', color: PAPER }); lvBadge.style.setProperty('--stroke', '10px');
        const rib = el('div', 'abs', root); css(rib, { width: '1250px', height: '140px', background: PINK, border: '10px solid ' + INK, boxShadow: '12px 14px 0 ' + INK });
        const ribT = popText(rib, '클릭 한 번에 터지는 쾌감!', { size: 84, color: PAPER });
        frame(root, INK, 16);
        // sound + camera
        sfx(28.13, 'whoosh', 1); H1.forEach(([ht], j) => { sfx(ht, j === 1 ? 'crit' : 'hit', j >= 3 ? .7 : 1); if (j < 3) { shakeAt(ht, 12); punchAt(ht, .02); } });
        sfx(28.6, 'slash', 1); sfx(29.52, 'slash', .9); sfx(30.0, 'whoosh', .9); sfx(30.47, 'fire', .8); sfx(31.41, 'whoosh', .9);
        sfx(31.875, 'boom', 1.2); shakeAt(31.875, 30, 6); flashAt(31.875, .8, .1); punchAt(31.875, .05);
        [32.4, 32.58, 32.75].forEach(x => { sfx(x, 'thud', 1); shakeAt(x, 14); });
        sfx(32.81, 'riser_short', 1); sfx(33.05, 'fire', 1.1); H2.forEach(([ht]) => { sfx(ht, 'crit', 1); shakeAt(ht, 16); });
        sfx(33.75, 'boom', 1.3); flashAt(33.75, 1, .14); shakeAt(33.75, 34, 6); punchAt(33.75, .06);
        conf.burst({ t: 33.78, x: 1400, y: 700, n: 120, speed: 2400, life: 2.4 });
        for (let i = 0; i < 10; i++) sfx(33.83 + i * .035 + .25, 'coin', .5);
        sfx(34.69, 'levelup', 1.1); conf.burst({ t: 34.69, x: 960, y: 300, n: 140, speed: 2200, life: 2.6 });
        sfx(34.2, 'pop', .8); sfx(34.45, 'pop', .8); sfx(35.9, 'pop', .9); sfx(36.0, 'whoosh', .6);
        const heroPath = tt => {
            let x = 420, y = 1000, r = 0, s = 1, sx = 1, sy = 1;
            if (tt >= 28.125 && tt < 30.0) { x = lerp(420, 900, E.inOutExpo(prog(tt, 28.125, 28.5))) + 60 * E.outCubic(prog(tt, 29.0, 29.2)); r = tt > 29.5 && tt < 29.78 ? -360 * E.inOutCubic(prog(tt, 29.5, 29.78)) : 0; }
            else if (tt >= 30.0 && tt < 30.47) { const p = prog(tt, 30.0, 30.47); x = lerp(960, 420, E.inOutCubic(p)); y = 1000 - 300 * Math.sin(Math.PI * p); r = -360 * E.inOutCubic(p); }
            else if (tt >= 31.41 && tt < 32.34) { const p1 = prog(tt, 31.41, 31.8), p2 = prog(tt, 31.95, 32.34); y = 1000 - 360 * E.outCubic(p1) + 360 * E.inCubic(p2); sy = tt < 31.8 ? 1.08 : 1; }
            else if (tt >= 32.81 && tt < 33.75) { x = 520; s = 1 + .12 * E.outBack(prog(tt, 32.81, 33.05)); }
            else if (tt >= 34.69) { x = lerp(420, 700, E.inOutCubic(prog(tt, 35.2, 35.7))); y = 1000 - Math.abs(Math.sin((tt - 34.69) * 6.7)) * 70 * (1 - prog(tt, 36.6, 37.4)); }
            return { x, y, r, s, sx, sy, rc: 300 };
        };
        return t => {
            xf(bgb, { x: 960 + Math.sin(t * .5) * 10, y: 540, s: 1.06 }, 1920, 1080);
            const ult = t >= 32.81 && t < 33.8;
            vis(dim, ult ? .55 * E.outCubic(prog(t, 32.81, 33.0)) * (1 - prog(t, 33.6, 33.8)) : 0);
            vis(spd, ult ? .9 : 0); spd.style.transform = 'rotate(' + (t * 60).toFixed(1) + 'deg)';
            // wave 1
            W1.forEach(m => {
                const hits = hitsFor(H1, m.i);
                const re = react(t, hits);
                const ko = prog(t, 31.9, 32.8);
                const dirx = m.x > 1450 ? 1 : .6, id = idle(t, m.i, .8);
                const kx = ko > 0 ? dirx * 1500 * ko : 0, ky = ko > 0 ? -1500 * ko + 2600 * ko * ko : 0;
                m.a.set({ x: m.x + re.kx + kx, y: m.y + id.dy + ky, s: popS(t, 28.0 + m.i * .04, .25), sx: (1 + re.sq) * id.sx, sy: (1 - re.sq) * id.sy, r: id.r + ko * 720 * (m.i % 2 ? 1 : -1), flash: re.flash, a: t < 32.9 ? 1 : 0 }, { shadow: { dx: 10, dy: 10 } });
            });
            // wave 2
            W2.forEach((m, i) => {
                const t0 = [32.75, 32.58, 32.4][i];
                const drop = prog(t, t0 - .28, t0);
                const re = react(t, hitsFor(H2, i).concat(t > 33.75 ? [33.75] : []), 1.4);
                const ko = prog(t, 33.78, 34.6), id = idle(t, i + 7, .7);
                const land = spring(t, t0, 22, 8);
                m.a.set({ x: m.x + re.kx + ko * 1600, y: (t < t0 ? lerp(-500, m.y, E.inQuad(drop)) : m.y + id.dy) - ko * 1300 + ko * ko * 2400, sx: (1 + .2 * land + re.sq) * id.sx, sy: (1 - .22 * land - re.sq) * id.sy, r: ko * 540, flash: re.flash, a: t > t0 - .28 && t < 34.7 ? 1 : 0 }, { shadow: { dx: 12, dy: 12 } });
            });
            // hero
            const hp = heroPath(t), id = idle(t, 3);
            const moving = (t > 28.125 && t < 28.55) || (t > 30.0 && t < 30.5) || (t > 31.41 && t < 32.34) || (t > 29.5 && t < 29.8);
            hero.set({ x: hp.x, y: hp.y + id.dy, r: hp.r + id.r, s: hp.s, sx: hp.sx * id.sx, sy: hp.sy * id.sy, rc: 300 }, { shadow: { dx: 14, dy: 12 }, ghosts: moving ? echoes(heroPath, t, 4, .03, TRAIL, .75) : [] });
            // effects
            fxSlash.set({ x: 1260, y: 820, s: lerp(.2, 1.25, E.outExpo(prog(t, 28.56, 28.8))), r: -30 + 40 * prog(t, 28.56, 29.0), a: t > 28.56 && t < 29.05 ? 1 - prog(t, 28.85, 29.05) : 0 });
            fxFist.set({ x: 1400, y: 760, s: lerp(.2, 1.2, E.outExpo(prog(t, 29.04, 29.3))), r: 10, a: t > 29.04 && t < 29.5 ? 1 - prog(t, 29.3, 29.5) : 0 });
            fxClaw.set({ x: 1580, y: 820, s: lerp(.2, 1.2, E.outExpo(prog(t, 29.52, 29.75))), r: -20, a: t > 29.52 && t < 29.98 ? 1 - prog(t, 29.8, 29.98) : 0 });
            fxRings.set({ x: 1450, y: 820, s: lerp(.2, 1.4, E.outExpo(prog(t, 30.47, 30.8))), r: t * 90, a: t > 30.47 && t < 31.2 ? 1 - prog(t, 30.95, 31.2) : 0 });
            fxSky.set({ x: 1420, y: 760, s: lerp(.3, 2.3, E.outExpo(prog(t, 31.85, 32.3))), r: t * 20, a: t > 31.85 && t < 32.7 ? 1 - prog(t, 32.3, 32.7) : 0 });
            fxPhx.set({ x: lerp(300, 1650, E.inOutCubic(prog(t, 33.0, 33.65))), y: 640, s: lerp(1.1, 2.3, prog(t, 33.0, 33.65)), r: -10, a: t > 33.0 && t < 33.9 ? 1 - prog(t, 33.7, 33.9) : 0 });
            numL.draw(t);
            crits.forEach(c => c.update(t));
            // combo counter
            const cnt = allHits.filter(h => t >= h).length;
            const lastHit = allHits.filter(h => t >= h).pop() || 0;
            comboNum.textContent = String(cnt);
            xf(comboBox, { x: 1500, y: 250, s: t > 28.6 && t < 34.4 ? (1 + .18 * decay(t, lastHit, 10)) * popS(t, 28.62, .2) : 0, r: 6 }, 300, 220);
            // loot & rewards
            lootL.draw(t);
            goldP.set({ x: 1500, y: 180, s: popS(t, 34.2, .25, 36.9), r: -3 });
            expP.set({ x: 1500, y: 290, s: popS(t, 34.45, .25, 36.9), r: 3 });
            lvRays.set({ x: 960, y: 330, r: t * 40, s: popS(t, 34.69, .35, 36.9), a: .9 });
            lvUp.place({ x: 960, y: 330, r: -5, s: 1 + .05 * Math.sin(t * 8) }); lvUp.update(t, 34.69, { mode: 'drop', stagger: .04, dur: .45, wave: t > 35.3 ? 10 : 0, out: [36.9, .25] });
            lvBadge.textContent = t < 35.9 ? 'Lv. 286' : 'Lv. 287';
            xf(lvBadge, { x: 960, y: 500, s: popS(t, 35.2, .25, 36.9) * (1 + .2 * decay(t, 35.9, 8)), r: 4 }, 320, 100);
            xf(rib, { x: lerp(-800, 960, E.outBackBig(prog(t, 35.9, 36.25))) + (t > 37.1 ? -2600 * E.inBack(prog(t, 37.1, 37.5)) : 0), y: 900, r: -3 }, 1250, 140);
            ribT.place({ x: 625, y: 70 }); ribT.update(t, 36.0, { mode: 'pop', stagger: .03 });
        };
    });
    wp.add(37.5, 'circle', { x: 960, y: 540, color: BLUE, dur: .28 });

    // ================================================================== E1. enhance +9 -> +10 (37.5 – 41.25)
    scene('enhance', 37.48, 41.27, root => {
        fill(root, BLUE);
        halftone(root, 'rgba(255,255,255,.14)', { size: 28 });
        const ry = rays(root, 2400, 'rgba(255,255,255,.22)');
        const bst = burst(root, 900, YELLOW, { n: 18, inner: .74 });
        const ped = disc(root, 520, INK); const pedRing = ring(root, 560, YELLOW, 16);
        const conv = [0, 1, 2].map(() => ring(root, 600, PAPER, 12));
        const item = pic(root, A + 'items/eq_033.png', 500, 500); item.node.style.filter = 'drop-shadow(12px 14px 0 #16112b)';
        const name = pill(root, '레전더리 · 셀레스티아', { size: 44 });
        const p9 = popText(root, '+9', { size: 170, color: YELLOW });
        const p10 = popText(root, '+10', { size: 250, color: YELLOW, shadowCss: '10px 10px 0 #ff3d7f, 20px 20px 0 #16112b' });
        const ok = popText(root, '강화 성공!', { size: 140, color: PAPER, shadowCss: '9px 10px 0 #ff3d7f, 18px 20px 0 #16112b' });
        const btn = el('div', 'btn', root, '강화하기'); css(btn, { width: '360px', height: '120px', fontSize: '60px' });
        const cursor = el('div', 'abs', root, '<svg width="100" height="118" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15 Z" fill="#fff" stroke="#16112b" stroke-width="2.2" stroke-linejoin="round"/></svg>');
        const titles = ['t_master', 't_great', 't_god'].map(k => pic(root, A + 'ui/' + k + '.png', 560, 560 * SZ['ui/' + k + '.png'][1] / SZ['ui/' + k + '.png'][0]));
        sfx(37.6, 'pop', .8); sfx(38.44, 'click', 1);
        for (let i = 0; i < 8; i++) sfx(38.5 + i * BEAT / 4, 'tick_up', .5 + i * .06, i);
        sfx(39.375, 'success', 1.2); sfx(39.375, 'boom', .9); flashAt(39.375, .95, .12); shakeAt(39.375, 22); punchAt(39.375, .05);
        conf.burst({ t: 39.4, x: 960, y: 520, n: 150, speed: 2500, life: 2.4 });
        [39.84, 40.31, 40.78].forEach(x => sfx(x, 'stamp', 1));
        return t => {
            const tension = prog(t, 38.44, 39.375), done = t >= 39.375;
            ry.set({ x: 960, y: 520, r: t * (20 + tension * 160) });
            bst.set({ x: 960, y: 520, s: done ? E.outBackBig(prog(t, 39.375, 39.7)) * (1 + .03 * Math.sin(t * 9)) : 0, r: t * 25 });
            ped.set({ x: 960, y: 560, s: popS(t, 37.55, .3) }); pedRing.set({ x: 960, y: 560, s: popS(t, 37.6, .3) * (1 + .04 * Math.sin(t * 6)) });
            conv.forEach((c, i) => { const q = ((t - 38.44) / (BEAT / 2) + i / 3) % 1; c.set({ x: 960, y: 560, s: lerp(2.6, .4, q), a: t > 38.44 && !done ? q * .9 : 0 }); });
            const jit = !done ? tension * tension : 0;
            item.set({ x: 960 + noise1(t * 9, 1) * 18 * jit, y: 540 + Math.sin(t * 2.4) * 10 + noise1(t * 9, 2) * 12 * jit, s: popS(t, 37.6, .35) * (1 + .12 * (done ? decay(t, 39.375, 5) : 0) + .06 * jit), r: noise1(t * 7, 3) * 14 * jit + (done ? spring(t, 39.375, 16, 6) * 10 : 0) });
            name.set({ x: 960, y: 930, s: popS(t, 37.8, .25), r: -2 });
            p9.place({ x: 1400, y: 330, r: 8 + noise1(t * 10, 4) * 6 * jit, s: popS(t, 37.7, .25) * (done ? 1 - E.inBack(prog(t, 39.3, 39.42)) : 1 + .15 * jit) });
            p9.update(t, 37.7, { mode: 'type', stagger: 0 });
            p10.place({ x: 1440, y: 380, r: 8, s: 1 + .06 * Math.sin(t * 7) }); p10.update(t, 39.375, { mode: 'slam', stagger: .06, dur: .28 });
            ok.place({ x: 820, y: 140, r: -3 }); ok.update(t, 39.5, { mode: 'pop', stagger: .04 });
            const press = t >= 38.44 ? spring(t, 38.44, 26, 10) : 0;
            xf(btn, { x: 1470, y: 800, s: popS(t, 37.9, .25, 38.8), sx: 1 - .1 * Math.max(0, press), sy: 1 - .16 * Math.max(0, press) }, 360, 120);
            const cp = E.inOutCubic(prog(t, 37.95, 38.38));
            xf(cursor, { x: lerp(1920, 1500, cp), y: lerp(1100, 820, cp), s: 1 - .15 * pulse(t, 38.4, .14), a: t > 37.9 && t < 38.8 ? 1 : 0 }, 100, 118, .1, .08);
            titles.forEach((ti, i) => { const t0 = [39.84, 40.31, 40.78][i]; ti.set({ x: 1480, y: 800 - i * 8, r: [-6, 4, -3][i], s: t >= t0 ? E.outBackBig(prog(t, t0, t0 + .25)) * (i < 2 ? 1 - prog(t, [40.31, 40.78][i], [40.31, 40.78][i] + .06) : 1) : 0 }); });
        };
    });

    // ================================================================== E2. card fusion with the real in-game effect (41.25 – 45)
    scene('fusion', 41.23, 45.02, root => {
        fill(root, VIOLET);
        halftone(root, 'rgba(255,255,255,.12)', { size: 26 });
        const ry = rays(root, 2400, 'rgba(255,216,61,.18)');
        const SX = [560, 960, 1360];
        const slots = [1, 2, 3].map(i => pic(root, A + 'ui/slot' + i + '.png', 300, 387));
        const cards = ['c_nor5', 'c_nor6', 'c_nor7'].map(k => { const d = el('div', 'card', root); css(d, { width: '300px', height: '387px', borderRadius: '14px' }); img(A + 'cards/' + k + '.png', '', d); return d; });
        const lucky = pic(root, A + 'ui/lucky100.png', 250, 323);
        const luckyTag = tag(root, 'LUCKY 100%!', MINT, { size: 44 });
        const gif = img(A + 'gif/00.png', 'abs', root); css(gif, { width: '1440px', height: '810px' });
        for (let i = 1; i < 43; i++) { const pre = new Image(); pre.src = A + 'gif/' + String(i).padStart(2, '0') + '.png'; K.loaders.push(new Promise(r => { pre.onload = pre.onerror = r; })); }
        const bst = burst(root, 820, YELLOW, { n: 20, inner: .78 });
        const result = el('div', 'card', root); css(result, { width: '380px', height: '490px', borderWidth: '10px' }); img(A + 'cards/c_pO.png', '', result); result.style.borderRadius = '18px';
        const shine = el('div', 'abs', result); css(shine, { width: '200px', height: '900px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)', top: '-200px' });
        const okT = popText(root, '조합 성공!', { size: 150, color: YELLOW, shadowCss: '9px 10px 0 #ff3d7f, 18px 20px 0 #16112b' });
        const tags3 = [['전직', MINT], ['각성', PINK], ['프레스티지', YELLOW]].map(([s, c]) => tag(root, s, c, { size: 46, color: c === PINK ? PAPER : INK }));
        [41.3, 41.72, 42.19].forEach(x => { sfx(x, 'thud', .9); shakeAt(x + .12, 8); });
        sfx(42.66, 'sparkle', 1); sfx(43.125, 'whoosh', 1); sfx(43.15, 'riser_short', .9);
        sfx(44.06, 'success', 1.2); flashAt(44.06, .9, .12); shakeAt(44.06, 18); conf.burst({ t: 44.08, x: 960, y: 560, n: 150, speed: 2400, life: 2.2 });
        [44.53, 44.65, 44.77].forEach(x => sfx(x, 'pop', .7));
        return t => {
            ry.set({ x: 960, y: 560, r: t * 30 });
            const merge = prog(t, 43.125, 43.6);
            slots.forEach((s, i) => s.set({ x: SX[i], y: 600, s: popS(t, 41.25 + i * .06, .25) * (1 - E.inBack(merge)), r: 0 }));
            cards.forEach((c, i) => {
                const t0 = [41.3, 41.72, 42.19][i];
                const drop = prog(t, t0 - .2, t0), land = spring(t, t0, 24, 9);
                const x = lerp(SX[i], 960, E.inBack(merge)), y = t < t0 ? lerp(-300, 600, E.inQuad(drop)) : lerp(600, 560, merge);
                xf(c, { x, y, sy: 1 - .08 * land, sx: 1 + .06 * land, r: merge * 720 * (i - 1 || 1), s: 1 - E.inCubic(merge) * .95, a: t > t0 - .2 && merge < 1 ? 1 : 0 }, 300, 387);
            });
            const lp = prog(t, 42.66, 42.95);
            lucky.set({ x: 1650, y: 330, sx: lp < 1 ? Math.abs(Math.cos(lp * Math.PI * 2)) : 1, r: 8, s: t > 42.66 ? (1 - E.inBack(merge)) : 0 });
            luckyTag.set({ x: 1650, y: 540, s: popS(t, 42.8, .25) * (1 - E.inBack(merge)), r: -5 });
            const k = Math.floor((t - 43.125) / .03);
            const gifOn = k >= 0 && k < 43;
            if (gifOn) { const src = A + 'gif/' + String(k).padStart(2, '0') + '.png'; if (gif.dataset.src !== src) { gif.dataset.src = src; gif.src = src; K.pending.push(gif.decode().catch(() => {})); } }
            xf(gif, { x: 960, y: 560, s: 1, a: gifOn ? 1 : 0 }, 1440, 810);
            const rv = t >= 44.06;
            bst.set({ x: 960, y: 560, s: rv ? E.outBackBig(prog(t, 44.06, 44.4)) : 0, r: t * 25 });
            xf(result, { x: 960, y: 590, s: rv ? E.outBackBig(prog(t, 44.06, 44.4)) : 0, r: rv ? spring(t, 44.06, 12, 5) * 8 : 0 }, 380, 490);
            shine.style.transform = 'translateX(' + lerp(-300, 520, prog(t, 44.2, 44.7)).toFixed(1) + 'px) rotate(20deg)';
            okT.place({ x: 960, y: 170, r: -3 }); okT.update(t, 44.15, { mode: 'pop', stagger: .04 });
            tags3.forEach((g, i) => g.set({ x: [620, 1300, 1320][i], y: [560, 440, 740][i], r: [-8, 6, -4][i], s: popS(t, [44.53, 44.65, 44.77][i], .25) }));
        };
    });

    // ================================================================== E3. combat power + gear orbit (45 – 48.75)
    scene('power', 44.98, 48.77, root => {
        fill(root, YELLOW);
        halftone(root, 'rgba(22,17,43,.12)', { size: 26 });
        const ry = rays(root, 2600, 'rgba(255,255,255,.4)');
        const dark = fill(root, INK); vis(dark, 0);
        const ids = ['eq_033', 'eq_115', 'eq_025', 'eq_039', 'eq_122', 'eq_035', 'eq_192', 'eq_163'];
        const orb = ids.map(k => { const p = pic(root, A + 'items/' + k + '.png', 170, 170); p.node.style.filter = 'drop-shadow(7px 8px 0 #16112b)'; return p; });
        const hero = sticker(root, 'hero/job_st.png', 880);
        hero.wrap.style.zIndex = 5;
        const lbl = tag(root, '전투력', INK, { size: 56, color: YELLOW });
        const num = el('div', 'abs bhs', root, '0'); css(num, { fontSize: '176px', color: PAPER, textShadow: '9px 10px 0 #ff3d7f, 18px 20px 0 #16112b' }); num.style.setProperty('--stroke', '16px');
        const copy = pill(root, '키울수록, 더 강하게!', { size: 48 });
        const sparks = Array.from({ length: 6 }, (_, i) => { const d = el('div', 'abs bhs', root, '★'); css(d, { fontSize: '70px', color: [PINK, PAPER, BLUE][i % 3] }); d.style.setProperty('--stroke', '8px'); return d; });
        sfx(45.05, 'pop', .9); sfx(47.34, 'boom', .9); sfx(47.34, 'sparkle', 1); shakeAt(47.34, 14); punchAt(47.34, .04);
        for (let i = 0; i < 14; i++) sfx(45.5 + i * .13, 'tick', .25);
        return t => {
            ry.set({ x: 1380, y: 560, r: t * 18 });
            const id = idle(t, 4, 1.1);
            hero.set({ x: 1420, y: 1080 + id.dy, s: popS(t, 45.0, .35), sx: id.sx, sy: id.sy, r: id.r }, { shadow: { dx: 20, dy: 16 } });
            orb.forEach((o, i) => {
                const ang = t * 1.2 + i * Math.PI * 2 / 8, sn = Math.sin(ang);
                o.node.style.zIndex = sn > 0 ? 6 : 4;
                o.set({ x: 1420 + Math.cos(ang) * 390, y: 600 + sn * 160, s: popS(t, 45.1 + i * .05, .3) * (.8 + .25 * (sn + 1) / 2), r: Math.sin(t * 2 + i) * 10 });
            });
            lbl.set({ x: 520, y: 360, s: popS(t, 45.2, .25), r: -4 });
            const v = Math.round(lerp(184000, 2012821, E.outCubic(prog(t, 45.47, 47.3))));
            num.textContent = v.toLocaleString('en-US');
            xf(num, { x: 520, y: 540, s: popS(t, 45.3, .3) * (1 + .12 * decay(t, 47.34, 6)), r: -3 }, 860, 180);
            copy.set({ x: 520, y: 760, s: popS(t, 46.4, .25), r: 2 });
            sparks.forEach((d, i) => { const dt = t - 47.34, ang = i * 60 * Math.PI / 180; xf(d, { x: 560 + Math.cos(ang) * 440 * E.outCubic(prog(dt, 0, .5)), y: 540 + Math.sin(ang) * 200 * E.outCubic(prog(dt, 0, .5)), s: dt > 0 && dt < .7 ? 1 - prog(dt, .35, .7) : 0, r: dt * 300 }, 70, 70); });
            vis(dark, E.inCubic(prog(t, 48.2, 48.75)) * .95);
        };
    });

    // ================================================================== F. WARNING build (48.75 – 52.5)
    scene('warning', 48.73, 52.52, root => {
        fill(root, INK);
        halftone(root, 'rgba(255,45,85,.22)', { size: 26 });
        const sig = pic(root, A + 'fx/sigil_red.png', 1000, 1000, 'fxi');
        const boss = sticker(root, 'mon/boss_st.png', 860);
        boss.body.style.filter = 'brightness(.14) saturate(.4)';
        const tapes = [0, 1].map(i => { const d = el('div', 'abs', root); css(d, { width: '4200px', height: '120px', background: 'repeating-linear-gradient(-45deg, #ffd83d 0 44px, #16112b 44px 88px)', borderTop: '10px solid #16112b', borderBottom: '10px solid #16112b' }); const txt = el('div', 'abs bhs', d, ('WARNING !! ').repeat(14)); css(txt, { fontSize: '74px', color: '#ff2d55', top: '12px', left: '0' }); txt.style.setProperty('--stroke', '10px'); return d; });
        const l1 = popText(root, '그리고…', { size: 100, color: PAPER });
        const l2 = popText(root, '놈이 온다!', { size: 230, color: '#ff2d55', shadowCss: '10px 11px 0 #ffd83d, 20px 22px 0 #000' });
        const beats = [49.22, 50.16, 51.09, 51.56, 52.03];
        beats.forEach((x, i) => { sfx(x, 'thud', 1 + i * .1); shakeAt(x, 14 + i * 4, 8); });
        sfx(48.8, 'alarm_short', .7); sfx(50.63, 'hit', 1); sfx(51.6, 'riser_short', 1);
        return t => {
            tapes.forEach((d, i) => { d.style.transform = 'translate(' + ((i ? -1 : 1) * ((t * 420) % 1056) - (i ? 1400 : 2000)).toFixed(1) + 'px,' + (i ? 900 : 60) + 'px) rotate(' + (i ? 3 : -3) + 'deg)'; vis(d, popS(t, 48.8 + i * .08, .25) > 0 ? 1 : 0); });
            let step = 0; beats.forEach(b => { if (t >= b) step++; });
            const sc = lerp(.42, 1.05, step / beats.length) + .05 * decay(t, beats[Math.max(0, step - 1)], 7);
            sig.set({ x: 1260, y: 540, s: sc * 1.1, r: t * 40, a: .9 });
            boss.set({ x: 1260, y: 540 + 430 * sc, s: sc }, { shadow: { dx: 0, dy: 0, color: '#ff2d55', a: .9 } });
            l1.place({ x: 520, y: 430 }); l1.update(t, 49.22, { mode: 'type', stagger: .09 });
            l2.place({ x: 560, y: 620, r: -5, s: 1 + .04 * Math.sin(t * 12) }); l2.update(t, 50.63, { mode: 'slam', stagger: .05, dur: .28 });
        };
    });
    flashAt(52.5, 1, .15, '#fff0e0');

    // ================================================================== G1. hell-field boss fight (52.5 – 60)
    scene('boss', 52.48, 60.02, root => {
        const bgh = bgImg(root, 'hell');
        const sigR = pic(root, A + 'fx/sigil_red.png', 1100, 1100, 'fxi');
        const sigB = pic(root, A + 'fx/sigil_blue.png', 700, 700, 'fxi');
        const dim = fill(root, INK); vis(dim, 0);
        const spd = speed(root, 'rgba(255,244,224,.7)'); vis(spd, 0);
        const bubble = pic(root, A + 'fx/shield.png', 900, 900, 'fxi');
        const boss = sticker(root, 'mon/boss_st.png', 820);
        const pillars = [930, 1820].map(x => ({ a: sticker(root, 'mon/pillar_st.png', 440), x }));
        const hero = sticker(root, 'hero/star_st.png', 600, { ghosts: 4 });
        const fxShield = pic(root, A + 'fx/shield.png', 460, 460, 'fxi'), fxBite = pic(root, A + 'fx/bloodfang.png', 520, 520);
        const fxA = pic(root, A + 'fx/clap.png', 560, 560), fxB = pic(root, A + 'fx/bolt.png', 600, 600), fxC = pic(root, A + 'fx/redstorm.png', 620, 620), fxKick = pic(root, A + 'fx/kick.png', 520, 520);
        const fxGold = pic(root, A + 'fx/goldpillar.png', 1000, 1000, 'fxi'), fxJack = pic(root, A + 'fx/jackpot.png', 1100, 1100);
        const shock = [0, 1, 2].map(i => ring(root, 500, i === 1 ? PINK : INK, 16));
        const buta = pic(root, A + 'ui/buta_logo.png', 520, 520 * SZ['ui/buta_logo.png'][1] / SZ['ui/buta_logo.png'][0]);
        buta.node.style.border = '8px solid #16112b'; buta.node.style.boxShadow = '10px 12px 0 #16112b';
        const hellTag = tag(root, '헬 필드 보스', '#ff2d55', { size: 48, color: PAPER });
        const hpWrap = el('div', 'hpbar', root); css(hpWrap, { width: '980px' });
        const hpLag = el('b', '', hpWrap), hpFill = el('i', '', hpWrap);
        const hpName = tag(root, '부타게임 [H]', YELLOW, { size: 34 });
        const roar = onoma(root, '크아앙!!', { t: 52.62, x: 1250, y: 210, r: 6, size: 190, color: '#ff2d55', life: .8 });
        const block = onoma(root, '막았다!', { t: 53.95, x: 520, y: 360, r: -8, size: 130, color: MINT, life: .6 });
        const barrier = onoma(root, '결계 발동!', { t: 55.9, x: 1400, y: 200, r: -4, size: 130, color: '#27c8ff', life: .7 });
        const breakT = onoma(root, '기둥 파괴!', { t: 57.7, x: 1400, y: 200, r: 5, size: 140, color: YELLOW, life: .6 });
        const clear = popText(root, 'CLEAR!!', { size: 260, color: YELLOW, shadowCss: '12px 12px 0 #ff3d7f, 24px 24px 0 #16112b' });
        const HITS = [[54.375, 88420, 1], [54.84, 212500, 1.4], [55.31, 95114, 1], [58.62, 1250000, 1.8], [59.06, 9999999, 2.2]];
        const nums = numbers(root, HITS.map(([ht, v, k], i) => ({ t: ht + .04, x: 1330 + (i % 2 ? 60 : -60), y: 380 - k * 20, text: v.toLocaleString('en-US'), size: Math.round(80 * k), color: k > 1 ? YELLOW : '#fff', big: k > 1, life: 1, r: (i % 2 ? 6 : -6) })));
        const hpAt = [[52.5, 1], [54.4, .8], [54.87, .64], [55.34, .55], [58.65, .22], [59.08, 0]];
        const hpVal = t => { let v = 1; hpAt.forEach(([ht, x]) => { if (t >= ht) v = x; }); return v; };
        const hpLagVal = t => { let v = 1, last = 52.5; hpAt.forEach(([ht, x]) => { if (t >= ht) { last = ht; } }); const cur = hpVal(t); const prev = hpAt.filter(h => h[0] < last).pop(); return prev ? lerp(prev[1], cur, E.inOutCubic(prog(t, last + .15, last + .45))) : cur; };
        const lootIcons = ['eq_025', 'eq_039', 'eq_115', 'eq_192', 'eq_060', 'eq_129', 'gold', 'gold'].map(k => A + 'items/' + k + '.png');
        const lootL = loot(root, lootIcons, { t: 59.4, x: 1300, y: 520, floor: 1010, size: 150, vx: 1600, vy: 1300, life: 3, stagger: .04, seed: 21 });
        const mythic = pill(root, '신화 장비 획득!', { size: 48, bg: '#ff2d55' });
        frame(root, INK, 16);
        sfx(52.5, 'boom', 1.3); sfx(52.6, 'roar', 1.2); shakeAt(52.62, 26, 5); punchAt(52.5, .05);
        sfx(53.44, 'whoosh', 1); sfx(53.9, 'shield', 1.1); shakeAt(53.9, 12);
        HITS.slice(0, 3).forEach(([ht], i) => { sfx(ht, i === 1 ? 'crit' : 'hit', 1.1); shakeAt(ht, 16); punchAt(ht, .025); });
        sfx(55.8, 'thud', 1.1); sfx(56.0, 'thud', 1.1); sfx(56.1, 'shield', .7);
        [56.72, 57.66].forEach(x => { sfx(x, 'break', 1.1); shakeAt(x, 18); }); sfx(56.3, 'whoosh', .9); sfx(57.19, 'whoosh', .9);
        sfx(58.125, 'riser_short', 1.1); sfx(58.6, 'boom', 1); sfx(59.06, 'boom', 1.4); sfx(59.3, 'stamp', 1.2); flashAt(59.06, 1, .18); shakeAt(59.06, 36, 5); punchAt(59.06, .07);
        conf.burst({ t: 59.1, x: 960, y: 420, n: 170, speed: 2600, life: 2.4 });
        for (let i = 0; i < 8; i++) sfx(59.5 + i * .04 + .3, 'coin', .45);
        const heroPath = tt => {
            let x = 430, y = 1010, r = 0, s = 1;
            if (tt >= 54.3 && tt < 55.7) { x = 900 + 60 * Math.sin((tt - 54.3) * 7); }
            if (tt >= 54.2 && tt < 54.375) x = lerp(430, 900, E.inOutExpo(prog(tt, 54.2, 54.375)));
            if (tt >= 55.7 && tt < 56.25) x = lerp(900, 430, E.inOutCubic(prog(tt, 55.7, 56.1)));
            if (tt >= 56.25 && tt < 57.9) { x = tt < 57.19 ? lerp(430, 760, E.inOutExpo(prog(tt, 56.25, 56.6))) : lerp(760, 1640, E.inOutExpo(prog(tt, 57.19, 57.5))); y = 1010 - 120 * pulse(tt, 56.5, .3) - 120 * pulse(tt, 57.45, .3); }
            if (tt >= 57.9 && tt < 58.4) x = lerp(1640, 520, E.inOutCubic(prog(tt, 57.9, 58.3)));
            if (tt >= 58.4) { x = 520; y = 1010 - 380 * E.outCubic(prog(tt, 58.3, 58.6)) + 380 * E.inCubic(prog(tt, 59.2, 59.5)); s = 1 + .1 * prog(tt, 58.3, 58.6); }
            return { x, y, r, s };
        };
        return t => {
            xf(bgh, { x: 960, y: 540, s: 1.05 + .01 * Math.sin(t) }, 1920, 1080);
            sigR.set({ x: 1360, y: 560, s: 1 + .04 * Math.sin(t * 3), r: t * 25, a: .85 });
            sigB.set({ x: 1360, y: 560, s: .9, r: -t * 40, a: .7 });
            const ult = t >= 58.125 && t < 59.2;
            vis(dim, ult ? .5 * E.outCubic(prog(t, 58.125, 58.3)) : 0);
            vis(spd, ult ? .85 : 0); spd.style.transform = 'rotate(' + (t * 70).toFixed(1) + 'deg)';
            // boss
            const hits = HITS.map(h => h[0]);
            const re = react(t, hits, 1.6);
            const lunge = -140 * pulse(t, 53.35, .45);
            const roarS = .07 * pulse(t, 52.55, .5);
            const ko = prog(t, 59.06, 59.9);
            const bid = idle(t, 9, .6);
            boss.set({ x: 1360 + re.kx + lunge + ko * 900, y: 1045 + bid.dy - ko * 900 + ko * ko * 400, s: (1 + roarS) * (1 - ko * .6), sx: (1 + re.sq) * bid.sx, sy: (1 - re.sq) * bid.sy, r: bid.r + ko * 900, flash: re.flash, a: ko < 1 ? 1 : 0 }, { shadow: { dx: 16, dy: 14 } });
            bubble.set({ x: 1360, y: 640, s: popS(t, 55.9, .3, 57.66, .2) * (1 + .03 * Math.sin(t * 8)), a: .75 });
            shock.forEach((r, i) => { const q = prog(t, 52.55 + i * .08, 53.2 + i * .08); r.set({ x: 1360, y: 640, s: lerp(.4, 4.5, E.outCubic(q)), a: q > 0 && q < 1 ? 1 - q : 0 }); });
            // pillars rise, then shatter
            pillars.forEach((p, i) => {
                const rise = E.outBack(prog(t, 55.78 + i * .12, 56.1 + i * .12));
                const br = prog(t, [56.72, 57.66][i], [56.72, 57.66][i] + .5);
                p.a.set({ x: p.x + (br > 0 ? (i ? 1 : -1) * 300 * br : 0), y: 1030 + (1 - rise) * 600 + br * br * 700, r: br * (i ? 200 : -200), s: 1 - br * .4, flash: br > 0 ? 1 - br * 2 : 0, a: rise > 0 && br < 1 ? 1 : 0 }, { shadow: { dx: 12, dy: 12 } });
            });
            // hero
            const hp = heroPath(t), id = idle(t, 5);
            const moving = (t > 54.2 && t < 54.4) || (t > 55.7 && t < 56.1) || (t > 56.25 && t < 56.6) || (t > 57.19 && t < 57.5) || (t > 57.9 && t < 58.3) || (t > 58.3 && t < 58.6);
            hero.set({ x: hp.x, y: hp.y + id.dy, s: hp.s, sx: id.sx, sy: id.sy, r: id.r, flash: t > 53.85 && t < 53.95 ? .8 : 0 }, { shadow: { dx: 14, dy: 12 }, ghosts: moving ? echoes(heroPath, t, 4, .03, TRAIL, .75) : [] });
            // effects
            fxBite.set({ x: lerp(1200, 620, prog(t, 53.44, 53.9)), y: 720, s: 1.1, r: -20, a: t > 53.44 && t < 53.95 ? 1 : 0 });
            fxShield.set({ x: 600, y: 760, s: E.outBackBig(prog(t, 53.85, 54.05)), a: t > 53.85 && t < 54.35 ? 1 - prog(t, 54.15, 54.35) : 0 });
            [[fxA, 54.35], [fxB, 54.82], [fxC, 55.29]].forEach(([f, ft]) => f.set({ x: 1320, y: 640, s: lerp(.2, 1.3, E.outExpo(prog(t, ft, ft + .25))), r: t * 40, a: t > ft && t < ft + .45 ? 1 - prog(t, ft + .3, ft + .45) : 0 }));
            fxKick.set({ x: t < 57.2 ? 930 : 1820, y: 800, s: lerp(.2, 1.3, E.outExpo(prog(t, t < 57.2 ? 56.7 : 57.64, (t < 57.2 ? 56.7 : 57.64) + .25))), a: (t > 56.7 && t < 57.05) || (t > 57.64 && t < 58.0) ? 1 : 0 });
            fxGold.set({ x: 1360, y: lerp(-300, 560, E.outExpo(prog(t, 58.45, 58.75))), s: 1.6, a: t > 58.45 && t < 59.3 ? 1 - prog(t, 59.1, 59.3) : 0 });
            fxJack.set({ x: 1360, y: 600, s: lerp(.3, 2.2, E.outExpo(prog(t, 59.04, 59.5))), r: t * 30, a: t > 59.04 && t < 59.9 ? 1 - prog(t, 59.6, 59.9) : 0 });
            // UI
            buta.set({ x: 330, y: 190, r: -5, s: popS(t, 52.6, .3, 54.1) });
            hellTag.set({ x: 330, y: 340, r: 4, s: popS(t, 52.75, .25, 54.1) });
            const hpS = popS(t, 52.8, .3, 59.6);
            xf(hpWrap, { x: 1150, y: 110, s: hpS }, 980, 46);
            hpFill.style.width = (hpVal(t) * 100).toFixed(2) + '%'; hpLag.style.width = (hpLagVal(t) * 100).toFixed(2) + '%';
            hpName.set({ x: 700, y: 110, s: hpS, r: -4 });
            roar.update(t); block.update(t); barrier.update(t); breakT.update(t);
            nums.draw(t);
            clear.place({ x: 960, y: 420, r: -8, s: 1 + .05 * Math.sin(t * 9) }); clear.update(t, 59.25, { mode: 'slam', stagger: .05, dur: .3 });
            lootL.draw(t);
            mythic.set({ x: 960, y: 640, s: popS(t, 59.55, .25), r: 3 });
        };
    });
    wp.add(60.0, 'bars', { dur: .24, colors: [MINT, YELLOW, PINK, BLUE, VIOLET, INK] });

    // ================================================================== G2. 28 fields conveyor (60 – 63.75)
    scene('fields', 59.98, 63.77, root => {
        fill(root, MINT);
        const st = el('div', 'stripes', root); st.style.setProperty('--c1', 'rgba(255,255,255,.22)');
        const names = [['woldo5', '월도랜드'], ['resort', '리조트'], ['pirate', '극한의농락전'], ['arena', '스코어서바이벌'], ['mansion', '이세계대저택'], ['castle', '관찰자들의 도시'], ['crystal', '밍닝스플랜'], ['motel', '더타임모텔'], ['war', '해고전쟁시대'], ['oracle', '예언의결속'], ['woldo1', '월도랜드1'], ['town', '뉴비즈']];
        const rows = [0, 1].map(r => {
            const strip = el('div', 'abs', root);
            const list = (r ? names.slice(6).concat(names.slice(0, 6)) : names).map(([k, label], i) => {
                const c = el('div', 'card', strip); css(c, { width: '520px', height: '300px', left: (i * 580) + 'px', top: '0px' });
                const im = img(A + 'bg/' + k + '.jpg', '', c); css(im, { width: '520px', height: '300px', objectFit: 'cover' });
                const lb = el('div', 'tag', c, label); css(lb, { position: 'absolute', left: '14px', bottom: '14px', fontSize: '28px', boxShadow: '4px 5px 0 #16112b', borderWidth: '4px' });
                return c;
            });
            return { strip, r };
        });
        const n28 = popText(root, '28', { size: 420, color: YELLOW, shadowCss: '14px 14px 0 #ff3d7f, 28px 28px 0 #16112b', stroke: 30 });
        const l1 = popText(root, '개의 필드', { size: 120, color: PAPER });
        const sub = pill(root, '끝없는 사냥 · 쏟아지는 보상', { size: 44 });
        const peekers = ['a1_00', 'a3_00', 'a6_10', 'a7_30', 'a2_20'].map(k => sticker(root, 'mon/' + k + '_st.png', 220));
        sfx(60.05, 'pop', 1); sfx(60.3, 'boom', .8); [60.94, 61.41, 61.88, 62.34, 62.81].forEach(x => sfx(x, 'pop', .7));
        return t => {
            st.style.transform = 'translateX(' + ((t * 60) % 96).toFixed(1) + 'px)';
            rows.forEach(({ strip, r }) => {
                const x = r ? -3000 + ((t - 60) * 520) % 2320 : -((t - 60) * 620) % 2320;
                strip.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (r ? 700 : 70) + 'px) rotate(' + (r ? 4 : -4) + 'deg)';
            });
            n28.place({ x: 1060, y: 470, r: -6, s: 1 + .04 * decay(t, 60.3, 6) }); n28.update(t, 60.3, { mode: 'slam', stagger: .08, dur: .3 });
            l1.place({ x: 1420, y: 430, r: -4 }, 0, .5); l1.update(t, 60.6, { mode: 'pop', stagger: .04 });
            sub.set({ x: 1390, y: 580, r: 3, s: popS(t, 61.0, .25) }, 0, .5);
            peekers.forEach((p, i) => { const t0 = [60.94, 61.41, 61.88, 62.34, 62.81][i]; const id = idle(t, i); p.set({ x: [260, 700, 1600, 380, 1250][i], y: [420, 380, 400, 1060, 1070][i] + id.dy, s: popS(t, t0, .3, t0 + 1.2, .2), r: [-8, 6, -4, 5, -6][i] }, { shadow: { dx: 8, dy: 8 } }); });
        };
    });

    // ================================================================== G3. content modes (63.75 – 67.5)
    scene('modes', 63.73, 67.52, root => {
        fill(root, PINK);
        halftone(root, 'rgba(255,255,255,.18)', { size: 28 });
        const M = [['hunt_hell', '헬 필드', 540, 330, -6], ['wb', '월드보스', 1390, 320, 5], ['hunt_daily', '일일던전', 560, 760, 4], ['hunt_normal', '일반 필드', 1370, 770, -5]].map(([k, label, x, y, r], i) => {
            const c = el('div', 'card', root); css(c, { width: '620px', height: '350px' });
            const im = img(A + 'ui/' + k + '.png', '', c); css(im, { width: '620px', height: '350px', objectFit: 'cover' });
            const tg = tag(root, label, [YELLOW, MINT, BLUE, VIOLET][i], { size: 52, color: i >= 2 ? PAPER : INK });
            return { c, tg, x, y, r, t0: 63.75 + i * BEAT };
        });
        const copy = popText(root, '매일 새로운 도전!', { size: 150, color: YELLOW, shadowCss: '9px 10px 0 #2f6bff, 18px 20px 0 #16112b' });
        M.forEach(m => sfx(m.t0, 'card', .9)); sfx(65.625, 'hit', 1); shakeAt(65.625, 14);
        return t => {
            M.forEach(m => {
                const p = prog(t, m.t0, m.t0 + .3);
                xf(m.c, { x: m.x, y: m.y, sx: p < 1 ? Math.abs(Math.cos((1 - E.outCubic(p)) * Math.PI / 2 * 2)) : 1, s: t > m.t0 ? .98 + .02 * Math.sin(t * 4 + m.x) : 0, r: m.r }, 620, 350);
                m.tg.set({ x: m.x - 190, y: m.y + 150, r: -m.r, s: popS(t, m.t0 + .15, .25) });
            });
            copy.place({ x: 960, y: 545, r: -4, s: 1 + .04 * decay(t, 65.625, 6) }); copy.update(t, 65.625, { mode: 'slam', stagger: .04, dur: .28, out: [67.2, .2] });
        };
    });
    wp.add(67.5, 'slash', { dur: .26, colors: [INK, YELLOW, BLUE] });

    // ================================================================== H1. PVP (67.5 – 69.375)
    scene('pvp', 67.48, 69.4, root => {
        const L = el('div', 'abs', root); css(L, { width: '1920px', height: '1080px', background: PINK, clipPath: 'polygon(0 0, 58% 0, 42% 100%, 0 100%)' });
        halftone(L, 'rgba(255,255,255,.2)', { size: 26 });
        const Rp = el('div', 'abs', root); css(Rp, { width: '1920px', height: '1080px', background: BLUE, clipPath: 'polygon(58% 0, 100% 0, 100% 100%, 42% 100%)' });
        halftone(Rp, 'rgba(255,255,255,.16)', { size: 26 });
        const seam = el('div', 'abs', root); css(seam, { width: '26px', height: '1300px', background: INK, left: '947px', top: '-110px', transform: 'rotate(8.4deg)' });
        const hero = sticker(root, 'hero/star_st.png', 820);
        const rival = sticker(root, 'mon/hunter_st.png', 860);
        const bolt = pic(root, A + 'fx/bolt.png', 700, 700);
        const vs = popText(root, 'VS', { size: 300, color: YELLOW, shadowCss: '12px 12px 0 #16112b', stroke: 26 });
        const t1 = tag(root, 'PVP 대전', YELLOW, { size: 60 });
        const rate = pill(root, '레이팅 1,016 ▲16', { size: 44, bg: INK });
        sfx(67.5, 'whoosh', 1); sfx(67.97, 'hit', 1.2); sfx(67.99, 'zap', 1); shakeAt(67.97, 22); flashAt(67.97, .5, .08); sfx(68.9, 'pop', .9);
        return t => {
            const inL = E.outExpo(prog(t, 67.5, 67.85)), inR = E.outExpo(prog(t, 67.6, 67.95));
            L.style.transform = 'translateX(' + ((1 - inL) * -1100).toFixed(1) + 'px)';
            Rp.style.transform = 'translateX(' + ((1 - inR) * 1100).toFixed(1) + 'px)';
            const id = idle(t, 1), id2 = idle(t, 2);
            hero.set({ x: 480 - (1 - inL) * 900, y: 1090 + id.dy, sx: id.sx, sy: id.sy, r: id.r }, { shadow: { dx: 18, dy: 14 } });
            rival.set({ x: 1460 + (1 - inR) * 900, y: 1090 + id2.dy, sx: id2.sx, sy: id2.sy, r: id2.r, flip: true }, { shadow: { dx: -18, dy: 14 } });
            bolt.set({ x: 960, y: 520, s: popS(t, 67.97, .3) * (1 + .05 * Math.sin(t * 20)), r: t * 20 });
            vs.place({ x: 960, y: 520, r: -6, s: 1 + .06 * decay(t, 68.0, 6) }); vs.update(t, 67.97, { mode: 'slam', stagger: .06, dur: .25 });
            t1.set({ x: 960, y: 120, s: popS(t, 67.7, .25), r: -3 });
            rate.set({ x: 480, y: 250, s: popS(t, 68.9, .25), r: -4 });
        };
    });

    // ================================================================== H2. party + chat (69.375 – 71.25)
    scene('party', 69.35, 71.27, root => {
        fill(root, YELLOW);
        halftone(root, 'rgba(22,17,43,.12)', { size: 26 });
        const roles = ['메인딜러', '탱커', '서포터', '서브딜러', '브루저'];
        const slots = roles.map((r, i) => {
            const c = el('div', 'card', root); css(c, { width: '250px', height: '322px', background: i ? INK : '#fff' });
            if (!i) img(A + 'cards/c_jobS.png', '', c);
            else { const q = el('div', 'bhs', c, '?'); css(q, { fontSize: '200px', color: PAPER, textAlign: 'center', lineHeight: '322px' }); q.style.setProperty('--stroke', '0px'); }
            const tg = tag(root, r, [PINK, BLUE, MINT, VIOLET, ORANGE][i], { size: 34, color: PAPER });
            return { c, tg, t0: 69.375 + i * BEAT / 4 };
        });
        const title = popText(root, '최대 5인 파티 레이드', { size: 120, color: PAPER, shadowCss: '8px 9px 0 #ff3d7f, 16px 18px 0 #16112b' });
        const chats = [['레이드 가실 분~?', 300, 860, 69.84, -3], ['ㄱㄱ!!', 1660, 830, 70.08, 4], ['저 힐 됩니다', 760, 960, 70.31, 2], ['흑화 호두 가즈아!', 1250, 960, 70.55, -2]].map(([s, x, y, t0, r]) => { const b = el('div', 'bubble', root, s); return { b, x, y, t0, r }; });
        slots.forEach(s => sfx(s.t0, 'pop', .8)); chats.forEach(c => sfx(c.t0, 'chat', .9)); sfx(70.78, 'hit', .8);
        return t => {
            slots.forEach((s, i) => { xf(s.c, { x: 400 + i * 280, y: 500, s: popS(t, s.t0, .28), r: [-4, 3, -2, 4, -3][i] + Math.sin(t * 3 + i) }, 250, 322); s.tg.set({ x: 400 + i * 280, y: 690, s: popS(t, s.t0 + .1, .25), r: [3, -3, 2, -2, 3][i] }); });
            chats.forEach(c => { xf(c.b, { x: c.x, y: c.y, s: popS(t, c.t0, .25), r: c.r }, 380, 90); });
            title.place({ x: 960, y: 140, r: -3 }); title.update(t, 70.78, { mode: 'pop', stagger: .03 });
        };
    });

    // ================================================================== H3. titles + season events (71.25 – 75)
    scene('events', 71.23, 75.02, root => {
        fill(root, VIOLET);
        halftone(root, 'rgba(255,255,255,.12)', { size: 26 });
        const ry = rays(root, 2600, 'rgba(255,216,61,.16)');
        const tk = ['t_mega', 't_allstar', 't_dva', 't_mz', 't_newbie', 't_rain', 't_200', 't_300'];
        const R = rng(31);
        const drops = tk.map((k, i) => { const w = 430, h = w * SZ['ui/' + k + '.png'][1] / SZ['ui/' + k + '.png'][0]; return { p: pic(root, A + 'ui/' + k + '.png', w, h), x: 250 + (i % 4) * 470 + (R() - .5) * 50, y: 250 + Math.floor(i / 4) * 290, t0: 71.25 + i * BEAT / 2, r: (R() - .5) * 16 }; });
        const copy1 = popText(root, '칭호를 모아라!', { size: 120, color: YELLOW });
        const lockCard = el('div', 'card', root); css(lockCard, { width: '1000px', height: '529px' });
        const lockIm = img(A + 'ui/lock_art.png', '', lockCard); css(lockIm, { width: '1000px', height: '529px', objectFit: 'cover' });
        const lockTitle = pic(root, A + 'ui/lock_title.png', 620, 620 * SZ['ui/lock_title.png'][1] / SZ['ui/lock_title.png'][0]);
        const girl = sticker(root, 'hero/lockgirl_st.png', 760);
        const bubble = el('div', 'bubble', root, '이번 시즌 한정!');
        const copy2 = popText(root, '매 시즌 새로운 이벤트', { size: 110, color: PAPER, shadowCss: '8px 9px 0 #ff3d7f, 16px 18px 0 #16112b' });
        const pack = pic(root, A + 'items/pack6j.png', 240, 240), coin = pic(root, A + 'ui/coin100.png', 220, 220);
        drops.forEach(d => sfx(d.t0, 'stamp', .6)); sfx(73.125, 'whoosh', 1); sfx(73.2, 'card', 1); sfx(73.6, 'pop', 1); sfx(73.9, 'chat', .9); sfx(74.1, 'sparkle', 1);
        conf.burst({ t: 74.1, x: 960, y: 560, n: 110, speed: 2200, life: 2 });
        return t => {
            ry.set({ x: 960, y: 540, r: t * 15 });
            const out1 = E.inBack(prog(t, 72.9, 73.15));
            drops.forEach(d => { const p = prog(t, d.t0, d.t0 + .35); d.p.set({ x: d.x, y: lerp(-300, d.y, E.outBounce(p)) + out1 * 1400, r: d.r + Math.sin(t * 3 + d.x) * 2, s: t > d.t0 ? 1 : 0 }); });
            copy1.place({ x: 960, y: 880, r: -3, s: 1 - out1 }); copy1.update(t, 72.2, { mode: 'pop', stagger: .04 });
            const inL = E.outBackBig(prog(t, 73.125, 73.45));
            xf(lockCard, { x: 900, y: 520, s: inL, r: -4 + Math.sin(t * 2) * 1.5 }, 1000, 529);
            lockTitle.set({ x: 840, y: 190, s: popS(t, 73.35, .25), r: -5 });
            const gid = idle(t, 8);
            girl.set({ x: 1560, y: 1100 + (1 - E.outBackBig(prog(t, 73.6, 73.95))) * 800 + gid.dy, sx: gid.sx, sy: gid.sy, r: gid.r - 4 }, { shadow: { dx: 16, dy: 14 } });
            xf(bubble, { x: 1560, y: 330, s: popS(t, 73.9, .25), r: 4 }, 330, 90);
            copy2.place({ x: 820, y: 930, r: -2 }); copy2.update(t, 74.1, { mode: 'pop', stagger: .03 });
            pack.set({ x: 260, y: 820, s: popS(t, 73.8, .25), r: -10 + Math.sin(t * 3) * 4 });
            coin.set({ x: 420, y: 280, s: popS(t, 73.95, .25), r: 8 + Math.sin(t * 3) * 4 });
        };
    });

    // ================================================================== I. 07:00 — "…벌써 아침?!" (75 – 82.5)
    scene('morning', 74.98, 82.52, root => {
        const night = fill(root, NIGHT);
        const sky = fill(root, 'linear-gradient(180deg, #7fd3ff 0%, #bfe9ff 55%, #ffe3a8 100%)');
        const sun = disc(root, 420, YELLOW); sun.node.style.border = '14px solid ' + INK;
        const sunRays = rays(root, 1300, 'rgba(255,216,61,.55)');
        const clouds = [[300, 220, 1.2], [1500, 170, 1], [1100, 330, .8]].map(([x, y, s]) => { const c = el('div', 'abs', root); css(c, { width: '320px', height: '110px', borderRadius: '60px', background: '#fff', border: '10px solid ' + INK, boxShadow: '8px 9px 0 ' + INK }); return { c, x, y, s }; });
        const clk = clock(root, 470);
        const tTag = tag(root, 'AM 6:59', YELLOW, { size: 52 });
        const ring1 = onoma(root, '따르릉!!', { t: 75.94, x: 960, y: 170, r: -6, size: 200, color: YELLOW, life: 1.2, shadowCss: '10px 11px 0 #ff3d7f, 20px 22px 0 #16112b' });
        const chibi = sticker(root, 'hero/chibi_st.png', 880);
        const q = popText(root, '…벌써 아침?!', { size: 190, color: PAPER, shadowCss: '10px 11px 0 #ff3d7f, 20px 22px 0 #16112b' });
        const small = pill(root, '딱 한 판만 하려고 했는데…', { size: 46 });
        const sweat = [0, 1, 2].map(i => { const d = el('div', 'abs', root); css(d, { width: '46px', height: '62px', background: '#27c8ff', border: '6px solid ' + INK, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%' }); return d; });
        // second beat: the warning line
        const y2 = fill(root, YELLOW);
        const ht2 = halftone(root, 'rgba(22,17,43,.12)', { size: 26 });
        const tape = el('div', 'abs', root); css(tape, { width: '3000px', height: '96px', background: 'repeating-linear-gradient(-45deg, #ffd83d 0 40px, #16112b 40px 80px)', border: '8px solid #16112b' });
        const warn = tag(root, '주의!', INK, { size: 56, color: YELLOW });
        const w1 = popText(root, '딱 한 판만으론', { size: 150, color: PAPER });
        const w2 = popText(root, '끝나지 않습니다', { size: 170, color: PINK, shadowCss: '9px 10px 0 #16112b' });
        const star = sticker(root, 'hero/star_st.png', 780);
        // final burst of everything
        const flyers = ['mon/a7_10_st.png', 'mon/a7_00_st.png', 'items/eq_115.png', 'fx/phoenix.png', 'mon/a6_01_st.png', 'items/pack5.png', 'fx/stars.png', 'mon/boss_st.png', 'items/eq_122.png', 'fx/clover.png', 'mon/a2_10_st.png', 'items/gold.png', 'fx/cards.png', 'mon/a4b_11_st.png'].map((p, i) => { const [w, h] = size(p, 300); const n = img(A + p, 'abs', root); css(n, { width: w + 'px', height: h + 'px' }); return { n, w, h, ang: i * 2.4, sp: 1 + (i % 3) * .3 }; });
        const spd = speed(root, 'rgba(22,17,43,.6)');
        sfx(75.0, 'stop', 1); [75.0, 75.47].forEach(x => sfx(x, 'tick', 1)); sfx(75.94, 'alarm', 1.2); shakeAt(75.94, 12, 3);
        sfx(76.875, 'scratch', 1.1); sfx(76.9, 'pop', 1); sfx(77.1, 'hit', 1); shakeAt(77.1, 16); sfx(78.28, 'pop', .8);
        sfx(78.75, 'whoosh', 1); sfx(78.8, 'stamp', 1); sfx(79.22, 'hit', 1); sfx(79.69, 'hit', 1.1); shakeAt(79.69, 16); sfx(80.2, 'pop', .9);
        sfx(80.625, 'riser_short', 1.2); for (let i = 0; i < 14; i++) sfx(80.7 + i * .12, 'swish', .45);
        return t => {
            const dayP = E.inOutCubic(prog(t, 75.94, 76.8));
            vis(night, 1 - dayP); vis(sky, dayP);
            sun.set({ x: 1560, y: lerp(1300, 330, E.outBack(prog(t, 76.0, 76.9))), s: 1 });
            sunRays.set({ x: 1560, y: lerp(1300, 330, E.outBack(prog(t, 76.0, 76.9))), r: t * 20, a: dayP });
            clouds.forEach((c, i) => xf(c.c, { x: c.x + (t - 75) * 30 * (i + 1) * (i % 2 ? -1 : 1), y: c.y, s: c.s * popS(t, 76.2 + i * .1, .3) }, 320, 110));
            // clock: 6:59:58 -> 7:00:00 on the beat, then the alarm rings
            const secs = 6 * 3600 + 59 * 60 + 58 + Math.min(2, Math.floor((t - 75.0) / BEAT));
            const ringing = t > 75.94 && t < 77.2;
            const cOut = E.inBack(prog(t, 76.7, 77.0));
            clk.set({ x: 960, y: 560 - cOut * 1200, s: popS(t, 75.0, .3) * (ringing ? 1 + .04 * Math.sin(t * 60) : 1), r: ringing ? Math.sin(t * 70) * 9 : 0 }, secs);
            clk.bells.forEach((b, i) => { b.style.transform = 'rotate(' + ((i ? 38 : -38) + (ringing ? Math.sin(t * 80 + i) * 16 : 0)).toFixed(1) + 'deg)'; });
            tTag.inner.textContent = t >= 75.94 ? 'AM 7:00' : 'AM 6:59';
            tTag.set({ x: 960, y: 880 - cOut * 1200, s: popS(t, 75.1, .25) * (1 + .15 * decay(t, 75.94, 8)), r: -3 });
            ring1.update(t);
            // "...already morning?!"
            const cid = idle(t, 3, 1.3);
            const cin = E.outBackBig(prog(t, 76.875, 77.25));
            chibi.set({ x: 560, y: 1110 + (1 - cin) * 900 + cid.dy, sx: cid.sx * (1 + .1 * spring(t, 77.1, 30, 9)), sy: cid.sy, r: cid.r + noise1(t * 8, 2) * 2 }, { shadow: { dx: 18, dy: 14 } });
            q.place({ x: 1300, y: 480, r: -5 }); q.update(t, 77.1, { mode: 'slam', stagger: .05, dur: .26 });
            small.set({ x: 1300, y: 700, s: popS(t, 78.28, .25), r: 2 });
            sweat.forEach((d, i) => { const t0 = 77.3 + i * .25, dt = (t - t0) % .8; xf(d, { x: 400 + i * 60 + (i === 1 ? 260 : 0), y: 300 + (i === 1 ? -40 : 0) + dt * 90, s: t > t0 ? 1 - prog(dt, .5, .8) : 0 }, 46, 62); });
            // warning line (78.75+)
            const w = t >= 78.75;
            [y2, ht2, tape].forEach(n => vis(n, w ? 1 : 0));
            if (w) tape.style.transform = 'translate(' + (-((t * 300) % 113) - 400).toFixed(1) + 'px, 110px) rotate(-3deg)';
            warn.set({ x: 360, y: 158, s: w ? popS(t, 78.8, .25) : 0, r: -4 });
            w1.place({ x: 1180, y: 430, r: -3 }); w1.update(t, 79.22, { mode: 'pop', stagger: .04 });
            w2.place({ x: 1180, y: 640, r: -3, s: 1 + .04 * Math.sin(t * 7) }); w2.update(t, 79.69, { mode: 'slam', stagger: .05, dur: .26 });
            const sid = idle(t, 6);
            star.set({ x: 380, y: 1100 + (1 - E.outBackBig(prog(t, 79.0, 79.35))) * 900 + sid.dy, sx: sid.sx, sy: sid.sy, r: sid.r, a: w ? 1 : 0 }, { shadow: { dx: 16, dy: 14 } });
            // 80.625+: everything flies at the camera
            const fb = prog(t, 80.625, 82.5);
            vis(spd, t > 80.6 ? .9 : 0); spd.style.transform = 'rotate(' + (t * 80).toFixed(1) + 'deg)';
            flyers.forEach((f, i) => {
                const lt = (fb * 2.2 - i * .1);
                const q2 = clamp(lt);
                const d = E.inCubic(q2) * 1500 * f.sp;
                xf(f.n, { x: 960 + Math.cos(f.ang) * d, y: 540 + Math.sin(f.ang) * d * .7, s: lerp(.2, 2.6, E.inCubic(q2)), r: q2 * 200 * (i % 2 ? 1 : -1), a: lt > 0 && lt < 1 ? 1 : 0 }, f.w, f.h);
            });
        };
    });
    flashAt(82.5, 1, .16);

    // ================================================================== J. end card (82.5 – 90)
    scene('end', 82.48, 90.02, root => {
        fill(root, PAPER);
        halftone(root, 'rgba(255,61,127,.2)', { size: 26, mask: 'radial-gradient(70% 70% at 50% 45%, transparent 45%, #000 90%)' });
        const ry = rays(root, 2600, 'rgba(255,216,61,.35)');
        const bst = burst(root, 980, YELLOW, { n: 16, inner: .8 });
        const logo = popText(root, 'RPGenius', { size: 250, color: PAPER, stroke: 22, shadowCss: '10px 10px 0 #ff3d7f, 20px 20px 0 #2f6bff, 30px 30px 0 #16112b' });
        const tagline = popText(root, '지금, 브라우저에서 바로', { size: 76, color: INK, shadow: false, stroke: 0 });
        const url = pill(root, '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffd83d" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>rpgenius.kro.kr', { size: 50 });
        const cta = el('div', 'btn', root, '▶ 딱 한 판만 하기'); css(cta, { width: '640px', height: '130px', fontSize: '62px', background: PINK, color: PAPER });
        const cursor = el('div', 'abs', root, '<svg width="100" height="118" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15 Z" fill="#fff" stroke="#16112b" stroke-width="2.2" stroke-linejoin="round"/></svg>');
        const fine = el('div', 'abs', root, 'PC · 모바일 브라우저 · 설치 없이 플레이'); css(fine, { fontWeight: 800, fontSize: '30px', color: 'rgba(22,17,43,.6)' });
        const hero = sticker(root, 'hero/star_st.png', 640);
        const girl = sticker(root, 'hero/lockgirl_st.png', 600);
        const bub = el('div', 'bubble', root, '진짜 딱 한 판만~?'); css(bub, { fontSize: '40px' });
        const clk = clock(root, 150);
        const tonight = tag(root, '오늘 밤도?', PINK, { size: 34, color: PAPER });
        sfx(82.5, 'boom', 1.2); sfx(82.52, 'crash', 1); shakeAt(82.5, 24, 6); punchAt(82.5, .05); conf.burst({ t: 82.52, x: 960, y: 360, n: 170, speed: 2600, life: 2.6 });
        sfx(83.2, 'pop', .8); sfx(83.67, 'pop', .9); sfx(84.14, 'pop', 1); sfx(84.84, 'click', 1); sfx(84.9, 'sparkle', 1); conf.burst({ t: 84.9, x: 960, y: 900, n: 90, speed: 1800, life: 2 });
        sfx(85.3, 'chat', .9); sfx(86.25, 'pop', .8); sfx(86.3, 'tick', .6);
        return t => {
            ry.set({ x: 960, y: 420, r: t * 20 });
            bst.set({ x: 960, y: 410, s: popS(t, 82.5, .4) * (1 + .03 * Math.sin(t * 5)), r: t * 12 });
            logo.place({ x: 960, y: 390, r: -4, s: 1 + .02 * Math.sin(t * 3) }); logo.update(t, 82.5, { mode: 'slam', stagger: .03, dur: .28, wave: t > 83.5 ? 5 : 0 });
            tagline.place({ x: 960, y: 620 }); tagline.update(t, 83.2, { mode: 'pop', stagger: .03 });
            url.set({ x: 960, y: 745, s: popS(t, 83.67, .28), r: -1.5 });
            const press = t >= 84.84 ? spring(t, 84.84, 26, 10) : 0;
            xf(cta, { x: 960, y: 900, s: popS(t, 84.14, .3) * (1 + .03 * Math.sin(t * 6)), sx: 1 - .1 * Math.max(0, press), sy: 1 - .16 * Math.max(0, press), r: -1 }, 640, 130);
            const cp = E.inOutCubic(prog(t, 84.3, 84.8));
            xf(cursor, { x: lerp(1900, 1060, cp), y: lerp(1150, 920, cp), s: 1 - .15 * pulse(t, 84.8, .14), a: t > 84.3 && t < 85.6 ? 1 - prog(t, 85.3, 85.6) : 0 }, 100, 118, .1, .08);
            fine.style.transform = 'translate(' + (960 - 300).toFixed(0) + 'px, 1010px)'; vis(fine, prog(t, 85.8, 86.2) * .9);
            const hid = idle(t, 2, 1.2), gid = idle(t, 7, 1.1);
            hero.set({ x: 215, y: 1100 + (1 - E.outBackBig(prog(t, 82.7, 83.1))) * 800 + hid.dy, sx: hid.sx, sy: hid.sy, r: hid.r + 3 }, { shadow: { dx: 16, dy: 14 } });
            girl.set({ x: 1700, y: 1100 + (1 - E.outBackBig(prog(t, 82.85, 83.25))) * 800 + gid.dy, sx: gid.sx, sy: gid.sy, r: gid.r - 3 }, { shadow: { dx: 16, dy: 14 } });
            xf(bub, { x: 1560, y: 520, s: popS(t, 85.3, .25), r: 4 }, 360, 90);
            const tick = Math.floor(t / BEAT);
            clk.set({ x: 1790, y: 110, s: popS(t, 86.25, .3), r: spring(t, tick * BEAT, 20, 9) * 3 }, 23 * 3600 + 58 * 60 + (tick % 60));
            tonight.set({ x: 1790, y: 225, s: popS(t, 86.4, .25), r: -4 });
        };
    });

    window.__scenes = scenes;

    // ------------------------------------------------------------ global render
    function render(t) {
        for (const s of scenes) {
            const on = t >= s.t0 && t < s.t1;
            s.root.style.display = on ? '' : 'none';
            if (on) s.update(t);
        }
        // camera: shakes + zoom punches
        let sx = 0, sy = 0, rot = 0, zoom = 1;
        for (const s of shakes) if (t >= s.t) { const a = s.amp * Math.exp(-(t - s.t) * s.k); sx += noise1(t * 3, 1) * a; sy += noise1(t * 3, 2) * a; rot += noise1(t * 2, 3) * a * .02; }
        for (const p of punches) if (t >= p.t) zoom += p.amt * Math.exp(-(t - p.t) * 7);
        world.style.transform = 'translate(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg) scale(' + zoom.toFixed(4) + ')';
        conf.draw(t);
        wp.draw(t);
        drawHud(t);
        let fa = 0, fc = '#fff';
        for (const f of flashes) if (t >= f.t - .02) { const a = f.a * Math.exp(-Math.max(0, t - f.t) / f.d) * (t < f.t ? prog(t, f.t - .02, f.t) : 1); if (a > fa) { fa = a; fc = f.color; } }
        flashEl.style.opacity = clamp(fa).toFixed(3); flashEl.style.background = fc;
        fadeEl.style.opacity = (t < .12 ? 1 - prog(t, 0, .12) : 0) + (t > 89 ? prog(t, 89, 90) : 0);
    }
    window.seek = async t => { K.pending.length = 0; render(t); await Promise.all(K.pending); return true; };
    // fonts + every image (including mask sources) must be ready before the first frame
    const preload = [...new Set(P.masks)].map(src => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = src; }));
    window.ready = Promise.all([document.fonts.load('400 80px BHS', '가나다 RPGenius'), document.fonts.load('900 40px Pretendard', '가나다'), ...K.loaders, ...preload])
        .then(() => document.fonts.ready).then(() => true);
    window.exportCues = () => JSON.stringify(CUES);
})();
