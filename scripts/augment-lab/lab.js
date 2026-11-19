// 증강 연출 실험실(부모 창). 왼쪽 목록에서 증강을 고르면 가운데 무대(stage.html)에서 그 증강의 연출을 보여 주고,
// 오른쪽에 설명, 정한 해석, 장면 단추, 지속 상태 조절, 효과음을 둔다. '실전'은 메모리 DB로 돈 실제 천상 화면(/paradise)이다.
// 증강마다의 연출 흐름은 demos/*.js가 AugLab.define(id, spec)으로 등록한다. spec의 모양은 아래 define 위의 설명을 본다.
(function () {
    const CATEGORY = { critical: '치명타', risk: '위험', basic: '기본 공격', dot: '지속 피해', skill: '스킬', defense: '방어', combo: '연격', shield: '보호막' };
    const query = new URLSearchParams(location.search);
    const demos = new Map(), parentErrors = [];
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const STOP = { stopped: true };
    const store = { get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} } };
    window.addEventListener('error', event => parentErrors.push(String(event.message)));
    window.addEventListener('unhandledrejection', event => { if (event.reason !== STOP) parentErrors.push(String(event.reason && event.reason.stack || event.reason)); });
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            if (value == null || value === false) continue;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? '' : value);
        }
        children.flat().forEach(child => { if (child != null && child !== false) node.append(child.nodeType ? child : String(child)); });
        return node;
    }
    const $ = id => document.getElementById(id);

    let catalog = null, stage = null, selected = null, mode = query.get('mode') === 'live' ? 'live' : 'gallery', size = query.get('size') === 'mobile' ? 'mobile' : 'desktop';
    let running = null, touring = null, filter = 'all', liveOwned = [], liveLoaded = false, captionTimer = 0, step = 0;
    let volume = clamp(Number(store.get('augment-lab-volume') ?? .7), 0, 1), muted = store.get('augment-lab-muted') === '1';

    // ---------- 무대(stage.html)와 소리 ----------
    const AugLab = window.AugLab = {
        get volume() { return muted ? 0 : volume; },
        get muted() { return muted; },
        // 무대의 hfield가 내는 타격음(낙원의 ParadiseAudio.playUrl 자리).
        playUrl(url, level) {
            if (muted || !url) return;
            const sound = new Audio(url); sound.volume = clamp((level == null ? .5 : level) * volume, 0, 1);
            sound.play().catch(() => {});
        },
        // 무대 HUD의 공격과 스킬 단추: 증강 없이 평범한 공격을 보여 준다.
        stageAction(kind, body) {
            if (!stage || mode !== 'gallery') return;
            stopTour();
            const L = makeL(selected, token());
            if (kind === 'attack') L.attack(); else if (kind === 'skill') L.skill(body.skillName);
        },
        /* spec(모두 선택):
         *   aura: {...}            처음 지속 상태(state.augmentAuras의 이 증강 항목, id 제외). 지속 상태가 없으면 생략
         *   auras: { id: {...} }   함께 보여 줄 다른 증강의 지속 상태
         *   skills: ['운명']        무대 스킬 단추에 더할 증강 스킬
         *   setup: L => {}          처음 상태를 더 만질 때(체력 등)
         *   demo: async L => {}     흐름 재생. 실제 전투 순서대로, await L.wait(초)로 간격
         *   signals: [{ label, run: L => {} }]   장면 단추(즉시 한 번)
         *   controls: [{ key, label, type: 'range'|'toggle'|'choice'|'window', min, max, step, options: [{ label, value }], ms }]
         *   notes: ['...']          원문에서 정해지지 않아 정한 해석과 규칙
         *   live: '...'             실전에서 발동시키는 법
         */
        define(id, spec) { demos.set(id, spec); },
        start,
        ready: null,
        // 검수용(check.js): 지금 고른 증강의 흐름을 재생하고 끝나면 풀린다.
        playDemo: () => playDemo(),
        runSignal: index => runSignal(((demos.get(selected) || {}).signals || [])[index] || { run() {} }),
        signals: () => ((demos.get(selected) || {}).signals || []).map(signal => signal.label),
        // 고른 증강의 효과음이 받아졌는지(ok)와 실패했는지.
        soundStatus: () => stage.soundsOf(selected, skillScenes(selected)).map(name => { const entry = stage.fx.loadSound(name); return { name, ok: !!entry.buffer, failed: !!entry.failed }; }),
        defined: () => [...demos.keys()],
        select: id => select(id),
        capture: scale => stage ? stage.snapshot(scale) : null,
        errors: () => parentErrors.concat(stage ? stage.errors : []),
        clearErrors() { parentErrors.length = 0; if (stage) stage.errors.length = 0; },
        get selected() { return selected; },
        get captions() { return captionLog.slice(); }
    };
    const captionLog = [];

    function stageWindow() { return $('stage').contentWindow; }
    function unlockAudio() { if (stage) stage.unlock(); }
    document.addEventListener('pointerdown', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);

    // ---------- 연출을 만드는 도구(L) ----------
    const token = () => { if (running) running.stopped = true; running = { stopped: false }; return running; };
    function stopDemo() { if (running) running.stopped = true; running = null; }
    const rand = (min, max) => Math.round(min + Math.random() * (max - min));
    const cueIds = list => (list || []).map(name => String(name).startsWith('augment:') ? String(name) : 'augment:' + name);
    function hitList(o, base) {
        const n = Array.isArray(o.hits) ? o.hits.length : Math.max(0, o.hits == null ? 1 : o.hits), crits = o.crit === true ? 1 : Number(o.crit || 0);
        return Array.from({ length: n }, (_, i) => {
            const critical = i < crits, damage = Array.isArray(o.hits) ? o.hits[i] : Math.round(rand(base * .85, base * 1.2) * (critical ? 1.9 : 1));
            return Object.assign({ damage, critical }, !o.skill && i > 0 ? { isComboHit: true } : {}, o.label ? { label: o.label } : {});
        });
    }
    const sum = hits => hits.reduce((total, hit) => total + Number(hit.damage || 0), 0);
    function setAura(id, patch) {
        const list = stage.model.auras, index = list.findIndex(entry => entry.id === id);
        let next;
        if (patch === null) next = list.filter(entry => entry.id !== id);
        else { const entry = Object.assign({}, index >= 0 ? list[index] : {}, patch, { id }); next = list.slice(); if (index >= 0) next[index] = entry; else next.push(entry); }
        stage.set({ auras: next });
    }
    function baseSkills() { return (stage.scene.battle.skills || []).map(skill => Object.assign({}, skill, { cooldownEnd: 0 })); }
    // 증강이 준 스킬의 연출 장면 이름(skill:운명 등). 장면 목록과 효과음 목록에 쓴다.
    const skillScenes = id => ((demos.get(id) || {}).skills || []).map(item => 'skill:' + (typeof item === 'string' ? item : item.name));
    // 증강 스킬 단추: paradise_prism.skillView와 같은 모양. item은 이름이나 { name, disabledReason, cooldownEnd }.
    function skillEntry(item) {
        const o = typeof item === 'string' ? { name: item } : item, info = (catalog.skills || []).find(skill => skill.name === o.name) || {};
        const owner = catalog.augments.find(a => a.skill === o.name), desc = owner ? owner.lines.find(line => line.includes(o.name)) || owner.lines.join(' ') : '';
        return Object.assign({ name: o.name, element: null, hpCost: 0, mpCost: info.mp || 0, resourceLabel: 'MP', cooldownEnd: 0, cooltimeText: info.cooldown ? info.cooldown / 1000 + '초' : '없음', descLines: desc ? [desc] : [], augmentSkill: true }, o);
    }
    function makeL(id, run) {
        const S = stage, mainSkill = () => (S.scene.battle.skills || [])[0]?.name || '스킬';
        // 피해 숫자는 실험자 캐릭터의 실제 공격력과 체력에 맞춘다.
        const ATK = Math.max(1, Number(S.scene.battle.player.atk) || 235), maxHp = () => Number(S.model.player.maxHp) || 2400;
        const L = {
            id,
            // 일반 공격. hits: 타수 또는 피해 배열, crit: true(첫 타) 또는 치명타 타수, cues: 증강 신호, extraHits: 고정 피해 같은 덧붙는 타격, extra: 사건에 더할 값
            attack(o = {}) {
                const hits = hitList(o, o.base || ATK).concat(o.extraHits || []);
                return S.push([Object.assign({ action: o.skill ? 'skill' : 'basic', skillName: o.skill || undefined, hits, damage: sum(hits), criticalCount: hits.filter(hit => hit.critical).length, triggeredEffectIds: cueIds(o.cues) }, o.extra || {})]);
            },
            // 스킬. name을 비우면 내 캐릭터의 첫 스킬. hits: 0이면 피해 없는 스킬(변속, 간파)
            skill(name, o = {}) { return L.attack(Object.assign({ base: Math.round(ATK * 1.8) }, o, { skill: name || mainSkill() })); },
            // 지속 피해와 소환수의 틱. dot: 지속 피해면 true
            tick(label, o = {}) {
                const damage = o.damage || Math.round(rand(ATK * .4, ATK * .7) * (o.crit ? 2 : 1));
                return S.push([Object.assign({ action: 'tick', dot: !!o.dot, skillName: label, source: label, hits: [{ damage, label, critical: !!o.crit }], damage, criticalCount: o.crit ? 1 : 0, triggeredEffectIds: cueIds(o.cues) }, o.extra || {})]);
            },
            // 적의 공격. damage: 0이면 피해 없음(막음, 무효), crit, counter(맞공격), reflected: [{ damage, label }], avoided(회피)
            enemy(o = {}) {
                const damage = o.damage != null ? o.damage : Math.round(rand(maxHp() * .08, maxHp() * .14) * (o.crit ? 2 : 1));
                const receivedHits = o.avoided ? [{ damage: 0, avoided: true }] : damage > 0 ? [{ damage, critical: !!o.crit }] : [];
                return S.push([Object.assign({ actor: 'enemy', action: 'basic', receivedHits, received: o.avoided ? 0 : damage, hits: [], damage: 0, triggeredEffectIds: cueIds(o.cues) }, o.counter ? { counter: true } : {}, o.reflected ? { reflectedHits: o.reflected } : {}, o.extra || {})]);
            },
            // 공격 없는 순간의 증강 신호(전투 시작 등). target: 'target'(적 쪽) 또는 'actor'(내 쪽)
            cue(cues, target, extra) { return S.push([Object.assign({ action: 'augment', effectTarget: target || 'target', hits: [], damage: 0, triggeredEffectIds: cueIds(cues) }, extra || {})]); },
            // 마지막 일격. wave가 false가 아니면 2마리 전투의 첫 적 처치(다음 적 등장)
            async kill(o = {}) {
                const extra = Object.assign({ cleared: true }, o.wave === false ? {} : { nextWave: 2, waveTotal: 2 }, o.extra || {});
                L.attack(Object.assign({}, o, { extra }));
                await L.wait(o.pause == null ? 1.6 : o.pause);
                if (o.wave !== false) S.nextEnemy(o.next);
            },
            // 나의 패배(죽음을 초월하는 자의 기회 소진 등)
            defeat(cues) { return S.push([{ action: 'augment', actor: 'player', effectTarget: 'actor', defeated: true, hits: [], damage: 0, triggeredEffectIds: cueIds(cues) }]); },
            aura(patch) { setAura(id, patch); },
            auraOf(other, patch) { setAura(other, patch); },
            get state() { return (S.model.auras.find(entry => entry.id === id) || null); },
            player(patch) { S.set({ player: patch }); },
            target(patch) { S.set({ target: patch }); },
            get model() { return S.model; },
            nextEnemy(patch) { S.nextEnemy(patch); },
            skills(names) { S.set({ skills: baseSkills().concat((names || []).map(skillEntry)) }); },
            caption(text) { showCaption(text); },
            async wait(seconds) { await sleep(seconds * 1000); if (run.stopped) throw STOP; },
            now: () => Date.now(),
            sound(name, options) { S.sound(name, options); },
            random: rand,
            // 실험자 캐릭터의 공격력(피해 숫자를 정할 때 기준)
            atk: ATK
        };
        return L;
    }

    // ---------- 자막 ----------
    function showCaption(text) {
        clearTimeout(captionTimer);
        const box = $('caption');
        if (!text) { box.hidden = true; return; }
        step++; captionLog.push(text);
        box.replaceChildren(el('span', { class: 'step', text: String(step) }), text);
        box.hidden = false;
    }
    function hideCaptionSoon(ms) { clearTimeout(captionTimer); captionTimer = setTimeout(() => { $('caption').hidden = true; }, ms || 1800); }

    // ---------- 고르기와 재생 ----------
    function prepare(id) {
        const spec = demos.get(id) || {}, L = makeL(id, token());
        stage.reset({ skills: baseSkills().concat((spec.skills || []).map(skillEntry)) });
        for (const [other, patch] of Object.entries(spec.auras || {})) setAura(other, patch);
        if (spec.aura) setAura(id, spec.aura);
        if (spec.setup) spec.setup(L);
        stage.preload(stage.scenesOf(id).concat(skillScenes(id)));
        step = 0; captionLog.length = 0; $('caption').hidden = true;
        return L;
    }
    async function playDemo(options) {
        const spec = demos.get(selected);
        if (!spec || !spec.demo) return;
        if (!options || !options.fromTour) stopTour();
        prepare(selected);
        const run = token(), L = makeL(selected, run);
        await stage.soundsReady(stage.soundsOf(selected, skillScenes(selected)), 900);
        try { await spec.demo(L); if (!run.stopped) hideCaptionSoon(2400); }
        catch (error) { if (error !== STOP) { parentErrors.push(String(error && error.stack || error)); showCaption('흐름 재생 중 오류: ' + (error && error.message || error)); } }
    }
    async function runSignal(signal) {
        stopTour();
        const run = token(), L = makeL(selected, run);
        try { await signal.run(L); }
        catch (error) { if (error !== STOP) { parentErrors.push(String(error && error.stack || error)); showCaption('오류: ' + (error && error.message || error)); } }
    }
    function select(id, options) {
        if (!catalog.augments.some(a => a.id === id)) id = catalog.augments[0].id;
        selected = id;
        stopDemo();
        if (!options || !options.fromTour) stopTour();
        document.querySelectorAll('#augments li').forEach(li => li.classList.toggle('on', li.dataset.id === id));
        const item = document.querySelector('#augments li.on'); if (item && options && options.scroll) item.scrollIntoView({ block: 'nearest' });
        $('mobilePick').value = id;
        syncUrl();
        if (mode === 'gallery') { prepare(id); renderGallery(); }
        else { liveOwned = [id]; renderLive(); liveAct('start'); }
    }
    function syncUrl() {
        const params = new URLSearchParams();
        params.set('augment', selected); if (mode === 'live') params.set('mode', 'live'); if (size === 'mobile') params.set('size', 'mobile');
        history.replaceState(null, '', '?' + params);
    }

    // ---------- 왼쪽 목록 ----------
    const augment = id => catalog.augments.find(a => a.id === id);
    const usesNewSound = id => catalog.newSounds.some(sound => stage && stage.soundsOf(id, skillScenes(id)).includes(sound.name));
    function renderList() {
        const words = $('search').value.trim().toLowerCase();
        const list = catalog.augments.filter(a => (filter === 'all' || a.category === filter || filter === 'new' && usesNewSound(a.id)) && (!words || (a.name + ' ' + a.lines.join(' ')).toLowerCase().includes(words)));
        $('augments').replaceChildren(...list.map(a => el('li', { 'data-id': a.id, class: a.id === selected ? 'on' : '', onclick: () => select(a.id) },
            el('img', { src: a.iconUrl, alt: '' }),
            el('span', {}, el('span', { class: 'name', text: a.name }), el('span', { class: 'sub', text: CATEGORY[a.category] + (a.skill ? ', 스킬 ' + a.skill : '') })),
            usesNewSound(a.id) ? el('span', { class: 'tag new', text: '새 소리' }) : '')));
    }
    function renderFilters() {
        const cats = [...new Set(catalog.augments.map(a => a.category))];
        const chips = [['all', '전체'], ['new', '새 효과음'], ...cats.map(c => [c, CATEGORY[c] || c])];
        $('filters').replaceChildren(...chips.map(([key, label]) => el('button', { class: key === filter ? 'on' : '', onclick: () => { filter = key; renderFilters(); renderList(); } }, label)));
    }
    // 새 효과음마다 그 소리를 쓰는 첫 증강(장면 목록에서 찾는다). 없으면 보기 단추를 달지 않는다.
    const soundOwner = name => catalog.augments.find(a => stage && stage.soundsOf(a.id, skillScenes(a.id)).includes(name));
    function renderNewSounds() {
        $('newSounds').replaceChildren(...catalog.newSounds.map(sound => { const owner = soundOwner(sound.name); return el('li', {},
            el('button', { 'aria-label': sound.label + ' 듣기', onclick: () => stage.sound(sound.name, { vol: .75 }) }, '듣기'),
            el('span', { class: 'what' }, sound.label + ' ', owner ? el('button', { class: 'tag', style: 'padding:0 6px', onclick: () => { if (mode !== 'gallery') setMode('gallery'); select(owner.id, { scroll: true }); playDemo(); } }, owner.name + ' 보기') : ''),
            el('span', { class: 'src' }, sound.use + ', 원작 ', el('a', { href: sound.source, target: '_blank', rel: 'noreferrer' }, sound.author), ' (CC0)')); }));
    }

    // ---------- 오른쪽: 연출 보기 ----------
    function head(a) {
        return el('div', { class: 'head' }, el('img', { src: a.iconUrl, alt: '' }), el('div', {}, el('h2', { text: a.name }),
            el('div', { class: 'meta' }, el('span', { class: 'tag', text: CATEGORY[a.category] || a.category }), a.skill ? el('span', { class: 'tag', text: '스킬 ' + a.skill }) : '', usesNewSound(a.id) ? el('span', { class: 'tag new', text: '새 효과음' }) : '')));
    }
    // 증강 설명의 강조 표기 {종류|말}을 색 글자로(paradise_augments_prism.js와 같은 규칙). 서버를 다시 켜기 전이면 lines를 그대로 보인다.
    function richText(a) {
        if (!a.text) return el('ul', { class: 'lines' }, a.lines.map(line => el('li', { text: line })));
        const paragraph = value => el('p', {}, ...String(value).split(/(\{[dhcskw]\|[^}]*\})/).filter(Boolean).map(part => {
            const m = /^\{([dhcskw])\|([^}]*)\}$/.exec(part);
            return m ? el('b', { class: 'tone-' + m[1], text: m[2] }) : document.createTextNode(part);
        }));
        return el('div', { class: 'rich' }, ...a.text.split('\n').map(paragraph), a.note ? el('p', { class: 'note', text: a.note }) : '');
    }
    function renderGallery() {
        const a = augment(selected), spec = demos.get(selected) || {};
        const box = $('detail');
        const parts = [head(a), richText(a)];
        parts.push(el('div', { class: 'actions' },
            el('button', { class: 'primary', disabled: !spec.demo, onclick: () => playDemo() }, '흐름 재생'),
            el('button', { onclick: () => { stopTour(); prepare(selected); renderGallery(); } }, '처음 상태로'),
            el('button', { onclick: () => { setMode('live'); } }, '실전에서 써 보기')));
        if (!demos.has(selected)) parts.push(el('p', { class: 'status bad', text: '이 증강의 연출 흐름이 아직 등록되지 않았습니다.' }));
        if (spec.notes && spec.notes.length) parts.push(el('h3', { text: '정한 해석' }), el('ul', { class: 'notes' }, spec.notes.map(note => el('li', { text: note }))));
        if (spec.signals && spec.signals.length) parts.push(el('h3', { text: '장면 하나씩' }), el('div', { class: 'signals' }, spec.signals.map(signal => el('button', { onclick: () => runSignal(signal) }, signal.label))));
        if (spec.controls && spec.controls.length) parts.push(el('h3', { text: '지속 상태' }), el('div', { class: 'controls' }, spec.controls.map(control => renderControl(control))));
        const sounds = stage.soundsOf(selected, skillScenes(selected));
        if (sounds.length) parts.push(el('h3', { text: '효과음' }), el('ul', { class: 'sounds' }, sounds.map(name => {
            const fresh = catalog.newSounds.find(sound => sound.name === name);
            return el('li', {}, el('button', { onclick: () => stage.sound(name, { vol: .7 }) }, '듣기'), el('span', { class: 'what' }, name, ' ', fresh ? el('span', { class: 'tag new', text: '새 효과음' }) : ''),
                el('span', { class: 'src' }, fresh ? [fresh.label + ', 원작 ', el('a', { href: fresh.source, target: '_blank', rel: 'noreferrer' }, fresh.author), ' (CC0)'] : '기존 효과음'));
        })));
        box.replaceChildren(...parts);
    }
    function currentAura() { return stage.model.auras.find(entry => entry.id === selected) || {}; }
    function renderControl(control) {
        const value = () => currentAura()[control.key];
        const L = () => makeL(selected, { stopped: false });
        const wrap = el('div', { class: 'control' });
        const label = el('div', { class: 'label' }, el('span', { text: control.label }), el('b', {}));
        const show = () => { const v = value(); label.lastChild.textContent = control.type === 'window' ? (Number(v) > Date.now() ? '진행 중' : '꺼짐') : control.type === 'toggle' ? (v ? '켜짐' : '꺼짐') : control.type === 'choice' ? ((control.options || []).find(option => JSON.stringify(option.value) === JSON.stringify(v)) || {}).label || '' : String(v ?? ''); };
        wrap.append(label);
        if (control.type === 'range') {
            const input = el('input', { type: 'range', min: control.min, max: control.max, step: control.step || 1, value: value() ?? control.min });
            input.addEventListener('input', () => { L().aura({ [control.key]: Number(input.value) }); show(); });
            wrap.append(input);
        } else if (control.type === 'toggle') {
            wrap.append(el('div', { class: 'options' }, el('button', { onclick: () => { L().aura({ [control.key]: !value() }); show(); } }, '바꾸기')));
        } else if (control.type === 'choice') {
            wrap.append(el('div', { class: 'options' }, (control.options || []).map(option => el('button', { onclick: () => { L().aura({ [control.key]: option.value }); show(); } }, option.label))));
        } else if (control.type === 'window') {
            wrap.append(el('div', { class: 'options' }, el('button', { onclick: () => { L().aura({ [control.key]: Date.now() + (control.ms || 10000) }); show(); setTimeout(show, (control.ms || 10000) + 50); } }, '시작'), el('button', { onclick: () => { L().aura({ [control.key]: 0 }); show(); } }, '끝')));
        }
        show();
        return wrap;
    }

    // ---------- 오른쪽: 실전 ----------
    async function liveAct(action, extra) {
        const status = document.querySelector('#detail .status');
        if (status) { status.textContent = '처리 중'; status.classList.remove('bad'); }
        let data;
        try {
            const response = await fetch('/lab/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action, augments: liveOwned, augment: selected }, extra || {})) });
            data = await response.json();
        } catch (error) { data = { ok: false, message: String(error.message || error) }; }
        const box = document.querySelector('#detail .status');
        if (box) { box.textContent = data.message || ''; box.classList.toggle('bad', !data.ok); }
        if (data.ok && (action === 'start' || !liveLoaded)) loadLive();
        return data;
    }
    function loadLive() { const frame = $('live'); liveLoaded = true; frame.src = '/paradise?lab=' + Date.now(); }
    function renderLive() {
        const a = augment(selected), spec = demos.get(selected) || {};
        const others = catalog.augments.filter(x => !liveOwned.includes(x.id));
        const button = (label, action, extra, primary) => el('button', { class: primary ? 'primary' : '', onclick: () => liveAct(action, extra) }, label);
        $('detail').replaceChildren(head(a),
            el('h3', { text: '실전에서 발동시키는 법' }),
            el('div', { class: 'live-hint', text: spec.live || '일반 공격과 스킬을 쓰며 지켜보세요. 아래 단추로 상황을 바로 만들 수 있습니다.' }),
            el('h3', { text: '상황 만들기' }),
            el('div', { class: 'live-grid' },
                button('새 전투 시작', 'start', null, true), button('둘째 적부터', 'start', { wave: 2 }),
                button('증강 상태 채우기', 'prime'), button('적이 바로 공격', 'enemyAttack'),
                button('적 HP 1', 'enemyOne'), button('적 체력 가득', 'enemyFull'),
                button('내 HP 25%', 'myHp', { ratio: .25 }), button('내 HP 5%', 'myHp', { ratio: .05 }),
                button('HP와 MP 가득', 'heal'), button('쿨타임 초기화', 'refill')),
            el('h3', { text: '함께 가질 증강' }),
            el('div', { class: 'owned' }, liveOwned.map(id => el('button', { class: id === selected ? 'on' : '', title: '빼기', onclick: () => { if (liveOwned.length > 1) { liveOwned = liveOwned.filter(x => x !== id); renderLive(); } } }, augment(id).name + (liveOwned.length > 1 ? ' ×' : '')))),
            el('div', { class: 'pick' },
                el('select', { id: 'liveAdd', 'aria-label': '더할 증강' }, el('option', { value: '' }, '증강 더하기'), others.map(x => el('option', { value: x.id }, x.name))),
                el('button', { onclick: () => { const id = $('liveAdd').value; if (id) { liveOwned.push(id); renderLive(); } } }, '더하기'),
                el('button', { onclick: () => { liveOwned = catalog.augments.map(x => x.id); renderLive(); } }, '30종 모두')),
            el('p', { class: 'status' }),
            el('p', { class: 'src', style: 'color:var(--text-3)', text: '증강을 바꾼 뒤에는 새 전투 시작을 누르세요. 화면은 메모리 DB의 실제 천상입니다.' }));
    }

    // ---------- 보기 방식, 크기, 차례로 보기 ----------
    function setMode(next) {
        mode = next;
        document.querySelectorAll('#modes button').forEach(button => button.classList.toggle('on', button.dataset.mode === mode));
        $('stage').hidden = mode !== 'gallery'; $('live').hidden = mode !== 'live';
        $('caption').hidden = true;
        stopDemo(); stopTour();
        if (mode === 'live') { liveOwned = [selected]; renderLive(); liveAct('start'); }
        else { prepare(selected); renderGallery(); }
        syncUrl(); fit();
    }
    function setSize(next) {
        size = next;
        document.querySelectorAll('#sizes button').forEach(button => button.classList.toggle('on', button.dataset.size === size));
        $('stageBox').classList.toggle('mobile', size === 'mobile');
        syncUrl(); fit();
    }
    function fit() {
        const box = $('stageBox'), frames = [$('stage'), $('live')];
        if (size !== 'mobile') { frames.forEach(frame => { frame.style.transform = ''; }); return; }
        const k = Math.min(1, (box.clientWidth - 24) / 390, (box.clientHeight - 24) / 844);
        frames.forEach(frame => { frame.style.transform = 'scale(' + k + ')'; });
    }
    // 사용자가 다른 것을 누르면 차례로 보기를 멈춘다(차례로 보기 자신이 부를 때는 fromTour).
    function stopTour() { if (!touring) return; touring.stopped = true; touring = null; $('tour').textContent = '30종 차례로 보기'; }
    async function tour() {
        if (touring) { stopTour(); return; }
        if (mode !== 'gallery') setMode('gallery');
        const me = touring = { stopped: false };
        $('tour').textContent = '차례로 보기 멈추기';
        for (const a of catalog.augments) {
            if (me.stopped) break;
            select(a.id, { scroll: true, fromTour: true }); await playDemo({ fromTour: true });
            if (me.stopped) break;
            await sleep(900);
        }
        if (touring === me) stopTour();
    }

    // ---------- 시작 ----------
    async function start() {
        AugLab.ready = (async () => {
            catalog = await (await fetch('/lab/api/catalog')).json();
            $('stage').src = '/lab/stage.html';
            await new Promise(resolve => $('stage').addEventListener('load', resolve, { once: true }));
            stage = await stageWindow().AugStage.ready;
            $('loading').remove();
            // 증강 장면들이 쓰는 소리를 모두 등록해 두면 첫 입력 때 한꺼번에 받는다.
            stage.preload(CombatFXScenes(), catalog.newSounds.map(sound => sound.name));
            $('volume').value = volume; $('mute').textContent = muted ? '소리 끔' : '소리 켬';
            $('volume').addEventListener('input', () => { volume = Number($('volume').value); store.set('augment-lab-volume', String(volume)); if (muted && volume > 0) toggleMute(); });
            $('mute').addEventListener('click', toggleMute);
            document.querySelectorAll('#modes button').forEach(button => button.addEventListener('click', () => { if (button.dataset.mode !== mode) setMode(button.dataset.mode); }));
            document.querySelectorAll('#sizes button').forEach(button => button.addEventListener('click', () => setSize(button.dataset.size)));
            $('tour').addEventListener('click', tour);
            $('search').addEventListener('input', renderList);
            $('mobilePick').replaceChildren(...catalog.augments.map(a => el('option', { value: a.id }, a.name)));
            $('mobilePick').addEventListener('change', () => select($('mobilePick').value));
            $('errors').addEventListener('click', () => { $('detail').prepend(el('pre', { class: 'status bad', style: 'white-space:pre-wrap;font-size:11px' }, AugLab.errors().join('\n\n'))); });
            setInterval(() => { const n = AugLab.errors().length; $('errors').hidden = !n; $('errors').textContent = '오류 ' + n; }, 1000);
            addEventListener('resize', fit);
            document.addEventListener('keydown', onKey);
            renderFilters();
            selected = query.get('augment') || catalog.augments[0].id;
            renderList(); renderNewSounds();
            setSize(size);
            if (mode === 'live') setMode('live'); else select(selected, { scroll: true });
            if (query.get('play') === '1' && mode === 'gallery') playDemo();
            return AugLab;
        })();
        return AugLab.ready;
    }
    function CombatFXScenes() { try { return stageWindow().CombatFX.augments.scenes.concat(stageWindow().CombatFX.augments.skills.map(name => 'skill:' + name)); } catch (_) { return []; } }
    function toggleMute() { muted = !muted; store.set('augment-lab-muted', muted ? '1' : '0'); $('mute').textContent = muted ? '소리 끔' : '소리 켬'; }
    function onKey(event) {
        if (event.target && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
        const items = [...document.querySelectorAll('#augments li')], index = items.findIndex(li => li.dataset.id === selected);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = items[clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1)];
            if (next) select(next.dataset.id, { scroll: true });
        } else if (event.key === 'Enter' && mode === 'gallery') { event.preventDefault(); playDemo(); }
        else if (event.key === 'Escape') { stopDemo(); stopTour(); hideCaptionSoon(0); }
    }
})();
