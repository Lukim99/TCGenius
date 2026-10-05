// Opus 5.5의 생일 소품 동선. 서버 사건을 재생하며 판정이나 타이밍 창은 만들지 않는다.
(() => {
    'use strict';
    const url = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const files = { props: '레이드/lukim-birthday-props-v1.png', poses: '레이드/lukim-birthday-poses-v1.png', coding: '레이드/lukim-birthday-coding-v1.png', clap: '레이드/lukim-birthday-clap-v2.png', mist: '레이드/fx-dark-mist.png' };
    // 시트의 소품은 균등한 칸에 들어 있지 않다. 원본 픽셀 영역과 여백을 따로 등록한다.
    const props = [[12, 68, 570, 416], [716, 30, 116, 253], [1025, 101, 445, 234], [48, 549, 425, 422], [527, 537, 490, 429], [988, 639, 539, 242], [1380, 101, 91, 175]];
    const sounds = ['match', 'ignite', 'blow', 'clap', 'throw', 'cream', 'cork', 'drink', 'typing', 'shuffle', 'gift'];
    const images = new Map(), buffers = new Map();
    let audio, loading;
    const clamp = v => Math.max(0, Math.min(1, v));
    const ease = v => 1 - (1 - clamp(v)) ** 3;
    const rand = i => { const n = Math.sin(i * 73.39 + 5) * 9379; return n - Math.floor(n); };
    function picture(src) {
        if (!src) return null;
        if (!images.has(src)) {
            const image = new Image(); image.decoding = 'async'; image.src = src;
            image.decode().then(() => { image.ready = true; }, () => {});
            images.set(src, image);
        }
        const image = images.get(src);
        return image.ready ? image : null;
    }
    function unlock() {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        if (!audio) audio = new Context();
        audio.resume().catch(() => {});
        if (!loading) loading = Promise.all(sounds.map(async name => {
            try {
                const response = await fetch(url('sfx/birthday/' + name + '-v1.mp3'));
                if (response.ok) buffers.set(name, await audio.decodeAudioData(await response.arrayBuffer()));
            } catch (_) {}
        }));
    }
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    function preload() { for (const file of Object.values(files)) picture(url(file)); }

    function create() {
        const frame = document.getElementById('frame');
        const canvas = document.createElement('canvas'); canvas.className = 'pq-birthday-fx'; canvas.setAttribute('aria-hidden', 'true');
        frame.append(canvas);
        const g = canvas.getContext('2d');
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let view = null, options = {}, scope = '', raf = 0, seenLit = new Set(), localClock = 0;
        const events = new Map(), cards = new Map(), flips = new Map(), sources = new Set();
        const seenClaps = new Set(), applause = new Map();
        const hacked = document.createElement('canvas'), hg = hacked.getContext('2d');
        const red = document.createElement('canvas'), cyan = document.createElement('canvas');
        let hackFrame = -1;
        let stage = null, base = null, bossDrawing = null;
        function sound(name, gain = .5, loop = false) {
            if (!audio || audio.state !== 'running' || !buffers.has(name) || !(options.volume > 0)) return null;
            const source = audio.createBufferSource(), volume = audio.createGain();
            source.buffer = buffers.get(name); source.loop = loop;
            volume.gain.value = options.volume * gain; source.connect(volume); volume.connect(audio.destination); source.start();
            const entry = { source, volume, gain }; sources.add(entry);
            source.onended = () => { sources.delete(entry); source.disconnect(); volume.disconnect(); };
            return entry;
        }
        function stop(entry) { if (entry) { try { entry.source.stop(); } catch (_) {} sources.delete(entry); } }
        function rect(node) {
            if (!node || !base) return null;
            const r = node.getBoundingClientRect();
            return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
        }
        function member(name) { return [...document.querySelectorAll('#pqPlayMembers .pq-char-card')].find(n => n.dataset.member === name); }
        function portrait(name) { return rect(member(name)?.querySelector('.img')); }
        function sprite(index, x, y, w, h, rotation = 0, opacity = 1, crop = [0, 0, 1, 1]) {
            const image = picture(url(files.props)); if (!image) return;
            const [sx, sy, cw, ch] = props[index];
            g.save(); g.globalAlpha *= clamp(opacity); g.translate(x, y); g.rotate(rotation);
            g.drawImage(image, sx + crop[0] * cw, sy + crop[1] * ch, cw * crop[2], ch * crop[3], -w / 2, -h / 2, w, h);
            g.restore();
        }
        function bottle(src, x, y, size, rotation = 0, opacity = 1) {
            const image = picture(src); if (!image) return;
            g.save(); g.globalAlpha *= clamp(opacity); g.translate(x, y); g.rotate(rotation);
            g.drawImage(image, -size / 2, -size / 2, size, size); g.restore();
        }
        function light(x, y, radius, alpha, color = '255,198,98') {
            const grad = g.createRadialGradient(x, y, 0, x, y, radius);
            grad.addColorStop(0, 'rgba(' + color + ',' + clamp(alpha) + ')'); grad.addColorStop(1, 'rgba(' + color + ',0)');
            g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = grad; g.fillRect(x - radius, y - radius, radius * 2, radius * 2); g.restore();
        }
        function smoke(x, y, size, t, seed) {
            const image = picture(url(files.mist)); if (!image) return;
            g.save(); g.globalAlpha = .24 * (1 - clamp(t)); g.globalCompositeOperation = 'screen';
            g.translate(x + Math.sin(seed) * t * size * .3, y - t * size * .7); g.rotate(seed + t * .4);
            g.drawImage(image, -size * (.3 + t * .4), -size * (.3 + t * .4), size * (.6 + t * .8), size * (.6 + t * .8)); g.restore();
        }
        function mouth() {
            const r = rect(document.getElementById('pqBossIllustImg')) || stage;
            return { x: r.x + r.w * .52, y: r.y + r.h * .52 };
        }
        function pose(index) {
            const image = picture(url(index === 'coding' ? files.coding : files.poses)), img = document.getElementById('pqBossIllustImg');
            const r = rect(img); if (!image || !r) return;
            img.style.visibility = 'hidden';
            const aspect = image.naturalWidth / image.naturalHeight;
            const w = Math.min(r.w, r.h * aspect), h = w / aspect, x = r.x + (r.w - w) / 2, y = r.y + r.h - h;
            bossDrawing = { x, y, w, h };
            if (index === 'coding') g.drawImage(image, x, y, w, h);
            else {
                const cw = image.naturalWidth / 2, ch = image.naturalHeight / 2;
                g.drawImage(image, index % 2 * cw, Math.floor(index / 2) * ch, cw, ch, x, y, w, h);
            }
        }
        function cakeLayout() {
            const w = Math.min(stage.w * .44, stage.h * .50), h = w * props[0][3] / props[0][2];
            return { w, h, x: stage.x + stage.w / 2, y: stage.y + stage.h * .985 - h / 2 };
        }
        function candle(i) {
            const cake = cakeLayout(), h = cake.w * .19, u = (i - 2.5) / 2.5;
            const bottom = cake.y - cake.h / 2 + cake.h * (.18 + .035 * (1 - u * u));
            return { x: cake.x + (i - 2.5) * cake.w * .105, y: bottom - h / 2, h, w: h * props[1][2] / props[1][3], wick: bottom - h + h * .02 };
        }
        function flame(x, y, h, opacity = 1, rotation = 0) {
            sprite(6, x, y - h / 2 + 1, h * props[6][2] / props[6][3], h, rotation, opacity);
        }
        function cakeScene(now) {
            const cake = cakeLayout();
            sprite(0, cake.x, cake.y, cake.w, cake.h);
            const elapsed = view.elapsed + (options.paused ? 0 : Math.min(.4, (now - localClock) / 1000));
            const blow = [...events.values()].find(e => e.kind === 'birthdayBlow');
            for (let i = 0; i < 6; i++) {
                const c = candle(i);
                sprite(1, c.x, c.y, c.w, c.h);
                const lit = view.lit?.includes(i);
                const blown = blow && (now - blow.at) / 1000 > .32 + i * .08;
                if (lit && !blown) {
                    flame(c.x, c.wick, cake.w * .087 * (1 + Math.sin(now * .011 + i) * .035), 1, blow ? -.5 : 0);
                    light(c.x, c.wick, cake.w * .12, .09);
                }
                if (blown) smoke(c.x, c.wick, cake.w * .14, clamp((now - blow.at) / 1000 - .32 - i * .08), i);
            }
            if (view.stage === 'lighting') {
                const f = (elapsed - 3) / 3, i = Math.max(0, Math.min(5, Math.floor(f))), a = candle(i), b = candle(Math.min(5, i + 1));
                const head = candle(0).x + f * cake.w * .105, y = a.wick + (b.wick - a.wick) * clamp(f - i);
                const w = cake.w * .40, h = w * props[2][3] / props[2][2];
                g.save(); g.translate(head, y); g.rotate(-.12);
                sprite(2, -w * .389, -h * .348, w, h); g.restore();
                light(head, y, cake.w * .12, .12);
            }
        }
        function cream(r, t, seed) {
            if (!r) return;
            const age = clamp(t), alpha = Math.min(1, (1 - age) * 3);
            // 실제 크림 텍스처가 충돌 지점에 납작하게 퍼진 뒤 작은 덩어리만 중력으로 흘러내린다.
            sprite(3, r.x + r.w * .5, r.y + r.h * .4 + age * 12, r.w * (.25 + ease(age * 5) * .75), r.h * .24, -.12, alpha, [.2, .13, .38, .16]);
            if (reduced.matches) return;
            for (let i = 0; i < 8; i++) {
                const vx = (rand(i + seed) - .5) * r.w * 1.8, vy = -18 - rand(i + seed + 11) * 42;
                sprite(3, r.x + r.w / 2 + vx * age, r.y + r.h * .4 + vy * age + 110 * age * age, 7 + rand(i) * 8, 5 + rand(i + 1) * 5, age * 4, alpha, [.25, .14, .12, .08]);
            }
        }
        function drawApplause(now) {
            const image = picture(url(files.clap)); if (!image) return;
            for (const [name, clap] of applause) {
                const t = (now - clap.at) / 1000, r = portrait(name);
                if (t > 1.1) { applause.delete(name); continue; }
                if (!r) continue;
                const motion = Math.min(t, .9 - 1e-6), beat = Math.floor(motion / .30), u = motion % .30 / .30;
                const contact = reduced.matches || u >= .46 && u < .66;
                const close = u < .46 ? (u / .46) ** 2 : u < .66 ? 1 : 1 - ease((u - .66) / .34);
                if (contact && (reduced.matches ? clap.beat < 0 : clap.beat !== beat)) { clap.beat = beat; sound('clap', .32); }
                const size = Math.min(88, Math.max(56, r.h * .62)), gap = size * .12 * (1 - close), cw = image.naturalWidth / 3;
                const x = r.x + r.w / 2, y = r.y + r.h * .72, alpha = Math.min(1, t * 12, (1.1 - t) * 6);
                g.save(); g.beginPath(); g.rect(r.x, r.y + r.h * .40, r.w, r.h * .60); g.clip(); g.globalAlpha = clamp(alpha);
                if (contact) g.drawImage(image, cw * 2, 0, cw, image.naturalHeight, x - size / 2, y - size / 2, size, size);
                else for (let side = 0; side < 2; side++) {
                    g.save(); g.translate(x + (side ? 1 : -1) * (size * .18 + gap), y + size * .38);
                    g.rotate((side ? -1 : 1) * .35 * (1 - close));
                    g.drawImage(image, side * cw, 0, cw, image.naturalHeight, -size / 2, -size * .88, size, size); g.restore();
                }
                g.restore();
                if (reduced.matches && t >= .6) applause.delete(name);
            }
        }
        function hacking(e, now) {
            const t = Math.max(0, (now - e.at) / 1000), power = clamp(t / e.duration) ** 2;
            if (reduced.matches) return;
            const frameId = Math.floor(t * 10), background = document.querySelector('#pqPhaseStage .pq-stage-background');
            const image = picture(background?.src), r = rect(background);
            if (!image || !r) return;
            if (hackFrame !== frameId || hacked.width !== Math.round(stage.w) || hacked.height !== Math.round(stage.h)) {
                hackFrame = frameId; hacked.width = Math.round(stage.w); hacked.height = Math.round(stage.h);
                hg.drawImage(image, r.x - stage.x, r.y - stage.y, r.w, r.h);
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                hg.drawImage(canvas, stage.x * dpr, stage.y * dpr, stage.w * dpr, stage.h * dpr, 0, 0, hacked.width, hacked.height);
                for (const [layer, color] of [[red, '#ff0000'], [cyan, '#00ffff']]) {
                    layer.width = hacked.width; layer.height = hacked.height;
                    const ctx = layer.getContext('2d'); ctx.drawImage(hacked, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = color; ctx.fillRect(0, 0, layer.width, layer.height);
                }
            }
            g.save(); g.beginPath(); g.rect(stage.x, stage.y, stage.w, stage.h);
            if (bossDrawing) g.rect(bossDrawing.x + bossDrawing.w * .255, bossDrawing.y + bossDrawing.h * .243, bossDrawing.w * .463, bossDrawing.h * .30);
            for (const node of document.querySelectorAll('#pqBossStage .pq-stage-hud, #pqBossSpeech:not([hidden])')) {
                const box = rect(node); if (box) g.rect(box.x, box.y, box.w, box.h);
            }
            g.clip('evenodd');
            for (let i = 0; i < Math.floor(1 + power * 5); i++) {
                if (rand(frameId * 13 + i) > .2 + power * .6) continue;
                const y = stage.h * (.2 + rand(frameId * 5 + i + 7) * .56), h = 2 + rand(frameId + i + 11) * (2 + power * 7);
                const dx = (rand(frameId * 7 + i + 3) - .5) * stage.w * .045 * power, split = 1 + power * 2;
                g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
                g.drawImage(red, 0, y, hacked.width, h, stage.x + dx - split, stage.y + y, stage.w, h);
                g.globalCompositeOperation = 'lighten';
                g.drawImage(cyan, 0, y, hacked.width, h, stage.x + dx + split, stage.y + y, stage.w, h);
            }
            g.restore();
            for (const player of options.members || []) {
                const card = portrait(player.name), art = picture(player.card?.imageUrl);
                if (!card || !art || power < .25 || rand(frameId + player.name.length) > power * .65) continue;
                const y = card.h * (.58 + rand(frameId + 9) * .34), h = 2 + power * 3, shift = (rand(frameId + 3) - .5) * 8 * power;
                g.save(); g.beginPath(); g.rect(card.x, card.y, card.w, card.h); g.clip();
                g.drawImage(art, 0, y / card.h * art.naturalHeight, art.naturalWidth, h / card.h * art.naturalHeight, card.x + shift, card.y + y, card.w, h); g.restore();
            }
        }
        function openingCake(e, t) {
            const targets = (options.members || []).filter(p => (e.targets || []).includes(p.name)).map(p => portrait(p.name)).filter(Boolean);
            if (!targets.length) return;
            const cake = cakeLayout(), hand = { x: bossDrawing.x + bossDrawing.w * .18, y: bossDrawing.y + bossDrawing.h * .46 };
            const x = targets.reduce((sum, r) => sum + r.x + r.w / 2, 0) / targets.length;
            const y = targets.reduce((sum, r) => sum + r.y + r.h * .4, 0) / targets.length;
            const rowWidth = Math.max(...targets.map(r => r.x + r.w)) - Math.min(...targets.map(r => r.x));
            const lift = ease(t / .16), u = reduced.matches ? 1 : clamp((t - .16) / (e.impactDelay - .16));
            const from = { x: cake.x + (hand.x - cake.x) * lift, y: cake.y + (hand.y - cake.y) * lift };
            const scale = t < .16 ? 1 - .08 * lift : .92 + (Math.max(1, Math.min(1.15, rowWidth * .9 / cake.w)) - .92) * u;
            g.save(); g.translate(from.x + (x - from.x) * u, from.y + (y - from.y) * u - Math.sin(u * Math.PI) * stage.h * .10);
            g.rotate(reduced.matches ? 0 : -.1 * lift + .4 * u); g.scale(scale, scale);
            sprite(0, 0, 0, cake.w, cake.h);
            for (let i = 0; i < 6; i++) { const c = candle(i); sprite(1, c.x - cake.x, c.y - cake.y, c.w, c.h); }
            g.restore();
        }
        function drawEvent(e, now) {
            const t = Math.max(0, (now - e.at) / 1000), p = clamp(t / (e.duration || 1)), m = mouth();
            if (e.kind === 'birthdaySpark') {
                const c = candle(e.candle);
                flame(c.x, c.wick, cakeLayout().w * .087 * (.2 + ease(p) * .6), 1 - p);
            } else if (e.kind === 'birthdayThrow') {
                const boss = rect(document.getElementById('pqBossIllustImg')) || stage;
                const hand = { x: boss.x + boss.w * .18, y: boss.y + boss.h * .49 };
                if (e.opening && e.stage !== 'resolved') openingCake(e, t);
                for (const player of options.members || []) {
                    if (!(e.targets || []).includes(player.name)) continue;
                    const r = portrait(player.name); if (!r) continue;
                    if (e.stage !== 'resolved') {
                        if (e.opening) continue;
                        const u = reduced.matches ? 1 : clamp(t / e.impactDelay), target = { x: r.x + r.w / 2, y: r.y + r.h * .4 };
                        const size = 36 + u * 18;
                        sprite(3, hand.x + (target.x - hand.x) * u, hand.y + (target.y - hand.y) * u - Math.sin(u * Math.PI) * stage.h * .22,
                            size, size, reduced.matches ? 0 : u * 4);
                    } else cream(r, Math.max(0, (now - e.landedAt) / 850), player.name.length);
                }
            } else if (e.kind === 'birthdaySteal') {
                const r = portrait(e.target); if (r) { light(r.x + r.w / 2, r.y + r.h / 2, r.h * .75, .13); }
            } else if (e.kind === 'birthdayDrink') {
                const r = portrait(e.target), player = (options.members || []).find(v => v.name === e.target);
                const potion = player?.potions?.find(v => v.name === e.potion);
                if (r && t < .65) {
                    const u = ease(t / .65), x = r.x + r.w / 2;
                    bottle(potion?.iconUrl, x + (m.x - x) * u, r.y + (m.y - r.y) * u - Math.sin(u * Math.PI) * 60, 38 * (1 - .3 * u), -u * .8);
                }
            } else if (e.kind === 'birthdayFrenzy') {
                const fade = Math.min(1, t * 3, (e.duration - t) * 3);
                const grad = g.createRadialGradient(stage.x + stage.w / 2, stage.y + stage.h / 2, stage.h * .2, stage.x + stage.w / 2, stage.y + stage.h / 2, stage.w * .62);
                grad.addColorStop(0, 'rgba(40,0,4,0)'); grad.addColorStop(1, 'rgba(65,0,9,' + clamp(fade) * .62 + ')');
                g.fillStyle = grad; g.fillRect(stage.x, stage.y, stage.w, stage.h);
            } else if (e.kind === 'birthdayStrike') {
                const r = portrait(e.target); if (r) cream(r, p, e.amount);
            } else if (e.kind === 'birthdayGift') {
                const size = Math.min(stage.w * .42, stage.h * .48), panel = rect(document.getElementById('pqMansionRoot'));
                const cx = stage.x + stage.w / 2, overlap = panel && panel.x < cx + size / 2 && panel.x + panel.w > cx - size / 2;
                const cy = Math.min(stage.y + stage.h * .82, overlap ? panel.y - size * .14 - 8 : Infinity);
                sprite(5, cx, cy, size, size * .65);
                for (let i = 0; i < (e.gifts || []).length; i++) {
                    const gift = e.gifts[i], player = options.members?.find(v => v.name === gift.by), r = portrait(gift.by);
                    const potion = player?.potions?.find(v => v.name === gift.name), age = (now - (e.giftAt?.[gift.by] || e.at)) / 1000;
                    const u = reduced.matches ? 1 : ease(age / .55), toX = stage.x + stage.w / 2 + (i - ((options.members?.length || 1) - 1) / 2) * size * .16;
                    bottle(potion?.iconUrl, r ? r.x + r.w / 2 + (toX - r.x - r.w / 2) * u : toX,
                        r ? r.y + (cy - r.y) * u - Math.sin(u * Math.PI) * 55 : cy, 30, -.1 * (1 - u));
                }
            }
        }
        function drawFlips(now) {
            for (const [name, flip] of flips) {
                let t = (now - flip.at) / 450;
                const r = portrait(name), img = member(name)?.querySelector('.img>img'), next = picture(flip.to);
                if (!next) { flip.at = now; t = 0; }
                if (t >= 1 || reduced.matches) { if (img) img.style.visibility = ''; flips.delete(name); continue; }
                if (!r || !img) continue;
                img.style.visibility = 'hidden';
                const image = t < .5 ? picture(flip.from) : next; if (!image) { img.style.visibility = ''; continue; }
                g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2); g.scale(Math.max(.035, Math.abs(Math.cos(t * Math.PI))), 1);
                g.drawImage(image, -r.w / 2, -r.h / 2, r.w, r.h); g.restore();
            }
        }
        function draw(now) {
            raf = 0;
            if (!view || !g || document.hidden) return;
            base = frame.getBoundingClientRect(); stage = rect(document.querySelector('.pq-game-stagewrap'));
            if (!stage?.w || !stage.h) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(base.width * dpr), h = Math.round(base.height * dpr);
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, base.width, base.height);
            const boss = document.getElementById('pqBossIllustImg'); if (boss) boss.style.visibility = '';
            bossDrawing = rect(boss) || stage;
            // 보스 동작은 케이크와 촛불보다 뒤에서 그린다. 1관문에는 촛대 없는 대기 동작을 유지한다.
            if (!options.paused || view.candles) {
                const active = [...events.values()], coding = active.find(e => e.kind === 'birthdayCoding');
                const index = coding ? 'coding' : active.some(e => e.kind === 'birthdayBlow') ? 0 : active.some(e => e.kind === 'birthdayDrink') ? 3
                    : active.some(e => e.kind === 'birthdayThrow' && now - e.at < (e.opening ? e.duration : e.impactDelay + .3) * 1000) ? 1 : view.candles ? 2 : null;
                if (index != null) pose(index);
            }
            if (view.candles) cakeScene(now);
            let shake = 0;
            for (const [id, e] of events) {
                if (e.duration != null && now > e.at + (e.duration + (e.kind === 'birthdayThrow' ? .65 : 0)) * 1000) { stop(e.audio); events.delete(id); continue; }
                if (options.paused) continue;
                if (!e.cued) {
                    e.cued = true;
                    const cue = { birthdayCandles: 'match', birthdayBlow: 'blow', birthdayThrow: 'throw', birthdayStrike: 'cream', birthdaySteal: 'cork', birthdayDrink: 'drink', birthdayCoding: 'typing' }[e.kind];
                    if (cue && now - e.at < 500) e.audio = sound(cue, cue === 'typing' ? .3 : .55, cue === 'typing');
                }
                if (e.stage === 'resolved' && !e.impactCued) { e.impactCued = true; if (now - e.landedAt < 500) sound('cream', .52); }
                drawEvent(e, now);
                if (e.kind === 'birthdayStrike') shake = Math.max(shake, 2 + Math.log10(e.amount + 1) * 1.2);
                else if (e.kind === 'birthdayFrenzy') shake = Math.max(shake, 1.6);
            }
            const coding = [...events.values()].find(e => e.kind === 'birthdayCoding');
            if (coding && !options.paused) hacking(coding, now);
            const wrap = document.querySelector('.pq-game-stagewrap');
            if (wrap) wrap.style.translate = !reduced.matches && shake ? Math.sin(now * .069) * shake + 'px ' + Math.cos(now * .047) * shake * .6 + 'px' : '';
            drawFlips(now);
            drawApplause(now);
            raf = requestAnimationFrame(draw);
        }
        function reset() {
            if (raf) cancelAnimationFrame(raf); raf = 0; view = null; events.clear(); cards.clear(); flips.clear(); seenLit.clear(); seenClaps.clear(); applause.clear(); hackFrame = -1;
            for (const e of sources) stop(e);
            g?.clearRect(0, 0, canvas.width, canvas.height); canvas.hidden = true;
            const wrap = document.querySelector('.pq-game-stagewrap'); if (wrap) wrap.style.translate = '';
            const boss = document.getElementById('pqBossIllustImg'); if (boss) boss.style.visibility = '';
            document.querySelectorAll('#pqPlayMembers .img>img').forEach(img => { img.style.visibility = ''; });
        }
        function update(next, context) {
            if (!next?.birthday) { if (view) reset(); return; }
            if (scope !== context.scope) { reset(); scope = context.scope; }
            const hadView = !!view, wasPaused = !!options.paused;
            options = context; view = next; localClock = performance.now(); canvas.hidden = false;
            preload();
            for (const index of next.lit || []) {
                if (!seenLit.has(index)) { if (hadView) sound('ignite', .55); seenLit.add(index); }
            }
            const incoming = new Set();
            for (const ev of next.events || []) {
                incoming.add(ev.id);
                if (!events.has(ev.id)) {
                    const age = ev.startedAt ? Math.max(0, Date.now() - ev.startedAt - (context.serverOffset || 0)) : Math.max(0, (ev.duration || 0) - (ev.remain || 0)) * 1000;
                    const e = { ...ev, at: performance.now() - age, giftAt: {} }; events.set(ev.id, e);
                }
                const e = events.get(ev.id);
                if (wasPaused && !context.paused) { e.at = performance.now() - Math.max(0, (ev.duration || 0) - (ev.remain || 0)) * 1000; e.cued = false; }
                if (ev.kind === 'birthdayClap' || ev.kind === 'birthdayCelebrate') for (const name of ev.responded || []) {
                    if (!seenClaps.has(name)) { seenClaps.add(name); if (hadView) applause.set(name, { at: performance.now(), beat: -1 }); }
                }
                if (ev.stage === 'resolved' && !e.landedAt) e.landedAt = performance.now() - Math.max(0, Date.now() - ev.impactAt - (context.serverOffset || 0));
                for (const gift of ev.gifts || []) if (!e.giftAt[gift.by]) { e.giftAt[gift.by] = performance.now(); sound('gift', .48); }
                Object.assign(e, ev);
            }
            for (const [id, e] of events) if (!incoming.has(id) && !['birthdayThrow', 'birthdayStrike'].includes(e.kind)) { stop(e.audio); events.delete(id); }
            let changed = false;
            for (const player of context.members || []) {
                const src = player.card?.imageUrl; if (!src) continue;
                picture(src); (player.potions || []).forEach(p => picture(p.iconUrl));
                const previous = cards.get(player.name);
                if (previous && (previous.src !== src || previous.revision !== player.card.revision)) { flips.set(player.name, { from: previous.src, to: src, at: performance.now() }); changed = true; }
                cards.set(player.name, { src, revision: player.card.revision });
            }
            if (changed) sound('shuffle', .4);
            if (!raf) raf = requestAnimationFrame(draw);
        }
        function setVolume(volume) { options.volume = volume; for (const e of sources) e.volume.gain.setTargetAtTime(volume * e.gain, audio.currentTime, .04); }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { for (const e of sources) stop(e); }
            else if (view && !raf) raf = requestAnimationFrame(draw);
        });
        return { update, reset, setVolume, visualOnly: ev => !!g && ev.kind.startsWith('birthday') && !['birthdayClap', 'birthdayGift'].includes(ev.kind) };
    }
    window.BirthdayRaidFX = { create, preload };
})();
