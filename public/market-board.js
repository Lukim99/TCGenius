// 팝니다, 삽니다 무대. 거래, 메일과 같은 공용 무대(market-stage.js) 위에 매물판, 감정대, 보관함을 올린다.
// 서버 API(/api/auction, /api/buyorder 와 하위 경로)와 요청 형식은 기존 화면과 같다.
(() => {
    'use strict';
    const MS = window.MarketStage;
    const MODES = {
        sell: { page: 'auction', root: 'auctionStageRoot', title: '팝니다', accent: '#ffb648', accent2: '#ff7a59', list: '/api/auction', who: 'sellerName', whoLabel: '판매자', mine: '내 판매', register: '판매 등록', best: '최저가', count: '매물' },
        buy: { page: 'buyorder', root: 'buyOrderStageRoot', title: '삽니다', accent: '#5fd3c6', accent2: '#6fb4ff', list: '/api/buyorder', who: 'buyerName', whoLabel: '구매자', mine: '내 구매', register: '구매 등록', best: '최고가', count: '요청' }
    };
    const KINDS = [['all', '전체'], ['card', '카드'], ['equipment', '장비'], ['item', '아이템'], ['pet', '펫'], ['avatar', '아바타']];
    const KIND_LABEL = { card: '카드', equipment: '장비', item: '아이템', pet: '펫', avatar: '아바타' };
    const EQUIP = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조', artifact: '아티팩트' };
    const CUR = { gold: '골드', garnet: '가넷' };
    const SORTS = [['new', '최신'], ['priceAsc', '낮은 가격'], ['priceDesc', '높은 가격']];
    const SORT_FN = { new: (a, b) => b.createdAt - a.createdAt, priceAsc: (a, b) => a.unitPrice - b.unitPrice, priceDesc: (a, b) => b.unitPrice - a.unitPrice };
    const GOOD = '#86e3b6', WARN = '#ff8f7a', GOLD = '#ffd873', DIM = 'rgba(214,222,236,.66)';
    // 시세 그래프 색: 체결가 선, 팝니다 최저가 점선, 삽니다 최고가 점선, 입력한 가격 선, 오름(빨강), 내림(파랑)
    const LINE = { trade: '#ffd873', ask: '#ff7a59', bid: '#5fd3c6', mine: '#f3f5f9', up: '#ff6b6b', down: '#6fb4ff' };
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const short = n => { const t = v => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ko-KR'); return n >= 1e8 ? t(n / 1e8) + '억' : n >= 1e4 ? t(n / 1e4) + '만' : fmt(Math.round(n)); };
    let mode = null, stage = null, loadToken = 0, toastTimer = 0;
    const data = { list: [], loading: false, error: '', sellable: null, infos: new Map(), best: new Map(), history: new Map() };
    const ui = { hover: '', focus: '', busy: false, filter: 'all', currency: 'all', sort: 'new', query: '', page: 0, selected: '', overlay: false, qty: 1, picker: null, dialog: null, toast: '', working: false };
    const M = () => MODES[mode];
    const wallet = () => (typeof myGoods === 'object' && myGoods) || { gold: 0, garnet: 0 };
    const currencyIcons = () => ({ gold: QUEST_REWARD_CURRENCY_ICONS['골드'], garnet: QUEST_REWARD_CURRENCY_ICONS['가넷'] });
    const selectedEntry = () => data.list.find(e => e.id === ui.selected) || null;

    // ── 품목 정체
    function groupKey(kind, d) {
        if (kind === 'card') return 'c:' + d.cardId + ':' + d.star + ':' + (d.cardType || '일반') + ':' + (d.skin || '');
        if (kind === 'equipment') return 'e:' + d.equipType + ':' + d.equipId + ':' + (d.level ?? '');
        if (kind === 'item') return 'i:' + d.itemId;
        if (kind === 'pet') return 'p:' + d.petId;
        return 'a:' + d.name;
    }
    function infoOf(e) {
        if (data.infos.has(e.id)) return data.infos.get(e.id);
        const d = e.display || {};
        let info;
        if (e.kind === 'card') {
            const formatted = d.formatted || d.sub || d.name, star = String(formatted).match(/^\[([^\]]+)\]/);
            info = MS.identify({ formatted, star: d.star, starText: star ? star[1] : null, type: d.cardType || '일반', skin: d.skin, imageUrl: d.imageUrl }, 'card');
            if (mode === 'buy' && !d.cardType) { info.chips = [info.chips[0], { text: '종류 무관', color: DIM }]; info.ribbon = null; }
            info.detail = false;
        } else if (e.kind === 'equipment') {
            const det = d.equipmentDetail;
            info = MS.identify(det ? { ...det } : { name: d.name, rarity: d.rarity, level: d.level || 0, typeLabel: EQUIP[d.equipType], iconUrl: d.iconUrl, frameUrl: d.frameUrl, statLines: d.statLines || [] }, 'equipment');
            if (mode === 'buy' && d.level == null) { info.corner = null; info.chips = info.chips.filter(c => !/^\+\d+$/.test(c.text)).concat([{ text: '강화 무관', color: DIM }]); }
            info.detail = !!det;
        } else if (e.kind === 'item') {
            info = MS.identify({ name: d.name, count: e.count, type: d.itemType, iconUrl: d.iconUrl, frameUrl: d.frameUrl }, 'item');
            if (d.orbDetail) info.lines = [{ text: '부여 가능  ' + (d.orbDetail.partLabels || []).join(', '), head: true, color: '#c9a7ff' }, ...(d.orbDetail.effectLines || []).map(text => ({ text }))];
            info.detail = false;
        } else if (e.kind === 'pet') {
            info = MS.identify({ name: d.name, rarity: d.rarity, iconUrl: d.iconUrl, frameUrl: d.frameUrl, statLines: d.statLines || [] }, 'pet');
        } else {
            info = MS.identify({ name: d.name, grade: d.rarity, iconUrl: d.iconUrl, frameUrl: d.frameUrl, imageUrl: d.imageUrl }, 'avatar');
            info.lines = (d.statLines || []).map(text => ({ text }));
        }
        data.infos.set(e.id, info);
        return info;
    }
    // 같은 품목끼리 묶어 가장 좋은 가격(팝니다는 최저, 삽니다는 최고)을 찾는다.
    function rebuildBest() {
        data.best.clear();
        const count = new Map();
        for (const e of data.list) {
            const key = groupKey(e.kind, e.display || {}) + '|' + e.currency, cur = data.best.get(key);
            count.set(key, (count.get(key) || 0) + 1);
            if (cur == null || (mode === 'sell' ? e.unitPrice < cur : e.unitPrice > cur)) data.best.set(key, e.unitPrice);
        }
        for (const [key, n] of count) if (n < 2) data.best.delete(key);
    }
    const isBest = e => data.best.get(groupKey(e.kind, e.display || {}) + '|' + e.currency) === e.unitPrice;
    // 삽니다: 내 보관함으로 바로 채울 수 있는 요청인지(기존 조건과 같은 기준)
    function canFill(e) {
        const s = data.sellable, d = e.display || {};
        if (!s || e.mine || mode !== 'buy') return false;
        if (e.kind === 'card') return s.cards.some(c => c.id === d.cardId && c.star === d.star && (!d.cardType || (c.type || '일반') === d.cardType));
        if (e.kind === 'equipment') return s.equipment.some(q => q.type === d.equipType && q.id === d.equipId && (d.level == null || q.level === d.level));
        if (e.kind === 'item') return s.items.some(i => i.id === d.itemId && i.count > 0);
        if (e.kind === 'pet') return (s.pets || []).some(p => p.id === d.petId);
        return (s.avatars || []).some(a => a.name === d.name);
    }
    function visible() {
        const q = ui.query.trim().toLowerCase();
        return data.list.filter(e => {
            if (ui.filter === 'mine') { if (!e.mine) return false; }
            else if (ui.filter === 'can') { if (!canFill(e)) return false; }
            else if (ui.filter !== 'all' && e.kind !== ui.filter) return false;
            if (ui.currency !== 'all' && e.currency !== ui.currency) return false;
            if (q) { const info = infoOf(e); if (![info.title, e[M().who], ...info.chips.map(c => c.text)].join(' ').toLowerCase().includes(q)) return false; }
            return true;
        }).sort(SORT_FN[ui.sort] || SORT_FN.new);
    }

    // ── 그리기
    function draw(A, K) {
        const W = A.w, H = A.h, mobile = W < 760, wide = W >= 1000, m = mobile ? 10 : 16;
        A.uniforms.accent = M().accent; A.uniforms.accent2 = M().accent2; A.uniforms.glow = 0; A.uniforms.seam = 0;
        ui.busy = ui.working;
        let y = topBar(A, K, m, mobile ? 6 : 10, W - m * 2, mobile ? 40 : 48, mobile);
        const detailW = wide ? K.clamp(Math.round(W * .3), 320, 400) : 0, listW = W - m * 2 - (detailW ? detailW + 14 : 0);
        const top = y;
        y = toolbar(A, K, m, y, listW, mobile);
        board(A, K, m, y, listW, H - y - m, mobile);
        if (detailW) detailPanel(A, K, m + listW + 14, top, detailW, H - top - m, false);
        else if (ui.overlay && selectedEntry()) {
            const e = selectedEntry(), Mo = K.modal(infoOf(e).kindLabel, Math.min(W - 8, 560), H - 8, { close: 'overlay-close', tint: infoOf(e).accent });
            detailPanel(A, K, Mo.x + 6, Mo.y + 60, Mo.w - 12, Mo.h - 66, true);
        }
        if (ui.filtersOpen) {
            const tabs = [...KINDS, ['mine', M().mine]].concat(mode === 'buy' ? [['can', '판매 가능']] : []), cols = 2, rows = Math.ceil(tabs.length / cols);
            const Mo = K.modal('분류', Math.min(W - 16, 420), 64 + rows * 54 + 12, { close: 'filters-close', tint: M().accent }), bw = (Mo.w - 36 - 8) / 2;
            tabs.forEach(([k, l], i) => K.btn('filter', k, Mo.x + 18 + (i % cols) * (bw + 8), Mo.y + 66 + Math.floor(i / cols) * 54, bw, 46, l, { on: ui.filter === k, pressed: ui.filter === k, size: 15, color: M().accent }));
        }
        if (ui.picker) MS.drawPicker(K, A, ui.picker, { tint: M().accent, detailAction: 'picker-detail', full: !!ui.picker.config.panel });
        if (ui.dialog) K.dialog(ui.dialog);
        if (ui.toast && !ui.picker && !ui.dialog) {
            const tw = Math.min(W - 24, K.tw(ui.toast, 14, 700) + 48), tx = (W - tw) / 2;
            K.plate(tx, top + 2, tw, 34, 8, { a: .96, edge: .7, tint: ui.toastBad ? WARN : GOOD, tintA: .25 });
            K.line(ui.toast, W / 2, top + 19.5, tw - 20, 14, ui.toastBad ? WARN : GOOD, 'center', 700, 10);
        }
    }
    function topBar(A, K, x, y, w, h, mobile) {
        const cy = y + h / 2, mm = M();
        K.gem(x + 12, cy, 9, K.steel(x, y, 24, h)); K.gem(x + 12, cy, 5, mm.accent);
        K.text(mm.title, x + 30, cy + 1, mobile ? 19 : 24, K.INK, 'left', 800);
        const tw0 = K.tw(mm.title, mobile ? 19 : 24, 800);
        if (!mobile) K.chip(mm.count + ' ' + fmt(data.list.length), x + 42 + tw0, cy - 11, mm.accent, { h: 22, size: 12 });
        const regW = mobile ? 108 : 150, refW = h - 8;
        K.btn('register', '', x + w - regW, y + 4, regW, h - 8, mm.register, { primary: true, glyph: 'plus', size: mobile ? 14 : 15 });
        K.btn('refresh', '', x + w - regW - 8 - refW, y + 4, refW, h - 8, '', { glyph: 'refresh', aria: '새로고침', disabled: data.loading });
        let px = x + w - regW - 16 - refW;
        if (!mobile) for (const c of ['garnet', 'gold']) {
            const v = fmt(wallet()[c]), cw = 50 + K.tw(v, 15, 800); px -= cw;
            K.plate(px, y + 5, cw, h - 10, 7, { a: .7, edge: .7 }); A.currency(c, px + 6, y + 10, h - 20);
            K.line(v, px + cw - 9, cy + .5, cw - h + 4, 15, K.INK, 'right', 800, 11); px -= 8;
        }
        K.rule(x, y + h + 5, w, .8, mm.accent);
        return y + h + 14;
    }
    function toolbar(A, K, x, y, w, mobile) {
        const tabs = [...KINDS, ['mine', M().mine]];
        if (mode === 'buy') tabs.push(['can', '판매 가능']);
        const canCount = mode === 'buy' ? data.list.filter(canFill).length : 0;
        const rowH = mobile ? 36 : 40;
        if (mobile) {
            const cur = tabs.find(t => t[0] === ui.filter), fw = (w - 12) * .4, cw = (w - 12) * .3, sw = w - fw - cw - 12;
            K.btn('filters-open', '', x, y, fw, rowH, cur[1], { on: ui.filter !== 'all', size: 13, color: M().accent, badge: mode === 'buy' && canCount ? String(canCount) : null, aria: '분류 ' + cur[1] });
            K.btn('currency-cycle', '', x + fw + 6, y, cw, rowH, ui.currency === 'all' ? '모든 화폐' : CUR[ui.currency], { size: 12, icon: ui.currency === 'all' ? null : ui.currency });
            K.btn('sort-cycle', '', x + fw + cw + 12, y, sw, rowH, SORTS.find(s => s[0] === ui.sort)[1], { size: 12 });
            y += rowH + 6;
            search(A, K, x, y, w, rowH);
            return y + rowH + 10;
        }
        let tx = x;
        tabs.forEach(([k, l]) => {
            const bw = Math.max(64, K.tw(l, 13, 700) + 30 + (k === 'can' && canCount ? 26 : 0));
            K.btn('filter', k, tx, y, bw, rowH, l, { on: ui.filter === k, pressed: ui.filter === k, size: 13, color: M().accent, badge: k === 'can' && canCount ? String(canCount) : null }); tx += bw + 6;
        });
        y += rowH + 8;
        let cx = x;
        [['all', '전체']].concat(Object.entries(CUR)).forEach(([k, l]) => { const bw = k === 'all' ? 64 : 84; K.btn('currency', k, cx, y, bw, rowH, l, { on: ui.currency === k, pressed: ui.currency === k, size: 13, icon: k === 'all' ? null : k, color: M().accent }); cx += bw + 4; });
        cx += 10;
        SORTS.forEach(([k, l]) => { const bw = K.tw(l, 13, 700) + 26; K.btn('sort', k, cx, y, bw, rowH, l, { on: ui.sort === k, pressed: ui.sort === k, size: 13, color: M().accent }); cx += bw + 4; });
        search(A, K, cx + 10, y, x + w - cx - 10, rowH);
        return y + rowH + 12;
    }
    function search(A, K, x, y, w, h) {
        if (w < 80) return;
        K.well(x, y, w, h, 6); K.glyph('search', x + 17, y + h / 2, 13, K.DIM);
        A.field('search', x + 30, y + 2, w - 34, h - 4, { value: ui.query, placeholder: '이름, 등급, 성급, ' + M().whoLabel, label: M().title + ' 검색', maxLength: 30 });
    }
    function board(A, K, x, y, w, h, mobile) {
        K.plate(x, y, w, h, 14, { a: .5, tint: M().accent, tintA: .08 });
        const p = mobile ? 8 : 12, list = visible(), gx = x + p, gw = w - p * 2, gh = h - p * 2 - 52;
        if (data.loading && !data.list.length) { K.text('불러오는 중', x + w / 2, y + h / 2, 15, K.DIM, 'center', 600); return; }
        if (data.error && !data.list.length) { K.text(data.error, x + w / 2, y + h / 2, 14, WARN, 'center', 700); return; }
        if (!list.length) {
            const n = Math.max(2, Math.min(6, Math.floor(gw / 150)));
            for (let i = 0; i < n; i++) { const sw = (gw - 10 * (n - 1)) / n; K.well(gx + i * (sw + 10), y + p, sw, Math.min(220, gh), 9); K.gem(gx + i * (sw + 10) + sw / 2, y + p + Math.min(220, gh) / 2, 5, 'rgba(255,255,255,.07)'); }
            if (!ui.query && ui.filter === 'all' && ui.currency === 'all') A.hit('register', 'empty', gx, y + p, gw, Math.min(220, gh), M().register, false);
            return;
        }
        const minW = mobile ? 0 : 156, cols = mobile ? 1 : Math.max(2, Math.floor((gw + 10) / (minW + 10)));
        const ch0 = mobile ? 96 : 246, minH = mobile ? 92 : 204, rows = Math.max(1, Math.floor((gh + 10) / (minH + 10))), per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per));
        ui.page = K.clamp(ui.page, 0, pages - 1);
        const cw = (gw - 10 * (cols - 1)) / cols, ch = Math.min(mobile ? 104 : ch0 * 1.2, (gh - 10 * (rows - 1)) / rows);
        list.slice(ui.page * per, ui.page * per + per).forEach((e, i) => listing(A, K, e, gx + (i % cols) * (cw + 10), y + p + Math.floor(i / cols) * (ch + 10), cw, ch, mobile));
        K.pager(gx, y + h - p - 44, gw, ui.page, pages, 'page-previous', 'page-next');
    }
    function listing(A, K, e, x, y, w, h, mobile) {
        const info = infoOf(e), on = ui.selected === e.id, mm = M(), badges = [];
        if (e.mine) badges.push({ text: mm.mine, color: mm.accent });
        if (isBest(e)) badges.push({ text: mm.best, color: GOOD });
        if (canFill(e)) badges.push({ text: '보유', color: GOLD });
        const footH = 44, side = (sx, sy, sw, sh) => {
            K.well(sx, sy, sw, sh, 6, K.rgba(mm.accent, .08));
            A.currency(e.currency, sx + 8, sy + sh / 2 - 17, 16);
            K.line(fmt(e.unitPrice), sx + sw - 8, sy + sh / 2 - 9, sw - 32, 14, GOLD, 'right', 800, 10);
            K.line((e.kind === 'item' && e.count > 1 ? '개당  ' : '') + e[mm.who], sx + sw - 8, sy + sh / 2 + 12, sw - 14, 10, K.MUTE, 'right', 700, 8);
        };
        K.slot(info, x, y, w, h, { action: 'pick', id: e.id, on, small: mobile, chips: [...badges, ...info.chips], side: mobile ? side : null, sideW: 118, footer: mobile ? null : (fx, fy, fw, fh) => {
            K.well(fx + 6, fy, fw - 12, fh - 6, 6, K.rgba(mm.accent, .08));
            const isz = 18; A.currency(e.currency, fx + 12, fy + 6, isz);
            K.line(fmt(e.unitPrice), fx + 16 + isz, fy + 15, fw - isz - 36, 15, GOLD, 'left', 800, 10);
            const sub = (e.kind === 'item' && e.count > 1 ? '개당  ' : '') + e[mm.who];
            K.line(sub, fx + 12, fy + 31, fw - 24, 10, K.MUTE, 'left', 700, 8);
        }, footerH: footH, aria: [info.title, ...badges.map(b => b.text), fmt(e.unitPrice) + ' ' + CUR[e.currency], mm.whoLabel + ' ' + e[mm.who]].join(', ') });
    }
    // 감정대와 거래 버튼
    function detailPanel(A, K, x, y, w, h, inOverlay) {
        const e = selectedEntry() || (inOverlay ? null : visible()[0] || null);
        if (!e) { K.inspect(null, x, y, w, h, {}); return; }
        if (!inOverlay && !ui.selected) ui.selected = e.id;
        const info = infoOf(e), actH = actionHeight(e);
        K.inspect(info, x, y, w, h, { bottom: actH, detail: info.detail ? 'detail' : null, detailId: e.id, a: inOverlay ? .985 : .6 });
        actions(A, K, e, x + 16, y + h - actH, w - 32, actH - 14);
    }
    function actionHeight(e) {
        if (mode === 'sell') return e.mine ? 128 : (e.kind === 'item' ? 232 : 178);
        return e.mine ? 150 : 168;
    }
    function row(K, label, value, x, y, w, color, goods, A) {
        K.text(label, x, y + 9, 12, K.DIM, 'left', 700);
        const vw = K.tw(value, 14, 800);
        if (goods) A.currency(goods, x + w - vw - 22, y, 18);
        K.text(value, x + w, y + 9, 14, color || K.INK, 'right', 800);
    }
    function actions(A, K, e, x, y, w, h) {
        const mm = M(), cur = CUR[e.currency];
        K.rule(x, y, w, .6, mm.accent); let yy = y + 10;
        row(K, mm.whoLabel, e[mm.who], x, yy, w, K.INK); yy += 24;
        if (mode === 'sell' && !e.mine) {
            const max = e.kind === 'item' ? Math.max(1, e.count) : 1; ui.qty = K.clamp(ui.qty, 1, max);
            if (e.kind === 'item') {
                K.text('수량', x, yy + 20, 12, K.DIM, 'left', 700);
                K.btn('qty-minus', '', x + 52, yy, 40, 40, '', { glyph: 'minus', disabled: ui.qty <= 1, aria: '수량 줄이기' });
                K.well(x + 98, yy, w - 98 - 46 - 70, 40, 6); A.field('qty', x + 104, yy + 2, w - 98 - 46 - 82, 36, { value: String(ui.qty), numeric: true, center: true, big: true, label: '구매 수량', maxLength: 9 });
                K.btn('qty-plus', '', x + w - 46 - 70 + 6, yy, 40, 40, '', { glyph: 'plus', disabled: ui.qty >= max, aria: '수량 늘리기' });
                K.btn('qty-max', '', x + w - 64, yy, 64, 40, '최대', { size: 13, disabled: ui.qty >= max });
                yy += 48;
            }
            const total = e.unitPrice * ui.qty, bal = Number(wallet()[e.currency] || 0), after = bal - total;
            row(K, e.kind === 'item' ? '총 결제 (' + fmt(ui.qty) + '개)' : '가격', fmt(total), x, yy, w, GOLD, e.currency, A); yy += 24;
            row(K, '결제 후 ' + cur, fmt(after), x, yy, w, after < 0 ? WARN : GOOD, e.currency, A); yy += 26;
            if (e.ticketCost > 0) { K.chip('거래권 ' + e.ticketCost + '장 사용', x, yy, '#ffcf7a', { h: 22, size: 11 }); }
            const lack = after < 0;
            K.btn('buy', e.id, x, y + h - 50, w, 50, lack ? cur + ' 부족' : '구매', { primary: true, size: 18, disabled: lack, aria: infoOf(e).title + ' ' + fmt(ui.qty) + '개 구매, ' + fmt(total) + ' ' + cur });
        } else if (mode === 'sell') {
            row(K, e.kind === 'item' ? '개당 가격  ×' + fmt(e.count) : '판매가', fmt(e.unitPrice), x, yy, w, GOLD, e.currency, A);
            K.btn('cancel-entry', e.id, x, y + h - 50, w, 50, '판매 취소', { danger: true, size: 16 });
        } else if (!e.mine) {
            row(K, '요청 수량', fmt(e.count) + '개', x, yy, w, K.INK); yy += 24;
            row(K, '개당 가격', fmt(e.unitPrice), x, yy, w, GOLD, e.currency, A); yy += 26;
            if (data.sellable && !canFill(e)) K.chip('보유 물품 없음', x, yy, WARN, { h: 22, size: 11 });
            else if (canFill(e)) K.chip('보유 중', x, yy, GOLD, { h: 22, size: 11 });
            K.btn('fill', e.id, x, y + h - 50, w, 50, '판매하기', { primary: true, size: 18 });
        } else {
            row(K, '남은 수량', fmt(e.count) + '개', x, yy, w, K.INK); yy += 24;
            row(K, '취소 시 반환', fmt(e.unitPrice * e.count), x, yy, w, GOOD, e.currency, A); yy += 24;
            if (e.ticketCost > 0) K.chip('거래권 ' + fmt(e.ticketCost * e.count) + '장 반환', x, yy, '#ffcf7a', { h: 22, size: 11 });
            K.btn('cancel-entry', e.id, x, y + h - 50, w, 50, '구매 등록 취소', { danger: true, size: 16 });
        }
    }

    // ── 등록, 판매(이행)용 보관함의 추가 조작
    // 가격 줄: 이름표와 시세 바로 넣기 단추, 그 아래 금액 칸과 화폐 두 개를 한 줄에 둔다.
    // 단추 왼쪽 색 막대는 시세 그래프의 같은 값 선 색이다.
    function priceBlock(K, A, P, x, y, w, opts = {}) {
        K.text(opts.priceLabel || '가격', x, y + 9, 12, K.DIM, 'left', 700);
        let rx = x + w;
        (opts.quick || []).slice().reverse().forEach(q => {
            const label = q.label + ' ' + fmt(q.value), qw = Math.min(K.tw(label, 11, 800) + 26, (w - 64) / 2);
            rx -= qw;
            K.btn('reg-quick', q.key, rx, y - 4, qw, 26, label, { size: 11, align: 'left', aria: q.label + ' ' + fmt(q.value) + ' 가격으로 맞추기' });
            K.C.fillStyle = q.color; K.C.fillRect(rx + 5, y + 2, 3, 14);
            rx -= 6;
        });
        y += 26;
        const tw = 62, fw = w - tw * 2 - 12;
        K.well(x, y, fw, 44, 6); A.currency(P.currency, x + 10, y + 11, 22);
        // 큰 금액은 칸 오른쪽에 만, 억 단위로 줄여 함께 보인다(입력 글자와 겹치지 않을 때만).
        const value = Number(P.price) || 0, unit = value >= 1e4 ? short(value) : '';
        if (unit && 44 + K.tw(P.price, 18, 700) + K.tw(unit, 13, 800) + 18 < fw) K.text(unit, x + fw - 10, y + 22.5, 13, K.rgba(GOLD, .75), 'right', 800);
        A.field('reg-price', x + 40, y + 2, fw - 48, 40, { value: P.price, placeholder: '0', numeric: true, big: true, label: (opts.priceLabel || '가격') + ' ' + CUR[P.currency], maxLength: 16 });
        Object.entries(CUR).forEach(([k, l], i) => K.btn('reg-currency', k, x + fw + 6 + i * (tw + 6), y, tw, 44, l, { on: P.currency === k, pressed: P.currency === k, size: 12, color: M().accent }));
        return y + 52;
    }
    function stepper(K, A, label, value, x, y, w, minus, plus, o = {}) {
        K.text(label, x, y + 20, 12, K.DIM, 'left', 700);
        const lw = 64;
        K.btn(minus, '', x + lw, y, 40, 40, '', { glyph: 'minus', disabled: o.minDisabled, aria: label + ' 줄이기' });
        K.well(x + lw + 46, y, w - lw - 92, 40, 6);
        if (o.field) A.field(o.field, x + lw + 52, y + 2, w - lw - 104, 36, { value: String(value), numeric: true, center: true, big: true, label, maxLength: 9 });
        else K.line(String(value), x + lw + 46 + (w - lw - 92) / 2, y + 20, w - lw - 100, 16, o.color || K.INK, 'center', 800, 10);
        K.btn(plus, '', x + w - 40, y, 40, 40, '', { glyph: 'plus', disabled: o.maxDisabled, aria: label + ' 늘리기' });
        return y + 46;
    }
    // 판매 등록 (팝니다)
    async function openSellRegister() {
        ui.picker = MS.createPicker({ title: '판매 등록', kinds: [{ key: 'card', label: '카드', entries: [] }], submitLabel: '등록하기', panel: marketPanelConfig });
        Object.assign(ui.picker, { currency: 'gold', price: '' });
        data.history.clear();
        ui.picker.error = '보유 목록 확인 중'; stage.play('paper'); stage.invalidate();
        await reloadSellable(ui.picker, 'card');
    }
    async function reloadSellable(P, keepKind) {
        try {
            const s = await api('/api/auction/sellable'); data.sellable = s;
            if (ui.picker !== P) return;
            const typeRank = { 각성: 0, 전직: 1, 일반: 2 };
            const tradeChip = e => e.raw.tradeCount != null ? [{ text: '거래 ' + fmt(e.raw.tradeCount) + '회 남음', color: DIM }] : [];
            P.config.kinds = [
                { key: 'card', label: '카드', entries: s.cards.slice().sort((a, b) => b.star - a.star || (typeRank[a.type] ?? 3) - (typeRank[b.type] ?? 3)).map(c => ({ key: 'c' + c.index, raw: c, info: MS.identify(c, 'card') })), filter: e => (e.raw.type || '일반') + ' 카드' },
                { key: 'equipment', label: '장비', entries: s.equipment.map(q => ({ key: 'e' + q.index, raw: q, info: MS.identify(q, 'equipment') })), filter: e => e.raw.typeLabel },
                { key: 'item', label: '아이템', entries: s.items.map(i => ({ key: 'i' + i.id, raw: i, info: MS.identify(i, 'item') })), filter: e => e.raw.type || '기타', quantity: e => e.raw.count },
                { key: 'pet', label: '펫', entries: (s.pets || []).map(p => { const info = MS.identify(p, 'pet'); info.chips = info.chips.concat(tradeChip({ raw: p })); return { key: 'p' + p.index, raw: p, info }; }), filter: e => e.raw.rarity },
                { key: 'avatar', label: '아바타', entries: (s.avatars || []).map(a => { const info = MS.identify(a, 'avatar'); if (a.grade === '유니크') info.chips.push({ text: '거래 ' + Math.max(0, 3 - Number(a.trades || 0)) + '회 남음', color: DIM }); return { key: 'a' + a.id, raw: a, info }; }), filter: e => e.raw.grade || '일반' }
            ];
            P.kind = keepKind || P.kind; P.error = '';
            P.config.extraHeight = () => 84;
            P.config.extra = (K, A, P2, kind, sel, x, y, w) => priceBlock(K, A, P2, x, y, w, { priceLabel: kind.key === 'item' ? '개당 가격' : '가격', quick: quickPrices(P2, kind, sel) });
        } catch (error) { if (ui.picker === P) P.error = error.message; }
        stage?.invalidate();
    }
    async function submitSell(P) {
        const kind = P.kind, sel = MS.pickerSelected(P);
        if (!sel) { P.error = KIND_LABEL[kind] + '를 선택해주세요.'; return; }
        const price = Number(P.price);
        if (!Number.isInteger(price) || price < 1) { P.error = '가격은 1 이상의 정수여야 합니다.'; return; }
        const body = { kind, currency: P.currency, price };
        if (kind === 'item') {
            const count = Number(P.amount || 1);
            if (!Number.isInteger(count) || count < 1 || count > sel.raw.count) { P.error = '갯수를 확인해주세요.'; return; }
            Object.assign(body, { itemId: sel.raw.id, count });
        } else if (kind === 'avatar') Object.assign(body, { name: sel.raw.name, avatarId: sel.raw.id });
        else body.index = sel.raw.index;
        ui.working = true; stage.invalidate();
        try {
            await postApi('/api/auction/register', body);
            stage.play('stamp'); stage.pulse(); data.history.clear();
            P.done = sel.info.title; P.selected = null; P.amount = ''; P.price = '';
            refreshProfile(); await load(); await reloadSellable(P, kind);
        } catch (error) { P.error = error.message; }
        finally { ui.working = false; stage?.invalidate(); }
    }

    // 구매 등록 (삽니다)
    async function openBuyRegister() {
        const P = ui.picker = MS.createPicker({ title: '구매 등록', kinds: [{ key: 'card', label: '카드', entries: [] }], submitLabel: '등록하기', panel: marketPanelConfig });
        Object.assign(P, { currency: 'gold', price: '', star: 0, cardType: '', levelOn: false, level: 0, count: 1 });
        data.history.clear();
        P.error = '목록 확인 중'; stage.play('paper'); stage.invalidate();
        try {
            const lk = await api('/api/buyorder/lookups');
            if (ui.picker !== P) return;
            const plain = (info) => { info.chips = info.chips.filter(c => !/^\+\d+$/.test(c.text)); info.corner = null; return info; };
            P.config.kinds = [
                { key: 'card', label: '카드', entries: lk.cards.map(c => { const info = MS.identify({ formatted: c.name, star: 0, type: '일반', imageUrl: c.imageUrl }, 'card'); info.chips = []; info.corner = null; info.detail = false; return { key: 'c' + c.id, raw: c, info }; }) },
                { key: 'equipment', label: '장비', entries: Object.entries(lk.equipment).flatMap(([type, list]) => list.map(q => ({ key: 'e' + type + ':' + q.id, raw: { ...q, type }, info: plain(MS.identify({ ...q, typeLabel: EQUIP[type], level: 0 }, 'equipment')) }))), filter: e => EQUIP[e.raw.type] },
                { key: 'item', label: '아이템', entries: lk.items.map(i => { const info = MS.identify({ ...i, count: 0 }, 'item'); return { key: 'i' + i.id, raw: i, info }; }), filter: e => e.raw.type || '기타' },
                { key: 'pet', label: '펫', entries: (lk.pets || []).map(p => ({ key: 'p' + p.id, raw: p, info: MS.identify(p, 'pet') })), filter: e => e.raw.rarity },
                { key: 'avatar', label: '아바타', entries: (lk.avatars || []).map(a => ({ key: 'a' + a.name, raw: a, info: MS.identify(a, 'avatar') })), filter: e => e.raw.grade || '일반' }
            ];
            P.error = '';
            P.config.extraHeight = kind => (kind.key === 'card' ? 92 : kind.key === 'equipment' ? 92 : 0) + (kind.key === 'avatar' ? 0 : 46) + 84 + 26;
            P.config.extra = (K, A, P2, kind, sel, x, y, w) => {
                let yy = y;
                if (kind.key === 'card') {
                    const starText = P2.star + 1 === 10 ? '𝛧' : P2.star + 1 === 11 ? '𝛴' : P2.star + 1 === 12 ? '𝛀' : (P2.star + 1) + '성';
                    yy = stepper(K, A, '성급', '[' + starText + '] ' + (P2.cardType ? P2.cardType + ' ' : '') + sel.raw.name, x, yy, w, 'reg-star-minus', 'reg-star-plus', { minDisabled: P2.star <= 0, maxDisabled: P2.star >= 11, color: MS.STAR_COLORS[P2.star] });
                    const half = (w - 6) / 2;
                    [['', '종류 무관'], ['일반', '일반']].forEach(([k, l], i) => K.btn('reg-type', k || 'any', x + i * (half + 6), yy, half, 38, l, { on: P2.cardType === k, pressed: P2.cardType === k, size: 13, color: M().accent }));
                    yy += 46;
                } else if (kind.key === 'equipment') {
                    const half = (w - 6) / 2;
                    [[false, '강화 무관'], [true, '강화 지정']].forEach(([k, l], i) => K.btn('reg-level-on', k ? 'on' : 'off', x + i * (half + 6), yy, half, 38, l, { on: P2.levelOn === k, pressed: P2.levelOn === k, size: 13, color: M().accent }));
                    yy += 44;
                    if (P2.levelOn) yy = stepper(K, A, '강화', '+' + P2.level, x, yy, w, 'reg-level-minus', 'reg-level-plus', { minDisabled: P2.level <= 0, maxDisabled: P2.level >= 15, color: GOLD });
                    else yy += 46;
                }
                if (kind.key !== 'avatar') yy = stepper(K, A, '수량', P2.count, x, yy, w, 'reg-count-minus', 'reg-count-plus', { field: 'reg-count', minDisabled: P2.count <= 1 });
                yy = priceBlock(K, A, P2, x, yy, w, { priceLabel: '개당 가격', quick: quickPrices(P2, kind, sel) });
                const count = kind.key === 'avatar' ? 1 : P2.count, total = (Number(P2.price) || 0) * count;
                const tickets = kind.key === 'card' ? Math.max(0, P2.star - 3) * count : 0;
                K.line('선결제 ' + fmt(total) + ' ' + CUR[P2.currency] + (tickets ? '   거래권 ' + tickets + '장' : ''), x, yy + 6, w, 13, GOLD, 'left', 800, 10);
                return yy + 20;
            };
        } catch (error) { if (ui.picker === P) P.error = error.message; }
        stage?.invalidate();
    }
    async function submitBuy(P) {
        const kind = P.kind, sel = MS.pickerSelected(P);
        if (!sel) { P.error = KIND_LABEL[kind] + '를 선택해주세요.'; return; }
        const price = Number(P.price);
        if (!Number.isInteger(price) || price < 1) { P.error = '가격은 1 이상의 정수여야 합니다.'; return; }
        const count = kind === 'avatar' ? 1 : Math.floor(Number(P.count) || 1);
        if (count < 1) { P.error = '갯수는 1 이상의 정수여야 합니다.'; return; }
        const body = { kind, currency: P.currency, price, count };
        if (kind === 'card') { body.cardId = sel.raw.id; body.star = P.star; if (P.cardType) body.type = P.cardType; }
        else if (kind === 'avatar') body.name = sel.raw.name;
        else if (kind === 'equipment') { body.equipType = sel.raw.type; body.equipId = sel.raw.id; if (P.levelOn) body.level = P.level; }
        else if (kind === 'pet') body.petId = sel.raw.id;
        else body.itemId = sel.raw.id;
        ui.working = true; stage.invalidate();
        try {
            await postApi('/api/buyorder/register', body);
            stage.play('stamp'); stage.pulse(); data.history.clear();
            P.done = sel.info.title; P.price = '';
            refreshProfile(); await load();
        } catch (error) { P.error = error.message; }
        finally { ui.working = false; stage?.invalidate(); }
    }

    // ── 시세판: 고른 품목의 최근 거래가 그래프. 금색 선이 체결가, 점선이 지금 걸린 팝니다 최저가와 삽니다 최고가, 흰 선이 입력한 가격이다.
    // 카드는 같은 번호와 성급, 장비와 펫은 같은 번호끼리 모으고, 카드 종류와 강화 수치(variant)는 고른 것만 보거나 전체를 본다.
    const variantLabel = v => typeof v === 'number' ? '+' + v : String(v);
    const pad2 = n => String(n).padStart(2, '0');
    const marketPanelConfig = { min: 128, max: 320, draw: marketPanel };
    function historyFor(key) {
        let h = data.history.get(key);
        if (!h) {
            h = { loading: true, error: '', trades: [], asks: [], bids: [] }; data.history.set(key, h);
            api('/api/market/history?key=' + encodeURIComponent(key))
                .then(r => Object.assign(h, { trades: r.trades || [], asks: r.asks || [], bids: r.bids || [] }))
                .catch(error => { h.error = error.message; })
                .finally(() => { h.loading = false; stage?.invalidate(); });
        }
        return h;
    }
    // 판매 등록은 내 물건, 구매 등록은 고른 조건으로 품목 키와 종류를 정한다(server.js marketKey, marketVariant와 같은 규칙).
    function marketTarget(P, kind, sel) {
        if (!sel || !kind) return null;
        const r = sel.raw, buy = mode === 'buy';
        if (kind.key === 'card') return { key: 'c:' + r.id + ':' + (buy ? P.star : r.star), variant: buy ? P.cardType || null : r.type || '일반' };
        if (kind.key === 'equipment') return { key: 'e:' + r.type + ':' + r.id, variant: buy ? (P.levelOn ? P.level : null) : Number(r.level || 0) };
        if (kind.key === 'item') return { key: 'i:' + r.id, variant: null };
        if (kind.key === 'pet') return { key: 'p:' + r.id, variant: buy ? null : Number(r.level || 0) };
        if (kind.key === 'avatar') return { key: 'a:' + r.name, variant: null };
        return null;
    }
    function marketView(P, kind, sel) {
        const t = marketTarget(P, kind, sel); if (!t) return null;
        const h = historyFor(t.key), item = t.key + '|' + t.variant;
        if (P.chartItem !== item) { P.chartItem = item; P.chartAll = false; P.chartPick = -1; }
        const exact = t.variant != null && !P.chartAll, cur = P.currency, other = cur === 'gold' ? 'garnet' : 'gold';
        const same = v => !exact || v === t.variant, open = list => list.filter(x => !x.mine);
        const pick = c => ({
            trades: h.trades.filter(x => x.currency === c && same(x.variant)).sort((a, b) => a.time - b.time),
            asks: open(h.asks).filter(x => x.currency === c && same(x.variant)),
            bids: open(h.bids).filter(x => x.currency === c && (x.variant == null || same(x.variant)))
        });
        const s = pick(cur), o = pick(other), n = s.trades.length, total = s.trades.reduce((sum, x) => sum + x.count, 0);
        return {
            ...t, h, cur, other, trades: s.trades,
            otherCount: o.trades.length + o.asks.length + o.bids.length,
            variants: t.variant != null && (h.trades.some(x => x.currency === cur && x.variant !== t.variant) || open(h.asks).some(x => x.currency === cur && x.variant !== t.variant)),
            last: n ? s.trades[n - 1].price : 0, prev: n > 1 ? s.trades[n - 2].price : 0,
            avg: total ? Math.round(s.trades.reduce((sum, x) => sum + x.price * x.count, 0) / total) : 0,
            ask: s.asks.length ? Math.min(...s.asks.map(x => x.price)) : 0,
            bid: s.bids.length ? Math.max(...s.bids.map(x => x.price)) : 0
        };
    }
    // 가격 줄 바로 넣기: 최근 거래가, 그리고 판매 등록은 팝니다 최저가, 구매 등록은 삽니다 최고가.
    function quickPrices(P, kind, sel) {
        const v = marketView(P, kind, sel); if (!v) return [];
        return [{ key: 'last', label: '최근', value: v.last, color: LINE.trade },
            mode === 'buy' ? { key: 'bid', label: '최고', value: v.bid, color: LINE.bid } : { key: 'ask', label: '최저', value: v.ask, color: LINE.ask }].filter(q => q.value > 0);
    }
    function chartGrid(K, x, y, w, h) {
        K.well(x, y, w, h, 8, 'rgba(2,4,8,.42)');
        for (let i = 1; i < 4; i++) { K.C.fillStyle = 'rgba(255,255,255,.045)'; K.C.fillRect(x + 10, Math.round(y + h * i / 4), w - 20, 1); }
    }
    function marketPanel(K, A, P, kind, sel, x, y, w, h) {
        const v = marketView(P, kind, sel);
        if (!v) { chartGrid(K, x, y, w, h); K.gem(x + w / 2, y + h / 2, 6, 'rgba(255,255,255,.08)'); return; }
        const sig = [v.key, v.variant, !!P.chartAll, v.cur, v.h.loading].join('|');
        if (P.chartSig !== sig) { P.chartSig = sig; P.chartAt = A.time || 0; P.chartPick = -1; }
        // 보여 줄 값이 없으면 머리 없이 빈 그래프 판만 둔다(불러오는 중, 기록 없음, 다른 화폐 시세 단추).
        const any = v.trades.length || v.ask || v.bid;
        if (v.h.loading || v.h.error || (!any && !v.variants)) { priceChart(K, A, P, v, x, y, w, h); return; }
        // 고른 종류의 기록만 비어 있으면 머리에는 종류 고르기 단추만 남긴다.
        const tight = h < 200 || !any, headH = !any ? 40 : tight ? 36 : 62;
        // 오른쪽 위: 고른 강화 수치나 카드 종류만 볼지, 전체를 볼지
        let right = x + w;
        if (v.variants) [['all', '전체'], ['one', variantLabel(v.variant)]].forEach(([id, label]) => {
            const bw = Math.max(52, K.tw(label, 12, 700) + 26), on = (id === 'all') === !!P.chartAll;
            right -= bw; K.btn('reg-variant', id, right, y, bw, 30, label, { on, pressed: on, size: 12, color: LINE.trade, aria: '시세 ' + label }); right -= 5;
        });
        // 왼쪽: 최근 거래가와 직전 거래 대비 등락, 오른쪽 아래에 평균
        const vy = tight ? y + 15 : y + 44, isz = tight ? 18 : 24;
        if (!tight) K.text('최근 거래가', x + 2, y + 11, 12, K.DIM, 'left', 700);
        else if (!any) K.text(variantLabel(v.variant) + ' 기록 없음', x + 2, vy, 13, K.MUTE, 'left', 700);
        if (v.trades.length) {
            const avgText = !tight && w >= 320 ? fmt(v.avg) : '', avgW = avgText ? K.tw(avgText, 14, 800) + K.tw('평균', 11, 700) + 16 : 0;
            A.currency(v.cur, x, vy - isz / 2, isz);
            const tx = x + isz + 6, vw = K.line(fmt(v.last), tx, vy + 1, (tight ? right : x + w) - tx - avgW - 84, tight ? 18 : 25, K.GOLD, 'left', 800, 12);
            if (v.prev && v.prev !== v.last) {
                const up = v.last > v.prev, pct = Math.abs(v.last - v.prev) / v.prev * 100;
                K.chip((up ? '▲ ' : '▼ ') + (pct >= 100 ? Math.round(pct) : pct.toFixed(1)) + '%', tx + vw + 8, vy - 10, up ? LINE.up : LINE.down, { h: 21, size: 11 });
            }
            if (avgText) { K.text(avgText, x + w, vy + 1, 14, K.INK, 'right', 800); K.text('평균', x + w - K.tw(avgText, 14, 800) - 6, vy + 1, 11, K.DIM, 'right', 700); }
        } else if (!v.h.loading && !v.h.error && (v.ask || v.bid)) K.text('거래 기록 없음', x + 2, vy, 14, K.MUTE, 'left', 700);
        priceChart(K, A, P, v, x, y + headH, w, h - headH);
    }
    function niceStep(span, count) { const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return Math.max(1, (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag); }
    function priceChart(K, A, P, v, x, y, w, h) {
        const C = K.C, S = K.S, n = v.trades.length, mine = Number(P.price) || 0;
        const refs = [v.ask && { value: v.ask, color: LINE.ask, label: '팝니다 최저' }, v.bid && { value: v.bid, color: LINE.bid, label: '삽니다 최고' }].filter(Boolean);
        if (v.h.loading || v.h.error || (!n && !refs.length)) {
            chartGrid(K, x, y, w, h);
            const swap = !v.h.loading && !v.h.error && v.otherCount > 0;
            // 고른 종류만 비었을 때는 머리에 이미 적혀 있다.
            K.line(v.h.loading ? '불러오는 중' : v.h.error || (v.variants ? '' : '거래 기록 없음'), x + w / 2, y + h / 2 - (swap ? 20 : 0), w - 24, 13, v.h.error ? K.WARN : K.DIM, 'center', 700, 10);
            if (swap) { const label = CUR[v.other] + ' 시세', bw = K.tw(label, 13, 700) + 64; K.btn('reg-chart-currency', v.other, x + (w - bw) / 2, y + h / 2 + 2, bw, 38, label, { size: 13, icon: v.other, aria: CUR[v.other] + ' 시세 보기' }); }
            return;
        }
        K.well(x, y, w, h, 8, 'rgba(2,4,8,.42)');
        // 범례: 그려지는 기준선만 적는다.
        const legend = h >= 130 ? refs.concat(mine ? [{ label: '내 가격', color: LINE.mine, solid: true }] : []) : [];
        let lx = x + 12, shown = 0;
        for (const item of legend) {
            const lw = 19 + K.tw(item.label, 11, 700);
            if (lx + lw > x + w - 8) break;
            C.save(); C.strokeStyle = item.color; C.lineWidth = 1.8; if (!item.solid) C.setLineDash([4, 3]);
            C.beginPath(); C.moveTo(lx, y + 15); C.lineTo(lx + 14, y + 15); C.stroke(); C.restore();
            K.text(item.label, lx + 19, y + 15.5, 11, K.DIM, 'left', 700); lx += lw + 14; shown++;
        }
        const gut = w >= 320 ? 82 : 72, l = x + 10, r = x + w - gut, t = y + (shown ? 34 : 16), b = y + h - 24, pw = r - l, ph = Math.max(12, b - t);
        // 세로 범위: 체결가와 걸린 가격. 입력한 가격은 너무 멀지 않을 때만 넣고, 멀면 값표를 끝에 붙여 화살표로 알린다.
        const vals = v.trades.map(q => q.price).concat(refs.map(q => q.value));
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (mine && mine >= lo / 3 && mine <= hi * 3) { lo = Math.min(lo, mine); hi = Math.max(hi, mine); }
        if (hi - lo < hi * .04) { const pad = Math.max(1, hi * .06); lo -= pad; hi += pad; }
        const padY = (hi - lo) * .14; lo = Math.max(0, lo - padY); hi += padY;
        const Y = val => b - (val - lo) / (hi - lo) * ph;
        const step = niceStep(hi - lo, ph > 150 ? 4 : ph > 80 ? 3 : 2);
        for (let g = Math.ceil(lo / step) * step, guard = 0; g <= hi && guard < 12; g += step, guard++) {
            const gy = Math.round(Y(g)) + .5; if (gy < t - 2 || gy > b + 1) continue;
            C.fillStyle = 'rgba(255,255,255,.055)'; C.fillRect(l, gy - .5, pw, 1);
            K.text(short(g), l + 3, gy - 7, 10, K.MUTE, 'left', 700);
        }
        const sx = pw / Math.max(1, n), X = i => l + sx * (i + .5), pts = v.trades.map((q, i) => [X(i), Y(q.price)]);
        const k = A.reduced ? 1 : K.clamp(((A.time || 0) - P.chartAt) / 560, 0, 1), ease = 1 - Math.pow(1 - k, 3);
        if (k < 1) A.again();
        refs.forEach(ref => { const ry = Math.round(K.clamp(Y(ref.value), t, b)) + .5; C.save(); C.setLineDash([6, 5]); C.lineWidth = 1.4; C.strokeStyle = K.rgba(ref.color, .85); C.beginPath(); C.moveTo(l, ry); C.lineTo(r, ry); C.stroke(); C.restore(); });
        // 체결가: 면, 빛나는 선, 점. 처음 그릴 때 왼쪽에서 오른쪽으로 펼친다.
        if (n) {
            C.save(); C.beginPath(); C.rect(x, y, l - x + pw * ease + 2, h); C.clip();
            if (n > 1) {
                C.beginPath(); C.moveTo(pts[0][0], b); pts.forEach(([px, py]) => C.lineTo(px, py)); C.lineTo(pts[n - 1][0], b); C.closePath();
                const g = C.createLinearGradient(0, t, 0, b); g.addColorStop(0, K.rgba(LINE.trade, .28)); g.addColorStop(1, K.rgba(LINE.trade, 0)); C.fillStyle = g; C.fill();
                C.beginPath(); pts.forEach(([px, py], i) => i ? C.lineTo(px, py) : C.moveTo(px, py));
                C.lineWidth = 2.2; C.lineJoin = 'round'; C.lineCap = 'round'; C.strokeStyle = LINE.trade; C.shadowColor = K.rgba(LINE.trade, .65); C.shadowBlur = 10; C.stroke(); C.shadowBlur = 0;
            }
            pts.forEach(([px, py], i) => { const last = i === n - 1; C.beginPath(); C.arc(px, py, last ? 4.4 : 2.7, 0, 7); C.fillStyle = last ? LINE.trade : '#241a06'; C.fill(); C.lineWidth = 1.6; C.strokeStyle = LINE.trade; C.stroke(); });
            const [ex, ey] = pts[n - 1]; C.beginPath(); C.arc(ex, ey, 8.5, 0, 7); C.lineWidth = 1.2; C.strokeStyle = K.rgba(LINE.trade, .4); C.stroke();
            C.restore();
            if (k >= 1) { C.save(); C.setLineDash([2, 3]); C.strokeStyle = K.rgba(LINE.trade, .5); C.lineWidth = 1; C.beginPath(); C.moveTo(ex + 9, Math.round(ey) + .5); C.lineTo(r, Math.round(ey) + .5); C.stroke(); C.restore(); }
        }
        let mineY = 0, mineOut = 0;
        if (mine) { const my = Y(mine); mineOut = my < t ? 1 : my > b ? -1 : 0; mineY = K.clamp(my, t, b); if (!mineOut) { C.fillStyle = K.rgba(LINE.mine, .8); C.fillRect(l, Math.round(mineY) - .5, pw, 1.5); } }
        // 오른쪽 값표: 최근 거래가(금색), 걸린 가격, 입력한 가격. 겹치면 위아래로 민다.
        const tags = [];
        if (n) tags.push({ y: pts[n - 1][1], text: fmt(v.last), color: LINE.trade, solid: true });
        refs.forEach(ref => tags.push({ y: K.clamp(Y(ref.value), t, b), text: fmt(ref.value), color: ref.color }));
        if (mine) tags.push({ y: mineY, text: (mineOut > 0 ? '▲ ' : mineOut < 0 ? '▼ ' : '') + fmt(mine), color: LINE.mine });
        tags.sort((p1, p2) => p1.y - p2.y);
        const gap = Math.min(20, (b - y - 10) / Math.max(1, tags.length - 1));
        for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + gap);
        const spill = tags.length ? tags[tags.length - 1].y - b : 0;
        if (spill > 0) tags.forEach(tag => { tag.y -= spill; });
        tags.forEach(tag => priceTag(K, r + 4, tag.y, gut - 8, 18, tag));
        // 아래 날짜: 하루 안이면 시각, 아니면 월.일. 최근 쪽부터 겹치지 않게 고른다.
        if (n) {
            const oneDay = new Date(v.trades[0].time).toDateString() === new Date(v.trades[n - 1].time).toDateString();
            const label = q => { const d = new Date(q.time); return oneDay ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : (d.getMonth() + 1) + '.' + d.getDate(); };
            const marks = []; v.trades.forEach((q, i) => { const s = label(q); if (!marks.length || marks[marks.length - 1].s !== s) marks.push({ i, s }); });
            let edge = Infinity;
            for (let m = marks.length - 1; m >= 0; m--) {
                const half = K.tw(marks[m].s, 10, 700) / 2 + 5, mx = K.clamp(X(marks[m].i), l + half, r - half);
                if (mx + half > edge) continue;
                K.text(marks[m].s, mx, b + 13, 10, K.MUTE, 'center', 700); edge = mx - half;
            }
        }
        // 점을 가리키거나 누르면 그 거래의 값, 때, 수량을 띄운다.
        let focus = -1;
        for (let i = 0; i < n; i++) { const key = 'reg-chart:' + i; if (S.hover === key || S.focus === key) focus = i; }
        if (focus < 0 && P.chartPick >= 0 && P.chartPick < n) focus = P.chartPick;
        if (focus >= 0 && k >= 1) {
            const [fx, fy] = pts[focus], q = v.trades[focus], d = new Date(q.time);
            C.save(); C.setLineDash([3, 3]); C.strokeStyle = 'rgba(255,255,255,.32)'; C.lineWidth = 1; C.beginPath(); C.moveTo(Math.round(fx) + .5, t); C.lineTo(Math.round(fx) + .5, b); C.stroke(); C.restore();
            C.beginPath(); C.arc(fx, fy, 5.5, 0, 7); C.fillStyle = LINE.trade; C.fill(); C.lineWidth = 2; C.strokeStyle = '#ffffff'; C.stroke();
            const sub = [(d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()), q.count > 1 ? '×' + fmt(q.count) : '', P.chartAll && q.variant != null ? variantLabel(q.variant) : ''].filter(Boolean).join('   ');
            const bw = Math.max(K.tw(fmt(q.price), 14, 800) + 28, K.tw(sub, 11, 700)) + 22, bh = 46;
            const bx = K.clamp(fx - bw / 2, x + 4, x + w - 4 - bw), by = fy - bh - 12 >= y + 4 ? fy - bh - 12 : fy + 12;
            K.plate(bx, by, bw, bh, 6, { a: .97, edge: .8, tint: LINE.trade, tintA: .14 });
            A.currency(v.cur, bx + 11, by + 7, 16); K.text(fmt(q.price), bx + 32, by + 15.5, 14, K.GOLD, 'left', 800);
            K.text(sub, bx + 11, by + 33, 11, K.DIM, 'left', 700);
        }
        for (let i = 0; i < n; i++) { const q = v.trades[i], d = new Date(q.time); A.hit('reg-chart', i, X(i) - sx / 2, t, sx, b - t, (d.getMonth() + 1) + '월 ' + d.getDate() + '일 거래 ' + fmt(q.price) + ' ' + CUR[q.currency] + (q.count > 1 ? ' ' + fmt(q.count) + '개' : '')); }
    }
    function priceTag(K, x, y, w, h, tag) {
        const C = K.C;
        C.beginPath(); C.moveTo(x, y); C.lineTo(x + 6, y - h / 2); C.lineTo(x + w, y - h / 2); C.lineTo(x + w, y + h / 2); C.lineTo(x + 6, y + h / 2); C.closePath();
        C.fillStyle = tag.solid ? tag.color : 'rgba(10,12,18,.94)'; C.fill(); C.lineWidth = 1; C.strokeStyle = K.rgba(tag.color, tag.solid ? 1 : .8); C.stroke();
        K.line(tag.text, x + 6 + (w - 6) / 2, y + .5, w - 12, 11, tag.solid ? '#2b1904' : tag.color, 'center', 800, 8);
    }

    // 삽니다 요청에 내 물품으로 판매
    async function openFill(e) {
        const P = ui.picker = MS.createPicker({ title: '판매할 물품', kinds: [{ key: e.kind, label: KIND_LABEL[e.kind], entries: [] }], submitLabel: '판매하기' });
        P.order = e; P.error = '보유 물품 확인 중'; stage.play('paper'); stage.invalidate();
        let f;
        try { f = await api('/api/buyorder/fulfillable?id=' + encodeURIComponent(e.id)); }
        catch (error) { if (ui.picker === P) { P.error = error.message; stage.invalidate(); } return; }
        if (ui.picker !== P) return;
        const d = e.display || {}, kind = { key: e.kind, label: KIND_LABEL[e.kind], entries: [] };
        if (e.kind === 'card') kind.entries = f.cards.map(c => ({ key: 'c' + c.index, raw: c, info: MS.identify(c, 'card') }));
        else if (e.kind === 'equipment') kind.entries = f.equipment.map(q => ({ key: 'e' + q.index, raw: q, info: MS.identify(q, 'equipment') }));
        else if (e.kind === 'pet') kind.entries = f.pets.map(p => ({ key: 'p' + p.index, raw: p, info: MS.identify(p, 'pet') }));
        else if (e.kind === 'item' && f.itemCount > 0) { kind.entries = [{ key: 'item', raw: { count: Math.min(f.itemCount, e.count) }, info: MS.identify({ name: d.name, count: f.itemCount, type: d.itemType, iconUrl: d.iconUrl, frameUrl: d.frameUrl }, 'item') }]; kind.quantity = x => x.raw.count; }
        else if (e.kind === 'avatar' && f.avatar && f.avatar.owned && !f.avatar.tradeBlockReason) kind.entries = (f.avatar.instances || []).map((inst, i) => { const info = MS.identify({ ...f.avatar }, 'avatar'); if (f.avatar.grade === '유니크') info.chips.push({ text: '거래 ' + Math.max(0, 3 - Number(inst.trades || 0)) + '회 남음', color: DIM }); info.title += f.avatar.instances.length > 1 ? ' ' + (i + 1) : ''; return { key: 'a' + inst.id, raw: inst, info }; });
        P.config.kinds = [kind]; P.kind = e.kind;
        P.error = kind.entries.length ? '' : (e.kind === 'avatar' && f.avatar && f.avatar.tradeBlockReason) || '조건에 맞는 보유 물품이 없습니다.';
        if (kind.entries.length === 1) { P.selected = kind.entries[0].key; P.mobileDetail = true; }
        P.feeRate = Number.isFinite(Number(f.feeRate)) ? Number(f.feeRate) : .05;
        P.config.extraHeight = () => 76;
        P.config.extra = (K, A, P2, k, sel, x, y, w) => {
            const qty = k.quantity ? Math.max(1, Number(P2.amount || 1)) : 1, total = e.unitPrice * qty, fee = Math.floor(total * P2.feeRate);
            row(K, '판매 대금', fmt(total), x, y, w, K.INK, e.currency, A);
            row(K, '수수료 ' + Math.round(P2.feeRate * 1000) / 10 + '%', '-' + fmt(fee), x, y + 22, w, WARN, e.currency, A);
            row(K, '입금', fmt(total - fee), x, y + 44, w, GOOD, e.currency, A);
            return y + 70;
        };
        stage.invalidate();
    }
    async function submitFill(P) {
        const e = P.order, sel = MS.pickerSelected(P);
        if (!sel) { P.error = '판매할 ' + KIND_LABEL[e.kind] + '을(를) 선택해주세요.'; return; }
        const body = { id: e.id };
        if (e.kind === 'item') { const count = Math.floor(Number(P.amount || 1)); if (count < 1 || count > sel.raw.count) { P.error = '수량을 확인해주세요.'; return; } body.count = count; }
        else if (e.kind === 'avatar') body.avatarId = sel.raw.id;
        else body.index = sel.raw.index;
        ui.working = true; stage.invalidate();
        try {
            await postApi('/api/buyorder/fulfill', body);
            ui.picker = null; stage.play('claim'); stage.pulse(); flash(infoOf(e).title + ' 판매 완료');
            refreshProfile(); await load(); loadSellable();
        } catch (error) { P.error = error.message; }
        finally { ui.working = false; stage?.invalidate(); }
    }

    // ── 동작
    async function buy(e) {
        ui.working = true; stage.invalidate();
        try {
            const body = { id: e.id }; if (e.kind === 'item') body.count = ui.qty;
            await postApi('/api/auction/buy', body);
            stage.play('deal'); stage.pulse(); flash(infoOf(e).title + ' 구매 완료');
            ui.selected = ''; ui.overlay = false; ui.qty = 1;
            refreshProfile(); await load();
        } catch (error) { flash(error.message, true); }
        finally { ui.working = false; stage?.invalidate(); }
    }
    async function cancelEntry(e) {
        ui.working = true; stage.invalidate();
        try {
            await postApi(mode === 'sell' ? '/api/auction/cancel' : '/api/buyorder/cancel', { id: e.id });
            stage.play('cancel'); flash(mode === 'sell' ? '판매 취소, 물품 반환' : '구매 등록 취소, 반환 완료');
            ui.selected = ''; ui.overlay = false;
            refreshProfile(); await load(); if (mode === 'buy') loadSellable();
        } catch (error) { flash(error.message, true); }
        finally { ui.working = false; stage?.invalidate(); }
    }
    function act(action, id) {
        if (MS.linesAct(ui, action)) { stage.invalidate(); return; }
        if (ui.dialog) {
            const d = ui.dialog;
            if (action === 'dialog-yes') { ui.dialog = null; const e = data.list.find(x => x.id === d.entryId); if (e) cancelEntry(e); return; }
            if (['dialog-close', 'back'].includes(action)) ui.dialog = null;
            stage.invalidate(); return;
        }
        if (ui.picker) {
            const P = ui.picker;
            if (action === 'picker-close' || (action === 'back' && !P.mobileDetail)) { ui.picker = null; stage.play('cancel'); stage.invalidate(); return; }
            if (action === 'back') { P.mobileDetail = false; stage.invalidate(); return; }
            if (action === 'picker-submit') { if (!ui.working) (P.order ? submitFill(P) : mode === 'sell' ? submitSell(P) : submitBuy(P)).then(() => stage?.invalidate()); stage.invalidate(); return; }
            if (action === 'picker-detail') { const sel = MS.pickerSelected(P); if (sel && sel.raw && sel.raw.detail) openEquipmentDetail(sel.raw.detail); else if (sel && P.kind === 'card' && sel.raw && sel.raw.skills) openRichModal(sel.info.title, '', [el('div', { class: 'dt-detail-context' }, ...mainCardDetailNodes(sel.raw))]); return; }
            if (action.startsWith('picker-')) { stage.play('select'); MS.pickerAct(P, action, id); stage.invalidate(); return; }
            if (action.startsWith('reg-')) { regAct(P, action, id); stage.invalidate(); return; }
        }
        if (action !== 'back') stage.play('select');
        const e = selectedEntry();
        switch (action) {
            case 'back': if (ui.filtersOpen) ui.filtersOpen = false; else if (ui.overlay) ui.overlay = false; break;
            case 'filter': ui.filter = id; ui.page = 0; ui.filtersOpen = false; break;
            case 'filters-open': ui.filtersOpen = true; break;
            case 'filters-close': ui.filtersOpen = false; break;
            case 'currency': ui.currency = id; ui.page = 0; break;
            case 'currency-cycle': ui.currency = { all: 'gold', gold: 'garnet', garnet: 'all' }[ui.currency]; ui.page = 0; break;
            case 'sort': ui.sort = id; ui.page = 0; break;
            case 'sort-cycle': ui.sort = { new: 'priceAsc', priceAsc: 'priceDesc', priceDesc: 'new' }[ui.sort]; ui.page = 0; break;
            case 'page-next': ui.page++; break;
            case 'page-previous': ui.page--; break;
            case 'refresh': load(); if (mode === 'buy') loadSellable(); return;
            case 'register': mode === 'sell' ? openSellRegister() : openBuyRegister(); return;
            case 'pick': if (ui.selected !== id) ui.qty = 1; ui.selected = id; if (stage.width < 1000) ui.overlay = true; stage.announce(e ? infoOf(e).title : ''); break;
            case 'overlay-close': ui.overlay = false; break;
            case 'qty-minus': ui.qty = Math.max(1, ui.qty - 1); break;
            case 'qty-plus': ui.qty += 1; break;
            case 'qty-max': if (e) ui.qty = e.count; break;
            case 'buy': if (e && !ui.working) buy(e); return;
            case 'fill': if (e) openFill(e); return;
            case 'cancel-entry': if (e) ui.dialog = { title: mode === 'sell' ? '판매 취소' : '구매 등록 취소', lines: [infoOf(e).title], entryId: e.id, tint: WARN, actions: [{ action: 'dialog-close', label: '돌아가기' }, { action: 'dialog-yes', label: '취소하기', danger: true }] }; break;
            case 'detail': { const d = e && e.display && e.display.equipmentDetail; if (d) openEquipmentDetail(d); return; }
        }
        stage.invalidate();
    }
    function regAct(P, action, id) {
        stage.play('select');
        if (action === 'reg-currency' || action === 'reg-chart-currency') P.currency = id;
        else if (action === 'reg-quick') { const { kind } = MS.pickerList(P), q = quickPrices(P, kind, MS.pickerSelected(P)).find(x => x.key === id); if (q) { P.price = String(q.value); P.error = ''; stage.play('chips'); } }
        else if (action === 'reg-variant') { P.chartAll = id === 'all'; P.chartPick = -1; }
        else if (action === 'reg-chart') P.chartPick = P.chartPick === Number(id) ? -1 : Number(id);
        else if (action === 'reg-star-minus') P.star = Math.max(0, P.star - 1);
        else if (action === 'reg-star-plus') P.star = Math.min(11, P.star + 1);
        else if (action === 'reg-type') P.cardType = id === 'any' ? '' : id;
        else if (action === 'reg-level-on') P.levelOn = id === 'on';
        else if (action === 'reg-level-minus') P.level = Math.max(0, P.level - 1);
        else if (action === 'reg-level-plus') P.level = Math.min(15, P.level + 1);
        else if (action === 'reg-count-minus') P.count = Math.max(1, P.count - 1);
        else if (action === 'reg-count-plus') P.count += 1;
    }
    function field(key, value, how) {
        if (key === 'search') { ui.query = value; ui.page = 0; }
        else if (key === 'qty') { const e = selectedEntry(); ui.qty = Math.max(1, Math.min(e ? e.count : 1, Math.floor(Number(value.replace(/[^0-9]/g, '')) || 1))); if (how === 'enter' && e) buy(e); }
        else if (ui.picker) {
            const P = ui.picker;
            if (key === 'picker-search') { P.query = value; P.page = 0; }
            else if (key === 'picker-amount') { P.amount = value.replace(/[^0-9]/g, ''); P.error = ''; }
            else if (key === 'reg-price') { P.price = value.replace(/[^0-9]/g, ''); P.error = ''; }
            else if (key === 'reg-count') P.count = Math.max(1, Math.floor(Number(value.replace(/[^0-9]/g, '')) || 1));
            if (how === 'enter' && key !== 'picker-search') { act('picker-submit'); return; }
        }
        stage.invalidate();
    }
    function openEquipmentDetail(d) { openRichModal(d.name, '', [el('div', { class: 'dt-detail-context' }, ...equipmentModalView(d, false))]); }
    function flash(text, bad) { ui.toast = text; ui.toastBad = !!bad; clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = ''; stage?.invalidate(); }, 2600); stage?.invalidate(); }
    function refreshProfile() { api('/api/profile').then(renderProfile).then(() => stage?.invalidate()).catch(() => {}); }

    // ── 데이터
    async function load() {
        const token = ++loadToken, m0 = mode; data.loading = true; data.error = ''; stage?.invalidate();
        try {
            const res = await api(M().list);
            if (token !== loadToken || mode !== m0) return;
            data.list = res.items || []; data.infos.clear(); rebuildBest();
            if (ui.selected && !data.list.some(e => e.id === ui.selected)) { ui.selected = ''; ui.overlay = false; }
        } catch (error) { if (token === loadToken) data.error = error.message; }
        finally { if (token === loadToken) { data.loading = false; stage?.invalidate(); } }
    }
    async function loadSellable() { try { data.sellable = await api('/api/auction/sellable'); stage?.invalidate(); } catch (_) { data.sellable = null; } }
    function open(nextMode) {
        close(); mode = nextMode;
        const host = document.getElementById(M().root); if (!host || !MS) return;
        Object.assign(ui, { filter: 'all', currency: 'all', sort: 'new', query: '', page: 0, selected: '', overlay: false, qty: 1, picker: null, dialog: null, toast: '' });
        data.list = []; data.infos.clear(); data.sellable = null;
        stage = MS.mount(host, { theme: 'market', label: M().title, state: ui, currencyIcons: new Proxy({}, { get: (_, k) => currencyIcons()[k] }), draw, onAct: act, onField: field });
        load(); if (mode === 'buy') loadSellable();
    }
    function close() { clearTimeout(toastTimer); stage?.dispose(); stage = null; ui.picker = null; ui.dialog = null; mode = null; }
    window.MarketBoardUI = { open, close };
})();
