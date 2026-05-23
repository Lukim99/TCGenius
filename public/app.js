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
const postApi = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || ('HTTP ' + r.status));
    return x;
};
const KOREAN_BIG_UNITS = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극'];
const comma = value => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n);
    if (abs < 1_000_000_000) return n.toLocaleString('ko-KR');
    const sign = n < 0 ? '-' : '';
    const groups = [];
    let remaining = Math.trunc(abs);
    while (remaining > 0) {
        groups.push(remaining % 10000);
        remaining = Math.floor(remaining / 10000);
    }
    let topIndex = groups.length - 1;
    while (topIndex > 0 && groups[topIndex] === 0) topIndex--;
    const parts = [String(groups[topIndex]) + KOREAN_BIG_UNITS[topIndex]];
    if (topIndex > 0 && groups[topIndex - 1] > 0) parts.push(String(groups[topIndex - 1]) + KOREAN_BIG_UNITS[topIndex - 1]);
    return sign + parts.join(' ');
};
const ratio = (value, max) => Math.max(0, Math.min(100, max > 0 ? (Number(value || 0) / Number(max || 0)) * 100 : 0));

$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
if ($('#adminLink')) $('#adminLink').onclick = () => location.href = '/admin';
function activatePage(name) {
    $$('.nav-btn').forEach(item => item.classList.toggle('active', item.dataset.page === name));
    $$('.page').forEach(page => page.classList.toggle('active', page.dataset.page === name));
}
$$('.nav-btn').forEach(btn => btn.onclick = () => {
    activatePage(btn.dataset.page);
    if (btn.dataset.page === 'info') {
        if (currentProfileName && myName && currentProfileName !== myName) loadProfile(myName).catch(e => alert(e.message));
    }
    if (btn.dataset.page === 'inventory' && !btn.dataset.loaded) {
        btn.dataset.loaded = '1';
        loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
    }
    if (btn.dataset.page === 'auction') loadAuctions();
    if (btn.dataset.page === 'buyorder') loadBuyOrders();
    if (btn.dataset.page === 'ranking') loadRanking();
    if (btn.dataset.page === 'dex') loadDex();
    if (btn.dataset.page === 'patchnotes') loadPatchnotes();
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

const RARITY_COLORS = { '일반': '#64748b', '고급': '#64748b', '레어': '#86efac', '희귀': '#86efac', '유니크': '#a855f7', '영웅': '#a855f7', '레전더리': '#facc15', '전설': '#facc15', '신화': '#ef4444', '고유': '#ec4899' };
const SLOT_ICONS = { 'weapon': '⚔️', 'armor': '🛡️', 'accessory': '💍', 'support': '🔧' };
const ITEM_TYPE_ORDER = ['이벤트', '가챠', '번들', '사용', '소모품', '티켓', '재료'];
const EQUIP_TYPE_ORDER = [['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구'], ['support', '보조']];

function equipmentThumb(eq) {
    const wrap = el('div', { class: 'equip-thumb' });
    if (eq.frameUrl) wrap.appendChild(el('img', { src: eq.frameUrl, class: 'frame', alt: '' }));
    if (eq.iconUrl) wrap.appendChild(el('img', { src: eq.iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, SLOT_ICONS[eq.type] || '🎒'));
    return wrap;
}

function equipmentCard(eq) {
    const color = RARITY_COLORS[eq.rarity] || '#334155';
    const card = el('div', { class: 'equip-card', onclick: () => openEquipmentModal(eq) },
        equipmentThumb(eq),
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

function openMainCardModal(card) {
    const lines = [];
    if (card && Array.isArray(card.skills) && card.skills.length > 0) {
        card.skills.forEach(skill => {
            lines.push('◆ ' + skill.name + ' [ MP ' + comma(skill.mpCost) + ' ] 쿨타임 ' + skill.cooltimeText);
            (skill.descLines || []).forEach(desc => lines.push(' ㄴ ' + desc));
        });
    }
    openModal(card && card.formatted ? card.formatted : '메인 캐릭터 카드', card && card.starText ? card.starText + ' · 스킬 정보' : '스킬 정보', lines);
}

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

const POTENTIAL_TIER_COLORS = { rare: '#ffffff', epic: '#86efac', unique: '#c084fc', legendary: '#fbbf24' };

function potentialBlockNode(display) {
    if (!display || !Array.isArray(display.entries) || display.entries.length == 0) return null;
    const color = POTENTIAL_TIER_COLORS[display.tierKey] || '#94a3b8';
    const block = el('div', { class: 'pot-block' },
        el('div', { class: 'pot-title' },
            el('span', null, '잠재능력'),
            el('span', { class: 'pot-tier-label' }, display.tierLabel || '')
        ),
        ...display.entries.map(entry => el('div', { class: 'pot-row' },
            el('span', { class: 'pot-grade ' + (entry.grade || 'bronze') }, entry.gradeLabel || ''),
            el('span', { class: 'pot-text' }, entry.text || '')
        ))
    );
    block.style.setProperty('--pot-tier', color);
    return block;
}

function openEquipmentModal(eq) {
    const title = eq.name + (eq.level > 0 ? ' +' + eq.level : '');
    const sub = eq.rarity + ' · ' + eq.typeLabel;
    const lines = (eq.statLines || []).map(line => line.replace(/^-\s*/, ''));
    openModal(title, sub, lines);
    const thumb = equipmentThumb(eq);
    thumb.classList.add('modal-equip-thumb');
    $('#modalBody').prepend(thumb);
    const potBlock = potentialBlockNode(eq.potentialDisplay);
    if (potBlock) $('#modalBody').appendChild(potBlock);
}

function categorySection(title, children) {
    return el('div', { class: 'cat' }, el('div', { class: 'cat-title' }, title), ...children);
}

let myName = null;
let currentProfileName = null;

function renderProfile(data) {
    currentProfileName = data.user.name;
    if (myName == null) myName = data.user.name;
    const banner = $('#profileBanner');
    if (banner) {
        const isOther = data.user.name !== myName;
        banner.style.display = isOther ? 'flex' : 'none';
        if (isOther) $('#profileBannerText').textContent = data.user.name + '님의 정보를 보고 있습니다';
    }
    $('#who').textContent = myName;
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
    $('#mainCard').replaceChildren(cardNode(data.mainCard, false, openMainCardModal));
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
let auctionState = { all: [], filter: 'all', me: null, query: '' };

function currencyText(currency, amount) {
    return (currency === 'gold' ? '🪙 ' : '💠 ') + comma(amount);
}

function currencyInline(currency, amount) {
    const icon = currency === 'gold'
        ? '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png')
        : '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png');
    return [el('img', { class: 'currency-img', src: icon, alt: currency === 'gold' ? '골드' : '가넷' }), comma(amount)];
}

function currencyNode(currency, amount, suffix) {
    return el('span', null, ...currencyInline(currency, amount), suffix || '');
}

function auctionThumbEl(entry, options) {
    const d = entry.display || {};
    const style = options && options.style ? options.style : null;
    if (d.imageUrl) return el('div', { class: 'auc-thumb card', style }, el('img', { src: d.imageUrl, alt: d.name }));
    const foreground = d.iconUrl
        ? el('img', { class: 'auc-item-img', src: d.iconUrl, alt: d.name })
        : el('span', { class: 'auc-icon' }, AUCTION_KIND_ICON[entry.kind] || '📦');
    if (d.frameUrl) return el('div', { class: 'auc-thumb square', style },
        el('img', { class: 'auc-frame', src: d.frameUrl, alt: '' }),
        foreground
    );
    return el('div', { class: 'auc-thumb square', style }, foreground);
}

function auctionCardEl(entry) {
    const d = entry.display;
    const node = el('div', { class: 'auc-card' + (entry.mine ? ' mine' : ''), onclick: () => openAuctionDetail(entry) },
        auctionThumbEl(entry),
        el('div', { class: 'auc-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : '')),
        d.sub ? el('div', { class: 'auc-sub' }, d.sub + (entry.kind === 'equipment' && d.level > 0 ? ' · +' + d.level : '')) : null,
        el('div', { class: 'auc-price' }, currencyNode(entry.currency, entry.unitPrice, entry.kind === 'item' ? ' / 1개' : '')),
        el('div', { class: 'auc-seller' }, '판매자: ' + entry.sellerName + (entry.ticketCost > 0 ? ' · 거래권 ' + entry.ticketCost + '장' : ''))
    );
    if (entry.mine) node.appendChild(el('span', { class: 'auc-mine-badge' }, '내 판매'));
    return node;
}

function renderAuctionList() {
    const filter = auctionState.filter;
    const query = (auctionState.query || '').trim().toLowerCase();
    const filtered = auctionState.all.filter(entry => {
        if (filter === 'mine' && !entry.mine) return false;
        if (filter !== 'all' && filter !== 'mine' && entry.kind !== filter) return false;
        if (query) {
            const hay = [entry.display && entry.display.name, entry.display && entry.display.sub, entry.sellerName].filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(query) === -1) return false;
        }
        return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
    if (filtered.length === 0) {
        $('#auctionList').replaceChildren(el('div', { class: 'empty' }, query ? '검색 결과가 없습니다.' : '등록된 판매가 없습니다.'));
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
if ($('#aucSearch')) $('#aucSearch').addEventListener('input', e => { auctionState.query = e.target.value; renderAuctionList(); });

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
    content.push(auctionThumbEl(entry, { style: { maxWidth: '180px', margin: '0 auto 12px' } }));
    if (d.statLines && d.statLines.length) d.statLines.forEach(line => content.push(el('div', { class: 'stat-line' }, line)));
    content.push(el('div', { class: 'stat-line' }, '판매자: ' + entry.sellerName));
    content.push(el('div', { class: 'stat-line' }, entry.kind === 'item' ? '개당 가격: ' : '가격: ', currencyNode(entry.currency, entry.unitPrice)));
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
        } }, '판매 취소');
        content.push(cancelBtn);
    } else {
        let buyCountInput = null;
        const totalLine = el('div', { class: 'stat-line', style: { color: '#fbbf24', fontWeight: '800' } }, '총 결제: ', currencyNode(entry.currency, entry.unitPrice));
        const updateTotal = (count) => {
            const total = entry.unitPrice * count;
            const fee = Math.floor(total * 0.05);
            totalLine.replaceChildren('총 결제: ', currencyNode(entry.currency, total), '  /  판매자 입금: ', currencyNode(entry.currency, total - fee));
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
        el('h3', null, '판매 등록'),
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
$('#boDetailBg').onclick = e => { if (e.target.id === 'boDetailBg') closeBoDetail(); };
$('#boRegBg').onclick = e => { if (e.target.id === 'boRegBg') closeBoRegister(); };
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeModal();
        closeDetail();
        closeRegister();
        closeBoDetail();
        closeBoRegister();
    }
});

// ===== 삽니다 (구매 등록) =====

let buyOrderState = { all: [], filter: 'all', query: '' };

function buyOrderCardEl(entry) {
    const d = entry.display;
    const node = el('div', { class: 'auc-card' + (entry.mine ? ' mine' : ''), onclick: () => openBuyOrderDetail(entry) },
        auctionThumbEl(entry),
        el('div', { class: 'auc-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : '')),
        d.sub ? el('div', { class: 'auc-sub' }, d.sub) : null,
        el('div', { class: 'auc-price' }, currencyNode(entry.currency, entry.unitPrice, entry.kind === 'item' ? ' / 1개' : '')),
        el('div', { class: 'auc-seller' }, '구매자: ' + entry.buyerName)
    );
    if (entry.mine) node.appendChild(el('span', { class: 'auc-mine-badge' }, '내 구매'));
    return node;
}

function renderBuyOrderList() {
    const filter = buyOrderState.filter;
    const query = (buyOrderState.query || '').trim().toLowerCase();
    const filtered = buyOrderState.all.filter(entry => {
        if (filter === 'mine' && !entry.mine) return false;
        if (filter !== 'all' && filter !== 'mine' && entry.kind !== filter) return false;
        if (query) {
            const hay = [entry.display && entry.display.name, entry.display && entry.display.sub, entry.buyerName].filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(query) === -1) return false;
        }
        return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
    if (filtered.length === 0) {
        $('#buyOrderList').replaceChildren(el('div', { class: 'empty' }, query ? '검색 결과가 없습니다.' : '등록된 구매 요청이 없습니다.'));
        return;
    }
    $('#buyOrderList').replaceChildren(...filtered.map(buyOrderCardEl));
}

async function loadBuyOrders() {
    $('#buyOrderList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/buyorder');
        buyOrderState.all = data.items || [];
        renderBuyOrderList();
    } catch (e) {
        $('#buyOrderList').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

$$('#boFilter button').forEach(btn => btn.onclick = () => {
    $$('#boFilter button').forEach(b => b.classList.toggle('on', b === btn));
    buyOrderState.filter = btn.dataset.filter;
    renderBuyOrderList();
});
if ($('#boSearch')) $('#boSearch').addEventListener('input', e => { buyOrderState.query = e.target.value; renderBuyOrderList(); });

function showBoDetail(content) {
    $('#boDetail').replaceChildren(...content);
    $('#boDetailBg').classList.add('active');
}
function closeBoDetail() { $('#boDetailBg').classList.remove('active'); }

async function openBuyOrderDetail(entry) {
    const d = entry.display;
    const content = [
        el('h3', null, d.name + (entry.count > 1 ? ' (요청 ' + comma(entry.count) + ')' : '')),
        el('div', { class: 'sub' }, AUCTION_KIND_LABEL[entry.kind] + (d.sub ? ' · ' + d.sub : ''))
    ];
    content.push(auctionThumbEl(entry, { style: { maxWidth: '180px', margin: '0 auto 12px' } }));
    if (d.statLines && d.statLines.length) d.statLines.forEach(line => content.push(el('div', { class: 'stat-line' }, line)));
    content.push(el('div', { class: 'stat-line' }, '구매자: ' + entry.buyerName));
    content.push(el('div', { class: 'stat-line' }, entry.kind === 'item' ? '개당 가격: ' : '가격: ', currencyNode(entry.currency, entry.unitPrice)));
    if (entry.mine) {
        const totalRefund = entry.unitPrice * entry.count;
        content.push(el('div', { class: 'stat-line' }, '취소 시 미체결 분만큼 ', currencyNode(entry.currency, totalRefund), (entry.ticketCost > 0 ? ' 및 거래권 ' + (entry.ticketCost * entry.count) + '장' : '') + '이 반환됩니다.'));
        const cancelBtn = el('button', { class: 'danger close', onclick: async () => {
            cancelBtn.disabled = true;
            try {
                const r = await fetch('/api/buyorder/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '취소 실패');
                closeBoDetail();
                await loadBuyOrders();
                api('/api/profile').then(renderProfile).catch(() => {});
            } catch (e) {
                alert(e.message);
                cancelBtn.disabled = false;
            }
        } }, '구매 등록 취소');
        content.push(cancelBtn);
    } else {
        content.push(el('div', { class: 'loading' }, '판매 가능한 자산 확인 중...'));
        $('#boDetail').replaceChildren(...content);
        $('#boDetailBg').classList.add('active');
        let fulfillable;
        try {
            fulfillable = await api('/api/buyorder/fulfillable?id=' + encodeURIComponent(entry.id));
        } catch (e) {
            content.pop();
            content.push(el('div', { class: 'empty err' }, e.message));
            $('#boDetail').replaceChildren(...content);
            return;
        }
        content.pop();
        renderFulfillSection(entry, fulfillable, content);
    }
    const closeBtn = el('button', { onclick: closeBoDetail, style: { marginTop: '8px', width: '100%' } }, '닫기');
    content.push(closeBtn);
    showBoDetail(content);
}

function renderFulfillSection(entry, fulfillable, content) {
    let selectedIndex = -1;
    let sellCountInput = null;
    const totalLine = el('div', { class: 'stat-line', style: { color: '#fbbf24', fontWeight: '800' } }, '');
    const updateTotal = (count) => {
        const total = entry.unitPrice * count;
        const fee = Math.floor(total * 0.05);
        totalLine.replaceChildren('판매 시 입금: ', currencyNode(entry.currency, total - fee), ' (수수료 ', currencyNode(entry.currency, fee), ')');
    };

    if (entry.kind === 'card') {
        if (!fulfillable.cards.length) {
            content.push(el('div', { class: 'empty' }, '조건에 맞는 보유 카드가 없습니다.'));
            return;
        }
        const pick = el('div', { class: 'pick-list' });
        fulfillable.cards.forEach(card => {
            const row = el('div', {
                class: 'pick-row',
                onclick: () => {
                    selectedIndex = card.index;
                    Array.from(pick.children).forEach(c => c.classList.remove('on'));
                    row.classList.add('on');
                }
            },
                el('div', null, el('b', null, card.formatted), el('div', { class: 'meta' }, card.starText)),
                card.imageUrl ? el('img', { src: card.imageUrl, style: { width: '32px', height: '42px', objectFit: 'cover', borderRadius: '4px' } }) : null
            );
            pick.appendChild(row);
        });
        content.push(el('label', null, '판매할 카드 선택'));
        content.push(pick);
        updateTotal(1);
        content.push(totalLine);
    } else if (entry.kind === 'equipment') {
        if (!fulfillable.equipment.length) {
            content.push(el('div', { class: 'empty' }, '조건에 맞는 보유 장비가 없습니다.'));
            return;
        }
        const pick = el('div', { class: 'pick-list' });
        fulfillable.equipment.forEach(eq => {
            const row = el('div', {
                class: 'pick-row',
                onclick: () => {
                    selectedIndex = eq.index;
                    Array.from(pick.children).forEach(c => c.classList.remove('on'));
                    row.classList.add('on');
                }
            },
                el('div', null, el('b', null, eq.name + (eq.level > 0 ? ' +' + eq.level : '')), el('div', { class: 'meta' }, eq.rarity + ' · ' + eq.typeLabel))
            );
            pick.appendChild(row);
        });
        content.push(el('label', null, '판매할 장비 선택'));
        content.push(pick);
        updateTotal(1);
        content.push(totalLine);
    } else if (entry.kind === 'item') {
        if (fulfillable.itemCount < 1) {
            content.push(el('div', { class: 'empty' }, '판매 가능한 수량이 없습니다.'));
            return;
        }
        const maxSell = Math.min(fulfillable.itemCount, entry.count);
        content.push(el('label', null, '판매 갯수 (보유 ' + comma(fulfillable.itemCount) + ' / 요청 ' + comma(entry.count) + ')'));
        sellCountInput = el('input', { type: 'number', value: 1, min: 1, max: maxSell });
        sellCountInput.oninput = () => {
            let v = Math.floor(Number(sellCountInput.value || 1));
            if (!Number.isInteger(v) || v < 1) v = 1;
            if (v > maxSell) v = maxSell;
            sellCountInput.value = v;
            updateTotal(v);
        };
        content.push(sellCountInput);
        updateTotal(1);
        content.push(totalLine);
    }

    const sellBtn = el('button', { class: 'primary close', onclick: async () => {
        const body = { id: entry.id };
        if (entry.kind === 'item') {
            const count = Math.floor(Number(sellCountInput.value || 1));
            if (!Number.isInteger(count) || count < 1) return alert('판매 갯수를 입력해주세요.');
            body.count = count;
            if (!confirm(entry.display.name + ' x' + comma(count) + ' 을(를) 판매하시겠습니까?')) return;
        } else {
            if (selectedIndex < 0) return alert('판매할 ' + AUCTION_KIND_LABEL[entry.kind] + '을(를) 선택해주세요.');
            body.index = selectedIndex;
            if (!confirm(entry.display.name + ' 을(를) 판매하시겠습니까?')) return;
        }
        sellBtn.disabled = true;
        try {
            const r = await fetch('/api/buyorder/fulfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const x = await r.json();
            if (!r.ok) throw new Error(x.error || '판매 실패');
            closeBoDetail();
            await loadBuyOrders();
            api('/api/profile').then(renderProfile).catch(() => {});
        } catch (e) {
            alert(e.message);
            sellBtn.disabled = false;
        }
    } }, '이 요청에 판매하기');
    content.push(sellBtn);
}

// ===== 구매 등록 모달 =====

let boRegState = { kind: 'card', lookups: null, cardId: -1, star: 0, type: '', skin: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, count: 1 };

async function openBoRegisterModal() {
    boRegState = { kind: 'card', lookups: null, cardId: -1, star: 0, type: '', skin: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, count: 1 };
    $('#boReg').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#boRegBg').classList.add('active');
    try {
        const data = await api('/api/buyorder/lookups');
        boRegState.lookups = data;
        renderBoRegisterModal();
    } catch (e) {
        $('#boReg').replaceChildren(el('div', { class: 'empty err' }, e.message), el('button', { class: 'close', onclick: closeBoRegister }, '닫기'));
    }
}
function closeBoRegister() { $('#boRegBg').classList.remove('active'); }

function renderBoRegisterModal() {
    const data = boRegState.lookups;
    const kindSeg = el('div', { class: 'seg' },
        ...['card', 'equipment', 'item'].map(k => el('button', {
            class: boRegState.kind === k ? 'on' : '',
            onclick: () => { boRegState.kind = k; renderBoRegisterModal(); }
        }, AUCTION_KIND_LABEL[k]))
    );

    const content = [
        el('h3', null, '구매 등록'),
        el('div', { class: 'sub' }, '등록 시 가격이 선결제되며, 취소 시 미체결 분이 반환됩니다.'),
        el('label', null, '종류'),
        kindSeg
    ];

    if (boRegState.kind === 'card') {
        content.push(el('label', null, '캐릭터 카드'));
        const cardSelect = el('select', { onchange: e => { boRegState.cardId = Number(e.target.value); boRegState.skin = ''; renderBoRegisterModal(); } },
            el('option', { value: -1 }, '카드 선택...'),
            ...data.cards.map(c => el('option', { value: c.id, selected: boRegState.cardId === c.id ? 'selected' : null }, c.name))
        );
        content.push(cardSelect);
        content.push(el('label', null, '성급 (정확 일치)'));
        const starSelect = el('select', { onchange: e => { boRegState.star = Number(e.target.value); boRegState.skin = ''; renderBoRegisterModal(); } });
        for (let i = 0; i <= 11; i++) {
            const opt = el('option', { value: i }, (i + 1) + '성' + (i >= 4 ? ' · 거래권 ' + Math.max(0, i - 3) + '장' : ''));
            if (boRegState.star === i) opt.selected = true;
            starSelect.appendChild(opt);
        }
        content.push(starSelect);
        content.push(el('label', null, '타입 (선택 사항)'));
        const typeSelect = el('select', { onchange: e => { boRegState.type = e.target.value; } },
            el('option', { value: '' }, '타입 무관'),
            el('option', { value: '일반', selected: boRegState.type === '일반' ? 'selected' : null }, '일반')
        );
        content.push(typeSelect);
        content.push(el('label', null, '패션 (선택 사항)'));
        const rawStar = Number(boRegState.star || 0);
        const skins = (data.fashion || []).filter(skin => Array.isArray(skin.primary_card) && skin.primary_card.map(Number).includes(Number(boRegState.cardId)) && rawStar >= Number(skin.requireStar || 0));
        const skinSelect = el('select', { onchange: e => { boRegState.skin = e.target.value; } },
            el('option', { value: '' }, '패션 무관'),
            ...skins.map(skin => el('option', { value: skin.name, selected: boRegState.skin === skin.name ? 'selected' : null }, skin.name))
        );
        if (boRegState.skin && !skins.some(skin => skin.name === boRegState.skin)) boRegState.skin = '';
        content.push(skinSelect);
        content.push(el('label', null, '갯수'));
        const countInput = el('input', { type: 'number', value: boRegState.count, min: 1 });
        countInput.oninput = e => { let v = Math.floor(Number(e.target.value || 1)); if (!Number.isInteger(v) || v < 1) v = 1; boRegState.count = v; e.target.value = v; };
        content.push(countInput);
    } else if (boRegState.kind === 'equipment') {
        content.push(el('label', null, '장비 종류'));
        const typeSeg = el('div', { class: 'seg' },
            ...[['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구'], ['support', '보조']].map(([k, label]) => el('button', {
                class: boRegState.equipType === k ? 'on' : '',
                onclick: () => { boRegState.equipType = k; boRegState.equipId = -1; renderBoRegisterModal(); }
            }, label))
        );
        content.push(typeSeg);
        content.push(el('label', null, '장비'));
        const list = (data.equipment[boRegState.equipType] || []);
        const eqSelect = el('select', { onchange: e => { boRegState.equipId = Number(e.target.value); } },
            el('option', { value: -1 }, '장비 선택...'),
            ...list.map(eq => el('option', { value: eq.id, selected: boRegState.equipId === eq.id ? 'selected' : null }, eq.name + ' (' + eq.rarity + ')'))
        );
        content.push(eqSelect);
        const levelRow = el('div', { class: 'row', style: { alignItems: 'center' } },
            el('label', { style: { margin: 0 } }, el('input', { type: 'checkbox', checked: boRegState.levelSpecified ? 'checked' : null, onchange: e => { boRegState.levelSpecified = e.target.checked; renderBoRegisterModal(); } }), ' 강화 레벨 지정')
        );
        content.push(levelRow);
        if (boRegState.levelSpecified) {
            const levelInput = el('input', { type: 'number', value: boRegState.level, min: 0, max: 15 });
            levelInput.oninput = e => { let v = Math.floor(Number(e.target.value || 0)); if (!Number.isInteger(v) || v < 0) v = 0; if (v > 15) v = 15; boRegState.level = v; e.target.value = v; };
            content.push(levelInput);
        }
        content.push(el('label', null, '갯수'));
        const countInput = el('input', { type: 'number', value: boRegState.count, min: 1 });
        countInput.oninput = e => { let v = Math.floor(Number(e.target.value || 1)); if (!Number.isInteger(v) || v < 1) v = 1; boRegState.count = v; e.target.value = v; };
        content.push(countInput);
    } else {
        content.push(el('label', null, '아이템'));
        const itemSelect = el('select', { onchange: e => { boRegState.itemId = Number(e.target.value); } },
            el('option', { value: -1 }, '아이템 선택...'),
            ...data.items.map(it => el('option', { value: it.id, selected: boRegState.itemId === it.id ? 'selected' : null }, '[' + it.type + '] ' + it.name))
        );
        content.push(itemSelect);
        content.push(el('label', null, '갯수'));
        const countInput = el('input', { type: 'number', value: boRegState.count, min: 1 });
        countInput.oninput = e => { let v = Math.floor(Number(e.target.value || 1)); if (!Number.isInteger(v) || v < 1) v = 1; boRegState.count = v; e.target.value = v; };
        content.push(countInput);
    }

    content.push(el('label', null, '화폐'));
    const currencySelect = el('select', { id: 'boRegCurrency' },
        el('option', { value: 'gold' }, '🪙 골드'),
        el('option', { value: 'garnet' }, '💠 가넷')
    );
    content.push(currencySelect);
    content.push(el('label', null, boRegState.kind === 'item' ? '개당 가격' : '개당 가격'));
    const priceInput = el('input', { type: 'number', id: 'boRegPrice', placeholder: '예: 10000', min: 1 });
    content.push(priceInput);

    const submitBtn = el('button', { class: 'primary', style: { flex: '2' }, onclick: submitBoRegister }, '등록');
    const cancelBtn = el('button', { onclick: closeBoRegister }, '취소');
    content.push(el('div', { class: 'row' }, cancelBtn, submitBtn));

    $('#boReg').replaceChildren(...content);
}

async function submitBoRegister() {
    const kind = boRegState.kind;
    const currency = $('#boRegCurrency').value;
    const price = Number($('#boRegPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) return alert('가격은 1 이상의 정수여야 합니다.');
    const body = { kind, currency, price, count: boRegState.count };
    if (kind === 'card') {
        if (boRegState.cardId < 0) return alert('카드를 선택해주세요.');
        body.cardId = boRegState.cardId;
        body.star = boRegState.star;
        if (boRegState.type) body.type = boRegState.type;
        if (boRegState.skin && boRegState.skin.trim()) body.skin = boRegState.skin.trim();
    } else if (kind === 'equipment') {
        if (boRegState.equipId < 0) return alert('장비를 선택해주세요.');
        body.equipType = boRegState.equipType;
        body.equipId = boRegState.equipId;
        if (boRegState.levelSpecified) body.level = boRegState.level;
    } else {
        if (boRegState.itemId < 0) return alert('아이템을 선택해주세요.');
        body.itemId = boRegState.itemId;
    }
    try {
        const r = await fetch('/api/buyorder/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.error || '등록 실패');
        closeBoRegister();
        await loadBuyOrders();
        api('/api/profile').then(renderProfile).catch(() => {});
    } catch (e) {
        alert(e.message);
    }
}

if ($('#boNew')) $('#boNew').onclick = openBoRegisterModal;

async function loadProfile(name) {
    const url = name && name !== myName ? '/api/profile/' + encodeURIComponent(name) : '/api/profile';
    const data = await api(url);
    activatePage('info');
    renderProfile(data);
}

if ($('#profileBackBtn')) $('#profileBackBtn').onclick = () => {
    if (myName) loadProfile(myName).catch(e => alert(e.message));
};

// ===== 랭킹 =====
let rankingData = null;
let rankingTab = 'cp';

function rankRow(entry, isMe, valueFormatter) {
    const rk = entry.rank;
    const rkClass = rk === 1 ? 'gold' : rk === 2 ? 'silver' : rk === 3 ? 'bronze' : '';
    const medal = rk === 1 ? '🥇' : rk === 2 ? '🥈' : rk === 3 ? '🥉' : rk + '위';
    return el('div', { class: 'rank-row ' + (isMe ? 'me' : ''), onclick: () => loadProfile(entry.name).catch(e => alert(e.message)) },
        el('div', { class: 'rk ' + rkClass }, medal),
        el('div', { class: 'nm' }, entry.name, el('span', { class: 'lv' }, 'Lv. ' + comma(entry.level))),
        el('div', { class: 'vl' }, valueFormatter(entry.value))
    );
}

function renderRanking() {
    if (!rankingData) return;
    const list = rankingTab === 'cp' ? rankingData.cp : rankingTab === 'exp' ? rankingData.exp : rankingData.worldBoss;
    const me = rankingTab === 'cp' ? rankingData.me.cp : rankingTab === 'exp' ? rankingData.me.exp : rankingData.me.worldBoss;
    const valueFormatter = rankingTab === 'cp' ? v => '⚔️ ' + comma(v) : rankingTab === 'exp' ? v => 'XP ' + comma(v) : v => '피해 ' + comma(v);
    const meBox = $('#rankMe');
    meBox.innerHTML = '';
    if (me) {
        meBox.className = 'rank-me';
        meBox.appendChild(el('div', { class: 'rk' }, comma(me.rank) + '위'));
        meBox.appendChild(el('div', { class: 'nm' }, me.name, ' ', el('span', { class: 'lv' }, 'Lv. ' + comma(me.level))));
        meBox.appendChild(el('div', null, '/ ' + comma(rankingTab === 'worldBoss' ? list.length : rankingData.total) + '명'));
        meBox.appendChild(el('div', { class: 'vl' }, valueFormatter(me.value)));
    } else {
        meBox.className = '';
    }
    const listEl = $('#rankList');
    listEl.innerHTML = '';
    if (!list.length) {
        listEl.appendChild(el('div', { class: 'empty' }, '랭킹 데이터가 없습니다.'));
        return;
    }
    list.forEach(entry => listEl.appendChild(rankRow(entry, me && entry.name === me.name, valueFormatter)));
}

async function loadRanking() {
    if (!rankingData) {
        $('#rankList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
        try { rankingData = await api('/api/ranking'); }
        catch (e) { $('#rankList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
    }
    renderRanking();
}

$$('.rank-tab').forEach(btn => btn.onclick = () => {
    rankingTab = btn.dataset.tab;
    $$('.rank-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderRanking();
});

// ===== 도감 =====
let dexData = null;
let dexTab = 'weapon';

function dexThumb(iconUrl, frameUrl, fallback, sizeClass) {
    const wrap = el('div', { class: sizeClass || 'dex-thumb' });
    if (frameUrl) wrap.appendChild(el('img', { src: frameUrl, class: 'frame', alt: '' }));
    if (iconUrl) wrap.appendChild(el('img', { src: iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, fallback || '⚙️'));
    return wrap;
}

const CURRENCY_ICON = { gold: '🪙', garnet: '💠' };

function dexCard(entry) {
    const color = RARITY_COLORS[entry.rarity] || '#334155';
    const card = el('div', { class: 'dex-card' });
    card.style.setProperty('--rar', color);

    const head = el('div', { class: 'dex-head' });
    head.appendChild(dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️'));
    head.appendChild(el('div', null,
        el('div', { class: 'dex-name' }, entry.name),
        el('div', { class: 'dex-meta' },
            el('span', { class: 'tag rarity' }, entry.rarity),
            el('span', { class: 'tag' }, entry.typeLabel),
            entry.noTrade ? el('span', { class: 'tag' }, '거래 불가') : null
        )
    ));
    card.appendChild(head);

    if (entry.desc) card.appendChild(el('div', { class: 'dex-desc' }, entry.desc));

    if (entry.baseStatLines && entry.baseStatLines.length) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '기본 능력치'));
        entry.baseStatLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }

    if (entry.upgrades && entry.upgrades.length) {
        const det = el('details', { class: 'dex-collapse' });
        det.appendChild(el('summary', null, '강화 단계 (+1 ~ +' + entry.maxUpgradeLevel + ')'));
        const list = el('div', { class: 'dex-upgrade-list' });
        entry.upgrades.forEach(up => {
            list.appendChild(el('div', { class: 'dex-upgrade-row' },
                el('div', { class: 'lvl' }, '+' + up.level),
                el('div', { class: 'lines' }, ...(up.statLines.length ? up.statLines.map(l => el('div', null, l)) : [el('div', { style: { color: '#64748b' } }, '변화 없음')]))
            ));
        });
        det.appendChild(list);
        card.appendChild(det);
    }

    if (entry.evolution) {
        const evol = el('div', { class: 'dex-evol' });
        evol.appendChild(el('div', { class: 'dex-evol-title' }, '합성 진화'));
        const target = el('div', { class: 'dex-evol-target' });
        target.appendChild(dexThumb(entry.evolution.targetIconUrl, entry.evolution.targetFrameUrl, SLOT_ICONS[entry.evolution.targetType] || '⚙️', 'dex-evol-thumb'));
        target.appendChild(el('div', null,
            el('div', { style: { fontWeight: 800, color: '#f8fafc' } }, entry.evolution.targetName),
            el('div', { style: { fontSize: '11px', color: '#94a3b8' } }, entry.evolution.targetRarity || '')
        ));
        target.appendChild(el('div', { style: { fontSize: '11px', color: '#a5b4fc' } }, '+' + entry.evolution.requireLevel + ' x' + entry.evolution.requireCount));
        evol.appendChild(target);
        card.appendChild(evol);
    }

    if (entry.recipe) {
        const recipe = el('div', { class: 'dex-recipe' });
        recipe.appendChild(el('div', { class: 'dex-recipe-title' }, '제작 레시피 · ' + entry.recipe.name));
        entry.recipe.materials.forEach(mat => {
            const row = el('div', { class: 'dex-recipe-mat' });
            const fallback = CURRENCY_ICON[mat.type] || '📦';
            row.appendChild(dexThumb(mat.iconUrl, mat.frameUrl, fallback, 'dex-mat-thumb'));
            row.appendChild(el('div', null,
                el('div', { style: { fontWeight: 700, color: '#f8fafc' } }, mat.name),
                el('div', { style: { fontSize: '11px', color: '#94a3b8' } }, mat.typeLabel)
            ));
            row.appendChild(el('div', { class: 'dex-mat-count' }, 'x' + comma(mat.count)));
            recipe.appendChild(row);
        });
        card.appendChild(recipe);
    }

    return card;
}

function renderDex() {
    if (!dexData) return;
    const list = dexData[dexTab] || [];
    const grid = $('#dexList');
    grid.innerHTML = '';
    if (!list.length) {
        grid.appendChild(el('div', { class: 'empty' }, '데이터가 없습니다.'));
        return;
    }
    list.forEach(entry => grid.appendChild(dexCard(entry)));
}

async function loadDex() {
    if (!dexData) {
        $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
        try { dexData = await api('/api/dex/equipment'); }
        catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
    }
    renderDex();
}

$$('.dex-tab').forEach(btn => btn.onclick = () => {
    dexTab = btn.dataset.tab;
    $$('.dex-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderDex();
});

let patchnoteData = null;
let patchnoteAdmin = false;

function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ko-KR');
}

function escapeMarkdownHtml(text) {
    return String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderInlineMarkdown(text) {
    return escapeMarkdownHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function markdownToHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inCode = false;
    let codeLines = [];
    let list = null;
    const closeList = () => {
        if (list) {
            out.push('</' + list + '>');
            list = null;
        }
    };
    lines.forEach(line => {
        if (line.trim().startsWith('```')) {
            if (inCode) {
                out.push('<pre><code>' + escapeMarkdownHtml(codeLines.join('\n')) + '</code></pre>');
                codeLines = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            return;
        }
        if (inCode) {
            codeLines.push(line);
            return;
        }
        if (/^###\s+/.test(line)) { closeList(); out.push('<h3>' + renderInlineMarkdown(line.replace(/^###\s+/, '')) + '</h3>'); return; }
        if (/^##\s+/.test(line)) { closeList(); out.push('<h2>' + renderInlineMarkdown(line.replace(/^##\s+/, '')) + '</h2>'); return; }
        if (/^#\s+/.test(line)) { closeList(); out.push('<h1>' + renderInlineMarkdown(line.replace(/^#\s+/, '')) + '</h1>'); return; }
        if (/^\s*[-*]\s+/.test(line)) {
            if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>'); }
            out.push('<li>' + renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
            return;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
            if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>'); }
            out.push('<li>' + renderInlineMarkdown(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
            return;
        }
        closeList();
        if (line.trim()) out.push('<p>' + renderInlineMarkdown(line) + '</p>');
    });
    closeList();
    if (inCode) out.push('<pre><code>' + escapeMarkdownHtml(codeLines.join('\n')) + '</code></pre>');
    return out.join('');
}

function replyForm(noteId, parentId) {
    const ta = el('textarea', { placeholder: parentId ? '대댓글 작성...' : '댓글 작성...' });
    const btn = el('button', { class: 'primary', onclick: async () => {
        const textbody = ta.value.trim();
        if (!textbody) return alert('내용을 입력해주세요.');
        btn.disabled = true;
        try {
            const data = await postApi('/api/patchnotes/' + encodeURIComponent(noteId) + '/replies', { parentId, textbody });
            patchnoteData = data.items || [];
            renderPatchnotes();
        } catch (e) {
            alert(e.message);
            btn.disabled = false;
        }
    } }, parentId ? '대댓글 등록' : '댓글 등록');
    return el('div', { class: 'reply-box' }, ta, el('div', { class: 'actions' }, btn));
}

function renderPatchReplies(noteId, replies, depth) {
    const wrap = el('div', { class: 'reply-list' });
    (replies || []).forEach(reply => {
        const row = el('div', { class: 'reply-item ' + (depth > 0 ? 'child' : '') },
            el('div', { class: 'reply-meta' }, el('b', null, reply.authorName || '알 수 없음'), ' Lv. ' + comma(reply.authorLevel || 1) + ' · ' + formatDateTime(reply.date)),
            el('div', { class: 'reply-text' }, reply.textbody || ''),
            replyForm(noteId, reply.id)
        );
        if (reply.replies && reply.replies.length) row.appendChild(renderPatchReplies(noteId, reply.replies, depth + 1));
        wrap.appendChild(row);
    });
    return wrap;
}

function patchnoteCard(note) {
    const body = el('div', { class: 'markdown-body' });
    body.innerHTML = markdownToHtml(note.textbody || '');
    return el('article', { class: 'patch-card' },
        el('div', null, el('div', { class: 'patch-title' }, note.title || '(제목 없음)'), el('div', { class: 'patch-date' }, formatDateTime(note.date))),
        body,
        el('div', { class: 'reply-list' },
            el('h3', { style: { margin: '4px 0' } }, '댓글'),
            renderPatchReplies(note.id, note.replies || [], 0),
            replyForm(note.id, null)
        )
    );
}

function renderPatchnotes() {
    const list = $('#patchList');
    if (!list) return;
    list.innerHTML = '';
    if ($('#patchNew')) $('#patchNew').style.display = patchnoteAdmin ? '' : 'none';
    if (!patchnoteData || patchnoteData.length === 0) {
        list.appendChild(el('div', { class: 'empty' }, '등록된 패치노트가 없습니다.'));
        return;
    }
    patchnoteData.forEach(note => list.appendChild(patchnoteCard(note)));
}

async function loadPatchnotes() {
    const list = $('#patchList');
    if (!list) return;
    list.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/patchnotes');
        patchnoteData = data.items || [];
        patchnoteAdmin = !!data.admin;
        renderPatchnotes();
    } catch (e) {
        list.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

if ($('#patchNew')) $('#patchNew').onclick = () => $('#patchEditor').classList.add('active');
if ($('#patchCancel')) $('#patchCancel').onclick = () => $('#patchEditor').classList.remove('active');
if ($('#patchSubmit')) $('#patchSubmit').onclick = async () => {
    const title = $('#patchTitle').value.trim();
    const date = $('#patchDate').value.trim();
    const textbody = $('#patchBody').value.trim();
    if (!title) return alert('제목을 입력해주세요.');
    if (!textbody) return alert('본문을 입력해주세요.');
    $('#patchSubmit').disabled = true;
    try {
        const data = await postApi('/api/patchnotes', { title, date, textbody });
        patchnoteData = data.items || [];
        $('#patchTitle').value = '';
        $('#patchDate').value = '';
        $('#patchBody').value = '';
        $('#patchEditor').classList.remove('active');
        renderPatchnotes();
    } catch (e) {
        alert(e.message);
    } finally {
        $('#patchSubmit').disabled = false;
    }
};

(async () => {
    try {
        const me = await api('/api/me');
        myName = me.name;
        const profile = await api('/api/profile');
        renderProfile(profile);
    } catch (e) {
        $('#app').replaceChildren(el('section', { class: 'panel' }, el('h2', null, '오류'), el('p', { class: 'err' }, e.message)));
    }
})();
