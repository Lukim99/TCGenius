// ============================================================================
// RPGenius 관리자 대시보드 클라이언트 스크립트
// ============================================================================

// ---------- 공통 유틸 ----------
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const el = (tag, props, ...children) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
        if (k === 'class') e.className = props[k];
        else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
        else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (k in e) e[k] = props[k];
        else e.setAttribute(k, props[k]);
    }
    children.flat().forEach(c => {
        if (c == null || c === false) return;
        e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return e;
};
const toast = (msg, ok = true) => {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (ok ? 'ok' : 'err');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
};
const api = async (url, opt) => {
    const r = await fetch(url, opt);
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || ('HTTP ' + r.status));
    return x;
};
const clone = v => JSON.parse(JSON.stringify(v));
const isInt = v => Number.isInteger(Number(v));

// ---------- 탭 전환 ----------
$$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(b => b.classList.toggle('active', b === t));
    $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
    if (TAB_LOADERS[t.dataset.tab] && !LOADED[t.dataset.tab]) { LOADED[t.dataset.tab] = true; TAB_LOADERS[t.dataset.tab](); }
});
const LOADED = { grant: true };
const TAB_LOADERS = {};

$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };

// ---------- 룩업 캐시 ----------
const LOOKUP = { items: null, equipment: null, cards: null, fashion: null };
async function getItems() { if (!LOOKUP.items) LOOKUP.items = await api('/api/lookup/items'); return LOOKUP.items; }
async function getEquipment() { if (!LOOKUP.equipment) LOOKUP.equipment = await api('/api/lookup/equipment'); return LOOKUP.equipment; }
async function getCards() { if (!LOOKUP.cards) LOOKUP.cards = await api('/api/lookup/cards'); return LOOKUP.cards; }
async function getFashion() { if (!LOOKUP.fashion) LOOKUP.fashion = await api('/api/lookup/fashion'); return LOOKUP.fashion; }

// ---------- 모달 픽커 ----------
const modal = $('#modal'), modalBody = $('#modalBody'), modalSearch = $('#modalSearch'), modalTitle = $('#modalTitle');
$('#modalClose').onclick = () => closeModal();
modal.onclick = e => { if (e.target === modal) closeModal(); };
function closeModal() { modal.classList.remove('show'); modal._cb = null; }
function openModal(title, items, render, onPick) {
    modalTitle.textContent = title;
    modalSearch.value = '';
    modalBody.innerHTML = '';
    const all = items.slice();
    function paint(list) {
        modalBody.innerHTML = '';
        if (list.length === 0) { modalBody.appendChild(el('div', { class: 'empty' }, '결과 없음')); return; }
        list.slice(0, 300).forEach(it => {
            const row = render(it);
            row.classList.add('item');
            row.onclick = () => { onPick(it); closeModal(); };
            modalBody.appendChild(row);
        });
    }
    paint(all);
    modalSearch.oninput = () => {
        const q = modalSearch.value.toLowerCase().trim();
        if (!q) return paint(all);
        paint(all.filter(it => (it._search || '').toLowerCase().includes(q)));
    };
    modal.classList.add('show');
    setTimeout(() => modalSearch.focus(), 50);
}

// 픽커: 아이템
async function pickItem(onPick, filterType) {
    const items = await getItems();
    const list = items.map(it => Object.assign({}, it, { _search: it.name + ' ' + it.type + ' ' + it.id })).filter(it => !filterType || it.type === filterType);
    openModal('아이템 선택', list, it => el('div', null,
        el('div', null, el('span', { class: 'tag b' }, '#' + it.id), it.name),
        el('div', { class: 'meta' }, it.type)
    ), onPick);
}
// 픽커: 장비
async function pickEquipment(slot, onPick) {
    const eq = await getEquipment();
    const list = (eq[slot] || []).map(e => Object.assign({}, e, { _search: e.name + ' ' + e.rarity + ' ' + e.id }));
    const labels = { weapon: '무기', armor: '갑옷', accessory: '장신구' };
    const rarityClass = r => ({ '일반': '', '고급': 'g', '희귀': 'b', '영웅': 'p', '전설': 'y', '신화': 'r' }[r] || '');
    openModal(labels[slot] + ' 선택', list, e => el('div', null,
        el('div', null, el('span', { class: 'tag ' + rarityClass(e.rarity) }, e.rarity), el('span', { class: 'tag' }, '#' + e.id), e.name),
    ), onPick);
}
// 픽커: 캐릭터 카드
async function pickCard(onPick) {
    const cards = await getCards();
    const list = cards.map(card => Object.assign({}, card, { _search: card.name + ' ' + card.id }));
    openModal('캐릭터 카드 선택', list, card => el('div', null,
        el('div', null, el('span', { class: 'tag b' }, '#' + card.id), card.name)
    ), onPick);
}

function cardTargetControls(entry, onChange) {
    const wrap = el('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', flex: '1' } });
    const btn = el('button', { class: 'pickbtn', type: 'button', style: { flex: '1', minWidth: '150px' } });
    const skinSelect = el('select', { style: { width: '130px' }, onchange: () => {
        if (skinSelect.value) entry.skin = skinSelect.value;
        else delete entry.skin;
        onChange && onChange();
    } });
    const getSelectedCardId = () => entry.card_id != null ? Number(entry.card_id) : (entry.character_card_id != null ? Number(entry.character_card_id) : (entry.id != null ? Number(entry.id) : -1));
    const refresh = async () => {
        const cards = await getCards();
        const id = getSelectedCardId();
        const card = cards.find(x => x.id === id);
        btn.innerHTML = '';
        btn.appendChild(card ? document.createTextNode('#' + card.id + ' ' + card.name) : el('span', { class: 'ph' }, '캐릭터 카드 선택...'));
    };
    const refreshSkins = async () => {
        const id = getSelectedCardId();
        const displayStar = entry.display_star != null ? Number(entry.display_star) : (entry.star_display != null ? Number(entry.star_display) : Number(entry.star || 0) + 1);
        const fashion = await getFashion();
        const skins = fashion.filter(skin => Array.isArray(skin.primary_card) && skin.primary_card.map(Number).includes(id) && (!Number(skin.requireStar || 0) || displayStar >= Number(skin.requireStar || 0)));
        skinSelect.innerHTML = '';
        skinSelect.appendChild(el('option', { value: '' }, '스킨 없음'));
        skins.forEach(skin => skinSelect.appendChild(el('option', { value: skin.name }, skin.name)));
        if (entry.skin && skins.some(skin => skin.name === entry.skin)) skinSelect.value = entry.skin;
        else {
            skinSelect.value = '';
            delete entry.skin;
        }
    };
    btn.onclick = () => pickCard(card => {
        entry.card_id = card.id;
        ['character_card_id', 'id', 'item_id', 'weapon_id', 'armor_id', 'accessory_id'].forEach(k => delete entry[k]);
        refresh();
        refreshSkins();
        onChange && onChange();
    });
    const displayStar = entry.display_star != null ? Number(entry.display_star) : (entry.star_display != null ? Number(entry.star_display) : Number(entry.star || 0) + 1);
    const starIn = el('input', { type: 'number', min: 1, max: 12, value: displayStar || 1, style: { width: '74px' }, title: '표시 성급', oninput: () => {
        entry.display_star = Number(starIn.value || 1);
        delete entry.star;
        delete entry.star_display;
        delete entry.range;
        refreshSkins();
        onChange && onChange();
    } });
    const typeIn = el('input', { type: 'text', value: entry.card_type || entry.cardType || '일반', placeholder: '타입', style: { width: '86px' }, oninput: () => {
        entry.card_type = typeIn.value || '일반';
        delete entry.cardType;
        onChange && onChange();
    } });
    refresh();
    refreshSkins();
    wrap.appendChild(btn);
    wrap.appendChild(el('span', { class: 'lab', style: { paddingTop: '7px' } }, '성급'));
    wrap.appendChild(starIn);
    wrap.appendChild(typeIn);
    wrap.appendChild(skinSelect);
    return wrap;
}

// ---------- 보상/엔트리 행 빌더 ----------
// kind: 'reward' (Pack/Bundle/Coupon용) | 'material' | 'crafted'
// roll: true이면 roll 필드 표시 (Pack 전용)
// 데이터 형식 정규화 후 entry 객체에 직접 mutate
function ensureCount(entry, asObject) {
    if (asObject) {
        if (typeof entry.count !== 'object' || entry.count == null) entry.count = { min: Number(entry.count || 1), max: Number(entry.count || 1) };
    } else {
        if (typeof entry.count === 'object' && entry.count != null) entry.count = Number(entry.count.min || entry.count.max || 1);
    }
}

const REWARD_TYPES = ['아이템', '캐릭터카드', '무기', '갑옷', '장신구', '골드', '가넷', '마일리지', '경험치'];
const MATERIAL_TYPES = ['아이템', '골드', '가넷', '마일리지'];
const CRAFTED_TYPES = ['아이템', '무기', '갑옷', '장신구'];

function entryRow(entry, opts, onChange, onDelete) {
    // opts: { types, withRoll, countAsObject }
    const types = opts.types;
    const wrap = el('div', { class: 'entry' });
    const sel = el('select');
    types.forEach(t => sel.appendChild(el('option', { value: t }, t)));
    if (!entry.type || !types.includes(entry.type)) entry.type = types[0];
    sel.value = entry.type;

    const targetSlot = el('span', { style: { flex: '1', minWidth: '160px', display: 'flex' } });
    const countSlot = el('span', { class: 'nf', style: { display: 'flex', gap: '4px', alignItems: 'center' } });
    const rollSlot = el('span', { class: 'nf', style: { display: opts.withRoll ? 'flex' : 'none', gap: '4px', alignItems: 'center' } });

    function paintTarget() {
        targetSlot.innerHTML = '';
        const t = entry.type;
        if (t === '아이템') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                if (typeof entry.item_id === 'number') {
                    const items = await getItems();
                    const it = items.find(x => x.id === entry.item_id);
                    btn.innerHTML = '';
                    btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + entry.item_id));
                } else {
                    btn.innerHTML = '<span class="ph">아이템 선택...</span>';
                }
            };
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; ['weapon_id', 'armor_id', 'accessory_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else if (t === '캐릭터카드') {
            targetSlot.appendChild(cardTargetControls(entry, onChange));
        } else if (t === '무기' || t === '갑옷' || t === '장신구') {
            const slot = { '무기': 'weapon', '갑옷': 'armor', '장신구': 'accessory' }[t];
            const idKey = { '무기': 'weapon_id', '갑옷': 'armor_id', '장신구': 'accessory_id' }[t];
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                const eq = await getEquipment();
                const cur = eq[slot] && eq[slot].find(x => x.id === entry[idKey]);
                btn.innerHTML = '';
                if (cur) btn.appendChild(document.createTextNode('<' + cur.rarity + '> #' + cur.id + ' ' + cur.name));
                else btn.appendChild(el('span', { class: 'ph' }, t + ' 선택...'));
            };
            btn.onclick = () => pickEquipment(slot, e => { entry[idKey] = e.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => k !== idKey && delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else {
            // 골드/가넷/마일리지/경험치 — target 없음
            ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]);
            targetSlot.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + t + ' 수량 지정)'));
        }
    }

    function paintCount() {
        countSlot.innerHTML = '';
        // 무기/갑옷/장신구는 보통 count=1 고정 (장비는 1개씩 지급되도록)
        if ((entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구') && opts.types !== CRAFTED_TYPES) {
            countSlot.appendChild(el('span', { class: 'lab' }, '×1'));
            if (opts.countAsObject) entry.count = { min: 1, max: 1 }; else entry.count = 1;
            return;
        }
        if (entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구') {
            // crafted (단일 지급)
            delete entry.count;
            countSlot.appendChild(el('span', { class: 'lab' }, '×1'));
            return;
        }
        if (opts.countAsObject) {
            ensureCount(entry, true);
            const minIn = el('input', { type: 'number', value: entry.count.min, oninput: () => { entry.count.min = Number(minIn.value); onChange && onChange(); } });
            const maxIn = el('input', { type: 'number', value: entry.count.max, oninput: () => { entry.count.max = Number(maxIn.value); onChange && onChange(); } });
            countSlot.appendChild(el('span', { class: 'lab' }, '수량'));
            countSlot.appendChild(minIn);
            countSlot.appendChild(el('span', { class: 'lab' }, '~'));
            countSlot.appendChild(maxIn);
        } else {
            ensureCount(entry, false);
            const cIn = el('input', { type: 'number', value: entry.count, oninput: () => { entry.count = Number(cIn.value); onChange && onChange(); } });
            countSlot.appendChild(el('span', { class: 'lab' }, '수량'));
            countSlot.appendChild(cIn);
        }
    }

    function paintRoll() {
        if (!opts.withRoll) return;
        rollSlot.innerHTML = '';
        if (typeof entry.roll !== 'number') entry.roll = 1;
        const rIn = el('input', { type: 'number', step: '0.001', min: 0, max: 1, value: entry.roll, oninput: () => { entry.roll = Number(rIn.value); onChange && onChange(); } });
        rollSlot.appendChild(el('span', { class: 'lab' }, 'roll'));
        rollSlot.appendChild(rIn);
    }

    sel.onchange = () => { entry.type = sel.value; paintTarget(); paintCount(); onChange && onChange(); };

    wrap.appendChild(sel);
    wrap.appendChild(targetSlot);
    wrap.appendChild(countSlot);
    wrap.appendChild(rollSlot);
    wrap.appendChild(el('button', { class: 'btn icon danger', type: 'button', title: '삭제', onclick: () => { onDelete(); onChange && onChange(); } }, '✕'));

    paintTarget(); paintCount(); paintRoll();
    return wrap;
}

// ============================================================================
// 유저 / 재화 지급
// ============================================================================
$('#searchBtn').onclick = async () => {
    const name = $('#searchName').value.trim();
    if (!name) return toast('닉네임을 입력하세요', false);
    try {
        const u = await api('/api/users/search?name=' + encodeURIComponent(name));
        $('#userInfo').style.display = 'grid';
        $('#userInfo').innerHTML = '';
        ['name', 'level', 'gold', 'garnet', 'point', 'mileage', 'isAdmin'].forEach(k => $('#userInfo').appendChild(el('div', null, el('b', null, k), String(u[k]))));
        $('#grantName').value = u.name;
    } catch (e) { $('#userInfo').style.display = 'none'; toast(e.message, false); }
};
$('#grantKind').onchange = () => $('#itemNameWrap').style.display = $('#grantKind').value === 'item' ? '' : 'none';
$('#grantItemPick').onclick = () => pickItem(it => {
    $('#grantItemName').value = it.name;
    $('#grantItemPick').innerHTML = '';
    $('#grantItemPick').appendChild(document.createTextNode('#' + it.id + ' ' + it.name));
});
$('#grantBtn').onclick = async () => {
    const body = { name: $('#grantName').value.trim(), kind: $('#grantKind').value, amount: Number($('#grantAmount').value), itemName: $('#grantItemName').value.trim() };
    try {
        const r = await api('/api/users/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.kind === 'item') toast('✅ ' + r.name + ' ' + r.itemName + ' ' + (r.delta > 0 ? '+' : '') + r.delta);
        else toast('✅ ' + r.name + ' ' + r.kind + ': ' + r.before + ' → ' + r.after);
    } catch (e) { toast(e.message, false); }
};

// ============================================================================
// 공통 데이터 탭 헬퍼
// ============================================================================
async function loadKey(key) { const r = await api('/api/data/' + encodeURIComponent(key)); return r.data; }
async function saveKey(key, data) { await api('/api/data/' + encodeURIComponent(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }); }

// ============================================================================
// PACK 에디터  ( data: Array<Array<entry>> )
// ============================================================================
let packData = [];
function renderPack() {
    const list = $('#packList'); list.innerHTML = '';
    if (!Array.isArray(packData)) packData = [];
    packData.forEach((entries, packIdx) => {
        const card = el('div', { class: 'card' });
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, 'Pack #' + packIdx + ' (' + (entries ? entries.length : 0) + '개)'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('Pack #' + packIdx + ' 삭제?')) { packData.splice(packIdx, 1); renderPack(); } } }, '삭제')
        ));
        const entryList = el('div', { class: 'entry-list' });
        if (!Array.isArray(entries)) { entries = []; packData[packIdx] = entries; }
        entries.forEach((entry, i) => {
            entryList.appendChild(entryRow(entry,
                { types: REWARD_TYPES, withRoll: true, countAsObject: true },
                null,
                () => { entries.splice(i, 1); renderPack(); }
            ));
        });
        card.appendChild(entryList);
        card.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { entries.push({ type: '아이템', count: { min: 1, max: 1 }, roll: 0.1 }); renderPack(); } }, '+ 보상 추가'));
        list.appendChild(card);
    });
}
$('#packAdd').onclick = () => { packData.push([]); renderPack(); };
$('#packReload').onclick = async () => { try { packData = (await loadKey('Pack')) || []; renderPack(); $('#packStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#packSave').onclick = async () => { if (!confirm('Pack 데이터를 저장합니다. 계속?')) return; try { await saveKey('Pack', packData); toast('✅ Pack 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.pack = () => $('#packReload').click();

// ============================================================================
// BUNDLE 에디터  ( data: Array<Array<entry>> )
// ============================================================================
let bundleData = [];
function renderBundle() {
    const list = $('#bundleList'); list.innerHTML = '';
    if (!Array.isArray(bundleData)) bundleData = [];
    bundleData.forEach((entries, idx) => {
        const card = el('div', { class: 'card' });
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, 'Bundle #' + idx + ' (' + (entries ? entries.length : 0) + '개)'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('Bundle #' + idx + ' 삭제?')) { bundleData.splice(idx, 1); renderBundle(); } } }, '삭제')
        ));
        const entryList = el('div', { class: 'entry-list' });
        if (!Array.isArray(entries)) { entries = []; bundleData[idx] = entries; }
        entries.forEach((entry, i) => {
            entryList.appendChild(entryRow(entry,
                { types: REWARD_TYPES, withRoll: false, countAsObject: true },
                null,
                () => { entries.splice(i, 1); renderBundle(); }
            ));
        });
        card.appendChild(entryList);
        card.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { entries.push({ type: '아이템', count: { min: 1, max: 1 } }); renderBundle(); } }, '+ 보상 추가'));
        list.appendChild(card);
    });
}
$('#bundleAdd').onclick = () => { bundleData.push([]); renderBundle(); };
$('#bundleReload').onclick = async () => { try { bundleData = (await loadKey('Bundle')) || []; renderBundle(); $('#bundleStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#bundleSave').onclick = async () => { if (!confirm('Bundle 데이터를 저장합니다. 계속?')) return; try { await saveKey('Bundle', bundleData); toast('✅ Bundle 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.bundle = () => $('#bundleReload').click();

// ============================================================================
// COUPON 에디터  ( data: Array<{code, reward[], expired_At}> )
// ============================================================================
let couponData = [];
function renderCoupon() {
    const list = $('#couponList'); list.innerHTML = '';
    if (!Array.isArray(couponData)) couponData = [];
    couponData.forEach((c, idx) => {
        if (!Array.isArray(c.reward)) c.reward = [];
        const card = el('div', { class: 'card' });
        const codeIn = el('input', { value: c.code || '', placeholder: '쿠폰 코드', oninput: () => c.code = codeIn.value });
        const expIn = el('input', { value: c.expired_At || '', placeholder: 'YYYY-MM-DDTHH:MM:SS+09:00 또는 비워두면 무기한', oninput: () => c.expired_At = expIn.value || null });
        const maxUseIn = el('input', { type: 'number', min: 0, value: c.maxUse == null ? '' : c.maxUse, placeholder: '비워두면 무제한', oninput: () => { const v = maxUseIn.value.trim(); c.maxUse = v === '' ? null : Number(v); } });
        const usedCount = Number(c.usedCount || 0);
        const usedLabel = (c.maxUse != null && c.maxUse > 0) ? (usedCount + ' / ' + c.maxUse) : (usedCount + ' / ∞');
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, '쿠폰 #' + idx + (c.code ? ' — ' + c.code : ''), el('span', { class: 'tag', style: { marginLeft: '8px' } }, '사용: ' + usedLabel)),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('이 쿠폰을 삭제합니까?')) { couponData.splice(idx, 1); renderCoupon(); } } }, '삭제')
        ));
        const grid = el('div', { class: 'split' });
        grid.appendChild(el('div', null, el('label', null, '코드'), codeIn));
        grid.appendChild(el('div', null, el('label', null, '만료일 (ISO 8601)'), expIn));
        const grid2 = el('div', { class: 'split', style: { marginTop: '6px' } });
        grid2.appendChild(el('div', null, el('label', null, '최대 사용 횟수 (maxUse)'), maxUseIn));
        grid2.appendChild(el('div', null, el('label', null, '현재 사용 횟수 (usedCount, 읽기 전용)'), el('input', { value: String(usedCount), readonly: true, style: { opacity: '.7' } })));
        card.appendChild(grid);
        card.appendChild(grid2);
        card.appendChild(el('h3', { style: { marginTop: '14px' } }, '보상'));
        const entryList = el('div', { class: 'entry-list' });
        c.reward.forEach((entry, i) => {
            entryList.appendChild(entryRow(entry,
                { types: REWARD_TYPES, withRoll: false, countAsObject: true },
                null,
                () => { c.reward.splice(i, 1); renderCoupon(); }
            ));
        });
        card.appendChild(entryList);
        card.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { c.reward.push({ type: '아이템', count: { min: 1, max: 1 } }); renderCoupon(); } }, '+ 보상 추가'));
        list.appendChild(card);
    });
}
$('#couponAdd').onclick = () => { couponData.push({ code: '', reward: [], expired_At: null }); renderCoupon(); };
$('#couponReload').onclick = async () => { try { couponData = (await loadKey('Coupon')) || []; renderCoupon(); $('#couponStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#couponSave').onclick = async () => { if (!confirm('Coupon 데이터를 저장합니다. 계속?')) return; try { await saveKey('Coupon', couponData); toast('✅ Coupon 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.coupon = () => $('#couponReload').click();

// ============================================================================
// SHOP 에디터  ( data: { [shopType]: Array<{type, item_id?, count, price:{goods,amount,item_id?}}> } )
// ============================================================================
let shopData = {};
let shopCurrentType = null;
function renderShopTypes() {
    const wrap = $('#shopTypes'); wrap.innerHTML = '';
    const types = Object.keys(shopData);
    if (types.length === 0) { wrap.appendChild(el('span', { class: 'muted' }, '상점 종류가 없습니다.')); shopCurrentType = null; return; }
    if (!shopCurrentType || !types.includes(shopCurrentType)) shopCurrentType = types[0];
    types.forEach(t => {
        const b = el('button', { class: 'subtab' + (t === shopCurrentType ? ' active' : ''), type: 'button', onclick: () => { shopCurrentType = t; renderShopTypes(); renderShop(); } }, t + ' (' + shopData[t].length + ')');
        wrap.appendChild(b);
    });
}
function shopEntryRow(entry, onChange, onDelete) {
    if (typeof entry.count !== 'number') entry.count = 1;
    if (!entry.price || typeof entry.price !== 'object') entry.price = { goods: 'gold', amount: 0 };
    const wrap = el('div', { class: 'card', style: { padding: '10px 12px' } });

    // 상품
    const head = el('div', { class: 'entry' });
    const sel = el('select');
    ['아이템', '캐릭터카드', '가넷', '골드', '마일리지'].forEach(t => sel.appendChild(el('option', { value: t }, t)));
    if (!['아이템', '캐릭터카드', '가넷', '골드', '마일리지'].includes(entry.type)) entry.type = '아이템';
    sel.value = entry.type;
    const target = el('span', { style: { flex: '1', minWidth: '180px', display: 'flex' } });
    const cnt = el('input', { class: 'nf', type: 'number', value: entry.count, style: { width: '100px' }, oninput: () => entry.count = Number(cnt.value) });

    function paintTarget() {
        target.innerHTML = '';
        if (entry.type === '아이템') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof entry.item_id === 'number') {
                    const items = await getItems();
                    const it = items.find(x => x.id === entry.item_id);
                    btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + entry.item_id));
                } else btn.innerHTML = '<span class="ph">아이템 선택...</span>';
            };
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; ['card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]); refresh(); });
            refresh(); target.appendChild(btn);
        } else if (entry.type === '캐릭터카드') {
            delete entry.item_id;
            target.appendChild(cardTargetControls(entry));
        } else {
            ['item_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]);
            target.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + entry.type + ' 지급)'));
        }
    }
    sel.onchange = () => { entry.type = sel.value; paintTarget(); };
    head.appendChild(el('span', { class: 'lab' }, '상품'));
    head.appendChild(sel); head.appendChild(target);
    head.appendChild(el('span', { class: 'lab' }, '수량')); head.appendChild(cnt);
    head.appendChild(el('button', { class: 'btn icon danger', type: 'button', onclick: onDelete }, '✕'));
    paintTarget();

    // 가격
    const priceRow = el('div', { class: 'entry', style: { marginTop: '6px' } });
    const goodsSel = el('select');
    ['gold', 'garnet', 'point', 'mileage', 'item'].forEach(g => goodsSel.appendChild(el('option', { value: g }, g)));
    goodsSel.value = entry.price.goods || 'gold';
    const amountIn = el('input', { class: 'nf', type: 'number', value: Number(entry.price.amount || 0), style: { width: '120px' }, oninput: () => entry.price.amount = Number(amountIn.value) });
    const priceTarget = el('span', { style: { flex: '1', minWidth: '180px', display: 'flex' } });
    function paintPriceTarget() {
        priceTarget.innerHTML = '';
        if (entry.price.goods === 'item') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof entry.price.item_id === 'number') {
                    const items = await getItems();
                    const it = items.find(x => x.id === entry.price.item_id);
                    btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + entry.price.item_id));
                } else btn.innerHTML = '<span class="ph">결제 아이템 선택...</span>';
            };
            btn.onclick = () => pickItem(it => { entry.price.item_id = it.id; refresh(); });
            refresh(); priceTarget.appendChild(btn);
        } else { delete entry.price.item_id; priceTarget.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + entry.price.goods + ' 결제)')); }
    }
    goodsSel.onchange = () => { entry.price.goods = goodsSel.value; paintPriceTarget(); };
    priceRow.appendChild(el('span', { class: 'lab' }, '가격'));
    priceRow.appendChild(goodsSel); priceRow.appendChild(priceTarget);
    priceRow.appendChild(el('span', { class: 'lab' }, '금액')); priceRow.appendChild(amountIn);
    paintPriceTarget();

    // 구매 제한
    if (!entry.limits || typeof entry.limits !== 'object') entry.limits = {};
    const limitRow = el('div', { class: 'entry', style: { marginTop: '6px', flexWrap: 'wrap' } });
    limitRow.appendChild(el('span', { class: 'lab' }, '제한 (0=무제한)'));
    const fields = [
        { key: 'max', label: '누적' },
        { key: 'daily', label: '일일' },
        { key: 'weekly', label: '주간' },
        { key: 'monthly', label: '월간' },
        { key: 'global', label: '글로벌' }
    ];
    fields.forEach(f => {
        const cur = Number(entry.limits[f.key] || 0);
        const inp = el('input', { class: 'nf', type: 'number', min: 0, value: cur, style: { width: '90px' }, oninput: () => {
            const v = Number(inp.value);
            if (!Number.isFinite(v) || v <= 0) delete entry.limits[f.key];
            else entry.limits[f.key] = Math.floor(v);
        } });
        limitRow.appendChild(el('span', { class: 'lab' }, f.label));
        limitRow.appendChild(inp);
    });

    wrap.appendChild(head); wrap.appendChild(priceRow); wrap.appendChild(limitRow);
    return wrap;
}
function renderShop() {
    const list = $('#shopList'); list.innerHTML = '';
    if (!shopCurrentType || !shopData[shopCurrentType]) return;
    const arr = shopData[shopCurrentType];
    arr.forEach((entry, i) => {
        list.appendChild(shopEntryRow(entry, null, () => { arr.splice(i, 1); renderShop(); renderShopTypes(); }));
    });
}
$('#shopAdd').onclick = () => {
    if (!shopCurrentType) return toast('상점 종류를 먼저 선택하세요', false);
    shopData[shopCurrentType].push({ type: '아이템', count: 1, price: { goods: 'gold', amount: 0 } });
    renderShop(); renderShopTypes();
};
$('#shopAddType').onclick = () => {
    const name = prompt('새 상점 종류 이름?');
    if (!name) return;
    if (shopData[name]) return toast('이미 존재합니다', false);
    shopData[name] = []; shopCurrentType = name; renderShopTypes(); renderShop();
};
$('#shopDelType').onclick = () => {
    if (!shopCurrentType) return;
    if (!confirm("'" + shopCurrentType + "' 상점을 삭제합니까? (포함된 모든 상품이 삭제됩니다)")) return;
    delete shopData[shopCurrentType]; shopCurrentType = null; renderShopTypes(); renderShop();
};
$('#shopReload').onclick = async () => { try { shopData = (await loadKey('Shop')) || {}; shopCurrentType = null; renderShopTypes(); renderShop(); $('#shopStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#shopSave').onclick = async () => { if (!confirm('Shop 데이터를 저장합니다. 계속?')) return; try { await saveKey('Shop', shopData); toast('✅ Shop 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.shop = () => $('#shopReload').click();

// ============================================================================
// RECIPE 에디터  ( data: Array<{name, materials[], crafted[]}> )
// ============================================================================
let recipeData = [];
function renderRecipe() {
    const list = $('#recipeList'); list.innerHTML = '';
    if (!Array.isArray(recipeData)) recipeData = [];
    recipeData.forEach((r, idx) => {
        if (!Array.isArray(r.materials)) r.materials = [];
        if (!Array.isArray(r.crafted)) r.crafted = [];
        const card = el('div', { class: 'card' });
        const nameIn = el('input', { value: r.name || '', placeholder: '레시피 이름', oninput: () => r.name = nameIn.value });
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, '레시피 #' + idx + (r.name ? ' — ' + r.name : '')),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('레시피 삭제?')) { recipeData.splice(idx, 1); renderRecipe(); } } }, '삭제')
        ));
        card.appendChild(el('div', null, el('label', null, '이름'), nameIn));

        const grid = el('div', { class: 'split', style: { marginTop: '12px' } });
        // 재료
        const matCol = el('div');
        matCol.appendChild(el('h3', null, '재료'));
        const matList = el('div', { class: 'entry-list' });
        r.materials.forEach((entry, i) => {
            matList.appendChild(entryRow(entry, { types: MATERIAL_TYPES, withRoll: false, countAsObject: false }, null, () => { r.materials.splice(i, 1); renderRecipe(); }));
        });
        matCol.appendChild(matList);
        matCol.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { r.materials.push({ type: '아이템', count: 1 }); renderRecipe(); } }, '+ 재료 추가'));

        // 결과물
        const craftCol = el('div');
        craftCol.appendChild(el('h3', null, '결과물'));
        const craftList = el('div', { class: 'entry-list' });
        r.crafted.forEach((entry, i) => {
            craftList.appendChild(entryRow(entry, { types: CRAFTED_TYPES, withRoll: false, countAsObject: false }, null, () => { r.crafted.splice(i, 1); renderRecipe(); }));
        });
        craftCol.appendChild(craftList);
        craftCol.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { r.crafted.push({ type: '아이템', count: 1 }); renderRecipe(); } }, '+ 결과물 추가'));

        grid.appendChild(matCol); grid.appendChild(craftCol);
        card.appendChild(grid);
        list.appendChild(card);
    });
}
$('#recipeAdd').onclick = () => { recipeData.push({ name: '', materials: [], crafted: [] }); renderRecipe(); };
$('#recipeReload').onclick = async () => { try { recipeData = (await loadKey('Recipe')) || []; renderRecipe(); $('#recipeStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#recipeSave').onclick = async () => { if (!confirm('Recipe 데이터를 저장합니다. 계속?')) return; try { await saveKey('Recipe', recipeData); toast('✅ Recipe 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.recipe = () => $('#recipeReload').click();

// ============================================================================
// BAIT 에디터  ( data: Array<{name, rewards: Array<{id, rate}>}> )
// ============================================================================
let baitData = [];
function baitRewardRow(reward, onDelete) {
    const wrap = el('div', { class: 'entry' });
    const btn = el('button', { class: 'pickbtn', type: 'button' });
    const refresh = async () => {
        btn.innerHTML = '';
        if (typeof reward.id === 'number') {
            const items = await getItems();
            const it = items.find(x => x.id === reward.id);
            btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + reward.id));
        } else btn.innerHTML = '<span class="ph">아이템 선택...</span>';
    };
    btn.onclick = () => pickItem(it => { reward.id = it.id; refresh(); });
    refresh();
    const target = el('span', { style: { flex: '1', minWidth: '160px', display: 'flex' } }, btn);
    const rateIn = el('input', { type: 'number', step: '0.001', min: 0, value: Number(reward.rate || 0), oninput: () => reward.rate = Number(rateIn.value) });
    const rateSlot = el('span', { class: 'nf', style: { display: 'flex', gap: '4px', alignItems: 'center' } },
        el('span', { class: 'lab' }, 'rate'), rateIn);
    wrap.appendChild(el('span', { class: 'lab' }, '아이템'));
    wrap.appendChild(target);
    wrap.appendChild(rateSlot);
    wrap.appendChild(el('button', { class: 'btn icon danger', type: 'button', title: '삭제', onclick: () => onDelete() }, '✕'));
    return wrap;
}
function renderBait() {
    const list = $('#baitList'); list.innerHTML = '';
    if (!Array.isArray(baitData)) baitData = [];
    baitData.forEach((b, idx) => {
        if (!Array.isArray(b.rewards)) b.rewards = [];
        const card = el('div', { class: 'card' });
        const nameIn = el('input', { value: b.name || '', placeholder: '미끼 이름 (Item.json의 미끼 아이템 이름과 일치)', oninput: () => b.name = nameIn.value });
        const total = b.rewards.reduce((s, r) => s + Number(r.rate || 0), 0);
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, '미끼 #' + idx + (b.name ? ' — ' + b.name : ''), el('span', { class: 'tag', style: { marginLeft: '8px' } }, '합계 rate: ' + total)),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('미끼 삭제?')) { baitData.splice(idx, 1); renderBait(); } } }, '삭제')
        ));
        card.appendChild(el('div', null, el('label', null, '이름'), nameIn));
        card.appendChild(el('h3', { style: { marginTop: '12px' } }, '보상'));
        const entryList = el('div', { class: 'entry-list' });
        b.rewards.forEach((reward, i) => {
            entryList.appendChild(baitRewardRow(reward, () => { b.rewards.splice(i, 1); renderBait(); }));
        });
        card.appendChild(entryList);
        card.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => { b.rewards.push({ id: 0, rate: 1 }); renderBait(); } }, '+ 보상 추가'));
        list.appendChild(card);
    });
}
$('#baitAdd').onclick = () => { baitData.push({ name: '', rewards: [] }); renderBait(); };
$('#baitReload').onclick = async () => { try { baitData = (await loadKey('Bait')) || []; renderBait(); $('#baitStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#baitSave').onclick = async () => { if (!confirm('Bait 데이터를 저장합니다. 계속?')) return; try { await saveKey('Bait', baitData); toast('✅ Bait 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.bait = () => $('#baitReload').click();

// ============================================================================
// RAW JSON 에디터
// ============================================================================
const rawSel = $('#rawKey');
window.DATA_KEYS.forEach(k => rawSel.appendChild(el('option', { value: k }, k)));
async function rawLoad() {
    const k = rawSel.value;
    $('#rawStatus').textContent = '불러오는 중...';
    try { const data = await loadKey(k); $('#rawText').value = JSON.stringify(data, null, 2); $('#rawStatus').textContent = k + ' 로드 완료'; }
    catch (e) { $('#rawStatus').textContent = ''; toast(e.message, false); }
}
$('#rawReload').onclick = rawLoad;
rawSel.onchange = rawLoad;
$('#rawFormat').onclick = () => { try { $('#rawText').value = JSON.stringify(JSON.parse($('#rawText').value), null, 2); toast('✅ 포맷 완료'); } catch (e) { toast('JSON 파싱 실패: ' + e.message, false); } };
$('#rawSave').onclick = async () => {
    const k = rawSel.value;
    let data; try { data = JSON.parse($('#rawText').value); } catch (e) { return toast('JSON 파싱 실패: ' + e.message, false); }
    if (!confirm(k + ' 데이터를 DynamoDB에 저장합니다. 계속할까요?')) return;
    try { await saveKey(k, data); toast('✅ ' + k + ' 저장 완료'); } catch (e) { toast(e.message, false); }
};
TAB_LOADERS.raw = () => rawLoad();
