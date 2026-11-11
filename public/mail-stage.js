// 우편함 무대. 왼쪽은 편지 선반, 오른쪽은 펼친 편지와 소포, 편지 쓰기는 발송대 겹창.
// 서버 API(/api/mail, read, claim, giftable, recipient-fee, send)와 요청 형식은 기존 메일함과 같다.
(() => {
    'use strict';
    const MS = window.MarketStage;
    const ACC = '#e8c27a', GM = '#ffcf5a';
    const EQUIP_LABELS = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조', artifact: '아티팩트' };
    const CUR_LABEL = { gold: '골드', garnet: '가넷', point: '포인트' };
    const box = { mails: [], unread: 0, page: 1, totalPages: 1, loading: false, error: '' };
    const ui = { hover: '', focus: '', busy: false, selectedId: null, mode: 'list', listPage: 0, listPer: 1, bodyPage: 0, bodyPages: 1, compose: null, picker: null, dialog: null };
    let stage = null, opts = {}, loadToken = 0;
    const comma0 = n => Number(n || 0).toLocaleString('ko-KR');
    const selected = () => box.mails.find(m => m.id === ui.selectedId) || null;
    const relTime = ts => typeof mailRelTime === 'function' ? mailRelTime(ts) : new Date(Number(ts)).toLocaleDateString('ko-KR');

    // 메일 선물 → 품목 정체
    function giftInfo(g) {
        if (g.type === 'gold' || g.type === 'garnet' || g.type === 'point') { const info = MS.identify({ iconUrl: g.iconUrl }, g.type); info.title = g.label || comma0(g.amount) + ' ' + CUR_LABEL[g.type]; info.corner = null; info.chips = [{ text: CUR_LABEL[g.type], color: info.accent }, { text: comma0(g.amount), color: info.accent }]; return info; }
        if (g.type === 'item') return MS.identify({ name: g.name, count: g.count, iconUrl: g.iconUrl, frameUrl: g.frameUrl, type: g.itemType, desc: g.desc }, 'item');
        if (g.type === 'equipment') return MS.identify({ name: g.name, rarity: g.rarity, level: g.level, iconUrl: g.iconUrl, frameUrl: g.frameUrl, typeLabel: g.typeLabel || EQUIP_LABELS[g.equipType], detail: g.detail || null }, 'equipment');
        if (g.type === 'pet') return MS.identify({ name: g.name, rarity: g.rarity, level: g.level, iconUrl: g.iconUrl, frameUrl: g.frameUrl, statLines: g.statLines || [] }, 'pet');
        if (g.type === 'card') { const star = String(g.label || '').match(/^\[([^\]]+)\]/); return MS.identify({ formatted: g.label, star: g.star, starText: star ? star[1] : null, type: g.cardType, imageUrl: g.iconUrl }, 'card'); }
        if (g.type === 'avatar') return MS.identify({ name: g.avatarName, grade: g.grade, iconUrl: g.iconUrl, frameUrl: g.frameUrl }, 'avatar');
        if (g.type === 'title') { const info = MS.identify({ name: g.name + ' 칭호', iconUrl: g.iconUrl, type: '칭호' }, 'item'); return info; }
        return MS.identify({ name: g.label || '선물', iconUrl: g.iconUrl, frameUrl: g.frameUrl }, 'item');
    }

    // ── 그리기
    function draw(A, K) {
        const W = A.w, H = A.h, mobile = W < 760, wide = W >= 940, m = mobile ? 10 : 16;
        A.uniforms.accent = ACC; A.uniforms.accent2 = '#7fb4ff'; A.uniforms.glow = 0; A.uniforms.seam = 0;
        ui.busy = box.loading && !box.mails.length ? false : !!ui.compose?.sending;
        const top = topBar(A, K, m, mobile ? 6 : 10, W - m * 2, mobile ? 40 : 48, mobile);
        const h = H - top - m;
        if (wide) {
            const rw = K.clamp(Math.round((W - m * 2) * .38), 330, 440);
            rack(A, K, m, top, rw, h, mobile);
            letter(A, K, m + rw + 14, top, W - m * 2 - rw - 14, h, false);
        } else if (ui.mode === 'letter' && selected()) letter(A, K, m, top, W - m * 2, h, true);
        else rack(A, K, m, top, W - m * 2, h, mobile);
        if (ui.giftView != null && selected()?.gifts[ui.giftView]) {
            const info = giftInfo(selected().gifts[ui.giftView]), Mo = K.modal(info.kindLabel, Math.min(W - 16, 520), Math.min(H - 16, 600), { close: 'gift-close', tint: info.accent });
            K.inspect(info, Mo.x + 8, Mo.y + 60, Mo.w - 16, Mo.h - 68, { a: .985 });
        }
        if (ui.compose) composeView(A, K, mobile);
        if (ui.picker) MS.drawPicker(K, A, ui.picker, { tint: ACC, detailAction: null, amountNote: currencyNote, emptyText: '보낼 수 있는 품목이 없습니다' });
        if (ui.dialog) K.dialog(ui.dialog);
    }
    function topBar(A, K, x, y, w, h, mobile) {
        const cy = y + h / 2;
        K.gem(x + 12, cy, 9, K.steel(x, y, 24, h)); K.gem(x + 12, cy, 5, ACC);
        K.text('우편함', x + 30, cy + 1, mobile ? 19 : 24, K.INK, 'left', 800);
        const tw0 = K.tw('우편함', mobile ? 19 : 24, 800);
        if (box.unread > 0) K.chip('읽지 않음 ' + comma0(box.unread), x + 40 + tw0, cy - 11, ACC, { h: 22, size: 12 });
        const bw = mobile ? 112 : 150;
        K.btn('compose', '', x + w - bw, y + 4, bw, h - 8, '편지 쓰기', { primary: true, glyph: 'pen', size: mobile ? 14 : 15 });
        K.btn('refresh', '', x + w - bw - 8 - (h - 8), y + 4, h - 8, h - 8, '', { glyph: 'refresh', aria: '새로고침', disabled: box.loading });
        K.rule(x, y + h + 5, w, .8, ACC);
        return y + h + 14;
    }
    // 편지 선반: 봉투 한 줄마다 보낸 사람, 제목, 시간, 동봉물
    function rack(A, K, x, y, w, h, mobile) {
        K.plate(x, y, w, h, 14, { a: .55, tint: ACC, tintA: .08 });
        const p = 10, rowH = mobile ? 76 : 80, listTop = y + p, listH = h - p * 2 - 52;
        if (box.error && !box.mails.length) { K.text(box.error, x + w / 2, y + h / 2, 14, K.WARN, 'center', 700); return; }
        if (!box.mails.length) { envelopeArt(K, x + w / 2 - 40, y + h / 2 - 60, 80, 56, false, false); K.text(box.loading ? '불러오는 중' : '받은 편지가 없습니다', x + w / 2, y + h / 2 + 24, 15, K.DIM, 'center', 600); return; }
        const per = Math.max(1, Math.floor((listH + 6) / (rowH + 6))), localPages = Math.max(1, Math.ceil(box.mails.length / per));
        ui.listPer = per; ui.listPage = K.clamp(ui.listPage, 0, localPages - 1);
        box.mails.slice(ui.listPage * per, ui.listPage * per + per).forEach((mail, i) => row(A, K, mail, x + p, listTop + i * (rowH + 6), w - p * 2, rowH));
        // 페이지: 이 화면의 쪽과 서버의 쪽을 이어서 넘긴다.
        // 서버는 20통씩 나눠 주므로 앞쪽 서버 쪽은 꽉 찬 것으로 보고 이어지는 번호를 매긴다.
        const perServer = Math.ceil(20 / per), current = (box.page - 1) * perServer + ui.listPage + 1, total = Math.max(current, box.total ? (box.totalPages - 1) * perServer + Math.ceil((box.total - (box.totalPages - 1) * 20) / per) : current), atStart = box.page <= 1 && ui.listPage <= 0, atEnd = box.page >= box.totalPages && ui.listPage >= localPages - 1;
        if (!(atStart && atEnd)) {
            const py = y + h - p - 44;
            K.btn('list-previous', '', x + p, py, 44, 44, '', { glyph: 'prev', disabled: atStart || box.loading, aria: '이전 편지들' });
            K.btn('list-next', '', x + w - p - 44, py, 44, 44, '', { glyph: 'next', disabled: atEnd || box.loading, aria: '다음 편지들' });
            K.text(current + ' / ' + total, x + w / 2, py + 22, 13, K.DIM, 'center', 700);
        }
    }
    function envelopeArt(K, x, y, w, h, unread, gift) {
        const C = K.C;
        K.cut(x, y, w, h, 4); const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, unread ? '#3a3226' : '#262a33'); g.addColorStop(1, unread ? '#221d15' : '#171a20'); C.fillStyle = g; C.fill();
        C.lineWidth = 1.2; C.strokeStyle = unread ? 'rgba(232,194,122,.8)' : 'rgba(180,190,206,.45)'; C.stroke();
        C.beginPath(); C.moveTo(x + 2, y + 2); C.lineTo(x + w / 2, y + h * .58); C.lineTo(x + w - 2, y + 2); C.stroke();
        if (gift) { C.fillStyle = 'rgba(255,163,107,.85)'; C.fillRect(x + w * .66, y, 5, h); }
        if (unread) {
            C.save(); C.shadowColor = 'rgba(255,90,70,.8)'; C.shadowBlur = 10; C.beginPath(); C.arc(x + w / 2, y + h * .58, Math.min(w, h) * .2, 0, 7);
            const s = C.createRadialGradient(x + w / 2 - 2, y + h * .55, 1, x + w / 2, y + h * .58, Math.min(w, h) * .2); s.addColorStop(0, '#ff8a70'); s.addColorStop(1, '#a3221a'); C.fillStyle = s; C.fill(); C.restore();
        }
    }
    function row(A, K, mail, x, y, w, h) {
        const key = 'open:' + mail.id, on = ui.selectedId === mail.id, hov = K.S.hover === key, unread = !mail.read, pending = mail.hasGifts && !mail.claimed;
        if (on) { K.C.save(); K.C.shadowColor = K.rgba(ACC, .7); K.C.shadowBlur = 14; K.cut(x, y, w, h, 8); K.C.fillStyle = K.rgba(ACC, .2); K.C.fill(); K.C.restore(); }
        K.plate(x, y, w, h, 8, { a: on ? .92 : .8, edge: on || hov ? 1.3 : .7, tint: unread ? ACC : null, tintA: .14 });
        envelopeArt(K, x + 10, y + (h - 36) / 2, 50, 36, unread, pending);
        const tx = x + 72, right = x + w - 10, timeW = K.tw(relTime(mail.createdAt), 12, 600);
        let fx = tx;
        if (mail.gm) { fx += K.chip('GM', tx, y + 8, GM, { h: 20, size: 11 }) + 6; }
        K.line(mail.from, fx, y + 18, right - timeW - 10 - fx, 13, unread ? K.INK : K.DIM, 'left', 800, 10);
        K.text(relTime(mail.createdAt), right, y + 18, 12, K.MUTE, 'right', 600);
        K.line(mail.subject, tx, y + 40, right - tx, 15, unread ? K.INK : K.DIM, 'left', unread ? 800 : 600, 11);
        if (mail.hasGifts) {
            let gx = tx; const gs = 22;
            mail.gifts.slice(0, 5).forEach(g => { const info = giftInfo(g); K.well(gx, y + h - gs - 7, gs, gs, 4, K.rgba(info.accent, .12)); A.art(info.art, gx + 1, y + h - gs - 6, gs - 2, gs - 2, { dim: mail.claimed }); gx += gs + 4; });
            if (mail.gifts.length > 5) { K.text('+' + (mail.gifts.length - 5), gx + 4, y + h - gs / 2 - 7, 11, K.DIM, 'left', 700); gx += 24; }
            K.text(mail.claimed ? '받음' : '선물 ' + mail.gifts.length, gx + 6, y + h - gs / 2 - 7, 11, mail.claimed ? K.MUTE : '#ffa36b', 'left', 800);
        }
        if (on) { K.cut(x, y, w, h, 8); K.C.lineWidth = 2; K.C.strokeStyle = K.rgba(ACC, .95); K.C.stroke(); }
        K.ring(key, x, y, w, h, 8);
        A.hit('open', mail.id, x, y, w, h, [unread ? '읽지 않은 편지' : '', mail.gm ? 'GM' : '', mail.from, mail.subject, relTime(mail.createdAt), mail.hasGifts ? (mail.claimed ? '선물 받음' : '선물 ' + mail.gifts.length + '개') : ''].filter(Boolean).join(', '), false, on);
    }
    // 펼친 편지
    function letter(A, K, x, y, w, h, mobile) {
        const mail = selected();
        K.plate(x, y, w, h, 16, { a: .58, tint: mail?.gm ? GM : ACC, tintA: .1 });
        if (!mail) { envelopeArt(K, x + w / 2 - 60, y + h / 2 - 70, 120, 84, false, false); return; }
        const p = mobile ? 12 : 20; let ty = y + p;
        if (mobile) { K.btn('letter-back', '', x + p, ty, 44, 40, '', { glyph: 'prev', aria: '편지 목록' }); }
        const sx = x + p + (mobile ? 54 : 0), sw = w - p * 2 - (mobile ? 54 : 0);
        const f = K.fit(mail.subject, sw, mobile ? 52 : 62, mobile ? 19 : 23, 13, 800); K.para(f, sx, ty + (mobile ? Math.max(0, (40 - f.lines.length * f.lh) / 2) : 0), K.INK, 'left');
        ty += Math.max(mobile ? 44 : 0, f.lines.length * f.lh) + 8;
        let mx = x + p; K.text('보낸 사람', mx, ty + 10, 12, K.DIM, 'left', 700); mx += K.tw('보낸 사람', 12, 700) + 8;
        if (mail.gm) mx += K.chip('GM', mx, ty, GM, { h: 20, size: 11 }) + 6;
        K.line(mail.from, mx, ty + 10, w * .45, 14, K.INK, 'left', 800, 10);
        K.text(new Date(mail.createdAt).toLocaleString('ko-KR'), x + w - p, ty + 10, 12, K.MUTE, 'right', 600);
        ty += 26; K.rule(x + p, ty, w - p * 2, .7, ACC); ty += 10;
        // 동봉물 영역 높이를 먼저 정한다.
        const gifts = mail.hasGifts ? mail.gifts : [], giftH = gifts.length ? (mobile ? 236 : 248) : 0;
        const bodyH = h - (ty - y) - p - giftH - (gifts.length ? 12 : 0);
        bodyText(A, K, mail.body || '(내용 없음)', x + p, ty, w - p * 2, bodyH);
        if (!gifts.length) return;
        const gy = y + h - p - giftH;
        parcel(A, K, mail, gifts, x + p, gy, w - p * 2, giftH, mobile);
    }
    function bodyText(A, K, text, x, y, w, h) {
        K.well(x, y, w, h, 10, 'rgba(236,224,200,.045)');
        const pad = 14, lh = 24, sz = 15, lines = K.wrap(text, w - pad * 2, sz, 600), per = Math.max(1, Math.floor((h - pad * 2 - 4) / lh));
        const pages = Math.max(1, Math.ceil(lines.length / per)); ui.bodyPages = pages; ui.bodyPage = K.clamp(ui.bodyPage, 0, pages - 1);
        const usable = pages > 1 ? Math.max(1, Math.floor((h - pad * 2 - 48) / lh)) : per, realPages = Math.max(1, Math.ceil(lines.length / usable));
        ui.bodyPages = realPages; ui.bodyPage = K.clamp(ui.bodyPage, 0, realPages - 1);
        lines.slice(ui.bodyPage * usable, ui.bodyPage * usable + usable).forEach((l, i) => K.text(l, x + pad, y + pad + lh * (i + .5), sz, '#e8e2d4', 'left', 600));
        if (realPages > 1) K.pager(x + w / 2 - 90, y + h - 50, 180, ui.bodyPage, realPages, 'body-previous', 'body-next');
        A.hit('body', '', x, y, w, Math.min(h, 40), '편지 내용 ' + text, true);
    }
    // 소포: 동봉물 칸과 받기 버튼
    function parcel(A, K, mail, gifts, x, y, w, h, mobile) {
        const C = K.C;
        K.plate(x, y, w, h, 12, { a: .72, edge: .8, tint: '#ffa36b', tintA: mail.claimed ? .03 : .12 });
        // 끈: 받기 전에는 소포를 가로지르는 끈이 묶여 있다.
        if (!mail.claimed) { C.fillStyle = 'rgba(255,163,107,.32)'; C.fillRect(x + 14, y + 36, w - 28, 2); }
        K.text('동봉된 선물 ' + gifts.length + '개', x + 14, y + 18, 13, mail.claimed ? K.DIM : '#ffa36b', 'left', 800);
        const btnW = mobile ? w - 28 : 190, bh = 46, inner = h - 44 - (mobile ? bh + 12 : 0) - 12;
        const gx = x + 12, gw = w - 24 - (mobile ? 0 : btnW + 14), gy = y + 42;
        const n = Math.min(5, gifts.length), cw = Math.min(150, (gw - 8 * (n - 1)) / n), ch = inner, ox = gx + (gw - (cw * n + 8 * (n - 1))) / 2;
        gifts.slice(0, 5).forEach((g, i) => K.slot(giftInfo(g), ox + i * (cw + 8), gy, cw, ch, { action: 'gift', id: String(i), small: true, dim: mail.claimed }));
        const bx = mobile ? x + 14 : x + w - btnW - 14, by = mobile ? y + h - bh - 12 : y + (h - bh) / 2 + 10;
        if (mail.claimed) {
            K.plate(bx, by, btnW, bh, 10, { a: .9, edge: .5, tint: K.GOOD, tintA: .2 }); K.glyph('check', bx + 28, by + bh / 2, 12, K.GOOD);
            K.text('수령 완료', bx + btnW / 2 + 10, by + bh / 2 + .5, 15, K.GOOD, 'center', 800);
        } else K.btn('claim', mail.id, bx, by, btnW, bh, '선물 받기', { primary: true, size: 17 });
    }

    // 발송대
    function composeView(A, K, mobile) {
        const c = ui.compose, W = A.w, H = A.h;
        const M = K.modal('편지 쓰기', mobile ? W - 8 : Math.min(1040, W - 40), mobile ? H - 8 : Math.min(720, H - 32), { close: 'compose-close', tint: ACC });
        const p = mobile ? 12 : 20, foot = M.y + M.h - p;
        if (!c.giftable) { K.text(c.error || '보낼 수 있는 품목 확인 중', M.x + M.w / 2, M.y + M.h / 2, 15, c.error ? K.WARN : K.DIM, 'center', 600); return; }
        const colW = mobile ? M.w - p * 2 : Math.round((M.w - p * 3) * .54), lx = M.x + p; let y = M.y + 66;
        const label = (t, yy, extra) => { K.text(t, lx, yy + 8, 12, K.DIM, 'left', 700); if (extra) K.chip(extra.text, lx + K.tw(t, 12, 700) + 10, yy - 2, extra.color, { h: 20, size: 11 }); };
        const fee = c.resolved ? { text: '이 상대 수수료 ' + Math.round(c.feeRate * 1000) / 10 + '%', color: K.GOLD } : null;
        label('받는 사람', y, fee); y += 20; K.well(lx, y, colW, 44, 7); A.field('to', lx + 8, y + 2, colW - 16, 40, { value: c.to, placeholder: '받는 사람 닉네임', maxLength: 10, label: '받는 사람' }); y += 52;
        label('제목', y); y += 20; K.well(lx, y, colW, 44, 7); A.field('subject', lx + 8, y + 2, colW - 16, 40, { value: c.subject, placeholder: '제목 (최대 50자)', maxLength: 50, label: '제목' }); y += 52;
        label('내용', y); y += 20;
        // 휴대폰은 아래(보내기, 담기 버튼, 소포 칸)부터 자리를 잡고 남는 높이를 내용 칸에 준다.
        const mobileSlot = Math.min((M.w - p * 2 - 6 * (c.giftable.maxGifts - 1)) / c.giftable.maxGifts, 64);
        const bodyH = mobile ? Math.max(48, foot - 50 - 24 - (36 * 2 + 6 + 8) - (20 + mobileSlot + 8) - 10 - y) : foot - 64 - y;
        K.well(lx, y, colW, bodyH, 7, 'rgba(236,224,200,.045)'); A.field('body', lx + 8, y + 4, colW - 16, bodyH - 8, { value: c.body, placeholder: '내용을 입력하세요', maxLength: 1000, multiline: true, label: '내용' });
        y += bodyH + 10;
        // 소포 칸
        const rx = mobile ? lx : lx + colW + p, rw = mobile ? colW : M.x + M.w - p - rx; let ry = mobile ? y : M.y + 66;
        K.text('소포  ' + c.gifts.length + ' / ' + c.giftable.maxGifts, rx, ry + 8, 12, '#ffa36b', 'left', 800); ry += 20;
        const max = c.giftable.maxGifts;
        if (mobile) {
            const sw = (rw - 6 * (max - 1)) / max, sh = mobileSlot;
            for (let i = 0; i < max; i++) {
                const g = c.gifts[i], gx = rx + i * (sw + 6);
                if (!g) { K.well(gx, ry, sw, sh, 6); K.gem(gx + sw / 2, ry + sh / 2, 4, 'rgba(255,255,255,.1)'); continue; }
                const info = draftInfo(g); K.well(gx, ry, sw, sh, 6, K.rgba(info.accent, .1));
                const bxy = info.card ? K.fitBox(sw - 10, sh - 10, 399 / 515) : { w: sh - 14, h: sh - 14 }; A.art(info.art, gx + (sw - bxy.w) / 2, ry + (sh - bxy.h) / 2, bxy.w, bxy.h, { fx: info.fx });
                K.btn('gift-remove', String(i), gx + sw - 26, ry + 2, 24, 24, '', { glyph: 'close', aria: info.title + ' 빼기' });
                A.hit('gift-view', String(i), gx, ry + 26, sw, sh - 26, info.title, true);
            }
            ry += sh + 8;
        } else {
            const rowH = Math.min(62, (foot - 64 - 112 - ry) / max - 6);
            for (let i = 0; i < max; i++) {
                const g = c.gifts[i], gy2 = ry + i * (rowH + 6);
                if (g) { const info = draftInfo(g); K.mini(info, rx, gy2, rw, rowH, { remove: 'gift-remove', id: String(i), right: g.type === 'item' ? '×' + comma0(g.count) : '' }); }
                else { K.well(rx, gy2, rw, rowH, 7); K.text('빈 칸', rx + rw / 2, gy2 + rowH / 2, 12, K.MUTE, 'center', 600); }
            }
            ry += max * (rowH + 6) + 4;
        }
        // 담기 버튼
        const adds = [['gold', '골드'], ['garnet', '가넷'], ['point', '포인트'], ['equipment', '장비'], ['pet', '펫'], ['item', '아이템'], ['avatar', '아바타']];
        const cols = 4, bw = (rw - 6 * (cols - 1)) / cols, bh = mobile ? 36 : 42, full = c.gifts.length >= max;
        adds.forEach(([k, l], i) => K.btn('add', k, rx + (i % cols) * (bw + 6), ry + Math.floor(i / cols) * (bh + 6), bw, bh, l, { icon: CUR_LABEL[k] && !mobile ? k : null, glyph: CUR_LABEL[k] || mobile ? null : 'plus', size: 13, disabled: full, aria: l + ' 담기' }));
        ry += Math.ceil(adds.length / cols) * (bh + 6);
        // 아래: 수수료, 오류, 보내기
        const by = foot - 50, fees = feeTotal();
        const msg = c.error || (fees > 0 ? '수수료 ' + comma0(fees) : '');
        if (msg) K.line(msg, M.x + p, by - 14, M.w - p * 2, 13, c.error ? K.WARN : K.GOLD, 'left', 700, 10);
        const sendW = mobile ? (M.w - p * 2) * .62 : 220;
        K.btn('compose-close', 'foot', M.x + M.w - p - sendW - 8 - (mobile ? M.w - p * 2 - sendW - 8 : 120), by, mobile ? M.w - p * 2 - sendW - 8 : 120, 50, '닫기');
        K.btn('send', '', M.x + M.w - p - sendW, by, sendW, 50, c.sending ? '보내는 중' : '보내기', { primary: true, size: 18, disabled: c.sending });
    }
    function draftInfo(g) {
        if (g.type === 'gold' || g.type === 'garnet' || g.type === 'point') { const info = MS.identify({ iconUrl: ui.compose.giftable[g.type + 'IconUrl'] }, g.type); info.title = comma0(g.amount) + ' ' + CUR_LABEL[g.type]; info.chips = [{ text: CUR_LABEL[g.type], color: info.accent }]; return info; }
        return g._info;
    }
    const feeOf = amount => Math.max(ui.compose.giftable.feeMin, Math.floor(amount * ui.compose.feeRate));
    function feeTotal() { return ui.compose.gifts.reduce((s, g) => s + (g.type === 'gold' || g.type === 'garnet' ? feeOf(g.amount) : 0), 0); }
    function currencyNote(kind, amount) {
        if (!(amount > 0)) return '';
        if (kind.key === 'point') return '받는 사람 수령 ' + comma0(amount);
        const fee = feeOf(amount); return '수수료 ' + comma0(fee) + '   받는 사람 수령 ' + comma0(Math.max(0, amount - fee));
    }

    // ── 데이터
    async function load(page) {
        const token = ++loadToken; box.loading = true; box.error = ''; stage?.invalidate();
        try {
            const data = await api('/api/mail?page=' + (Number(page) || 1));
            if (token !== loadToken) return;
            box.mails = data.mails || []; box.total = data.total || 0; box.unread = data.unread || 0; box.page = data.page || 1; box.totalPages = data.totalPages || 1;
            opts.onUnread?.(box.unread);
            if (ui.selectedId && !box.mails.some(m => m.id === ui.selectedId)) { ui.selectedId = null; ui.mode = 'list'; }
            if (!ui.selectedId && stage && stage.width >= 940 && box.mails.length) select(box.mails[0].id, true);
        } catch (error) { if (token === loadToken) box.error = error.message; }
        finally { if (token === loadToken) { box.loading = false; stage?.invalidate(); } }
    }
    async function select(id, quiet) {
        const mail = box.mails.find(m => m.id === id); if (!mail) return;
        ui.selectedId = id; ui.mode = 'letter'; ui.bodyPage = 0; ui.giftView = null;
        if (!quiet) { stage?.play('letter'); stage?.announce(mail.subject); }
        stage?.invalidate();
        if (!mail.read) {
            mail.read = true; box.unread = Math.max(0, box.unread - 1); opts.onUnread?.(box.unread); stage?.invalidate();
            try { await postApi('/api/mail/read', { id }); } catch (_) { }
        }
    }
    async function claim(id) {
        const mail = box.mails.find(m => m.id === id); if (!mail || mail.claimed) return;
        ui.busy = true; stage.invalidate();
        try {
            await postApi('/api/mail/claim', { id });
            mail.claimed = true; stage.play('claim'); stage.pulse();
            ui.dialog = { title: '수령 완료', lines: ['선물을 받았습니다.'], rows: mail.gifts.map(giftInfo), wide: true, tint: '#ffa36b' };
        } catch (error) { ui.dialog = { title: '받지 못했습니다', lines: [error.message], error: true }; }
        finally { ui.busy = false; stage?.invalidate(); }
    }

    // 편지 쓰기
    async function openCompose() {
        ui.compose = { to: '', subject: '', body: '', gifts: [], giftable: null, feeRate: 0, resolved: '', error: '', sending: false, token: 0 };
        stage.play('paper'); stage.invalidate();
        try {
            const giftable = await api('/api/mail/giftable');
            if (!ui.compose) return;
            ui.compose.giftable = giftable; ui.compose.feeRate = ui.compose.baseFee = Number(giftable.feeRate);
        } catch (error) { if (ui.compose) ui.compose.error = error.message; }
        stage.invalidate();
    }
    async function syncFee() {
        const c = ui.compose; if (!c || !c.giftable) return;
        const to = c.to.trim(); if (!to || to === c.resolved) return;
        const token = ++c.token;
        try {
            const data = await api('/api/mail/recipient-fee?to=' + encodeURIComponent(to));
            if (ui.compose !== c || token !== c.token) return;
            c.feeRate = Number(data.feeRate); c.giftable.feeMin = Number(data.feeMin); c.resolved = to; c.error = '';
        } catch (error) { if (ui.compose !== c || token !== c.token) return; c.feeRate = c.baseFee; c.resolved = ''; c.error = error.message; }
        stage?.invalidate();
    }
    async function openGiftPicker(kind) {
        const c = ui.compose;
        if (c.gifts.length >= c.giftable.maxGifts) { c.error = '선물은 최대 ' + c.giftable.maxGifts + '개까지 담을 수 있습니다.'; stage.invalidate(); return; }
        c.error = '';
        if ((kind === 'gold' || kind === 'garnet') && c.to.trim()) await syncFee();
        const g = c.giftable, usedEq = new Set(c.gifts.filter(x => x.type === 'equipment').map(x => x.number)), usedPet = new Set(c.gifts.filter(x => x.type === 'pet').map(x => x.index)), usedAv = new Set(c.gifts.filter(x => x.type === 'avatar').map(x => x.avatarId));
        const reserved = type => c.gifts.filter(x => x.type === type).reduce((s, x) => s + Number(x.amount || 0), 0), addedItem = id => c.gifts.filter(x => x.type === 'item' && x.id === id).reduce((s, x) => s + x.count, 0);
        const currency = key => ({ key, label: CUR_LABEL[key], currency: true, balance: Math.max(0, g[key] - reserved(key)), reserved: reserved(key), icon: g[key + 'IconUrl'], steps: key === 'gold' ? [10000, 100000, 1000000] : [100, 1000, 10000] });
        const kinds = [currency('gold'), currency('garnet'), currency('point'),
            { key: 'equipment', label: '장비', entries: g.equipment.filter(o => !usedEq.has(o.number)).map(o => ({ key: 'e' + o.number, raw: o, info: MS.identify(o, 'equipment') })), filter: e => e.raw.typeLabel || e.raw.rarity },
            { key: 'pet', label: '펫', entries: g.pets.filter(o => !usedPet.has(o.index)).map(o => ({ key: 'p' + o.index, raw: o, info: MS.identify(o, 'pet') })), filter: e => e.raw.rarity },
            { key: 'item', label: '아이템', entries: g.items.map(o => ({ ...o, left: o.count - addedItem(o.id) })).filter(o => o.left > 0).map(o => ({ key: 'i' + o.id, raw: o, info: MS.identify({ ...o, count: o.left }, 'item') })), filter: e => e.raw.type || '기타', quantity: e => e.raw.left },
            { key: 'avatar', label: '아바타', entries: (g.avatars || []).filter(o => !usedAv.has(o.id)).map(o => ({ key: 'a' + o.id, raw: o, info: MS.identify(o, 'avatar') })), filter: e => e.raw.grade || '일반' }];
        ui.picker = MS.createPicker({ title: '소포에 담기', kinds, start: kind, submitLabel: '담기' });
        stage.play('paper'); stage.invalidate();
    }
    function pickerSubmit() {
        const P = ui.picker, c = ui.compose, kind = P.config.kinds.find(k => k.key === P.kind);
        if (kind.currency) {
            const amount = Math.floor(Number(P.amount));
            if (!(amount > 0)) { P.error = '수량을 입력하세요.'; return; }
            if (amount > kind.balance) { P.error = '보유량을 초과했습니다.'; return; }
            if (kind.key !== 'point') { const fee = feeOf(amount); if (amount - fee < 1) { P.error = '수수료(' + comma0(fee) + ') 이상이어야 합니다.'; return; } }
            c.gifts.push({ type: kind.key, amount });
        } else {
            const sel = MS.pickerSelected(P); if (!sel) { P.error = '담을 품목을 고르세요.'; return; }
            const o = sel.raw;
            if (kind.key === 'equipment') c.gifts.push({ type: 'equipment', number: o.number, _info: sel.info });
            else if (kind.key === 'pet') c.gifts.push({ type: 'pet', index: o.index, _info: sel.info });
            else if (kind.key === 'avatar') c.gifts.push({ type: 'avatar', name: o.name, avatarId: o.id, _info: sel.info });
            else {
                const count = Math.floor(Number(P.amount || 1));
                if (!(count > 0) || count > o.left) { P.error = '수량이 올바르지 않습니다.'; return; }
                c.gifts.push({ type: 'item', id: o.id, count, _info: MS.identify({ ...o, count }, 'item') });
            }
        }
        ui.picker = null; stage.play('pack');
    }
    async function send() {
        const c = ui.compose; c.error = '';
        const to = c.to.trim();
        if (!to) { c.error = '받는 사람을 입력해주세요.'; return; }
        if (!c.subject.trim() && !c.body.trim() && !c.gifts.length) { c.error = '내용 또는 선물을 입력해주세요.'; return; }
        c.sending = true; stage.invalidate();
        try {
            const gifts = c.gifts.map(g => { const out = {}; for (const k in g) if (k[0] !== '_') out[k] = g[k]; return out; });
            const r = await postApi('/api/mail/send', { to, subject: c.subject.trim(), body: c.body.trim(), gifts });
            ui.compose = null; stage.play('stamp'); stage.pulse();
            ui.dialog = { title: '발송 완료', lines: [to + '님에게 편지를 보냈습니다.' + (r.fee ? '\n골드와 가넷은 수수료 ' + comma0(r.fee) + '을 뺀 금액이 전달됩니다.' : '')], tint: ACC };
        } catch (error) { if (ui.compose) { c.error = error.message; c.sending = false; } }
        stage?.invalidate();
    }

    // ── 동작
    function act(action, id) {
        if (MS.linesAct(ui, action)) { stage.invalidate(); return; }
        if (ui.dialog) { if (['dialog-close', 'back', 'claim-yes'].includes(action)) { const d = ui.dialog; ui.dialog = null; if (action === 'claim-yes') { claim(d.mailId); return; } } stage.invalidate(); return; }
        if (ui.picker && (action.startsWith('picker-') || action === 'back')) {
            if (action === 'picker-close' || (action === 'back' && !ui.picker.mobileDetail)) { ui.picker = null; stage.play('cancel'); }
            else if (action === 'back') ui.picker.mobileDetail = false;
            else if (action === 'picker-submit') pickerSubmit();
            else { stage.play('select'); MS.pickerAct(ui.picker, action, id); }
            stage.invalidate(); return;
        }
        if (action !== 'back') stage.play('select');
        switch (action) {
            case 'back': if (ui.giftView != null) ui.giftView = null; else if (ui.compose) ui.compose = null; else if (ui.mode === 'letter' && stage.width < 940) ui.mode = 'list'; break;
            case 'open': select(id); return;
            case 'letter-back': ui.mode = 'list'; break;
            case 'list-next': if (ui.listPage < Math.ceil(box.mails.length / ui.listPer) - 1) ui.listPage++; else if (box.page < box.totalPages) { ui.listPage = 0; load(box.page + 1); } break;
            case 'list-previous': if (ui.listPage > 0) ui.listPage--; else if (box.page > 1) { ui.listPage = Math.ceil(20 / ui.listPer) - 1; load(box.page - 1); } break;
            case 'body-next': ui.bodyPage++; break;
            case 'body-previous': ui.bodyPage--; break;
            case 'refresh': load(box.page); return;
            case 'claim': ui.dialog = { title: '선물 받기', lines: ['동봉된 선물을 모두 받을까요?'], rows: (selected()?.gifts || []).map(giftInfo), wide: true, mailId: id, tint: '#ffa36b', actions: [{ action: 'dialog-close', label: '취소' }, { action: 'claim-yes', label: '받기', primary: true }] }; break;
            case 'gift': { const g = selected()?.gifts[Number(id)]; if (g) { ui.giftView = Number(id); stage.announce(giftInfo(g).title); } break; }
            case 'gift-close': ui.giftView = null; break;
            case 'compose': openCompose(); return;
            case 'compose-close': ui.compose = null; stage.play('cancel'); break;
            case 'add': openGiftPicker(id); return;
            case 'gift-remove': ui.compose.gifts.splice(Number(id), 1); ui.compose.error = ''; break;
            case 'send': send(); return;
        }
        stage.invalidate();
    }
    function field(key, value, how) {
        if (ui.picker) {
            if (key === 'picker-search') { ui.picker.query = value; ui.picker.page = 0; }
            if (key === 'picker-amount') { ui.picker.amount = value.replace(/[^0-9]/g, ''); ui.picker.error = ''; if (how === 'enter') { pickerSubmit(); } }
            stage.invalidate(); return;
        }
        const c = ui.compose; if (!c) return;
        if (key === 'to') { if (value !== c.to) { c.to = value; if (value.trim() !== c.resolved) { c.feeRate = c.baseFee; c.resolved = ''; } } if (how === 'blur' || how === 'enter') syncFee(); }
        if (key === 'subject') c.subject = value;
        if (key === 'body') c.body = value;
        stage.invalidate();
    }
    function open(options) {
        close(); opts = options || {};
        const host = document.getElementById('mailStageRoot'); if (!host || !MS) return;
        stage = MS.mount(host, { theme: 'mail', label: '우편함', state: ui, currencyIcons: new Proxy({}, { get: (_, key) => (ui.compose?.giftable || {})[key + 'IconUrl'] || (typeof QUEST_REWARD_CURRENCY_ICONS === 'object' ? QUEST_REWARD_CURRENCY_ICONS[CUR_LABEL[key]] : null) }), draw, onAct: act, onField: field });
        load(1);
    }
    function close() { stage?.dispose(); stage = null; ui.compose = null; ui.picker = null; ui.dialog = null; ui.mode = 'list'; }
    window.MailStageUI = { open, close, reload: () => load(box.page) };
})();
