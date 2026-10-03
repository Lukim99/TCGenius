(function () {
    'use strict';

    // 아티팩트 재설정 연출: 기울어진 차원 고리 세 겹이 반대로 돌다가 정렬되며 확정된다.
    const THREE_URL = new URL('./vendor/yut/three.module.min.js', document.currentScript ? document.currentScript.src : location.href).href;
    const sfx = file => '/rpg-ui?file=' + encodeURIComponent(file);
    // Mixkit Free License: https://mixkit.co/license/modal/sfxFree/
    // https://mixkit.co/free-sound-effects/spell/ (Rewind magic spell, Thin icicles spell, Light spell)
    // 실패음은 기존 전투와 같은 Kenney CC0 효과음.
    const SOUNDS = {
        start: 'https://assets.mixkit.co/active_storage/sfx/877/877-preview.mp3',
        brake: 'https://assets.mixkit.co/active_storage/sfx/1685/1685-preview.mp3',
        done: 'https://assets.mixkit.co/active_storage/sfx/1332/1332-preview.mp3',
        fail: sfx('sfx/fail.mp3')
    };
    const VOLUME = .22, MUTE_KEY = 'artifact-fx-muted';
    const TINT = { rare: '#6fa8dc', unique: '#b48cf0', legendary: '#e8b04b' };
    const RARITY_ALIAS = { '레어': 'rare', '유니크': 'unique', '레전더리': 'legendary' };
    const GOLD = '#f0cd87', TAU = Math.PI * 2, MARK = TAU / 8;
    const MIN_SPIN = 1400, BRAKE = 340, BLOOM = 300, FAIL_OUT = 220, MAX_LOOP = 15000, SPARKS = 26;
    // frame은 고정 틀(잠금 표시), 나머지는 서로 반대로 도는 고리.
    const RINGS = [
        { kind: 'frame', axis: 0, tilt: 0, speed: 0 },
        { kind: 'outer', axis: .5, tilt: 1.05, speed: .9 },
        { kind: 'mid', axis: -.7, tilt: .95, speed: -1.4 },
        { kind: 'inner', axis: 1.6, tilt: .8, speed: 2.1 }
    ];
    const clamp = v => Math.max(0, Math.min(1, v));
    const ease = p => 1 - Math.pow(1 - p, 3);
    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    // ---- 효과음 ----
    let muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) {}
    const playing = new Set();
    function stopAll() {
        playing.forEach(a => { try { a.pause(); } catch (_) {} });
        playing.clear();
    }
    function play(name) {
        if (muted || document.hidden) return;
        try {
            const a = new Audio(SOUNDS[name]);
            a.volume = VOLUME;
            playing.add(a);
            a.onended = a.onerror = () => playing.delete(a);
            const p = a.play();
            if (p) p.catch(() => playing.delete(a));
        } catch (_) { /* 소리는 선택 사항 */ }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });

    function syncSound(button) {
        button.textContent = muted ? '효과음 꺼짐' : '효과음 켜짐';
        button.setAttribute('aria-pressed', String(!muted));
    }
    function soundControl() {
        const button = make('button', 'af-sound');
        button.type = 'button';
        button.setAttribute('aria-label', '아티팩트 효과음');
        syncSound(button);
        button.onclick = () => {
            muted = !muted;
            try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) {}
            if (muted) stopAll();
            document.querySelectorAll('.af-sound').forEach(syncSound);
        };
        return button;
    }

    // ---- 텍스처 (WebGL·Canvas 2D 공용) ----
    function ringCanvas(kind, tint, locked) {
        const c = document.createElement('canvas');
        c.width = c.height = 512;
        const g = c.getContext('2d'), R = 128;
        g.scale(2, 2);
        g.translate(R, R);
        const arc = (r, width, style) => { g.beginPath(); g.arc(0, 0, r * R, 0, TAU); g.lineWidth = width; g.strokeStyle = style; g.stroke(); };
        const around = (n, fn) => { for (let i = 0; i < n; i++) { g.save(); g.rotate(i / n * TAU); fn(i); g.restore(); } };
        if (kind === 'outer') {
            arc(.86, 16, tint + '2e'); arc(.78, 1.5, tint); arc(.94, 1.5, tint);
            g.fillStyle = tint;
            around(48, i => g.fillRect(-.75, -.94 * R, 1.5, i % 4 ? 4 : 9));
            g.fillStyle = GOLD;
            around(6, () => { g.beginPath(); g.moveTo(0, -.91 * R); g.lineTo(4, -.86 * R); g.lineTo(0, -.81 * R); g.lineTo(-4, -.86 * R); g.fill(); });
        } else if (kind === 'mid') {
            arc(.64, 14, 'rgba(240,205,135,.1)'); arc(.575, 1, GOLD + '99'); arc(.705, 1, GOLD + '99');
            g.fillStyle = '#efe3c8';
            g.font = '700 15px Georgia,serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].forEach((t, i) => { g.save(); g.rotate(i * MARK); g.fillText(t, 0, -.64 * R); g.restore(); });
        } else if (kind === 'inner') {
            g.setLineDash([9, 6]); arc(.45, 3, tint); g.setLineDash([]);
            arc(.4, 1, tint + '66');
            g.fillStyle = GOLD;
            around(3, () => { g.beginPath(); g.arc(0, -.45 * R, 3, 0, TAU); g.fill(); });
        } else if (kind === 'shock') {
            arc(.9, 10, GOLD + '33'); arc(.9, 3, GOLD);
        } else {
            arc(.985, 1, 'rgba(163,156,173,.35)');
            g.fillStyle = 'rgba(163,156,173,.6)';
            around(4, () => g.fillRect(-1, -R, 2, 7));
            // 잠긴 옵션 수만큼 상단에 금색 고정쇠
            g.fillStyle = GOLD;
            for (let i = 0; i < locked; i++) { g.save(); g.rotate((i - (locked - 1) / 2) * .17); g.fillRect(-4, -R + 1, 8, 6); g.restore(); }
        }
        return c;
    }
    function glowCanvas(core, edge) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, core); grad.addColorStop(.3, edge); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        return c;
    }

    // ---- 렌더러: 같은 상태를 2D(정사영) 또는 Three.js(원근)로 그린다 ----
    const dpr = () => Math.min(2, window.devicePixelRatio || 1);
    function view2D(canvas, tex) {
        const g = canvas.getContext('2d');
        const blit = (img, s, a) => { if (a > 0) { g.globalAlpha = a; g.drawImage(img, -s / 2, -s / 2, s, s); } };
        return {
            draw(st, w, h) {
                const ratio = dpr(), W = Math.round(w * ratio), H = Math.round(h * ratio);
                if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
                const u = H / 1.15;
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.clearRect(0, 0, W, H);
                g.translate(W / 2, H / 2);
                g.globalCompositeOperation = 'lighter';
                blit(tex.glow, st.glow.s * u, st.glow.a);
                g.globalCompositeOperation = 'source-over';
                st.rings.forEach((r, i) => {
                    g.save(); g.rotate(-r.axisNow); g.scale(1, Math.cos(r.tiltNow)); g.rotate(-r.spin);
                    blit(tex.rings[i], u, 1); g.restore();
                });
                g.globalCompositeOperation = 'lighter';
                blit(tex.shock, st.shock.s * u, st.shock.a);
                blit(tex.bloom, st.bloom.s * u, st.bloom.a);
                st.sparks.forEach(p => { if (p.al > 0) { g.globalAlpha = p.al; g.drawImage(tex.spark, p.x * u - 4 * ratio, -p.y * u - 4 * ratio, 8 * ratio, 8 * ratio); } });
                g.globalAlpha = 1;
                g.globalCompositeOperation = 'source-over';
            },
            dispose() { canvas.width = canvas.height = 0; }
        };
    }

    function viewGL(T, canvas, tex) {
        const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setClearColor(0, 0);
        const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, .1, 10);
        camera.position.z = 1.15 / 2 / Math.tan(15 * Math.PI / 180);
        const owned = [], plane = new T.PlaneGeometry(1, 1);
        owned.push(plane);
        const texture = img => { const t = new T.CanvasTexture(img); if ('colorSpace' in t) t.colorSpace = T.SRGBColorSpace; owned.push(t); return t; };
        const mesh = (img, order, additive) => {
            const m = new T.MeshBasicMaterial({ map: texture(img), transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide, blending: additive ? T.AdditiveBlending : T.NormalBlending });
            owned.push(m);
            const node = new T.Mesh(plane, m);
            node.renderOrder = order;
            return node;
        };
        const glow = mesh(tex.glow, 0, true), shock = mesh(tex.shock, 5, true), bloom = mesh(tex.bloom, 6, true);
        scene.add(glow, shock, bloom);
        const rings = tex.rings.map((img, i) => {
            const pivot = new T.Group(), tilt = new T.Group(), ring = mesh(img, 1 + i, false);
            pivot.add(tilt); tilt.add(ring); scene.add(pivot);
            return { pivot, tilt, ring };
        });
        const pos = new Float32Array(SPARKS * 3), col = new Float32Array(SPARKS * 3), geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
        const pointMat = new T.PointsMaterial({ map: texture(tex.spark), size: .05, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending });
        owned.push(geo, pointMat);
        const points = new T.Points(geo, pointMat);
        points.renderOrder = 7;
        scene.add(points);
        const size = new T.Vector2();
        const layer = (node, l) => { node.scale.setScalar(l.s || .001); node.material.opacity = l.a; node.visible = l.a > 0; };
        return {
            draw(st, w, h) {
                renderer.getSize(size);
                if (size.x !== w || size.y !== h || renderer.getPixelRatio() !== dpr()) {
                    renderer.setPixelRatio(dpr()); renderer.setSize(w, h, false);
                    camera.aspect = w / h; camera.updateProjectionMatrix();
                }
                layer(glow, st.glow); layer(shock, st.shock); layer(bloom, st.bloom);
                st.rings.forEach((r, i) => { rings[i].pivot.rotation.z = r.axisNow; rings[i].tilt.rotation.x = r.tiltNow; rings[i].ring.rotation.z = r.spin; });
                st.sparks.forEach((p, i) => { pos.set([p.x, p.y, 0], i * 3); col.set([p.al, p.al * .86, p.al * .6], i * 3); });
                geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
                renderer.render(scene, camera);
            },
            dispose() {
                owned.forEach(o => o.dispose());
                renderer.dispose();
                if (renderer.forceContextLoss) renderer.forceContextLoss();
            }
        };
    }
    let threeLoad = null;
    const loadThree = () => threeLoad || (threeLoad = import(THREE_URL));

    // ---- 연출 ----
    function begin(host, options = {}) {
        const rarity = RARITY_ALIAS[options.rarity] || String(options.rarity || '').toLowerCase();
        const tint = TINT[rarity] || TINT.rare;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const locked = Math.max(0, Math.min(9, options.lockedCount | 0));
        const stage = make('div', 'af-fx' + (reduced ? ' reduced' : ''));
        stage.style.setProperty('--af-fx-tint', tint);
        const canvas = make('canvas', 'af-fx-canvas');
        canvas.setAttribute('aria-hidden', 'true');
        const icon = make('img', 'af-fx-icon');
        icon.alt = '';
        icon.onerror = () => { icon.hidden = true; };
        if (options.imageUrl) icon.src = options.imageUrl; else icon.hidden = true;
        const label = make('span', 'af-fx-label', '재설정 중');
        label.setAttribute('role', 'status');
        stage.append(canvas, icon, label);
        host.append(stage);
        host.hidden = false;
        play('start');

        const tex = {
            rings: RINGS.map(r => ringCanvas(r.kind, tint, locked)),
            shock: ringCanvas('shock', tint, 0),
            glow: glowCanvas('rgba(255,255,255,.85)', tint + '55'),
            bloom: glowCanvas('rgba(255,246,222,.95)', GOLD + '80'),
            spark: glowCanvas('#fff', GOLD + 'aa')
        };
        const spawn = (p, f) => Object.assign(p, { a: Math.random() * TAU, r: .16 + .46 * f, x: 0, y: 0, v: .2 + Math.random() * .12, w: 1.1 + Math.random(), burst: false, al: 0 });
        const st = {
            rings: RINGS.map((r, i) => ({ ...r, spin: i * .7, axisNow: r.axis, tiltNow: 0 })),
            sparks: Array.from({ length: reduced ? 0 : SPARKS }, () => spawn({}, Math.random())),
            glow: { s: .5, a: .5 }, shock: { s: 0, a: 0 }, bloom: { s: 0, a: 0 }
        };
        const t0 = performance.now();
        let view = view2D(canvas, tex), disposed = false, frozen = false, settleAt = 0, impactAt = 0, raf = 0, last = 0;
        let pending = null, resolvePending = null;
        const timers = new Set();
        const after = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

        function update(now, dt) {
            const t = (now - t0) / 1000, brake = reduced ? 220 : BRAKE;
            if (!settleAt) {
                const level = reduced ? .12 : Math.min(1, t / .35);
                st.rings.forEach((r, i) => {
                    r.spin += r.speed * level * dt;
                    if (reduced) return;
                    r.axisNow = r.axis + Math.sin(t * .5 + i) * .35;
                    r.tiltNow = r.tilt * (.55 + .45 * Math.sin(t * 1.3 + i * 2.1));
                });
                st.glow.s = .48 + (reduced ? 0 : .04 * Math.sin(t * 5));
                st.glow.a = Math.min(.6, t * 2);
            } else {
                // 감속하며 기울기가 풀리고 각인이 눈금에 맞물린다.
                const p = ease(clamp((now - settleAt) / brake));
                st.rings.forEach(r => {
                    r.spin = r.from + (r.to - r.from) * p;
                    r.tiltNow = r.tilt0 * (1 - p);
                    r.axisNow = r.axis0 * (1 - p);
                });
                st.glow.a = .6 + .3 * p;
            }
            if (impactAt) {
                const q = clamp((now - impactAt) / (reduced ? 200 : BLOOM));
                st.shock.s = reduced ? .9 : .5 + .75 * ease(q);
                st.shock.a = 1 - q;
                st.bloom.s = .4 + (reduced ? 0 : .35 * ease(q));
                st.bloom.a = .8 * (q < .15 ? q / .15 : (1 - q) / .85);
            }
            st.sparks.forEach((p, i) => {
                if (p.burst) {
                    const q = clamp((now - impactAt) / 450);
                    p.r += p.v * (1 - q) * dt;
                    p.al = 1 - q;
                } else {
                    const level = settleAt ? 1.6 : 1;
                    p.r -= p.v * level * dt;
                    p.a += p.w * dt;
                    if (p.r < .1) { if (settleAt) p.al = 0; else spawn(p, 1); }
                    if (p.r >= .1) p.al = .85 * clamp((.62 - p.r) * 4) * clamp((p.r - .1) * 8);
                }
                if (impactAt && !p.burst) Object.assign(p, { burst: true, a: i / SPARKS * TAU + Math.random() * .2, r: .12, v: .9 + Math.random() * .6 });
                p.x = Math.cos(p.a) * p.r;
                p.y = Math.sin(p.a) * p.r * .7;
            });
        }
        function frame(now) {
            raf = 0;
            if (disposed || frozen) return;
            update(now, Math.min(.05, (now - (last || now)) / 1000));
            last = now;
            const w = stage.clientWidth, h = stage.clientHeight;
            if (w && h) view.draw(st, w, h);
            // 응답이 오지 않으면 일정 시간 뒤 마지막 장면에서 멈춘다.
            if (!settleAt && now - t0 > MAX_LOOP) return;
            raf = requestAnimationFrame(frame);
        }
        const kick = () => { if (!raf && !disposed && !frozen) raf = requestAnimationFrame(frame); };

        function teardown(stopAudio) {
            if (!disposed) {
                disposed = true;
                cancelAnimationFrame(raf);
                raf = 0;
                timers.forEach(clearTimeout);
                timers.clear();
                if (stopAudio) stopAll();
                try { view.dispose(); } catch (_) {}
                stage.remove();
                if (!host.querySelector('.af-fx')) host.hidden = true;
                window.removeEventListener('pagehide', dispose);
            }
            if (resolvePending) resolvePending();
        }
        function dispose() { teardown(true); }
        function finish(success = true) {
            if (pending) return pending;
            pending = new Promise(resolve => { resolvePending = resolve; });
            if (disposed) { resolvePending(); return pending; }
            if (!success) {
                frozen = true;
                stage.classList.add('fail');
                label.textContent = '재설정 실패';
                stopAll();
                play('fail');
                after(FAIL_OUT, () => teardown(false));
                return pending;
            }
            after(Math.max(0, (reduced ? 300 : MIN_SPIN) - (performance.now() - t0)), () => {
                st.rings.forEach(r => {
                    r.from = r.spin;
                    r.to = r.speed > 0 ? Math.ceil((r.spin + .35) / MARK) * MARK : r.speed < 0 ? Math.floor((r.spin - .35) / MARK) * MARK : r.spin;
                    r.tilt0 = r.tiltNow;
                    r.axis0 = r.axisNow;
                });
                settleAt = performance.now();
                stopAll();
                play('brake');
                kick();
                after(reduced ? 220 : BRAKE, () => {
                    impactAt = performance.now();
                    stage.classList.add('done');
                    label.textContent = '옵션 확정';
                    play('done');
                    // 확정음은 끝까지 울리게 두고 화면만 정리한다.
                    after(reduced ? 200 : BLOOM, () => teardown(false));
                });
            });
            return pending;
        }

        window.addEventListener('pagehide', dispose);
        kick();
        loadThree().then(T => {
            if (disposed) return;
            const glCanvas = make('canvas', 'af-fx-canvas');
            glCanvas.setAttribute('aria-hidden', 'true');
            let gl;
            try { gl = viewGL(T, glCanvas, tex); } catch (_) { return; }
            canvas.replaceWith(glCanvas);
            view.dispose();
            view = gl;
            if (frozen) return;
            const w = stage.clientWidth, h = stage.clientHeight;
            if (w && h) view.draw(st, w, h);
        }).catch(() => { /* Canvas 2D 유지 */ });
        return { finish, dispose };
    }

    window.ArtifactEffects = { begin, soundControl };
})();
