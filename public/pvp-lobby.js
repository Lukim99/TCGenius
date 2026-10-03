/* PVP 콘텐츠 화면. 실제 전투는 기존 /pvp 엔진으로 연결한다. */
(() => {
    'use strict';
    let threePromise;
    const GOLD = '#d9a441', IVORY = '#f4ebd8', MUTED = '#aaa2b8';
    const kinds = { near: '근접', higher: '상위', random: '랜덤', extra: '추가' };
    const number = n => Number(n || 0).toLocaleString();
    const node = (tag, attrs = {}, text) => {
        const n = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
        if (text != null) n.textContent = text;
        return n;
    };

    function mount(root, callbacks) {
        const stage = node('section', { class: 'pvp-stage', 'aria-label': 'PVP 경기장' });
        const glCanvas = node('canvas', { class: 'pvp-gl', 'aria-hidden': 'true' });
        const flat = node('div', { class: 'pvp-flat', 'aria-hidden': 'true', hidden: '' });
        const flatMine = node('img', { alt: '' }), flatOpponent = node('img', { alt: '' });
        flat.append(flatMine, flatOpponent);
        const hud = node('canvas', { class: 'pvp-hud', 'aria-hidden': 'true' });
        const hit = node('div', { class: 'pvp-hit' });
        const summary = node('div', { class: 'pvp-accessible', role: 'status', 'aria-live': 'polite' });
        const controls = {};
        let data, busy = false, selectedIndex = -1, width = 0, height = 0, sceneHeight = 0;
        let engine, destroyed = false, raf = 0, lastTime = 0, elapsed = 0, switchAt = 0;
        const ctx = hud.getContext('2d');
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        const page = root.closest('.page');
        const current = () => (data?.daily?.opponents || [])[selectedIndex];
        const opponents = () => data?.daily?.opponents || [];
        const done = o => o && (o.result === 'win' || o.result === 'lose');
        const visible = () => !document.hidden && stage.isConnected && (!page || page.classList.contains('active'));

        function button(id, label, action) {
            const b = node('button', { type: 'button', class: 'pvp-control', 'aria-label': label }, label);
            b.addEventListener('click', action);
            controls[id] = { button: b, label, rect: null };
            hit.append(b);
        }
        function choose(step) {
            const list = opponents();
            if (list.length < 2 || busy) return;
            selectedIndex = (selectedIndex + step + list.length) % list.length;
            switchAt = performance.now();
            update(data, busy);
        }
        button('previous', '이전 상대', () => choose(-1));
        button('next', '다음 상대', () => choose(1));
        button('challenge', '도전', () => {
            if (!busy && (data?.battle?.active || current() && !done(current()))) callbacks.challenge(data?.battle?.active ? data.battle.opponent : current().name);
        });
        button('defense', '방어 덱', () => callbacks.panel('defense'));
        button('ranking', '랭킹', () => callbacks.panel('ranking'));
        button('history', '기록', () => callbacks.panel('history'));
        button('refresh', '상대 새로고침', () => { if (!busy) callbacks.refresh(); });
        button('extra', '추가 도전', () => { if (!busy) callbacks.extra(); });
        const keydown = e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); choose(e.key === 'ArrowLeft' ? -1 : 1); }
        };
        stage.addEventListener('keydown', keydown);
        stage.append(glCanvas, flat, hud, hit, summary);
        root.replaceChildren(stage);
        if (!ctx) stage.classList.add('pvp-native');

        function control(id, x, y, w, h, label) {
            const c = controls[id];
            c.rect = { x, y, w, h };
            c.label = label;
            c.button.textContent = label;
            Object.assign(c.button.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        }
        function resize() {
            if (destroyed || !stage.clientWidth) return;
            width = stage.clientWidth;
            const narrow = width < 700;
            height = narrow ? 622 : Math.max(540, Math.min(680, width * .58, innerHeight - 154));
            sceneHeight = narrow ? 410 : height;
            stage.style.height = height + 'px';
            const dpr = Math.min(devicePixelRatio || 1, 2);
            hud.width = Math.round(width * dpr); hud.height = Math.round(height * dpr);
            ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (engine) engine.resize(width, sceneHeight, narrow);
            const o = current(), daily = data?.daily || {};
            control('previous', 14, narrow ? 105 : height * .53, 44, 48, '‹');
            control('next', width - 58, narrow ? 105 : height * .53, 44, 48, '›');
            const mainY = narrow ? 412 : height - 76;
            const mainW = narrow ? width - 32 : 216;
            control('challenge', (width - mainW) / 2, mainY, mainW, 56,
                data?.battle?.active ? '전투 이어하기' : done(o) ? (o.result === 'win' ? '승리 +' : '패배 −') + number(Math.abs(o.ratingDelta || 0)) : '도전');
            const menuW = narrow ? (width - 52) / 3 : 116;
            ['defense', 'ranking', 'history'].forEach((id, i) => control(id,
                narrow ? 16 + i * (menuW + 10) : width - 132,
                narrow ? 482 : 118 + i * 54, menuW, 44, { defense: '방어 덱', ranking: '랭킹', history: '기록' }[id]));
            const utilityW = narrow ? (width - 42) / 2 : 154;
            control('refresh', narrow ? 16 : 16, narrow ? 536 : height - 76, utilityW, 48,
                '새로고침 ' + Math.max(0, Number(daily.refreshMax || 0) - Number(daily.refreshUsed || 0)) + '회');
            control('extra', narrow ? 26 + utilityW : width - utilityW - 16, narrow ? 536 : height - 76, utilityW, 48,
                daily.extraFree ? '추가 도전 무료' : '추가 도전 ' + number(daily.extraCost) + '가넷');
            draw();
        }
        function panel(x, y, w, h, gold = false) {
            ctx.beginPath(); ctx.roundRect(x, y, w, h, 9);
            if (gold) {
                const gradient = ctx.createLinearGradient(0, y, 0, y + h);
                gradient.addColorStop(0, '#f2cf7a'); gradient.addColorStop(1, '#9a6a23');
                ctx.fillStyle = gradient;
            } else ctx.fillStyle = 'rgba(21,19,31,.88)';
            ctx.fill(); ctx.strokeStyle = gold ? '#f2cf7a' : 'rgba(217,164,65,.6)'; ctx.lineWidth = 1; ctx.stroke();
        }
        function text(value, x, y, size = 14, color = IVORY, align = 'left', weight = 600) {
            ctx.font = weight + ' ' + size + 'px Pretendard, sans-serif';
            ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
            ctx.fillText(String(value), x, y);
        }
        function namePlate(name, detail, x, y, w) {
            panel(x, y, w, 61);
            ctx.font = '700 16px Pretendard, sans-serif';
            const lines = [''];
            for (const char of String(name)) {
                if (ctx.measureText(lines.at(-1) + char).width > w - 20) lines.push('');
                lines[lines.length - 1] += char;
            }
            lines.slice(0, 2).forEach((line, i) => text(line, x + w / 2, y + (lines.length > 1 ? 15 + i * 17 : 22), 16, IVORY, 'center', 700));
            text(detail, x + w / 2, y + 48, 12, MUTED, 'center', 500);
        }
        function draw() {
            if (!ctx || !width || !data || destroyed) return;
            ctx.clearRect(0, 0, width, height);
            const narrow = width < 700, o = current(), me = data.me || {}, daily = data.daily || {};
            panel(12, 12, width - 24, narrow ? 87 : 76);
            text('PVP', 28, 37, 23, '#f2cf7a', 'left', 800);
            text('레이팅 ' + number(me.rating), 28, 65, 13);
            const right = width - 28;
            text('오늘 ' + number(daily.battlesUsed) + ' / ' + number(daily.battlesMax), right, 37, 14,
                daily.battlesUsed >= daily.battlesMax ? '#e0564f' : IVORY, 'right');
            text(number(me.wins) + '승 ' + number(me.losses) + '패' + (me.rank ? '   ' + number(me.rank) + '위' : ''), right, 65, 13, MUTED, 'right');
            const count = opponents().length;
            const ribbonY = narrow ? 113 : 111;
            text(count ? '상대 ' + (selectedIndex + 1) + ' / ' + count + (kinds[o?.kind] ? '   ' + kinds[o.kind] : '') : '매칭 가능한 상대가 없습니다.', width / 2, ribbonY, 14, '#7de2ef', 'center');
            if (narrow) {
                namePlate('나', me.mainCard?.formatted || '카드 없음', 16, 306, 118);
                namePlate(o?.name || '상대 없음', o ? 'Lv.' + number(o.level) + '   레이팅 ' + number(o.rating) : '', width * .34, 339, width * .66 - 16);
            } else {
                const plateW = Math.min(250, width * .29);
                namePlate(me.name || '나', me.mainCard?.formatted || '카드 없음', width * .27 - plateW / 2, height - 178, plateW);
                namePlate(o?.name || '상대 없음', o ? 'Lv.' + number(o.level) + '   레이팅 ' + number(o.rating) : '', width * .73 - plateW / 2, height - 178, plateW);
            }
            for (const [id, c] of Object.entries(controls)) {
                if (!c.rect) continue;
                const { x, y, w, h } = c.rect;
                ctx.save(); ctx.globalAlpha = c.button.disabled ? .48 : 1;
                panel(x, y, w, h, id === 'challenge' && !c.button.disabled);
                text(c.label, x + w / 2, y + (id === 'extra' ? 17 : h / 2), id === 'challenge' ? 20 : id === 'previous' || id === 'next' ? 30 : 13,
                    id === 'challenge' && !c.button.disabled ? '#1a1408' : IVORY, 'center', 700);
                if (id === 'extra') text('남은 ' + Math.max(0, Number(daily.extraMax || 0) - Number(daily.extraUsed || 0)) + '회', x + w / 2, y + 35, 12, MUTED, 'center');
                ctx.restore();
            }
            const caption = data.battle?.active ? '진행 중인 전투  ' + data.battle.opponent
                : done(o) ? o.reward ? '보상  ' + o.reward : '대결 완료' : o?.cardFormatted || '';
            if (caption) text(caption, width / 2, narrow ? 604 : height - 103, 12, MUTED, 'center');
        }
        function update(next, isBusy = false) {
            const previous = current();
            data = next; busy = isBusy;
            const list = opponents();
            // 추가 도전에서는 같은 상대가 다시 등록될 수 있으므로 이름만으로 선택하지 않는다.
            if (previous && (list[selectedIndex]?.name !== previous.name || list[selectedIndex]?.kind !== previous.kind)) {
                selectedIndex = list.findIndex(o => o.name === previous.name && o.kind === previous.kind && o.result === previous.result);
            }
            if (selectedIndex < 0 || !list[selectedIndex]) selectedIndex = Math.max(0, list.findIndex(o => !done(o)));
            const o = current(), me = data.me || {}, daily = data.daily || {};
            controls.challenge.button.disabled = busy || !data.battle?.active && (!o || done(o));
            controls.challenge.button.setAttribute('aria-label', data.battle?.active ? '전투 이어하기' : done(o) ? '대결 완료' : '도전: ' + (o?.name || '상대 없음'));
            controls.previous.button.disabled = controls.next.button.disabled = busy || list.length < 2;
            controls.refresh.button.disabled = busy || !daily.canRefresh;
            controls.extra.button.disabled = busy || !daily.canBuyExtra;
            for (const id of ['defense', 'ranking', 'history']) controls[id].button.disabled = busy;
            summary.textContent = '내 레이팅 ' + number(me.rating) + ', 오늘 ' + number(daily.battlesUsed) + '/' + number(daily.battlesMax) + '회. ' +
                (o ? '상대 ' + (list.indexOf(o) + 1) + '/' + list.length + ', ' + o.name + ', ' + (kinds[o.kind] || '') + ', 레이팅 ' + number(o.rating) + ', ' + (o.cardFormatted || '') + (done(o) ? ', ' + (o.result === 'win' ? '승리' : '패배') + ', 레이팅 변화 ' + number(o.ratingDelta) + (o.reward ? ', 보상 ' + o.reward : '') : '') : '매칭 가능한 상대가 없습니다.') +
                (data.battle?.active ? ' 진행 중인 전투: ' + data.battle.opponent : '');
            for (const [img, url] of [[flatMine, me.mainCard?.imageUrl], [flatOpponent, o?.cardImageUrl]]) {
                if (url) { img.src = url; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
            }
            engine?.cards(me.mainCard?.imageUrl, o?.cardImageUrl);
            resize(); resume();
        }

        function animate(time) {
            raf = 0;
            if (destroyed || !visible()) { lastTime = 0; return; }
            elapsed += lastTime ? Math.min(.05, (time - lastTime) / 1000) : 0;
            lastTime = time;
            engine?.render(elapsed, motion.matches, Math.max(0, 1 - (time - switchAt) / 300));
            draw();
            if (!motion.matches && engine) raf = requestAnimationFrame(animate);
        }
        function resume() {
            cancelAnimationFrame(raf); raf = 0; lastTime = 0;
            if (visible()) raf = requestAnimationFrame(animate);
        }
        function fallback() { glCanvas.hidden = true; flat.hidden = false; draw(); }
        const lost = e => { e.preventDefault(); engine?.dispose(); engine = null; fallback(); resume(); };
        glCanvas.addEventListener('webglcontextlost', lost);
        const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage);
        const pageObserver = new MutationObserver(resume);
        if (page) pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('visibilitychange', resume);
        motion.addEventListener('change', resume);
        document.fonts.ready.then(() => { if (!destroyed) draw(); });
        threePromise ||= import('/static/vendor/yut/three.module.min.js');
        threePromise.then(THREE => {
            if (destroyed) return;
            try {
                engine = createArena(THREE, glCanvas, () => resume());
                engine.cards(data?.me?.mainCard?.imageUrl, current()?.cardImageUrl);
                resize(); resume();
            } catch (_) { fallback(); }
        }).catch(fallback);
        return { update, destroy() {
            destroyed = true; cancelAnimationFrame(raf);
            resizeObserver.disconnect(); pageObserver.disconnect();
            document.removeEventListener('visibilitychange', resume); motion.removeEventListener('change', resume);
            stage.removeEventListener('keydown', keydown); glCanvas.removeEventListener('webglcontextlost', lost);
            engine?.dispose(); stage.remove();
        } };
    }

    function createArena(T, canvas, loaded) {
        const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        const scene = new T.Scene(); scene.background = new T.Color('#0b0a12'); scene.fog = new T.Fog('#0b0a12', 10, 22);
        const camera = new T.PerspectiveCamera(38, 1, .1, 30);
        const resources = new Set(), textures = new Map();
        let disposed = false;
        const material = options => { const m = new T.MeshStandardMaterial(options); resources.add(m); return m; };
        const mesh = (geometry, mat, x, y, z) => {
            resources.add(geometry);
            const m = new T.Mesh(geometry, mat); m.position.set(x, y, z); scene.add(m); return m;
        };
        scene.add(new T.AmbientLight('#d3c8ee', 1.2));
        const sun = new T.DirectionalLight('#ffe2b0', 2.2); sun.position.set(3, 7, 5); scene.add(sun);
        const arena = mesh(new T.CylinderGeometry(4.2, 4.5, .35, 48), material({ color: '#3a3546', roughness: .85 }), 0, -.2, 0);
        const stone = document.createElement('canvas'); stone.width = stone.height = 256;
        const ink = stone.getContext('2d');
        ink.fillStyle = '#393342'; ink.fillRect(0, 0, 256, 256);
        ink.strokeStyle = '#25212e'; ink.lineWidth = 2;
        for (let y = 0; y < 256; y += 64) for (let x = -32; x < 256; x += 64) ink.strokeRect(x + (y / 64 % 2 ? 32 : 0), y, 64, 64);
        const stoneTexture = new T.CanvasTexture(stone); resources.add(stoneTexture); stoneTexture.colorSpace = T.SRGBColorSpace;
        stoneTexture.wrapS = stoneTexture.wrapT = T.RepeatWrapping; stoneTexture.repeat.set(3, 3); arena.material.map = stoneTexture;
        const rings = [];
        for (const [radius, color] of [[3.6, '#8b5cf6'], [3.9, '#38d3e8']]) {
            const ring = mesh(new T.TorusGeometry(radius, .028, 8, 80), material({ color, emissive: color, emissiveIntensity: 1.2 }), 0, .015, 0);
            ring.rotation.x = -Math.PI / 2; rings.push(ring);
        }
        const sides = [-1, 1].map((side, i) => {
            const group = new T.Group(); scene.add(group);
            const pedestal = new T.Mesh(new T.CylinderGeometry(.75, .9, .5, 32), material({ color: '#2a2536', roughness: .6 }));
            resources.add(pedestal.geometry); group.add(pedestal); pedestal.position.y = .25;
            const rim = new T.Mesh(new T.TorusGeometry(.78, .025, 8, 48), material({ color: GOLD, metalness: .8, roughness: .3 }));
            resources.add(rim.geometry); rim.rotation.x = -Math.PI / 2; rim.position.y = .51; group.add(rim);
            const cardGroup = new T.Group(); group.add(cardGroup);
            const back = new T.Mesh(new T.PlaneGeometry(1.63, 2.08), new T.MeshBasicMaterial({ color: '#d9a441', side: T.DoubleSide }));
            resources.add(back.geometry); resources.add(back.material); cardGroup.add(back);
            const card = new T.Mesh(new T.PlaneGeometry(1.55, 2), new T.MeshBasicMaterial({ color: '#282232', side: T.DoubleSide }));
            resources.add(card.geometry); resources.add(card.material); card.position.z = .015; cardGroup.add(card);
            const light = new T.PointLight(i ? '#38d3e8' : '#8b5cf6', 14, 7); group.add(light); light.position.set(0, .6, 1.5);
            return { group, cardGroup, card, light, url: null, y: 1.55, x: side * 2.1 };
        });
        const loader = new T.TextureLoader();
        function setCard(side, url) {
            if (side.url === url) return;
            side.url = url; side.card.material.map = null; side.card.material.color.set('#282232'); side.card.material.needsUpdate = true;
            if (!url) return;
            let texture = textures.get(url);
            if (!texture) {
                texture = loader.load(url, () => { if (!disposed) loaded(); }, undefined, () => { if (!disposed) loaded(); });
                texture.colorSpace = T.SRGBColorSpace; textures.set(url, texture);
            }
            side.card.material.map = texture; side.card.material.color.set('#ffffff'); side.card.material.needsUpdate = true;
        }
        return {
            cards(me, opponent) { setCard(sides[0], me); setCard(sides[1], opponent); },
            resize(w, h, narrow) {
                renderer.setSize(w, h); camera.aspect = w / h; camera.fov = narrow ? 44 : 38;
                camera.position.set(0, narrow ? 2.6 : 3.1, narrow ? 7.2 : 8.4); camera.lookAt(0, narrow ? 1.5 : 1.2, 0); camera.updateProjectionMatrix();
                sides.forEach((s, i) => {
                    s.x = narrow ? i ? .35 : -1.55 : i ? 2.1 : -2.1;
                    s.y = narrow ? i ? 1.35 : 1.4 : 1.55;
                    s.group.position.set(s.x, 0, narrow ? i ? 0 : 1.4 : i ? -.2 : .4);
                    s.cardGroup.scale.setScalar(narrow ? i ? 1.25 : .62 : Math.min(1, w / 1000));
                });
            },
            render(t, reduced, switching) {
                rings.forEach((r, i) => { r.rotation.z = reduced ? 0 : t * (i ? -.05 : .08); });
                sides.forEach((s, i) => {
                    s.cardGroup.position.set(i && !reduced ? switching * .3 : 0, s.y + (reduced ? 0 : Math.sin(t * 1.4 + i * 1.6) * .04), 0);
                    s.cardGroup.rotation.y = reduced ? 0 : Math.sin(t * .6) * .06;
                    s.light.intensity = 14 + (i && !reduced ? switching * 10 : 0);
                });
                renderer.render(scene, camera);
            },
            dispose() {
                if (disposed) return; disposed = true;
                resources.forEach(r => r.dispose()); textures.forEach(t => t.dispose()); renderer.dispose();
            }
        };
    }
    window.PvpLobby = { mount };
})();
