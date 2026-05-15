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
const api = async url => {
    const r = await fetch(url);
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || ('HTTP ' + r.status));
    return x;
};
const comma = n => Number(n || 0).toLocaleString('ko-KR');
const ratio = (value, max) => Math.max(0, Math.min(100, max > 0 ? (Number(value || 0) / Number(max || 0)) * 100 : 0));

$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
if ($('#adminLink')) $('#adminLink').onclick = () => location.href = '/admin';
$$('.nav-btn').forEach(btn => btn.onclick = () => {
    $$('.nav-btn').forEach(item => item.classList.toggle('active', item === btn));
    $$('.page').forEach(page => page.classList.toggle('active', page.dataset.page === btn.dataset.page));
    if (btn.dataset.page === 'inventory' && !btn.dataset.loaded) {
        btn.dataset.loaded = '1';
        loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
    }
    if (btn.dataset.page === 'auction') loadAuctions();
});

function cardNode(card, compact, onClick) {
    if (!card || !card.name) return el('div', { class: 'empty-card' }, '카드 없음');
    const props = { class: 'card-tile ' + (compact ? 'compact' : '') };
    if (typeof onClick === 'function') props.onclick = () => onClick(card);
    return el('div', props,
        card.imageUrl ? el('img', { src: card.imageUrl, alt: card.formatted }) : el('div', { class: 'no-img' }, card.name),
        el('div', { class: 'card-name' }, card.formatted)
    );
}

function kv(label, value) {
    return el('div', { class: 'kv' }, el('span', null, label), el('b', null, value));
}

function textLines(text) {
    return String(text || '').split('\n').filter(line => line && line.indexOf('\u200e') === -1);
}

const RARITY_COLORS = { '일반': '#64748b', '고급': '#16a34a', '희귀': '#2563eb', '영웅': '#9333ea', '전설': '#f59e0b', '신화': '#ef4444', '고유': '#ec4899' };
const SLOT_ICONS = { 'weapon': '⚔️', 'armor': '🛡️', 'accessory': '💍' };
const ITEM_TYPE_ORDER = ['이벤트', '가챠', '번들', '마법석', '소모품', '티켓', '재료'];
const EQUIP_TYPE_ORDER = [['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구']];

function equipmentCard(eq) {
    const color = RARITY_COLORS[eq.rarity] || '#334155';
    const icon = SLOT_ICONS[eq.type] || '🎒';
    const card = el('div', { class: 'equip-card', onclick: () => openEquipmentModal(eq) },
        el('div', { class: 'slot-icon' }, icon),
        el('div', null,
            el('div', { class: 'equip-name' }, eq.name),
            el('div', { class: 'equip-meta' },
                el('span', { class: 'tag rarity' }, eq.rarity),
                eq.equipped ? el('span', { class: 'tag on' }, '장착') : null
            )
        ),
        eq.level > 0 ? el('span', { class: 'level' }, '+' + eq.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    return card;
}

function openModal(title, sub, lines) {
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub || '';
    $('#modalSub').style.display = sub ? '' : 'none';
    $('#modalBody').replaceChildren(...(lines.length ? lines.map(line => el('div', { class: 'stat-line' }, line)) : [el('div', { class: 'empty' }, '표시할 정보가 없습니다.')]));
    $('#modalBg').classList.add('active');
}

function closeModal() { $('#modalBg').classList.remove('active'); }

function openCardSlotModal(card) {
    const eff = card.slotEffect;
    if (!eff) return openModal(card.formatted, card.starText + ' · 슬롯 효과 없음', []);
    const lines = [];
    if (eff.active) {
        lines.push('◆ ' + eff.name + ' ' + eff.currentText + ' (현재 ' + eff.currentStarText + ')');
    } else {
        lines.push('⚠️ ' + eff.requireStarText + ' 이상부터 효과 적용');
        lines.push('◆ ' + eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)');
    }
    if (Number(eff.perLevelText.replace(/[^0-9.]/g, '')) > 0) lines.push(' ㄴ 이후 등급마다 +' + eff.perLevelText);
    openModal(card.formatted, '카드 슬롯 효과', lines);
}

function openEquipmentModal(eq) {
    const title = eq.name + (eq.level > 0 ? ' +' + eq.level : '');
    const sub = eq.rarity + ' · ' + eq.typeLabel;
    const lines = (eq.statLines || []).map(line => line.replace(/^-\s*/, ''));
    openModal(title, sub, lines);
}

function categorySection(title, children) {
    return el('div', { class: 'cat' }, el('div', { class: 'cat-title' }, title), ...children);
}

function renderProfile(data) {
    $('#who').textContent = data.user.name;
    $('#profileName').textContent = data.user.name;
    $('#level').textContent = 'Lv. ' + comma(data.user.level);
    $('#exp').textContent = '(' + comma(data.user.exp) + '/' + comma(data.user.maxExp) + ')';
    $('#hp').textContent = comma(data.user.hp) + ' / ' + comma(data.user.maxHp);
    $('#hpFill').style.width = ratio(data.user.hp, data.user.maxHp) + '%';
    $('#mp').textContent = comma(data.user.mp) + ' / ' + comma(data.user.maxMp);
    $('#mpFill').style.width = ratio(data.user.mp, data.user.maxMp) + '%';
    $('#totalPower').textContent = comma(data.combatPower.total);
    $('#goods').replaceChildren(
        kv('🪙 골드', comma(data.user.gold)),
        kv('💠 가넷', comma(data.user.garnet)),
        kv('💰 포인트', comma(data.user.point)),
        kv('Ⓜ️ 마일리지', comma(data.user.mileage))
    );
    $('#stats').replaceChildren(
        kv('공격력', comma(data.stats.atk)),
        kv('방어력', comma(data.stats.def)),
        kv('방어 관통력', comma(data.stats.pnt)),
        kv('치명타 확률', data.stats.critText),
        kv('치명타 피해량', data.stats.critMulText)
    );
    $('#mainCard').replaceChildren(cardNode(data.mainCard));
    $('#slotCards').replaceChildren(...data.cardSlots.map(card => cardNode(card, true, openCardSlotModal)));
    $('#equippedGear').replaceChildren(...(data.equippedEquipment.length ? data.equippedEquipment.map(equipmentCard) : [el('div', { class: 'empty' }, '장착 중인 장비가 없습니다.')]));
    if (data.user.isAdmin) $('#adminLink').style.display = '';
}

function itemRow(item) {
    return el('div', { class: 'inv-row' },
        el('b', null, item.name),
        el('strong', null, 'x' + comma(item.count))
    );
}

async function loadInventory(kind) {
    $('#viewer').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    const data = await api('/api/inventory/' + kind);
    if (kind === 'items') {
        $('#viewerTitle').textContent = '인벤토리';
        const sections = [];
        ITEM_TYPE_ORDER.forEach(type => {
            const filtered = data.items.filter(item => item.type === type).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
            if (filtered.length) sections.push(categorySection('《 ' + type + ' 》', filtered.map(itemRow)));
        });
        $('#viewer').replaceChildren(...(sections.length ? sections : [el('div', { class: 'empty' }, '보유 아이템이 없습니다.')]));
    }
    if (kind === 'cards') {
        $('#viewerTitle').textContent = '보유 캐릭터 카드';
        $('#viewer').replaceChildren(data.cards.length ? el('div', { class: 'card-grid' }, data.cards.map(card => cardNode(card, true))) : el('div', { class: 'empty' }, '보유 카드가 없습니다.'));
    }
    if (kind === 'equipment') {
        $('#viewerTitle').textContent = '보유 장비';
        const sections = [];
        EQUIP_TYPE_ORDER.forEach(([type, label]) => {
            const filtered = data.equipment.filter(eq => eq.type === type);
            if (filtered.length) sections.push(categorySection('《 ' + label + ' 》', [el('div', { class: 'equip-grid' }, filtered.map(equipmentCard))]));
        });
        $('#viewer').replaceChildren(...(sections.length ? sections : [el('div', { class: 'empty' }, '보유 장비가 없습니다.')]));
    }
}

$$('.view-btn').forEach(btn => btn.onclick = () => loadInventory(btn.dataset.kind).catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message))));

// ===== 경매장 =====

const AUCTION_KIND_ICON = { 'card': '🃏', 'equipment': '⚔️', 'item': '📦' };
const AUCTION_KIND_LABEL = { 'card': '카드', 'equipment': '장비', 'item': '아이템' };
let auctionState = { all: [], filter: 'all', me: null };

function currencyText(currency, amount) {
    return (currency === 'gold' ? '🪙 ' : '💠 ') + comma(amount);
}

function auctionCardEl(entry) {
    const d = entry.display;
    const thumb = d.imageUrl
        ? el('img', { src: d.imageUrl, alt: d.name })
        : el('span', null, AUCTION_KIND_ICON[entry.kind] || '📦');
    const priceText = entry.kind === 'item'
        ? currencyText(entry.currency, entry.unitPrice) + ' / 1개'
        : currencyText(entry.currency, entry.unitPrice);
    const node = el('div', { class: 'auc-card' + (entry.mine ? ' mine' : ''), onclick: () => openAuctionDetail(entry) },
        el('div', { class: 'auc-thumb' + (entry.kind === 'card' ? ' card' : '') }, thumb),
        el('div', { class: 'auc-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : '')),
        d.sub ? el('div', { class: 'auc-sub' }, d.sub + (entry.kind === 'equipment' && d.level > 0 ? ' · +' + d.level : '')) : null,
        el('div', { class: 'auc-price' }, priceText),
        el('div', { class: 'auc-seller' }, '판매자: ' + entry.sellerName + (entry.ticketCost > 0 ? ' · 거래권 ' + entry.ticketCost + '장' : ''))
    );
    if (entry.mine) node.appendChild(el('span', { class: 'auc-mine-badge' }, '내 경매'));
    return node;
}

function renderAuctionList() {
    const filter = auctionState.filter;
    const filtered = auctionState.all.filter(entry => {
        if (filter === 'all') return true;
        if (filter === 'mine') return entry.mine;
        return entry.kind === filter;
    }).sort((a, b) => b.createdAt - a.createdAt);
    if (filtered.length === 0) {
        $('#auctionList').replaceChildren(el('div', { class: 'empty' }, '등록된 경매가 없습니다.'));
        return;
    }
    $('#auctionList').replaceChildren(...filtered.map(auctionCardEl));
}

async function loadAuctions() {
    $('#auctionList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/auction');
        auctionState.all = data.items || [];
        renderAuctionList();
    } catch (e) {
        $('#auctionList').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

$$('#aucFilter button').forEach(btn => btn.onclick = () => {
    $$('#aucFilter button').forEach(b => b.classList.toggle('on', b === btn));
    auctionState.filter = btn.dataset.filter;
    renderAuctionList();
});

function showDetail(content) {
    $('#aucDetail').replaceChildren(...content);
    $('#aucDetailBg').classList.add('active');
}
function closeDetail() { $('#aucDetailBg').classList.remove('active'); }

function openAuctionDetail(entry) {
    const d = entry.display;
    const content = [
        el('h3', null, d.name + (entry.count > 1 ? ' (재고 ' + comma(entry.count) + ')' : '')),
        el('div', { class: 'sub' }, AUCTION_KIND_LABEL[entry.kind] + (d.sub ? ' · ' + d.sub : '') + (entry.kind === 'equipment' && d.level > 0 ? ' · +' + d.level : ''))
    ];
    if (d.imageUrl) content.push(el('div', { class: 'auc-thumb', style: { aspectRatio: '3/4', maxWidth: '180px', margin: '0 auto 12px' } }, el('img', { src: d.imageUrl, alt: d.name })));
    if (d.statLines && d.statLines.length) d.statLines.forEach(line => content.push(el('div', { class: 'stat-line' }, line)));
    content.push(el('div', { class: 'stat-line' }, '판매자: ' + entry.sellerName));
    content.push(el('div', { class: 'stat-line' }, (entry.kind === 'item' ? '개당 가격: ' : '가격: ') + currencyText(entry.currency, entry.unitPrice)));
    if (entry.ticketCost > 0) content.push(el('div', { class: 'stat-line' }, '⚠️ 구매 시 거래권 ' + entry.ticketCost + '장이 소모됩니다.'));

    if (entry.mine) {
        content.push(el('div', { class: 'stat-line' }, '취소 시 등록한 자산이 그대로 반환됩니다.'));
        const cancelBtn = el('button', { class: 'danger close', onclick: async () => {
            cancelBtn.disabled = true;
            try {
                const r = await fetch('/api/auction/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '취소 실패');
                closeDetail();
                await loadAuctions();
            } catch (e) {
                alert(e.message);
                cancelBtn.disabled = false;
            }
        } }, '경매 취소');
        content.push(cancelBtn);
    } else {
        let buyCountInput = null;
        const totalLine = el('div', { class: 'stat-line', style: { color: '#fbbf24', fontWeight: '800' } }, '총 결제: ' + currencyText(entry.currency, entry.unitPrice));
        const updateTotal = (count) => {
            const total = entry.unitPrice * count;
            const fee = Math.floor(total * 0.05);
            totalLine.textContent = '총 결제: ' + currencyText(entry.currency, total) + '  /  판매자 입금: ' + currencyText(entry.currency, total - fee);
        };
        if (entry.kind === 'item') {
            content.push(el('label', null, '구매 갯수 (재고 ' + comma(entry.count) + ')'));
            buyCountInput = el('input', { type: 'number', value: 1, min: 1, max: entry.count });
            buyCountInput.oninput = () => {
                let v = Math.floor(Number(buyCountInput.value || 1));
                if (!Number.isInteger(v) || v < 1) v = 1;
                if (v > entry.count) v = entry.count;
                buyCountInput.value = v;
                updateTotal(v);
            };
            content.push(buyCountInput);
            updateTotal(1);
        } else {
            updateTotal(1);
        }
        content.push(totalLine);
        const buyBtn = el('button', { class: 'primary close', onclick: async () => {
            const count = buyCountInput ? Math.floor(Number(buyCountInput.value || 1)) : 1;
            const total = entry.unitPrice * count;
            const label = entry.kind === 'item' ? (d.name + ' x' + comma(count)) : d.name;
            if (!confirm(label + ' 을(를) ' + currencyText(entry.currency, total) + ' 에 구매하시겠습니까?')) return;
            buyBtn.disabled = true;
            try {
                const body = { id: entry.id };
                if (entry.kind === 'item') body.count = count;
                const r = await fetch('/api/auction/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '구매 실패');
                closeDetail();
                await loadAuctions();
                api('/api/profile').then(renderProfile).catch(() => {});
            } catch (e) {
                alert(e.message);
                buyBtn.disabled = false;
            }
        } }, '구매하기');
        content.push(buyBtn);
    }
    const closeBtn = el('button', { onclick: closeDetail, style: { marginTop: '8px', width: '100%' } }, '닫기');
    content.push(closeBtn);
    showDetail(content);
}

// ===== 경매 등록 =====

let regState = { kind: 'card', selectedIndex: -1, selectedItemId: -1, sellable: null };

async function openRegisterModal() {
    regState = { kind: 'card', selectedIndex: -1, selectedItemId: -1, sellable: null };
    $('#aucReg').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#aucRegBg').classList.add('active');
    try {
        const data = await api('/api/auction/sellable');
        regState.sellable = data;
        renderRegisterModal();
    } catch (e) {
        $('#aucReg').replaceChildren(el('div', { class: 'empty err' }, e.message), el('button', { class: 'close', onclick: closeRegister }, '닫기'));
    }
}
function closeRegister() { $('#aucRegBg').classList.remove('active'); }

function renderRegisterModal() {
    const data = regState.sellable;
    const kindSeg = el('div', { class: 'seg' },
        ...['card', 'equipment', 'item'].map(k => el('button', {
            class: regState.kind === k ? 'on' : '',
            onclick: () => { regState.kind = k; regState.selectedIndex = -1; regState.selectedItemId = -1; renderRegisterModal(); }
        }, AUCTION_KIND_LABEL[k]))
    );

    let pickList;
    if (regState.kind === 'card') {
        pickList = data.cards.length === 0
            ? el('div', { class: 'empty' }, '판매 가능한 카드가 없습니다.\n(인벤토리 보유 카드만 등록 가능)')
            : el('div', { class: 'pick-list' }, ...data.cards.map(card => el('div', {
                class: 'pick-row' + (regState.selectedIndex === card.index ? ' on' : ''),
                onclick: () => { regState.selectedIndex = card.index; renderRegisterModal(); }
            },
                el('div', null, el('b', null, card.formatted), el('div', { class: 'meta' }, card.starText)),
                card.imageUrl ? el('img', { src: card.imageUrl, style: { width: '32px', height: '42px', objectFit: 'cover', borderRadius: '4px' } }) : null
            )));
    } else if (regState.kind === 'equipment') {
        pickList = data.equipment.length === 0
            ? el('div', { class: 'empty' }, '판매 가능한 장비가 없습니다.\n(인벤토리 미장착 장비만 등록 가능)')
            : el('div', { class: 'pick-list' }, ...data.equipment.map(eq => el('div', {
                class: 'pick-row' + (regState.selectedIndex === eq.index ? ' on' : ''),
                onclick: () => { regState.selectedIndex = eq.index; renderRegisterModal(); }
            },
                el('div', null, el('b', null, eq.name + (eq.level > 0 ? ' +' + eq.level : '')), el('div', { class: 'meta' }, eq.rarity + ' · ' + eq.typeLabel))
            )));
    } else {
        pickList = data.items.length === 0
            ? el('div', { class: 'empty' }, '판매 가능한 아이템이 없습니다.')
            : el('div', { class: 'pick-list' }, ...data.items.map(item => el('div', {
                class: 'pick-row' + (regState.selectedItemId === item.id ? ' on' : ''),
                onclick: () => { regState.selectedItemId = item.id; renderRegisterModal(); }
            },
                el('div', null, el('b', null, item.name), el('div', { class: 'meta' }, item.type)),
                el('strong', null, '보유 ' + comma(item.count))
            )));
    }

    const itemSelected = regState.kind === 'item' ? data.items.find(i => i.id === regState.selectedItemId) : null;
    const countInput = regState.kind === 'item' ? el('input', { type: 'number', id: 'regCount', value: 1, min: 1, max: itemSelected ? itemSelected.count : 1 }) : null;
    const currencySelect = el('select', { id: 'regCurrency' },
        el('option', { value: 'gold' }, '🪙 골드'),
        el('option', { value: 'garnet' }, '💠 가넷')
    );
    const priceInput = el('input', { type: 'number', id: 'regPrice', placeholder: '예: 10000', min: 1 });

    const submitBtn = el('button', { class: 'primary', style: { flex: '2' }, onclick: submitRegister }, '등록');
    const cancelBtn = el('button', { onclick: closeRegister }, '취소');

    const content = [
        el('h3', null, '경매 등록'),
        el('div', { class: 'sub' }, '수수료 5%를 제외하고 판매자에게 입금됩니다.'),
        el('label', null, '종류'),
        kindSeg,
        el('label', null, '판매할 ' + AUCTION_KIND_LABEL[regState.kind]),
        pickList
    ];
    if (regState.kind === 'item' && itemSelected) {
        content.push(el('label', null, '갯수 (보유 ' + comma(itemSelected.count) + ')'));
        content.push(countInput);
    }
    content.push(el('label', null, '화폐'));
    content.push(currencySelect);
    content.push(el('label', null, regState.kind === 'item' ? '개당 가격' : '가격'));
    content.push(priceInput);
    content.push(el('div', { class: 'row' }, cancelBtn, submitBtn));

    $('#aucReg').replaceChildren(...content);
}

async function submitRegister() {
    const kind = regState.kind;
    const currency = $('#regCurrency').value;
    const price = Number($('#regPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) return alert('가격은 1 이상의 정수여야 합니다.');
    const body = { kind, currency, price };
    if (kind === 'card' || kind === 'equipment') {
        if (regState.selectedIndex < 0) return alert(AUCTION_KIND_LABEL[kind] + '를 선택해주세요.');
        body.index = regState.selectedIndex;
    } else {
        if (regState.selectedItemId < 0) return alert('아이템을 선택해주세요.');
        const count = Number($('#regCount').value || 0);
        if (!Number.isInteger(count) || count < 1) return alert('갯수는 1 이상의 정수여야 합니다.');
        body.itemId = regState.selectedItemId;
        body.count = count;
    }
    try {
        const r = await fetch('/api/auction/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.error || '등록 실패');
        closeRegister();
        await loadAuctions();
        api('/api/profile').then(renderProfile).catch(() => {});
    } catch (e) {
        alert(e.message);
    }
}

$('#aucNew').onclick = openRegisterModal;

// ===== 모달 닫기 핸들러 =====

$('#modalClose').onclick = closeModal;
$('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
$('#aucDetailBg').onclick = e => { if (e.target.id === 'aucDetailBg') closeDetail(); };
$('#aucRegBg').onclick = e => { if (e.target.id === 'aucRegBg') closeRegister(); };
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeModal();
        closeDetail();
        closeRegister();
    }
});

api('/api/profile').then(renderProfile).catch(e => {
    $('#app').replaceChildren(el('section', { class: 'panel' }, el('h2', null, '오류'), el('p', { class: 'err' }, e.message)));
});
