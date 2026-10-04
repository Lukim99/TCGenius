// 서버가 공개한 패턴만 그린다. 피해와 입력 판정은 전투 엔진에서 처리한다.
(() => {
    'use strict';
    const FILES = {
        beep: 'beep', gloss: 'gloss', fall: 'shards-fall', stone: 'shards-impact',
        blast: 'resonance-blast', wall: 'wall-hum', rupture: 'rupture', charge: 'charge'
    };
    // 즉시 발동한 실제 사건. 카드 없이 효과만 보여 주고, 서버 목록에서 빠져도 끝까지 그린다.
    const INSTANT = new Set(['regenerate', 'dark-blast', 'crit-reflect', 'revive', 'puzzle', 'dealing', 'dealing-strike', 'bounce']);
    const VISUAL_ONLY = new Set(['harden', 'shards', 'resonance', 'echo', 'wall', 'rupture', ...INSTANT]);
    // 자연 종료 직전에 빠지면 마무리(폭발, 착탄, 사라짐)를 이어서 그린다.
    const TAIL = new Set(['resonance', 'echo', 'shards', 'shatter', 'purge', 'execute', 'flame', 'cannon', 'empower', 'dark-shield', 'mochi-shield', 'rain-shield', 'reflect']);
    const CAST_IMPACT = new Set(['purge', 'execute', 'flame', 'cannon']);
    const TEXTURES = { mist: '레이드/fx-dark-mist.png', shard: '레이드/fx-bronze-shard.png', fire: '레이드/fx-fire-plume-v1.png', heal: '레이드/fx-healing-wisp-v1.png', puzzle: '레이드/fx-puzzle-piece-v1.png' };
    // 분리 보스 그림 안의 기준점(가로, 세로 비율): 황소 몸통, 스피커 우퍼, 잔향의 뻗은 손.
    const FOCUS = { sculpture: [.55, .52], whiplash: [.5, .66], 'whiplash-echo': [.7, .66] };
    const GLINTS = [[.42, .05], [.39, .3], [.58, .45], [.79, .58], [.3, .83], [.66, .74]];
    const BRONZE = [255, 196, 120], BRONZE_HOT = [255, 246, 222], VIOLET = [168, 120, 255], VIOLET_HOT = [236, 222, 255];
    const RED = [232, 40, 52], RED_HOT = [255, 196, 188], PALE = [196, 204, 255], PALE_HOT = [244, 246, 255];
    const TAU = Math.PI * 2;
    const buffers = new Map(), textures = new Map();
    let audio = null, loading = null, hexTile = null, puffTile = null;
    const tailTime = kind => kind === 'flame' ? 1.5 : .65;
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

    function soundPlan(kind, duration) {
        switch (kind) {
        case 'harden': return [[1, 'gloss', .35]];
        case 'shards': return [[0, 'fall', .3], [2, 'stone', .6], [3, 'stone', .6], [4, 'stone', .6]];
        case 'resonance': return [[0, 'beep', .6], [.16, 'beep', .6], [.32, 'beep', .6], [3, 'blast', .7]];
        case 'echo': return [[0, 'beep', .5], [.22, 'beep', .5], [3, 'beep', .6], [3.22, 'beep', .6]];
        case 'wall': return [[0, 'wall', .4]];
        case 'rupture': return [[0, 'rupture', .45]];
        case 'shield': case 'dark-shield': case 'mochi-shield': case 'rain-shield': case 'reflect':
        case 'charge': case 'purge': case 'empower': case 'dealing': case 'revive': return [[0, 'charge', .3]];
        // 시전 끝의 실제 타격만 한 번 더 울린다.
        case 'flame': return [[0, 'charge', .3], [duration, 'blast', .5]];
        case 'cannon': return [[0, 'charge', .3], [duration, 'stone', .55]];
        case 'execute': return [[0, 'charge', .3], [duration, 'rupture', .45]];
        case 'regenerate': return [[0, 'gloss', .22]];
        case 'dark-blast': case 'dealing-strike': return [[0, 'blast', .5]];
        case 'crit-reflect': case 'bounce': return [[0, 'stone', .4]];
        case 'puzzle': return [[.3, 'stone', .3], [.6, 'stone', .25]];
        default: return [];
        }
    }
    const kindOf = event => event.kind === 'raidCue' ? event.effect || 'charge' : event.kind;
    const hash = id => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h; };
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
            // 짧은 즉시 효과가 첫 이미지 요청을 기다리다 끝나지 않도록 해당 보스의 재질을 미리 읽는다.
            const art = sprite?.src || '';
            if (art.includes('ingyeo')) texture('fire');
            if (art.includes('black-hodu')) { texture('heal'); texture('mist'); }
            if (art.includes('tabujago')) texture('puzzle');
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
                    state = { event, kind: kindOf(event), seed: hash(id), start: now - age * 1000, plan: soundPlan(kindOf(event), Number(event.duration || 0)), fired: new Set(), sources: new Set(), hits: [], removed: false };
                    // 재접속으로 이미 지난 신호를 다시 울리지 않는다.
                    state.plan.forEach(([at], i) => { if (age - at > .15) state.fired.add(i); });
                    states.set(id, state);
                    if (['shards', 'bounce', 'burden'].includes(state.kind)) texture('shard');
                    if (['empower', 'dark-shield', 'flame', 'bounce', 'burden'].includes(state.kind)) texture('mist');
                    if (['flame', 'berserk'].includes(state.kind)) texture('fire');
                    if (state.kind === 'regenerate') texture('heal');
                    if (state.kind === 'puzzle') texture('puzzle');
                    if (VISUAL_ONLY.has(state.kind)) announcements.push(event.message || event.label);
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
                if (INSTANT.has(state.kind)) state.removed = true;
                else if (CAST_IMPACT.has(state.kind) && state.event.stage !== 'resolved') { stopSounds(state); states.delete(id); }
                else if (!TAIL.has(state.kind) || age < Number(state.event.duration || 0) - .35) { stopSounds(state); states.delete(id); }
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
        // 보스 그림의 알파 안쪽에만 칠한다. 먼저 칠한 뒤 그림 알파로 잘라 여러 획도 함께 남는다.
        function skin(paint, alpha, op = 'source-over') {
            const b = spriteRect;
            if (!b || alpha <= 0) return;
            maskCtx.globalCompositeOperation = 'source-over'; maskCtx.globalAlpha = 1;
            maskCtx.clearRect(0, 0, width, height);
            paint(maskCtx, b);
            maskCtx.globalCompositeOperation = 'destination-in'; maskCtx.globalAlpha = 1;
            maskCtx.drawImage(sprite, spriteDrawRect.x, spriteDrawRect.y, spriteDrawRect.w, spriteDrawRect.h);
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

        // ---- 일반 레이드 신호 ----
        const body = () => spriteRect || { x: scene.x + scene.w * .3, y: scene.y + scene.h * .2, w: scene.w * .4, h: scene.h * .6 };
        // 공개된 대상의 파티 카드 쪽으로 방향만 잡는다. 카드가 없으면 무대 가운데.
        function memberX(name) {
            const card = name && document.querySelector('.pq-char-card[data-member="' + CSS.escape(name) + '"]');
            let x = card ? card.getBoundingClientRect().left + card.offsetWidth / 2 - canvas.getBoundingClientRect().left : scene.x + scene.w / 2;
            // 낮은 가로 화면은 파티가 무대 옆에 있다. 각 대상을 같은 모서리에 몰지 않는다.
            if (card && (x < scene.x || x > scene.x + scene.w)) {
                const cards = [...document.querySelectorAll('.pq-char-card[data-member]')];
                x = scene.x + scene.w * (.15 + .7 * (cards.indexOf(card) + .5) / cards.length);
            }
            return Math.max(scene.x + 16, Math.min(scene.x + scene.w - 16, x));
        }
        // 알파 재질을 회전, 압축해 그린다. 연기는 일반 합성, 불과 회복광은 가산 합성이다.
        function material(g, image, x, y, w, h, alpha, angle = 0, flip = 1) {
            if (!image || alpha <= .01) return;
            g.save(); g.translate(x, y); g.rotate(angle); g.scale(flip, 1); g.globalAlpha = clamp(alpha);
            g.drawImage(image, -w / 2, -h / 2, w, h); g.restore();
        }
        // 밑동을 고정한 채 난류 방향과 높이를 바꾼다. 한 장으로 합성해 가산 합성의 줄 경계를 막는다.
        function firePlume(x, base, w, h, t, seed, alpha, lean = 0, reduced = false) {
            const image = texture('fire');
            if (!image || alpha <= .01 || h < 2) return;
            ctx.save(); ctx.translate(x, base); ctx.rotate(lean); ctx.scale(rand(seed) > .5 ? -1 : 1, 1);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha);
            const flicker = reduced ? 1 : 1 + .045 * Math.sin(t * 8.1 + seed);
            ctx.transform(1, 0, reduced ? 0 : .055 * Math.sin(t * 4.7 + seed), flicker, 0, 0);
            ctx.drawImage(image, -w / 2, -h * .96, w, h);
            ctx.restore();
        }
        function embers(x0, w, base, rise, n, t, seed, alpha) {
            for (let i = 0; i < n; i++) {
                const ph = (t * (.35 + rand(seed + i) * .3) + rand(seed + i + 1)) % 1;
                const x = x0 + w * rand(seed + i + 2) + Math.sin(ph * 5 + i) * w * .02;
                glow(x, base - ph * rise, (3 + rand(seed + i + 3) * 3) * unit(), [255, 150, 60], Math.sin(ph * Math.PI) * alpha);
            }
        }
        // 날카로운 십자 반짝임. 거울면과 반격에 쓴다.
        function glint(x, y, r, angle, alpha) {
            if (alpha <= .01) return;
            ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = 'rgb(248,252,255)';
            ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(0, -r * .07); ctx.lineTo(r, 0); ctx.lineTo(0, r * .07); ctx.closePath();
            ctx.moveTo(0, -r * .55); ctx.lineTo(r * .06, 0); ctx.lineTo(0, r * .55); ctx.lineTo(-r * .06, 0); ctx.closePath(); ctx.fill();
            ctx.restore();
        }
        // 흑화 증폭: 무거운 연기가 몸으로 응축되고, 기존 그림의 붉은 결만 낮게 맥동한다.
        function empower(t, fade, reduced, seed) {
            const b = body(), image = texture('mist') || puff(), [cx, cy] = point(.5, .65), h = Math.min(b.h, scene.h), sink = ease(clamp(t / .9)) * fade;
            if (!reduced && t < 1.15) for (let i = 0; i < 4; i++) {
                const p = ease(clamp((t - i * .08) / .75)), side = i % 2 ? 1 : -1;
                const x = cx + side * b.w * (.62 - p * .43), y = cy + h * (.12 - i * .09) * (1 - p);
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, x, y, b.w * (.58 - p * .22), h * (.7 - p * .25), Math.sin(p * Math.PI) * .35 * fade, side * p * .3);
            }
            skin((m, b) => {
                const g = m.createRadialGradient(cx, cy, h * .06, cx, cy, b.w * .62);
                g.addColorStop(0, 'rgba(24,4,10,.85)'); g.addColorStop(1, 'rgba(40,20,30,.15)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                for (let i = 0; i < 3; i++) {
                    const drift = reduced ? 0 : Math.sin(t * .6 + i) * h * .025;
                    material(m, image, b.x + b.w * (.25 + i * .25), cy + drift, b.w * .5, h * .8, .45, i * .6 + (reduced ? 0 : t * .06));
                }
            }, (.4 + (t < 1.2 ? .1 * Math.sin(clamp((t - .7) / .5) * Math.PI) : 0)) * sink, 'multiply');
            const phase = t % 1.8, beat = reduced ? .3 : Math.exp(-(((phase - .12) / .1) ** 2)) + .5 * Math.exp(-(((phase - .38) / .1) ** 2));
            // 알파 내부의 연기 결을 재사용해 직선 번개 대신 낮은 진홍색 맥을 남긴다.
            skin((m, b) => {
                material(m, image, cx, cy, b.w * .9, h, .8, reduced ? 0 : Math.sin(t * .4) * .08);
            }, (.12 + .2 * beat) * sink, 'lighter');
            ctx.globalCompositeOperation = 'source-over';
            material(ctx, image, cx, groundY(), b.w * .9, h * .28, .22 * sink, reduced ? 0 : Math.sin(t * .2) * .04);
        }
        // 재생: 부드러운 회복광이 몸의 결에 스며든다. 수평 주사선과 보석 모양 입자는 쓰지 않는다.
        function regenerate(t, duration, reduced, seed) {
            const b = body(), ground = groundY(), h = Math.min(b.h, scene.h * .85), image = texture('heal');
            const p = reduced ? .45 : ease(clamp(t / (duration * .7))), show = clamp(t / .18) * clamp((duration - t) / .4), JADE = [140, 210, 170];
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 2; i++) {
                const drift = reduced ? 0 : Math.sin(t * 1.8 + i * 2) * b.w * .012;
                material(ctx, image, b.x + b.w * (.32 + i * .35) + drift, ground - h * (.24 + p * .22), h * .42, h * .85, .34 * show, (i ? .13 : -.13));
            }
            skin((m, b) => {
                const cy = ground - h * (.2 + p * .65), cx = b.x + b.w * .5;
                const g = m.createRadialGradient(cx, cy, 0, cx, cy, h * .55);
                g.addColorStop(0, 'rgba(190,240,206,.65)'); g.addColorStop(.4, 'rgba(98,185,139,.18)'); g.addColorStop(1, 'rgba(98,185,139,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                material(m, image, cx, cy, h * .7, h, .5, reduced ? 0 : t * .06);
            }, .45 * show, 'lighter');
            for (let i = 0; i < (width < 420 ? 5 : 8); i++) {
                const ph = reduced ? .5 : clamp((t - rand(seed + i) * .4) / .95), s = (1 + rand(seed + i + 1)) * unit();
                if (ph <= 0 || ph >= 1) continue;
                const x = b.x + b.w * (.22 + rand(seed + i + 2) * .56), y = ground - ph * h * (.4 + rand(seed + i + 3) * .4);
                glow(x, y, s * 2.5, JADE, Math.sin(ph * Math.PI) * show * .4);
            }
        }
        // 파멸의 정화: 무대 아래 파티 쪽에서 잿빛 생명줄이 보스로 빨려 올라가고, 끝나면 몸이 붉게 차오른다.
        function purge(t, duration, reduced, seed) {
            const [x, y] = point(...focus), b = body(), bottom = scene.y + scene.h, end = t - duration, n = width < 420 ? 4 : 6, u = unit();
            const p = clamp(t / duration), ASH = [216, 208, 222], BLOOD = [196, 24, 48], BLOOD_HOT = [255, 170, 170];
            if (end < 0) {
                ctx.lineCap = 'round';
                for (let i = 0; i < n; i++) {
                    const sx = scene.x + scene.w * (.1 + .8 * i / (n - 1)), mx = (sx + x) / 2 + (sx - x) * .25, my = (bottom + y) / 2;
                    if (reduced) continue;
                    for (let k = 0; k < 2; k++) {
                        const ph = (t * .9 + rand(seed + i * 2 + k)) % 1, s = ph ** 1.6, a = Math.sin(ph * Math.PI);
                        const dx = (1 - s) ** 2 * sx + 2 * (1 - s) * s * mx + s * s * x, dy = (1 - s) ** 2 * bottom + 2 * (1 - s) * s * my + s * s * y;
                        glow(dx, dy, 5 * u, BLOOD, a * (.4 + p * .5));
                        glow(dx, dy, 2 * u, BLOOD_HOT, a * (.5 + p * .5));
                    }
                }
                glow(x, y, b.w * (.12 + p * .12), [10, 2, 6], .35 * p, false);
                skin((m, b) => {
                    const g = m.createRadialGradient(x, y, 0, x, y, b.w * .35);
                    g.addColorStop(0, rgba(ASH, .2)); g.addColorStop(1, rgba(ASH, 0));
                    m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                }, p * .25, 'lighter');
            } else if (end < .65) {
                const e = end / .65;
                skin((m, b) => { m.fillStyle = rgba(BLOOD, 1); m.fillRect(b.x, b.y, b.w, b.h); }, (1 - e) * .45, 'lighter');
                glow(x, y, b.w * .15, BLOOD_HOT, (1 - e) * .3);
            }
        }
        // 종언: 무대 가장자리가 어두워지며 맥박이 빨라지고, 몸을 가르는 붉은 선이 길어진 뒤 한 번에 베어 낸다.
        function execute(t, duration, reduced, seed) {
            const [x, y] = point(.5, .45), end = t - duration, p = clamp(t / duration), reach = Math.hypot(scene.w, scene.h) * .5, u = unit();
            const angle = -.55 + (rand(seed) - .5) * .3, dx = Math.cos(angle), dy = Math.sin(angle), fall = end < 0 ? 1 : clamp(1 - end / .65);
            const beat = reduced || end >= 0 ? 0 : Math.max(0, Math.sin(t * TAU * (.8 + p * .9))) ** 8;
            const vignette = ctx.createRadialGradient(x, y, Math.min(scene.w, scene.h) * (.42 - p * .14), x, y, reach * 1.2);
            vignette.addColorStop(0, 'rgba(6,0,4,0)'); vignette.addColorStop(1, 'rgba(6,0,4,1)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp((.25 + p * .4 + beat * .12) * fall); ctx.fillStyle = vignette;
            ctx.fillRect(scene.x, scene.y, scene.w, scene.h);
            ctx.lineCap = 'round';
            if (end < 0) {
                const len = reach * .55 * (reduced ? 1 : ease(p)), flicker = reduced ? 1 : .75 + .25 * Math.sin(t * 31);
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((.25 + p * .4) * flicker); ctx.strokeStyle = rgba(RED, 1); ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x - dx * len, y - dy * len); ctx.lineTo(x + dx * len, y + dy * len); ctx.stroke();
                ctx.globalAlpha = clamp((.4 + p * .6) * flicker); ctx.strokeStyle = rgba(RED_HOT, 1); ctx.lineWidth = 1; ctx.stroke();
            } else if (end < .65) {
                const e = end / .65, len = reach * 1.2, nx = -dy, ny = dx, shift = (reduced ? 0 : ease(e)) * 10 * u;
                if (end < .1) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = (1 - end / .1) * .35; ctx.fillStyle = 'rgb(60,0,10)'; ctx.fillRect(scene.x, scene.y, scene.w, scene.h); }
                ctx.globalCompositeOperation = 'lighter';
                for (const [c, w, a] of [[RED, 16, .5], [RED_HOT, 6, 1]]) {
                    const half = w * u * (1 - e);
                    ctx.globalAlpha = clamp((1 - e) * a); ctx.fillStyle = rgba(c, 1);
                    ctx.beginPath(); ctx.moveTo(x - dx * len, y - dy * len); ctx.lineTo(x + nx * half, y + ny * half); ctx.lineTo(x + dx * len, y + dy * len); ctx.lineTo(x - nx * half, y - ny * half); ctx.closePath(); ctx.fill();
                }
                // 베인 자리가 양쪽으로 벌어지는 잔상.
                ctx.globalAlpha = clamp((1 - e) * .4); ctx.strokeStyle = rgba(RED_HOT, 1); ctx.lineWidth = 1;
                for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x - dx * len * .6 + nx * shift * side, y - dy * len * .6 + ny * shift * side); ctx.lineTo(x + dx * len * .6 + nx * shift * side, y + dy * len * .6 + ny * shift * side); ctx.stroke(); }
            }
        }
        // 화염 폭발: 두 곳의 바닥 열기, 한 번의 분출, 가라앉는 연기와 중력이 있는 잔불.
        function flame(t, duration, reduced, seed) {
            const b = body(), ground = groundY(), end = t - duration, p = clamp(t / duration), cx = b.x + b.w / 2, u = unit(), h = Math.min(b.h, scene.h);
            const light = (strength, radius) => skin((m, b) => {
                const g = m.createRadialGradient(cx, ground, h * .03, cx, ground, radius);
                g.addColorStop(0, 'rgba(255,174,84,.8)'); g.addColorStop(.35, 'rgba(235,72,20,.25)'); g.addColorStop(1, 'rgba(180,34,10,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, strength, 'lighter');
            if (end < 0) {
                light(.16 + p * .3, h * (.3 + p * .3));
                ctx.save(); ctx.translate(cx, ground); ctx.scale(1, .12);
                glow(0, 0, b.w * .42, [235, 82, 22], .14 + p * .15);
                ctx.restore();
                for (let i = 0; i < 2; i++) {
                    const flicker = reduced ? 1 : 1 + Math.sin(t * (6.2 + i) + seed) * .08;
                    const size = h * (.12 + p * .27) * (i ? .8 : 1) * flicker;
                    firePlume(cx + b.w * (i ? .26 : -.23), ground, size * .82, size, t, seed + i * 5, .45 + p * .25, i ? .08 : -.1, reduced);
                }
                if (!reduced) embers(cx - b.w * .25, b.w * .5, ground, h * .45, width < 420 ? 5 : 8, t, seed + 50, .4);
            } else if (end < 1.5) {
                const e = end / 1.5, image = texture('mist') || puff();
                light(end < .12 ? .5 * (1 - end / .12) : .24 * (1 - e), h * .65);
                // 질감 있는 연기는 불길보다 늦게 부풀어 올라 남는다.
                ctx.globalCompositeOperation = 'source-over';
                for (let i = 0; i < 3; i++) {
                    const size = h * (.55 + e * .22), x = cx + (i - 1) * h * .3;
                    material(ctx, image, x, ground - h * (.1 + e * .2), size, size * .7, Math.sin(e * Math.PI) * .3, (i - 1) * .12);
                }
                for (let i = 0; i < 3; i++) {
                    const age = end - (reduced ? 0 : i * .065), life = .64 - i * .045;
                    if (age < 0 || age >= life) continue;
                    const q = age / life, size = h * (i ? .5 : .76) * (reduced ? .8 : ease(clamp(age / .12))) * (1 - q * .2);
                    const side = i === 1 ? -1 : i === 2 ? 1 : 0;
                    firePlume(cx + side * b.w * .23, ground, size * (i ? .82 : 1), size, t * 1.6, seed + i * 8, Math.min(.85, (1 - q) * 1.1), side * .27, reduced);
                }
                if (!reduced) for (let i = 0; i < (width < 420 ? 8 : 12); i++) {
                    const a = end - rand(seed + i + 60) * .08;
                    if (a < 0 || a > 1.1) continue;
                    const vx = (rand(seed + i + 61) - .5) * h * .9, vy = h * (.35 + rand(seed + i + 62) * .4);
                    const x = cx + (rand(seed + i + 63) - .5) * h * .4 + vx * a, y = ground - vy * a + h * .75 * a * a;
                    if (y > ground) continue;
                    glow(x, y, (2 + rand(seed + i + 64) * 2) * u, [255, 162, 74], .65 * (1 - a / 1.1));
                }
            }
        }
        // 천국의 대포: 무대 위쪽에 열린 하늘 구멍에서 조준선이 좁혀 들고, 끝나면 포탄이 아래로 내리꽂힌다.
        function cannon(t, duration, ev, reduced, seed) {
            const end = t - duration, p = clamp(t / duration), aim = scene.y + scene.h * .93, u = unit(), SKY = [160, 206, 255], SKY_HOT = [240, 248, 255];
            const names = ev.targets || [];
            for (let k = 0; k < (names.length || 2); k++) {
                const ox = scene.x + scene.w * (.25 + .5 * rand(seed + k * 3)), oy = scene.y + scene.h * .04;
                const tx = names[k] ? memberX(names[k]) : scene.x + scene.w * (.15 + .7 * rand(seed + k * 3 + 1));
                const ang = Math.atan2(aim - oy, tx - ox), nx = -Math.sin(ang), ny = Math.cos(ang);
                if (end < 0) {
                    band(ox, oy, scene.w * .05 * (.4 + .6 * ease(p)), 6 * u, SKY_HOT, .6 * ease(clamp(t / .4)), .3);
                    const spread = scene.w * .08 * (1 - (reduced ? .5 : ease(p))) + 1.5;
                    const g = ctx.createLinearGradient(ox, oy, tx, aim);
                    g.addColorStop(0, rgba(SKY, .5)); g.addColorStop(1, rgba(SKY, .05));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(.25 + p * .5); ctx.fillStyle = g;
                    ctx.beginPath(); ctx.moveTo(ox - nx * 2, oy - ny * 2); ctx.lineTo(ox + nx * 2, oy + ny * 2); ctx.lineTo(tx + nx * spread, aim + ny * spread); ctx.lineTo(tx - nx * spread, aim - ny * spread); ctx.closePath(); ctx.fill();
                    // 착탄점은 조준 기호 대신 바닥에 응축되는 푸른 빛과 떨어지는 먼지로 표시한다.
                    ctx.save(); ctx.translate(tx, aim); ctx.scale(1, .25);
                    glow(0, 0, (26 - p * 12) * u, SKY, .15 + p * .3); ctx.restore();
                    if (!reduced) for (let i = 0; i < 3; i++) {
                        const q = (t * 1.2 + i / 3) % 1;
                        glow(tx + (rand(seed + i + 90) - .5) * 14 * u, aim - (1 - q) * 65 * u, 2 * u, SKY_HOT, q * .25);
                    }
                } else if (end < .65) {
                    const e = end / .65, travel = reduced ? 1 : clamp(end / .18), len = Math.hypot(tx - ox, aim - oy);
                    const hx = ox + (tx - ox) * travel, hy = oy + (aim - oy) * travel, trail = Math.min(len * .35, len * travel);
                    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
                    for (const [c, w] of [[SKY, 9], [SKY_HOT, 3]]) {
                        ctx.globalAlpha = clamp(1 - e); ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = w * u;
                        ctx.beginPath(); ctx.moveTo(hx - Math.cos(ang) * trail, hy - Math.sin(ang) * trail); ctx.lineTo(hx, hy); ctx.stroke();
                    }
                    if (travel >= 1) {
                        glow(tx, aim, 40 * u, SKY_HOT, (1 - e) * .8);
                        band(tx, aim, (10 + (reduced ? 30 : ease(e) * 60)) * u, 8 * u, SKY, (1 - e) * .7, .3);
                    }
                }
            }
        }
        // 폭주지대: 바닥의 몇 군데가 불규칙하게 타오른다. 시전 단계는 없다.
        function berserk(t, reduced, seed) {
            const ground = groundY(), bottom = scene.y + scene.h, top = ground - scene.h * .1;
            const g = ctx.createLinearGradient(0, top, 0, bottom);
            g.addColorStop(0, 'rgba(255,80,20,0)'); g.addColorStop(1, 'rgba(255,80,20,.15)');
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = reduced ? .8 : .75 + .25 * Math.sin(t * 2.3); ctx.fillStyle = g;
            ctx.fillRect(scene.x, top, scene.w, bottom - top);
            for (let i = 0; i < 3; i++) {
                const x = scene.x + scene.w * (.13 + i * .34 + (rand(seed + i) - .5) * .1);
                const flick = reduced ? 1 : 1 + .12 * Math.sin(t * (4.5 + i) + i * 2);
                const h = scene.h * (.12 + rand(seed + i + 2) * .08) * flick;
                firePlume(x, ground, h * .9, h, t, seed + i, .48, (i - 1) * .1, reduced);
            }
            if (!reduced) embers(scene.x, scene.w, bottom, scene.h * .5, width < 420 ? 6 : 10, t, seed + 200, .4);
        }
        // 칠흑의 방패: 몸의 표면에 흑요석 같은 어두운 반사막이 닫힌다.
        function darkShield(t, fade, reduced) {
            const b = body(), h = Math.min(b.h, scene.h * .85), ground = groundY(), mistImage = texture('mist') || puff();
            const show = ease(clamp(t / .35)) * fade;
            skin((m, b) => {
                const g = m.createLinearGradient(0, ground - h * .7, 0, ground);
                g.addColorStop(0, 'rgba(18,22,34,0)'); g.addColorStop(.4, 'rgba(18,22,34,.65)'); g.addColorStop(1, 'rgba(8,10,18,.9)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                material(m, mistImage, b.x + b.w * .5, ground - h * .25, b.w, h * .8, .35);
            }, .52 * show, 'multiply');
            const sweep = reduced ? .5 : (t / 2.8) % 1;
            skin((m, b) => {
                const x = b.x + b.w * (-.2 + sweep * 1.4), g = m.createLinearGradient(x - h * .12, ground - h * .6, x + h * .12, ground);
                g.addColorStop(0, 'rgba(140,152,176,0)'); g.addColorStop(.46, 'rgba(98,112,138,.12)');
                g.addColorStop(.5, 'rgba(190,202,218,.5)'); g.addColorStop(.54, 'rgba(98,112,138,.12)'); g.addColorStop(1, 'rgba(140,152,176,0)');
                m.fillStyle = g; m.fillRect(b.x, ground - h * .65, b.w, h * .65);
            }, .4 * show, 'lighter');
            if (!reduced && t < .8) for (let i = 0; i < 2; i++) {
                const p = ease(clamp(t / .8)), side = i ? 1 : -1;
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, mistImage, b.x + b.w * (.5 + side * (.48 - p * .18)), ground - h * .28, h * .7, h * .55, Math.sin(p * Math.PI) * .3, side * .2);
            }
        }
        // 모찌나간다: 말랑한 반투명 막이 튕기듯 부풀어 오르고 숨 쉬듯 출렁인다.
        function mochiShield(t, fade, reduced) {
            const [cx, cy, rx, ry] = shieldShape(), pop = reduced ? 1 : 1 - Math.exp(-7 * t) * Math.cos(12 * t), breath = reduced ? 0 : Math.sin(t * 2.4) * .03;
            if (pop <= .01) return;
            ctx.save(); ctx.translate(cx, cy + ry * .04); ctx.scale(pop * (1 + breath), pop * (1 - breath) * ry / rx);
            ctx.beginPath();
            for (let i = 0; i <= 48; i++) {
                const a = i / 48 * TAU, r = rx * (1 + (reduced ? 0 : .025 * Math.sin(3 * a + t * 2.2) + .015 * Math.sin(5 * a - t * 3.1)));
                if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(r, 0);
            }
            ctx.closePath();
            const fill = ctx.createRadialGradient(0, -rx * .1, rx * .45, 0, 0, rx * 1.03);
            fill.addColorStop(0, 'rgba(255,240,244,0)'); fill.addColorStop(.8, 'rgba(255,232,238,.16)'); fill.addColorStop(1, 'rgba(255,214,226,.42)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(fade); ctx.fillStyle = fill; ctx.fill();
            ctx.strokeStyle = 'rgba(255,244,247,.6)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.translate(-rx * .38, -rx * .52); ctx.rotate(-.5); ctx.scale(1, .32);
            glow(0, 0, rx * .2, [255, 250, 252], .35 * fade);
            ctx.restore();
        }
        // 레인! 도와줘!: 보스 위로 빗줄기가 떨어져 둥근 물막에 부딪히고 표면을 타고 흘러내린다.
        function rainShield(t, fade, reduced, seed) {
            const [cx, cy, rx, ry] = shieldShape(), ground = Math.max(cy, groundY()), u = unit(), WATER = [140, 200, 236], WATER_HOT = [226, 244, 255];
            const appear = clamp(t / .5) * fade, surface = x => Math.abs(x - cx) < rx ? cy - ry * Math.sqrt(1 - ((x - cx) / rx) ** 2) : ground;
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TAU); ctx.lineTo(cx + rx, ground); ctx.lineTo(cx - rx, ground); ctx.closePath();
            const g = ctx.createLinearGradient(0, cy - ry, 0, ground);
            g.addColorStop(0, rgba(WATER, .16)); g.addColorStop(1, rgba(WATER, .03));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear; ctx.fillStyle = g; ctx.fill();
            ctx.globalAlpha = appear * .5; ctx.strokeStyle = rgba(WATER_HOT, 1); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
            ctx.lineCap = 'round';
            const n = width < 420 ? 14 : 24, len = 16 * u;
            for (let i = 0; i < n; i++) {
                const x = scene.x + scene.w * (i + rand(seed + i)) / n, stop = surface(x);
                const ph = reduced ? rand(seed + i + 9) : (t * (1.3 + rand(seed + i + 1) * .5) + rand(seed + i + 2)) % 1;
                const y = scene.y - len + (stop - scene.y + len) * ph, tail = Math.max(scene.y, y), head = Math.min(stop, y + len);
                if (head <= tail) continue;
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear * .35; ctx.strokeStyle = rgba(WATER_HOT, 1); ctx.lineWidth = 1.1;
                ctx.beginPath(); ctx.moveTo(x, tail); ctx.lineTo(x + (head - tail) * .12, head); ctx.stroke();
                if (!reduced && y + len > stop && stop < ground) glow(x, stop, 5 * u, WATER_HOT, appear * .5 * (1 - (y + len - stop) / len));
            }
            if (!reduced) for (let k = 0; k < 4; k++) {
                const ph = (t * .45 + k / 4) % 1, a = -Math.PI / 2 + (k % 2 ? 1 : -1) * ph * Math.PI * .45;
                glow(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 4 * u, WATER_HOT, appear * .6 * Math.sin(ph * Math.PI));
            }
        }
        // 반사: 보스 표면이 차가운 거울처럼 빛을 튕긴다. 외곽에 도형을 둘러놓지 않는다.
        function mirror(t, fade, reduced, seed) {
            const show = clamp(t / .3) * fade, b = body(), cycle = reduced ? .4 : (t / 1.3) % 1;
            skin((m, b) => {
                const x = b.x + b.w * (-.25 + cycle * 1.5), g = m.createLinearGradient(x - b.w * .12, b.y, x + b.w * .12, b.y + b.h * .22);
                g.addColorStop(0, 'rgba(138,188,214,0)'); g.addColorStop(.45, 'rgba(154,206,226,.12)');
                g.addColorStop(.5, 'rgba(238,250,255,.8)'); g.addColorStop(.55, 'rgba(154,206,226,.12)'); g.addColorStop(1, 'rgba(138,188,214,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, .6 * show, 'lighter');
            if (!reduced) {
                const flash = clamp(1 - (t % 1.3) / .2), [x, y] = point(.3 + rand(seed + Math.floor(t / 1.3)) * .4, .5);
                glint(x, y, Math.min(b.w, b.h) * .055, -.6, flash * show * .65);
            }
        }
        // 어둠 폭발: 몸 중심으로 어둠이 오그라든 뒤 검은 충격파와 연기가 바닥을 따라 퍼진다.
        function darkBlast(t, reduced, seed) {
            const [x, y] = point(.5, .55), b = body(), reach = Math.max(scene.w, scene.h) * .65, n = width < 420 ? 5 : 8;
            if (t < .3) glow(x, y, b.w * (.5 - t), [8, 2, 8], (t / .3) * .55, false);
            const e = clamp((t - .22) / .98);
            if (e <= 0 || e >= 1) return;
            const r = b.w * .2 + (reduced ? .4 : ease(e)) * reach, thick = reach * .14, squash = .55;
            ctx.save(); ctx.translate(x, y); ctx.scale(1, squash);
            const g = ctx.createRadialGradient(0, 0, Math.max(0, r - thick), 0, 0, r);
            g.addColorStop(0, 'rgba(10,4,12,0)'); g.addColorStop(.7, 'rgba(10,4,12,.6)'); g.addColorStop(1, 'rgba(10,4,12,0)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(1 - e); ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.restore();
            band(x, y, r - thick * .3, 2 * unit(), [180, 20, 44], (1 - e) * .55, squash);
            const image = texture('mist') || puff(), size = b.w * .4;
            for (let i = 0; i < n; i++) {
                const a = i / n * TAU + rand(seed + i) * .5;
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp((1 - e) * .45);
                ctx.drawImage(image, x + Math.cos(a) * r * .85 - size / 2, y + Math.sin(a) * r * squash * .85 - size * .31, size, size * .62);
            }
        }
        // 치명 반사: 맞은 자리에서 각진 섬광이 튀고, 날카로운 반격이 공격한 쪽으로 되돌아간다.
        function critReflect(t, ev, reduced, seed) {
            const [px, py] = point(.35 + rand(seed) * .3, .3 + rand(seed + 1) * .35), tx = memberX(ev.targets?.[0]), ty = scene.y + scene.h * .95, u = unit();
            if (t < .2) glow(px, py, 22 * u, RED_HOT, (1 - t / .2) * .6);
            if (t < .25) glint(px, py, (18 + (reduced ? 0 : t * 80)) * u, Math.PI / 4, 1 - t / .25);
            const e = clamp((t - .08) / .3), out = clamp(1 - (t - .38) / .42);
            if (e <= 0 || out <= 0) return;
            const head = reduced ? 1 : ease(e), back = Math.max(0, head - .35), ang = Math.atan2(ty - py, tx - px), nx = -Math.sin(ang) * 3 * u, ny = Math.cos(ang) * 3 * u;
            const hx = px + (tx - px) * head, hy = py + (ty - py) * head, bx = px + (tx - px) * back, by = py + (ty - py) * back;
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = out; ctx.fillStyle = rgba(RED_HOT, 1);
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo((bx + hx) / 2 + nx, (by + hy) / 2 + ny); ctx.lineTo(hx, hy); ctx.lineTo((bx + hx) / 2 - nx, (by + hy) / 2 - ny); ctx.closePath(); ctx.fill();
            if (head >= 1) glint(tx, ty, 14 * u, 0, out * .8);
        }
        // 부활: 검게 식은 몸에 발밑부터 빛기둥이 솟고, 아래부터 다시 불이 붙는다.
        function revive(t, duration, reduced) {
            const b = body(), ground = groundY(), p = clamp(t / duration), out = clamp((duration - t) / .5), BONE = [255, 238, 210];
            const relight = ease(clamp((t - .35) / 1)), cx = b.x + b.w / 2, w = b.w * (.12 + .1 * Math.sin(p * Math.PI));
            skin((m, b) => { m.fillStyle = 'rgb(12,8,12)'; m.fillRect(b.x, b.y, b.w, b.h); }, (1 - relight) * .7);
            const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
            g.addColorStop(0, rgba(BONE, 0)); g.addColorStop(.5, rgba(BONE, .5)); g.addColorStop(1, rgba(BONE, 0));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(t / .4) * out; ctx.fillStyle = g;
            ctx.fillRect(cx - w, scene.y, w * 2, ground - scene.y);
            const front = b.y + b.h * (1 - relight);
            if (!reduced && relight > 0 && relight < 1) skin((m, b) => {
                const g = m.createLinearGradient(0, front - b.h * .05, 0, front + b.h * .12);
                g.addColorStop(0, rgba(BONE, 0)); g.addColorStop(.35, rgba(BONE, 1)); g.addColorStop(1, rgba(BONE, 0));
                m.fillStyle = g; m.fillRect(b.x, front - b.h * .05, b.w, b.h * .17);
            }, .7, 'lighter');
            if (t > .4 && t < 1.3) { const e = (t - .4) / .9; band(cx, ground, b.w * (.2 + (reduced ? .4 : ease(e)) * .9), 8 * unit(), BONE, (1 - e) * .5, .22); }
        }
        // 퍼즐 던지기: 조각들이 몸에서 튀어나와 돌며 무대 아래 파티 쪽으로 흩어진다.
        function puzzle(t, reduced, seed) {
            const n = width < 420 ? 6 : 10, u = unit(), bottom = scene.y + scene.h + 12 * u, image = texture('puzzle');
            for (let i = 0; i < n; i++) {
                const ph = reduced ? .55 : clamp((t - i / n * .55) / .55);
                if (ph <= 0 || ph >= 1) continue;
                const [sx, sy] = point(.3 + rand(seed + i) * .4, .3 + rand(seed + i + 1) * .3);
                const ex = scene.x + scene.w * (.06 + rand(seed + i + 2) * .88), lift = scene.h * (.12 + rand(seed + i + 3) * .15);
                const s = (16 + rand(seed + i + 4) * 10) * u;
                ctx.save(); ctx.translate(sx + (ex - sx) * ph, sy + (bottom - sy) * ph - lift * 4 * ph * (1 - ph));
                ctx.rotate(rand(seed + i + 5) * TAU + (reduced ? 0 : ph * (6 + rand(seed + i + 6) * 6)));
                ctx.scale(.45 + .55 * Math.abs(Math.cos(ph * 5 + i)), 1);
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, 0, 0, s * 2, s * 2, Math.min(1, ph * 6) * (reduced ? 1 - t / 1.2 : 1));
                ctx.restore();
            }
        }
        // 무난한 딜링: 다음 공격의 열기가 몸과 무기에 축적된다.
        function dealing(t, duration, ev, reduced) {
            const [x, y] = point(.63, .58), b = body(), count = Math.max(1, Math.min(3, Number(ev.count) || 1)), out = clamp((duration - t) / .35), u = unit();
            const h = Math.min(b.h, scene.h), show = ease(clamp(t / .25)) * out;
            skin((m, b) => {
                const g = m.createRadialGradient(x, y, 0, x, y, h * .4);
                g.addColorStop(0, 'rgba(255,180,88,.65)'); g.addColorStop(.35, 'rgba(228,110,36,.18)'); g.addColorStop(1, 'rgba(228,110,36,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, (.2 + count * .12) * show, 'lighter');
            for (let i = 0; i < 5 + count * 2; i++) {
                const p = reduced ? .5 : ease(clamp((t - i * .035) / .6)), angle = rand(i + count * 31) * TAU;
                const distance = h * (.18 + rand(i + 9) * .25) * (1 - p);
                glow(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * .7, 2.5 * u, [255, 200, 132], Math.sin(p * Math.PI) * out * .5);
            }
            glint(x, y, 10 * u, -.5, show * .4);
        }
        // 확실한 딜링: 무기에 축적된 열기가 한 번의 넓은 궤적으로 터진다.
        function dealingStrike(t, reduced) {
            const [x, y] = point(.5, .5), b = body(), u = unit(), AMBER = [255, 150, 50], AMBER_HOT = [255, 232, 186];
            ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
            if (t < .25) glow(x, y, Math.min(b.w, b.h) * (.12 + .1 * clamp(t / .25)), AMBER, .35 * (1 - t / .25));
            if (t > .18 && t < .45) glow(x, y, b.w * .3, AMBER_HOT, (1 - Math.abs(t - .25) / .2) * .7);
            const e = reduced ? .5 : clamp((t - .2) / .45), out = clamp(1 - (t - .65) / .55), R = scene.w * .55, oy = y - R * .35;
            if (t > .2 && out > 0) for (let j = 0; j < 6; j++) {
                const head = Math.PI * (.88 - e * .76);
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - j / 6) * out); ctx.strokeStyle = rgba(j ? AMBER : AMBER_HOT, 1); ctx.lineWidth = (12 - j * 1.5) * u;
                ctx.beginPath(); ctx.arc(x, oy, R, head + j * .12, head + (j + 1) * .12); ctx.stroke();
            }
            if (t > .45) { const g = clamp((t - .45) / .75); band(x, groundY(), b.w * (.3 + (reduced ? .5 : ease(g)) * 1.2), 10 * u, AMBER, (1 - g) * .6, .22); }
        }
        // 튀어오르기: 발밑의 먼지와 파편이 튀고 지정 대상 쪽에도 무거운 충격이 이어진다.
        function bounce(t, ev, reduced) {
            const b = body(), u = unit(), image = texture('mist') || puff(), bottom = scene.y + scene.h - 8 * u;
            const origins = [[b.x + b.w * .5, groundY()], [memberX(ev.targets?.[0]), bottom]];
            origins.forEach(([x, y], k) => {
                const age = t - k * .12, p = reduced ? .4 : clamp(age / .7);
                if (age < 0 || age > .85) return;
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, x, y - p * 18 * u, (50 + p * 80) * u, (25 + p * 25) * u, (1 - p) * .3);
                for (let i = 0; i < (width < 420 ? 3 : 5); i++) {
                    const vx = (rand(i + k * 13) - .5) * 70 * u, lift = (30 + rand(i + 7) * 30) * u;
                    shard(x + vx * p, y - 4 * p * (1 - p) * lift, (3 + rand(i + 19) * 3) * u, i * 2 + p * 4, p * 5, .5, clamp(1 - p * .5));
                }
            });
        }
        // 주시는 대상 방향으로 흐르는 낮은 불씨로만 표시한다.
        function markCue(t, ev, reduced) {
            const [x, y] = point(...focus), u = unit(), tx = memberX(ev.targets?.[0]), ty = scene.y + scene.h - 10 * u, EMBER = [255, 120, 40];
            if (!reduced) for (let i = 0; i < 3; i++) {
                const s = (t / 2.4 + i / 3) % 1;
                glow(x + (tx - x) * s, y + (ty - y) * s, 2.5 * u, EMBER, Math.sin(s * Math.PI) * .35);
            }
            glow(tx, ty, 7 * u, EMBER, reduced ? .25 : .2 + .1 * Math.sin(t * 2));
        }
        // 조의 의지: 부서진 청동 덩어리가 대상 위에 내려앉고, 지지 인원에 따라 하중을 넓게 받친다.
        function burden(t, state, reduced) {
            const ev = state.event, u = unit(), bottom = scene.y + scene.h - 6 * u, duration = Number(ev.duration || 0), seed = state.seed;
            const names = [...new Set([ev.target, ...(ev.responded || [])].filter(Boolean).map(String))];
            const xs = names.length ? names.map(memberX) : [memberX()], count = xs.length;
            const goal = xs.reduce((a, x) => a + x, 0) / count;
            state.loadX = state.loadX == null || reduced ? goal : state.loadX + (goal - state.loadX) * .2;
            const settle = reduced ? 1 : ease(clamp(t / .4)), show = settle * clamp((duration - t) / .2);
            if (show <= 0) return;
            const y = bottom - (26 + count * 5) * u - (1 - settle) * 24 * u + clamp(t / Math.max(.1, duration)) * 6 * u / count;
            for (let i = 0; i < 4; i++) {
                const x = state.loadX + (i - 1.5) * (14 + count * 3) * u;
                shard(x, y + (rand(seed + i) - .5) * 12 * u, (10 + rand(seed + i + 7) * 6) * u, i * 1.2 + seed, .2 + i * .4, .7, show);
            }
            xs.forEach(x => {
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, texture('mist') || puff(), x, bottom - 7 * u, 55 * u, 25 * u, .18 * show);
            });
            if (!reduced) for (let i = 0; i < 3; i++) {
                const p = (t * 2.5 + i / 3) % 1;
                shard(state.loadX + (rand(seed + i + 21) - .5) * 55 * u, y + p * p * 40 * u, 1.5 * u, i + p * 3, p * 4, .3, (1 - p) * show);
            }
        }
        function draw(state, t) {
            const kind = state.kind, ev = state.event, reduced = motion.matches;
            const duration = Number(ev.duration || 0), seed = state.seed;
            if (CAST_IMPACT.has(kind) && ev.stage !== 'resolved') t = Math.min(t, Math.max(0, duration - .001));
            const end = t - duration;
            const fade = end > 0 ? clamp(1 - end / tailTime(kind)) : 1;
            if (INSTANT.has(kind) && end > 0) return;
            ctx.save();
            ctx.beginPath(); ctx.rect(scene.x, scene.y, scene.w, scene.h); ctx.clip();
            if (kind === 'harden') sheen(t, 1, fade, reduced);
            else if (kind === 'empower') empower(t, fade, reduced, seed);
            else if (kind === 'regenerate') { if (Number(ev.amount) > 0) regenerate(t, duration, reduced, seed); }
            else if (kind === 'purge') purge(t, duration, reduced, seed);
            else if (kind === 'execute') execute(t, duration, reduced, seed);
            else if (kind === 'flame') flame(t, duration, reduced, seed);
            else if (kind === 'cannon') cannon(t, duration, ev, reduced, seed);
            else if (kind === 'charge') {
                // 기모아: 금빛 기운이 바깥 고리에서 몸 안으로 빨려 든다. 저지 결과에 따라 갈리므로 끝 폭발은 그리지 않는다.
                charge(t, duration, [236, 190, 100], [255, 242, 210], false, fade, reduced);
            }
            else if (kind === 'berserk') berserk(t, reduced, seed);
            else if (kind === 'dark-shield') darkShield(t, fade, reduced);
            else if (kind === 'mochi-shield') mochiShield(t, fade, reduced);
            else if (kind === 'rain-shield') rainShield(t, fade, reduced, seed);
            else if (kind === 'dark-blast') darkBlast(t, reduced, seed);
            else if (kind === 'crit-reflect') critReflect(t, ev, reduced, seed);
            else if (kind === 'revive') revive(t, duration, reduced);
            else if (kind === 'puzzle') puzzle(t, reduced, seed);
            else if (kind === 'dealing') dealing(t, duration, ev, reduced);
            else if (kind === 'dealing-strike') dealingStrike(t, reduced);
            else if (kind === 'bounce') bounce(t, ev, reduced);
            else if (kind === 'mark') markCue(t, ev, reduced);
            else if (kind === 'burden') burden(t, state, reduced);
            else if (kind === 'sculpture') {
                const pct = clamp(Number(ev.damage || 0) / Math.max(1, Number(ev.hpMax || 0)));
                skin((m, b) => { m.fillStyle = 'rgba(236,226,206,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, pct * .55, 'overlay');
            } else if (kind === 'shards') shards(t, fade, reduced);
            else if (kind === 'resonance') charge(t, duration, VIOLET, VIOLET_HOT, true, fade, reduced);
            else if (kind === 'echo') echo(t, fade, reduced);
            else if (kind === 'dictation' || kind === 'voice') {
                // 외침: 둥근 고리 대신 좌우로 퍼지는 음파 호.
                const [x, y] = point(...focus), r = Math.min(scene.w, scene.h) * .34;
                ctx.lineCap = 'round'; ctx.strokeStyle = rgba(PALE_HOT, 1);
                for (let i = 0; i < 3; i++) {
                    const p = reduced ? .3 + i * .2 : (t * .8 + i / 3) % 1;
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - p) * .45; ctx.lineWidth = 2 - p;
                    for (const dir of [0, Math.PI]) { ctx.beginPath(); ctx.arc(x, y, r * (.15 + p * .85), dir - .45, dir + .45); ctx.stroke(); }
                }
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
            else if (kind === 'reflect') mirror(t, fade, reduced, seed);
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
                if (state.removed && age > Number(ev.duration || 0) + tailTime(state.kind)) { stopSounds(state); states.delete(id); continue; }
                state.plan.forEach(([at, key, gain], i) => {
                    if (state.fired.has(i) || age < at) return;
                    if (CAST_IMPACT.has(state.kind) && at >= Number(ev.duration || 0) && ev.stage !== 'resolved') return;
                    state.fired.add(i);
                    if (age - at <= .15) play(state, key, gain);
                });
                if (!finite || age <= Number(ev.duration || 0) + tailTime(state.kind)) draw(state, age);
            }
            if (busy()) frame = requestAnimationFrame(render);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stopSounds(); }
            else kick();
        });
        return { update, reset, setVolume, markTargets: () => targets(currentView?.events || []), visualOnly: event => event.stage === 'resolved' || VISUAL_ONLY.has(kindOf(event)) };
    }
    window.RaidPatternFX = { create };
})();
