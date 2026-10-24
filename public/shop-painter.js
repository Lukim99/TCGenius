// 상점 화면 페인터. Canvas2D에 그리고 부모가 WebGL 텍스처로 올린다. 이벤트·요청은 부모 담당.
(function () {
    'use strict';
    const FONT = '"Black Market Pretendard", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const INK = '#f3f5f9', DIM = 'rgba(214,222,236,.66)', MUTE = 'rgba(190,198,214,.42)', GOLD = '#ffd873', WARN = '#ff8f7a', GOOD = '#86e3b6';
    const CUR = { gold: '골드', garnet: '가넷', point: '포인트', mileage: '마일리지' };
    const HUES = [['암시장', '#a98bff'], ['레이드|재료|보스', '#ff8a5c'], ['패키지|꾸러미|번들|묶음', '#f0b450'], ['아바타|패션|코스튬|스킨', '#ff7fae'],
        ['이벤트|캡슐|시즌', '#4fd1a5'], ['카드|스펙터|소환', '#6fb4ff'], ['포인트|마일리지|코인|가넷', '#57d3e6'], ['일반|골드|기본', '#e8b04b']];
    const PAL = ['#6fb4ff', '#4fd1a5', '#f0b450', '#ff7fae', '#a98bff', '#57d3e6', '#ff8a5c'];
    let A, C, S, W, H, T, R, live = true, acc = '#6fb4ff';

    // ── 기본 도구
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
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

    // ── 상단: '상점' 표지와 보유 재화
    function purse(c, x, y, w, h, isz) {
        plate(x, y, w, h, 7, { a: .7, edge: .7 }); A.currency(c.goods, x + 7, y + (h - isz) / 2, isz);
        line(fmt(c.amount), x + w - 10, y + h / 2 + .5, w - isz - 22, h >= 36 ? 16 : 13, INK, 'right', 800);
    }
    function topBar(x, y, w, h) {
        const cy = y + h / 2; gem(x + 12, cy, 9, steel(x, y, 24, h)); gem(x + 12, cy, 5, acc);
        text('상점', x + 32, cy + 1, 24, INK, 'left', 800);
        let px = x + w; [...wallet()].reverse().forEach(c => { const cw = 26 + 30 + tw(fmt(c.amount), 16, 800); px -= cw; purse(c, px, y + 4, cw, h - 8, 26); px -= 8; });
        rule(x, y + h + 6, w, .8);
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
        btn('categories', '', x, y, w, h, n, { mark: true, trail: 'down', align: 'left', color: acc, size: 16, aria: `분류 선택, 현재 ${n}` });
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
        artOf(d, cx - as / 2, wy + 4 - (hov && !R ? 2 : 0), as, as, !!r);
        if (r) {
            const rw = tw(r, 12, 800) + 18; plate(cx - rw / 2, wy + wh - 26, rw, 22, 5, { a: .92, edge: .6 });
            text(r, cx, wy + wh - 15, 12, r === '품절' ? WARN : GOOD, 'center', 800);
        }
        const ny = wy + wh + 5, nh = y + h - 26 - ny, f = fit(d.name || '', w - 12, nh, small ? 13 : 14, 9, 700);
        para(f, cx, ny + (nh - f.lines.length * f.lh) / 2, r ? MUTE : INK, 'center');
        if (it.price) { const pw = Math.min(w - 12, priceW(it.price, 18, 14)); price(it.price, cx - pw / 2, y + h - 15, 18, 14, r ? MUTE : GOLD, w - 12); }
        if (on) { const p = R ? 0 : Math.sin(T * 3.2) * 1.5; brackets(x - 3 - p, y - 3 - p, w + 6 + p * 2, h + 6 + p * 2, 12, acc); cut(x, y, w, h, k); C.lineWidth = 2; C.strokeStyle = rgba(acc, .9); C.stroke(); }
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

    // ── 무대: 광선, 원근 바닥, 육각 받침, 회전하는 각진 테, 떠오르는 불씨, 큰 상품 그림
    function stage(x, y, w, h, it) {
        C.save(); cut(x, y, w, h, 14); C.clip();
        const cx = x + w / 2, pw = Math.min(w * .7, h * 1.15), rx = pw / 2, ry = pw * .13, dh = Math.max(10, pw * .055), base = y + h - ry - dh - 14;
        let g = C.createRadialGradient(cx, base - h * .35, 0, cx, base - h * .35, Math.max(w, h) * .62);
        g.addColorStop(0, rgba(acc, .3)); g.addColorStop(.5, rgba(acc, .07)); g.addColorStop(1, rgba(acc, 0)); C.fillStyle = g; C.fillRect(x, y, w, h);
        for (let i = 0; i < 5; i++) {
            const bx = cx + (i - 2) * pw * .17, a = .05 + .035 * Math.sin(T * .8 + i * 1.7), bw = pw * (.05 + hash(i) * .05);
            const lg = C.createLinearGradient(0, y, 0, base); lg.addColorStop(0, rgba(acc, 0)); lg.addColorStop(1, rgba(acc, a)); C.fillStyle = lg;
            C.beginPath(); C.moveTo(bx - bw * .25, y); C.lineTo(bx + bw * .25, y); C.lineTo(bx + bw, base); C.lineTo(bx - bw, base); C.fill();
        }
        C.lineWidth = 1; C.strokeStyle = rgba(acc, .12);
        for (let i = -7; i <= 7; i++) { C.beginPath(); C.moveTo(cx + i * pw * .07, base); C.lineTo(cx + i * pw * .32, y + h); C.stroke(); }
        for (let j = 1; j <= 3; j++) { const fy = base + (y + h - base) * (j / 3) ** 1.6; C.beginPath(); C.moveTo(x, fy); C.lineTo(x + w, fy); C.stroke(); }
        const hex = s => [0, 1, 2, 3, 4, 5].map(k => [cx + Math.cos(k * Math.PI / 3) * rx * s, base + Math.sin(k * Math.PI / 3) * ry * s]);
        const top = hex(1), path = pts => { C.beginPath(); pts.forEach(([px, py], i) => i ? C.lineTo(px, py) : C.moveTo(px, py)); C.closePath(); };
        C.beginPath(); [0, 1, 2, 3].forEach((k, i) => i ? C.lineTo(...top[k]) : C.moveTo(...top[k])); [3, 2, 1, 0].forEach(k => C.lineTo(top[k][0], top[k][1] + dh)); C.closePath();
        g = C.createLinearGradient(cx - rx, 0, cx + rx, 0); g.addColorStop(0, '#1a1e28'); g.addColorStop(.35, '#5a6476'); g.addColorStop(.6, '#232835'); g.addColorStop(1, '#0d1016');
        C.fillStyle = g; C.fill(); C.strokeStyle = 'rgba(220,230,244,.35)'; C.stroke();
        path(top); g = C.createLinearGradient(0, base - ry, 0, base + ry); g.addColorStop(0, 'rgba(30,36,50,.95)'); g.addColorStop(1, rgba(acc, .32)); C.fillStyle = g; C.fill();
        C.lineWidth = 1.6; C.strokeStyle = rgba(acc, .85); C.stroke(); path(hex(.74)); C.lineWidth = 1; C.strokeStyle = 'rgba(255,255,255,.16)'; C.stroke();
        for (let j = 0; j < 2; j++) {
            const an = T * (j ? -.45 : .3) + j * .4, s = rx * (1.08 + j * .22);
            const sq = [0, 1, 2, 3].map(k => [cx + Math.cos(an + k * Math.PI / 2) * s, base + Math.sin(an + k * Math.PI / 2) * s * ry / rx]);
            path(sq); C.lineWidth = 1.2; C.strokeStyle = rgba(acc, j ? .26 : .48); C.stroke(); sq.forEach(([px, py]) => gem(px, py, 3, rgba(acc, .8)));
        }
        if (it) {
            const sz = Math.max(40, Math.min(w * .74, base - y - 18, 540)), bob = R ? 0 : Math.sin(T * 1.3) * 5, ax = cx - sz / 2, ay = base - sz - ry * .2 + bob, dim = !!reason(it);
            C.beginPath(); C.ellipse(cx, base, rx * .45, ry * .45, 0, 0, Math.PI * 2); C.fillStyle = 'rgba(0,0,0,.45)'; C.fill();
            artOf(it.display, ax, ay, sz, sz, dim);
            C.save(); path(top); C.clip(); C.translate(0, base * 2); C.scale(1, -1); C.globalAlpha = .14; A.art(it.display || {}, ax, ay, sz, sz); C.restore();
        }
        for (let i = 0; i < 18; i++) {
            const ph = (T * .16 + hash(i + 9)) % 1, px = cx + (hash(i) - .5) * pw * .95, py = base - ph * h * .72;
            gem(px, py, 1.4 + hash(i + 3) * 2.2, i % 3 ? rgba(acc, Math.sin(ph * Math.PI) * .8) : `rgba(255,255,255,${Math.sin(ph * Math.PI) * .6})`);
        }
        C.restore(); cut(x, y, w, h, 14); C.lineWidth = 1; C.strokeStyle = rgba(acc, .3); C.stroke();
    }

    // ── 이름·가격·제한 / 수량·영수증·구매
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
    function receipt(x, y, w, h, b) {
        well(x, y, w, h); const cw = w / 3, p = b.it.price;
        [['보유', fmt(b.bal), INK], ['비용', fmt(b.cost), GOLD], ['구매 후', fmt(b.after), b.after < 0 ? WARN : GOOD]].forEach(([lb, v, c], i) => {
            const cx = x + cw * i; if (i) { C.fillStyle = 'rgba(255,255,255,.1)'; C.fillRect(cx, y + 8, 1, h - 16); }
            text(lb, cx + 10, y + 13, 11, DIM, 'left', 600);
            if (p) A.currency(p.goods, cx + 8, y + h - 24, 18, p);
            line(v, cx + 30, y + h - 15, cw - 36, 15, c, 'left', 800);
        });
    }
    function purchase(x, y, w) {
        const b = buyState(), d = b.it.display || {}, mw = 64, qx = x + 50, qw = w - mw - 106;
        btn('qty-minus', '', x, y, 44, 44, '수량 줄이기', { glyph: 'minus', disabled: b.cap <= 0 || b.q <= 1 });
        well(qx, y, qw, 44); text(fmt(b.q), qx + qw / 2, y + 17, 20, b.cap ? INK : MUTE, 'center', 800);
        line(`최대 ${fmt(b.cap)}`, qx + qw / 2, y + 35, qw - 8, 11, DIM, 'center', 600);
        ring('qty-value:', qx, y, qw, 44, 6);
        if (live) A.hit('qty-value', '', qx, y, qw, 44, '구매 수량', b.cap <= 0);
        btn('qty-plus', '', x + w - mw - 50, y, 44, 44, '수량 늘리기', { glyph: 'plus', disabled: b.q >= b.cap });
        btn('qty-max', '', x + w - mw, y, mw, 44, '최대', { disabled: b.cap <= 1 || b.q >= b.cap, aria: `최대 수량 ${fmt(b.cap)}` });
        receipt(x, y + 52, w, 48, b);
        const cn = curName(b.it.price);
        btn('buy', '', x, y + 108, w, 50, b.why || '구매', { primary: true, size: 18, disabled: !!b.why,
            aria: b.why ? `${d.name}, ${b.why}` : `${d.name} 수량 ${fmt(b.q)} 구매, 비용 ${fmt(b.cost)} ${cn}, 구매 후 ${fmt(b.after)} ${cn}` });
    }
    const PH = 158;
    function hero(x, y, w, h, side) {
        plate(x, y, w, h, 18, { a: .48, tint: acc }); const it = A.item, p = 20;
        if (!it) { stage(x + 8, y + 8, w - 16, h - 16, null); text('상품을 선택하세요', x + w / 2, y + h * .4, 17, DIM, 'center', 600); return; }
        if (side) {
            const aw = Math.round(w * .42), ix = x + aw + 22, iw = w - aw - 22 - p, th = tags(ix, 0, iw, it, true);
            stage(x + 8, y + 8, aw, h - 16, it);
            info(ix, y + p, iw, h - p * 2 - PH - 12 - 58 - th, it, 26);
            purchase(ix, y + h - p - PH, iw);
        } else {
            const cw = (w - p * 2 - 24) / 2, ih = Math.max(PH, info(x + p, 0, cw, 104, it, 28, true)), sy = y + h - p - ih;
            stage(x + 8, y + 8, w - 16, sy - y - 22, it); rule(x + p, sy - 12, w - p * 2);
            info(x + p, sy, cw, 104, it, 28);
            purchase(x + p + cw + 24, sy + ih - PH, cw);
        }
    }

    // ── 화면 구성
    function desktop() {
        const m = 20, top = 72; topBar(m, 10, W - m * 2, 48);
        const big = W >= 1700, railW = big ? 200 : 172, x0 = m + railW + 16, avail = W - x0 - m, invW = Math.round(avail * (big ? .45 : .44)), bh = H - top - m;
        rail(m, top, railW, bh); hero(x0, top, avail - invW - 16, bh, false);
        inventory(x0 + avail - invW, top, invW, bh, { minW: big ? 150 : 136, minH: big ? 176 : 168 });
    }
    function tablet() {
        const m = 16; topBar(m, 8, W - m * 2, 46);
        let y = 70; chooser(m, y, Math.min(320, W - m * 2), 48); y += 60;
        const sh = clamp(Math.round(H * .42), 330, 440); hero(m, y, W - m * 2, sh, true); y += sh + 12;
        inventory(m, y, W - m * 2, H - y - m, { minW: 128, minH: 164 });
    }
    function mobileBrowse() {
        const m = 12, w = W - m * 2, cs = wallet(), mats = materials(); let y = 8;
        chooser(m, y, w, 44); y += 52;
        if (cs.length) { const cw = (w - 6 * (cs.length - 1)) / cs.length; cs.forEach((c, i) => purse(c, m + i * (cw + 6), y, cw, 30, 20)); y += 38; }
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
        const by = H - 8 - PH, iy = by - 10 - ih, ah = iy - 8 - 60;
        if (ah >= 70) stage(m, 60, w, ah, it);
        else if (ah > 0) well(m, 60, w, ah);
        info(m, iy, w, nameH, it, 20); purchase(m, by, w);
    }

    // ── 겹창
    function modal(title, w, h, burst) {
        C.fillStyle = 'rgba(3,5,9,.66)'; C.fillRect(0, 0, W, H);
        w = Math.min(W - 24, w); h = Math.min(H - 24, h); const x = (W - w) / 2, y = (H - h) / 2;
        if (burst) {
            C.save(); C.translate(W / 2, y + 34); C.rotate(R ? 0 : T * .25);
            for (let i = 0; i < 16; i++) { C.rotate(Math.PI / 8); C.beginPath(); C.moveTo(0, 0); C.lineTo(-14, -Math.max(w, 300) * .7); C.lineTo(14, -Math.max(w, 300) * .7); C.closePath(); C.fillStyle = rgba(i % 2 ? acc : '#ffe49c', .12); C.fill(); }
            C.restore();
        }
        plate(x, y, w, h, 18, { a: .93, tint: acc });
        gem(x + 24, y + 30, 5, acc); line(title, x + 38, y + 30, w - 60, 19, INK, 'left', 800); rule(x + 20, y + 54, w - 40);
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
    function listView(title, list, closeAct, head, burst) {
        const w = Math.min(W - 24, 640), cols = w >= 540 ? 2 : 1, hh = head ? head.h : 0;
        const need = 64 + hh + Math.ceil(Math.max(1, list.length) / cols) * 76 + 60 + 62, M = modal(title, w, Math.min(need, 680), burst), p = 18;
        if (head) head.draw(M.x + p, M.y + 64, M.w - p * 2);
        const ly = M.y + 66 + hh, foot = 60 + 54;
        const pages = entries(list, M.x + p, ly, M.w - p * 2, M.y + M.h - foot - ly, cols);
        pager(M.x + p, M.y + M.h - 112, M.w - p * 2, S.detailPage, pages, 'content-previous', 'content-next');
        btn(closeAct, '', M.x + p, M.y + M.h - 62, M.w - p * 2, 48, closeAct === 'success-close' ? '확인' : '닫기', { primary: closeAct === 'success-close' });
    }
    function confirmView() {
        const b = buyState(); if (!b.it) return;
        const d = b.it.display || {}, w = Math.min(W - 24, 520), iw = w - 36, as = Math.min(96, iw * .28), nw = iw - as - 16, cn = curName(b.it.price);
        const f = fit(d.name || '', nw, 120, 20, 12, 800), bh = Math.max(as, f.lines.length * f.lh + 30);
        const M = modal('구매 확인', w, 64 + bh + 16 + 48 + 16 + 50 + 18), x = M.x + 18;
        let y = M.y + 66; well(x, y, as, as); A.art(d, x + 4, y + 4, as - 8, as - 8);
        const ty = y + (bh - f.lines.length * f.lh - 30) / 2; para(f, x + as + 16, ty, INK, 'left');
        text(`수량 ${fmt(b.q)}`, x + as + 16, ty + f.lines.length * f.lh + 15, 15, acc, 'left', 700);
        y += bh + 16; receipt(x, y, iw, 48, b); y += 64;
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
            for (let i = 0; i < 10; i++) { const ph = (T * .5 + hash(i)) % 1; gem(x + hash(i + 4) * w, y + 60 - ph * 50, 2 + hash(i + 7) * 2, `rgba(255,228,156,${Math.sin(ph * Math.PI) * .8})`); }
        } }, true);
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
    function messageView() {
        const w = Math.min(W - 24, 460), f = fit(S.message, w - 40, 240, 16, 11, 600), M = modal('알림', w, 64 + f.lines.length * f.lh + 20 + 48 + 20);
        para(f, M.x + 20, M.y + 68, INK, 'left');
        btn('back', '', M.x + 18, M.y + M.h - 62, M.w - 36, 48, '확인');
    }

    function draw(a) {
        A = a; C = a.ctx; S = a.s; W = a.w; H = a.h; R = !!a.reduced; T = R ? 0 : a.t || 0;
        acc = hue(tabName());
        C.save(); C.clearRect(0, 0, W, H);
        const ov = S.message ? 'message' : ['confirm', 'success', 'contents', 'categories', 'materials'].includes(S.mode) ? S.mode : '';
        live = !ov;
        if (W < 640 || W < 1200 && H < 780) {
            if (A.item && !['browse', 'categories', 'materials'].includes(S.mode)) mobileDetail(); else mobileBrowse();
        } else if (W < 1200) tablet(); else desktop();
        live = true;
        if (ov === 'message') messageView();
        else if (ov === 'confirm') confirmView();
        else if (ov === 'success') successView();
        else if (ov === 'contents') listView('구성품', (A.item && A.item.display && A.item.display.bundleContents) || [], 'back');
        else if (ov === 'categories') pickView('분류', tabs(), 'category', S.tab);
        else if (ov === 'materials') pickView('재료', materials().map(m => ({ id: m, name: m })), 'material', S.material);
        C.restore();
    }
    window.ShopPainter = { draw };
})();
