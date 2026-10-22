(function () {
    'use strict';
    // 낙원 상점: 돌과 금으로 된 거래실 오버레이. 그리기·히트 영역은 부모(paradise.js)가 넘기는 api만 쓰고, 서버 문자열은 캔버스에 그리기만 한다.
    // 구매는 api.buy(id, 수량)로 부모의 pending 흐름을 탄다. 성공 연출은 부모가 purchaseComplete를 부른 뒤에만 시작한다.
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FONT = 'ParadiseSans,Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const GOLD = '#f2d58f', IVORY = '#f4ecd9', CYAN = '#a6e6e8', DIM = '#9aa6ad', WARN = '#eba493', MUTED = '#a89d84';
    const CUR = { tokens: '천상의 증표', gold: '골드' }, TABS = [['tokens', '증표 교환'], ['gold', '골드 교환']], REVEAL = 1100;
    let A, C, S, busy = false, tab = 'tokens', page = 0, sel = null, qty = 1, confirm = false, modal = false, reveal = null, seen = null;

    function open() { tab = 'tokens'; page = 0; sel = null; qty = 1; confirm = false; modal = false; reveal = null; }
    function purchaseComplete(p) {
        if (!p || p.requestId != null && p.requestId === seen) return;
        seen = p.requestId; reveal = { ...p, at: performance.now() }; sel = p.id; qty = 1; confirm = false;
    }

    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const icon = cur => cur === 'gold' ? S.goldIconUrl : S.tokenIconUrl;
    const bal = cur => Number(S.balances?.[cur]) || 0;
    const title = it => it.count > 1 ? `${it.name} ×${A.fmt(it.count)}` : it.name;
    function measure(v, size, weight = 700) { C.font = `${weight} ${size}px ${FONT}`; return C.measureText(String(v)).width; }
    // 살 수 있는 최대 수량: 서버 한도, 잔액, 주간 잔여 중 가장 작은 값.
    function cap(it) { const byBal = it.price > 0 ? Math.floor(bal(it.currency) / it.price) : Infinity; return Math.max(0, Math.min(Number(it.maxQuantity) || 0, byBal, it.remaining ?? Infinity)); }
    function why(it) { if (!it.available) return '구매 불가'; if (it.remaining === 0) return '이번 주 매진'; if (bal(it.currency) < it.price) return `${CUR[it.currency]} 부족`; return cap(it) ? '' : '구매 불가'; }
    function stock(it) { return it.weeklyLimit == null ? '' : `주간 ${A.fmt(it.remaining ?? 0)}/${A.fmt(it.weeklyLimit)} 남음`; }
    function pick(it, sheet) { sel = it.id; qty = 1; confirm = false; if (sheet) modal = true; }
    function kst(at) {
        const d = new Date(at); if (!at || isNaN(d)) return '';
        const k = new Date(d.getTime() + 324e5), p = n => String(n).padStart(2, '0');
        return `주간 수량 ${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())}(${'일월화수목금토'[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} 초기화`;
    }

    // ── 재질: 돌판, 금속 난간, 보석, 모서리 꺾쇠
    function gem(x, y, s, fill) { C.beginPath(); C.moveTo(x, y - s); C.lineTo(x + s, y); C.lineTo(x, y + s); C.lineTo(x - s, y); C.closePath(); C.fillStyle = fill; C.fill(); }
    function stone(x, y, w, h, k = 9, a = .9, edge = 'rgba(236,212,160,.24)') {
        A.chamfer(C, x, y, w, h, k); const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, `rgba(30,35,42,${a})`); g.addColorStop(1, `rgba(8,11,15,${Math.min(1, a + .08)})`); C.fillStyle = g; C.fill();
        C.strokeStyle = edge; C.lineWidth = 1; C.stroke(); A.line(C, x + k + 2, y + 1.5, x + w - k - 2, y + 1.5, 'rgba(255,240,210,.09)');
        A.chamfer(C, x + 4, y + 4, w - 8, h - 8, Math.max(2, k - 3)); C.strokeStyle = 'rgba(255,255,255,.04)'; C.stroke();
    }
    function rail(x, y, w, a = 1) {
        C.globalAlpha = a; A.line(C, x, y + 1.5, x + w, y + 1.5, 'rgba(0,0,0,.55)', 2); A.line(C, x, y, x + w, y, A.metal(C, 'gold', x, y - 1, w, 2), 1.5);
        gem(x, y, 4, GOLD); gem(x + w, y, 4, GOLD); gem(x + w / 2, y, 3, CYAN); C.globalAlpha = 1;
    }
    function brackets(x, y, w, h, s, color) {
        C.beginPath(); [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => { C.moveTo(cx, cy + sy * s); C.lineTo(cx, cy); C.lineTo(cx + sx * s, cy); });
        C.strokeStyle = color; C.lineWidth = 2; C.stroke();
    }
    function chamber(x, y, w, h, t) {
        A.chamfer(C, x, y, w, h, 16); const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#1b2028'); g.addColorStop(.45, '#10141a'); g.addColorStop(1, '#080a0e'); C.fillStyle = g; C.fill();
        C.save(); C.clip(); C.beginPath();
        // 석조 줄눈: 엇갈린 벽돌 이음새를 아주 옅게
        for (let r = 0, yy = y + 46; yy < y + h; r++, yy += 46) { C.moveTo(x, yy); C.lineTo(x + w, yy); for (let xx = x + (r % 2 ? 60 : 0); xx < x + w; xx += 120) { C.moveTo(xx, yy); C.lineTo(xx, yy + 46); } }
        C.strokeStyle = 'rgba(255,235,200,.035)'; C.lineWidth = 1; C.stroke();
        const br = reduced ? .5 : .5 + .5 * Math.sin(t / 2200), light = C.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, Math.max(w, h) * .6);
        light.addColorStop(0, `rgba(242,213,143,${.1 + .04 * br})`); light.addColorStop(.5, 'rgba(110,210,210,.035)'); light.addColorStop(1, 'rgba(0,0,0,0)'); C.fillStyle = light; C.fillRect(x, y, w, h); C.restore();
        A.chamfer(C, x, y, w, h, 16); C.strokeStyle = A.metal(C, 'gold', x, y, w, h); C.lineWidth = 2; C.stroke();
        A.chamfer(C, x + 6, y + 6, w - 12, h - 12, 12); C.strokeStyle = 'rgba(242,213,143,.14)'; C.lineWidth = 1; C.stroke();
        gem(x + w / 2, y, 7, A.metal(C, 'gold', x + w / 2 - 7, y - 7, 14, 14)); gem(x + w / 2, y, 3, CYAN);
    }
    // 빛나는 인장: 금속 테, 청록 안쪽 고리, 천천히 도는 눈금, 네 방위 보석. k는 빛 세기.
    function seal(cx, cy, R, t, k = 1) {
        const rg = C.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7); rg.addColorStop(0, `rgba(255,236,190,${.22 * k})`); rg.addColorStop(.45, `rgba(110,215,215,${.1 * k})`); rg.addColorStop(1, 'rgba(110,215,215,0)'); C.fillStyle = rg; C.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4);
        const d = C.createRadialGradient(cx, cy - R * .3, 0, cx, cy, R); d.addColorStop(0, 'rgba(166,230,232,.16)'); d.addColorStop(.7, 'rgba(12,17,24,.9)'); d.addColorStop(1, 'rgba(6,9,13,.96)');
        const rim = A.metal(C, 'gold', cx - R, cy - R, R * 2, R * 2);
        C.beginPath(); C.arc(cx, cy, R, 0, Math.PI * 2); C.fillStyle = d; C.fill(); C.strokeStyle = rim; C.lineWidth = 2; C.stroke();
        C.beginPath(); C.arc(cx, cy, R - 6, 0, Math.PI * 2); C.strokeStyle = 'rgba(166,230,232,.32)'; C.lineWidth = 1; C.stroke();
        const spin = reduced ? 0 : t / 48000; C.beginPath();
        for (let i = 0; i < 36; i++) { const a = spin + i * Math.PI / 18, r0 = R - 10, r1 = r0 - (i % 9 ? 3 : 8); C.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); C.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
        C.strokeStyle = 'rgba(242,213,143,.4)'; C.stroke();
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 - Math.PI / 2; gem(cx + Math.cos(a) * R, cy + Math.sin(a) * R, i ? 4 : 6, rim); }
    }

    // ── 버튼: 금빛 주 버튼, 청록 선택 탭, 돌빛 보조. lead는 글자 앞 아이콘, cost는 글자 뒤 재화.
    function btn(x, y, w, h, label, fn, o = {}) {
        const off = !!o.disabled || busy && !o.free, hov = !off && A.inside(x, y, w, h), size = o.size || 15, shown = o.glyph ?? label;
        A.chamfer(C, x, y, w, h, Math.min(8, h / 4));
        if (o.primary) { const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, off ? '#4a4538' : hov ? '#fff2c8' : '#f3d993'); g.addColorStop(.5, off ? '#3d382d' : hov ? '#e2bb6c' : '#cfa152'); g.addColorStop(1, off ? '#302c24' : '#946a28'); C.fillStyle = g; }
        else if (o.on) { const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(58,124,128,.96)'); g.addColorStop(1, 'rgba(14,44,50,.96)'); C.fillStyle = g; }
        else C.fillStyle = hov ? 'rgba(36,50,60,.94)' : 'rgba(13,19,26,.86)';
        C.fill(); C.strokeStyle = off && !o.on ? 'rgba(255,255,255,.12)' : o.primary ? 'rgba(255,247,220,.8)' : o.on ? 'rgba(166,230,232,.85)' : hov ? 'rgba(166,230,232,.65)' : 'rgba(236,212,160,.38)'; C.lineWidth = 1; C.stroke();
        const color = off && !o.on ? (o.primary ? '#8d8572' : 'rgba(230,235,238,.4)') : o.primary ? '#20170a' : o.on ? '#effcfb' : IVORY, cy = y + h / 2 + .5;
        const amount = o.cost != null ? A.fmt(o.cost) : '', lead = o.lead ? 28 : 0, aw = amount ? measure(amount, size) + 36 : 0, lw = Math.min(measure(shown, size), w - 20 - lead - aw);
        let cx = x + (w - lead - lw - aw) / 2;
        if (lead) { C.globalAlpha = off && !o.on ? .5 : 1; A.iconAt(o.lead, cx, y + h / 2 - 11, 22); C.globalAlpha = 1; cx += lead; }
        A.text(C, shown, cx, cy, size, color, 'left', 700, lw + 1, false);
        if (amount) { cx += lw + 10; C.globalAlpha = off ? .45 : 1; A.iconAt(o.icon, cx, y + h / 2 - 11, 22); C.globalAlpha = 1; A.text(C, amount, cx + 26, cy, size, color, 'left', 700, undefined, false); }
        A.register(x, y, w, h, o.aria || label, fn, off);
    }
    function tabBtn(x, y, w, h, key, name) {
        const n = (S.items || []).filter(it => it.currency === key).length;
        btn(x, y, w, h, name, () => { if (tab !== key) { tab = key; page = 0; sel = null; qty = 1; confirm = false; modal = false; } },
            { on: tab === key, lead: icon(key), size: 15, aria: `${name}, ${n}종, 보유 ${CUR[key]} ${A.fmt(bal(key))}${tab === key ? ', 선택됨' : ''}` });
    }
    function purse(x, y, w, h, cur) {
        A.chamfer(C, x, y, w, h, 7); C.fillStyle = 'rgba(6,9,13,.82)'; C.fill(); C.strokeStyle = 'rgba(236,212,160,.32)'; C.lineWidth = 1; C.stroke();
        const amount = A.fmt(bal(cur)), name = CUR[cur], fits = 38 + measure(name, 12, 600) + 12 + measure(amount, 16, 800) + 12 <= w;
        A.iconAt(icon(cur), x + 8, y + h / 2 - 12, 24); if (fits) A.text(C, name, x + 38, y + h / 2 + .5, 12, DIM, 'left', 600);
        A.text(C, amount, x + w - 12, y + h / 2 + .5, 16, IVORY, 'right', 800, w - 50);
    }
    const purseW = cur => 38 + measure(CUR[cur], 12, 600) + 12 + measure(A.fmt(bal(cur)), 16, 800) + 14;
    function pager(x, y, w, pages, note) {
        if (pages > 1) {
            btn(x, y, 44, 44, '이전 페이지', () => { page--; }, { glyph: '‹', size: 22, disabled: page <= 0 });
            btn(x + w - 44, y, 44, 44, '다음 페이지', () => { page++; }, { glyph: '›', size: 22, disabled: page >= pages - 1 });
            A.text(C, `${page + 1} / ${pages}`, x + w / 2, y + (note ? 13 : 22), 13, '#d8cfb8', 'center', 700);
        }
        if (note) A.text(C, note, x + w / 2, y + (pages > 1 ? 33 : 22), 11, DIM, 'center', 600, w - 104);
    }

    // ── 진열 선반(데스크톱): 칸마다 실물 아이콘, 이름, 재고, 가격. 줄마다 금속 선반 난간.
    function slot(x, y, w, h, it) {
        const on = it.id === sel, hov = !busy && A.inside(x, y, w, h), reason = why(it), cx = x + w / 2;
        stone(x, y, w, h, 9, .88, hov ? 'rgba(242,213,143,.55)' : undefined);
        if (on) {
            const g = C.createRadialGradient(cx, y + h * .4, 0, cx, y + h * .4, w * .7); g.addColorStop(0, 'rgba(110,215,215,.16)'); g.addColorStop(1, 'rgba(110,215,215,0)'); C.fillStyle = g; C.fillRect(x, y, w, h);
            A.chamfer(C, x, y, w, h, 9); C.strokeStyle = A.metal(C, 'gold', x, y, w, h); C.lineWidth = 2; C.stroke(); brackets(x + 6, y + 6, w - 12, h - 12, 12, 'rgba(166,230,232,.75)'); gem(cx, y, 5, CYAN);
        }
        const is = Math.max(40, Math.min(104, h - 120, w * .5)), iy = y + 24 - (hov && !reduced ? 3 : 0), gy = iy + is / 2;
        const rg = C.createRadialGradient(cx, gy, 0, cx, gy, is * .85); rg.addColorStop(0, `rgba(255,236,190,${on ? .26 : hov ? .2 : .12})`); rg.addColorStop(1, 'rgba(150,225,230,0)'); C.fillStyle = rg; C.fillRect(cx - is, gy - is, is * 2, is * 2);
        C.beginPath(); C.ellipse(cx, y + 28 + is, is * .42, is * .08, 0, 0, Math.PI * 2); C.strokeStyle = A.metal(C, 'gold', cx - is / 2, 0, is, 1); C.globalAlpha = .5; C.lineWidth = 1.2; C.stroke();
        C.globalAlpha = reason ? .42 : 1; A.iconAt(it.iconUrl, cx - is / 2, iy, is); C.globalAlpha = 1;
        if (it.owned) A.text(C, `보유 ${A.fmt(it.owned)}`, x + 14, y + 17, 11, DIM, 'left', 600, w / 2 - 20);
        if (it.weeklyLimit != null) { const tw = measure('주간 한정', 11) + 14; A.chamfer(C, x + w - 12 - tw, y + 8, tw, 18, 4); C.fillStyle = 'rgba(14,44,50,.9)'; C.fill(); C.strokeStyle = 'rgba(166,230,232,.45)'; C.lineWidth = 1; C.stroke(); A.text(C, '주간 한정', x + w - 12 - tw / 2, y + 17.5, 11, CYAN, 'center', 700, undefined, false); }
        const ny = y + 28 + is + 18;
        A.text(C, A.wrap(C, title(it), w - 20, 15, 1, 700)[0] || '', cx, ny, 15, IVORY, 'center', 700);
        A.text(C, reason || stock(it), cx, ny + 21, 12, reason ? WARN : CYAN, 'center', 600, w - 16);
        A.line(C, x + 16, y + h - 42, x + w - 16, y + h - 42, 'rgba(242,213,143,.14)');
        const pr = A.fmt(it.price), pw = measure(pr, 17, 800) + 26; A.iconAt(icon(it.currency), cx - pw / 2, y + h - 32, 22); A.text(C, pr, cx - pw / 2 + 26, y + h - 21, 17, reason ? MUTED : GOLD, 'left', 800);
        A.register(x, y, w, h, [it.name, `${pr} ${CUR[it.currency]}`, reason || stock(it), on ? '선택됨' : ''].filter(Boolean).join(', '), () => pick(it), busy);
    }
    function shelf(x, y, w, h, list) {
        const n = list.length, gap = 12; if (!n) { A.text(C, '진열된 물품이 없습니다', x + w / 2, y + h / 2, 14, DIM, 'center', 600); return; }
        const maxC = Math.max(1, Math.floor((w + gap) / (176 + gap))), cols = Math.min(maxC, Math.ceil(n / Math.ceil(n / maxC))), need = Math.ceil(n / cols);
        let rows = Math.floor((h + gap) / (170 + gap)), foot = 0;
        if (rows < need) { foot = 56; rows = Math.floor((h - foot + gap) / (170 + gap)); }
        rows = clamp(rows, 1, need); const per = cols * rows, pages = Math.ceil(n / per); page = clamp(page, 0, pages - 1);
        const ch = Math.min(236, (h - foot - gap * (rows - 1)) / rows), cw = (w - gap * (cols - 1)) / cols, gh = rows * ch + (rows - 1) * gap, gy = foot ? y : y + Math.max(0, (h - gh) / 2 - 20);
        for (let r = 0; r < rows; r++) rail(x - 6, gy + r * (ch + gap) + ch + 6, w + 12, .55);
        list.slice(page * per, page * per + per).forEach((it, i) => slot(x + (i % cols) * (cw + gap), gy + Math.floor(i / cols) * (ch + gap), cw, ch, it));
        if (pages > 1) pager(x + w / 2 - 110, y + h - 44, 220, pages, '');
    }
    // ── 목록 줄(모바일): 아이콘, 이름, 재고 / 가격, 보유. 누르면 구매 창.
    function row(x, y, w, h, it) {
        const reason = why(it), hov = !busy && A.inside(x, y, w, h), is = h - 20, pr = A.fmt(it.price), prw = measure(pr, 16, 800), own = `보유 ${A.fmt(it.owned || 0)}`, ow = measure(own, 11, 600), tx = x + is + 22, my = y + h / 2;
        stone(x, y, w, h, 8, .88, hov ? 'rgba(242,213,143,.55)' : undefined);
        const g = C.createRadialGradient(x + 10 + is / 2, my, 0, x + 10 + is / 2, my, is * .7); g.addColorStop(0, 'rgba(255,236,190,.16)'); g.addColorStop(1, 'rgba(255,236,190,0)'); C.fillStyle = g; C.fillRect(x + 4, y + 4, is + 12, h - 8);
        C.globalAlpha = reason ? .45 : 1; A.iconAt(it.iconUrl, x + 10, y + 10, is); C.globalAlpha = 1;
        A.text(C, A.wrap(C, title(it), w - (tx - x) - prw - 46, 15, 1, 700)[0] || '', tx, my - 11, 15, IVORY, 'left', 700);
        A.text(C, reason || stock(it), tx, my + 13, 12, reason ? WARN : CYAN, 'left', 600, w - (tx - x) - ow - 24);
        A.text(C, pr, x + w - 14, my - 11, 16, reason ? MUTED : GOLD, 'right', 800); A.iconAt(icon(it.currency), x + w - 14 - prw - 24, my - 21, 20);
        A.text(C, own, x + w - 14, my + 13, 11, DIM, 'right', 600);
        A.register(x, y, w, h, [it.name, `${pr} ${CUR[it.currency]}`, reason || stock(it), own].filter(Boolean).join(', '), () => pick(it, true), busy);
    }

    // ── 제단 구매판: 인장 위 선택 물품 / 설명 / 보유와 주간 재고 / 수량 / 영수증(보유, 비용, 구매 후) / 구매와 확인.
    function altarFrame(x, y, w, h) {
        stone(x, y, w, h, 12, .92, A.metal(C, 'gold', x, y, w, h));
        const g = C.createLinearGradient(0, y, 0, y + h * .5); g.addColorStop(0, 'rgba(110,215,215,.08)'); g.addColorStop(1, 'rgba(110,215,215,0)'); A.chamfer(C, x + 2, y + 2, w - 4, h * .5, 10); C.fillStyle = g; C.fill();
        gem(x + w / 2, y, 6, A.metal(C, 'gold', x + w / 2 - 6, y - 6, 12, 12));
    }
    function go(it) { const n = Math.min(qty, cap(it)); confirm = false; if (n < 1 || busy) return; Promise.resolve(A.buy(it.id, n)).catch(() => {}); }
    function altar(x, y, w, h, it, t) {
        const max = cap(it), reason = why(it), off = !max, cur = CUR[it.currency], ci = icon(it.currency), cx = x + w / 2, lock = off || confirm;
        qty = clamp(qty, 1, Math.max(1, max)); const total = it.price * qty, before = bal(it.currency), after = before - total;
        const by = y + h - 68, ry = by - 92, sy = ry - 60, ly = sy - 20, top = y + 18, D = Math.min(210, w * .5, ly - 16 - top - 92);
        let ty = top;
        if (D >= 48) {
            const R = D / 2, cy = top + R, bob = reduced ? 0 : Math.sin(t / 1300) * 3; seal(cx, cy, R, t);
            C.globalAlpha = off ? .45 : 1; A.iconAt(it.iconUrl, cx - R * .66, cy - R * .66 + bob, R * 1.32); C.globalAlpha = 1; ty += D + 10;
        }
        const names = A.wrap(C, title(it), w - 40, 20, 2, 800); names.forEach((s, i) => A.text(C, s, cx, ty + 12 + i * 25, 20, IVORY, 'center', 800)); ty += names.length * 25 + 8;
        const lines = Math.min(3, Math.floor((ly - 14 - ty) / 19)); if (lines > 0) A.paragraph(C, it.description, cx, ty + 8, w - 48, 13, '#cbd4d6', 19, lines, 'center');
        if (confirm && !off) A.text(C, `${A.fmt(qty * (it.count || 1))}개를 구매할까요?`, cx, ly, 15, CYAN, 'center', 700, w - 32);
        else { A.text(C, `보유 ${A.fmt(it.owned || 0)}`, x + 20, ly, 13, DIM, 'left', 600); A.text(C, reason || stock(it), x + w - 20, ly, 13, reason ? WARN : CYAN, 'right', 700, w - 120); }
        // 수량: − [값 / 최대] + 최대
        const sx = x + 16, pw = w - 32 - 96 - 68 - 24, qx = sx + 56;
        btn(sx, sy, 48, 48, '수량 감소', () => { qty--; }, { glyph: '−', size: 22, disabled: lock || qty <= 1 });
        A.chamfer(C, qx, sy, pw, 48, 8); C.fillStyle = 'rgba(4,8,11,.9)'; C.fill(); C.strokeStyle = lock ? 'rgba(166,230,232,.2)' : 'rgba(166,230,232,.55)'; C.lineWidth = 1; C.stroke();
        A.text(C, A.fmt(qty), qx + pw / 2, sy + 24, 20, off ? DIM : IVORY, 'center', 800);
        if (pw >= 104) A.text(C, `/ ${A.fmt(max)}`, qx + pw - 10, sy + 25, 11, DIM, 'right', 600);
        btn(qx + pw + 8, sy, 48, 48, '수량 증가', () => { qty++; }, { glyph: '+', size: 22, disabled: lock || qty >= max });
        btn(x + w - 84, sy, 68, 48, '최대 수량', () => { qty = max; }, { glyph: '최대', size: 14, disabled: lock || qty >= max });
        // 영수증
        rail(x + 16, ry, w - 32, .7);
        [['보유', A.fmt(before), IVORY], ['비용', `−${A.fmt(total)}`, GOLD], ['구매 후', A.fmt(after), after < 0 ? WARN : CYAN]].forEach(([label, v, color], i) => {
            const yy = ry + 20 + i * 24, vw = measure(v, 15, 800); A.text(C, label, x + 24, yy, 13, DIM, 'left', 600);
            A.iconAt(ci, x + w - 24 - vw - 24, yy - 10, 20); A.text(C, v, x + w - 24, yy, 15, color, 'right', 800);
        });
        const bill = `${A.fmt(total)} ${cur}, 구매 후 ${A.fmt(after)} ${cur}`;
        if (!confirm || off) btn(x + 16, by, w - 32, 52, busy ? '거래 중' : off ? reason : '구매', () => { confirm = true; }, { primary: true, cost: off || busy ? null : total, icon: ci, size: 16, disabled: off, aria: off ? `${it.name}, ${reason}` : `${it.name} ${qty}개 구매, ${bill}` });
        else {
            const cw = Math.round((w - 40) * .34);
            btn(x + 16, by, cw, 52, '취소', () => { confirm = false; }, { size: 15 });
            btn(x + 24 + cw, by, w - 40 - cw, 52, '구매 확정', () => go(it), { primary: true, cost: total, icon: ci, size: 16, aria: `${it.name} ${qty}개 구매 확정, ${bill}` });
        }
    }
    // ── 구매 성공: 인장이 피어나며 물품이 솟고, 궤도 획과 입자 뒤로 이름과 수량. 끝나면 구매판으로 돌아간다.
    function bloom(x, y, w, h, t) {
        const r = reveal, dur = reduced ? 900 : REVEAL, age = t - r.at; if (age >= dur) { reveal = null; return false; }
        const R = Math.max(30, Math.min(w * .28, (h - 130) / 2.8, 110)), cx = x + w / 2, cy = y + R * 1.45 + 8;
        const k = reduced ? 1 : clamp(age / 450, 0, 1), e = 1 - Math.pow(1 - k, 3), fade = clamp((dur - age) / 220, 0, 1), q = reduced ? 1 : clamp((age - 360) / 260, 0, 1);
        C.save(); C.globalAlpha = fade; seal(cx, cy, R * (.55 + .45 * e), t, 1 + e);
        if (!reduced) {
            C.beginPath(); C.arc(cx, cy, R * (.6 + 1.1 * k), 0, Math.PI * 2); C.strokeStyle = `rgba(255,230,170,${.7 * (1 - k)})`; C.lineWidth = 1 + 3 * (1 - k); C.stroke();
            for (let i = 0; i < 3; i++) { const a = t / (600 + i * 180) + i * 2.1, rr = R * (1.08 + i * .14); C.beginPath(); C.ellipse(cx, cy, rr, rr * (.42 + i * .1), i * .5, a, a + 1.1); C.strokeStyle = i === 1 ? `rgba(166,230,232,${.7 * e})` : `rgba(242,213,143,${.65 * e})`; C.lineWidth = 1.5; C.stroke(); }
            const p = age / dur;
            for (let i = 0; i < 20; i++) { const a = i * 2.39996, d = R * (.35 + (1.15 + (i % 4) * .12) * p); C.beginPath(); C.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2.2 * (1 - p) + .6, 0, Math.PI * 2); C.fillStyle = i % 3 ? `rgba(255,236,190,${1 - p})` : `rgba(166,230,232,${1 - p})`; C.fill(); }
        }
        const back = 1 + 2.70158 * Math.pow(e - 1, 3) + 1.70158 * Math.pow(e - 1, 2), s = R * 1.25 * (reduced ? 1 : .35 + .65 * back);
        A.iconAt(r.iconUrl, cx - s / 2, cy - s / 2, s);
        C.globalAlpha = fade * q; const ty = cy + R * 1.35 + 16, rem = A.fmt(r.remainingBalance), rw = measure(rem, 13, 700) + 24;
        A.text(C, '구매 완료', cx, ty, 12, CYAN, 'center', 700);
        A.text(C, A.wrap(C, r.name, w - 32, 20, 1, 800)[0] || '', cx, ty + 26, 20, IVORY, 'center', 800);
        A.text(C, `×${A.fmt(r.count)}`, cx, ty + 54, 20, GOLD, 'center', 800);
        A.iconAt(icon(r.currency), cx - rw / 2, ty + 70, 20); A.text(C, rem, cx - rw / 2 + 24, ty + 80, 13, DIM, 'left', 700);
        C.restore(); return true;
    }

    function draw(o) {
        A = o.api; C = o.ctx; busy = !!o.busy; S = o.state?.shop; const { w, h, t } = o, mobile = w < 700;
        C.fillStyle = 'rgba(3,5,9,.86)'; C.fillRect(0, 0, w, h);
        const m = mobile ? 8 : 16, pw = Math.min(1240, w - m * 2), ph = Math.min(mobile ? h : 860, h - m * 2), px = (w - pw) / 2, py = (h - ph) / 2;
        chamber(px, py, pw, ph, t);
        gem(px + (mobile ? 22 : 30), py + (mobile ? 32 : 36), 5, A.metal(C, 'gold', px + 16, py + 26, 20, 20));
        A.text(C, '낙원 상점', px + (mobile ? 36 : 44), py + (mobile ? 32 : 36), mobile ? 19 : 24, IVORY, 'left', 800);
        btn(px + pw - 56, py + 12, 44, 44, '낙원 상점 닫기', () => A.close(), { glyph: '✕', size: 17, free: true });
        if (!S) { A.text(C, '불러오는 중…', w / 2, h / 2, 15, DIM, 'center', 600); return; }
        const list = (S.items || []).filter(it => it.currency === tab), it = list.find(i => i.id === sel), reset = kst(S.resetAt);
        if (!mobile) {
            let rx = px + pw - 68; ['gold', 'tokens'].forEach(cur => { const bw = purseW(cur); rx -= bw; purse(rx, py + 14, bw, 40, cur); rx -= 8; });
            rail(px + 22, py + 68, pw - 44);
            TABS.forEach(([key, name], i) => tabBtn(px + 24 + i * 196, py + 82, 184, 44, key, name));
            if (reset) A.text(C, reset, px + pw - 24, py + 104, 12, DIM, 'right', 600, pw - 470);
            if (!it && list.length) { sel = (list.find(i => cap(i) > 0) || list[0]).id; qty = 1; confirm = false; }
            const bx = px + 24, by = py + 142, bw = pw - 48, bh = py + ph - 20 - by, aw = clamp(bw * .36, 320, 420), sw = bw - aw - 24, ax = bx + sw + 24, cur = list.find(i => i.id === sel);
            shelf(bx, by, sw, bh, list);
            altarFrame(ax, by, aw, bh);
            if (reveal && bloom(ax, by, aw, bh, t)) return;
            if (cur) altar(ax, by, aw, bh, cur, t); else A.text(C, '물품을 고르세요', ax + aw / 2, by + bh / 2, 14, DIM, 'center', 600);
            return;
        }
        const half = (pw - 32) / 2; ['tokens', 'gold'].forEach((cur, i) => purse(px + 12 + i * (half + 8), py + 60, half, 38, cur));
        rail(px + 16, py + 108, pw - 32);
        if (modal && it) {
            const x = px + 10, y = py + 116, sw = pw - 20, sh = py + ph - 10 - y;
            altarFrame(x, y, sw, sh);
            btn(x + 12, y + 12, 96, 44, '목록으로', () => { modal = false; confirm = false; }, { glyph: '‹  목록', size: 14 });
            if (!(reveal && bloom(x, y + 56, sw, sh - 56, t))) altar(x, y + 56, sw, sh - 56, it, t);
            return;
        }
        modal = false;
        TABS.forEach(([key, name], i) => tabBtn(px + 12 + i * (half + 8), py + 118, half, 44, key, name));
        const ly = py + 174, bottom = py + ph - 12, rh = 72, per = Math.max(1, Math.floor((bottom - 52 - ly + 8) / (rh + 8))), pages = Math.max(1, Math.ceil(list.length / per));
        page = clamp(page, 0, pages - 1);
        if (!list.length) A.text(C, '진열된 물품이 없습니다', w / 2, ly + 60, 14, DIM, 'center', 600);
        list.slice(page * per, page * per + per).forEach((item, i) => row(px + 12, ly + i * (rh + 8), pw - 24, rh, item));
        pager(px + 12, bottom - 44, pw - 24, pages, reset);
    }

    window.ParadiseShop = { open, draw, purchaseComplete };
})();
