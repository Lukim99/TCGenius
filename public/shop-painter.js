// 상점 화면 페인터. Canvas2D에 그리고 부모가 WebGL 텍스처로 올린다. 이벤트·요청은 부모 담당.
(function () {
    'use strict';
    const FONT = '"Black Market Pretendard", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const INK = '#f3f5f9', DIM = 'rgba(214,222,236,.66)', MUTE = 'rgba(190,198,214,.42)', GOLD = '#ffd873', WARN = '#ff8f7a', GOOD = '#86e3b6';
    const CUR = { gold: '골드', garnet: '가넷', point: '포인트', mileage: '마일리지' };
    const HUES = [['암시장', '#a98bff'], ['레이드|재료|보스', '#ff8a5c'], ['패키지|꾸러미|번들|묶음', '#f0b450'], ['아바타|패션|코스튬|스킨', '#ff7fae'],
        ['이벤트|캡슐|시즌', '#4fd1a5'], ['카드|스펙터|소환', '#6fb4ff'], ['포인트|마일리지|코인|가넷', '#57d3e6'], ['일반|골드|기본', '#e8b04b']];
    const PAL = ['#6fb4ff', '#4fd1a5', '#f0b450', '#ff7fae', '#a98bff', '#57d3e6', '#ff8a5c'];
    let A, C, S, W, H, live = true, acc = '#6fb4ff';

    // ── 기본 도구
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; }
    function hue(name) {
        name = String(name || ''); for (const [k, c] of HUES) if (new RegExp(k).test(name)) return c;
        let h = 0; for (const ch of name) h = h * 31 + ch.charCodeAt(0) | 0; return PAL[Math.abs(h) % PAL.length];
    }
    function font(sz, wt) { C.font = `${wt || 600} ${sz}px ${FONT}`; }
    function tw(s, sz, wt) { font(sz, wt); return C.measureText(String(s)).width; }
    function text(s, x, y, sz, col, al, wt) { font(sz, wt); C.fillStyle = col; C.textAlign = al || 'left'; C.textBaseline = 'middle'; C.fillText(String(s), x, y); }
    // 한 줄 텍스트: 폭에 맞을 때까지 글자 크기만 줄인다(말줄임 없음).
    function line(s, x, y, w, sz, col, al, wt, min = 10) { while (sz > min && tw(s, sz, wt) > w) sz--; text(s, x, y, sz, col, al, wt); return tw(s, sz, wt); }
    function wrap(s, w, sz, wt) {
        font(sz, wt); const out = []; let ln = '';
        for (const word of String(s ?? '').split(/\s+/).filter(Boolean)) {
            const next = ln ? ln + ' ' + word : word;
            if (C.measureText(next).width <= w) { ln = next; continue; }
            if (ln) out.push(ln); ln = '';
            for (const ch of word) { if (ln && C.measureText(ln + ch).width > w) { out.push(ln); ln = ch; } else ln += ch; }
        }
        if (ln) out.push(ln); return out.length ? out : [''];
    }
    // 여러 줄: 상자 높이에 다 들어갈 때까지 글자 크기를 줄인다.
    function fit(s, w, h, max, min, wt) {
        let f; for (let sz = max; sz >= min; sz--) { const lh = Math.round(sz * 1.28); f = { lines: wrap(s, w, sz, wt), sz, lh, wt }; if (f.lines.length * lh <= h) break; }
        return f;
    }
    function para(f, x, y, col, al) { f.lines.forEach((l, i) => text(l, x, y + f.lh * (i + .5), f.sz, col, al, f.wt)); return f.lines.length * f.lh; }

    // ── 재질: 왼쪽 위·오른쪽 아래를 깊게 깎은 각진 판, 강철 테두리
    function cut(x, y, w, h, k) {
        const s = Math.min(k * .35, 4); C.beginPath(); C.moveTo(x + k, y); C.lineTo(x + w - s, y); C.lineTo(x + w, y + s); C.lineTo(x + w, y + h - k);
        C.lineTo(x + w - k, y + h); C.lineTo(x + s, y + h); C.lineTo(x, y + h - s); C.lineTo(x, y + k); C.closePath();
    }
    function steel(x, y, w, h, a = 1) {
        const g = C.createLinearGradient(x, y, x + w * .3, y + h);
        g.addColorStop(0, `rgba(238,244,252,${.8 * a})`); g.addColorStop(.28, `rgba(112,124,144,${.5 * a})`);
        g.addColorStop(.55, `rgba(214,224,238,${.66 * a})`); g.addColorStop(1, `rgba(56,64,80,${.6 * a})`); return g;
    }
    function plate(x, y, w, h, k, o = {}) {
        const a = o.a ?? .78; cut(x, y, w, h, k);
        const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, `rgba(28,32,44,${a})`); g.addColorStop(1, `rgba(8,10,16,${Math.min(1, a + .1)})`); C.fillStyle = g; C.fill();
        if (o.tint) { const t = C.createLinearGradient(0, y, 0, y + Math.min(h, 220)); t.addColorStop(0, rgba(o.tint, .16)); t.addColorStop(1, rgba(o.tint, 0)); C.fillStyle = t; C.fill(); }
        C.lineWidth = 1.5; C.strokeStyle = steel(x, y, w, h, o.edge ?? 1); C.stroke();
        cut(x + 3, y + 3, w - 6, h - 6, Math.max(2, k - 2)); C.lineWidth = 1; C.strokeStyle = 'rgba(0,0,0,.55)'; C.stroke();
    }
    function well(x, y, w, h, k = 6) {
        cut(x, y, w, h, k); C.fillStyle = 'rgba(2,4,8,.5)'; C.fill(); C.lineWidth = 1; C.strokeStyle = 'rgba(0,0,0,.7)'; C.stroke();
        C.beginPath(); C.moveTo(x + k, y + h + .5); C.lineTo(x + w - 2, y + h + .5); C.strokeStyle = 'rgba(255,255,255,.08)'; C.stroke();
    }
    function gem(x, y, s, fill) { C.beginPath(); C.moveTo(x, y - s); C.lineTo(x + s, y); C.lineTo(x, y + s); C.lineTo(x - s, y); C.closePath(); C.fillStyle = fill; C.fill(); }
    function rule(x, y, w, a = 1) {
        const g = C.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, `rgba(220,230,244,${.35 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        C.fillStyle = g; C.fillRect(x, y, w, 1); C.fillStyle = rgba(acc, .5 * a); C.fillRect(x + w / 2 - 24, y - .5, 48, 2);
    }
    function brackets(x, y, w, h, s, col) {
        C.strokeStyle = col; C.lineWidth = 2; C.beginPath();
        [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, dx, dy]) => { C.moveTo(px + dx * s, py); C.lineTo(px, py); C.lineTo(px, py + dy * s); });
        C.stroke();
    }
    function glyph(kind, cx, cy, s, col) {
        C.strokeStyle = col; C.lineWidth = 2.4; C.lineCap = 'round'; C.lineJoin = 'round'; C.beginPath();
        if (kind === 'prev') { C.moveTo(cx + s * .35, cy - s * .65); C.lineTo(cx - s * .3, cy); C.lineTo(cx + s * .35, cy + s * .65); }
        else if (kind === 'next') { C.moveTo(cx - s * .35, cy - s * .65); C.lineTo(cx + s * .3, cy); C.lineTo(cx - s * .35, cy + s * .65); }
        else if (kind === 'down') { C.moveTo(cx - s * .55, cy - s * .3); C.lineTo(cx, cy + s * .3); C.lineTo(cx + s * .55, cy - s * .3); }
        else if (kind === 'plus') { C.moveTo(cx - s * .6, cy); C.lineTo(cx + s * .6, cy); C.moveTo(cx, cy - s * .6); C.lineTo(cx, cy + s * .6); }
        else if (kind === 'minus') { C.moveTo(cx - s * .6, cy); C.lineTo(cx + s * .6, cy); }
        else if (kind === 'refresh') {
            C.arc(cx, cy, s * .62, -Math.PI * .3, Math.PI * 1.35); const ax = cx + Math.cos(-Math.PI * .3) * s * .62, ay = cy + Math.sin(-Math.PI * .3) * s * .62;
            C.moveTo(ax + s * .42, ay - s * .03); C.lineTo(ax, ay); C.lineTo(ax + s * .1, ay + s * .41);
        }
        else if (kind === 'mail') { C.rect(cx - s * .72, cy - s * .5, s * 1.44, s); C.moveTo(cx - s * .72, cy - s * .5); C.lineTo(cx, cy + s * .1); C.lineTo(cx + s * .72, cy - s * .5); }
        C.stroke(); C.lineCap = 'butt';
    }
    function ring(key, x, y, w, h, k) {
        if (S.focus !== key) return;
        cut(x - 4, y - 4, w + 8, h + 8, k + 3); C.lineWidth = 2; C.strokeStyle = '#ffffff'; C.stroke();
        cut(x - 7, y - 7, w + 14, h + 14, k + 5); C.lineWidth = 1.5; C.strokeStyle = rgba(acc, .75); C.stroke();
    }

    // ── 버튼: 금속 테 + 광택. primary는 금색 구매 버튼.
    function btn(action, id, x, y, w, h, label, o = {}) {
        const off = !!o.disabled || !!S.busy, key = action + ':' + id, hov = live && !off && S.hover === key, k = Math.min(10, h / 4), col0 = o.color || acc;
        cut(x, y, w, h, k); const g = C.createLinearGradient(0, y, 0, y + h);
        if (o.primary && !off) { g.addColorStop(0, hov ? '#fff3cc' : '#ffe49c'); g.addColorStop(.48, hov ? '#f6c860' : '#eab043'); g.addColorStop(.52, '#cf8f24'); g.addColorStop(1, '#7d5012'); }
        else if (o.on) { g.addColorStop(0, rgba(col0, .58)); g.addColorStop(1, rgba(col0, .16)); }
        else if (off) { g.addColorStop(0, 'rgba(46,50,60,.84)'); g.addColorStop(1, 'rgba(22,24,30,.9)'); }
        else { g.addColorStop(0, hov ? 'rgba(70,80,100,.94)' : 'rgba(44,50,64,.9)'); g.addColorStop(1, hov ? 'rgba(28,32,44,.96)' : 'rgba(16,18,26,.94)'); }
        C.fillStyle = g; C.fill();
        C.lineWidth = o.on || hov ? 1.7 : 1.2;
        C.strokeStyle = o.primary && !off ? 'rgba(255,248,222,.92)' : o.on ? rgba(col0, .95) : hov ? 'rgba(242,248,255,.8)' : steel(x, y, w, h, off ? .4 : .9); C.stroke();
        if (!off) { C.save(); cut(x, y, w, h, k); C.clip(); C.fillStyle = 'rgba(255,255,255,.08)'; C.fillRect(x, y, w, h * .44); C.restore(); }
        if (o.on) { C.fillStyle = col0; C.fillRect(x + k, y + h - 3, w - k * 2, 2); }
        const col = o.primary ? (off ? 'rgba(226,220,206,.5)' : '#2b1904') : off ? 'rgba(222,228,238,.4)' : INK;
        if (o.glyph) glyph(o.glyph, x + w / 2, y + h / 2, Math.min(16, h * .36), col);
        else {
            const pl = o.mark ? 30 : 12, pr = o.trail ? 30 : 12, lw = w - pl - pr, f = fit(label, lw, h - 8, o.size || 15, 10, 700), left = o.align === 'left';
            para(f, left ? x + pl : x + pl + lw / 2, y + (h - f.lines.length * f.lh) / 2, col, left ? 'left' : 'center');
            if (o.mark) gem(x + 16, y + h / 2, o.on ? 5 : 3.5, off ? MUTE : col0);
            if (o.trail) glyph(o.trail, x + w - 17, y + h / 2, 10, col);
        }
        ring(key, x, y, w, h, k);
        if (live) A.hit(action, id, x, y, w, h, o.aria || label, off, !!o.pressed);
    }
    function pager(x, y, w, page, pages, prev, next) {
        if (pages <= 1) return;
        btn(prev, '', x, y, 44, 44, '이전 페이지', { glyph: 'prev', disabled: page <= 0 });
        btn(next, '', x + w - 44, y, 44, 44, '다음 페이지', { glyph: 'next', disabled: page >= pages - 1 });
        const mid = x + w / 2, pips = pages <= 10 && w >= 200;
        text(`${page + 1} / ${pages}`, mid, y + (pips ? 15 : 22), 14, INK, 'center', 700);
        if (pips) for (let i = 0; i < pages; i++) gem(mid + (i - (pages - 1) / 2) * 13, y + 33, i === page ? 4.5 : 2.5, i === page ? acc : 'rgba(255,255,255,.3)');
    }

    // ── 데이터 해석
    const tabs = () => (S.data && S.data.tabs || []).map(t => typeof t === 'string' ? { id: t, name: t } : { id: t.id ?? t.key ?? t.name, name: t.name ?? t.label ?? t.id });
    const tabName = () => { const t = tabs().find(t => t.id === S.tab); return t ? t.name : String(S.tab || ''); };
    function wallet() {
        const c = S.data && S.data.currencies; if (!c) return [];
        if (Array.isArray(c)) return c.map(v => ({ goods: v.goods ?? v.key ?? v.id, amount: v.amount ?? v.value ?? v.balance }));
        return Object.keys(c).map(k => ({ goods: k, amount: c[k] && typeof c[k] === 'object' ? c[k].amount ?? c[k].value ?? c[k].balance : c[k] }));
    }
    function materials() {
        if (Array.isArray(A.materials)) return A.materials.map(String);
        const shop = S.data && S.data.shop, src = Array.isArray(shop) ? shop : shop && (shop[S.tab] || shop.items), out = [];
        [].concat(Array.isArray(src) ? src : [], A.items || []).forEach(it => {
            const m = it && it.materialTab; if (m && !out.includes(m) && (it.tab == null || it.tab === S.tab)) out.push(m);
        });
        return out;
    }
    const curName = p => (p && p.name) || CUR[p && p.goods] || '';
    const reason = it => !it ? '' : it.owned ? '보유중' : it.soldOut ? '품절' : '';
    function buyState() {
        const it = A.item, cap = Math.max(0, Math.floor(Number(A.max)) || 0), unit = Number(it && it.price && it.price.amount) || 0, bal = Number(A.balance) || 0;
        const q = clamp(Math.floor(Number(S.qty)) || 1, 1, Math.max(1, cap)), cost = unit * q;
        const why = cap > 0 ? '' : reason(it) || (bal < unit ? '재화 부족' : '구매 불가');
        return { it, cap, q, cost, bal, after: bal - cost, why };
    }
    function price(p, x, cy, isz, sz, col, maxW) {
        if (!p) return 0; A.currency(p.goods, x, cy - isz / 2, isz, p);
        return isz + 6 + line(fmt(p.amount), x + isz + 6, cy, maxW ? maxW - isz - 6 : 1e4, sz, col, 'left', 800);
    }
    function priceW(p, isz, sz) { return p ? isz + 6 + tw(fmt(p.amount), sz, 800) : 0; }
    function artOf(d, x, y, w, h, dim) {
        C.save(); if (dim) { C.globalAlpha = .4; C.filter = 'grayscale(1)'; }
        A.art(d || {}, x, y, w, h); C.restore();
    }

    // 아이콘 + 금액. 폭이 모자라면 12px까지 줄이고, 그래도 모자라면 아이콘을 뺀다(숫자는 전부 표시).
    function amount(goods, value, x, cy, maxW, sz, col, al) {
        let s = sz; while (s > 12 && tw(value, s, 800) + s * 1.2 + 6 > maxW) s--;
        const isz = goods ? Math.round(s * 1.2) : 0, ic = isz && isz + 6 + tw(value, s, 800) <= maxW, tot = (ic ? isz + 6 : 0) + tw(value, s, 800);
        const lx = al === 'right' ? x - tot : al === 'center' ? x - tot / 2 : x;
        if (ic) A.currency(goods, lx, cy - isz / 2, isz);
        text(value, lx + (ic ? isz + 6 : 0), cy, s, col, 'left', 800); return tot;
    }
    // 이름표 + 금액 줄. 한 줄에 안 들어가면 금액을 다음 줄로 내린다.
    function ledger(rows, x, y, w, dry) {
        const list = rows.map(r => ({ ...r, one: tw(r.label, 13, 600) + 40 + tw(r.value, 13, 800) <= w - 20 })), h = list.reduce((s, r) => s + (r.one ? 30 : 48), 8);
        if (dry) return h;
        well(x, y, w, h); let ry = y + 4;
        list.forEach((r, i) => {
            if (i) { C.fillStyle = 'rgba(255,255,255,.08)'; C.fillRect(x + 10, ry, w - 20, 1); }
            text(r.label, x + 10, ry + (r.one ? 15 : 13), 13, DIM, 'left', 600);
            amount(r.goods, r.value, x + w - 10, ry + (r.one ? 15 : 34), r.one ? w - 32 - tw(r.label, 13, 600) : w - 20, 15, r.col || INK, 'right');
            ry += r.one ? 30 : 48;
        });
        return h;
    }

    // ── 상단: '상점' 표지와 보유 재화
    function purse(c, x, y, w, h, isz) {
        plate(x, y, w, h, 7, { a: .7, edge: .7 }); A.currency(c.goods, x + 7, y + (h - isz) / 2, isz);
        line(fmt(c.amount), x + w - 10, y + h / 2 + .5, w - isz - 22, h >= 36 ? 16 : 13, INK, 'right', 800, 12);
    }
    // 재화 판 묶음: 숫자 폭을 재서 한 줄 전체 열, 안 되면 2열, 아주 긴 값은 한 줄을 다 쓴다. 쓴 높이를 돌려준다.
    function purses(cs, x, y, w, h, isz) {
        if (!cs.length) return 0;
        const gap = 6, need = c => isz + 24 + tw(fmt(c.amount), 13, 800), cell = n => (w - gap * (n - 1)) / n;
        const cols = cs.every(c => need(c) <= cell(cs.length)) ? cs.length : Math.min(2, cs.length), cw = cell(cols);
        let col = 0, row = 0;
        cs.forEach(c => {
            const span = need(c) <= cw ? 1 : cols; if (col + span > cols) { col = 0; row++; }
            purse(c, x + col * (cw + gap), y + row * (h + gap), span * cw + (span - 1) * gap, h, isz);
            col += span; if (col >= cols) { col = 0; row++; }
        });
        return (row + (col ? 1 : 0)) * (h + gap) - gap;
    }
    function topBar(x, y, w, h) {
        const cy = y + h / 2, cs = wallet(); gem(x + 12, cy, 9, steel(x, y, 24, h)); gem(x + 12, cy, 5, acc);
        text('상점', x + 32, cy + 1, 24, INK, 'left', 800);
        let bh = h;
        if (cs.reduce((s, c) => s + 64 + tw(fmt(c.amount), 16, 800), 0) <= w - 110) {
            let px = x + w; [...cs].reverse().forEach(c => { const cw = 26 + 30 + tw(fmt(c.amount), 16, 800); px -= cw; purse(c, px, y + 4, cw, h - 8, 26); px -= 8; });
        } else bh = Math.max(h, purses(cs, x + 110, y + 4, w - 110, 30, 20) + 8);
        rule(x, y + bh + 6, w, .8); return bh;
    }

    // ── 분류 레일(데스크톱)
    function rail(x, y, w, h) {
        plate(x, y, w, h, 14, { a: .58 });
        const list = tabs(), bh = 48, gap = 6, fitN = Math.max(1, Math.floor((h - 16 + gap) / (bh + gap)));
        const more = list.length > fitN, show = more ? list.slice(0, fitN - 1) : list;
        show.forEach((t, i) => {
            const on = t.id === S.tab;
            btn('category', t.id, x + 8, y + 8 + i * (bh + gap), w - 16, bh, t.name, { on, pressed: on, color: hue(t.name), mark: true, align: 'left', aria: t.name });
        });
        if (more) btn('categories', '', x + 8, y + 8 + show.length * (bh + gap), w - 16, bh, '전체 분류', { trail: 'down' });
    }
    function chooser(x, y, w, h) {
        const n = tabName();
        btn('categories', '', x, y, w, h, S.market ? '' : n, { mark: !S.market, trail: 'down', align: 'left', color: acc, size: 16, aria: `분류 선택, 현재 ${n}` });
        if (S.market) {
            A.art({ iconUrl: '/static/assets/black-market/seal.webp' }, x + 7, y + 3, h - 6, h - 6);
            text(n, x + h + 10, y + h / 2, 16, INK, 'left', 700);
        }
    }
    function matButton(x, y, w, h) {
        const n = S.material || '재료';
        btn('materials', '', x, y, w, h, n, { trail: 'down', align: 'left', aria: `재료 선택${S.material ? ', 현재 ' + S.material : ''}` });
    }

    // ── 인벤토리 슬롯: 강철 소켓, 리벳, 선택 시 분류색 발광과 맥동 브래킷
    function slot(it, x, y, w, h, small) {
        const d = it.display || {}, id = it.shopId, key = 'product:' + id, on = S.selected === id, hov = live && !S.busy && S.hover === key, r = reason(it), k = 9;
        if (on) { C.save(); C.shadowColor = rgba(acc, .9); C.shadowBlur = 20; cut(x, y, w, h, k); C.fillStyle = rgba(acc, .3); C.fill(); C.restore(); }
        plate(x, y, w, h, k, { a: .84, edge: on || hov ? 1.35 : .85 });
        const pad = small ? 6 : 8, as = Math.max(34, Math.min(w - pad * 2 - 8, (h - 44) * (small ? .5 : .56))), wy = y + pad, wh = as + 8, cx = x + w / 2;
        cut(x + pad, wy, w - pad * 2, wh, 6);
        const g = C.createRadialGradient(cx, wy + wh / 2, 2, cx, wy + wh / 2, w * .6); g.addColorStop(0, rgba(acc, on ? .34 : hov ? .24 : .14)); g.addColorStop(1, 'rgba(0,0,0,.45)');
        C.fillStyle = g; C.fill(); C.strokeStyle = 'rgba(0,0,0,.7)'; C.lineWidth = 1; C.stroke();
        [[x + pad + 5, wy + 5], [x + w - pad - 5, wy + 5], [x + pad + 5, wy + wh - 5], [x + w - pad - 5, wy + wh - 5]].forEach(([rx, ry]) => { C.beginPath(); C.arc(rx, ry, 1.6, 0, 7); C.fillStyle = 'rgba(220,230,244,.45)'; C.fill(); });
        artOf(d, cx - as / 2, wy + 4, as, as, !!r);
        if (r) {
            const rw = tw(r, 12, 800) + 18; plate(cx - rw / 2, wy + wh - 26, rw, 22, 5, { a: .92, edge: .6 });
            text(r, cx, wy + wh - 15, 12, r === '품절' ? WARN : GOOD, 'center', 800);
        }
        const ny = wy + wh + 5, nh = y + h - 26 - ny, f = fit(d.name || '', w - 12, nh, small ? 13 : 14, 9, 700);
        para(f, cx, ny + (nh - f.lines.length * f.lh) / 2, r ? MUTE : INK, 'center');
        if (it.price) { const pw = Math.min(w - 12, priceW(it.price, 18, 14)); price(it.price, cx - pw / 2, y + h - 15, 18, 14, r ? MUTE : GOLD, w - 12); }
        if (on) { brackets(x - 3, y - 3, w + 6, h + 6, 12, acc); cut(x, y, w, h, k); C.lineWidth = 2; C.strokeStyle = rgba(acc, .9); C.stroke(); }
        ring(key, x, y, w, h, k);
        const label = [d.name, it.price ? `${fmt(it.price.amount)} ${curName(it.price)}` : '', r, on ? '선택됨' : ''].filter(Boolean).join(', ');
        if (live) A.hit('product', id, x, y, w, h, label, !!S.busy, on);
    }
    function grid(list, x, y, w, h, minW, minH, gap, cols, small) {
        cols = cols || Math.max(1, Math.floor((w + gap) / (minW + gap)));
        const rows = Math.max(1, Math.floor((h + gap) / (minH + gap))), per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per));
        S.perPage = per; S.page = clamp(Math.floor(S.page) || 0, 0, pages - 1);
        const cw = (w - gap * (cols - 1)) / cols, ch = Math.min(minH * 1.3, (h - gap * (rows - 1)) / rows), page = list.slice(S.page * per, S.page * per + per);
        if (!list.length) { text('상품이 없습니다', x + w / 2, y + h / 2, 15, DIM, 'center', 600); return 1; }
        for (let i = 0; i < per; i++) {
            const sx = x + (i % cols) * (cw + gap), sy = y + Math.floor(i / cols) * (ch + gap);
            if (page[i]) slot(page[i], sx, sy, cw, ch, small);
            else { well(sx, sy, cw, ch, 9); gem(sx + cw / 2, sy + ch / 2, 4, 'rgba(255,255,255,.08)'); }
        }
        return pages;
    }
    function inventory(x, y, w, h, o) {
        plate(x, y, w, h, 14, { a: .55 });
        const p = 14, mats = materials(); gem(x + p + 6, y + p + 22, 5, acc);
        const mw = mats.length ? Math.min(200, w * .42) : 0;
        line(tabName(), x + p + 20, y + p + 22, w - p * 2 - 28 - mw, 19, INK, 'left', 800);
        if (mw) matButton(x + w - p - mw, y + p, mw, 44);
        rule(x + p, y + p + 52, w - p * 2, .6);
        const top = y + p + 64, gh = y + h - p - 52 - top;
        const pages = grid(A.items || [], x + p, top, w - p * 2, gh, o.minW, o.minH, 10);
        pager(x + p, y + h - p - 44, w - p * 2, S.page, pages, 'previous', 'next');
    }

    // 정적인 전시 배경. 선택이나 구매 시 별도 입자·회전 효과를 만들지 않는다.
    function stage(x, y, w, h, it) {
        if (w <= 0 || h <= 0) return;
        well(x, y, w, h, 12);
        if (!it) return;
        const d = it.display || {}, size = Math.min(w * .78, h * .84);
        artOf(d, x + (w - size) / 2, y + (h - size) / 2, size, size, !!reason(it));
    }

    function tags(x, y, w, it, dry) {
        const list = (A.limits || []).map(l => ({ t: `${l.label} ${fmt(l.remaining)}/${fmt(l.limit)}`, c: Number(l.remaining) > 0 ? INK : WARN }));
        const r = reason(it); if (r) list.unshift({ t: r, c: r === '품절' ? WARN : GOOD });
        let tx = x, ty = y; if (!list.length) return 0;
        list.forEach(({ t, c }) => {
            const tl = Math.min(w, tw(t, 13, 700) + 20); if (tx > x && tx + tl > x + w) { tx = x; ty += 32; }
            if (!dry) { plate(tx, ty, tl, 26, 6, { a: .7, edge: .55 }); line(t, tx + tl / 2, ty + 13.5, tl - 14, 13, c, 'center', 700); }
            tx += tl + 6;
        });
        return ty - y + 26;
    }
    function info(x, y, w, nameH, it, sz, dry) {
        const d = it.display || {}, f = fit(d.name || '', w, nameH, sz, 12, 800), nh = f.lines.length * f.lh, bundle = (d.bundleContents || []).length;
        let cy = y; if (!dry) para(f, x, cy, INK, 'left'); cy += nh + 6;
        if (!dry) {
            if (it.price) price(it.price, x, cy + 22, 28, 24, reason(it) ? MUTE : GOLD, bundle ? w - 110 : w);
            if (bundle) btn('contents', '', x + w - 100, cy, 100, 44, '구성품', { aria: `${d.name} 구성품 보기` });
        }
        cy += 52; cy += tags(x, cy, w, it, dry);
        return cy - y;
    }
    // 영수증: 세 칸에 숫자가 들어가면 가로, 아니면 줄로 쌓는다. 높이를 돌려준다.
    function receipt(x, y, w, b, dry) {
        const p = b.it.price, g = p && p.goods, cw = w / 3;
        const rows = [{ label: '보유', value: fmt(b.bal), col: INK }, { label: '비용', value: fmt(b.cost), col: GOLD }, { label: '구매 후', value: fmt(b.after), col: b.after < 0 ? WARN : GOOD }];
        if (!rows.every(r => tw(r.value, 13, 800) <= cw - 36)) return ledger(rows.map(r => ({ ...r, goods: g })), x, y, w, dry);
        if (dry) return 48;
        well(x, y, w, 48);
        rows.forEach((r, i) => {
            const cx = x + cw * i; if (i) { C.fillStyle = 'rgba(255,255,255,.1)'; C.fillRect(cx, y + 8, 1, 32); }
            text(r.label, cx + 10, y + 13, 11, DIM, 'left', 600);
            if (p) A.currency(g, cx + 8, y + 24, 18, p);
            line(r.value, cx + 30, y + 33, cw - 36, 15, r.col, 'left', 800, 13);
        });
        return 48;
    }
    const purchaseH = w => 110 + receipt(0, 0, w, buyState(), true);
    function purchase(x, y, w) {
        const b = buyState(), d = b.it.display || {}, mw = 64, qx = x + 50, qw = w - mw - 106;
        btn('qty-minus', '', x, y, 44, 44, '수량 줄이기', { glyph: 'minus', disabled: b.cap <= 0 || b.q <= 1 });
        well(qx, y, qw, 44); text(fmt(b.q), qx + qw / 2, y + 17, 20, b.cap ? INK : MUTE, 'center', 800);
        line(`최대 ${fmt(b.cap)}`, qx + qw / 2, y + 35, qw - 8, 11, DIM, 'center', 600);
        ring('qty-value:', qx, y, qw, 44, 6);
        if (live) A.hit('qty-value', '', qx, y, qw, 44, '구매 수량', b.cap <= 0);
        btn('qty-plus', '', x + w - mw - 50, y, 44, 44, '수량 늘리기', { glyph: 'plus', disabled: b.q >= b.cap });
        btn('qty-max', '', x + w - mw, y, mw, 44, '최대', { disabled: b.cap <= 1 || b.q >= b.cap, aria: `최대 수량 ${fmt(b.cap)}` });
        const rh = receipt(x, y + 52, w, b), cn = curName(b.it.price);
        btn('buy', '', x, y + 60 + rh, w, 50,b.why || '구매', { primary: true, size: 18, disabled: !!b.why,
            aria: b.why ? `${d.name}, ${b.why}` : `${d.name} 수량 ${fmt(b.q)} 구매, 비용 ${fmt(b.cost)} ${cn}, 구매 후 ${fmt(b.after)} ${cn}` });
    }
    function hero(x, y, w, h, side) {
        plate(x, y, w, h, 18, { a: .48, tint: acc }); const it = A.item, p = 20;
        if (!it) { stage(x + 8, y + 8, w - 16, h - 16, null); text('상품을 선택하세요', x + w / 2, y + h * .4, 17, DIM, 'center', 600); return; }
        if (side) {
            const aw = Math.round(w * .42), ix = x + aw + 22, iw = w - aw - 22 - p, th = tags(ix, 0, iw, it, true), ph = purchaseH(iw);
            stage(x + 8, y + 8, aw, h - 16, it);
            info(ix, y + p, iw, h - p * 2 - ph - 12 - 58 - th, it, 26);
            purchase(ix, y + h - p - ph, iw);
        } else {
            const cw = (w - p * 2 - 24) / 2, ph = purchaseH(cw), ih = Math.max(ph, info(x + p, 0, cw, 104, it, 28, true)), sy = y + h - p - ih;
            stage(x + 8, y + 8, w - 16, sy - y - 22, it); rule(x + p, sy - 12, w - p * 2);
            info(x + p, sy, cw, 104, it, 28);
            purchase(x + p + cw + 24, sy + ih - ph, cw);
        }
    }

    // ── 화면 구성
    function desktop() {
        const m = 20, top = 24 + topBar(m, 10, W - m * 2, 48);
        const big = W >= 1700, railW = big ? 200 : 172, x0 = m + railW + 16, avail = W - x0 - m, invW = Math.round(avail * (big ? .45 : .44)), bh = H - top - m;
        rail(m, top, railW, bh);
        if (S.market) { marketMain(x0, top, avail, bh, 4); return; }
        hero(x0, top, avail - invW - 16, bh, false);
        inventory(x0 + avail - invW, top, invW, bh, { minW: big ? 150 : 136, minH: big ? 176 : 168 });
    }
    function tablet() {
        const m = 16; let y = 24 + topBar(m, 8, W - m * 2, 46);
        chooser(m, y, Math.min(320, W - m * 2), 48); y += 60;
        if (S.market) { marketMain(m, y, W - m * 2, H - y - m, 2); return; }
        const sh = clamp(Math.round(H * .42), 330, 440); hero(m, y, W - m * 2, sh, true); y += sh + 12;
        inventory(m, y, W - m * 2, H - y - m, { minW: 128, minH: 164 });
    }
    function mobileBrowse() {
        const m = 12, w = W - m * 2, cs = wallet(), mats = materials(); let y = 8;
        chooser(m, y, w, 44); y += 52;
        if (cs.length) y += purses(cs, m, y, w, 30, 20) + 8;
        if (mats.length) { matButton(m, y, w, 44); y += 52; }
        const cols = W < 640 ? 2 : Math.max(3, Math.floor(w / 180));
        const pages = grid(A.items || [], m, y, w, H - y - 60, 0, 134, 8, cols, true);
        pager(m, H - 52, w, S.page, pages, 'previous', 'next');
    }
    function mobileDetail() {
        const m = 12, w = W - m * 2, it = A.item;
        btn('back', '', m, 8, 44, 44, '목록으로', { glyph: 'prev' });
        line(tabName(), m + 56, 30, w - 56, 16, DIM, 'left', 700);
        const nameH = Math.min(70, Math.round(H * .12)), ih = info(m, 0, w, nameH, it, 20, true);
        const by = H - 8 - purchaseH(w), iy = by - 10 - ih, ah = iy - 8 - 60;
        if (ah >= 70) stage(m, 60, w, ah, it);
        else if (ah > 0) well(m, 60, w, ah);
        info(m, iy, w, nameH, it, 20); purchase(m, by, w);
    }

    // ── 겹창
    function modal(title, w, h) {
        C.fillStyle = 'rgba(3,5,9,.66)'; C.fillRect(0, 0, W, H);
        w = Math.min(W - 24, w); h = Math.min(H - 24, h); const x = (W - w) / 2, y = (H - h) / 2;
        plate(x, y, w, h, 18, { a: .93, tint: acc });
        if (S.market) {
            // Original seal stamp: overshoot, settle, then stay still.
            const p = A.reduced || !S.market.dialog ? 1 : clamp((A.time - S.marketDialogAt - 120) / 600, 0, 1);
            const scale = p < .6 ? 1.7 - p / .6 * .76 : .94 + (p - .6) / .4 * .06;
            const angle = (p < .6 ? -24 + p / .6 * 28 : 4 - (p - .6) / .4 * 4) * Math.PI / 180;
            C.save(); C.translate(x + 31, y + 30); C.rotate(angle); C.scale(scale, scale); C.globalAlpha = Math.min(1, p / .6);
            A.art({ iconUrl: '/static/assets/black-market/seal.webp' }, -19, -19, 38, 38); C.restore();
        }
        else gem(x + 24, y + 30, 5, acc);
        const tx = S.market ? 56 : 38;
        line(title, x + tx, y + 30, w - tx - 22, 19, INK, 'left', 800); rule(x + 20, y + 54, w - 40);
        return { x, y, w, h };
    }
    function entries(list, x, y, w, h, cols) {
        const gap = 8, rh = 68, rows = Math.max(1, Math.floor((h + gap) / (rh + gap))), per = rows * cols, pages = Math.max(1, Math.ceil(list.length / per));
        S.detailPages = pages; S.detailPage = clamp(Math.floor(S.detailPage) || 0, 0, pages - 1);
        const cw = (w - gap * (cols - 1)) / cols;
        list.slice(S.detailPage * per, S.detailPage * per + per).forEach((e, i) => {
            const ex = x + (i % cols) * (cw + gap), ey = y + Math.floor(i / cols) * (rh + gap), sub = e.label && e.label !== e.name ? e.label : '';
            well(ex, ey, cw, rh); const g = C.createRadialGradient(ex + rh / 2, ey + rh / 2, 2, ex + rh / 2, ey + rh / 2, rh * .6); g.addColorStop(0, rgba(acc, .25)); g.addColorStop(1, rgba(acc, 0));
            C.fillStyle = g; C.fillRect(ex, ey, rh, rh); A.art(e, ex + 7, ey + 7, rh - 14, rh - 14);
            const count = e.count == null ? '' : String(e.count);
            const label = (e.name || '') + (count && count !== '1' ? ' x' + (Number.isFinite(Number(count)) ? fmt(count) : count) : '');
            const tx = ex + rh + 4, tww = cw - rh - 12, f = fit(label, tww, rh - 10 - (sub ? 16 : 0), 15, 11, 700), tot = f.lines.length * f.lh + (sub ? 16 : 0), ty = ey + (rh - tot) / 2;
            para(f, tx, ty, INK, 'left'); if (sub) line(sub, tx, ty + f.lines.length * f.lh + 8, tww, 12, DIM, 'left', 600);
        });
        return pages;
    }
    function listView(title, list, closeAct, head) {
        const w = Math.min(W - 24, 640), cols = w >= 540 ? 2 : 1, hh = head ? head.h : 0;
        const need = 64 + hh + Math.ceil(Math.max(1, list.length) / cols) * 76 + 60 + 62, M = modal(title, w, Math.min(need, 680)), p = 18;
        if (head) head.draw(M.x + p, M.y + 64, M.w - p * 2);
        const ly = M.y + 66 + hh, foot = 60 + 54;
        const pages = entries(list, M.x + p, ly, M.w - p * 2, M.y + M.h - foot - ly, cols);
        pager(M.x + p, M.y + M.h - 112, M.w - p * 2, S.detailPage, pages, 'content-previous', 'content-next');
        btn(closeAct, '', M.x + p, M.y + M.h - 62, M.w - p * 2, 48, closeAct === 'success-close' ? '확인' : '닫기', { primary: closeAct === 'success-close' });
    }
    function confirmView() {
        const b = buyState(); if (!b.it) return;
        const d = b.it.display || {}, w = Math.min(W - 24, 520), iw = w - 36, as = Math.min(96, iw * .28), nw = iw - as - 16, cn = curName(b.it.price);
        const f = fit(d.name || '', nw, 120, 20, 12, 800), bh = Math.max(as, f.lines.length * f.lh + 30), rh = receipt(0, 0, iw, b, true);
        const M = modal('구매 확인', w, 64 + bh + 16 + rh + 16 + 50 + 18), x = M.x + 18;
        let y = M.y + 66; well(x, y, as, as); A.art(d, x + 4, y + 4, as - 8, as - 8);
        const ty = y + (bh - f.lines.length * f.lh - 30) / 2; para(f, x + as + 16, ty, INK, 'left');
        text(`수량 ${fmt(b.q)}`, x + as + 16, ty + f.lines.length * f.lh + 15, 15, acc, 'left', 700);
        y += bh + 16; receipt(x, y, iw, b); y += rh + 16;
        const cw = Math.round(iw * .36);
        btn('cancel', '', x, y, cw, 50, '취소');
        btn('confirm', '', x + cw + 10, y, iw - cw - 10, 50, S.busy ? '구매 중' : '구매', { primary: true, size: 18, disabled: !!b.why,
            aria: `${d.name} 수량 ${fmt(b.q)} 구매 확정, 비용 ${fmt(b.cost)} ${cn}, 구매 후 ${fmt(b.after)} ${cn}` });
    }
    function successView() {
        const sc = S.success || {}, rw = sc.rewards || [];
        listView('구매 완료', rw, 'success-close', { h: 64, draw: (x, y, w) => {
            const f = fit(sc.name || '', w, 40, 18, 11, 800); para(f, x, y, INK, 'left');
            if (sc.count) text(`수량 ${fmt(sc.count)}`, x, y + f.lines.length * f.lh + 12, 14, GOLD, 'left', 700);
        } });
    }
    function pickView(title, items, action, cur) {
        const w = Math.min(W - 24, 680), cols = w >= 560 ? 3 : 2, bh = 48, gap = 8, iw = w - 36, rows = Math.ceil(items.length / cols);
        const M = modal(title, w, 64 + rows * (bh + gap) + 10 + 48 + 20), cw = (iw - gap * (cols - 1)) / cols;
        const rh = Math.max(44, Math.min(bh, (M.h - 64 - 78) / Math.max(1, rows) - gap));
        items.forEach((t, i) => {
            const on = t.id === cur;
            btn(action, t.id, M.x + 18 + (i % cols) * (cw + gap), M.y + 66 + Math.floor(i / cols) * (rh + gap), cw, rh, t.name, { on, pressed: on, color: hue(t.name), mark: action === 'category', align: 'left' });
        });
        btn('back', '', M.x + 18, M.y + M.h - 62, iw, 48, '닫기');
    }
    function messageView(msg = S.message, act = 'back', col = INK) {
        const w = Math.min(W - 24, 460), f = fit(msg, w - 40, 240, 16, 11, 600), M = modal('알림', w, 64 + f.lines.length * f.lh + 20 + 48 + 20);
        para(f, M.x + 20, M.y + 68, col, 'left');
        btn(act, '', M.x + 18, M.y + M.h - 62, M.w - 36, 48, '확인');
    }

    // ── 암시장: 같은 판·레일·분류 선택 위에 네 구역 입찰판, 선택 물품 입찰대, 확인·결과·규칙 겹창
    const SECT = ['card-garnet', 'card-gold', 'item-garnet', 'item-gold'], TRIM = { gold: '#f1c463', garnet: '#b98aff' }, KIND = { card: '카드', item: '아이템' };
    const RULES = ['새 물품은 매일 09:00과 21:00에 열립니다.', '입찰은 08:50과 20:50에 마감하고, 09:00과 21:00까지 정산합니다.',
        '입찰은 비공개입니다. 다른 사람의 입찰은 보이지 않습니다.', '입찰 금액은 입찰하는 즉시 보관됩니다.', '낙찰되지 않거나 입찰을 취소하면 보관금을 돌려받습니다.',
        '마감 전까지 금액을 바꾸거나 입찰을 취소할 수 있습니다.', '같은 금액이면 먼저 입찰한 사람이 낙찰됩니다.', '낙찰 보상은 우편으로 받습니다.'];
    const lotOf = (sec, list) => (list || (S.market.data && S.market.data.lots) || []).find(l => l.sector === sec);
    const locked = () => !!(S.market.closed || S.market.busy || S.market.uncertain);
    const lotName = l => (l.display && l.display.name) || '';
    const lotTag = l => `${KIND[l.kind] || ''} ${CUR[l.currency] || ''} 입찰`;
    const digits = v => /^\d+$/.test(v) ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : v;
    function flourish(sector) {
        if (A.reduced || !S.marketFlourish || S.marketFlourish.sector !== sector) return 0;
        const p = clamp((A.time - S.marketFlourish.at) / 1200, 0, 1);
        return p < .3 ? p / .3 : (1 - p) / .7;
    }
    function artBox(d, x, y, w, h, tc, hot, sector) {
        const cx = x + w / 2, glow = flourish(sector), showcase = !!sector;
        C.save(); cut(x, y, w, h, 6); C.clip();
        const shade = C.createLinearGradient(0, y, 0, y + h);
        shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(.6, 'rgba(0,0,0,.15)'); shade.addColorStop(1, 'rgba(0,0,0,.5)');
        C.fillStyle = shade; C.fillRect(x, y, w, h);
        if (showcase) {
            // Original .bm-display beam: narrow at the pedestal, widening upwards.
            const bw = w * .78, base = y + h * .92;
            const beam = C.createLinearGradient(0, base, 0, y);
            beam.addColorStop(0, rgba(tc, (hot ? .26 : .14) + glow * .12)); beam.addColorStop(.4, rgba(tc, hot ? .10 : .05)); beam.addColorStop(1, rgba(tc, 0));
            C.beginPath(); C.moveTo(cx - bw * .2, base); C.lineTo(cx + bw * .2, base); C.lineTo(cx + bw / 2, y); C.lineTo(cx - bw / 2, y); C.closePath(); C.fillStyle = beam; C.fill();
            // The original fixed bronze disc and luminous top face, without rotation.
            const ph = h * .15, py = y + h * .82;
            const bronze = C.createLinearGradient(0, py + ph * .18, 0, py + ph);
            bronze.addColorStop(0, '#d9b878'); bronze.addColorStop(.35, '#6d4c24'); bronze.addColorStop(.7, '#2a1b0d'); bronze.addColorStop(1, '#120b05');
            C.beginPath(); C.ellipse(cx, py + ph * .59, bw / 2, ph * .41, 0, 0, Math.PI * 2); C.fillStyle = bronze;
            C.shadowColor = 'rgba(0,0,0,.75)'; C.shadowBlur = 18; C.shadowOffsetY = 8; C.fill(); C.shadowOffsetY = 0;
            C.save(); C.translate(cx, py + ph * .28); C.scale(bw * .42, ph * .28);
            const face = C.createRadialGradient(0, 0, 0, 0, 0, 1);
            face.addColorStop(0, tc === TRIM.gold ? '#ffe8ad' : '#e4ccff'); face.addColorStop(.3, tc); face.addColorStop(.55, rgba(tc, .28)); face.addColorStop(1, rgba(tc, 0));
            C.fillStyle = face; C.shadowColor = rgba(tc, .4); C.shadowBlur = 26; C.globalAlpha = .9 + glow * .1; C.filter = `brightness(${1 + glow * .8})`;
            C.beginPath(); C.arc(0, 0, 1, 0, Math.PI * 2); C.fill(); C.restore();
        }
        const card = !!d?.imageUrl, aw = showcase ? (card ? w * .84 : Math.min(w * .62, h * .78)) : w - 12;
        const ah = showcase && card ? h * .84 : Math.min(aw, h - 12), ay = showcase ? (card ? y + h * .05 : y + h * .44 - ah / 2) : y + (h - ah) / 2;
        C.shadowColor = 'rgba(0,0,0,.7)'; C.shadowBlur = 12; C.shadowOffsetY = 10;
        if (showcase && S.market.closed) C.filter = 'saturate(.7) brightness(.85)';
        if (aw > 8 && ah > 8) A.art(d || {}, cx - aw / 2, ay - (hot && !A.reduced ? 4 : 0), aw, ah);
        C.filter = 'none'; C.shadowOffsetY = 0;
        if (showcase && S.market.closed) {
            const ss = Math.min(w * .38, h * .4); C.translate(x + w * .94 - ss / 2, y + h * .06 + ss / 2); C.rotate(-14 * Math.PI / 180);
            A.art({ iconUrl: '/static/assets/black-market/seal.webp' }, -ss / 2, -ss / 2, ss, ss);
        }
        C.restore();
    }
    function lotCard(sec, x, y, w, h, small) {
        const M = S.market, l = lotOf(sec), key = 'market-select:' + sec, k = 9;
        if (!l) { well(x, y, w, h, k); text(M.data ? '물품 없음' : '불러오는 중', x + w / 2, y + h / 2, 13, MUTE, 'center', 600); return; }
        const on = M.selected === sec, hov = live && !S.busy && S.hover === key, tc = TRIM[l.currency] || acc, d = l.display || {}, cx = x + w / 2;
        const glow = flourish(sec); C.save(); C.translate(cx, y + h / 2); C.scale(1 + glow * .025, 1 + glow * .025); C.translate(-cx, -y - h / 2);
        if (on) { C.save(); C.shadowColor = rgba(acc, .9); C.shadowBlur = 20; cut(x, y, w, h, k); C.fillStyle = rgba(acc, .3); C.fill(); C.restore(); }
        plate(x, y, w, h, k, { a: .84, edge: on || hov ? 1.35 : .85, tint: tc });
        // 작은 칸은 종류와 재화를 그림 칸 위 모서리에 얹어 그림을 키운다.
        const pad = small ? 6 : 10, ts = small ? 11 : 13, is = small ? 14 : 18, ty = y + pad + (small ? 10 : 12), cn = CUR[l.currency] || '';
        const bid = l.myBid ? fmt(l.myBid.amount) : '', stacked = !small && bid && tw(bid, 13, 800) + 24 > w - pad * 2 - 86;
        const fh = small ? 18 : stacked ? 52 : 34, fy = y + h - pad - fh, f = fit(d.name || '', w - pad * 2 - 4, small ? 30 : 46, small ? 13 : 16, small ? 10 : 11, 700), nh = f.lines.length * f.lh;
        const ny = fy - (small ? 2 : 6) - nh, ay = small ? y + pad : ty + 16;
        if (ny - 4 - ay > 16) artBox(d, x + pad, ay, w - pad * 2, ny - 4 - ay, tc, hov, sec);
        text(KIND[l.kind] || '', x + pad + 5, ty, ts, small ? INK : DIM, 'left', 700);
        const cw = tw(cn, ts, 800); text(cn, x + w - pad - 5, ty, ts, tc, 'right', 800); A.currency(l.currency, x + w - pad - 9 - cw - is, ty - is / 2, is);
        para(f, cx, ny, INK, 'center');
        if (small) { if (bid) amount(l.currency, bid, cx, fy + fh / 2, w - pad * 2, 13, GOLD, 'center'); else text('미입찰', cx, fy + fh / 2, 12, MUTE, 'center', 700); }
        else {
            well(x + pad, fy, w - pad * 2, fh, 6); text('내 보관금', x + pad + 10, fy + (stacked ? 13 : fh / 2), 12, DIM, 'left', 600);
            if (bid) amount(l.currency, bid, x + w - pad - 10, fy + (stacked ? 36 : fh / 2), w - pad * 2 - (stacked ? 20 : 86), 15, GOLD, 'right'); else text('미입찰', x + w - pad - 10, fy + fh / 2, 13, MUTE, 'right', 700);
        }
        if (on) { brackets(x - 3, y - 3, w + 6, h + 6, 12, acc); cut(x, y, w, h, k); C.lineWidth = 2; C.strokeStyle = rgba(acc, .9); C.stroke(); }
        if (glow) { cut(x, y, w, h, k); C.lineWidth = 1; C.strokeStyle = rgba(tc, glow); C.shadowColor = rgba(tc, glow); C.shadowBlur = 28; C.stroke(); }
        ring(key, x, y, w, h, k);
        C.restore();
        if (live) A.hit('market-select', sec, x, y, w, h, [lotName(l), lotTag(l), bid ? `내 보관금 ${bid} ${cn}` : '미입찰', on ? '선택됨' : ''].filter(Boolean).join(', '), !!S.busy, on);
    }
    function board(x, y, w, h, cols, small) {
        const gap = small ? 8 : 14;
        if (cols === 4) {
            const mid = 28, cw = (w - gap * 2 - mid) / 4;
            [['오늘의 카드', x], ['오늘의 아이템', x + cw * 2 + gap + mid]].forEach(([t, gx]) => { gem(gx + 6, y + 12, 4, acc); text(t, gx + 18, y + 12, 16, INK, 'left', 800); });
            C.fillStyle = 'rgba(255,255,255,.1)'; C.fillRect(x + cw * 2 + gap + mid / 2, y + 4, 1, h - 8);
            SECT.forEach((s, i) => lotCard(s, x + i * cw + (i > 0 ? gap : 0) + (i > 1 ? mid : 0) + (i > 2 ? gap : 0), y + 30, cw, h - 30));
            return;
        }
        const lh = small ? 0 : 28, rh = (h - gap) / 2, cw = (w - gap) / 2;
        ['오늘의 카드', '오늘의 아이템'].forEach((t, r) => {
            const ry = y + r * (rh + gap); if (lh) { gem(x + 6, ry + 11, 4, acc); text(t, x + 18, ry + 11, 15, INK, 'left', 800); }
            [0, 1].forEach(c => lotCard(SECT[r * 2 + c], x + c * (cw + gap), ry + lh, cw, rh - lh, small));
        });
    }
    function clock(x, y, al, sz) {
        const M = S.market, st = M.status || '', dot = st === '정산 중' ? WARN : GOOD, sw = tw(st, 12, 700) + 14;
        const sx = al === 'center' ? x - sw / 2 : al === 'right' ? x - sw : x;
        C.save(); C.globalAlpha = A.reduced || M.closed ? 1 : .725 + .275 * Math.cos(A.time / 1800 * Math.PI * 2);
        gem(sx + 4, y + 7, 3.5, dot); C.restore(); text(st, sx + 14, y + 7, 12, dot, 'left', 700);
        text(M.countdown || '', x, y + 14 + sz * .6, sz, INK, al, 800);
        line(M.clockNote || '', x, y + 22 + sz * 1.2, 220, 12, DIM, al, 600, 11);
    }
    function tools(x, y) {
        const M = S.market;
        btn('market-refresh', '', x, y, 44, 44, '새로고침', { glyph: 'refresh', disabled: !!M.fetching });
        btn('market-mail', '', x + 50, y, 44, 44, '보상 우편함', { glyph: 'mail' });
    }
    function balanceRows(l) {
        const b = S.market.data && S.market.data.balances, cur = l.currency;
        return [{ label: '보유 ' + (CUR[cur] || ''), goods: cur, value: fmt(b && b[cur]), col: INK },
            { label: '내 보관금', goods: l.myBid ? cur : '', value: l.myBid ? fmt(l.myBid.amount) : '미입찰', col: l.myBid ? GOLD : MUTE }];
    }
    function amountField(l, x, y, w, h) {
        const M = S.market, v = String((M.drafts || {})[l.sector] ?? ''), off = locked() || !!S.busy, key = 'market-amount:' + l.sector, isz = 22;
        well(x, y, w, h, 8); cut(x, y, w, h, 8); C.lineWidth = 1.2; C.strokeStyle = steel(x, y, w, h, off ? .35 : .8); C.stroke();
        A.currency(l.currency, x + w - 12 - isz, y + (h - isz) / 2, isz);
        if (v) line(digits(v), x + w - isz - 22, y + h / 2 + 1, w - isz - 36, 20, off ? MUTE : INK, 'right', 800, 12);
        else text('금액 입력', x + w - isz - 22, y + h / 2 + 1, 16, MUTE, 'right', 600);
        ring(key, x, y, w, h, 8);
        if (live) A.hit('market-amount', l.sector, x, y, w, h, `${lotName(l)} ${CUR[l.currency] || ''} 입찰 금액`, off);
    }
    function bidActions(l, x, y, w, h) {
        const M = S.market, cw = l.myBid ? Math.round(Math.min(130, w * .36)) : 0, lab = M.closed ? '입찰 마감' : l.myBid ? '금액 변경' : '입찰하기';
        if (cw) btn('market-cancel', l.sector, x, y, cw, h, '입찰 취소', { disabled: locked(), aria: `${lotName(l)} 입찰 취소` });
        btn('market-bid', l.sector, x + (cw && cw + 8), y, w - (cw && cw + 8), h, lab, { primary: true, size: 17, disabled: locked(), aria: `${lotName(l)} ${CUR[l.currency] || ''} ${lab}` });
    }
    function lotHead(l, x, y, w, h, sz) {
        const f = fit(lotName(l), w, h - 22, sz, 12, 800), M = S.market, ty = y + (h - f.lines.length * f.lh - 22) / 2;
        para(f, x, ty, INK, 'left');
        const note = M.uncertain ? '처리 결과를 확인하지 못했습니다. 새로고침하세요.' : lotTag(l);
        line(note, x, ty + f.lines.length * f.lh + 12, w, 13, M.uncertain ? WARN : TRIM[l.currency] || acc, 'left', 700, 11);
    }
    // 선택 물품 입찰대: 넓으면 한 줄, 좁으면 정보 줄 아래 입력 줄. 높이를 돌려준다.
    function bidConsole(x, y, w, dry) {
        const l = lotOf(S.market.selected), one = w >= 1000, lw = one ? Math.min(340, w * .28) : Math.min(360, w * .5);
        const rowH = Math.max(64, l ? ledger(balanceRows(l), 0, 0, lw, true) : 0), h = rowH + 28 + (one ? 0 : 56);
        if (dry) return h;
        plate(x, y, w, h, 14, { a: .72, tint: acc });
        if (!l) { text(S.market.data ? '물품을 선택하세요' : '불러오는 중', x + w / 2, y + h / 2, 15, DIM, 'center', 600); return h; }
        const p = 14, ix = x + p, iy = y + p, ctl = one ? Math.min(560, w * .46) : 0, as = 64, lx = x + w - p - ctl - (ctl && 16) - lw;
        artBox(l.display, ix, iy + (rowH - as) / 2, as, as, TRIM[l.currency] || acc, true);
        lotHead(l, ix + as + 12, iy, lx - 16 - ix - as - 12, rowH, 18);
        ledger(balanceRows(l), lx, iy + (rowH - ledger(balanceRows(l), 0, 0, lw, true)) / 2, lw);
        const fy = one ? iy + (rowH - 48) / 2 : iy + rowH + 8, fx = one ? x + w - p - ctl : ix, fw = (one ? ctl : w - p * 2) * .5;
        amountField(l, fx, fy, fw, 48); bidActions(l, fx + fw + 10, fy, (one ? ctl : w - p * 2) - fw - 10, 48);
        return h;
    }
    function marketMain(x, y, w, h, cols) {
        plate(x, y, w, h, 18, { a: .5, tint: acc }); const p = 16, iw = w - p * 2, cy = y + 42;
        A.art({ iconUrl: '/static/assets/black-market/seal.webp' }, x + p, cy - 25, 50, 50);
        text('암시장', x + p + 58, cy + 1, 24, INK, 'left', 800);
        let rx = x + w - p - 94; tools(rx, cy - 22);
        btn('market-rules', '', rx -= 112, cy - 22, 104, 44, '거래 규칙'); btn('market-results', '', rx -= 112, cy - 22, 104, 44, '지난 결과');
        clock(clamp(x + w / 2, x + p + 250, rx - 120), y + 10, 'center', 28);
        rule(x + p, y + 84, iw, .7);
        const ch = bidConsole(0, 0, iw, true), by = y + h - p - ch;
        board(x + p, y + 98, iw, by - 14 - y - 98, cols);
        bidConsole(x + p, by, iw);
    }
    function mobileMarket() {
        const m = 12, w = W - m * 2, M = S.market, l = M.mode === 'detail' && lotOf(M.selected);
        if (l) return marketDetail(l);
        let y = 8; chooser(m, y, w, 44); y += 52;
        const b = M.data && M.data.balances; if (b) y += purses(['garnet', 'gold'].map(g => ({ goods: g, amount: b[g] })), m, y, w, 30, 20) + 8;
        plate(m, y, w, 56, 10, { a: .72, tint: acc }); clock(m + 12, y + 4, 'left', 19); tools(m + w - 94, y + 6); y += 64;
        const fy = H - 52, hw = (w - 8) / 2;
        board(m, y, w, fy - 8 - y, 2, true);
        btn('market-results', '', m, fy, hw, 44, '지난 결과'); btn('market-rules', '', m + hw + 8, fy, hw, 44, '거래 규칙');
    }
    function marketDetail(l) {
        const m = 12, w = W - m * 2, M = S.market, rows = balanceRows(l);
        btn('market-back', '', m, 8, 44, 44, '목록으로', { glyph: 'prev' });
        text(M.countdown || '', m + w, 20, 18, INK, 'right', 800); line(M.clockNote || '', m + w, 41, w - 150, 12, DIM, 'right', 600, 11);
        const st = M.status || ''; gem(m + 60, 30, 3.5, st === '정산 중' ? WARN : GOOD); line(st, m + 70, 30, w - 230, 13, DIM, 'left', 700, 11);
        const nameH = Math.min(78, Math.round(H * .14)), lh = ledger(rows, 0, 0, w, true), bottom = nameH + 22 + 8 + lh + 8 + 48 + 8 + 50;
        let y = H - 8 - bottom; const sh = y - 8 - 60;
        if (sh >= 70) artBox(l.display, m, 60, w, sh, TRIM[l.currency] || acc, false, l.sector); else if (sh > 0) well(m, 60, w, sh);
        lotHead(l, m, y, w, nameH + 22, 20); y += nameH + 30;
        ledger(rows, m, y, w); y += lh + 8;
        amountField(l, m, y, w, 48); y += 56;
        bidActions(l, m, y, w, 50);
    }
    function bidConfirm() {
        const M = S.market, dg = M.dialog, l = dg.lot || lotOf(M.selected) || {}, d = l.display || {}, cur = l.currency, ct = dg.contract;
        const tag = typeof ct === 'string' ? ct : String(ct && (ct.action || ct.type || ct.kind) || ''), cancel = /cancel|취소/.test(tag) || Number(dg.amount) === 0, delta = Number(dg.delta) || 0;
        const rows = [{ label: '현재 보관금', goods: cur, value: fmt(dg.current) }, { label: '변경 후 입찰금', goods: cur, value: fmt(dg.amount), col: GOLD },
            { label: delta < 0 ? '즉시 돌려받을 금액' : '추가로 맡길 금액', goods: cur, value: fmt(Math.abs(delta)), col: delta < 0 ? GOOD : INK },
            { label: '변경 후 보유 재화', goods: cur, value: fmt(dg.after), col: Number(dg.after) < 0 ? WARN : INK }];
        const note = cancel ? '취소하면 보관금을 즉시 돌려받습니다.' : '입찰 금액은 즉시 보관되고, 낙찰되지 않으면 돌려받습니다. 같은 금액이면 먼저 입찰한 사람이 낙찰됩니다.';
        const w = Math.min(W - 24, 520), iw = w - 36, as = Math.min(72, iw * .22), f = fit(lotName(l), iw - as - 14, 72, 19, 12, 800), bh = Math.max(as, f.lines.length * f.lh + 24);
        const lh = ledger(rows, 0, 0, iw, true), fixed = 66 + bh + 12 + lh + 12 + 14 + 50 + 18, nf = fit(note, iw, Math.max(16, Math.min(H - 24, 760) - fixed), 13, 10, 600);
        const MD = modal(cancel ? '입찰 취소 확인' : '입찰 확인', w, fixed + nf.lines.length * nf.lh), x = MD.x + 18, lab = S.busy || M.busy ? '처리 중' : cancel ? '취소하고 반환' : '입찰 확정';
        let y = MD.y + 66; artBox(d, x, y + (bh - as) / 2, as, as, TRIM[cur] || acc, true);
        const ty = y + (bh - f.lines.length * f.lh - 24) / 2; para(f, x + as + 14, ty, INK, 'left');
        line(lotTag(l), x + as + 14, ty + f.lines.length * f.lh + 12, iw - as - 14, 13, TRIM[cur] || acc, 'left', 700, 11);
        y += bh + 12; ledger(rows, x, y, iw); y += lh + 12;
        para(nf, x, y, DIM, 'left'); y += nf.lines.length * nf.lh + 14;
        const cw = Math.round(iw * .36); btn('market-back', '', x, y, cw, 50, '돌아가기');
        btn('market-confirm', '', x + cw + 10, y, iw - cw - 10, 50, lab, { primary: true, size: 18, aria: `${lotName(l)} ${CUR[cur] || ''} ${lab}, 변경 후 입찰금 ${fmt(dg.amount)}, 변경 후 보유 재화 ${fmt(dg.after)}` });
    }
    function resultEntry(l, x, y, w, h) {
        const d = l.display || {}, tc = TRIM[l.currency] || acc, win = l.winner, big = h >= 140, as = big ? h - 20 : Math.min(h - 20, 76), tx = x + as + 24, iw = x + w - 14 - tx;
        plate(x, y, w, h, 10, { a: .8, edge: .8, tint: tc }); artBox(d, x + 10, y + (h - as) / 2, as, as, tc, !!win);
        line(lotTag(l).replace(/ 입찰$/, ''), tx, y + 18, iw, 12, tc, 'left', 700, 11);
        const nh = big ? 52 : 38, f = fit(d.name || '', iw, nh, big ? 18 : 15, 11, 800); para(f, tx, y + 28 + (nh - f.lines.length * f.lh) / 2, INK, 'left');
        if (!win) { text('낙찰자 없음', tx, y + h - 26, 14, MUTE, 'left', 700); return; }
        line(`낙찰 ${win.name || ''}`, tx, y + h - (big ? 48 : 38), iw, 14, INK, 'left', 700, 11);
        amount(l.currency, fmt(win.amount), tx, y + h - (big ? 22 : 16), iw, big ? 20 : 16, GOLD);
    }
    function resultsView() {
        const M = S.market, pv = M.data && M.data.previous, list = pv ? SECT.map(s => lotOf(s, pv.lots || [])).filter(Boolean) : [];
        const w = Math.min(W - 24, 1040), cols = w >= 760 ? 2 : 1, rh = cols === 2 ? 150 : 116, gap = 10, iw = w - 36, sub = pv ? [pv.date, pv.round == null ? '' : String(pv.round).padStart(2, '0') + ':00 회차'].filter(Boolean).join(' ') : '';
        const head = 66 + (sub ? 28 : 0), need = head + Math.max(1, Math.ceil(list.length / cols)) * (rh + gap) + 62 + 8, MD = modal('지난 결과', w, need);
        if (sub) line(sub, MD.x + 20, MD.y + 78, iw, 14, DIM, 'left', 600, 11);
        let rows = Math.max(1, Math.floor((MD.h - head - 70 + gap) / (rh + gap)));
        if (rows * cols < list.length) rows = Math.max(1, Math.floor((MD.h - head - 70 - 52 + gap) / (rh + gap)));
        const per = rows * cols, pages = Math.max(1, Math.ceil(list.length / per)), cw = (iw - gap * (cols - 1)) / cols;
        M.resultPages = pages; M.resultPage = clamp(Math.floor(M.resultPage) || 0, 0, pages - 1);
        if (!list.length) text('지난 결과가 없습니다', MD.x + w / 2, MD.y + head + 30, 15, DIM, 'center', 600);
        list.slice(M.resultPage * per, M.resultPage * per + per).forEach((l, i) => resultEntry(l, MD.x + 18 + (i % cols) * (cw + gap), MD.y + head + Math.floor(i / cols) * (rh + gap), cw, rh));
        pager(MD.x + 18, MD.y + MD.h - 114, iw, M.resultPage, pages, 'market-result-previous', 'market-result-next');
        btn('market-back', '', MD.x + 18, MD.y + MD.h - 62, iw, 48, '닫기');
    }
    function rulesView() {
        const w = Math.min(W - 24, 560), iw = w - 64, room = Math.min(H - 24, 640) - 66 - 74;
        let sz = 15, ls, lh; for (; sz >= 11; sz--) { lh = Math.round(sz * 1.4); ls = RULES.map(r => wrap(r, iw, sz, 600)); if (ls.reduce((s, l) => s + l.length * lh, 0) + 8 * 7 <= room) break; }
        const MD = modal('거래 규칙', w, 66 + ls.reduce((s, l) => s + l.length * lh, 0) + 56 + 74); let y = MD.y + 70;
        ls.forEach(l => { gem(MD.x + 30, y + lh / 2, 3.5, acc); l.forEach((t, i) => text(t, MD.x + 44, y + lh * (i + .5), sz, INK, 'left', 600)); y += l.length * lh + 8; });
        btn('market-back', '', MD.x + 18, MD.y + MD.h - 62, w - 36, 48, '닫기');
    }

    function draw(a) {
        A = a; C = a.ctx; S = a.s; W = a.w; H = a.h;
        const mk = S.market; acc = mk ? HUES[0][1] : hue(tabName());
        C.save(); C.clearRect(0, 0, W, H);
        if (A.background) {
            const scale = Math.max(W / A.background.naturalWidth, H / A.background.naturalHeight);
            const bw = A.background.naturalWidth * scale, bh = A.background.naturalHeight * scale;
            C.drawImage(A.background, (W - bw) / 2, (H - bh) / 2, bw, bh);
            C.fillStyle = mk ? 'rgba(5,8,13,.38)' : 'rgba(5,8,13,.58)'; C.fillRect(0, 0, W, H);
        }
        let ov = S.message ? 'message' : ['confirm', 'success', 'contents', 'categories', 'materials'].includes(S.mode) ? S.mode : '';
        if (mk && !ov) ov = mk.message ? 'market-message' : mk.dialog ? 'market-confirm' : ['results', 'rules'].includes(mk.mode) ? 'market-' + mk.mode : '';
        live = !ov;
        if (W < 640 || W < 1200 && H < 780) {
            if (mk) mobileMarket();
            else if (A.item && !['browse', 'categories', 'materials'].includes(S.mode)) mobileDetail(); else mobileBrowse();
        } else if (W < 1200) tablet(); else desktop();
        live = true;
        if (ov === 'market-message' && !mk.error) {
            // Keep the lot's original completion flourish visible behind the acknowledgement.
            const w = Math.min(W - 24, 480), f = fit(mk.message, w - 114, 64, 15, 12, 700), h = Math.max(72, f.lines.length * f.lh + 28), x = (W - w) / 2, y = H - h - 12;
            plate(x, y, w, h, 12, { a: .96, tint: acc }); para(f, x + 16, y + (h - f.lines.length * f.lh) / 2, INK, 'left');
            btn('market-back', '', x + w - 88, y + (h - 44) / 2, 72, 44, '확인');
        }
        else if (ov === 'market-message') messageView(mk.message, 'market-back', WARN);
        else if (ov === 'market-confirm') bidConfirm();
        else if (ov === 'market-results') resultsView();
        else if (ov === 'market-rules') rulesView();
        else if (ov === 'message') messageView();
        else if (ov === 'confirm') confirmView();
        else if (ov === 'success') successView();
        else if (ov === 'contents') listView('구성품', (A.item && A.item.display && A.item.display.bundleContents) || [], 'back');
        else if (ov === 'categories') pickView('분류', tabs(), 'category', S.tab);
        else if (ov === 'materials') pickView('재료', materials().map(m => ({ id: m, name: m })), 'material', S.material);
        C.restore();
    }
    window.ShopPainter = { draw };
})();
