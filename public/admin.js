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
    const labels = { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' };
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
        const rawStar = Number(entry.star || 0);
        const fashion = await getFashion();
        const skins = fashion.filter(skin => Array.isArray(skin.primary_card) && skin.primary_card.map(Number).includes(id) && rawStar >= Number(skin.requireStar || 0));
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
        ['character_card_id', 'id', 'item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id'].forEach(k => delete entry[k]);
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

const REWARD_TYPES = ['아이템', '캐릭터카드', '무기', '갑옷', '장신구', '보조', '골드', '가넷', '마일리지', '경험치'];
const MATERIAL_TYPES = ['아이템', '무기', '갑옷', '장신구', '보조', '골드', '가넷', '마일리지'];
const CRAFTED_TYPES = ['아이템', '무기', '갑옷', '장신구', '보조'];

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
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; ['weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else if (t === '캐릭터카드') {
            targetSlot.appendChild(cardTargetControls(entry, onChange));
        } else if (t === '무기' || t === '갑옷' || t === '장신구' || t === '보조') {
            const slot = { '무기': 'weapon', '갑옷': 'armor', '장신구': 'accessory', '보조': 'support' }[t];
            const idKey = { '무기': 'weapon_id', '갑옷': 'armor_id', '장신구': 'accessory_id', '보조': 'support_id' }[t];
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                const eq = await getEquipment();
                const cur = eq[slot] && eq[slot].find(x => x.id === entry[idKey]);
                btn.innerHTML = '';
                if (cur) btn.appendChild(document.createTextNode('<' + cur.rarity + '> #' + cur.id + ' ' + cur.name));
                else btn.appendChild(el('span', { class: 'ph' }, t + ' 선택...'));
            };
            btn.onclick = () => pickEquipment(slot, e => { entry[idKey] = e.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => k !== idKey && delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else {
            // 골드/가넷/마일리지/경험치 — target 없음
            ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin'].forEach(k => delete entry[k]);
            targetSlot.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + t + ' 수량 지정)'));
        }
    }

    function paintCount() {
        countSlot.innerHTML = '';
        // 보상 장비는 보통 count=1 고정 (제작 재료 장비는 수량 입력 허용)
        if ((entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구' || entry.type === '보조') && opts.types !== CRAFTED_TYPES && opts.types !== MATERIAL_TYPES) {
            countSlot.appendChild(el('span', { class: 'lab' }, '×1'));
            if (opts.countAsObject) entry.count = { min: 1, max: 1 }; else entry.count = 1;
            return;
        }
        if ((entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구' || entry.type === '보조') && opts.types === CRAFTED_TYPES) {
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
if ($('#shopLimitResetScope')) $('#shopLimitResetScope').onchange = () => {
    const scope = $('#shopLimitResetScope').value;
    $('#shopLimitResetIndexWrap').style.display = scope === 'item' ? '' : 'none';
};
if ($('#shopLimitResetBtn')) $('#shopLimitResetBtn').onclick = async () => {
    const scope = $('#shopLimitResetScope').value;
    if ((scope === 'shop' || scope === 'item') && !shopCurrentType) return toast('상점을 먼저 선택하세요.', false);
    const body = { scope, shopType: shopCurrentType || '' };
    let targetText = scope === 'all' ? '모든 상점' : "'" + shopCurrentType + "' 상점 전체";
    if (scope === 'item') {
        const displayIndex = Number($('#shopLimitResetIndex').value);
        if (!Number.isInteger(displayIndex) || displayIndex < 1) return toast('상품 번호를 입력하세요.', false);
        const arr = shopData[shopCurrentType] || [];
        if (displayIndex > arr.length) return toast('존재하지 않는 상품 번호입니다.', false);
        body.index = displayIndex - 1;
        targetText = "'" + shopCurrentType + "' 상점 " + displayIndex + '번 상품';
    }
    if (!confirm(targetText + '의 구매 제한 기록을 초기화합니다.\n유저별 기록과 전체 제한 기록이 함께 삭제됩니다. 계속?')) return;
    try {
        const result = await api('/api/admin/shop-limits/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const msg = '초기화 완료: 유저 ' + result.userUpdated + '명, 전체 제한 ' + result.globalUpdated + '건';
        $('#shopLimitResetStatus').textContent = msg;
        toast('✅ ' + msg);
    } catch (e) {
        toast(e.message, false);
    }
};
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
// 공통: JSON 서브 에디터 (작은 textarea + 파싱)
// ============================================================================
function jsonSubEditor(label, getter, setter, placeholder, rows) {
    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1', minWidth: '220px' } });
    const initial = getter();
    const ta = el('textarea', {
        spellcheck: false,
        placeholder: placeholder || '',
        style: { minHeight: ((rows || 2) * 22) + 'px', fontSize: '12px', fontFamily: 'ui-monospace, monospace' },
        value: initial == null ? '' : JSON.stringify(initial, null, 2)
    });
    const status = el('span', { class: 'muted', style: { fontSize: '11px' } }, '');
    ta.addEventListener('blur', () => {
        const text = ta.value.trim();
        if (text === '') { setter(undefined); status.textContent = '(미설정)'; status.style.color = ''; return; }
        try {
            const parsed = JSON.parse(text);
            setter(parsed);
            status.textContent = '✓ 적용됨';
            status.style.color = '#86efac';
            ta.value = JSON.stringify(parsed, null, 2);
        } catch (e) {
            status.textContent = '⚠ JSON 파싱 실패: ' + e.message;
            status.style.color = '#fca5a5';
        }
    });
    wrap.appendChild(el('label', null, label));
    wrap.appendChild(ta);
    wrap.appendChild(status);
    return wrap;
}

function invalidateLookupCache(keys) {
    (keys || []).forEach(k => { LOOKUP[k] = null; });
}

function sectionTitle(title, _ignoredIcon, hint) {
    return el('div', { class: 'section-title' },
        el('span', null, title),
        hint ? el('span', { class: 'hint' }, hint) : null
    );
}

// switchToggle: 이쁨 스위치 토글
function switchToggle(opts) {
    const id = opts && opts.id || ('sw_' + Math.random().toString(36).slice(2));
    const checked = !!(opts && opts.checked);
    const inp = el('input', { type: 'checkbox', id: id, checked: checked, onchange: e => opts && opts.onChange && opts.onChange(e.target.checked) });
    const label = el('label', { class: 'switch', for: id, title: opts && opts.title || '' },
        inp,
        el('span', { class: 'track' }),
        opts && opts.label ? el('span', { class: 'switch-label' }, opts.label) : null
    );
    return label;
}

// ============================================================================
// ITEM 에디터  ( data: Array<{name, type, desc?, no_trade?, pack?, num?, use?, use_func?, require?, ...}> )
// ============================================================================
let itemData = [];
let itemFilterText = '';
const ITEM_TYPES = ['재료', '가챠', '번들', '사용', '소모품', '티켓', '미끼', '이벤트'];
const ITEM_KNOWN_FIELDS = new Set(['name', 'desc', 'type', 'no_trade', 'pack', 'num', 'use', 'use_func', 'require', 'protect']);

function itemCard(item, index) {
    const card = el('div', { class: 'card' });
    const head = el('div', { class: 'card-head' },
        el('div', { class: 'card-title' },
            el('span', { class: 'tag b' }, '#' + index),
            ' ',
            item.name || '(이름 없음)',
            item.type ? el('span', { class: 'tag', style: { marginLeft: '8px' } }, item.type) : null,
            item.no_trade ? el('span', { class: 'tag r', style: { marginLeft: '4px' } }, '거래불가') : null
        ),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => {
            if (!confirm('아이템 #' + index + ' (' + (item.name || '') + ')을(를) 삭제합니까?\n* 후속 인덱스가 모두 -1씩 당겨집니다.')) return;
            itemData.splice(index, 1);
            renderItem();
        } }, '삭제')
    );
    card.appendChild(head);

    // 기본 정보
    card.appendChild(sectionTitle('기본 정보', '📝'));
    const row1 = el('div', { class: 'row' });
    row1.appendChild(el('div', null, el('label', null, '이름'),
        el('input', { value: item.name || '', placeholder: '아이템 이름', oninput: e => item.name = e.target.value })
    ));
    const typeSel = el('select');
    ITEM_TYPES.forEach(t => typeSel.appendChild(el('option', { value: t }, t)));
    if (item.type && !ITEM_TYPES.includes(item.type)) typeSel.appendChild(el('option', { value: item.type }, item.type + ' (사용자 지정)'));
    typeSel.value = item.type || '재료';
    typeSel.onchange = () => item.type = typeSel.value;
    row1.appendChild(el('div', null, el('label', null, '분류'), typeSel));
    row1.appendChild(el('div', { class: 'nf', style: { minWidth: '140px' } },
        el('label', null, '거래 불가'),
        el('div', { style: { padding: '7px 0' } },
            switchToggle({
                id: 'item_nt_' + index,
                checked: !!item.no_trade,
                label: item.no_trade ? '거래 제한' : '거래 가능',
                onChange: v => { if (v) item.no_trade = true; else delete item.no_trade; renderItem(); }
            })
        )
    ));
    card.appendChild(row1);

    card.appendChild(el('div', null, el('label', null, '설명'),
        el('textarea', { value: item.desc || '', placeholder: '아이템 설명', style: { minHeight: '50px', fontFamily: 'inherit', fontSize: '13px' }, oninput: e => item.desc = e.target.value })
    ));

    // 가챠 / 번들 설정
    card.appendChild(sectionTitle('가챠 / 번들 설정'));
    const row3 = el('div', { class: 'row' });
    const packTypeSel = el('select');
    ['없음', '목록 번호 (Pack/Bundle 인덱스)', '카드팩 / 장비 상자 객체'].forEach(t => packTypeSel.appendChild(el('option', null, t)));
    const currentPackKind = (typeof item.pack === 'undefined') ? 0 : (typeof item.pack === 'number' ? 1 : 2);
    packTypeSel.selectedIndex = currentPackKind;
    const packTarget = el('div', { style: { flex: '1', minWidth: '180px' } });
    function paintPackTarget() {
        packTarget.innerHTML = '';
        const kind = packTypeSel.selectedIndex;
        if (kind === 0) { delete item.pack; return; }
        if (kind === 1) {
            if (typeof item.pack !== 'number') item.pack = 0;
            packTarget.appendChild(el('input', { type: 'number', min: 0, value: Number(item.pack || 0), oninput: e => item.pack = Number(e.target.value || 0) }));
            return;
        }
        if (kind === 2) {
            if (!item.pack || typeof item.pack !== 'object') item.pack = { type: '캐릭터 카드팩', range: { min: 1, max: 1 } };
            packTarget.appendChild(jsonSubEditor('', () => item.pack, v => { if (v == null) delete item.pack; else item.pack = v; }, '예: { "type": "캐릭터 카드팩", "range": { "min": 1, "max": 1 } }', 4));
        }
    }
    packTypeSel.onchange = paintPackTarget;
    row3.appendChild(el('div', null, el('label', null, '가챠 종류'), packTypeSel));
    row3.appendChild(packTarget);
    row3.appendChild(el('div', { class: 'nf' }, el('label', null, '가챠 추첨 횟수'),
        el('input', { type: 'number', min: 1, value: Number(item.num || 0) || '', placeholder: '기본 1', oninput: e => { const v = Number(e.target.value); if (!v) delete item.num; else item.num = v; } })
    ));
    card.appendChild(row3);
    paintPackTarget();

    // 사용 효과 / 조건
    card.appendChild(sectionTitle('사용 효과 / 조건', '✨'));
    const row4 = el('div', { class: 'row' });
    row4.appendChild(jsonSubEditor('사용 키 (use)', () => item.use, v => { if (v == null || v === '') delete item.use; else item.use = v; }, '예: "캐릭터변환"', 1));
    row4.appendChild(jsonSubEditor('소모품 효과 (use_func)', () => item.use_func, v => { if (v == null) delete item.use_func; else item.use_func = v; }, '예: [{ "type": "체력회복", "amount": 100 }]', 4));
    row4.appendChild(jsonSubEditor('사용 조건 (require)', () => item.require, v => { if (v == null) delete item.require; else item.require = v; }, '예: [{ "id": 17, "count": 3 }]', 3));
    row4.appendChild(jsonSubEditor('카드 보호 (protect)', () => item.protect, v => { if (v == null) delete item.protect; else item.protect = v; }, '예: { "star": 5 }', 2));
    card.appendChild(row4);

    // 기타 필드
    const extraKeys = Object.keys(item).filter(k => !ITEM_KNOWN_FIELDS.has(k));
    if (extraKeys.length > 0) {
        const extraObj = {};
        extraKeys.forEach(k => { extraObj[k] = item[k]; });
        card.appendChild(sectionTitle('기타 필드 (raw JSON)', '⚙️'));
        card.appendChild(jsonSubEditor('', () => extraObj, v => {
            extraKeys.forEach(k => delete item[k]);
            if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (!ITEM_KNOWN_FIELDS.has(k)) item[k] = v[k]; });
        }, '', 3));
    }
    return card;
}

function renderItem() {
    const list = $('#itemList'); list.innerHTML = '';
    if (!Array.isArray(itemData)) itemData = [];
    const q = (itemFilterText || '').trim().toLowerCase();
    let shown = 0;
    itemData.forEach((item, idx) => {
        if (!item) return;
        if (q) {
            const hay = (idx + ' ' + (item.name || '') + ' ' + (item.type || '') + ' ' + (item.desc || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        list.appendChild(itemCard(item, idx));
        shown++;
    });
    if (shown === 0) list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '아이템이 없습니다.'));
}
$('#itemAdd').onclick = () => { itemData.push({ name: '', type: '재료', desc: '' }); itemFilterText = ''; if ($('#itemFilter')) $('#itemFilter').value = ''; renderItem(); };
$('#itemReload').onclick = async () => {
    try { itemData = (await loadKey('Item')) || []; renderItem(); $('#itemStatus').textContent = '로드 완료 (' + itemData.length + '개)'; invalidateLookupCache(['items']); }
    catch (e) { toast(e.message, false); }
};
$('#itemSave').onclick = async () => {
    if (!confirm('Item 데이터를 저장합니다. 인덱스 변경이 있다면 다른 데이터(Pack/Shop 등)와의 호환성을 다시 확인하세요. 계속할까요?')) return;
    try { await saveKey('Item', itemData); invalidateLookupCache(['items']); toast('✅ Item 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#itemFilter')) $('#itemFilter').addEventListener('input', e => { itemFilterText = e.target.value; renderItem(); });
TAB_LOADERS.item = () => $('#itemReload').click();

// ============================================================================
// 공통: 능력치 / 강화 / 요구조건 에디터 (장비 · 패션용)
// ============================================================================

// 능력치 정의 — formatEquipmentStatLines / formatStatValue 기준
// kind:
//   'int'     : 정수, raw 표시
//   'percent' : 0~1 사이 소수 저장, UI에는 % (×100) 표시
//   'cooldown': ms 저장, UI에는 ms 그대로 (음수=감소)
const FLAT_STAT_DEFS = [
    { key: 'atk', label: '공격력', kind: 'int' },
    { key: 'def', label: '방어력', kind: 'int' },
    { key: 'hp', label: '체력', kind: 'int' },
    { key: 'mp', label: 'MP', kind: 'int' },
    { key: 'pnt', label: '방어 관통력', kind: 'int' },
    { key: 'plusGold', label: '처치 당 골드', kind: 'int' },
    { key: 'crit', label: '치명타 확률', kind: 'percent' },
    { key: 'critMul', label: '치명타 피해량', kind: 'percent' },
    { key: 'critDef', label: '치명타 피해 감소율', kind: 'percent' },
    { key: 'cmb', label: '연격 확률', kind: 'percent' },
    { key: 'maxCmb', label: '추가 공격 횟수', kind: 'int' },
    { key: 'skillCooldown', label: '스킬 쿨타임 (ms, 음수=감소)', kind: 'cooldown' },
    { key: 'skillTrueDmg', label: '스킬 사용 시 추가 고정 피해', kind: 'int' }
];

const PLUS_STAT_DEFS = [
    { key: 'atk', label: '최종 공격력', kind: 'percent' },
    { key: 'def', label: '최종 방어력', kind: 'percent' },
    { key: 'hp', label: '최종 체력', kind: 'percent' },
    { key: 'mp', label: '최종 MP', kind: 'percent' },
    { key: 'pnt', label: '방어력 관통', kind: 'percent' },
    { key: 'gold', label: '골드 획득량', kind: 'percent' },
    { key: 'potion', label: '물약 효율', kind: 'percent' },
    { key: 'recoveryEfficiency', label: '회복 효율', kind: 'percent' },
    { key: 'afterBasic', label: '일반 공격 피해', kind: 'percent' },
    { key: 'avd', label: '회피 확률', kind: 'percent' },
    { key: 'afterSkill', label: '스킬 공격 피해', kind: 'percent' },
    { key: '000', label: '공격 시 10/100/1000 추가 피해 확률', kind: 'percent' },
    { key: 'exp', label: '경험치 획득량', kind: 'percent' },
    { key: 'eliteDmg', label: '엘리트 몬스터 대상 추가 피해', kind: 'percent' },
    { key: 'mpReduce', label: 'MP 소모량', kind: 'percent' },
    { key: 'itemDropChance', label: '아이템 획득 확률', kind: 'percent' },
    { key: 'crit', label: '치명타 확률', kind: 'percent' },
    { key: 'critMul', label: '치명타 피해량', kind: 'percent' },
    { key: 'critDef', label: '치명타 피해 감소율', kind: 'percent' },
    { key: 'cmb', label: '연격 확률', kind: 'percent' },
    { key: 'maxCmb', label: '추가 공격 횟수', kind: 'int' },
    { key: 'skillCooldown', label: '스킬 쿨타임 (ms, 음수=감소)', kind: 'cooldown' },
    { key: 'skillTrueDmg', label: '스킬 사용 시 추가 고정 피해', kind: 'int' },
    { key: 'takenDamage', label: '받는 피해 증가', kind: 'percent' },
    { key: 'damageBonus', label: '일반 몬스터에게 주는 피해 증가', kind: 'percent' },
    { key: 'summonDuration', label: '소환 지속시간', kind: 'percent' }
];

function statKindUnit(kind) {
    if (kind === 'percent') return '%';
    if (kind === 'cooldown') return 'ms';
    return '';
}

function statValueToInputValue(kind, raw) {
    if (raw == null || raw === '') return '';
    if (kind === 'percent') return Math.round(Number(raw) * 10000) / 100; // 0.05 → 5
    return Number(raw);
}

function statInputValueToRaw(kind, str) {
    if (str === '' || str == null) return undefined;
    const n = Number(str);
    if (!Number.isFinite(n)) return undefined;
    if (kind === 'percent') return Math.round(n * 100) / 10000; // 5 → 0.05
    if (kind === 'int') return Math.round(n);
    return n;
}

// statEditor: 객체 obj의 능력치를 정의(defs) 기반 폼으로 편집
function statEditor(title, _ignoredIcon, obj, defs) {
    const wrap = el('div', { class: 'section', style: { marginTop: 0 } });
    if (title) {
        wrap.appendChild(el('div', { class: 'section-title' },
            el('span', null, title)
        ));
    }
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
    wrap.appendChild(list);

    function repaint() {
        list.innerHTML = '';
        if (!obj || typeof obj !== 'object') return;
        const definedKeys = new Set(defs.map(d => d.key));
        const definedDefs = defs.filter(d => Object.prototype.hasOwnProperty.call(obj, d.key));
        const extraKeys = Object.keys(obj).filter(k => !definedKeys.has(k));

        if (definedDefs.length === 0 && extraKeys.length === 0) {
            list.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', padding: '4px 0' } }, '설정된 능력치가 없습니다.'));
        } else {
            definedDefs.forEach(def => list.appendChild(buildRow(def, false)));
            extraKeys.forEach(key => list.appendChild(buildRow({ key, label: key, kind: 'int' }, true)));
        }

        const remaining = defs.filter(d => !Object.prototype.hasOwnProperty.call(obj, d.key));
        const addRow = el('div', { class: 'stat-add' });
        const sel = el('select');
        sel.appendChild(el('option', { value: '' }, '+ 능력치 추가...'));
        remaining.forEach(d => sel.appendChild(el('option', { value: d.key }, d.label)));
        sel.onchange = () => {
            if (!sel.value) return;
            const def = defs.find(d => d.key === sel.value);
            if (!def) return;
            obj[def.key] = 0;
            repaint();
        };
        const customBtn = el('button', { class: 'btn sm', type: 'button', title: '임의 키 추가 (고급)', onclick: () => {
            const k = prompt('커스텀 키:');
            if (!k) return;
            if (Object.prototype.hasOwnProperty.call(obj, k)) return toast('이미 존재하는 키', false);
            obj[k] = 0; repaint();
        } }, '➕');
        addRow.appendChild(sel);
        addRow.appendChild(customBtn);
        list.appendChild(addRow);
    }

    function buildRow(def, isCustom) {
        const row = el('div', { class: 'stat-row' });
        const nameCell = el('div', { class: 'name', title: def.key },
            def.label,
            isCustom ? el('span', { class: 'field-name' }, def.key) : null
        );
        const inputVal = statValueToInputValue(def.kind, obj[def.key]);
        const inp = el('input', { type: 'number', step: def.kind === 'percent' ? '0.01' : (def.kind === 'cooldown' ? '100' : '1'), value: inputVal, oninput: () => {
            const raw = statInputValueToRaw(def.kind, inp.value);
            if (typeof raw === 'undefined') delete obj[def.key];
            else obj[def.key] = raw;
        } });
        const unit = el('div', { class: 'unit' }, statKindUnit(def.kind) || '–');
        const delBtn = el('button', { class: 'btn icon danger', type: 'button', title: '제거', onclick: () => { delete obj[def.key]; repaint(); } }, '✕');
        row.appendChild(nameCell);
        row.appendChild(inp);
        row.appendChild(unit);
        row.appendChild(delBtn);
        return row;
    }

    repaint();
    return wrap;
}

// upgradeEditor: 강화 단계 배열을 편집. 각 단계는 { stat?, plusStat? } — 접을 수 있는 패널
function upgradeStepSummary(step) {
    const parts = [];
    function describe(obj, defs, isPlus) {
        Object.keys(obj || {}).forEach(k => {
            const def = defs.find(d => d.key === k) || { key: k, label: k, kind: isPlus ? 'percent' : 'int' };
            const v = obj[k];
            if (v == null || v === 0) return;
            const sign = Number(v) > 0 ? '+' : '';
            if (def.kind === 'percent') parts.push(def.label + ' ' + sign + (Math.round(Number(v) * 1000) / 10) + '%');
            else if (def.kind === 'cooldown') parts.push(def.label + ' ' + sign + (Math.round(Number(v) / 100) / 10) + '초');
            else parts.push(def.label + ' ' + sign + v);
        });
    }
    describe(step.stat, FLAT_STAT_DEFS, false);
    describe(step.plusStat, PLUS_STAT_DEFS, true);
    return parts.length ? parts.join(' · ') : '설정 없음';
}

function upgradeEditor(getter, setter, options) {
    const wrap = el('div');
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    wrap.appendChild(list);
    const includeSupport = !!(options && options.support);

    function arr() {
        let v = getter();
        if (!Array.isArray(v)) { v = []; setter(v); }
        return v;
    }

    function repaint() {
        list.innerHTML = '';
        const items = arr();
        if (items.length === 0) {
            list.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', padding: '4px 0' } }, '강화 단계가 없습니다.'));
        } else {
            items.forEach((step, i) => {
                if (!step || typeof step !== 'object') { items[i] = step = {}; }
                if (!step.stat || typeof step.stat !== 'object') step.stat = {};
                if (!step.plusStat || typeof step.plusStat !== 'object') step.plusStat = {};

                const det = el('details', { class: 'collapsible' });
                const sum = el('summary');
                sum.appendChild(el('span', { style: { fontWeight: '600' } }, '+' + (i + 1)));
                sum.appendChild(el('span', { class: 'summary-meta' }, upgradeStepSummary(step)));
                const actions = el('span', { class: 'actions' });
                const stop = e => { e.preventDefault(); e.stopPropagation(); };
                actions.appendChild(el('button', { class: 'btn sm', type: 'button', title: '위로', onclick: e => { stop(e); if (i === 0) return; const t = items[i]; items[i] = items[i - 1]; items[i - 1] = t; repaint(); } }, '↑'));
                actions.appendChild(el('button', { class: 'btn sm', type: 'button', title: '아래로', onclick: e => { stop(e); if (i === items.length - 1) return; const t = items[i]; items[i] = items[i + 1]; items[i + 1] = t; repaint(); } }, '↓'));
                actions.appendChild(el('button', { class: 'btn sm danger', type: 'button', title: '삭제', onclick: e => { stop(e); if (!confirm('+' + (i + 1) + ' 단계를 삭제할까요?')) return; items.splice(i, 1); repaint(); } }, '삭제'));
                sum.appendChild(actions);
                det.appendChild(sum);

                const body = el('div', { class: 'body' });
                const inner = el('div', { class: 'split' });
                inner.appendChild(statEditor('기본 능력치 증가', '⚔️', step.stat, FLAT_STAT_DEFS));
                inner.appendChild(statEditor('비율 증가', '📈', step.plusStat, PLUS_STAT_DEFS));
                body.appendChild(inner);
                if (includeSupport) {
                    if (!step.statRange || typeof step.statRange !== 'object') step.statRange = {};
                    if (!step.plusStatRange || typeof step.plusStatRange !== 'object') step.plusStatRange = {};
                    const innerRange = el('div', { class: 'split' });
                    innerRange.appendChild(statEditor('무작위 범위 증가 (기본)', '🎲', step.statRange, FLAT_STAT_DEFS));
                    innerRange.appendChild(statEditor('무작위 범위 증가 (비율)', '🎲', step.plusStatRange, PLUS_STAT_DEFS));
                    body.appendChild(innerRange);
                    body.appendChild(dynamicBonusEditor(() => step.dynamicBonus, v => { if (v == null) delete step.dynamicBonus; else step.dynamicBonus = v; }, { titleSuffix: ' 증가' }));
                }
                det.appendChild(body);
                list.appendChild(det);
            });
        }
        const bar = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } });
        bar.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => { items.push({ stat: {}, plusStat: {} }); repaint(); } }, '+ 단계 추가'));
        if (items.length > 0) bar.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => {
            list.querySelectorAll('details.collapsible').forEach(d => d.open = true);
        } }, '모두 펼치기'));
        if (items.length > 0) bar.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => {
            list.querySelectorAll('details.collapsible').forEach(d => d.open = false);
        } }, '모두 접기'));
        list.appendChild(bar);
    }

    repaint();
    return wrap;
}

// requireMainCardEditor: 보조 장비의 requireMainCard 편집 (캐릭터 카드 id 배열)
function requireMainCardEditor(getter, setter) {
    const wrap = el('div', { class: 'tag-list' });
    function arr() {
        let v = getter();
        if (!Array.isArray(v)) { v = []; setter(v); }
        return v;
    }
    function repaint() {
        wrap.innerHTML = '';
        const items = arr();
        if (items.length === 0) wrap.appendChild(el('span', { class: 'muted', style: { fontSize: '12px' } }, '제한 없음 (모든 메인 카드에서 효과 발동).'));
        items.forEach((cardId, i) => {
            const pill = el('span', { class: 'tag-pill' });
            const labelNode = el('span', null, '#' + cardId);
            pill.appendChild(labelNode);
            getCards().then(cards => {
                const c = cards.find(x => x.id === Number(cardId));
                if (c) labelNode.textContent = c.name + ' #' + cardId;
            }).catch(() => {});
            pill.appendChild(el('button', { type: 'button', title: '제거', onclick: () => { items.splice(i, 1); repaint(); } }, '✕'));
            wrap.appendChild(pill);
        });
        wrap.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => pickCard(card => { if (!items.includes(card.id)) items.push(card.id); repaint(); }) }, '+ 카드 추가'));
    }
    repaint();
    return wrap;
}

// dynamicBonusEditor: data.dynamicBonus.mainCardStar[star] = { stat, plusStat }
function dynamicBonusEditor(getter, setter, options) {
    const wrap = el('div');
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    wrap.appendChild(list);
    const titleSuffix = (options && options.titleSuffix) || '';

    function obj() {
        let v = getter();
        if (!v || typeof v !== 'object') { v = {}; setter(v); }
        if (!v.mainCardStar || typeof v.mainCardStar !== 'object') v.mainCardStar = {};
        return v;
    }

    function repaint() {
        list.innerHTML = '';
        const root = obj();
        const map = root.mainCardStar;
        // 마이그레이션: 숫자값은 { plusStat: { atk: n } } 으로 자동 변환
        Object.keys(map).forEach(starKey => {
            const v = map[starKey];
            if (typeof v === 'number') map[starKey] = { stat: {}, plusStat: { atk: v } };
            else if (!v || typeof v !== 'object') map[starKey] = { stat: {}, plusStat: {} };
            else {
                if (!v.stat || typeof v.stat !== 'object') v.stat = {};
                if (!v.plusStat || typeof v.plusStat !== 'object') v.plusStat = {};
            }
        });
        const stars = Object.keys(map).sort((a, b) => Number(a) - Number(b));
        if (stars.length === 0) {
            list.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', padding: '4px 0' } }, '메인 카드 성급 보너스가 없습니다.'));
        }
        stars.forEach(starKey => {
            const entry = map[starKey];
            const det = el('details', { class: 'collapsible' });
            const sum = el('summary');
            sum.appendChild(el('span', { style: { fontWeight: '600' } }, (Number(starKey) + 1) + '성'));
            sum.appendChild(el('span', { class: 'summary-meta' }, upgradeStepSummary(entry)));
            const actions = el('span', { class: 'actions' });
            const stop = e => { e.preventDefault(); e.stopPropagation(); };
            actions.appendChild(el('button', { class: 'btn sm danger', type: 'button', title: '삭제', onclick: e => { stop(e); if (!confirm((Number(starKey) + 1) + '성 보너스를 삭제할까요?')) return; delete map[starKey]; repaint(); } }, '삭제'));
            sum.appendChild(actions);
            det.appendChild(sum);
            const body = el('div', { class: 'body' });
            const inner = el('div', { class: 'split' });
            inner.appendChild(statEditor('기본 능력치' + titleSuffix, '⚔️', entry.stat, FLAT_STAT_DEFS));
            inner.appendChild(statEditor('비율 증가' + titleSuffix, '📈', entry.plusStat, PLUS_STAT_DEFS));
            body.appendChild(inner);
            det.appendChild(body);
            list.appendChild(det);
        });
        const bar = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' } });
        const starIn = el('input', { type: 'number', min: 0, max: 11, value: '', placeholder: '성급(0=1성)', style: { width: '120px' } });
        bar.appendChild(el('span', { class: 'lab' }, '추가 성급'));
        bar.appendChild(starIn);
        bar.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => {
            const raw = String(starIn.value || '').trim();
            if (raw === '') return;
            const s = Number(raw);
            if (!Number.isInteger(s) || s < 0) { alert('0 이상의 정수를 입력하세요.'); return; }
            const key = String(s);
            if (map[key]) { alert('이미 존재하는 성급입니다.'); return; }
            map[key] = { stat: {}, plusStat: {} };
            starIn.value = '';
            repaint();
        } }, '+ 성급 보너스 추가'));
        list.appendChild(bar);
    }

    repaint();
    return wrap;
}

// equipmentRequireEditor: 장비 require 편집
//   format: [{ type: '무기'|'갑옷'|'장신구', weapon_id|armor_id|accessory_id: number }, ...]
function equipmentRequireEditor(getter, setter) {
    const wrap = el('div');
    const list = el('div', { class: 'entry-list' });
    wrap.appendChild(list);

    function arr() {
        let v = getter();
        if (!Array.isArray(v)) { v = []; setter(v); }
        return v;
    }

    const TYPE_TO_SLOT = { '무기': 'weapon', '갑옷': 'armor', '장신구': 'accessory' };
    const TYPE_TO_KEY = { '무기': 'weapon_id', '갑옷': 'armor_id', '장신구': 'accessory_id' };

    function repaint() {
        list.innerHTML = '';
        const items = arr();
        items.forEach((req, i) => {
            const row = el('div', { class: 'entry' });
            const typeSel = el('select', { style: { width: '90px', flex: '0 0 auto' } });
            ['무기', '갑옷', '장신구'].forEach(t => typeSel.appendChild(el('option', { value: t }, t)));
            if (!req.type || !TYPE_TO_SLOT[req.type]) req.type = '장신구';
            typeSel.value = req.type;
            const idDisplay = el('button', { class: 'pickbtn', type: 'button', style: { flex: '1' } });
            const refresh = async () => {
                idDisplay.innerHTML = '';
                const slot = TYPE_TO_SLOT[req.type];
                const idKey = TYPE_TO_KEY[req.type];
                const idVal = req[idKey];
                if (typeof idVal === 'number') {
                    const eq = await getEquipment();
                    const found = (eq[slot] || []).find(x => x.id === idVal);
                    idDisplay.appendChild(found ? document.createTextNode('#' + found.id + ' [' + (found.rarity || '') + '] ' + found.name) : el('span', { class: 'ph' }, '없는 장비 #' + idVal));
                } else idDisplay.innerHTML = '<span class="ph">' + req.type + ' 선택...</span>';
            };
            idDisplay.onclick = () => pickEquipment(TYPE_TO_SLOT[req.type], picked => {
                ['weapon_id', 'armor_id', 'accessory_id'].forEach(k => delete req[k]);
                req[TYPE_TO_KEY[req.type]] = picked.id;
                refresh();
            });
            typeSel.onchange = () => {
                req.type = typeSel.value;
                ['weapon_id', 'armor_id', 'accessory_id'].forEach(k => delete req[k]);
                refresh();
            };
            const delBtn = el('button', { class: 'btn icon danger', type: 'button', onclick: () => { items.splice(i, 1); repaint(); } }, '✕');
            row.appendChild(typeSel);
            row.appendChild(idDisplay);
            row.appendChild(delBtn);
            list.appendChild(row);
            refresh();
        });
        list.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => { items.push({ type: '장신구' }); repaint(); } }, '+ 조건 추가'));
        if (items.length === 0) list.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', padding: '4px' } }, '효과 발동에 필요한 다른 장비가 없습니다.'));
    }

    repaint();
    return wrap;
}

// ============================================================================
// EQUIPMENT 에디터  ( data: { weapon: [...], armor: [...], accessory: [...] } )
// ============================================================================
let equipData = { weapon: [], armor: [], accessory: [], support: [] };
let equipCurrentSlot = 'weapon';
let equipFilterText = '';
const EQUIP_RARITIES = ['일반', '레어', '에픽', '유니크', '레전더리', '신화', '고유'];
const EQUIP_KNOWN_FIELDS = new Set(['name', 'desc', 'rarity', 'stat', 'plusStat', 'statRange', 'plusStatRange', 'upgrade', 'evolution', 'requireLevel', 'underLevel', 'exactlyStar', 'require', 'requireMainCard', 'dynamicBonus', 'no_trade', 'category', 'isRaid']);

function renderEquipTypes() {
    const wrap = $('#equipTypes'); wrap.innerHTML = '';
    [['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구'], ['support', '보조']].forEach(([k, label]) => {
        const arr = (equipData && equipData[k]) || [];
        const b = el('button', { class: 'subtab' + (equipCurrentSlot === k ? ' active' : ''), type: 'button',
            onclick: () => { equipCurrentSlot = k; renderEquipTypes(); renderEquip(); } }, label + ' (' + arr.length + ')');
        wrap.appendChild(b);
    });
}

function equipCard(eq, index) {
    const card = el('div', { class: 'card' });
    const rarityClass = ({ '일반': '', '레어': 'b', '에픽': 'p', '유니크': 'y', '레전더리': 'y', '신화': 'r', '고유': 'g' })[eq.rarity] || '';
    const head = el('div', { class: 'card-head' },
        el('div', { class: 'card-title' },
            el('span', { class: 'tag b' }, '#' + index),
            ' ',
            eq.name || '(이름 없음)',
            eq.rarity ? el('span', { class: 'tag ' + rarityClass, style: { marginLeft: '8px' } }, eq.rarity) : null,
            eq.no_trade ? el('span', { class: 'tag r', style: { marginLeft: '4px' } }, '거래불가') : null,
            eq.isRaid ? el('span', { class: 'tag r', style: { marginLeft: '4px' } }, '레이드') : null,
            eq.category ? el('span', { class: 'tag', style: { marginLeft: '4px' } }, String(eq.category)) : null
        ),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => {
            if (!confirm('장비 #' + index + ' (' + (eq.name || '') + ')을(를) 삭제합니까?\n* 후속 인덱스가 모두 -1씩 당겨집니다.')) return;
            equipData[equipCurrentSlot].splice(index, 1);
            renderEquipTypes(); renderEquip();
        } }, '삭제')
    );
    card.appendChild(head);

    // 기본 정보
    card.appendChild(sectionTitle('기본 정보', '📝'));
    const row1 = el('div', { class: 'row' });
    row1.appendChild(el('div', null, el('label', null, '이름'),
        el('input', { value: eq.name || '', placeholder: '장비 이름', oninput: e => eq.name = e.target.value })
    ));
    const raritySel = el('select');
    EQUIP_RARITIES.forEach(r => raritySel.appendChild(el('option', { value: r }, r)));
    if (eq.rarity && !EQUIP_RARITIES.includes(eq.rarity)) raritySel.appendChild(el('option', { value: eq.rarity }, eq.rarity + ' (사용자 지정)'));
    raritySel.value = eq.rarity || '일반';
    raritySel.onchange = () => eq.rarity = raritySel.value;
    row1.appendChild(el('div', null, el('label', null, '등급'), raritySel));
    row1.appendChild(el('div', null, el('label', null, '분류(category)'),
        el('input', { value: eq.category || '', placeholder: '예: 반지, 목걸이', oninput: e => { const v = e.target.value.trim(); if (v) eq.category = v; else delete eq.category; } })
    ));
    row1.appendChild(el('div', { class: 'nf', style: { minWidth: '140px' } },
        el('label', null, '거래 불가'),
        el('div', { style: { padding: '7px 0' } },
            switchToggle({
                id: 'eq_nt_' + index,
                checked: !!eq.no_trade,
                label: eq.no_trade ? '거래 제한' : '거래 가능',
                onChange: v => { if (v) eq.no_trade = true; else delete eq.no_trade; renderEquip(); }
            })
        )
    ));
    row1.appendChild(el('div', { class: 'nf', style: { minWidth: '140px' } },
        el('label', null, '레이드 장비'),
        el('div', { style: { padding: '7px 0' } },
            switchToggle({
                id: 'eq_raid_' + equipCurrentSlot + '_' + index,
                checked: !!eq.isRaid,
                label: eq.isRaid ? '레이드' : '일반',
                onChange: v => { if (v) eq.isRaid = true; else delete eq.isRaid; renderEquip(); }
            })
        )
    ));
    card.appendChild(row1);

    card.appendChild(el('div', null, el('label', null, '설명'),
        el('textarea', { value: eq.desc || '', placeholder: '장비 설명', style: { minHeight: '40px', fontFamily: 'inherit', fontSize: '13px' }, oninput: e => eq.desc = e.target.value })
    ));

    // 장착 조건
    card.appendChild(sectionTitle('장착 조건', '🔒'));
    const row3 = el('div', { class: 'row' });
    function numField(label, key, placeholder) {
        const inp = el('input', { type: 'number', value: typeof eq[key] === 'number' ? eq[key] : '', placeholder: placeholder || '',
            oninput: e => { const v = e.target.value; if (v === '') delete eq[key]; else eq[key] = Number(v); } });
        return el('div', { class: 'nf' }, el('label', null, label), inp);
    }
    row3.appendChild(numField('장착 필요 레벨', 'requireLevel', '예: 10'));
    row3.appendChild(numField('장착 가능 최대 레벨', 'underLevel', '예: 30'));
    row3.appendChild(numField('메인카드 성급 조건', 'exactlyStar', '0=1성, 5=6성'));
    row3.appendChild(numField('진화 단계', 'evolution', '예: 4'));
    card.appendChild(row3);

    // 기본 능력치 / 비율 증가
    card.appendChild(sectionTitle('능력치', '✨'));
    if (!eq.stat || typeof eq.stat !== 'object') eq.stat = {};
    if (!eq.plusStat || typeof eq.plusStat !== 'object') eq.plusStat = {};
    const row4 = el('div', { class: 'split' });
    row4.appendChild(statEditor('기본 능력치', '⚔️', eq.stat, FLAT_STAT_DEFS));
    row4.appendChild(statEditor('비율 증가', '📈', eq.plusStat, PLUS_STAT_DEFS));
    card.appendChild(row4);

    const isSupport = equipCurrentSlot === 'support';
    if (isSupport) {
        // 무작위 능력치 범위
        card.appendChild(sectionTitle('무작위 능력치 범위', '🎲'));
        if (!eq.statRange || typeof eq.statRange !== 'object') eq.statRange = {};
        if (!eq.plusStatRange || typeof eq.plusStatRange !== 'object') eq.plusStatRange = {};
        const rangeRow = el('div', { class: 'split' });
        rangeRow.appendChild(statEditor('기본 능력치 범위', '⚔️', eq.statRange, FLAT_STAT_DEFS));
        rangeRow.appendChild(statEditor('비율 증가 범위', '📈', eq.plusStatRange, PLUS_STAT_DEFS));
        card.appendChild(rangeRow);

        // 메인 카드 성급 보너스
        card.appendChild(sectionTitle('메인 카드 성급 보너스 (dynamicBonus)', '⭐'));
        card.appendChild(dynamicBonusEditor(() => eq.dynamicBonus, v => { if (v == null) delete eq.dynamicBonus; else eq.dynamicBonus = v; }));

        // 장착 가능 메인 카드
        card.appendChild(sectionTitle('장착 가능 메인 카드 (requireMainCard)', '🃏'));
        card.appendChild(requireMainCardEditor(() => eq.requireMainCard, v => { if (v == null) delete eq.requireMainCard; else eq.requireMainCard = v; }));
    }

    // 강화 단계
    card.appendChild(sectionTitle('강화 단계', '🔨'));
    card.appendChild(upgradeEditor(() => eq.upgrade, v => { if (v == null) delete eq.upgrade; else eq.upgrade = v; }, { support: isSupport }));

    // 동시 장착 조건
    card.appendChild(sectionTitle('동시 장착 조건', '🔗'));
    card.appendChild(equipmentRequireEditor(() => eq.require, v => { if (v == null) delete eq.require; else eq.require = v; }));

    // 기타 필드
    const extraKeys = Object.keys(eq).filter(k => !EQUIP_KNOWN_FIELDS.has(k));
    if (extraKeys.length > 0) {
        const extraObj = {};
        extraKeys.forEach(k => { extraObj[k] = eq[k]; });
        card.appendChild(sectionTitle('기타 필드 (raw JSON)', '⚙️'));
        card.appendChild(jsonSubEditor('', () => extraObj, v => {
            extraKeys.forEach(k => delete eq[k]);
            if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (!EQUIP_KNOWN_FIELDS.has(k)) eq[k] = v[k]; });
        }, '', 3));
    }
    return card;
}

function renderEquip() {
    const list = $('#equipList'); list.innerHTML = '';
    if (!equipData || typeof equipData !== 'object') equipData = { weapon: [], armor: [], accessory: [], support: [] };
    ['weapon', 'armor', 'accessory', 'support'].forEach(k => { if (!Array.isArray(equipData[k])) equipData[k] = []; });
    const arr = equipData[equipCurrentSlot] || [];
    const q = (equipFilterText || '').trim().toLowerCase();
    let shown = 0;
    arr.forEach((eq, idx) => {
        if (!eq) return;
        if (q) {
            const hay = (idx + ' ' + (eq.name || '') + ' ' + (eq.rarity || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        list.appendChild(equipCard(eq, idx));
        shown++;
    });
    if (shown === 0) list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '장비가 없습니다.'));
}
$('#equipAdd').onclick = () => {
    if (!equipData[equipCurrentSlot]) equipData[equipCurrentSlot] = [];
    equipData[equipCurrentSlot].push({ name: '', desc: '', rarity: '일반', stat: {}, plusStat: {} });
    equipFilterText = ''; if ($('#equipFilter')) $('#equipFilter').value = '';
    renderEquipTypes(); renderEquip();
};
$('#equipReload').onclick = async () => {
    try {
        const data = (await loadKey('Equipment')) || {};
        equipData = { weapon: Array.isArray(data.weapon) ? data.weapon : [], armor: Array.isArray(data.armor) ? data.armor : [], accessory: Array.isArray(data.accessory) ? data.accessory : [], support: Array.isArray(data.support) ? data.support : [] };
        renderEquipTypes(); renderEquip();
        $('#equipStatus').textContent = '로드 완료 (무기 ' + equipData.weapon.length + ' / 갑옷 ' + equipData.armor.length + ' / 장신구 ' + equipData.accessory.length + ' / 보조 ' + equipData.support.length + ')';
        invalidateLookupCache(['equipment']);
    } catch (e) { toast(e.message, false); }
};
$('#equipSave').onclick = async () => {
    if (!confirm('Equipment 데이터를 저장합니다. 계속?')) return;
    try { await saveKey('Equipment', equipData); invalidateLookupCache(['equipment']); toast('✅ Equipment 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#equipFilter')) $('#equipFilter').addEventListener('input', e => { equipFilterText = e.target.value; renderEquip(); });
TAB_LOADERS.equipment = () => $('#equipReload').click();

// ============================================================================
// FASHION 에디터  ( data: Array<{name, primary_card:[ids], requireStar?, isHigh?, option?:{stat?,plusStat?}}> )
// ============================================================================
let fashionData = [];
let fashionFilterText = '';
const FASHION_KNOWN_FIELDS = new Set(['name', 'primary_card', 'requireStar', 'isHigh', 'option']);

function fashionPrimaryCardRow(skin) {
    const wrap = el('div', { class: 'tag-list' });
    if (!Array.isArray(skin.primary_card)) skin.primary_card = [];
    function repaint() {
        wrap.innerHTML = '';
        if (skin.primary_card.length === 0) wrap.appendChild(el('span', { class: 'muted', style: { fontSize: '12px' } }, '아직 설정되지 않았습니다.'));
        skin.primary_card.forEach((cardId, i) => {
            const pill = el('span', { class: 'tag-pill' });
            const labelNode = el('span', null, '#' + cardId);
            pill.appendChild(labelNode);
            getCards().then(cards => {
                const c = cards.find(x => x.id === Number(cardId));
                if (c) labelNode.textContent = c.name + ' #' + cardId;
            }).catch(() => {});
            pill.appendChild(el('button', { type: 'button', title: '제거', onclick: () => { skin.primary_card.splice(i, 1); repaint(); } }, '✕'));
            wrap.appendChild(pill);
        });
        wrap.appendChild(el('button', { class: 'btn sm', type: 'button', onclick: () => pickCard(card => { if (!skin.primary_card.includes(card.id)) skin.primary_card.push(card.id); repaint(); }) }, '+ 카드 추가'));
    }
    repaint();
    return wrap;
}

function fashionCard(skin, index) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-head' },
        el('div', { class: 'card-title' },
            el('span', { class: 'tag b' }, '#' + index),
            ' ',
            skin.name || '(이름 없음)'
        ),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => {
            if (!confirm('스킨 #' + index + ' (' + (skin.name || '') + ')을(를) 삭제합니까?')) return;
            fashionData.splice(index, 1);
            renderFashion();
        } }, '삭제')
    ));

    card.appendChild(sectionTitle('기본 정보', '📝'));
    const row1 = el('div', { class: 'row' });
    row1.appendChild(el('div', null, el('label', null, '이름'),
        el('input', { value: skin.name || '', placeholder: '스킨 이름', oninput: e => skin.name = e.target.value })
    ));
    row1.appendChild(el('div', { class: 'nf' }, el('label', null, '필요 성급'),
        el('input', { type: 'number', min: 0, max: 11, value: typeof skin.requireStar === 'number' ? skin.requireStar : '', placeholder: '예: 5 (표시 6성)',
            oninput: e => { const v = e.target.value; if (v === '') delete skin.requireStar; else skin.requireStar = Number(v); } })
    ));
    row1.appendChild(el('div', { class: 'nf' }, el('label', null, '고급 여부'),
        el('label', { class: 'switch', style: { marginTop: '8px' } },
            el('input', { type: 'checkbox', checked: skin.isHigh === true, onchange: e => { if (e.target.checked) skin.isHigh = true; else delete skin.isHigh; } }),
            el('span', { class: 'track' }),
            el('span', null, '고급')
        )
    ));
    card.appendChild(row1);

    card.appendChild(sectionTitle('적용 가능한 캐릭터 카드', '🎭'));
    card.appendChild(fashionPrimaryCardRow(skin));

    card.appendChild(sectionTitle('능력치 옵션', '✨'));
    if (!skin.option || typeof skin.option !== 'object') skin.option = {};
    if (!skin.option.stat || typeof skin.option.stat !== 'object') skin.option.stat = {};
    if (!skin.option.plusStat || typeof skin.option.plusStat !== 'object') skin.option.plusStat = {};
    const row3 = el('div', { class: 'split' });
    row3.appendChild(statEditor('기본 능력치', '⚔️', skin.option.stat, FLAT_STAT_DEFS));
    row3.appendChild(statEditor('비율 증가', '📈', skin.option.plusStat, PLUS_STAT_DEFS));
    card.appendChild(row3);

    const extraKeys = Object.keys(skin).filter(k => !FASHION_KNOWN_FIELDS.has(k));
    if (extraKeys.length > 0) {
        const extraObj = {};
        extraKeys.forEach(k => { extraObj[k] = skin[k]; });
        card.appendChild(sectionTitle('기타 필드 (raw JSON)', '⚙️'));
        card.appendChild(jsonSubEditor('', () => extraObj, v => {
            extraKeys.forEach(k => delete skin[k]);
            if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (!FASHION_KNOWN_FIELDS.has(k)) skin[k] = v[k]; });
        }, '', 3));
    }
    return card;
}

function renderFashion() {
    const list = $('#fashionList'); list.innerHTML = '';
    if (!Array.isArray(fashionData)) fashionData = [];
    const q = (fashionFilterText || '').trim().toLowerCase();
    let shown = 0;
    fashionData.forEach((skin, idx) => {
        if (!skin) return;
        if (q && !((skin.name || '') + ' ' + idx).toLowerCase().includes(q)) return;
        list.appendChild(fashionCard(skin, idx));
        shown++;
    });
    if (shown === 0) list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '스킨이 없습니다.'));
}
$('#fashionAdd').onclick = () => { fashionData.push({ name: '', primary_card: [], option: {} }); fashionFilterText = ''; if ($('#fashionFilter')) $('#fashionFilter').value = ''; renderFashion(); };
$('#fashionReload').onclick = async () => {
    try { fashionData = (await loadKey('Fashion')) || []; renderFashion(); $('#fashionStatus').textContent = '로드 완료 (' + fashionData.length + '개)'; invalidateLookupCache(['fashion']); }
    catch (e) { toast(e.message, false); }
};
$('#fashionSave').onclick = async () => {
    if (!confirm('Fashion 데이터를 저장합니다. 계속?')) return;
    try { await saveKey('Fashion', fashionData); invalidateLookupCache(['fashion']); toast('✅ Fashion 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#fashionFilter')) $('#fashionFilter').addEventListener('input', e => { fashionFilterText = e.target.value; renderFashion(); });
TAB_LOADERS.fashion = () => $('#fashionReload').click();

// ============================================================================
// 거래 로그 (TradeLog)
// ============================================================================
let tradeLogData = [];
let tradeLogFilter = { q: '', tradeType: '', kind: '' };

const TRADE_TYPE_CLASS = { '경매장': 't-auction', '삽니다': 't-buyorder' };
const KIND_CLASS = { card: 'k-card', equipment: 'k-equipment', item: 'k-item' };
const KIND_LABEL_FALLBACK = { card: '캐릭터 카드', equipment: '장비', item: '아이템' };
const CURRENCY_CLASS = { gold: 'cur-gold', garnet: 'cur-garnet' };
const CURRENCY_LABEL = { gold: '골드', garnet: '가넷' };

function formatTradeLogTime(ms) {
    if (!ms) return '-';
    const d = new Date(Number(ms) + 9 * 60 * 60 * 1000); // KST 환산
    const pad = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
        + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

function comma(n) { return Number(n || 0).toLocaleString('ko-KR'); }

function tradeLogItemMeta(log) {
    const parts = [];
    const p = log.payload || {};
    if (log.kind === 'card') {
        if (typeof p.star === 'number') parts.push((p.star + 1) + '성');
        if (p.type) parts.push(p.type);
        if (p.skin) parts.push('스킨: ' + p.skin);
    } else if (log.kind === 'equipment') {
        if (log.rarity) parts.push('<' + log.rarity + '>');
        if (typeof p.level === 'number' && p.level > 0) parts.push('+' + p.level);
    }
    if (log.fee && Number(log.fee) > 0) parts.push('수수료 ' + comma(log.fee));
    return parts.join(' · ');
}

function tradeLogRow(log) {
    const row = el('div', { class: 'log-row' });
    row.appendChild(el('div', { class: 'col-time', title: log.id }, formatTradeLogTime(log.time)));

    const tags = el('div', { class: 'col-tags' });
    tags.appendChild(el('span', { class: 'tag ' + (TRADE_TYPE_CLASS[log.tradeType] || '') }, log.tradeType || '?'));
    tags.appendChild(el('span', { class: 'tag ' + (KIND_CLASS[log.kind] || '') }, log.kindLabel || KIND_LABEL_FALLBACK[log.kind] || log.kind || '?'));
    row.appendChild(tags);

    const itemCell = el('div', { class: 'col-item' });
    itemCell.appendChild(el('div', { class: 'iname' }, log.itemName || '-'));
    const meta = tradeLogItemMeta(log);
    if (meta) itemCell.appendChild(el('div', { class: 'imeta' }, meta));
    row.appendChild(itemCell);

    row.appendChild(el('div', { class: 'col-count' }, 'x' + comma(log.count || 1)));

    const priceCell = el('div', { class: 'col-price' });
    const curClass = CURRENCY_CLASS[log.currency] || '';
    const curLabel = CURRENCY_LABEL[log.currency] || log.currency || '?';
    priceCell.appendChild(el('div', { class: 'total' }, comma(log.totalPrice || 0), ' ', el('span', { class: 'tag ' + curClass, style: { marginLeft: '4px' } }, curLabel)));
    if (Number(log.count || 1) > 1) priceCell.appendChild(el('span', { class: 'unit' }, '단가 ' + comma(log.unitPrice || 0)));
    row.appendChild(priceCell);

    const parties = el('div', { class: 'col-parties' });
    parties.appendChild(el('div', { class: 'party' },
        el('span', { class: 'role' }, '구매'),
        el('span', { class: 'name' }, log.buyer || '-')
    ));
    parties.appendChild(el('div', { class: 'party' },
        el('span', { class: 'role' }, '판매'),
        el('span', { class: 'name' }, log.seller || '-')
    ));
    row.appendChild(parties);

    return row;
}

function renderTradeLog() {
    const list = $('#tradeLogList'); list.innerHTML = '';
    const q = (tradeLogFilter.q || '').trim().toLowerCase();
    const tt = tradeLogFilter.tradeType;
    const kk = tradeLogFilter.kind;
    let shown = 0;
    tradeLogData.forEach(log => {
        if (tt && log.tradeType !== tt) return;
        if (kk && log.kind !== kk) return;
        if (q) {
            const hay = ((log.buyer || '') + ' ' + (log.seller || '') + ' ' + (log.itemName || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        list.appendChild(tradeLogRow(log));
        shown++;
    });
    if (shown === 0) list.appendChild(el('div', { class: 'empty' }, tradeLogData.length === 0 ? '아직 기록된 거래가 없습니다.' : '검색 결과가 없습니다.'));
}

async function loadTradeLog() {
    $('#tradeLogStatus').textContent = '불러오는 중...';
    try {
        const data = await api('/api/admin/tradelog?limit=2000');
        tradeLogData = data.items || [];
        $('#tradeLogStatus').textContent = '총 ' + tradeLogData.length + '건';
        renderTradeLog();
    } catch (e) {
        $('#tradeLogStatus').textContent = '';
        toast(e.message, false);
    }
}

if ($('#tradeLogReload')) $('#tradeLogReload').onclick = loadTradeLog;
if ($('#tradeLogClear')) $('#tradeLogClear').onclick = async () => {
    if (!confirm('거래 로그 전체를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    try { await api('/api/admin/tradelog', { method: 'DELETE' }); tradeLogData = []; renderTradeLog(); $('#tradeLogStatus').textContent = '삭제 완료'; toast('거래 로그를 삭제했습니다.'); }
    catch (e) { toast(e.message, false); }
};
if ($('#tradeLogFilter')) $('#tradeLogFilter').addEventListener('input', e => { tradeLogFilter.q = e.target.value; renderTradeLog(); });
if ($('#tradeLogType')) $('#tradeLogType').onchange = e => { tradeLogFilter.tradeType = e.target.value; renderTradeLog(); };
if ($('#tradeLogKind')) $('#tradeLogKind').onchange = e => { tradeLogFilter.kind = e.target.value; renderTradeLog(); };
TAB_LOADERS.tradelog = loadTradeLog;

// ============================================================================
// PITR 복원 / 마이그레이션
// ============================================================================
function pitrTable() {
    return $('#pitrTable').value;
}

function pitrPrint(data) {
    $('#pitrPreview').textContent = JSON.stringify(data, null, 2);
}

function pitrStatusBox(data) {
    const box = $('#pitrStatus');
    box.innerHTML = '';
    const pitr = data.pitr || {};
    const live = data.live || {};
    [
        ['테이블', data.table || '-'],
        ['PITR 상태', pitr.status || '-'],
        ['복원 가능 시작', pitr.earliest ? new Date(pitr.earliest).toLocaleString() : '-'],
        ['최신 복원 가능 시점', pitr.latest ? new Date(pitr.latest).toLocaleString() : '-'],
        ['운영 테이블 상태', live.status || '-'],
        ['운영 항목 수', comma(live.itemCount || 0)]
    ].forEach(([k, v]) => box.appendChild(el('div', null, el('b', null, k), String(v))));
}

async function loadPitrStatus() {
    try {
        const data = await api('/api/admin/pitr/status?table=' + encodeURIComponent(pitrTable()));
        pitrStatusBox(data);
        toast('PITR 상태를 불러왔습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

async function loadPitrLive() {
    try {
        const data = await api('/api/admin/pitr/live?table=' + encodeURIComponent(pitrTable()) + '&limit=10');
        pitrPrint(data);
        toast('운영 최신 데이터를 불러왔습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

async function createPitrRestore() {
    const restoreTime = $('#pitrTime').value;
    if (!restoreTime && !confirm('복원 시점이 비어있습니다. 최신 복원 가능 시점으로 복원 테이블을 만들까요?')) return;
    if (!confirm('PITR 복원 테이블을 새로 생성합니다. AWS 비용이 발생할 수 있습니다. 계속할까요?')) return;
    try {
        const data = await api('/api/admin/pitr/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table: pitrTable(), restoreTime, useLatest: !restoreTime })
        });
        $('#pitrJobId').value = data.job.id;
        pitrPrint(data);
        toast('복원 테이블 생성을 시작했습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

async function loadPitrJob() {
    const id = $('#pitrJobId').value.trim();
    if (!id) return toast('작업 ID를 입력하세요.', false);
    try {
        const data = await api('/api/admin/pitr/jobs/' + encodeURIComponent(id) + '?limit=10');
        pitrPrint(data);
        toast('복원 작업 상태를 불러왔습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

async function migratePitrJob() {
    const id = $('#pitrJobId').value.trim();
    if (!id) return toast('작업 ID를 입력하세요.', false);
    const confirmText = prompt('복원 테이블 데이터를 운영 테이블에 덮어씁니다.\n운영에만 있는 항목은 삭제하지 않습니다.\n진행하려면 "마이그레이션"을 입력하세요.');
    if (confirmText !== '마이그레이션') return;
    try {
        const data = await api('/api/admin/pitr/jobs/' + encodeURIComponent(id) + '/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: confirmText })
        });
        pitrPrint(data);
        toast('마이그레이션이 완료되었습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

async function deletePitrTable() {
    const id = $('#pitrJobId').value.trim();
    if (!id) return toast('작업 ID를 입력하세요.', false);
    if (!confirm('복원용 임시 테이블을 삭제합니다. 계속할까요?')) return;
    try {
        const data = await api('/api/admin/pitr/jobs/' + encodeURIComponent(id) + '/table', { method: 'DELETE' });
        pitrPrint(data);
        toast('복원 테이블 삭제를 요청했습니다.');
    } catch (e) {
        toast(e.message, false);
    }
}

if ($('#pitrStatusBtn')) $('#pitrStatusBtn').onclick = loadPitrStatus;
if ($('#pitrLiveBtn')) $('#pitrLiveBtn').onclick = loadPitrLive;
if ($('#pitrRestoreBtn')) $('#pitrRestoreBtn').onclick = createPitrRestore;
if ($('#pitrJobBtn')) $('#pitrJobBtn').onclick = loadPitrJob;
if ($('#pitrMigrateBtn')) $('#pitrMigrateBtn').onclick = migratePitrJob;
if ($('#pitrDeleteBtn')) $('#pitrDeleteBtn').onclick = deletePitrTable;
TAB_LOADERS.pitr = loadPitrStatus;

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