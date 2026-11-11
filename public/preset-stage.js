// 프리셋 무대. 왼쪽은 프리셋 칸 선반, 가운데는 장비와 카드를 걸어 둔 진열대, 오른쪽은 고른 품목의 감정대.
// 서버 API(/api/presets, save, apply, rename, unlock)와 요청 형식은 기존 프리셋 화면과 같다.
// 진열대는 지금 장착한 상태와 비교해, 적용하면 바뀌는 칸에 표식을 붙인다.
(() => {
    'use strict';
    const MS = window.MarketStage;
    const ACC = '#74d3ff', ACC2 = '#ffd873', LIVE = '#86e3b6', GARNET = '#e07bff';
    const EMPTY_CARD = '/static/assets/preset-empty-card.png';
    const GEAR_LEFT = [['weapon', '무기'], ['hat', '모자'], ['armor', '갑옷'], ['pants', '하의'], ['shoes', '신발']];
    const box = { data: null, loading: false, error: '' };
    const ui = { hover: '', focus: '', busy: false, sel: 'current', pick: 'main', railPage: 0, railFollow: true, stripPage: 0, inspectOpen: false, renaming: false, nameDraft: '', dialog: null, chooser: false, toast: null };
    let stage = null, opts = {}, toastTimer = 0, loadToken = 0;
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const two = i => String(i + 1).padStart(2, '0');
    const relTime = ts => !ts ? '' : typeof mailRelTime === 'function' ? mailRelTime(ts) : new Date(Number(ts)).toLocaleDateString('ko-KR');
    const isSlot = sel => sel !== 'current';
    const viewOf = sel => !box.data ? null : sel === 'current' ? box.data.current : box.data.presets[sel] || null;
    const locked = sel => isSlot(sel) && !!box.data && sel >= box.data.unlocked;
    const nameOf = sel => sel === 'current' ? '현재 장착' : (box.data?.presets[sel]?.name || '프리셋 ' + (sel + 1));
    // 빈 칸에는 저장될 모습(지금 장착)을 흐리게 미리 보여 준다.
    const ghostOf = sel => isSlot(sel) && !locked(sel) && !viewOf(sel) ? box.data?.current || null : null;

    // ── 칸 배치: 왼쪽 열 무기~신발, 오른쪽 열 장신구(보유 칸 수만큼), 보조, 아티팩트
    function sockets() {
        const n = Math.max(1, Number(box.data?.accessorySlots || 3));
        return [...GEAR_LEFT.map(([type, label]) => ({ type, label })),
            ...Array.from({ length: n }, (_, i) => ({ type: 'accessory', label: '장신구 ' + (i + 1), n: i })),
            { type: 'support', label: '보조' }, { type: 'artifact', label: '아티팩트' }];
    }
    function arrange(view) {
        const by = {};
        (view?.equipment || []).forEach(e => (by[e.type] ||= []).push(e));
        (by.accessory || []).sort((a, b) => String(a.slotKey ?? '').localeCompare(String(b.slotKey ?? ''), 'en', { numeric: true }));
        const used = {};
        return sockets().map(s => { const i = used[s.type] = (used[s.type] ?? -1) + 1; return (by[s.type] || [])[i] || null; });
    }
    // 적용하면 바뀌는 칸. 장비는 uid, 카드는 표시 이름(성급, 전직, 스킨 포함)으로 비교한다.
    // 적용은 장비와 슬롯 카드를 모두 내리고 프리셋 것만 다시 거는 순서라, 프리셋에 빈 칸이 있으면 그 칸도 비게 된다.
    function changes(sel) {
        const view = viewOf(sel), cur = box.data?.current;
        if (!isSlot(sel) || !view || !cur) return null;
        const S = sockets(), a = arrange(view), b = arrange(cur);
        const accOf = list => list.filter((e, i) => e && S[i].type === 'accessory').map(e => e.uid);
        const accA = new Set(accOf(a)), removed = accOf(b).filter(uid => !uid || !accA.has(uid)).length, accB = new Set(accOf(b));
        let emptyAcc = 0;
        const gear = S.map((s, i) => {
            if (s.type === 'accessory') {
                if (a[i]) return !accB.has(a[i].uid);
                return emptyAcc++ < removed;
            }
            if (!a[i] && !b[i]) return false;
            if (!a[i] || !b[i]) return true;
            return a[i].uid !== b[i].uid;
        });
        const main = !!view.mainCard && (view.mainCard.formatted || '') !== (cur.mainCard?.formatted || '');
        const pool = (cur.slotCards || []).map(c => c.formatted), n = cardSlots();
        const cards = Array.from({ length: n }, (_, j) => {
            const c = view.slotCards[j];
            if (!c) return false;
            const k = pool.indexOf(c.formatted); if (k < 0) return true; pool.splice(k, 1); return false;
        });
        const extra = pool.length;
        for (let j = view.slotCards.length; j < n && j - view.slotCards.length < extra; j++) cards[j] = true;
        const total = gear.filter(Boolean).length + (main ? 1 : 0) + cards.filter(Boolean).length;
        return { gear, main, cards, total };
    }
    const cardSlots = () => Math.max(1, Number(box.data?.cardSlots || 5));
    const isWorn = sel => { const c = changes(sel); return !!c && c.total === 0; };
    const hasLoadout = view => !!view && (!!view.mainCard || (view.slotCards || []).length > 0 || (view.equipment || []).length > 0);

    // ── 고른 품목
    function picked() {
        const view = viewOf(ui.sel) || ghostOf(ui.sel) || { equipment: [], slotCards: [], mainCard: null }, cur = box.data?.current, compare = isSlot(ui.sel) && !!viewOf(ui.sel) && cur;
        if (ui.pick === 'main') {
            const info = view.mainCard ? MS.identify(view.mainCard, 'card') : null;
            const other = compare && cur.mainCard && view.mainCard && cur.mainCard.formatted !== view.mainCard.formatted ? MS.identify(cur.mainCard, 'card') : null;
            return { info, label: '메인 카드', compare: other };
        }
        if (ui.pick[0] === 'c') {
            const j = Number(ui.pick.slice(1)), card = view.slotCards[j];
            return { info: card ? MS.identify(card, 'card') : null, label: '슬롯 카드 ' + (j + 1), compare: null };
        }
        const i = Number(ui.pick.slice(1)), S = sockets(), eq = arrange(view)[i], now = compare ? arrange(cur)[i] : null;
        const other = now && (!eq || now.uid !== eq.uid) && changes(ui.sel)?.gear[i] ? MS.identify(now, 'equipment') : null;
        return { info: eq ? MS.identify(eq, 'equipment') : null, label: S[i] ? S[i].label : '장비', compare: other };
    }

    // ── 그리기
    function draw(A, K) {
        const W = A.w, H = A.h, mobile = W < 760, wide = W >= 1180, m = mobile ? 10 : 16;
        A.uniforms.accent = ACC; A.uniforms.accent2 = ACC2; A.uniforms.glow = 0; A.uniforms.seam = 0; A.uniforms.focus = [W / 2, H * .6];
        const top = topBar(A, K, m, mobile ? 6 : 10, W - m * 2, mobile ? 40 : 48, mobile), h = H - top - m;
        if (!box.data) {
            K.text(box.error || '불러오는 중', W / 2, top + h / 2, 15, box.error ? K.WARN : K.DIM, 'center', 700);
            return;
        }
        if (mobile) {
            const sh = 52;
            strip(A, K, m, top, W - m * 2, sh);
            stand(A, K, m, top + sh + 8, W - m * 2, h - sh - 8, true);
        } else {
            const rw = K.clamp(Math.round(W * .21), 236, 320), iw = wide ? K.clamp(Math.round(W * .27), 330, 430) : 0;
            shelf(A, K, m, top, rw, h);
            stand(A, K, m + rw + 14, top, W - m * 2 - rw - 14 - (iw ? iw + 14 : 0), h, false);
            if (iw) inspector(A, K, W - m - iw, top, iw, h, false);
        }
        if (!wide && ui.inspectOpen) {
            const pk = picked(), Mo = K.modal(pk.info ? pk.info.kindLabel : pk.label, Math.min(W - 16, 520), Math.min(H - 16, pk.compare ? 700 : 620), { close: 'inspect-close', tint: pk.info ? pk.info.accent : ACC });
            inspector(A, K, Mo.x + 8, Mo.y + 60, Mo.w - 16, Mo.h - 68, true);
        }
        if (ui.chooser) chooser(A, K);
        if (ui.dialog) K.dialog(ui.dialog);
        if (ui.toast) toast(A, K, mobile);
    }
    function topBar(A, K, x, y, w, h, mobile) {
        const cy = y + h / 2, d = box.data;
        K.gem(x + 12, cy, 9, K.steel(x, y, 24, h)); K.gem(x + 12, cy, 5, ACC);
        K.text('프리셋', x + 30, cy + 1, mobile ? 19 : 24, K.INK, 'left', 800);
        if (d) K.chip(d.unlocked + ' / ' + d.slotCount, x + 40 + K.tw('프리셋', mobile ? 19 : 24, 800), cy - 11, ACC, { h: 22, size: 12 });
        const rb = h - 8;
        K.btn('refresh', '', x + w - rb, y + 4, rb, rb, '', { glyph: 'refresh', aria: '새로고침', disabled: box.loading });
        if (d) {
            const gw = Math.max(92, K.tw(fmt(d.garnet), 15, 800) + 50), gx = x + w - rb - 10 - gw;
            K.plate(gx, y + 5, gw, h - 10, 6, { a: .8, edge: .6, tint: GARNET, tintA: .12 });
            A.currency('garnet', gx + 7, y + 5 + (h - 10 - 24) / 2, 24);
            K.text(fmt(d.garnet), gx + gw - 10, cy + 1, 15, '#f2d2ff', 'right', 800);
            A.hit('noop', 'garnet', gx, y + 5, gw, h - 10, '보유 가넷 ' + fmt(d.garnet), true);
        }
        K.rule(x, y + h + 5, w, .8, ACC);
        return y + h + 14;
    }

    // 프리셋 칸 선반(데스크톱)
    function items() {
        const d = box.data, list = ['current'];
        for (let i = 0; i < d.unlocked; i++) list.push(i);
        if (d.unlocked < d.slotCount) list.push(d.unlocked);
        return list;
    }
    function shelf(A, K, x, y, w, h) {
        K.plate(x, y, w, h, 14, { a: .55, tint: ACC, tintA: .07 });
        const p = 10, rowH = 72, gap = 6, list = items(), room = h - p * 2;
        let per = Math.max(1, Math.floor((room + gap) / (rowH + gap)));
        if (per < list.length) per = Math.max(1, Math.floor((room - 54 + gap) / (rowH + gap)));
        const pages = Math.max(1, Math.ceil(list.length / per));
        if (ui.railFollow) { ui.railPage = Math.max(0, Math.floor(list.indexOf(ui.sel) / per)); ui.railFollow = false; }
        ui.railPage = K.clamp(ui.railPage, 0, pages - 1);
        list.slice(ui.railPage * per, ui.railPage * per + per).forEach((it, i) => shelfRow(A, K, it, x + p, y + p + i * (rowH + gap), w - p * 2, rowH));
        if (pages > 1) K.pager(x + p, y + h - p - 44, w - p * 2, ui.railPage, pages, 'rail-previous', 'rail-next');
    }
    function shelfRow(A, K, it, x, y, w, h) {
        const d = box.data, C = K.C, key = 'slot:' + it, on = ui.sel === it, hov = K.S.hover === key;
        const lock = locked(it), view = viewOf(it), worn = isSlot(it) && isWorn(it), col = it === 'current' ? ACC2 : worn ? LIVE : ACC;
        if (on) { C.save(); C.shadowColor = K.rgba(col, .75); C.shadowBlur = 14; K.cut(x, y, w, h, 8); C.fillStyle = K.rgba(col, .18); C.fill(); C.restore(); }
        K.plate(x, y, w, h, 8, { a: on ? .92 : .8, edge: on || hov ? 1.3 : .7, tint: lock ? null : col, tintA: on ? .16 : .07 });
        // 번호 패
        const nb = 34, ny = y + (h - nb) / 2;
        K.well(x + 8, ny, nb, nb, 6, K.rgba(col, lock ? .03 : .1));
        if (it === 'current') { K.gem(x + 8 + nb / 2, ny + nb / 2, 9, ACC2); K.gem(x + 8 + nb / 2, ny + nb / 2, 4, '#2b1904'); }
        else if (lock) lockGlyph(K, x + 8 + nb / 2, ny + nb / 2, 11, K.MUTE);
        else K.text(two(it), x + 8 + nb / 2, ny + nb / 2 + 1, 15, view ? K.INK : K.MUTE, 'center', 800);
        // 메인 카드 얼굴
        const fs = h - 22, fx = x + 8 + nb + 10, fy = y + 11;
        if (view?.mainCard) K.face({ mainCard: view.mainCard }, fx, fy, fs, col);
        else { C.beginPath(); C.arc(fx + fs / 2, fy + fs / 2, fs / 2, 0, 7); C.setLineDash([3, 4]); C.lineWidth = 1.2; C.strokeStyle = K.rgba(lock ? '#8a97a8' : col, .45); C.stroke(); C.setLineDash([]); if (!lock) K.glyph('plus', fx + fs / 2, fy + fs / 2, 10, K.rgba(col, .6)); }
        const tx = fx + fs + 10, right = x + w - 10;
        let chipW = 0;
        if (worn) chipW = K.chip('장착 중', right - K.tw('장착 중', 11, 800) - 16, y + 9, LIVE, { h: 20, size: 11 });
        else if (view?.missing) chipW = K.chip('소실 ' + view.missing, right - K.tw('소실 ' + view.missing, 11, 800) - 16, y + 9, K.WARN, { h: 20, size: 11 });
        K.line(nameOf(it), tx, y + 20, right - tx - (chipW ? chipW + 6 : 0), 14, lock ? K.MUTE : K.INK, 'left', 800, 10);
        if (lock) {
            const cost = d.costs[it];
            if (cost) { A.currency('garnet', tx, y + h - 30, 18); K.text(fmt(cost.amount), tx + 23, y + h - 21, 13, it === d.unlocked ? '#f2d2ff' : K.MUTE, 'left', 800); }
        } else if (view) {
            const eqN = (view.equipment || []).length, cardN = (view.mainCard ? 1 : 0) + (view.slotCards || []).length;
            const sub = '장비 ' + eqN + '   카드 ' + cardN, time = isSlot(it) && view.savedAt ? relTime(view.savedAt) : '';
            // 시간은 자리가 남을 때만 오른쪽에 둔다.
            const timeW = time ? K.tw(time, 11, 600) : 0, roomy = time && right - tx - timeW - 10 >= K.tw(sub, 12, 700);
            K.line(sub, tx, y + h - 21, right - tx - (roomy ? timeW + 10 : 0), 12, K.DIM, 'left', 700, 9);
            if (roomy) K.text(time, right, y + h - 21, 11, K.MUTE, 'right', 600);
        } else K.text('빈 칸', tx, y + h - 21, 12, K.MUTE, 'left', 700);
        if (on) { K.cut(x, y, w, h, 8); C.lineWidth = 2; C.strokeStyle = K.rgba(col, .95); C.stroke(); }
        K.ring(key, x, y, w, h, 8);
        A.hit('slot', it, x, y, w, h, [it === 'current' ? '현재 장착' : (it + 1) + '번 ' + nameOf(it), lock ? '잠김' : view ? '' : '빈 칸', worn ? '장착 중' : '', on ? '선택됨' : ''].filter(Boolean).join(', '), false, on);
    }
    // 자물쇠: 고리, 쇠 몸통, 열쇠 구멍
    function lockGlyph(K, cx, cy, s, col) {
        const C = K.C, bw = s * 1.3, bh = s * 1.02, bx = cx - bw / 2, by = cy - s * .18;
        C.lineCap = 'round'; C.lineWidth = Math.max(2, s * .2); C.strokeStyle = col;
        C.beginPath(); C.moveTo(cx - s * .4, by + 1); C.lineTo(cx - s * .4, cy - s * .48); C.arc(cx, cy - s * .48, s * .4, Math.PI, 0); C.lineTo(cx + s * .4, by + 1); C.stroke(); C.lineCap = 'butt';
        K.cut(bx, by, bw, bh, Math.max(2, s * .16));
        const g = C.createLinearGradient(bx, by, bx + bw * .4, by + bh); g.addColorStop(0, 'rgba(236,242,250,.92)'); g.addColorStop(.45, 'rgba(132,144,164,.9)'); g.addColorStop(1, 'rgba(70,78,96,.92)');
        C.fillStyle = g; C.fill(); C.lineWidth = 1; C.strokeStyle = 'rgba(0,0,0,.5)'; C.stroke();
        C.fillStyle = 'rgba(12,16,24,.85)'; C.beginPath(); C.arc(cx, by + bh * .42, s * .14, 0, 7); C.fill(); C.fillRect(cx - s * .06, by + bh * .42, s * .12, bh * .32);
    }
    // 프리셋 칸 줄(휴대폰)
    function strip(A, K, x, y, w, h) {
        const list = items(), cw = 56, gap = 6, ab = 36;
        let per = Math.floor((w + gap) / (cw + gap));
        const paged = per < list.length; if (paged) per = Math.max(1, Math.floor((w - ab * 2 - 12 + gap) / (cw + gap)));
        const pages = Math.max(1, Math.ceil(list.length / per));
        if (ui.railFollow) { ui.stripPage = Math.max(0, Math.floor(list.indexOf(ui.sel) / per)); ui.railFollow = false; }
        ui.stripPage = K.clamp(ui.stripPage, 0, pages - 1);
        let cx = x + (paged ? ab + 6 : 0);
        if (paged) {
            K.btn('strip-previous', '', x, y + (h - 44) / 2, ab, 44, '', { glyph: 'prev', disabled: ui.stripPage <= 0, aria: '이전 칸' });
            K.btn('strip-next', '', x + w - ab, y + (h - 44) / 2, ab, 44, '', { glyph: 'next', disabled: ui.stripPage >= pages - 1, aria: '다음 칸' });
        }
        list.slice(ui.stripPage * per, ui.stripPage * per + per).forEach(it => {
            const key = 'slot:' + it, on = ui.sel === it, hov = K.S.hover === key, lock = locked(it), view = viewOf(it), worn = isSlot(it) && isWorn(it), col = it === 'current' ? ACC2 : worn ? LIVE : ACC;
            K.plate(cx, y, cw, h, 7, { a: on ? .95 : .8, edge: on || hov ? 1.3 : .6, tint: lock ? null : col, tintA: on ? .22 : .06 });
            if (it === 'current') K.text('현재', cx + cw / 2, y + h / 2 - 4, 14, on ? ACC2 : K.INK, 'center', 800);
            else if (lock) lockGlyph(K, cx + cw / 2, y + h / 2 - 4, 10, K.MUTE);
            else K.text(String(it + 1), cx + cw / 2, y + h / 2 - 4, 17, view ? K.INK : K.MUTE, 'center', 800);
            K.gem(cx + cw / 2, y + h - 11, 3.5, worn ? LIVE : view && !lock ? K.rgba(col, .85) : 'rgba(255,255,255,.16)');
            if (on) { K.cut(cx, y, cw, h, 7); K.C.lineWidth = 2; K.C.strokeStyle = K.rgba(col, .95); K.C.stroke(); }
            K.ring(key, cx, y, cw, h, 7);
            A.hit('slot', it, cx, y, cw, h, [it === 'current' ? '현재 장착' : (it + 1) + '번 ' + nameOf(it), lock ? '잠김' : view ? '' : '빈 칸', worn ? '장착 중' : '', on ? '선택됨' : ''].filter(Boolean).join(', '), false, on);
            cx += cw + gap;
        });
    }

    // 진열대: 머리(번호, 이름, 상태), 장비와 카드, 아래 행동 단추
    function stand(A, K, x, y, w, h, mobile) {
        const sel = ui.sel, view = viewOf(sel), lock = locked(sel), ch = changes(sel);
        K.plate(x, y, w, h, 16, { a: .4, tint: ACC, tintA: .05 });
        const p = mobile ? 10 : 18, headH = mobile ? 42 : 50, actH = mobile ? 52 : 58;
        header(A, K, x + p, y + p, w - p * 2, headH, view, ch, lock, mobile);
        const by = y + p + headH + (mobile ? 8 : 12), bh = y + h - p - actH - (mobile ? 10 : 14) - by;
        loadout(A, K, x + p, by, w - p * 2, bh, view || ghostOf(sel), ch, lock || !view && isSlot(sel), mobile);
        actions(A, K, x + p, y + h - p - actH, w - p * 2, actH, view, ch, lock, mobile);
    }
    function header(A, K, x, y, w, h, view, ch, lock, mobile) {
        const sel = ui.sel, cy = y + h / 2, col = sel === 'current' ? ACC2 : ACC;
        let tx = x;
        if (sel === 'current') { K.gem(x + 12, cy, 10, ACC2); K.gem(x + 12, cy, 4.5, '#2b1904'); tx += 32; }
        else { K.plate(x, y + (h - 38) / 2, 46, 38, 7, { a: .9, edge: .8, tint: col, tintA: .2 }); K.text(two(sel), x + 23, cy + 1, 18, lock ? K.MUTE : K.INK, 'center', 800); tx += 56; }
        // 오른쪽 상태 꼬리표
        const chips = [];
        if (ch && view) {
            if (ch.total === 0) chips.push({ text: '장착 중', color: LIVE });
            else chips.push({ text: '교체 ' + ch.total, color: ACC, gem: true });
        }
        if (view?.missing) chips.push({ text: '소실 ' + view.missing, color: K.WARN });
        if (isSlot(sel) && view?.savedAt && !mobile) chips.push({ text: relTime(view.savedAt), color: K.MUTE, plain: true });
        let rx = x + w;
        for (const c of chips.slice().reverse()) {
            if (c.plain) { const tw = K.tw(c.text, 12, 600); K.text(c.text, rx, cy, 12, c.color, 'right', 600); rx -= tw + 12; continue; }
            const cw = K.tw(c.text, 12, 800) + 16 + (c.gem ? 14 : 0), cx = rx - cw;
            K.cut(cx, cy - 12, cw, 24, 5); K.C.fillStyle = K.rgba(c.color, .14); K.C.fill(); K.C.lineWidth = 1; K.C.strokeStyle = K.rgba(c.color, .6); K.C.stroke();
            if (c.gem) K.gem(cx + 12, cy, 4.5, c.color);
            K.text(c.text, cx + 8 + (c.gem ? 14 : 0), cy + 1, 12, c.color, 'left', 800);
            rx = cx - 8;
        }
        const canName = isSlot(sel) && !!view && !lock, penW = canName ? (mobile ? 40 : 44) : 0, nameW = rx - tx - (penW ? penW + 8 : 0) - 8;
        if (ui.renaming && canName) {
            K.well(tx, y + (h - 40) / 2, Math.max(120, nameW + penW + 8), 40, 7);
            A.field('preset-name', tx + 10, y + (h - 40) / 2 + 3, Math.max(100, nameW + penW + 8) - 64, 34, { value: ui.nameDraft, placeholder: '프리셋 ' + (sel + 1), maxLength: 12, label: '프리셋 이름', focus: true, select: true, big: true });
            K.btn('rename-ok', '', tx + Math.max(120, nameW + penW + 8) - 46, y + (h - 34) / 2, 40, 34, '', { glyph: 'check', aria: '이름 저장' });
            return;
        }
        K.line(nameOf(sel), tx, cy + 1, nameW, mobile ? 18 : 22, lock ? K.MUTE : K.INK, 'left', 800, 12);
        if (canName) K.btn('rename', '', tx + Math.min(nameW, K.tw(nameOf(sel), mobile ? 18 : 22, 800)) + 8, y + (h - 36) / 2, penW, 36, '', { glyph: 'pen', aria: '이름 바꾸기' });
    }
    function loadout(A, K, x, y, w, h, view, ch, dim, mobile) {
        const S = sockets(), gear = arrange(view), n = cardSlots(), worn = !!ch && ch.total === 0, lock = locked(ui.sel);
        const leftN = GEAR_LEFT.length, rightN = S.length - leftN;
        if (mobile) {
            // 위: 메인 카드와 슬롯 카드, 아래: 장비 두 줄
            const gearRows = Math.ceil(S.length / 5), gs = Math.min(Math.floor((w - 4 * 6) / 5), 66), gearH = gearRows * (gs + 6) - 6;
            const cardH = Math.max(110, h - gearH - 14), mh = Math.min(cardH, Math.round((w * .42) * 515 / 399)), mw = Math.round(mh * 399 / 515);
            mainCard(A, K, view, x, y + (cardH - mh) / 2, mw, mh, ch, dim, worn);
            A.uniforms.focus = [x + mw / 2, y + (cardH - mh) / 2 + mh];
            const sx = x + mw + 10, sw = w - mw - 10, cols = n > 3 ? Math.ceil(n / 2) : n, rows = Math.ceil(n / cols);
            const csW = Math.min((sw - (cols - 1) * 6) / cols, ((cardH - (rows - 1) * 6) / rows) * 399 / 515), csH = csW * 515 / 399;
            const gy = y + (cardH - (rows * csH + (rows - 1) * 6)) / 2;
            for (let j = 0; j < n; j++) slotCard(A, K, view, j, sx + (j % cols) * (csW + 6), gy + Math.floor(j / cols) * (csH + 6), csW, csH, ch, dim);
            const gy2 = y + cardH + 14;
            S.forEach((s, i) => socket(A, K, gear[i], s, i, x + (i % 5) * (gs + 6) + (w - (5 * gs + 24)) / 2, gy2 + Math.floor(i / 5) * (gs + 6), gs, gs, 'tile', ch, dim));
            if (lock) lockOverlay(A, K, x, y, w, h);
            return;
        }
        // 데스크톱: 왼쪽 열, 가운데 메인 카드, 오른쪽 열, 아래 슬롯 카드 줄
        const cardRow = K.clamp(Math.round(h * .25), 96, 168), gap = 8, upper = h - cardRow - 16;
        const rows = Math.max(leftN, rightN), sh = Math.min(76, Math.floor((upper - (rows - 1) * gap) / rows));
        const colW = K.clamp(Math.round(w * .3), sh, 250), tile = colW < sh * 2.1;
        const cw0 = tile ? sh : colW, centerW = w - cw0 * 2 - 28;
        const mh = Math.min(upper, Math.round((centerW - 16) * 515 / 399)), mw = Math.round(mh * 399 / 515), mx = x + (w - mw) / 2, my = y + (upper - mh) / 2;
        mainCard(A, K, view, mx, my, mw, mh, ch, dim, worn);
        A.uniforms.focus = [mx + mw / 2, my + mh];
        const colTop = n => y + (upper - (n * sh + (n - 1) * gap)) / 2;
        for (let i = 0; i < leftN; i++) socket(A, K, gear[i], S[i], i, x, colTop(leftN) + i * (sh + gap), cw0, sh, tile ? 'tile' : 'left', ch, dim);
        for (let i = leftN; i < S.length; i++) socket(A, K, gear[i], S[i], i, x + w - cw0, colTop(rightN) + (i - leftN) * (sh + gap), cw0, sh, tile ? 'tile' : 'right', ch, dim);
        const csH = cardRow, csW = Math.min(Math.round(csH * 399 / 515), Math.floor((w - (n - 1) * 10) / n)), rowW = n * csW + (n - 1) * 10, cy0 = y + h - cardRow;
        for (let j = 0; j < n; j++) slotCard(A, K, view, j, x + (w - rowW) / 2 + j * (csW + 10), cy0 + (cardRow - csW * 515 / 399) / 2, csW, csW * 515 / 399, ch, dim);
        if (lock) lockOverlay(A, K, x, y, w, h);
    }
    function lockOverlay(A, K, x, y, w, h) {
        const s = Math.min(w, h) * .14, cx = x + w / 2, cy = y + h / 2 - 10;
        K.C.fillStyle = 'rgba(4,6,10,.55)'; K.cut(x, y, w, h, 12); K.C.fill();
        lockGlyph(K, cx, cy, Math.max(22, s), 'rgba(220,228,240,.75)');
        const cost = box.data.costs[ui.sel];
        if (cost) { const t = fmt(cost.amount), tw = K.tw(t, 20, 800); A.currency('garnet', cx - (tw + 34) / 2, cy + Math.max(22, s) + 10, 26); K.text(t, cx - (tw + 34) / 2 + 34, cy + Math.max(22, s) + 24, 20, '#f2d2ff', 'left', 800); }
    }
    function marker(K, x, y, on) { if (!on) return; K.gem(x, y, 6.5, '#06121a'); K.gem(x, y, 4.5, ACC); }
    function mainCard(A, K, view, x, y, w, h, ch, dim, worn) {
        const key = 'pick:main', on = ui.pick === 'main', hov = K.S.hover === key, card = view?.mainCard, info = card ? MS.identify(card, 'card') : null, col = info ? info.accent : ACC, C = K.C;
        C.save(); C.shadowColor = K.rgba(worn ? LIVE : col, on ? .7 : .35); C.shadowBlur = on ? 26 : 14; K.cut(x - 4, y - 4, w + 8, h + 8, 12); C.fillStyle = 'rgba(6,9,14,.6)'; C.fill(); C.restore();
        K.well(x - 4, y - 4, w + 8, h + 8, 12, K.rgba(col, .06));
        if (info) A.art(info.art, x, y, w, h, { fx: dim ? null : info.fx, dim, big: true });
        else A.art({ imageUrl: EMPTY_CARD }, x, y, w, h, { dim: true });
        if (info?.ribbon) K.ribbon(info.ribbon.text, x + w - 2, y + 10, info.ribbon.color);
        marker(K, x + w - 2, y + h - 2, ch?.main);
        if (on || hov) K.brackets(x - 8, y - 8, w + 16, h + 16, 16, on ? K.rgba(col, .95) : 'rgba(240,246,255,.55)');
        K.ring(key, x - 4, y - 4, w + 8, h + 8, 12);
        A.hit('pick', 'main', x, y, w, h, ['메인 카드', info ? info.title : '비어 있음', ch?.main ? '교체' : ''].filter(Boolean).join(', '), false, on);
    }
    function slotCard(A, K, view, j, x, y, w, h, ch, dim) {
        const key = 'pick:c' + j, on = ui.pick === 'c' + j, hov = K.S.hover === key, card = view?.slotCards[j], info = card ? MS.identify(card, 'card') : null, col = info ? info.accent : ACC;
        K.well(x - 3, y - 3, w + 6, h + 6, 7, K.rgba(col, .05));
        if (info) A.art(info.art, x, y, w, h, { fx: dim ? null : info.fx, dim });
        else A.art({ imageUrl: EMPTY_CARD }, x, y, w, h, { dim: true });
        marker(K, x + w - 1, y + h - 1, ch?.cards[j]);
        if (on || hov) K.brackets(x - 6, y - 6, w + 12, h + 12, 10, on ? K.rgba(col, .95) : 'rgba(240,246,255,.5)');
        K.ring(key, x - 3, y - 3, w + 6, h + 6, 7);
        A.hit('pick', 'c' + j, x, y, w, h, ['슬롯 카드 ' + (j + 1), info ? info.title : '비어 있음', ch?.cards[j] ? '교체' : ''].filter(Boolean).join(', '), false, on);
    }
    // 장비 칸: 'left'와 'right'는 그림 옆에 이름, 'tile'은 그림만
    function socket(A, K, eq, s, i, x, y, w, h, mode, ch, dim) {
        const key = 'pick:g' + i, on = ui.pick === 'g' + i, hov = K.S.hover === key, info = eq ? MS.identify(eq, 'equipment') : null, col = info ? info.accent : '#8a97a8', C = K.C, changed = !!ch?.gear[i];
        if (on) { C.save(); C.shadowColor = K.rgba(col, .8); C.shadowBlur = 16; K.cut(x, y, w, h, 8); C.fillStyle = K.rgba(col, .2); C.fill(); C.restore(); }
        K.plate(x, y, w, h, 8, { a: info ? .86 : .55, edge: on || hov ? 1.3 : info ? .8 : .45, tint: info ? col : null, tintA: on ? .2 : .08 });
        const icon = h - 10, ix = mode === 'right' ? x + w - 5 - icon : x + 5, iy = y + 5;
        if (mode === 'tile') {
            K.well(x + 4, y + 4, w - 8, h - 8, 6, K.rgba(col, info ? .08 : .03));
            if (info) A.art(info.art, x + 6, y + 6, w - 12, h - 12, { fx: dim ? null : info.fx, dim });
            else K.line(s.label.replace(/ \d+$/, ''), x + w / 2, y + h / 2, w - 8, 11, 'rgba(190,198,214,.35)', 'center', 700, 8);
        } else {
            K.well(ix, iy, icon, icon, 6, K.rgba(col, info ? .08 : .03));
            if (info) A.art(info.art, ix + 2, iy + 2, icon - 4, icon - 4, { fx: dim ? null : info.fx, dim });
            const tx = mode === 'right' ? x + 10 : ix + icon + 10, tw = w - icon - 24, al = mode === 'right' ? 'left' : 'left';
            if (info && h >= 58) {
                const f = K.fit(info.title, tw, h - 30, 14, 10, 700); K.para(f, tx, y + 8 + Math.max(0, (h - 30 - f.lines.length * f.lh) / 2), dim ? K.MUTE : K.INK, al);
                let cx = tx;
                cx += K.chip(eq.rarity || '장비', cx, y + h - 24, col, { h: 18, size: 10, max: tw }) + 4;
                if (Number(eq.level) > 0 && cx < tx + tw - 30) K.chip('+' + eq.level, cx, y + h - 24, K.GOLD, { h: 18, size: 10 });
            } else if (info) {
                // 키가 낮은 칸: 이름 한 줄, 그 아래 등급과 강화 수치
                K.line(info.title, tx, y + h * .36, tw, 13, dim ? K.MUTE : K.INK, 'left', 700, 10);
                const rw = K.line(eq.rarity || '장비', tx, y + h * .72, tw, 11, col, 'left', 800, 9);
                if (Number(eq.level) > 0) K.text('+' + eq.level, tx + rw + 6, y + h * .72, 11, K.GOLD, 'left', 800);
            } else K.line(s.label, tx, y + h / 2, tw, 13, 'rgba(190,198,214,.42)', 'left', 700, 9);
        }
        if (info && Number(eq.level) > 0 && mode === 'tile') { const t = '+' + eq.level, cw = Math.max(22, K.tw(t, 10, 800) + 8); K.plate(x + 3, y + 3, cw, 16, 4, { a: .92, edge: .5 }); K.text(t, x + 3 + cw / 2, y + 11.5, 10, K.GOLD, 'center', 800); }
        marker(K, mode === 'right' ? x + 4 : x + w - 4, y + 4, changed);
        if (on) { K.brackets(x - 3, y - 3, w + 6, h + 6, 10, K.rgba(col, .95)); K.cut(x, y, w, h, 8); C.lineWidth = 2; C.strokeStyle = K.rgba(col, .95); C.stroke(); }
        K.ring(key, x, y, w, h, 8);
        A.hit('pick', 'g' + i, x, y, w, h, [s.label, info ? info.title : '비어 있음', info && eq.rarity, info && Number(eq.level) > 0 ? '+' + eq.level : '', changed ? '교체' : ''].filter(Boolean).join(', '), false, on);
    }
    function actions(A, K, x, y, w, h, view, ch, lock, mobile) {
        const d = box.data, sel = ui.sel, gap = 10;
        if (sel === 'current') {
            K.btn('chooser', '', x, y, w, h, '프리셋에 저장', { primary: true, size: mobile ? 16 : 18, glyph: 'check', disabled: !hasLoadout(view) });
            return;
        }
        if (lock) {
            const cost = d.costs[sel], next = sel === d.unlocked;
            K.btn('unlock', sel, x, y, w, h, next ? '해금  ' + fmt(cost?.amount) : '이전 칸을 먼저 해금', { primary: next, icon: next ? 'garnet' : null, size: mobile ? 16 : 18, disabled: !next });
            return;
        }
        if (!view) { K.btn('save', sel, x, y, w, h, '현재 장착 저장', { primary: true, glyph: 'plus', size: mobile ? 16 : 18 }); return; }
        const worn = !!ch && ch.total === 0, pw = Math.round((w - gap) * .62);
        K.btn('apply', sel, x, y, pw, h, worn ? '장착 중' : '적용', { primary: !worn, size: mobile ? 17 : 20, disabled: worn, glyph: worn ? 'check' : null, aria: worn ? '장착 중' : nameOf(sel) + ' 적용' });
        K.btn('save', sel, x + pw + gap, y, w - pw - gap, h, mobile ? '덮어쓰기' : '현재 장착으로 덮어쓰기', { size: mobile ? 14 : 15, disabled: worn, aria: nameOf(sel) + '에 현재 장착 덮어쓰기' });
    }
    function inspector(A, K, x, y, w, h, inModal) {
        const pk = picked(), cmpH = pk.compare ? 104 : 0;
        K.inspect(pk.info, x, y, w, h, { a: inModal ? .985 : .6, bottom: cmpH, empty: locked(ui.sel) ? '' : pk.label });
        if (!pk.compare) return;
        const by = y + h - 16 - 62;
        K.rule(x + 16, by - 34, w - 32, .7, ACC2);
        K.chip('현재 장착', x + 16, by - 26, ACC2, { h: 20, size: 11 });
        K.mini(pk.compare, x + 16, by, w - 32, 62);
    }
    // 현재 장착을 담을 칸 고르기
    function chooser(A, K) {
        const d = box.data, n = d.unlocked, W = A.w, cols = W < 560 ? 2 : W < 900 ? 3 : 4, cellH = 64, gap = 8;
        const rows = Math.ceil(n / cols), M = K.modal('저장할 칸', Math.min(W - 16, cols * 200 + 40), 70 + Math.min(rows, 6) * (cellH + gap) + 12, { close: 'chooser-close', tint: ACC2 });
        const cw = (M.w - 36 - (cols - 1) * gap) / cols;
        for (let i = 0; i < n && i < cols * 6; i++) {
            const cx = M.x + 18 + (i % cols) * (cw + gap), cy = M.y + 66 + Math.floor(i / cols) * (cellH + gap), view = d.presets[i], worn = isWorn(i);
            K.btn('save-to', i, cx, cy, cw, cellH, two(i) + '  ' + (view ? nameOf(i) : '빈 칸'), { align: 'left', size: 14, on: worn, color: LIVE, badge: view ? String((view.equipment || []).length) : null, aria: (i + 1) + '번 ' + (view ? nameOf(i) + ' 덮어쓰기' : '빈 칸에 저장') });
        }
    }
    function toast(A, K, mobile) {
        const t = ui.toast, tw = K.tw(t.text, 15, 800) + 40, x = (A.w - tw) / 2, y = mobile ? 62 : 72;
        K.plate(x, y, tw, 40, 8, { a: .95, tint: t.color || LIVE, tintA: .24, edge: 1.2 });
        K.text(t.text, A.w / 2, y + 21, 15, t.color || LIVE, 'center', 800);
    }
    function flash(text, color) {
        clearTimeout(toastTimer); ui.toast = { text, color };
        stage?.announce(text); stage?.invalidate();
        toastTimer = setTimeout(() => { ui.toast = null; stage?.invalidate(); }, 1600);
    }

    // ── 서버
    async function load(keepSelection) {
        const token = ++loadToken;
        box.loading = true; box.error = ''; stage?.invalidate();
        try {
            const data = await api('/api/presets');
            if (token !== loadToken) return;
            box.data = data;
            if (!keepSelection) {
                const worn = data.presets.findIndex((p, i) => p && i < data.unlocked && isWorn(i));
                select(worn >= 0 ? worn : 'current', true);
            } else if (isSlot(ui.sel) && ui.sel > data.unlocked) select('current', true);
        } catch (error) { if (token === loadToken) box.error = error.message; }
        finally { if (token === loadToken) { box.loading = false; stage?.invalidate(); } }
    }
    async function call(path, body, done) {
        ui.busy = true; stage.invalidate();
        try { const r = await postApi(path, body); box.data = r; if (done) await done(r); }
        catch (error) { ui.dialog = { title: '처리하지 못했습니다', lines: [error.message], error: true }; stage?.play('cancel'); }
        finally { ui.busy = false; stage?.invalidate(); }
    }
    function save(slot) {
        call('/api/presets/save', { slot }, () => { select(slot, true); stage.play('stamp'); stage.pulse(); flash(two(slot) + '  저장', ACC2); });
    }
    function apply(slot) {
        return call('/api/presets/apply', { slot }, r => {
            if (r.profile) opts.onProfile?.(r.profile);
            stage.play('deal'); stage.pulse();
            if (Array.isArray(r.warnings) && r.warnings.length) ui.dialog = { title: '일부 적용', lines: r.warnings, tint: ACC };
            else flash('적용 완료', LIVE);
        });
    }
    function rename(slot, name) {
        ui.renaming = false;
        if ((box.data.presets[slot]?.name || '') === name) { stage.invalidate(); return; }
        call('/api/presets/rename', { slot, name });
    }

    // ── 동작
    function select(sel, quiet) {
        if (sel !== 'current') sel = Number(sel);
        if (!box.data || (isSlot(sel) && (!(sel >= 0) || sel > box.data.unlocked || sel >= box.data.slotCount))) return;
        ui.sel = sel; ui.pick = 'main'; ui.inspectOpen = false; ui.renaming = false; ui.railFollow = true;
        if (!quiet) { stage?.play('select'); stage?.announce(sel === 'current' ? '현재 장착' : (sel + 1) + '번 ' + nameOf(sel)); }
    }
    function step(delta) {
        if (!box.data) return;
        const list = items(), i = list.indexOf(ui.sel), next = list[Math.max(0, Math.min(list.length - 1, i + delta))];
        if (next !== ui.sel) { select(next); stage.invalidate(); }
    }
    function act(action, id) {
        if (MS.linesAct(ui, action)) { stage.invalidate(); return; }
        if (ui.dialog) {
            const d = ui.dialog; ui.dialog = null;
            if (action === 'apply-yes') apply(d.slot);
            else if (action === 'apply-save') call('/api/presets/save', { slot: d.empty }, () => apply(d.slot));
            else if (action === 'save-yes') save(d.slot);
            else if (action === 'unlock-yes') call('/api/presets/unlock', { slot: d.slot }, () => { select(d.slot, true); stage.play('unlock'); stage.pulse(); flash(two(d.slot) + '  해금', GARNET); });
            stage.invalidate(); return;
        }
        if (ui.chooser) {
            if (action === 'save-to') { ui.chooser = false; const i = Number(id); if (box.data.presets[i]) ui.dialog = { title: '덮어쓰기', lines: [two(i) + '  ' + nameOf(i)], slot: i, tint: ACC2, actions: [{ action: 'dialog-close', label: '취소' }, { action: 'save-yes', label: '덮어쓰기', primary: true }] }; else save(i); }
            else if (action === 'chooser-close' || action === 'back') { ui.chooser = false; stage.play('cancel'); }
            stage.invalidate(); return;
        }
        switch (action) {
            case 'back':
                if (ui.renaming) ui.renaming = false;
                else if (ui.inspectOpen) ui.inspectOpen = false;
                break;
            case 'refresh': load(true); return;
            case 'slot': select(id === 'current' ? 'current' : Number(id)); break;
            case 'rail-previous': ui.railPage--; break;
            case 'rail-next': ui.railPage++; break;
            case 'strip-previous': ui.stripPage--; break;
            case 'strip-next': ui.stripPage++; break;
            case 'pick': ui.pick = id; stage.play('select'); if (stage.width < 1180) ui.inspectOpen = true; break;
            case 'inspect-close': ui.inspectOpen = false; break;
            case 'rename': ui.renaming = true; ui.nameDraft = box.data.presets[ui.sel]?.name || ''; break;
            case 'rename-ok': rename(ui.sel, ui.nameDraft.trim()); return;
            case 'chooser': ui.chooser = true; stage.play('paper'); break;
            case 'save': {
                const i = Number(id);
                if (box.data.presets[i]) ui.dialog = { title: '덮어쓰기', lines: [two(i) + '  ' + nameOf(i)], slot: i, tint: ACC2, actions: [{ action: 'dialog-close', label: '취소' }, { action: 'save-yes', label: '덮어쓰기', primary: true }] };
                else { save(i); return; }
                break;
            }
            case 'apply': {
                const i = Number(id), d = box.data;
                // 지금 장착이 어느 프리셋에도 없으면, 적용하기 전에 한 번 묻는다. 빈 칸이 있으면 거기에 담고 적용할 수 있다.
                const kept = d.presets.some((p, k) => p && k < d.unlocked && isWorn(k));
                if (kept || !hasLoadout(d.current)) { apply(i); return; }
                const empty = d.presets.findIndex((p, k) => !p && k < d.unlocked);
                ui.dialog = { title: nameOf(i) + ' 적용', lines: ['현재 장착은 어느 프리셋에도 없습니다.'], slot: i, empty, wide: true, tint: ACC,
                    actions: [{ action: 'dialog-close', label: '취소' }].concat(empty >= 0 ? [{ action: 'apply-save', label: two(empty) + '에 저장 후 적용' }] : [], [{ action: 'apply-yes', label: '적용', primary: true }]) };
                break;
            }
            case 'unlock': {
                const i = Number(id), d = box.data, cost = d.costs[i];
                if (!cost || i !== d.unlocked) break;
                const after = d.garnet - cost.amount;
                ui.dialog = after < 0
                    ? { title: two(i) + '  해금', lines: ['가넷 ' + fmt(cost.amount) + ' 필요', '보유 ' + fmt(d.garnet)], error: true }
                    : { title: two(i) + '  해금', lines: ['가넷 ' + fmt(cost.amount), '보유 ' + fmt(d.garnet) + '  →  ' + fmt(after)], slot: i, tint: GARNET, actions: [{ action: 'dialog-close', label: '취소' }, { action: 'unlock-yes', label: '해금', primary: true }] };
                break;
            }
        }
        stage.invalidate();
    }
    function field(key, value, how) {
        if (key !== 'preset-name' || !ui.renaming) return;
        ui.nameDraft = value.slice(0, 12);
        if (how === 'enter') { rename(ui.sel, ui.nameDraft.trim()); return; }
        stage.invalidate();
    }
    // 위아래 화살표로 칸을 넘기고, 숫자 1~9로 바로 고른다.
    function keydown(event) {
        if (!stage || ui.dialog || ui.chooser || ui.renaming || event.ctrlKey || event.metaKey || event.altKey) return;
        if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('.msg-modal-bg, #modalBg.active')) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); step(event.key === 'ArrowDown' ? 1 : -1); }
        else if (/^[1-9]$/.test(event.key) && box.data && Number(event.key) - 1 <= box.data.unlocked) { select(Number(event.key) - 1); stage.invalidate(); }
        else if (event.key === '0') { select('current'); stage.invalidate(); }
    }
    function open(options) {
        close(); opts = options || {};
        const host = document.getElementById('presetStageRoot'); if (!host || !MS) return;
        stage = MS.mount(host, { theme: 'preset', label: '프리셋', state: ui, currencyIcons: new Proxy({}, { get: (_, key) => key === 'garnet' ? (box.data?.costs || []).find(Boolean)?.iconUrl || null : null }), draw, onAct: act, onField: field });
        document.addEventListener('keydown', keydown);
        load(false);
    }
    function close() {
        document.removeEventListener('keydown', keydown);
        clearTimeout(toastTimer); stage?.dispose(); stage = null;
        Object.assign(ui, { dialog: null, chooser: false, renaming: false, inspectOpen: false, toast: null, busy: false });
    }
    window.PresetStageUI = { open, close, reload: () => load(true) };
})();
