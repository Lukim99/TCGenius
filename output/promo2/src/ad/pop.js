// Pop motion toolkit for film #2: sticker actors with hard shadows and colored echo trails, stroked comic type,
// burst shapes, confetti, loot arcs, full-screen wipes and a vector clock. Everything is a pure function of time t.
(function (global) {
    'use strict';
    const { W, H, clamp, lerp, prog, E, el, css, vis, rng, img, splitChars } = K;
    const BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4;
    const bt = (bar, beat = 0) => +(bar * BAR + beat * BEAT).toFixed(5);

    E.outBackBig = p => { const s = 2.6; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); };
    E.inOutBack = p => { const c = 1.70158 * 1.525; return p < .5 ? (Math.pow(2 * p, 2) * ((c + 1) * 2 * p - c)) / 2 : (Math.pow(2 * p - 2, 2) * ((c + 1) * (p * 2 - 2) + c) + 2) / 2; };
    E.outBounce = p => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375; return n * (p -= 2.625 / d) * p + .984375; };
    // damped spring response after t0 (for squash/stretch, wobble); decay envelope
    const spring = (t, t0, freq = 16, damp = 7) => t < t0 ? 0 : Math.exp(-(t - t0) * damp) * Math.cos((t - t0) * freq);
    const decay = (t, t0, k = 8) => t < t0 ? 0 : Math.exp(-(t - t0) * k);
    const pulse = (t, t0, dur) => t < t0 || t > t0 + dur ? 0 : Math.sin(prog(t, t0, t0 + dur) * Math.PI);

    // transform with an anchor (ax, ay as fractions of w/h)
    function tf(p, w, h, ax, ay) {
        const s = p.s == null ? 1 : p.s;
        const sx = (p.sx == null ? 1 : p.sx) * s * (p.flip ? -1 : 1), sy = (p.sy == null ? 1 : p.sy) * s;
        let x = p.x, y = p.y;
        // rc: rotate about a point rc px above the anchor (e.g. a body centre) instead of the anchor itself
        if (p.rc && p.r) { const a = p.r * Math.PI / 180, hh = p.rc * s; x -= hh * Math.sin(a); y += -hh + hh * Math.cos(a); }
        return 'translate(' + (x - ax * w).toFixed(1) + 'px,' + (y - ay * h).toFixed(1) + 'px) rotate(' + (p.r || 0).toFixed(2) + 'deg) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    }
    function xf(node, p, w, h, ax = .5, ay = .5) {
        node.style.transformOrigin = (ax * 100) + '% ' + (ay * 100) + '%';
        node.style.transform = tf(p, w, h, ax, ay);
        if (p.a != null) vis(node, p.a);
        return node;
    }
    const masks = [];
    function maskDiv(parent, src, w, h) {
        const d = el('div', 'mask', parent);
        css(d, { width: w + 'px', height: h + 'px', WebkitMaskImage: 'url("' + src + '")', maskImage: 'url("' + src + '")' });
        masks.push(src);
        return d;
    }

    // Sticker actor: hard ink shadow + white flash overlay + colored echo ghosts (all silhouettes of the same PNG).
    function actor(parent, src, o) {
        const w = o.w, h = o.h, ax = o.ax == null ? .5 : o.ax, ay = o.ay == null ? 1 : o.ay;
        const wrap = el('div', 'abs', parent);
        const ghosts = Array.from({ length: o.ghosts || 0 }, () => maskDiv(wrap, src, w, h));
        const shadow = o.shadow === false ? null : maskDiv(wrap, src, w, h);
        const body = el('div', 'actor', wrap);
        css(body, { width: w + 'px', height: h + 'px' });
        const im = img(src, '', body);
        const flash = maskDiv(body, src, w, h);
        flash.style.background = '#fff';
        [...ghosts, shadow, body].forEach(n => { if (n) n.style.transformOrigin = (ax * 100) + '% ' + (ay * 100) + '%'; });
        let lastGhost = -1;
        return {
            wrap, body, w, h,
            set(p, x = {}) {
                const a = p.a == null ? 1 : p.a;
                body.style.transform = tf(p, w, h, ax, ay);
                vis(body, a);
                flash.style.opacity = (p.flash || 0).toFixed(3);
                if (shadow) {
                    const sh = x.shadow || {};
                    shadow.style.background = sh.color || '#16112b';
                    shadow.style.transform = tf(Object.assign({}, p, { x: p.x + (sh.dx == null ? 16 : sh.dx), y: p.y + (sh.dy == null ? 14 : sh.dy) }), w, h, ax, ay);
                    vis(shadow, a * (sh.a == null ? 1 : sh.a));
                }
                const gs = x.ghosts || [];
                if (gs.length || lastGhost !== 0) ghosts.forEach((g, i) => {
                    const q = gs[i];
                    if (!q || q.a <= .01) { if (g.style.visibility !== 'hidden') vis(g, 0); return; }
                    g.style.background = q.color;
                    g.style.transform = tf(q, w, h, ax, ay);
                    vis(g, q.a);
                });
                lastGhost = gs.length;
            }
        };
    }
    // echo trail states from a motion path function path(t) -> {x,y,s,sx,sy,r}
    function echoes(path, t, n, lag, colors, alpha = .85) {
        const out = [];
        for (let i = n; i >= 1; i--) {
            const q = Object.assign({}, path(t - i * lag));
            q.color = colors[(i - 1) % colors.length];
            q.a = alpha * (1 - (i - 1) / n);
            out.push(q);
        }
        return out;
    }
    // idle breathing: returns small offsets
    const idle = (t, seed = 0, amp = 1) => ({
        dy: -Math.abs(Math.sin(t * 3.1 + seed)) * 8 * amp,
        sy: 1 + .014 * amp * Math.sin(t * 6.2 + seed),
        sx: 1 - .008 * amp * Math.sin(t * 6.2 + seed),
        r: .9 * amp * Math.sin(t * 2.3 + seed * 2)
    });

    // Plain positioned image (effects, items, cards)
    function pic(parent, src, w, h, cls) {
        const node = img(src, cls || 'abs', parent);
        css(node, { width: w + 'px', height: h + 'px' });
        return { node, w, h, set(p, ax = .5, ay = .5) { xf(node, p, w, h, ax, ay); } };
    }

    // Stroked comic headline (Black Han Sans), per-char animation.
    function popText(parent, text, o = {}) {
        const box = el('div', 'abs', parent);
        const node = el('div', 'bhs', box);
        const size = o.size || 120;
        css(node, { fontSize: size + 'px', color: o.color || '#fff4e0' });
        node.style.setProperty('--stroke', (o.stroke == null ? Math.round(size * .09) : o.stroke) + 'px');
        if (o.shadow !== false) node.style.textShadow = o.shadowCss || (Math.round(size * .06) + 'px ' + Math.round(size * .07) + 'px 0 #16112b');
        const chars = splitChars(node, text);
        chars.forEach(c => { if (c.textContent === ' ') c.textContent = '\u00a0'; });
        let wpx = 0, hpx = 0;
        const api = {
            box, node, chars,
            measure() { if (!wpx) { wpx = node.offsetWidth; hpx = node.offsetHeight; } return [wpx, hpx]; },
            // place the whole line: anchor ax (0 left, .5 center, 1 right)
            place(p, ax = .5, ay = .5) { const [w, h] = api.measure(); xf(box, p, w, h, ax, ay); },
            // per-char entrance/exit
            update(t, t0, u = {}) {
                const mode = u.mode || o.mode || 'pop', st = u.stagger == null ? (o.stagger == null ? .035 : o.stagger) : u.stagger, dur = u.dur || o.dur || .42;
                chars.forEach((c, i) => {
                    const p = prog(t, t0 + i * st, t0 + i * st + dur);
                    let a = 1, x = 0, y = 0, s = 1, r = 0;
                    if (mode === 'pop') { const e = E.outBackBig(p); s = e; a = p > 0 ? 1 : 0; r = (1 - E.outCubic(p)) * (i % 2 ? 24 : -24); }
                    else if (mode === 'drop') { const e = E.outBounce(p); y = (1 - e) * -size * 2.2; a = p > 0 ? 1 : 0; }
                    else if (mode === 'rise') { const e = E.outBack(p); y = (1 - e) * size * .9; a = clamp(p * 3); }
                    else if (mode === 'type') { a = p > 0 ? 1 : 0; s = p > 0 ? 1 + .25 * (1 - E.outCubic(prog(t, t0 + i * st, t0 + i * st + .12))) : 1; }
                    else if (mode === 'slam') { const e = E.outExpo(p); s = lerp(3.2, 1, e); a = clamp(p * 4); r = (1 - e) * (i % 2 ? 10 : -10); }
                    if (u.wave) { y += Math.sin(t * 7 - i * .55) * u.wave; }
                    if (u.out) {
                        const q = prog(t, u.out[0] + i * (u.out[2] == null ? .02 : u.out[2]), u.out[0] + i * (u.out[2] == null ? .02 : u.out[2]) + u.out[1]);
                        const e = E.inBack(q);
                        if (u.outMode === 'fly') { y += -e * size * 1.6; a *= 1 - clamp(q * 1.4); }
                        else { s *= 1 - clamp(e); }
                    }
                    c.style.opacity = a <= 0 ? '0' : Math.min(1, a).toFixed(3);
                    c.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + Math.max(0, s).toFixed(3) + ') rotate(' + r.toFixed(1) + 'deg)';
                });
            }
        };
        return api;
    }

    // ---------- shapes ----------
    function starPoly(n, inner = .55, rot = -90) {
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
            const r = i % 2 ? inner : 1, a = (rot + i * 180 / n) * Math.PI / 180;
            pts.push((50 + 50 * r * Math.cos(a)).toFixed(2) + '% ' + (50 + 50 * r * Math.sin(a)).toFixed(2) + '%');
        }
        return 'polygon(' + pts.join(',') + ')';
    }
    // outlined burst: ink star behind a colored star
    function burst(parent, size, color, o = {}) {
        const box = el('div', 'abs', parent);
        css(box, { width: size + 'px', height: size + 'px' });
        const poly = starPoly(o.n || 14, o.inner || .72);
        const ink = el('div', 'abs', box); css(ink, { width: size + 'px', height: size + 'px', background: '#16112b', clipPath: poly });
        const fill = el('div', 'abs', box); css(fill, { left: (size * .045) + 'px', top: (size * .045) + 'px', width: (size * .91) + 'px', height: (size * .91) + 'px', background: color, clipPath: poly });
        return { box, fill, set(p) { xf(box, p, size, size); } };
    }
    function disc(parent, size, color, cls) {
        const d = el('div', cls || 'circle', parent);
        css(d, { width: size + 'px', height: size + 'px', background: color });
        return { node: d, set(p) { xf(d, p, size, size); } };
    }
    function ring(parent, size, color, width) {
        const d = el('div', 'ring', parent);
        css(d, { width: size + 'px', height: size + 'px', borderColor: color, borderWidth: width + 'px' });
        return { node: d, set(p) { xf(d, p, size, size); } };
    }

    // ---------- confetti (pooled, deterministic ballistic flakes) ----------
    const PALETTE = ['#ff3d7f', '#ffd83d', '#2f6bff', '#19e3b1', '#7a3cff', '#ff7a2f', '#ffffff'];
    function confetti(host, size = 300) {
        const pool = Array.from({ length: size }, (_, i) => {
            const d = el('i', '', host);
            const kind = i % 3;
            css(d, { position: 'absolute', left: '0', top: '0', width: kind === 1 ? '18px' : '14px', height: kind === 1 ? '18px' : '28px',
                borderRadius: kind === 1 ? '50%' : '3px', display: 'none', border: '3px solid #16112b' });
            return d;
        });
        const list = [];
        return {
            burst(o) { list.push(Object.assign({ n: 80, speed: 1500, up: 0, spread: Math.PI * 2, angle: -Math.PI / 2, gravity: 1400, life: 2.2, drag: 1.6, seed: list.length * 7 + 3 }, o)); },
            draw(t) {
                let k = 0;
                for (const b of list) {
                    const dt = t - b.t;
                    if (dt < 0 || dt > b.life) continue;
                    const R = rng(b.seed);
                    for (let i = 0; i < b.n && k < pool.length; i++) {
                        const ang = b.angle + (R() - .5) * b.spread, sp = b.speed * (.35 + R() * .65), spin = (R() - .5) * 26, flip = 4 + R() * 10, ci = Math.floor(R() * PALETTE.length), life = b.life * (.6 + R() * .4);
                        if (dt > life) continue;
                        // velocity with linear drag: x = v/k (1 - e^{-k t}); gravity pulls with terminal fall
                        const kx = b.drag, f = (1 - Math.exp(-kx * dt)) / kx;
                        const x = b.x + Math.cos(ang) * sp * f;
                        const y = b.y + Math.sin(ang) * sp * f + b.gravity * (dt - f) / kx * .9;
                        const d = pool[k++];
                        d.style.display = '';
                        d.style.background = PALETTE[ci];
                        d.style.opacity = (1 - Math.pow(dt / life, 4)).toFixed(3);
                        d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (spin * dt * 20).toFixed(1) + 'deg) scaleX(' + Math.cos(flip * dt).toFixed(3) + ')';
                    }
                }
                for (; k < pool.length; k++) if (pool[k].style.display !== 'none') pool[k].style.display = 'none';
            }
        };
    }

    // ---------- loot: icons launched in arcs, bouncing on a floor ----------
    function loot(parent, srcs, o) {
        const R = rng(o.seed || 5);
        const items = srcs.map((src, i) => {
            const sz = o.size || 150;
            const node = img(src, 'abs', parent);
            css(node, { width: sz + 'px', height: sz + 'px', filter: 'drop-shadow(6px 7px 0 #16112b)' });
            return { node, sz, t0: o.t + i * (o.stagger || .04), x0: o.x + (R() - .5) * (o.jitter || 80), vx: (R() - .5) * (o.vx || 1400), vy: -(o.vy || 1500) * (.7 + R() * .5), spin: (R() - .5) * 720 };
        });
        const g = o.gravity || 3600, floor = o.floor || 900, rest = .42;
        return {
            draw(t) {
                items.forEach(it => {
                    const dt = t - it.t0;
                    if (dt < 0 || dt > (o.life || 2.4)) { if (it.node.style.visibility !== 'hidden') vis(it.node, 0); return; }
                    // bounce physics (analytic per segment)
                    let y0 = o.y, vy = it.vy, tt = dt, x = it.x0 + it.vx * Math.min(dt, 1.2) * (1 - Math.min(dt, 1.2) / 2.8);
                    let y = y0 + vy * tt + .5 * g * tt * tt;
                    for (let b = 0; b < 3 && y > floor; b++) {
                        const disc = vy * vy - 2 * g * (y0 - floor);
                        const th = (-vy + Math.sqrt(Math.max(0, disc))) / g;
                        const vImpact = vy + g * th;
                        tt -= th; y0 = floor; vy = -vImpact * rest;
                        y = y0 + vy * tt + .5 * g * tt * tt;
                    }
                    y = Math.min(y, floor);
                    const a = 1 - prog(dt, (o.life || 2.4) - .35, o.life || 2.4);
                    const s = E.outBack(prog(dt, 0, .25));
                    xf(it.node, { x, y, s, r: it.spin * Math.min(dt, .8), a }, it.sz, it.sz, .5, 1);
                });
            }
        };
    }

    // ---------- full-screen wipes ----------
    function wipes(host) {
        const list = [];
        const COLORS = ['#ff3d7f', '#ffd83d', '#2f6bff', '#19e3b1', '#7a3cff', '#16112b'];
        return {
            // kind: bars | circle | slash ; t = moment of full cover (cut point)
            add(t, kind, o = {}) {
                const w = { t, kind, o, nodes: [] };
                if (kind === 'bars') {
                    const n = o.n || 6, cols = o.colors || COLORS;
                    for (let i = 0; i < n; i++) { const d = el('div', 'abs', host); css(d, { width: '2600px', height: Math.ceil(1500 / n + 4) + 'px', background: cols[i % cols.length], display: 'none', borderTop: '8px solid #16112b', borderBottom: '8px solid #16112b' }); w.nodes.push(d); }
                } else if (kind === 'circle') {
                    const d = el('div', 'abs', host); css(d, { borderRadius: '50%', display: 'none', borderStyle: 'solid', borderColor: o.color || '#ffd83d' }); w.nodes.push(d);
                    const r = el('div', 'abs', host); css(r, { borderRadius: '50%', display: 'none', border: '14px solid #16112b' }); w.nodes.push(r);
                } else if (kind === 'slash') {
                    const cols = o.colors || ['#16112b', '#ff3d7f', '#ffd83d'];
                    cols.forEach(c => { const d = el('div', 'abs', host); css(d, { width: '1400px', height: '2400px', background: c, display: 'none' }); w.nodes.push(d); });
                }
                list.push(w);
            },
            draw(t) {
                for (const w of list) {
                    const dur = w.o.dur || .26, dt = t - w.t;
                    const on = dt > -dur && dt < dur;
                    w.nodes.forEach(n => { n.style.display = on ? '' : 'none'; });
                    if (!on) continue;
                    if (w.kind === 'bars') {
                        const n = w.nodes.length, bh = 1500 / n;
                        w.nodes.forEach((d, i) => {
                            const lag = i * .022;
                            let sx, org;
                            if (dt < 0) { sx = E.inOutCubic(prog(dt, -dur + lag, lag * .5)); org = '0% 50%'; }
                            else { sx = 1 - E.inOutCubic(prog(dt, lag * .5, dur - (n - 1 - i) * .01)); org = '100% 50%'; }
                            d.style.transformOrigin = org;
                            d.style.transform = 'translate(-340px,' + (-210 + i * bh).toFixed(1) + 'px) rotate(-8deg) scaleX(' + sx.toFixed(4) + ')';
                        });
                    } else if (w.kind === 'circle') {
                        const cx = w.o.x == null ? 960 : w.o.x, cy = w.o.y == null ? 540 : w.o.y, R = 2300;
                        const [d, r] = w.nodes;
                        let outer, hole;
                        if (dt < 0) { outer = R * E.inCubic(prog(dt, -dur, 0)); hole = 0; }
                        else { outer = R; hole = R * E.outCubic(prog(dt, 0, dur)); }
                        const bw = Math.max(0, outer - hole);
                        css(d, { left: (cx - outer) + 'px', top: (cy - outer) + 'px', width: (outer * 2) + 'px', height: (outer * 2) + 'px', borderWidth: bw.toFixed(1) + 'px' });
                        const rr = dt < 0 ? outer : hole;
                        css(r, { left: (cx - rr - 7) + 'px', top: (cy - rr - 7) + 'px', width: (rr * 2 + 14) + 'px', height: (rr * 2 + 14) + 'px', display: rr > 4 ? '' : 'none' });
                    } else if (w.kind === 'slash') {
                        w.nodes.forEach((d, i) => {
                            const lag = i * .03;
                            const x = dt < 0 ? lerp(-3200, -500, E.inOutCubic(prog(dt, -dur + lag, 0))) : lerp(-500, 2600, E.inOutCubic(prog(dt, lag, dur)));
                            d.style.transform = 'translate(' + (x + i * 90).toFixed(1) + 'px,-600px) rotate(20deg)';
                        });
                    }
                }
            }
        };
    }

    // ---------- analog alarm clock ----------
    function clock(parent, size) {
        const box = el('div', 'abs', parent);
        css(box, { width: size + 'px', height: size + 'px' });
        const bells = [-38, 38].map(a => { const b = el('div', 'abs', box); css(b, { width: (size * .34) + 'px', height: (size * .22) + 'px', left: (size * .33) + 'px', top: (-size * .1) + 'px', background: '#ff3d7f', border: '12px solid #16112b', borderRadius: '50% 50% 20% 20%', transformOrigin: '50% 330%', transform: 'rotate(' + a + 'deg)' }); return b; });
        const face = el('div', 'clock', box); css(face, { width: size + 'px', height: size + 'px' });
        for (let i = 0; i < 12; i++) { const k = el('div', 'tick', face); k.style.transform = 'rotate(' + (i * 30) + 'deg) translateY(' + (-size * .36) + 'px)' + (i % 3 ? ' scale(.6)' : ''); }
        const hh = el('div', 'hand', face); css(hh, { width: '22px', height: (size * .23) + 'px', marginLeft: '-11px' });
        const mh = el('div', 'hand', face); css(mh, { width: '16px', height: (size * .33) + 'px', marginLeft: '-8px' });
        const sh = el('div', 'hand', face); css(sh, { width: '8px', height: (size * .37) + 'px', marginLeft: '-4px', background: '#ff3d7f' });
        el('div', 'pin', face);
        return {
            box, bells,
            set(p, secs) {
                const h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60;
                hh.style.transform = 'rotate(' + (h * 30).toFixed(2) + 'deg)';
                mh.style.transform = 'rotate(' + (m * 6).toFixed(2) + 'deg)';
                sh.style.transform = 'rotate(' + (Math.floor(s) * 6).toFixed(2) + 'deg)';
                xf(box, p, size, size);
            }
        };
    }

    global.P = { BPM, BEAT, BAR, bt, spring, decay, pulse, tf, xf, actor, echoes, idle, pic, popText, starPoly, burst, disc, ring, confetti, loot, wipes, clock, masks, PALETTE };
})(window);
