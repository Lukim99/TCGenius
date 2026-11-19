// 증강 연출 무대. 실제 public/hfield.js를 천상(내장) 방식으로 돌리고, 실험실(부모 창)이 만든 사건과 지속 상태를 넣는다.
// 바탕(내 캐릭터, 스킬, 회랑의 적)은 실험실 서버가 메모리 DB의 실제 천상 전투에서 찍어 둔 화면(/lab/api/scene)이다.
(function () {
    const battle = window.ParadiseBattle, CE = window.CombatEffects;
    const BACKGROUND = '/static/assets/paradise/corridor.webp';
    const errors = [];
    const note = (...args) => errors.push(args.map(value => value && value.stack ? value.stack : String(value)).join(' '));
    const error = console.error, warn = console.warn;
    console.error = (...args) => { note(...args); error.apply(console, args); };
    console.warn = (...args) => { note(...args); warn.apply(console, args); };
    window.addEventListener('error', event => note(event.message));
    window.addEventListener('unhandledrejection', event => note(event.reason));

    let scene = null, model = null, seq = 1, enemies = 1, runKey = 'lab-1', regions = [], current = null;
    const fx = () => window.__fx || null;
    // 적 체력은 내 공격력의 44배쯤(2마리 전투의 한 마리): 피해 숫자와 체력 막대가 실제 비율로 보인다.
    const atk = () => Math.max(1, Number(scene.battle.player && scene.battle.player.atk) || 235);
    function enemyHp() { const maxHp = Math.round(atk() * 44); return { maxHp, hp: Math.round(maxHp * .96) }; }
    function baseModel() {
        const player = scene.battle.player || {};
        return {
            player: { hp: Math.round((player.maxHp || 90000) * .82), maxHp: player.maxHp || 90000, mp: Math.round((player.maxMp || 5000) * .9), maxMp: player.maxMp || 5000, shield: 0 },
            target: Object.assign({ id: 'lab-enemy-1', wave: { index: 1, total: 2 } }, enemyHp()),
            skills: (scene.battle.skills || []).map(skill => ({ ...skill, cooldownEnd: 0 })),
            auras: [], log: []
        };
    }
    function state() {
        const enemy = scene.enemy || {}, sprite = enemy.sprite;
        return {
            ...scene.battle,
            serverNow: Date.now(), inField: true, phase: 'elite', nextActionAt: 0, combatLog: model.log, paradiseRelics: false,
            player: { ...scene.battle.player, ...model.player },
            // 지속 상태 배열은 바뀔 때만 새 배열이 된다(연출 엔진이 같은 배열이면 다시 맞추지 않는다).
            skills: model.skills, augmentAuras: model.auras,
            target: { ...enemy, ...model.target },
            activeField: { backgroundUrl: BACKGROUND, monster: typeof sprite === 'string' ? { spriteUrl: sprite } : sprite || {} }
        };
    }
    // 사건에 번호, 시각, 대상을 붙이고 체력을 반영한 뒤 hfield에 넘긴다. 돌려주는 값은 hfield가 잡은 연출 길이(ms)다.
    function push(events) {
        const list = (events || []).map(partial => {
            const event = { id: 'lab-' + seq++, at: Date.now(), enemyId: model.target.id, hits: [], receivedHits: [], damage: 0, received: 0, ...partial };
            if (!event.actor || event.actor === 'player') {
                const dealt = Number(event.damage || 0);
                if (dealt > 0 && event.targetHp == null) model.target.hp = Math.max(event.cleared ? 0 : 1, model.target.hp - dealt);
                if (event.cleared) model.target.hp = 0;
                event.targetHp = model.target.hp;
            }
            if (Number(event.received || 0) > 0 && model.player.hp > 0) model.player.hp = Math.max(1, model.player.hp - Number(event.received));
            return CE ? CE.annotateEvent(event) : event;
        });
        current = state();
        return battle.update(current, list, runKey) || 0;
    }
    function frame(time) {
        if (model) {
            current = state();
            battle.update(current, [], runKey, true);
            regions = battle.draw(time, false) || [];
        }
        requestAnimationFrame(frame);
    }
    // 무대 HUD(공격, 스킬 단추)를 누르면 실험실에 알린다.
    document.addEventListener('pointerdown', event => {
        const hit = regions.find(r => event.clientX >= r.x && event.clientX <= r.x + r.w && event.clientY >= r.y && event.clientY <= r.y + r.h);
        if (hit && typeof hit.action === 'function') hit.action();
    });
    battle.onAction = (kind, body) => { try { if (parent.AugLab) parent.AugLab.stageAction(kind, body || {}); } catch (_) {} };
    document.addEventListener('keydown', event => { battle.key(event); });

    const scenesOf = id => (CombatFX.augments.scenes || []).filter(scene => scene === 'augment:' + id || scene.startsWith('augment:' + id + '.'));
    const AugStage = {
        errors,
        get scene() { return scene; },
        get model() { return model; },
        get fx() { return fx(); },
        ready: fetch('/lab/api/scene').then(response => response.json()).then(data => {
            scene = data; model = baseModel();
            push([]); push([]);
            requestAnimationFrame(frame);
            return AugStage;
        }),
        push,
        // 무대를 처음 상태로: 새 적(연출 정리), 체력과 지속 상태 초기화.
        reset(options) {
            // 지속 상태 연출을 먼저 거두고(빈 목록이면 엔진이 손잡이를 정리한다) 남은 장면을 지운다.
            model.auras = []; push([]);
            if (fx() && fx().clear) fx().clear();
            runKey = 'lab-' + (++enemies);
            model = baseModel();
            if (options && options.skills) model.skills = options.skills;
            model.target.id = 'lab-enemy-' + enemies;
            battle.reset();
            push([]); push([]);
        },
        // 같은 전투의 다음 적(2마리 전투의 둘째). 소환수와 지속 상태는 실험실이 정한 대로 남는다.
        nextEnemy(patch) {
            model.target = { ...model.target, id: 'lab-enemy-' + (++enemies), ...enemyHp(), wave: { index: 2, total: 2 }, ...(patch || {}) };
            push([]);
        },
        set(patch) {
            if (!patch) return;
            if (patch.player) Object.assign(model.player, patch.player);
            if (patch.target) Object.assign(model.target, patch.target);
            if (patch.skills) model.skills = patch.skills;
            if (patch.auras) model.auras = patch.auras;
            if (patch.log) model.log = patch.log;
            push([]);
        },
        scenesOf,
        // 증강 장면들이 미리 받는 소리 이름(장면 정의의 sounds).
        soundsOf(id, extraScenes) {
            const names = new Set();
            scenesOf(id).concat(extraScenes || []).forEach(sceneId => { const def = CombatFX.resolve(sceneId); (def && def.sounds || []).forEach(name => names.add(name)); });
            return [...names];
        },
        preload(ids, sounds) { if (fx()) fx().preload(ids || [], sounds || []); },
        unlock() { if (fx()) fx().unlock(); },
        // 소리 하나를 바로 낸다. 아직 받는 중이면 받는 대로 낸다.
        sound(name, options) {
            const engine = fx(); if (!engine) return;
            engine.unlock();
            const entry = engine.loadSound(name), started = performance.now();
            (function tryPlay() {
                if (entry.buffer) return engine.sound(name, Object.assign({ cool: 0, vary: 0 }, options));
                if (!entry.failed && performance.now() - started < 2500) setTimeout(tryPlay, 40);
            })();
        },
        // 받아 둔 소리가 다 준비될 때까지(최대 ms) 기다린다.
        soundsReady(names, ms) {
            const engine = fx(); if (!engine) return Promise.resolve();
            const entries = (names || []).map(name => engine.loadSound(name)), started = performance.now();
            return new Promise(resolve => (function poll() {
                if (entries.every(entry => entry.buffer || entry.failed) || performance.now() - started > (ms || 1200)) return resolve();
                setTimeout(poll, 40);
            })());
        },
        // 검수용: 지금 화면(무대, 연출, HUD)을 한 장으로 합쳐 PNG data URL로 돌려준다.
        snapshot(scale) {
            const layers = [document.getElementById('hfCanvas'), document.querySelector('.cfx-canvas'), document.getElementById('hfHud')].filter(layer => layer && layer.width);
            const base = layers[0], k = Math.min(scale || 1, 1600 / base.width), out = document.createElement('canvas');
            out.width = Math.round(base.width * k); out.height = Math.round(base.height * k);
            const g = out.getContext('2d');
            layers.forEach(layer => g.drawImage(layer, 0, 0, out.width, out.height));
            return out.toDataURL('image/png');
        }
    };
    window.AugStage = AugStage;
})();
