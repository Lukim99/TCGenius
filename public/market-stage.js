/* 거래, 메일 공용 무대. 화면은 Canvas2D로 그리고 WebGL로 합성한다(상점과 같은 방식).
   두 번째 텍스처(재질 지도)에 품목 그림의 모양대로 재질 번호를 칠해 두면 셰이더가 종류별로 다른 광택을 입힌다.
   일반 카드는 부드러운 광택, 전직 카드는 사선 금속박, 각성 카드는 무지개 홀로그램, 장비는 등급색 반짝임, 아이템은 유리 반사.
   글을 읽기 전에도 재질만으로 종류가 구분되게 하려는 장치다. WebGL이 없으면 같은 그림을 2D 캔버스로 보여 준다. */
(function () {
    'use strict';
    const FONT = '"Black Market Pretendard", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const INK = '#f3f5f9', DIM = 'rgba(214,222,236,.66)', MUTE = 'rgba(190,198,214,.42)', GOLD = '#ffd873', WARN = '#ff8f7a', GOOD = '#86e3b6';
    const FX = { gloss: 1, job: 2, awaken: 3, gear: 4, glass: 5, coin: 6, seal: 7 };
    const SOUND_VOLUME = { select: .14, card: .32, slide: .26, chips: .3, drop: .3, lock: .32, unlock: .28, deal: .34, paper: .3, letter: .32, pack: .3, stamp: .4, claim: .34, cancel: .26 };

    // ── 품목 정체: 어느 화면이든 같은 규칙으로 종류, 등급, 성급, 전직 여부, 스킨, 수량을 정리한다.
    const STAR_COLORS = ['#9aa7b8', '#9aa7b8', '#9aa7b8', '#9aa7b8', '#7fd18b', '#5fc6e8', '#6f9dff', '#b48cff', '#ffcf5a', '#ff8a6b', '#ff6fae', '#ffe9a8'];
    const CARD_TYPES = { 일반: { color: '#a9c4e4', fx: FX.gloss }, 전직: { color: '#ffb648', fx: FX.job }, 각성: { color: '#c792ff', fx: FX.awaken } };
    const RARITY_FALLBACK = { 일반: '#8a97a8', 고급: '#8a97a8', 레어: '#86efac', 유니크: '#b77cff', 레전더리: '#facc15', 신화: '#ff9a3c', 초월: '#ff5a5a' };
    const CURRENCY = { gold: { label: '골드', color: '#ffd873' }, garnet: { label: '가넷', color: '#e07bff' }, point: { label: '포인트', color: '#7fd0ff' } };
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    function rarityColor(rarity) {
        const map = typeof RARITY_COLORS === 'object' ? RARITY_COLORS : RARITY_FALLBACK;
        return map[rarity] || RARITY_FALLBACK[String(rarity || '').split(' ')[0]] || '#8a97a8';
    }
    const hueOf = hex => { const n = parseInt(String(hex).slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return 0; const d = max - min; const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return h / 6; };
    function equipmentLines(d) {
        const out = [];
        const head = (text, color) => out.push({ text, color, head: true });
        const art = d.artifact;
        if (art && (art.options || []).length) {
            head('아티팩트 옵션', '#ffb0d0');
            art.options.forEach(o => out.push({ text: (o.conditionPrefix || '') + (o.conditionValue || '') + (o.conditionSuffix || '') + '  ' + o.abilityLabel + ' +' + o.n + '%', color: o.active === false ? MUTE : '#ffe1ee' }));
            out.push({ text: '재설정 ' + Math.max(0, Number(art.maxRerolls || 3) - Number(art.rerollsUsed || 0)) + '회 남음', color: DIM });
        }
        if ((d.statLines || []).length) { head('능력치', '#c8d6e8'); d.statLines.forEach(text => out.push({ text })); }
        if (d.soul && d.soul.name) out.push({ text: '영혼 ' + d.soul.name, color: '#c9a7ff' });
        const pot = d.potentialDisplay;
        if (pot && (pot.entries || []).length) { head('잠재 ' + (pot.tierLabel || ''), '#9fe0ff'); pot.entries.forEach(e => out.push({ text: (e.gradeLabel ? e.gradeLabel + '  ' : '') + e.text, color: '#d8f3ff' })); }
        else if ((d.potentialLines || []).length) { head('잠재', '#9fe0ff'); d.potentialLines.forEach(text => out.push({ text: String(text).replace(/^-\s*/, ''), color: '#d8f3ff' })); }
        if (d.passive && d.passive.name) { head('패시브 ' + d.passive.name, '#ffcf7a'); String(d.passive.desc || '').split('\n').filter(Boolean).forEach(text => out.push({ text, color: '#f3e3c2' })); }
        const set = d.setInfo || null, setName = d.setName || (set && set.name);
        if (setName) out.push({ text: setName + ' 세트', color: '#c8d6e8', head: true });
        if (d.description) out.push({ text: d.description, color: MUTE });
        return out;
    }
    function identify(entry, kind) {
        entry = entry || {};
        if (kind === 'card') {
            const type = CARD_TYPES[entry.type] ? entry.type : '일반', star = Math.max(0, Math.min(11, Number(entry.star) || 0)), meta = CARD_TYPES[type];
            const chips = [{ text: entry.starText || (star + 1) + '성', color: STAR_COLORS[star] }, { text: type === '일반' ? '일반 카드' : type + ' 카드', color: meta.color }];
            if (entry.skin) chips.push({ text: entry.skin + ' 스킨', color: '#ff9ccf' });
            if (entry.specter) chips.push({ text: '스펙터 ' + (entry.specter.name || entry.specter), color: '#7fe3d2' });
            const lines = [];
            if (entry.slotEffect) lines.push((entry.slotEffect.active === false ? '슬롯 효과 비활성 ' : '슬롯 효과 ') + entry.slotEffect.name + ' ' + entry.slotEffect.currentText);
            const skills = (entry.skills || []).map(skill => skill && skill.name).filter(Boolean);
            if (skills.length) lines.push('스킬 ' + skills.join(', '));
            const jobSkills = type !== '일반' && entry.classInfo ? (entry.classInfo.skills || []).map(skill => skill && skill.name).filter(Boolean) : [];
            if (jobSkills.length) lines.push(type + ' 스킬 ' + jobSkills.join(', '));
            return { kind, kindLabel: '캐릭터 카드', title: entry.formatted || entry.name || '캐릭터 카드', art: { imageUrl: entry.imageUrl }, card: true,
                accent: STAR_COLORS[star], typeColor: meta.color, ribbon: type === '일반' ? null : { text: type, color: meta.color }, corner: { text: entry.starText || (star + 1) + '성', color: STAR_COLORS[star] },
                chips, lines, fx: { code: meta.fx, strength: .45 + star / 22, hue: hueOf(meta.color) }, detail: true };
        }
        if (kind === 'equipment') {
            // 서버가 장비 상세(경매와 같은 equipmentDetail)를 detail로 함께 주면 그쪽 값을 쓴다.
            if (entry.detail) entry = { ...entry, ...entry.detail, number: entry.number, index: entry.index, version: entry.version };
            const color = rarityColor(entry.rarity), level = Number(entry.level || 0);
            const chips = [{ text: entry.typeLabel || '장비', color: DIM }, { text: entry.rarity || '장비', color }];
            if (level > 0) chips.push({ text: '+' + level, color: GOLD });
            if (entry.transcendStage) chips.push({ text: '초월 ' + entry.transcendStage + '단계', color: '#ff7a7a' });
            if (entry.potentialDisplay && entry.potentialDisplay.tierLabel) chips.push({ text: '잠재 ' + entry.potentialDisplay.tierLabel, color: '#9fe0ff' });
            if (entry.setName) chips.push({ text: entry.setName + ' 세트', color: '#c8d6e8' });
            if (entry.artifact && entry.artifact.options) chips.push({ text: '옵션 ' + entry.artifact.options.length + '개', color: '#c8d6e8' });
            const rank = ['일반', '고급', '레어', '유니크', '레전더리', '신화', '초월'].indexOf(String(entry.baseRarity || entry.rarity || '').split(' ')[0]);
            return { kind, kindLabel: entry.typeLabel || '장비', title: entry.name || '장비', art: { iconUrl: entry.iconUrl, frameUrl: entry.frameUrl }, accent: color,
                ribbon: null, corner: level > 0 ? { text: '+' + level, color: GOLD } : null, tag: entry.typeLabel || '장비',
                chips, lines: equipmentLines(entry), fx: { code: FX.gear, strength: .25 + Math.max(0, rank) * .12, hue: hueOf(color) }, detail: !!entry.statLines };
        }
        if (kind === 'pet') {
            const color = rarityColor(entry.rarity), level = Number(entry.level || 0);
            return { kind, kindLabel: '펫', title: entry.name || '펫', art: { iconUrl: entry.iconUrl, frameUrl: entry.frameUrl }, accent: color, tag: '펫',
                corner: level > 0 ? { text: '+' + level, color: GOLD } : null, chips: [{ text: '펫', color: DIM }, { text: entry.rarity || '펫', color }].concat(level > 0 ? [{ text: '+' + level, color: GOLD }] : []),
                lines: [...(entry.statLines || []), ...(entry.specialLines || [])].map(text => ({ text })), fx: { code: FX.gear, strength: .35, hue: hueOf(color) } };
        }
        if (kind === 'avatar') {
            const grade = entry.grade || '일반', color = grade === '한정' ? '#ff6b6b' : grade === '유니크' ? '#b77cff' : grade === '프레스티지' ? '#facc15' : '#ff9ccf';
            return { kind, kindLabel: '아바타', title: (entry.name || '') + ' 아바타', art: { iconUrl: entry.iconUrl || entry.imageUrl, frameUrl: entry.iconUrl ? entry.frameUrl : null }, accent: color, tag: '아바타',
                chips: [{ text: '아바타', color: DIM }, { text: grade, color }].concat(grade === '한정' ? [{ text: '재거래 불가', color: WARN }] : []), lines: [], fx: { code: FX.glass, strength: .5, hue: hueOf(color) } };
        }
        if (CURRENCY[kind]) {
            const c = CURRENCY[kind];
            return { kind, kindLabel: '재화', title: c.label, art: { iconUrl: entry.iconUrl }, accent: c.color, currency: true, chips: [{ text: '재화', color: DIM }], lines: [], fx: { code: FX.coin, strength: .8, hue: hueOf(c.color) } };
        }
        const count = Number(entry.count || 0), type = entry.type || '아이템';
        return { kind: 'item', kindLabel: type, title: entry.name || '아이템', art: { iconUrl: entry.iconUrl, frameUrl: entry.frameUrl }, accent: '#9fb6cf', tag: type,
            corner: count > 0 ? { text: '×' + fmt(count), color: INK } : null, chips: [{ text: type, color: '#9fd3ff' }].concat(count > 0 ? [{ text: '×' + fmt(count), color: INK }] : []),
            lines: entry.desc ? [entry.desc] : [], fx: { code: FX.glass, strength: .45, hue: .58 } };
    }

    // ── 그리기 도구 (상점 페인터와 같은 재질)
    function kit(A) {
        const C = A.ctx, S = A.s, acc = A.accent || '#6fb4ff';
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
        const font = (sz, wt) => { C.font = `${wt || 600} ${sz}px ${FONT}`; };
        const tw = (s, sz, wt) => { font(sz, wt); return C.measureText(String(s)).width; };
        const text = (s, x, y, sz, col, al, wt) => { font(sz, wt); C.fillStyle = col; C.textAlign = al || 'left'; C.textBaseline = 'middle'; C.fillText(String(s), x, y); };
        const line = (s, x, y, w, sz, col, al, wt, min = 10) => { while (sz > min && tw(s, sz, wt) > w) sz--; text(s, x, y, sz, col, al, wt); return tw(s, sz, wt); };
        function wrap(s, w, sz, wt) {
            font(sz, wt); const out = [];
            for (const para of String(s ?? '').split('\n')) {
                let ln = '';
                for (const word of para.split(/\s+/).filter(Boolean)) {
                    const next = ln ? ln + ' ' + word : word;
                    if (C.measureText(next).width <= w) { ln = next; continue; }
                    if (ln) out.push(ln); ln = '';
                    for (const ch of word) { if (ln && C.measureText(ln + ch).width > w) { out.push(ln); ln = ch; } else ln += ch; }
                }
                out.push(ln);
            }
            return out.length ? out : [''];
        }
        function fit(s, w, h, max, min, wt) {
            let f; for (let sz = max; sz >= min; sz--) { const lh = Math.round(sz * 1.3); f = { lines: wrap(s, w, sz, wt), sz, lh, wt }; if (f.lines.length * lh <= h) break; }
            return f;
        }
        const para = (f, x, y, col, al) => { f.lines.forEach((l, i) => text(l, x, y + f.lh * (i + .5), f.sz, col, al, f.wt)); return f.lines.length * f.lh; };
        function cut(x, y, w, h, k) {
            const s = Math.min(k * .35, 4); C.beginPath(); C.moveTo(x + k, y); C.lineTo(x + w - s, y); C.lineTo(x + w, y + s); C.lineTo(x + w, y + h - k);
            C.lineTo(x + w - k, y + h); C.lineTo(x + s, y + h); C.lineTo(x, y + h - s); C.lineTo(x, y + k); C.closePath();
        }
        function steel(x, y, w, h, a = 1) {
            const g = C.createLinearGradient(x, y, x + w * .3, y + h);
            g.addColorStop(0, `rgba(238,244,252,${.8 * a})`); g.addColorStop(.28, `rgba(112,124,144,${.5 * a})`); g.addColorStop(.55, `rgba(214,224,238,${.66 * a})`); g.addColorStop(1, `rgba(56,64,80,${.6 * a})`); return g;
        }
        function plate(x, y, w, h, k, o = {}) {
            const a = o.a ?? .78; cut(x, y, w, h, k);
            const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, `rgba(28,32,44,${a})`); g.addColorStop(1, `rgba(8,10,16,${Math.min(1, a + .1)})`); C.fillStyle = g; C.fill();
            if (o.tint) { const t = C.createLinearGradient(0, y, 0, y + Math.min(h, 220)); t.addColorStop(0, rgba(o.tint, o.tintA ?? .16)); t.addColorStop(1, rgba(o.tint, 0)); C.fillStyle = t; C.fill(); }
            C.lineWidth = 1.5; C.strokeStyle = steel(x, y, w, h, o.edge ?? 1); C.stroke();
            cut(x + 3, y + 3, w - 6, h - 6, Math.max(2, k - 2)); C.lineWidth = 1; C.strokeStyle = 'rgba(0,0,0,.55)'; C.stroke();
        }
        function well(x, y, w, h, k = 6, fill = 'rgba(2,4,8,.5)') {
            cut(x, y, w, h, k); C.fillStyle = fill; C.fill(); C.lineWidth = 1; C.strokeStyle = 'rgba(0,0,0,.7)'; C.stroke();
            C.beginPath(); C.moveTo(x + k, y + h + .5); C.lineTo(x + w - 2, y + h + .5); C.strokeStyle = 'rgba(255,255,255,.08)'; C.stroke();
        }
        const gem = (x, y, s, fill) => { C.beginPath(); C.moveTo(x, y - s); C.lineTo(x + s, y); C.lineTo(x, y + s); C.lineTo(x - s, y); C.closePath(); C.fillStyle = fill; C.fill(); };
        function rule(x, y, w, a = 1, color = acc) {
            const g = C.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, `rgba(220,230,244,${.35 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
            C.fillStyle = g; C.fillRect(x, y, w, 1); C.fillStyle = rgba(color, .5 * a); C.fillRect(x + w / 2 - 24, y - .5, 48, 2);
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
            else if (kind === 'plus') { C.moveTo(cx - s * .6, cy); C.lineTo(cx + s * .6, cy); C.moveTo(cx, cy - s * .6); C.lineTo(cx, cy + s * .6); }
            else if (kind === 'minus') { C.moveTo(cx - s * .6, cy); C.lineTo(cx + s * .6, cy); }
            else if (kind === 'close') { C.moveTo(cx - s * .5, cy - s * .5); C.lineTo(cx + s * .5, cy + s * .5); C.moveTo(cx + s * .5, cy - s * .5); C.lineTo(cx - s * .5, cy + s * .5); }
            else if (kind === 'check') { C.moveTo(cx - s * .55, cy); C.lineTo(cx - s * .15, cy + s * .42); C.lineTo(cx + s * .6, cy - s * .45); }
            else if (kind === 'search') { C.arc(cx - s * .12, cy - s * .12, s * .45, 0, 7); C.moveTo(cx + s * .22, cy + s * .22); C.lineTo(cx + s * .62, cy + s * .62); }
            else if (kind === 'mail') { C.rect(cx - s * .72, cy - s * .5, s * 1.44, s); C.moveTo(cx - s * .72, cy - s * .5); C.lineTo(cx, cy + s * .1); C.lineTo(cx + s * .72, cy - s * .5); }
            else if (kind === 'pen') { C.moveTo(cx - s * .6, cy + s * .6); C.lineTo(cx - s * .45, cy + s * .1); C.lineTo(cx + s * .35, cy - s * .7); C.lineTo(cx + s * .65, cy - s * .4); C.lineTo(cx - s * .15, cy + s * .45); C.closePath(); }
            else if (kind === 'refresh') { C.arc(cx, cy, s * .6, -Math.PI * .3, Math.PI * 1.35); const ax = cx + Math.cos(-Math.PI * .3) * s * .6, ay = cy + Math.sin(-Math.PI * .3) * s * .6; C.moveTo(ax + s * .42, ay - s * .03); C.lineTo(ax, ay); C.lineTo(ax + s * .1, ay + s * .41); }
            else if (kind === 'eye') { C.moveTo(cx - s * .7, cy); C.quadraticCurveTo(cx, cy - s * .7, cx + s * .7, cy); C.quadraticCurveTo(cx, cy + s * .7, cx - s * .7, cy); C.moveTo(cx + s * .2, cy); C.arc(cx, cy, s * .2, 0, 7); }
            C.stroke(); C.lineCap = 'butt';
        }
        function ring(key, x, y, w, h, k) {
            if (S.focus !== key) return;
            cut(x - 4, y - 4, w + 8, h + 8, k + 3); C.lineWidth = 2; C.strokeStyle = '#ffffff'; C.stroke();
            cut(x - 7, y - 7, w + 14, h + 14, k + 5); C.lineWidth = 1.5; C.strokeStyle = rgba(acc, .75); C.stroke();
        }
        function btn(action, id, x, y, w, h, label, o = {}) {
            const off = !!o.disabled || !!S.busy, key = action + ':' + (id ?? ''), hov = !off && S.hover === key, k = Math.min(10, h / 4), col0 = o.color || acc;
            cut(x, y, w, h, k); const g = C.createLinearGradient(0, y, 0, y + h);
            if (o.primary && !off) { g.addColorStop(0, hov ? '#fff3cc' : '#ffe49c'); g.addColorStop(.48, hov ? '#f6c860' : '#eab043'); g.addColorStop(.52, '#cf8f24'); g.addColorStop(1, '#7d5012'); }
            else if (o.danger && !off) { g.addColorStop(0, hov ? 'rgba(150,62,56,.95)' : 'rgba(118,44,40,.92)'); g.addColorStop(1, 'rgba(46,14,14,.95)'); }
            else if (o.on) { g.addColorStop(0, rgba(col0, .58)); g.addColorStop(1, rgba(col0, .16)); }
            else if (off) { g.addColorStop(0, 'rgba(46,50,60,.84)'); g.addColorStop(1, 'rgba(22,24,30,.9)'); }
            else { g.addColorStop(0, hov ? 'rgba(70,80,100,.94)' : 'rgba(44,50,64,.9)'); g.addColorStop(1, hov ? 'rgba(28,32,44,.96)' : 'rgba(16,18,26,.94)'); }
            C.fillStyle = g; C.fill();
            C.lineWidth = o.on || hov ? 1.7 : 1.2;
            C.strokeStyle = o.primary && !off ? 'rgba(255,248,222,.92)' : o.danger && !off ? 'rgba(255,170,160,.7)' : o.on ? rgba(col0, .95) : hov ? 'rgba(242,248,255,.8)' : steel(x, y, w, h, off ? .4 : .9); C.stroke();
            if (!off) { C.save(); cut(x, y, w, h, k); C.clip(); C.fillStyle = 'rgba(255,255,255,.08)'; C.fillRect(x, y, w, h * .44); C.restore(); }
            if (o.on) { C.fillStyle = col0; C.fillRect(x + k, y + h - 3, w - k * 2, 2); }
            const col = o.primary ? (off ? 'rgba(226,220,206,.5)' : '#2b1904') : off ? 'rgba(222,228,238,.4)' : INK;
            const lead = o.icon ? h * .62 : 0;
            if (o.glyph && !label) glyph(o.glyph, x + w / 2, y + h / 2, Math.min(16, h * .36), col);
            else {
                const gl = o.glyph ? 26 : 0, pl = 12 + gl + (lead ? lead + 6 : 0), pr = o.badge ? 34 : 12, lw = w - pl - pr, f = fit(label, lw, h - 8, o.size || 15, 10, 700), left = o.align === 'left';
                const tx = left ? x + pl : x + pl + lw / 2;
                if (!left && (gl || lead)) {
                    const total = Math.max(...f.lines.map(l => tw(l, f.sz, 700))) + gl + (lead ? lead + 6 : 0), sx = x + (w - total) / 2;
                    if (o.glyph) glyph(o.glyph, sx + 9, y + h / 2, 9, col);
                    if (lead) A.icon(o.icon, sx + gl, y + (h - lead) / 2, lead, lead);
                    para(f, sx + gl + (lead ? lead + 6 : 0), y + (h - f.lines.length * f.lh) / 2, col, 'left');
                } else {
                    if (o.glyph) glyph(o.glyph, x + 21, y + h / 2, 9, col);
                    if (lead) A.icon(o.icon, x + 12 + gl, y + (h - lead) / 2, lead, lead);
                    para(f, tx, y + (h - f.lines.length * f.lh) / 2, col, left ? 'left' : 'center');
                }
                if (o.badge) { const bw = Math.max(22, tw(o.badge, 11, 800) + 10); plate(x + w - bw - 6, y + h / 2 - 10, bw, 20, 4, { a: .9, edge: .5 }); text(o.badge, x + w - 6 - bw / 2, y + h / 2 + .5, 11, o.badgeColor || INK, 'center', 800); }
            }
            ring(key, x, y, w, h, k);
            A.hit(action, id, x, y, w, h, o.aria || label, off, !!o.pressed);
        }
        function pager(x, y, w, page, pages, prev, next) {
            if (pages <= 1) return;
            btn(prev, '', x, y, 44, 44, '', { glyph: 'prev', disabled: page <= 0, aria: '이전 페이지' });
            btn(next, '', x + w - 44, y, 44, 44, '', { glyph: 'next', disabled: page >= pages - 1, aria: '다음 페이지' });
            const mid = x + w / 2, pips = pages <= 10 && w >= 200;
            text(`${page + 1} / ${pages}`, mid, y + (pips ? 15 : 22), 14, INK, 'center', 700);
            if (pips) for (let i = 0; i < pages; i++) gem(mid + (i - (pages - 1) / 2) * 13, y + 33, i === page ? 4.5 : 2.5, i === page ? acc : 'rgba(255,255,255,.3)');
        }
        // 작은 꼬리표. 폭을 돌려준다.
        function chip(label, x, y, color, o = {}) {
            const sz = o.size || 12, h = o.h || 22, w = Math.min(o.max || 1e4, tw(label, sz, 800) + 16);
            cut(x, y, w, h, 4); C.fillStyle = o.fill || rgba(color, .14); C.fill(); C.lineWidth = 1; C.strokeStyle = rgba(color, .55); C.stroke();
            line(label, x + w / 2, y + h / 2 + .5, w - 10, sz, color, 'center', 800, 9); return w;
        }
        function chipRow(list, x, y, w, o = {}) {
            const h = o.h || 22, gap = 5; let cx = x, cy = y;
            for (const c of list) {
                const cw = Math.min(w, tw(c.text, o.size || 12, 800) + 16);
                if (cx > x && cx + cw > x + w) { if (o.single) break; cx = x; cy += h + gap; }
                if (!o.dry) chip(c.text, cx, cy, c.color || INK, { h, size: o.size, max: w }); cx += cw + gap;
            }
            return cy - y + h;
        }
        function ribbon(label, x, y, color) {
            const w = tw(label, 11, 800) + 16, h = 19;
            C.beginPath(); C.moveTo(x - w, y); C.lineTo(x, y); C.lineTo(x, y + h); C.lineTo(x - w, y + h); C.lineTo(x - w + 6, y + h / 2); C.closePath();
            const g = C.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, rgba(color, .96)); g.addColorStop(1, rgba(color, .7)); C.fillStyle = g; C.fill();
            text(label, x - w / 2 + 3, y + h / 2 + .5, 11, '#16100a', 'center', 800);
        }
        // 품목 칸: 그림, 성급이나 강화 수치, 종류 띠, 이름, 꼬리표. 선택하면 브래킷과 강조색 테두리.
        function slot(info, x, y, w, h, o = {}) {
            const key = (o.action || 'pick') + ':' + (o.id ?? ''), on = !!o.on, hov = !o.disabled && !S.busy && S.hover === key, k = 9, col = info.accent || acc;
            if (on) { C.save(); C.shadowColor = rgba(col, .9); C.shadowBlur = 18; cut(x, y, w, h, k); C.fillStyle = rgba(col, .26); C.fill(); C.restore(); }
            plate(x, y, w, h, k, { a: .86, edge: on || hov ? 1.35 : .8, tint: col, tintA: on ? .2 : .08 });
            C.fillStyle = rgba(col, .85); C.fillRect(x + 2, y + k, 2.5, h - k * 2);
            if (h < 150 && w > h * 1.2) { slotRow(info, x, y, w, h, o, key, on, col, k); return; }
            const footH = o.footer ? o.footerH || 40 : 0; h -= footH;
            const pad = 6, nameH = o.small ? 30 : 34, chipH = o.noChips ? 0 : 20, ah = h - pad * 2 - nameH - chipH - (chipH ? 4 : 0), aw = w - pad * 2;
            well(x + pad, y + pad, aw, ah, 6, rgba(col, .07));
            if (ah > 18) {
                const box = info.card ? fitBox(aw - 8, ah - 8, 399 / 515) : { w: Math.min(aw - 8, ah - 8), h: Math.min(aw - 8, ah - 8) };
                A.art(info.art, x + pad + (aw - box.w) / 2, y + pad + (ah - box.h) / 2, box.w, box.h, { fx: info.fx, dim: o.dim });
            }
            if (info.corner) { const cw = Math.max(26, tw(info.corner.text, 12, 800) + 12); plate(x + pad + 3, y + pad + 3, cw, 21, 5, { a: .92, edge: .55 }); line(info.corner.text, x + pad + 3 + cw / 2, y + pad + 14, cw - 6, 12, info.corner.color || INK, 'center', 800, 9); }
            if (info.ribbon) ribbon(info.ribbon.text, x + w - pad - 1, y + pad + 4, info.ribbon.color);
            else if (info.tag && !o.small) { const tl = Math.min(aw - 40, tw(info.tag, 10, 700) + 12); if (tl > 20) { plate(x + w - pad - 3 - tl, y + pad + 3, tl, 18, 4, { a: .85, edge: .4 }); line(info.tag, x + w - pad - 3 - tl / 2, y + pad + 12.5, tl - 6, 10, DIM, 'center', 700, 8); } }
            const ny = y + pad + ah + 3, f = fit(o.label || info.title, w - 12, nameH, o.small ? 12 : 13, 9, 700);
            para(f, x + w / 2, ny + (nameH - f.lines.length * f.lh) / 2, o.dim ? MUTE : INK, 'center');
            if (chipH) {
                const list = (o.chips || info.chips).filter(c => !info.corner || c.text !== info.corner.text).slice(0, 2);
                const total = list.reduce((s, c) => s + tw(c.text, 10, 800) + 12 + 4, -4);
                let cx = x + Math.max(6, (w - total) / 2);
                for (const c of list) { const cw = chip(c.text, cx, y + h - pad - chipH, c.color, { h: chipH - 2, size: 10, max: w - 12 }); cx += cw + 4; if (cx > x + w - 10) break; }
            }
            if (footH) { o.footer(x, y + h, w, footH); h += footH; }
            if (on) { brackets(x - 3, y - 3, w + 6, h + 6, 12, col); cut(x, y, w, h, k); C.lineWidth = 2; C.strokeStyle = rgba(col, .95); C.stroke(); }
            ring(key, x, y, w, h, k);
            if (o.action) A.hit(o.action, o.id, x, y, w, h, o.aria || [info.title, ...info.chips.map(c => c.text), on ? '선택됨' : ''].filter(Boolean).join(', '), !!o.disabled, on);
        }
        // 키가 낮은 칸: 그림을 왼쪽에 크게, 이름과 꼬리표를 오른쪽에 둔다.
        function slotRow(info, x, y, w, h, o, key, on, col, k) {
            const pad = 6, ah = h - pad * 2, aw = Math.min(w * .42, info.card ? ah * 399 / 515 + 8 : ah);
            well(x + pad, y + pad, aw, ah, 6, rgba(col, .07));
            const box = info.card ? fitBox(aw - 6, ah - 6, 399 / 515) : { w: Math.min(aw, ah) - 8, h: Math.min(aw, ah) - 8 };
            A.art(info.art, x + pad + (aw - box.w) / 2, y + pad + (ah - box.h) / 2, box.w, box.h, { fx: info.fx, dim: o.dim });
            if (info.corner) { const cw = Math.max(24, tw(info.corner.text, 11, 800) + 10); plate(x + pad + 2, y + pad + 2, cw, 19, 5, { a: .92, edge: .55 }); line(info.corner.text, x + pad + 2 + cw / 2, y + pad + 12, cw - 6, 11, info.corner.color || INK, 'center', 800, 8); }
            const sideW = o.side ? o.sideW || 110 : 0, tx = x + pad + aw + 8, tw2 = x + w - 8 - tx - sideW;
            if (sideW) o.side(x + w - sideW - 6, y + pad, sideW, h - pad * 2);
            let ty = y + pad + 2;
            const head = info.ribbon || (info.tag ? { text: info.tag, color: DIM } : null);
            if (head && h >= 76) { line(head.text, tx, ty + 7, tw2, 11, head.color, 'left', 800, 8); ty += 16; }
            const chipH = 18, room = y + h - pad - chipH - 4 - ty;
            const f = fit(o.label || info.title, tw2, Math.max(16, room), 14, 9, 700); para(f, tx, ty + Math.max(0, (room - f.lines.length * f.lh) / 2), o.dim ? MUTE : INK, 'left');
            chipRow((o.chips || info.chips).filter(c => !info.corner || c.text !== info.corner.text).slice(0, 3), tx, y + h - pad - chipH, tw2, { h: chipH, size: 10, single: true });
            if (on) { brackets(x - 3, y - 3, w + 6, h + 6, 12, col); cut(x, y, w, h, k); C.lineWidth = 2; C.strokeStyle = rgba(col, .95); C.stroke(); }
            ring(key, x, y, w, h, k);
            if (o.action) A.hit(o.action, o.id, x, y, w, h, o.aria || [info.title, ...info.chips.map(c => c.text), on ? '선택됨' : ''].filter(Boolean).join(', '), !!o.disabled, on);
        }
        function fitBox(w, h, ratio) { return w / h > ratio ? { w: h * ratio, h } : { w, h: w / ratio }; }
        // 감정대: 선택한 품목을 크게 보여 주고 정체를 모두 적는다.
        function inspect(info, x, y, w, h, o = {}) {
            plate(x, y, w, h, 16, { a: o.a ?? .6, tint: info ? info.accent : acc });
            if (!info) { well(x + 10, y + 10, w - 20, h - 20, 12); gem(x + w / 2, y + h / 2, 7, 'rgba(255,255,255,.08)'); if (o.empty) text(o.empty, x + w / 2, y + h / 2 + 26, 14, MUTE, 'center', 600); return; }
            const p = 16, bottom = o.bottom || 0, side = w > 520 && w > h * .95;
            // 옵션을 한 쪽에 다 보이는 것이 먼저다. 이름, 꼬리표, 옵션이 차지할 높이를 먼저 재고 남는 만큼만 그림에 준다.
            const fullW = w - p * 2, titleFit = fit(info.title, fullW, 86, 22, 13, 800);
            const headH = 22 + titleFit.lines.length * titleFit.lh + 8 + chipRow(info.chips, 0, 0, fullW, { h: 24, size: 12, dry: true }) + 10;
            const artRoom = h - p * 2 - bottom - 12 - headH - measureLines(info, fullW);
            // 그림이 너무 작아질 만큼 옵션이 많거나 자리가 좁으면, 그림을 작은 머리로 줄이고 옵션에 높이를 몰아준다.
            if (!side && ((info.lines.length && artRoom < 150) || h - bottom < 300)) {
                const aw = info.card ? 84 : 92, ah = info.card ? Math.round(84 * 515 / 399) : 92, ax = x + p, ay = y + p;
                well(ax, ay, aw, ah, 9, rgba(info.accent, .08));
                const box = info.card ? fitBox(aw - 8, ah - 8, 399 / 515) : { w: aw * .8, h: ah * .8 };
                A.art(info.art, ax + (aw - box.w) / 2, ay + (ah - box.h) / 2, box.w, box.h, { fx: info.fx, big: true });
                // 상세 버튼은 이름 옆에 둔다. 닫기 버튼과 함께 놓이는 휴대폰 판에서는 눈 아이콘만 보인다.
                const hasDetail = !!(o.detail && info.detail), iconOnly = !!o.headRight, detailW = iconOnly ? 40 : 72, detailX = x + w - p - (o.headRight || 0) - detailW;
                const tx = ax + aw + 12, tw2 = x + w - p - tx - (o.headRight || 0) - (hasDetail ? detailW + 8 : 0); let ty = ay;
                if (hasDetail) btn(o.detail, o.detailId, detailX, ay, detailW, iconOnly ? 40 : 30, iconOnly ? '' : '상세', { glyph: 'eye', size: 12, aria: info.title + ' 상세 정보' });
                line(info.ribbon ? info.kindLabel + '  ' + info.ribbon.text : info.kindLabel, tx, ty + 8, tw2, 12, info.ribbon ? info.ribbon.color : info.accent, 'left', 800);
                ty += 20;
                const f = fit(info.title, tw2, 48, 19, 12, 800); ty += para(f, tx, ty, INK, 'left') + 6;
                ty += chipRow(info.chips, tx, ty, tw2, { h: 22, size: 11 });
                const oy = Math.max(ty, ay + ah) + 10;
                optionLines(info, x + p, oy, w - p * 2, y + h - p - bottom - oy);
                return;
            }
            let tx, ty, tw2, artRect;
            if (side) { const aw = Math.min(w * .42, h - p * 2 - bottom); artRect = [x + p, y + p, aw, h - p * 2 - bottom]; tx = x + p * 2 + aw; ty = y + p; tw2 = w - aw - p * 3; }
            else { const ah = clamp(Math.min(Math.round(h * .46), artRoom), 150, 330); artRect = [x + p, y + p, w - p * 2, ah]; tx = x + p; ty = y + p + ah + 12; tw2 = w - p * 2; }
            const [ax, ay, aw, ah] = artRect; well(ax, ay, aw, ah, 12, rgba(info.accent, .06));
            const g = C.createRadialGradient(ax + aw / 2, ay + ah * .55, 4, ax + aw / 2, ay + ah * .55, Math.max(aw, ah) * .6); g.addColorStop(0, rgba(info.accent, .26)); g.addColorStop(1, rgba(info.accent, 0));
            C.fillStyle = g; cut(ax, ay, aw, ah, 12); C.fill();
            const box = info.card ? fitBox(aw - 24, ah - 24, 399 / 515) : { w: Math.min(aw, ah) * .74, h: Math.min(aw, ah) * .74 };
            A.art(info.art, ax + (aw - box.w) / 2, ay + (ah - box.h) / 2, box.w, box.h, { fx: info.fx, big: true });
            if (info.ribbon) ribbon(info.ribbon.text, ax + aw - 2, ay + 10, info.ribbon.color);
            const maxY = y + h - p - bottom;
            line(info.kindLabel, tx, ty + 9, tw2, 12, info.accent, 'left', 800);
            ty += 22;
            const f = fit(info.title, tw2, Math.min(86, (maxY - ty) * .4), 22, 13, 800); ty += para(f, tx, ty, INK, 'left') + 8;
            ty += chipRow(info.chips, tx, ty, tw2, { h: 24, size: 12 }) + 10;
            optionLines(info, tx, ty, tw2, maxY - ty);
            if (o.detail && info.detail) btn(o.detail, o.detailId, ax + aw - 92 - 8, ay + ah - 40 - 8, 92, 40, '상세', { glyph: 'eye', aria: info.title + ' 상세 정보' });
        }
        // 옵션 줄 전체가 차지할 높이(쪽 나눔 없이).
        function measureLines(info, w) {
            let total = 0, rows = 0;
            for (const l of info.lines) {
                const item = typeof l === 'string' ? { text: l } : l, n = wrap(item.text, w - (item.head ? 0 : 10), item.head ? 12 : 13, item.head ? 800 : 600).length;
                if (item.head && rows) total += 6;
                total += n * 19; rows += n;
            }
            return total;
        }
        // 옵션 줄: 제목 줄은 색과 굵기로 나누고, 넘치면 쪽으로 넘긴다.
        function optionLines(info, x, y, w, h) {
            if (!info.lines.length || h < 20) return;
            const lh = 19, rows = [];
            info.lines.forEach(l => {
                const item = typeof l === 'string' ? { text: l } : l;
                wrap(item.text, w - (item.head ? 0 : 10), item.head ? 12 : 13, item.head ? 800 : 600).forEach((t, i) => rows.push({ ...item, text: t, gap: item.head && i === 0 && rows.length > 0 }));
            });
            const fitRows = n => { let used = 0, k = 0; for (; k < rows.length; k++) { const need = lh + (rows[k].gap ? 6 : 0); if (used + need > n) break; used += need; } return k; };
            let per = fitRows(h), pages = 1, starts = [0];
            if (per < rows.length) {
                const usable = h - 30; starts = [0];
                for (let i = 0; i < rows.length;) { let used = 0, k = i; for (; k < rows.length; k++) { const need = lh + (rows[k].gap && k > i ? 6 : 0); if (used + need > usable) break; used += need; } k = Math.max(k, i + 1); i = k; if (i < rows.length) starts.push(i); }
                pages = starts.length;
            }
            if (S.lineKey !== info.title) { S.lineKey = info.title; S.linePage = 0; }
            S.linePage = clamp(S.linePage || 0, 0, pages - 1);
            const from = starts[S.linePage], to = S.linePage + 1 < pages ? starts[S.linePage + 1] : rows.length;
            let yy = y;
            rows.slice(from, to).forEach((r, i) => {
                if (r.gap && i > 0) yy += 6;
                if (r.head) { gem(x + 3, yy + lh / 2, 3, r.color || acc); text(r.text, x + 11, yy + lh / 2, 12, r.color || INK, 'left', 800); }
                else text(r.text, x + 10, yy + lh / 2, 13, r.color || DIM, 'left', 600);
                yy += lh;
            });
            if (pages > 1) {
                const py = y + h - 26;
                btn('lines-previous', '', x + w - 104, py, 36, 26, '', { glyph: 'prev', disabled: S.linePage <= 0, aria: '이전 옵션' });
                text((S.linePage + 1) + ' / ' + pages, x + w - 52, py + 13, 11, DIM, 'center', 700);
                btn('lines-next', '', x + w - 36, py, 36, 26, '', { glyph: 'next', disabled: S.linePage >= pages - 1, aria: '다음 옵션' });
            }
        }
        // 재화 판: 아이콘, 이름, 전체 금액.
        function coin(goods, amount, x, y, w, h, o = {}) {
            const c = CURRENCY[goods] || { label: o.label || goods, color: INK };
            plate(x, y, w, h, 7, { a: .78, edge: .7, tint: c.color, tintA: .1 });
            const isz = Math.min(h - 10, 30); A.currency(goods, x + 8, y + (h - isz) / 2, isz);
            const lx = x + 14 + isz;
            if (o.sub) { text(o.label || c.label, lx, y + h * .34, 12, DIM, 'left', 700); line(o.sub, lx, y + h * .7, w - isz - 24 - tw(fmt(amount), 16, 800), 11, MUTE, 'left', 600, 9); }
            else text(o.label || c.label, lx, y + h / 2, 13, DIM, 'left', 700);
            line(fmt(amount), x + w - 10, y + h / 2 + .5, w - isz - 70, 17, o.color || c.color, 'right', 800, 12);
        }
        function face(player, x, y, size, color) {
            C.save(); C.beginPath(); C.arc(x + size / 2, y + size / 2, size / 2, 0, 7); C.fillStyle = 'rgba(2,4,8,.7)'; C.fill(); C.clip();
            const art = player && player.mainCard && player.mainCard.imageUrl;
            if (art) A.cover(art, x, y - size * .06, size, size * 1.29, .18);
            else text((player && player.name || '?').slice(0, 1), x + size / 2, y + size / 2, size * .42, INK, 'center', 800);
            C.restore();
            C.beginPath(); C.arc(x + size / 2, y + size / 2, size / 2, 0, 7); C.lineWidth = 2; C.strokeStyle = steel(x, y, size, size, 1); C.stroke();
            C.beginPath(); C.arc(x + size / 2, y + size / 2, size / 2 + 3, 0, 7); C.lineWidth = 1.2; C.strokeStyle = rgba(color || acc, .7); C.stroke();
        }
        function modal(title, w, h, o = {}) {
            C.fillStyle = 'rgba(3,5,9,.7)'; C.fillRect(0, 0, A.w, A.h);
            A.shade(); // 가려진 그림의 재질 효과와 입력칸이 겹창 위로 비치지 않게 한다.
            w = Math.min(A.w - 16, w); h = Math.min(A.h - 16, h); const x = Math.round((A.w - w) / 2), y = Math.round((A.h - h) / 2);
            plate(x, y, w, h, 18, { a: .985, tint: o.tint || acc });
            gem(x + 24, y + 30, 5, o.tint || acc); line(title, x + 38, y + 30, w - 38 - (o.close ? 64 : 22), 19, INK, 'left', 800); rule(x + 20, y + 54, w - 40, 1, o.tint || acc);
            if (o.close) btn(o.close, '', x + w - 56, y + 10, 44, 40, '', { glyph: 'close', aria: '닫기' });
            return { x, y, w, h };
        }
        // 알림, 확인 창: { title, lines, rows(품목 정체), actions: [{ action, label, primary, danger }] }
        function dialog(d) {
            const w = Math.min(A.w - 16, d.wide ? 560 : 440), iw = w - 36, rows = d.rows || [], rowH = 60;
            const f = fit((d.lines || []).join('\n'), iw, 220, 15, 11, 600), rowsH = Math.min(rows.length, 5) * (rowH + 6);
            const M = modal(d.title, w, 64 + f.lines.length * f.lh + (rows.length ? rowsH + 12 : 0) + 18 + 50 + 18, { tint: d.tint });
            let y = M.y + 66; y += para(f, M.x + 18, y, d.error ? WARN : INK, 'left');
            if (rows.length) {
                y += 12;
                rows.slice(0, 5).forEach(info => { mini(info, M.x + 18, y, iw, rowH); y += rowH + 6; });
                if (rows.length > 5) text('외 ' + (rows.length - 5) + '개', M.x + M.w - 18, y - 4, 12, DIM, 'right', 700);
            }
            const acts = d.actions || [{ action: 'dialog-close', label: '확인', primary: true }], gap = 10, bw = (iw - gap * (acts.length - 1)) / acts.length;
            acts.forEach((a, i) => btn(a.action, a.id ?? '', M.x + 18 + i * (bw + gap), M.y + M.h - 68, bw, 50, a.label, { primary: a.primary, danger: a.danger, size: 17 }));
        }
        // 한 줄짜리 품목: 그림, 이름, 꼬리표.
        function mini(info, x, y, w, h, o = {}) {
            well(x, y, w, h, 7, rgba(info.accent, .06));
            const as = h - 10, box = info.card ? fitBox(as, as, 399 / 515) : { w: as, h: as };
            A.art(info.art, x + 5 + (as - box.w) / 2, y + 5 + (as - box.h) / 2, box.w, box.h, { fx: info.fx });
            const tx = x + as + 14, right = o.right ? tw(o.right, 15, 800) + 16 : 0, tw2 = w - as - 22 - right - (o.remove ? 44 : 0);
            const f = fit(info.title, tw2, h * .52, 15, 10, 700); para(f, tx, y + 4 + (h * .55 - f.lines.length * f.lh) / 2, INK, 'left');
            chipRow(info.chips.filter(c => !o.right || c.text !== o.right), tx, y + h - 24, tw2, { h: 18, size: 10, single: true });
            if (o.right) text(o.right, x + w - 10 - (o.remove ? 44 : 0), y + h / 2, 15, o.rightColor || GOLD, 'right', 800);
            if (o.remove) btn(o.remove, o.id, x + w - 42, y + (h - 36) / 2, 36, 36, '', { glyph: 'close', aria: info.title + ' 빼기' });
        }
        return { C, S, acc, INK, DIM, MUTE, GOLD, WARN, GOOD, fmt, clamp, rgba, font, tw, text, line, wrap, fit, para, cut, steel, plate, well, gem, rule, brackets, glyph, ring, btn, pager, chip, chipRow, ribbon, slot, inspect, coin, face, modal, dialog, mini, fitBox };
    }

    // ── 보관함(품목 고르기): 거래와 메일이 함께 쓴다.
    // config.kinds: [{ key, label, currency?, balance?, entries?, filters?(entry → 분류 이름), quantity?(entry → 최대 수량) }]
    function createPicker(config) {
        return { config, kind: config.start || config.kinds[0].key, page: 0, perPage: 1, filter: '전체', query: '', selected: null, amount: '', error: '', mobileDetail: false };
    }
    function pickerList(P) {
        const kind = P.config.kinds.find(k => k.key === P.kind); if (!kind || kind.currency) return { kind, list: [], filters: [] };
        const all = kind.entries || [], filters = ['전체', ...new Set(all.map(e => kind.filter ? kind.filter(e) : null).filter(Boolean))];
        if (!filters.includes(P.filter)) P.filter = '전체';
        const q = P.query.trim().toLowerCase();
        const list = all.filter(e => (P.filter === '전체' || kind.filter(e) === P.filter) && (!q || [e.info.title, ...e.info.chips.map(c => c.text)].join(' ').toLowerCase().includes(q)));
        return { kind, list, filters };
    }
    function pickerAct(P, action, id) {
        P.done = '';
        switch (action) {
            case 'picker-kind': P.kind = id; P.page = 0; P.filter = '전체'; P.selected = null; P.amount = ''; P.error = ''; P.mobileDetail = false; return true;
            case 'picker-filter': P.filter = id; P.page = 0; return true;
            case 'picker-pick': P.selected = id; P.amount = ''; P.error = ''; P.mobileDetail = true; return true;
            case 'picker-next': P.page += 1; return true;
            case 'picker-previous': P.page = Math.max(0, P.page - 1); return true;
            case 'picker-back': P.mobileDetail = false; return true;
            case 'picker-max': { const max = pickerMax(P); if (max > 0) P.amount = String(max); return true; }
            case 'picker-add': { const add = Number(id); const cur = Number(P.amount) || 0, max = pickerMax(P); P.amount = String(Math.max(0, Math.min(max, cur + add))); return true; }
        }
        return false;
    }
    function pickerSelected(P) { const { kind } = pickerList(P); return kind && !kind.currency ? (kind.entries || []).find(e => e.key === P.selected) || null : null; }
    function pickerMax(P) {
        const kind = P.config.kinds.find(k => k.key === P.kind); if (!kind) return 0;
        if (kind.currency) return Math.max(0, Number(kind.balance) || 0);
        const e = pickerSelected(P); return e ? Math.max(0, Number(kind.quantity ? kind.quantity(e) : 1) || 0) : 0;
    }
    function drawPicker(K, A, P, o = {}) {
        const { C } = K, W = A.w, H = A.h, mobile = W < 760;
        const M = K.modal(P.config.title, mobile ? W - 8 : Math.min(1080, W - 40), mobile ? H - 8 : Math.min(760, H - 32), { close: 'picker-close', tint: o.tint });
        const p = mobile ? 12 : 18, { kind, list, filters } = pickerList(P), kinds = P.config.kinds;
        let y = M.y + 66;
        // 종류 탭
        // 탭 이름이 한 줄에 안 들어가면 탭을 두 줄로 나눈다(글자가 세로로 끊기지 않게).
        const tabSize = mobile ? 13 : 15, tabFits = n => { const tw0 = (M.w - p * 2 - 6 * (n - 1)) / n; return kinds.every(k => K.tw(k.label, tabSize, 700) + 22 <= tw0); };
        const tabRows = tabFits(kinds.length) ? 1 : 2, perRow = Math.ceil(kinds.length / tabRows);
        const tabW = (M.w - p * 2 - 6 * (perRow - 1)) / perRow, tabH = mobile ? (tabRows > 1 ? 38 : 42) : 46;
        kinds.forEach((k, i) => K.btn('picker-kind', k.key, M.x + p + (i % perRow) * (tabW + 6), y + Math.floor(i / perRow) * (tabH + 6), tabW, tabH, k.label, {
            on: k.key === P.kind, pressed: k.key === P.kind, icon: k.currency && tabW >= 96 ? k.key : null, size: tabSize, color: k.color,
            badge: !k.currency && !mobile ? String((k.entries || []).length) : null, aria: k.label + (k.currency ? '' : ' ' + (k.entries || []).length + '개') }));
        y += tabRows * (tabH + 6) + 4;
        const foot = M.y + M.h - p;
        if (kind && kind.currency) { drawAmountPanel(K, A, P, kind, M.x + p, y, M.w - p * 2, foot - y, o); return; }
        // 분류와 검색
        const searchW = mobile ? M.w - p * 2 : Math.min(260, (M.w - p * 2) * .3);
        K.well(M.x + p, y, searchW, 40, 6); K.glyph('search', M.x + p + 18, y + 20, 14, K.DIM);
        A.field('picker-search', M.x + p + 32, y + 2, searchW - 36, 36, { value: P.query, placeholder: '이름, 등급, 성급 검색', label: '보관함 검색', maxLength: 30 });
        const inspW0 = mobile ? 0 : Math.min(400, Math.round((M.w - p * 2) * .38)), rowY = y;
        let fy = y, fx0 = M.x + p + searchW + 10, fw = M.w - p * 2 - searchW - 10 - (inspW0 ? inspW0 + 14 : 0);
        if (mobile) { fy = y + 48; fx0 = M.x + p; fw = M.w - p * 2; }
        // 분류 버튼이 한 줄에 다 안 들어가면 다음 줄로 넘긴다(두 줄째는 격자 폭 전체를 쓴다).
        let fx = fx0, rowStart = fx0, rowEnd = fx0 + fw, lines = 1;
        const gridRight = M.x + M.w - p - (inspW0 ? inspW0 + 14 : 0);
        for (const f of filters) {
            const bw = K.tw(f, 13, 700) + 26;
            if (fx + bw > rowEnd) { if (lines >= 2) break; lines++; fy += 46; rowStart = M.x + p; rowEnd = gridRight; fx = rowStart; }
            K.btn('picker-filter', f, fx, fy, bw, 40, f, { on: P.filter === f, pressed: P.filter === f, size: 13 }); fx += bw + 6;
        }
        y = fy + 50;
        const sel = pickerSelected(P), inspW = mobile ? 0 : Math.min(400, Math.round((M.w - p * 2) * .38));
        const gx = M.x + p, gw = M.w - p * 2 - (inspW ? inspW + 14 : 0), gh = foot - y - 54 - (mobile && sel ? 0 : 0);
        // 격자
        const minW = mobile ? 0 : 128, cols = mobile ? Math.max(2, Math.floor(gw / 150)) : Math.max(2, Math.floor((gw + 10) / (minW + 10)));
        const ch0 = P.kind === 'card' ? 196 : 164, rows = Math.max(1, Math.floor((gh + 10) / (ch0 + 10))), per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per));
        P.perPage = per; P.page = K.clamp(P.page, 0, pages - 1);
        const cw = (gw - 10 * (cols - 1)) / cols, ch = Math.min(ch0 * 1.25, (gh - 10 * (rows - 1)) / rows);
        if (!list.length) { K.well(gx, y, gw, gh, 10); K.text(P.query || P.filter !== '전체' ? '맞는 품목이 없습니다' : o.emptyText || '보낼 수 있는 품목이 없습니다', gx + gw / 2, y + gh / 2, 15, K.DIM, 'center', 600); }
        list.slice(P.page * per, P.page * per + per).forEach((e, i) => {
            K.slot(e.info, gx + (i % cols) * (cw + 10), y + Math.floor(i / cols) * (ch + 10), cw, ch, { action: 'picker-pick', id: e.key, on: e.key === P.selected, small: mobile });
        });
        K.pager(gx, foot - 44, gw, P.page, pages, 'picker-previous', 'picker-next');
        if (!mobile) {
            const ix = M.x + M.w - p - inspW, actH = sel ? (kind.quantity ? 168 : 112) + (P.config.extraHeight ? P.config.extraHeight(kind, sel) : 0) : 112;
            K.inspect(sel && sel.info, ix, rowY, inspW, foot - rowY, { bottom: actH, detail: sel && o.detailAction, detailId: sel && sel.key });
            if (sel) drawPickAction(K, A, P, kind, sel, ix + 16, foot - actH + 6, inspW - 32, o);
        } else if (sel && P.mobileDetail) {
            // 휴대폰: 고른 품목을 아래에서 올라오는 판으로 보여 준다.
            const sh = Math.min(H - 24, (kind.quantity ? 520 : 450) + (P.config.extraHeight ? P.config.extraHeight(kind, sel) : 0)), sx = M.x + 4, sy = M.y + M.h - sh - 4;
            C.fillStyle = 'rgba(3,5,9,.55)'; C.fillRect(M.x, M.y, M.w, M.h); A.shade();
            const actH = (kind.quantity ? 160 : 104) + (P.config.extraHeight ? P.config.extraHeight(kind, sel) : 0);
            K.inspect(sel.info, sx, sy, M.w - 8, sh, { bottom: actH, detail: o.detailAction, detailId: sel.key, a: .985, headRight: 56 });
            K.btn('picker-back', '', sx + M.w - 8 - 52, sy + 8, 44, 40, '', { glyph: 'close', aria: '고르기 취소' });
            drawPickAction(K, A, P, kind, sel, sx + 16, sy + sh - actH + 4, M.w - 40, o);
        }
    }
    function drawPickAction(K, A, P, kind, sel, x, y, w, o) {
        let yy = y;
        if (P.config.extra) yy = P.config.extra(K, A, P, kind, sel, x, yy, w);
        if (kind.quantity) {
            const max = kind.quantity(sel);
            K.text('수량', x, yy + 10, 12, K.DIM, 'left', 700); K.text('최대 ' + K.fmt(max), x + w, yy + 10, 12, K.DIM, 'right', 700); yy += 22;
            K.well(x, yy, w - 74, 44, 6); A.field('picker-amount', x + 8, yy + 2, w - 90, 40, { value: P.amount, placeholder: '1', numeric: true, label: sel.info.title + ' 수량', maxLength: 12, big: true });
            K.btn('picker-max', '', x + w - 66, yy, 66, 44, '최대', { disabled: max <= 0 }); yy += 52;
        }
        if (P.error) { K.line(P.error, x, yy + 8, w, 13, K.WARN, 'left', 700, 10); yy += 20; }
        else if (P.done) { K.line('올림  ' + P.done, x, yy + 8, w, 13, K.GOOD, 'left', 700, 10); yy += 20; }
        K.btn('picker-submit', '', x, Math.max(yy, y + (kind.quantity ? 0 : 20)), w, 50, P.config.submitLabel || '올리기', { primary: true, size: 18, aria: sel.info.title + ' ' + (P.config.submitLabel || '올리기') });
    }
    function drawAmountPanel(K, A, P, kind, x, y, w, h, o) {
        const cw = Math.min(520, w), cx = x + (w - cw) / 2, bal = Number(kind.balance) || 0, isz = Math.min(120, h * .28);
        K.well(x, y, w, h, 12, K.rgba(CURRENCY[kind.key] ? CURRENCY[kind.key].color : K.acc, .05));
        let yy = y + Math.max(16, (h - isz - 300) / 2);
        A.art({ iconUrl: kind.icon }, x + (w - isz) / 2, yy, isz, isz, { fx: { code: FX.coin, strength: .9, hue: hueOf(CURRENCY[kind.key] ? CURRENCY[kind.key].color : '#ffd873') }, big: true });
        yy += isz + 14;
        K.text('보유 ' + K.fmt(bal) + (kind.reserved ? '  이미 담음 ' + K.fmt(kind.reserved) : ''), x + w / 2, yy, 15, K.DIM, 'center', 700); yy += 22;
        K.well(cx, yy, cw, 56, 8); A.field('picker-amount', cx + 12, yy + 4, cw - 24, 48, { value: P.amount, placeholder: '0', numeric: true, label: kind.label + ' 수량', maxLength: 16, big: true, center: true }); yy += 64;
        const steps = kind.steps || [10000, 100000, 1000000], bw = (cw - 6 * steps.length) / (steps.length + 1);
        steps.forEach((s, i) => K.btn('picker-add', s, cx + i * (bw + 6), yy, bw, 40, '+' + (s >= 10000 ? K.fmt(s / 10000) + '만' : K.fmt(s)), { size: 13, disabled: bal <= 0 }));
        K.btn('picker-max', '', cx + steps.length * (bw + 6), yy, bw, 40, '전부', { size: 13, disabled: bal <= 0 }); yy += 50;
        const note = o.amountNote ? o.amountNote(kind, Number(P.amount) || 0) : '';
        if (P.error) { K.line(P.error, x + w / 2, yy + 8, cw, 14, K.WARN, 'center', 700); yy += 24; }
        else if (note) { K.line(note, x + w / 2, yy + 8, cw, 14, K.GOLD, 'center', 700); yy += 24; }
        K.btn('picker-submit', '', cx, Math.min(yy + 4, y + h - 62), cw, 52, P.config.submitLabel || '올리기', { primary: true, size: 18, aria: kind.label + ' ' + (P.config.submitLabel || '올리기') });
    }

    // ── 셰이더: 배경(화면별)과 재질 지도에 따른 광택
    const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const FS = `precision mediump float;
        varying vec2 uv;uniform sampler2D ui;uniform sampler2D fx;uniform float t;uniform vec2 size;uniform vec2 pointer;
        uniform vec3 accent;uniform vec3 accent2;uniform float theme;uniform float glow;uniform float seam;uniform float pulse;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
        vec3 hsv(float h,float s,float v){vec3 k=clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);return v*mix(vec3(1.),k,s);}
        vec3 backdrop(vec2 px){
            vec2 q=px/max(size.y,1.);vec3 c=vec3(.022,.026,.036);
            float grain=noise(px*.6)*.012+noise(q*9.+vec2(t*.01,0.))*.018;c+=grain;
            if(theme<.5){
                // 거래: 위는 상대의 등불, 아래는 내 등불. 가운데 이음선으로 빛 알갱이가 양쪽에서 흘러든다.
                float top=exp(-pow((px.y)/(size.y*.55),2.))*(.10+.03*sin(t*.7));
                float bot=exp(-pow((size.y-px.y)/(size.y*.55),2.))*(.10+.03*sin(t*.6+1.3));
                c+=accent2*top+accent*bot;
                float dy=(px.y-seam)/max(size.y,1.);
                float band=exp(-dy*dy*900.);
                float flow=0.;
                for(int i=0;i<18;i++){float f=float(i);float sp=.04+hash(vec2(f,1.))*.05;float side=step(.5,hash(vec2(f,9.)));
                    float x=fract(hash(vec2(f,3.))+t*sp);x=mix(x*.5,1.-x*.5,side);
                    vec2 d=vec2(px.x/size.x-x,dy*2.5);float r=length(d*vec2(size.x/size.y,1.));flow+=smoothstep(.006,0.,r)*(.6+.4*sin(t*3.+f));}
                vec3 gold=vec3(1.,.82,.45);
                c+=mix(vec3(.55,.62,.75),gold,glow)*(band*(.05+.10*glow+.04*pulse)+flow*(.18+.4*glow));
            } else if(theme<1.5){
                // 메일: 어두운 우편소 위로 항로가 지나가고, 점선 위로 우편물이 천천히 움직인다.
                for(int i=0;i<5;i++){float f=float(i);
                    vec2 cen=vec2(hash(vec2(f,4.))*1.6-.3,1.3+hash(vec2(f,5.))*.9)*vec2(size.x/size.y,1.);
                    float r=length(q-cen),rad=.9+hash(vec2(f,6.))*.8;float d=abs(r-rad);
                    float ang=atan(q.y-cen.y,q.x-cen.x);float dash=step(.55,fract(ang*38.-t*(.25+hash(vec2(f,7.))*.2)));
                    c+=accent*smoothstep(.0028,0.,d)*dash*.22;
                    float head=fract(t*.035+hash(vec2(f,8.)));float ha=mix(-2.7,-.4,head);vec2 hp=cen+rad*vec2(cos(ha),sin(ha));
                    c+=vec3(1.,.9,.7)*smoothstep(.012,0.,length(q-hp))*.5;}
                float fiber=pow(noise(vec2(q.x*40.,q.y*4.)+t*.02),6.)*.05;c+=vec3(.9,.85,.75)*fiber;
                c+=accent*exp(-pow((px.y)/(size.y*.7),2.))*.05;
            } else {
                // 시장: 위에 늘어진 줄을 따라 등불이 흔들리고, 바닥에는 따뜻한 빛이 고인다.
                float aspect=size.x/max(size.y,1.);float n=9.;
                float seg=fract(q.x/aspect*n);float ry=.035+.045*sin(seg*3.14159);
                c+=vec3(.55,.48,.40)*smoothstep(.0018,0.,abs(q.y-ry))*.35;
                for(int i=0;i<9;i++){float f=float(i);
                    vec2 lp=vec2((f+.5)/n*aspect+sin(t*.55+f*1.7)*.006,.08+.012*sin(t*.8+f));
                    float d=length(q-lp);vec3 lc=mix(accent,accent2,mod(f,2.));
                    float flick=.85+.15*sin(t*2.3+f*3.1);
                    c+=lc*(smoothstep(.016,.0,d)*.9+exp(-d*d*60.)*.07)*flick;}
                c+=mix(accent,accent2,.5)*exp(-pow((size.y-px.y)/(size.y*.45),2.))*.06;
            }
            return c;
        }
        // 둥근 반짝임: 칸마다 한 점이 가끔 빛나고 짧은 십자 빛이 붙는다.
        float glint(vec2 px,float size,float density,float speed){
            vec2 cell=floor(px/size);float h=hash(cell);if(h<density)return 0.;
            vec2 f=(fract(px/size)-.5)*size;float tw=pow(.5+.5*sin(t*speed+h*60.),10.);
            float core=smoothstep(1.8,0.,length(f));
            float ray=smoothstep(.8,0.,abs(f.x))*smoothstep(size*.42,0.,abs(f.y))+smoothstep(.8,0.,abs(f.y))*smoothstep(size*.42,0.,abs(f.x));
            return (core+ray*.45)*tw;
        }
        vec3 material(vec3 col,vec4 m,vec2 px){
            float code=floor(m.r*8.+.5),k=m.g,h=m.b;
            vec2 dir=normalize(px-pointer+vec2(.001));float near=exp(-length(px-pointer)/(size.y*.45));
            float sweep=smoothstep(.06,0.,abs(fract((px.x+px.y*.6)/(size.x*.9)-t*.09)-.5)-.36);
            if(code<1.5){ // 일반 카드: 부드러운 광택
                col+=vec3(1.)*sweep*.10*k+vec3(.9,.95,1.)*near*.06*k;
            } else if(code<2.5){ // 전직 카드: 사선 금속박
                float lines=.5+.5*sin((px.x-px.y)*.55+dot(dir,vec2(3.,2.))*2.+t*.6);
                vec3 foil=mix(vec3(1.,.78,.36),vec3(1.,.96,.82),lines);
                col=mix(col,col*foil*1.35,.22*k)+foil*(sweep*.16+near*.08)*k;
            } else if(code<3.5){ // 각성 카드: 무지개 홀로그램과 반짝임
                float hh=fract((px.x*.0035-px.y*.0025)+dot(dir,vec2(.3,.2))+t*.04);
                vec3 holo=hsv(hh,.55,1.);col=mix(col,col*.6+holo*.55,.28*k)+holo*sweep*.14*k;
                col+=vec3(1.)*glint(px,15.,.93,3.)*.9*k;
            } else if(code<4.5){ // 장비, 펫: 등급색 반짝임
                vec3 tint=hsv(h,.7,1.);col+=tint*(sweep*.22+near*.08)*k;
                col+=mix(tint,vec3(1.),.5)*glint(px+7.,17.,.95,2.4)*.8*k;
            } else if(code<5.5){ // 아이템: 유리 반사
                col+=vec3(.85,.95,1.)*sweep*.12*k+vec3(.7,.85,1.)*near*.05*k;
            } else if(code<6.5){ // 재화: 동전 반짝임
                col+=mix(hsv(h,.35,1.),vec3(1.),.4)*glint(px,13.,.9,3.)*1.1*k+vec3(1.,.9,.6)*sweep*.12*k;
            } else { // 인장: 맥박
                col+=hsv(h,.6,1.)*(.18+.18*sin(t*3.))*k;
            }
            return col;
        }
        void main(){
            vec2 px=vec2(uv.x,1.-uv.y)*size;
            vec4 ink=texture2D(ui,uv);vec3 col=mix(backdrop(px),ink.rgb,ink.a);
            vec4 m=texture2D(fx,uv);if(m.a>.5)col=material(col,m,px);
            gl_FragColor=vec4(col,1.);
        }`;
    const THEMES = { trade: 0, mail: 1, market: 2 };
    const hexRgb = hex => String(hex).slice(1).match(/../g).map(v => parseInt(v, 16) / 255);

    // ── 무대 호스트
    function mount(shell, opts) {
        const root = document.createElement('div'); root.className = 'market-stage'; root.dataset.theme = opts.theme;
        const canvas = document.createElement('canvas'); canvas.className = 'market-stage-canvas'; canvas.setAttribute('aria-hidden', 'true');
        const fallback = document.createElement('canvas'); fallback.className = 'market-stage-fallback'; fallback.setAttribute('aria-hidden', 'true');
        const controls = document.createElement('div'); controls.className = 'market-stage-controls'; controls.setAttribute('aria-label', opts.label || '화면 조작');
        const live = document.createElement('div'); live.className = 'market-stage-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
        root.append(canvas, fallback, controls, live); shell.replaceChildren(root); shell.classList.add('market-stage-shell');
        const ui = document.createElement('canvas'), ctx = ui.getContext('2d');
        const fxCanvas = document.createElement('canvas'), fxCtx = fxCanvas.getContext('2d');
        const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d');
        const s = opts.state, images = new Map(), bounds = new WeakMap(), buttons = new Map(), fields = new Map(), audio = {};
        let gl, program, buffer, uiTex, fxTex, uniforms, lost = false, disposed = false, dirty = true, again = false, visible = true;
        let width = 0, height = 0, dpr = 1, raf = 0, lastGl = 0, regions = [], fieldSpecs = [], pointer = null, pulseAt = 0;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const invalidate = () => { if (!disposed) { dirty = true; schedule(); } };
        function image(url) {
            if (!url) return null;
            if (!images.has(url)) { const img = new Image(); if (new URL(url, location.href).origin !== location.origin) img.crossOrigin = 'anonymous'; img.onload = invalidate; img.onerror = invalidate; img.src = url; images.set(url, img); }
            const img = images.get(url); return img.complete && img.naturalWidth ? img : null;
        }
        function trim(img) {
            if (!bounds.has(img)) {
                try {
                    const probe = document.createElement('canvas'); probe.width = probe.height = 96; const p = probe.getContext('2d', { willReadFrequently: true }); p.drawImage(img, 0, 0, 96, 96);
                    const px = p.getImageData(0, 0, 96, 96).data; let l = 96, t = 96, r = -1, b = -1;
                    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (px[(y * 96 + x) * 4 + 3] > 28) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
                    bounds.set(img, r < l ? [0, 0, img.naturalWidth, img.naturalHeight] : [l / 96 * img.naturalWidth, t / 96 * img.naturalHeight, (r - l + 1) / 96 * img.naturalWidth, (b - t + 1) / 96 * img.naturalHeight]);
                } catch (_) { bounds.set(img, [0, 0, img.naturalWidth, img.naturalHeight]); }
            }
            return bounds.get(img);
        }
        // 그림을 그리고, 같은 모양으로 재질 지도에 번호를 칠한다.
        function paint(img, sx, sy, sw, sh, dx, dy, dw, dh, o) {
            ctx.save(); if (o.dim) { ctx.globalAlpha = .4; ctx.filter = 'grayscale(1)'; } ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); ctx.restore();
            if (!o.fx || o.dim || !gl) return;
            const f = .5 * dpr, w = Math.max(1, Math.ceil(dw * f)), h = Math.max(1, Math.ceil(dh * f));
            if (scratch.width < w) scratch.width = w; if (scratch.height < h) scratch.height = h;
            sctx.globalCompositeOperation = 'copy'; sctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            sctx.globalCompositeOperation = 'source-in';
            sctx.fillStyle = `rgb(${Math.round(o.fx.code / 8 * 255)},${Math.round(Math.min(1, o.fx.strength) * 255)},${Math.round((o.fx.hue || 0) * 255)})`; sctx.fillRect(0, 0, w, h);
            sctx.globalCompositeOperation = 'source-over';
            fxCtx.drawImage(scratch, 0, 0, w, h, dx * f, dy * f, w, h);
        }
        function contain(url, x, y, w, h, o = {}) {
            const img = image(url); if (!img || w <= 0 || h <= 0) return null;
            const sc = Math.min(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
            paint(img, 0, 0, img.naturalWidth, img.naturalHeight, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, o); return img;
        }
        function icon(url, x, y, w, h, o = {}) {
            const img = image(url); if (!img) return null;
            const [sx, sy, sw, sh] = trim(img), sc = Math.min(w / sw, h / sh) * .9;
            paint(img, sx, sy, sw, sh, x + (w - sw * sc) / 2, y + (h - sh * sc) / 2, sw * sc, sh * sc, o); return img;
        }
        function art(d, x, y, w, h, o = {}) {
            if (!d) return;
            if (d.frameUrl) contain(d.frameUrl, x, y, w, h, { dim: o.dim });
            const url = d.imageUrl || d.iconUrl || d.imgUrl;
            if (url) { if (!(d.imageUrl ? contain : d.frameUrl ? contain : icon)(url, x, y, w, h, o)) { ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = '#9fb3c8'; ctx.fillRect(x + w * .3, y + h * .3, w * .4, h * .4); ctx.restore(); } }
            else if (d.label) { ctx.save(); ctx.fillStyle = '#c9d6e3'; ctx.font = '700 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.label, x + w / 2, y + h / 2); ctx.restore(); }
        }
        function cover(url, x, y, w, h, focusY = .2) {
            const img = image(url); if (!img) return;
            const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / sc, sh = h / sc;
            ctx.drawImage(img, (img.naturalWidth - sw) / 2, Math.max(0, (img.naturalHeight - sh) * focusY), sw, sh, x, y, w, h);
        }
        const currencyIcon = goods => goods === 'gold' || goods === 'garnet' || goods === 'point' ? (opts.currencyIcons || {})[goods] : goods === 'ticket' ? (opts.currencyIcons || {}).ticket : goods;
        function currency(goods, x, y, size) { if (!icon(currencyIcon(goods), x, y, size, size)) { ctx.save(); ctx.fillStyle = '#b8d3e2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(size * .6) + 'px sans-serif'; ctx.fillText('◇', x + size / 2, y + size / 2); ctx.restore(); } }
        function hit(action, id, x, y, w, h, label, disabled = false, pressed = false) { if (w > 0 && h > 0) regions.push({ action, id: String(id ?? ''), x, y, w, h, label: String(label || action), disabled: disabled || !!s.busy, pressed }); }
        function field(key, x, y, w, h, o = {}) { fieldSpecs.push({ key, x, y, w, h, o }); }
        function syncControls() {
            const keys = new Set();
            for (const r of regions) {
                const key = r.action + ':' + r.id; keys.add(key); let b = buttons.get(key);
                if (!b) {
                    b = document.createElement('button'); b.type = 'button'; b.dataset.action = r.action; b.dataset.id = r.id;
                    b.onclick = () => { if (!disposed && !s.busy) opts.onAct(b.dataset.action, b.dataset.id); };
                    b.onpointerenter = () => { s.hover = key; invalidate(); }; b.onpointerleave = () => { if (s.hover === key) { s.hover = ''; invalidate(); } };
                    b.onfocus = () => { s.focus = key; invalidate(); }; b.onblur = () => { if (s.focus === key) { s.focus = ''; invalidate(); } };
                    controls.append(b); buttons.set(key, b);
                }
                const box = `${r.x},${r.y},${r.w},${r.h}`; if (b.dataset.box !== box) { b.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; b.dataset.box = box; }
                if (b.getAttribute('aria-label') !== r.label) b.setAttribute('aria-label', r.label);
                if (b.disabled !== r.disabled) b.disabled = r.disabled;
                if (b.getAttribute('aria-pressed') !== String(!!r.pressed)) b.setAttribute('aria-pressed', String(!!r.pressed));
            }
            for (const [key, b] of buttons) if (!keys.has(key)) { if (s.hover === key) s.hover = ''; b.remove(); buttons.delete(key); }
            const fkeys = new Set();
            for (const f of fieldSpecs) {
                fkeys.add(f.key); let el = fields.get(f.key);
                const multi = !!f.o.multiline;
                if (!el || (el.tagName === 'TEXTAREA') !== multi) {
                    el?.remove(); el = document.createElement(multi ? 'textarea' : 'input');
                    if (!multi) { el.type = 'text'; el.autocomplete = 'off'; }
                    el.className = 'market-stage-field'; el.spellcheck = false;
                    el.addEventListener('input', () => { opts.onField(f.key, el.value); });
                    el.addEventListener('keydown', event => { if (event.key === 'Enter' && !multi) { event.preventDefault(); opts.onField(f.key, el.value, 'enter'); } if (event.key === 'Escape') { event.stopPropagation(); el.blur(); } });
                    el.addEventListener('blur', () => opts.onField(f.key, el.value, 'blur'));
                    controls.append(el); fields.set(f.key, el);
                }
                const box = `${f.x},${f.y},${f.w},${f.h}`; if (el.dataset.box !== box) { el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px`; el.dataset.box = box; }
                el.classList.toggle('big', !!f.o.big); el.classList.toggle('center', !!f.o.center);
                el.placeholder = f.o.placeholder || ''; el.maxLength = f.o.maxLength || 200; el.setAttribute('aria-label', f.o.label || f.key);
                el.inputMode = f.o.numeric ? 'numeric' : 'text'; el.disabled = !!s.busy;
                const value = String(f.o.value ?? ''); if (document.activeElement !== el && el.value !== value) el.value = value;
                if (f.o.focus && !s._focused?.[f.key]) { (s._focused ||= {})[f.key] = true; setTimeout(() => el.focus({ preventScroll: true }), 30); }
            }
            for (const [key, el] of fields) if (!fkeys.has(key)) { el.remove(); fields.delete(key); if (s._focused) delete s._focused[key]; }
        }
        function initGl() {
            try {
                gl ||= canvas.getContext('webgl', { alpha: false, depth: false, stencil: false, antialias: false, powerPreference: 'low-power' });
                if (!gl || gl.isContextLost()) return false;
                const shader = (type, code) => { const o = gl.createShader(type); gl.shaderSource(o, code); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn('[market-stage]', gl.getShaderInfoLog(o)); throw new Error('shader'); } return o; };
                program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
                gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
                const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
                const tex = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, t);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); return t; };
                uiTex = tex(gl.TEXTURE0, gl.LINEAR); fxTex = tex(gl.TEXTURE1, gl.NEAREST);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                uniforms = Object.fromEntries(['ui', 'fx', 't', 'size', 'pointer', 'accent', 'accent2', 'theme', 'glow', 'seam', 'pulse'].map(k => [k, gl.getUniformLocation(program, k)]));
                gl.uniform1i(uniforms.ui, 0); gl.uniform1i(uniforms.fx, 1);
                lost = false; root.dataset.gl = 'ready'; canvas.hidden = false; fallback.hidden = true; dirty = true; return true;
            } catch (_) { release(); return false; }
        }
        function release() { if (!gl || gl.isContextLost()) return; [uiTex, fxTex].forEach(t => t && gl.deleteTexture(t)); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); uiTex = fxTex = buffer = program = null; }
        function fallbackMode() { root.dataset.gl = 'fallback'; fallback.hidden = false; canvas.hidden = true; program = null; dirty = true; }
        function resize() {
            if (disposed) return;
            const top = shell.getBoundingClientRect().top, bottom = document.querySelector('.bottom-tabs');
            const bottomH = bottom && getComputedStyle(bottom).display !== 'none' ? bottom.getBoundingClientRect().height : 0;
            const nextW = Math.round(shell.clientWidth), nextH = Math.max(300, Math.floor((visualViewport?.height || innerHeight) - Math.max(0, top) - bottomH));
            if (width === nextW && nextH < height && controls.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
            const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4000000 / Math.max(1, nextW * nextH)));
            if (width === nextW && height === nextH && dpr === ratio) return;
            width = nextW; height = nextH; dpr = ratio; root.style.height = height + 'px';
            for (const c of [canvas, fallback, ui]) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
            fxCanvas.width = Math.max(1, Math.round(width * dpr * .5)); fxCanvas.height = Math.max(1, Math.round(height * dpr * .5));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (gl && uiTex && !gl.isContextLost()) {
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, uiTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ui.width, ui.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fxTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fxCanvas.width, fxCanvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }
            invalidate();
        }
        const A = { ctx, s, art, shade: () => { fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); fieldSpecs = []; regions = []; }, icon: (url, x, y, w, h) => icon(currencyIcon(url), x, y, w, h), cover, currency, hit, field, get w() { return width; }, get h() { return height; },
            again() { again = true; }, uniforms: { glow: 0, seam: 0, accent: '#6fb4ff', accent2: '#ff9a6b' } };
        function paintUi(time) {
            regions = []; fieldSpecs = []; again = false;
            ctx.clearRect(0, 0, width, height); fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
            if (!gl || lost || !program) { const g = ctx.createLinearGradient(0, 0, 0, height); g.addColorStop(0, '#0d1118'); g.addColorStop(1, '#06080c'); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); }
            A.time = time; A.reduced = reduced.matches; A.accent = A.uniforms.accent;
            opts.draw(A, kit(A));
            syncControls();
            if (gl && program && !lost) {
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, uiTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ui);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fxTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, fxCanvas);
            }
        }
        function composite(time) {
            if (gl && program && !lost) {
                const u = A.uniforms, t = reduced.matches ? 0 : time / 1000;
                gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program);
                gl.uniform1f(uniforms.t, t); gl.uniform2f(uniforms.size, width, height);
                const ptr = pointer || [width * (.5 + .35 * Math.cos(t * .4)), height * (.35 + .2 * Math.sin(t * .31))];
                gl.uniform2f(uniforms.pointer, ptr[0], ptr[1]);
                gl.uniform3fv(uniforms.accent, hexRgb(u.accent)); gl.uniform3fv(uniforms.accent2, hexRgb(u.accent2));
                gl.uniform1f(uniforms.theme, THEMES[opts.theme] || 0); gl.uniform1f(uniforms.glow, u.glow || 0); gl.uniform1f(uniforms.seam, u.seam || height / 2);
                gl.uniform1f(uniforms.pulse, Math.max(0, 1 - (time - pulseAt) / 900));
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            } else { const f = fallback.getContext('2d'); f.setTransform(1, 0, 0, 1, 0, 0); f.drawImage(ui, 0, 0); }
        }
        function schedule() { if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(tick); }
        function tick(time) {
            raf = 0; if (disposed || !visible || document.hidden) return;
            const animate = !!(gl && program && !lost) && !reduced.matches;
            if (dirty || again) { dirty = false; paintUi(time); composite(time); lastGl = time; }
            else if (animate && time - lastGl >= 33) { composite(time); lastGl = time; }
            if (animate || again || dirty) schedule();
        }
        const visibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; silence(); } else invalidate(); };
        const keydown = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open], .msg-modal-bg, #modalBg.active, .fusion-overlay')) { event.preventDefault(); opts.onAct('back', ''); } };
        const move = event => { const r = root.getBoundingClientRect(); pointer = [event.clientX - r.left, event.clientY - r.top]; };
        const leave = () => { pointer = null; };
        const loss = event => { event.preventDefault(); lost = true; fallbackMode(); invalidate(); };
        const restore = () => { if (!disposed) { if (!initGl()) fallbackMode(); resize(); invalidate(); } };
        function play(name) {
            if (disposed || document.hidden || !SOUND_VOLUME[name]) return;
            const clip = audio[name] ||= new Audio('/static/assets/market-stage/' + name + '.mp3');
            clip.volume = SOUND_VOLUME[name]; try { clip.currentTime = 0; } catch (_) {} clip.play().catch(() => {});
        }
        function silence() { Object.values(audio).forEach(clip => { clip.pause(); try { clip.currentTime = 0; } catch (_) {} }); }
        canvas.addEventListener('webglcontextlost', loss); canvas.addEventListener('webglcontextrestored', restore);
        root.addEventListener('pointermove', move, { passive: true }); root.addEventListener('pointerleave', leave);
        document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keydown); reduced.addEventListener('change', invalidate);
        window.addEventListener('resize', resize); visualViewport?.addEventListener('resize', resize);
        const observer = new ResizeObserver(resize); observer.observe(shell);
        const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) invalidate(); else { cancelAnimationFrame(raf); raf = 0; } }); intersection.observe(root);
        if (!initGl()) fallbackMode();
        resize();
        document.fonts?.load('600 16px "Black Market Pretendard"').then(invalidate).catch(() => {});
        return {
            invalidate, play, silence, root,
            announce(text) { live.textContent = text || ''; },
            pulse() { pulseAt = performance.now(); invalidate(); },
            get width() { return width; }, get height() { return height; },
            dispose() {
                disposed = true; cancelAnimationFrame(raf); observer.disconnect(); intersection.disconnect(); silence();
                Object.values(audio).forEach(clip => { clip.removeAttribute('src'); clip.load(); });
                document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keydown); reduced.removeEventListener('change', invalidate);
                window.removeEventListener('resize', resize); visualViewport?.removeEventListener('resize', resize);
                for (const img of images.values()) img.onload = img.onerror = null;
                release(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); root.remove(); shell.classList.remove('market-stage-shell');
            }
        };
    }

    function linesAct(S, action) {
        if (action === 'lines-next') { S.linePage = (S.linePage || 0) + 1; return true; }
        if (action === 'lines-previous') { S.linePage = Math.max(0, (S.linePage || 0) - 1); return true; }
        return false;
    }
    window.MarketStage = { mount, linesAct, identify, kit, createPicker, pickerList, pickerAct, pickerSelected, pickerMax, drawPicker, FX, CURRENCY, STAR_COLORS, CARD_TYPES, rarityColor };
})();
