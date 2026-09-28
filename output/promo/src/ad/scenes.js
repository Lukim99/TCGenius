// RPGenius web film — 60 s, 1920x1080. Every scene is a pure function of global time t.
(function () {
    'use strict';
    const { W, H, clamp, lerp, prog, E, tw, kf, env, rng, noise1, el, css, px, setT, T, vis, blur, kinetic, comma, img, clipFrame, browserFrame, shotIn, viewRing, phoneFrame } = K;
    const A = '../assets/';
    const SHOT = n => A + 'shots/' + n + '.png';
    const CLIP = n => A + 'clips/' + n;
    const MAN = window.CLIPMAN || {};
    const CUES = window.CUES;
    const stage = document.getElementById('scenes');
    const world = document.getElementById('world');
    const bgLayer = document.getElementById('bg');
    const flashEl = document.getElementById('flash');
    const fadeEl = document.getElementById('fade');
    const grainEl = document.getElementById('grain');
    const fxHost = document.getElementById('fx');
    const fx = K.particles(fxHost);


    // ------------------------------------------------------------ helpers
    const scenes = [];
    function scene(name, t0, t1, build) {
        const root = el('div', 'scene', stage);
        root.dataset.name = name;
        const s = { name, t0, t1, root };
        s.update = build(root, s) || (() => {});
        scenes.push(s);
        return s;
    }
    // frame index into a captured clip: marks by label (nth occurrence), fps from manifest
    function mark(clip, label, nth = 0) {
        const m = MAN[clip];
        if (!m) return 0;
        const list = m.marks.filter(x => x.label === label || x.label.startsWith(label + ':') || (label === 'beat' && /^(attack|skill)/.test(x.label) && !x.label.includes('rejected')));
        return (list[nth] || list[list.length - 1] || { frame: 0 }).frame;
    }
    function clipFps(clip) { return (MAN[clip] && MAN[clip].fps) || 60; }
    function clipLen(clip) { return (MAN[clip] && MAN[clip].frames) || 1; }
    // play a clip segment: from frame f0 at time ta, speed (1 = realtime)
    function playClip(node, clip, t, ta, f0, speed = 1, fEnd) {
        const f = f0 + Math.max(0, t - ta) * clipFps(clip) * speed;
        const last = fEnd != null ? fEnd : clipLen(clip) - 1;
        clipFrame(node, CLIP(clip), Math.min(Math.floor(f), last));
    }
    // speed ramp for one recorded beat (frames m..last): normal speed on the attack and recovery, fast through the
    // game's white hit-flash frames w = [w0, w1] (360-520 ms in the real game), filling exactly D seconds from time b
    function beatKeys(clip, b, D, m, w, last = m + 30, sW = 2.5) {
        const fps = clipFps(clip), L = E.linear;
        if (!w) return [[b, m], [b + D, Math.min(last, m + D * fps), L]];
        const nA = w[0] - m, wf = (w[1] + 1 - w[0]) / (fps * sW);
        const s = Math.min(1, (nA + last - w[1] - 1) / (fps * (D - wf)));
        const tA = b + nA / (fps * s), tB = tA + wf;
        return [[b, m], [tA, w[0], L], [tB, w[1] + 1, L], [b + D, w[1] + 1 + (b + D - tB) * fps * s, L]];
    }
    function rampClip(node, clip, t, keys) { clipFrame(node, CLIP(clip), Math.floor(kf(t, keys))); }
    function text(parent, cls, html, x, y, anchor) {
        const node = el('div', 'abs ' + cls, parent, html);
        css(node, { left: x + 'px', top: y + 'px' });
        if (anchor === 'center') node.style.transform = 'translateX(-50%)';
        return node;
    }
    // Title block: eyebrow + multi-line kinetic headline + sub, anchored at (x, y)
    function titleBlock(parent, x, y, o) {
        const box = el('div', 'abs', parent);
        css(box, { left: x + 'px', top: y + 'px', width: (o.width || 900) + 'px', textAlign: o.align || 'left' });
        const eb = o.eyebrow ? el('div', 'eyebrow', box, o.eyebrow) : null;
        if (eb && o.align === 'center') eb.style.display = 'inline-block';
        const lines = (o.lines || []).map((line, i) => {
            const k = kinetic(box, line, 'headline shadow ' + (o.gold && o.gold[i] ? 'gold glow' : ''), { gold: !!(o.gold && o.gold[i]), stagger: o.stagger || .03, dur: o.dur || .6 });
            if (o.size) k.node.style.fontSize = o.size + 'px';
            k.node.style.marginTop = i === 0 ? (eb ? '18px' : '0') : '-4px';
            return k;
        });
        const sub = o.sub ? el('div', 'sub shadow', box, o.sub) : null;
        if (sub) sub.style.marginTop = '26px';
        return {
            box, eb, lines, sub,
            update(t, t0, tOut, outDur = .35) {
                if (eb) { const p = prog(t, t0, t0 + .5); vis(eb, E.outCubic(p) * (1 - prog(t, tOut, tOut + outDur))); eb.style.letterSpacing = lerp(.8, .42, E.outExpo(p)).toFixed(3) + 'em'; }
                lines.forEach((k, i) => k.update(t, t0 + .12 + i * .16, { mode: o.mode || 'rise', out: [tOut, outDur], shine: o.shine ? prog(t, t0 + .5, t0 + 1.6) : null }));
                if (sub) { const p = prog(t, t0 + .45, t0 + 1.0); vis(sub, E.outCubic(p) * (1 - prog(t, tOut, tOut + outDur))); sub.style.transform = 'translateY(' + ((1 - E.outExpo(p)) * 24).toFixed(1) + 'px)'; }
            }
        };
    }
    function chip(parent, html, x, y) { const c = el('div', 'abs chip', parent, html); css(c, { left: x + 'px', top: y + 'px' }); return c; }
    function popIn(node, t, t0, dur = .45, from = .6) { const p = prog(t, t0, t0 + dur); vis(node, E.outQuad(p)); return lerp(from, 1, E.outBack(p)); }

    // camera shake from impacts
    function shake(t) {
        let a = 0;
        for (const ti of CUES.impacts) if (t >= ti) a += (ti === 16 || ti === 40 || ti === 52 ? 16 : 9) * Math.exp(-(t - ti) * 7);
        for (const ti of CUES.hits) if (t >= ti) a += 4 * Math.exp(-(t - ti) * 10);
        return { x: noise1(t * 3, 1) * a, y: noise1(t * 3, 2) * a, r: noise1(t * 2, 3) * a * .02 };
    }
    function flashAmount(t) {
        let f = 0;
        const add = (ti, s, d) => { if (t >= ti - .02) f = Math.max(f, s * Math.exp(-Math.max(0, t - ti) / d) * (t < ti ? prog(t, ti - .02, ti) : 1)); };
        add(3.0, 1, .1); add(5.5, .5, .1); add(12.45, .32, .09); add(16.0, .95, .085); add(40.0, .95, .09); add(52.0, .9, .16);
        for (const ti of [8.0, 10.5, 11.0, 13.0, 20.0, 22.0, 26.0, 29.0, 32.0, 43.5, 46.5]) add(ti, .28, .07);
        for (let k = 0; k < 16; k++) add(50 + k * .125, k % 4 === 0 ? .5 : .18, .04);
        return clamp(f);
    }

    // ------------------------------------------------------------ background
    const blobs = [
        { c: 'rgba(232,176,75,.16)', r: 520, x: .25, y: .3, sx: .07, sy: .05 },
        { c: 'rgba(120,80,220,.12)', r: 620, x: .78, y: .65, sx: .05, sy: .06 },
        { c: 'rgba(60,140,255,.08)', r: 480, x: .6, y: .15, sx: .06, sy: .04 },
        { c: 'rgba(255,90,60,.07)', r: 420, x: .15, y: .85, sx: .04, sy: .07 }
    ].map(b => { const n = el('div', 'blob', bgLayer); css(n, { width: b.r * 2 + 'px', height: b.r * 2 + 'px', background: 'radial-gradient(circle, ' + b.c + ' 0%, ' + b.c.replace(/[\d.]+\)$/, m => (parseFloat(m) * .45).toFixed(3) + ')') + ' 32%, transparent 68%)' }); return Object.assign(b, { n }); });
    const grid = el('div', 'grid', bgLayer);
    function updateBg(t) {
        blobs.forEach((b, i) => { const x = (b.x + Math.sin(t * b.sx * 2 + i) * .08) * W - b.r, y = (b.y + Math.cos(t * b.sy * 2 + i * 2) * .07) * H - b.r; b.n.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; });
        grid.style.transform = 'perspective(1200px) rotateX(58deg) translateY(' + ((t * 40) % 96).toFixed(1) + 'px) scale(2.2)';
        grid.style.opacity = (.06 + .03 * Math.sin(t)).toFixed(3);
    }

    // ============================================================ S1 — text-era hook (0 – 3.1)
    const CHAT = window.CHATLOG || [
        { who: 'me', text: '/rpg 필드입장 월도랜드5', t: .3, type: .5 },
        { who: 'bot', text: '⚔️ 월도랜드5 필드에 입장했습니다.\n권장 전투력 ⚔️ 316,723', t: .95 },
        { who: 'me', text: '/rpg 공격', t: 1.35, type: .22 },
        { who: 'bot', text: '💥 치명타! 84,541 피해\n☠️ 18마리 처치 · 🪙 +134,846', t: 1.85 }
    ];
    scene('hook', 0, 3.1, root => {
        const col = el('div', 'abs', root); css(col, { left: '560px', top: '140px', width: '800px', height: '700px', transformOrigin: '50% 40%' });
        const head = el('div', 'abs', col, '<span style="display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f7d98f,#b07a1f);color:#1f1503;font:900 24px Cinzel">R</span><span style="margin-left:14px;font-weight:800;font-size:26px;vertical-align:middle">RPGenius 개인 채팅</span><span style="margin-left:12px;font-size:18px;color:#9aa3b2;vertical-align:middle">봇 명령어</span>');
        css(head, { left: '0', top: '0' });
        const rule = el('div', 'abs', col); css(rule, { left: '0', top: '64px', width: '800px', height: '1px', background: 'linear-gradient(90deg,rgba(232,176,75,.5),transparent)' });
        let y = 96;
        const bubbles = CHAT.map(m => {
            const b = el('div', 'abs', col);
            const me = m.who === 'me';
            const lines = m.text.split('\n').length;
            css(b, {
                top: y + 'px', [me ? 'right' : 'left']: '0', maxWidth: '640px', padding: '16px 22px', borderRadius: me ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                background: me ? 'linear-gradient(180deg,#3a2c12,#2a200d)' : '#15181f', border: '1px solid ' + (me ? 'rgba(232,176,75,.55)' : '#2a2e37'),
                color: me ? '#ffe4a6' : '#dfe3ea', fontSize: '28px', fontWeight: me ? 800 : 600, lineHeight: '1.45', whiteSpace: 'pre', fontFamily: me ? 'ui-monospace, "SFMono-Regular", Menlo, monospace' : 'Pretendard'
            });
            if (!me) { const tag = el('div', '', b, 'RPGenius'); css(tag, { fontSize: '16px', fontWeight: 800, color: '#e8b04b', marginBottom: '4px', fontFamily: 'Pretendard', letterSpacing: '.04em' }); }
            const body = el('span', '', b); body.textContent = me ? '' : m.text;
            y += (me ? 76 : 52 + lines * 41) + 18;
            return { b, body, m, me };
        });
        // typing clicks → cue sheet
        CHAT.filter(m => m.who === 'me').forEach(m => { const n = Array.from(m.text).length; for (let i = 0; i < n; i++) CUES.typing.push(+(m.t + (i / n) * m.type).toFixed(3)); });
        const line = kinetic(root, '채팅창 속 텍스트로만 즐기던 RPG가', 'headline shadow', { stagger: .028, dur: .5 });
        css(line.node, { position: 'absolute', left: '0', width: '1920px', top: '880px', textAlign: 'center', fontSize: '66px', fontWeight: 800, letterSpacing: '-.03em' });
        // chromatic ghost copies for the glitch
        const ghostR = col.cloneNode(true), ghostC = col.cloneNode(true);
        [ghostR, ghostC].forEach((g, i) => { root.insertBefore(g, col); g.style.mixBlendMode = 'screen'; g.style.filter = i ? 'drop-shadow(0 0 0 #00e5ff) hue-rotate(160deg)' : 'sepia(1) saturate(8) hue-rotate(-40deg)'; });
        return t => {
            bubbles.forEach(({ b, body, m, me }) => {
                const p = prog(t, m.t, m.t + .28);
                vis(b, E.outQuad(p));
                b.style.transform = 'translateY(' + ((1 - E.outBack(p)) * 26).toFixed(1) + 'px) scale(' + lerp(.94, 1, E.outBack(p)).toFixed(3) + ')';
                b.style.transformOrigin = me ? '100% 100%' : '0 100%';
                if (me) { const chars = Array.from(m.text); const k = Math.floor(clamp((t - m.t) / m.type) * chars.length); body.textContent = chars.slice(0, k).join('') + (t < m.t + m.type + .15 && Math.floor(t * 8) % 2 === 0 ? '▍' : ''); }
            });
            vis(head, E.outCubic(prog(t, 0, .35)));
            line.update(t, 1.95, { mode: 'rise' });
            // glitch + push-in towards the flash at 3.0
            const g = prog(t, 2.5, 3.0);
            const z = (1.22 + .06 * E.inOutQuad(prog(t, 0, 2.5))) * (1 + E.inExpo(g) * .35);
            const jx = g > 0 ? noise1(t * 9, 4) * 26 * g : 0;
            setT(col, { x: jx, y: 60, s: z });
            blur(col, E.inExpo(g) * 8);
            [ghostR, ghostC].forEach((gh, i) => { vis(gh, g * .6); setT(gh, { x: jx + (i ? -1 : 1) * 14 * g, y: 60 + (i ? 3 : -3) * g, s: z }); gh.style.transformOrigin = '50% 40%'; });
            vis(root, 1 - prog(t, 3.0, 3.1));
        };
    });

    // ============================================================ S2 — reveal: 이제, 웹에서 (2.95 – 4.6)
    const FIELD = 'field';
    scene('reveal', 2.95, 4.62, root => {
        const shot = el('img', 'full', root);
        const scrim = el('div', 'scrim', root); scrim.style.background = 'radial-gradient(60% 55% at 50% 48%, rgba(0,0,0,.55), rgba(0,0,0,.1) 70%, transparent)';
        const l1 = kinetic(root, '이제,', 'headline shadow', { stagger: .04 }); css(l1.node, { position: 'absolute', left: '0', width: '1920px', top: '332px', textAlign: 'center', fontSize: '84px', fontWeight: 800 });
        const l2 = kinetic(root, '웹에서 펼쳐진다', 'headline gold glow', { gold: true, stagger: .045, dur: .5 }); css(l2.node, { position: 'absolute', left: '0', width: '1920px', top: '430px', textAlign: 'center', fontSize: '168px' });
        return t => {
            playClip(shot, FIELD, t, 3.0, mark(FIELD, 'beat', 0), .65);
            const s = 1.18 - .18 * E.outExpo(prog(t, 3.0, 3.6)) + .03 * prog(t, 3.6, 4.6);
            setT(shot, { s }); blur(shot, (1 - prog(t, 3.0, 3.25)) * 10);
            l1.update(t, 3.1, { mode: 'slam', out: [4.3, .2] });
            l2.update(t, 3.22, { mode: 'slam', out: [4.3, .2], shine: prog(t, 3.6, 4.3) });
            vis(scrim, 1 - prog(t, 4.3, 4.5));
        };
    });

    // ============================================================ S3 — browser pull-back + logo (4.55 – 8.1)
    scene('logo', 4.55, 8.12, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const bf = browserFrame(wrap, 1400, 56 + 787.5);
        const clip = el('img', '', bf.view); css(clip, { width: '1400px', height: '787.5px' });
        const rays = el('div', 'abs', root); css(rays, { left: '360px', top: '-180px', width: '1200px', height: '1200px', borderRadius: '50%', background: 'repeating-conic-gradient(from 0deg, rgba(255,214,140,.16) 0deg 4deg, transparent 4deg 15deg)', maskImage: 'radial-gradient(circle, #000 0%, transparent 62%)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, transparent 62%)' });
        const glow = el('div', 'abs', root); css(glow, { left: '560px', top: '160px', width: '800px', height: '500px', background: 'radial-gradient(closest-side, rgba(232,176,75,.35), transparent)', filter: 'blur(20px)' });
        const eyebrow = text(root, 'eyebrow', 'NOW ON THE WEB', 960, 318, 'center');
        const logo = el('div', 'abs logo gold glow', root, 'rp<span class="big">G</span>enius');
        css(logo, { left: '0', width: '1920px', top: '360px', textAlign: 'center', fontSize: '196px' });
        const tag = kinetic(root, '설치 없이, 브라우저 하나로', 'sub shadow', { stagger: .03 }); css(tag.node, { position: 'absolute', left: '0', width: '1920px', top: '640px', textAlign: 'center', fontSize: '46px', fontWeight: 700 });
        const url = 'rpgenius.kro.kr';
        for (let i = 0; i < url.length; i++) CUES.typing.push(+(4.95 + i * .028).toFixed(3));
        return t => {
            // frame: full-bleed (s = 1920/1400) → framed, then drops back behind the logo
            const p = E.inOutCubic(prog(t, 4.55, 5.35));
            const q = E.inOutCubic(prog(t, 5.35, 6.0));
            const s0 = 1920 / 1400;
            const s = lerp(s0, .86, p) * lerp(1, .74, q);
            const x = (1920 - 1400) / 2, yBar = -56 * s0 + (1080 - 787.5 * s0) / 2;
            const y = lerp(yBar - (1080 - 787.5 * s0) / 2 + (1080 - 787.5) / 2 - 56 * 0, (1080 - 843.5) / 2, p) + q * 250;
            css(bf.root, { left: x + 'px', top: '0px' });
            setT(bf.root, { persp: 2400, y: lerp(-56 * s0 * 1 + (1080 - 787.5 * s0) / 2 - (1080 - 843.5) / 2 * 0, 0, 0) + y, rx: lerp(0, 9, p) + q * 12, ry: lerp(0, -6, p), s });
            bf.root.style.transformOrigin = '50% 0%';
            bf.root.style.filter = 'brightness(' + lerp(1, .42, q).toFixed(3) + ')' + (q > 0 ? ' blur(' + (q * 2).toFixed(2) + 'px)' : '');
            bf.glareAt(prog(t, 4.9, 6.2));
            const n = Math.floor(clamp((t - 4.95) / (url.length * .028)) * url.length);
            bf.setUrl(url.slice(0, t < 4.95 ? url.length : n), n >= url.length ? '/?tab=사냥' : '', t > 4.9 && t < 5.6 && Math.floor(t * 8) % 2 === 0);
            playClip(clip, FIELD, t, 4.55, mark(FIELD, 'beat', 1), .8);
            // logo
            const lp = prog(t, 5.5, 6.1);
            vis(logo, E.outQuad(prog(t, 5.45, 5.7)) * (1 - E.inCubic(prog(t, 7.7, 8.1))));
            const ls = lerp(1.35, 1, E.outExpo(lp)) * lerp(1, 1.7, E.inExpo(prog(t, 7.7, 8.1)));
            setT(logo, { s: ls }); blur(logo, (1 - E.outExpo(lp)) * 18 + E.inExpo(prog(t, 7.7, 8.1)) * 14, 'drop-shadow(0 0 30px rgba(232,176,75,.45))');
            vis(rays, prog(t, 5.5, 6.2) * .9 * (1 - prog(t, 7.7, 8.0))); setT(rays, { rz: t * 12 });
            vis(glow, prog(t, 5.5, 5.9) * (1 - prog(t, 7.7, 8.0)));
            vis(eyebrow, E.outCubic(prog(t, 5.75, 6.2)) * (1 - prog(t, 7.6, 7.8)));
            eyebrow.style.letterSpacing = lerp(.9, .42, E.outExpo(prog(t, 5.75, 6.6))).toFixed(3) + 'em';
            tag.update(t, 6.05, { mode: 'rise', out: [7.6, .25] });
            vis(bf.root, 1 - prog(t, 7.75, 8.05));
        };
    });

    // ============================================================ S4 — character / profile (7.9 – 10.6)
    scene('profile', 7.9, 10.62, root => {
        const wrap = el('div', 'abs persp p3d', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const bf = browserFrame(wrap, 1180, 56 + 737.5, { path: '/?tab=info' });
        css(bf.root, { left: '640px', top: '150px' });
        const shot = shotIn(bf.view, SHOT('profile'), 2880, 1180);
        const tb = titleBlock(root, 128, 318, { eyebrow: 'CHARACTER', lines: ['키울수록', '강해진다'], gold: [false, true], sub: '레벨 · 장비 · 카드 · 펫 · 칭호', size: 112 });
        const cp = el('div', 'abs', root); css(cp, { left: '0', top: '0', padding: '18px 30px 14px', borderRadius: '22px', background: 'rgba(10,11,14,.72)', border: '1px solid rgba(232,176,75,.35)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' });
        cp.innerHTML = '<div class="eyebrow" style="font-size:18px">COMBAT POWER</div><div class="cpn" style="font-weight:900;font-size:92px;letter-spacing:-.03em;line-height:1.05;margin-top:4px"></div>';
        const cpn = cp.querySelector('.cpn'); cpn.classList.add('gold');
        const ring = viewRing(bf.view, shot, 720, 610, 436, 96);
        const chips = [chip(root, '<b>+15</b> 초월 3단계', 0, 0), chip(root, '<b>신화</b> 장비', 0, 0), chip(root, '<b>Ω</b> 프레스티지 카드', 0, 0)];
        return t => {
            const f = E.outExpo(prog(t, 7.9, 8.5));
            setT(bf.root, { persp: 2000, x: lerp(260, 0, f), ry: lerp(-24, -9, f) + Math.sin(t * .8) * 1.2, rx: 3, z: lerp(-300, 0, f) });
            bf.root.style.transformOrigin = '0% 50%';
            vis(bf.root, f * (1 - prog(t, 10.35, 10.6)));
            // camera inside the page: zoom to 전투력 then scroll to gear
            const zoom = kf(t, [[8.2, 1], [8.7, 1.55, E.inOutCubic], [9.5, 1.55], [9.95, 1, E.inOutCubic]]);
            const scroll = kf(t, [[9.5, 0], [10.4, 420, E.inOutCubic]]);
            shot.set(scroll, zoom, 230, 180);
            bf.glareAt(prog(t, 8.0, 10.2));
            tb.update(t, 8.0, 10.3);
            // combat power counter floating beside the pill
            const cpP = prog(t, 8.45, 9.35);
            vis(cp, E.outQuad(prog(t, 8.4, 8.7)) * (1 - prog(t, 9.6, 9.9)));
            css(cp, { left: '1250px', top: '240px' });
            setT(cp, { y: (1 - E.outBack(prog(t, 8.4, 8.9))) * 30 });
            cpn.textContent = comma(2012821 * E.outCubic(cpP));
            const rp = prog(t, 8.7, 9.0);
            ring.set(scroll, zoom, 230, 180, E.outQuad(rp) * (1 - prog(t, 9.4, 9.6)), lerp(1.25, 1, E.outBack(rp)));
            // chips over the gear list
            chips.forEach((c, i) => { css(c, { left: (1340 + (i % 2) * 70) + 'px', top: (560 + i * 76) + 'px' }); const s = popIn(c, t, 9.75 + i * .12); setT(c, { s, x: (1 - s) * 60 }); if (t > 10.3) vis(c, 1 - prog(t, 10.3, 10.5)); });
        };
    });

    // ============================================================ S5 — card fusion (10.4 – 13.1)
    const FUSION = 'fusion2';
    scene('fusion', 10.4, 13.12, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const bf = browserFrame(wrap, 1180, 56 + 737.5, { path: '/?tab=combine' });
        css(bf.root, { left: '640px', top: '150px' });
        const shot = shotIn(bf.view, SHOT('combine_ready'), 2880, 1180);
        const tb = titleBlock(root, 128, 330, { eyebrow: 'CARD FUSION', lines: ['3장의 카드,', '하나의 운명'], gold: [false, true], sub: '조합 · 전직 · 각성', size: 108 });
        const cine = el('img', 'full', root);
        const scrim = el('div', 'scrim', root); scrim.style.background = 'linear-gradient(20deg, rgba(5,6,8,.82) 0%, rgba(5,6,8,.5) 22%, transparent 42%)';
        const label = text(root, 'eyebrow', 'CARD FUSION · 카드 조합', 96, 960);
        return t => {
            const f = E.outExpo(prog(t, 10.4, 10.9));
            setT(bf.root, { persp: 2000, x: lerp(-200, 0, f), ry: lerp(20, -8, f), rx: 2 });
            bf.root.style.transformOrigin = '0% 50%';
            shot.set(0, kf(t, [[10.5, 1], [11.0, 1.35, E.inCubic]]), 280, 330);
            vis(bf.root, f);
            tb.update(t, 10.45, 10.95, .12);
            // hard cut to the real fusion cinema (60 fps capture) with a speed ramp:
            // lucky glow + gather ~2x, sealing orbit 2.4x, ease into the reveal, reveal at real time (lands on the 12.45 sparkle)
            const on = t >= 11.0;
            vis(cine, on ? 1 : 0);
            if (on) {
                const b = mark(FUSION, 'begin'), L = E.linear;
                clipFrame(cine, CLIP(FUSION), Math.floor(kf(t, [[11.0, b + 20], [11.6, b + 90, L], [12.2, b + 176, L], [12.45, b + 189, L], [13.12, b + 230, L]])));
                setT(cine, { s: lerp(1.12, 1.0, E.outExpo(prog(t, 11.0, 11.6))) + .04 * prog(t, 11.6, 13.1) });
            }
            vis(label, on ? E.outCubic(prog(t, 11.2, 11.6)) * (1 - prog(t, 12.8, 13.0)) : 0);
            vis(scrim, on ? 1 : 0);
        };
    });

    // ============================================================ S6 — enhance +10 (12.9 – 16.05)
    const ENH = 'enhance2';
    scene('enhance', 12.9, 16.05, root => {
        const rays = el('div', 'abs', root); css(rays, { left: '830px', top: '-110px', width: '1300px', height: '1300px', borderRadius: '50%', background: 'repeating-conic-gradient(from 0deg, rgba(255,214,140,.15) 0deg 3deg, transparent 3deg 11deg)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, transparent 60%)', maskImage: 'radial-gradient(circle, #000 0%, transparent 60%)' });
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        // real enhancement window, captured at 480x860 CSS @2x (960x1720)
        const bf = browserFrame(wrap, 500, 56 + 895.8, { path: '/?tab=inventory' });
        css(bf.root, { left: '1230px', top: '60px' });
        const clip = el('img', '', bf.view); css(clip, { width: '500px', height: '895.8px' });
        const eb = text(root, 'eyebrow', 'ENHANCE', 132, 236);
        const big = el('div', 'abs', root); css(big, { left: '118px', top: '268px', fontWeight: 900, fontSize: '270px', letterSpacing: '-.05em', lineHeight: '1' });
        big.classList.add('gold', 'glow');
        const l1 = kinetic(root, '강화 성공의 짜릿함', 'headline shadow', { stagger: .03 }); css(l1.node, { position: 'absolute', left: '124px', top: '572px', fontSize: '80px' });
        const sub = text(root, 'sub shadow', '초월 · 잠재능력 · 장비 합성', 130, 690);
        return t => {
            const f = E.outExpo(prog(t, 12.95, 13.5));
            setT(bf.root, { persp: 2000, x: lerp(260, 0, f), ry: lerp(-26, -10, f) + Math.sin(t * 1.2) * 1.2, rx: 2, s: 1 + .05 * prog(t, 14.4, 15.7) });
            bf.root.style.transformOrigin = '100% 50%';
            vis(bf.root, f * (1 - E.inCubic(prog(t, 15.55, 15.75))));
            const r0 = mark(ENH, 'result');
            playClip(clip, ENH, t, 13.05, Math.max(0, r0 - 18), 1.0);
            const burst = 13.05 + 18 / 60;
            vis(rays, E.outQuad(prog(t, burst, burst + .4)) * .95 * (1 - prog(t, 15.4, 15.7)));
            setT(rays, { rz: t * 14, s: lerp(.7, 1, E.outExpo(prog(t, burst, burst + .8))) });
            // the real roll: +9 -> +10, flipping on the burst
            big.textContent = t < burst ? '+9' : '+10';
            vis(big, E.outQuad(prog(t, 13.05, 13.25)) * (1 - prog(t, 15.5, 15.72)));
            setT(big, { s: 1 + (t >= burst ? .12 * Math.exp(-(t - burst) * 6) : 0) });
            vis(eb, E.outCubic(prog(t, 13.0, 13.35)) * (1 - prog(t, 15.5, 15.7)));
            l1.update(t, 13.9, { out: [15.45, .25] });
            vis(sub, E.outCubic(prog(t, 14.3, 14.7)) * (1 - prog(t, 15.45, 15.65)));
            root.style.filter = 'brightness(' + lerp(1, .55, prog(t, 15.0, 15.75)).toFixed(3) + ')';
        };
    });

    // ============================================================ S7 — DROP: real-time battle (15.95 – 20.1)
    scene('battle', 15.95, 20.12, root => {
        const shot = el('img', 'full', root);
        const slam = kinetic(root, '실시간 전투', 'headline gold glow', { gold: true, stagger: .03, dur: .4 });
        css(slam.node, { position: 'absolute', left: '0', width: '1920px', top: '360px', textAlign: 'center', fontSize: '230px' });
        const scrimL = el('div', 'scrim', root); scrimL.style.background = 'radial-gradient(1250px 520px at 330px 150px, rgba(5,6,8,.8) 0%, rgba(5,6,8,.46) 45%, transparent 100%)';
        const lower = el('div', 'abs', root); css(lower, { left: '96px', top: '118px' });
        lower.innerHTML = '<div class="eyebrow">REAL-TIME WEB BATTLE</div><div class="headline shadow" style="font-size:64px;margin-top:10px">클릭 한 번에 터지는 스킬 · 치명타</div>';
        const beatsAt = [16.0, 17.0, 18.0, 19.0];
        beatsAt.forEach((b, i) => CUES.battle.push({ t: b + .05, kind: i % 2 ? 'skill' : 'hit' }));
        // white hit-flash frames on the player inside each beat (measured from the capture)
        const beatW = [[2, [168, 172]], [3, [196, 208]], [5, [262, 271]], [6, [289, 301]]];
        const keys = beatsAt.map((b, i) => beatKeys(FIELD, b, 1.0, mark(FIELD, 'beat', beatW[i][0]), beatW[i][1]));
        return t => {
            let i = beatsAt.length - 1; while (i > 0 && t < beatsAt[i]) i--;
            const b = beatsAt[i];
            rampClip(shot, FIELD, t, keys[i]);
            setT(shot, { s: 1.07 - .07 * E.outExpo(prog(t, b, b + .35)) });
            slam.update(t, 16.0, { mode: 'slam', out: [16.75, .22] });
            vis(lower, E.outCubic(prog(t, 16.9, 17.3)) * (1 - prog(t, 19.8, 20.05)));
            vis(scrimL, E.outCubic(prog(t, 16.8, 17.3)) * (1 - prog(t, 19.8, 20.05)));
            setT(lower, { x: (1 - E.outExpo(prog(t, 16.9, 17.5))) * -60 });
        };
    });

    // ============================================================ S8 — 28 fields (19.9 – 22.1)
    scene('fields', 19.9, 22.12, root => {
        const plane = el('div', 'abs persp', root); css(plane, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const grid = el('img', '', plane); css(grid, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px' });
        const num = el('div', 'abs gold glow', root, '28'); css(num, { left: '120px', top: '150px', fontWeight: 900, fontSize: '260px', letterSpacing: '-.06em', lineHeight: '1' });
        const t1 = el('div', 'abs headline shadow', root, '개의 필드'); css(t1, { left: '440px', top: '300px', fontSize: '96px' });
        const t2 = text(root, 'sub shadow', '끝없는 사냥, 쏟아지는 보상', 128, 450);
        return t => {
            clipFrame(grid, CLIP(FIELD), mark(FIELD, 'lobby') + 8);
            const p = E.outExpo(prog(t, 19.95, 20.6));
            const z = kf(t, [[20.6, 0], [21.5, 120, E.inOutCubic], [22.1, 900, E.inExpo]]);
            setT(grid, { persp: 1800, rx: lerp(38, 18, p), y: lerp(160, 60, p), z: z - 200 + p * 120, s: .94 });
            grid.style.transformOrigin = '50% 70%';
            blur(grid, E.inExpo(prog(t, 21.6, 22.1)) * 10);
            vis(grid, p);
            const np = prog(t, 20.05, 20.5);
            vis(num, E.outQuad(np) * (1 - prog(t, 21.6, 21.9))); setT(num, { s: lerp(1.6, 1, E.outExpo(np)) }); blur(num, (1 - E.outExpo(np)) * 12);
            vis(t1, E.outCubic(prog(t, 20.25, 20.6)) * (1 - prog(t, 21.6, 21.9))); setT(t1, { x: (1 - E.outExpo(prog(t, 20.25, 20.8))) * 40 });
            vis(t2, E.outCubic(prog(t, 20.5, 20.9)) * (1 - prog(t, 21.6, 21.9)));
        };
    });

    // ============================================================ S9 — hell field boss (21.9 – 26.1)
    const HF = 'hfield';
    scene('hfield', 21.9, 26.12, root => {
        const shot = el('img', 'full', root);
        const scrimH = el('div', 'scrim', root); scrimH.style.background = 'radial-gradient(1250px 520px at 330px 150px, rgba(5,6,8,.8) 0%, rgba(5,6,8,.46) 45%, transparent 100%)';
        const tb = titleBlock(root, 96, 110, { eyebrow: 'HELL FIELD', lines: ['헬 필드 보스전'], gold: [true], sub: '초월 · 신화 등급 보상에 도전하라', size: 84 });
        const beatsAt = [23.5, 24.25, 25.0, 25.5];
        beatsAt.forEach((b, i) => { if (i < 3) CUES.battle.push({ t: b + .05, kind: i === 1 ? 'skill' : 'hit' }); });
        CUES.sparkle.push(25.62);
        // keep ~3 frames of each impact at speed, then whip through the white flash on the boss / pillars
        const b0 = mark(HF, 'beat', 0), b1 = mark(HF, 'beat', 1);
        const keys = [beatKeys(HF, 23.5, .75, b0, [b0 + 3, 99]), beatKeys(HF, 24.25, .75, b1, [b1 + 3, 123])];
        return t => {
            shot.style.transformOrigin = t >= 25.5 ? '50% 42%' : '50% 50%';
            if (t < 23.5) { playClip(shot, HF, t, 22.0, mark(HF, 'entry'), 1.5); setT(shot, { s: 1.04 - .04 * E.outCubic(prog(t, 22.0, 22.6)) }); }
            else {
                let i = beatsAt.length - 1; while (i > 0 && t < beatsAt[i]) i--;
                if (i < 2) rampClip(shot, HF, t, keys[i]);
                else if (i === 2) playClip(shot, HF, t, beatsAt[i], mark(HF, 'beat', i), 1);
                else playClip(shot, HF, t, beatsAt[i], mark(HF, 'beat', i) + 11, 1);   // loot reveal (skips the grey transition)
                if (i < 3) setT(shot, { s: 1.06 - .06 * E.outExpo(prog(t, beatsAt[i], beatsAt[i] + .3)) });
                else setT(shot, { s: lerp(1.3, 1.42, E.outCubic(prog(t, 25.5, 26.1))) });
            }
            tb.update(t, 23.6, 25.8, .25);
            vis(scrimH, E.outCubic(prog(t, 23.5, 23.9)) * (1 - prog(t, 25.8, 26.05)));
        };
    });

    // ============================================================ S10 — PVP (25.9 – 29.1)
    const PVP = 'pvp';
    scene('pvp', 25.9, 29.12, root => {
        const shot = el('img', 'full', root);
        const scrimP = el('div', 'scrim', root); scrimP.style.background = 'radial-gradient(1250px 520px at 330px 150px, rgba(5,6,8,.8) 0%, rgba(5,6,8,.46) 45%, transparent 100%)';
        const tb = titleBlock(root, 96, 110, { eyebrow: 'PVP ARENA', lines: ['PVP 대전'], gold: [true], sub: '매일 새로운 상대와 한판 승부', size: 96 });
        // the capture's middle stretch is under continuous hit flashes (mana-burn ticks), so: start -> one hit -> victory
        const beatsAt = [27.5, 28.4];
        CUES.battle.push({ t: 27.53, kind: 'hit' });
        CUES.sparkle.push(28.45);
        const hit = mark(PVP, 'beat', 1), L = E.linear;
        const hitKeys = [[27.5, hit], [27.6, hit + 3, L], [27.8, 126, L], [28.4, hit + 30, L]];
        return t => {
            if (t < 26.5) { playClip(shot, PVP, t, 26.0, mark(PVP, 'lobby'), 1); setT(shot, { s: lerp(1.15, 1.02, E.outExpo(prog(t, 26.0, 26.5))) }); }
            else if (t < 27.5) { playClip(shot, PVP, t, 26.5, mark(PVP, 'start'), 1.2, mark(PVP, 'attack') - 1); setT(shot, { s: 1.0 }); }
            else {
                let i = beatsAt.length - 1; while (i > 0 && t < beatsAt[i]) i--;
                if (i === 0) rampClip(shot, PVP, t, hitKeys);
                else playClip(shot, PVP, t, beatsAt[i], mark(PVP, 'beat', 2) + 4, 1.4);
                setT(shot, { s: 1.06 - .06 * E.outExpo(prog(t, beatsAt[i], beatsAt[i] + .3)) });
            }
            tb.update(t, 26.15, 28.8, .25);
            vis(scrimP, E.outCubic(prog(t, 26.1, 26.5)) * (1 - prog(t, 28.8, 29.05)));
        };
    });

    // ============================================================ S11 — modes: raid / world boss (28.9 – 32.1)
    scene('modes', 28.9, 32.12, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        // five hunt cards lifted from the real menu capture (2880 px wide @2x): positions in capture px
        const cards = [[262, 270, 758, 438, '일반 필드'], [1064, 270, 758, 438, '헬 필드'], [1864, 270, 758, 438, '일일던전'], [262, 754, 758, 438, '월드보스'], [1064, 754, 758, 438, '레이드']];
        const nodes = cards.map(([sx, sy, sw, sh]) => {
            const c = el('div', 'abs', wrap);
            css(c, { width: '520px', height: (520 * sh / sw) + 'px', borderRadius: '22px', overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.08)' });
            const im = img(SHOT('hunt'), '', c); const k = 520 / sw;
            css(im, { position: 'absolute', width: (2880 * k) + 'px', left: (-sx * k) + 'px', top: (-sy * k) + 'px' });
            return c;
        });
        const tb = titleBlock(root, 0, 96, { eyebrow: 'CONTENTS', lines: ['혼자서도, 함께라면 더'], gold: [true], sub: '최대 5인 파티 레이드 · 월드보스 랭킹', size: 92, align: 'center', width: 1920 });
        // real party roster (5 players, one role each) from the /party page, cropped to its panel
        const pf = browserFrame(wrap, 760, 56 + 660, { path: '/party' });
        css(pf.root, { left: '1060px', top: '290px' });
        const pimg = img(A + 'shots_extra/raid_room2x.png', '', pf.view);
        css(pimg, { position: 'absolute', width: '760px', left: '0px', top: '-175px' });

        return t => {
            const rp = E.outExpo(prog(t, 30.75, 31.3));
            setT(pf.root, { persp: 2000, x: lerp(500, 0, rp), ry: lerp(-30, -10, rp), rx: 3 });
            vis(pf.root, rp * (1 - prog(t, 31.85, 32.1)));

            nodes.forEach((c, i) => {
                const p = E.outExpo(prog(t, 29.0 + i * .09, 29.7 + i * .09));
                const col = i - 2;
                const baseX = 960 - 260 + col * 360, baseY = 470 + Math.abs(col) * 36;
                const focus = i === 4 ? E.inOutCubic(prog(t, 30.6, 31.2)) * .0 : 0;
                const others = E.inOutCubic(prog(t, 30.6, 31.1));
                css(c, { left: baseX + 'px', top: baseY + 'px' });
                const toLeft = i === 4 ? others : 0;
                setT(c, { persp: 1800, y: lerp(400, 0, p) + (i === 4 ? -40 * toLeft : others * 120), z: lerp(-600, -col * col * 60, p) + toLeft * 120, ry: -col * 12 * (1 - toLeft) + toLeft * 14, rz: col * 2.5 * (1 - toLeft), x: toLeft * (150 - baseX) });
                vis(c, p * (i === 4 ? 1 : 1 - others) * (1 - prog(t, 31.85, 32.1)));
                c.style.zIndex = i === 4 ? 5 : 1;
            });
            tb.update(t, 29.15, 31.75, .3);
        };
    });

    // ============================================================ S12 — hot deal shop (31.9 – 34.6)
    scene('shop', 31.9, 34.62, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const bf = browserFrame(wrap, 1260, 56 + 787.5, { path: '/?tab=shop' });
        css(bf.root, { left: '560px', top: '130px' });
        const shot = shotIn(bf.view, SHOT('shop_hotdeal'), 2880, 1260);
        const tb = titleBlock(root, 110, 330, { eyebrow: 'SHOP', lines: ['놓치면 사라지는', '핫딜'], gold: [false, true], sub: '골드 · 가넷 · 포인트 · 마일리지', size: 100 });
        return t => {
            const f = E.outExpo(prog(t, 31.95, 32.5));
            setT(bf.root, { persp: 2000, y: lerp(160, 0, f), rx: lerp(18, 5, f), ry: -9 });
            bf.root.style.transformOrigin = '50% 100%';
            vis(bf.root, f * (1 - prog(t, 34.35, 34.6)));
            shot.set(0, kf(t, [[32.3, 1], [34.4, 1.32, E.inOutCubic]]), 780, 420);
            bf.glareAt(prog(t, 32.1, 34.0));
            tb.update(t, 32.0, 34.3);
        };
    });

    // ============================================================ S13 — player market (34.4 – 37.1)
    scene('market', 34.4, 37.12, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const a = browserFrame(wrap, 800, 56 + 500, { path: '/?tab=auction' });
        const b = browserFrame(wrap, 800, 56 + 500, { path: '/?tab=buyorder' });
        css(a.root, { left: '150px', top: '380px' }); css(b.root, { left: '970px', top: '380px' });
        const sa = shotIn(a.view, SHOT('auction'), 2880, 800), sb = shotIn(b.view, SHOT('buyorder'), 2880, 800);
        const tb = titleBlock(root, 0, 90, { eyebrow: 'MARKET', lines: ['유저가 만드는 거래소'], gold: [true], sub: '팝니다 · 삽니다 — 골드 · 가넷으로 자유롭게', size: 92, align: 'center', width: 1920 });
        return t => {
            const f = E.outExpo(prog(t, 34.45, 35.0));
            setT(a.root, { persp: 2000, x: lerp(-300, 0, f), ry: lerp(30, 14, f), rx: 4 }); a.root.style.transformOrigin = '100% 50%';
            setT(b.root, { persp: 2000, x: lerp(300, 0, f), ry: lerp(-30, -14, f), rx: 4 }); b.root.style.transformOrigin = '0% 50%';
            const out = 1 - prog(t, 36.85, 37.1);
            vis(a.root, f * out); vis(b.root, f * out);
            sa.set(kf(t, [[34.6, 0], [37.0, 520, E.inOutCubic]]), 1);
            sb.set(kf(t, [[34.6, 260], [37.0, 0, E.inOutCubic]]), 1);
            tb.update(t, 34.5, 36.8);
        };
    });

    // ============================================================ S14 — community (36.9 – 40.1)
    scene('community', 36.9, 40.12, root => {
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const r = browserFrame(wrap, 1040, 56 + 650, { path: '/?tab=ranking' });
        const c = browserFrame(wrap, 820, 56 + 512.5, { path: '/?tab=chat' });
        css(r.root, { left: '160px', top: '250px' }); css(c.root, { left: '980px', top: '400px' });
        const sr = shotIn(r.view, SHOT('ranking'), 2880, 1040), sc = shotIn(c.view, SHOT('chat_public'), 2880, 820);
        const crown = viewRing(r.view, sr, 302, 444, 2274, 150, 6);
        const tb = titleBlock(root, 0, 80, { eyebrow: 'COMMUNITY', lines: ['정상을 향해, 함께'], gold: [true], sub: '랭킹 · 실시간 채팅 · 패치노트', size: 92, align: 'center', width: 1920 });
        return t => {
            const f = E.outExpo(prog(t, 36.95, 37.5));
            const push = E.inCubic(prog(t, 38.3, 39.75));
            setT(r.root, { persp: 2000, y: lerp(200, 0, f), ry: 12, rx: 5, z: push * 260 }); r.root.style.transformOrigin = '100% 50%';
            setT(c.root, { persp: 2000, y: lerp(260, 0, E.outExpo(prog(t, 37.15, 37.7))), ry: -14, rx: 3, z: push * 180 }); c.root.style.transformOrigin = '0% 50%';
            vis(r.root, f * (1 - prog(t, 39.6, 39.75))); vis(c.root, E.outExpo(prog(t, 37.15, 37.7)) * (1 - prog(t, 39.6, 39.75)));
            const rz = kf(t, [[37.4, 1], [38.4, 1.28, E.inOutCubic]]);
            sr.set(0, rz, 140, 150);
            sc.set(0, 1);
            crown.set(0, rz, 140, 150, E.outQuad(prog(t, 37.9, 38.2)) * (1 - prog(t, 39.0, 39.3)), lerp(1.08, 1, E.outBack(prog(t, 37.9, 38.3))));
            tb.update(t, 37.0, 39.5, .25);
            root.style.filter = 'brightness(' + (1 + .35 * push).toFixed(3) + ')';
        };
    });

    // ============================================================ S15 — events (39.9 – 43.6)
    const LOCK = 'lockbox_video';
    scene('events', 39.9, 43.62, root => {
        const vid = el('img', 'full', root);
        const wrap = el('div', 'abs persp', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const f1 = browserFrame(wrap, 1100, 56 + 687.5, { path: '/?tab=자물쇠' });
        const f2 = browserFrame(wrap, 1100, 56 + 687.5, { path: '/?tab=윷놀이' });
        css(f1.root, { left: '410px', top: '120px' }); css(f2.root, { left: '410px', top: '120px' });
        const s1 = shotIn(f1.view, SHOT('lockbox'), 2880, 1100);
        const s2 = shotIn(f2.view, A + 'shots_extra/yut.png', 1440, 1100);
        const slam = kinetic(root, '시즌마다 새로운 이벤트', 'headline gold glow', { gold: true, stagger: .03, dur: .4 });
        css(slam.node, { position: 'absolute', left: '0', width: '1920px', top: '420px', textAlign: 'center', fontSize: '140px' });
        const cap = el('div', 'abs', root); css(cap, { left: '0', width: '1920px', top: '906px', textAlign: 'center' });
        cap.innerHTML = '<span class="eyebrow" style="display:inline-block">EVENTS</span>';
        const labels = ['봉인된 자물쇠', '윷놀이', '추석 보름달'];
        const lab = el('div', 'abs headline shadow', root); css(lab, { left: '0', width: '1920px', top: '940px', textAlign: 'center', fontSize: '60px' });
        return t => {
            // 40.0 – 40.9: lockbox opening video burst full-bleed
            const vOn = t < 40.95;
            vis(vid, vOn ? 1 : 0);
            if (vOn) { playClip(vid, LOCK, t, 39.9, 250, 1.6); setT(vid, { s: 1.12 - .12 * E.outExpo(prog(t, 40.0, 40.6)) }); }
            slam.update(t, 40.02, { mode: 'slam', out: [40.7, .2] });
            const p1 = E.outExpo(prog(t, 40.9, 41.4)), p2 = E.outExpo(prog(t, 42.1, 42.6));
            setT(f1.root, { persp: 2000, x: lerp(500, 0, p1) - p2 * 700, ry: lerp(-30, -6, p1) + p2 * 20, rx: 3 });
            vis(f1.root, p1 * (1 - p2));
            s1.set(0, kf(t, [[41.0, 1.0], [42.2, 1.15]]), 550, 344);
            setT(f2.root, { persp: 2000, x: lerp(700, 0, p2), ry: lerp(-30, -6, p2), rx: 3 });
            vis(f2.root, p2 * (1 - prog(t, 43.3, 43.6)));
            s2.set(0, kf(t, [[42.2, 1.0], [43.5, 1.1]]), 550, 344);
            const which = t < 42.1 ? 0 : 1;
            lab.textContent = labels[which];
            vis(lab, t > 40.95 ? (E.outCubic(prog(t, which ? 42.2 : 41.0, which ? 42.5 : 41.3)) * (which ? 1 - prog(t, 43.3, 43.55) : 1 - prog(t, 41.95, 42.1))) : 0);
            vis(cap, t > 40.95 ? 1 - prog(t, 43.3, 43.55) : 0);
        };
    });

    // ============================================================ S16 — collection wall (43.4 – 46.6)
    scene('collection', 43.4, 46.62, root => {
        const wrap = el('div', 'abs persp p3d', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const tiles = [
            ['inventory_items', 180, 250, 1120, 700], ['dex_character', 180, 250, 1120, 700], ['inventory_equipment', 180, 230, 1120, 700],
            ['profile_cards', 190, 1230, 1120, 700], ['dex_weapon', 180, 250, 1120, 700], ['inventory_pets', 180, 250, 1120, 700]
        ].map(([n, sx, sy, sw, sh], i) => {
            const c = el('div', 'abs', wrap);
            css(c, { width: '600px', height: (600 * sh / sw) + 'px', borderRadius: '18px', overflow: 'hidden', background: '#101216', boxShadow: '0 30px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(232,176,75,.18)' });
            const im = img(SHOT(n), '', c); const k = 600 / sw;
            css(im, { position: 'absolute', width: (2880 * k) + 'px', left: (-sx * 2 * k) + 'px', top: (-sy * 2 * k) + 'px' });
            return c;
        });
        const tb = titleBlock(root, 0, 60, { eyebrow: 'COLLECTION', lines: ['수백 종의 장비 · 카드 · 펫'], gold: [true], size: 88, align: 'center', width: 1920 });
        return t => {
            const orbit = kf(t, [[43.5, 26], [46.5, -14, E.inOutQuad]]);
            tiles.forEach((c, i) => {
                const col = i % 3, row = Math.floor(i / 3);
                const p = E.outExpo(prog(t, 43.5 + i * .07, 44.2 + i * .07));
                const x = 960 - 300 + (col - 1) * 640, y = 330 + row * 400;
                css(c, { left: x + 'px', top: y + 'px' });
                setT(c, { persp: 1600, x: (col - 1) * -40 * (1 - p), z: lerp(-900, -Math.abs(col - 1) * 180, p), ry: (col - 1) * -22 + orbit * .6, rx: (row - .5) * 8, y: lerp(120, 0, p) });
                vis(c, p * (1 - prog(t, 46.35, 46.6)));
            });
            tb.update(t, 43.55, 46.3, .25);
        };
    });

    // ============================================================ S17 — devices: PC + mobile (46.4 – 50.1)
    scene('devices', 46.4, 50.12, root => {
        const wrap = el('div', 'abs persp p3d', root); css(wrap, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const bf = browserFrame(wrap, 1060, 56 + 662.5, { path: '/?tab=info' });
        css(bf.root, { left: '140px', top: '250px' });
        const sp = shotIn(bf.view, SHOT('profile'), 2880, 1060);
        const phones = ['m_field', 'm_profile'].map((n, i) => {
            const ph = phoneFrame(wrap, 390, 844);
            css(ph.root, { left: (1240 + i * 300) + 'px', top: (150 + i * 40) + 'px' });
            const s = shotIn(ph.screen, SHOT(n), 1170, 358);
            return { ph, s };
        });
        const tb = titleBlock(root, 0, 60, { eyebrow: 'PC · MOBILE', lines: ['PC에서도, 모바일에서도'], gold: [true], sub: '설치 없이 브라우저로 어디서나', size: 92, align: 'center', width: 1920 });
        return t => {
            const f = E.outExpo(prog(t, 46.45, 47.0));
            setT(bf.root, { persp: 2200, x: lerp(-400, 0, f), ry: lerp(30, 14, f), rx: 4 }); bf.root.style.transformOrigin = '100% 50%';
            vis(bf.root, f * (1 - prog(t, 49.8, 50.1)));
            sp.set(kf(t, [[47.2, 0], [49.8, 380, E.inOutCubic]]), 1);
            phones.forEach(({ ph, s }, i) => {
                const p = E.outExpo(prog(t, 46.7 + i * .15, 47.3 + i * .15));
                setT(ph.root, { persp: 2200, y: lerp(700, 0, p) + Math.sin(t * 1.6 + i) * 8, ry: lerp(-40, -16 + i * 4, p), rz: i ? 3 : -2, s: .86 });
                vis(ph.root, p * (1 - prog(t, 49.8, 50.1)));
                s.set(i === 1 ? kf(t, [[47.6, 0], [49.8, 600, E.inOutCubic]]) : 0, 1);
            });
            tb.update(t, 46.55, 49.7, .3);
        };
    });

    // ============================================================ S18 — hyper montage (49.9 – 52.05)
    scene('montage', 49.95, 52.02, root => {
        const a = el('img', 'full', root);
        const list = [
            ['clip', FIELD, 'beat', 2], ['shot', 'profile_cards'], ['clip', HF, 'beat', 1, 14], ['shot', 'lockbox'],
            ['clip', FUSION, 'begin', 0, 150], ['shot', 'shop_hotdeal'], ['clip', PVP, 'beat', 1, 17], ['shot', 'dex_character'],
            ['clip', FIELD, 'beat', 5], ['shot', 'ranking'], ['clip', FUSION, 'begin', 0, 200], ['shot', 'm_hunt'],
            ['clip', HF, 'beat', 3, 18], ['shot', 'hunt'], ['clip', LOCK, null, 330], ['clip', FIELD, 'beat', 0]
        ];
        return t => {
            const k = clamp(Math.floor((t - 50.0) / .125), 0, list.length - 1);
            const it = list[k];
            const local = t - (50.0 + k * .125);
            if (it[0] === 'clip') {
                const f0 = it[2] ? mark(it[1], it[2], it[3]) + (it[4] || 8) : it[3];
                clipFrame(a, CLIP(it[1]), f0 + Math.floor(local * clipFps(it[1])));
                css(a, { objectFit: 'cover', objectPosition: '50% 50%' });
            } else {
                if (a.dataset.src !== SHOT(it[1])) { a.dataset.src = SHOT(it[1]); a.src = SHOT(it[1]); K.pending.push(a.decode().catch(() => {})); }
                css(a, { objectFit: 'cover', objectPosition: '50% 0%' });
            }
            setT(a, { s: 1.14 - .1 * E.outExpo(clamp(local / .125)), rz: (k % 2 ? 1 : -1) * .6 });
            blur(a, (1 - clamp(local / .06)) * 6);
            vis(root, t < 51.9 ? 1 : 0);
        };
    });

    // ============================================================ S19 — end card (51.95 – 60)
    scene('end', 51.95, 60.01, root => {
        const wall = el('div', 'abs persp p3d', root); css(wall, { left: '0', top: '0', width: '1920px', height: '1080px' });
        const names = ['profile', 'hunt', 'shop_hotdeal', 'ranking', 'lockbox', 'inventory_cards', 'auction', 'dex_character', 'combine_ready', 'profile_cards', 'chat_public', 'shop_package'];
        const tiles = names.map((n, i) => {
            const c = el('div', 'abs', wall);
            css(c, { width: '560px', height: '350px', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' });
            const im = img(SHOT(n), '', c); css(im, { width: '560px' });
            return c;
        });
        const veil = el('div', 'scrim', root); veil.style.background = 'radial-gradient(55% 60% at 50% 46%, rgba(5,6,8,.74), rgba(5,6,8,.84) 60%, rgba(5,6,8,.92) 100%)';
        const rays = el('div', 'abs', root); css(rays, { left: '360px', top: '-160px', width: '1200px', height: '1200px', borderRadius: '50%', background: 'repeating-conic-gradient(from 0deg, rgba(255,214,140,.14) 0deg 3deg, transparent 3deg 12deg)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, transparent 60%)', maskImage: 'radial-gradient(circle, #000 0%, transparent 60%)' });
        const logo = el('div', 'abs logo gold glow', root, 'rp<span class="big">G</span>enius'); css(logo, { left: '0', width: '1920px', top: '300px', textAlign: 'center', fontSize: '210px' });
        const tag = kinetic(root, '지금, 웹에서 시작하세요', 'headline shadow', { stagger: .03 }); css(tag.node, { position: 'absolute', left: '0', width: '1920px', top: '572px', textAlign: 'center', fontSize: '64px', fontWeight: 800 });
        const url = el('div', 'abs', root); css(url, { left: '0', width: '1920px', top: '692px', textAlign: 'center' });
        url.innerHTML = '<span style="display:inline-flex;align-items:center;gap:16px;height:84px;padding:0 40px;border-radius:42px;background:rgba(12,14,18,.85);border:2px solid rgba(232,176,75,.6);box-shadow:0 0 40px rgba(232,176,75,.25);font-weight:800;font-size:42px;color:#fff3d6;letter-spacing:.01em"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#e8b04b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>rpgenius.kro.kr</span>';
        const cta = el('div', 'abs', root); css(cta, { left: '0', width: '1920px', top: '812px', textAlign: 'center' });
        cta.innerHTML = '<span style="display:inline-flex;align-items:center;gap:14px;height:88px;padding:0 56px;border-radius:44px;background:linear-gradient(180deg,#f7d98f,#e8b04b 55%,#c38a2c);color:#1f1503;font-weight:900;font-size:40px;box-shadow:0 18px 50px rgba(232,176,75,.35), inset 0 2px 0 rgba(255,255,255,.5)">지금 플레이 <span style="font-size:30px">▶</span></span>';
        const fine = text(root, 'sub', 'PC · 모바일 브라우저 · 설치 불필요', 960, 944, 'center'); css(fine, { fontSize: '24px', color: 'rgba(236,238,242,.55)', fontWeight: 600 });
        return t => {
            tiles.forEach((c, i) => {
                const col = i % 4, row = Math.floor(i / 4);
                css(c, { left: (col * 600 - 120 + (row % 2) * 150) + 'px', top: (row * 390 - 60) + 'px' });
                const drift = (t - 52) * 18;
                setT(c, { persp: 1400, x: drift * (row % 2 ? 1 : -1), rx: 12, ry: -8, z: -200 });
                vis(c, E.outCubic(prog(t, 52.0 + i * .03, 52.6 + i * .03)) * .55);
            });
            const lp = prog(t, 52.0, 52.6);
            vis(logo, E.outQuad(prog(t, 51.98, 52.15)));
            setT(logo, { s: lerp(1.5, 1, E.outExpo(lp)) * (1 + .03 * Math.exp(-Math.max(0, t - 58) * 5) * (t > 58 ? 1 : 0)) });
            blur(logo, (1 - E.outExpo(lp)) * 20, 'drop-shadow(0 0 36px rgba(232,176,75,.5))');
            vis(rays, prog(t, 52.0, 52.8) * .9); setT(rays, { rz: t * 9 });
            tag.update(t, 52.55, {});
            vis(url, E.outCubic(prog(t, 53.1, 53.5))); setT(url, { y: (1 - E.outExpo(prog(t, 53.1, 53.7))) * 30 });
            const pulse = t > 58 ? 1 + .08 * Math.exp(-(t - 58) * 4) * Math.cos((t - 58) * 20) : 1;
            vis(cta, E.outCubic(prog(t, 53.5, 53.9))); setT(cta, { y: (1 - E.outExpo(prog(t, 53.5, 54.1))) * 30, s: pulse });
            vis(fine, E.outCubic(prog(t, 54.6, 55.2)) * .9);
        };
    });

    // ------------------------------------------------------------ bursts & global render
    fx.burst({ t: 3.0, x: 960, y: 520, n: 120, speed: 1400, life: 1.3, color: '255,226,160' });
    fx.burst({ t: 5.5, x: 960, y: 470, n: 140, speed: 1100, life: 1.6, color: '255,214,140', gravity: 120 });
    fx.burst({ t: 16.0, x: 960, y: 520, n: 160, speed: 1800, life: 1.1, color: '255,200,120' });
    fx.burst({ t: 40.0, x: 960, y: 540, n: 160, speed: 1700, life: 1.2, color: '220,200,255' });
    fx.burst({ t: 52.0, x: 960, y: 420, n: 220, speed: 1500, life: 2.2, color: '255,222,150', gravity: 160 });
    fx.burst({ t: 58.0, x: 960, y: 856, n: 70, speed: 700, life: 1.2, color: '255,236,190', gravity: 60 });

    // gold light streaks sweeping across on every hard cut
    const streakHost = document.getElementById('streaks');
    const streakTimes = [8.0, 10.5, 11.0, 13.0, 20.0, 22.0, 26.0, 29.0, 32.0, 34.5, 37.0, 43.5, 46.5];
    const streaks = streakTimes.map(() => el('div', 'st', streakHost));
    const tagEl = document.getElementById('tag');
    const bars = document.querySelectorAll('#bars i');
    function updateFinish(t) {
        streakTimes.forEach((ti, i) => {
            const p = prog(t, ti - .12, ti + .18);
            const on = p > 0 && p < 1;
            streaks[i].style.display = on ? '' : 'none';
            if (on) { streaks[i].style.transform = 'translateX(' + lerp(-700, 2100, E.inOutCubic(p)).toFixed(1) + 'px) skewX(-18deg)'; streaks[i].style.opacity = Math.sin(p * Math.PI).toFixed(3); }
        });
        vis(tagEl, t > 3.05 && t < 51.9 ? .85 : 0);
        // 2.39:1 letterbox for the cold open, opening up with the browser reveal
        const h = 140 * (1 - E.inOutCubic(prog(t, 4.6, 5.35)));
        bars.forEach(b => { b.style.height = h.toFixed(1) + 'px'; });
    }

    function render(t) {
        updateBg(t);
        for (const s of scenes) {
            const on = t >= s.t0 && t < s.t1;
            s.root.style.display = on ? '' : 'none';
            if (on) s.update(t);
        }
        const sh = shake(t);
        world.style.transform = 'translate(' + sh.x.toFixed(2) + 'px,' + sh.y.toFixed(2) + 'px) rotate(' + sh.r.toFixed(3) + 'deg)';
        // dust only where it carries the mood (logo, end card); bursts on impacts
        fx.dustAlpha = (t > 5.3 && t < 8.1) ? .8 * Math.min(1, (t - 5.3) / .4) : (t > 51.95 ? 1 : 0);
        const burstLive = [[3.0, 1.3], [5.5, 1.6], [16.0, 1.1], [40.0, 1.2], [52.0, 2.2], [58.0, 1.2]].some(([b, l]) => t >= b && t <= b + l);
        fxHost.style.display = fx.dustAlpha > 0 || burstLive ? '' : 'none';
        if (fxHost.style.display !== 'none') fx.draw(t, { x: sh.x * 2, y: sh.y * 2 });
        updateFinish(t);
        flashEl.style.opacity = flashAmount(t).toFixed(3);
        flashEl.style.background = t > 39 && t < 41 ? '#f3ecff' : '#fff8e8';
        const gap = CUES.gaps.some(([a, b]) => t >= a && t < b);
        fadeEl.style.opacity = (gap ? .92 : 0) + (t > 59.2 ? prog(t, 59.2, 60) : 0) + (t < .25 ? 1 - prog(t, 0, .25) : 0);

    }

    window.seek = async t => {
        K.pending.length = 0;
        render(t);
        await Promise.all(K.pending);
        return true;
    };
    // Hidden scenes are display:none, so explicitly load every face before the first frame.
    const faces = ['500 40px Pretendard', '600 40px Pretendard', '700 40px Pretendard', '800 40px Pretendard', '900 40px Pretendard', '700 40px Cinzel', '800 40px Cinzel'];
    window.ready = Promise.all([...faces.map(f => document.fonts.load(f, '가나다 RPGenius 0123')), ...K.loaders]).then(() => document.fonts.ready).then(() => true);
    window.exportCues = () => JSON.stringify(CUES);
})();
