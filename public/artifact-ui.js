// 아티팩트 재설정 패널. 부모(app.js)가 장비 메뉴에서 root를 열고 ArtifactUI.render(root, view, { submit })를 호출한다.
// 변수칸(조건값·능력·n)을 각각 잠그고, 비용 = 100 × 10^잠금수. 성공 후 결과 반영(render 재호출)은 부모 담당.
(() => {
    'use strict';

    const BASE_COST = 100;
    const CONFIRM_COST = 1000000;
    const ARM_MS = 4000;
    const FLASH_MS = 900;
    const FIELDS = [
        { key: 'condition', label: '조건' },
        { key: 'ability', label: '능력' },
        { key: 'n', label: '수치' }
    ];
    const OPTION_NO = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
    const RARITY = {
        rare: { key: 'rare', label: '레어' },
        unique: { key: 'unique', label: '유니크' },
        legendary: { key: 'legendary', label: '레전더리' }
    };
    const RARITY_ALIAS = { '레어': 'rare', '유니크': 'unique', '레전더리': 'legendary' };
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const states = new WeakMap();

    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
    }
    function setText(n, text) {
        text = String(text);
        if (n.textContent !== text) n.textContent = text;
    }
    // disabled 대신 aria-disabled — 누르던 버튼의 초점을 유지한다
    function setDisabled(b, on) {
        if (on) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
    }
    const fmt = v => Math.max(0, Math.round(Number(v) || 0)).toLocaleString('ko-KR');
    const rarityOf = r => RARITY[RARITY_ALIAS[r] || String(r || '').toLowerCase()] || RARITY.rare;
    const costOf = count => BASE_COST * Math.pow(10, count);
    const valueOf = (opt, field) => field === 'condition' ? opt.conditionValue : (field === 'ability' ? (opt.abilityLabel || opt.ability) : opt.n);

    function lockIcon() {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('af-lock-ico');
        const shackle = document.createElementNS(SVG_NS, 'path');
        shackle.setAttribute('class', 'af-shackle');
        shackle.setAttribute('d', 'M5 7V5a3 3 0 0 1 6 0v2');
        const body = document.createElementNS(SVG_NS, 'rect');
        body.setAttribute('x', '3');
        body.setAttribute('y', '7');
        body.setAttribute('width', '10');
        body.setAttribute('height', '7');
        body.setAttribute('rx', '1');
        svg.append(shackle, body);
        return svg;
    }

    function build(root, view, locks) {
        const rarity = rarityOf(view.rarity);
        const options = Array.isArray(view.options) ? view.options : [];
        const st = { root, uid: view.uid, shape: shapeOf(view), locks, view: null, submit: null, pending: false, err: '', armedUntil: 0, armTimer: 0, rows: [] };
        const wrap = node('div', 'af');
        wrap.dataset.rarity = rarity.key;

        st.wrap = wrap;
        const head = node('div', 'af-head');
        st.title = node('b', 'af-title', '아티팩트 재설정');
        head.append(node('span', 'af-rarity', rarity.label), st.title);
        const uses = node('div', 'af-uses');
        st.usesText = node('span', 'af-uses-t');
        st.pips = node('span', 'af-pips');
        uses.append(st.usesText, st.pips);
        head.append(uses);

        const list = node('div', 'af-opts');
        options.forEach((opt, i) => {
            const row = node('div', 'af-opt');
            const top = node('div', 'af-opt-head');
            const tpl = node('span', 'af-tpl');
            const state = node('span', 'af-state');
            top.append(node('span', 'af-opt-no', OPTION_NO[i] || String(i + 1)), tpl, node('span', 'af-fixed', '고정'), state);
            const cells = node('div', 'af-cells');
            const cellNodes = FIELDS.map(f => {
                const key = i + '.' + f.key;
                const b = node('button', 'af-cell');
                b.type = 'button';
                b.dataset.field = f.key;
                const v = node('b', 'af-cell-v');
                const lk = node('span', 'af-cell-lock');
                lk.append(lockIcon(), node('span', 'af-cell-lock-t'));
                b.append(node('span', 'af-cell-k', f.label), v, lk);
                b.addEventListener('click', () => {
                    if (b.getAttribute('aria-disabled') === 'true' || st.pending) return;
                    if (st.locks.has(key)) st.locks.delete(key); else st.locks.add(key);
                    disarm(st);
                    patch(st);
                });
                cells.append(b);
                return { key, field: f.key, label: f.label, b, v, lockText: lk.lastChild };
            });
            row.append(top, cells);
            list.append(row);
            st.rows.push({ row, tpl, state, cells: cellNodes });
        });

        // 발현도 — 지금 충족한 옵션의 n 합계, 임계치 보너스는 누적
        const mani = node('section', 'af-mani');
        const maniHead = node('div', 'af-mani-head');
        st.maniVal = node('b', 'af-mani-v');
        maniHead.append(node('span', 'af-mani-k', '발현도'), st.maniVal, node('span', 'af-mani-note', '충족 수치 합계 (보너스 누적)'));
        const track = node('div', 'af-track');
        st.maniFill = node('i', 'af-track-fill');
        track.append(st.maniFill);
        st.maniTicks = node('div', 'af-ticks');
        st.bonusList = node('div', 'af-bonus');
        mani.append(maniHead, track, st.maniTicks, st.bonusList);
        st.mani = mani;

        const foot = node('div', 'af-foot');
        const costRow = node('div', 'af-cost');
        st.lockCount = node('span', 'af-cost-k');
        st.cost = node('b', 'af-cost-v');
        costRow.append(st.lockCount, st.cost);
        const goldRow = node('div', 'af-gold');
        st.gold = node('span');
        st.next = node('span', 'af-next');
        goldRow.append(st.gold, st.next);
        st.block = node('div', 'af-block');
        st.block.setAttribute('role', 'status');
        st.confirm = node('div', 'af-confirm');
        st.confirm.setAttribute('role', 'alert');
        st.submitBtn = node('button', 'af-submit');
        st.submitBtn.type = 'button';
        st.submitBtn.addEventListener('click', () => onSubmit(st));
        st.errEl = node('div', 'af-err');
        st.errEl.setAttribute('role', 'alert');
        // 다른 플레이어 장비 — 비용·실행 대신 열람 안내만 둔다
        const ro = node('div', 'af-ro');
        ro.append(node('b', 'af-ro-k', '열람'), node('span', 'af-ro-t', '장비 주인만 재설정할 수 있습니다'));
        foot.append(costRow, goldRow, st.block, st.confirm, st.submitBtn, st.errEl, ro);

        wrap.append(head, list, mani, foot);
        root.replaceChildren(wrap);
        return st;
    }

    function shapeOf(view) {
        const n = Array.isArray(view.options) ? view.options.length : 0;
        return String(view.uid) + '|' + n + '|' + rarityOf(view.rarity).key;
    }

    function compute(st) {
        const v = st.view;
        const total = st.rows.length * FIELDS.length;
        const count = st.locks.size;
        const cost = costOf(count);
        const maxRerolls = Math.max(0, Number(v.maxRerolls) || 0);
        const remain = Math.max(0, maxRerolls - Math.max(0, Number(v.rerollsUsed) || 0));
        const gold = Math.max(0, Number(v.gold) || 0);
        let block = '';
        if (typeof st.submit !== 'function') block = '아티팩트 옵션 보기';
        else if (remain <= 0) block = '재설정 횟수 소진: ' + maxRerolls + '/' + maxRerolls + ' 사용';
        else if (!total) block = '바꿀 옵션 없음';
        else if (count >= total) block = '모든 칸이 잠겨 있어 재설정할 수 없습니다';
        else if (gold < cost) block = '골드 부족: ' + fmt(cost - gold) + ' 더 필요';
        const reasons = [];
        if (cost >= CONFIRM_COST) reasons.push('고액 ' + fmt(cost) + ' 골드');
        if (remain === 1) reasons.push('마지막 재설정');
        return { total, count, cost, remain, maxRerolls, gold, block, reasons };
    }

    function patch(st) {
        const v = st.view;
        const c = compute(st);
        const options = Array.isArray(v.options) ? v.options : [];

        setText(st.usesText, '남은 재설정 ' + c.remain + ' / ' + c.maxRerolls);
        if (st.pips.childElementCount !== c.maxRerolls) st.pips.replaceChildren(...Array.from({ length: c.maxRerolls }, () => node('i')));
        Array.from(st.pips.children).forEach((p, i) => p.classList.toggle('on', i < c.remain));

        const readonly = typeof st.submit !== 'function';
        st.wrap.dataset.readonly = readonly ? '1' : '';
        setText(st.title, readonly ? '아티팩트 옵션' : '아티팩트 재설정');
        const lockedOut = readonly || c.remain <= 0 || st.pending;
        st.rows.forEach((r, i) => {
            const opt = options[i] || {};
            const active = !!opt.active;
            r.row.dataset.active = active ? '1' : '0';
            setText(r.tpl, opt.conditionLabel || '');
            setText(r.state, active ? '✓ 충족' : '✕ 미충족');
            r.cells.forEach(cell => {
                const locked = !readonly && st.locks.has(cell.key);
                const val = valueOf(opt, cell.field);
                setText(cell.v, val == null || val === '' ? '-' : val);
                cell.b.setAttribute('aria-pressed', locked ? 'true' : 'false');
                cell.b.setAttribute('aria-label', cell.label + ' ' + (val == null ? '' : val) + (readonly ? '' : locked ? ' (잠금)' : ' (잠금 해제)'));
                setText(cell.lockText, locked ? '잠금' : '');
                setDisabled(cell.b, lockedOut);
            });
        });

        const bonuses = Array.isArray(v.bonuses) ? v.bonuses : [];
        const showMani = rarityOf(v.rarity).key === 'legendary' || bonuses.length > 0;
        st.mani.hidden = !showMani;
        if (showMani) patchMani(st, v, bonuses);

        setText(st.lockCount, '잠금 ' + c.count + '칸 / ' + c.total);
        setText(st.cost, fmt(c.cost) + ' 골드');
        setText(st.gold, '보유 ' + fmt(c.gold) + ' 골드');
        setText(st.next, c.count < c.total ? '1칸 더 잠그면 ' + fmt(costOf(c.count + 1)) : '');
        st.block.hidden = !c.block;
        setText(st.block, c.block ? '✕ ' + c.block : '');

        const armed = !c.block && st.armedUntil > Date.now();
        if (!armed && st.armedUntil) st.armedUntil = 0;
        st.confirm.hidden = !armed;
        setText(st.confirm, armed ? c.reasons.join(', ') + '. 한 번 더 누르면 확정됩니다.' : '');
        st.submitBtn.dataset.armed = armed ? '1' : '';
        setText(st.submitBtn, st.pending ? '재설정 중'
            : c.block ? '재설정 불가'
            : armed ? '확정 (' + fmt(c.cost) + ' 골드)'
            : '재설정 (' + fmt(c.cost) + ' 골드)');
        setDisabled(st.submitBtn, !!c.block || st.pending);
        st.submitBtn.setAttribute('aria-busy', st.pending ? 'true' : 'false');
        st.errEl.hidden = !st.err;
        setText(st.errEl, st.err ? '✕ ' + st.err : '');
    }

    function patchMani(st, v, bonuses) {
        const val = Math.max(0, Number(v.manifestation) || 0);
        const top = Math.max(30, ...bonuses.map(b => Number(b.threshold) || 0));
        setText(st.maniVal, val);
        st.maniFill.style.transform = 'scaleX(' + Math.min(1, val / top) + ')';
        const sig = bonuses.map(b => b.threshold + ':' + b.label).join('|') + '|' + top;
        if (st.maniSig !== sig) {
            st.maniSig = sig;
            st.maniTicks.replaceChildren(...bonuses.map(b => {
                const t = node('span', 'af-tick', b.threshold);
                t.style.left = Math.min(100, (Number(b.threshold) || 0) / top * 100) + '%';
                return t;
            }));
            st.bonusRows = bonuses.map(b => {
                const row = node('div', 'af-bonus-row');
                const mark = node('span', 'af-bonus-mark');
                const state = node('span', 'af-bonus-state');
                row.append(mark, node('b', 'af-bonus-th', b.threshold), node('span', 'af-bonus-label', b.label || ''), state);
                return { row, mark, state, threshold: Number(b.threshold) || 0 };
            });
            st.bonusList.replaceChildren(...st.bonusRows.map(r => r.row));
        }
        Array.from(st.maniTicks.children).forEach((t, i) => t.classList.toggle('on', !!(bonuses[i] && bonuses[i].active)));
        st.bonusRows.forEach((r, i) => {
            const on = !!(bonuses[i] && bonuses[i].active);
            r.row.dataset.active = on ? '1' : '0';
            setText(r.mark, on ? '✓' : '');
            setText(r.state, on ? '적용' : (r.threshold - val) + ' 부족');
        });
    }

    // 직전 결과와 달라진 변수칸만 짧게 표시
    function markChanges(st, prev, next) {
        if (!prev || String(prev.uid) !== String(next.uid)) return;
        const a = Array.isArray(prev.options) ? prev.options : [];
        const b = Array.isArray(next.options) ? next.options : [];
        st.rows.forEach((r, i) => {
            r.cells.forEach(cell => {
                if (!a[i] || !b[i] || String(valueOf(a[i], cell.field)) === String(valueOf(b[i], cell.field))) return;
                cell.b.classList.remove('changed');
                void cell.b.offsetWidth;
                cell.b.classList.add('changed');
                setTimeout(() => cell.b.classList.remove('changed'), FLASH_MS);
            });
        });
    }

    function disarm(st) {
        st.armedUntil = 0;
        clearTimeout(st.armTimer);
    }

    async function onSubmit(st) {
        if (st.pending) return;
        const c = compute(st);
        if (c.block) return;
        // 고액·마지막 1회는 같은 버튼 2단 확인 하나로 통일
        if (c.reasons.length && !(st.armedUntil > Date.now())) {
            st.armedUntil = Date.now() + ARM_MS;
            clearTimeout(st.armTimer);
            st.armTimer = setTimeout(() => { if (states.get(st.root) === st) patch(st); }, ARM_MS + 20);
            patch(st);
            return;
        }
        disarm(st);
        if (typeof st.submit !== 'function') return;
        st.pending = true;
        st.err = '';
        patch(st);
        const order = key => { const [i, f] = key.split('.'); return Number(i) * 10 + FIELDS.findIndex(x => x.key === f); };
        const locks = Array.from(st.locks).sort((x, y) => order(x) - order(y));
        try {
            await st.submit({ uid: st.view.uid, locks });
        } catch (e) {
            st.err = (e && e.message) || '재설정 실패';
        } finally {
            st.pending = false;
            if (states.get(st.root) === st) patch(st);
        }
    }

    function render(root, view, opts) {
        if (!root) return;
        let st = states.get(root);
        if (!view) {
            if (st) disarm(st);
            states.delete(root);
            root.replaceChildren();
            return;
        }
        const prev = st ? st.view : null;
        if (!st || st.shape !== shapeOf(view)) {
            // 같은 장비면 잠금을 이어서 쓴다 (재설정 직후 같은 칸을 계속 잠그는 흐름)
            const keep = st && String(st.uid) === String(view.uid) ? st.locks : new Set();
            if (st) disarm(st);
            st = build(root, view, keep);
            states.set(root, st);
        }
        st.view = view;
        st.submit = opts && opts.submit;
        const n = Array.isArray(view.options) ? view.options.length : 0;
        for (const key of Array.from(st.locks)) {
            const [i, f] = key.split('.');
            if (!(Number(i) < n) || !FIELDS.some(x => x.key === f)) st.locks.delete(key);
        }
        markChanges(st, prev, view);
        patch(st);
    }

    window.ArtifactUI = { render };
})();
