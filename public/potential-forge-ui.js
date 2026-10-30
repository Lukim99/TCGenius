// 잠재능력 각인로 UI. app.js가 #potentialContent를 root로 넘겨
// PotentialForge.renderSetup/renderRunning/renderResult(root, model, actions)를 호출한다.
// 서버 통신, 순서 제어, 확정 처리는 app.js 몫이고, 이 파일은 화면과 콜백 연결만 맡는다.
(() => {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const GRADES = ['bronze', 'silver', 'gold', 'platinum'];
    const GRADE_LABEL = { bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플레티넘' };
    const TIERS = ['rare', 'epic', 'unique', 'legendary'];
    const SLOT_SR = ['첫 번째 조건', '두 번째 조건', '세 번째 조건'];
    const JEWEL_NAME = { none: '촉매 없음', jewel: '쥬얼', white: '화이트 쥬얼' };
    const STOP_TEXT = {
        matched: { tone: 'win', title: '목표 달성!', sub: '줄 위치와 관계없이 모든 조건을 충족했습니다.' },
        budget: { tone: 'halt', title: '골드 한도 도달', sub: '정한 한도 안에서 목표를 찾지 못했습니다.' },
        gold: { tone: 'halt', title: '골드 부족', sub: '다음 각인 비용이 보유 골드보다 많아 멈췄습니다.' },
        jewel: { tone: 'halt', title: '쥬얼 소진', sub: '쥬얼이 떨어져 멈췄습니다. 골드 결제로 바꾸지 않았습니다.' },
        manual: { tone: 'halt', title: '각인 중단', sub: '직접 멈췄습니다.' },
        error: { tone: 'err', title: '오류로 중단', sub: '문제가 생겨 각인을 멈췄습니다.' }
    };
    // 결과 연출 타이밍(ms)
    const LINE_AT = 700;
    const LINE_GAP = 420;
    const FINALE_AT = LINE_AT + LINE_GAP * 3;
    const IMPACT_AT = 620;
    const REVEAL_END = FINALE_AT + 1300;

    const states = new WeakMap();
    let uidSeq = 0;

    // ---------- 기본 도구 ----------
    function h(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
    }
    function svg(tag, attrs) {
        const n = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(k => n.setAttribute(k, String(attrs[k])));
        return n;
    }
    function button(cls, onClick, text) {
        const b = h('button', 'pf-btn ' + cls, text);
        b.type = 'button';
        // 효과음 잠금 해제는 사용자 입력 안에서, 콜백보다 먼저
        if (onClick) b.addEventListener('click', () => { if (b.disabled) return; unlock(); onClick(); });
        return b;
    }
    function img(cls, src, alt) {
        const i = h('img', cls);
        i.src = src;
        i.alt = alt || '';
        i.draggable = false;
        i.decoding = 'async';
        return i;
    }
    const uid = () => 'pf-' + (++uidSeq);
    const num = v => Math.max(0, Math.round(Number(v) || 0));
    const fmt = v => num(v).toLocaleString('ko-KR');
    const gradeIdx = g => GRADES.indexOf(g);
    const tierIdx = t => TIERS.indexOf(t);
    const call = (fn, ...args) => { if (typeof fn === 'function') fn(...args); };

    function stateOf(root) {
        let st = states.get(root);
        if (!st) {
            st = { view: '', timers: [], run: null, revealKey: '', revealAt: 0, wonRun: null };
            states.set(root, st);
        }
        return st;
    }
    function clearTimers(st) {
        st.timers.forEach(clearTimeout);
        st.timers = [];
    }
    function later(st, ms, fn) {
        const id = setTimeout(() => {
            st.timers = st.timers.filter(t => t !== id);
            fn();
        }, ms);
        st.timers.push(id);
    }
    // 예약된 효과음이 남은 화면을 떠날 때만 소리를 끊는다
    function leaveView(st) {
        if (st.timers.length) stopSound();
        clearTimers(st);
    }

    // 다시 그려도 초점과 스크롤 위치를 유지한다 (쥬얼 선택 등 app.js 재렌더 대비)
    function mount(root, st, view, shell) {
        const active = document.activeElement;
        const focusKey = active && root.contains(active) && active.dataset ? active.dataset.pfFocus : '';
        const scroller = root.closest('.pot-wrap');
        const keepScroll = scroller && st.view === view ? scroller.scrollTop : 0;
        if (scroller) scroller.classList.remove('pf-locked');
        st.view = view;
        root.classList.add('potential-forge');
        root.dataset.pfView = view;
        root.replaceChildren(shell);
        if (scroller) scroller.scrollTop = keepScroll;
        if (focusKey) {
            const t = root.querySelector('[data-pf-focus="' + focusKey + '"]');
            if (t && !t.disabled) t.focus({ preventScroll: true });
        }
    }

    function optionMap(info) {
        const m = new Map();
        (info.targetOptions || []).forEach(o => { if (o && o.key != null) m.set(String(o.key), o); });
        return m;
    }
    function gradesOf(opt) {
        const list = (opt && Array.isArray(opt.grades) ? opt.grades : GRADES).filter(g => GRADES.includes(g));
        return list.length ? list : GRADES.slice();
    }
    function normTargets(raw, optMap) {
        return [0, 1, 2].map(i => {
            const t = Array.isArray(raw) ? raw[i] : null;
            const keys = t && (Array.isArray(t.keys) ? t.keys : [t.key]).filter(key => optMap.has(key));
            if (!keys || !keys.length) return null;
            const grades = targetGrades(keys, optMap);
            return { keys: [...new Set(keys)], grade: grades.includes(t.grade) ? t.grade : grades[0] };
        });
    }
    function targetGrades(keys, optMap) {
        return GRADES.filter(g => keys.some(key => gradesOf(optMap.get(key)).includes(g))
            && keys.every(key => gradesOf(optMap.get(key)).some(available => gradeIdx(available) >= gradeIdx(g))));
    }
    function targetName(t, optMap, compact = false) {
        const names = t.keys.map(key => optMap.get(key)?.label || key);
        return compact && names.length > 2 ? names.slice(0, 2).join(' 또는 ') + ' 외 ' + (names.length - 2) + '개' : names.join(' 또는 ');
    }
    function targetText(t, optMap) {
        if (!t) return '조건 없음';
        return targetName(t, optMap) + ' ' + GRADE_LABEL[t.grade] + ' 이상';
    }
    function conditionSummary(targets, optMap) {
        const el = h('ul', 'pf-conditions');
        el.setAttribute('aria-label', '목표 조건 충족 현황');
        const rows = targets.map(t => {
            if (!t) return null;
            const row = h('li');
            row.title = targetText(t, optMap);
            row.append(h('span', null, targetName(t, optMap, true) + ' ' + GRADE_LABEL[t.grade] + ' 이상'));
            const status = h('b', null, '미충족'); row.append(status); el.append(row);
            return { row, status };
        });
        const sync = matched => rows.forEach((entry, i) => { if (entry) { entry.row.classList.toggle('is-met', !!matched?.[i]); entry.status.textContent = matched?.[i] ? '충족' : '미충족'; } });
        return { el, sync };
    }
    function affordability(info, jewel) {
        const opt = (info.options || {})[jewel] || {};
        const cost = num(opt.cost);
        const gold = num(info.gold);
        const jewelCount = jewel === 'none' ? Infinity : num((info.jewels || {})[jewel]);
        const jewelOk = jewel === 'none' || (opt.available !== false && jewelCount > 0);
        return { cost, gold, jewelCount, goldOk: gold >= cost, jewelOk, ok: gold >= cost && jewelOk };
    }
    function eqTitle(eq) {
        return (eq.name || '장비') + (Number(eq.level) > 0 ? ' +' + eq.level : '');
    }

    // ---------- 효과음: /static/potential-forge-audio.js(외부 음원)에 위임 ----------
    const audio = () => window.PotentialForgeAudio || null;
    function unlock() {
        const a = audio();
        if (a && typeof a.unlock === 'function') { try { a.unlock(); } catch (_) { } }
    }
    function play(name, arg) {
        const a = audio();
        if (a && typeof a.play === 'function') { try { a.play(name, arg); } catch (_) { } }
    }
    function stopSound() {
        const a = audio();
        if (a && typeof a.stop === 'function') { try { a.stop(); } catch (_) { } }
    }
    function soundToggle() {
        const b = h('button', 'pf-sound');
        b.type = 'button';
        b.dataset.pfFocus = 'sound';
        const ico = h('i', 'pf-sound-ico');
        ico.setAttribute('aria-hidden', 'true');
        const label = h('span');
        b.append(ico, label);
        const sync = () => {
            const a = audio();
            const on = !!(a && a.enabled);
            b.disabled = !a;
            b.setAttribute('aria-pressed', String(on));
            label.textContent = on ? '효과음 켬' : '효과음 끔';
        };
        b.addEventListener('click', () => {
            const a = audio();
            if (!a) return;
            unlock();
            let on = false;
            try { on = !!a.toggle(); } catch (_) { }
            if (on) play('select');
            sync();
        });
        sync();
        return b;
    }

    function speedControl(value, onChange, disabled = false) {
        const el = h('div', 'pf-speed');
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', '자동 각인 속도');
        el.append(h('span', 'pf-speed-label', '각인 속도'));
        const buttons = [1, 2, 3].map(speed => {
            const b = button('pf-speed-btn', () => { sync(speed); play('select'); call(onChange, speed); }, speed + '배속');
            b.dataset.pfSpeed = String(speed);
            b.dataset.pfFocus = 'speed' + speed;
            b.disabled = disabled;
            el.append(b);
            return b;
        });
        function sync(speed) { buttons.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.pfSpeed) === (speed || 1)))); }
        sync(value);
        return { el, sync };
    }

    // ---------- 공통 조각 ----------
    function header(title, sub, onClose, closeLabel) {
        const head = h('header', 'pf-head');
        const plate = h('div', 'pf-title');
        plate.append(h('h2', 'pf-title-text', title));
        if (sub) plate.append(h('span', 'pf-title-sub', sub));
        head.append(soundToggle(), plate);
        if (onClose) {
            const x = button('pf-x', onClose, '✕');
            x.setAttribute('aria-label', closeLabel || '닫기');
            x.dataset.pfFocus = 'close';
            head.append(x);
        } else {
            head.append(h('span', 'pf-x-spacer'));
        }
        return head;
    }

    function itemNode(eq) {
        const box = h('div', 'pf-item');
        if (eq.frameUrl) box.append(img('auc-frame', eq.frameUrl, ''));
        if (eq.iconUrl) box.append(img('auc-item-img', eq.iconUrl, eq.name || '장비'));
        return box;
    }

    function ring(cls) {
        return svg('svg', { viewBox: '-100 -100 200 200', class: 'pf-ring ' + cls, 'aria-hidden': 'true', focusable: 'false' });
    }
    function point(r, deg) {
        const a = deg * Math.PI / 180;
        return (r * Math.sin(a)).toFixed(2) + ',' + (-r * Math.cos(a)).toFixed(2);
    }
    // 연금술 각인 고리: 바깥 눈금 고리 / 육망성 / 안쪽 점선 — 각각 따로 회전
    function forgeRings() {
        const outer = ring('pf-ring-outer');
        outer.append(svg('circle', { r: 97, class: 'pf-r-line' }), svg('circle', { r: 91, class: 'pf-r-ticks' }), svg('circle', { r: 85, class: 'pf-r-line is-faint' }));
        for (let i = 0; i < 12; i++) {
            outer.append(svg('rect', { x: -2.4, y: -96.3, width: 4.8, height: 4.8, class: i % 3 ? 'pf-r-node' : 'pf-r-node is-major', transform: 'rotate(' + (i * 30) + ') rotate(45 0 -93.9)' }));
        }
        const star = ring('pf-ring-star');
        star.append(svg('circle', { r: 76, class: 'pf-r-line is-faint' }));
        star.append(svg('polygon', { points: [0, 120, 240].map(d => point(74, d)).join(' '), class: 'pf-r-glyph' }));
        star.append(svg('polygon', { points: [60, 180, 300].map(d => point(74, d)).join(' '), class: 'pf-r-glyph' }));
        for (let i = 0; i < 6; i++) {
            const [x, y] = point(74, i * 60).split(',');
            star.append(svg('circle', { cx: x, cy: y, r: 3.2, class: 'pf-r-dot' }));
        }
        const inner = ring('pf-ring-inner');
        inner.append(svg('circle', { r: 56, class: 'pf-r-dash' }), svg('circle', { r: 48, class: 'pf-r-line is-faint' }));
        return [outer, star, inner];
    }

    function coreNode(eq, entries, mode) {
        const core = h('div', 'pf-core');
        core.dataset.mode = mode;
        core.append(h('div', 'pf-hearth'), ...forgeRings());
        const fx = h('div', 'pf-core-fx');
        fx.setAttribute('aria-hidden', 'true');
        core.append(fx, itemNode(eq));
        const gems = [0, 1, 2].map(i => {
            const g = h('span', 'pf-gem');
            g.setAttribute('aria-hidden', 'true');
            g.style.setProperty('--ang', (i * 120) + 'deg');
            core.append(g);
            return g;
        });
        setGems(gems, entries);
        return { core, gems, fx };
    }
    function setGems(gems, entries) {
        gems.forEach((g, i) => { g.dataset.grade = (entries && entries[i] && entries[i].grade) || ''; });
    }

    function stageNode(eq, tierKey, tierLabel, core) {
        const stage = h('div', 'pf-stage');
        stage.dataset.tier = tierKey || 'rare';
        const plate = h('div', 'pf-nameplate');
        plate.append(h('strong', 'pf-eq-name', eqTitle(eq)));
        const crest = h('span', 'pf-crest', tierLabel || '');
        plate.append(crest);
        stage.append(core, plate);
        return { stage, crest };
    }

    function fillLine(ln, entry) {
        ln.el.dataset.grade = (entry && entry.grade) || '';
        ln.grade.textContent = entry ? (entry.gradeLabel || GRADE_LABEL[entry.grade] || '') : '—';
        ln.text.textContent = entry ? (entry.text || '') : '비어 있음';
    }
    function lineNode(entry, goal) {
        const el = h('li', 'pf-line');
        const grade = h('span', 'pf-grade');
        const body = h('span', 'pf-line-body');
        const reel = h('span', 'pf-reel');
        reel.setAttribute('aria-hidden', 'true');
        const text = h('span', 'pf-line-text');
        body.append(reel, text);
        el.append(grade, body);
        const ln = { el, grade, body, text, lamp: null };
        if (goal) {
            const lamp = h('span', 'pf-lamp');
            const lampText = h('span', 'pf-lamp-t');
            lamp.append(h('i', 'pf-lamp-orb'), lampText);
            const goalLine = h('span', 'pf-line-goal');
            ln.goalText = h('span', null, goal.text);
            ln.goalLine = goalLine;
            goalLine.append(h('em', null, '조건'), ln.goalText);
            body.append(goalLine);
            el.classList.add('has-goal');
            el.append(lamp);
            ln.lamp = lamp;
            ln.lampText = lampText;
        }
        fillLine(ln, entry);
        return ln;
    }
    function setLamp(ln, state) {
        if (!ln.lamp) return;
        ln.lamp.dataset.state = state;
        ln.lampText.textContent = state === 'on' ? '충족' : state === 'off' ? '미충족' : '—';
    }
    function setLineCondition(ln, run, index) {
        const condition = run?.lineMatches?.[index];
        const used = Number.isInteger(condition);
        if (ln.goalLine) { ln.goalLine.hidden = !used; ln.goalText.textContent = used ? SLOT_SR[condition] : ''; }
        setLamp(ln, used ? 'on' : 'free');
        return used;
    }
    // goals: [{text}|null]×3 — 목표 표시가 필요한 화면에서만 넘긴다
    function tablet(data, title, cls, goals) {
        const box = h('section', 'pf-tablet' + (cls ? ' ' + cls : ''));
        box.dataset.tier = (data && data.tierKey) || 'rare';
        const titleId = uid();
        box.setAttribute('aria-labelledby', titleId);
        const head = h('header', 'pf-tablet-head');
        const t = h('span', 'pf-tablet-title', title);
        t.id = titleId;
        const tier = h('span', 'pf-tier', (data && data.tierLabel) || '');
        head.append(t, tier);
        const list = h('ol', 'pf-lines');
        const entries = (data && data.entries) || [];
        const lines = [0, 1, 2].map(i => {
            const ln = lineNode(entries[i], goals ? (goals[i] || { text: '조건 없음' }) : null);
            list.append(ln.el);
            return ln;
        });
        box.append(head, list);
        return { el: box, lines, tier };
    }

    function goldIconNode(info) {
        return info.goldIcon ? img('pf-coin', info.goldIcon, '') : h('i', 'pf-coin is-css');
    }
    function purse(info) {
        const row = h('div', 'pf-purse');
        const pill = (icon, value, label) => {
            const p = h('span', 'pf-purse-pill');
            p.setAttribute('aria-label', label);
            if (icon) { icon.setAttribute('aria-hidden', 'true'); p.append(icon); }
            p.append(h('b', null, value));
            return p;
        };
        const icons = info.jewelIcons || {};
        const jewels = info.jewels || {};
        row.append(pill(goldIconNode(info), fmt(info.gold), '보유 골드 ' + fmt(info.gold)));
        row.append(pill(icons.jewel ? img('pf-coin', icons.jewel, '') : null, fmt(jewels.jewel), '보유 쥬얼 ' + fmt(jewels.jewel) + '개'));
        row.append(pill(icons.white ? img('pf-coin', icons.white, '') : null, fmt(jewels.white), '보유 화이트 쥬얼 ' + fmt(jewels.white) + '개'));
        return row;
    }

    function section(title, cls) {
        const s = h('section', 'pf-sec' + (cls ? ' ' + cls : ''));
        const id = uid();
        const t = h('h3', 'pf-sec-title', title);
        t.id = id;
        s.setAttribute('aria-labelledby', id);
        s.append(t);
        return s;
    }

    function errorNode(msg) {
        const e = h('div', 'pf-error', msg);
        e.setAttribute('role', 'alert');
        return e;
    }

    function sparks(count, cls) {
        const wrap = h('div', cls);
        wrap.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < count; i++) {
            const s = h('i');
            s.style.setProperty('--a', Math.round(i * 360 / count + (i % 2 ? 11 : -7)) + 'deg');
            s.style.setProperty('--r', (0.82 + (i % 3) * 0.14).toFixed(2));
            s.style.setProperty('--t', ((i % 4) * 0.06).toFixed(2) + 's');
            wrap.append(s);
        }
        return wrap;
    }

    // ---------- 설정 화면 ----------
    function renderSetup(root, model, actions) {
        const st = stateOf(root);
        leaveView(st);
        st.run = null;
        st.revealKey = '';
        const info = model.info || {};
        const eq = model.equipment || {};
        const busy = !!model.busy;
        const jewel = JEWEL_NAME[model.jewel] ? model.jewel : 'none';
        const optMap = optionMap(info);
        const targets = normTargets(model.targets, optMap);
        targets.forEach((target, i) => call(actions.onTarget, i, target));
        let budget = model.goldLimit == null ? '' : String(model.goldLimit).replace(/[^\d]/g, '');
        const aff = affordability(info, jewel);
        const current = info.current || {};

        const shell = h('div', 'pf-shell');
        shell.setAttribute('role', 'region');
        shell.setAttribute('aria-label', '잠재능력 각인');
        shell.append(header('잠재능력 각인', null, actions.onClose, '각인로 닫기'));

        const body = h('div', 'pf-body');

        // 왼쪽: 장비 각인로
        const forge = h('div', 'pf-col pf-col-forge');
        const { core } = coreNode(eq, current.entries, 'idle');
        const { stage } = stageNode(eq, info.currentTier || current.tierKey, info.currentTierLabel || current.tierLabel, core);
        stage.append(purse(info));
        forge.append(stage, tablet(current, '현재 잠재능력', 'is-current').el, upgradeGauge(info, jewel));

        // 오른쪽: 설정 인셋
        const inset = h('div', 'pf-col pf-inset');

        const jewelSec = section('촉매');
        const jewelRow = h('div', 'pf-jewels');
        jewelRow.setAttribute('role', 'group');
        jewelRow.setAttribute('aria-label', '촉매 선택');
        ['none', 'jewel', 'white'].forEach(key => {
            const opt = (info.options || {})[key] || {};
            const count = key === 'none' ? null : num((info.jewels || {})[key]);
            const available = key === 'none' || (opt.available !== false && count > 0);
            const b = button('pf-socket', () => { if (key !== jewel) call(actions.onJewel, key); });
            b.dataset.key = key;
            b.dataset.pfFocus = 'jewel-' + key;
            b.setAttribute('aria-pressed', String(key === jewel));
            b.disabled = busy || !available;
            const iconUrl = key === 'none' ? null : (info.jewelIcons || {})[key];
            const well = h('span', 'pf-socket-well');
            well.setAttribute('aria-hidden', 'true');
            if (iconUrl) well.append(img('pf-socket-img', iconUrl, ''));
            b.append(well, h('span', 'pf-socket-name', JEWEL_NAME[key]));
            const detail = key === 'none' ? '할인 없음' : ('골드 -' + num(opt.discountPct) + '%');
            b.append(h('span', 'pf-socket-sub', detail));
            if (count != null) b.append(h('span', 'pf-socket-count', available ? '보유 ' + fmt(count) : '없음'));
            jewelRow.append(b);
        });
        jewelSec.append(jewelRow);
        if (jewel !== 'none') jewelSec.append(h('p', 'pf-note', '각인 1회마다 ' + JEWEL_NAME[jewel] + ' 1개를 씁니다. 떨어지면 자동 각인이 멈춰요.'));

        const tgtSec = section('목표 각인');
        tgtSec.append(h('p', 'pf-note', '줄 위치는 상관없습니다. 조건마다 허용할 옵션을 여러 개 고를 수 있고, 그중 하나가 나오면 충족합니다.'));
        const tgtList = h('div', 'pf-targets');
        targets.forEach((_, i) => {
            const trigger = button('pf-rune', () => openPicker({
                root, shell, slot: i, current: targets[i], optMap, trigger,
                onConfirm: picked => {
                    targets[i] = picked;
                    syncRow();
                    refresh();
                    call(actions.onTarget, i, picked ? { keys: [...picked.keys], grade: picked.grade } : null);
                }
            }));
            trigger.dataset.pfFocus = 'target' + i;
            trigger.setAttribute('aria-haspopup', 'dialog');
            trigger.disabled = busy;
            const socket = h('span', 'pf-rune-socket');
            socket.setAttribute('aria-hidden', 'true');
            const name = h('strong', 'pf-rune-name');
            const sub = h('span', 'pf-rune-sub');
            const text = h('span', 'pf-rune-text');
            text.append(name, sub);
            const act = h('span', 'pf-rune-act');
            act.setAttribute('aria-hidden', 'true');
            trigger.append(socket, text, act);
            const syncRow = () => {
                const t = targets[i];
                trigger.dataset.grade = t ? t.grade : '';
                trigger.classList.toggle('is-set', !!t);
                name.textContent = t ? targetName(t, optMap, true) : '조건 없음';
                sub.textContent = t ? GRADE_LABEL[t.grade] + ' 이상' + (t.keys.length > 1 ? ' 중 하나' : '') : '이 조건은 검사하지 않음';
                act.textContent = t ? '바꾸기' : '정하기';
                trigger.setAttribute('aria-label', SLOT_SR[i] + ' 목표, ' + name.textContent + (t ? ' ' + sub.textContent : '') + '. 눌러서 고르기');
            };
            syncRow();
            tgtList.append(trigger);
        });
        tgtSec.append(tgtList);

        const budgetSec = section('골드 한도');
        const budgetId = uid();
        const field = h('label', 'pf-field');
        const budgetIn = h('input', 'pf-input');
        budgetIn.type = 'text';
        budgetIn.inputMode = 'numeric';
        budgetIn.autocomplete = 'off';
        budgetIn.spellcheck = false;
        budgetIn.placeholder = '비우면 보유 골드 전부';
        budgetIn.value = budget;
        budgetIn.disabled = busy;
        budgetIn.dataset.pfFocus = 'budget';
        budgetIn.setAttribute('aria-label', '자동 각인 골드 한도');
        budgetIn.setAttribute('aria-describedby', budgetId);
        field.append(goldIconNode(info), budgetIn, h('span', 'pf-field-unit', '골드'));
        const budgetNote = h('p', 'pf-budget-note');
        budgetNote.id = budgetId;
        const estNote = h('p', 'pf-note');
        budgetIn.addEventListener('input', () => {
            const clean = budgetIn.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
            if (clean !== budgetIn.value) budgetIn.value = clean;
            budget = clean;
            refresh();
            call(actions.onBudget, clean);
        });
        budgetSec.append(field, budgetNote, estNote);

        const lore = h('ul', 'pf-lore');
        lore.setAttribute('aria-label', '각인 규칙');
        [
            '시도마다 세 줄이 모두 새로 새겨집니다.',
            '조건 안에서는 선택한 옵션 중 하나만 나오면 됩니다.',
            '모든 조건을 서로 다른 줄에서 충족하면 멈춥니다. 한 줄을 두 번 세지 않습니다.',
            '원래 잠재능력은 끝까지 보관되고, 마지막에 원래와 새 잠재 중 직접 고릅니다.',
            '최대 3회씩 진행합니다. 중단하면 이미 진행한 마지막 결과를 확인합니다.',
            '도중에 티어가 오를 수 있으며, 그 뒤로는 각인 비용이 늘 수 있습니다.'
        ].forEach(t => lore.append(h('li', null, t)));

        inset.append(jewelSec, tgtSec, budgetSec, lore);
        body.append(forge, inset);
        shell.append(body);

        // 하단 고정: 비용 + 1회/자동
        const footer = h('footer', 'pf-footer');
        if (model.error) footer.append(errorNode(model.error));
        const cost = h('div', 'pf-cost' + (aff.goldOk ? '' : ' is-lack'));
        cost.append(h('span', 'pf-cost-k', '1회 비용'), goldIconNode(info), h('b', null, fmt(aff.cost)));
        if (jewel !== 'none') cost.append(h('span', 'pf-cost-plus', '+ ' + JEWEL_NAME[jewel] + ' 1개'));
        if (!aff.goldOk) cost.append(h('span', 'pf-cost-warn', '골드 부족'));
        const hintId = uid();
        const autoHint = h('p', 'pf-auto-hint');
        autoHint.id = hintId;
        autoHint.setAttribute('aria-live', 'polite');
        // 새 실행을 시작하는 입력에서만 충전음을 한 번 낸다
        const singleBtn = button('pf-btn-iron', () => { play('charge'); call(actions.onSingle); }, busy ? '각인 중…' : '1회 각인');
        singleBtn.dataset.pfFocus = 'single';
        singleBtn.disabled = busy || !aff.ok;
        const autoBtn = button('pf-btn-brass', () => { play('charge'); call(actions.onAuto); });
        autoBtn.dataset.pfFocus = 'auto';
        autoBtn.setAttribute('aria-describedby', hintId);
        autoBtn.append(h('span', 'pf-btn-sigil'), h('span', null, busy ? '각인 중…' : '자동 각인'));
        const btns = h('div', 'pf-actions');
        btns.append(singleBtn, autoBtn);
        footer.append(speedControl(model.speed, actions.onSpeed, busy).el, cost, btns, autoHint);
        shell.append(footer);

        function blockReason(limit) {
            if (busy) return '각인을 처리하는 중입니다.';
            if (!aff.goldOk) return '골드가 부족합니다.';
            if (!aff.jewelOk) return '선택한 쥬얼이 없습니다.';
            if (!targets.some(Boolean)) return '조건을 하나 이상 정하면 자동 각인을 시작할 수 있어요.';
            if (limit != null && limit < aff.cost) return '골드 한도가 1회 비용보다 적습니다.';
            return '';
        }
        function refresh() {
            const limit = budget === '' ? null : Number(budget);
            budgetNote.textContent = limit == null
                ? '한도 없음, 보유 골드 ' + fmt(aff.gold) + ' 전부 사용 가능'
                : fmt(limit) + ' 골드까지 사용' + (limit > aff.gold ? ' (보유 ' + fmt(aff.gold) + ')' : '');
            budgetNote.classList.toggle('is-open', limit == null);
            if (aff.cost > 0) {
                let est = Math.floor(Math.min(limit == null ? aff.gold : limit, aff.gold) / aff.cost);
                if (jewel !== 'none') est = Math.min(est, aff.jewelCount);
                estNote.textContent = '지금 비용으로 최대 약 ' + fmt(est) + '회 각인할 수 있어요.';
            } else estNote.textContent = '';
            const reason = blockReason(limit);
            autoBtn.disabled = !!reason;
            const n = targets.filter(Boolean).length;
            autoHint.textContent = reason || ('조건 ' + n + '개를 모두 충족할 때까지 자동으로 각인합니다.');
            autoHint.classList.toggle('is-warn', !!reason && !busy);
        }
        refresh();

        mount(root, st, 'setup', shell);
    }

    function upgradeGauge(info, jewel) {
        const box = h('div', 'pf-gauge');
        const u = info.upgrade;
        if (!u) {
            box.classList.add('is-max');
            box.append(h('span', 'pf-gauge-k', '승급'), h('b', 'pf-gauge-v', '최고 티어에 도달했습니다'));
            return box;
        }
        const guarantee = num(u.guarantee);
        const fail = num(u.failCount);
        const pct = guarantee > 0 ? Math.min(100, fail / guarantee * 100) : 0;
        const top = h('div', 'pf-gauge-top');
        top.append(h('span', 'pf-gauge-k', '승급 ' + (info.currentTierLabel || '') + ' → ' + (u.next || '')), h('b', 'pf-gauge-v', '확정까지 ' + fmt(fail) + ' / ' + fmt(guarantee)));
        const bar = h('div', 'pf-gauge-bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', '확정 승급 게이지');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(guarantee));
        bar.setAttribute('aria-valuenow', String(Math.min(fail, guarantee)));
        const fill = h('i');
        fill.style.width = pct.toFixed(1) + '%';
        bar.append(fill);
        box.append(top, bar);
        if (jewel !== 'none' && info.currentTier !== 'unique') box.append(h('p', 'pf-note', '쥬얼을 쓰면 승급 확률과 게이지가 2배로 오릅니다.'));
        return box;
    }

    // ---------- 목표 각인판 (브라우저 드롭다운 대신 각인로 위에 뜨는 석판) ----------
    // 옵션 타일과 등급 보석을 고른 뒤 '목표 새기기'로 확정한다. 취소하면 바뀌지 않는다.
    function openPicker({ root, shell, slot, current, optMap, trigger, onConfirm }) {
        if (shell.querySelector('.pf-picker-overlay')) return;
        let pending = current ? { keys: [...current.keys], grade: current.grade } : null;
        const scroller = root.closest('.pot-wrap');
        const keepScroll = scroller ? scroller.scrollTop : 0;

        const overlay = h('div', 'pf-picker-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const titleId = uid();
        overlay.setAttribute('aria-labelledby', titleId);
        const panel = h('div', 'pf-picker');
        panel.tabIndex = -1;
        overlay.append(panel);

        const head = h('header', 'pf-picker-head');
        const heading = h('div', 'pf-picker-heading');
        const title = h('h4', 'pf-picker-title', '목표 각인');
        title.id = titleId;
        heading.append(h('span', 'pf-picker-kicker', SLOT_SR[slot]), title);
        const x = button('pf-x pf-picker-x', () => close(false), '✕');
        x.setAttribute('aria-label', '닫기');
        x.dataset.pfFocus = 'target-close';
        head.append(heading, x);

        // 지금 고른 각인 미리보기
        const seal = h('div', 'pf-picker-seal');
        seal.setAttribute('aria-live', 'polite');
        const sealGem = h('span', 'pf-picker-seal-gem');
        sealGem.setAttribute('aria-hidden', 'true');
        const sealName = h('strong', 'pf-picker-seal-name');
        const sealGrade = h('span', 'pf-picker-seal-grade');
        const sealText = h('span', 'pf-picker-seal-text');
        sealText.append(sealName, sealGrade);
        seal.append(sealGem, sealText);

        const optLabel = h('div', 'pf-picker-label');
        const optLabelId = uid();
        optLabel.id = optLabelId;
        optLabel.append(h('span', null, '허용 옵션'), h('span', 'pf-picker-hint', '여러 개 선택 가능 / 스크롤'));
        const grid = h('div', 'pf-picker-grid');
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-labelledby', optLabelId);
        const tiles = [];
        const addTile = (key, labelText, opt) => {
            const tile = button('pf-tile' + (opt ? '' : ' is-blank'), () => pickOption(key));
            tile.dataset.pfOption = key;
            tile.append(h('span', 'pf-tile-name', labelText));
            if (opt) {
                const ok = gradesOf(opt);
                const pips = h('span', 'pf-tile-pips');
                pips.setAttribute('aria-hidden', 'true');
                GRADES.forEach(g => {
                    const p = h('i', ok.includes(g) ? null : 'is-off');
                    p.dataset.grade = g;
                    pips.append(p);
                });
                tile.append(pips);
            } else tile.append(h('span', 'pf-tile-sub', '이 조건은 검사하지 않음'));
            tiles.push(tile);
            grid.append(tile);
        };
        addTile('', '조건 없음', null);
        optMap.forEach((o, key) => addTile(key, String(o.label), o));

        const gradeLabel = h('div', 'pf-picker-label');
        const gradeLabelId = uid();
        gradeLabel.id = gradeLabelId;
        const gradeHint = h('span', 'pf-picker-hint');
        gradeLabel.append(h('span', null, '최소 등급'), gradeHint);
        const gradeRow = h('div', 'pf-picker-grades');
        gradeRow.setAttribute('role', 'group');
        gradeRow.setAttribute('aria-labelledby', gradeLabelId);
        const facets = GRADES.map(g => {
            const f = button('pf-facet', () => pickGrade(g));
            f.dataset.pfGrade = g;
            f.dataset.grade = g;
            const gem = h('span', 'pf-facet-gem');
            gem.setAttribute('aria-hidden', 'true');
            f.append(gem, h('span', 'pf-facet-name', GRADE_LABEL[g]), h('span', 'pf-facet-sub', '이상'));
            gradeRow.append(f);
            return f;
        });

        const foot = h('footer', 'pf-picker-foot');
        const cancel = button('pf-btn-iron', () => close(false), '취소');
        cancel.dataset.pfFocus = 'target-cancel';
        const confirm = button('pf-btn-brass', () => close(true));
        confirm.dataset.pfFocus = 'target-confirm';
        confirm.append(h('span', 'pf-btn-sigil'), h('span', null, '목표 새기기'));
        foot.append(cancel, confirm);

        panel.append(head, seal, optLabel, grid, gradeLabel, gradeRow, foot);

        function sync() {
            const keys = pending ? pending.keys : [];
            const ok = pending ? targetGrades(keys, optMap) : [];
            tiles.forEach(t => t.setAttribute('aria-pressed', String(keys.length ? keys.includes(t.dataset.pfOption) : t.dataset.pfOption === '')));
            facets.forEach(f => {
                const g = f.dataset.pfGrade;
                f.disabled = !pending || !ok.includes(g);
                f.setAttribute('aria-pressed', String(!!pending && pending.grade === g));
            });
            seal.dataset.grade = pending ? pending.grade : '';
            seal.classList.toggle('is-set', !!pending);
            sealName.textContent = pending ? targetName(pending, optMap, true) : '조건 없음';
            sealGrade.textContent = pending ? keys.length + '개 중 하나가 ' + GRADE_LABEL[pending.grade] + ' 이상이면 충족' : '이 조건은 검사하지 않음';
            gradeHint.textContent = pending ? '' : '조건 없음은 등급을 고르지 않습니다';
        }
        function pickOption(key) {
            const o = optMap.get(key);
            if (!o) pending = null;
            else {
                const keys = pending ? [...pending.keys] : [];
                const index = keys.indexOf(key);
                if (index >= 0) keys.splice(index, 1); else keys.push(key);
                const ok = targetGrades(keys, optMap);
                const prev = pending && pending.grade;
                pending = keys.length ? { keys, grade: ok.includes(prev) ? prev : ok[0] } : null;
            }
            sync();
            play('select');
        }
        function pickGrade(g) {
            if (!pending) return;
            pending = { keys: pending.keys, grade: g };
            sync();
            play('select', g);
        }
        function close(commit) {
            overlay.remove();
            if (scroller) {
                scroller.classList.remove('pf-locked');
                scroller.scrollTop = keepScroll;
            }
            if (commit) {
                play('lamp');
                onConfirm(pending);
            }
            if (trigger.isConnected) trigger.focus({ preventScroll: true });
        }
        function keepVisible(el) {
            if (el.parentNode !== grid) return;
            const top = el.offsetTop;
            const bottom = top + el.offsetHeight;
            if (top < grid.scrollTop) grid.scrollTop = top - 6;
            else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight + 6;
        }
        // 방향키: 타일 격자는 칸 단위, 등급 줄은 좌우 한 칸씩
        function arrowNav(e) {
            const inGrid = tiles.includes(document.activeElement);
            const list = inGrid ? tiles : facets.filter(f => !f.disabled);
            const i = list.indexOf(document.activeElement);
            if (i < 0) return false;
            let cols = 1;
            if (inGrid) {
                const top = list[0].offsetTop;
                cols = list.findIndex(n => n.offsetTop !== top);
                if (cols < 1) cols = list.length;
            }
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
            let j;
            if (e.key === 'Home') j = 0;
            else if (e.key === 'End') j = list.length - 1;
            else if (step != null) j = Math.max(0, Math.min(list.length - 1, i + step));
            else return false;
            list[j].focus({ preventScroll: true });
            keepVisible(list[j]);
            return true;
        }
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(false);
                return;
            }
            if (e.key === 'Tab') {
                const items = [...panel.querySelectorAll('button')].filter(b => !b.disabled && b.getClientRects().length);
                if (!items.length) return;
                const first = items[0];
                const last = items[items.length - 1];
                const inside = panel.contains(document.activeElement);
                if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
                return;
            }
            if (arrowNav(e)) e.preventDefault();
        });
        // 석판 바깥(어두운 막)을 누르면 취소
        overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });

        sync();
        shell.append(overlay);
        if (scroller) scroller.classList.add('pf-locked');
        play('select');
        // 중간 행부터 잘려 보이지 않도록 목록은 처음부터 연다. 선택값은 상단 미리보기에 유지한다.
        tiles[0].focus({ preventScroll: true });
        grid.scrollTop = 0;
    }

    // ---------- 자동 각인 진행 화면 ----------
    function renderRunning(root, model, actions) {
        const st = stateOf(root);
        const run = model.run || {};
        if (st.view !== 'running' || !st.run || st.run.id !== run.id) buildRunning(root, st, model);
        st.run.actions = actions;
        patchRunning(st, st.run, model);
    }

    function buildRunning(root, st, model) {
        leaveView(st);
        const info = model.info || {};
        const eq = model.equipment || {};
        const run = model.run || {};
        const res = model.result;
        const optMap = optionMap(info);
        const targets = normTargets(model.targets, optMap);
        const original = (res && res.old) || info.current || {};
        const r = { id: run.id, targets, prevRolls: -1, prevMatched: [false, false, false], prevTier: null, sealed: false, actions: null };

        const shell = h('div', 'pf-shell is-running');
        r.shell = shell;
        shell.setAttribute('role', 'region');
        shell.setAttribute('aria-label', '자동 각인 진행');
        shell.append(header('자동 각인', eqTitle(eq), null));

        const body = h('div', 'pf-body');
        const forge = h('div', 'pf-col pf-col-forge');
        const startTier = (res && res.new && res.new.tierKey) || original.tierKey;
        const startLabel = (res && res.new && res.new.tierLabel) || original.tierLabel;
        const c = coreNode(eq, null, 'running');
        const s = stageNode(eq, startTier, startLabel, c.core);
        r.stage = s.stage;
        r.crest = s.crest;
        r.core = c.core;
        r.gems = c.gems;
        r.fx = c.fx;
        c.core.append(sparks(10, 'pf-embers'));

        const counter = h('div', 'pf-counter');
        r.counterNum = h('b', 'pf-counter-n', '0');
        r.counterHost = h('span', 'pf-counter-host');
        r.counterHost.append(r.counterNum);
        counter.append(r.counterHost, h('span', 'pf-counter-u', '회째 각인'));
        r.status = h('span', 'pf-status');
        r.status.setAttribute('role', 'status');
        s.stage.append(counter, r.status);

        const stats = h('dl', 'pf-stats');
        const stat = (k, cls) => {
            const d = h('div', 'pf-stat' + (cls ? ' ' + cls : ''));
            const v = h('dd');
            d.append(h('dt', null, k), v);
            stats.append(d);
            return { d, v };
        };
        r.spent = stat('소모 골드', 'is-wide');
        r.bar = h('div', 'pf-spend-bar');
        r.barFill = h('i');
        r.bar.append(r.barFill);
        r.bar.setAttribute('aria-hidden', 'true');
        r.spent.d.append(r.bar);
        r.remain = stat('남은 한도');
        r.gold = stat('보유 골드');
        r.jewel = model.jewel && model.jewel !== 'none' ? stat(JEWEL_NAME[model.jewel] + ' 사용') : null;
        forge.append(s.stage, stats);

        const right = h('div', 'pf-col');
        const goals = [0, 1, 2].map(() => ({ text: '' }));
        const cand = tablet(res && res.new, '최신 후보', 'is-candidate is-rolling', goals);
        r.cand = cand;
        r.tierBanner = h('div', 'pf-tier-banner');
        r.tierBanner.setAttribute('aria-live', 'polite');
        cand.el.append(r.tierBanner);
        const keep = tablet(original, '보관 중인 원래 잠재', 'is-kept is-compact');
        r.conditions = conditionSummary(targets, optMap);
        right.append(r.conditions.el, cand.el, keep.el);
        body.append(forge, right);
        shell.append(body);

        const footer = h('footer', 'pf-footer');
        r.footer = footer;
        r.stopBtn = button('pf-btn-stop', () => call(r.actions && r.actions.onStop));
        r.stopBtn.dataset.pfFocus = 'stop';
        r.stopLabel = h('span', null, '각인 멈추기');
        r.stopBtn.append(h('span', 'pf-stop-mark'), r.stopLabel);
        r.speed = speedControl(model.speed, speed => { r.shell.style.setProperty('--pf-speed', String(speed)); call(r.actions && r.actions.onSpeed, speed); });
        footer.append(r.speed.el, r.stopBtn, h('p', 'pf-auto-hint', '진행한 최대 3회 중 마지막 결과를 보관합니다. 원래 잠재능력은 유지됩니다.'));
        shell.append(footer);

        st.run = r;
        mount(root, st, 'running', shell);
    }

    function patchRunning(st, r, model) {
        const info = model.info || {};
        const run = model.run || {};
        const res = model.result;
        const rolls = num(run.rolls);
        const fresh = rolls !== r.prevRolls;
        const entries = (res && res.new && res.new.entries) || [];
        const running = run.status === 'running';
        r.speed.sync(model.speed);
        r.shell.style.setProperty('--pf-speed', String(model.speed || 1));

        r.core.dataset.mode = running ? 'running' : 'halt';
        if (fresh) {
            const n = h('b', 'pf-counter-n' + (r.prevRolls >= 0 ? ' is-bump' : ''), fmt(rolls));
            r.counterHost.replaceChildren(n);
            if (rolls > 0) {
                r.cand.lines.forEach((ln, i) => {
                    const t = h('span', 'pf-line-text pf-land');
                    ln.text.replaceWith(t);
                    ln.text = t;
                    fillLine(ln, entries[i]);
                });
                setGems(r.gems, entries);
                const pulse = h('span', 'pf-pulse');
                r.fx.replaceChildren(pulse);
                if (r.prevRolls >= 0) play('tick');
            }
            r.prevRolls = rolls;
        }

        // 티어: 진행 중 승급이 일어나면 한 번만 크게 알린다
        const tierKey = res && res.new && res.new.tierKey;
        if (tierKey) {
            r.cand.el.dataset.tier = tierKey;
            r.stage.dataset.tier = tierKey;
            r.cand.tier.textContent = res.new.tierLabel || '';
            r.crest.textContent = res.new.tierLabel || '';
            if (r.prevTier && tierIdx(tierKey) > tierIdx(r.prevTier)) {
                const b = h('div', 'pf-tier-flash', '티어 승급! ' + (res.currentTierLabel || '') + ' → ' + (res.nextTierLabel || res.new.tierLabel || ''));
                r.tierBanner.replaceChildren(b);
                const burst = sparks(14, 'pf-burst');
                r.fx.append(burst);
                play('tier');
            }
            r.prevTier = tierKey;
        }

        // 조건별 충족과 각 줄에 배정된 조건은 서버 판정을 따른다.
        r.conditions.sync(run.matched);
        r.cand.lines.forEach((ln, i) => {
            const on = setLineCondition(ln, run, i);
            if (on && !r.prevMatched[i]) {
                ln.el.classList.remove('is-hit');
                void ln.el.offsetWidth;
                ln.el.classList.add('is-hit');
                play('lamp');
            }
            r.prevMatched[i] = on;
        });

        const limit = run.goldLimit == null ? null : num(run.goldLimit);
        const spent = num(run.spent);
        r.spent.v.textContent = fmt(spent) + (limit == null ? ' / 보유 골드 전부' : ' / ' + fmt(limit));
        r.bar.hidden = limit == null;
        if (limit) r.barFill.style.width = Math.min(100, spent / limit * 100).toFixed(1) + '%';
        r.remain.v.textContent = limit == null ? '제한 없음' : fmt(Math.max(0, limit - spent));
        r.gold.v.textContent = fmt(info.gold);
        if (r.jewel) r.jewel.v.textContent = fmt(run.jewelUsed) + '개 (남은 ' + fmt((info.jewels || {})[model.jewel]) + '개)';

        const stopInfo = STOP_TEXT[run.stopReason];
        r.status.dataset.state = running ? 'running' : (stopInfo ? stopInfo.tone : 'halt');
        r.status.textContent = running ? (rolls ? '각인 중' : '각인로 점화 중') : (stopInfo ? stopInfo.title : '멈추는 중');
        r.cand.el.classList.toggle('is-rolling', running);
        r.stopBtn.disabled = !running;
        r.stopLabel.textContent = running ? '각인 멈추기' : '정리 중…';

        if (!running && run.stopReason === 'matched' && !r.sealed) {
            r.sealed = true;
            const seal = h('div', 'pf-seal');
            seal.setAttribute('aria-hidden', 'true');
            seal.append(h('span', null, '목표 달성'));
            r.core.append(seal);
            r.fx.append(sparks(16, 'pf-burst is-win'));
            st.wonRun = r.id;
            play('win');
        }
    }

    // ---------- 결과 화면 ----------
    function renderResult(root, model, actions) {
        const st = stateOf(root);
        st.run = null;
        const info = model.info || {};
        const eq = model.equipment || {};
        const res = model.result;
        const run = model.run || null;
        const busy = !!model.busy;
        const optMap = optionMap(info);
        const targets = normTargets(model.targets, optMap);

        if (!res || !res.new) {
            clearTimers(st);
            renderEmptyResult(root, st, model, actions, run);
            return;
        }

        const newEntries = res.new.entries || [];
        const key = [run ? run.id : 'single', res.new.tierKey].concat(newEntries.map(e => (e.grade || '') + ':' + (e.text || ''))).join('|');
        // 같은 결과를 연출 도중 다시 그리면 처음부터 다시 하지 않고 이어서 재생한다 (소리 예약도 유지)
        const fresh = st.revealKey !== key;
        if (fresh) {
            clearTimers(st);
            st.revealKey = key;
            st.revealAt = Date.now();
        }
        const elapsed = fresh ? 0 : Date.now() - st.revealAt;
        const settled = elapsed >= REVEAL_END;

        const stop = run && STOP_TEXT[run.stopReason];
        const tone = stop ? stop.tone : (res.upgraded ? 'win' : 'plain');
        const title = stop ? stop.title : (res.upgraded ? '티어 승급!' : '각인 완료');
        const sub = stop ? stop.sub : '새 잠재능력이 떠올랐습니다. 적용할지 직접 고르세요.';
        const best = newEntries.reduce((m, e) => Math.max(m, gradeIdx(e.grade)), 0);
        const big = res.upgraded || tone === 'win' || best >= 3;

        const shell = h('div', 'pf-shell is-result' + (settled ? ' pf-settled' : '') + (res.upgraded ? ' is-tier' : '') + (big ? ' is-big' : ''));
        shell.setAttribute('role', 'region');
        shell.setAttribute('aria-label', '각인 결과');
        shell.dataset.tone = tone;
        if (!settled && elapsed > 0) shell.style.setProperty('--t0', -Math.round(elapsed) + 'ms');
        shell.append(header('각인 결과', eqTitle(eq), actions.onClose, '닫기 (결과는 보관됩니다)'));

        // 무대: 에너지 수렴(예비 동작) → 금속 타격과 충격파 → 꽃피는 빛 → 줄별 공개
        const c = coreNode(eq, newEntries, 'result');
        const s = stageNode(eq, res.new.tierKey, res.new.tierLabel, c.core);
        s.stage.classList.add('is-reveal');
        s.stage.dataset.burst = res.upgraded ? 'tier' : GRADES[best];
        s.stage.style.setProperty('--impact', IMPACT_AT + 'ms');
        if (big) c.fx.append(h('span', 'pf-rays pf-fx'));
        c.fx.append(
            h('span', 'pf-gather pf-fx'),
            sparks(18, 'pf-converge pf-fx'),
            h('span', 'pf-shock pf-fx'),
            h('span', 'pf-shock pf-fx is-echo'),
            h('span', 'pf-clang pf-fx'),
            h('span', 'pf-bloom pf-fx')
        );
        if (big) c.fx.append(h('span', 'pf-shock pf-fx is-final'), sparks(16, 'pf-burst pf-fx is-late'));
        c.gems.forEach((g, i) => {
            g.classList.add('pf-intro');
            g.style.setProperty('--d', (LINE_AT + LINE_GAP * i) + 'ms');
        });

        const headline = h('div', 'pf-headline pf-intro');
        headline.style.setProperty('--d', (tone === 'win' ? FINALE_AT - 120 : 280) + 'ms');
        headline.setAttribute('role', 'status');
        headline.append(h('strong', 'pf-headline-t', title), h('span', 'pf-headline-s', sub));
        s.stage.append(headline);

        const body = h('div', 'pf-body is-result');
        const lead = h('div', 'pf-col pf-col-forge');
        lead.append(s.stage);
        if (res.upgraded) {
            const banner = h('div', 'pf-tier-up pf-intro');
            banner.style.setProperty('--d', FINALE_AT + 'ms');
            banner.append(h('span', 'pf-tier-up-k', '티어 승급'), h('b', null, (res.currentTierLabel || (res.old && res.old.tierLabel) || '') + ' → ' + (res.nextTierLabel || res.new.tierLabel || '')));
            lead.append(banner);
        }
        if (res.combatPower) lead.append(powerNode(res.combatPower));
        const summary = summaryNode(res, run);
        if (summary) lead.append(summary);

        // 이전 / 이후 비교
        const cmp = h('div', 'pf-compare');
        const before = tablet(res.old, '이전 잠재', 'is-before');
        const goals = run && targets.some(Boolean) ? [0, 1, 2].map(() => ({ text: '' })) : null;
        const after = tablet(res.new, '새 잠재', 'is-after', goals);
        const matched = run && Array.isArray(run.matched) ? run.matched : [];
        after.lines.forEach((ln, i) => {
            ln.el.classList.add('pf-intro', 'pf-reveal');
            ln.el.style.setProperty('--d', (LINE_AT + LINE_GAP * i) + 'ms');
            const g = gradeIdx(ln.el.dataset.grade);
            if (g >= 2) ln.el.append(sparks(g >= 3 ? 10 : 6, 'pf-line-sparks pf-fx'));
            if (goals) setLineCondition(ln, run, i);
        });
        const arrow = h('div', 'pf-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        cmp.append(before.el, arrow, after.el);
        if (goals) {
            const need = targets.filter(Boolean).length;
            const hit = targets.filter((t, i) => t && matched[i]).length;
            const tally = h('p', 'pf-tally pf-intro' + (hit === need ? ' is-full' : ''), '조건 ' + hit + ' / ' + need + '개 충족');
            tally.style.setProperty('--d', FINALE_AT + 'ms');
            const conditions = conditionSummary(targets, optMap);
            conditions.sync(matched);
            cmp.append(tally, conditions.el);
        }
        const right = h('div', 'pf-col');
        right.append(cmp);
        right.append(h('p', 'pf-warn' + (res.upgraded ? ' is-strong' : ''), res.upgraded
            ? '원래 잠재를 유지하면 이번 티어 승급도 함께 사라집니다. 쓴 골드와 쥬얼은 돌아오지 않습니다.'
            : '어느 쪽을 골라도 쓴 골드와 쥬얼은 돌아오지 않습니다.'));
        body.append(lead, right);
        shell.append(body);

        const footer = h('footer', 'pf-footer');
        if (model.error) footer.append(errorNode(model.error));
        const keepBtn = button('pf-btn-iron', () => call(actions.onKeep), '원래 잠재 유지');
        keepBtn.dataset.pfFocus = 'keep';
        keepBtn.disabled = busy;
        const applyBtn = button('pf-btn-brass', () => call(actions.onApply));
        applyBtn.dataset.pfFocus = 'apply';
        applyBtn.disabled = busy;
        applyBtn.append(h('span', 'pf-btn-sigil'), h('span', null, busy ? '처리 중…' : '새 잠재 적용'));
        const btns = h('div', 'pf-actions');
        btns.append(keepBtn, applyBtn);
        footer.append(btns);
        shell.append(footer);

        mount(root, st, 'result', shell);

        // 소리는 처음 공개할 때 한 번만 예약한다. 진행 화면에서 이미 승리음을 냈다면 다시 끊고 틀지 않는다.
        if (fresh) {
            newEntries.slice(0, 3).forEach((e, i) => later(st, LINE_AT + LINE_GAP * i, () => play('line', e.grade)));
            const finale = res.upgraded ? 'tier' : tone === 'win' ? 'win' : tone === 'plain' ? 'lamp' : 'halt';
            if (!(finale === 'win' && run && st.wonRun === run.id)) later(st, FINALE_AT, () => play(finale));
        }
    }

    function renderEmptyResult(root, st, model, actions, run) {
        const info = model.info || {};
        const eq = model.equipment || {};
        const stop = run && STOP_TEXT[run.stopReason];
        const current = info.current || {};
        st.revealKey = '';

        const shell = h('div', 'pf-shell is-result is-empty');
        shell.setAttribute('role', 'region');
        shell.setAttribute('aria-label', '각인 결과');
        shell.dataset.tone = stop ? stop.tone : 'halt';
        shell.append(header('각인 결과', eqTitle(eq), actions.onClose, '닫기'));

        const c = coreNode(eq, current.entries, 'halt');
        const s = stageNode(eq, current.tierKey || info.currentTier, current.tierLabel || info.currentTierLabel, c.core);
        const headline = h('div', 'pf-headline');
        headline.setAttribute('role', 'status');
        headline.append(h('strong', 'pf-headline-t', stop ? stop.title : '각인되지 않음'), h('span', 'pf-headline-s', (stop ? stop.sub + ' ' : '') + '한 번도 각인되지 않아 잠재능력은 그대로입니다.'));
        s.stage.append(headline);

        const body = h('div', 'pf-body is-result');
        const lead = h('div', 'pf-col pf-col-forge');
        lead.append(s.stage);
        const right = h('div', 'pf-col');
        right.append(tablet(current, '현재 잠재능력 (변화 없음)', 'is-current').el);
        body.append(lead, right);
        shell.append(body);

        const footer = h('footer', 'pf-footer');
        if (model.error) footer.append(errorNode(model.error));
        const btns = h('div', 'pf-actions');
        const closeBtn = button('pf-btn-iron', () => call(actions.onClose), '닫기');
        closeBtn.dataset.pfFocus = 'close-foot';
        btns.append(closeBtn);
        if (typeof actions.onAgain === 'function') {
            const again = button('pf-btn-brass', () => actions.onAgain(), '각인로로 돌아가기');
            again.dataset.pfFocus = 'again';
            again.disabled = !!model.busy;
            btns.append(again);
        }
        footer.append(btns);
        shell.append(footer);
        mount(root, st, 'result', shell);
    }

    function powerNode(p) {
        const diff = Math.round(Number(p.diff) || 0);
        const box = h('div', 'pf-power pf-intro');
        box.style.setProperty('--d', FINALE_AT + 'ms');
        box.dataset.dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
        const cell = (k, v, cls) => {
            const d = h('div', 'pf-power-cell ' + cls);
            d.append(h('span', null, k), h('b', null, v));
            return d;
        };
        box.append(
            cell('이전 전투력', fmt(p.old), 'is-old'),
            cell('변화', (diff > 0 ? '+' : diff < 0 ? '−' : '±') + fmt(Math.abs(diff)), 'is-delta'),
            cell('새 전투력', fmt(p.new), 'is-new')
        );
        return box;
    }

    function summaryNode(res, run) {
        const chips = [];
        if (run) {
            chips.push('각인 ' + fmt(run.rolls) + '회');
            chips.push('골드 ' + fmt(run.spent));
            if (num(run.jewelUsed) > 0) chips.push('쥬얼 ' + fmt(run.jewelUsed) + '개');
        } else {
            if (res.cost != null) chips.push('골드 ' + fmt(res.cost));
            if (typeof res.useJewel === 'string' && JEWEL_NAME[res.useJewel] && res.useJewel !== 'none') chips.push(JEWEL_NAME[res.useJewel] + ' 1개');
            else if (res.useJewel === true) chips.push('쥬얼 1개');
        }
        if (!chips.length) return null;
        const box = h('ul', 'pf-summary');
        box.setAttribute('aria-label', '소모 요약');
        chips.forEach(c => box.append(h('li', null, c)));
        return box;
    }

    function destroy(root) {
        if (!root) return;
        const st = states.get(root);
        if (st) {
            clearTimers(st);
            states.delete(root);
        }
        root.replaceChildren();
        root.classList.remove('potential-forge');
        delete root.dataset.pfView;
        const scroller = root.closest('.pot-wrap');
        if (scroller) scroller.classList.remove('pf-locked');
        stopSound();
    }

    window.PotentialForge = { renderSetup, renderRunning, renderResult, destroy };
})();
