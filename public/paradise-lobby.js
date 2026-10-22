(function () {
    'use strict';
    // 낙원 로비(입장·천상 장비·특수능력·주간 랭킹)와 장비 강화 창. 그리기·히트 영역은 부모(paradise.js)가 넘기는 api만 사용한다.
    // 렌더러(WebGL) 그림은 HUD 클립을 받지 않으므로 art()가 상단 내비 아래로 직접 잘라 그린다.
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FONT = 'ParadiseSans,Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const NAV = 68, GOLD = '#f2d58f', IVORY = '#f4ecd9', CYAN = '#a6e6e8', DIM = '#9aa6ad';
    const SLOT_NAME = { weapon: '천상 무기', armor: '천상 방어구' }, STATS = [['atk', '공격력'], ['def', '방어력'], ['hp', '체력']];
    const RANK_COLOR = ['#f6d98d', '#dfe8ee', '#e3a77c'];
    let A, C, floor = NAV, coinUrl = '', seenId, anim = null;

    function use(o, top) {
        A = o.api; C = o.ctx; floor = top; const r = o.state?.progression?.lastResult;
        // 처음 관측한 결과는 기준점으로만 기록하고, 이후 새 ID가 보일 때만 연출한다.
        if (!o.state?.progression) return;
        if (seenId === undefined) seenId = r?.id ?? null; else if (r && r.id !== seenId) { seenId = r.id; anim = { ...r, at: o.t }; }
    }
    const fresh = (t, pick) => anim && pick(anim) ? Math.max(0, 1 - (t - anim.at) / 1200) : 0;
    function hit(x, y, w, h, label, fn, off) { const top = Math.max(y, floor); if (y + h > top) A.register(x, top, w, y + h - top, label, fn, off); }
    function kst(at) {
        const d = new Date(at); if (!at || isNaN(d)) return '';
        const k = new Date(d.getTime() + 324e5), p = n => String(n).padStart(2, '0');
        return `${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())}(${'일월화수목금토'[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST 초기화`;
    }
    function art(name, x, y, w, h, tint) {
        const R = A.renderer, tex = R.image(A.asset(name)); if (!tex?.ready || y + h <= floor) return;
        const s = tex.width / tex.height, r = w / h; let [u, v, uw, vh] = s > r ? [(1 - r / s) / 2, 0, r / s, 1] : [0, (1 - s / r) / 2, 1, s / r];
        if (y < floor) { const cut = (floor - y) / h; v += vh * cut; vh *= 1 - cut; h -= floor - y; y = floor; }
        R.quad(tex, x, y, w, h, tint, [u, v, uw, vh]);
    }
    function stone(x, y, w, h, a = .8, edge = 'rgba(236,212,160,.26)') {
        A.chamfer(C, x, y, w, h, 9); const g = C.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, `rgba(26,30,36,${a})`); g.addColorStop(1, `rgba(7,10,14,${Math.min(1, a + .1)})`); C.fillStyle = g; C.fill();
        C.strokeStyle = edge; C.lineWidth = 1; C.stroke(); A.chamfer(C, x + 4, y + 4, w - 8, h - 8, 7); C.strokeStyle = 'rgba(255,255,255,.045)'; C.stroke();
    }
    function gem(x, y, s, fill) { C.beginPath(); C.moveTo(x, y - s); C.lineTo(x + s, y); C.lineTo(x, y + s); C.lineTo(x - s, y); C.closePath(); C.fillStyle = fill; C.fill(); }
    function lock(cx, cy, s, color) { C.beginPath(); C.arc(cx, cy - s * .2, s * .3, Math.PI, 0); C.strokeStyle = color; C.lineWidth = Math.max(2, s * .1); C.stroke(); A.rr(C, cx - s * .42, cy - s * .2, s * .84, s * .66, s * .12); C.fillStyle = color; C.fill(); }
    function measure(value, size, weight = 700) { C.font = `${weight} ${size}px ${FONT}`; return C.measureText(String(value)).width; }
    function heading(x, y, w, label) {
        gem(x + 5, y, 5, A.metal(C, 'gold', x, y - 5, 10, 10)); A.text(C, label, x + 18, y, 17, IVORY, 'left', 700);
        const sx = x + 30 + measure(label, 17), g = C.createLinearGradient(sx, 0, x + w, 0); g.addColorStop(0, 'rgba(242,213,143,.5)'); g.addColorStop(1, 'rgba(242,213,143,0)');
        if (x + w > sx) A.line(C, sx, y, x + w, y, g, 1);
    }
    function btn(x, y, w, h, label, fn, o = {}) {
        const off = !!o.disabled, hov = !off && (o.hot || A.inside(x, y, w, h)), size = o.size || 15, shown = o.glyph ?? label;
        A.chamfer(C, x, y, w, h, Math.min(8, h / 4));
        if (o.primary) { const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, off ? '#4a4538' : hov ? '#fff2c8' : '#f3d993'); g.addColorStop(.5, off ? '#3d382d' : hov ? '#e2bb6c' : '#cfa152'); g.addColorStop(1, off ? '#302c24' : '#946a28'); C.fillStyle = g; }
        else C.fillStyle = hov ? 'rgba(36,50,60,.94)' : 'rgba(13,19,26,.84)';
        C.fill(); C.strokeStyle = off ? 'rgba(255,255,255,.12)' : o.primary ? 'rgba(255,247,220,.8)' : hov ? 'rgba(166,230,232,.65)' : 'rgba(236,212,160,.38)'; C.lineWidth = 1; C.stroke();
        const color = off ? (o.primary ? '#8d8572' : 'rgba(230,235,238,.38)') : o.primary ? '#20170a' : IVORY, cy = y + h / 2 + .5;
        const amount = o.cost != null ? A.fmt(o.cost) : '', lw = measure(shown, size), aw = amount ? measure(amount, size) + 26 : 0;
        let cx = x + (w - lw - (aw && aw + 10)) / 2; A.text(C, shown, cx, cy, size, color, 'left', 700, undefined, false);
        if (amount) { cx += lw + 10; C.globalAlpha = off ? .45 : 1; A.iconAt(o.icon || coinUrl, cx, y + h / 2 - 11, 22); C.globalAlpha = 1; A.text(C, amount, cx + 26, cy, size, color, 'left', 700, undefined, false); }
        if (!o.noHit) hit(x, y, w, h, amount ? `${label} (${amount})` : label, fn, off);
    }

    // ── 입장 타일: 실제 아트가 주인공, 하단만 어둡게 눌러 글자를 얹는다.
    function realm(i, x, y, w, h, o, mobile) {
        const s = o.state, hell = i === 1, keys = s.hell?.keys || [], keyCount = keys.reduce((a, k) => a + (k.count || 0), 0), tickets = s.ticket?.count || 0;
        const can = hell ? !!s.hell?.enabled && keyCount > 0 : !!s.enabled && tickets >= 1 && !s.entryBlocked, off = !can || o.busy;
        const hov = !off && A.inside(x, Math.max(y, floor), w, h), k = hov ? 1 : can ? .84 : .42, tone = hell ? '255,122,72' : '255,236,190';
        art(hell ? 'hell' : 'corridor', x, y, w, h, hell && !can ? [k, k * .86, k * .88, 1] : [k, k, k, 1]);
        let g = C.createLinearGradient(0, y + h * .3, 0, y + h); g.addColorStop(0, 'rgba(4,7,11,0)'); g.addColorStop(1, 'rgba(4,7,11,.94)'); C.fillStyle = g; C.fillRect(x, y + h * .3, w, h * .7);
        const breathe = reduced ? .5 : .5 + .5 * Math.sin(o.t / 1400 + i * 2);
        g = C.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, h); g.addColorStop(0, `rgba(${tone},${can ? (hov ? .26 : .06 + .06 * breathe) : 0})`); g.addColorStop(1, `rgba(${tone},0)`); C.fillStyle = g; C.fillRect(x, y, w, h);
        const rim = can ? A.metal(C, hell ? 'ember' : 'gold', x, y, w, h) : 'rgba(170,120,120,.4)';
        C.strokeStyle = rim; C.lineWidth = hov ? 2.5 : 1.5; C.strokeRect(x + .5, y + .5, w - 1, h - 1); C.strokeStyle = 'rgba(255,255,255,.08)'; C.lineWidth = 1; C.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
        [[x + 6, y + 6, 1, 1], [x + w - 6, y + 6, -1, 1], [x + 6, y + h - 6, 1, -1], [x + w - 6, y + h - 6, -1, -1]].forEach(([cx, cy, sx, sy]) => { C.beginPath(); C.moveTo(cx, cy + sy * 20); C.lineTo(cx, cy); C.lineTo(cx + sx * 20, cy); C.strokeStyle = rim; C.lineWidth = 2; C.stroke(); });
        gem(x + w / 2, y, 7, rim);
        const pad = mobile ? 12 : 22, bh = mobile ? 46 : 52, bw = mobile ? w - pad * 2 : Math.min(220, w * .42), by = y + h - pad - bh, bx = mobile ? x + pad : x + w - pad - bw;
        const ty = mobile ? by - 48 : by + 6, sy = ty + (mobile ? 25 : 32), limit = mobile ? x + w - pad : bx - 12;
        A.text(C, hell ? '지옥' : '천상', x + pad, ty, mobile ? 22 : 30, hell ? (can ? '#ffd9bf' : '#c9a5aa') : '#fbf3df', 'left', 800);
        if (hell) {
            const owned = keys.filter(key => key.count > 0); let kx = x + pad;
            if (!s.hell?.enabled || !owned.length) A.text(C, s.hell?.enabled ? '열쇠 없음' : '준비 중', kx, sy, 13, '#b89a9e', 'left', 600);
            else owned.forEach(key => { const label = `×${A.fmt(key.count)}`; if (kx + 26 + measure(label, 13) > limit) return; A.iconAt(key.iconUrl, kx, sy - 12, 24); A.text(C, label, kx + 26, sy, 13, '#f0c7a8', 'left', 700); kx += 38 + measure(label, 13); });
        } else {
            const best = `최고 ${A.fmt(s.weekly?.bestFloor || 0)}층`; A.text(C, best, x + pad, sy, 13, '#e2d3a8', 'left', 600);
            const tx = x + pad + measure(best, 13, 600) + 14; if (tx + 60 < limit) { A.iconAt(s.ticket?.iconUrl, tx, sy - 12, 24); A.text(C, `×${A.fmt(tickets)}`, tx + 26, sy, 13, IVORY, 'left', 700); }
        }
        const label = hell ? (!s.hell?.enabled ? '준비 중' : keyCount ? '열쇠 선택' : '열쇠 없음') : !s.enabled ? '준비 중' : tickets < 1 ? '입장권 없음' : '입장';
        btn(bx, by, bw, bh, label, null, { primary: true, noHit: true, hot: hov, disabled: off, size: mobile ? 15 : 16, ...(can && !hell ? { cost: 1, icon: s.ticket?.iconUrl } : {}) });
        hit(x, y, w, h, hell ? '지옥, 열쇠 선택' : '천상 입장', hell ? () => A.openHell() : () => A.enterHeaven(), off);
    }

    // ── 천상 장비 받침대
    function pedestal(slot, x, y, w, h, p, o, is) {
        const g = p[slot], hov = A.inside(x, y, w, h), flash = fresh(o.t, a => a.slot === slot); stone(x, y, w, h, .8, hov ? 'rgba(242,213,143,.6)' : undefined); if (!g) return;
        const cx = x + w / 2, lift = hov && !reduced ? 4 : 0, iy = y + 44 - lift, gy = iy + is / 2, br = reduced ? .5 : .5 + .5 * Math.sin(o.t / 1600 + (slot === 'armor' ? 2 : 0)), off = o.busy || p.locked;
        A.text(C, SLOT_NAME[slot], x + 16, y + 24, 15, IVORY, 'left', 700, w - 70); if (g.unlocked) A.text(C, `+${g.level}`, x + w - 16, y + 24, 17, GOLD, 'right', 800);
        const rg = C.createRadialGradient(cx, gy, 0, cx, gy, is * .8); rg.addColorStop(0, `rgba(255,240,200,${g.unlocked ? Math.min(.85, .18 + .1 * br + (hov ? .12 : 0) + flash * .55) : .05})`); rg.addColorStop(.6, `rgba(150,225,230,${g.unlocked ? .06 : .02})`); rg.addColorStop(1, 'rgba(150,225,230,0)'); C.fillStyle = rg; C.fillRect(cx - is, gy - is, is * 2, is * 2);
        C.beginPath(); C.ellipse(cx, y + 48 + is, is * .46, is * .09, 0, 0, Math.PI * 2); C.strokeStyle = A.metal(C, 'gold', cx - is / 2, 0, is, 1); C.globalAlpha = g.unlocked ? .7 : .3; C.lineWidth = 1.5; C.stroke();
        C.globalAlpha = g.unlocked ? 1 : .32; A.iconAt(g.iconUrl || A.asset(`celestial-${slot}`), cx - is / 2, iy, is); C.globalAlpha = 1;
        if (!g.unlocked) lock(cx, gy, 28, 'rgba(236,224,200,.85)');
        else { let sy = y + 48 + is + 24; const list = STATS.filter(([k]) => g[k]); if (!list.length) A.text(C, '—', cx, sy, 13, DIM, 'center'); list.forEach(([k, n]) => { A.text(C, n, cx - 6, sy, 13, DIM, 'right', 500); A.text(C, `+${A.fmt(g[k])}`, cx + 6, sy, 14, IVORY, 'left', 700); sy += 19; }); }
        if (g.unlocked) btn(x + 12, y + h - 56, w - 24, 44, g.next ? '강화' : '최대 강화', () => A.openEquipment(slot), { primary: !!g.next, disabled: off });
        else btn(x + 12, y + h - 56, w - 24, 44, '해금', () => A.mutate('unlockEquipment', { slot }), { primary: true, cost: g.unlockCost, disabled: off || p.tokens < g.unlockCost });
    }
    // ── 특수능력 룬 두 칸 + 줄별 재설정
    function traitLayout(w, T) { const tw = w - 32 - 64 - 16, rows = [0, 1].map(i => { const l = T?.lines?.[i]; return l ? Math.max(142, 104 + A.wrap(C, l.desc, tw, 13, 6).length * 19) : 84; }); return { tw, rows, h: 52 + rows[0] + rows[1] + 12 }; }
    function traits(x, y, w, h, p, o) {
        const T = p.traits || {}, lines = T.lines || [], off = o.busy || p.locked, L = traitLayout(w, T);
        stone(x, y, w, h, .8);
        A.text(C, '특수능력', x + 18, y + 30, 15, GOLD, 'left', 700);
        let ry = y + 52;
        [0, 1].forEach(i => {
            const l = lines[i], rh = L.rows[i], rx = x + 16, rc = ry + (l ? 40 : rh / 2);
            const flash = fresh(o.t, a => !a.slot && a.index === i);
            if (flash) { A.chamfer(C, x + 8, ry, w - 16, rh - 6, 7); C.fillStyle = `rgba(255,240,200,${flash * .16})`; C.fill(); }
            if (i) A.line(C, x + 16, ry - 4, x + w - 16, ry - 4, 'rgba(236,212,160,.14)');
            C.beginPath(); C.arc(rx + 32, rc, 31, 0, Math.PI * 2); C.fillStyle = 'rgba(0,0,0,.35)'; C.fill(); C.strokeStyle = l ? A.metal(C, 'gold', rx, rc - 31, 64, 62) : 'rgba(255,255,255,.14)'; C.lineWidth = 1.5; C.stroke();
            C.globalAlpha = l ? 1 : .3; A.iconAt(T.iconUrl, rx + 6, rc - 26, 52); C.globalAlpha = 1;
            if (l) { A.text(C, l.name, rx + 80, ry + 20, 15, GOLD, 'left', 700, L.tw); A.paragraph(C, l.desc, rx + 80, ry + 44, L.tw, 13, '#d5dcdc', 19, 6);
                btn(x + w - 176, ry + rh - 54, 160, 44, `${i + 1}번째 특수능력 재설정`, () => A.mutate('rerollTrait', { index: i }), { glyph: '재설정', cost: T.rerollCost, disabled: off || p.tokens < T.rerollCost, size: 14 }); }
            else { lock(rx + 32, rc, 22, 'rgba(236,224,200,.8)'); const cost = T.unlockCosts?.[i]; btn(x + w - 176, rc - 22, 160, 44, '해금', () => A.mutate('unlockTrait', { index: i }), { primary: true, cost, disabled: off || cost == null || p.tokens < cost || i === 1 && !lines[0], size: 14 }); }
            ry += rh;
        });
    }
    function sanctum(o, x, y, cw, mobile) {
        const p = o.state.progression; coinUrl = p?.tokenIconUrl || '';
        const balance = p ? A.fmt(p.tokens) : '', note = '천상에서만 적용', bw = p ? measure(balance, 16) + 30 : 0, nw = measure(note, 12, 600) + 16;
        heading(x, y + 14, cw - bw - nw - 16, '천상 장비');
        if (!p) { A.text(C, '불러오는 중…', x + cw / 2, y + 80, 14, DIM, 'center', 600); return y + 130; }
        A.text(C, balance, x + cw, y + 14, 16, IVORY, 'right', 700); A.iconAt(p.tokenIconUrl, x + cw - bw, y + 2, 24); A.text(C, note, x + cw - bw - 12, y + 14, 12, CYAN, 'right', 600);
        y += 36; const gap = mobile ? 10 : 16, wide = cw >= 900, pw = wide ? 232 : (cw - gap) / 2, is = mobile ? 84 : 108, ph = is + 196, tw = wide ? cw - 2 * (pw + gap) : cw, th = traitLayout(tw, p.traits).h;
        if (wide) { const rh = Math.max(ph, th); pedestal('weapon', x, y, pw, rh, p, o, is); pedestal('armor', x + pw + gap, y, pw, rh, p, o, is); traits(x + 2 * (pw + gap), y, tw, rh, p, o); return y + rh; }
        pedestal('weapon', x, y, pw, ph, p, o, is); pedestal('armor', x + pw + gap, y, pw, ph, p, o, is); y += ph + gap; traits(x, y, cw, th, p, o); return y + th;
    }

    // ── 주간 랭킹: 상위 5명 + 내 순위, 보상 구간은 weeklyRewards에서만 만든다.
    function bands(w, R) {
        const lw = 76, iw = 74, per = Math.max(1, Math.floor((w - 28 - lw) / iw));
        const list = (R?.ranks || []).map(b => ({ label: b.from === b.to ? `${b.from}위` : `${b.from}–${b.to}위`, rank: b.from, rewards: b.rewards || [] }));
        if (R?.participation?.length) list.push({ label: '참가', join: true, rewards: R.participation });
        list.forEach(b => { b.h = Math.max(1, Math.ceil(b.rewards.length / per)) * 72 + 12; });
        return { list, per, lw, iw, h: Math.max(120, 20 + list.reduce((a, b) => a + b.h, 0)) };
    }
    function rewardsPanel(x, y, w, h, B) {
        stone(x, y, w, h); let by = y + 10;
        if (!B.list.length) A.text(C, '보상 정보가 없습니다', x + w / 2, y + h / 2, 13, DIM, 'center', 600);
        B.list.forEach((b, i) => {
            if (b.join) { A.chamfer(C, x + 8, by + 2, w - 16, b.h - 4, 6); C.fillStyle = 'rgba(120,210,220,.08)'; C.fill(); C.strokeStyle = 'rgba(166,230,232,.3)'; C.lineWidth = 1; C.stroke(); if (i) { gem(x + w / 2, by + 1, 9, 'rgba(18,30,36,.95)'); A.text(C, '+', x + w / 2, by + 1, 14, CYAN, 'center', 800); } }
            else if (i) A.line(C, x + 16, by, x + w - 16, by, 'rgba(236,212,160,.12)');
            const mid = by + b.h / 2, color = b.join ? CYAN : b.rank <= 3 ? RANK_COLOR[Math.min(2, b.rank - 1)] : IVORY;
            A.text(C, b.label, x + 18, b.join ? mid - 8 : mid, 16, color, 'left', 800, B.lw - 8); if (b.join) A.text(C, '전 순위 추가', x + 18, mid + 12, 11, CYAN, 'left', 600, B.lw - 6);
            b.rewards.forEach((r, j) => {
                const ix = x + 14 + B.lw + (j % B.per) * B.iw, iy = by + 6 + Math.floor(j / B.per) * 72, icx = ix + B.iw / 2;
                A.iconAt(r.iconUrl, icx - 19, iy, 38); A.text(C, `×${A.fmt(r.count)}`, icx + 22, iy + 34, 12, IVORY, 'right', 800);
                A.wrap(C, r.name, B.iw - 6, 11, 2, 500).forEach((s, k) => A.text(C, s, icx, iy + 48 + k * 13, 11, '#c6cfd2', 'center', 500));
            });
            by += b.h;
        });
    }
    function rankList(x, y, w, h, o) {
        const r = o.ranking, rows = (r?.rows || []).slice(0, 5); stone(x, y, w, h);
        if (!r) A.text(C, '불러오는 중…', x + w / 2, y + h / 2, 14, DIM, 'center', 600);
        else if (!rows.length) A.text(C, '이번 주 기록이 없습니다', x + w / 2, y + 14 + 105, 14, DIM, 'center', 600);
        const row = (rank, name, floorText, ry, me) => {
            const cy = ry + 21; if (rank >= 1 && rank <= 3) { gem(x + 32, cy, 14, A.metal(C, ['gold', 'silver', 'ember'][rank - 1], x + 18, cy - 14, 28, 28)); A.text(C, rank, x + 32, cy + .5, 13, '#1c150a', 'center', 800, undefined, false); }
            else A.text(C, rank ? A.fmt(rank) : '—', x + 32, cy, 14, me ? CYAN : DIM, 'center', 700);
            A.text(C, name || '—', x + 60, cy, 14, me ? '#e9fbfb' : IVORY, 'left', me ? 700 : 500, w - 150); A.text(C, floorText, x + w - 18, cy, 14, me ? CYAN : GOLD, 'right', 700);
        };
        rows.forEach((e, i) => { if (i) A.line(C, x + 16, y + 14 + i * 42, x + w - 16, y + 14 + i * 42, 'rgba(255,255,255,.06)'); row(e.rank, e.name, `${A.fmt(e.floor)}층`, y + 14 + i * 42, false); });
        if (!r) return; const me = r.me, my = y + h - 60;
        A.chamfer(C, x + 8, my, w - 16, 48, 6); C.fillStyle = 'rgba(120,210,220,.1)'; C.fill(); C.strokeStyle = 'rgba(166,230,232,.4)'; C.lineWidth = 1; C.stroke();
        row(me?.rank, me?.name || o.state.player?.name, me?.floor ? `${A.fmt(me.floor)}층` : '기록 없음', my + 3, true);
    }
    function weekly(o, x, y, cw, mobile) {
        const r = o.ranking, bw = mobile ? 100 : 120, info = [r?.total ? `${A.fmt(r.total)}명 참여` : '', kst(r?.resetsAt || o.state.weekly?.resetsAt)].filter(Boolean).join(', ');
        const iw = mobile ? 0 : measure(info, 12, 500) + 16; heading(x, y + 22, cw - bw - iw - 16, '주간 랭킹');
        if (!mobile) A.text(C, info, x + cw - bw - 16, y + 22, 12, DIM, 'right', 500);
        btn(x + cw - bw, y, bw, 44, '전체 순위', () => A.openRanking(), { size: 14 });
        if (mobile && info) { A.text(C, info, x, y + 58, 12, DIM, 'left', 500, cw); y += 20; }
        y += 58; const lh = 300, gap = mobile ? 12 : 16, lw = mobile ? cw : Math.round(cw * .42), B = bands(mobile ? cw : cw - lw - gap, o.state.weeklyRewards);
        if (mobile) { rankList(x, y, cw, lh, o); y += lh + gap; rewardsPanel(x, y, cw, B.h, B); return y + B.h; }
        const h = Math.max(lh, B.h); rankList(x, y, lw, h, o); rewardsPanel(x + lw + gap, y, cw - lw - gap, h, B); return y + h;
    }

    function draw(o) {
        use(o, NAV); const { w, state: s, scroll = 0 } = o; if (!s) return 0;
        const mobile = w <= 700, cw = Math.min(1160, w - (mobile ? 24 : 48)), x = (w - cw) / 2, gap = mobile ? 10 : 20, rw = (cw - gap) / 2, rh = mobile ? Math.min(300, rw * 1.5) : 300;
        let y = 86 - scroll; realm(0, x, y, rw, rh, o, mobile); realm(1, x + rw + gap, y, rw, rh, o, mobile); y += rh;
        if (s.entryBlocked) y += 12 + A.paragraph(C, s.entryBlocked, x + cw / 2, y + 16, Math.min(cw, 560), 13, '#eba493', 19, 3, 'center');
        y = sanctum(o, x, y + (mobile ? 24 : 32), cw, mobile);
        y = weekly(o, x, y + (mobile ? 28 : 34), cw, mobile);
        return y + scroll + 32;
    }

    // ── 강화 창: 단상 위 장비, 현재→다음 수치, 확률·비용. 결과 연출은 lastResult의 새 ID 기준.
    function drawEquipment(o) {
        use(o, 0); const { w, h, t, slot } = o, p = o.state?.progression, g = p?.[slot], close = () => o.api.close(), cx = w / 2;
        C.fillStyle = 'rgba(3,5,9,.82)'; C.fillRect(0, 0, w, h); hit(0, 0, w, h, '닫기', close);
        const pw = Math.min(500, w - 20), ph = Math.min(h - 20, 600), px = (w - pw) / 2, py = (h - ph) / 2;
        hit(px, py, pw, ph, SLOT_NAME[slot] || '장비', () => {});
        stone(px, py, pw, ph, .95, A.metal(C, 'gold', px, py, pw, ph));
        btn(px + pw - 52, py + 8, 44, 44, '닫기', close, { glyph: '✕', size: 16 });
        if (!g) { A.text(C, '불러오는 중…', cx, py + ph / 2, 15, DIM, 'center', 600); return; }
        coinUrl = p.tokenIconUrl || ''; A.iconAt(coinUrl, px + 16, py + 18, 24); A.text(C, A.fmt(p.tokens), px + 44, py + 30, 15, IVORY, 'left', 700);
        A.text(C, SLOT_NAME[slot], cx, py + 30, 18, IVORY, 'center', 700, pw - 200);
        const is = Math.max(90, Math.min(176, ph - 400)), sy = py + 62, scy = sy + is / 2 + 8, n = g.unlocked ? g.next : null, off = o.busy || p.locked;
        const a = anim && anim.slot === slot ? anim : null, age = a ? t - a.at : 1e9, k = Math.min(1, age / 1600), live = age < 1600 && !reduced;
        const forging = o.busy && !reduced, pulse = forging ? .5 + .5 * Math.sin(t / 110) : reduced ? .5 : .5 + .5 * Math.sin(t / 1800);
        const rg = C.createRadialGradient(cx, scy, 0, cx, scy, is); rg.addColorStop(0, `rgba(255,236,190,${.16 + .14 * pulse + (forging ? .22 : 0)})`); rg.addColorStop(.55, 'rgba(150,225,230,.07)'); rg.addColorStop(1, 'rgba(150,225,230,0)'); C.fillStyle = rg; C.fillRect(cx - is, scy - is, is * 2, is * 2);
        if (!reduced && g.unlocked) { C.save(); C.translate(cx, scy); C.rotate(t / (forging ? 1600 : 9000)); C.fillStyle = `rgba(255,240,205,${forging ? .2 : .08})`; for (let i = 0; i < 12; i++) { C.rotate(Math.PI / 6); C.beginPath(); C.moveTo(-2, -is * .32); C.lineTo(0, -is * .92); C.lineTo(2, -is * .32); C.fill(); } C.restore(); }
        [[.5, .1, .75], [.36, .06, .4]].forEach(([rx, ry, al]) => { C.beginPath(); C.ellipse(cx, scy + is * .5, is * rx, is * ry, 0, 0, Math.PI * 2); C.strokeStyle = A.metal(C, 'gold', cx - is / 2, 0, is, 1); C.globalAlpha = al; C.lineWidth = 1.5; C.stroke(); }); C.globalAlpha = 1;
        const sc = live && a.success ? 1 + .14 * Math.sin(Math.PI * Math.min(1, age / 520)) : 1, dx = live && !a.success ? Math.sin(age / 22) * 7 * Math.max(0, 1 - age / 650) : 0, s2 = is * .82 * sc;
        C.globalAlpha = g.unlocked ? (live && !a.success ? .55 + .45 * k : 1) : .35; A.iconAt(g.iconUrl || A.asset(`celestial-${slot}`), cx - s2 / 2 + dx, scy - s2 / 2, s2); C.globalAlpha = 1;
        if (!g.unlocked) lock(cx, scy, 34, 'rgba(236,224,200,.85)');
        if (live && a.success) {
            C.beginPath(); C.arc(cx, scy, is * (.3 + k * .9), 0, Math.PI * 2); C.strokeStyle = `rgba(255,226,150,${1 - k})`; C.lineWidth = 1 + 3 * (1 - k); C.stroke();
            for (let i = 0; i < 16; i++) { const ang = i * Math.PI / 8 + (i * 7 % 5) * .08, d = is * (.2 + k * (.7 + (i % 3) * .1)); C.beginPath(); C.arc(cx + Math.cos(ang) * d, scy + Math.sin(ang) * d, 2.6 * (1 - k) + .4, 0, Math.PI * 2); C.fillStyle = `rgba(255,240,200,${1 - k})`; C.fill(); }
            A.chamfer(C, px, py, pw, ph, 9); C.fillStyle = `rgba(255,245,220,${Math.pow(1 - k, 3) * .3})`; C.fill();
        } else if (live) for (let i = 0; i < 12; i++) { const fx = cx + (i - 5.5) * is * .07, fy = scy + k * is * (.5 + (i * 5 % 7) * .06); C.fillStyle = `rgba(160,190,205,${(1 - k) * .8})`; C.fillRect(fx, fy, 3, 7); }
        if (a && age < 2800) { const msg = a.message || (a.success ? `강화 성공, +${a.level}` : '강화 실패, 단계 유지'), bw = Math.min(pw - 40, measure(msg, 15) + 40), al = Math.min(1, (2800 - age) / 400);
            C.globalAlpha = al; A.chamfer(C, cx - bw / 2, py + ph - 126, bw, 34, 7); C.fillStyle = 'rgba(8,12,16,.88)'; C.fill(); C.strokeStyle = a.success ? 'rgba(242,213,143,.7)' : 'rgba(166,190,205,.5)'; C.lineWidth = 1; C.stroke();
            A.text(C, msg, cx, py + ph - 109, 15, a.success ? GOLD : '#c3d3db', 'center', 700, bw - 20); C.globalAlpha = 1; }
        let y = sy + is + 34;
        if (n) { A.text(C, `+${g.level}`, cx - 26, y, 22, IVORY, 'right', 800); A.text(C, '→', cx, y, 18, DIM, 'center', 700); A.text(C, `+${n.level}`, cx + 26, y, 22, GOLD, 'left', 800); }
        else A.text(C, g.unlocked ? `최대 강화 +${g.level}` : '봉인', cx, y, 20, g.unlocked ? GOLD : DIM, 'center', 800);
        y += 26; const list = STATS.filter(([s]) => g[s] || n?.[s]);
        (list.length ? list : STATS).forEach(([s, label], i) => {
            const ry = y + i * 30 + 15; A.line(C, px + 28, ry - 15, px + pw - 28, ry - 15, 'rgba(255,255,255,.07)');
            A.text(C, label, px + 32, ry, 14, DIM, 'left', 500); A.text(C, A.fmt(g[s] || 0), n ? cx + 40 : px + pw - 32, ry, 15, IVORY, 'right', 700);
            if (n) { A.text(C, '→', cx + 66, ry, 13, DIM, 'center', 600); A.text(C, A.fmt(n[s] || 0), px + pw - 32, ry, 15, GOLD, 'right', 800); }
        });
        y += (list.length || 3) * 30 + 22;
        if (n && n.chance != null) { const pct = Math.round(n.chance * 10) / 10; A.text(C, `성공 확률 ${pct}%`, cx, y, 16, GOLD, 'center', 700); A.text(C, '실패 시 단계 유지, 최대 +25', cx, y + 22, 12, DIM, 'center', 500); }
        else if (!g.unlocked) A.text(C, '최대 +25', cx, y, 12, DIM, 'center', 500);
        const by = py + ph - 68, bw = pw - 32;
        if (!g.unlocked && g.unlockCost != null) btn(px + 16, by, bw, 52, '해금', () => A.mutate('unlockEquipment', { slot }), { primary: true, cost: g.unlockCost, disabled: off || p.tokens < g.unlockCost, size: 16 });
        else if (n && n.cost != null && n.chance != null) btn(px + 16, by, bw, 52, o.busy ? '강화 중' : '강화', () => A.mutate('enhance', { slot }), { primary: true, cost: n.cost, disabled: off || p.tokens < n.cost, size: 16 });
    }

    window.ParadiseLobby = { draw, drawEquipment };
})();
