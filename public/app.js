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
function svgIcon(svgHtml) {
    const tmp = document.createElement('div');
    tmp.innerHTML = svgHtml;
    return tmp.firstElementChild;
}
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
if ($('#adminLink')) $('#adminLink').onclick = () => { location.href = '/admin'; };

const PAGE_LABELS = { info: '정보', inventory: '인벤토리', combine: '조합', dex: '도감', auction: '팝니다', buyorder: '삽니다', shop: '상점', ranking: '랭킹', patchnotes: '패치노트' };
const ICONS = {
    me:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`,
    content:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    market:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    party:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    community: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
};
const GROUPS = [
    { id: 'me',        label: '캐릭터',   iconSvg: ICONS.me,        pages: ['info', 'inventory'] },
    { id: 'content',   label: '콘텐츠',   iconSvg: ICONS.content,   pages: ['combine', 'dex'] },
    { id: 'market',    label: '거래',     iconSvg: ICONS.market,    pages: ['shop', 'auction', 'buyorder'] },
    ...(window.HAS_PARTY ? [{ id: 'party', label: '파티', iconSvg: ICONS.party, pages: ['party'] }] : []),
    { id: 'community', label: '커뮤니티', iconSvg: ICONS.community, pages: ['ranking', 'patchnotes'] },
];

let activePage = 'info';

function getGroupForPage(pageId) {
    return GROUPS.find(g => g.pages.includes(pageId)) || GROUPS[0];
}

function buildNav() {
    const groupTabsEl = $('#groupTabs');
    const bottomTabsEl = $('#bottomTabs');
    GROUPS.forEach(g => {
        const handler = () => activateGroup(g.id);
        if (groupTabsEl) groupTabsEl.appendChild(
            el('button', { class: 'group-tab', 'data-group': g.id, onclick: handler }, svgIcon(g.iconSvg), g.label)
        );
        if (bottomTabsEl) bottomTabsEl.appendChild(
            el('button', { class: 'bottom-tab', 'data-group': g.id, onclick: handler },
                el('span', { class: 'tab-icon-wrap' }, svgIcon(g.iconSvg)),
                el('span', { class: 'tab-label' }, g.label))
        );
    });
    const initGroup = getGroupForPage(activePage);
    syncGroupActive(initGroup.id);
    buildSubNav(initGroup);
}

function syncGroupActive(groupId) {
    $$('.group-tab, .bottom-tab').forEach(t => t.classList.toggle('active', t.dataset.group === groupId));
}

function buildSubNav(group) {
    const bar = $('#subNavBar');
    if (!bar) return;
    const pages = group.pages.filter(p => p !== 'party');
    if (pages.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.replaceChildren(...pages.map(pageId =>
        el('button', { class: 'subnav-tab' + (pageId === activePage ? ' active' : ''), 'data-page': pageId,
            onclick: () => navigatePage(pageId) }, PAGE_LABELS[pageId] || pageId)
    ));
}

function activateGroup(groupId) {
    const group = GROUPS.find(g => g.id === groupId);
    if (!group) return;
    if (group.pages[0] === 'party') { location.href = '/party'; return; }
    syncGroupActive(groupId);
    buildSubNav(group);
    navigatePage(group.pages[0]);
}

function navigatePage(pageId) {
    activePage = pageId;
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === pageId));
    $$('.subnav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === pageId));
    if (pageId === 'info' && currentProfileName && myName && currentProfileName !== myName) loadProfile(myName).catch(e => alert(e.message));
    if (pageId === 'inventory') {
        if (currentProfileName && myName && currentProfileName !== myName) {
            currentInventoryName = currentProfileName;
        } else {
            currentInventoryName = myName;
        }
        updateInventoryBanner();
        loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
    }
    if (pageId === 'combine') loadCombine();
    if (pageId === 'shop') loadShop(); else stopHotdealCountdown();
    if (pageId === 'auction') loadAuctions();
    if (pageId === 'buyorder') loadBuyOrders();
    if (pageId === 'ranking') loadRanking();
    if (pageId === 'dex') loadDex();
    if (pageId === 'patchnotes') loadPatchnotes();
}

function activatePage(name) {
    if (name === 'party') { location.href = '/party'; return; }
    const group = getGroupForPage(name);
    syncGroupActive(group.id);
    buildSubNav(group);
    navigatePage(name);
}

buildNav();

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

function petCardThumb(pet) {
    const wrap = el('div', { class: 'equip-thumb' + (pet.expired ? ' pet-expired' : '') });
    if (pet.frameUrl) wrap.appendChild(el('img', { src: pet.frameUrl, class: 'frame', alt: '' }));
    if (pet.iconUrl) wrap.appendChild(el('img', { src: pet.iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, '🐾'));
    return wrap;
}

function petCard(pet) {
    const color = RARITY_COLORS[pet.rarity] || '#334155';
    const expText = pet.expired ? '만료됨' : (pet.expiryText || '');
    const card = el('div', { class: 'equip-card', onclick: () => openPetModal(pet) },
        petCardThumb(pet),
        el('div', null,
            el('div', { class: 'equip-name' }, pet.name),
            el('div', { class: 'equip-meta' },
                el('span', { class: 'tag rarity' }, pet.rarity),
                pet.equipped ? el('span', { class: 'tag on' }, '장착') : null,
                expText ? el('span', { class: 'tag' }, expText) : null
            )
        ),
        pet.level > 0 ? el('span', { class: 'level' }, '+' + pet.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    return card;
}

function openPetModal(pet) {
    const title = pet.name + (pet.level > 0 ? ' +' + pet.level : '');
    const expText = pet.expired ? '만료됨' : (pet.expiryText || '');
    const sub = pet.rarity + ' · 펫' + (expText ? ' · ' + expText : '');
    openModal(title, sub, pet.statLines || []);
    const thumb = petCardThumb(pet);
    thumb.classList.add('modal-equip-thumb');
    $('#modalBody').prepend(thumb);
    if (pet.specialLines && pet.specialLines.length) {
        $('#modalBody').appendChild(el('div', { class: 'pet-special-title' }, '특수 효과'));
        pet.specialLines.forEach(line => $('#modalBody').appendChild(el('div', { class: 'stat-line' }, line)));
    }
    const se = pet.setEffect;
    if (se && Array.isArray(se.tiers) && se.tiers.length) {
        $('#modalBody').appendChild(el('div', { class: 'pet-set-block' },
            el('div', { class: 'pet-set-title' }, '세트 효과 · ' + se.name + ' (' + se.count + '/' + se.total + ')'),
            ...se.tiers.map(tier => el('div', { class: 'pet-set-tier' },
                el('span', { class: 'pet-set-tier-label' }, tier.tier + '세트'),
                el('div', { class: 'pet-set-tier-lines' }, ...tier.lines.map(line => el('div', null, line)))
            ))
        ));
    }
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

function formatSoulRemaining(expiredAt) {
    const diff = Number(expiredAt || 0) - Date.now();
    if (diff <= 0) return null;
    if (diff >= 86400000) return '영혼이 ' + Math.floor(diff / 86400000) + '일 후 빠져나갑니다.';
    if (diff >= 3600000) return '영혼이 ' + Math.floor(diff / 3600000) + '시간 후 빠져나갑니다.';
    if (diff >= 60000) return '영혼이 ' + Math.floor(diff / 60000) + '분 후 빠져나갑니다.';
    if (diff >= 1000) return '영혼이 ' + Math.floor(diff / 1000) + '초 후 빠져나갑니다.';
    return null;
}

function openEquipmentModal(eq) {
    const title = eq.name + (eq.level > 0 ? ' +' + eq.level : '');
    const sub = eq.rarity + ' · ' + eq.typeLabel;
    const lines = (eq.statLines || []).map(line => line.replace(/^-\s*/, ''));
    openModal(title, sub, lines);
    const thumb = equipmentThumb(eq);
    thumb.classList.add('modal-equip-thumb');
    $('#modalBody').prepend(thumb);
    if (eq.soul) {
        const soulText = formatSoulRemaining(eq.soul.expiredAt);
        if (soulText) $('#modalBody').appendChild(el('div', { class: 'stat-line', style: 'opacity:0.85;font-style:italic' }, soulText));
    }
    const potBlock = potentialBlockNode(eq.potentialDisplay);
    if (potBlock) $('#modalBody').appendChild(potBlock);
    const inventoryPageActive = document.querySelector('.page[data-page="inventory"]') && document.querySelector('.page[data-page="inventory"]').classList.contains('active');
    const ownInventory = !currentInventoryName || !myName || currentInventoryName === myName;
    if (inventoryPageActive && ownInventory && Number(eq.number || 0) > 0) {
        const action = eq.equipped ? 'unequip' : 'equip';
        const row = el('div', { class: 'row' });
        row.appendChild(el('button', { class: eq.equipped ? 'close' : 'primary', onclick: e => handleEquipmentAction(eq, action, e) }, eq.equipped ? '장착 해제' : '장착'));
        row.appendChild(el('button', { onclick: () => { closeModal(); openEnhanceModal(eq); } }, '강화'));
        $('#modalBody').appendChild(row);
    }
}

async function handleEquipmentAction(eq, action, event) {
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/inventory/equipment/' + action, { number: eq.number });
        closeModal();
        if (data.profile) renderProfile(data.profile);
        await loadInventory('equipment');
    } catch (e) {
        alert(e.message);
        if (btn) btn.disabled = false;
    }
}

function categorySection(title, children) {
    return el('div', { class: 'cat' }, el('div', { class: 'cat-title' }, title), ...children);
}

let myName = null;
let currentProfileName = null;
let currentInventoryName = null;

function updateInventoryBanner() {
    const banner = $('#inventoryBanner');
    if (!banner) return;
    const isOther = currentInventoryName && myName && currentInventoryName !== myName;
    banner.style.display = isOther ? 'flex' : 'none';
    if (isOther) $('#inventoryBannerText').textContent = currentInventoryName + '님의 인벤토리를 보고 있습니다';
}

function renderProfile(data) {
    currentProfileName = data.user.name;
    const isInitialOwnProfile = myName == null;
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
    const petRow = $('#petRow');
    if (petRow) petRow.replaceChildren(...(data.equippedPets || []).map(petCard));
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
    const viewInvBtn = $('#viewInventoryBtn');
    if (viewInvBtn) viewInvBtn.style.display = data.user.name !== myName ? '' : 'none';
    if (data.user.isAdmin) $('#adminLink').style.display = '';
    if (isInitialOwnProfile && !data.user.canPartyQuest)
        $$('.group-tab[data-group="party"], .bottom-tab[data-group="party"]').forEach(t => t.remove());
}

if ($('#viewInventoryBtn')) $('#viewInventoryBtn').onclick = () => {
    if (!currentProfileName) return;
    currentInventoryName = currentProfileName;
    updateInventoryBanner();
    activatePage('inventory');
    loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
};

if ($('#inventoryBackBtn')) $('#inventoryBackBtn').onclick = () => {
    currentInventoryName = myName;
    updateInventoryBanner();
    loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
};

function invItemCell(item) {
    const imgParts = [];
    if (item.iconUrl) {
        if (item.frameUrl) imgParts.push(el('img', { class: 'inv-cell-frame', src: item.frameUrl, alt: '' }));
        imgParts.push(el('img', { class: 'inv-cell-icon', src: item.iconUrl, alt: item.name }));
    }
    if (item.count > 1) imgParts.push(el('span', { class: 'inv-cell-count' }, comma(item.count)));
    return el('div', { class: 'inv-cell', onclick: () => openInvItemModal(item) },
        el('div', { class: 'inv-cell-img' }, ...imgParts),
        el('div', { class: 'inv-cell-name' }, item.name)
    );
}

function openInvItemModal(item) {
    const thumbParts = [];
    if (item.iconUrl) {
        if (item.frameUrl) thumbParts.push(el('img', { class: 'inv-cell-frame', src: item.frameUrl, alt: '' }));
        thumbParts.push(el('img', { class: 'inv-cell-icon', src: item.iconUrl, alt: item.name }));
    }
    const bodyNodes = [
        el('div', { class: 'inv-cell-img', style: 'width:96px;height:96px;margin:0 auto 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1)' }, ...thumbParts),
        el('div', { class: 'kv' }, el('span', null, '종류'), el('b', null, item.type || '-')),
        el('div', { class: 'kv' }, el('span', null, '보유 수량'), el('b', null, comma(item.count) + '개')),
    ];
    if (item.desc) bodyNodes.push(el('div', { style: 'padding:10px 14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.06);border-radius:12px;font-size:13px;color:#cbd5e1;line-height:1.6;margin-top:4px' }, item.desc));
    $('#modalTitle').textContent = item.name;
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(...bodyNodes);
    $('#modalBg').classList.add('active');
}

async function loadInventory(kind) {
    $$('.inv-kind-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    $('#viewer').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    const url = currentInventoryName && myName && currentInventoryName !== myName
        ? '/api/inventory/' + kind + '/' + encodeURIComponent(currentInventoryName)
        : '/api/inventory/' + kind;
    const data = await api(url);
    if (kind === 'items') {
        $('#viewerTitle').textContent = '인벤토리';
        const sections = [];
        ITEM_TYPE_ORDER.forEach(type => {
            const filtered = data.items.filter(item => item.type === type).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
            if (filtered.length) sections.push(categorySection('《 ' + type + ' 》', [el('div', { class: 'inv-grid' }, ...filtered.map(invItemCell))]));
        });
        const unknown = data.items.filter(item => !ITEM_TYPE_ORDER.includes(item.type)).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
        if (unknown.length) sections.push(categorySection('《 기타 》', [el('div', { class: 'inv-grid' }, ...unknown.map(invItemCell))]));
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
    if (kind === 'pet') {
        $('#viewerTitle').textContent = '보유 펫';
        $('#viewer').replaceChildren(data.pet.length ? el('div', { class: 'equip-grid' }, data.pet.map(petCard)) : el('div', { class: 'empty' }, '보유 펫이 없습니다.'));
    }
}

$$('.inv-kind-tab').forEach(btn => btn.onclick = () => loadInventory(btn.dataset.kind).catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message))));

// ===== 조합 =====

let combineState = { cards: [], meta: { table: {}, protect: {}, gold: 0 }, slots: [null, null, null], protectIndex: null, result: null, busy: false, built: false, slotEls: null };

function combineUi(file) { return '/combine-ui?file=' + encodeURIComponent(file); }

function combineGrade() {
    const filled = combineState.slots.find(Boolean);
    return filled ? filled.star : null;
}

// ===== 장비 강화 =====
let enhanceState = { preview: null, busy: false };


function openEnhanceModal(eq) {
    if (!Number(eq.number || 0)) return;
    $('#enhanceOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadEnhancePreview(eq.number);
}

async function loadEnhancePreview(number) {
    $('#enhanceContent').replaceChildren(el('div', { class: 'loading', style: 'padding:60px 0;text-align:center' }, '불러오는 중...'));
    $('#enhanceResultOverlay').classList.remove('active');
    try {
        const data = await api('/api/equipment/upgrade/preview/' + number);
        if (data.error) { $('#enhanceContent').replaceChildren(el('div', { class: 'empty err', style: 'padding:40px 0' }, data.error)); return; }
        enhanceState.preview = data;
        renderEnhancePreview(data);
    } catch (e) {
        $('#enhanceContent').replaceChildren(el('div', { class: 'empty err', style: 'padding:40px 0' }, e.message));
    }
}

function renderEnhancePreview(data) {
    const thumbParts = [];
    if (data.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: data.frameUrl, alt: '' }));
    if (data.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: data.iconUrl, alt: data.name }));

    const beforeContent = el('div', { class: 'enhance-before-content' });
    const afterContent = el('div', { class: 'enhance-after-content' });
    if (data.statDiffs && data.statDiffs.length) {
        data.statDiffs.forEach(d => {
            beforeContent.appendChild(el('div', { class: 'enhance-stat-row' },
                el('span', { class: 'enhance-stat-label' }, d.label),
                el('span', { class: 'enhance-stat-val' }, d.before)
            ));
            afterContent.appendChild(el('div', { class: 'enhance-stat-row' },
                el('span', { class: 'enhance-stat-label' }, d.label),
                el('span', { class: 'enhance-stat-val better' }, d.after,
                    el('span', { class: 'enhance-stat-delta' }, ' (' + d.delta + ')'))
            ));
        });
    } else {
        beforeContent.appendChild(el('div', { class: 'enhance-empty-stat' }, '—'));
        afterContent.appendChild(el('div', { class: 'enhance-empty-stat' }, '—'));
    }

    const win = el('div', { class: 'enhance-window' },
        el('button', { class: 'enhance-close-btn', onclick: closeEnhanceModal }, '✕'),
        el('div', { class: 'enhance-item-zone' },
            el('div', { class: 'auc-thumb square' }, ...thumbParts),
            el('div', { class: 'enhance-item-level' }, data.name + '  +' + data.level + ' → +' + data.nextLevel)
        ),
        beforeContent,
        afterContent
    );

    const confirmBtn = el('button', { class: 'enhance-confirm-btn', id: 'enhanceConfirmBtn', onclick: () => {
        if (Number(data.rates.reset || 0) > 0 && !data.protectInfo) showEnhanceWarning(() => runEnhancement(data.number));
        else runEnhancement(data.number);
    } }, '강화');
    if (!data.canUpgrade) confirmBtn.disabled = true;

    const protectNodes = data.protectInfo
        ? [el('div', { class: 'enhance-protect ' + (data.protectInfo.level || 'basic') },
            el('div', { class: 'enhance-protect-icon' },
                data.protectInfo.iconUrl
                    ? el('img', { class: 'enhance-protect-img', src: data.protectInfo.iconUrl, alt: '' })
                    : '🛡'),
            el('div', { class: 'enhance-protect-text' },
                el('div', { class: 'enhance-protect-name' }, data.protectInfo.label),
                el('div', { class: 'enhance-protect-detail' }, data.protectInfo.detail)
            ),
            el('div', { class: 'enhance-protect-badge' }, '보유 중')
          )]
        : [];

    $('#enhanceContent').replaceChildren(
        win,
        el('div', { class: 'enhance-info' },
            el('div', { class: 'enhance-section-label' }, '강화 확률'),
            el('div', { class: 'enhance-rates-row' },
                enhRateChip('great', '대성공', data.rates.great),
                enhRateChip('success', '성공', data.rates.success),
                enhRateChip('down', '하락', data.rates.down),
                enhRateChip('destroy', '파괴', data.rates.reset)
            ),
            el('div', { class: 'enhance-section-label' }, '필요 재료'),
            el('div', { class: 'enhance-cost-row' },
                enhCostItem('강화석', comma(data.cost.stone) + '개', comma(data.stoneCount) + '개 보유', data.hasStone),
                enhCostItem('🪙 골드', comma(data.cost.gold), comma(data.gold) + ' 보유', data.hasGold)
            ),
            ...protectNodes
        ),
        el('div', { class: 'enhance-footer' },
            el('button', { class: 'enhance-cancel-btn', onclick: closeEnhanceModal }, '닫기'),
            confirmBtn
        )
    );
}

function enhRateChip(kind, label, value) {
    return el('div', { class: 'enhance-rate-chip ' + kind },
        el('div', { class: 'rate-label' }, label),
        el('div', { class: 'rate-val' }, Math.round(value * 1000) / 10 + '%')
    );
}

function enhCostItem(name, need, have, ok) {
    return el('div', { class: 'enhance-cost-item ' + (ok ? 'ok' : 'lack') },
        el('div', { class: 'enhance-cost-text' },
            el('div', { class: 'enhance-cost-name' }, name),
            el('div', { class: 'enhance-cost-val' }, need)
        ),
        el('div', { style: 'font-size:10px;color:' + (ok ? '#86efac' : '#fca5a5') + ';font-weight:700;white-space:nowrap' }, have)
    );
}

async function runEnhancement(number) {
    if (enhanceState.busy) return;
    enhanceState.busy = true;
    const btn = $('#enhanceConfirmBtn');
    if (btn) btn.disabled = true;
    const itemInfo = enhanceState.preview ? { name: enhanceState.preview.name, iconUrl: enhanceState.preview.iconUrl, frameUrl: enhanceState.preview.frameUrl } : {};
    try {
        const data = await postApi('/api/equipment/upgrade/run', { number });
        enhanceState.busy = false;
        if (data.profile) renderProfile(data.profile);
        showEnhanceResult(data.resultKind, data.message, number, data.preview, data.appliedDiffs || [], itemInfo);
    } catch (e) {
        enhanceState.busy = false;
        if (btn) { btn.disabled = false; }
        alert(e.message);
    }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, ...children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    children.forEach(c => { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
}

const SPARKLE_PATH = 'M0,-10 L2.2,-2.2 L10,0 L2.2,2.2 L0,10 L-2.2,2.2 L-10,0 L-2.2,-2.2 Z';

// 무기 둘레로 흩뿌려지는 반짝임 파티클 SVG 레이어
function buildSparkleLayer(count, colors) {
    const svg = svgEl('svg', { class: 'enh-fx-sparkles', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 46 + Math.random() * 38;
        const x = 100 + Math.cos(ang) * dist;
        const y = 100 + Math.sin(ang) * dist;
        const sc = 0.5 + Math.random() * 0.9;
        const color = colors[i % colors.length];
        const g = svgEl('g', { class: 'enh-sparkle', style: 'transform-origin:' + x + 'px ' + y + 'px;animation-delay:' + (Math.random() * 0.9).toFixed(2) + 's' });
        g.appendChild(svgEl('path', { d: SPARKLE_PATH, fill: color, transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + sc.toFixed(2) + ')' }));
        svg.appendChild(g);
    }
    return svg;
}

// 중심에서 방사형으로 터지는 광선 SVG (성공/대성공)
function buildRayLayer(count, color) {
    const svg = svgEl('svg', { class: 'enh-fx-rays', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    const grp = svgEl('g', { class: 'enh-rays-spin', style: 'transform-origin:100px 100px' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        const x2 = 100 + Math.cos(ang) * 96;
        const y2 = 100 + Math.sin(ang) * 96;
        grp.appendChild(svgEl('line', { x1: 100, y1: 100, x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: color, 'stroke-width': (1 + (i % 2)).toString(), 'stroke-linecap': 'round', opacity: '0.85' }));
    }
    svg.appendChild(grp);
    return svg;
}

// 무기가 부서질 때 사방으로 튀는 파편 SVG (파괴)
function buildShardLayer(count) {
    const svg = svgEl('svg', { class: 'enh-fx-shards', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 70 + Math.random() * 50;
        const dx = (Math.cos(ang) * dist).toFixed(1);
        const dy = (Math.sin(ang) * dist).toFixed(1);
        const rot = (Math.random() * 540 - 270).toFixed(0);
        const s = 5 + Math.random() * 7;
        const shade = ['#94a3b8', '#cbd5e1', '#64748b', '#e2e8f0'][i % 4];
        const poly = svgEl('polygon', { points: '0,' + (-s).toFixed(1) + ' ' + (s * 0.8).toFixed(1) + ',' + (s * 0.6).toFixed(1) + ' ' + (-s * 0.7).toFixed(1) + ',' + (s * 0.7).toFixed(1), fill: shade });
        const g = svgEl('g', { class: 'enh-shard', style: '--dx:' + dx + 'px;--dy:' + dy + 'px;--rot:' + rot + 'deg;transform-origin:100px 100px;animation-delay:' + (Math.random() * 0.12).toFixed(2) + 's' });
        g.appendChild(svgEl('g', { transform: 'translate(100 100)' }, poly));
        svg.appendChild(g);
    }
    return svg;
}

function showEnhanceWarning(onConfirm) {
    const ov = $('#enhanceResultOverlay');
    ov.replaceChildren(
        el('div', { class: 'enh-warn-icon' }, '⚠️'),
        el('div', { class: 'enh-warn-title' }, '장비가 파괴될 수 있습니다'),
        el('div', { class: 'enh-warn-sub' }, '보호권 없이 강화하면 실패 시 장비가 사라집니다. 진행하시겠습니까?'),
        el('div', { class: 'enh-warn-actions' },
            el('button', { class: 'enhance-cancel-btn', onclick: () => ov.classList.remove('active') }, '취소'),
            el('button', { class: 'enh-warn-confirm', onclick: () => { ov.classList.remove('active'); onConfirm(); } }, '진행')
        )
    );
    ov.classList.add('active');
}

function showEnhanceResult(kind, message, number, nextPreview, appliedDiffs, itemInfo) {
    const lines = (message || '').split('\n');
    let headline = lines[0] || '';
    const sub = lines.slice(1).join('  ').trim();
    if (kind === 'protected') {
        if (message.includes('초기화')) headline = '파괴 방어 초기화';
        else if (message.includes('파괴')) headline = '파괴 방어';
        else if (message.includes('하락')) headline = '하락 방어';
    }
    const resultOverlay = $('#enhanceResultOverlay');
    const info = itemInfo || {};

    // 무기 썸네일
    const thumbParts = [];
    if (info.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: info.frameUrl, alt: '' }));
    if (info.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: info.iconUrl, alt: info.name || '' }));
    const weapon = el('div', { class: 'enh-fx-weapon' }, el('div', { class: 'auc-thumb square' }, ...thumbParts));

    // 결과 종류별 이펙트 레이어 구성
    const fxLayers = [el('div', { class: 'enh-fx-aura' })];
    if (kind === 'great') {
        fxLayers.push(buildRayLayer(16, '#fde68a'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(16, ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#f0abfc', '#fbbf24']));
    } else if (kind === 'success') {
        fxLayers.push(buildRayLayer(12, 'rgba(186,230,253,.7)'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(11, ['#e0f2fe', '#bae6fd', '#ffffff']));
    } else if (kind === 'destroy') {
        fxLayers.push(weapon);
        fxLayers.push(buildShardLayer(14));
    } else if (kind === 'protected') {
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(8, ['#a5b4fc', '#c7d2fe', '#e0e7ff']));
    } else { // down / fail
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(6, ['#fca5a5', '#fecaca']));
    }
    const fxStage = el('div', { class: 'enh-fx ' + kind }, ...fxLayers);

    // 차례차례 등장하는 스탯 변화
    const diffs = Array.isArray(appliedDiffs) ? appliedDiffs : [];
    const FX_DURATION = 1.25; // 이펙트 후 스탯 등장 시작 (초)
    const STEP = 0.28;
    const statsBox = el('div', { class: 'enh-result-stats' });
    diffs.forEach((d, i) => {
        const row = el('div', { class: 'enh-result-stat-row ' + (d.improved ? 'up' : 'down'), style: 'animation-delay:' + (FX_DURATION + i * STEP).toFixed(2) + 's' },
            el('span', { class: 'enh-result-stat-label' }, d.label),
            el('span', { class: 'enh-result-stat-val' }, d.after,
                el('span', { class: 'enh-result-stat-delta' }, ' (' + d.delta + ')'))
        );
        statsBox.appendChild(row);
    });

    const btnDelay = (FX_DURATION + diffs.length * STEP + 0.15).toFixed(2);
    const confirmBtn = el('button', {
        class: 'enh-result-confirm ' + kind,
        style: 'animation-delay:' + btnDelay + 's',
        onclick: () => {
            resultOverlay.classList.remove('active');
            if (nextPreview && !nextPreview.error) {
                enhanceState.preview = nextPreview;
                renderEnhancePreview(nextPreview);
            } else {
                closeEnhanceModal();
            }
        }
    }, '확인');

    resultOverlay.replaceChildren(
        fxStage,
        el('div', { class: 'enh-result-headline ' + kind }, headline),
        ...(sub ? [el('div', { class: 'enhance-result-sub' }, sub)] : []),
        statsBox,
        confirmBtn
    );
    resultOverlay.classList.add('active');
}

function closeEnhanceModal() {
    $('#enhanceOverlay').classList.remove('active');
    document.body.style.overflow = '';
    enhanceState.preview = null;
    enhanceState.busy = false;
    loadInventory('equipment').catch(() => {});
}

function buildCombineStage() {
    const stage = $('#combineStage');
    if (!stage) return;
    stage.style.backgroundImage = 'url(' + combineUi('원본.png') + ')';
    const mkSlot = (cls) => el('div', { class: 'combine-slot ' + cls + ' empty' },
        el('img', { class: 'slot-card', alt: '' })
    );
    const lucky = mkSlot('lucky');
    const result = mkSlot('result');
    const m = [mkSlot('m0'), mkSlot('m1'), mkSlot('m2')];
    lucky.classList.add('clickable');
    lucky.onclick = onLuckyClick;
    m.forEach((slot, i) => slot.onclick = () => removeFromSlotByIndex(i));
    const btn = el('button', { class: 'combine-btn', id: 'combineBtn', onclick: submitCombine });
    btn.style.backgroundImage = 'url(' + combineUi('조합버튼.png') + ')';
    const effect = el('img', { class: 'combine-effect', id: 'combineEffect', alt: '', style: 'display:none' });
    stage.replaceChildren(lucky, result, m[0], m[1], m[2], btn, effect);
    combineState.slotEls = { lucky, result, m };
    combineState.built = true;
}

function renderCombineStage() {
    if (!combineState.built) buildCombineStage();
    const els = combineState.slotEls;
    if (!els) return;
    combineState.slots.forEach((card, i) => {
        const slot = els.m[i];
        const img = slot.querySelector('.slot-card');
        slot.classList.add('clickable');
        if (card) { img.src = card.imageUrl; slot.classList.remove('empty'); }
        else { img.removeAttribute('src'); slot.classList.add('empty'); }
    });
    const limg = els.lucky.querySelector('.slot-card');
    if (combineState.protectIndex != null && combineState.slots[combineState.protectIndex]) {
        limg.src = combineUi((combineState.slots[combineState.protectIndex].star + 1) + '성 보호카드.png');
        els.lucky.classList.remove('empty');
    } else { limg.removeAttribute('src'); els.lucky.classList.add('empty'); }
    const rimg = els.result.querySelector('.slot-card');
    if (combineState.result) { rimg.src = combineState.result.imageUrl; els.result.classList.remove('empty'); }
    else { rimg.removeAttribute('src'); els.result.classList.add('empty'); }
    const btn = $('#combineBtn');
    if (btn) btn.disabled = !(combineState.slots.every(Boolean) && !combineState.busy);
    renderCombineInfo();
    renderCombinePool();
}

function renderCombineInfo() {
    const info = $('#combineInfo');
    if (!info) return;
    const grade = combineGrade();
    const filled = combineState.slots.filter(Boolean).length;
    if (grade == null) { info.textContent = '같은 등급의 캐릭터 카드 3장을 선택하세요.'; return; }
    const t = combineState.meta.table[grade];
    const lines = [];
    if (t) {
        let s = (grade + 1) + '성 조합 · 성공 확률 ' + (Math.round(t.rate * 1000) / 10) + '% · 필요 골드 🪙 ' + comma(t.gold);
        if (t.guarantee) s += ' · 보정 ' + comma(t.count) + '/' + comma(t.guarantee);
        lines.push(s);
    } else lines.push('이 등급은 조합할 수 없습니다.');
    lines.push('선택 ' + filled + '/3' + (combineState.protectIndex != null ? ' · 🛡️ ' + (combineState.protectIndex + 1) + '번째 재료 보호' : ''));
    info.replaceChildren(...lines.map(l => el('div', null, l)));
}

function renderCombinePool() {
    const pool = $('#combinePool');
    if (!pool) return;
    if (!combineState.cards.length) { pool.replaceChildren(el('div', { class: 'empty' }, '보유한 캐릭터 카드가 없습니다.')); return; }
    const grade = combineGrade();
    const used = new Set(combineState.slots.filter(Boolean).map(c => c.number));
    pool.replaceChildren(...combineState.cards.map(card => {
        const selected = used.has(card.number);
        const disabled = !selected && (!card.combinable || (grade != null && card.star != grade));
        const node = cardNode(card, true, null);
        node.classList.add('combine-pool-card');
        if (selected) node.classList.add('selected');
        else if (disabled) node.classList.add('disabled');
        node.onclick = () => {
            if (combineState.busy) return;
            if (selected) removeFromSlotByNumber(card.number);
            else if (!disabled) addCardToSlot(card);
        };
        return node;
    }));
}

function addCardToSlot(card) {
    const grade = combineGrade();
    if (!card.combinable) { alert('이 등급은 조합할 수 없습니다.'); return; }
    if (grade != null && card.star != grade) { alert('같은 등급의 카드끼리만 조합할 수 있습니다.'); return; }
    if (combineState.slots.some(c => c && c.number === card.number)) return;
    const idx = combineState.slots.findIndex(c => !c);
    if (idx === -1) { alert('재료 슬롯이 가득 찼습니다.'); return; }
    combineState.slots[idx] = card;
    combineState.result = null;
    renderCombineStage();
}

function removeFromSlotByIndex(i) {
    if (combineState.busy || !combineState.slots[i]) return;
    combineState.slots[i] = null;
    if (combineState.protectIndex === i) combineState.protectIndex = null;
    combineState.result = null;
    renderCombineStage();
}

function removeFromSlotByNumber(number) {
    const idx = combineState.slots.findIndex(c => c && c.number === number);
    if (idx !== -1) removeFromSlotByIndex(idx);
}

function onLuckyClick() {
    if (combineState.busy) return;
    if (!combineState.slots.every(Boolean)) { alert('재료 카드 3장을 먼저 선택하세요.'); return; }
    const grade = combineGrade();
    if (!combineState.meta.protect[grade]) { alert('이 등급에 사용할 수 있는 보호 카드가 없습니다.'); return; }
    openProtectModal(grade);
}

function openProtectModal(grade) {
    openModal('보호 카드 사용', (grade + 1) + '성 · 조합 실패 시 보존할 재료를 선택하세요', []);
    const body = $('#modalBody');
    body.replaceChildren(el('img', { src: combineUi((grade + 1) + '성 보호카드.png'), alt: '', style: 'width:96px;display:block;margin:0 auto 14px' }));
    combineState.slots.forEach((card, i) => {
        const row = el('div', { class: 'stat-line', style: 'cursor:pointer;display:flex;align-items:center;gap:10px' },
            card.imageUrl ? el('img', { src: card.imageUrl, alt: '', style: 'width:34px;border-radius:4px' }) : null,
            el('span', null, (i + 1) + '번째 재료 · ' + card.formatted)
        );
        if (combineState.protectIndex === i) row.style.borderColor = '#fbbf24';
        row.onclick = () => { combineState.protectIndex = i; closeModal(); renderCombineStage(); };
        body.appendChild(row);
    });
    body.appendChild(el('button', { class: 'close', onclick: () => { combineState.protectIndex = null; closeModal(); renderCombineStage(); } }, '보호 사용 안 함'));
}

function playCombineEffect() {
    const eff = $('#combineEffect');
    if (!eff) return;
    eff.src = combineUi('조합-이펙트.gif') + '&t=' + Date.now();
    eff.style.display = '';
    setTimeout(() => { eff.style.display = 'none'; }, 1500);
}

async function submitCombine() {
    if (combineState.busy || !combineState.slots.every(Boolean)) return;
    combineState.busy = true;
    const btn = $('#combineBtn');
    if (btn) btn.disabled = true;
    const payload = { numbers: combineState.slots.map(c => c.number) };
    if (combineState.protectIndex != null) payload.protectIndex = combineState.protectIndex;
    try {
        const data = await postApi('/api/combine', payload);
        playCombineEffect();
        setTimeout(() => {
            combineState.cards = data.cards || [];
            combineState.meta = data.meta || combineState.meta;
            combineState.slots = [null, null, null];
            combineState.protectIndex = null;
            combineState.result = data.resultCard || null;
            combineState.busy = false;
            renderCombineStage();
            if (data.profile) renderProfile(data.profile);
            renderCombineResult(data);
        }, 1500);
    } catch (e) {
        combineState.busy = false;
        renderCombineStage();
        alert(e.message);
    }
}

function renderCombineResult(data) {
    const info = $('#combineInfo');
    if (!info) return;
    const success = !!data.success;
    const msg = typeof data.message === 'string' ? data.message : '';
    const guaranteed = msg.indexOf('확정') !== -1;
    const rc = data.resultCard;
    const headline = guaranteed ? '⚜️ 확정 조합 성공!' : (success ? '🌟 조합 성공!' : '조합 완료');
    const notes = msg.split('\n').filter(l => l.indexOf('🛡️') !== -1).map(l => l.replace(/^[-\s]*/, ''));
    info.replaceChildren(el('div', { class: 'combine-result ' + (success ? 'ok' : 'fail') },
        el('div', { class: 'combine-result-head' }, headline),
        rc ? el('div', { class: 'combine-result-card' },
            rc.imageUrl ? el('img', { class: 'combine-result-img', src: rc.imageUrl, alt: rc.formatted || rc.name }) : null,
            el('div', { class: 'combine-result-name' }, rc.formatted || rc.name || '')
        ) : null,
        ...notes.map(n => el('div', { class: 'combine-result-note' }, n))
    ));
}

async function loadCombine() {
    try {
        const data = await api('/api/combine/cards');
        combineState.cards = data.cards || [];
        combineState.meta = data.meta || { table: {}, protect: {}, gold: 0 };
        combineState.slots = [null, null, null];
        combineState.protectIndex = null;
        combineState.result = null;
        combineState.busy = false;
        renderCombineStage();
    } catch (e) {
        combineState.built = false;
        const stage = $('#combineStage');
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 경매장 =====

const AUCTION_KIND_ICON = { 'card': '🃏', 'equipment': '⚔️', 'item': '📦', 'pet': '🐾' };
const AUCTION_KIND_LABEL = { 'card': '카드', 'equipment': '장비', 'item': '아이템', 'pet': '펫' };
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
    if (d.soul && d.soul.expiredAt) {
        const soulText = formatSoulRemaining(d.soul.expiredAt);
        if (soulText) content.push(el('div', { class: 'stat-line', style: 'opacity:0.85;font-style:italic' }, soulText));
    }
    const aucPotBlock = potentialBlockNode(d.potentialDisplay);
    if (aucPotBlock) content.push(aucPotBlock);
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

// ===== 상점 =====

const SHOP_CURR_IMGS = {
    gold:   '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png'),
    garnet: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png'),
    point:  '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('포인트.png'),
};
const SHOP_CURR_LABELS = { gold: '골드', garnet: '가넷', point: '포인트', mileage: '마일리지', item: '아이템' };

let shopData = null;
let shopTab = null;

function shopCurrNode(goods, size) {
    const sz = size || 18;
    if (goods === 'mileage') return el('span', { style: 'font-size:' + Math.round(sz * 0.9) + 'px;line-height:1;flex-shrink:0;display:block;font-style:normal' }, 'Ⓜ️');
    if (SHOP_CURR_IMGS[goods]) return el('img', { src: SHOP_CURR_IMGS[goods], alt: goods, style: 'width:' + sz + 'px;height:' + sz + 'px;object-fit:contain;display:block;flex-shrink:0' });
    return el('span', { style: 'font-size:' + sz + 'px;flex-shrink:0' }, '💰');
}

function buildShopThumb(display, cls) {
    const wrap = el('div', { class: cls || 'shop-card-thumb' });
    if (display.isCurrency && display.iconUrl) {
        wrap.appendChild(el('img', { class: 'shop-card-thumb-curr', src: display.iconUrl, alt: '' }));
    } else if (display.frameUrl || display.iconUrl) {
        if (display.frameUrl) wrap.appendChild(el('img', { class: 'shop-card-thumb-frame', src: display.frameUrl, alt: '' }));
        if (display.iconUrl) wrap.appendChild(el('img', { class: 'shop-card-thumb-icon', src: display.iconUrl, alt: '' }));
    } else {
        const fb = svgIcon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`);
        fb.style.cssText = 'width:32px;height:32px;display:block;opacity:.6;position:relative;z-index:2;color:#818cf8';
        wrap.appendChild(fb);
    }
    return wrap;
}

function priceItemImg(price, size) {
    const sz = size || 20;
    if (!price.iconUrl) return null;
    return el('img', { src: price.iconUrl, alt: '', style: 'width:' + sz + 'px;height:' + sz + 'px;object-fit:contain;display:block;flex-shrink:0' });
}

function buildPriceNode(price) {
    const wrap = el('div', { class: 'shop-card-price' });
    if (price.goods === 'item') {
        const img = priceItemImg(price, 20);
        if (img) wrap.appendChild(img);
        wrap.appendChild(el('span', {}, String(price.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    } else {
        wrap.appendChild(shopCurrNode(price.goods, 18));
        wrap.appendChild(el('span', {}, String(price.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    }
    return wrap;
}

function buildReceiptRow(label, price, amount, variant) {
    const row = el('div', { class: 'shop-receipt-row' + (variant ? ' ' + variant : '') });
    row.appendChild(el('span', { class: 'shop-receipt-label' }, label));
    const val = el('div', { class: 'shop-receipt-val' });
    if (price.goods === 'item') {
        const img = priceItemImg(price, 16);
        if (img) val.appendChild(img);
        val.appendChild(el('span', {}, String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    } else {
        val.appendChild(shopCurrNode(price.goods, 16));
        val.appendChild(el('span', {}, String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    }
    row.appendChild(val);
    return row;
}

// rpgenius.js formatShopLimitSuffix와 동일한 방식으로 제한 정보 구성
function buildLimitRows(limitInfo) {
    if (!limitInfo) return [];
    const { limits, rec, globalCount } = limitInfo;
    const rows = [];
    if (typeof limits.max === 'number')     rows.push({ label: '전체',  used: rec.max,    limit: limits.max    });
    if (typeof limits.daily === 'number')   rows.push({ label: '일일',  used: rec.daily,   limit: limits.daily  });
    if (typeof limits.weekly === 'number')  rows.push({ label: '주간',  used: rec.weekly,  limit: limits.weekly });
    if (typeof limits.monthly === 'number') rows.push({ label: '월간',  used: rec.monthly, limit: limits.monthly });
    if (typeof limits.global === 'number')  rows.push({ label: '선착순', used: globalCount, limit: limits.global, isGlobal: true });
    return rows;
}

function buildLimitBadge(limitInfo) {
    const rows = buildLimitRows(limitInfo);
    if (rows.length === 0) return el('span', {});
    const wrap = el('div', { class: 'shop-limit-badge' });
    rows.forEach(r => {
        const remaining = r.limit - r.used;
        const exhausted = remaining <= 0;
        const row = el('div', { class: 'shop-limit-row' + (exhausted ? ' exhausted' : '') });
        row.appendChild(el('span', { class: 'shop-limit-label' }, r.label));
        row.appendChild(el('span', { class: 'shop-limit-val' },
            comma(r.used) + ' / ' + comma(r.limit)
        ));
        wrap.appendChild(row);
    });
    return wrap;
}

function buildLimitDetail(limitInfo) {
    const rows = buildLimitRows(limitInfo);
    if (rows.length === 0) return null;
    const section = el('div', { class: 'shop-limit-detail' });
    section.appendChild(el('div', { class: 'shop-bundle-label' }, '구매 제한'));
    rows.forEach(r => {
        const remaining = r.limit - r.used;
        const exhausted = remaining <= 0;
        const row = el('div', { class: 'shop-limit-detail-row' + (exhausted ? ' exhausted' : '') });
        row.appendChild(el('span', { class: 'shop-limit-detail-label' }, r.label));
        const bar = el('div', { class: 'shop-limit-bar-wrap' });
        const pct = Math.min(100, Math.round((r.used / r.limit) * 100));
        bar.appendChild(el('div', { class: 'shop-limit-bar', style: '--pct:' + pct + '%' }));
        row.appendChild(bar);
        row.appendChild(el('span', { class: 'shop-limit-detail-val' + (exhausted ? ' exhausted' : '') },
            comma(r.used) + ' / ' + comma(r.limit)
        ));
        section.appendChild(row);
    });
    return section;
}

function renderShop(data, tab) {
    shopData = data;
    shopTab = tab || data.tabs[0];
    const body = $('#shopBody');
    body.replaceChildren();

    const tabRow = el('div', { class: 'shop-tabs' });
    data.tabs.forEach(t => {
        const isHot = t === '핫딜샵';
        tabRow.appendChild(el('button', {
            class: 'shop-tab' + (t === shopTab ? ' active' : '') + (isHot ? ' hotdeal' : ''),
            onclick: () => { if (isHot) { shopTab = '핫딜샵'; renderShopTabs(data, body, tabRow); loadHotDeal(body, tabRow); } else renderShop(data, t); }
        }, t));
    });

    if (shopTab === '핫딜샵') { body.appendChild(tabRow); loadHotDeal(body, tabRow); return; }

    const currBar = el('div', { class: 'shop-currency-bar' });
    [{ key: 'gold', label: '골드' }, { key: 'garnet', label: '가넷' }, { key: 'point', label: '포인트' }, { key: 'mileage', label: '마일리지' }].forEach(({ key, label }) => {
        if (data.currencies[key] == null) return;
        const chip = el('div', { class: 'shop-currency-chip' });
        chip.appendChild(shopCurrNode(key, 18));
        chip.appendChild(el('span', { style: 'color:#94a3b8;font-size:12px;margin-right:2px' }, label));
        chip.appendChild(el('span', {}, String(data.currencies[key]).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
        currBar.appendChild(chip);
    });
    const grid = el('div', { class: 'shop-grid' });
    (data.shop[shopTab] || []).forEach(item => {
        const card = el('div', { class: 'shop-card' + (item.soldOut ? ' sold-out' : '') });
        card.appendChild(buildShopThumb(item.display));
        card.appendChild(el('div', { class: 'shop-card-name' }, item.display.name));
        card.appendChild(buildPriceNode(item.price));
        if (item.limitInfo) {
            card.appendChild(buildLimitBadge(item.limitInfo));
        }
        card.appendChild(el('button', { class: 'shop-card-btn', onclick: e => { e.stopPropagation(); openShopBuyModal(item); } }, item.soldOut ? '품절' : '구매'));
        if (item.soldOut) card.appendChild(el('span', { class: 'shop-sold-badge' }, '품절'));
        card.onclick = () => { if (!item.soldOut) openShopBuyModal(item); };
        grid.appendChild(card);
    });
    if ((data.shop[shopTab] || []).length === 0) grid.appendChild(el('div', { class: 'empty' }, '상품이 없습니다.'));

    body.appendChild(tabRow);
    body.appendChild(currBar);
    body.appendChild(grid);
}

function openShopBuyModal(item) {
    const d = item.display;
    const p = item.price;
    const li = item.limitInfo;
    const isPackage = shopTab === '패키지';

    // 최대 구매 가능 수량 계산 (모든 제한 타입 반영)
    let maxQty = 999;
    if (li && li.remaining) {
        const r = li.remaining;
        ['max', 'global', 'daily', 'weekly', 'monthly'].forEach(k => {
            if (typeof r[k] === 'number') maxQty = Math.min(maxQty, r[k]);
        });
    }
    if (p.goods !== 'item' && shopData) {
        const bal = shopData.currencies[p.goods] || 0;
        if (p.amount > 0) maxQty = Math.min(maxQty, Math.floor(bal / p.amount));
    } else if (p.goods === 'item') {
        const have = item.priceItemCount || 0;
        if (p.amount > 0) maxQty = Math.min(maxQty, Math.floor(have / p.amount));
    }
    maxQty = Math.max(0, maxQty);

    let qty = Math.min(1, maxQty || 1);
    const content = el('div', { class: 'shop-buy-modal' });

    // 아이템 미리보기
    const itemRow = el('div', { class: 'shop-buy-item-row' });
    itemRow.appendChild(buildShopThumb(d, 'shop-buy-thumb'));
    const info = el('div', { style: 'flex:1;min-width:0' });
    info.appendChild(el('div', { class: 'shop-buy-name' }, d.name));
    if (p.goods === 'item') {
        const have = item.priceItemCount ?? 0;
        info.appendChild(el('div', { class: 'shop-buy-meta' }, '보유: ' + comma(have) + '개'));
    }
    itemRow.appendChild(info);
    content.appendChild(itemRow);

    // 구매 제한 (rpgenius.js formatShopLimitSuffix 방식)
    if (li) {
        const det = buildLimitDetail(li);
        if (det) content.appendChild(det);
    }

    // 패키지 번들 내용
    if (isPackage && d.bundleContents && d.bundleContents.length > 0) {
        const sec = el('div', { class: 'shop-bundle-section' });
        sec.appendChild(el('div', { class: 'shop-bundle-label' }, '구성품'));
        const list = el('div', { class: 'shop-bundle-list' });
        d.bundleContents.forEach(bc => {
            const row = el('div', { class: 'shop-bundle-row' });
            const mini = el('div', { class: 'shop-bundle-mini' });
            if (bc.imgUrl) {
                mini.appendChild(el('img', { src: bc.imgUrl, style: 'width:100%;height:100%;object-fit:contain' }));
            } else {
                if (bc.frameUrl) mini.appendChild(el('img', { src: bc.frameUrl, style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1' }));
                if (bc.iconUrl) mini.appendChild(el('img', { src: bc.iconUrl, style: 'width:75%;height:75%;object-fit:contain;position:relative;z-index:2' }));
            }
            row.appendChild(mini);
            row.appendChild(el('span', { class: 'shop-bundle-name' }, bc.name));
            row.appendChild(el('span', { class: 'shop-bundle-count' }, '×' + bc.count));
            list.appendChild(row);
        });
        sec.appendChild(list);
        content.appendChild(sec);
    }

    // 수량 입력
    const qtyRow = el('div', { class: 'shop-qty-row' });
    qtyRow.appendChild(el('span', { class: 'shop-qty-label' }, '구매 수량'));
    const qtyMinus = el('button', { class: 'shop-qty-btn', onclick: () => { qty = Math.max(1, qty - 1); qtyInput.value = qty; updateReceipt(); } }, '−');
    const qtyInput = el('input', { type: 'number', class: 'shop-qty-input', value: String(qty), min: '1', max: String(maxQty > 0 ? maxQty : 1) });
    qtyInput.oninput = () => { qty = Math.max(1, Math.min(maxQty || 1, parseInt(qtyInput.value) || 1)); qtyInput.value = qty; updateReceipt(); };
    const qtyPlus = el('button', { class: 'shop-qty-btn', onclick: () => { qty = Math.min(maxQty > 0 ? maxQty : 1, qty + 1); qtyInput.value = qty; updateReceipt(); } }, '+');
    qtyRow.appendChild(qtyMinus);
    qtyRow.appendChild(qtyInput);
    qtyRow.appendChild(qtyPlus);
    qtyRow.appendChild(el('span', { class: 'shop-qty-max' }, '최대 ' + (maxQty > 0 ? maxQty : '-')));
    content.appendChild(qtyRow);

    // 계산서
    const receipt = el('div', { class: 'shop-receipt' });
    content.appendChild(receipt);

    function updateReceipt() {
        receipt.replaceChildren();
        const totalCost = p.amount * qty;
        let bal;
        if (p.goods === 'item') {
            bal = item.priceItemCount || 0;
        } else {
            bal = (shopData && shopData.currencies[p.goods]) || 0;
        }
        const after = bal - totalCost;
        receipt.appendChild(buildReceiptRow('현재 보유', p, bal));
        receipt.appendChild(buildReceiptRow('소모', p, totalCost, 'deduct'));
        receipt.appendChild(el('div', { class: 'shop-receipt-divider' }));
        receipt.appendChild(buildReceiptRow('구매 후 잔액', p, after, after < 0 ? 'neg' : 'result'));
    }
    updateReceipt();

    // 버튼
    const footer = el('div', { class: 'shop-buy-footer' });
    footer.appendChild(el('button', { onclick: closeModal }, '취소'));
    const buyBtn = el('button', { class: 'primary', onclick: async () => {
        if (qty < 1) return;
        buyBtn.disabled = true;
        buyBtn.textContent = '처리 중...';
        try {
            const r = await fetch('/api/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopType: shopTab, index: item.index, count: qty }) });
            const res = await r.json();
            if (!r.ok) throw new Error(res.error || '구매 실패');
            if (shopData) shopData.currencies = res.currencies;
            closeModal();
            await loadShop();
        } catch (e) {
            buyBtn.disabled = false;
            buyBtn.textContent = '구매';
            alert(e.message);
        }
    }}, '구매');
    footer.appendChild(buyBtn);
    content.appendChild(footer);

    $('#modalTitle').textContent = d.name + ' 구매';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

function renderShopTabs(data, body, tabRow) {
    tabRow.querySelectorAll('.shop-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === shopTab);
    });
}

let hotdealCountdownTimer = null;
function stopHotdealCountdown() { if (hotdealCountdownTimer) { clearInterval(hotdealCountdownTimer); hotdealCountdownTimer = null; } }

async function loadHotDeal(body, tabRow) {
    stopHotdealCountdown();
    const existing = body.querySelector('.hd-root');
    if (!existing) body.appendChild(el('div', { class: 'hd-root' }, el('div', { class: 'loading', style: 'padding:40px 0;text-align:center' }, '불러오는 중...')));
    try {
        const data = await api('/api/hotdeal');
        if (shopTab !== '핫딜샵') return;
        renderHotDeal(data, body, tabRow);
    } catch (e) {
        if (shopTab !== '핫딜샵') return;
        const root = body.querySelector('.hd-root') || body;
        root.replaceChildren(el('div', { class: 'empty err', style: 'padding:40px 0;text-align:center' }, e.message));
    }
}

function renderHotDeal(data, body, tabRow) {
    stopHotdealCountdown();

    const currencyBar = el('div', { class: 'hd-currency-bar' });
    [{ key: 'gold', label: '골드' }, { key: 'garnet', label: '가넷' }].forEach(({ key, label }) => {
        if (data.currencies[key] == null) return;
        const chip = el('div', { class: 'shop-currency-chip' });
        chip.appendChild(shopCurrNode(key, 18));
        chip.appendChild(el('span', { style: 'color:#94a3b8;font-size:12px;margin-right:2px' }, label));
        chip.appendChild(el('span', {}, comma(data.currencies[key])));
        currencyBar.appendChild(chip);
    });

    const countdownEl = el('span');
    function updateCountdown() {
        const rem = Math.max(0, data.nextRefreshAt - Date.now());
        const h = String(Math.floor(rem / 3600000)).padStart(2, '0');
        const m = String(Math.floor((rem % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((rem % 60000) / 1000)).padStart(2, '0');
        countdownEl.replaceChildren('다음 교체까지 ', el('span', null, h + ':' + m + ':' + s));
        if (rem <= 0) { stopHotdealCountdown(); loadHotDeal(body, tabRow); }
    }
    updateCountdown();
    hotdealCountdownTimer = setInterval(updateCountdown, 1000);

    const slots = el('div', { class: 'hd-slots' });
    data.items.forEach(item => {
        const isLightning = item.slot === 1;
        const slot = el('div', { class: 'hd-slot ' + (isLightning ? 'lightning' : 'fire') });

        // 불꽃/번개 파티클 요소
        if (isLightning) {
            for (let i = 0; i < 3; i++) slot.appendChild(el('div', { class: 'hd-slot-spark' }));
        } else {
            const embers = [['4px','-28px'], ['-3px','-35px'], ['5px','-30px']];
            embers.forEach(([ex, ey]) => {
                const e2 = el('div', { class: 'hd-slot-ember' });
                e2.style.setProperty('--ex', ex);
                e2.style.setProperty('--ey', ey);
                slot.appendChild(e2);
            });
        }

        const inner = el('div', { class: 'hd-slot-inner' });

        // 썸네일
        const thumb = el('div', { class: 'hd-item-thumb auc-thumb square' });
        if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
        if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
        if (item.purchased) {
            const sold = el('div', { class: 'hd-sold' });
            sold.appendChild(el('div', { class: 'hd-sold-text' }, '구매 완료'));
            thumb.appendChild(sold);
        }
        inner.appendChild(thumb);
        inner.appendChild(el('div', { class: 'hd-item-name' }, item.name));

        const priceRow = el('div', { class: 'hd-price-row' });
        if (item.price.imgUrl) priceRow.appendChild(el('img', { class: 'hd-price-img', src: item.price.imgUrl, alt: item.price.goods }));
        priceRow.appendChild(el('div', { class: 'hd-price-val' }, comma(item.price.amount) + (item.price.goods === 'garnet' ? ' 가넷' : ' 골드')));
        inner.appendChild(priceRow);

        const btn = el('button', {
            class: 'hd-buy-btn',
            disabled: item.purchased,
            onclick: item.purchased ? null : () => openHotDealBuyModal(item, data, body, tabRow)
        }, item.purchased ? '구매 완료' : '구매');
        inner.appendChild(btn);

        slot.appendChild(inner);
        slots.appendChild(slot);
    });

    const root = el('div', { class: 'hd-root' },
        el('div', { class: 'hd-header' },
            el('div', { class: 'hd-title' }, el('span', { class: 'hd-title-fire' }, '🔥'), '핫딜 SHOP', el('span', { class: 'hd-title-fire2' }, '🔥')),
            el('div', { class: 'hd-meta' },

                el('div', { class: 'hd-countdown' }, countdownEl)
            )
        ),
        currencyBar,
        slots
    );

    body.replaceChildren(tabRow, root);
}

function openHotDealBuyModal(item, hdData, body, tabRow) {
    const p = item.price;
    const bal = hdData.currencies[p.goods] || 0;
    const after = bal - p.amount;

    const content = el('div', { class: 'shop-buy-modal' });
    const itemRow = el('div', { class: 'shop-buy-item-row' });
    const thumb = el('div', { class: 'shop-buy-thumb' });
    if (item.frameUrl) thumb.appendChild(el('img', { class: 'shop-card-thumb-frame', src: item.frameUrl, alt: '' }));
    if (item.iconUrl) thumb.appendChild(el('img', { class: 'shop-card-thumb-icon', src: item.iconUrl, alt: item.name }));
    itemRow.appendChild(thumb);
    const info = el('div', { style: 'flex:1;min-width:0' });
    info.appendChild(el('div', { class: 'shop-buy-name' }, item.name));
    info.appendChild(el('div', { class: 'shop-buy-meta' }, '핫딜 1회 한정'));
    itemRow.appendChild(info);
    content.appendChild(itemRow);

    const receipt = el('div', { class: 'shop-receipt' });
    const pFull = { goods: p.goods, amount: p.amount, imgUrl: p.imgUrl };
    receipt.appendChild(buildReceiptRow('현재 보유', pFull, bal));
    receipt.appendChild(buildReceiptRow('소모', pFull, p.amount, 'deduct'));
    receipt.appendChild(el('div', { class: 'shop-receipt-divider' }));
    receipt.appendChild(buildReceiptRow('구매 후 잔액', pFull, after, after < 0 ? 'neg' : 'result'));
    content.appendChild(receipt);

    const footer = el('div', { class: 'shop-buy-footer' });
    footer.appendChild(el('button', { onclick: closeModal }, '취소'));
    const buyBtn = el('button', { class: 'primary', onclick: async () => {
        buyBtn.disabled = true; buyBtn.textContent = '처리 중...';
        try {
            const res = await postApi('/api/hotdeal/buy', { slot: item.slot });
            closeModal();
            renderHotDeal(res.hotdeal, body, tabRow);
        } catch (e) {
            buyBtn.disabled = false; buyBtn.textContent = '구매';
            alert(e.message);
        }
    }}, '구매');
    footer.appendChild(buyBtn);
    content.appendChild(footer);

    $('#modalTitle').textContent = item.name + ' 구매';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

async function loadShop() {
    const body = $('#shopBody');
    body.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const r = await fetch('/api/shop');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '오류');
        renderShop(data, shopTab && (data.shop[shopTab] ? shopTab : null));
    } catch (e) {
        body.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 경매 등록 =====

const REG_ICONS = {
    card:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="19" rx="2"/><path d="M7 7h6"/><path d="M7 11h6"/><path d="M7 15h4"/><path d="M18 8v13a2 2 0 0 1-2 2H6"/></svg>`,
    equipment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    item:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>`,
    pet:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>`,
};
const REG_CHK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const REG_SLOT_SVGS = {
    weapon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    armor:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    accessory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/></svg>`,
    support:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};
function regCurrImg(c) {
    const file = c === 'gold' ? '골드.png' : '가넷.png';
    return el('img', { src: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(file), alt: c, style: 'width:22px;height:22px;object-fit:contain;display:block;flex-shrink:0' });
}
function buildRegItemThumb(item, kind) {
    if (kind === 'card') {
        return el('div', { class: 'reg-thumb' }, item.imageUrl ? el('img', { class: 'reg-card-img', src: item.imageUrl, alt: '' }) : svgIcon(REG_ICONS.card));
    }
    const wrap = el('div', { class: 'reg-thumb sq' });
    if (item.frameUrl) wrap.appendChild(el('img', { class: 'reg-thumb-frame', src: item.frameUrl, alt: '' }));
    if (item.iconUrl) wrap.appendChild(el('img', { class: 'reg-thumb-icon', src: item.iconUrl, alt: '' }));
    else {
        const fallback = kind === 'pet' ? REG_ICONS.pet : kind === 'equipment' ? (REG_SLOT_SVGS[item.type] || REG_SLOT_SVGS.weapon) : REG_ICONS.item;
        wrap.appendChild(svgIcon(fallback));
    }
    return wrap;
}

let regState = { kind: 'card', currency: 'gold', selectedIndex: -1, selectedItemId: -1, sellable: null };

async function openRegisterModal() {
    regState = { kind: 'card', currency: 'gold', selectedIndex: -1, selectedItemId: -1, sellable: null };
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
    if (!data) return;
    const kind = regState.kind;

    const kindRow = el('div', { class: 'reg-kind-row' },
        ...['card', 'equipment', 'item', 'pet'].map(k => el('button', {
            class: 'reg-kind-btn' + (kind === k ? ' active' : ''),
            onclick: () => { regState.kind = k; regState.selectedIndex = -1; regState.selectedItemId = -1; renderRegisterModal(); }
        }, svgIcon(REG_ICONS[k]), AUCTION_KIND_LABEL[k]))
    );

    let pool, emptyMsg;
    if (kind === 'card') { pool = data.cards; emptyMsg = '판매 가능한 카드가 없습니다.'; }
    else if (kind === 'equipment') { pool = data.equipment; emptyMsg = '판매 가능한 장비가 없습니다.\n(미장착 장비만 등록 가능)'; }
    else if (kind === 'pet') { pool = data.pets || []; emptyMsg = '판매 가능한 펫이 없습니다.\n(거래 가능 횟수 1 이상만 등록 가능)'; }
    else { pool = data.items; emptyMsg = '판매 가능한 아이템이 없습니다.'; }

    const pickList = !pool.length
        ? el('div', { class: 'empty', style: 'padding:16px 0' }, emptyMsg)
        : el('div', { class: 'reg-pick-scroll' }, ...pool.map(item => {
            const isSel = kind === 'item' ? regState.selectedItemId === item.id : regState.selectedIndex === item.index;
            let thumbEl, nameText, metaText;
            thumbEl = buildRegItemThumb(item, kind);
            if (kind === 'card') {
                nameText = item.formatted; metaText = item.starText || '';
            } else if (kind === 'equipment') {
                nameText = item.name + (item.level > 0 ? ' +' + item.level : '');
                metaText = item.rarity + ' · ' + item.typeLabel;
                const st = item.soul && item.soul.expiredAt ? formatSoulRemaining(item.soul.expiredAt) : null;
                if (st) metaText += '\n' + st;
            } else if (kind === 'pet') {
                nameText = item.name + (item.level > 0 ? ' +' + item.level : '');
                metaText = item.rarity + ' · 거래 가능 ' + comma(item.tradeCount) + '회';
            } else {
                nameText = item.name; metaText = item.type + ' · 보유 ' + comma(item.count) + '개';
            }
            const infoEl = el('div', null, el('div', { class: 'reg-item-name' }, nameText), el('div', { class: 'reg-item-meta' }, metaText));
            if (kind === 'equipment' && item.potentialDisplay) {
                const pb = potentialBlockNode(item.potentialDisplay);
                if (pb) infoEl.appendChild(pb);
            }
            const checkEl = el('div', { class: 'reg-check' + (isSel ? ' sel' : '') }, isSel ? svgIcon(REG_CHK_SVG) : null);
            return el('div', {
                class: 'reg-pick-row' + (isSel ? ' selected' : ''),
                onclick: () => { if (kind === 'item') regState.selectedItemId = item.id; else regState.selectedIndex = item.index; renderRegisterModal(); }
            }, thumbEl, infoEl, checkEl);
        }));

    const content = [
        el('h3', null, '판매 등록'),
        el('div', { class: 'sub' }, '수수료 5%를 제외하고 판매자에게 입금됩니다.'),
        el('div', { class: 'reg-divider' }),
        el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '종류'),
        kindRow,
        el('div', { class: 'reg-section-label' }, '판매할 ' + AUCTION_KIND_LABEL[kind]),
        pickList,
    ];

    if (kind === 'item') {
        const itemSel = data.items.find(i => i.id === regState.selectedItemId);
        if (itemSel) {
            content.push(el('div', { class: 'reg-section-label' }, '갯수'));
            content.push(el('div', { class: 'reg-count-row' },
                el('input', { type: 'number', id: 'regCount', value: 1, min: 1, max: itemSel.count }),
                el('span', { class: 'reg-count-hint' }, '최대 ' + comma(itemSel.count) + '개')
            ));
        }
    }

    content.push(el('div', { class: 'reg-divider' }));
    content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '결제 수단'));
    content.push(el('div', { class: 'reg-currency-row' },
        ...['gold', 'garnet'].map(c => el('button', {
            class: 'reg-curr-btn ' + c + (regState.currency === c ? ' active' : ''),
            onclick: () => { regState.currency = c; renderRegisterModal(); }
        }, regCurrImg(c), c === 'gold' ? '골드' : '가넷'))
    ));
    content.push(el('div', { class: 'reg-section-label' }, kind === 'item' ? '개당 가격' : '가격'));
    content.push(el('div', { class: 'reg-price-wrap' },
        el('span', { class: 'reg-price-icon' }, regCurrImg(regState.currency)),
        el('input', { type: 'number', id: 'regPrice', class: 'reg-price-field', placeholder: '0', min: 1 })
    ));
    content.push(el('div', { class: 'reg-inline-err', id: 'regErr' }));
    content.push(el('div', { class: 'reg-footer' },
        el('button', { onclick: closeRegister }, '취소'),
        el('button', { class: 'primary', onclick: submitRegister }, '등록하기')
    ));

    $('#aucReg').replaceChildren(...content);
}

function showRegErr(msg) {
    const d = $('#regErr');
    if (d) { d.textContent = msg; d.classList.add('visible'); }
}
async function submitRegister() {
    const kind = regState.kind;
    const currency = regState.currency || 'gold';
    const price = Number($('#regPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) { showRegErr('가격은 1 이상의 정수여야 합니다.'); return; }
    const body = { kind, currency, price };
    if (kind === 'card' || kind === 'equipment' || kind === 'pet') {
        if (regState.selectedIndex < 0) { showRegErr(AUCTION_KIND_LABEL[kind] + '를 선택해주세요.'); return; }
        body.index = regState.selectedIndex;
    } else {
        if (regState.selectedItemId < 0) { showRegErr('아이템을 선택해주세요.'); return; }
        const count = Number($('#regCount') ? $('#regCount').value : 1);
        if (!Number.isInteger(count) || count < 1) { showRegErr('갯수는 1 이상의 정수여야 합니다.'); return; }
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
        showRegErr(e.message);
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
    } else if (entry.kind === 'pet') {
        if (!fulfillable.pets || !fulfillable.pets.length) {
            content.push(el('div', { class: 'empty' }, '조건에 맞는 보유 펫이 없습니다.\n(거래 가능 횟수가 1 이상이어야 합니다)'));
            return;
        }
        const pick = el('div', { class: 'pick-list' });
        fulfillable.pets.forEach(pet => {
            const row = el('div', {
                class: 'pick-row',
                onclick: () => {
                    selectedIndex = pet.index;
                    Array.from(pick.children).forEach(c => c.classList.remove('on'));
                    row.classList.add('on');
                }
            },
                el('div', null, el('b', null, pet.name + (pet.level > 0 ? ' +' + pet.level : '')), el('div', { class: 'meta' }, pet.rarity + ' · 거래 가능 ' + comma(pet.tradeCount) + '회'))
            );
            pick.appendChild(row);
        });
        content.push(el('label', null, '판매할 펫 선택'));
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

let boRegState = { kind: 'card', lookups: null, cardId: -1, star: 0, type: '', skin: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, petId: -1, count: 1, search: '' };

async function openBoRegisterModal() {
    boRegState = { kind: 'card', currency: 'gold', lookups: null, cardId: -1, star: 0, type: '', skin: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, petId: -1, count: 1, search: '' };
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
    if (!data) return;
    const kind = boRegState.kind;

    const kindRow = el('div', { class: 'reg-kind-row' },
        ...['card', 'equipment', 'item', 'pet'].map(k => el('button', {
            class: 'reg-kind-btn' + (kind === k ? ' active' : ''),
            onclick: () => { boRegState.kind = k; boRegState.search = ''; renderBoRegisterModal(); }
        }, svgIcon(REG_ICONS[k]), AUCTION_KIND_LABEL[k]))
    );

    const content = [
        el('h3', null, '구매 등록'),
        el('div', { class: 'sub' }, '등록 시 가격이 선결제되며, 취소 시 미체결 분이 반환됩니다.'),
        el('div', { class: 'reg-divider' }),
        el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '종류'),
        kindRow,
        el('div', { class: 'reg-divider' }),
    ];

    const makeCountInput = () => {
        const inp = el('input', { type: 'number', value: boRegState.count, min: 1 });
        inp.oninput = e => { let v = Math.floor(Number(e.target.value || 1)); if (v < 1) v = 1; boRegState.count = v; e.target.value = v; };
        return el('div', { class: 'reg-count-row' }, inp, el('span', { class: 'reg-count-hint' }, '개'));
    };

    const makeItemGrid = (items, selectedId, onSelect, renderThumb) => {
        const wrap = el('div', { class: 'bo-img-wrap' });
        const inp = el('input', { type: 'search', class: 'bo-search-inp', placeholder: '이름으로 검색...', value: boRegState.search });
        const grid = el('div', { class: 'bo-img-grid' });

        const filterGrid = q => {
            const lower = q.toLowerCase();
            let visible = 0;
            grid.querySelectorAll('.bo-img-cell').forEach(cell => {
                const show = !lower || cell.dataset.name.toLowerCase().includes(lower);
                cell.style.display = show ? '' : 'none';
                if (show) visible++;
            });
            let empty = grid.querySelector('.bo-img-empty');
            if (!visible) {
                if (!empty) { empty = el('div', { class: 'bo-img-empty' }, '검색 결과 없음'); grid.appendChild(empty); }
            } else {
                if (empty) empty.remove();
            }
        };

        inp.oninput = e => { boRegState.search = e.target.value; filterGrid(e.target.value); };

        items.forEach(item => {
            const isSelected = item.id === selectedId;
            const cell = el('div', {
                class: 'bo-img-cell' + (isSelected ? ' selected' : ''),
                onclick: () => { onSelect(item.id); renderBoRegisterModal(); }
            });
            cell.dataset.name = item.name;
            const thumb = el('div', { class: 'bo-img-thumb' });
            renderThumb(thumb, item);
            cell.appendChild(thumb);
            cell.appendChild(el('div', { class: 'bo-img-name' }, item.name));
            grid.appendChild(cell);
        });
        if (!items.length) grid.appendChild(el('div', { class: 'bo-img-empty' }, '항목 없음'));

        wrap.appendChild(inp);
        wrap.appendChild(grid);
        filterGrid(boRegState.search);
        // 렌더 후 포커스 복원
        requestAnimationFrame(() => { if (boRegState.search) inp.focus(); });
        return wrap;
    };

    if (kind === 'card') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '캐릭터 카드'));
        content.push(makeItemGrid(data.cards, boRegState.cardId, id => { boRegState.cardId = id; boRegState.skin = ''; }, (thumb, c) => {
            if (c.imageUrl) thumb.appendChild(el('img', { src: c.imageUrl, alt: c.name }));
            else thumb.appendChild(el('span', { class: 'bo-img-fallback' }, c.name[0]));
        }));

        if (boRegState.cardId >= 0) {
            content.push(el('div', { class: 'reg-section-label' }, '상세 조건'));
            const detailGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' });
            const starSel = el('select', { onchange: e => { boRegState.star = Number(e.target.value); boRegState.skin = ''; renderBoRegisterModal(); } });
            for (let i = 0; i <= 11; i++) {
                const opt = el('option', { value: i }, (i + 1) + '성' + (i >= 4 ? ' (거래권 ' + Math.max(0, i - 3) + '장)' : ''));
                if (boRegState.star === i) opt.selected = true;
                starSel.appendChild(opt);
            }
            const typeSel = el('select', { onchange: e => { boRegState.type = e.target.value; } },
                el('option', { value: '' }, '타입 무관'),
                el('option', { value: '일반', selected: boRegState.type === '일반' ? 'selected' : null }, '일반')
            );
            const starWrap = el('div', null, el('div', { style: 'font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px' }, '성급 (정확 일치)'), starSel);
            const typeWrap = el('div', null, el('div', { style: 'font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px' }, '타입'), typeSel);
            detailGrid.appendChild(starWrap); detailGrid.appendChild(typeWrap);
            content.push(detailGrid);

            const rawStar = Number(boRegState.star || 0);
            const skins = (data.fashion || []).filter(s => Array.isArray(s.primary_card) && s.primary_card.map(Number).includes(Number(boRegState.cardId)) && rawStar >= Number(s.requireStar || 0));
            if (boRegState.skin && !skins.some(s => s.name === boRegState.skin)) boRegState.skin = '';
            if (skins.length > 0) {
                content.push(el('div', { class: 'reg-section-label' }, '패션 (선택)'));
                content.push(el('select', { onchange: e => { boRegState.skin = e.target.value; } },
                    el('option', { value: '' }, '패션 무관'),
                    ...skins.map(s => el('option', { value: s.name, selected: boRegState.skin === s.name ? 'selected' : null }, s.name))
                ));
            }
        }
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else if (kind === 'equipment') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '장비 종류'));
        const equipTypeRow = el('div', { class: 'reg-equip-row' },
            ...[['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구'], ['support', '보조']].map(([k, label]) =>
                el('button', { class: 'reg-equip-btn' + (boRegState.equipType === k ? ' active' : ''),
                    onclick: () => { boRegState.equipType = k; boRegState.equipId = -1; boRegState.search = ''; renderBoRegisterModal(); }
                }, svgIcon(REG_SLOT_SVGS[k]), label)
            )
        );
        content.push(equipTypeRow);
        content.push(el('div', { class: 'reg-section-label' }, '장비'));
        const eqList = data.equipment[boRegState.equipType] || [];
        content.push(makeItemGrid(eqList, boRegState.equipId, id => { boRegState.equipId = id; }, (thumb, eq) => {
            if (eq.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: eq.frameUrl, alt: '' }));
            if (eq.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: eq.iconUrl, alt: eq.name }));
            else if (!eq.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, eq.name[0]));
        }));

        const lvToggle = el('label', { class: 'reg-level-toggle' },
            el('input', { type: 'checkbox', checked: boRegState.levelSpecified ? 'checked' : null,
                onchange: e => { boRegState.levelSpecified = e.target.checked; renderBoRegisterModal(); } }),
            '강화 레벨 지정'
        );
        content.push(lvToggle);
        if (boRegState.levelSpecified) {
            content.push(el('div', { class: 'reg-section-label' }, '강화 레벨 (0~15)'));
            const lvInp = el('input', { type: 'number', value: boRegState.level, min: 0, max: 15, style: 'width:100%;padding:10px 12px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e5e7eb;font-size:15px;font-weight:700;outline:none' });
            lvInp.oninput = e => { let v = Math.max(0, Math.min(15, Math.floor(Number(e.target.value || 0)))); boRegState.level = v; e.target.value = v; };
            content.push(lvInp);
        }
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else if (kind === 'pet') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '펫'));
        content.push(makeItemGrid(data.pets || [], boRegState.petId, id => { boRegState.petId = id; }, (thumb, p) => {
            if (p.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: p.frameUrl, alt: '' }));
            if (p.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: p.iconUrl, alt: p.name }));
            else if (!p.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, p.name[0]));
        }));
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '아이템'));
        content.push(makeItemGrid(data.items, boRegState.itemId, id => { boRegState.itemId = id; }, (thumb, it) => {
            if (it.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: it.frameUrl, alt: '' }));
            if (it.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: it.iconUrl, alt: it.name }));
            else if (!it.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, it.name[0]));
        }));
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());
    }

    content.push(el('div', { class: 'reg-divider' }));
    content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '결제 수단'));
    content.push(el('div', { class: 'reg-currency-row' },
        ...['gold', 'garnet'].map(c => el('button', {
            class: 'reg-curr-btn ' + c + (boRegState.currency === c ? ' active' : ''),
            onclick: () => { boRegState.currency = c; renderBoRegisterModal(); }
        }, regCurrImg(c), c === 'gold' ? '골드' : '가넷'))
    ));
    content.push(el('div', { class: 'reg-section-label' }, '개당 가격'));
    content.push(el('div', { class: 'reg-price-wrap' },
        el('span', { class: 'reg-price-icon' }, regCurrImg(boRegState.currency)),
        el('input', { type: 'number', id: 'boRegPrice', class: 'reg-price-field', placeholder: '0', min: 1 })
    ));
    content.push(el('div', { class: 'reg-inline-err', id: 'boRegErr' }));
    content.push(el('div', { class: 'reg-footer' },
        el('button', { onclick: closeBoRegister }, '취소'),
        el('button', { class: 'primary', onclick: submitBoRegister }, '등록하기')
    ));

    $('#boReg').replaceChildren(...content);
}

function showBoRegErr(msg) {
    const d = $('#boRegErr');
    if (d) { d.textContent = msg; d.classList.add('visible'); }
}
async function submitBoRegister() {
    const kind = boRegState.kind;
    const currency = boRegState.currency || 'gold';
    const price = Number($('#boRegPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) { showBoRegErr('가격은 1 이상의 정수여야 합니다.'); return; }
    const body = { kind, currency, price, count: boRegState.count };
    if (kind === 'card') {
        if (boRegState.cardId < 0) { showBoRegErr('카드를 선택해주세요.'); return; }
        body.cardId = boRegState.cardId; body.star = boRegState.star;
        if (boRegState.type) body.type = boRegState.type;
        if (boRegState.skin && boRegState.skin.trim()) body.skin = boRegState.skin.trim();
    } else if (kind === 'equipment') {
        if (boRegState.equipId < 0) { showBoRegErr('장비를 선택해주세요.'); return; }
        body.equipType = boRegState.equipType; body.equipId = boRegState.equipId;
        if (boRegState.levelSpecified) body.level = boRegState.level;
    } else if (kind === 'pet') {
        if (boRegState.petId < 0) { showBoRegErr('펫을 선택해주세요.'); return; }
        body.petId = boRegState.petId;
    } else {
        if (boRegState.itemId < 0) { showBoRegErr('아이템을 선택해주세요.'); return; }
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
        showBoRegErr(e.message);
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

    if (entry.specialLines && entry.specialLines.length) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '특수 효과'));
        entry.specialLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }

    if (entry.set) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '세트 효과 · ' + entry.set.name));
        if (entry.set.tiers && entry.set.tiers.length) {
            entry.set.tiers.forEach(t => block.appendChild(el('div', null, t.tier + '세트: ' + (t.lines && t.lines.length ? t.lines.join(', ') : '효과 없음'))));
        } else {
            block.appendChild(el('div', { style: { color: '#64748b' } }, 'PetSet.json에 효과가 정의되지 않음'));
        }
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

function dexCharacterCard(entry) {
    const card = el('div', { class: 'dex-card' });
    card.style.setProperty('--rar', '#5865f2');
    if (entry.coverUrl) {
        card.appendChild(el('div', { style: { margin: '-14px -14px 0', aspectRatio: '16 / 9', borderRadius: '14px 14px 8px 8px', overflow: 'hidden', background: '#020617' } },
            el('img', { src: entry.coverUrl, alt: entry.name, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
        ));
    }
    const head = el('div', { style: { display: 'grid', gap: '4px' } });
    head.appendChild(el('div', null,
        el('div', { class: 'dex-name' }, entry.name),
        el('div', { class: 'dex-meta' },
            el('span', { class: 'tag rarity' }, entry.typeLabel || '캐릭터 카드')
        )
    ));
    card.appendChild(head);

    if (entry.slotEffect) {
        const eff = entry.slotEffect;
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '카드 슬롯 효과'));
        block.appendChild(el('div', null, eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)'));
        if (eff.perLevelText && Number(String(eff.perLevelText).replace(/[^0-9.-]/g, '')) !== 0) block.appendChild(el('div', null, '이후 등급마다 ' + (String(eff.perLevelText).trim().startsWith('-') ? '' : '+') + eff.perLevelText));
        card.appendChild(block);
    }

    if (entry.skills && entry.skills.length) {
        const det = el('details', { class: 'dex-collapse', open: true });
        det.appendChild(el('summary', null, '스킬'));
        const list = el('div', { class: 'dex-upgrade-list' });
        entry.skills.forEach(skill => {
            list.appendChild(el('div', { class: 'dex-upgrade-row' },
                el('div', { class: 'lvl' }, skill.name),
                el('div', { class: 'lines' },
                    el('div', { style: { fontWeight: 800, color: '#f8fafc' } }, 'MP ' + comma(skill.mpCost) + ' · ' + skill.cooltimeText),
                    ...(skill.descLines || []).map(line => el('div', null, line))
                )
            ));
        });
        det.appendChild(list);
        card.appendChild(det);
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
    list.forEach(entry => grid.appendChild(dexTab === 'character' ? dexCharacterCard(entry) : dexCard(entry)));
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
