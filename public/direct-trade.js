// 1:1 거래 무대. 채팅 거래와 같은 세션을 읽고, 품목과 확정 버전을 함께 보내 이전 내역으로 정산하지 않는다.
// 화면 구성: 위는 상대의 판(받을 것), 아래는 내 판(줄 것), 가운데 이음선에 정산과 인장, 오른쪽은 감정대.
(() => {
    'use strict';
    const MS = window.MarketStage;
    const MINE = '#57d3e6', THEIRS = '#ffa36b';
    const LABELS = { gold: '골드', garnet: '가넷', card: '카드', equipment: '장비', item: '아이템' };
    let state = null, timer = 0, busy = false, polling = false, epoch = 0, tickCount = 0;
    let requestName = '', errorText = '', notice = '', dismissedResult = '', stage = null, lastPartnerSig = '';
    const ui = { hover: '', focus: '', busy: false, inspect: '', overlay: '', pages: { mine: 0, theirs: 0, result: 0 }, picker: null, dialog: null };
    const root = () => document.getElementById('directTradeRoot');
    const active = () => document.querySelector('[data-page="directtrade"]')?.classList.contains('active');
    const version = session => ({ sessionId: session.id, revision: session.revision });
    const icons = () => ({ gold: QUEST_REWARD_CURRENCY_ICONS['골드'], garnet: QUEST_REWARD_CURRENCY_ICONS['가넷'], point: QUEST_REWARD_CURRENCY_ICONS['포인트'], ticket: state?.ticketIconUrl });
    const comma0 = n => Number(n || 0).toLocaleString('ko-KR');

    // 판 위의 품목 목록: 재화는 따로, 나머지는 정체를 붙인다.
    function offerEntries(offer, side) {
        if (!offer) return [];
        const list = [];
        (offer.cards || []).forEach((e, i) => list.push({ key: side + ':card:' + i, kind: 'card', entry: e, info: MS.identify(e, 'card') }));
        (offer.equipment || []).forEach((e, i) => list.push({ key: side + ':equipment:' + i, kind: 'equipment', entry: e, info: MS.identify(e, 'equipment') }));
        (offer.items || []).forEach((e, i) => list.push({ key: side + ':item:' + i, kind: 'item', entry: e, info: MS.identify(e, 'item') }));
        return list;
    }
    function allEntries() {
        if (state?.status === 'active') return [...offerEntries(state.session.partnerOffer, 'theirs'), ...offerEntries(state.session.offer, 'mine')];
        if (state?.result?.receivedOffer) return offerEntries(state.result.receivedOffer, 'result');
        return [];
    }
    const inspected = () => allEntries().find(e => e.key === ui.inspect) || null;

    // ── 그리기
    function draw(A, K) {
        const W = A.w, H = A.h, mobile = W < 760, wide = W >= 1100;
        ui.busy = busy || !!state?.session?.processing;
        A.uniforms.accent = MINE; A.uniforms.accent2 = THEIRS;
        A.uniforms.glow = state?.status === 'active' ? (state.session.confirmed ? .5 : 0) + (state.session.partnerConfirmed ? .5 : 0) : 0;
        if (!state) { K.text(errorText || '거래 내역 확인 중', W / 2, H / 2, 16, errorText ? K.WARN : K.DIM, 'center', 600); A.uniforms.seam = H / 2; return; }
        const m = mobile ? 10 : 16;
        const top = topBar(A, K, m, mobile ? 6 : 10, W - m * 2, mobile ? 40 : 48, mobile);
        if (state.status === 'active') activeView(A, K, m, top, W - m * 2, H - top - m, { mobile, wide });
        else if (state.status === 'outgoing' || state.status === 'incoming') inviteView(A, K, m, top, W - m * 2, H - top - m, mobile);
        else if (state.result && state.result.id !== dismissedResult) resultView(A, K, m, top, W - m * 2, H - top - m, mobile);
        else requestView(A, K, m, top, W - m * 2, H - top - m, mobile);
        toast(A, K, top, mobile);
        if (ui.overlay === 'inspect' && inspected()) {
            const e = inspected(), w = Math.min(W - 16, 560), h = Math.min(H - 16, 620), M = K.modal(e.info.kindLabel, w, h, { close: 'overlay-close', tint: e.info.accent });
            K.inspect(e.info, M.x + 8, M.y + 60, M.w - 16, M.h - 68, { detail: 'detail', detailId: e.key });
        }
        if (ui.picker) MS.drawPicker(K, A, ui.picker, { detailAction: 'picker-detail', tint: MINE, amountNote: (kind, amount) => amount > 0 ? '수수료 ' + comma0(Math.round(amount * state.feeRate)) + '   상대 수령 ' + comma0(amount - Math.round(amount * state.feeRate)) : '' });
        if (ui.dialog) K.dialog(ui.dialog);
    }
    function topBar(A, K, x, y, w, h, mobile) {
        const cy = y + h / 2;
        K.gem(x + 12, cy, 9, K.steel(x, y, 24, h)); K.gem(x + 12, cy, 5, MINE);
        K.text('1:1 거래', x + 30, cy + 1, mobile ? 19 : 24, K.INK, 'left', 800);
        const b = state.balances, list = [['gold', b.gold], ['garnet', b.garnet], ['ticket', b.tickets]];
        let px = x + w;
        const need = list.reduce((s, [, v]) => s + 56 + K.tw(comma0(v), 15, 800) + 8, 0);
        if (need <= w - 130) [...list].reverse().forEach(([k, v]) => { const cw = 52 + K.tw(comma0(v), 15, 800); px -= cw; purse(A, K, k, v, px, y + 5, cw, h - 10); px -= 8; });
        else if (!mobile) { const cw = (w - 140) / 3; list.forEach(([k, v], i) => purse(A, K, k, v, x + 140 + i * cw, y + 5, cw - 6, h - 10)); }
        K.rule(x, y + h + 5, w, .8, MINE);
        return y + h + 14;
    }
    function purse(A, K, goods, amount, x, y, w, h) {
        K.plate(x, y, w, h, 7, { a: .7, edge: .7 }); const isz = h - 10; A.currency(goods, x + 6, y + 5, isz);
        K.line(comma0(amount), x + w - 9, y + h / 2 + .5, w - isz - 20, 15, K.INK, 'right', 800, 11);
        A.hit('wallet', goods, x, y, w, h, (goods === 'ticket' ? '거래권' : LABELS[goods]) + ' 보유 ' + comma0(amount), true);
    }
    function toast(A, K, top, mobile) {
        const msg = errorText || notice; if (!msg || ui.picker || ui.dialog) return;
        const w = Math.min(A.w - 24, K.tw(msg, 14, 700) + 48), x = (A.w - w) / 2, y = top + (mobile ? 2 : 4);
        K.plate(x, y, w, 34, 8, { a: .95, edge: .7, tint: errorText ? K.WARN : K.GOLD, tintA: .25 });
        K.line(msg, A.w / 2, y + 17.5, w - 20, 14, errorText ? K.WARN : K.GOLD, 'center', 700, 10);
    }

    // 진행 중인 거래
    function activeView(A, K, x, y, w, h, o) {
        const s = state.session, inspW = o.wide ? K.clamp(Math.round(w * .3), 320, 400) : 0, bw = w - (inspW ? inspW + 14 : 0);
        const seamH = o.mobile ? 148 : 136, boardH = Math.floor((h - seamH - 16) / 2);
        board(A, K, 'theirs', state.partner, s.partnerOffer, s.partnerConfirmed, x, y, bw, boardH, o.mobile);
        const sy = y + boardH + 8; A.uniforms.seam = sy + seamH / 2;
        seam(A, K, s, x, sy, bw, seamH, o.mobile);
        board(A, K, 'mine', state.me, s.offer, s.confirmed, x, sy + seamH + 8, bw, h - boardH - seamH - 16, o.mobile);
        if (inspW) {
            const e = inspected() || allEntries()[0] || null;
            K.inspect(e && e.info, x + w - inspW, y, inspW, h, { detail: 'detail', detailId: e && e.key });
        }
    }
    function board(A, K, side, player, offer, confirmed, x, y, w, h, mobile) {
        const mine = side === 'mine', color = mine ? MINE : THEIRS, p = mobile ? 8 : 12, hh = mobile ? 46 : 58;
        K.plate(x, y, w, h, 14, { a: .58, tint: color, tintA: .12 });
        const fs = hh - (mobile ? 8 : 10); K.face(player, x + p, y + (hh - fs) / 2 + 4, fs, color);
        const tx = x + p + fs + 10;
        K.text(mine ? '내가 줄 것' : '내가 받을 것', tx, y + hh * .36 + 2, 12, color, 'left', 800);
        K.line((player?.name || state.session.partnerName) + (player?.level ? '  Lv.' + player.level : ''), tx, y + hh * .7 + 2, w * .4, mobile ? 14 : 16, K.INK, 'left', 800, 11);
        const addW = mine ? (mobile ? 44 : 150) : 0, stW = 86;
        const sx = x + w - p - addW - (addW ? 8 : 0) - stW;
        K.plate(sx, y + (hh - 30) / 2 + 4, stW, 30, 7, { a: .9, edge: .6, tint: confirmed ? K.GOOD : K.MUTE, tintA: confirmed ? .3 : .05 });
        if (confirmed) K.glyph('check', sx + 17, y + hh / 2 + 4, 10, K.GOOD);
        K.text(confirmed ? '확정' : '검토 중', sx + stW / 2 + (confirmed ? 8 : 0), y + hh / 2 + 4.5, 13, confirmed ? K.GOOD : K.DIM, 'center', 800);
        if (mine) K.btn('add', '', x + w - p - addW, y + (hh - 40) / 2 + 4, addW, 40, mobile ? '' : '물품 올리기', { glyph: 'plus', primary: !mobile, aria: '물품 올리기', disabled: !!state.session.processing });
        let by = y + hh + 6; const bx = x + p, bwid = w - p * 2, bottom = y + h - p;
        const coins = ['gold', 'garnet'].filter(k => offer[k] > 0);
        if (coins.length) {
            const ch = mobile ? 34 : 40, cw = (bwid - 8 * (coins.length - 1)) / coins.length;
            coins.forEach((k, i) => K.coin(k, offer[k], bx + i * (cw + 8), by, cw, ch));
            by += ch + 8;
        }
        const list = offerEntries(offer, side);
        if (!list.length) {
            if (!coins.length) { const n = Math.max(1, Math.min(5, Math.floor((bwid + 8) / 128))), sw = (bwid - 8 * (n - 1)) / n; for (let i = 0; i < n; i++) { K.well(bx + i * (sw + 8), by, sw, bottom - by, 9); K.gem(bx + i * (sw + 8) + sw / 2, by + (bottom - by) / 2, 5, 'rgba(255,255,255,.07)'); } if (mine) A.hit('add', 'empty', bx, by, bwid, bottom - by, '물품 올리기', !!state.session.processing); }
            return;
        }
        // 판이 낮으면 칸을 가로형(그림 왼쪽, 글 오른쪽)으로 바꿔 그림이 작아지지 않게 한다.
        const gh = bottom - by, rows = Math.max(1, Math.floor((gh + 8) / (mobile ? 150 : 170))), flat = gh < 150, minW = flat ? (mobile ? 170 : 200) : mobile ? 96 : 116;
        const pagerW = list.length > Math.floor((bwid + 8) / (minW + 8)) * rows ? 52 : 0;
        const cols = Math.max(1, Math.floor((bwid - pagerW * 2 + 8) / (minW + 8))), per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per));
        ui.pages[side] = K.clamp(ui.pages[side], 0, pages - 1);
        const gx = bx + (pages > 1 ? pagerW : 0), gw = bwid - (pages > 1 ? pagerW * 2 : 0), cw = Math.min(flat ? 280 : 170, (gw - 8 * (cols - 1)) / cols), ch = (gh - 8 * (rows - 1)) / rows;
        list.slice(ui.pages[side] * per, ui.pages[side] * per + per).forEach((e, i) => {
            K.slot(e.info, gx + (i % cols) * (cw + 8), by + Math.floor(i / cols) * (ch + 8), cw, ch, { action: 'inspect', id: e.key, on: ui.inspect === e.key, small: mobile });
        });
        if (pages > 1) {
            K.btn('board-previous', side, bx, by + gh / 2 - 24, 44, 48, '', { glyph: 'prev', disabled: ui.pages[side] <= 0, aria: '이전 물품' });
            K.btn('board-next', side, x + w - p - 44, by + gh / 2 - 24, 44, 48, '', { glyph: 'next', disabled: ui.pages[side] >= pages - 1, aria: '다음 물품' });
            K.text((ui.pages[side] + 1) + '/' + pages, bx + 22, by + gh / 2 + 38, 11, K.DIM, 'center', 700);
        }
    }
    function seam(A, K, s, x, y, w, h, mobile) {
        const C = K.C, receive = s.partnerOffer, give = s.offer, short = state.balances.tickets < receive.ticketCost, full = state.cardSpace < receive.cards.length;
        K.plate(x, y, w, h, 14, { a: .82, tint: K.GOLD, tintA: .06 });
        // 인장: 위 반원은 상대, 아래 반원은 나. 둘 다 확정하면 금색으로 닫힌다.
        const d = mobile ? 74 : h - 28, cx = mobile ? x + 14 + d / 2 : x + w * .5, cy = mobile ? y + 12 + d / 2 : y + h / 2;
        const both = s.confirmed && s.partnerConfirmed;
        const half = (start, on, col) => { C.beginPath(); C.moveTo(cx, cy); C.arc(cx, cy, d / 2 - 4, start, start + Math.PI); C.closePath();
            const g = C.createRadialGradient(cx, cy, 2, cx, cy, d / 2); g.addColorStop(0, K.rgba(col, on ? .8 : .12)); g.addColorStop(1, K.rgba(col, on ? .35 : .04)); C.fillStyle = g; C.fill(); };
        half(Math.PI, s.partnerConfirmed, both ? K.GOLD : THEIRS); half(0, s.confirmed, both ? K.GOLD : MINE);
        C.beginPath(); C.arc(cx, cy, d / 2 - 2, 0, 7); C.lineWidth = 2.5; C.strokeStyle = K.steel(cx - d / 2, cy - d / 2, d, d, 1.2); C.stroke();
        C.beginPath(); C.moveTo(cx - d / 2 + 4, cy); C.lineTo(cx + d / 2 - 4, cy); C.lineWidth = 1.5; C.strokeStyle = both ? K.rgba(K.GOLD, .9) : 'rgba(0,0,0,.6)'; C.stroke();
        if (both) K.glyph('check', cx, cy, d * .32, '#2b1904');
        else { K.text(s.partnerConfirmed ? '확정' : '대기', cx, cy - d * .2, Math.max(10, d * .13), s.partnerConfirmed ? THEIRS : K.MUTE, 'center', 800); K.text(s.confirmed ? '확정' : '대기', cx, cy + d * .2, Math.max(10, d * .13), s.confirmed ? MINE : K.MUTE, 'center', 800); }
        A.hit('seal', '', cx - d / 2, cy - d / 2, d, d, (s.partnerConfirmed ? '상대 확정함' : '상대 검토 중') + ', ' + (s.confirmed ? '내가 확정함' : '내가 아직 확정하지 않음'), true);
        const status = s.processing ? '거래 처리 중' : both ? '거래 마무리 중' : s.confirmed ? '상대 확정 대기' : s.partnerConfirmed ? '상대 확정 완료' : '';
        const confirmDisabled = !s.confirmed && (short || full);
        const flows = [['받는', receive, true], ['주는', give, false]];
        if (mobile) {
            const rx = x + 24 + d, rw = w - d - 34; let ry = y + 10;
            K.line(status, rx, ry + 8, rw, 13, s.partnerConfirmed && !s.confirmed ? THEIRS : K.INK, 'left', 700, 10); ry += 22;
            const parts = flows.map(([label, offer, incoming]) => ['gold', 'garnet'].filter(k => offer[k] > 0).map(k => label + ' ' + LABELS[k] + ' ' + comma0(incoming ? offer.net[k] : offer[k]))).flat();
            const tk = receive.ticketCost > 0 ? '거래권 ' + receive.ticketCost + '장 사용 (보유 ' + state.balances.tickets + ')' : '';
            K.line(parts.join('   ') || '재화 없음', rx, ry + 7, rw, 12, K.GOLD, 'left', 700, 9); ry += 18;
            if (tk || full) K.line(full ? '카드 보관 공간 부족' : tk, rx, ry + 7, rw, 12, short || full ? K.WARN : K.DIM, 'left', 700, 9);
            const by = y + h - 54, bw2 = (w - 20 - 8) * .6;
            K.btn('confirm', '', x + 10, by, bw2, 46, s.confirmed ? '확정 취소' : '거래 확정', { primary: !s.confirmed, disabled: confirmDisabled, size: 16 });
            K.btn('cancel', '', x + 18 + bw2, by, w - 28 - bw2, 46, '거래 취소', { danger: true, size: 14 });
            return;
        }
        // 왼쪽: 재화 정산, 오른쪽: 상태와 버튼
        const lw = w * .5 - d / 2 - 28, lx = x + 14, ly = y + 12;
        flows.forEach(([label, offer, incoming], col) => {
            const colW = (lw - 8) / 2, cx0 = lx + col * (colW + 8); let yy = ly;
            K.text(label + ' 재화', cx0, yy + 8, 12, incoming ? THEIRS : MINE, 'left', 800); yy += 20;
            const ks = ['gold', 'garnet'].filter(k => offer[k] > 0);
            if (!ks.length) { K.well(cx0, yy, colW, 36, 6); K.text('없음', cx0 + colW / 2, yy + 18, 12, K.MUTE, 'center', 700); }
            ks.forEach(k => { K.coin(k, incoming ? offer.net[k] : offer[k], cx0, yy, colW, 40, incoming ? { sub: '수수료 ' + comma0(offer.fees[k]) + ' 제외' } : {}); yy += 46; });
        });
        const rx = x + w * .5 + d / 2 + 18, rw = x + w - 14 - rx; let ry = y + 12;
        K.line(status, rx, ry + 9, rw, 14, s.partnerConfirmed && !s.confirmed ? THEIRS : K.INK, 'left', 700, 10); ry += 24;
        const facts = [];
        if (receive.ticketCost > 0) facts.push({ text: '거래권 ' + receive.ticketCost + '장 사용  보유 ' + state.balances.tickets, color: short ? K.WARN : K.DIM });
        if (receive.cards.length) facts.push({ text: '카드 공간 ' + state.cardSpace, color: full ? K.WARN : K.DIM });
        K.chipRow(facts, rx, ry, rw, { h: 22, size: 11, single: true });
        const bh = 46, bw2 = (rw - 8) * .62;
        K.btn('confirm', '', rx, y + h - 12 - bh, bw2, bh, s.confirmed ? '확정 취소' : '거래 확정', { primary: !s.confirmed, disabled: confirmDisabled, size: 16,
            aria: confirmDisabled ? (short ? '거래권이 부족해 확정할 수 없음' : '카드 보관 공간이 부족해 확정할 수 없음') : s.confirmed ? '확정 취소' : '거래 확정' });
        K.btn('cancel', '', rx + bw2 + 8, y + h - 12 - bh, rw - bw2 - 8, bh, '거래 취소', { danger: true, size: 14 });
    }

    // 신청 전: 내 카드와 비어 있는 상대 자리, 그 아래 닉네임 칸
    function requestView(A, K, x, y, w, h, mobile) {
        A.uniforms.seam = y + h * .45;
        const pw = Math.min(w, 860), px = x + (w - pw) / 2, ph = Math.min(h, mobile ? 420 : 420), py = y + Math.max(0, (h - ph) / 2 - 10);
        K.plate(px, py, pw, ph, 18, { a: .62, tint: MINE, tintA: .1 });
        const cardH = Math.min(mobile ? 220 : 270, ph * .6), cardW = cardH * 399 / 515, gap = mobile ? 20 : 60, cy = py + 22;
        const lx = px + pw / 2 - gap / 2 - cardW, rx = px + pw / 2 + gap / 2;
        portrait(A, K, state.me, lx, cy, cardW, cardH, MINE, '나');
        const C = K.C; K.well(rx, cy, cardW, cardH, 12, K.rgba(THEIRS, .05));
        C.save(); C.setLineDash([6, 6]); K.cut(rx + 8, cy + 8, cardW - 16, cardH - 16, 8); C.strokeStyle = K.rgba(THEIRS, .45); C.lineWidth = 1.5; C.stroke(); C.restore();
        K.text('?', rx + cardW / 2, cy + cardH / 2 - 8, cardH * .28, K.rgba(THEIRS, .55), 'center', 800);
        K.text('상대', rx + cardW / 2, cy + cardH - 22, 13, K.DIM, 'center', 700);
        K.gem(px + pw / 2, cy + cardH / 2, 8, K.GOLD);
        let fy = cy + cardH + 22; const fw = Math.min(pw - 32, 520), fx = px + (pw - fw) / 2;
        K.text('거래할 상대', fx, fy + 8, 13, K.DIM, 'left', 700); fy += 20;
        const sendW = mobile ? 96 : 140;
        K.well(fx, fy, fw - sendW - 8, 50, 8);
        A.field('name', fx + 10, fy + 4, fw - sendW - 28, 42, { value: requestName, placeholder: '상대방 닉네임', label: '거래할 상대 닉네임', maxLength: 100, big: true });
        K.btn('request', '', fx + fw - sendW, fy, sendW, 50, '거래 신청', { primary: true, size: 16, disabled: busy || !requestName.trim() });
    }
    function portrait(A, K, player, x, y, w, h, color, label) {
        K.well(x, y, w, h, 12, K.rgba(color, .06));
        const card = player?.mainCard;
        if (card) { const info = MS.identify(card, 'card'); A.art(info.art, x + 6, y + 6, w - 12, h - 12, { fx: info.fx, big: true }); if (info.ribbon) K.ribbon(info.ribbon.text, x + w - 4, y + 10, info.ribbon.color); }
        K.plate(x + 8, y + h - 34, w - 16, 28, 6, { a: .9, edge: .6, tint: color, tintA: .25 });
        K.line((player?.name || label) + (player?.level ? '  Lv.' + player.level : ''), x + w / 2, y + h - 19.5, w - 28, 13, K.INK, 'center', 800, 9);
        if (card) A.hit('portrait', label, x, y, w, h, (player?.name || label) + ' 대표 카드 ' + card.formatted, true);
    }
    // 신청 대기, 신청 도착
    function inviteView(A, K, x, y, w, h, mobile) {
        A.uniforms.seam = y + h * .45;
        const incoming = state.status === 'incoming', pw = Math.min(w, 860), px = x + (w - pw) / 2, ph = Math.min(h, mobile ? 500 : 460), py = y + Math.max(0, (h - ph) / 2 - 10);
        K.plate(px, py, pw, ph, 18, { a: .62, tint: THEIRS, tintA: .1 });
        const cardH = Math.min(mobile ? 180 : 270, ph * .55), ringD = mobile ? 86 : 120, cardW = Math.min(cardH * 399 / 515, (pw - ringD - 48) / 2), gap = ringD + (mobile ? 16 : 50), cy = py + 22;
        portrait(A, K, state.me, px + pw / 2 - gap / 2 - cardW, cy, cardW, cardH, MINE, '나');
        portrait(A, K, state.partner || { name: state.request.partnerName }, px + pw / 2 + gap / 2, cy, cardW, cardH, THEIRS, state.request.partnerName);
        const rcx = px + pw / 2, rcy = cy + cardH / 2, C = K.C;
        const left = Math.max(0, state.request.expiresAt - Date.now()), frac = Math.min(1, left / 300000), sec = Math.ceil(left / 1000);
        C.beginPath(); C.arc(rcx, rcy, ringD / 2 - 6, 0, 7); C.lineWidth = 7; C.strokeStyle = 'rgba(255,255,255,.08)'; C.stroke();
        C.beginPath(); C.arc(rcx, rcy, ringD / 2 - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); C.strokeStyle = incoming ? THEIRS : MINE; C.lineCap = 'round'; C.stroke(); C.lineCap = 'butt';
        K.text(Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'), rcx, rcy - 4, ringD * .2, K.INK, 'center', 800);
        K.text('남은 시간', rcx, rcy + ringD * .2, 11, K.DIM, 'center', 700);
        A.hit('timer', '', rcx - ringD / 2, rcy - ringD / 2, ringD, ringD, '남은 시간 ' + Math.floor(sec / 60) + '분 ' + sec % 60 + '초', true);
        let by = cy + cardH + 20;
        K.line(incoming ? state.request.partnerName + '님이 거래를 신청했습니다' : state.request.partnerName + '님의 수락을 기다립니다', px + pw / 2, by + 10, pw - 40, mobile ? 16 : 19, K.INK, 'center', 800, 11);
        by += 34; const bw = Math.min(320, pw - 40);
        if (incoming) K.btn('accept', '', px + (pw - bw) / 2, by, bw, 52, '수락', { primary: true, size: 18 });
        else K.btn('request-cancel', '', px + (pw - bw) / 2, by, bw, 50, '신청 취소', { danger: true, size: 16 });
    }
    function resultView(A, K, x, y, w, h, mobile) {
        A.uniforms.seam = y + 80;
        const r = state.result, ok = r.status === 'completed', pw = Math.min(w, 900), px = x + (w - pw) / 2, ph = h - 4, py = y;
        K.plate(px, py, pw, ph, 18, { a: .62, tint: ok ? K.GOOD : K.MUTE, tintA: .12 });
        const C = K.C, cx = px + pw / 2, cy = py + 52;
        C.beginPath(); C.arc(cx, cy, 30, 0, 7); C.fillStyle = K.rgba(ok ? K.GOOD : '#9aa7b8', .18); C.fill(); C.lineWidth = 2; C.strokeStyle = K.rgba(ok ? K.GOOD : '#9aa7b8', .9); C.stroke();
        if (ok) K.glyph('check', cx, cy, 22, K.GOOD); else K.glyph('refresh', cx, cy, 22, '#c4cfdd');
        K.text(ok ? '거래 완료' : '거래 취소', cx, cy + 50, 22, K.INK, 'center', 800);
        K.line(r.message || '', cx, cy + 78, pw - 40, 14, K.DIM, 'center', 600, 10);
        let gy = cy + 100; const gx = px + 16, gw = pw - 32, gb = py + ph - 76;
        const offer = r.receivedOffer, coins = offer ? ['gold', 'garnet'].filter(k => offer[k] > 0) : [];
        if (coins.length) { const cw = (gw - 8 * (coins.length - 1)) / coins.length; coins.forEach((k, i) => K.coin(k, offer.net[k], gx + i * (cw + 8), gy, cw, 42, { label: '받은 ' + LABELS[k] })); gy += 50; }
        const list = offer ? offerEntries(offer, 'result') : [];
        if (!offer) { K.well(gx, gy, gw, gb - gy, 10); K.text('올린 물품은 모두 돌려받았습니다', cx, gy + (gb - gy) / 2, 15, K.DIM, 'center', 600); }
        else if (list.length) {
            const cols = Math.max(2, Math.floor((gw + 8) / ((mobile ? 104 : 128) + 8))), rows = Math.max(1, Math.floor((gb - gy - 50 + 8) / ((mobile ? 156 : 176) + 8))), per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per));
            ui.pages.result = K.clamp(ui.pages.result, 0, pages - 1);
            const cw = Math.min(170, (gw - 8 * (cols - 1)) / cols), ch = (gb - gy - (pages > 1 ? 52 : 0) - 8 * (rows - 1)) / rows, ox = gx + (gw - (cw * Math.min(cols, list.length) + 8 * (Math.min(cols, list.length) - 1))) / 2;
            list.slice(ui.pages.result * per, ui.pages.result * per + per).forEach((e, i) => K.slot(e.info, ox + (i % cols) * (cw + 8), gy + Math.floor(i / cols) * (ch + 8), cw, ch, { action: 'inspect', id: e.key, small: mobile }));
            K.pager(gx, gb - 46, gw, ui.pages.result, pages, 'result-previous', 'result-next');
        }
        const bw = Math.min(320, pw - 32);
        K.btn('new', '', cx - bw / 2, py + ph - 64, bw, 50, '새 거래 신청', { primary: true, size: 17 });
    }

    // ── 동작
    function act(action, id) {
        if (MS.linesAct(ui, action)) { stage.invalidate(); return; }
        if (ui.dialog && !['dialog-close', 'cancel-yes'].includes(action)) { if (action === 'back') ui.dialog = null; stage.invalidate(); return; }
        if (ui.picker && action.startsWith('picker-')) return pickerAction(action, id);
        if (action !== 'back') stage.play('select');
        switch (action) {
            case 'back':
                if (ui.picker) { if (ui.picker.mobileDetail) ui.picker.mobileDetail = false; else ui.picker = null; }
                else if (ui.overlay) ui.overlay = '';
                break;
            case 'request': if (!busy && requestName.trim()) mutate('request', { name: requestName.trim() }); return;
            case 'accept': mutate('accept', { requestId: state.request.id }); return;
            case 'request-cancel': mutate('request-cancel', { requestId: state.request.id }); return;
            case 'confirm': mutate(state.session.confirmed ? 'unconfirm' : 'confirm', version(state.session)); return;
            case 'cancel': ui.dialog = { title: '거래 취소', lines: ['거래를 취소하고 올린 물품을 모두 돌려받을까요?'], actions: [{ action: 'dialog-close', label: '계속 거래' }, { action: 'cancel-yes', label: '거래 취소', danger: true }], tint: '#ff8f7a' }; break;
            case 'cancel-yes': ui.dialog = null; mutate('cancel', version(state.session)); return;
            case 'dialog-close': ui.dialog = null; break;
            case 'new': dismissedResult = state.result.id; ui.inspect = ''; break;
            case 'add': openPicker(); return;
            case 'inspect': ui.inspect = id; if (stage.width < 1100) ui.overlay = 'inspect'; stage.announce(inspected()?.info.title || ''); break;
            case 'overlay-close': ui.overlay = ''; break;
            case 'detail': detail(allEntries().find(e => e.key === id)); return;
            case 'board-next': ui.pages[id]++; break;
            case 'board-previous': ui.pages[id]--; break;
            case 'result-next': ui.pages.result++; break;
            case 'result-previous': ui.pages.result--; break;
        }
        stage.invalidate();
    }
    function field(key, value, how) {
        if (key === 'name') { requestName = value; if (how === 'enter' && requestName.trim() && !busy) mutate('request', { name: requestName.trim() }); else stage.invalidate(); return; }
        if (!ui.picker) return;
        if (key === 'picker-search') { ui.picker.query = value; ui.picker.page = 0; }
        if (key === 'picker-amount') { ui.picker.amount = value.replace(/[^0-9]/g, ''); ui.picker.error = ''; if (how === 'enter') { pickerAction('picker-submit'); return; } }
        stage.invalidate();
    }
    function detail(e) {
        if (!e) return;
        if (e.kind === 'card') openRichModal(e.entry.formatted || e.entry.name, '', [el('div', { class: 'dt-detail-context' }, ...mainCardDetailNodes(e.entry))]);
        else if (e.kind === 'equipment') openRichModal(e.entry.name, '', [el('div', { class: 'dt-detail-context' }, ...equipmentModalView(e.entry, false))]);
        else openRichModal(e.entry.name, e.entry.type || '아이템', [el('div', { class: 'dt-detail dt-detail-context' }, el('img', { src: e.entry.iconUrl, alt: e.entry.name }), el('b', null, comma(e.entry.count) + '개'), e.entry.desc ? el('p', null, e.entry.desc) : null)]);
    }

    // 보관함: 거래 가능한 목록을 받아 종류별로 보여 준다.
    function pickerKinds(data) {
        const typeRank = { 각성: 0, 전직: 1, 일반: 2 };
        const cards = (data?.cards || []).slice().sort((a, b) => b.star - a.star || (typeRank[a.type] ?? 3) - (typeRank[b.type] ?? 3) || a.id - b.id);
        return [
            { key: 'gold', label: '골드', currency: true, balance: state.balances.gold, icon: icons().gold },
            { key: 'garnet', label: '가넷', currency: true, balance: state.balances.garnet, icon: icons().garnet, steps: [100, 1000, 10000] },
            { key: 'card', label: '카드', entries: cards.map(e => ({ key: 'card:' + e.number, raw: e, info: MS.identify(e, 'card') })), filter: e => (e.raw.type || '일반') + ' 카드' },
            { key: 'equipment', label: '장비', entries: (data?.equipment || []).map(e => ({ key: 'equipment:' + e.number, raw: e, info: MS.identify(e, 'equipment') })), filter: e => e.raw.typeLabel },
            { key: 'item', label: '아이템', entries: (data?.items || []).map(e => ({ key: 'item:' + e.id, raw: e, info: MS.identify(e, 'item') })), filter: e => e.raw.type || '기타', quantity: e => e.raw.count }
        ];
    }
    async function openPicker() {
        const sessionId = state.session.id;
        ui.picker = MS.createPicker({ title: '물품 올리기', kinds: pickerKinds(null), start: 'card', submitLabel: '올리기' });
        ui.picker.error = '보유 목록 확인 중'; stage.play('paper'); stage.invalidate();
        let data;
        try { data = await api('/api/trade/inventory'); }
        catch (error) { if (ui.picker) { ui.picker.error = error.message; stage.invalidate(); } return; }
        if (!ui.picker || !active() || state.session?.id !== sessionId) return;
        ui.picker.config.kinds = pickerKinds(data); ui.picker.error = ''; stage.invalidate();
    }
    // 여러 개를 연달아 올릴 수 있게 보관함을 닫지 않고 목록만 새로 받는다(보유 목록 버전이 바뀌므로).
    async function reloadPicker(added) {
        const P = ui.picker; if (!P) return;
        P.selected = null; P.amount = ''; P.mobileDetail = false; P.done = added;
        try { const data = await api('/api/trade/inventory'); if (ui.picker === P) { const keep = P.kind; P.config.kinds = pickerKinds(data); P.kind = keep; } }
        catch (error) { if (ui.picker === P) P.error = error.message; }
        stage?.invalidate();
    }
    async function pickerAction(action, id) {
        const P = ui.picker;
        if (action === 'picker-close') { ui.picker = null; stage.play('cancel'); stage.invalidate(); return; }
        if (action === 'picker-detail') { const e = MS.pickerSelected(P); if (e) detail({ kind: P.kind, entry: e.raw }); return; }
        if (action !== 'picker-submit') { stage.play('select'); MS.pickerAct(P, action, id); stage.invalidate(); return; }
        if (busy || state.session?.processing) return;
        const kind = P.kind, kindConfig = P.config.kinds.find(k => k.key === kind), payload = { ...version(state.session), kind };
        if (kindConfig.currency) {
            const amount = Number(P.amount);
            if (!Number.isSafeInteger(amount) || amount < 1) { P.error = '등록할 수량을 입력해주세요.'; stage.invalidate(); return; }
            if (amount > state.balances[kind]) { P.error = '보유량보다 많습니다.'; stage.invalidate(); return; }
            payload.amount = amount;
        } else {
            const sel = MS.pickerSelected(P);
            if (!sel) { P.error = '올릴 품목을 선택해주세요.'; stage.invalidate(); return; }
            if (kind === 'item') {
                const count = Number(P.amount || 1);
                if (!Number.isSafeInteger(count) || count < 1 || count > sel.raw.count) { P.error = '수량을 확인해주세요.'; stage.invalidate(); return; }
                Object.assign(payload, { itemId: sel.raw.id, count, version: sel.raw.version });
            } else Object.assign(payload, { number: sel.raw.number, version: sel.raw.version });
        }
        const ok = await mutate('register', payload);
        if (ok) {
            stage?.play(kind === 'card' ? 'card' : kindConfig.currency ? 'chips' : 'drop'); stage?.pulse();
            const added = kindConfig.currency ? comma0(payload.amount) + ' ' + LABELS[kind] : (MS.pickerSelected(P)?.info.title || '');
            await reloadPicker(added);
        }
        else if (ui.picker) { ui.picker.error = errorText; errorText = ''; }
        stage?.invalidate();
    }

    // ── 상태 동기화 (기존 거래대와 같은 계약)
    function applyState(next) {
        if (state?.session && next.session?.id === state.session.id && next.session.revision !== state.session.revision && (state.session.confirmed || state.session.partnerConfirmed)) notice = '품목이 변경되어 양쪽 확정이 해제되었습니다.';
        else if (state?.status !== next.status || next.session?.confirmed || next.session?.partnerConfirmed) notice = '';
        const sig = next.session ? JSON.stringify(next.session.partnerOffer) : '';
        if (stage && lastPartnerSig && sig && sig !== lastPartnerSig && next.session?.id === state?.session?.id) { stage.play('slide'); stage.announce('상대가 물품을 바꿨습니다'); }
        if (stage && state?.session && next.session?.partnerConfirmed && !state.session.partnerConfirmed) stage.play('lock');
        if (stage && state?.status === 'active' && next.status !== 'active') { ui.picker = null; ui.overlay = ''; ui.dialog = null; if (next.result) stage.play(next.result.status === 'completed' ? 'deal' : 'cancel'); }
        lastPartnerSig = sig; state = next;
        stage?.invalidate();
    }
    async function refresh() {
        if (!active() || document.hidden || busy || polling) return;
        polling = true; const current = epoch;
        try { const result = await api('/api/trade'); if (current === epoch && !busy && active()) applyState(result.state); }
        catch (error) { if (current === epoch && active()) { errorText = error.message; stage?.invalidate(); } }
        finally { polling = false; }
    }
    async function mutate(action, payload) {
        if (busy) return false;
        busy = true; epoch++; errorText = ''; stage?.invalidate();
        try {
            const result = await postApi('/api/trade/' + action, payload);
            if (result.profile) renderProfile(result.profile);
            if (action === 'confirm') stage?.play('lock'); else if (action === 'unconfirm') stage?.play('unlock'); else if (action === 'request') stage?.play('paper');
            applyState(result.state);
            return true;
        } catch (error) { errorText = error.message; return false; }
        finally { busy = false; stage?.invalidate(); refresh(); }
    }
    function open() {
        close(); tickCount = 0;
        const host = root(); if (!host || !MS) return;
        stage = MS.mount(host, { theme: 'trade', label: '1:1 거래', state: ui, currencyIcons: new Proxy({}, { get: (_, key) => icons()[key] }), draw, onAct: act, onField: field });
        refresh();
        timer = setInterval(() => { tickCount++; if (state?.request) stage?.invalidate(); if (tickCount % 2 === 0) refresh(); }, 1000);
    }
    function close() { epoch++; clearInterval(timer); timer = 0; stage?.dispose(); stage = null; ui.picker = null; ui.overlay = ''; ui.dialog = null; }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && active()) refresh(); });
    window.DirectTradeUI = { open, close };
})();
