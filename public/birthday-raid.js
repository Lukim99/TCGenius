// Opus 5.5의 생일 소품 동선. 서버 사건을 재생하며 판정이나 타이밍 창은 만들지 않는다.
(() => {
    'use strict';
    const url = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const files = { props: '레이드/lukim-birthday-props-v1.png', poses: '레이드/lukim-birthday-poses-v1.png', coding: '레이드/lukim-birthday-coding-v1.png', mist: '레이드/fx-dark-mist.png' };
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

    function create() {
        const frame = document.getElementById('frame');
        const canvas = document.createElement('canvas'); canvas.className = 'pq-birthday-fx'; canvas.setAttribute('aria-hidden', 'true');
        frame.append(canvas);
        const g = canvas.getContext('2d');
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let view = null, options = {}, scope = '', raf = 0, seenLit = new Set(), localClock = 0;
        const events = new Map(), cards = new Map(), flips = new Map(), sources = new Set();
        let stage = null, base = null;
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
            const cw = image.naturalWidth / 3, ch = image.naturalHeight / 2;
            g.save(); g.globalAlpha *= clamp(opacity); g.translate(x, y); g.rotate(rotation);
            g.drawImage(image, (index % 3 + crop[0]) * cw, (Math.floor(index / 3) + crop[1]) * ch, cw * crop[2], ch * crop[3], -w / 2, -h / 2, w, h);
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
            const image = picture(url(index === 2 ? files.coding : files.poses)), img = document.getElementById('pqBossIllustImg');
            const r = rect(img); if (!image || !r) return;
            img.style.visibility = 'hidden';
            if (index === 2) g.drawImage(image, r.x, r.y, r.w, r.h);
            else {
                const cw = image.naturalWidth / 2, ch = image.naturalHeight / 2;
                g.drawImage(image, index % 2 * cw, Math.floor(index / 2) * ch, cw, ch, r.x, r.y, r.w, r.h);
            }
        }
        function cakeScene(now) {
            const size = Math.min(stage.w * .48, stage.h * .6), cx = stage.x + stage.w * .5, cy = stage.y + stage.h * .76;
            sprite(0, cx, cy, size, size);
            const elapsed = view.elapsed + (options.paused ? 0 : Math.min(.4, (now - localClock) / 1000));
            for (let i = 0; i < 6; i++) {
                const x = cx + (i - 2.5) * size * .106, h = size * .255, bottom = cy - size * .225 + Math.abs(i - 2.5) * size * .011;
                sprite(1, x, bottom - h * .42, h, h);
                const lit = view.lit?.includes(i), blow = [...events.values()].find(e => e.kind === 'birthdayBlow');
                const blown = blow && (now - blow.at) / 1000 > .32 + i * .08;
                if (lit && !blown) {
                    sprite(2, x, bottom - h * .94, h * .19, h * .42 * (1 + Math.sin(now * .011 + i) * .035), 0, 1, [.73, .12, .20, .44]);
                    light(x, bottom - h * .82, size * .17, .15);
                }
                if (blown) smoke(x, bottom - h * .88, size * .14, clamp((now - blow.at) / 1000 - .32 - i * .08), i);
            }
            if (view.stage === 'lighting') {
                const head = cx + (-2.5 + (elapsed - 3) / 3) * size * .106;
                const y = cy - size * .43;
                sprite(2, head - size * .14, y + size * .04, size * .42, size * .42);
                light(head, y, size * .14, .18);
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
        function confetti(t) {
            if (reduced.matches) return;
            for (let i = 0; i < 36; i++) {
                const age = clamp(t), x = stage.x + stage.w * (.2 + rand(i) * .6) + (rand(i + 6) - .5) * age * 180;
                const y = stage.y + stage.h * .4 - Math.sin(age * Math.PI) * stage.h * .35 + age * stage.h * .5;
                sprite(0, x, y, 5 + rand(i) * 5, 9, age * 6 + i, 1 - age, [.09, .68, .10, .10]);
            }
        }
        function drawEvent(e, now) {
            const t = Math.max(0, (now - e.at) / 1000), p = clamp(t / (e.duration || 1)), m = mouth();
            if (e.kind === 'birthdaySpark') {
                const size = Math.min(stage.w * .48, stage.h * .6), x = stage.x + stage.w * .5 + (e.candle - 2.5) * size * .106;
                const y = stage.y + stage.h * .76 - size * .43;
                light(x, y, size * .13, .25 * Math.sin(p * Math.PI));
                sprite(2, x, y - size * .02, size * .07, size * .12, -.1 + p * .2, 1 - p, [.73, .12, .20, .44]);
            } else if (e.kind === 'birthdayBlow') { pose(0); light(m.x, m.y, stage.h * .2, .07); }
            else if (e.kind === 'birthdayThrow') {
                if (t < .25) pose(1);
                const boss = rect(document.getElementById('pqBossIllustImg')) || stage;
                const hand = { x: boss.x + boss.w * .18, y: boss.y + boss.h * .49 };
                for (const player of options.members || []) {
                    const r = portrait(player.name); if (!r) continue;
                    if (t < .42) {
                        const u = reduced.matches ? 1 : clamp(t / .42), target = { x: r.x + r.w / 2, y: r.y + r.h * .4 };
                        sprite(3, hand.x + (target.x - hand.x) * u, hand.y + (target.y - hand.y) * u - Math.sin(u * Math.PI) * stage.h * .3,
                            36 + u * 18, 36 + u * 18, reduced.matches ? 0 : u * 4);
                    } else cream(r, (t - .42) / .85, player.name.length);
                }
            } else if (e.kind === 'birthdaySteal') {
                const r = portrait(e.target); if (r) { light(r.x + r.w / 2, r.y + r.h / 2, r.h * .75, .13); }
            } else if (e.kind === 'birthdayDrink') {
                pose(3);
                const r = portrait(e.target), player = (options.members || []).find(v => v.name === e.target);
                const potion = player?.potions?.find(v => v.name === e.potion);
                if (r && t < .65) {
                    const u = ease(t / .65), x = r.x + r.w / 2;
                    bottle(potion?.iconUrl, x + (m.x - x) * u, r.y + (m.y - r.y) * u - Math.sin(u * Math.PI) * 60, 38 * (1 - .3 * u), -u * .8);
                }
            } else if (e.kind === 'birthdayCoding') {
                pose(2);
                light(m.x, m.y, stage.h * .3, .08 + Math.sin(t * 18) * .015, '255,178,78');
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
            } else if (e.kind === 'birthdayCelebrate') confetti(p);
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
            if (view.candles && !options.paused) cakeScene(now);
            let shake = 0;
            for (const [id, e] of events) {
                if (e.duration != null && now > e.at + (e.duration + (e.kind === 'birthdayThrow' ? .65 : 0)) * 1000) { stop(e.audio); events.delete(id); continue; }
                if (options.paused) continue;
                if (!e.cued) {
                    e.cued = true;
                    const cue = { birthdayCandles: 'match', birthdayBlow: 'blow', birthdayThrow: 'throw', birthdayStrike: 'cream', birthdaySteal: 'cork', birthdayDrink: 'drink', birthdayCoding: 'typing', birthdayShuffle: 'shuffle', birthdayCelebrate: 'clap' }[e.kind];
                    if (cue && now - e.at < 500) e.audio = sound(cue, cue === 'typing' ? .3 : .55, cue === 'typing');
                }
                if (e.impactAt && now >= e.impactAt) { e.impactAt = 0; sound('cream', .52); }
                drawEvent(e, now);
                if (e.kind === 'birthdayStrike') shake = Math.max(shake, 2 + Math.log10(e.amount + 1) * 1.2);
                else if (e.kind === 'birthdayFrenzy') shake = Math.max(shake, 1.6);
            }
            const wrap = document.querySelector('.pq-game-stagewrap');
            if (wrap) wrap.style.translate = !reduced.matches && shake ? Math.sin(now * .069) * shake + 'px ' + Math.cos(now * .047) * shake * .6 + 'px' : '';
            drawFlips(now);
            raf = requestAnimationFrame(draw);
        }
        function reset() {
            if (raf) cancelAnimationFrame(raf); raf = 0; view = null; events.clear(); cards.clear(); flips.clear(); seenLit.clear();
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
            for (const file of Object.values(files)) picture(url(file));
            for (const index of next.lit || []) {
                if (!seenLit.has(index)) { if (hadView) sound('ignite', .55); seenLit.add(index); }
            }
            const incoming = new Set();
            for (const ev of next.events || []) {
                incoming.add(ev.id);
                if (!events.has(ev.id)) {
                    const at = performance.now() - Math.max(0, (ev.duration || 0) - (ev.remain || 0)) * 1000;
                    const e = { ...ev, at, giftAt: {}, clapped: new Set() }; events.set(ev.id, e);
                    if (ev.kind === 'birthdayThrow') e.impactAt = at + 420;
                }
                const e = events.get(ev.id);
                if (wasPaused && !context.paused) { e.at = performance.now() - Math.max(0, (ev.duration || 0) - (ev.remain || 0)) * 1000; e.cued = false; if (ev.kind === 'birthdayThrow') e.impactAt = e.at + 420; }
                if (ev.kind === 'birthdayClap') for (const name of ev.responded || []) {
                    if (!e.clapped.has(name)) { e.clapped.add(name); if (hadView) sound('clap', .38); }
                }
                for (const gift of ev.gifts || []) if (!e.giftAt[gift.by]) { e.giftAt[gift.by] = performance.now(); sound('gift', .48); }
                Object.assign(e, ev);
            }
            for (const [id, e] of events) if (!incoming.has(id) && !['birthdayThrow', 'birthdayStrike'].includes(e.kind)) { stop(e.audio); events.delete(id); }
            for (const player of context.members || []) {
                const src = player.card?.imageUrl; if (!src) continue;
                picture(src); (player.potions || []).forEach(p => picture(p.iconUrl));
                if (cards.has(player.name) && cards.get(player.name) !== src) { flips.set(player.name, { from: cards.get(player.name), to: src, at: performance.now() }); sound('shuffle', .25); }
                cards.set(player.name, src);
            }
            if (!raf) raf = requestAnimationFrame(draw);
        }
        function setVolume(volume) { options.volume = volume; for (const e of sources) e.volume.gain.setTargetAtTime(volume * e.gain, audio.currentTime, .04); }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { for (const e of sources) stop(e); }
            else if (view && !raf) raf = requestAnimationFrame(draw);
        });
        return { update, reset, setVolume, visualOnly: ev => !!g && ev.kind.startsWith('birthday') && !['birthdayClap', 'birthdayGift'].includes(ev.kind) };
    }
    window.BirthdayRaidFX = { create };
})();
