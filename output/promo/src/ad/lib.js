// Deterministic motion toolkit: every pixel of the ad is a pure function of time t (seconds),
// so any frame can be rendered in any order (render.js seeks frame by frame).
(function (global) {
    'use strict';
    const W = 1920, H = 1080, FPS = 60;

    // ---------- math ----------
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, p) => a + (b - a) * p;
    const prog = (t, a, b) => clamp((t - a) / (b - a));
    const E = {
        linear: p => p,
        inQuad: p => p * p, outQuad: p => 1 - (1 - p) * (1 - p),
        inOutQuad: p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2,
        inCubic: p => p * p * p, outCubic: p => 1 - Math.pow(1 - p, 3),
        inOutCubic: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
        inQuart: p => p * p * p * p, outQuart: p => 1 - Math.pow(1 - p, 4),
        inOutQuart: p => p < .5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2,
        outQuint: p => 1 - Math.pow(1 - p, 5),
        inExpo: p => p === 0 ? 0 : Math.pow(2, 10 * p - 10),
        outExpo: p => p === 1 ? 1 : 1 - Math.pow(2, -10 * p),
        inOutExpo: p => p === 0 ? 0 : p === 1 ? 1 : p < .5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
        outBack: p => { const s = 1.70158; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); },
        outBackSoft: p => { const s = 1.1; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); },
        inBack: p => { const s = 1.70158; return (s + 1) * p * p * p - s * p * p; },
        outElastic: p => p === 0 ? 0 : p === 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - .75) * (2 * Math.PI) / 3) + 1
    };
    const tw = (t, a, b, from, to, ease = E.outCubic) => lerp(from, to, ease(prog(t, a, b)));
    // keyframes: [[time, value, easeIntoThisKey?], ...]
    function kf(t, keys) {
        if (t <= keys[0][0]) return keys[0][1];
        for (let i = 1; i < keys.length; i++) {
            const [t1, v1, ease] = keys[i];
            const [t0, v0] = keys[i - 1];
            if (t <= t1) return lerp(v0, v1, (ease || E.inOutCubic)(prog(t, t0, t1)));
        }
        return keys[keys.length - 1][1];
    }
    // in/out envelope: 0→1 over [a,a+fi], 1 until b-fo, →0 at b
    const env = (t, a, b, fi = .3, fo = .3, ei = E.outCubic, eo = E.inCubic) =>
        t < a || t > b ? 0 : Math.min(ei(prog(t, a, a + fi)), fo > 0 ? 1 - eo(prog(t, b - fo, b)) : 1);

    // ---------- seeded randomness / noise ----------
    function rng(seed) {
        let s = seed >>> 0;
        return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    }
    const noise1 = (t, seed = 1) => Math.sin(t * 13.1 + seed * 1.7) * .5 + Math.sin(t * 29.7 + seed * 4.1) * .3 + Math.sin(t * 53.3 + seed * 9.3) * .2;

    // ---------- DOM ----------
    function el(tag, cls, parent, html) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (html != null) node.innerHTML = html;
        if (parent) parent.appendChild(node);
        return node;
    }
    function css(node, styles) { for (const k in styles) node.style[k] = styles[k]; return node; }
    const px = v => v.toFixed(2) + 'px';
    function place(node, x, y, w, h) { css(node, { left: px(x), top: px(y) }); if (w != null) node.style.width = px(w); if (h != null) node.style.height = px(h); return node; }
    // transform builder
    function T(o) {
        let s = '';
        if (o.persp) s += 'perspective(' + o.persp + 'px) ';
        if (o.x || o.y || o.z) s += 'translate3d(' + (o.x || 0).toFixed(2) + 'px,' + (o.y || 0).toFixed(2) + 'px,' + (o.z || 0).toFixed(2) + 'px) ';
        if (o.rx) s += 'rotateX(' + o.rx.toFixed(3) + 'deg) ';
        if (o.ry) s += 'rotateY(' + o.ry.toFixed(3) + 'deg) ';
        if (o.rz) s += 'rotateZ(' + o.rz.toFixed(3) + 'deg) ';
        if (o.skx) s += 'skewX(' + o.skx.toFixed(3) + 'deg) ';
        if (o.s != null && o.s !== 1) s += 'scale(' + o.s.toFixed(4) + ') ';
        if (o.sx != null || o.sy != null) s += 'scale(' + (o.sx == null ? 1 : o.sx).toFixed(4) + ',' + (o.sy == null ? 1 : o.sy).toFixed(4) + ') ';
        return s || 'none';
    }
    function setT(node, o) { node.style.transform = T(o); return node; }
    function vis(node, alpha) { node.style.opacity = clamp(alpha).toFixed(3); node.style.visibility = alpha <= .001 ? 'hidden' : 'visible'; return node; }
    function blur(node, b, extra) { node.style.filter = (b > .05 ? 'blur(' + b.toFixed(2) + 'px) ' : '') + (extra || ''); }

    // Split text into per-character spans (keeps spaces), returns span list.
    function splitChars(node, text) {
        node.textContent = '';
        return Array.from(text).map(chr => { const s = el('span', 'ch', node); s.textContent = chr; return s; });
    }

    // Kinetic headline: per-char stagger rise with blur; optional gold shine sweep across the whole line.
    function kinetic(parent, text, cls, opts = {}) {
        // Gold lines: the gradient lives on each glyph span (aligned to one line-wide gradient);
        // a text-shadow on transparent glyphs would render as a dark smear, so drop it there.
        const containerCls = opts.gold ? cls.split(' ').filter(c => c !== 'gold' && c !== 'shadow').join(' ') : cls;
        const node = el('div', containerCls, parent);
        const chars = splitChars(node, text);
        if (opts.gold) chars.forEach(c => c.classList.add('gold'));
        const state = { node, chars, measured: false, offsets: [], width: 0 };
        state.measure = () => {
            if (state.measured) return;
            state.width = node.scrollWidth || 1;
            state.offsets = chars.map(c => c.offsetLeft);
            if (opts.gold) chars.forEach((c, i) => { c.style.backgroundSize = state.width + 'px 100%'; c.style.backgroundPosition = (-state.offsets[i]) + 'px 0'; });
            state.measured = true;
        };
        // mode: rise | slam | drop | fade ; t0 start, dur per char, stagger
        state.update = (t, t0, o = {}) => {
            state.measure();
            const mode = o.mode || opts.mode || 'rise';
            const stagger = o.stagger != null ? o.stagger : (opts.stagger != null ? opts.stagger : .035);
            const dur = o.dur || opts.dur || .55;
            const out = o.out; // [start, dur]
            chars.forEach((c, i) => {
                const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
                let a = 0, y = 0, s = 1, b = 0, rz = 0, x = 0;
                if (mode === 'rise') { const e = E.outExpo(p); a = E.outQuad(p); y = (1 - e) * 70; b = (1 - e) * 14; }
                else if (mode === 'slam') { const e = E.outExpo(p); a = clamp(p * 3); s = lerp(2.4, 1, e); b = (1 - e) * 24; y = (1 - e) * -20; }
                else if (mode === 'drop') { const e = E.outBack(p); a = clamp(p * 2.5); y = (1 - e) * -90; rz = (1 - E.outCubic(p)) * (i % 2 ? 14 : -14); }
                else if (mode === 'fade') { a = E.outQuad(p); b = (1 - p) * 8; }
                else if (mode === 'type') { a = p > 0 ? 1 : 0; }
                if (out) {
                    const q = prog(t, out[0] + i * (out[2] || .015), out[0] + i * (out[2] || .015) + out[1]);
                    const e = E.inCubic(q);
                    a *= 1 - e; y += -e * 50; b += e * 12; x += e * (o.outX || 0);
                }
                c.style.opacity = a.toFixed(3);
                c.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ') rotate(' + rz.toFixed(2) + 'deg)';
                c.style.filter = b > .1 ? 'blur(' + b.toFixed(1) + 'px)' : 'none';
            });
            if (opts.gold && o.shine != null) {
                // shine: 0..1 sweep position of a bright band across the line
                const band = lerp(-0.3, 1.3, o.shine) * state.width;
                chars.forEach((c, i) => {
                    const d = (state.offsets[i] - band) / 120;
                    const k = Math.exp(-d * d);
                    if (k > .02) c.style.filter = (c.style.filter === 'none' ? '' : c.style.filter + ' ') + 'brightness(' + (1 + k * .9).toFixed(3) + ')';
                });
            }
        };
        return state;
    }

    // Count-up number (comma formatted)
    const comma = n => Math.round(n).toLocaleString('en-US');

    // ---------- images & clips ----------
    const pending = [];
    const loaders = [];
    function img(src, cls, parent) {
        const node = el('img', cls, parent);
        node.decoding = 'sync';
        loaders.push(new Promise(res => { node.onload = node.onerror = () => res(); }));
        node.src = src;
        return node;
    }
    // A clip is a folder of numbered JPEG frames captured from the real game (60 fps).
    function clipFrame(node, dir, index, fallbackCount) {
        const src = dir + '/' + String(Math.max(0, Math.round(index))).padStart(5, '0') + '.jpg';
        if (node.dataset.src !== src) {
            node.dataset.src = src;
            node.src = src;
            pending.push(node.decode().catch(() => {}));
        }
    }

    // ---------- components ----------
    const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    function browserFrame(parent, w, h, opts = {}) {
        const root = el('div', 'bf', parent);
        css(root, { width: w + 'px', height: h + 'px' });
        const bar = el('div', 'bf-bar', root);
        el('div', 'bf-dots', bar, '<i></i><i></i><i></i>');
        const url = el('div', 'bf-url', bar, LOCK + '<span class="host"></span><span class="path"></span><span class="caret"></span>');
        const host = url.querySelector('.host'), path = url.querySelector('.path'), caret = url.querySelector('.caret');
        host.textContent = opts.host || 'rpgenius.kro.kr';
        path.textContent = opts.path || '';
        const view = el('div', 'bf-view', root);
        const glare = el('div', 'bf-glare', root);
        const api = {
            root, view, glare, host, path, caret,
            w, h, vw: w, vh: h - 56,
            setUrl(hostText, pathText, caretOn) { host.textContent = hostText; path.textContent = pathText || ''; caret.style.display = caretOn ? '' : 'none'; },
            glareAt(p) { glare.style.backgroundPosition = (100 - p * 100).toFixed(1) + '% 0'; }
        };
        api.setUrl(host.textContent, path.textContent, false);
        return api;
    }
    // Screenshot inside a frame/viewport: natural size nw x nh (px of the capture), fit to width `fitW`.
    function shotIn(view, src, nw, fitW) {
        const node = img(src, '', view);
        const k = fitW / nw;
        css(node, { width: nw + 'px' });
        return {
            node, k,
            // pan: yOff in fitted px (scroll), zoom around (cx, cy) in viewport px
            set(scroll = 0, zoom = 1, cx = 0, cy = 0, xOff = 0) {
                const s = k * zoom;
                const x = cx - cx * zoom + xOff;
                const y = cy - cy * zoom - scroll * zoom;
                node.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + s.toFixed(5) + ')';
            }
        };
    }
    // Highlight ring living inside a frame's viewport, positioned in capture pixels (follows zoom/scroll).
    function viewRing(view, shot, rx, ry, rw, rh, pad = 10) {
        const ring = el('div', 'ring', view);
        ring.style.transformOrigin = '0 0';
        return {
            ring,
            set(scroll = 0, zoom = 1, cx = 0, cy = 0, alpha = 1, pop = 1) {
                const k = shot.k * zoom;
                const x = cx - cx * zoom + rx * k - pad, y = cy - cy * zoom - scroll * zoom + ry * k - pad;
                const w = rw * k + pad * 2, h = rh * k + pad * 2;
                ring.style.left = x.toFixed(1) + 'px'; ring.style.top = y.toFixed(1) + 'px';
                ring.style.width = w.toFixed(1) + 'px'; ring.style.height = h.toFixed(1) + 'px';
                ring.style.transformOrigin = '50% 50%';
                ring.style.transform = 'scale(' + pop.toFixed(3) + ')';
                vis(ring, alpha);
            }
        };
    }
    function phoneFrame(parent, w, h) {
        const root = el('div', 'ph', parent);
        css(root, { width: w + 'px', height: h + 'px' });
        const screen = el('div', 'ph-screen', root);
        el('div', 'ph-island', root);
        return { root, screen, sw: w - 32, sh: h - 32 };
    }

    // ---------- particles (pooled DOM sprites; a full-screen canvas layer composites far slower here) ----------
    function particles(host) {
        const R = rng(7);
        const SPRITE = 'radial-gradient(circle, rgba(255,232,176,1) 0%, rgba(240,190,95,.5) 30%, rgba(232,176,75,0) 70%)';
        const mk = () => { const d = document.createElement('i'); d.style.cssText = 'position:absolute;left:0;top:0;width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:50%;background:' + SPRITE + ';display:none'; host.appendChild(d); return d; };
        const dust = Array.from({ length: 90 }, () => ({
            x: R() * W, y: R() * H, z: .3 + R() * .9, vx: (R() - .5) * 14, vy: -6 - R() * 22, ph: R() * 6.28, sz: .6 + R() * 2.2, hue: R(), el: mk()
        }));
        const pool = Array.from({ length: 260 }, mk);
        const bursts = [];
        const api = {
            dustAlpha: .7,
            burst(o) { bursts.push(Object.assign({ n: 80, speed: 900, life: 1.2, gravity: 500, seed: bursts.length + 11, color: '255,214,140', size: 3 }, o)); },
            draw(t, cam = { x: 0, y: 0 }) {
                for (const p of dust) {
                    if (api.dustAlpha <= .01) { p.el.style.display = 'none'; continue; }
                    const x = ((p.x + p.vx * t * p.z + Math.sin(t * .7 + p.ph) * 18 - cam.x * p.z) % W + W) % W;
                    const y = ((p.y + p.vy * t * p.z - cam.y * p.z) % H + H) % H;
                    const tw = .45 + .55 * Math.pow(Math.sin(t * (1.2 + p.hue) + p.ph) * .5 + .5, 2);
                    const a = api.dustAlpha * tw * .55 * p.z;
                    const sc = p.sz * p.z * 2.6 * 6 / 32;
                    p.el.style.display = '';
                    p.el.style.opacity = Math.min(1, a).toFixed(3);
                    p.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
                }
                let k = 0;
                for (const b of bursts) {
                    const dt = t - b.t;
                    if (dt < 0 || dt > b.life) continue;
                    const r2 = rng(b.seed);
                    for (let i = 0; i < b.n && k < pool.length; i++) {
                        const ang = r2() * Math.PI * 2, sp = b.speed * (.25 + r2() * .75), life = b.life * (.45 + r2() * .55), rs = r2();
                        if (dt > life) continue;
                        const q = dt / life;
                        const dist = sp * (1 - Math.pow(1 - q, 3)) * life * .55;
                        const x = b.x + Math.cos(ang) * dist;
                        const y = b.y + Math.sin(ang) * dist * (b.flat || 1) + b.gravity * dt * dt * .5;
                        const a = Math.pow(1 - q, 1.6);
                        const sz = b.size * (.5 + rs) * (1 - q * .5) * 3.2 / 32 * 2;
                        const d = pool[k++];
                        d.style.display = '';
                        d.style.opacity = a.toFixed(3);
                        d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sz.toFixed(3) + ')';
                    }
                }
                for (; k < pool.length; k++) if (pool[k].style.display !== 'none') pool[k].style.display = 'none';
            }
        };
        return api;
    }

    // Grain tiles precomputed once, cycled per frame (deterministic).
    function grainTiles(count = 6, size = 256) {
        const R = rng(99);
        return Array.from({ length: count }, () => {
            const c = document.createElement('canvas'); c.width = c.height = size;
            const g = c.getContext('2d'); const d = g.createImageData(size, size);
            for (let i = 0; i < d.data.length; i += 4) { const v = R() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
            g.putImageData(d, 0, 0);
            return 'url(' + c.toDataURL('image/png') + ')';
        });
    }

    global.K = {
        W, H, FPS, clamp, lerp, prog, E, tw, kf, env, rng, noise1, el, css, px, place, T, setT, vis, blur,
        splitChars, kinetic, comma, img, clipFrame, pending, loaders, browserFrame, shotIn, viewRing, phoneFrame, particles, grainTiles
    };
})(window);
