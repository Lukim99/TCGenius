// 지원군 등장과 파티원의 피해, 회복, 보호막을 그린다. 수치와 판정은 서버가 보낸 사건을 그대로 따른다.
(() => {
    'use strict';
    // 외부 CC0 음원(docs/raid-assets.md). 기존 타격, 치명타, 스킬, 물약, 카운트다운 음원은 쓰지 않는다.
    const SOUNDS = { heal: 'healing-absorb-v2', ward: 'ward-form-v2', glint: 'mirror-glint-v2', shatter: 'echo-break-v2', hurt: 'stone-hit-v2', earth: 'dark-impact-v2',
        rubble: 'ground-land-v2', cutA: 'doom-cut-v2', cutB: 'dealing-cut-v2', thunder: 'resonance-impact-v2', bloom: 'revival-bloom-v2', aura: 'dealing-aura-v2' };
    const TEXTURES = { heal: '레이드/fx-party-heal.png', aegis: '레이드/fx-party-aegis.png', shard: '레이드/fx-bronze-shard.png' };
    // 지원군마다 색, 타격 방식, 효과음 시각(등장 기준 초). STRIKE는 실제 효과가 닿는 순간이다.
    const STRIKE = .55, ENTRY = 1.5;
    const SUPPORT = {
        '지오': { tone: [222, 168, 104], strike: 'earth', sounds: [[.5, 'cutA', .4], [.56, 'earth', .45], [.8, 'rubble', .3]] },
        'SitoSoym': { tone: [214, 226, 246], strike: 'ward', sounds: [[.42, 'ward', .42]] },
        'X': { tone: [226, 234, 248], strike: 'cross', sounds: [[.5, 'cutA', .45], [.62, 'cutB', .45], [.9, 'glint', .3]] },
        '피카츄': { tone: [255, 194, 88], strike: 'spark', sounds: [[.5, 'thunder', .4]] },
        '오로라': { tone: [186, 236, 218], strike: 'aurora', figure: false, sounds: [[.42, 'bloom', .38]] },
        '눈뜬 장님': { tone: [246, 208, 122], strike: 'needle', sounds: [[.52, 'cutB', .42], [.68, 'aura', .32]] }
    };
    const LIFE = { damage: .7, heal: 1.25, 'shield-grant': 1.05, 'shield-block': .6, 'shield-break': 1.1, 'shield-expire': .95 };
    const HEAL = [196, 238, 200], HEAL_HOT = [255, 248, 222], WARD = [190, 212, 255], WARD_HOT = [246, 240, 214], BLOOD = [196, 34, 34];
    const TAU = Math.PI * 2, PRISM = [[186, 236, 218], [172, 192, 246], [238, 198, 216]];
    // 흐름에 쓰는 질감 원본의 결 영역 [x 시작, y 시작, x 범위, 높이] 비율: 회복 기운의 몸통, 방패 유리의 왼쪽 테.
    const GRAIN = { heal: [.3, .45, .35, .4], aegis: [.08, .3, .14, .4] };
    const rand = i => { const n = Math.sin(i * 61.37 + 17.8) * 43758.54; return n - Math.floor(n); };
    const clamp = v => Math.max(0, Math.min(1, v));
    const ease = p => 1 - (1 - clamp(p)) ** 3;
    const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
    const bell = (t, a, b) => Math.sin(Math.PI * clamp((t - a) / (b - a)));
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a) + ')';
    const hash = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h; };
    const images = new Map(), tiles = new Map(), grains = new Map();
    function picture(src) {
        if (!src) return null;
        let image = images.get(src);
        if (!image) { image = new Image(); image.decoding = 'async'; image.src = src; images.set(src, image); }
        return image.complete && image.naturalWidth ? image : null;
    }
    const texture = key => picture('/rpg-ui?file=' + encodeURIComponent(TEXTURES[key]));
    function flowGrain(key) {
        if (grains.has(key)) return grains.get(key);
        const image = texture(key), crop = GRAIN[key];
        if (!image || !crop) return null;
        const canvas = document.createElement('canvas'), g = canvas.getContext('2d');
        canvas.width = 96; canvas.height = 192;
        g.drawImage(image, image.naturalWidth * (crop[0] + crop[2] * .45), image.naturalHeight * crop[1],
            image.naturalWidth * .07, image.naturalHeight * crop[3], 0, 0, 96, 192);
        // 절단면의 알파를 부드럽게 닫아 궤적에서 사각 이음매가 드러나지 않게 한다.
        g.globalCompositeOperation = 'destination-in';
        for (const vertical of [false, true]) {
            const gradient = g.createLinearGradient(0, 0, vertical ? 0 : 96, vertical ? 192 : 0);
            gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.32, '#000');
            gradient.addColorStop(.68, '#000'); gradient.addColorStop(1, 'transparent');
            g.fillStyle = gradient; g.fillRect(0, 0, 96, 192);
        }
        grains.set(key, canvas);
        return canvas;
    }
    // 부드러운 빛 알갱이와 흙먼지 덩어리 타일. 종류마다 한 번만 만든다.
    function tile(key, size, blobs) {
        let canvas = tiles.get(key);
        if (canvas) return canvas;
        canvas = document.createElement('canvas'); canvas.width = canvas.height = size; tiles.set(key, canvas);
        const g = canvas.getContext('2d');
        for (const [x, y, r, stops] of blobs) {
            const gradient = g.createRadialGradient(x, y, 0, x, y, r);
            stops.forEach(([at, color]) => gradient.addColorStop(at, color));
            g.fillStyle = gradient; g.fillRect(0, 0, size, size);
        }
        return canvas;
    }
    const mote = c => tile('m' + c, 32, [[16, 16, 16, [[0, '#fffcf0'], [.25, rgba(c, .8)], [1, rgba(c, 0)]]]]);
    const dust = () => tile('dust', 96, Array.from({ length: 7 }, (_, i) => [24 + rand(i) * 48, 26 + rand(i + 9) * 44, 18 + rand(i + 3) * 22, [[0, 'rgba(142,118,92,.5)'], [1, 'rgba(142,118,92,0)']]]));

    function create() {
        const canvas = document.createElement('canvas');
        canvas.className = 'rpfx-canvas'; canvas.setAttribute('aria-hidden', 'true');
        (document.getElementById('frame') || document.body).append(canvas);
        const ctx = canvas.getContext('2d');
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const seen = new Map(), shields = new Map(), quiet = new Map(), bases = new Map(), playing = new Set(), lastPlayed = new Map();
        let effects = [], floats = [], active = false, scope = '', room = null, offset = 0, volume = 0;
        let frame = 0, lastFrame = 0, width = 0, height = 0, ratio = 1, bounds = null, layout = null;

        // ---- 소리: 기존 효과음과 같은 브라우저 Audio 재생. 같은 종류는 쿨다운으로 묶는다 ----
        function setVolume(value) { volume = clamp(Number(value) || 0); if (!volume) silence(); }
        function silence() { for (const a of playing) { try { a.pause(); } catch (_) {} } playing.clear(); }
        function base(key) {
            let audio = bases.get(key);
            if (!audio) { audio = new Audio('/rpg-ui?file=' + encodeURIComponent('sfx/raid/' + SOUNDS[key] + '.mp3')); audio.preload = 'auto'; bases.set(key, audio); }
            return audio;
        }
        function play(key, gain, cool = 0) {
            if (!volume || !active || document.hidden || !SOUNDS[key]) return;
            const now = performance.now();
            if (cool && now - (lastPlayed.get(key) ?? -1e9) < cool * 1000) return;
            lastPlayed.set(key, now);
            const a = base(key).cloneNode();
            a.volume = clamp(volume * gain);
            playing.add(a);
            a.onended = () => playing.delete(a);
            a.play().catch(() => playing.delete(a));
        }

        // ---- 배치: 카드는 200ms마다 다시 만들어지므로 매 프레임 현재 요소의 위치를 읽는다 ----
        function rectOf(node) {
            const r = node?.getBoundingClientRect();
            return r && r.width && r.height ? { x: r.left - bounds.left, y: r.top - bounds.top, w: r.width, h: r.height } : null;
        }
        function measure() {
            bounds = canvas.getBoundingClientRect();
            width = bounds.width; height = bounds.height;
            ratio = Math.min(2, window.devicePixelRatio || 1);
            const w = Math.round(width * ratio), h = Math.round(height * ratio);
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            const cards = new Map();
            document.querySelectorAll('.pq-char-card[data-member]').forEach(card => {
                const box = rectOf(card), img = rectOf(card.querySelector('.img')) || box;
                if (box) cards.set(card.dataset.member, { box, img, me: card.classList.contains('me') });
            });
            const stage = rectOf(document.getElementById('pqPhaseStage'));
            layout = { cards, stage, boss: stage && bossRect(stage), skills: rectOf(document.getElementById('pqSkillBar')) };
        }
        // 실제 보스 영역. 패턴 효과와 같은 data-subject 비율을 쓴다.
        function bossRect(stage) {
            const image = document.getElementById('pqBossIllustImg'), box = rectOf(image);
            if (box && image.naturalWidth) {
                const s = Math.min(box.w / image.naturalWidth, box.h / image.naturalHeight), w = image.naturalWidth * s, h = image.naturalHeight * s;
                let subject = [0, 0, 1, 1];
                try { subject = JSON.parse(image.dataset.subject || '[0,0,1,1]'); } catch (_) {}
                const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
                return { x: x + w * subject[0], y: y + h * subject[1], w: w * subject[2], h: h * subject[3] };
            }
            return { x: stage.x + stage.w * .3, y: stage.y + stage.h * .2, w: stage.w * .4, h: stage.h * .6 };
        }
        // 지원군이 서는 자리: 무대 왼쪽 위, 보스 체력바 아래. 패턴 입력 패널과 겹치면 높이를 줄인다.
        function anchor() {
            const stage = layout.stage;
            if (!stage) return null;
            const hud = rectOf(document.querySelector('#pqBossStage .pq-stage-hud'));
            const top = Math.max(stage.y + 8, hud ? hud.y + hud.h - 4 : 0), x = stage.x + 12;
            let h = Math.min(168, Math.max(72, stage.h * .42));
            const panel = rectOf(document.querySelector('.mr-root:not([hidden])'));
            if (panel && panel.x < x + h * .74 + 8 && panel.y < top + h + 28) h = Math.min(h, panel.y - top - 30);
            h = Math.min(h, stage.y + stage.h - top - 30);
            return { x, y: top, w: Math.max(0, h) * .74, h: Math.max(0, h), stage };
        }

        // ---- 사건 ----
        function update(snapshot, options = {}) {
            if (!snapshot || snapshot.state !== 'inProgress') { if (active || scope) reset(); return; }
            const next = snapshot.id + ':' + snapshot.startedAt + ':' + snapshot.phaseIndex;
            if (next !== scope) { reset(); scope = next; room = { id: snapshot.id, startedAt: Number(snapshot.startedAt), phaseIndex: Number(snapshot.phaseIndex) }; }
            active = true;
            offset = Number(options.serverOffset) || 0;
            setVolume(options.volume);
            shields.clear();
            for (const m of snapshot.members || []) {
                const r = m.runtime;
                if (r && !r.dead && Number(r.shield) > 0) shields.set(m.name, Number(r.shield));
            }
            texture('aegis'); texture('heal');
            for (const key in SOUNDS) base(key);
            mark(); kick();
        }
        function enqueue(ev) {
            if (!active || !ev || !room || document.hidden) return;
            if (ev.roomId !== room.id || Number(ev.startedAt) !== room.startedAt || Number(ev.phaseIndex) !== room.phaseIndex) return;
            const id = String(ev.id || ''), now = performance.now();
            if (!id || seen.has(id)) return;
            seen.set(id, now);
            if (seen.size > 400) for (const [key, at] of seen) if (now - at > 30000) seen.delete(key);
            // 재접속이나 늦게 도착한 지난 사건은 다시 그리지 않는다.
            const age = Date.now() - offset - Number(ev.at || 0);
            if (!(age < 2500)) return;
            const amount = Math.max(0, Math.round(Number(ev.amount) || 0));
            if (ev.kind === 'support') {
                const spec = SUPPORT[ev.support];
                if (!spec) return;
                if (ev.icon) picture(ev.icon);
                if (spec.strike === 'earth') texture('shard');
                effects = effects.filter(e => e.kind !== 'support');
                effects.push({ kind: 'support', spec, name: ev.support, icon: ev.icon, start: now, life: ENTRY, seed: hash(id), fired: new Set() });
                kick();
                return;
            }
            if (!LIFE[ev.kind] || !ev.target) return;
            // 지원군이 주는 효과는 지원군의 기운이 카드에 닿는 순간에 시작한다. 이동은 지원군 연출이 맡는다.
            const entry = ev.support && effects.find(e => e.kind === 'support' && e.name === ev.support);
            const start = entry ? Math.max(now, entry.start + (STRIKE + .3) * 1000) : now;
            const effect = { kind: ev.kind, target: ev.target, source: ev.source, support: ev.support || '', amount, start, life: LIFE[ev.kind], seed: hash(id), sounded: false };
            if (ev.kind === 'shield-break' || ev.kind === 'shield-expire') quiet.set(ev.target, start + 1200);
            if (ev.kind === 'shield-grant') quiet.delete(ev.target);
            effects.push(effect);
            if (effects.length > 48) effects.splice(effects.findIndex(e => e.kind !== 'support'), 1);
            if (amount) addFloat(effect);
            kick();
        }
        // 짧은 간격의 같은 종류 숫자는 하나로 합친다.
        function addFloat(e) {
            const kind = e.kind === 'shield-block' ? 'block' : e.kind === 'damage' ? 'damage' : e.kind === 'heal' ? 'heal' : e.kind === 'shield-grant' ? 'ward' : '';
            if (!kind) return;
            const delay = kind === 'heal' && moving(e) ? 380 : 0;
            const recent = floats.find(f => f.target === e.target && f.kind === kind && e.start + delay - f.start < (kind === 'heal' ? 500 : 280));
            if (recent) { recent.amount += e.amount; recent.bump = Math.max(recent.start, e.start + delay); return; }
            floats.push({ target: e.target, kind, amount: e.amount, start: e.start + delay, bump: 0, seed: e.seed });
        }

        // 보호막이 있는 카드에 테두리 표시를 붙인다. 카드가 다시 만들어지면 그리기 전에 다시 붙인다.
        function mark() {
            document.querySelectorAll('.pq-char-card[data-member]').forEach(card => {
                const on = active && shields.has(card.dataset.member) && !(quiet.get(card.dataset.member) > performance.now());
                if (on && card.dataset.pfxShield !== '1') card.dataset.pfxShield = '1';
                else if (!on && card.dataset.pfxShield) delete card.dataset.pfxShield;
            });
        }
        const mutations = new MutationObserver(mark);
        const watch = () => { const party = document.getElementById('pqPlayMembers'); if (party) mutations.observe(party, { childList: true }); };
        watch();

        // ---- 그리기 도구 ----
        function sprite(image, x, y, w, h, angle, alpha, mode = 'lighter') {
            if (!image || alpha <= 0) return;
            ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = clamp(alpha);
            ctx.translate(x, y); if (angle) ctx.rotate(angle);
            ctx.drawImage(image, -w / 2, -h / 2, w, h); ctx.restore();
        }
        function clipRect(r, pad = 0) { ctx.beginPath(); ctx.rect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2); ctx.clip(); }
        // 초상 비율을 지키며 방패 유리를 맞춘다(원본 2:3).
        function aegisBox(img) {
            let h = img.h * 1.06, w = h * 2 / 3;
            if (w > img.w * 1.12) { w = img.w * 1.12; h = w * 1.5; }
            return { cx: img.x + img.w / 2, cy: img.y + img.h * .5, w, h };
        }
        function arc(a, b, lift) {
            const cx = (a[0] + b[0]) / 2, cy = Math.min(a[1], b[1]) - lift;
            return u => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * cx + u * u * b[0], v * v * a[1] + 2 * v * u * cy + u * u * b[1]]; };
        }
        // 매끈한 궤적을 따라 질감 원본의 가는 결을 이어 붙인 흐름. 머리는 밝고 꼬리로 갈수록 가늘고 성기다.
        function stream(path, t, t0, dur, key, width, seed, alpha, tone, ribbons) {
            const head = ease((t - t0) / dur), tail = smooth((t - t0 - dur * .3) / (dur * .9)), fade = alpha * (1 - smooth((t - t0 - dur) / .25));
            if (t < t0 || head <= tail || fade <= 0) return;
            const n = 24, pts = [], image = flowGrain(key);
            for (let i = 0; i <= n; i++) {
                const u = tail + (head - tail) * i / n, [x, y] = path(u), [qx, qy] = path(Math.min(1, u + .01));
                const a = Math.atan2(qy - y, qx - x), sway = Math.sin(u * 7 + seed + t * 3) * width * .7 * Math.sin(Math.PI * u);
                pts.push([x - Math.sin(a) * sway, y + Math.cos(a) * sway, a, i / n]);
            }
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            if (image) for (let i = 1; i <= n; i++) {
                const [x, y, a, k] = pts[i], [px, py] = pts[i - 1], len = Math.hypot(x - px, y - py) * 2.2 + 3, th = width * (.18 + .5 * k);
                ctx.save(); ctx.globalAlpha = clamp(fade * (.15 + .4 * k)); ctx.translate((x + px) / 2, (y + py) / 2); ctx.rotate(a - Math.PI / 2);
                ctx.drawImage(image, -th / 2, -len / 2, th, len); ctx.restore();
            }
            (ribbons || []).forEach((c, r) => {
                // 옅은 빛의 띠가 흐름 양옆을 엇갈려 감는다.
                const line = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[n][0], pts[n][1]);
                line.addColorStop(0, rgba(c, 0)); line.addColorStop(1, rgba(c, .5 * fade));
                ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath();
                pts.forEach(([x, y, a, k], i) => { const o = Math.sin(k * 5 + r * 2.1 + t * 4) * width * .6; ctx[i ? 'lineTo' : 'moveTo'](x - Math.sin(a) * o, y + Math.cos(a) * o); });
                ctx.stroke();
            });
            for (let j = 0; j < 4; j++) {
                const [x, y] = pts[Math.floor(rand(seed + j * 7) * n)], drift = (t - t0) * 14;
                sprite(mote(tone), x + (rand(seed + j) - .5) * width * 2, y - drift * rand(seed + j * 3), 4, 4, 0, fade * .7);
            }
            sprite(mote(tone), pts[n][0], pts[n][1], width * 1.6, width * 1.6, 0, fade * head);
            ctx.restore();
        }
        // 지나가는 칼날 빛. 머리가 먼저 나가고 꼬리가 따라 닫히며 양 끝이 가늘다.
        function blade(path, t, t0, dur, thick, tone, alpha) {
            const head = ease((t - t0) / dur), tail = smooth((t - t0 - dur * .35) / (dur + .2)), fade = 1 - clamp((t - t0 - dur) / .32);
            if (head <= tail || fade <= 0 || t < t0) return;
            const n = 18, left = [], right = [];
            for (let i = 0; i <= n; i++) {
                const u = tail + (head - tail) * i / n, p = path(u), q = path(Math.min(1, u + .01));
                const angle = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2, w = thick * Math.sin(Math.PI * i / n) ** .7 * (.4 + .6 * i / n);
                left.push([p[0] + Math.cos(angle) * w, p[1] + Math.sin(angle) * w]); right.push([p[0] - Math.cos(angle) * w, p[1] - Math.sin(angle) * w]);
            }
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            for (const [scale, color, a] of [[1, tone, .55], [.35, [255, 250, 236], .95]]) {
                ctx.beginPath();
                left.forEach(([x, y], i) => { const r = right[i], mx = (x + r[0]) / 2, my = (y + r[1]) / 2; ctx[i ? 'lineTo' : 'moveTo'](mx + (x - mx) * scale, my + (y - my) * scale); });
                for (let i = right.length - 1; i >= 0; i--) { const [x, y] = right[i], l = left[i], mx = (x + l[0]) / 2, my = (y + l[1]) / 2; ctx.lineTo(mx + (x - mx) * scale, my + (y - my) * scale); }
                ctx.fillStyle = rgba(color, a * alpha * fade); ctx.fill();
            }
            ctx.restore();
        }
        // 갈라지는 번개 경로. 같은 시드는 같은 모양을 돌려준다.
        function bolt(a, b, seed, spread, depth, out) {
            let points = [a, b];
            for (let level = 0; level < 5; level++) {
                const next = [points[0]];
                for (let i = 1; i < points.length; i++) {
                    const p = points[i - 1], q = points[i], dx = q[0] - p[0], dy = q[1] - p[1], k = (rand(seed + level * 37 + i * 13) - .5) * spread / 2 ** level;
                    next.push([(p[0] + q[0]) / 2 - dy * k, (p[1] + q[1]) / 2 + dx * k], q);
                }
                points = next;
            }
            out.push(points);
            if (depth > 0) for (let i = 0; i < 2; i++) {
                const from = points[8 + Math.floor(rand(seed + i * 5) * 18)], angle = Math.atan2(b[1] - a[1], b[0] - a[0]) + (i ? .6 : -.55) * (.6 + rand(seed + i));
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (.18 + rand(seed + i * 3) * .16);
                bolt(from, [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len], seed + 101 * (i + 1), spread * .8, depth - 1, out);
            }
            return out;
        }
        function strokePaths(paths, tone, alpha) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = ctx.lineCap = 'round';
            for (const [width, color, a] of [[9, tone, .12], [3.2, tone, .55], [1.2, [255, 246, 226], .95]]) {
                ctx.strokeStyle = rgba(color, a * alpha);
                paths.forEach((points, k) => {
                    ctx.lineWidth = width * (k ? .55 : 1); ctx.beginPath();
                    points.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.stroke();
                });
            }
            ctx.restore();
        }
        function number(text, x, y, size, fill, edge, alpha) {
            ctx.save(); ctx.globalAlpha = clamp(alpha); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = size + "px 'Black Han Sans', Pretendard, sans-serif"; ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(2.5, size * .16); ctx.strokeStyle = edge; ctx.strokeText(text, x, y);
            ctx.fillStyle = fill; ctx.fillText(text, x, y); ctx.restore();
        }

        // ---- 지원군 ----
        function portrait(e, image, w, h) {
            const pw = Math.round(w * ratio), ph = Math.round(h * ratio);
            if (e.panel && e.panel.width === pw && e.panel.height === ph) return e.panel;
            const panel = e.panel || document.createElement('canvas'), g = panel.getContext('2d');
            panel.width = pw; panel.height = ph; e.panel = panel;
            // 비율을 지키며 상반신 쪽으로 잘라낸다.
            const s = Math.max(pw / image.naturalWidth, ph / image.naturalHeight), sw = pw / s, sh = ph / s;
            g.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) * .22, sw, sh, 0, 0, pw, ph);
            g.globalCompositeOperation = 'destination-in';
            let mask = g.createLinearGradient(0, 0, pw, 0);
            mask.addColorStop(0, 'rgba(0,0,0,0)'); mask.addColorStop(.1, '#000'); mask.addColorStop(.68, '#000'); mask.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = mask; g.fillRect(0, 0, pw, ph);
            mask = g.createLinearGradient(0, 0, 0, ph);
            mask.addColorStop(0, 'rgba(0,0,0,.4)'); mask.addColorStop(.12, '#000'); mask.addColorStop(.7, '#000'); mask.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = mask; g.fillRect(0, 0, pw, ph);
            // 전장 쪽에서 오는 가장자리 빛.
            g.globalCompositeOperation = 'source-atop';
            mask = g.createLinearGradient(pw, 0, pw * .55, 0);
            mask.addColorStop(0, rgba(e.spec.tone, .5)); mask.addColorStop(1, rgba(e.spec.tone, 0));
            g.fillStyle = mask; g.fillRect(0, 0, pw, ph);
            return panel;
        }
        function figure(e) {
            const a = anchor();
            return a && { ...a, eye: [a.x + a.w * .58, a.y + a.h * .32], chest: [a.x + a.w * .6, a.y + a.h * .55] };
        }
        function drawSupport(e, t, reduced) {
            const f = figure(e);
            if (!f) return;
            const appear = reduced ? smooth(t / .25) : ease(t / .34), leave = smooth((t - 1.12) / .38), alpha = appear * (1 - leave);
            const lunge = reduced ? 0 : f.w * (.07 * bell(t, .42, .78) - .5 * (1 - appear) - .15 * leave);
            const stage = f.stage;
            ctx.save(); clipRect(stage);
            // 무대 왼쪽이 어두워지며 지원군이 그 앞으로 걸어 나온다.
            const cx = f.x + f.w * .45, cy = f.y + f.h * .6, r = Math.max(60, f.h), veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            veil.addColorStop(0, 'rgba(6,5,8,.6)'); veil.addColorStop(1, 'rgba(6,5,8,0)');
            ctx.globalAlpha = alpha * .9; ctx.fillStyle = veil; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            const image = e.spec.figure !== false && picture(e.icon);
            if (e.spec.figure === false && !reduced) {
                // 오로라는 초상 대신 아래에서 모여드는 무지갯빛 기운과 이름으로 들어선다.
                ctx.globalAlpha = 1;
                PRISM.forEach((c, i) => stream(arc([f.x + f.w * (.1 + i * .4), f.y + f.h + 30], f.chest, f.h * (.3 + i * .15)), t, i * .07, .5, 'heal', Math.max(8, f.w * .16), e.seed + i * 13, alpha, c, [c]));
                sprite(mote(e.spec.tone), f.chest[0], f.chest[1], f.w * .9, f.w * .9, 0, bell(t, .3, 1.3) * .45);
            }
            if (image && f.h >= 48) {
                ctx.globalAlpha = alpha;
                ctx.drawImage(portrait(e, image, f.w, f.h), f.x + lunge, f.y, f.w, f.h);
            }
            const size = Math.round(Math.max(13, Math.min(18, (f.h || 100) * .11))), ny = f.y + Math.max(f.h, 0) + size * .5 + 2;
            ctx.font = size + "px 'Black Han Sans', Pretendard, sans-serif"; ctx.textBaseline = 'middle';
            const tw = ctx.measureText(e.name).width;
            ctx.globalAlpha = alpha; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#f1e6cf'; ctx.fillText(e.name, f.x + 4 + lunge * .5, ny);
            ctx.shadowBlur = 0;
            const rule = ctx.createLinearGradient(f.x, 0, f.x + tw + 26, 0);
            rule.addColorStop(0, rgba(e.spec.tone, .9)); rule.addColorStop(1, rgba(e.spec.tone, 0));
            ctx.fillStyle = rule; ctx.fillRect(f.x + 4, ny + size * .62, (tw + 22) * (reduced ? 1 : ease((t - .12) / .4)), 1);
            ctx.restore();
            drawStrike(e, t, f, reduced);
        }
        function drawStrike(e, t, f, reduced) {
            const boss = layout.boss, tone = e.spec.tone, kind = e.spec.strike, s = e.seed, after = t - STRIKE;
            if (!boss) return;
            const px = boss.x + boss.w * .5, py = boss.y + boss.h * .46, size = Math.min(boss.w, boss.h);
            ctx.save(); clipRect(layout.stage);
            if (reduced) {
                // 동작 줄이기: 이동 없이 닿는 자리에서만 질감 있는 빛이 천천히 오르고 가라앉는다.
                const a = bell(t, .35, 1.4) * .5;
                if (kind !== 'ward' && kind !== 'aurora') sprite(mote(tone), px, py, size * .7, size * .7, 0, a);
                ctx.restore(); return;
            }
            if (kind === 'earth') {
                const path = u => [px - size * .42 + size * .84 * u, py - size * .38 + size * .7 * u + Math.sin(u * Math.PI) * size * .12];
                blade(path, t, .46, .13, size * .05, tone, 1);
                if (after > 0) {
                    const ground = py + size * .34, shard = texture('shard'), image = dust();
                    for (let i = 0; i < 4; i++) {
                        const d = after - i * .04, r = size * (.18 + ease(d / .8) * .32);
                        if (d > 0) sprite(image, px + (rand(s + i) - .5) * size * .5, ground - ease(d) * size * .08, r * 2, r * 1.2, 0, (1 - d / .9) * .7, 'source-over');
                    }
                    if (shard) for (let i = 0; i < 12; i++) {
                        const vx = (rand(s + i * 3) - .5) * size * 2.4, vy = -size * (1.1 + rand(s + i * 5) * 1.3), g = size * 5.5, d = Math.min(after, .95);
                        const x = px + vx * d, y = Math.min(ground + size * .06, py + size * .2 + vy * d + g * d * d / 2), k = 5 + rand(s + i) * 9;
                        sprite(shard, x, y, k, k, d * (rand(s + i * 7) - .5) * 14, (1 - smooth((after - .6) / .4)), 'source-over');
                    }
                    const flat = ctx.createRadialGradient(px, ground, 0, px, ground, size * .7);
                    flat.addColorStop(0, rgba(tone, .4 * (1 - clamp(after / .45)))); flat.addColorStop(1, rgba(tone, 0));
                    ctx.save(); ctx.translate(px, ground); ctx.scale(1, .22); ctx.translate(-px, -ground);
                    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = flat; ctx.fillRect(px - size, ground - size, size * 2, size * 2); ctx.restore();
                }
            } else if (kind === 'cross') {
                const L = size * .5;
                blade(u => [px - L + 2 * L * u, py - L * .72 + 1.44 * L * u], t, .47, .09, size * .03, tone, 1);
                blade(u => [px + L - 2 * L * u, py - L * .72 + 1.44 * L * u], t, .59, .09, size * .03, tone, 1);
                if (after > .1) sprite(mote(tone), px, py, size * 1.1, size * .16, 0, bell(after, .1, .5) * .5);
                // 재사용 대기 해제: 개인 스킬 줄을 따라 맑은 빛이 한 번 지나간다.
                const bar = layout.skills;
                if (bar && t > .82) {
                    ctx.restore(); ctx.save(); clipRect(bar);
                    const x = bar.x + (bar.w + 80) * ease((t - .82) / .5) - 40, sweep = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
                    sweep.addColorStop(0, rgba(tone, 0)); sweep.addColorStop(.5, rgba(tone, .32 * (1 - smooth((t - 1.12) / .38)))); sweep.addColorStop(1, rgba(tone, 0));
                    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sweep; ctx.fillRect(x - 40, bar.y, 80, bar.h);
                }
            } else if (kind === 'spark') {
                if (t > .46 && t < .82) {
                    const flick = Math.floor((t - .46) / .06), alpha = (flick % 2 ? .55 : 1) * (1 - smooth((t - .7) / .12));
                    const from = [px + (rand(s + flick) - .5) * size * .3, layout.stage.y + 4];
                    strokePaths(bolt(from, [px, py], s + flick * 17, .5, 2, []), tone, alpha);
                }
                if (after > 0) {
                    sprite(mote(tone), px, py, size * .8, size * .8, 0, (1 - clamp(after / .5)) * .7);
                    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
                    for (let i = 0; i < 16; i++) {
                        const angle = -Math.PI * rand(s + i), v = size * (.8 + rand(s + i * 3) * 1.4), d = Math.min(after, .8), g = size * 4;
                        const x = px + Math.cos(angle) * v * d, y = py + Math.sin(angle) * v * d + g * d * d / 2;
                        const vx = Math.cos(angle) * v, vy = Math.sin(angle) * v + g * d, n = Math.hypot(vx, vy) || 1;
                        ctx.strokeStyle = rgba(tone, (1 - after / .8) * .9); ctx.lineWidth = 1.4; ctx.beginPath();
                        ctx.moveTo(x, y); ctx.lineTo(x - vx / n * 7, y - vy / n * 7); ctx.stroke();
                    }
                    ctx.restore();
                }
            } else if (kind === 'needle') {
                const head = ease((t - .42) / .1), fade = 1 - smooth((t - .56) / .3);
                if (t > .42 && fade > 0) {
                    const [ex, ey] = f.eye, x = ex + (px - ex) * head, y = ey + (py - ey) * head, line = ctx.createLinearGradient(ex, ey, x, y);
                    line.addColorStop(0, rgba(tone, 0)); line.addColorStop(1, rgba([255, 246, 220], .95 * fade));
                    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = line; ctx.lineWidth = 1.6;
                    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
                }
                if (after > 0) {
                    sprite(mote(tone), px, py, size * 1.3, size * .09, 0, bell(after, 0, .45) * .8);
                    for (let i = 0; i < 22; i++) {
                        const angle = rand(s + i) * TAU, v = size * (.25 + rand(s + i * 3) * .6), d = after;
                        const travel = v * (1 - Math.exp(-d * 3.2)) / 3.2 * 3, x = px + Math.cos(angle) * travel, y = py + Math.sin(angle) * travel + d * d * size * .12;
                        sprite(mote(tone), x, y, 7, 7, 0, (1 - clamp(d / .95)) * .9);
                    }
                }
            } else drawPartyField(e, t, 1, false, f);
            ctx.restore();
        }
        // 파티 전체를 감싸는 기운(SitoSoym의 창백한 결계, 오로라의 무지갯빛 장막). 지원군에게서 카드마다 흐름이 닿는다.
        function drawPartyField(e, t, scale, reduced, f) {
            if (reduced || !f) return;
            // 무대 자르기를 풀고 파티 줄까지 흐름을 잇는다. 카드 주변에 면을 칠하지 않는다.
            ctx.restore(); ctx.save();
            const aurora = e.spec.strike === 'aurora';
            [...layout.cards.values()].forEach((c, k) => {
                const path = arc(f.chest, [c.img.x + c.img.w / 2, c.img.y + c.img.h * .45], 30 + k * 12);
                stream(path, t, .3 + k * .06, .5, aurora ? 'heal' : 'aegis', Math.max(7, c.img.w * .14), e.seed + k * 31, .95 * scale, e.spec.tone, aurora ? PRISM.slice(1) : null);
            });
        }

        // ---- 파티원 카드 효과 ----
        // 다른 파티원이 보낸 효과만 카드 사이를 건너간다. 지원군의 주기 회복은 받는 카드에서만 피어난다.
        function transfer(e, c, t, tone, key, reduced) {
            const src = moving(e) && layout.cards.get(e.source);
            if (!src || reduced) return 0;
            const from = [src.img.x + src.img.w / 2, src.img.y + src.img.h * .45];
            const to = [c.img.x + c.img.w / 2, c.img.y + c.img.h * .5], path = arc(from, to, Math.max(26, c.box.h * .45));
            // 시전자의 짧은 집중: 카드 아래쪽부터 숨 쉬듯 밝아진다.
            ctx.save(); clipRect(src.img);
            const glow = ctx.createRadialGradient(from[0], src.img.y + src.img.h, 0, from[0], src.img.y + src.img.h, src.img.h);
            glow.addColorStop(0, rgba(tone, .35 * bell(t, 0, .5))); glow.addColorStop(1, rgba(tone, 0));
            ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.fillRect(src.img.x, src.img.y, src.img.w, src.img.h); ctx.restore();
            stream(path, t, .02, .36, key, Math.max(7, c.img.w * .14), e.seed, 1, tone, null);
            return .38;
        }
        function drawHeal(e, c, t, reduced) {
            const image = texture('heal'), arrive = transfer(e, c, t, HEAL, 'heal', reduced), d = t - arrive, img = c.img;
            if (d < 0) return;
            ctx.save(); clipRect(img);
            if (reduced) {
                const glow = ctx.createLinearGradient(0, img.y + img.h, 0, img.y);
                glow.addColorStop(0, rgba(HEAL, .4 * bell(d, 0, .85))); glow.addColorStop(1, rgba(HEAL, 0));
                ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.fillRect(img.x, img.y, img.w, img.h);
            } else if (image) {
                // 따뜻한 기운이 아래에서 모여 초상 안으로 스며든다. 두 번째 결은 반대로 감기며 늦게 따라온다.
                const w = img.w * 1.2, rise = ease(d / .85) * img.h * .2;
                sprite(image, img.x + img.w / 2, img.y + img.h * .78 - rise, w, w, 0, bell(d, 0, .85) * .8);
                ctx.save(); ctx.translate(img.x + img.w / 2, 0); ctx.scale(-1, 1); ctx.translate(-(img.x + img.w / 2), 0);
                sprite(image, img.x + img.w * .52, img.y + img.h * .9 - rise * 1.3, w * .75, w * .75, .2, bell(d, .12, .87) * .55);
                ctx.restore();
                const soak = ctx.createRadialGradient(img.x + img.w / 2, img.y + img.h * .62, 0, img.x + img.w / 2, img.y + img.h * .62, img.h * .55);
                soak.addColorStop(0, rgba(HEAL_HOT, .22 * bell(d, .2, .87))); soak.addColorStop(1, rgba(HEAL_HOT, 0));
                ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = soak; ctx.fillRect(img.x, img.y, img.w, img.h);
            }
            ctx.restore();
        }
        function drawDamage(e, c, t, reduced) {
            const img = c.img, s = e.seed, hit = 1 - smooth((t - .04) / .42), edge = Math.min(1, t / .04) * hit;
            ctx.save(); clipRect(img);
            // 잠깐 붉게 저미는 가장자리.
            const depth = Math.min(img.w, img.h) * .22;
            for (const [x0, y0, x1, y1] of [[img.x, 0, img.x + depth, 0], [img.x + img.w, 0, img.x + img.w - depth, 0], [0, img.y + img.h, 0, img.y + img.h - depth], [0, img.y, 0, img.y + depth]]) {
                const g = ctx.createLinearGradient(x0, y0, x1, y1);
                g.addColorStop(0, rgba(BLOOD, .55 * edge)); g.addColorStop(1, rgba(BLOOD, 0));
                ctx.fillStyle = g; ctx.fillRect(img.x, img.y, img.w, img.h);
            }
            if (!reduced) {
                // 맞은 자리의 짧은 눌림과 튀는 작은 파편.
                const hx = img.x + img.w * (.35 + rand(s) * .3), hy = img.y + img.h * (.3 + rand(s + 1) * .25);
                const press = ctx.createRadialGradient(hx, hy, 0, hx, hy, img.w * .4);
                press.addColorStop(0, 'rgba(20,4,4,' + .45 * (1 - clamp(t / .25)) + ')'); press.addColorStop(1, 'rgba(20,4,4,0)');
                ctx.fillStyle = press; ctx.fillRect(img.x, img.y, img.w, img.h);
                const shard = texture('shard');
                if (shard) for (let i = 0; i < 4; i++) {
                    const angle = -Math.PI * (.15 + rand(s + i * 3) * .7), v = img.w * (1.2 + rand(s + i) * 1.2), d = Math.min(t, .5), k = 3 + rand(s + i * 5) * 4;
                    sprite(shard, hx + Math.cos(angle) * v * d, hy + Math.sin(angle) * v * d + img.h * 3 * d * d, k, k, d * 12 * (rand(s + i) - .5), 1 - clamp(t / .5), 'source-over');
                }
            }
            ctx.restore();
        }
        function drawShield(e, c, t, reduced) {
            const aegis = texture('aegis');
            if (!aegis) return;
            const b = aegisBox(c.img), s = e.seed;
            const arrive = e.kind === 'shield-grant' ? transfer(e, c, t, WARD, 'aegis', reduced) : 0;
            ctx.save(); clipRect(c.box);
            if (e.kind === 'shield-grant') {
                const d = t - arrive;
                if (d >= 0) {
                    // 넓게 흩어진 유리막이 몸 쪽으로 응축되어 고요한 막으로 남는다.
                    const k = reduced ? 1 : 1.35 - .35 * ease(d / .45), a = reduced ? bell(d, 0, .7) * .6 + .2 : Math.min(1, d / .2) * (.9 - .7 * smooth((d - .3) / .35));
                    sprite(aegis, b.cx, b.cy, b.w * k, b.h * k, 0, a, 'source-over');
                }
            } else if (e.kind === 'shield-block') {
                // 맞은 자리에서 유리 굴절이 번져 나간다.
                const hx = b.cx + (rand(s) - .5) * b.w * .5, hy = b.cy - b.h * (.1 + rand(s + 1) * .2), r = reduced ? b.h * .3 : b.h * (.08 + ease(t / .5) * .7);
                sprite(aegis, b.cx, b.cy, b.w, b.h, 0, .25 * (1 - t / .6), 'source-over');
                ctx.save(); ctx.beginPath(); ctx.arc(hx, hy, r + 7, 0, TAU); ctx.arc(hx, hy, Math.max(0, r - 7), 0, TAU, true); ctx.clip();
                sprite(aegis, b.cx + 2, b.cy, b.w * 1.03, b.h * 1.03, 0, .95 * (1 - clamp(t / .55)));
                ctx.restore();
                sprite(mote(WARD_HOT), hx, hy, 26, 26, 0, (1 - clamp(t / .2)) * .8);
            } else if (e.kind === 'shield-break') {
                if (t < .12) sprite(aegis, b.cx, b.cy, b.w, b.h, 0, .9 * (1 - t / .12));
                if (!reduced) for (let i = 0; i < 8; i++) {
                    // 유리 조각마다 방패 원본의 해당 부분을 잘라 떨어뜨린다.
                    const a0 = i / 8 * TAU + rand(s + i) * .3, a1 = (i + 1) / 8 * TAU + rand(s + i + 1) * .3, mid = (a0 + a1) / 2;
                    const vx = Math.cos(mid) * b.w * (.5 + rand(s + i * 3) * .5), vy = Math.sin(mid) * b.h * .25 - b.h * .3, d = t, g = b.h * 3.2;
                    const dx = vx * d, dy = vy * d + g * d * d / 2, spin = (rand(s + i * 7) - .5) * 5 * d, fade = 1 - smooth((t - .45) / .5);
                    const ox = b.cx + Math.cos(mid) * b.w * .3, oy = b.cy + Math.sin(mid) * b.h * .3;
                    ctx.save(); ctx.translate(ox + dx, oy + dy); ctx.rotate(spin); ctx.translate(-ox, -oy);
                    ctx.beginPath(); ctx.moveTo(b.cx + Math.cos(mid) * b.w * .12, b.cy + Math.sin(mid) * b.h * .12);
                    for (let k = 0; k <= 3; k++) { const a = a0 + (a1 - a0) * k / 3; ctx.lineTo(b.cx + Math.cos(a) * b.w * .6, b.cy + Math.sin(a) * b.h * .6); }
                    ctx.closePath(); ctx.clip();
                    ctx.globalAlpha = fade; ctx.drawImage(aegis, b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h);
                    ctx.restore();
                }
                else sprite(aegis, b.cx, b.cy, b.w, b.h, 0, .4 * (1 - clamp(t / .6)), 'source-over');
            } else if (e.kind === 'shield-expire') {
                // 조용히 풀린다: 막이 조금 넓어지며 위로 흩어진다.
                const k = 1 + (reduced ? 0 : ease(t / .9) * .1), lift = reduced ? 0 : ease(t / .9) * b.h * .06;
                sprite(aegis, b.cx, b.cy - lift, b.w * k, b.h * k, 0, .24 * (1 - smooth(t / .85)), 'source-over');
                if (!reduced) for (let i = 0; i < 6; i++) {
                    const x = b.cx + (rand(s + i) - .5) * b.w * .9, y = b.cy + (rand(s + i * 3) - .2) * b.h * .4 - ease(t) * b.h * (.15 + rand(s + i) * .2);
                    sprite(mote(WARD), x, y, 6, 6, 0, bell(t, 0, .9) * .7);
                }
            }
            ctx.restore();
        }
        // 보호막이 남아 있는 동안의 고요한 유리막.
        function drawAmbient(now, reduced) {
            const aegis = texture('aegis');
            if (!aegis) return;
            for (const [name] of shields) {
                const c = layout.cards.get(name);
                if (!c || quiet.get(name) > now || effects.some(e => e.target === name && e.kind === 'shield-grant' && now - e.start < 900)) continue;
                const b = aegisBox(c.img), a = reduced ? .2 : .19 + .05 * Math.sin(now / 1000 * 1.3 + hash(name));
                ctx.save(); clipRect(c.box); sprite(aegis, b.cx, b.cy, b.w, b.h, 0, a, 'source-over'); ctx.restore();
            }
        }
        function drawFloats(now, reduced) {
            floats = floats.filter(f => now - Math.max(f.start, f.bump) < 960);
            const stack = new Map();
            for (const f of floats) {
                const t = (now - f.start) / 1000, c = layout.cards.get(f.target);
                if (t < 0 || !c) continue;
                const k = stack.get(f.target) || 0; stack.set(f.target, k + 1);
                const pop = f.bump && now - f.bump < 120 ? 1.08 : 1, rise = reduced ? 0 : (1 - Math.exp(-t * 4)) * 22;
                const x = c.img.x + c.img.w / 2 + (rand(f.seed) - .5) * c.img.w * .2, y = c.img.y + c.img.h * .36 - rise - k * 15;
                const alpha = Math.min(1, t / .06) * (1 - smooth(((now - Math.max(f.start, f.bump)) / 1000 - .65) / .3)), big = Math.max(13, Math.min(20, c.img.w * .18));
                const text = (f.kind === 'block' ? '방어 ' : f.kind === 'heal' || f.kind === 'ward' ? '+' : '-') + f.amount.toLocaleString('ko-KR');
                const style = { damage: ['#ffe2d6', '#4a0a0a', big], heal: ['#e5f9df', '#0d3320', big], block: ['#dfe8ff', '#1a2448', big * .78], ward: ['#e3ecff', '#1a2448', big * .78] }[f.kind];
                number(text, x, y, Math.round(style[2] * pop * (reduced ? 1 : 1 + .14 * (1 - Math.min(1, t / .12)))), style[0], style[1], alpha);
            }
        }

        // ---- 프레임 ----
        const moving = e => !!e.source && e.source !== e.target && !e.support;
        const transient = () => effects.length > 0 || floats.length > 0;
        const busy = () => active && (transient() || shields.size > 0);
        function kick() {
            if (!frame && busy() && !document.hidden) frame = requestAnimationFrame(render);
            if (!busy()) ctx.clearRect(0, 0, width, height);
        }
        function render(now) {
            frame = 0;
            if (document.hidden || !busy()) { ctx.clearRect(0, 0, width, height); return; }
            // 효과가 진행 중이면 30fps, 보호막만 남았으면 12fps.
            if (now - lastFrame < (transient() ? 32 : 80)) { frame = requestAnimationFrame(render); return; }
            lastFrame = now;
            measure(); ctx.clearRect(0, 0, width, height);
            const reduced = motion.matches;
            drawAmbient(now, reduced);
            effects = effects.filter(e => now - e.start < e.life * 1000);
            for (const e of effects) {
                const t = (now - e.start) / 1000;
                if (t < 0) continue;
                if (e.kind === 'support') {
                    e.spec.sounds.forEach(([at, key, gain], i) => {
                        if (e.fired.has(i) || t < at) return;
                        e.fired.add(i);
                        if (t - at < .15) play(key, gain);
                    });
                    drawSupport(e, t, reduced);
                    continue;
                }
                const c = layout.cards.get(e.target);
                if (!e.sounded) {
                    e.sounded = true;
                    // 지원군이 직접 내는 결계음과 겹치지 않게, 주기적인 회복과 피해는 쿨다운으로 묶는다.
                    if (e.kind === 'heal' && !e.support) play('heal', .3, 1.6);
                    else if (e.kind === 'damage' && c?.me) play('hurt', .22, .9);
                    else if (e.kind === 'shield-grant' && !e.support) play('ward', .32, .8);
                    else if (e.kind === 'shield-block') play('glint', .26, .6);
                    else if (e.kind === 'shield-break') play('shatter', .4, .3);
                }
                if (!c) continue;
                if (e.kind === 'heal') drawHeal(e, c, t, reduced);
                else if (e.kind === 'damage') drawDamage(e, c, t, reduced);
                else drawShield(e, c, t, reduced);
            }
            drawFloats(now, reduced);
            mark();
            if (busy()) frame = requestAnimationFrame(render);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0;
            silence(); effects = []; floats = []; shields.clear(); quiet.clear();
            active = false; scope = ''; room = null;
            mark(); ctx.clearRect(0, 0, width, height);
        }
        function onVisibility() {
            if (document.hidden) { cancelAnimationFrame(frame); frame = 0; silence(); effects = []; floats = []; ctx.clearRect(0, 0, width, height); }
            else { watch(); kick(); }
        }
        document.addEventListener('visibilitychange', onVisibility);
        function destroy() {
            reset();
            document.removeEventListener('visibilitychange', onVisibility);
            mutations.disconnect(); canvas.remove();
        }
        return { update, enqueue, setVolume, reset, destroy };
    }
    window.RaidPartyFX = { create };
})();
