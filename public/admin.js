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
const LOOKUP = { items: null, equipment: null };
async function getItems() { if (!LOOKUP.items) LOOKUP.items = await api('/api/lookup/items'); return LOOKUP.items; }
async function getEquipment() { if (!LOOKUP.equipment) LOOKUP.equipment = await api('/api/lookup/equipment'); return LOOKUP.equipment; }

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

const REWARD_TYPES = ['아이템', '무기', '갑옷', '장신구', '골드', '가넷', '마일리지', '경험치'];
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
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; delete entry.weapon_id; delete entry.armor_id; delete entry.accessory_id; refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
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
            btn.onclick = () => pickEquipment(slot, e => { entry[idKey] = e.id; ['item_id', 'weapon_id', 'armor_id', 'accessory_id'].forEach(k => k !== idKey && delete entry[k]); refresh(); onChange && onChange(); });
            refresh();
            targetSlot.appendChild(btn);
        } else {
            // 골드/가넷/마일리지/경험치 — target 없음
            ['item_id', 'weapon_id', 'armor_id', 'accessory_id'].forEach(k => delete entry[k]);
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
        card.appendChild(el('div', { class: 'card-head' },
            el('div', { class: 'card-title' }, '쿠폰 #' + idx),
            el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('이 쿠폰을 삭제합니까?')) { couponData.splice(idx, 1); renderCoupon(); } } }, '삭제')
        ));
        const grid = el('div', { class: 'split' });
        grid.appendChild(el('div', null, el('label', null, '코드'), codeIn));
        grid.appendChild(el('div', null, el('label', null, '만료일 (ISO 8601)'), expIn));
        card.appendChild(grid);
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
    ['아이템', '가넷', '골드', '마일리지'].forEach(t => sel.appendChild(el('option', { value: t }, t)));
    if (!['아이템', '가넷', '골드', '마일리지'].includes(entry.type)) entry.type = '아이템';
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
            btn.onclick = () => pickItem(it => { entry.item_id = it.id; refresh(); });
            refresh(); target.appendChild(btn);
        } else { delete entry.item_id; target.appendChild(el('span', { class: 'muted', style: { padding: '6px 4px' } }, '(' + entry.type + ' 지급)')); }
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

    wrap.appendChild(head); wrap.appendChild(priceRow);
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
