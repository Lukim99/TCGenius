// 서버가 공개한 패턴만 그린다. 피해와 입력 판정은 전투 엔진에서 처리한다.
(() => {
    'use strict';
    const FILES = {
        beep: 'beep', gloss: 'gloss', fall: 'shards-fall', stone: 'shards-impact',
        blast: 'resonance-blast', wall: 'wall-hum', rupture: 'rupture', charge: 'charge'
    };
    const VISUAL_ONLY = new Set(['harden', 'shards', 'resonance', 'echo', 'wall', 'rupture']);
    const TEXTURES = { mist: '레이드/fx-dark-mist.png', shard: '레이드/fx-bronze-shard.png' };
    // 분리 보스 그림 안의 기준점(가로, 세로 비율): 황소 몸통, 스피커 우퍼, 잔향의 뻗은 손.
    const FOCUS = { sculpture: [.55, .52], whiplash: [.5, .66], 'whiplash-echo': [.7, .66] };
    const GLINTS = [[.42, .05], [.39, .3], [.58, .45], [.79, .58], [.3, .83], [.66, .74]];
    const BRONZE = [255, 196, 120], BRONZE_HOT = [255, 246, 222], VIOLET = [168, 120, 255], VIOLET_HOT = [236, 222, 255];
    const RED = [232, 40, 52], RED_HOT = [255, 196, 188], PALE = [196, 204, 255], PALE_HOT = [244, 246, 255];
    const TAU = Math.PI * 2;
    const buffers = new Map(), textures = new Map();
    let audio = null, loading = null, hexTile = null, puffTile = null;
    function unlockAudio() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audio) audio = new AudioContext();
        audio.resume().catch(() => {});
        if (!loading) loading = Promise.all(Object.entries(FILES).map(async ([key, file]) => {
            try {
                const response = await fetch('/rpg-ui?file=' + encodeURIComponent('sfx/raid/' + file + '.mp3'));
                if (!response.ok) return;
                buffers.set(key, await audio.decodeAudioData(await response.arrayBuffer()));
            } catch (_) {}
        }));
    }
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio);
    // 텍스처는 처음 필요할 때 불러오고, 준비되기 전에는 대체 그림을 쓴다.
    function texture(key) {
        let image = textures.get(key);
        if (!image) { image = new Image(); image.decoding = 'async'; image.src = '/rpg-ui?file=' + encodeURIComponent(TEXTURES[key]); textures.set(key, image); }
        return image.complete && image.naturalWidth ? image : null;
    }
    function puff() {
        if (puffTile) return puffTile;
        puffTile = document.createElement('canvas'); puffTile.width = puffTile.height = 128;
        const g = puffTile.getContext('2d');
        for (let i = 0; i < 7; i++) {
            const x = 30 + rand(i) * 68, y = 34 + rand(i + 9) * 60, r = 26 + rand(i + 3) * 30;
            const gradient = g.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, 'rgba(46,40,44,.55)'); gradient.addColorStop(1, 'rgba(46,40,44,0)');
            g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
        }
        return puffTile;
    }

    function soundPlan(kind) {
        switch (kind) {
        case 'harden': return [[1, 'gloss', .35]];
        case 'shards': return [[0, 'fall', .3], [2, 'stone', .6], [3, 'stone', .6], [4, 'stone', .6]];
        case 'resonance': return [[0, 'beep', .6], [.16, 'beep', .6], [.32, 'beep', .6], [3, 'blast', .7]];
        case 'echo': return [[0, 'beep', .5], [.22, 'beep', .5], [3, 'beep', .6], [3.22, 'beep', .6]];
        case 'wall': return [[0, 'wall', .4]];
        case 'rupture': return [[0, 'rupture', .45]];
        case 'shield': case 'charge': case 'purge': case 'flame': case 'cannon': return [[0, 'charge', .3]];
        default: return [];
        }
    }
    const kindOf = event => event.kind === 'raidCue' ? event.effect || 'charge' : event.kind;
    const rand = i => { const n = Math.sin(i * 61.37 + 17.8) * 43758.54; return n - Math.floor(n); };
    const clamp = value => Math.max(0, Math.min(1, value));
    const ease = p => 1 - (1 - p) ** 3;
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a) + ')';

    function create(canvas) {
        const ctx = canvas?.getContext('2d');
        if (!ctx) return null;
        const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
        const fog = document.createElement('canvas'), fogCtx = fog.getContext('2d');
        const live = document.createElement('div');
        live.className = 'pq-fx-announcement'; live.setAttribute('aria-live', 'polite');
        canvas.parentElement.append(live);
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const states = new Map(), sources = new Set();
        let scope = '', frame = 0, lastFrame = 0, width = 0, height = 0, ratio = 1, volume = 0, master = null;
        let sprite = null, spriteRect = null, spriteDrawRect = null, currentView = null, focus = [.5, .55], scene = { x: 0, y: 0, w: 0, h: 0 };
        let mist = null, lastOutcome = '';

        function setVolume(value) {
            volume = clamp(Number(value) || 0);
            if (master && audio) master.gain.setValueAtTime(volume, audio.currentTime);
            if (!volume) stopSounds();
        }
        function stopSounds(state) {
            for (const source of state ? state.sources : sources) { try { source.stop(); } catch (_) {} }
        }
        function play(state, key, gain) {
            if (!audio || audio.state !== 'running' || !volume || document.hidden || !buffers.has(key)) return;
            if (!master) { master = audio.createGain(); master.connect(audio.destination); }
            master.gain.setValueAtTime(volume, audio.currentTime);
            const source = audio.createBufferSource(), mix = audio.createGain();
            source.buffer = buffers.get(key); mix.gain.value = gain;
            source.connect(mix); mix.connect(master);
            state.sources.add(source); sources.add(source);
            source.onended = () => { state.sources.delete(source); sources.delete(source); source.disconnect(); mix.disconnect(); };
            source.start();
        }
        function measure() {
            const bounds = canvas.getBoundingClientRect();
            width = bounds.width; height = bounds.height;
            ratio = Math.min(2, window.devicePixelRatio || 1);
            const w = Math.round(width * ratio), h = Math.round(height * ratio);
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = mask.width = w; canvas.height = mask.height = h;
                ctx.setTransform(ratio, 0, 0, ratio, 0, 0); maskCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
            }
            locate(bounds);
        }
        // 전경 캔버스와 실제 보스 영역을 구분한다. 등록된 원본 좌표는 배경과 같은 cover 변환을 받는다.
        function locate(bounds = canvas.getBoundingClientRect()) {
            const stage = document.getElementById('pqPhaseStage')?.getBoundingClientRect();
            scene = stage?.width ? { x: stage.left - bounds.left, y: stage.top - bounds.top, w: stage.width, h: stage.height } : { x: 0, y: 0, w: width, h: height };
            sprite = document.getElementById('pqBossIllustImg');
            spriteRect = spriteDrawRect = null;
            if (sprite?.complete && sprite.naturalWidth) {
                const box = sprite.getBoundingClientRect();
                const s = Math.min(box.width / sprite.naturalWidth, box.height / sprite.naturalHeight), w = sprite.naturalWidth * s, h = sprite.naturalHeight * s;
                if (w > 0) {
                    spriteDrawRect = { x: box.left - bounds.left + (box.width - w) / 2, y: box.top - bounds.top + (box.height - h) / 2, w, h };
                    const subject = JSON.parse(sprite.dataset.subject || '[0,0,1,1]');
                    spriteRect = { x: spriteDrawRect.x + w * subject[0], y: spriteDrawRect.y + h * subject[1], w: w * subject[2], h: h * subject[3] };
                }
            }
            focus = FOCUS[(sprite?.src.match(/(sculpture|whiplash-echo|whiplash)(?:-scene)?\.png/) || [])[1]] || [.5, .55];
        }
        const observer = new ResizeObserver(measure); observer.observe(canvas);

        function clearPatterns() {
            stopSounds(); states.clear(); currentView = null;
            document.querySelectorAll('[data-raid-target]').forEach(card => delete card.dataset.raidTarget);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0;
            clearPatterns(); mist = null; lastOutcome = '';
            ctx.clearRect(0, 0, width, height); live.textContent = '';
        }
        const mistAlive = () => !!mist && (!mist.doneAt || performance.now() - mist.doneAt < 600);
        const busy = () => states.size > 0 || mistAlive();
        function kick() {
            if (!frame && busy() && !document.hidden) frame = requestAnimationFrame(render);
            if (!busy()) ctx.clearRect(0, 0, width, height);
        }
        // 잡몹 단계의 정화 진행. 재접속하면 현재 진행도에서 바로 시작한다.
        function syncMist(info, now) {
            if (!info) { mist = null; return; }
            const target = info.complete ? 1 : clamp(Number(info.progress) || 0);
            if (!mist) { mist = { shown: target, target, doneAt: info.complete ? now - 600 : 0 }; texture('mist'); }
            mist.target = target;
            if (info.complete && !mist.doneAt) mist.doneAt = now;
        }
        function targets(events) {
            const marked = new Map();
            for (const event of events) for (const name of [...(event.targets || []), ...(event.target ? [event.target] : [])]) {
                marked.set(name, ['burden', 'blessing'].includes(event.kind) ? event.kind : '1');
            }
            document.querySelectorAll('.pq-char-card[data-member]').forEach(card => {
                const mark = marked.get(card.dataset.member);
                if (mark) card.dataset.raidTarget = mark;
                else delete card.dataset.raidTarget;
            });
        }
        function update(view, options) {
            const nextScope = (options.scope || '') + ':' + (view?.form || '');
            if (nextScope !== scope) { reset(); scope = nextScope; }
            setVolume(options.volume);
            const now = performance.now();
            syncMist(options.purification, now);
            if (!view) {
                if (!mist) { reset(); return; }
                if (states.size) clearPatterns();
                measure(); kick(); return;
            }
            currentView = view; measure();
            const seen = new Set(), announcements = [];
            const events = [...(view.events || [])];
            if (view.form === 'transition') events.push({ id: 'form-transition', kind: 'transition', duration: 4, remain: view.transitionRemain });
            // 직접 본 보호막 시련이 성공으로 끝났을 때만 깨지는 연출을 붙인다.
            const outcome = view.outcome;
            if (outcome?.id && outcome.id !== lastOutcome) {
                const shielded = states.get(String(outcome.id));
                if (outcome.ok && shielded?.kind === 'trial' && shielded.event.stage === 'shield') {
                    states.set('shatter:' + outcome.id, { event: { duration: 0 }, kind: 'shatter', start: now, plan: [], fired: new Set(), sources: new Set(), hits: [], removed: true });
                }
                lastOutcome = outcome.id;
            }
            for (const event of events) {
                const id = String(event.id); seen.add(id);
                let state = states.get(id);
                if (!state) {
                    const age = Math.max(0, Number(event.duration || 0) - Number(event.remain || 0));
                    state = { event, kind: kindOf(event), start: now - age * 1000, plan: soundPlan(kindOf(event)), fired: new Set(), sources: new Set(), hits: [], removed: false };
                    // 재접속으로 이미 지난 신호를 다시 울리지 않는다.
                    state.plan.forEach(([at], i) => { if (age - at > .15) state.fired.add(i); });
                    states.set(id, state);
                    if (state.kind === 'shards') texture('shard');
                    if (VISUAL_ONLY.has(event.kind)) announcements.push(event.message || event.label);
                }
                if (event.remain != null) state.start = now - Math.max(0, Number(event.duration || 0) - Number(event.remain || 0)) * 1000;
                if (event.kind === 'trial' && state.event.stage !== event.stage && event.stage === 'shield') play(state, 'charge', .3);
                // 보호막 수치가 줄어든 스냅샷마다 피격 파문을 남긴다.
                if (event.kind === 'trial' && event.stage === 'shield' && state.event.stage === 'shield' && Number(event.shield) < Number(state.event.shield)) {
                    state.hits.push({ at: now, angle: Math.random() * TAU });
                    if (state.hits.length > 4) state.hits.shift();
                }
                state.event = event; state.removed = false;
            }
            for (const [id, state] of states) {
                if (seen.has(id)) continue;
                const age = (now - state.start) / 1000;
                // 공명과 연속 타격은 마지막 서버 틱과 화면 프레임 사이도 이어서 그린다.
                const tail = ['resonance', 'echo', 'shards', 'shatter'].includes(state.kind);
                if (!tail || age < Number(state.event.duration || 0) - .35) { stopSounds(state); states.delete(id); }
                else state.removed = true;
            }
            if (announcements.length) live.textContent = announcements.join(' ');
            targets(events);
            kick();
        }
        // ---- 공통 그리기 도구 ----
        function point(u, v) {
            const b = spriteRect;
            return b ? [b.x + b.w * u, b.y + b.h * v] : [scene.x + scene.w * .5, scene.y + scene.h * (.3 + v * .4)];
        }
        const unit = () => Math.max(.6, Math.min(1.6, Math.min(scene.w, scene.h) / 400));
        const groundY = () => spriteRect ? Math.min(scene.y + scene.h - 6, spriteRect.y + spriteRect.h * .97) : scene.y + scene.h * .86;
        function glow(x, y, r, c, alpha, add = true) {
            if (alpha <= 0 || r <= 0) return;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, rgba(c, 1)); gradient.addColorStop(.3, rgba(c, .5)); gradient.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = add ? 'lighter' : 'source-over'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = gradient;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // 두께가 있는 빛의 띠. 충격파, 파동, 보호막 파문이 같이 쓴다.
        function band(x, y, r, thick, c, alpha, squash = 1) {
            if (alpha <= 0 || r <= 0) return;
            ctx.save(); ctx.translate(x, y); ctx.scale(1, squash);
            const outer = r + thick * .25, gradient = ctx.createRadialGradient(0, 0, Math.max(0, r - thick), 0, 0, outer);
            gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(.8, rgba(c, 1)); gradient.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = gradient;
            ctx.beginPath(); ctx.arc(0, 0, outer, 0, TAU); ctx.fill(); ctx.restore();
        }
        function bolt(g, x1, y1, x2, y2, seed, c, hot, alpha, line) {
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
            g.beginPath(); g.moveTo(x1, y1);
            for (let i = 1; i < 6; i++) { const off = (rand(seed + i) - .5) * len * .24; g.lineTo(x1 + dx * i / 6 + nx * off, y1 + dy * i / 6 + ny * off); }
            g.lineTo(x2, y2); g.lineCap = g.lineJoin = 'round';
            g.globalAlpha = clamp(alpha * .45); g.strokeStyle = rgba(c, 1); g.lineWidth = line * 3; g.stroke();
            g.globalAlpha = clamp(alpha); g.strokeStyle = rgba(hot, 1); g.lineWidth = line; g.stroke();
        }
        function star(x, y, r, alpha) {
            if (alpha <= .02) return;
            glow(x, y, r * .55, BRONZE_HOT, alpha * .8);
            ctx.strokeStyle = rgba(BRONZE_HOT, 1); ctx.lineWidth = 1.2; ctx.globalAlpha = clamp(alpha);
            ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r * .7); ctx.lineTo(x, y + r * .7); ctx.stroke();
        }
        // 보스 그림의 알파 안쪽에만 칠한다.
        function skin(paint, alpha, op = 'source-over') {
            const b = spriteRect;
            if (!b || alpha <= 0) return;
            maskCtx.globalCompositeOperation = 'source-over'; maskCtx.globalAlpha = 1;
            maskCtx.clearRect(0, 0, width, height);
            maskCtx.drawImage(sprite, spriteDrawRect.x, spriteDrawRect.y, spriteDrawRect.w, spriteDrawRect.h);
            maskCtx.globalCompositeOperation = 'source-in';
            paint(maskCtx, b);
            const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(width, b.x + b.w), y1 = Math.min(height, b.y + b.h);
            if (x1 <= x0 || y1 <= y0) return;
            ctx.globalCompositeOperation = op; ctx.globalAlpha = clamp(alpha);
            ctx.drawImage(mask, x0 * ratio, y0 * ratio, (x1 - x0) * ratio, (y1 - y0) * ratio, x0, y0, x1 - x0, y1 - y0);
        }

        // ---- 패턴별 효과 ----
        // 청동 피부: 따뜻한 광택이 오른 뒤 대각선 반사광이 몸을 훑고, 굴곡에 반짝임이 맺힌다.
        function sheen(t, delay, fade, reduced) {
            const b = spriteRect;
            if (!b) return;
            const warm = clamp(t / Math.max(.3, delay)) * fade;
            skin((m, b) => {
                const gradient = m.createLinearGradient(b.x, b.y, b.x + b.w * .7, b.y + b.h);
                gradient.addColorStop(0, 'rgba(255,232,180,1)'); gradient.addColorStop(.55, 'rgba(205,130,60,.7)'); gradient.addColorStop(1, 'rgba(70,36,14,.4)');
                m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
            }, warm * .55, 'overlay');
            const active = t - delay;
            if (active >= 0 && active < .3) skin((m, b) => { m.fillStyle = rgba(BRONZE_HOT, 1); m.fillRect(b.x, b.y, b.w, b.h); }, (1 - active / .3) * .35 * fade, 'lighter');
            const cycle = reduced || active < 0 ? -1 : (active % 1.7) / .85;
            const sweepX = cycle >= 0 && cycle <= 1 ? b.x - b.w * .3 + ease(cycle) * b.w * 1.6 : null;
            if (sweepX != null) skin((m, b) => {
                const gradient = m.createLinearGradient(sweepX - b.w * .2, b.y, sweepX + b.w * .2, b.y + b.h * .3);
                gradient.addColorStop(0, 'rgba(255,200,130,0)'); gradient.addColorStop(.42, 'rgba(255,214,150,.45)');
                gradient.addColorStop(.5, 'rgba(255,252,240,1)'); gradient.addColorStop(.58, 'rgba(255,214,150,.45)'); gradient.addColorStop(1, 'rgba(255,200,130,0)');
                m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
            }, .8 * fade, 'lighter');
            if (active < 0 || focus !== FOCUS.sculpture) return;
            GLINTS.forEach(([u, v], i) => {
                const [x, y] = point(u, v);
                const hit = sweepX == null ? 0 : clamp(1 - Math.abs(sweepX - x) / (b.w * .1));
                const idle = reduced ? .35 : .2 + .2 * Math.sin(t * 2.3 + i * 1.7);
                star(x, y, b.w * .035 * (1 + hit), Math.max(idle, hit) * fade);
            });
        }
        function shard(x, y, size, spin, tilt, depth, alpha) {
            const facing = Math.cos(tilt), image = texture('shard');
            // 어두운 배경에서 윤곽이 묻히지 않도록 뒤에 옅은 청동빛을 깐다.
            glow(x, y, size * 1.5, BRONZE, alpha * .22 * Math.min(1, depth));
            ctx.save(); ctx.translate(x, y); ctx.rotate(spin); ctx.scale(.5 + .5 * Math.abs(facing), 1);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(alpha * (.7 + Math.min(1, depth) * .3));
            if (image) {
                // 텍스처는 정사각형 안에 대각선으로 들어 있어 실제 조각은 절반 정도다.
                const h = size * 3.4, w = h * image.naturalWidth / image.naturalHeight;
                ctx.drawImage(image, -w / 2, -h / 2, w, h);
                if (facing > .6) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((facing - .6) * .9 * alpha); ctx.drawImage(image, -w / 2, -h / 2, w, h); }
            } else {
                const light = .45 + .55 * Math.max(0, facing), shade = k => 'rgb(' + Math.round(BRONZE[0] * k) + ',' + Math.round(BRONZE[1] * k * .82) + ',' + Math.round(BRONZE[2] * k * .6) + ')';
                ctx.fillStyle = shade(light * (.45 + depth * .4));
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .55, -size * .1); ctx.lineTo(size * .2, size * .9); ctx.lineTo(-size * .1, 0); ctx.closePath(); ctx.fill();
                ctx.fillStyle = shade((1.1 - light * .5) * (.35 + depth * .3));
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(-size * .1, 0); ctx.lineTo(size * .2, size * .9); ctx.lineTo(-size * .5, size * .3); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = rgba(BRONZE_HOT, .7 * light); ctx.lineWidth = .8;
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(-size * .1, 0); ctx.lineTo(size * .2, size * .9); ctx.stroke();
            }
            ctx.restore();
            if (facing > .93) star(x, y - size * .3, size * .6, (facing - .93) * 10 * alpha * depth);
        }
        // 파편은 시간으로만 계산한다. 재접속해도 같은 위치에서 이어진다.
        function shards(t, fade, reduced) {
            const s = unit(), ground = groundY(), small = width < 420, count = small ? 7 : 12;
            const bottom = scene.y + scene.h * .96, dust = [150, 128, 104];
            // 무대 밖(HUD 아래 입력 영역)으로 번지지 않게 무대 안에만 그린다.
            ctx.save(); ctx.beginPath(); ctx.rect(scene.x, scene.y, scene.w, scene.h); ctx.clip();
            // 예고: 첫 착지 전부터 천장에서 돌가루가 흘러내린다.
            if (t < 2.2) {
                const p = clamp(t / 1.6), out = clamp((2.2 - t) / .4);
                for (let i = 0; i < (small ? 4 : 7); i++) {
                    const x = scene.x + scene.w * (.08 + rand(i + 300) * .84), len = scene.h * (.15 + p * (.3 + rand(i + 301) * .3));
                    const sway = reduced ? 0 : Math.sin(t * 1.3 + i) * scene.w * .004, wide = (5 + rand(i + 302) * 7) * s;
                    const gradient = ctx.createLinearGradient(0, scene.y, 0, scene.y + len);
                    gradient.addColorStop(0, rgba(dust, .5)); gradient.addColorStop(1, rgba(dust, 0));
                    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(p * out * .55 * fade); ctx.fillStyle = gradient;
                    ctx.beginPath(); ctx.moveTo(x - wide, scene.y); ctx.lineTo(x + wide, scene.y); ctx.lineTo(x + sway + wide * .4, scene.y + len); ctx.lineTo(x + sway - wide * .4, scene.y + len); ctx.closePath(); ctx.fill();
                }
            }
            for (let volley = -1; volley < 3; volley++) {
                for (let i = 0; i < (volley < 0 ? count - 4 : count); i++) {
                    const seed = volley * 53 + i * 7 + 101;
                    const fall = volley < 0 ? .9 : .95 + rand(seed + 1) * .25;
                    const land = volley < 0 ? .4 + rand(seed) * 1.5 : 2 + volley + (rand(seed) - .5) * .14;
                    const age = t - (land - fall);
                    if (age < 0 || age > fall + 1.3) continue;
                    const depth = volley < 0 ? .3 + rand(seed + 2) * .25 : .45 + rand(seed + 2) * .55;
                    // 깊이에 따라 착지선이 받침대 뒤쪽에서 화면 앞쪽까지 퍼진다.
                    const x = scene.x + scene.w * (.06 + rand(seed + 3) * .88);
                    const floor = ground - scene.h * .06 + (bottom - ground + scene.h * .06) * clamp((depth - .45) / .55);
                    const size = (14 + rand(seed + 4) * 16) * depth * s * (volley < 0 ? .6 : 1);
                    const top = scene.y - size * 3, drift = (rand(seed + 5) - .5) * scene.w * .08;
                    if (age < fall) {
                        const p = age / fall;
                        // 낙하 지점에 그림자가 짙어지며 좁혀 든다.
                        if (volley >= 0) {
                            ctx.save(); ctx.translate(x, floor); ctx.scale(1, .3);
                            glow(0, 0, size * (3.2 - p * 1.6), [12, 7, 4], (.12 + p * .5) * fade, false);
                            ctx.restore();
                            band(x, floor, size * (3.6 - p * 2.4), size * .35, BRONZE, p * p * .35 * fade, .3);
                        }
                        if (reduced) continue;
                        const y = top + (floor - top) * p * p, px = x - drift * (1 - p), speed = 2 * (floor - top) * p / fall;
                        const trail = Math.min(size * 6, speed * .07), tail = px - drift * .07, w = size * .45;
                        const gradient = ctx.createLinearGradient(tail, y - trail, px, y);
                        gradient.addColorStop(0, rgba(dust, 0)); gradient.addColorStop(1, rgba(BRONZE, .45 * Math.min(1, depth) * fade));
                        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = gradient;
                        ctx.beginPath(); ctx.moveTo(tail, y - trail); ctx.lineTo(px + w, y); ctx.lineTo(px - w, y); ctx.closePath(); ctx.fill();
                        shard(px, y, size, rand(seed + 6) * TAU + age * (1 + rand(seed + 7) * 1.6), age * (2 + rand(seed + 8) * 2.5), depth, fade);
                        continue;
                    }
                    const a = age - fall, weight = Math.min(1, depth);
                    // 착지: 넓은 섬광과 바닥 충격 고리, 튀는 잔조각, 피어오르는 먼지, 눕는 파편.
                    if (a < .14) glow(x, floor, size * 4.5, BRONZE_HOT, (1 - a / .14) * .75 * weight * fade);
                    if (a < .45) band(x, floor, size * (1 + (reduced ? 2 : ease(a / .45) * 7)), size * .7, BRONZE_HOT, (1 - a / .45) * .5 * weight * fade, .28);
                    if (!reduced && a < .6) for (let k = 0; k < (small ? 2 : 4); k++) {
                        const angle = -Math.PI * (.12 + rand(seed + k * 3) * .76), v = (120 + rand(seed + k * 3 + 1) * 200) * s * depth;
                        const vx = Math.cos(angle) * v, vy = Math.sin(angle) * v;
                        const sx = x + vx * a, sy = Math.min(floor, floor + vy * a + 600 * s * a * a);
                        shard(sx, sy, size * (.22 + rand(seed + k * 3 + 2) * .15), angle + a * 9, a * 12 + k, depth, clamp(1 - a / .6) * fade);
                        if (a < .25) {
                            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - a / .25) * fade);
                            ctx.strokeStyle = rgba(BRONZE_HOT, 1); ctx.lineWidth = 2;
                            ctx.beginPath(); ctx.moveTo(sx - vx * .04, sy - vy * .04); ctx.lineTo(sx, sy); ctx.stroke();
                        }
                    }
                    if (a < 1) for (let k = 0; k < 3; k++) {
                        const r = size * (1.4 + (reduced ? 1 : ease(a) * (3 + k * 1.5))), lift = (reduced ? 0 : a) * size * (1 + k) * .8;
                        ctx.save(); ctx.translate(x + (k - 1) * size * a * 1.4, floor - lift); ctx.scale(1, .55);
                        glow(0, 0, r, dust, (1 - a) * (.42 - k * .1) * weight * fade, false);
                        ctx.restore();
                    }
                    shard(x, floor - size * .25, size, rand(seed + 6) * TAU, 1.1, depth * .85, clamp(1 - (a - .9) / .4) * fade);
                }
                // 화면 앞을 스쳐 떨어지는 큰 파편: 초점이 맞지 않아 흐리고, 착지 시각에 화면 아래로 빠진다.
                if (volley < 0 || reduced) continue;
                for (let i = 0; i < (small ? 1 : 2); i++) {
                    const seed = volley * 31 + i * 13 + 900, at = 2 + volley + (rand(seed) - .5) * .1, life = .75;
                    const age = t - (at - life);
                    if (age < 0 || age > life + .15) continue;
                    const side = (i + volley) % 2, p = age / life, size = (40 + rand(seed + 1) * 22) * s;
                    const x = scene.x + scene.w * (side ? .7 + rand(seed + 2) * .24 : .06 + rand(seed + 2) * .24);
                    const y = scene.y - size * 3 + (scene.h + size * 6) * p ** 1.4;
                    ctx.save(); ctx.filter = 'blur(' + (2 * s).toFixed(1) + 'px)';
                    shard(x, y, size, rand(seed + 3) * TAU + age * 1.8, age * 3, 1.6, .8 * fade);
                    ctx.restore();
                }
            }
            // 일제 낙하 순간 바닥 전체에 먼지가 깔리고 바닥이 잠깐 밝아진다. 화면은 흔들지 않는다.
            for (const at of [2, 3, 4]) {
                const d = t - at;
                if (d < 0 || d >= .9) continue;
                if (d < .15) {
                    const gradient = ctx.createLinearGradient(0, ground - scene.h * .2, 0, scene.y + scene.h);
                    gradient.addColorStop(0, rgba(BRONZE_HOT, 0)); gradient.addColorStop(1, rgba(BRONZE_HOT, .22));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - d / .15) * fade); ctx.fillStyle = gradient;
                    ctx.fillRect(scene.x, ground - scene.h * .2, scene.w, scene.y + scene.h - ground + scene.h * .2);
                }
                ctx.save(); ctx.translate(scene.x + scene.w * .5, (ground + bottom) / 2); ctx.scale(1, .2);
                glow(0, 0, scene.w * (.45 + (reduced ? .2 : ease(d / .9) * .4)), dust, (1 - d / .9) * .4 * fade, false);
                ctx.restore();
            }
            ctx.restore();
        }
        // 보라색 공명: 세 번의 점등, 안으로 빨려드는 기운과 방전, 짧은 섬광과 충격파.
        function charge(t, duration, c, hot, burst, fade, reduced) {
            const [x, y] = point(...focus), core = spriteRect ? spriteRect.w * .2 : unit() * 70;
            const p = duration ? clamp(t / duration) : .5, end = duration ? t - duration : -1;
            if (end < 0) {
                glow(x, y, core * (.5 + p * .7), c, (.18 + p * .4) * fade);
                glow(x, y, core * (.18 + p * .3), hot, (.3 + p * .6) * fade);
                if (burst) for (const at of [0, .16, .32]) {
                    const d = t - at;
                    if (d < 0 || d >= .22) continue;
                    glow(x, y, core * 1.1, hot, (1 - d / .22) * .9);
                    band(x, y, core * (.5 + (reduced ? 0 : d * 5)), core * .3, c, (1 - d / .22) * .9);
                }
                if (reduced) return;
                const n = width < 420 ? 8 : 14;
                ctx.lineCap = 'round';
                for (let i = 0; i < n; i++) {
                    const life = .85, ph = ((t + rand(i) * life) % life) / life, base = rand(i + 9) * TAU;
                    if (t < ph * life) continue;
                    const r1 = core * (3.2 - ph * 2.8), r0 = r1 + core * .7, a1 = base + ph * 1.1, a0 = a1 - .35;
                    const gradient = ctx.createLinearGradient(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, x + Math.cos(a1) * r1, y + Math.sin(a1) * r1);
                    gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(1, rgba(hot, 1));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(Math.sin(ph * Math.PI) * (.35 + p * .6) * fade);
                    ctx.strokeStyle = gradient; ctx.lineWidth = 1.2 + p * 1.8;
                    ctx.beginPath(); ctx.moveTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0);
                    ctx.quadraticCurveTo(x + Math.cos(a0 + .3) * (r0 + r1) * .5, y + Math.sin(a0 + .3) * (r0 + r1) * .5, x + Math.cos(a1) * r1, y + Math.sin(a1) * r1); ctx.stroke();
                }
                if (p < .2) return;
                const tick = Math.floor(t * 14);
                ctx.globalCompositeOperation = 'lighter';
                for (let k = 0; k < (p > .7 ? 3 : 2); k++) {
                    if (rand(tick * 5 + k) > .3 + p * .55) continue;
                    const angle = rand(tick * 5 + k + 2) * TAU, r = core * (.9 + rand(tick + k) * .8);
                    bolt(ctx, x, y, x + Math.cos(angle) * r, y + Math.sin(angle) * r, tick * 7 + k, c, hot, (.5 + p * .5) * fade, 1.4);
                }
            } else if (burst && end < .65) {
                const e = end / .65, reach = Math.hypot(scene.w, scene.h) * .8, wave = reduced ? .3 : ease(e);
                if (end < .16) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - end / .16) * .4; ctx.fillStyle = rgba(hot, 1); ctx.fillRect(scene.x, scene.y, scene.w, scene.h); }
                glow(x, y, core * (1.4 - e), hot, (1 - e) * .9);
                band(x, y, core * .6 + wave * reach, core * (1 - e * .5), c, (1 - e) * .9);
                band(x, groundY(), core + wave * reach, core * .8, hot, (1 - e) * .5, .25);
            }
        }
        // 되울림: 좌우 원뿔이 차오른 뒤 겹친 파동으로 방출된다. 1초와 4초에 실제 타격.
        function echo(t, fade, reduced) {
            const [x, y] = point(...focus), core = spriteRect ? spriteRect.w * .2 : unit() * 70, length = Math.hypot(scene.w, scene.h) * .6;
            for (const [hit, power] of [[1, 1], [4, 1.35]]) {
                const w = t - (hit - 1);
                if (w < 0 || w > 1.6) continue;
                if (w >= 1 && w < 1.15) glow(x, y, core * 1.2 * power, VIOLET_HOT, (1 - (w - 1) / .15) * .8 * fade);
                for (const dir of [Math.PI * .84, Math.PI * .16]) {
                    const spread = .26 * power;
                    ctx.save(); ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, length, dir - spread, dir + spread); ctx.closePath(); ctx.clip();
                    if (w < 1) {
                        const fill = ease(w), gradient = ctx.createRadialGradient(x, y, core * .4, x, y, length * fill + 1);
                        gradient.addColorStop(0, rgba(VIOLET, .5)); gradient.addColorStop(.85, rgba(VIOLET, .18)); gradient.addColorStop(1, rgba(VIOLET, 0));
                        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(.55 * power * fade); ctx.fillStyle = gradient;
                        ctx.fillRect(x - length, y - length, length * 2, length * 2);
                        ctx.globalAlpha = clamp((.25 + fill * .4) * fade); ctx.strokeStyle = rgba(VIOLET_HOT, 1); ctx.lineWidth = 1.5;
                        for (const edge of [dir - spread, dir + spread]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(edge) * length * fill, y + Math.sin(edge) * length * fill); ctx.stroke(); }
                    } else {
                        const e = (w - 1) / .6;
                        for (let k = 0; k < 3; k++) {
                            const r = core * .6 + length * (reduced ? .3 + k * .2 : ease(clamp(e * 1.15 - k * .12)) * (1 - k * .08));
                            band(x, y, r, core * .35 * power, k ? VIOLET : VIOLET_HOT, (1 - e) * (.9 - k * .2) * fade);
                        }
                    }
                    ctx.restore();
                }
            }
        }
        // 맥동과 역전: 모임은 안으로, 흩어짐은 밖으로 흐른다. 역전은 붉은 소용돌이와 반전된 중심.
        function flow(t, ev, inversion, reduced) {
            const [x, y] = point(...focus), radius = Math.min(scene.w, scene.h) * .42, inward = ev.pulse === 'gather';
            const c = inversion ? RED : VIOLET, hot = inversion ? RED_HOT : VIOLET_HOT, n = width < 420 ? 12 : 20;
            ctx.lineCap = 'round';
            for (let i = 0; i < n; i++) {
                const angle = i / n * TAU + rand(i) * .3, ph = reduced ? .5 : (t * .8 + rand(i + 5)) % 1;
                const at = s => {
                    const curl = inversion ? (inward ? -1.1 : 1.1) * s : 0, r = radius * (.12 + s * .88);
                    return [x + Math.cos(angle + curl) * r, y + Math.sin(angle + curl) * r * .62];
                };
                const head = inward ? 1 - ph : ph, [hx, hy] = at(head), [tx, ty] = at(clamp(inward ? head + .16 : head - .16));
                const alpha = Math.sin(ph * Math.PI) * .85, gradient = ctx.createLinearGradient(tx, ty, hx, hy);
                gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(1, rgba(hot, 1));
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.strokeStyle = gradient; ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
                glow(hx, hy, 5, hot, alpha * .8);
            }
            const beat = reduced ? .5 : (t * 1.2) % 1;
            if (inversion) {
                glow(x, y, radius * .22, [20, 2, 6], .7, false);
                band(x, y, radius * .2, radius * .05, c, .7);
            } else glow(x, y, radius * (inward ? .14 + beat * .06 : .1), hot, inward ? .5 : .25);
            band(x, y, radius * (inward ? 1 - beat * .85 : .15 + beat * .85), radius * .05, c, Math.sin(beat * Math.PI) * .45, .62);
        }
        function shieldShape() {
            const b = spriteRect;
            return b ? [b.x + b.w * .5, b.y + b.h * .52, b.w * .58, b.h * .56] : [scene.x + scene.w * .5, scene.y + scene.h * .55, scene.w * .25, scene.h * .3];
        }
        // 보호막: 가장자리가 짙은 막, 육각 결, 반사광, 테두리의 네 층. 깎일수록 금이 가고 피격 지점에 파문이 남는다.
        function shield(t, state, c, hot, reduced) {
            const ev = state.event, [cx, cy, rx, ry] = shieldShape();
            const strength = ev.kind === 'trial' ? clamp(Number(ev.shield || 0) / Math.max(1, Number(ev.shieldMax || 0))) : 1, appear = clamp(t / .4);
            ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
            const body = ctx.createRadialGradient(0, 0, rx * .5, 0, 0, rx);
            body.addColorStop(0, rgba(c, 0)); body.addColorStop(.8, rgba(c, .1)); body.addColorStop(.97, rgba(c, .42)); body.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = appear * (.55 + .45 * strength); ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
            if (!hexTile) {
                hexTile = document.createElement('canvas'); hexTile.width = 24; hexTile.height = 42;
                const g = hexTile.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 1;
                g.beginPath(); g.moveTo(12, 0); g.lineTo(24, 7); g.lineTo(24, 21); g.lineTo(12, 28); g.lineTo(0, 21); g.lineTo(0, 7); g.closePath(); g.moveTo(12, 28); g.lineTo(12, 42); g.stroke();
            }
            ctx.save(); ctx.clip();
            ctx.translate(0, (reduced ? 0 : (t * 6) % 42) - rx);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear * .09 * (.4 + .6 * strength); ctx.fillStyle = ctx.createPattern(hexTile, 'repeat');
            ctx.fillRect(-rx, -42, rx * 2, rx * 2 + 84);
            ctx.restore();
            ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
            const drift = reduced ? 0 : Math.sin(t * .8) * .25;
            ctx.globalAlpha = appear * .55; ctx.strokeStyle = rgba(PALE_HOT, 1); ctx.lineWidth = rx * .035;
            ctx.beginPath(); ctx.arc(0, 0, rx * .9, -2.5 + drift, -1.75 + drift); ctx.stroke();
            ctx.globalAlpha = appear * .25; ctx.lineWidth = rx * .02;
            ctx.beginPath(); ctx.arc(0, 0, rx * .9, .7 + drift, 1.1 + drift); ctx.stroke();
            ctx.globalAlpha = appear * (.35 + .3 * strength); ctx.strokeStyle = rgba(hot, 1); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.stroke();
            for (let i = 0; i < Math.floor((1 - strength) * 8); i++) {
                const angle = rand(i + 40) * TAU, r0 = rx * (.96 - rand(i + 41) * .1), r1 = rx * (.55 + rand(i + 42) * .2);
                bolt(ctx, Math.cos(angle) * r0, Math.sin(angle) * r0, Math.cos(angle + .2) * r1, Math.sin(angle + .2) * r1, i * 13, c, hot, appear * .6, 1);
            }
            const now = performance.now();
            for (const hit of state.hits) {
                const d = (now - hit.at) / 1000;
                if (d > .45) continue;
                const hx = Math.cos(hit.angle) * rx * .92, hy = Math.sin(hit.angle) * rx * .92;
                ctx.save(); ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.clip();
                glow(hx, hy, rx * .25, hot, (1 - d / .45) * .8);
                band(hx, hy, rx * (.05 + d * .9), rx * .06, c, (1 - d / .45) * .7);
                ctx.restore();
            }
            ctx.restore();
        }
        function shatter(t) {
            const e = clamp(t / .65), [cx, cy, rx, ry] = shieldShape(), n = width < 420 ? 10 : 16;
            if (e >= 1) return;
            band(cx, cy, rx * (1 + ease(e) * .4), rx * .12, PALE_HOT, (1 - e) * .9, ry / rx);
            for (let i = 0; i < n; i++) {
                const angle = i / n * TAU + rand(i) * .3, v = rx * (.5 + rand(i + 3) * .7), size = rx * (.06 + rand(i + 5) * .06);
                const px = cx + Math.cos(angle) * (rx + v * e), py = cy + Math.sin(angle) * (ry + v * e * ry / rx) + 160 * e * e;
                ctx.save(); ctx.translate(px, py); ctx.rotate(angle + e * (4 + rand(i + 7) * 6));
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - e) * .8;
                ctx.fillStyle = rgba(PALE, .5); ctx.strokeStyle = rgba(PALE_HOT, 1); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .8, size * .6); ctx.lineTo(-size * .7, size * .4); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
        }
        // 정화: 어두운 연기 장막이 중앙부터 걷혀 실제 배경을 드러낸다. 절반 해상도로 따로 그린다.
        function drawMist(now, dt, reduced) {
            if (!scene.w || !scene.h) return;
            mist.shown += (mist.target - mist.shown) * (1 - Math.exp(-dt / .25));
            const dissolve = mist.doneAt ? clamp((now - mist.doneAt) / 600) : 0;
            const reveal = mist.shown + (1 - mist.shown) * ease(dissolve);
            const w = Math.max(1, Math.round(scene.w * .5)), h = Math.max(1, Math.round(scene.h * .5));
            if (fog.width !== w || fog.height !== h) { fog.width = w; fog.height = h; }
            const g = fogCtx, image = texture('mist') || puff(), time = reduced ? 0 : now / 1000;
            g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
            const veil = g.createLinearGradient(0, 0, 0, h);
            veil.addColorStop(0, 'rgba(7,6,9,.86)'); veil.addColorStop(.6, 'rgba(12,8,10,.9)'); veil.addColorStop(1, 'rgba(24,6,9,.94)');
            g.fillStyle = veil; g.fillRect(0, 0, w, h);
            for (let i = 0; i < (w < 240 ? 9 : 14); i++) {
                const size = (.45 + rand(i + 11) * .5) * Math.max(w, h);
                const px = ((rand(i) + time * .006 * (.5 + rand(i + 3))) % 1.3 - .15) * w;
                const py = (rand(i + 7) * 1.1 - .05) * h + Math.sin(time * .15 + i) * h * .02;
                g.globalAlpha = .4 + rand(i + 13) * .35;
                g.drawImage(image, px - size / 2, py - size * .31, size, size * .62);
            }
            g.globalCompositeOperation = 'source-atop'; g.globalAlpha = .75 + (reduced ? 0 : Math.sin(time * .5) * .15);
            const ember = g.createRadialGradient(w * .5, h * 1.1, 0, w * .5, h * 1.1, h * .95);
            ember.addColorStop(0, 'rgba(130,16,24,.45)'); ember.addColorStop(1, 'rgba(130,16,24,0)');
            g.fillStyle = ember; g.fillRect(0, 0, w, h);
            if (reveal > 0) {
                // 무대 비율에 맞춘 타원으로 걷어 낸다. 걷힌 넓이가 진행도와 비슷하게 늘고, 100%에서 모서리까지 맑아진다.
                const cx = w * .5, cy = h * .56, squash = h / w, r = w * .5 * 1.55 * reveal ** .7, inner = .5 + .5 * reveal;
                const hole = g.createRadialGradient(0, 0, r * inner, 0, 0, r + 1);
                // 진행 초반에는 걷힌 중앙에도 옅은 연기가 남는다.
                hole.addColorStop(0, 'rgba(0,0,0,' + (.8 + .2 * reveal) + ')'); hole.addColorStop(1, 'rgba(0,0,0,0)');
                g.save(); g.translate(cx, cy); g.scale(1, squash);
                g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.fillStyle = hole; g.fillRect(-w, -w * 1.2, w * 2, w * 2.4);
                g.restore();
                // 가장자리를 연기 모양으로 갉아 타원 경계가 드러나지 않게 한다.
                g.globalAlpha = .45;
                for (let k = 0; k < 12; k++) {
                    const angle = k / 12 * TAU + time * .03, rr = r * (inner + (1 - inner) * .3) * (.85 + rand(k + 20) * .2), size = Math.max(8, Math.min(r * .5, h * .7));
                    g.drawImage(image, cx + Math.cos(angle) * rr - size / 2, cy + Math.sin(angle) * rr * squash - size * .31, size, size * .62);
                }
            }
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - dissolve;
            ctx.drawImage(fog, scene.x, scene.y, scene.w, scene.h);
        }
        function draw(state, t) {
            const kind = state.kind, ev = state.event, reduced = motion.matches;
            const duration = Number(ev.duration || 0), end = t - duration;
            const fade = end > 0 ? clamp(1 - end / .65) : 1;
            ctx.save();
            if (kind === 'harden') sheen(t, 1, fade, reduced);
            else if (kind === 'empower') sheen(t, .4, fade, reduced);
            else if (kind === 'sculpture') {
                const pct = clamp(Number(ev.damage || 0) / Math.max(1, Number(ev.hpMax || 0)));
                skin((m, b) => { m.fillStyle = 'rgba(236,226,206,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, pct * .55, 'overlay');
            } else if (kind === 'shards') shards(t, fade, reduced);
            else if (kind === 'resonance') charge(t, duration, VIOLET, VIOLET_HOT, true, fade, reduced);
            else if (['flame', 'charge', 'purge', 'execute', 'cannon'].includes(kind)) {
                const [c, hot] = kind === 'flame' ? [[255, 120, 50], [255, 222, 170]] : kind === 'charge' || kind === 'cannon' ? [[236, 190, 100], [255, 242, 210]] : [VIOLET, VIOLET_HOT];
                charge(t, duration, c, hot, false, fade, reduced);
            } else if (kind === 'echo') echo(t, fade, reduced);
            else if (kind === 'dictation' || kind === 'voice') {
                const [x, y] = point(...focus), r = Math.min(scene.w, scene.h) * .3;
                for (let i = 0; i < 2; i++) { const p = reduced ? .4 : (t * .7 + i * .5) % 1; band(x, y, r * (.2 + p * .8), r * .06, PALE, (1 - p) * .35, .7); }
            } else if (kind === 'pulse' || kind === 'inversion') flow(t, ev, kind === 'inversion', reduced);
            else if (kind === 'trial' && ev.stage === 'record') {
                // 기록 중: 차가운 막이 몸을 덮고 주사선이 아래로 훑는다.
                const scan = reduced ? .5 : (t * .45) % 1;
                skin((m, b) => {
                    const gradient = m.createLinearGradient(0, b.y + b.h * (scan - .12), 0, b.y + b.h * (scan + .12));
                    gradient.addColorStop(0, rgba(PALE, .15)); gradient.addColorStop(.5, rgba(PALE_HOT, 1)); gradient.addColorStop(1, rgba(PALE, .15));
                    m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
                }, .35, 'lighter');
            } else if (kind === 'shield' || kind === 'trial') shield(t, state, PALE, PALE_HOT, reduced);
            else if (kind === 'reflect') shield(t, state, [130, 220, 236], [226, 252, 255], reduced);
            else if (kind === 'curse') {
                skin((m, b) => { m.fillStyle = 'rgba(60,20,90,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, .4 + (reduced ? 0 : Math.sin(t * 2) * .08), 'multiply');
                ctx.save(); ctx.translate(point(.5, 1)[0], groundY()); ctx.scale(1, .25);
                glow(0, 0, (spriteRect?.w || scene.w * .4) * .6, [120, 60, 190], .35);
                ctx.restore();
            } else if (kind === 'transition') {
                // 스피커가 안에서부터 붉게 갈라진다.
                const p = clamp(t / 4);
                skin((m, b) => { m.fillStyle = 'rgba(30,6,10,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, p * .45, 'multiply');
                skin((m, b) => {
                    const x = b.x + b.w * .5, y = b.y + b.h * .66;
                    for (let i = 0; i < 3 + Math.floor(p * 9); i++) {
                        const angle = rand(i + 70) * TAU, r = b.w * (.15 + rand(i + 71) * .45) * clamp(p * 1.5);
                        bolt(m, x, y, x + Math.cos(angle) * r, y + Math.sin(angle) * r * 1.2, i * 11, RED, RED_HOT, 1, 1.4);
                    }
                }, .5 + p * .5, 'lighter');
                if (t > 3.6) glow(...point(.5, .66), (spriteRect?.w || scene.w * .4) * .7, RED_HOT, clamp((t - 3.6) / .4) * .6);
            } else if (kind === 'wall') {
                // 양쪽 벽이 소리에 떨린다.
                const strength = Math.sin(clamp(t / Math.max(.1, duration)) * Math.PI), size = scene.w * .14;
                ctx.globalCompositeOperation = 'lighter';
                for (const side of [0, 1]) {
                    const edge = side ? scene.x + scene.w : scene.x, dir = side ? -1 : 1;
                    const gradient = ctx.createLinearGradient(edge, 0, edge + dir * size, 0);
                    gradient.addColorStop(0, rgba(VIOLET, .35)); gradient.addColorStop(1, rgba(VIOLET, 0));
                    ctx.globalAlpha = strength * fade; ctx.fillStyle = gradient; ctx.fillRect(Math.min(edge, edge + dir * size), scene.y, size, scene.h);
                    ctx.strokeStyle = rgba(VIOLET_HOT, 1); ctx.lineWidth = 1.2;
                    for (let k = 0; k < 4; k++) {
                        const x0 = edge + dir * size * (.15 + k * .2);
                        ctx.globalAlpha = strength * (.5 - k * .1) * fade; ctx.beginPath();
                        for (let y = scene.y; y <= scene.y + scene.h; y += 8) {
                            const x = x0 + Math.sin(y * .06 + (reduced ? 0 : t * 38) + k) * size * .06 * strength;
                            if (y === scene.y) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                }
            } else if (kind === 'rupture') {
                const [x, y] = point(...focus), reach = Math.hypot(scene.w, scene.h) * .45, grow = reduced ? 1 : ease(clamp(t / .2)), alpha = clamp(1 - t / 1.3);
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 7; i++) {
                    const angle = i / 7 * TAU + rand(i + 30) * .4, r = reach * (.6 + rand(i + 31) * .4) * grow;
                    bolt(ctx, x, y, x + Math.cos(angle) * r, y + Math.sin(angle) * r, i * 17, RED, RED_HOT, alpha * .9, 1.8);
                }
                glow(x, y, reach * .25, RED_HOT, alpha * .6);
                band(x, y, reach * (.1 + (reduced ? .3 : ease(clamp(t / .6))) * .9), reach * .08, RED, alpha * .6);
            } else if (kind === 'pillars') {
                // 하중이 큰 기둥일수록 돌가루가 많이 떨어진다.
                for (let i = 0; i < 4; i++) {
                    const load = clamp(Number(ev.loads?.[i] || 0) / 12), x = scene.x + scene.w * (.16 + i * .22);
                    const gradient = ctx.createLinearGradient(0, scene.y, 0, scene.y + scene.h);
                    gradient.addColorStop(0, rgba(BRONZE, .3 * load)); gradient.addColorStop(1, rgba(BRONZE, 0));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = gradient; ctx.fillRect(x - 10, scene.y, 20, scene.h);
                    if (!reduced) for (let k = 0; k < Math.round(load * 5); k++) {
                        const p = (t * (.6 + rand(i * 9 + k) * .5) + rand(i * 9 + k + 1)) % 1;
                        glow(x + (rand(i * 9 + k + 2) - .5) * 16, scene.y + p * scene.h * .9, 2.5, [214, 196, 168], (1 - p) * .6, false);
                    }
                }
            } else if (kind === 'blessing') {
                const [x, top] = point(.5, 0), w = (spriteRect?.w || scene.w * .4) * .5, ground = groundY();
                const gradient = ctx.createLinearGradient(0, scene.y, 0, ground);
                gradient.addColorStop(0, 'rgba(255,240,206,.32)'); gradient.addColorStop(1, 'rgba(255,240,206,0)');
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = reduced ? .7 : .6 + Math.sin(t * 2) * .15; ctx.fillStyle = gradient;
                ctx.beginPath(); ctx.moveTo(x - w * .3, scene.y); ctx.lineTo(x + w * .3, scene.y); ctx.lineTo(x + w, ground); ctx.lineTo(x - w, ground); ctx.closePath(); ctx.fill();
                glow(x, top + (spriteRect?.h || 0) * .4, w * 1.2, [255, 236, 200], .12);
            } else if (kind === 'shatter') shatter(t);
            ctx.restore();
        }
        function render(now) {
            frame = 0;
            if (document.hidden || !busy() || !width || !height) { ctx.clearRect(0, 0, width, height); return; }
            if (now - lastFrame < 32) { frame = requestAnimationFrame(render); return; }
            const dt = Math.min(.1, (now - lastFrame) / 1000);
            lastFrame = now; ctx.clearRect(0, 0, width, height);
            locate();
            if (mistAlive()) { ctx.save(); drawMist(now, dt, motion.matches); ctx.restore(); }
            for (const [id, state] of states) {
                const age = (now - state.start) / 1000, ev = state.event;
                const finite = ev.remain != null || state.kind === 'shatter';
                if (state.removed && age > Number(ev.duration || 0) + .65) { stopSounds(state); states.delete(id); continue; }
                state.plan.forEach(([at, key, gain], i) => {
                    if (state.fired.has(i) || age < at) return;
                    state.fired.add(i);
                    if (age - at <= .15) play(state, key, gain);
                });
                if (!finite || age <= Number(ev.duration || 0) + .65) draw(state, age);
            }
            if (busy()) frame = requestAnimationFrame(render);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stopSounds(); }
            else kick();
        });
        return { update, reset, setVolume, markTargets: () => targets(currentView?.events || []), visualOnly: event => VISUAL_ONLY.has(event.kind) };
    }
    window.RaidPatternFX = { create };
})();
