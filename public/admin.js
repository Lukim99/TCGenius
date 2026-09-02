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
const PAGE_SIZE = 30;
const PAGE_STATE = {};
function pagedAppend(list, key, rows, build, rerender) {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if ((PAGE_STATE[key] || 0) > pages - 1) PAGE_STATE[key] = pages - 1;
    const page = PAGE_STATE[key] || 0;
    rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach(r => list.appendChild(build(r)));
    if (pages <= 1) return;
    const pager = el('div', { class: 'pager' });
    const btn = (label, p, opts) => el('button', {
        class: 'pager-btn' + (opts && opts.on ? ' on' : ''),
        disabled: !!(opts && opts.dis),
        onclick: () => { PAGE_STATE[key] = p; rerender(); }
    }, label);
    pager.appendChild(btn('이전', page - 1, { dis: page === 0 }));
    let last = -1;
    [...new Set([0, pages - 1, page - 1, page, page + 1])].filter(p => p >= 0 && p < pages).sort((a, b) => a - b).forEach(p => {
        if (last >= 0 && p - last > 1) pager.appendChild(el('span', { class: 'pager-gap' }, '...'));
        pager.appendChild(btn(String(p + 1), p, { on: p === page }));
        last = p;
    });
    pager.appendChild(btn('다음', page + 1, { dis: page === pages - 1 }));
    pager.appendChild(el('span', { class: 'pager-info' }, '총 ' + rows.length + '건'));
    list.appendChild(pager);
}
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
function showLoading() { const o = $('#loadingOverlay'); if (o) o.classList.add('active'); }
function hideLoading() { const o = $('#loadingOverlay'); if (o) o.classList.remove('active'); }

// ---------- 공통 메시지 모달 (네이티브 alert/confirm/prompt 대체) ----------
function openMsgModal(message, opts) {
    return new Promise(resolve => {
        const mode = (opts && opts.mode) || 'alert';
        const bg = el('div', { class: 'msg-modal-bg' });
        let input = null;
        if (mode === 'prompt') input = el('input', { class: 'msg-modal-input', type: 'text', value: (opts && opts.value) || '' });
        const done = val => { bg.remove(); resolve(val); };
        const okValue = () => mode === 'prompt' ? input.value : true;
        const cancelValue = mode === 'prompt' ? null : false;
        const okBtn = el('button', { class: 'btn primary', type: 'button', onclick: () => done(okValue()) }, '확인');
        const actions = mode === 'alert'
            ? [okBtn]
            : [el('button', { class: 'btn', type: 'button', onclick: () => done(cancelValue) }, '취소'), okBtn];
        bg.appendChild(el('div', { class: 'msg-modal' },
            el('div', { class: 'msg-modal-text' }, String(message)),
            input,
            el('div', { class: 'msg-modal-actions' }, ...actions)));
        bg.addEventListener('click', e => { if (e.target === bg && mode === 'alert') done(true); });
        bg.addEventListener('keydown', e => {
            if (e.key === 'Escape') done(mode === 'alert' ? true : cancelValue);
            if (e.key === 'Enter' && mode === 'prompt') done(okValue());
        });
        document.body.appendChild(bg);
        setTimeout(() => (input || okBtn).focus(), 30);
    });
}
const showAlert = message => openMsgModal(message);
const showConfirm = message => openMsgModal(message, { mode: 'confirm' });
const showPrompt = (message, value) => openMsgModal(message, { mode: 'prompt', value });

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
const LOOKUP = { items: null, equipment: null, cards: null, fashion: null, pet: null, equipmentPassives: null };
const EQUIPMENT_SLOT_DEFS = [['weapon', '무기'], ['hat', '모자'], ['armor', '갑옷'], ['pants', '하의'], ['shoes', '신발'], ['accessory', '장신구'], ['support', '보조']];
const EQUIPMENT_SLOT_KEYS = EQUIPMENT_SLOT_DEFS.map(([key]) => key);
const EQUIPMENT_SLOT_LABELS = Object.fromEntries(EQUIPMENT_SLOT_DEFS);
async function getItems() { if (!LOOKUP.items) LOOKUP.items = await api('/api/lookup/items'); return LOOKUP.items; }
async function getEquipment() { if (!LOOKUP.equipment) LOOKUP.equipment = await api('/api/lookup/equipment'); return LOOKUP.equipment; }
async function fetchEquipmentPassives() { if (!LOOKUP.equipmentPassives) LOOKUP.equipmentPassives = await api('/api/lookup/equipment-passives'); return LOOKUP.equipmentPassives || []; }
async function getCards() { if (!LOOKUP.cards) LOOKUP.cards = await api('/api/lookup/cards'); return LOOKUP.cards; }
async function getFashion() { if (!LOOKUP.fashion) LOOKUP.fashion = await api('/api/lookup/fashion'); return LOOKUP.fashion; }
async function getPets() { if (!LOOKUP.pet) LOOKUP.pet = await api('/api/lookup/pet'); return LOOKUP.pet; }
async function getTitles() { if (!LOOKUP.titles) LOOKUP.titles = await api('/api/lookup/titles'); return LOOKUP.titles || []; }

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
    const rarityClass = r => ({ '일반': '', '고급': 'g', '희귀': 'b', '영웅': 'p', '전설': 'y', '초월': 'r', '신화': 'm' }[r] || '');
    openModal(EQUIPMENT_SLOT_LABELS[slot] + ' 선택', list, e => el('div', null,
        el('div', null, el('span', { class: 'tag ' + rarityClass(e.rarity) }, e.rarity), el('span', { class: 'tag' }, '#' + e.id), e.name),
    ), onPick);
}
// 픽커: 펫
async function pickPet(onPick) {
    const pets = await getPets();
    const list = pets.map(p => Object.assign({}, p, { _search: p.name + ' ' + p.rarity + ' ' + p.id }));
    const rarityClass = r => ({ '일반': '', '레어': 'b', '에픽': 'p', '유니크': 'y', '레전더리': 'y', '신화': 'r', '고유': 'g' }[r] || '');
    openModal('펫 선택', list, p => el('div', null,
        el('div', null, el('span', { class: 'tag ' + rarityClass(p.rarity) }, p.rarity), el('span', { class: 'tag' }, '#' + p.id), p.name)
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

// 픽커: 칭호
async function pickTitle(onPick) {
    const titles = await getTitles();
    const list = titles.map(t => Object.assign({}, t, { _search: t.name + ' ' + t.id }));
    openModal('칭호 선택', list, t => el('div', null,
        el('div', null, el('span', { class: 'tag y' }, '칭호'), t.name),
        el('div', { class: 'meta' }, t.id)
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
        ['character_card_id', 'id', 'item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'pet_id', 'title_id', 'fashion'].forEach(k => delete entry[k]);
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

const REWARD_TYPES = ['아이템', '캐릭터카드', '아바타', '무기', '갑옷', '장신구', '보조', '펫', '칭호', '골드', '가넷', '마일리지', '포인트', '경험치'];
const MATERIAL_TYPES = ['아이템', '무기', '갑옷', '장신구', '보조', '펫', '골드', '가넷', '마일리지'];
const CRAFTED_TYPES = ['아이템', '무기', '갑옷', '장신구', '보조', '펫'];

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
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; ['weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'title_id', 'fashion'].forEach(k => delete entry[k]); refresh(); onChange && onChange(); });
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
            btn.onclick = () => pickEquipment(slot, e => { entry[idKey] = e.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'title_id', 'fashion'].forEach(k => k !== idKey && delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else if (t === '펫') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                const pets = await getPets();
                const cur = pets.find(x => x.id === entry.pet_id);
                btn.innerHTML = '';
                if (cur) btn.appendChild(document.createTextNode('<' + cur.rarity + '> #' + cur.id + ' ' + cur.name));
                else btn.appendChild(el('span', { class: 'ph' }, '펫 선택...'));
            };
            btn.onclick = () => pickPet(p => { entry.pet_id = p.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'title_id', 'fashion'].forEach(k => delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else if (t === '아바타') {
            const avatarSel = el('select', { style: { flex: '1', minWidth: '150px' } });
            const refresh = async () => {
                const fashion = await getFashion();
                const seen = new Set();
                avatarSel.innerHTML = '';
                avatarSel.appendChild(el('option', { value: '' }, '아바타 선택...'));
                fashion.forEach(f => {
                    if (!f || !f.name || seen.has(f.name)) return;
                    seen.add(f.name);
                    avatarSel.appendChild(el('option', { value: f.name }, f.name));
                });
                avatarSel.value = entry.fashion || '';
            };
            avatarSel.onchange = () => {
                ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'title_id', 'fashion'].forEach(k => delete entry[k]);
                if (avatarSel.value) entry.fashion = avatarSel.value;
                else delete entry.fashion;
                onChange && onChange();
            };
            refresh();
            targetSlot.appendChild(avatarSel);
        } else if (t === '칭호') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                const titles = await getTitles();
                const cur = titles.find(x => x.id === entry.title_id);
                btn.innerHTML = '';
                if (cur) btn.appendChild(document.createTextNode('🏅 ' + cur.name));
                else btn.appendChild(el('span', { class: 'ph' }, '칭호 선택...'));
            };
            btn.onclick = () => pickTitle(tt => { entry.title_id = tt.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'fashion'].forEach(k => delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else {
            // 골드/가넷/마일리지/경험치 — target 없음
            ['item_id', 'weapon_id', 'armor_id', 'accessory_id', 'support_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'title_id', 'fashion'].forEach(k => delete entry[k]);
            targetSlot.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + t + ' 수량 지정)'));
        }
    }

    function paintCount() {
        countSlot.innerHTML = '';
        // 보상 장비는 보통 count=1 고정 (제작 재료 장비는 수량 입력 허용)
        if ((entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구' || entry.type === '보조' || entry.type === '펫' || entry.type === '칭호' || entry.type === '아바타') && opts.types !== CRAFTED_TYPES && opts.types !== MATERIAL_TYPES) {
            countSlot.appendChild(el('span', { class: 'lab' }, '×1'));
            if (opts.countAsObject) entry.count = { min: 1, max: 1 }; else entry.count = 1;
            return;
        }
        if ((entry.type === '무기' || entry.type === '갑옷' || entry.type === '장신구' || entry.type === '보조' || entry.type === '펫') && opts.types === CRAFTED_TYPES) {
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
let grantEquipId;
$('#grantKind').onchange = async () => {
    const kind = $('#grantKind').value;
    $('#itemNameWrap').style.display = kind === 'item' ? '' : 'none';
    ['#equipWrap', '#equipPickWrap', '#equipLevelWrap'].forEach(id => $(id).style.display = kind === 'equipment' ? '' : 'none');
    $('#avatarNameWrap').style.display = kind === 'avatar' ? '' : 'none';
    $('#amountWrap').style.display = (kind === 'equipment' || kind === 'avatar') ? 'none' : '';
    if (kind === 'avatar') {
        const sel = $('#grantAvatarName');
        if (sel.options.length <= 1) {
            const fashion = await getFashion();
            const seen = new Set();
            fashion.forEach(f => {
                if (!f || !f.name || seen.has(f.name)) return;
                seen.add(f.name);
                sel.appendChild(el('option', { value: f.name }, f.name));
            });
        }
    }
};
$('#grantItemPick').onclick = () => pickItem(it => {
    $('#grantItemName').value = it.name;
    $('#grantItemPick').innerHTML = '';
    $('#grantItemPick').appendChild(document.createTextNode('#' + it.id + ' ' + it.name));
});
$('#grantEquipType').onchange = () => {
    grantEquipId = undefined;
    $('#grantEquipPick').innerHTML = '<span class="ph">장비 선택</span>';
};
$('#grantEquipPick').onclick = () => pickEquipment($('#grantEquipType').value, eq => {
    grantEquipId = eq.id;
    $('#grantEquipPick').innerHTML = '';
    $('#grantEquipPick').appendChild(document.createTextNode('#' + eq.id + ' ' + eq.name));
});
$('#grantBtn').onclick = async () => {
    const body = { name: $('#grantName').value.trim(), kind: $('#grantKind').value, amount: Number($('#grantAmount').value), itemName: $('#grantItemName').value.trim() };
    if (body.kind === 'avatar') {
        body.avatarName = $('#grantAvatarName').value;
        if (!body.avatarName) return toast('아바타를 선택하세요.', false);
    }
    if (body.kind === 'equipment') {
        if (typeof grantEquipId === 'undefined') return toast('장비를 선택하세요.', false);
        body.equipType = $('#grantEquipType').value;
        body.equipId = grantEquipId;
        body.level = Number($('#grantEquipLevel').value || 0);
    }
    try {
        const r = await api('/api/users/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.kind === 'item') toast('✅ ' + r.name + ' ' + r.itemName + ' ' + (r.delta > 0 ? '+' : '') + r.delta);
        else if (r.kind === 'equipment') toast('✅ ' + r.name + ' ' + r.equipName + ' +' + r.level + ' 지급');
        else if (r.kind === 'avatar') toast('✅ ' + r.name + ' [' + r.grade + '] ' + r.avatarName + ' 아바타 해금');
        else toast('✅ ' + r.name + ' ' + r.kind + ': ' + r.before + ' → ' + r.after);
    } catch (e) { toast(e.message, false); }
};

// ============================================================================
// 공통 데이터 탭 헬퍼
// ============================================================================
async function loadKey(key) { const r = await api('/api/data/' + encodeURIComponent(key)); return r.data; }
async function saveKey(key, data) { await api('/api/data/' + encodeURIComponent(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }); }

// ============================================================================
// 메인 배너
// ============================================================================
let bannerData = [];
let bannerTargetTabs = [];
let bannerDirty = false;
let bannerSaving = false;

function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function isValidBannerTargetUrl(value) {
    const url = String(value || '').trim();
    if (!url || url.length > 1000 || /[\x00-\x1f\x7f]/.test(url)) return false;
    if (/^\/(?![\\/])/.test(url)) return true;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
    } catch (_) {
        return false;
    }
}

function updateBannerStatus(message) {
    $('#bannerStatus').textContent = message || (bannerData.length + '개' + (bannerDirty ? ' · 저장 필요' : ''));
    $('#bannerSave').disabled = !bannerDirty || bannerSaving;
}

function markBannerDirty() {
    bannerDirty = true;
    updateBannerStatus();
}

function moveBanner(index, offset) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= bannerData.length) return;
    const moved = bannerData.splice(index, 1)[0];
    bannerData.splice(nextIndex, 0, moved);
    markBannerDirty();
    renderBanners();
}

function renderBanners() {
    const list = $('#bannerList');
    list.replaceChildren();
    if (!bannerData.length) {
        list.appendChild(el('div', { class: 'empty' }, '등록된 배너가 없습니다.'));
        updateBannerStatus();
        return;
    }
    bannerData.forEach((item, index) => {
        const up = el('button', { class: 'btn sm', type: 'button', disabled: index === 0, 'aria-label': '위로 이동' }, '↑ 위로');
        const down = el('button', { class: 'btn sm', type: 'button', disabled: index === bannerData.length - 1, 'aria-label': '아래로 이동' }, '↓ 아래로');
        up.onclick = () => moveBanner(index, -1);
        down.onclick = () => moveBanner(index, 1);

        const targetSelect = el('select', { 'aria-label': (item.originalName || '배너') + ' 클릭 시 이동할 탭' },
            ...bannerTargetTabs.map(target => el('option', { value: target.value }, target.label))
        );
        const targetUrlInput = el('input', {
            class: 'banner-admin-url',
            type: 'text',
            inputMode: 'url',
            placeholder: 'https://example.com 또는 /내부경로',
            value: item.targetUrl || '',
            hidden: item.targetTab !== 'custom-url',
            'aria-label': (item.originalName || '배너') + ' 커스텀 URL'
        });
        targetSelect.value = item.targetTab || '';
        targetSelect.onchange = () => {
            item.targetTab = targetSelect.value;
            targetUrlInput.hidden = item.targetTab !== 'custom-url';
            if (!targetUrlInput.hidden) setTimeout(() => targetUrlInput.focus(), 0);
            markBannerDirty();
        };
        targetUrlInput.oninput = () => {
            item.targetUrl = targetUrlInput.value;
            markBannerDirty();
        };

        const remove = el('button', { class: 'btn sm danger', type: 'button' }, '삭제');
        remove.onclick = async () => {
            if (!(await showConfirm("'" + (item.originalName || '배너') + "'을(를) 삭제할까요?"))) return;
            remove.disabled = true;
            try {
                await api('/api/admin/banners/' + encodeURIComponent(item.id), { method: 'DELETE' });
                bannerData = bannerData.filter(entry => entry.id !== item.id);
                if (!bannerData.length) bannerDirty = false;
                renderBanners();
                toast('✅ 배너를 삭제했습니다.');
            } catch (e) {
                remove.disabled = false;
                toast(e.message, false);
            }
        };
        const created = item.createdAt ? new Date(item.createdAt).toLocaleString('ko-KR') : '';
        list.appendChild(el('div', { class: 'banner-admin-card' },
            el('div', { class: 'banner-admin-order' },
                el('span', { class: 'banner-admin-number' }, '#' + (index + 1)),
                el('div', { class: 'banner-admin-move' }, up, down)
            ),
            el('img', { src: item.imageUrl, alt: item.originalName || '배너' }),
            el('div', { class: 'banner-admin-meta' },
                el('div', { style: { minWidth: '0', flex: '1' } },
                    el('div', { class: 'banner-admin-name' }, item.originalName || '배너'),
                    el('div', { class: 'banner-admin-sub' }, [formatFileSize(item.size), created].filter(Boolean).join(' · '))
                ),
                remove
            ),
            el('div', { class: 'banner-admin-settings' },
                el('label', null, '클릭 시 이동'),
                targetSelect,
                targetUrlInput
            )
        ));
    });
    updateBannerStatus();
}

async function loadBanners() {
    updateBannerStatus('불러오는 중...');
    try {
        const data = await api('/api/admin/banners');
        bannerData = Array.isArray(data.items) ? data.items : [];
        bannerTargetTabs = Array.isArray(data.targetTabs) ? data.targetTabs : [];
        bannerDirty = false;
        renderBanners();
    } catch (e) {
        $('#bannerStatus').textContent = '';
        toast(e.message, false);
    }
}

async function saveBannerSettings(showSuccess = true) {
    if (!bannerDirty) return true;
    const invalidUrlItem = bannerData.find(item => item.targetTab === 'custom-url' && !isValidBannerTargetUrl(item.targetUrl));
    if (invalidUrlItem) {
        toast('커스텀 URL은 http://, https:// 또는 /로 시작하는 내부 경로를 입력해 주세요.', false);
        return false;
    }
    bannerSaving = true;
    updateBannerStatus('저장 중...');
    try {
        const data = await api('/api/admin/banners', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: bannerData.map(item => ({
                id: item.id,
                targetTab: item.targetTab || '',
                targetUrl: item.targetTab === 'custom-url' ? String(item.targetUrl || '').trim() : ''
            })) })
        });
        bannerData = Array.isArray(data.items) ? data.items : bannerData;
        bannerDirty = false;
        if (showSuccess) toast('✅ 배너 순서와 이동 탭을 저장했습니다.');
        return true;
    } catch (e) {
        toast(e.message, false);
        return false;
    } finally {
        bannerSaving = false;
        renderBanners();
    }
}

$('#bannerUpload').onclick = async () => {
    const input = $('#bannerFile');
    const file = input.files && input.files[0];
    if (!file) return toast('업로드할 이미지를 선택하세요.', false);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return toast('JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.', false);
    if (file.size > 10 * 1024 * 1024) return toast('배너 이미지는 10MB 이하여야 합니다.', false);
    const button = $('#bannerUpload');
    button.disabled = true;
    $('#bannerStatus').textContent = '업로드 중...';
    try {
        if (bannerDirty && !(await saveBannerSettings(false))) return;
        const response = await fetch('/api/admin/banners', {
            method: 'POST',
            headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
            body: file
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        input.value = '';
        await loadBanners();
        toast('✅ 배너를 추가했습니다.');
    } catch (e) {
        $('#bannerStatus').textContent = '';
        toast(e.message, false);
    } finally {
        button.disabled = false;
    }
};
$('#bannerSave').onclick = () => saveBannerSettings();
$('#bannerReload').onclick = async () => {
    if (bannerDirty && !(await showConfirm('저장하지 않은 변경사항을 버리고 다시 불러올까요?'))) return;
    loadBanners();
};
TAB_LOADERS.banner = loadBanners;

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
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('Pack #' + packIdx + ' 삭제?'))) { packData.splice(packIdx, 1); renderPack(); } } }, '삭제')
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
$('#packSave').onclick = async () => { if (!(await showConfirm('Pack 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Pack', packData); PACK_REF_CACHE.Pack = null; toast('✅ Pack 저장 완료'); } catch (e) { toast(e.message, false); } };
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
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('Bundle #' + idx + ' 삭제?'))) { bundleData.splice(idx, 1); renderBundle(); } } }, '삭제')
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
$('#bundleSave').onclick = async () => { if (!(await showConfirm('Bundle 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Bundle', bundleData); PACK_REF_CACHE.Bundle = null; toast('✅ Bundle 저장 완료'); } catch (e) { toast(e.message, false); } };
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
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('이 쿠폰을 삭제합니까?'))) { couponData.splice(idx, 1); renderCoupon(); } } }, '삭제')
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
$('#couponSave').onclick = async () => { if (!(await showConfirm('Coupon 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Coupon', couponData); toast('✅ Coupon 저장 완료'); } catch (e) { toast(e.message, false); } };
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
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; ['card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'fashion'].forEach(k => delete entry[k]); refresh(); });
            refresh(); target.appendChild(btn);
        } else if (entry.type === '캐릭터카드') {
            delete entry.item_id;
            target.appendChild(cardTargetControls(entry));
        } else {
            ['item_id', 'card_id', 'character_card_id', 'id', 'display_star', 'star_display', 'star', 'range', 'card_type', 'cardType', 'skin', 'pet_id', 'fashion'].forEach(k => delete entry[k]);
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
$('#shopAddType').onclick = async () => {
    const name = (await showPrompt('새 상점 종류 이름?'));
    if (!name) return;
    if (shopData[name]) return toast('이미 존재합니다', false);
    shopData[name] = []; shopCurrentType = name; renderShopTypes(); renderShop();
};
$('#shopDelType').onclick = async () => {
    if (!shopCurrentType) return;
    if (!(await showConfirm("'" + shopCurrentType + "' 상점을 삭제합니까? (포함된 모든 상품이 삭제됩니다)"))) return;
    delete shopData[shopCurrentType]; shopCurrentType = null; renderShopTypes(); renderShop();
};
$('#shopReload').onclick = async () => { try { shopData = (await loadKey('Shop')) || {}; shopCurrentType = null; renderShopTypes(); renderShop(); $('#shopStatus').textContent = '로드 완료'; } catch (e) { toast(e.message, false); } };
$('#shopSave').onclick = async () => { if (!(await showConfirm('Shop 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Shop', shopData); toast('✅ Shop 저장 완료'); } catch (e) { toast(e.message, false); } };
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
    if (!(await showConfirm(targetText + '의 구매 제한 기록을 초기화합니다.\n유저별 기록과 전체 제한 기록이 함께 삭제됩니다. 계속?'))) return;
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
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('레시피 삭제?'))) { recipeData.splice(idx, 1); renderRecipe(); } } }, '삭제')
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
$('#recipeSave').onclick = async () => { if (!(await showConfirm('Recipe 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Recipe', recipeData); toast('✅ Recipe 저장 완료'); } catch (e) { toast(e.message, false); } };
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
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('미끼 삭제?'))) { baitData.splice(idx, 1); renderBait(); } } }, '삭제')
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
$('#baitSave').onclick = async () => { if (!(await showConfirm('Bait 데이터를 저장합니다. 계속?'))) return; try { await saveKey('Bait', baitData); toast('✅ Bait 저장 완료'); } catch (e) { toast(e.message, false); } };
TAB_LOADERS.bait = () => $('#baitReload').click();

// ============================================================================
// QUEST 에디터  ( data: Array<{id,name,desc,categories,minLevel,maxLevel,skippable,epicOrder,objectives,rewards,unlock,enabled}> )
// ============================================================================
const QUEST_CATEGORIES = ['에픽', '주간', '일일', '일반', '이벤트'];
const QUEST_CATEGORY_CLASS = { '에픽': 'epic', '주간': 'weekly', '일일': 'daily', '일반': 'normal', '이벤트': 'event' };
const QUEST_OBJECTIVE_TYPES = [
    ['kill', '몬스터 처치'],
    ['eliteKill', '엘리트 처치'],
    ['worldboss', '월드보스 공격'],
    ['pvp', 'PVP 전투'],
    ['craft', '아이템 제작'],
    ['enhance', '강화 성공'],
    ['deliver', '아이템 납품'],
    ['partyJoin', '파티 퀘스트 참여'],
    ['partyClear', '파티 퀘스트 클리어'],
    ['partyClearMin', '파티 퀘스트 N인 이상 클리어'],
    ['partyClearMax', '파티 퀘스트 N인 이하 클리어']
];
const QUEST_UNLOCK_TYPES = [['always', '즉시'], ['quest', '퀘스트 클리어 시'], ['item', '아이템 획득 시']];
let questData = [];
const questOpenIds = new Set();

async function getQuestTargets() { if (!LOOKUP.questTargets) LOOKUP.questTargets = await api('/api/lookup/quest-targets'); return LOOKUP.questTargets; }
function questTargetsSync() { return LOOKUP.questTargets || { fields: [], bosses: [], partyQuests: [], recipes: [] }; }

function questItemPickButton(target, key, onPicked) {
    const btn = el('button', { class: 'pickbtn', type: 'button' });
    const refresh = async () => {
        btn.innerHTML = '';
        if (typeof target[key] === 'number') {
            const items = await getItems();
            const it = items.find(x => x.id === target[key]);
            btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + target[key]));
        } else btn.innerHTML = '<span class="ph">아이템 선택...</span>';
    };
    btn.onclick = () => pickItem(it => { target[key] = it.id; refresh(); onPicked && onPicked(); });
    refresh();
    return btn;
}

// 이름 목록 select (빈값 = 전체). 목록이 비어 있으면 직접 입력으로 폴백.
function questNameSelect(target, key, options, allLabel) {
    const list = (options || []).slice();
    if (target[key] && !list.includes(target[key])) list.push(target[key]);
    if (!list.length) {
        const input = el('input', { value: target[key] || '', placeholder: (allLabel || '전체') + ' (직접 입력)', oninput: () => {
            const v = input.value.trim();
            if (v) target[key] = v; else delete target[key];
        } });
        return input;
    }
    const sel = el('select');
    sel.appendChild(el('option', { value: '' }, allLabel || '전체'));
    list.forEach(name => sel.appendChild(el('option', { value: name }, name)));
    sel.value = target[key] || '';
    sel.onchange = () => { if (sel.value === '') delete target[key]; else target[key] = sel.value; };
    return sel;
}

function questObjectiveRow(objective, onDelete) {
    const wrap = el('div', { class: 'entry' });
    const sel = el('select');
    QUEST_OBJECTIVE_TYPES.forEach(([value, label]) => sel.appendChild(el('option', { value }, label)));
    if (!QUEST_OBJECTIVE_TYPES.some(([value]) => value === objective.type)) objective.type = 'kill';
    sel.value = objective.type;
    const targetSlot = el('span', { class: 'qe-target' });
    function paintTarget() {
        targetSlot.innerHTML = '';
        const t = objective.type;
        const targets = questTargetsSync();
        if (t === 'kill' || t === 'eliteKill') {
            targetSlot.appendChild(questNameSelect(objective, 'field', targets.fields, '모든 필드'));
        } else if (t === 'worldboss') {
            targetSlot.appendChild(questNameSelect(objective, 'boss', targets.bosses, '모든 보스'));
        } else if (t === 'pvp') {
            const winChk = el('input', { type: 'checkbox', checked: objective.winOnly === true, onchange: () => objective.winOnly = winChk.checked });
            targetSlot.appendChild(el('label', { class: 'qe-inline', style: { margin: 0 } }, winChk, '승리만 인정'));
        } else if (t === 'craft') {
            targetSlot.appendChild(questNameSelect(objective, 'recipe', targets.recipes, '모든 레시피'));
        } else if (t === 'deliver') {
            targetSlot.appendChild(questItemPickButton(objective, 'item_id'));
        } else if (t === 'partyJoin' || t === 'partyClear' || t === 'partyClearMin' || t === 'partyClearMax') {
            targetSlot.appendChild(questNameSelect(objective, 'quest', targets.partyQuests, '모든 파티 퀘스트'));
            if (t === 'partyClearMin' || t === 'partyClearMax') {
                const membersIn = el('input', { class: 'qe-num', type: 'number', min: 1, max: 10, value: Number(objective.members || 2), oninput: () => objective.members = Math.max(1, Number(membersIn.value) || 1) });
                targetSlot.appendChild(el('span', { class: 'lab' }, '인원'));
                targetSlot.appendChild(membersIn);
                targetSlot.appendChild(el('span', { class: 'lab' }, t === 'partyClearMin' ? '명 이상' : '명 이하'));
            }
        }
    }
    sel.onchange = () => {
        ['field', 'boss', 'winOnly', 'recipe', 'item_id', 'quest', 'members'].forEach(k => delete objective[k]);
        objective.type = sel.value;
        if (objective.type === 'partyClearMin' || objective.type === 'partyClearMax') objective.members = 2;
        paintTarget();
    };
    paintTarget();
    const countIn = el('input', { class: 'qe-num', type: 'number', min: 1, value: Number(objective.count || 1), oninput: () => objective.count = Math.max(1, Number(countIn.value) || 1) });
    wrap.appendChild(sel);
    wrap.appendChild(targetSlot);
    wrap.appendChild(el('span', { class: 'nf qe-inline' }, el('span', { class: 'lab' }, '횟수/개수'), countIn));
    wrap.appendChild(el('button', { class: 'btn icon danger', type: 'button', title: '삭제', onclick: () => onDelete() }, '✕'));
    return wrap;
}

function questUnlockControls(q) {
    if (!q.unlock || typeof q.unlock !== 'object') q.unlock = { type: 'always' };
    const wrap = el('div', { class: 'qe-inline', style: { width: '100%' } });
    const sel = el('select', { style: { width: 'auto' } });
    QUEST_UNLOCK_TYPES.forEach(([value, label]) => sel.appendChild(el('option', { value }, label)));
    if (!QUEST_UNLOCK_TYPES.some(([value]) => value === q.unlock.type)) q.unlock.type = 'always';
    sel.value = q.unlock.type;
    const targetSlot = el('span', { class: 'qe-target' });
    function paintTarget() {
        targetSlot.innerHTML = '';
        if (q.unlock.type === 'quest') {
            const questSel = el('select');
            questSel.appendChild(el('option', { value: '' }, '선행 퀘스트 선택...'));
            questData.filter(other => other !== q).forEach(other => {
                questSel.appendChild(el('option', { value: String(other.id) }, '#' + other.id + ' ' + (other.name || '(이름 없음)')));
            });
            questSel.value = typeof q.unlock.quest_id === 'number' ? String(q.unlock.quest_id) : '';
            questSel.onchange = () => { q.unlock.quest_id = questSel.value === '' ? undefined : Number(questSel.value); };
            targetSlot.appendChild(questSel);
        } else if (q.unlock.type === 'item') {
            targetSlot.appendChild(questItemPickButton(q.unlock, 'item_id'));
            const countIn = el('input', { class: 'qe-num', type: 'number', min: 1, value: Number(q.unlock.count || 1), oninput: () => q.unlock.count = Math.max(1, Number(countIn.value) || 1) });
            targetSlot.appendChild(el('span', { class: 'lab' }, '개수'));
            targetSlot.appendChild(countIn);
        }
    }
    sel.onchange = () => { q.unlock = { type: sel.value }; paintTarget(); };
    paintTarget();
    wrap.appendChild(sel);
    wrap.appendChild(targetSlot);
    return wrap;
}

function questCategoryToggle(q, category) {
    const on = q.categories.includes(category);
    return el('button', {
        type: 'button',
        class: 'qe-cat' + (on ? ' on ' + (QUEST_CATEGORY_CLASS[category] || 'normal') : ''),
        onclick: () => {
            if (on) q.categories = q.categories.filter(c => c !== category);
            else q.categories.push(category);
            renderQuest();
        }
    }, category);
}

function questFormNode(q) {
    const body = el('div', { class: 'qe-body' });
    const nameIn = el('input', { value: q.name || '', placeholder: '퀘스트 이름', oninput: () => q.name = nameIn.value });
    const minIn = el('input', { class: 'qe-num', type: 'number', min: 1, value: Number(q.minLevel || 1), oninput: () => q.minLevel = Math.max(1, Number(minIn.value) || 1) });
    const maxIn = el('input', { class: 'qe-num', type: 'number', min: 1, max: 300, value: Number(q.maxLevel || 1), oninput: () => q.maxLevel = Math.min(300, Math.max(1, Number(maxIn.value) || 1)) });
    const descIn = el('textarea', { value: q.desc || '', placeholder: '설명', rows: 2, oninput: () => q.desc = descIn.value });
    body.appendChild(el('div', { class: 'qe-grid' },
        el('div', null, el('label', null, '이름'), nameIn),
        el('div', null, el('label', null, '수행가능레벨 (최소 ~ 최대)'), el('div', { class: 'qe-inline' }, minIn, el('span', null, '~'), maxIn))));
    body.appendChild(el('div', null, el('label', null, '설명'), descIn));
    const catsWrap = el('div', { class: 'qe-cats' }, ...QUEST_CATEGORIES.map(category => questCategoryToggle(q, category)));
    if (q.categories.includes('에픽')) {
        const orderIn = el('input', { class: 'qe-num', type: 'number', min: 1, value: Number(q.epicOrder || 1), oninput: () => q.epicOrder = Math.max(1, Number(orderIn.value) || 1) });
        catsWrap.appendChild(el('span', { class: 'qe-inline' }, el('span', { class: 'lab' }, '에픽 번호'), orderIn));
    }
    const skipChk = el('input', { type: 'checkbox', checked: q.skippable === true, onchange: () => { q.skippable = skipChk.checked; renderQuest(); } });
    const enabledChk = el('input', { type: 'checkbox', checked: q.enabled !== false, onchange: () => { q.enabled = enabledChk.checked; renderQuest(); } });
    body.appendChild(el('div', { class: 'qe-grid' },
        el('div', null, el('label', null, '퀘스트 범주'), catsWrap),
        el('div', null, el('label', null, '옵션'), el('div', { class: 'qe-inline', style: { gap: '14px' } },
            el('label', { class: 'qe-inline', style: { margin: 0 } }, skipChk, '스킵 허용'),
            el('label', { class: 'qe-inline', style: { margin: 0 } }, enabledChk, '활성')))));
    body.appendChild(el('div', { class: 'qe-sec' }, el('h3', null, '게시판 노출 조건'), questUnlockControls(q)));
    const objectiveList = el('div', { class: 'entry-list' });
    q.objectives.forEach((objective, i) => objectiveList.appendChild(questObjectiveRow(objective, () => { q.objectives.splice(i, 1); renderQuest(); })));
    body.appendChild(el('div', { class: 'qe-sec' }, el('h3', null, '목표'), objectiveList,
        el('button', { class: 'add-btn', type: 'button', onclick: () => { q.objectives.push({ type: 'kill', count: 1 }); renderQuest(); } }, '+ 목표 추가')));
    const rewardList = el('div', { class: 'entry-list' });
    q.rewards.forEach((reward, i) => {
        rewardList.appendChild(entryRow(reward,
            { types: REWARD_TYPES, withRoll: false, countAsObject: true },
            null,
            () => { q.rewards.splice(i, 1); renderQuest(); }
        ));
    });
    body.appendChild(el('div', { class: 'qe-sec' }, el('h3', null, '보상'), rewardList,
        el('button', { class: 'add-btn', type: 'button', onclick: () => { q.rewards.push({ type: '아이템', count: { min: 1, max: 1 } }); renderQuest(); } }, '+ 보상 추가')));
    return body;
}

function renderQuest() {
    const list = $('#questList'); list.innerHTML = '';
    if (!Array.isArray(questData)) questData = [];
    questData.forEach((q, idx) => {
        if (!Array.isArray(q.objectives)) q.objectives = [];
        if (!Array.isArray(q.rewards)) q.rewards = [];
        if (!Array.isArray(q.categories)) q.categories = [];
        const open = questOpenIds.has(q.id);
        const card = el('div', { class: 'card qe-card' + (q.enabled === false ? ' qe-disabled' : '') });
        const head = el('div', {
            class: 'qe-head',
            onclick: e => {
                if (e.target.closest('button,input,select,label,textarea')) return;
                if (questOpenIds.has(q.id)) questOpenIds.delete(q.id); else questOpenIds.add(q.id);
                renderQuest();
            }
        },
            el('span', { class: 'qe-caret' + (open ? ' open' : '') }, '▸'),
            el('span', { class: 'qe-id' }, '#' + q.id),
            el('span', { class: 'qe-name' }, q.name || '(이름 없음)'),
            el('span', { class: 'qe-chips' },
                ...q.categories.map(category => el('span', { class: 'qe-chip ' + (QUEST_CATEGORY_CLASS[category] || 'normal') },
                    category + (category === '에픽' && q.epicOrder ? ' ' + q.epicOrder : ''))),
                q.skippable === true ? el('span', { class: 'qe-chip skip' }, '스킵') : null,
                q.enabled === false ? el('span', { class: 'qe-chip off' }, '비활성') : null),
            el('span', { class: 'qe-meta' }, 'Lv.' + Number(q.minLevel || 1) + '~' + Number(q.maxLevel || 1) + ' · 목표 ' + q.objectives.length + ' · 보상 ' + q.rewards.length),
            el('span', { class: 'qe-head-actions' },
                el('button', { class: 'btn sm', type: 'button', onclick: () => {
                    const copy = clone(q);
                    copy.id = questData.reduce((max, other) => Math.max(max, Number(other.id || 0)), 0) + 1;
                    copy.name = (copy.name || '') + ' (복사)';
                    questData.splice(idx + 1, 0, copy);
                    questOpenIds.add(copy.id);
                    renderQuest();
                } }, '복제'),
                el('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if ((await showConfirm('퀘스트 #' + q.id + ' 삭제?'))) { questData.splice(idx, 1); renderQuest(); } } }, '삭제'))
        );
        card.appendChild(head);
        if (open) card.appendChild(questFormNode(q));
        list.appendChild(card);
    });
    if (!questData.length) list.appendChild(el('div', { class: 'muted', style: { padding: '8px 2px' } }, '등록된 퀘스트가 없습니다.'));
}
$('#questAdd').onclick = () => {
    const nextId = questData.reduce((max, q) => Math.max(max, Number(q.id || 0)), 0) + 1;
    questData.push({ id: nextId, name: '', desc: '', categories: ['일반'], minLevel: 1, maxLevel: 300, skippable: false, objectives: [], rewards: [], unlock: { type: 'always' }, enabled: true });
    questOpenIds.add(nextId);
    renderQuest();
};
$('#questReload').onclick = async () => {
    try {
        await getQuestTargets().catch(() => {});
        questData = (await loadKey('Quest')) || [];
        renderQuest();
        $('#questStatus').textContent = '로드 완료';
    } catch (e) { toast(e.message, false); }
};
$('#questSave').onclick = async () => {
    if (questData.some(q => !String(q.name || '').trim())) return toast('이름이 비어있는 퀘스트가 있습니다.', false);
    questData.forEach(q => { q.maxLevel = Math.min(300, Math.max(1, Number(q.maxLevel) || 1)); });
    if (!(await showConfirm('Quest 데이터를 저장합니다. 계속?'))) return;
    try { await saveKey('Quest', questData); toast('✅ Quest 저장 완료'); } catch (e) { toast(e.message, false); }
};
TAB_LOADERS.quest = () => $('#questReload').click();

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
            status.style.color = 'var(--ok)';
            ta.value = JSON.stringify(parsed, null, 2);
        } catch (e) {
            status.textContent = '⚠ JSON 파싱 실패: ' + e.message;
            status.style.color = 'var(--err-soft)';
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
const ITEM_KNOWN_FIELDS = new Set(['name', 'desc', 'type', 'no_trade', 'pack', 'num', 'use', 'use_func', 'require', 'protect', 'charId', 'rarity', 'ug', 'soul']);

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
        el('div', { class: 'actions', style: { gap: '4px' } },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
                itemData.push(JSON.parse(JSON.stringify(item)));
                itemFilterText = ''; if ($('#itemFilter')) $('#itemFilter').value = '';
                PAGE_STATE.item = 1e9; renderItem();
                toast('#' + (itemData.length - 1) + '번으로 복제했습니다.');
            } }, '복제'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                const refs = await scanRefs('item_id', index);
                if (!(await showConfirm('아이템 #' + index + ' (' + (item.name || '') + ')을(를) 삭제합니까?\n* 후속 인덱스가 모두 -1씩 당겨집니다.' + refWarnText(refs)))) return;
                itemData.splice(index, 1);
                renderItem();
            } }, '삭제')
        )
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
    typeSel.onchange = () => { item.type = typeSel.value; renderItem(); };
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

    // 가챠 / 번들 설정 (해당 타입이거나 기존 값이 있을 때만)
    const itemType = item.type || '재료';
    if (itemType === '가챠' || itemType === '번들' || typeof item.pack !== 'undefined' || typeof item.num !== 'undefined') {
        card.appendChild(sectionTitle(itemType === '번들' ? '번들 설정' : '가챠 설정'));
        card.appendChild(itemPackEditor(item, itemType));
    }

    // 사용 효과 / 조건 (해당 타입이거나 기존 값이 있는 필드만)
    const showUse = itemType === '사용' || itemType === '티켓' || itemType === '가챠' || typeof item.use !== 'undefined';
    const showUseFunc = itemType === '소모품' || typeof item.use_func !== 'undefined';
    const showRequire = itemType === '사용' || itemType === '소모품' || itemType === '티켓' || typeof item.require !== 'undefined';
    const showProtect = itemType === '사용' || typeof item.protect !== 'undefined';
    if (showUse || showUseFunc || showRequire || showProtect) {
        card.appendChild(sectionTitle('사용 효과 / 조건', '✨'));
        if (showUse) card.appendChild(itemUseEditor(item));
        if (showUseFunc) card.appendChild(useFuncEditor(item));
        if (showRequire) card.appendChild(requireEditor(item));
        if (showProtect) card.appendChild(protectEditor(item));
    }

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
    const rows = [];
    itemData.forEach((item, idx) => {
        if (!item) return;
        if (q) {
            const hay = (idx + ' ' + (item.name || '') + ' ' + (item.type || '') + ' ' + (item.desc || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        rows.push(idx);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '아이템이 없습니다.')); return; }
    pagedAppend(list, 'item', rows, idx => itemCard(itemData[idx], idx), renderItem);
}
$('#itemAdd').onclick = () => { itemData.push({ name: '', type: '재료', desc: '' }); itemFilterText = ''; if ($('#itemFilter')) $('#itemFilter').value = ''; PAGE_STATE.item = 1e9; renderItem(); };
$('#itemReload').onclick = async () => {
    try { itemData = (await loadKey('Item')) || []; renderItem(); $('#itemStatus').textContent = '로드 완료 (' + itemData.length + '개)'; invalidateLookupCache(['items']); }
    catch (e) { toast(e.message, false); }
};
$('#itemSave').onclick = async () => {
    if (!(await showConfirm('Item 데이터를 저장합니다. 인덱스 변경이 있다면 다른 데이터(Pack/Shop 등)와의 호환성을 다시 확인하세요. 계속할까요?'))) return;
    try { await saveKey('Item', itemData); invalidateLookupCache(['items']); toast('✅ Item 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#itemFilter')) $('#itemFilter').addEventListener('input', e => { itemFilterText = e.target.value; PAGE_STATE.item = 0; renderItem(); });
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
    { key: 'skillTrueDmg', label: '스킬 사용 시 추가 고정 피해', kind: 'int' },
    { key: 'atkPerMillionGold', label: '보유 골드 100만 당 공격력', kind: 'int' },
    { key: 'fireAtk', label: '[화]속성 강화', kind: 'int' },
    { key: 'waterAtk', label: '[수]속성 강화', kind: 'int' },
    { key: 'lightAtk', label: '[명]속성 강화', kind: 'int' },
    { key: 'darkAtk', label: '[암]속성 강화', kind: 'int' },
    { key: 'fireRes', label: '[화]속성 저항', kind: 'int' },
    { key: 'waterRes', label: '[수]속성 저항', kind: 'int' },
    { key: 'lightRes', label: '[명]속성 저항', kind: 'int' },
    { key: 'darkRes', label: '[암]속성 저항', kind: 'int' },
    { key: 'allElementAtk', label: '모든 속성 강화', kind: 'int' },
    { key: 'allElementRes', label: '모든 속성 저항', kind: 'int' },
    { key: 'atkDefReduce', label: '공격 시 5초간 방어력 감소', kind: 'int' }
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
    { key: 'finalDamage', label: '최종 피해', kind: 'percent' },
    { key: 'extraDamage', label: '추가 피해', kind: 'percent' },
    { key: 'nonElementDamage', label: '[무]속성 공격 피해', kind: 'percent' },
    { key: 'bossDmg', label: '보스 몬스터에게 주는 피해 증가', kind: 'percent' },
    { key: 'summonDuration', label: '소환 지속시간', kind: 'percent' },
    { key: 'cooldown', label: '쿨타임 감소', kind: 'percent' },
    { key: 'dotDamage', label: '지속 피해', kind: 'percent' },
    { key: 'waldolandDmg', label: "'월도랜드' 필드 공격 시 추가 피해", kind: 'percent' },
    { key: 'butagamePartyQuestDmg', label: "'부타게임' 파티 퀘스트 내 추가 피해", kind: 'percent' }
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
        const customBtn = el('button', { class: 'btn sm', type: 'button', title: '임의 키 추가 (고급)', onclick: async () => {
            const k = (await showPrompt('커스텀 키:'));
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
    let sp = step.special;
    if (Array.isArray(sp)) { const m = {}; sp.forEach(o => { if (o && typeof o === 'object') Object.keys(o).forEach(k => m[k] = o[k]); }); sp = m; }
    if (sp && typeof sp === 'object') {
        PET_SPECIAL_NUM_DEFS.forEach(def => {
            const v = sp[def.key];
            if (typeof v === 'number' && v !== 0) parts.push(def.label + ' ' + (def.frac ? (Math.round(v * 1000) / 10) + '%' : v));
        });
        if (sp.autoAttend) parts.push('자동 출석');
    }
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
                actions.appendChild(el('button', { class: 'btn sm danger', type: 'button', title: '삭제', onclick: async e => { stop(e); if (!(await showConfirm('+' + (i + 1) + ' 단계를 삭제할까요?'))) return; items.splice(i, 1); repaint(); } }, '삭제'));
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
                if (options && options.allowSpecial) {
                    body.appendChild(sectionTitle('특수 효과 (special)', '🐾'));
                    body.appendChild(petSpecialEditor(() => step.special, v => { if (v == null) delete step.special; else step.special = v; }));
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
            actions.appendChild(el('button', { class: 'btn sm danger', type: 'button', title: '삭제', onclick: async e => { stop(e); if (!(await showConfirm((Number(starKey) + 1) + '성 보너스를 삭제할까요?'))) return; delete map[starKey]; repaint(); } }, '삭제'));
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
            if (!Number.isInteger(s) || s < 0) { showAlert('0 이상의 정수를 입력하세요.'); return; }
            const key = String(s);
            if (map[key]) { showAlert('이미 존재하는 성급입니다.'); return; }
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
// EQUIPMENT 에디터
// ============================================================================
let equipData = Object.fromEntries(EQUIPMENT_SLOT_KEYS.map(key => [key, []]));
let equipCurrentSlot = 'weapon';
let equipFilterText = '';
const EQUIP_RARITIES = ['일반', '레어', '에픽', '유니크', '레전더리', '초월', '신화', '고유'];
const PET_RARITIES = ['일반', '레어', '에픽', '유니크', '레전더리', '신화', '고유'];
const EQUIP_KNOWN_FIELDS = new Set(['name', 'desc', 'rarity', 'stat', 'plusStat', 'statRange', 'plusStatRange', 'upgrade', 'evolution', 'requireLevel', 'underLevel', 'exactlyStar', 'require', 'requireMainCard', 'dynamicBonus', 'no_trade', 'category', 'isRaid', 'passive_id']);
let equipPassivesList = [];

function renderEquipTypes() {
    const wrap = $('#equipTypes'); wrap.innerHTML = '';
    EQUIPMENT_SLOT_DEFS.forEach(([k, label]) => {
        const arr = (equipData && equipData[k]) || [];
        const b = el('button', { class: 'subtab' + (equipCurrentSlot === k ? ' active' : ''), type: 'button',
            onclick: () => { equipCurrentSlot = k; renderEquipTypes(); renderEquip(); } }, label + ' (' + arr.length + ')');
        wrap.appendChild(b);
    });
}

function equipCard(eq, index) {
    const card = el('div', { class: 'card' });
    const rarityClass = ({ '일반': '', '레어': 'b', '에픽': 'p', '유니크': 'y', '레전더리': 'y', '초월': 'r', '신화': 'm', '고유': 'g' })[eq.rarity] || '';
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
        el('div', { class: 'actions', style: { gap: '4px' } },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
                equipData[equipCurrentSlot].push(JSON.parse(JSON.stringify(eq)));
                equipFilterText = ''; if ($('#equipFilter')) $('#equipFilter').value = '';
                PAGE_STATE['equip:' + equipCurrentSlot] = 1e9; renderEquipTypes(); renderEquip();
                toast('#' + (equipData[equipCurrentSlot].length - 1) + '번으로 복제했습니다.');
            } }, '복제'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                const idKey = { weapon: 'weapon_id', armor: 'armor_id', accessory: 'accessory_id', support: 'support_id' }[equipCurrentSlot];
                const refs = idKey ? await scanRefs(idKey, index) : { direct: 0, above: 0 };
                // 모자/하의/신발은 팩·레시피 등에 *_id 참조 키가 없어 참조 검사를 수행할 수 없음을 명시한다 (조용히 건너뛰지 않음)
                const scanNote = idKey ? '' : '\n* 이 부위(' + EQUIPMENT_SLOT_LABELS[equipCurrentSlot] + ')는 팩/번들/상점/레시피 참조 검사를 지원하지 않습니다. 유저 인벤토리·장착 데이터의 id가 당겨질 수 있으니 주의하세요.';
                if (!(await showConfirm('장비 #' + index + ' (' + (eq.name || '') + ')을(를) 삭제합니까?\n* 후속 인덱스가 모두 -1씩 당겨집니다.' + refWarnText(refs) + scanNote))) return;
                equipData[equipCurrentSlot].splice(index, 1);
                renderEquipTypes(); renderEquip();
            } }, '삭제')
        )
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

    // 패시브
    if (equipPassivesList && equipPassivesList.length) {
        const passiveSel = el('select');
        passiveSel.appendChild(el('option', { value: '' }, '(없음)'));
        equipPassivesList.forEach(p => passiveSel.appendChild(el('option', { value: String(p.id) }, p.id + ' — ' + p.name)));
        passiveSel.value = typeof eq.passive_id !== 'undefined' ? String(eq.passive_id) : '';
        passiveSel.onchange = () => {
            if (passiveSel.value === '') delete eq.passive_id;
            else eq.passive_id = Number(passiveSel.value);
        };
        card.appendChild(el('div', { class: 'nf' }, el('label', null, '패시브'), passiveSel));
    }

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
    if (!equipData || typeof equipData !== 'object') equipData = {};
    EQUIPMENT_SLOT_KEYS.forEach(k => { if (!Array.isArray(equipData[k])) equipData[k] = []; });
    const arr = equipData[equipCurrentSlot] || [];
    const q = (equipFilterText || '').trim().toLowerCase();
    const rows = [];
    arr.forEach((eq, idx) => {
        if (!eq) return;
        if (q) {
            const hay = (idx + ' ' + (eq.name || '') + ' ' + (eq.rarity || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        rows.push(idx);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '장비가 없습니다.')); return; }
    pagedAppend(list, 'equip:' + equipCurrentSlot, rows, idx => equipCard(arr[idx], idx), renderEquip);
}
$('#equipAdd').onclick = () => {
    if (!equipData[equipCurrentSlot]) equipData[equipCurrentSlot] = [];
    equipData[equipCurrentSlot].push({ name: '', desc: '', rarity: '일반', stat: {}, plusStat: {} });
    equipFilterText = ''; if ($('#equipFilter')) $('#equipFilter').value = '';
    PAGE_STATE['equip:' + equipCurrentSlot] = 1e9;
    renderEquipTypes(); renderEquip();
};
$('#equipReload').onclick = async () => {
    try {
        const [data, passives] = await Promise.all([loadKey('Equipment'), fetchEquipmentPassives()]);
        const eq = data || {};
        equipData = Object.assign({}, eq);
        EQUIPMENT_SLOT_KEYS.forEach(key => { equipData[key] = Array.isArray(eq[key]) ? eq[key] : []; });
        equipPassivesList = passives;
        renderEquipTypes(); renderEquip();
        $('#equipStatus').textContent = '로드 완료 (' + EQUIPMENT_SLOT_DEFS.map(([key, label]) => label + ' ' + equipData[key].length).join(' / ') + ')';
        invalidateLookupCache(['equipment']);
    } catch (e) { toast(e.message, false); }
};
$('#equipSave').onclick = async () => {
    if (!(await showConfirm('Equipment 데이터를 저장합니다. 계속?'))) return;
    try { await saveKey('Equipment', equipData); invalidateLookupCache(['equipment']); toast('✅ Equipment 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#equipFilter')) $('#equipFilter').addEventListener('input', e => { equipFilterText = e.target.value; PAGE_STATE['equip:' + equipCurrentSlot] = 0; renderEquip(); });
TAB_LOADERS.equipment = () => $('#equipReload').click();

// ============================================================================
// PET 에디터  ( data: Array<{name, rarity, desc, stat, plusStat, upgrade?, special?, requireLevel?}> )
// ============================================================================
let petData = [];
let petFilterText = '';
const PET_KNOWN_FIELDS = new Set(['name', 'desc', 'rarity', 'stat', 'plusStat', 'upgrade', 'special', 'requireLevel', 'set']);
const PET_SPECIAL_NUM_DEFS = [
    { key: 'fishingSpeed', label: '낚시 속도 증가', frac: true, hint: '0.1 = 10%' },
    { key: 'fishBasket', label: '살림망 크기 증가', frac: false, hint: '칸 수' },
    { key: 'autoFragment', label: '편린 자동 사용 확률', frac: true, hint: '0.1 = 10%' },
    { key: 'hpRegen', label: 'HP 자동 회복 주기', frac: false, hint: 'N초마다 최대 체력 1%' },
    { key: 'mpRegen', label: 'MP 자동 회복 주기', frac: false, hint: 'N초마다 최대 MP 1%' },
    { key: 'canShortcut', label: '단축키 저장 슬롯', frac: false, hint: '개수' }
];

function petSpecialEditor(getter, setter) {
    let special = getter();
    if (Array.isArray(special)) {
        const merged = {};
        special.forEach(o => { if (o && typeof o === 'object') Object.keys(o).forEach(k => { merged[k] = o[k]; }); });
        special = merged; setter(special);
    } else if (!special || typeof special !== 'object') {
        special = {}; setter(special);
    }
    const wrap = el('div', { class: 'section', style: { marginTop: 0 } });
    const list = el('div', { class: 'row' });
    wrap.appendChild(list);
    PET_SPECIAL_NUM_DEFS.forEach(def => {
        const has = Object.prototype.hasOwnProperty.call(special, def.key);
        const inp = el('input', { type: 'number', step: def.frac ? '0.01' : '1',
            value: has && typeof special[def.key] === 'number' ? special[def.key] : '',
            placeholder: def.hint || '',
            oninput: e => { const v = e.target.value; if (v === '') delete special[def.key]; else special[def.key] = Number(v); } });
        list.appendChild(el('div', { class: 'nf' }, el('label', null, def.label), inp, el('div', { class: 'muted', style: { fontSize: '11px' } }, def.hint || '')));
    });
    list.appendChild(el('div', { class: 'nf', style: { minWidth: '160px' } },
        el('label', null, '자동 출석체크'),
        el('div', { style: { padding: '7px 0' } },
            switchToggle({ id: 'pet_autoattend_' + Math.random().toString(36).slice(2), checked: !!special.autoAttend, label: '오늘 미출석 시 자동',
                onChange: v => { if (v) special.autoAttend = true; else delete special.autoAttend; } })
        )
    ));
    return wrap;
}

function petCard(pet, index) {
    const card = el('div', { class: 'card' });
    const rarityClass = ({ '일반': '', '레어': 'b', '에픽': 'p', '유니크': 'y', '레전더리': 'y', '신화': 'r', '고유': 'g' })[pet.rarity] || '';
    const head = el('div', { class: 'card-head' },
        el('div', { class: 'card-title' },
            el('span', { class: 'tag b' }, '#' + index), ' ',
            pet.name || '(이름 없음)',
            pet.rarity ? el('span', { class: 'tag ' + rarityClass, style: { marginLeft: '8px' } }, pet.rarity) : null
        ),
        el('div', { class: 'actions', style: { gap: '4px' } },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
                petData.push(JSON.parse(JSON.stringify(pet)));
                petFilterText = ''; if ($('#petFilter')) $('#petFilter').value = '';
                PAGE_STATE.pet = 1e9; renderPet();
                toast('#' + (petData.length - 1) + '번으로 복제했습니다.');
            } }, '복제'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                const refs = await scanRefs('pet_id', index);
                if (!(await showConfirm('펫 #' + index + ' (' + (pet.name || '') + ')을(를) 삭제합니까?\n* 후속 인덱스가 모두 -1씩 당겨집니다.' + refWarnText(refs)))) return;
                petData.splice(index, 1); renderPet();
            } }, '삭제')
        )
    );
    card.appendChild(head);

    card.appendChild(sectionTitle('기본 정보', '📝'));
    const row1 = el('div', { class: 'row' });
    row1.appendChild(el('div', null, el('label', null, '이름'),
        el('input', { value: pet.name || '', placeholder: '펫 이름', oninput: e => pet.name = e.target.value })));
    const raritySel = el('select');
    PET_RARITIES.forEach(r => raritySel.appendChild(el('option', { value: r }, r)));
    if (pet.rarity && !PET_RARITIES.includes(pet.rarity)) raritySel.appendChild(el('option', { value: pet.rarity }, pet.rarity + ' (사용자 지정)'));
    raritySel.value = pet.rarity || '일반';
    raritySel.onchange = () => pet.rarity = raritySel.value;
    row1.appendChild(el('div', null, el('label', null, '등급'), raritySel));
    row1.appendChild(el('div', { class: 'nf' }, el('label', null, '장착 필요 레벨'),
        el('input', { type: 'number', value: typeof pet.requireLevel === 'number' ? pet.requireLevel : '', placeholder: '예: 10',
            oninput: e => { const v = e.target.value; if (v === '') delete pet.requireLevel; else pet.requireLevel = Number(v); } })));
    row1.appendChild(el('div', null, el('label', null, '세트 이름 (set)'),
        el('input', { value: pet.set || '', placeholder: 'PetSet.json의 세트 이름', oninput: e => { const v = e.target.value.trim(); if (v) pet.set = v; else delete pet.set; } })));
    card.appendChild(row1);

    card.appendChild(el('div', null, el('label', null, '설명'),
        el('textarea', { value: pet.desc || '', placeholder: '펫 설명', style: { minHeight: '40px', fontFamily: 'inherit', fontSize: '13px' }, oninput: e => pet.desc = e.target.value })));

    card.appendChild(sectionTitle('능력치', '✨'));
    if (!pet.stat || typeof pet.stat !== 'object') pet.stat = {};
    if (!pet.plusStat || typeof pet.plusStat !== 'object') pet.plusStat = {};
    const row4 = el('div', { class: 'split' });
    row4.appendChild(statEditor('기본 능력치', '⚔️', pet.stat, FLAT_STAT_DEFS));
    row4.appendChild(statEditor('비율 증가', '📈', pet.plusStat, PLUS_STAT_DEFS));
    card.appendChild(row4);

    card.appendChild(sectionTitle('특수 효과 (special)', '🐾'));
    card.appendChild(petSpecialEditor(() => pet.special, v => { if (v == null) delete pet.special; else pet.special = v; }));

    card.appendChild(sectionTitle('강화 단계', '🔨'));
    card.appendChild(upgradeEditor(() => pet.upgrade, v => { if (v == null) delete pet.upgrade; else pet.upgrade = v; }, { allowSpecial: true }));

    const extraKeys = Object.keys(pet).filter(k => !PET_KNOWN_FIELDS.has(k));
    if (extraKeys.length > 0) {
        const extraObj = {};
        extraKeys.forEach(k => { extraObj[k] = pet[k]; });
        card.appendChild(sectionTitle('기타 필드 (raw JSON)', '⚙️'));
        card.appendChild(jsonSubEditor('', () => extraObj, v => {
            extraKeys.forEach(k => delete pet[k]);
            if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (!PET_KNOWN_FIELDS.has(k)) pet[k] = v[k]; });
        }, '', 3));
    }
    return card;
}

function renderPet() {
    const list = $('#petList'); list.innerHTML = '';
    if (!Array.isArray(petData)) petData = [];
    const q = (petFilterText || '').trim().toLowerCase();
    const rows = [];
    petData.forEach((pet, idx) => {
        if (!pet) return;
        if (q) {
            const hay = (idx + ' ' + (pet.name || '') + ' ' + (pet.rarity || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        rows.push(idx);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '펫이 없습니다.')); return; }
    pagedAppend(list, 'pet', rows, idx => petCard(petData[idx], idx), renderPet);
}
$('#petAdd').onclick = () => {
    if (!Array.isArray(petData)) petData = [];
    petData.push({ name: '', desc: '', rarity: '일반', stat: {}, plusStat: {}, special: {} });
    petFilterText = ''; if ($('#petFilter')) $('#petFilter').value = '';
    PAGE_STATE.pet = 1e9;
    renderPet();
};
$('#petReload').onclick = async () => {
    try {
        const data = await loadKey('Pet');
        petData = Array.isArray(data) ? data : [];
        renderPet();
        invalidateLookupCache(['pet']);
        $('#petStatus').textContent = '로드 완료 (펫 ' + petData.length + '종)' + (data == null ? ' · 저장 시 Pet 데이터가 새로 생성됩니다' : '');
    } catch (e) { toast(e.message, false); }
};
$('#petSave').onclick = async () => {
    if (!(await showConfirm('Pet 데이터를 저장합니다. 계속?'))) return;
    try { await saveKey('Pet', Array.isArray(petData) ? petData : []); invalidateLookupCache(['pet']); toast('✅ Pet 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#petFilter')) $('#petFilter').addEventListener('input', e => { petFilterText = e.target.value; PAGE_STATE.pet = 0; renderPet(); });
TAB_LOADERS.pet = () => $('#petReload').click();

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
        el('div', { class: 'actions', style: { gap: '4px' } },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
                fashionData.push(JSON.parse(JSON.stringify(skin)));
                fashionFilterText = ''; if ($('#fashionFilter')) $('#fashionFilter').value = '';
                PAGE_STATE.fashion = 1e9; renderFashion();
                toast('#' + (fashionData.length - 1) + '번으로 복제했습니다.');
            } }, '복제'),
            el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                if (!(await showConfirm('스킨 #' + index + ' (' + (skin.name || '') + ')을(를) 삭제합니까?'))) return;
                fashionData.splice(index, 1);
                renderFashion();
            } }, '삭제')
        )
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
    const rows = [];
    fashionData.forEach((skin, idx) => {
        if (!skin) return;
        if (q && !((skin.name || '') + ' ' + idx).toLowerCase().includes(q)) return;
        rows.push(idx);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '스킨이 없습니다.')); return; }
    pagedAppend(list, 'fashion', rows, idx => fashionCard(fashionData[idx], idx), renderFashion);
}
$('#fashionAdd').onclick = () => { fashionData.push({ name: '', primary_card: [], option: {} }); fashionFilterText = ''; if ($('#fashionFilter')) $('#fashionFilter').value = ''; PAGE_STATE.fashion = 1e9; renderFashion(); };
$('#fashionReload').onclick = async () => {
    try { fashionData = (await loadKey('Fashion')) || []; renderFashion(); $('#fashionStatus').textContent = '로드 완료 (' + fashionData.length + '개)'; invalidateLookupCache(['fashion']); }
    catch (e) { toast(e.message, false); }
};
$('#fashionSave').onclick = async () => {
    if (!(await showConfirm('Fashion 데이터를 저장합니다. 계속?'))) return;
    try { await saveKey('Fashion', fashionData); invalidateLookupCache(['fashion']); toast('✅ Fashion 저장 완료'); }
    catch (e) { toast(e.message, false); }
};
if ($('#fashionFilter')) $('#fashionFilter').addEventListener('input', e => { fashionFilterText = e.target.value; PAGE_STATE.fashion = 0; renderFashion(); });
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
    const rows = [];
    tradeLogData.forEach(log => {
        if (tt && log.tradeType !== tt) return;
        if (kk && log.kind !== kk) return;
        if (q) {
            const hay = ((log.buyer || '') + ' ' + (log.seller || '') + ' ' + (log.itemName || '')).toLowerCase();
            if (!hay.includes(q)) return;
        }
        rows.push(log);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, tradeLogData.length === 0 ? '아직 기록된 거래가 없습니다.' : '검색 결과가 없습니다.')); return; }
    pagedAppend(list, 'tradelog', rows, log => tradeLogRow(log), renderTradeLog);
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
    if (!(await showConfirm('거래 로그 전체를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))) return;
    try { await api('/api/admin/tradelog', { method: 'DELETE' }); tradeLogData = []; renderTradeLog(); $('#tradeLogStatus').textContent = '삭제 완료'; toast('거래 로그를 삭제했습니다.'); }
    catch (e) { toast(e.message, false); }
};
if ($('#tradeLogFilter')) $('#tradeLogFilter').addEventListener('input', e => { tradeLogFilter.q = e.target.value; PAGE_STATE.tradelog = 0; renderTradeLog(); });
if ($('#tradeLogType')) $('#tradeLogType').onchange = e => { tradeLogFilter.tradeType = e.target.value; PAGE_STATE.tradelog = 0; renderTradeLog(); };
if ($('#tradeLogKind')) $('#tradeLogKind').onchange = e => { tradeLogFilter.kind = e.target.value; PAGE_STATE.tradelog = 0; renderTradeLog(); };
TAB_LOADERS.tradelog = loadTradeLog;

// ============================================================================
// 유생의 주사위 로그
// ============================================================================
let eventDiceLogData = [];
let eventDiceLogFilter = { q: '', hit: '' };

function eventDiceRewardText(log) {
    const reward = log.receivedReward;
    if (!reward) return '보상 없음';
    return (reward.name || reward.grantName || '-') + ' x' + comma(reward.count || 0) + (reward.lightning ? ' · 라이트닝 2배' : '');
}

function eventDiceLogRow(log) {
    const hit = !!log.hit;
    const row = el('div', { class: 'dice-log-row ' + (hit ? 'hit' : 'miss'), title: log.id || '' });
    row.appendChild(el('div', { class: 'mono mut' }, formatTradeLogTime(log.time)));
    row.appendChild(el('div', { class: 'user' }, log.nickname || '-', el('div', { class: 'mut mono' }, log.userId || '-')));
    row.appendChild(el('div', { class: 'mono' }, '예측 ' + (log.prediction == null ? '-' : log.prediction) + ' → 결과 ' + (log.sum == null ? '-' : log.sum)));
    row.appendChild(el('div', { class: 'mono' }, Array.isArray(log.dice) ? log.dice.join(' + ') : '-'));
    row.appendChild(el('div', { class: 'mono' }, '라이트닝 ' + (log.lightningSum == null ? '-' : log.lightningSum)));
    row.appendChild(el('div', { class: 'reward' }, eventDiceRewardText(log)));
    row.appendChild(el('div', { class: 'status' }, el('span', { class: 'tag ' + (hit ? 'd-hit' : 'd-miss') }, hit ? '당첨' : '실패')));
    return row;
}

function renderEventDiceLog() {
    const list = $('#eventDiceLogList'); list.innerHTML = '';
    const q = (eventDiceLogFilter.q || '').trim().toLowerCase();
    const hitFilter = eventDiceLogFilter.hit;
    const rows = [];
    eventDiceLogData.forEach(log => {
        if (hitFilter === 'hit' && !log.hit) return;
        if (hitFilter === 'miss' && log.hit) return;
        if (q) {
            const hay = [
                log.nickname || '',
                log.userId || '',
                log.prediction == null ? '' : String(log.prediction),
                log.sum == null ? '' : String(log.sum),
                Array.isArray(log.dice) ? log.dice.join(' ') : '',
                log.lightningSum == null ? '' : String(log.lightningSum),
                eventDiceRewardText(log)
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return;
        }
        rows.push(log);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, eventDiceLogData.length === 0 ? '아직 기록된 주사위 로그가 없습니다.' : '검색 결과가 없습니다.')); return; }
    pagedAppend(list, 'dicelog', rows, log => eventDiceLogRow(log), renderEventDiceLog);
}

async function loadEventDiceLog() {
    $('#eventDiceLogStatus').textContent = '불러오는 중...';
    try {
        const data = await api('/api/admin/event-dice-logs?limit=5000');
        eventDiceLogData = data.items || [];
        $('#eventDiceLogStatus').textContent = '총 ' + eventDiceLogData.length + '건';
        renderEventDiceLog();
    } catch (e) {
        $('#eventDiceLogStatus').textContent = '';
        toast(e.message, false);
    }
}

if ($('#eventDiceLogReload')) $('#eventDiceLogReload').onclick = loadEventDiceLog;
if ($('#eventDiceLogFilter')) $('#eventDiceLogFilter').addEventListener('input', e => { eventDiceLogFilter.q = e.target.value; PAGE_STATE.dicelog = 0; renderEventDiceLog(); });
if ($('#eventDiceLogHit')) $('#eventDiceLogHit').onchange = e => { eventDiceLogFilter.hit = e.target.value; PAGE_STATE.dicelog = 0; renderEventDiceLog(); };
TAB_LOADERS.eventdicelog = loadEventDiceLog;

// ============================================================================
// 포인트 충전 로그
// ============================================================================
let pointLogData = [];
let pointLogFilter = '';

function formatPointLogTime(iso) {
    if (!iso) return '-';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return String(iso);
    return formatTradeLogTime(ms);
}

function pointLogRow(log) {
    const row = el('div', { class: 'point-log-row' });
    row.appendChild(el('div', { class: 'mono mut' }, formatPointLogTime(log.at)));
    row.appendChild(el('div', { class: 'nick' }, log.nickname || '-'));
    row.appendChild(el('div', { class: 'mono amount' }, '+' + comma(log.amount) + ' P'));
    const dist = '로또기금 ' + comma(log.lotto) + ' · 익테봇 ' + comma(log.company)
        + ' · Lukim9 ' + comma(log.lukim) + ' · 유치원생 ' + comma(log.kinder)
        + ' / 충전 후 잔액 ' + comma(log.point) + ' P';
    row.appendChild(el('div', { class: 'mono dist mut', title: dist }, dist));
    const act = el('div', { class: 'act' });
    if (log.id) {
        const btn = el('button', { class: 'btn danger', style: 'padding:5px 10px;font-size:12px' }, '취소');
        btn.onclick = () => cancelPointLog(log, btn);
        act.appendChild(btn);
    }
    row.appendChild(act);
    return row;
}

async function cancelPointLog(log, btn) {
    if (!(await showConfirm(log.nickname + '님의 ' + comma(log.amount) + 'P 충전을 취소(환불)할까요?\n충전 계정 잔액과 분배가 되돌려집니다.'))) return;
    btn.disabled = true;
    showLoading();
    try {
        await api('/api/admin/point-logs/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: log.id }) });
        toast('충전을 취소했습니다.', true);
        loadPointLog();
    } catch (e) {
        btn.disabled = false;
        toast(e.message, false);
    } finally {
        hideLoading();
    }
}

function renderPointLog() {
    const list = $('#pointLogList'); list.innerHTML = '';
    const q = (pointLogFilter || '').trim().toLowerCase();
    const rows = [];
    pointLogData.forEach(log => {
        if (q && !String(log.nickname || '').toLowerCase().includes(q)) return;
        rows.push(log);
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, pointLogData.length === 0 ? '아직 충전 기록이 없습니다.' : '검색 결과가 없습니다.')); return; }
    pagedAppend(list, 'pointlog', rows, log => pointLogRow(log), renderPointLog);
}

async function loadPointLog() {
    $('#pointLogStatus').textContent = '불러오는 중...';
    try {
        const data = await api('/api/admin/point-logs');
        pointLogData = data.items || [];
        $('#pointLogStatus').textContent = '총 ' + pointLogData.length + '건';
        renderPointLog();
    } catch (e) {
        $('#pointLogStatus').textContent = '';
        toast(e.message, false);
    }
}

if ($('#pointLogReload')) $('#pointLogReload').onclick = loadPointLog;
if ($('#pointLogFilter')) $('#pointLogFilter').addEventListener('input', e => { pointLogFilter = e.target.value; PAGE_STATE.pointlog = 0; renderPointLog(); });
TAB_LOADERS.pointlog = loadPointLog;

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
    if (!restoreTime && !(await showConfirm('복원 시점이 비어있습니다. 최신 복원 가능 시점으로 복원 테이블을 만들까요?'))) return;
    if (!(await showConfirm('PITR 복원 테이블을 새로 생성합니다. AWS 비용이 발생할 수 있습니다. 계속할까요?'))) return;
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
    const confirmText = (await showPrompt('복원 테이블 데이터를 운영 테이블에 덮어씁니다.\n운영에만 있는 항목은 삭제하지 않습니다.\n진행하려면 "마이그레이션"을 입력하세요.'));
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
    if (!(await showConfirm('복원용 임시 테이블을 삭제합니다. 계속할까요?'))) return;
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
    if (!(await showConfirm(k + ' 데이터를 DynamoDB에 저장합니다. 계속할까요?'))) return;
    try { await saveKey(k, data); toast('✅ ' + k + ' 저장 완료'); } catch (e) { toast(e.message, false); }
};
TAB_LOADERS.raw = () => rawLoad();

// ============================================================================
// 핫딜 미리보기
// ============================================================================
const GOODS_LABEL = { gold: '골드', garnet: '가넷' };
const SEG_LABEL = ['00:00–06:00', '06:00–12:00', '12:00–18:00', '18:00–24:00'];

function renderHdSlot(slot, slotIdx) {
    const wrap = el('div', { class: 'hd-prev-slot ' + (slotIdx === 0 ? 'fire' : 'lightning') });
    if (slot.iconUrl) wrap.appendChild(el('img', { class: 'hd-prev-icon', src: slot.iconUrl, alt: '' }));
    const nameRow = el('div', { class: 'hd-prev-name' }, slot.name + (slot.count > 1 ? ` ×${slot.count}` : ''));
    const priceRow = el('div', { class: 'hd-prev-price' },
        GOODS_LABEL[slot.goods] || slot.goods,
        ' ',
        Number(slot.amount).toLocaleString()
    );
    wrap.appendChild(nameRow);
    wrap.appendChild(priceRow);
    return wrap;
}

function renderHdPeriod(item) {
    const seg = Number(item.periodKey.split('-')[3]);
    const card = el('div', { class: 'hd-prev-card' });
    card.appendChild(el('div', { class: 'hd-prev-header' },
        el('span', { class: 'hd-prev-time' }, SEG_LABEL[seg] || item.periodKey),
        el('span', { class: 'hd-prev-sector' }, item.sectorName),
        item.edited ? el('span', { class: 'hd-prev-edited' }, '편집됨') : null
    ));
    const slots = el('div', { class: 'hd-prev-slots' });
    item.slots.forEach((s, i) => slots.appendChild(renderHdSlot(s, i)));
    card.appendChild(slots);
    if (Array.isArray(item.options) && item.options.length) {
        card.appendChild(el('button', { class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => openHdEditModal(item) }, '편집'));
    }
    return card;
}

function hdOptionMatchesSlot(opt, slot) {
    return opt.id === slot.itemId && opt.count === slot.count && opt.goods === slot.goods && opt.amount === slot.amount;
}

function openHdEditModal(item) {
    const seg = Number(item.periodKey.split('-')[3]);
    const bg = el('div', { class: 'modal-bg show' });
    bg.onclick = e => { if (e.target === bg) bg.remove(); };
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', null, '핫딜 편집 — ' + item.periodKey.slice(0, 10) + ' ' + (SEG_LABEL[seg] || '')));
    const body = el('div', { class: 'body', style: 'padding:16px;display:flex;flex-direction:column;gap:14px' });
    body.appendChild(el('div', { class: 'muted' }, '섹터: ' + item.sectorName + ' (변경 불가)'));
    const selects = [];
    [0, 1].forEach(slotIdx => {
        const cur = item.slots[slotIdx];
        const sel = el('select', { style: 'width:100%' });
        item.options.forEach((opt, oi) => {
            const o = el('option', { value: String(oi) }, opt.label);
            if (cur && hdOptionMatchesSlot(opt, cur)) o.selected = true;
            sel.appendChild(o);
        });
        selects.push(sel);
        body.appendChild(el('div', null, el('label', null, '슬롯 ' + (slotIdx + 1)), sel));
    });
    modal.appendChild(body);
    const foot = el('div', { class: 'foot', style: 'display:flex;gap:8px;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn', onclick: () => bg.remove() }, '취소'));
    if (item.edited) foot.appendChild(el('button', { class: 'btn danger', onclick: () => hdResetOverride(item.periodKey, bg) }, '기본값으로 되돌리기'));
    foot.appendChild(el('button', { class: 'btn primary', onclick: () => hdSaveOverride(item, selects, bg) }, '저장'));
    modal.appendChild(foot);
    bg.appendChild(modal);
    document.body.appendChild(bg);
}

async function hdSaveOverride(item, selects, bg) {
    const picks = selects.map(sel => {
        const opt = item.options[Number(sel.value)];
        return { id: opt.id, count: opt.count, goods: opt.goods, amount: opt.amount };
    });
    try {
        await api('/api/admin/hotdeal/override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodKey: item.periodKey, picks }) });
        bg.remove();
        loadHdPreview();
    } catch (e) { showAlert(e.message); }
}

async function hdResetOverride(periodKey, bg) {
    if (!(await showConfirm('이 핫딜을 기본값(시드 생성)으로 되돌릴까요?'))) return;
    try {
        await api('/api/admin/hotdeal/override/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodKey }) });
        bg.remove();
        loadHdPreview();
    } catch (e) { showAlert(e.message); }
}

async function loadHdPreview() {
    const date = $('#hdDate').value;
    const seg = $('#hdSeg').value;
    const result = $('#hdResult');
    result.innerHTML = '<div class="muted">불러오는 중...</div>';
    try {
        let url = '/api/admin/hotdeal/preview';
        if (date) { url += '?date=' + encodeURIComponent(date); if (seg !== '') url += '&seg=' + seg; }
        const data = await api(url);
        result.innerHTML = '';
        if (Array.isArray(data)) {
            const grid = el('div', { class: 'hd-prev-grid' });
            data.forEach(item => grid.appendChild(renderHdPeriod(item)));
            result.appendChild(grid);
        } else {
            result.appendChild(renderHdPeriod(data));
        }
    } catch (e) {
        result.innerHTML = '<div class="muted err">' + e.message + '</div>';
    }
}

// set default date to today (local)
const _hdTodayLocal = new Date();
$('#hdDate').value = _hdTodayLocal.getFullYear() + '-' + String(_hdTodayLocal.getMonth() + 1).padStart(2, '0') + '-' + String(_hdTodayLocal.getDate()).padStart(2, '0');

$('#hdPreviewBtn').onclick = loadHdPreview;
TAB_LOADERS.hotdealpreview = () => loadHdPreview();
TAB_LOADERS.raw = () => rawLoad();

// ============================================================================
// 메일 전체 발송
// ============================================================================
const bcGifts = [];
const BC_MAX = 10;

function bcGiftLabel(g) {
    if (g.type === 'gold') return '골드 ' + (Number(g.amount) || 0);
    if (g.type === 'garnet') return '가넷 ' + (Number(g.amount) || 0);
    if (g.type === 'point') return (Number(g.amount) || 0) + 'P';
    if (g.type === 'item') return (g.itemName || '아이템 미선택') + ' x' + (Number(g.count) || 0);
    if (g.type === 'card') return (g.cardName || '카드 미선택') + ' ' + ((Number(g.star) || 0) + 1) + '성' + (g.jobType === '전직' ? ' [전직]' : '');
    if (g.type === 'equipment') return (g.equipName || (EQUIPMENT_SLOT_LABELS[g.equipType] + ' 미선택')) + ' +' + (Number(g.level) || 0);
    if (g.type === 'pet') return (g.petName || '펫 미선택') + ' +' + (Number(g.level) || 0);
    if (g.type === 'title') return '칭호: ' + (g.titleName || '미선택');
    return '?';
}

function renderBcGifts() {
    const list = $('#bcGiftList');
    list.innerHTML = '';
    if (!bcGifts.length) { list.appendChild(el('div', { class: 'muted' }, '담은 선물이 없습니다.')); return; }
    bcGifts.forEach((g, i) => {
        const card = el('div', { class: 'card' });
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, bcGiftLabel(g)),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { bcGifts.splice(i, 1); renderBcGifts(); } }, '삭제')
        ));
        const row = el('div', { class: 'row' });
        if (g.type === 'gold' || g.type === 'garnet' || g.type === 'point') {
            row.appendChild(el('div', null, el('label', null, '수량'),
                el('input', { type: 'number', value: g.amount || 0, oninput: e => { g.amount = Number(e.target.value); } })));
        } else if (g.type === 'item') {
            row.appendChild(el('div', { style: 'flex:1' }, el('label', null, '아이템 (거래불가 가능)'),
                el('button', { class: 'btn pickbtn', type: 'button', style: 'width:100%;text-align:left', onclick: () => pickItem(it => { g.id = it.id; g.itemName = it.name; renderBcGifts(); }) }, g.itemName ? ('#' + g.id + ' ' + g.itemName) : '아이템 선택...')));
            row.appendChild(el('div', null, el('label', null, '수량'),
                el('input', { type: 'number', value: g.count || 1, oninput: e => { g.count = Number(e.target.value); } })));
        } else if (g.type === 'card') {
            row.appendChild(el('div', { style: 'flex:1' }, el('label', null, '캐릭터'),
                el('button', { class: 'btn pickbtn', type: 'button', style: 'width:100%;text-align:left', onclick: () => pickCard(c => { g.cardId = c.id; g.cardName = c.name; renderBcGifts(); }) }, g.cardName ? ('#' + g.cardId + ' ' + g.cardName) : '캐릭터 선택...')));
            row.appendChild(el('div', null, el('label', null, '성급 (0=1성)'),
                el('input', { type: 'number', min: 0, max: 10, value: g.star || 0, oninput: e => { g.star = Number(e.target.value); } })));
            const sel = el('select', { onchange: e => { g.jobType = e.target.value; renderBcGifts(); } },
                el('option', { value: '일반' }, '일반'), el('option', { value: '전직' }, '전직'));
            sel.value = g.jobType || '일반';
            row.appendChild(el('div', null, el('label', null, '종류'), sel));
        } else if (g.type === 'equipment') {
            const typeSel = el('select', { onchange: e => { g.equipType = e.target.value; g.id = undefined; g.equipName = ''; renderBcGifts(); } },
                ...Object.keys(EQUIPMENT_SLOT_LABELS).map(t => el('option', { value: t }, EQUIPMENT_SLOT_LABELS[t])));
            typeSel.value = g.equipType || 'weapon';
            row.appendChild(el('div', null, el('label', null, '부위'), typeSel));
            row.appendChild(el('div', { style: 'flex:1' }, el('label', null, '장비'),
                el('button', { class: 'btn pickbtn', type: 'button', style: 'width:100%;text-align:left', onclick: () => pickEquipment(g.equipType || 'weapon', eq => { g.id = eq.id; g.equipName = eq.name; renderBcGifts(); }) }, g.equipName ? ('#' + g.id + ' ' + g.equipName) : '장비 선택...')));
            row.appendChild(el('div', null, el('label', null, '강화 (+레벨)'),
                el('input', { type: 'number', min: 0, value: g.level || 0, oninput: e => { g.level = Number(e.target.value); } })));
            card.appendChild(row);
            card.appendChild(el('div', { class: 'row' }, el('div', { style: 'flex:1' },
                el('label', null, '고급 옵션 JSON (선택) — potential / rolled / soul / locked'),
                el('textarea', { rows: 3, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '예) {"potential":{"rarity":"전설","options":[...]}}', value: g.advancedText || '', oninput: e => { g.advancedText = e.target.value; } }))));
            list.appendChild(card);
            return;
        } else if (g.type === 'pet') {
            row.appendChild(el('div', { style: 'flex:1' }, el('label', null, '펫'),
                el('button', { class: 'btn pickbtn', type: 'button', style: 'width:100%;text-align:left', onclick: () => pickPet(p => { g.id = p.id; g.petName = p.name; renderBcGifts(); }) }, g.petName ? ('#' + g.id + ' ' + g.petName) : '펫 선택...')));
            row.appendChild(el('div', null, el('label', null, '레벨'),
                el('input', { type: 'number', min: 0, value: g.level || 0, oninput: e => { g.level = Number(e.target.value); } })));
        } else if (g.type === 'title') {
            row.appendChild(el('div', { style: 'flex:1' }, el('label', null, '칭호'),
                el('button', { class: 'btn pickbtn', type: 'button', style: 'width:100%;text-align:left', onclick: () => pickTitle(t => { g.titleId = t.id; g.titleName = t.name; renderBcGifts(); }) }, g.titleName ? (g.titleName + ' (' + g.titleId + ')') : '칭호 선택...')));
        }
        card.appendChild(row);
        list.appendChild(card);
    });
}

function bcAdd(type) {
    if (bcGifts.length >= BC_MAX) return toast('선물은 최대 ' + BC_MAX + '개입니다.', false);
    const g = { type };
    if (type === 'equipment') g.equipType = 'weapon';
    if (type === 'card') g.jobType = '일반';
    bcGifts.push(g);
    renderBcGifts();
}

$('#bcAddGold').onclick = () => bcAdd('gold');
$('#bcAddGarnet').onclick = () => bcAdd('garnet');
$('#bcAddPoint').onclick = () => bcAdd('point');
$('#bcAddItem').onclick = () => bcAdd('item');
$('#bcAddCard').onclick = () => bcAdd('card');
$('#bcAddEquip').onclick = () => bcAdd('equipment');
$('#bcAddPet').onclick = () => bcAdd('pet');
$('#bcAddTitle').onclick = () => bcAdd('title');

$('#bcSendBtn').onclick = async () => {
    const subject = $('#bcSubject').value.trim();
    const body = $('#bcBody').value.trim();
    const gmName = $('#bcGmName').value.trim();
    if (!subject && !body && !bcGifts.length) return toast('제목/내용 또는 선물을 입력하세요.', false);
    const gifts = [];
    for (const g of bcGifts) {
        if (g.type === 'gold' || g.type === 'garnet' || g.type === 'point') {
            if (!(Number(g.amount) > 0)) return toast((g.type === 'gold' ? '골드' : g.type === 'garnet' ? '가넷' : '포인트') + ' 수량을 입력하세요.', false);
            gifts.push({ type: g.type, amount: Number(g.amount) });
        } else if (g.type === 'item') {
            if (typeof g.id === 'undefined') return toast('아이템을 선택하세요.', false);
            gifts.push({ type: 'item', id: g.id, count: Number(g.count || 0) });
        } else if (g.type === 'card') {
            if (typeof g.cardId === 'undefined') return toast('카드를 선택하세요.', false);
            gifts.push({ type: 'card', cardId: g.cardId, star: Number(g.star || 0), jobType: g.jobType || '일반' });
        } else if (g.type === 'pet') {
            if (typeof g.id === 'undefined') return toast('펫을 선택하세요.', false);
            gifts.push({ type: 'pet', id: g.id, level: Number(g.level || 0) });
        } else if (g.type === 'title') {
            if (!g.titleId) return toast('칭호를 선택하세요.', false);
            gifts.push({ type: 'title', titleId: g.titleId });
        } else if (g.type === 'equipment') {
            if (typeof g.id === 'undefined') return toast('장비를 선택하세요.', false);
            const spec = { type: 'equipment', equipType: g.equipType, id: g.id, level: Number(g.level || 0) };
            if (g.advancedText && g.advancedText.trim()) {
                try { spec.advanced = JSON.parse(g.advancedText); }
                catch (err) { return toast('장비 고급 옵션 JSON 오류: ' + err.message, false); }
            }
            gifts.push(spec);
        }
    }
    const to = $('#bcTo').value.trim();
    if (!(await showConfirm(to ? "'" + to + "'님에게 메일을 발송합니다. 계속할까요?" : '모든 유저에게 메일을 발송합니다. 계속할까요?'))) return;
    $('#bcSendBtn').disabled = true;
    $('#bcStatus').textContent = '발송 중...';
    try {
        let statusText;
        if (to) {
            await api('/api/admin/mail/send-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body, gmName, gifts }) });
            statusText = to + '님에게 발송 완료';
        } else {
            const r = await api('/api/admin/mail/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, body, gmName, gifts }) });
            statusText = r.recipients + '명 발송 완료';
        }
        toast('✅ ' + statusText);
        $('#bcStatus').textContent = statusText;
        bcGifts.length = 0;
        $('#bcSubject').value = '';
        $('#bcBody').value = '';
        renderBcGifts();
    } catch (e) { toast(e.message, false); $('#bcStatus').textContent = ''; }
    finally { $('#bcSendBtn').disabled = false; }
};

renderBcGifts();

// ============================================================================
// 패치노트 에디터
// ============================================================================
let patchnoteData = [];
function normalizePatchnote(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && typeof data === 'object' && (data.title || data.textbody)) return [Object.assign({ id: 'main', replies: [] }, data)];
    return [];
}
function patchnoteCard(post, index) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-head' },
        el('div', { class: 'card-title' },
            el('span', { class: 'tag b' }, '#' + index), ' ',
            post.title || '(제목 없음)',
            el('span', { class: 'tag', style: { marginLeft: '8px' } }, (Array.isArray(post.replies) ? post.replies.length : 0) + ' 댓글')),
        el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!(await showConfirm('패치노트 "' + (post.title || '') + '"를 삭제합니까? 댓글도 함께 삭제됩니다.'))) return;
            patchnoteData.splice(index, 1); renderPatchnote();
        } }, '삭제')
    ));
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { style: { flex: '2' } }, el('label', null, '제목'),
        el('input', { value: post.title || '', placeholder: '패치노트 제목', oninput: e => post.title = e.target.value })));
    row.appendChild(el('div', null, el('label', null, '날짜'),
        el('input', { value: post.date || '', placeholder: 'YYYY-MM-DD HH:mm', oninput: e => post.date = e.target.value })));
    card.appendChild(row);
    card.appendChild(el('div', null, el('label', null, '내용'),
        el('textarea', { value: post.textbody || '', placeholder: '패치노트 내용', style: { minHeight: '140px', fontFamily: 'inherit', fontSize: '13px', whiteSpace: 'pre-wrap' }, oninput: e => post.textbody = e.target.value })));
    return card;
}
function renderPatchnote() {
    const list = $('#patchnoteList'); list.innerHTML = '';
    if (!Array.isArray(patchnoteData)) patchnoteData = [];
    const rows = patchnoteData.map((_, i) => i).filter(i => patchnoteData[i]);
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, '패치노트가 없습니다.')); return; }
    pagedAppend(list, 'patchnote', rows, i => patchnoteCard(patchnoteData[i], i), renderPatchnote);
}
if ($('#patchnoteAdd')) {
    $('#patchnoteAdd').onclick = () => {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        patchnoteData.unshift({
            id: Date.now().toString(36) + Math.random().toString(16).slice(2, 10),
            title: '', textbody: '',
            date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
            replies: []
        });
        PAGE_STATE.patchnote = 0; renderPatchnote();
    };
    $('#patchnoteReload').onclick = async () => {
        try { patchnoteData = normalizePatchnote(await loadKey('Patchnote')); renderPatchnote(); $('#patchnoteStatus').textContent = '로드 완료 (' + patchnoteData.length + '건)'; }
        catch (e) { toast(e.message, false); }
    };
    $('#patchnoteSave').onclick = async () => {
        if (!(await showConfirm('패치노트를 저장합니다. 계속?'))) return;
        try { await saveKey('Patchnote', patchnoteData); toast('패치노트 저장 완료'); }
        catch (e) { toast(e.message, false); }
    };
    TAB_LOADERS.patchnote = () => $('#patchnoteReload').click();
}

// ============================================================================
// 닉네임 매칭 에디터 (NameMatch: RPGenius 닉네임 -> 충전 계정 닉네임)
// ============================================================================
let nmPairs = [];
let nmFilterText = '';
function nmRow(pair, index) {
    return el('div', { class: 'entry' },
        el('input', { type: 'text', value: pair[0], placeholder: 'RPGenius 닉네임', style: { flex: '1', minWidth: '140px' }, oninput: e => pair[0] = e.target.value }),
        el('span', { class: 'lab' }, '→'),
        el('input', { type: 'text', value: pair[1], placeholder: '충전 계정 닉네임', style: { flex: '1', minWidth: '140px' }, oninput: e => pair[1] = e.target.value }),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => { nmPairs.splice(index, 1); renderNm(); } }, '삭제')
    );
}
function renderNm() {
    const list = $('#nmList'); list.innerHTML = '';
    const q = (nmFilterText || '').trim().toLowerCase();
    const rows = nmPairs.map((_, i) => i).filter(i => !q || (nmPairs[i][0] + ' ' + nmPairs[i][1]).toLowerCase().includes(q));
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '등록된 매칭이 없습니다.')); return; }
    pagedAppend(list, 'namematch', rows, i => nmRow(nmPairs[i], i), renderNm);
}
if ($('#nmAdd')) {
    $('#nmAdd').onclick = () => { nmPairs.push(['', '']); PAGE_STATE.namematch = 1e9; renderNm(); };
    $('#nmReload').onclick = async () => {
        try {
            const data = (await loadKey('NameMatch')) || {};
            nmPairs = Object.entries(data).map(([k, v]) => [k, String(v || '')]);
            renderNm(); $('#nmStatus').textContent = '로드 완료 (' + nmPairs.length + '건)';
        } catch (e) { toast(e.message, false); }
    };
    $('#nmSave').onclick = async () => {
        const map = {};
        for (const [k, v] of nmPairs) {
            const key = k.trim(), val = v.trim();
            if (!key || !val) { toast('빈 닉네임이 있습니다.', false); return; }
            if (map[key]) { toast('중복된 닉네임: ' + key, false); return; }
            map[key] = val;
        }
        if (!(await showConfirm('닉네임 매칭 ' + Object.keys(map).length + '건을 저장합니다. 계속?'))) return;
        try { await saveKey('NameMatch', map); toast('닉네임 매칭 저장 완료'); }
        catch (e) { toast(e.message, false); }
    };
    if ($('#nmFilter')) $('#nmFilter').addEventListener('input', e => { nmFilterText = e.target.value; PAGE_STATE.namematch = 0; renderNm(); });
    TAB_LOADERS.namematch = () => $('#nmReload').click();
}

// ============================================================================
// 확률 에디터 (Prob.combine: 닉네임별 합성 성공 확률 보너스)
// ============================================================================
let probData = {};
let probPairs = [];
function probRow(pair, index) {
    return el('div', { class: 'entry' },
        el('input', { type: 'text', value: pair[0], placeholder: '닉네임', style: { flex: '1', minWidth: '140px' }, oninput: e => pair[0] = e.target.value }),
        el('span', { class: 'lab' }, '보너스'),
        el('input', { type: 'number', step: 0.01, min: 0, max: 1, value: pair[1], placeholder: '0.05', style: { width: '110px', flex: '0 0 auto' }, oninput: e => pair[1] = Number(e.target.value) || 0 }),
        el('span', { class: 'lab' }, '(0.05 = +5%)'),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => { probPairs.splice(index, 1); renderProb(); } }, '삭제')
    );
}
function renderProb() {
    const list = $('#probList'); list.innerHTML = '';
    const rows = probPairs.map((_, i) => i);
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, '등록된 대상이 없습니다.')); return; }
    pagedAppend(list, 'prob', rows, i => probRow(probPairs[i], i), renderProb);
}
if ($('#probAdd')) {
    $('#probAdd').onclick = () => { probPairs.push(['', 0]); PAGE_STATE.prob = 1e9; renderProb(); };
    $('#probReload').onclick = async () => {
        try {
            probData = (await loadKey('Prob')) || {};
            if (typeof probData !== 'object' || Array.isArray(probData)) probData = {};
            probPairs = Object.entries(probData.combine || {}).map(([k, v]) => [k, Number(v) || 0]);
            renderProb(); $('#probStatus').textContent = '로드 완료 (' + probPairs.length + '건)';
        } catch (e) { toast(e.message, false); }
    };
    $('#probSave').onclick = async () => {
        const combine = {};
        for (const [k, v] of probPairs) {
            const key = k.trim();
            if (!key) { toast('빈 닉네임이 있습니다.', false); return; }
            if (combine[key] != null) { toast('중복된 닉네임: ' + key, false); return; }
            combine[key] = Number(v) || 0;
        }
        if (!(await showConfirm('합성 확률 보너스 ' + Object.keys(combine).length + '건을 저장합니다. 계속?'))) return;
        try { probData.combine = combine; await saveKey('Prob', probData); toast('확률 저장 완료'); }
        catch (e) { toast(e.message, false); }
    };
    TAB_LOADERS.prob = () => $('#probReload').click();
}

// ============================================================================
// 천장 에디터 (Ceil.EventDice: 주사위 합계별 천장 횟수, 0 = 천장 없음)
// ============================================================================
let ceilData = {};
function renderCeil() {
    const grid = $('#ceilGrid'); grid.innerHTML = '';
    const ed = (ceilData && ceilData.EventDice) || {};
    for (let sum = 3; sum <= 18; sum++) {
        const key = String(sum);
        grid.appendChild(el('div', null,
            el('b', null, '합계 ' + sum),
            el('input', { type: 'number', min: 0, value: Number(ed[key] || 0), oninput: e => {
                if (!ceilData || typeof ceilData !== 'object') ceilData = {};
                if (!ceilData.EventDice) ceilData.EventDice = {};
                ceilData.EventDice[key] = Math.max(0, Math.floor(Number(e.target.value) || 0));
            } })
        ));
    }
}
if ($('#ceilReload')) {
    $('#ceilReload').onclick = async () => {
        try {
            ceilData = (await loadKey('Ceil')) || {};
            if (typeof ceilData !== 'object' || Array.isArray(ceilData)) ceilData = {};
            renderCeil(); $('#ceilStatus').textContent = '로드 완료 (0 = 천장 없음)';
        } catch (e) { toast(e.message, false); }
    };
    $('#ceilSave').onclick = async () => {
        if (!(await showConfirm('이벤트 주사위 천장을 저장합니다. 계속?'))) return;
        try { await saveKey('Ceil', ceilData); toast('천장 저장 완료'); }
        catch (e) { toast(e.message, false); }
    };
    TAB_LOADERS.ceil = () => $('#ceilReload').click();
}

// ============================================================================
// 상태 데이터 뷰어 (런타임 상태 키: 항목 단위 조회 / 수정 / 삭제)
// ============================================================================
const STATE_DATA_KEYS = ['Auction', 'BuyOrder', 'ShopState', 'EliteState', 'WorldBossState', 'VoteState', 'PunchState', 'PunchRank', 'Ices', 'Logs'];
let sdData = null;
let sdLoadedKey = '';
let sdFilterText = '';
function sdEntries() {
    if (Array.isArray(sdData)) return sdData.map((v, i) => [i, v]);
    if (sdData && typeof sdData === 'object') return Object.entries(sdData);
    return null;
}
function sdEntryRow(entry) {
    const [k, v] = entry;
    const isArray = Array.isArray(sdData);
    const preview = (() => { try { const s = JSON.stringify(v); return s.length > 110 ? s.slice(0, 110) + '…' : s; } catch (e) { return String(v); } })();
    const det = el('details', { class: 'collapsible' });
    det.appendChild(el('summary', null,
        el('span', { style: { fontWeight: '600' } }, isArray ? '#' + k : String(k)),
        el('span', { class: 'summary-meta', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1' } }, preview)
    ));
    const body = el('div', { class: 'body' });
    const ta = el('textarea', { spellcheck: false, style: { minHeight: '160px' } });
    ta.value = JSON.stringify(v, null, 2);
    body.appendChild(ta);
    body.appendChild(el('div', { class: 'bar', style: { marginTop: '8px', marginBottom: 0 } },
        el('button', { class: 'btn sm', type: 'button', onclick: () => {
            try {
                const parsed = JSON.parse(ta.value);
                if (isArray) sdData[Number(k)] = parsed; else sdData[k] = parsed;
                toast('항목이 적용되었습니다. 전체 저장을 눌러야 반영됩니다.');
                renderSd();
            } catch (e) { toast('JSON 파싱 실패: ' + e.message, false); }
        } }, '적용'),
        el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            const label = isArray ? '#' + k : String(k);
            if (!(await showConfirm('항목 ' + label + '을(를) 삭제합니까?' + (isArray ? '\n배열 항목 삭제 시 이후 인덱스가 당겨집니다.' : '')))) return;
            if (isArray) sdData.splice(Number(k), 1); else delete sdData[k];
            renderSd();
        } }, '삭제')
    ));
    det.appendChild(body);
    return det;
}
function renderSd() {
    const list = $('#sdList'); list.innerHTML = '';
    if (sdData === null || typeof sdData === 'undefined') { list.appendChild(el('div', { class: 'empty' }, '키를 선택하고 불러오기를 눌러주세요.')); return; }
    const entries = sdEntries();
    if (!entries) {
        const ta = el('textarea', { spellcheck: false, style: { minHeight: '120px' } });
        ta.value = JSON.stringify(sdData, null, 2);
        list.appendChild(ta);
        list.appendChild(el('div', { class: 'bar', style: { marginTop: '8px' } },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
                try { sdData = JSON.parse(ta.value); toast('적용되었습니다. 전체 저장을 눌러야 반영됩니다.'); renderSd(); }
                catch (e) { toast('JSON 파싱 실패: ' + e.message, false); }
            } }, '적용')));
        return;
    }
    const q = (sdFilterText || '').trim().toLowerCase();
    const rows = entries.filter(([k, v]) => {
        if (!q) return true;
        try { return (String(k) + ' ' + JSON.stringify(v)).toLowerCase().includes(q); }
        catch (e) { return String(k).toLowerCase().includes(q); }
    });
    if (rows.length === 0) { list.appendChild(el('div', { class: 'empty' }, q ? '검색 결과가 없습니다.' : '항목이 없습니다.')); return; }
    pagedAppend(list, 'statedata', rows, sdEntryRow, renderSd);
}
if ($('#sdKey')) {
    const sel = $('#sdKey');
    STATE_DATA_KEYS.filter(k => !window.DATA_KEYS || window.DATA_KEYS.includes(k)).forEach(k => sel.appendChild(el('option', { value: k }, k)));
    $('#sdReload').onclick = async () => {
        const key = sel.value;
        if (!key) return;
        $('#sdStatus').textContent = '불러오는 중...';
        try {
            sdData = await loadKey(key);
            sdLoadedKey = key;
            PAGE_STATE.statedata = 0;
            renderSd();
            const entries = sdEntries();
            $('#sdStatus').textContent = key + ' 로드 완료' + (entries ? ' (' + entries.length + '항목)' : '');
        } catch (e) { $('#sdStatus').textContent = ''; toast(e.message, false); }
    };
    $('#sdSave').onclick = async () => {
        if (!sdLoadedKey) { toast('먼저 키를 불러와 주세요.', false); return; }
        if (sel.value !== sdLoadedKey && !(await showConfirm('현재 화면의 데이터는 ' + sdLoadedKey + '입니다. ' + sdLoadedKey + '에 저장할까요?'))) return;
        if (!(await showConfirm('상태 데이터 ' + sdLoadedKey + ' 전체를 덮어씁니다. 실행 중인 게임 상태에 즉시 반영됩니다. 계속?'))) return;
        try { await saveKey(sdLoadedKey, sdData); toast(sdLoadedKey + ' 저장 완료'); }
        catch (e) { toast(e.message, false); }
    };
    if ($('#sdFilter')) $('#sdFilter').addEventListener('input', e => { sdFilterText = e.target.value; PAGE_STATE.statedata = 0; renderSd(); });
    TAB_LOADERS.statedata = () => renderSd();
}

// ============================================================================
// 패키지 등록 마법사 (번들 생성 -> 개봉 아이템 생성 -> 상점 등록)
// ============================================================================
let pkgRewards = [];
function pkgRewardRow(r, index) {
    const wrap = el('div', { class: 'entry' });
    const sel = el('select');
    ['골드', '가넷', '포인트', '마일리지', '아이템'].forEach(t => sel.appendChild(el('option', { value: t }, t)));
    sel.value = r.type;
    const target = el('span', { style: { flex: '1', minWidth: '160px', display: 'flex' } });
    function paintTarget() {
        target.innerHTML = '';
        if (r.type === '아이템') {
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof r.item_id === 'number') {
                    const items = await getItems();
                    const it = items.find(x => x.id === r.item_id);
                    btn.appendChild(it ? document.createTextNode('#' + it.id + ' ' + it.name) : el('span', { class: 'ph' }, '없는 아이템 #' + r.item_id));
                } else btn.appendChild(el('span', { class: 'ph' }, '아이템 선택'));
            };
            btn.onclick = () => pickItem(it => { r.item_id = it.id; refresh(); });
            refresh();
            target.appendChild(btn);
        } else {
            delete r.item_id;
            target.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + r.type + ' 직접 지급)'));
        }
    }
    sel.onchange = () => { r.type = sel.value; paintTarget(); };
    paintTarget();
    wrap.appendChild(sel);
    wrap.appendChild(target);
    wrap.appendChild(el('span', { class: 'lab' }, '수량'));
    wrap.appendChild(el('input', { type: 'number', min: 1, value: r.count, style: { width: '110px', flex: '0 0 auto' }, oninput: e => r.count = Math.floor(Number(e.target.value) || 0) }));
    wrap.appendChild(el('button', { class: 'btn icon danger', type: 'button', onclick: () => { pkgRewards.splice(index, 1); renderPkgRewards(); } }, '✕'));
    return wrap;
}
function renderPkgRewards() {
    const list = $('#pkgRewardList'); list.innerHTML = '';
    if (pkgRewards.length === 0) { list.appendChild(el('div', { class: 'empty' }, '보상을 추가하세요.')); return; }
    pkgRewards.forEach((r, i) => list.appendChild(pkgRewardRow(r, i)));
}
async function loadPkgShopTypes() {
    const sel = $('#pkgShopType');
    const prev = sel.value;
    sel.innerHTML = '';
    try {
        const shop = (await loadKey('Shop')) || {};
        Object.keys(shop).forEach(t => sel.appendChild(el('option', { value: t }, t)));
        if (prev && shop[prev]) sel.value = prev;
    } catch (e) { toast(e.message, false); }
}
if ($('#pkgCreate')) {
    $('#pkgRewardAdd').onclick = () => {
        if (pkgRewards.length >= 10) { toast('보상은 최대 10개입니다.', false); return; }
        pkgRewards.push({ type: '골드', count: 1 });
        renderPkgRewards();
    };
    $('#pkgCreate').onclick = async () => {
        const name = $('#pkgName').value.trim();
        if (!name) { toast('패키지 이름을 입력하세요.', false); return; }
        if (pkgRewards.length === 0) { toast('구성 보상을 추가하세요.', false); return; }
        for (const r of pkgRewards) {
            if (!r.count || r.count < 1) { toast('보상 수량을 확인하세요.', false); return; }
            if (r.type === '아이템' && typeof r.item_id !== 'number') { toast('보상 아이템을 선택하세요.', false); return; }
        }
        const shopType = $('#pkgShopType').value;
        if (!shopType) { toast('상점 종류를 선택하세요.', false); return; }
        const amount = Math.floor(Number($('#pkgAmount').value));
        if (!amount || amount < 1) { toast('가격을 입력하세요.', false); return; }
        const limits = {
            max: Number($('#pkgLimitMax').value) || 0,
            daily: Number($('#pkgLimitDaily').value) || 0,
            weekly: Number($('#pkgLimitWeekly').value) || 0,
            monthly: Number($('#pkgLimitMonthly').value) || 0,
            global: Number($('#pkgLimitGlobal').value) || 0
        };
        const body = {
            name,
            desc: $('#pkgDesc').value,
            noTrade: $('#pkgNoTrade').checked,
            rewards: pkgRewards,
            shopType,
            price: { goods: $('#pkgGoods').value, amount },
            limits
        };
        if (!(await showConfirm('패키지 "' + name + '"를 생성합니다.\n번들 생성, 개봉 아이템 생성, ' + shopType + ' 상점 등록이 함께 처리됩니다. 계속?'))) return;
        const btn = $('#pkgCreate');
        btn.disabled = true;
        showLoading();
        try {
            const r = await api('/api/admin/package/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            invalidateLookupCache(['items']);
            PACK_REF_CACHE.Bundle = null;
            $('#pkgStatus').textContent = '생성 완료: 번들 #' + r.bundleIndex + ', 아이템 #' + r.itemIndex + ', ' + r.shopType + ' ' + (r.shopIndex + 1) + '번 상품';
            toast('패키지가 생성되었습니다.');
            pkgRewards = [];
            renderPkgRewards();
            $('#pkgName').value = ''; $('#pkgDesc').value = ''; $('#pkgAmount').value = '';
        } catch (e) { toast(e.message, false); }
        finally { btn.disabled = false; hideLoading(); }
    };
    TAB_LOADERS.package = () => { renderPkgRewards(); loadPkgShopTypes(); };
}

// ============================================================================
// 참조 스캔: 삭제 전 Pack / Bundle / Shop / Recipe / Bait에서 인덱스 참조 검사
// ============================================================================
async function scanRefs(idKey, index) {
    showLoading();
    try {
        const keys = ['Pack', 'Bundle', 'Shop', 'Recipe', 'Bait'];
        const datas = await Promise.all(keys.map(k => loadKey(k).catch(() => null)));
        let direct = 0, above = 0;
        const walk = o => {
            if (!o || typeof o !== 'object') return;
            if (Array.isArray(o)) { o.forEach(walk); return; }
            for (const k in o) {
                if (k === idKey && typeof o[k] === 'number') {
                    if (o[k] === index) direct++;
                    else if (o[k] > index) above++;
                }
                walk(o[k]);
            }
        };
        datas.forEach(walk);
        return { direct, above };
    } finally { hideLoading(); }
}
function refWarnText(refs) {
    let t = '';
    if (refs.direct > 0) t += '\n경고: 팩 / 번들 / 상점 / 레시피 / 미끼에서 이 항목을 ' + refs.direct + '곳에서 참조하고 있습니다.';
    if (refs.above > 0) t += '\n경고: 삭제 시 뒤 인덱스가 당겨져 더 큰 인덱스를 가리키는 참조 ' + refs.above + '곳이 어긋납니다.';
    return t;
}

// ============================================================================
// 아이템 구조화 에디터: 가챠/번들 선택, use, use_func, require, protect
// ============================================================================
const PACK_REF_CACHE = {};
async function getPackRefData(key) {
    if (!PACK_REF_CACHE[key]) PACK_REF_CACHE[key] = loadKey(key).catch(() => []);
    return PACK_REF_CACHE[key];
}
function packEntrySummary(entries, items) {
    if (!Array.isArray(entries) || entries.length === 0) return '(비어 있음)';
    const parts = entries.slice(0, 4).map(e => {
        let t = e.type || '?';
        if (e.type === '아이템' && typeof e.item_id === 'number') {
            const it = items.find(x => x.id === e.item_id);
            t = it ? it.name : '아이템#' + e.item_id;
        }
        let c = '';
        if (e.count && typeof e.count === 'object') c = e.count.min === e.count.max ? String(e.count.min) : e.count.min + '~' + e.count.max;
        else if (e.count) c = String(e.count);
        return t + (c ? ' x' + c : '');
    });
    return parts.join(', ') + (entries.length > 4 ? ' 외 ' + (entries.length - 4) + '개' : '');
}
async function pickPackList(refKey, onPick) {
    const [data, items] = await Promise.all([getPackRefData(refKey), getItems()]);
    const label = refKey === 'Bundle' ? '번들' : '팩';
    const list = (Array.isArray(data) ? data : []).map((entries, idx) => {
        const summary = packEntrySummary(entries, items);
        return { idx, summary, _search: '#' + idx + ' ' + summary };
    });
    openModal(label + ' 선택', list, r => el('div', null,
        el('div', null, el('span', { class: 'tag b' }, '#' + r.idx), label + ' #' + r.idx),
        el('div', { class: 'meta' }, r.summary)
    ), r => onPick(r.idx));
}
function packObjEditor(pack) {
    const PACK_OBJ_TYPES = ['캐릭터 카드팩', '전직 캐릭터 카드팩', '장비 상자', '보조 장비 상자', '펫'];
    const wrap = el('div', { class: 'entry', style: { flexWrap: 'wrap', flex: '1' } });
    const typeSel = el('select', { style: { width: '160px' } });
    PACK_OBJ_TYPES.forEach(t => typeSel.appendChild(el('option', { value: t }, t)));
    if (!PACK_OBJ_TYPES.includes(pack.type)) pack.type = PACK_OBJ_TYPES[0];
    typeSel.value = pack.type;
    const rest = el('span', { style: { display: 'flex', gap: '6px', alignItems: 'center', flex: '1', flexWrap: 'wrap' } });
    function paint() {
        rest.innerHTML = '';
        if (pack.type === '캐릭터 카드팩' || pack.type === '전직 캐릭터 카드팩') {
            delete pack.rarity;
            if (!pack.range || typeof pack.range !== 'object') pack.range = { min: 1, max: 1 };
            rest.appendChild(el('span', { class: 'lab' }, '별 범위'));
            rest.appendChild(el('input', { type: 'number', min: 1, max: 6, value: Number(pack.range.min || 1), style: { width: '70px', flex: '0 0 auto' }, oninput: e => pack.range.min = Number(e.target.value) || 1 }));
            rest.appendChild(el('span', { class: 'lab' }, '~'));
            rest.appendChild(el('input', { type: 'number', min: 1, max: 6, value: Number(pack.range.max || 1), style: { width: '70px', flex: '0 0 auto' }, oninput: e => pack.range.max = Number(e.target.value) || 1 }));
        } else {
            delete pack.range;
            const rarities = pack.type === '펫'
                ? ['일반', '레어', '에픽', '유니크', '레전더리', '신화', '고유']
                : ['일반', '고급', '희귀', '영웅', '전설', '초월', '신화'];
            rest.appendChild(el('span', { class: 'lab' }, '등급'));
            const rsel = el('select', { style: { width: '130px' } });
            rarities.forEach(r => rsel.appendChild(el('option', { value: r }, r)));
            if (pack.rarity && !rarities.includes(pack.rarity)) rsel.appendChild(el('option', { value: pack.rarity }, pack.rarity + ' (사용자 지정)'));
            rsel.value = pack.rarity || rarities[0];
            pack.rarity = rsel.value;
            rsel.onchange = () => pack.rarity = rsel.value;
            rest.appendChild(rsel);
        }
    }
    typeSel.onchange = () => { pack.type = typeSel.value; paint(); };
    paint();
    wrap.appendChild(el('span', { class: 'lab' }, '종류'));
    wrap.appendChild(typeSel);
    wrap.appendChild(rest);
    return wrap;
}
function itemPackEditor(item, itemType) {
    const wrap = el('div');
    const row = el('div', { class: 'row' });
    const refKey = itemType === '번들' ? 'Bundle' : 'Pack';
    const kindSel = el('select');
    [['none', '없음'], ['list', refKey === 'Bundle' ? '번들 선택' : '팩 선택'], ['obj', '카드팩 / 상자 / 펫']].forEach(([v, label]) => kindSel.appendChild(el('option', { value: v }, label)));
    kindSel.value = typeof item.pack === 'undefined' ? 'none' : (typeof item.pack === 'number' ? 'list' : 'obj');
    const target = el('div', { style: { flex: '2', minWidth: '220px', display: 'flex' } });
    function paint() {
        target.innerHTML = '';
        if (kindSel.value === 'none') { delete item.pack; return; }
        if (kindSel.value === 'list') {
            if (typeof item.pack !== 'number') delete item.pack;
            const btn = el('button', { class: 'pickbtn', type: 'button', style: { width: '100%' } });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof item.pack === 'number') {
                    const [data, items] = await Promise.all([getPackRefData(refKey), getItems()]);
                    const entries = Array.isArray(data) ? data[item.pack] : null;
                    btn.appendChild(document.createTextNode('#' + item.pack + ' ' + (entries ? packEntrySummary(entries, items) : '(없는 번호)')));
                } else btn.appendChild(el('span', { class: 'ph' }, refKey === 'Bundle' ? '번들 선택' : '팩 선택'));
            };
            btn.onclick = () => pickPackList(refKey, idx => { item.pack = idx; refresh(); });
            refresh();
            target.appendChild(btn);
            return;
        }
        if (!item.pack || typeof item.pack !== 'object') item.pack = { type: '캐릭터 카드팩', range: { min: 1, max: 1 } };
        target.appendChild(packObjEditor(item.pack));
    }
    kindSel.onchange = paint;
    paint();
    row.appendChild(el('div', { class: 'nf', style: { minWidth: '150px' } }, el('label', null, '지급 방식'), kindSel));
    row.appendChild(el('div', { style: { flex: '2' } }, el('label', null, '지급 대상'), target));
    if (itemType !== '번들') {
        row.appendChild(el('div', { class: 'nf' }, el('label', null, '추첨 횟수'),
            el('input', { type: 'number', min: 1, value: Number(item.num || 0) || '', placeholder: '기본 1', style: { width: '110px' }, oninput: e => { const v = Number(e.target.value); if (!v) delete item.num; else item.num = v; } })
        ));
    }
    wrap.appendChild(row);
    return wrap;
}
const ITEM_USE_KEYS = ['변환', '캐릭터변환', '만능캐릭터변환', '전직캐릭터변환', '전직프레스티지', '스탯초기화', '장신구선택권', '보조장비리롤', '잠재능력부여', '장비강화권', '영혼석', '보주', '보주선택', '가위', '생명수', '초월업그레이드', '초월선택', '아이템선택', '초월상자', '보주상자'];
function itemUseEditor(item) {
    const wrap = el('div');
    const row = el('div', { class: 'row' });
    const useSel = el('select');
    useSel.appendChild(el('option', { value: '' }, '없음'));
    ITEM_USE_KEYS.forEach(u => useSel.appendChild(el('option', { value: u }, u)));
    if (item.use && !ITEM_USE_KEYS.includes(item.use)) useSel.appendChild(el('option', { value: item.use }, item.use + ' (사용자 지정)'));
    useSel.value = item.use || '';
    row.appendChild(el('div', { class: 'nf', style: { minWidth: '180px' } }, el('label', null, '사용 기능'), useSel));
    wrap.appendChild(row);
    const auxWrap = el('div');
    function paintAux() {
        auxWrap.innerHTML = '';
        const u = item.use;
        if (u === '변환' || u === '캐릭터변환' || typeof item.charId !== 'undefined') {
            const entry = el('div', { class: 'entry', style: { marginTop: '6px' } });
            entry.appendChild(el('span', { class: 'lab' }, '대상 캐릭터'));
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof item.charId === 'number') {
                    const cards = await getCards();
                    const c = cards.find(x => x.id === item.charId);
                    btn.appendChild(document.createTextNode(c ? '#' + c.id + ' ' + c.name : '없는 카드 #' + item.charId));
                } else btn.appendChild(el('span', { class: 'ph' }, '캐릭터 카드 선택'));
            };
            btn.onclick = () => pickCard(c => { item.charId = c.id; refresh(); });
            refresh();
            entry.appendChild(btn);
            auxWrap.appendChild(entry);
        }
        if (u === '장신구선택권') {
            const rarities = ['일반', '고급', '희귀', '영웅', '전설', '초월', '신화'];
            const entry = el('div', { class: 'entry', style: { marginTop: '6px' } });
            entry.appendChild(el('span', { class: 'lab' }, '장신구 등급'));
            const rsel = el('select', { style: { width: '130px' } });
            rarities.forEach(r => rsel.appendChild(el('option', { value: r }, r)));
            if (item.rarity && !rarities.includes(item.rarity)) rsel.appendChild(el('option', { value: item.rarity }, item.rarity + ' (사용자 지정)'));
            rsel.value = item.rarity || rarities[0];
            item.rarity = rsel.value;
            rsel.onchange = () => item.rarity = rsel.value;
            entry.appendChild(rsel);
            auxWrap.appendChild(entry);
        }
        if (u === '장비강화권') {
            if (!item.ug || typeof item.ug !== 'object') item.ug = { level: 1, roll: 1 };
            const entry = el('div', { class: 'entry', style: { marginTop: '6px' } });
            entry.appendChild(el('span', { class: 'lab' }, '강화 레벨'));
            entry.appendChild(el('input', { type: 'number', min: 1, value: Number(item.ug.level || 1), style: { width: '90px', flex: '0 0 auto' }, oninput: e => item.ug.level = Math.max(1, Math.floor(Number(e.target.value) || 1)) }));
            entry.appendChild(el('span', { class: 'lab' }, '부여 횟수'));
            entry.appendChild(el('input', { type: 'number', min: 1, value: Number(item.ug.roll || 1), style: { width: '90px', flex: '0 0 auto' }, oninput: e => item.ug.roll = Math.max(1, Math.floor(Number(e.target.value) || 1)) }));
            auxWrap.appendChild(entry);
        }
        if (u === '영혼석') auxWrap.appendChild(soulEditor(item));
    }
    useSel.onchange = () => {
        const v = useSel.value;
        if (!v) delete item.use; else item.use = v;
        if (v !== '변환' && v !== '캐릭터변환') delete item.charId;
        if (v !== '장신구선택권') delete item.rarity;
        if (v !== '장비강화권') delete item.ug;
        if (v !== '영혼석') delete item.soul;
        paintAux();
    };
    paintAux();
    wrap.appendChild(auxWrap);
    return wrap;
}
function soulEditor(item) {
    if (!item.soul || typeof item.soul !== 'object') item.soul = { name: '', date: 0 };
    const soul = item.soul;
    const wrap = el('div', { class: 'card', style: { marginTop: '6px', padding: '10px 12px' } });
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', null, el('label', null, '영혼 이름'), el('input', { value: soul.name || '', oninput: e => soul.name = e.target.value })));
    row.appendChild(el('div', { class: 'nf' }, el('label', null, '지속 일수 (0 = 무제한)'), el('input', { type: 'number', min: 0, value: Number(soul.date || 0), style: { width: '140px' }, oninput: e => soul.date = Math.max(0, Number(e.target.value) || 0) })));
    wrap.appendChild(row);
    [['weapon', '무기'], ['armor', '갑옷']].forEach(([slot, label]) => {
        if (!soul[slot] || typeof soul[slot] !== 'object') soul[slot] = { stat: {}, plusStat: {} };
        if (!soul[slot].stat || typeof soul[slot].stat !== 'object') soul[slot].stat = {};
        if (!soul[slot].plusStat || typeof soul[slot].plusStat !== 'object') soul[slot].plusStat = {};
        const det = el('details', { class: 'collapsible' });
        det.appendChild(el('summary', null, label + ' 능력치'));
        const body = el('div', { class: 'body' });
        body.appendChild(statEditor('기본 능력치', null, soul[slot].stat, FLAT_STAT_DEFS));
        body.appendChild(statEditor('강화 능력치', null, soul[slot].plusStat, PLUS_STAT_DEFS));
        det.appendChild(body);
        wrap.appendChild(det);
    });
    return wrap;
}
const USE_FUNC_DEFS = [
    { key: '체력회복', amountLabel: '회복량', pct: false, duration: false },
    { key: '마나회복', amountLabel: '회복량', pct: false, duration: false },
    { key: '체력회복%', amountLabel: '최대 체력 대비 %', pct: true, duration: false },
    { key: '마나회복%', amountLabel: '최대 MP 대비 %', pct: true, duration: false },
    { key: '경험치획득', amountLabel: '경험치', pct: false, duration: false },
    { key: '경험치비약', amountLabel: '증가율 %', pct: true, duration: true },
    { key: '골드비약', amountLabel: '증가율 %', pct: true, duration: true }
];
function useFuncEditor(item) {
    const wrap = el('div', { style: { marginTop: '8px' } });
    wrap.appendChild(el('label', null, '소모품 효과'));
    const list = el('div', { class: 'entry-list' });
    function paint() {
        list.innerHTML = '';
        (item.use_func || []).forEach((func, i) => {
            const def = USE_FUNC_DEFS.find(d => d.key === func.type) || USE_FUNC_DEFS[0];
            const entry = el('div', { class: 'entry' });
            const tsel = el('select', { style: { width: '130px' } });
            USE_FUNC_DEFS.forEach(d => tsel.appendChild(el('option', { value: d.key }, d.key)));
            if (func.type && !USE_FUNC_DEFS.some(d => d.key === func.type)) tsel.appendChild(el('option', { value: func.type }, func.type + ' (사용자 지정)'));
            tsel.value = func.type || USE_FUNC_DEFS[0].key;
            tsel.onchange = () => { func.type = tsel.value; if (!USE_FUNC_DEFS.find(d => d.key === func.type && d.duration)) delete func.duration; paint(); };
            entry.appendChild(tsel);
            entry.appendChild(el('span', { class: 'lab' }, def.amountLabel));
            entry.appendChild(el('input', { type: 'number', step: def.pct ? 0.1 : 1, value: def.pct ? statValueToInputValue('percent', func.amount) : Number(func.amount || 0), style: { width: '110px', flex: '0 0 auto' }, oninput: e => {
                func.amount = def.pct ? (statInputValueToRaw('percent', e.target.value) || 0) : Number(e.target.value) || 0;
            } }));
            if (def.duration) {
                entry.appendChild(el('span', { class: 'lab' }, '지속 (분)'));
                entry.appendChild(el('input', { type: 'number', min: 1, value: Math.round(Number(func.duration || 0) / 60000) || '', placeholder: '30', style: { width: '90px', flex: '0 0 auto' }, oninput: e => func.duration = Math.max(0, Math.floor(Number(e.target.value) || 0)) * 60000 }));
            }
            entry.appendChild(el('button', { class: 'btn icon danger', type: 'button', onclick: () => { item.use_func.splice(i, 1); if (item.use_func.length === 0) delete item.use_func; paint(); } }, '✕'));
            list.appendChild(entry);
        });
    }
    paint();
    wrap.appendChild(list);
    wrap.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => {
        if (!Array.isArray(item.use_func)) item.use_func = [];
        item.use_func.push({ type: '체력회복', amount: 0 });
        paint();
    } }, '+ 효과 추가'));
    return wrap;
}
function requireEditor(item) {
    const wrap = el('div', { style: { marginTop: '8px' } });
    wrap.appendChild(el('label', null, '사용 조건 (함께 소모되는 아이템)'));
    const list = el('div', { class: 'entry-list' });
    function paint() {
        list.innerHTML = '';
        (item.require || []).forEach((r, i) => {
            const entry = el('div', { class: 'entry' });
            const btn = el('button', { class: 'pickbtn', type: 'button' });
            const refresh = async () => {
                btn.innerHTML = '';
                if (typeof r.id === 'number') {
                    const items = await getItems();
                    const it = items.find(x => x.id === r.id);
                    btn.appendChild(document.createTextNode(it ? '#' + it.id + ' ' + it.name : '없는 아이템 #' + r.id));
                } else btn.appendChild(el('span', { class: 'ph' }, '아이템 선택'));
            };
            btn.onclick = () => pickItem(it => { r.id = it.id; refresh(); });
            refresh();
            entry.appendChild(btn);
            entry.appendChild(el('span', { class: 'lab' }, '수량'));
            entry.appendChild(el('input', { type: 'number', min: 1, value: Number(r.count || 1), style: { width: '90px', flex: '0 0 auto' }, oninput: e => r.count = Math.max(1, Math.floor(Number(e.target.value) || 1)) }));
            entry.appendChild(el('button', { class: 'btn icon danger', type: 'button', onclick: () => { item.require.splice(i, 1); if (item.require.length === 0) delete item.require; paint(); } }, '✕'));
            list.appendChild(entry);
        });
    }
    paint();
    wrap.appendChild(list);
    wrap.appendChild(el('button', { class: 'add-btn', type: 'button', onclick: () => {
        if (!Array.isArray(item.require)) item.require = [];
        item.require.push({ count: 1 });
        paint();
    } }, '+ 조건 아이템 추가'));
    return wrap;
}
function protectEditor(item) {
    const wrap = el('div', { class: 'entry', style: { marginTop: '8px' } });
    wrap.appendChild(el('span', { class: 'lab' }, '카드 보호권 성급 (비우면 보호권 아님)'));
    wrap.appendChild(el('input', { type: 'number', min: 1, max: 6, value: item.protect ? Number(item.protect.star || '') : '', style: { width: '90px', flex: '0 0 auto' }, oninput: e => {
        const v = Math.floor(Number(e.target.value));
        if (!v) delete item.protect; else item.protect = { star: v };
    } }));
    return wrap;
}
