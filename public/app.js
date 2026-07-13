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
// 칭호 이미지 뱃지 (닉네임 앞에 표시). title: { name, imageUrl } | null
function titleImg(title) {
    if (!title || !title.imageUrl) return null;
    return el('img', { src: title.imageUrl, class: 'title-badge', alt: title.name || '', title: title.name || '' });
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

$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
if ($('#adminLink')) $('#adminLink').onclick = () => { location.href = '/admin'; };

function setHeaderPoint(n) {
    const node = $('#pointAmount');
    if (node) node.textContent = comma(Number(n || 0));
}
function showLoading() { const o = $('#loadingOverlay'); if (o) o.classList.add('active'); }
function hideLoading() { const o = $('#loadingOverlay'); if (o) o.classList.remove('active'); }
function openPointChargeModal() {
    $('#modalTitle').textContent = '포인트 충전';
    $('#modalSub').textContent = '최소 50P부터 충전할 수 있습니다.';
    $('#modalSub').style.display = '';
    const input = el('input', { type: 'number', min: '50', step: '1', placeholder: '충전할 포인트', inputmode: 'numeric' });
    const info = el('div', { class: 'point-charge-info' }, '보유 잔액에서 입력한 포인트만큼 차감되어 충전됩니다.');
    const btn = el('button', { class: 'primary' }, '충전하기');
    btn.onclick = async () => {
        const amount = Math.floor(Number(input.value));
        if (!Number.isFinite(amount) || amount < 50) { alert('최소 50P부터 충전할 수 있습니다.'); return; }
        btn.disabled = true;
        showLoading();
        try {
            const r = await postApi('/api/point/charge', { amount });
            setHeaderPoint(r.point);
            closeModal();
            alert(comma(r.charged) + 'P를 충전했습니다.');
            if (currentProfileName === myName) { try { renderProfile(await api('/api/profile')); } catch (e) {} }
        } catch (e) {
            alert(e.message);
            btn.disabled = false;
        } finally {
            hideLoading();
        }
    };
    $('#modalBody').replaceChildren(el('div', { class: 'point-charge-body' }, input, info, btn));
    $('#modalBg').classList.add('active');
    setTimeout(() => input.focus(), 50);
}
if ($('#pointAddBtn')) $('#pointAddBtn').onclick = openPointChargeModal;

const PAGE_LABELS = { info: '정보', inventory: '인벤토리', mail: '메일함', event: '이벤트', '버닝': '버닝', '자물쇠': '자물쇠', '펀치기계': '이벤트', combine: '조합', jobcombine: '전직조합', dex: '도감', auction: '팝니다', buyorder: '삽니다', shop: '상점', ranking: '랭킹', patchnotes: '패치노트' };
const mailState = { mails: [], unread: 0, selectedId: null, page: 1, totalPages: 1 };
const ICONS = {
    me:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`,
    content:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    market:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    party:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    community: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
};
// 유생의 주사위 이벤트 종료 시각(KST 2026-07-10 23:59). 종료 후 탭 자체를 노출하지 않는다.
const EVENT_DICE_END_TS = new Date('2026-07-10T23:59:00+09:00').getTime();
const EVENT_DICE_ENDED = Date.now() >= EVENT_DICE_END_TS;
// 펀치기계 탭: 지금은 관리자에게만, 이벤트 종료(7/10 23:59) 이후 모든 유저에게 노출.
const PUNCH_VISIBLE = window.IS_ADMIN || EVENT_DICE_ENDED;
const GROUPS = [
    { id: 'me',        label: '캐릭터',   iconSvg: ICONS.me,        pages: ['info', 'inventory', 'mail'] },
    { id: 'content',   label: '콘텐츠',   iconSvg: ICONS.content,   pages: [...(PUNCH_VISIBLE ? ['펀치기계'] : []), ...(EVENT_DICE_ENDED ? [] : ['event']), '버닝', '자물쇠', 'combine', 'jobcombine', 'dex', '레벨보상'] },
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
    updateMailBadge();
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
    if (pageId === 'info' && !suppressInfoSelfReset && currentProfileName && myName && currentProfileName !== myName) loadProfile(myName).catch(e => alert(e.message));
    if (pageId === 'inventory') {
        if (currentProfileName && myName && currentProfileName !== myName) {
            currentInventoryName = currentProfileName;
        } else {
            currentInventoryName = myName;
        }
        updateInventoryBanner();
        loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
    }
    if (pageId === 'mail') loadMail();
    if (pageId === 'event') loadEventDice();
    if (pageId === '버닝') loadBurning();
    if (pageId === '자물쇠') loadLockbox();
    if (pageId === '펀치기계') loadPunch();
    if (pageId === 'combine') loadCombine();
    if (pageId === 'jobcombine') loadJobCombine();
    if (pageId === '레벨보상') loadLevelRewards();
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

let currentStatGroups = [];

function renderStatCard() {
    const root = $('#stats');
    if (!root) return;
    const hideZero = $('#statHideZero') && $('#statHideZero').checked;
    const card = el('div', { class: 'stat-card' });
    (currentStatGroups || []).forEach(g => {
        const items = (g.items || []).filter(it => !hideZero || it.owned);
        if (!items.length) return;
        const grp = el('div', { class: 'stat-grp' }, el('div', { class: 'stat-grp-title' }, g.title));
        items.forEach(it => {
            const cls = !it.owned ? ' zero' : (it.tone === 'good' ? ' bonus' : (it.tone === 'bad' ? ' neg' : ''));
            grp.appendChild(el('div', { class: 'stat-line' },
                el('span', { class: 'stat-label' }, it.label),
                el('div', { class: 'stat-vblock' },
                    el('b', { class: 'stat-value' + cls }, it.value),
                    it.sub ? el('span', { class: 'stat-sub' }, it.sub) : null)
            ));
        });
        card.appendChild(grp);
    });
    root.replaceChildren(card.children.length ? card : el('div', { class: 'empty' }, '표시할 스탯이 없습니다.'));
}

if ($('#statHideZero')) $('#statHideZero').onchange = () => renderStatCard();

function goodsRow(iconUrl, name, value, subName, subValue) {
    const icon = iconUrl ? el('img', { class: 'goods-icon', src: iconUrl, alt: name }) : el('span', { class: 'goods-icon-fallback' }, '●');
    const vblock = el('div', { class: 'goods-vblock' }, el('b', { class: 'goods-value' }, value));
    if (subName != null) vblock.appendChild(el('div', { class: 'goods-sub' }, subName + ' ' + subValue));
    return el('div', { class: 'goods-row' }, icon, el('div', { class: 'goods-name' }, name), vblock);
}

function renderGoods(user, icons) {
    const root = $('#goods');
    if (!root) return;
    root.replaceChildren(el('div', { class: 'goods-card' },
        goodsRow(icons.gold, '골드', comma(user.gold)),
        goodsRow(icons.garnet, '가넷', comma(user.garnet)),
        goodsRow(icons.point, '포인트', comma(user.point), '마일리지', comma(user.mileage))
    ));
}

function renderStatPoint(sp) {
    const root = $('#statPointBody');
    if (!root) return;
    if (!sp) { root.replaceChildren(el('div', { class: 'empty' }, '스탯포인트 정보가 없습니다.')); return; }
    const summary = el('div', { class: 'sp-summary' },
        el('div', { class: 'sp-avail' }, el('span', null, '잔여 스탯포인트'), el('b', null, comma(sp.available))),
        el('div', { class: 'sp-buy' }, '누적 구매 ' + comma(sp.buyCount) + '회 · 다음 1개 🪙 ' + comma(sp.nextPrice))
    );
    const list = el('div', { class: 'sp-list' });
    (sp.stats || []).forEach(s => {
        const pct = sp.perStatLimit > 0 ? Math.min(100, s.invested / sp.perStatLimit * 100) : 0;
        const bonus = '+' + comma(s.flat) + (s.plusPercent != null ? '  /  +' + s.plusPercent + '%' : '');
        list.appendChild(el('div', { class: 'sp-row' },
            el('div', { class: 'sp-name' }, s.name),
            el('div', { class: 'sp-bar' }, el('div', { class: 'sp-bar-fill', style: 'width:' + pct + '%' })),
            el('div', { class: 'sp-count' }, comma(s.invested) + ' / ' + comma(sp.perStatLimit)),
            el('div', { class: 'sp-bonus' }, bonus)
        ));
    });
    root.replaceChildren(summary, list, el('div', { class: 'sp-note' }, '스탯포인트 구매·투자는 카카오톡에서 가능합니다.'));
}

$$('.pf-tab').forEach(btn => btn.onclick = () => {
    const tab = btn.dataset.pftab;
    $$('.pf-tab').forEach(b => b.classList.toggle('active', b === btn));
    $$('.pf-panel').forEach(p => p.classList.toggle('active', p.dataset.pfpanel === tab));
});

function textLines(text) {
    return String(text || '').split('\n').filter(line => line && line.indexOf('\u200e') === -1);
}

const RARITY_COLORS = { '일반': '#64748b', '고급': '#64748b', '레어': '#86efac', '희귀': '#86efac', '유니크': '#a855f7', '영웅': '#a855f7', '레전더리': '#facc15', '전설': '#facc15', '초월': '#ef4444', '초월 1단계': '#ef4444', '초월 2단계': '#ef4444', '초월 3단계': '#ef4444', '신화': '#a78bfa', '고유': '#ec4899' };
const SLOT_ICONS = { 'weapon': '⚔️', 'hat': '🎩', 'armor': '🛡️', 'pants': '👖', 'shoes': '👢', 'accessory': '💍', 'support': '🔧' };
const ITEM_TYPE_ORDER = ['이벤트', '가챠', '번들', '사용', '소모품', '티켓', '재료'];
const EQUIP_TYPE_ORDER = [['weapon', '무기'], ['hat', '모자'], ['armor', '갑옷'], ['pants', '하의'], ['shoes', '신발'], ['accessory', '장신구'], ['support', '보조']];

function rarityTag(rarity) {
    return el('span', { class: 'tag rarity' + (rarity === '신화' ? ' rarity-mythic' : '') }, rarity);
}

function applyRarityCardClass(node, rarity) {
    if (rarity === '신화') node.classList.add('rarity-mythic-card');
    return node;
}

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
                rarityTag(pet.rarity),
                pet.equipped ? el('span', { class: 'tag on' }, '장착') : null,
                expText ? el('span', { class: 'tag' }, expText) : null
            )
        ),
        pet.level > 0 ? el('span', { class: 'level' }, '+' + pet.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    applyRarityCardClass(card, pet.rarity);
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
                rarityTag(eq.rarity),
                eq.equipped ? el('span', { class: 'tag on' }, '장착') : null
            )
        ),
        eq.level > 0 ? el('span', { class: 'level' }, '+' + eq.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    applyRarityCardClass(card, eq.rarity);
    return card;
}

function gearSlotNode(typeKey, label, eq) {
    const pos = el('div', { class: 'gear-slot-pos' }, label);
    if (!eq) {
        const thumb = el('div', { class: 'equip-thumb gear-empty-thumb' }, el('span', { class: 'icon-fallback' }, SLOT_ICONS[typeKey] || '🎒'));
        return el('div', { class: 'gear-slot empty' }, pos, thumb,
            el('div', { class: 'gear-slot-info' }, el('div', { class: 'gear-slot-empty' }, '미장착')),
            el('span', { class: 'gear-slot-lv' }));
    }
    const node = el('div', { class: 'gear-slot filled', onclick: () => openEquipmentModal(eq) },
        pos, equipmentThumb(eq),
        el('div', { class: 'gear-slot-info' },
            el('div', { class: 'gear-slot-name' }, eq.name),
            el('div', { class: 'equip-meta' }, rarityTag(eq.rarity))
        ),
        eq.level > 0 ? el('span', { class: 'gear-slot-lv' }, '+' + eq.level) : el('span', { class: 'gear-slot-lv' })
    );
    node.style.setProperty('--rar', RARITY_COLORS[eq.rarity] || '#334155');
    applyRarityCardClass(node, eq.rarity);
    return node;
}

function renderGearSlots(data) {
    const root = $('#equippedGear');
    if (!root) return;
    const byType = { weapon: null, hat: null, armor: null, pants: null, shoes: null, support: null };
    const accessories = [];
    (data.equippedEquipment || []).forEach(e => {
        if (e.type === 'accessory') accessories.push(e);
        else if (e.type in byType) byType[e.type] = e;
    });
    const maxAcc = Math.max(1, Number(data.user.maxAccessory || 3));
    const nodes = [
        gearSlotNode('weapon', '무기', byType.weapon), gearSlotNode('hat', '모자', byType.hat),
        gearSlotNode('armor', '갑옷', byType.armor), gearSlotNode('pants', '하의', byType.pants),
        gearSlotNode('shoes', '신발', byType.shoes)
    ];
    for (let i = 0; i < maxAcc; i++) nodes.push(gearSlotNode('accessory', maxAcc > 1 ? '장신구 ' + (i + 1) : '장신구', accessories[i] || null));
    nodes.push(gearSlotNode('support', '보조', byType.support));
    root.replaceChildren(...nodes);
}

function openModal(title, sub, lines) {
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub || '';
    $('#modalSub').style.display = sub ? '' : 'none';
    $('#modalBody').replaceChildren(...(lines.length ? lines.map(line => el('div', { class: 'stat-line' }, line)) : [el('div', { class: 'empty' }, '표시할 정보가 없습니다.')]));
    $('#modalBg').classList.add('active');
}

function closeModal() { $('#modalBg').classList.remove('active'); }

function openRichModal(title, sub, nodes) {
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub || '';
    $('#modalSub').style.display = sub ? '' : 'none';
    $('#modalBody').replaceChildren(el('div', { class: 'mc-body' }, ...nodes));
    $('#modalBg').classList.add('active');
}

function cardSectionNode(label) {
    return el('div', { class: 'mc-section' },
        el('span', { class: 'mc-section-line' }),
        el('span', { class: 'mc-section-label' }, label),
        el('span', { class: 'mc-section-line' })
    );
}

function skillPanelNode(skill) {
    return el('div', { class: 'mc-panel skill' },
        el('div', { class: 'mc-head' },
            el('span', { class: 'mc-name' }, skill.name),
            el('div', { class: 'mc-chips' },
                el('span', { class: 'mc-chip mp' }, 'MP ' + comma(skill.mpCost)),
                el('span', { class: 'mc-chip cd' }, '⏱ ' + skill.cooltimeText)
            )
        ),
        el('div', { class: 'mc-desc' }, ...(skill.descLines || []).map(d => el('span', null, d)))
    );
}

function slotEffectPanelNode(eff) {
    const valText = eff.active ? eff.currentText : eff.baseText;
    const perLevel = Number(String(eff.perLevelText || '').replace(/[^0-9.]/g, '')) > 0;
    return el('div', { class: 'mc-panel slot' + (eff.active ? '' : ' locked') },
        el('div', { class: 'mc-head' },
            el('span', { class: 'mc-name' }, eff.name),
            el('div', { class: 'mc-chips' }, el('span', { class: 'mc-chip val' }, valText))
        ),
        el('div', { class: 'mc-note' + (eff.active ? '' : ' warn') },
            (eff.active ? '현재 ' + eff.currentStarText + ' 기준' : '⚠️ ' + eff.requireStarText + ' 이상부터 적용 (' + eff.requireStarText + ' 기준값)')
            + (perLevel ? ' · 등급마다 +' + eff.perLevelText : '')
        )
    );
}

function openMainCardModal(card) {
    const isJob = card && card.type === '전직';
    const nodes = [];
    if (card && Array.isArray(card.skills) && card.skills.length > 0) {
        card.skills.forEach(skill => nodes.push(skillPanelNode(skill)));
    }
    // 전직 카드만 전직 스킬을 추가로 사용 (일반 스킬 + 전직 스킬 둘 다)
    if (isJob && card.classInfo && Array.isArray(card.classInfo.skills) && card.classInfo.skills.length > 0) {
        nodes.push(cardSectionNode('전직'));
        card.classInfo.skills.forEach(skill => nodes.push(skillPanelNode(skill)));
    }
    if (!nodes.length) nodes.push(el('div', { class: 'mc-empty' }, '표시할 스킬이 없습니다.'));
    openRichModal(card && card.formatted ? card.formatted : '메인 캐릭터 카드', card && card.starText ? card.starText + ' · 스킬' : '스킬', nodes);
}

function openCardSlotModal(card) {
    const isJob = card && card.type === '전직';
    const nodes = [];
    // 전직 카드는 전직 슬롯 효과만, 일반 카드는 일반 슬롯 효과만 적용
    if (isJob) {
        if (card.classInfo && Array.isArray(card.classInfo.slotEffects)) {
            card.classInfo.slotEffects.forEach(se => nodes.push(slotEffectPanelNode(se)));
        }
    } else if (card.slotEffect) {
        nodes.push(slotEffectPanelNode(card.slotEffect));
    }
    if (!nodes.length) nodes.push(el('div', { class: 'mc-empty' }, '슬롯 효과가 없습니다.'));
    openRichModal(card.formatted, (card.starText || '') + ' · 카드 슬롯 효과', nodes);
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
        if (eq.canPotential) {
            const potRow = el('div', { class: 'row' });
            if (eq.potential) {
                potRow.appendChild(el('button', { class: 'pot-reroll-open', onclick: () => { closeModal(); openRerollModal(eq); } }, '잠재능력 재설정'));
            } else {
                potRow.appendChild(el('button', { class: 'pot-awaken', onclick: e => awakenPotential(eq, e) }, '잠재능력 부여'));
            }
            $('#modalBody').appendChild(potRow);
        }
    }
}

async function awakenPotential(eq, event) {
    if (!confirm('돋보기 1개를 소모하여 잠재능력을 부여하시겠습니까?')) return;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/awaken', { number: eq.number });
        closeModal();
        if (data.profile) renderProfile(data.profile);
        await loadInventory('equipment');
    } catch (e) {
        alert(e.message);
        if (btn) btn.disabled = false;
    }
}

// ===== 잠재능력 재설정 모달 (강화 모달 스타일) =====
let potentialState = { eq: null, info: null, jewel: 'none', busy: false };

const JEWEL_META = {
    none:  { cls: 'none',     name: '쥬얼 미사용' },
    jewel: { cls: 'advanced', name: '쥬얼' },
    white: { cls: 'blessed',  name: '화이트 쥬얼' }
};

// 쥬얼 아이콘 노드 (none은 빈 표시, jewel/white는 실제 이미지)
function jewelIconNode(key) {
    const info = potentialState.info || {};
    const icons = info.jewelIcons || {};
    const url = key === 'jewel' ? icons.jewel : key === 'white' ? icons.white : null;
    if (url) return el('img', { class: 'jewel-icon-img', src: url, alt: '' });
    return el('span', { class: 'jewel-icon-none' }, '–');
}

// 모바일에서 스크롤 없이 화면에 맞도록 zoom으로 자동 축소 (reflow)
function potAvailHeight() {
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    return vh * 0.92;
}
function potFitZoom(elem) {
    if (!elem) return { z: 1, natural: 0 };
    elem.style.zoom = '1';
    const natural = elem.scrollHeight;
    const avail = potAvailHeight();
    const z = natural > avail ? avail / natural : 1;
    elem.style.zoom = String(z);
    return { z, natural };
}
function refitPotential() {
    const ov = $('#potentialOverlay');
    if (!ov || !ov.classList.contains('active')) return;
    const wrap = ov.querySelector('.enhance-wrap');
    if (!wrap) return;
    if ($('#potentialResultOverlay').classList.contains('active')) {
        const inner = $('#potentialResultOverlay').querySelector('.pot-result-inner');
        if (inner) { const { z, natural } = potFitZoom(inner); wrap.style.height = (natural * z) + 'px'; }
    } else {
        wrap.style.height = '';
        potFitZoom($('#potentialContent'));
    }
}
window.addEventListener('resize', refitPotential);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refitPotential);

function potEntriesNode(data, label, cls) {
    const block = el('div', { class: 'pot-block ' + (cls || '') });
    block.appendChild(el('div', { class: 'pot-title' },
        el('span', null, label),
        el('span', { class: 'pot-tier-label' }, (data && data.tierLabel) || '')
    ));
    (data && data.entries || []).forEach(entry => {
        block.appendChild(el('div', { class: 'pot-row' },
            el('span', { class: 'pot-grade ' + (entry.grade || 'bronze') }, entry.gradeLabel || ''),
            el('span', { class: 'pot-text' }, entry.text || '')
        ));
    });
    return block;
}

function openRerollModal(eq) {
    potentialState = { eq, info: null, jewel: 'none', busy: false };
    $('#potentialOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadRerollInfo();
}

function closeRerollModal() {
    $('#potentialOverlay').classList.remove('active');
    document.body.style.overflow = '';
    const wrap = $('#potentialOverlay').querySelector('.enhance-wrap');
    if (wrap) wrap.style.height = '';
    const c = $('#potentialContent'); if (c) c.style.zoom = '1';
    potentialState = { eq: null, info: null, jewel: 'none', busy: false };
    loadInventory('equipment').catch(() => {});
}

async function loadRerollInfo() {
    $('#potentialContent').replaceChildren(el('div', { class: 'loading', style: 'padding:60px 0;text-align:center' }, '불러오는 중...'));
    $('#potentialResultOverlay').classList.remove('active');
    try {
        const data = await api('/api/potential/reroll-info/' + potentialState.eq.number);
        potentialState.info = data;
        if (potentialState.jewel === 'jewel' && !data.options.jewel.available) potentialState.jewel = 'none';
        if (potentialState.jewel === 'white' && !data.options.white.available) potentialState.jewel = 'none';
        renderRerollSetup();
    } catch (e) {
        $('#potentialContent').replaceChildren(el('div', { class: 'enhance-error-wrap' },
            el('div', { class: 'empty err' }, e.message),
            el('button', { class: 'enhance-cancel-btn', style: 'margin-top:12px;width:100%', onclick: closeRerollModal }, '닫기')
        ));
    }
}

function buildJewelCard() {
    const { info, jewel } = potentialState;
    const meta = JEWEL_META[jewel];
    const opt = info.options[jewel];
    const card = el('div', { class: 'enhance-protect ' + meta.cls + ' clickable', onclick: openJewelPicker });
    card.appendChild(el('div', { class: 'enhance-protect-icon' }, jewelIconNode(jewel)));
    const detail = jewel === 'none' ? '할인 없음 · 클릭하여 쥬얼 선택' : ('골드 -' + opt.discountPct + '% · 승급 확률/카운트 2배');
    card.appendChild(el('div', { class: 'enhance-protect-text' },
        el('div', { class: 'enhance-protect-name' }, meta.name),
        el('div', { class: 'enhance-protect-detail' }, detail)
    ));
    if (jewel !== 'none') card.appendChild(el('div', { class: 'enhance-protect-badge' }, '보유 ' + (jewel === 'white' ? info.jewels.white : info.jewels.jewel) + '개'));
    card.appendChild(el('div', { class: 'enhance-protect-pick-arrow' }, '▾'));
    return card;
}

function openJewelPicker() {
    const { info, jewel } = potentialState;
    const body = el('div', { class: 'protect-picker' });
    const makeRow = (key, detail, count, available) => {
        const row = el('div', {
            class: 'protect-pick-row' + (jewel === key ? ' selected' : '') + (available ? '' : ' disabled'),
            onclick: available ? () => { potentialState.jewel = key; closeModal(); renderRerollSetup(); } : null
        });
        row.appendChild(el('div', { class: 'protect-pick-icon' }, jewelIconNode(key)));
        row.appendChild(el('div', { class: 'protect-pick-text' },
            el('div', { class: 'protect-pick-name' }, JEWEL_META[key].name),
            el('div', { class: 'protect-pick-detail' }, detail)));
        if (count != null) row.appendChild(el('div', { class: 'protect-pick-count' }, count + '개'));
        if (jewel === key) row.appendChild(el('div', { class: 'protect-pick-check' }, '✓'));
        return row;
    };
    body.appendChild(makeRow('none', '쥬얼을 사용하지 않습니다', null, true));
    body.appendChild(makeRow('jewel', '골드 -' + info.options.jewel.discountPct + '% · 승급 2배', info.jewels.jewel, info.options.jewel.available));
    body.appendChild(makeRow('white', '골드 -' + info.options.white.discountPct + '% · 승급 2배', info.jewels.white, info.options.white.available));
    $('#modalTitle').textContent = '쥬얼 선택';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

function buildCostBox() {
    const { info, jewel } = potentialState;
    const opt = info.options[jewel];
    const lack = info.gold < opt.cost;
    const box = el('div', { class: 'pot-cost-box' });
    const goldImg = info.goldIcon ? el('img', { class: 'pot-gold-icon', src: info.goldIcon, alt: '' }) : null;
    box.appendChild(el('div', { class: 'pot-cost-line' + (lack ? ' lack' : '') },
        '소모 ', goldImg, ' ' + comma(opt.cost) + (lack ? ' (보유 ' + comma(info.gold) + ')' : ' / ' + comma(info.gold))));
    if (info.upgrade) {
        const jewelBonus = jewel !== 'none' && info.currentTier !== 'unique';
        box.appendChild(el('div', { class: 'pot-upg-line' },
            '승급 ' + info.currentTierLabel + ' → ' + info.upgrade.next + ' · 확정까지 ' + comma(info.upgrade.failCount) + '/' + comma(info.upgrade.guarantee) + (jewelBonus ? ' (쥬얼 2배)' : '')));
    }
    return box;
}

function renderRerollSetup() {
    const { eq, info, jewel } = potentialState;
    const opt = info.options[jewel];
    const lack = info.gold < opt.cost;

    const thumbParts = [];
    if (eq.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: eq.frameUrl, alt: '' }));
    if (eq.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: eq.iconUrl, alt: eq.name }));
    const header = el('div', { class: 'pot-mod-head' },
        el('button', { class: 'enhance-close-btn', onclick: closeRerollModal }, '✕'),
        el('div', { class: 'auc-thumb square' }, ...thumbParts),
        el('div', { class: 'pot-mod-title' }, eq.name + (eq.level > 0 ? ' +' + eq.level : '')),
        el('div', { class: 'pot-mod-tier' }, info.currentTierLabel)
    );

    const confirmBtn = el('button', { class: 'pot-confirm-btn', disabled: lack ? true : false, onclick: e => doReroll(e) }, '재설정');

    $('#potentialContent').replaceChildren(
        header,
        el('div', { class: 'enhance-info' },
            el('div', { class: 'enhance-section-label' }, '현재 잠재능력'),
            potEntriesNode(info.current, '현재', 'cur'),
            el('div', { class: 'enhance-section-label' }, '쥬얼'),
            buildJewelCard(),
            el('div', { class: 'enhance-section-label' }, '소모 / 승급'),
            buildCostBox()
        ),
        el('div', { class: 'enhance-footer' },
            el('button', { class: 'enhance-cancel-btn', onclick: closeRerollModal }, '닫기'),
            confirmBtn
        )
    );
    requestAnimationFrame(refitPotential);
}

async function doReroll(event) {
    if (potentialState.busy) return;
    potentialState.busy = true;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/reroll', { number: potentialState.eq.number, jewel: potentialState.jewel });
        potentialState.busy = false;
        showRerollResult(data);
    } catch (e) {
        potentialState.busy = false;
        if (btn) btn.disabled = false;
        alert(e.message);
    }
}

function showRerollResult(data) {
    const ov = $('#potentialResultOverlay');
    const eq = potentialState.eq;
    const kind = data.upgraded ? 'great' : 'success';
    potentialState.lastResult = data;

    const thumbParts = [];
    if (eq.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: eq.frameUrl, alt: '' }));
    if (eq.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: eq.iconUrl, alt: '' }));
    const weapon = el('div', { class: 'enh-fx-weapon' }, el('div', { class: 'auc-thumb square' }, ...thumbParts));
    const fxLayers = [el('div', { class: 'enh-fx-aura' })];
    if (data.upgraded) {
        fxLayers.push(buildRayLayer(16, '#fde68a'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(16, ['#fde68a', '#c4b5fd', '#86efac', '#93c5fd', '#f0abfc', '#fbbf24']));
    } else {
        fxLayers.push(buildRayLayer(12, 'rgba(196,181,253,.7)'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(11, ['#e9d5ff', '#c4b5fd', '#ffffff']));
    }
    const fxStage = el('div', { class: 'enh-fx ' + kind }, ...fxLayers);

    const FX = 0.25;
    const headline = el('div', { class: 'enh-result-headline ' + kind, style: 'animation-delay:' + FX + 's' },
        data.upgraded ? ('티어 승급! ' + data.currentTierLabel + ' → ' + data.nextTierLabel + (data.guaranteed ? ' (확정)' : '')) : '잠재능력 재설정');

    const cmp = el('div', { class: 'pot-compare pot-result-reveal', style: 'animation-delay:' + (FX + 0.1).toFixed(2) + 's' },
        potEntriesNode(data.old, '이전', 'old'),
        potEntriesNode(data.new, '신규', 'new'));

    const warn = data.upgraded ? el('div', { class: 'pot-warn pot-result-reveal', style: 'animation-delay:' + (FX + 0.18).toFixed(2) + 's' },
        '이전 유지를 선택하면 승급도 사라집니다. 골드/쥬얼은 반환되지 않습니다.') : null;

    const btnRow = el('div', { class: 'pot-result-actions pot-result-reveal', style: 'animation-delay:' + (FX + 0.25).toFixed(2) + 's' },
        el('button', { class: 'enhance-cancel-btn', onclick: e => data.upgraded ? showRerollKeepWarning() : finishReroll('cancel', e) }, '이전 유지'),
        el('button', { class: 'pot-confirm-btn', onclick: e => finishReroll('confirm', e) }, '새 잠재능력 적용'));

    const inner = el('div', { class: 'pot-result-inner' }, fxStage, headline, cmp, ...(warn ? [warn] : []), btnRow);
    ov.replaceChildren(inner);
    ov.classList.add('active');
    requestAnimationFrame(refitPotential);
}

function showRerollKeepWarning() {
    const ov = $('#potentialResultOverlay');
    const inner = el('div', { class: 'pot-result-inner' },
        el('div', { class: 'enh-warn-title' }, '승급을 포기하시겠습니까?'),
        el('div', { class: 'enh-warn-sub' }, '이전 잠재능력으로 되돌리면 티어 승급도 함께 사라집니다. 소모한 골드/쥬얼은 반환되지 않습니다.'),
        el('div', { class: 'enh-warn-actions' },
            el('button', { class: 'enhance-cancel-btn', onclick: () => showRerollResult(potentialState.lastResult) }, '돌아가기'),
            el('button', { class: 'enh-warn-confirm', onclick: e => finishReroll('cancel', e) }, '승급 포기')
        )
    );
    ov.replaceChildren(inner);
    ov.classList.add('active');
    requestAnimationFrame(refitPotential);
}

async function finishReroll(kind, event) {
    if (potentialState.busy) return;
    potentialState.busy = true;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/reroll/' + (kind === 'confirm' ? 'confirm' : 'cancel'), {});
        potentialState.busy = false;
        if (data.profile) renderProfile(data.profile);
        $('#potentialResultOverlay').classList.remove('active');
        loadRerollInfo(); // 모달은 유지하고 재설정 화면 갱신
    } catch (e) {
        potentialState.busy = false;
        if (btn) btn.disabled = false;
        alert(e.message);
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
let suppressInfoSelfReset = false;

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
    $('#who').textContent = myName;
    if (data.user.name === myName) setHeaderPoint(data.user.point);
    $('#profileName').textContent = data.user.name;
    const pTitle = $('#profileTitle');
    if (pTitle) { const img = titleImg(data.user.title); pTitle.replaceChildren(...(img ? [img] : [])); }
    $('#level').textContent = 'Lv. ' + comma(data.user.level);
    $('#exp').textContent = 'EXP ' + comma(data.user.exp) + ' / ' + comma(data.user.maxExp);
    $('#totalPower').textContent = comma(data.combatPower.total);
    const heroBg = $('#pfHeroBg');
    if (heroBg) heroBg.style.backgroundImage = (data.mainCard && data.mainCard.imageUrl) ? 'url("' + data.mainCard.imageUrl + '")' : 'none';
    const petRow = $('#petRow');
    if (petRow) petRow.replaceChildren(...(data.equippedPets || []).map(petCard));
    renderGoods(data.user, data.currencyIcons || {});
    currentStatGroups = data.statGroups || [];
    renderStatCard();
    renderStatPoint(data.statPoint);
    $('#mainCard').replaceChildren(cardNode(data.mainCard, false, openMainCardModal));
    $('#slotCards').replaceChildren(...data.cardSlots.map(card => cardNode(card, true, openCardSlotModal)));
    renderGearSlots(data);
    if (data.user.isAdmin) $('#adminLink').style.display = '';
    if (isInitialOwnProfile && !data.user.canPartyQuest)
        $$('.group-tab[data-group="party"], .bottom-tab[data-group="party"]').forEach(t => t.remove());
}

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

async function openLockbox(count = 1) {
    // 영상 재생 전에 열쇠/자물쇠 보유를 먼저 확인해, 부족하면 경고만 띄운다.
    let check;
    try {
        check = await postApi('/api/inventory/lockbox-check', { count });
    } catch (e) {
        openModal('오류', '', [e.message]);
        return;
    }
    if (!check.ok) {
        openModal('열기 불가', '', [check.error || '열쇠가 부족합니다.']);
        return;
    }
    const overlay = $('#lockboxOverlay');
    const video = $('#lockboxVideo');
    overlay.classList.add('active');
    video.currentTime = 0;
    video.play();
    const finish = async () => {
        video.onended = null;
        $('#lockboxSkip').onclick = null;
        video.pause();
        overlay.classList.remove('active');
        try {
            const data = await postApi('/api/inventory/use-lockbox', { count });
            showLockboxResult(data.opens || []);
            loadInventory('items');
        } catch (e) {
            openModal('오류', '', [e.message]);
        }
    };
    video.onended = finish;
    $('#lockboxSkip').onclick = finish;
}

function lockboxRewardRow(r, i, bonus) {
    const thumbChildren = [];
    if (r.frameUrl) thumbChildren.push(el('img', { class: 'lb-frame', src: r.frameUrl, alt: '' }));
    if (r.iconUrl) thumbChildren.push(el('img', { class: 'lb-icon', src: r.iconUrl, alt: r.name }));
    return el('div', { class: 'lockbox-reward-row' + (bonus ? ' bonus' : ''), style: 'animation-delay:' + (i * 0.08) + 's' },
        el('div', { class: 'lockbox-reward-thumb' }, ...thumbChildren),
        el('div', { class: 'lockbox-reward-info' },
            el('div', { class: 'lockbox-reward-name' }, r.name),
            el('div', { class: 'lockbox-reward-count' }, 'x' + comma(r.count))
        )
    );
}

function lockboxMiniItem(r, bonus) {
    const thumbChildren = [];
    if (r.frameUrl) thumbChildren.push(el('img', { class: 'lb-frame', src: r.frameUrl, alt: '' }));
    if (r.iconUrl) thumbChildren.push(el('img', { class: 'lb-icon', src: r.iconUrl, alt: r.name }));
    return el('div', { class: 'lockbox-mini' + (bonus ? ' bonus' : '') },
        el('span', { class: 'lockbox-mini-tag' }, bonus ? '보너스' : '메인'),
        el('div', { class: 'lockbox-mini-thumb' }, ...thumbChildren),
        el('div', { class: 'lockbox-mini-info' },
            el('div', { class: 'lockbox-mini-name' }, r.name),
            el('div', { class: 'lockbox-mini-count' }, 'x' + comma(r.count))
        )
    );
}

function lockboxOpenCard(o, idx) {
    const card = el('div', { class: 'lockbox-open-card', style: 'animation-delay:' + (idx * 0.05) + 's' });
    card.appendChild(el('div', { class: 'lockbox-open-no' }, (idx + 1) + '회'));
    const body = el('div', { class: 'lockbox-open-body' });
    (o.main || []).forEach(r => body.appendChild(lockboxMiniItem(r, false)));
    (o.bonus || []).forEach(r => body.appendChild(lockboxMiniItem(r, true)));
    card.appendChild(body);
    return card;
}

function showLockboxResult(opens) {
    opens = opens || [];
    const overlay = $('#lockboxResultOverlay');
    const multi = opens.length > 1;
    const nodes = [
        el('div', { class: 'lockbox-result-title' }, '✦  봉인 해제  ✦'),
        el('div', { class: 'lockbox-result-sub' }, multi ? opens.length + '회 개봉 결과' : '봉인된 자물쇠에서 아이템을 획득했습니다'),
    ];
    if (multi) {
        const list = el('div', { class: 'lockbox-opens' });
        opens.forEach((o, idx) => list.appendChild(lockboxOpenCard(o, idx)));
        nodes.push(list);
    } else {
        const o = opens[0] || { main: [], bonus: [] };
        const grid = el('div', { class: 'lockbox-rewards-grid' });
        (o.main || []).forEach((r, i) => grid.appendChild(lockboxRewardRow(r, i, false)));
        nodes.push(grid);
        if ((o.bonus || []).length) {
            nodes.push(el('div', { class: 'lockbox-bonus-divider' }, '보너스'));
            const bonusGrid = el('div', { class: 'lockbox-rewards-grid' });
            o.bonus.forEach((r, i) => bonusGrid.appendChild(lockboxRewardRow(r, i, true)));
            nodes.push(bonusGrid);
        }
    }
    const closeBtn = el('button', { class: 'lockbox-result-close' }, '확인');
    closeBtn.onclick = () => overlay.classList.remove('active');
    nodes.push(closeBtn);
    overlay.replaceChildren(...nodes);
    overlay.classList.add('active');
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

// ===== 이벤트: 유생의 주사위 =====

const EVENT_DICE_REWARDS = {
    3:  { name: '축복받은 장비 보호권', count: 1,  mult: 170 },
    4:  { name: '고급 장비 보호권',     count: 1,  mult: 60 },
    5:  { name: '고급 패션 적용권',     count: 1,  mult: 30 },
    6:  { name: '장비 보호권',          count: 1,  mult: 16 },
    7:  { name: '패션 적용권',          count: 1,  mult: 11 },
    8:  { name: '지니어스의 열쇠',      count: 10, mult: 8 },
    9:  { name: '딜러 지렁이',          count: 20, mult: 6 },
    10: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    11: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    12: { name: '익명 지렁이',          count: 20, mult: 6 },
    13: { name: '캐릭터 변환석',        count: 2,  mult: 8 },
    14: { name: '7성 카드팩',           count: 1,  mult: 11 },
    15: { name: '8성 보호 카드',         count: 1,  mult: 16 },
    16: { name: '8성 카드팩',           count: 1,  mult: 30 },
    17: { name: '9성 카드팩',           count: 1,  mult: 60 },
    18: { name: '제타 카드팩',          count: 1,  mult: 170 }
};
const EVENT_DICE_SUMS = Object.keys(EVENT_DICE_REWARDS).map(Number);
const EVENT_DICE_PIPS = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
};
const EVENT_DICE_FACE_ANGLE = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: -90 },
    3: { x: -90, y: 0 },
    4: { x: 90, y: 0 },
    5: { x: 0, y: 90 },
    6: { x: 0, y: 180 }
};
let eventDiceState = { built: false, loading: false, rolling: false, prediction: null, dice: [null, null, null], result: null, history: [], diceItemCount: 0, rewards: null, lightningSum: null, lightningBolt: null, error: '' };
let eventLightningTimer = null;

function formatEventDiceEndDate() {
    return new Date(EVENT_DICE_END_TS).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

let eventDiceEndTimer = null;
function scheduleEventDiceEndRedirect() {
    if (EVENT_DICE_ENDED || eventDiceEndTimer) return;
    const delay = EVENT_DICE_END_TS - Date.now();
    if (delay <= 0) { location.href = '/?tab=' + encodeURIComponent('펀치기계'); return; }
    eventDiceEndTimer = setTimeout(() => {
        if (activePage === 'event') location.href = '/?tab=' + encodeURIComponent('펀치기계');
    }, delay);
}

// ===== 봉인된 자물쇠 탭 =====
const lockboxUi = name => '/lockbox-ui?file=' + encodeURIComponent(name);

function loadLockbox() {
    const root = $('#lockboxRoot');
    if (!root) return;
    const title = el('img', { class: 'lockbox-title', src: lockboxUi('글씨.png'), alt: '봉인된 자물쇠' });
    const item = el('img', { class: 'lockbox-item', src: lockboxUi('이달의 아이템.png'), alt: '이달의 아이템' });
    const char = el('img', { class: 'lockbox-char', src: lockboxUi('캐릭터.png'), alt: '' });
    const btns = el('div', { class: 'lockbox-btns' });
    btns.appendChild(el('button', { class: 'lockbox-btn', style: "background-image:url('" + lockboxUi('1회 열기 버튼.png') + "')", onclick: () => openLockbox(1) }));
    btns.appendChild(el('button', { class: 'lockbox-btn', style: "background-image:url('" + lockboxUi('10회 열기 버튼.png') + "')", onclick: () => openLockbox(10) }));
    root.replaceChildren(title, item, char, btns);
}

function generateEventLightningBolt(targetX, targetY) {
    const pts = [];
    const numSegs = 10 + Math.floor(Math.random() * 6);
    const startX = targetX + (Math.random() - 0.5) * 100;
    pts.push([startX, -30]);
    for (let i = 1; i < numSegs; i++) {
        const t = i / numSegs;
        const spread = 85 * (1 - Math.pow(t, 1.6)) + 8;
        const cx = startX + (targetX - startX) * t;
        pts.push([cx + (Math.random() - 0.5) * spread * 2, targetY * t]);
    }
    pts.push([targetX, targetY]);
    const main = pts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
    const branches = [];
    const numBranches = 2 + Math.floor(Math.random() * 2);
    for (let b = 0; b < numBranches; b++) {
        const idx = 2 + Math.floor(Math.random() * Math.floor(pts.length * 0.5));
        if (idx >= pts.length) continue;
        const [bx, by] = pts[idx];
        const len = 30 + Math.random() * 60;
        const angle = (Math.random() - 0.5) * Math.PI * 1.1;
        const bPts = [[bx, by]];
        const bSegs = 2 + Math.floor(Math.random() * 2);
        for (let s = 1; s <= bSegs; s++) {
            const t = s / bSegs;
            bPts.push([
                bx + Math.sin(angle) * len * t + (Math.random() - 0.5) * 14,
                by + Math.abs(Math.cos(angle)) * len * t
            ]);
        }
        branches.push(bPts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' '));
    }
    return { main, branches, width: window.innerWidth, height: window.innerHeight };
}

function renderEventLightningBolt() {
    const bolt = eventDiceState.lightningBolt;
    if (!bolt) return null;
    const branchSvg = bolt.branches.map(b => '<g><path d="' + b + '" stroke="rgba(255,240,80,0.4)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#eventBoltBlur)"/><path d="' + b + '" stroke="rgba(255,255,200,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>').join('');
    return svgIcon('<svg class="event-lightning-bolt-svg" width="' + bolt.width + '" height="' + bolt.height + '" viewBox="0 0 ' + bolt.width + ' ' + bolt.height + '"><defs><filter id="eventBoltBlur"><feGaussianBlur stdDeviation="5"/></filter></defs><path d="' + bolt.main + '" stroke="rgba(255,220,40,0.3)" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#eventBoltBlur)"/><path d="' + bolt.main + '" stroke="rgba(255,240,100,0.65)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="' + bolt.main + '" stroke="rgba(255,255,230,0.98)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' + branchSvg + '</svg>');
}

function triggerEventLightning(sum) {
    eventDiceState.lightningSum = sum;
    eventDiceState.lightningBolt = null;
    renderEventDice();
    requestAnimationFrame(() => {
        const target = document.querySelector('[data-event-lit="true"]');
        if (!target) return;
        const rect = target.getBoundingClientRect();
        eventDiceState.lightningBolt = generateEventLightningBolt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        renderEventDice();
        if (eventLightningTimer) clearTimeout(eventLightningTimer);
        eventLightningTimer = setTimeout(() => {
            eventDiceState.lightningBolt = null;
            renderEventDice();
        }, 580);
    });
}

function eventRewardIcon(reward, sizeClass) {
    return el('div', { class: 'event-reward-thumb ' + (sizeClass || '') },
        reward.frameUrl ? el('img', { class: 'event-reward-frame', src: reward.frameUrl, alt: '' }) : null,
        reward.iconUrl ? el('img', { class: 'event-reward-icon', src: reward.iconUrl, alt: reward.name, onload: e => { if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'none'; }, onerror: e => { e.currentTarget.style.display = 'none'; } }) : null,
        el('span', { class: 'event-reward-fallback' }, reward.name.slice(0, 1))
    );
}

function eventDie(value, index) {
    const faceAngle = value ? EVENT_DICE_FACE_ANGLE[value] : null;
    const transform = faceAngle ? 'rotateX(' + (faceAngle.x + 360 * (index + 1)) + 'deg) rotateY(' + (faceAngle.y + 360 * (index + 1)) + 'deg)' : '';
    const hit = eventDiceState.result && eventDiceState.result.prediction === eventDiceState.result.sum;
    const outcome = eventDiceState.result ? (hit ? ' win' : ' lose') : '';
    const stateClass = eventDiceState.rolling ? 'rolling' : value ? 'result' : 'idle';
    return el('div', { class: 'event-die ' + stateClass + outcome },
        el('div', { class: 'event-cube-settle' },
            el('div', { class: 'event-cube', style: transform ? { transform } : null },
                [1, 2, 3, 4, 5, 6].map(v =>
                    el('div', { class: 'event-face event-face' + v },
                        Array.from({ length: 9 }, (_, i) => el('span', { class: EVENT_DICE_PIPS[v].includes(i + 1) ? 'event-die-pip' : 'event-die-empty' }))
                    )
                )
            )
        )
    );
}

function eventRewardName(reward) {
    return reward.name + ' x' + comma(reward.count);
}

function renderEventDiceResult() {
    const result = eventDiceState.result;
    if (!result) {
        return el('div', { class: 'event-result-card waiting' },
            el('div', { class: 'event-result-kicker' }, eventDiceState.prediction ? 'READY' : 'PICK A SUM'),
            el('div', { class: 'event-result-title' }, eventDiceState.prediction ? '합계 ' + eventDiceState.prediction + ' 예측' : '합을 먼저 선택하세요'),
            el('div', { class: 'event-result-sub' }, '굴릴 때 유생의 주사위 1개가 소모됩니다.')
        );
    }
    const hit = result.prediction === result.sum;
    return el('div', { class: 'event-result-card hit ' + (hit ? 'win' : 'lose') + (result.lightning ? ' lightning' : '') },
        el('div', { class: 'event-result-kicker' }, hit ? 'PREDICTION HIT' : 'RESULT'),
        el('div', { class: 'event-result-title' }, '합계 ' + result.sum),
        el('div', { class: hit ? 'event-hit-label yes' : 'event-hit-label no' }, hit ? '예측 성공' : '예측 실패'),
        result.lightning ? el('div', { class: 'event-lightning-hit' }, el('span', { class: 'event-lit-bolt' }, '⚡'), '라이트닝 보상 2배') : null,
        el('div', { class: 'event-result-reward' },
            eventRewardIcon(result.reward, 'large'),
            el('div', null,
                el('div', { class: 'event-result-reward-name' }, result.reward.name),
                el('div', { class: 'event-result-reward-count' }, 'x' + comma(result.reward.count))
            )
        )
    );
}

function renderEventDiceRewardGrid() {
    const rewards = eventDiceState.rewards || EVENT_DICE_REWARDS;
    return el('div', { class: 'event-reward-grid' },
        EVENT_DICE_SUMS.map(sum => {
            const reward = rewards[sum] || EVENT_DICE_REWARDS[sum];
            const active = eventDiceState.result && eventDiceState.result.sum === sum;
            const picked = eventDiceState.prediction === sum;
            const lightning = eventDiceState.lightningSum === sum;
            return el('button', {
                class: 'event-reward-cell' + (active ? ' active' : '') + (picked ? ' picked' : '') + (lightning ? ' lightning lightning-striking' : ''),
                type: 'button',
                'data-event-lit': lightning ? 'true' : null,
                disabled: eventDiceState.rolling,
                onclick: () => { eventDiceState.prediction = sum; eventDiceState.result = null; renderEventDice(); }
            },
                lightning ? [el('div', { class: 'event-slot-spark' }), el('div', { class: 'event-slot-spark' }), el('div', { class: 'event-slot-spark' })] : null,
                el('div', { class: 'event-reward-sum' }, lightning ? el('span', { class: 'event-lit-bolt' }, '⚡') : null, sum),
                eventRewardIcon(reward),
                el('div', { class: 'event-reward-name' }, reward.name),
                el('div', { class: 'event-reward-count' }, 'x' + comma(reward.count) + (lightning ? ' → x' + comma(reward.count * 2) : ''))
            );
        })
    );
}

function renderEventDiceHistory() {
    if (!eventDiceState.history.length) return el('div', { class: 'event-history-empty' }, '아직 기록이 없습니다.');
    return el('div', { class: 'event-history-list' },
        eventDiceState.history.map(item =>
            el('div', { class: 'event-history-row' },
                el('span', { class: 'event-history-sum' }, item.sum),
                el('span', { class: 'event-history-dice' }, item.dice.join(' + ')),
                el('span', { class: 'event-history-reward' }, eventRewardName(item.reward)),
                el('span', { class: item.prediction === item.sum ? 'event-history-hit yes' : 'event-history-hit no' }, item.prediction === item.sum ? 'HIT' : 'MISS')
            )
        )
    );
}

function renderEventDice() {
    const root = $('#eventDiceRoot');
    if (!root) return;
    const dice = eventDiceState.dice;
    const canRoll = eventDiceState.prediction !== null && eventDiceState.diceItemCount > 0 && !eventDiceState.rolling && !eventDiceState.loading;
    const rollBtn = el('button', {
        class: 'event-roll-btn primary',
        type: 'button',
        disabled: !canRoll,
        onclick: rollEventDice
    }, eventDiceState.rolling ? '굴리는 중...' : eventDiceState.prediction === null ? '합을 선택하세요' : eventDiceState.diceItemCount <= 0 ? '유생의 주사위 부족' : '주사위 굴리기');

    const effects = [];
    if (eventDiceState.result) {
        const hit = eventDiceState.result.prediction === eventDiceState.result.sum;
        effects.push(el('div', { class: 'event-screen-flash ' + (hit ? 'win' : 'lose') }));
        effects.push(el('div', { class: 'event-outcome-burst ' + (hit ? 'win' : 'lose') }, hit ? '예측 성공' : '예측 실패'));
    }

    if (eventDiceState.lightningBolt) {
        effects.push(el('div', { class: 'event-lightning-flash' }));
        effects.push(renderEventLightningBolt());
    }

    root.replaceChildren(
        ...effects,
        el('div', { class: 'event-dice-main' },
            el('div', { class: 'event-title-block' },
                el('div', { class: 'event-eyebrow' }, 'EVENT'),
                el('h2', null, '유생의 주사위'),
                el('div', { class: 'event-subcopy' }, '합을 예측한 뒤 주사위를 굴려 보상을 획득합니다.'),
                el('div', { class: 'event-end-date' }, '이벤트 종료: ' + formatEventDiceEndDate())
            ),
            el('div', { class: 'event-dice-row' }, dice.map((value, index) => eventDie(value, index))),
            renderEventDiceResult(),
            el('div', { class: 'event-ticket-line' },
                el('span', null, '보유 유생의 주사위'),
                el('b', null, comma(eventDiceState.diceItemCount) + '개')
            ),
            rollBtn
        ),
        el('div', { class: 'event-dice-side' },
            el('div', { class: 'event-panel-title' }, '합 예측'),
            renderEventDiceRewardGrid(),
            eventDiceState.error ? el('div', { class: 'event-error' }, eventDiceState.error) : null,
            el('div', { class: 'event-panel-title event-history-title' }, '최근 결과'),
            renderEventDiceHistory()
        )
    );
}

async function rollEventDice() {
    if (eventDiceState.rolling || eventDiceState.prediction === null) return;
    eventDiceState.rolling = true;
    eventDiceState.result = null;
    eventDiceState.lightningSum = null;
    eventDiceState.lightningBolt = null;
    eventDiceState.error = '';
    renderEventDice();
    try {
        const minSpin = new Promise(resolve => setTimeout(resolve, 1100));
        const req = postApi('/api/event/dice/roll', { prediction: eventDiceState.prediction }).then(data => {
            if (data.lightningSum) triggerEventLightning(data.lightningSum);
            return data;
        });
        const [data] = await Promise.all([req, minSpin]);
        eventDiceState = Object.assign(eventDiceState, {
            rolling: false,
            dice: data.dice,
            diceItemCount: data.diceItemCount,
            result: data,
            history: [data].concat(eventDiceState.history).slice(0, 5)
        });
    } catch (e) {
        eventDiceState.rolling = false;
        eventDiceState.error = e.message;
    }
    renderEventDice();
}

async function loadEventDice() {
    scheduleEventDiceEndRedirect();
    const root = $('#eventDiceRoot');
    if (root && !eventDiceState.built) root.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    if (!eventDiceState.built) eventDiceState.built = true;
    eventDiceState.loading = true;
    try {
        const data = await api('/api/event/dice');
        if (data.ended) {
            eventDiceState.loading = false;
            location.href = '/?tab=' + encodeURIComponent('펀치기계');
            return;
        }
        eventDiceState.diceItemCount = data.diceItemCount || 0;
        eventDiceState.rewards = data.rewards || null;
        eventDiceState.error = '';
    } catch (e) {
        eventDiceState.error = e.message;
    }
    eventDiceState.loading = false;
    renderEventDice();
}

// ===== 펀치기계 =====
const PUNCH_MIN_SCORE = 3000, PUNCH_MAX_SCORE = 9999;
const PUNCH_PUCK_RANGE = 334;        // SVG 단위: 파워 0→1 시 퍽 이동 거리
const PUNCH_LIGHT_COUNT = 14;
const PUNCH_RING_R = 116;            // 다이얼 SVG(280) 기준 점이 도는 원 반지름
// phase: 'idle'(토큰 대기) | 'ready'(점이 회전, 멈출 수 있음) | 'busy'(연출 중)
// tab(모바일 전용): 'machine'(펀치기계 화면) | 'rewards'(보상 화면)
let punchState = { built: false, phase: 'idle', tokenCount: 0, rank: [], rewards: null, pendingChoice: false, tab: 'machine', token: null, angle: Math.PI, raf: 0, lastTs: 0, best: 0 };
let punchEls = null;

async function loadPunch() {
    const root = $('#punchRoot');
    if (!root) return;
    if (!punchState.built) {
        punchState.best = Number(localStorage.getItem('punchBest') || 0) || 0;
        buildPunchUI(root);
        punchState.built = true;
    }
    try {
        const data = await api('/api/punch');
        punchState.tokenCount = data.tokenCount || 0;
        punchState.rank = data.rank || [];
        punchState.rewards = data.rewards || null;
        punchState.pendingChoice = !!data.pendingChoice;
    } catch (e) { /* 네트워크 실패 시 기존 상태 유지 */ }
    renderPunchMeta();
    renderPunchRewardInfo();
    renderPunchRank();
    updatePunchPuck(0);
    if (punchState.pendingChoice) openPunch9999Modal();
}

function buildPunchUI(root) {
    let lights = '';
    for (let i = 0; i < PUNCH_LIGHT_COUNT; i++) {
        const level = 1 - i / (PUNCH_LIGHT_COUNT - 1);
        const y = (70 + i * (400 - 70) / (PUNCH_LIGHT_COUNT - 1)).toFixed(1);
        lights += '<circle class="pm-light" data-level="' + level.toFixed(4) + '" cx="64" cy="' + y + '" r="4"/>';
        lights += '<circle class="pm-light" data-level="' + level.toFixed(4) + '" cx="128" cy="' + y + '" r="4"/>';
    }
    const svg = `<svg class="punch-tower" viewBox="0 0 200 470" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pmFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3c66"/><stop offset="1" stop-color="#121b31"/></linearGradient>
    <linearGradient id="pmSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1729"/><stop offset="1" stop-color="#070b15"/></linearGradient>
    <linearGradient id="pmTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a4c80"/><stop offset="1" stop-color="#243760"/></linearGradient>
    <linearGradient id="pmTrack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1120"/><stop offset="1" stop-color="#05080f"/></linearGradient>
    <radialGradient id="pmPuck" cx="40%" cy="32%" r="80%"><stop offset="0" stop-color="#fff6c4"/><stop offset="45%" stop-color="#ffc24a"/><stop offset="100%" stop-color="#ff7a1a"/></radialGradient>
    <linearGradient id="pmBell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe79a"/><stop offset="1" stop-color="#caa033"/></linearGradient>
    <radialGradient id="pmCoin" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff1b0"/><stop offset="55%" stop-color="#f4c430"/><stop offset="100%" stop-color="#b8860b"/></radialGradient>
    <filter id="pmGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <ellipse cx="96" cy="456" rx="74" ry="13" fill="rgba(0,0,0,.45)"/>
  <polygon points="56,40 76,26 156,26 136,40" fill="url(#pmTop)"/>
  <polygon points="136,40 156,26 156,406 136,420" fill="url(#pmSide)"/>
  <rect x="56" y="40" width="80" height="380" rx="9" fill="url(#pmFront)" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
  <rect x="74" y="48" width="44" height="370" rx="13" fill="#05070d" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/>
  <rect x="78" y="52" width="36" height="362" rx="10" fill="url(#pmTrack)"/>
  <rect x="78" y="41" width="36" height="9" rx="4" fill="#0a0f1c" stroke="rgba(0,0,0,.7)" stroke-width="1"/>
  <rect x="84" y="43.4" width="24" height="4" rx="2" fill="#04060c"/>
  ${lights}
  <g id="punchBell">
    <rect x="83" y="14" width="26" height="6" rx="3" fill="#8a6d22"/>
    <path d="M75 18 Q96 -10 117 18 Z" fill="url(#pmBell)" stroke="#7a5e1c" stroke-width="1"/>
    <circle cx="96" cy="20" r="3.2" fill="#7a5e1c"/>
  </g>
  <g id="punchCoin" opacity="0">
    <circle cx="96" cy="46" r="9" fill="url(#pmCoin)" stroke="#9a7b1e" stroke-width="1.5"/>
    <ellipse cx="96" cy="46" rx="4" ry="6" fill="rgba(120,90,10,.35)"/>
  </g>
  <g id="punchPuck">
    <rect x="70" y="57" width="52" height="22" rx="7" fill="url(#pmPuck)" filter="url(#pmGlow)"/>
    <rect x="75" y="61" width="42" height="5" rx="2.5" fill="rgba(255,255,255,.75)"/>
  </g>
</svg>`;
    const towerWrap = el('div', { class: 'punch-tower-wrap' });
    towerWrap.innerHTML = svg;

    const lcd = el('div', { class: 'punch-lcd' },
        el('span', { class: 'punch-lcd-screw tl' }), el('span', { class: 'punch-lcd-screw tr' }),
        el('span', { class: 'punch-lcd-screw bl' }), el('span', { class: 'punch-lcd-screw br' }),
        el('div', { class: 'punch-lcd-label' }, 'SCORE'),
        el('div', { class: 'punch-lcd-screen' },
            el('span', { class: 'punch-lcd-ghost' }, '8888'),
            el('span', { class: 'punch-lcd-value', id: 'punchScoreValue' }, '0')),
        el('div', { class: 'punch-best' }, 'BEST ', el('b', { id: 'punchBest' }, String(punchState.best))));

    const dial = el('div', { class: 'punch-dial', id: 'punchDial' });
    dial.innerHTML = `<svg class="punch-ring" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pmRing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff3b3b"/>
      <stop offset="0.32" stop-color="#ff8a1e"/>
      <stop offset="0.55" stop-color="#ffd21e"/>
      <stop offset="1" stop-color="#27c93f"/>
    </linearGradient>
    <filter id="pmDotGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <circle cx="140" cy="140" r="${PUNCH_RING_R}" fill="none" stroke="#0b1120" stroke-width="22"/>
  <circle class="punch-ring-grad" cx="140" cy="140" r="${PUNCH_RING_R}" fill="none" stroke="url(#pmRing)" stroke-width="13" stroke-linecap="round"/>
  <g id="punchDot" class="punch-dot"><circle cx="140" cy="140" r="11" fill="#fff" stroke="#0b1120" stroke-width="3" filter="url(#pmDotGlow)"/></g>
</svg>`;
    const pad = el('button', { class: 'punch-pad', id: 'punchPad', type: 'button' },
        el('span', { class: 'pm-glove' }, ''),
        el('span', { class: 'punch-pad-label', id: 'punchPadLabel' }, ''));
    dial.appendChild(pad);

    const coinBtn = el('button', { class: 'punch-coin-btn', id: 'punchCoinBtn', type: 'button' },
        '토큰 투입 (', el('b', { id: 'punchTokenCount' }, String(punchState.tokenCount)), ')');

    // 펀치기계 화면(머신): 타워 + LCD + 다이얼 + 토큰 버튼.
    const machine = el('div', { class: 'punch-machine active', 'data-ptab': 'machine' },
        el('div', { class: 'punch-title-block' },
            el('div', { class: 'punch-eyebrow' }, 'POWER OF ONE PUNCH'),
            el('h2', null, '펀치기계'),
            el('div', { class: 'punch-sub' }, '당신의 힘을 뽐내보세요!')),
        el('div', { class: 'punch-machine-body' },
            towerWrap,
            el('div', { class: 'punch-machine-controls' }, lcd, dial, coinBtn)));

    // 보상 화면: 주간 1위 보상 + 점수 구간별 보상 + 랭킹.
    const rewards = el('div', { class: 'punch-rewards', 'data-ptab': 'rewards' },
        el('div', { class: 'punch-rewards-head' }, el('h3', null, '보상 안내')),
        el('div', { class: 'punch-weekly', id: 'punchWeekly' }),
        el('div', { class: 'punch-tier-list', id: 'punchTierList' }),
        el('div', { class: 'punch-rank' },
            el('div', { class: 'punch-rank-title' }, '펀치 랭킹 TOP 5'),
            el('div', { class: 'punch-rank-list', id: 'punchRankList' })));

    // 모바일 전용 스위치 탭.
    const tabs = el('div', { class: 'punch-tabs' },
        el('button', { class: 'punch-tab active', 'data-ptab': 'machine', type: 'button', onclick: () => switchPunchTab('machine') }, '펀치기계'),
        el('button', { class: 'punch-tab', 'data-ptab': 'rewards', type: 'button', onclick: () => switchPunchTab('rewards') }, '보상'));

    const stage = el('div', { class: 'punch-stage', id: 'punchStage' }, tabs, machine, rewards);
    root.replaceChildren(stage);

    punchEls = {
        stage,
        puck: root.querySelector('#punchPuck'),
        bell: root.querySelector('#punchBell'),
        coin: root.querySelector('#punchCoin'),
        lights: Array.from(root.querySelectorAll('.pm-light')),
        value: root.querySelector('#punchScoreValue'),
        best: root.querySelector('#punchBest'),
        dial, pad,
        padLabel: root.querySelector('#punchPadLabel'),
        dot: root.querySelector('#punchDot'),
        coinBtn,
        tokenCountEl: root.querySelector('#punchTokenCount'),
        rankList: root.querySelector('#punchRankList'),
        weekly: root.querySelector('#punchWeekly'),
        tierList: root.querySelector('#punchTierList'),
        machine, rewards,
        tabBtns: Array.from(root.querySelectorAll('.punch-tab'))
    };
    coinBtn.addEventListener('click', insertPunchCoin);
    pad.addEventListener('click', punchStop);
    renderPunchDot();
}

function switchPunchTab(tab) {
    punchState.tab = tab;
    if (!punchEls) return;
    punchEls.machine.classList.toggle('active', tab === 'machine');
    punchEls.rewards.classList.toggle('active', tab === 'rewards');
    punchEls.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.ptab === tab));
}

// 보상 아이콘(프레임 + 아이템 이미지 + 수량).
function punchRewardIcon(reward) {
    const thumb = el('div', { class: 'punch-reward-thumb' });
    if (reward.frameUrl) thumb.appendChild(el('img', { class: 'punch-reward-frame', src: reward.frameUrl, alt: '' }));
    if (reward.iconUrl) thumb.appendChild(el('img', { class: 'punch-reward-icon', src: reward.iconUrl, alt: reward.name }));
    else thumb.appendChild(el('span', { class: 'punch-reward-fallback' }, '🎁'));
    if (Number(reward.count) > 1) thumb.appendChild(el('span', { class: 'punch-reward-count' }, 'x' + reward.count));
    return thumb;
}

function punchTierRow(t) {
    const tag = t.choice ? '택1' : (t.rewards.length > 1 ? '랜덤' : '');
    const names = t.rewards.map(r => r.name + (Number(r.count) > 1 ? ' x' + r.count : '')).join(t.choice ? ' / ' : ' or ');
    return el('div', { class: 'punch-tier-row' + (t.choice ? ' top' : '') },
        el('div', { class: 'punch-tier-range' }, t.label),
        el('div', { class: 'punch-tier-icons' }, ...t.rewards.map(punchRewardIcon)),
        el('div', { class: 'punch-tier-name' }, names,
            tag ? el('span', { class: 'punch-tier-tag' }, tag) : null));
}

function renderPunchRewardInfo() {
    if (!punchEls || !punchEls.weekly) return;
    const r = punchState.rewards;
    if (!r) return;
    punchEls.weekly.replaceChildren(
        el('div', { class: 'punch-weekly-badge' }, '👑 주간 1위'),
        punchRewardIcon(r.weeklyPrize),
        el('div', { class: 'punch-weekly-info' },
            el('div', { class: 'punch-weekly-name' }, r.weeklyPrize.name),
            el('div', { class: 'punch-weekly-note' }, '매주 랭킹 1위에게 자동 지급')));
    punchEls.tierList.replaceChildren(...(r.tiers || []).map(punchTierRow));
}

function renderPunchMeta() {
    if (!punchEls) return;
    punchEls.tokenCountEl.textContent = String(punchState.tokenCount);
    const idle = punchState.phase === 'idle';
    punchEls.coinBtn.disabled = !idle || punchState.tokenCount < 1;
    punchEls.pad.disabled = punchState.phase !== 'ready';
    punchEls.dial.classList.toggle('active', punchState.phase === 'ready');
    punchEls.padLabel.textContent = punchState.phase === 'ready' ? '' : punchState.phase === 'busy' ? '' : '';
}

function renderPunchRank() {
    if (!punchEls) return;
    if (!punchState.rank.length) { punchEls.rankList.replaceChildren(el('div', { class: 'punch-rank-empty' }, '아직 기록이 없습니다.')); return; }
    punchEls.rankList.replaceChildren(...punchState.rank.map((e, i) =>
        el('div', { class: 'punch-rank-row' + (e.name === myName ? ' me' : '') },
            el('span', { class: 'punch-rank-no r' + (i + 1) }, String(i + 1)),
            el('span', { class: 'punch-rank-name' }, e.name),
            el('span', { class: 'punch-rank-score' }, String(e.score)))));
}

function updatePunchPuck(gauge) {
    if (!punchEls) return;
    const ty = (1 - gauge) * PUNCH_PUCK_RANGE;
    punchEls.puck.setAttribute('transform', 'translate(0,' + ty.toFixed(2) + ')');
    punchEls.lights.forEach(l => l.classList.toggle('on', gauge >= Number(l.dataset.level)));
}

// 점을 현재 각도 위치에 배치(angle=0 → 맨 위).
function renderPunchDot() {
    if (!punchEls) return;
    const dx = PUNCH_RING_R * Math.sin(punchState.angle);
    const dy = -PUNCH_RING_R * Math.cos(punchState.angle);
    punchEls.dot.setAttribute('transform', 'translate(' + dx.toFixed(2) + ',' + dy.toFixed(2) + ')');
}

async function insertPunchCoin() {
    if (punchState.phase !== 'idle') return;
    if (punchState.tokenCount < 1) { openModal('토큰 부족', '', ['펀치기계 토큰이 없습니다.']); return; }
    punchState.phase = 'busy';
    renderPunchMeta();
    let data;
    try {
        data = await postApi('/api/punch/play', {});
    } catch (e) {
        punchState.phase = 'idle';
        renderPunchMeta();
        openModal('오류', '', [e.message]);
        return;
    }
    punchState.token = data.token;
    punchState.tokenCount = data.tokenCount;
    punchEls.tokenCountEl.textContent = String(punchState.tokenCount);
    animatePunchCoin(startPunchOrbit);
}

// 동전이 머신 투입구로 떨어지는 연출.
function animatePunchCoin(done) {
    const coin = punchEls.coin;
    if (!coin) { done(); return; }
    const start = performance.now(), dur = 720, easeIn = p => p * p;
    function step(t) {
        const p = Math.min(1, (t - start) / dur);
        const y = -86 * (1 - easeIn(p));
        const op = p < 0.14 ? p / 0.14 : (p > 0.82 ? Math.max(0, 1 - (p - 0.82) / 0.18) : 1);
        coin.setAttribute('transform', 'translate(0,' + y.toFixed(1) + ')');
        coin.setAttribute('opacity', op.toFixed(2));
        if (p < 1) requestAnimationFrame(step);
        else { coin.setAttribute('opacity', '0'); done(); }
    }
    requestAnimationFrame(step);
}

function startPunchOrbit() {
    punchState.phase = 'ready';
    punchState.angle = Math.PI;          // 맨 아래에서 시작
    punchState.lastTs = 0;
    updatePunchPuck(0);                   // 퍽을 바닥으로 리셋
    if (punchEls) punchEls.value.textContent = '0';
    renderPunchMeta();
    punchState.raf = requestAnimationFrame(punchOrbit);
}

function punchOrbit(ts) {
    if (punchState.phase !== 'ready') return;
    if (!punchState.lastTs) punchState.lastTs = ts;
    const dt = Math.min(60, ts - punchState.lastTs) / 1000;
    punchState.lastTs = ts;
    const power = (Math.cos(punchState.angle) + 1) / 2;     // 위=1, 아래=0
    const omega = 4.5 + 10.8 * power;                        // 위로 갈수록 빠르게, 아래로 갈수록 느리게 (기존 대비 +80%)
    punchState.angle = (punchState.angle + omega * dt) % (Math.PI * 2);
    renderPunchDot();
    punchState.raf = requestAnimationFrame(punchOrbit);
}

function punchStop() {
    if (punchState.phase !== 'ready') return;
    punchState.phase = 'busy';
    cancelAnimationFrame(punchState.raf);
    renderPunchMeta();
    const power = (Math.cos(punchState.angle) + 1) / 2;      // 점의 높이 → 파워(위=1)
    // 파워가 가리키는 '원래 점수'에 -1000~+100의 랜덤 오프셋(주로 깎이고 드물게 약간 상승).
    const base = PUNCH_MIN_SCORE + power * (PUNCH_MAX_SCORE - PUNCH_MIN_SCORE);
    const offset = Math.random() * 1100 - 1000;
    const score = Math.min(PUNCH_MAX_SCORE, Math.max(PUNCH_MIN_SCORE, Math.round(base + offset)));
    settlePunch((score - PUNCH_MIN_SCORE) / (PUNCH_MAX_SCORE - PUNCH_MIN_SCORE), score);
}

function settlePunch(targetGauge, score) {
    const start = performance.now(), dur = 560;
    const backOut = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
    function step(t) {
        const p = Math.min(1, (t - start) / dur);
        updatePunchPuck(targetGauge * backOut(p));
        if (p < 1) requestAnimationFrame(step);
        else updatePunchPuck(targetGauge);
    }
    requestAnimationFrame(step);
    revealPunchScore(score);
}

// 점수판을 앞자리부터 차례대로 공개. 미확정 자리는 빠르게 깜빡여 긴장감을 준다.
function revealPunchScore(score) {
    const digits = String(score).split('');          // 항상 4자리(3000~9999)
    const perDigit = 650;                              // 자리당 공개 간격(ms)
    const total = perDigit * digits.length;            // 전체 공개 시간(ms)
    const start = performance.now();
    let lastFlick = 0, lastLocked = -1;
    function frame(t) {
        const elapsed = t - start;
        const locked = Math.min(digits.length, Math.floor(elapsed / perDigit));
        if (locked !== lastLocked || t - lastFlick > 5) {
            let out = '';
            for (let i = 0; i < digits.length; i++) out += i < locked ? digits[i] : Math.floor(Math.random() * 10);
            if (punchEls) punchEls.value.textContent = out;
            lastFlick = t;
            lastLocked = locked;
        }
        if (elapsed < total) requestAnimationFrame(frame);
        else finishPunch(score);
    }
    requestAnimationFrame(frame);
}

async function finishPunch(score) {
    if (punchEls) punchEls.value.textContent = String(score);
    if (score >= 9000 && punchEls) {
        punchEls.bell.classList.add('ring');
        setTimeout(() => punchEls.bell.classList.remove('ring'), 900);
    }
    if (score > punchState.best) {
        punchState.best = score;
        localStorage.setItem('punchBest', String(score));
        if (punchEls) punchEls.best.textContent = String(score);
    }
    let resp = null;
    if (punchState.token) {
        try {
            resp = await postApi('/api/punch/score', { token: punchState.token, score });
            if (Array.isArray(resp.rank)) punchState.rank = resp.rank;
        } catch (e) { /* 기록 실패해도 게임은 진행 */ }
        punchState.token = null;
    }
    punchState.phase = 'idle';
    renderPunchMeta();
    renderPunchRank();
    if (resp) {
        if (resp.pendingChoice) { punchState.pendingChoice = true; openPunch9999Modal(); }
        else if (resp.reward) openPunchRewardModal(resp.reward);
    }
}

// 모달 닫기 잠금(9999 선택 등 반드시 선택해야 하는 경우 백드롭/닫기 무효화).
let modalLocked = false;
function setModalCloseVisible(v) {
    const btn = $('#modalClose');
    if (btn) btn.style.display = v ? '' : 'none';
}

function openPunchRewardModal(reward) {
    modalLocked = false;
    setModalCloseVisible(true);
    openRichModal('보상 획득!', '', [
        el('div', { class: 'punch-result-modal' },
            punchRewardIcon(reward),
            el('div', { class: 'punch-result-name' }, reward.name + (Number(reward.count) > 1 ? ' x' + reward.count : '')),
            el('div', { class: 'punch-result-sub' }, '인벤토리에서 확인하세요.'))
    ]);
}

function openPunch9999Modal() {
    const r = punchState.rewards;
    const choices = (r && r.choice9999) || [];
    if (!choices.length) return;
    modalLocked = true;
    setModalCloseVisible(false);
    openRichModal('🎉 9999 달성!', '보상을 선택하세요', [
        el('div', { class: 'punch-choice-row' },
            ...choices.map(c => el('button', { class: 'punch-choice-btn', type: 'button', onclick: () => claimPunch9999(c.key) },
                punchRewardIcon(c),
                el('span', { class: 'punch-choice-name' }, c.name))))
    ]);
}

async function claimPunch9999(choice) {
    try {
        const data = await postApi('/api/punch/claim', { choice });
        punchState.pendingChoice = false;
        modalLocked = false;
        setModalCloseVisible(true);
        if (data.reward) openPunchRewardModal(data.reward);
        else closeModal();
    } catch (e) { alert(e.message); }
}

// ===== 조합 =====

let combineState = { cards: [], meta: { table: {}, protect: {}, lucky: [], gold: 0 }, slots: [null, null, null], protectIndex: null, luckyRate: null, result: null, busy: false, built: false, slotEls: null };

function combineUi(file) { return '/combine-ui?file=' + encodeURIComponent(file); }

function combineGrade() {
    const filled = combineState.slots.find(Boolean);
    return filled ? filled.star : null;
}

function combineType() {
    const filled = combineState.slots.find(Boolean);
    return filled ? (filled.type || '일반') : null;
}

// ===== 장비 강화 =====
let enhanceState = { preview: null, busy: false, selectedProtectLevel: 'auto' };


function openEnhanceModal(eq) {
    if (!Number(eq.number || 0)) return;
    $('#enhanceOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadEnhancePreview(eq.number);
}

function showEnhanceError(msg) {
    $('#enhanceContent').replaceChildren(
        el('div', { class: 'enhance-error-wrap' },
            el('div', { class: 'empty err' }, msg),
            el('button', { class: 'enhance-cancel-btn', style: 'margin-top:12px;width:100%', onclick: closeEnhanceModal }, '닫기')
        )
    );
}

async function loadEnhancePreview(number) {
    $('#enhanceContent').replaceChildren(el('div', { class: 'loading', style: 'padding:60px 0;text-align:center' }, '불러오는 중...'));
    $('#enhanceResultOverlay').classList.remove('active');
    try {
        const data = await api('/api/equipment/upgrade/preview/' + number);
        if (data.error) { showEnhanceError(data.error); return; }
        enhanceState.preview = data;
        renderEnhancePreview(data);
    } catch (e) {
        showEnhanceError(e.message);
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

    const getEffectiveProtect = () => {
        const opts = data.protectOptions || [];
        const sel = enhanceState.selectedProtectLevel;
        if (sel === 'none') return null;
        if (!sel || sel === 'auto') return opts[0] || null;
        return opts.find(o => o.level === sel) || null;
    };

    const buildProtectCard = () => {
        const opts = data.protectOptions || [];
        const effective = getEffectiveProtect();
        const canPick = opts.length > 0;
        const cardClass = 'enhance-protect ' + (effective ? (effective.level || 'basic') : 'none') + (canPick ? ' clickable' : '');
        const card = el('div', { class: cardClass, onclick: canPick ? () => openProtectPicker(data) : null });
        if (effective) {
            card.appendChild(el('div', { class: 'enhance-protect-icon' },
                effective.iconUrl ? el('img', { class: 'enhance-protect-img', src: effective.iconUrl, alt: '' }) : '🛡'));
            card.appendChild(el('div', { class: 'enhance-protect-text' },
                el('div', { class: 'enhance-protect-name' }, effective.label),
                el('div', { class: 'enhance-protect-detail' }, effective.detail)
            ));
            card.appendChild(el('div', { class: 'enhance-protect-badge' }, '보유 ' + effective.count + '개'));
        } else {
            card.appendChild(el('div', { class: 'enhance-protect-icon' }, '⊘'));
            card.appendChild(el('div', { class: 'enhance-protect-text' },
                el('div', { class: 'enhance-protect-name' }, '보호 없음'),
                el('div', { class: 'enhance-protect-detail' }, opts.length ? '클릭하여 보호권 선택' : '보호권 미보유')
            ));
        }
        if (canPick) card.appendChild(el('div', { class: 'enhance-protect-pick-arrow' }, '▾'));
        return card;
    };

    const confirmBtn = el('button', { class: 'enhance-confirm-btn', id: 'enhanceConfirmBtn', onclick: () => {
        const effective = getEffectiveProtect();
        if (Number(data.rates.reset || 0) > 0 && !effective) showEnhanceWarning(() => runEnhancement(data.number));
        else runEnhancement(data.number);
    } }, '강화');
    if (!data.canUpgrade) confirmBtn.disabled = true;

    const protectNodes = (data.protectOptions != null)
        ? [buildProtectCard()]
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
                enhCostItem(data.cost.stoneName || '강화석', comma(data.cost.stone) + '개', comma(data.stoneCount) + '개 보유', data.hasStone),
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

function openProtectPicker(previewData) {
    const opts = previewData.protectOptions || [];
    const cur = enhanceState.selectedProtectLevel;

    const body = el('div', { class: 'protect-picker' });
    const makeRow = (level, label, detail, iconUrl, count, isCur) => {
        const row = el('div', {
            class: 'protect-pick-row' + (isCur ? ' selected' : ''),
            onclick: () => {
                enhanceState.selectedProtectLevel = level;
                closeModal();
                renderEnhancePreview(previewData);
            }
        });
        const icon = el('div', { class: 'protect-pick-icon' });
        if (iconUrl) icon.appendChild(el('img', { src: iconUrl, alt: '' }));
        else icon.textContent = level === 'none' ? '⊘' : '🛡';
        row.appendChild(icon);
        const txt = el('div', { class: 'protect-pick-text' });
        txt.appendChild(el('div', { class: 'protect-pick-name' }, label));
        txt.appendChild(el('div', { class: 'protect-pick-detail' }, detail));
        row.appendChild(txt);
        if (count != null) row.appendChild(el('div', { class: 'protect-pick-count' }, count + '개'));
        if (isCur) row.appendChild(el('div', { class: 'protect-pick-check' }, '✓'));
        return row;
    };

    const isNone = cur === 'none';
    const isAuto = !cur || cur === 'auto';
    body.appendChild(makeRow('none', '보호 없음', '보호권을 사용하지 않습니다', null, null, isNone));
    opts.forEach(opt => {
        const isCur = isAuto ? opt === opts[0] : cur === opt.level;
        body.appendChild(makeRow(opt.level, opt.label, opt.detail, opt.iconUrl, opt.count, isCur));
    });

    $('#modalTitle').textContent = '보호권 선택';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

async function runEnhancement(number) {
    if (enhanceState.busy) return;
    enhanceState.busy = true;
    const btn = $('#enhanceConfirmBtn');
    if (btn) btn.disabled = true;
    const itemInfo = enhanceState.preview ? { name: enhanceState.preview.name, iconUrl: enhanceState.preview.iconUrl, frameUrl: enhanceState.preview.frameUrl } : {};
    // resolve effective protectLevel
    const opts = enhanceState.preview && enhanceState.preview.protectOptions || [];
    const sel = enhanceState.selectedProtectLevel;
    let protectLevel;
    if (sel === 'none') protectLevel = 'none';
    else if (!sel || sel === 'auto') protectLevel = opts[0] ? opts[0].level : 'none';
    else protectLevel = sel;
    try {
        const data = await postApi('/api/equipment/upgrade/run', { number, protectLevel });
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
    enhanceState.selectedProtectLevel = 'auto';
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
        limg.src = combineUi((combineState.slots[combineState.protectIndex].star + 1) + '성 보호 카드.png');
        els.lucky.classList.remove('empty');
    } else if (combineState.luckyRate != null) {
        limg.src = combineUi('럭키' + Math.round(combineState.luckyRate * 100) + '%.png');
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
        const lucky = combineState.luckyRate != null;
        const shownRate = lucky ? Math.min(1, t.rate * (1 + combineState.luckyRate)) : t.rate;
        let s = (grade + 1) + '성 조합 · 성공 확률 ' + (Math.round(shownRate * 1000) / 10) + '%' + (lucky ? ' 🍀' : '') + ' · 필요 골드 🪙 ' + comma(t.gold);
        if (t.guarantee) s += ' · 보정 ' + comma(t.count) + '/' + comma(t.guarantee);
        lines.push(s);
    } else lines.push('이 등급은 조합할 수 없습니다.');
    let extra = '';
    if (combineState.protectIndex != null) extra = ' · 🛡️ ' + (combineState.protectIndex + 1) + '번째 재료 보호';
    else if (combineState.luckyRate != null) extra = ' · 🍀 럭키 ' + (Math.round(combineState.luckyRate * 1000) / 10) + '% 증가';
    lines.push('선택 ' + filled + '/3' + extra);
    info.replaceChildren(...lines.map(l => el('div', null, l)));
}

function renderCombinePool() {
    const pool = $('#combinePool');
    if (!pool) return;
    if (!combineState.cards.length) { pool.replaceChildren(el('div', { class: 'empty' }, '보유한 캐릭터 카드가 없습니다.')); return; }
    const grade = combineGrade();
    const type = combineType();
    const used = new Set(combineState.slots.filter(Boolean).map(c => c.number));
    pool.replaceChildren(...combineState.cards.map(card => {
        const selected = used.has(card.number);
        const cardType = card.type || '일반';
        const disabled = !selected && (!card.combinable || (grade != null && card.star != grade) || (type != null && cardType !== type));
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
    const type = combineType();
    if (!card.combinable) { alert('이 등급은 조합할 수 없습니다.'); return; }
    if (grade != null && card.star != grade) { alert('같은 등급의 카드끼리만 조합할 수 있습니다.'); return; }
    if (type != null && (card.type || '일반') !== type) { alert('같은 종류의 카드끼리만 조합할 수 있습니다.'); return; }
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
    const hasProtect = !!combineState.meta.protect[grade];
    const hasLucky = (combineState.meta.lucky || []).length > 0;
    if (!hasProtect && !hasLucky) { alert('사용할 수 있는 보호/럭키 카드가 없습니다.'); return; }
    openProtectModal(grade);
}

function openProtectModal(grade) {
    const hasProtect = !!combineState.meta.protect[grade];
    const luckyList = combineState.meta.lucky || [];
    openModal('보호 / 럭키 카드', (grade + 1) + '성 조합 보조 카드를 선택하세요 (둘 중 하나만 사용 가능)', []);
    const body = $('#modalBody');
    body.replaceChildren();
    if (luckyList.length) {
        body.appendChild(el('div', { style: 'font-weight:800;color:#86efac;margin:4px 0 6px' }, '🍀 럭키 카드 — 성공 확률 상승'));
        luckyList.forEach(l => {
            const pct = Math.round(l.rate * 1000) / 10;
            const row = el('div', { class: 'stat-line', style: 'cursor:pointer;display:flex;align-items:center;gap:10px' },
                el('img', { src: combineUi('럭키' + Math.round(l.rate * 100) + '%.png'), alt: '', style: 'width:34px;border-radius:4px' }),
                el('span', null, (l.name || '럭키 카드') + ' · 성공 확률 ' + pct + '% 증가 (곱연산)')
            );
            if (combineState.luckyRate != null && Math.abs(combineState.luckyRate - l.rate) < 1e-9) row.style.borderColor = '#fbbf24';
            row.onclick = () => { combineState.luckyRate = l.rate; combineState.protectIndex = null; closeModal(); renderCombineStage(); };
            body.appendChild(row);
        });
    }
    if (hasProtect) {
        body.appendChild(el('div', { style: 'font-weight:800;color:#93c5fd;margin:10px 0 6px' }, '🛡️ 보호 카드 — 실패 시 재료 1장 보존'));
        body.appendChild(el('img', { src: combineUi((grade + 1) + '성 보호 카드.png'), alt: '', style: 'width:80px;display:block;margin:0 auto 8px' }));
        combineState.slots.forEach((card, i) => {
            const row = el('div', { class: 'stat-line', style: 'cursor:pointer;display:flex;align-items:center;gap:10px' },
                card.imageUrl ? el('img', { src: card.imageUrl, alt: '', style: 'width:34px;border-radius:4px' }) : null,
                el('span', null, (i + 1) + '번째 재료 · ' + card.formatted)
            );
            if (combineState.protectIndex === i) row.style.borderColor = '#fbbf24';
            row.onclick = () => { combineState.protectIndex = i; combineState.luckyRate = null; closeModal(); renderCombineStage(); };
            body.appendChild(row);
        });
    }
    body.appendChild(el('button', { class: 'close', onclick: () => { combineState.protectIndex = null; combineState.luckyRate = null; closeModal(); renderCombineStage(); } }, '사용 안 함'));
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
    else if (combineState.luckyRate != null) payload.luckyRate = combineState.luckyRate;
    try {
        const data = await postApi('/api/combine', payload);
        playCombineEffect();
        setTimeout(() => {
            combineState.cards = data.cards || [];
            combineState.meta = data.meta || combineState.meta;
            combineState.slots = [null, null, null];
            combineState.protectIndex = null;
            combineState.luckyRate = null;
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
        combineState.meta = data.meta || { table: {}, protect: {}, lucky: [], gold: 0 };
        combineState.slots = [null, null, null];
        combineState.protectIndex = null;
        combineState.luckyRate = null;
        combineState.result = null;
        combineState.busy = false;
        renderCombineStage();
    } catch (e) {
        combineState.built = false;
        const stage = $('#combineStage');
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 전직조합 =====

let jobCombineState = { cards: [], gold: 0, slots: [null, null, null], result: null, busy: false, built: false, slotEls: null };

function buildJobCombineStage() {
    const stage = $('#jobCombineStage');
    if (!stage) return;
    stage.style.backgroundImage = 'url(' + combineUi('전직조합원본.jpg') + ')';
    const mkSlot = (cls) => el('div', { class: 'jobcombine-slot ' + cls + ' empty' },
        el('img', { class: 'slot-card', alt: '' })
    );
    const result = mkSlot('result');
    const m = [mkSlot('m0'), mkSlot('m1'), mkSlot('m2')];
    m.forEach((slot, i) => slot.onclick = () => removeFromJobSlotByIndex(i));
    const btn = el('button', { class: 'jobcombine-btn', id: 'jobCombineBtn', onclick: submitJobCombine });
    btn.style.backgroundImage = 'url(' + combineUi('전직조합버튼.png') + ')';
    stage.replaceChildren(result, m[0], m[1], m[2], btn);
    jobCombineState.slotEls = { result, m };
    jobCombineState.built = true;
}

function renderJobCombineStage() {
    if (!jobCombineState.built) buildJobCombineStage();
    const els = jobCombineState.slotEls;
    if (!els) return;
    jobCombineState.slots.forEach((card, i) => {
        const slot = els.m[i];
        const img = slot.querySelector('.slot-card');
        slot.classList.add('clickable');
        if (card) { img.src = card.imageUrl; slot.classList.remove('empty'); }
        else { img.removeAttribute('src'); slot.classList.add('empty'); }
    });
    const rimg = els.result.querySelector('.slot-card');
    if (jobCombineState.result) { rimg.src = jobCombineState.result.imageUrl; els.result.classList.remove('empty'); }
    else { rimg.removeAttribute('src'); els.result.classList.add('empty'); }
    const btn = $('#jobCombineBtn');
    if (btn) btn.disabled = !(jobCombineState.slots.every(Boolean) && !jobCombineState.busy);
    renderJobCombineInfo();
    renderJobCombinePool();
}

function jobCombineSelectedId() {
    const filled = jobCombineState.slots.find(Boolean);
    return filled ? filled.id : null;
}
function jobCombineSelectedStar() {
    const filled = jobCombineState.slots.find(Boolean);
    return filled ? filled.star : null;
}

function renderJobCombineInfo() {
    const info = $('#jobCombineInfo');
    if (!info) return;
    const filled = jobCombineState.slots.filter(Boolean).length;
    const star = jobCombineSelectedStar();
    const characterId = jobCombineSelectedId();
    const lines = [];
    if (star == null) lines.push('같은 캐릭터·같은 등급의 일반 카드 3장을 선택하세요.');
    else {
        const filledCards = jobCombineState.slots.filter(Boolean);
        const allSame = filledCards.every(c => c.id === characterId && c.star === star);
        if (!allSame) lines.push('⚠️ 같은 캐릭터·같은 등급의 카드 3장이 필요합니다.');
        else lines.push('전직조합 · 100% 성공 · ' + (star + 1) + '성 전직 카드 획득');
    }
    lines.push('선택 ' + filled + '/3');
    info.replaceChildren(...lines.map(l => el('div', null, l)));
}

function renderJobCombinePool() {
    const pool = $('#jobCombinePool');
    if (!pool) return;
    if (!jobCombineState.cards.length) { pool.replaceChildren(el('div', { class: 'empty' }, '전직조합 가능한 카드가 없습니다. (같은 캐릭터 5성↑ 일반 카드 3장 필요)')); return; }
    const selectedId = jobCombineSelectedId();
    const selectedStar = jobCombineSelectedStar();
    const used = new Set(jobCombineState.slots.filter(Boolean).map(c => c.number));
    pool.replaceChildren(...jobCombineState.cards.map(card => {
        const selected = used.has(card.number);
        const disabled = !selected && (
            (selectedId != null && card.id !== selectedId) ||
            (selectedStar != null && card.star !== selectedStar)
        );
        const node = cardNode(card, true, null);
        if (selected) node.classList.add('selected');
        else if (disabled) node.classList.add('disabled');
        node.onclick = () => {
            if (jobCombineState.busy) return;
            if (selected) removeFromJobSlotByIndex(jobCombineState.slots.findIndex(c => c && c.number === card.number));
            else if (!disabled) addJobCardToSlot(card);
        };
        return node;
    }));
}

function addJobCardToSlot(card) {
    const selectedId = jobCombineSelectedId();
    const selectedStar = jobCombineSelectedStar();
    if (selectedId != null && card.id !== selectedId) { alert('같은 캐릭터 카드끼리만 조합할 수 있습니다.'); return; }
    if (selectedStar != null && card.star !== selectedStar) { alert('같은 등급의 카드끼리만 조합할 수 있습니다.'); return; }
    if (jobCombineState.slots.some(c => c && c.number === card.number)) return;
    const idx = jobCombineState.slots.findIndex(c => !c);
    if (idx === -1) { alert('재료 슬롯이 가득 찼습니다.'); return; }
    jobCombineState.slots[idx] = card;
    jobCombineState.result = null;
    renderJobCombineStage();
}

function removeFromJobSlotByIndex(i) {
    if (jobCombineState.busy || !jobCombineState.slots[i]) return;
    jobCombineState.slots[i] = null;
    jobCombineState.result = null;
    renderJobCombineStage();
}

async function submitJobCombine() {
    if (jobCombineState.busy || !jobCombineState.slots.every(Boolean)) return;
    jobCombineState.busy = true;
    const btn = $('#jobCombineBtn');
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/jobcombine', { numbers: jobCombineState.slots.map(c => c.number) });
        jobCombineState.cards = data.cards || [];
        jobCombineState.gold = data.gold != null ? data.gold : jobCombineState.gold;
        jobCombineState.slots = [null, null, null];
        jobCombineState.result = data.resultCard || null;
        jobCombineState.busy = false;
        renderJobCombineStage();
        if (data.profile) renderProfile(data.profile);
        const info = $('#jobCombineInfo');
        if (info && data.resultCard) {
            const rc = data.resultCard;
            info.replaceChildren(el('div', { class: 'combine-result ok' },
                el('div', { class: 'combine-result-head' }, '✨ 전직조합 성공!'),
                el('div', { class: 'combine-result-card' },
                    rc.imageUrl ? el('img', { class: 'combine-result-img', src: rc.imageUrl, alt: rc.formatted || rc.name }) : null,
                    el('div', { class: 'combine-result-name' }, rc.formatted || rc.name || '')
                )
            ));
        }
    } catch (e) {
        jobCombineState.busy = false;
        renderJobCombineStage();
        alert(e.message);
    }
}

async function loadJobCombine() {
    try {
        const data = await api('/api/jobcombine/cards');
        jobCombineState.cards = data.cards || [];
        jobCombineState.gold = data.gold != null ? data.gold : 0;
        jobCombineState.slots = [null, null, null];
        jobCombineState.result = null;
        jobCombineState.busy = false;
        renderJobCombineStage();
    } catch (e) {
        jobCombineState.built = false;
        const stage = $('#jobCombineStage');
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 레벨 보상 =====

function openLevelRewardModal(r) {
    $('#modalTitle').textContent = 'Lv.' + r.level + ' 달성 보상';
    $('#modalSub').textContent = r.claimed ? '수령 완료' : r.unlocked ? '수령 가능' : 'Lv.' + r.level + ' 달성 시 수령 가능';
    $('#modalSub').style.display = '';
    const body = el('div', { class: 'lvreward-modal-body' });
    r.items.forEach(item => {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (item.iconUrl || item.frameUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
            if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, item.name));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, 'x' + item.count));
        body.appendChild(row);
    });
    if (r.garnet) {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (r.garnetIconUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            thumb.appendChild(el('img', { class: 'auc-item-img', src: r.garnetIconUrl, alt: '가넷', style: 'width:100%;height:100%' }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, '가넷'));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, r.garnet.toLocaleString()));
        body.appendChild(row);
    }
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

async function loadLevelRewards() {
    const list = $('#levelRewardList');
    if (!list) return;
    try {
        const data = await api('/api/levelrewards');
        renderLevelRewardList(data.list || [], data.userLevel || 1);
    } catch (e) {
        list.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

function renderLevelRewardList(rewards, userLevel) {
    const list = $('#levelRewardList');
    if (!list) return;
    list.replaceChildren(...rewards.map(r => {
        const row = el('div', { class: 'lvreward-row' + (r.claimed ? ' claimed' : ''), style: 'cursor:pointer', onclick: () => openLevelRewardModal(r) });

        const itemsEl = el('div', { class: 'lvreward-items' });
        r.items.forEach(item => {
            const wrap = el('div', { class: 'lvreward-icon-wrap' });
            if (item.iconUrl || item.frameUrl) {
                const thumb = el('div', { class: 'lvreward-thumb' });
                if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
                if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
                wrap.appendChild(thumb);
            } else {
                wrap.appendChild(el('div', { class: 'lvreward-thumb-fallback' }, item.name));
            }
            wrap.appendChild(el('div', { class: 'lvreward-icon-count' }, 'x' + item.count));
            itemsEl.appendChild(wrap);
        });
        if (r.garnet) {
            const gWrap = el('div', { class: 'lvreward-icon-wrap' });
            const gThumb = el('div', { class: 'lvreward-garnet' });
            if (r.garnetIconUrl) gThumb.appendChild(el('img', { src: r.garnetIconUrl, alt: '가넷' }));
            gWrap.appendChild(gThumb);
            gWrap.appendChild(el('div', { class: 'lvreward-icon-count' }, r.garnet.toLocaleString()));
            itemsEl.appendChild(gWrap);
        }

        const right = el('div', { class: 'lvreward-right' });
        const labelClass = (r.claimed || !r.unlocked) ? 'lvreward-label gray' : 'lvreward-label';
        right.appendChild(el('div', { class: labelClass }, 'Lv.' + r.level + ' 달성보상'));
        if (r.claimed) {
            right.appendChild(el('button', { class: 'lvreward-btn done', disabled: true }, '수령 완료'));
        } else if (r.unlocked) {
            const btn = el('button', { class: 'lvreward-btn claim' }, '보상받기');
            btn.onclick = async (e) => {
                e.stopPropagation();
                btn.disabled = true;
                try {
                    const result = await postApi('/api/levelreward', { level: r.level });
                    if (result.profile) renderProfile(result.profile);
                    await loadLevelRewards();
                } catch (e) {
                    alert(e.message);
                    btn.disabled = false;
                }
            };
            right.appendChild(btn);
        } else {
            right.appendChild(el('button', { class: 'lvreward-btn locked', disabled: true }, 'Lv.' + r.level + ' 필요'));
        }

        row.appendChild(itemsEl);
        row.appendChild(right);
        return row;
    }));
}

// ===== 버닝 =====
async function loadBurning() {
    const root = $('#burningRoot');
    if (!root) return;
    root.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        renderBurning(await api('/api/burning'));
    } catch (e) {
        root.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// 셀마다 불 오브 하나만 표시. 클릭하면 보상 모달이 뜬다.
function burningCell(level, track, info, opts) {
    const claimable = opts.unlocked && !info.claimed && !opts.megaLocked;
    const stateClass = info.claimed ? ' claimed' : claimable ? ' claimable' : ' locked';
    const orb = el('div', { class: 'burning-orb' + stateClass, role: 'button', tabindex: '0' },
        el('span', { class: 'burning-fire' }, '🔥'));
    if (info.claimed) orb.appendChild(el('span', { class: 'burning-orb-check' }, '✓'));
    else if (!opts.unlocked || opts.megaLocked) orb.appendChild(el('span', { class: 'burning-orb-lock' }, '🔒'));
    orb.onclick = () => openBurningModal(level, track, info, opts);
    return el('div', { class: 'burning-cell' }, orb);
}

function openBurningModal(level, track, info, opts) {
    const claimable = opts.unlocked && !info.claimed && !opts.megaLocked;
    $('#modalTitle').textContent = (track === 'mega' ? '메가 버닝' : '버닝') + ' Lv.' + level;
    $('#modalSub').textContent = info.claimed ? '수령 완료'
        : opts.megaLocked ? '메가 버닝 해금이 필요합니다'
            : opts.unlocked ? '수령 가능' : 'Lv.' + level + ' 달성 시 수령 가능';
    $('#modalSub').style.display = '';
    const body = el('div', { class: 'burning-modal-body' });
    info.items.forEach(item => {
        const row = el('div', { class: 'burning-modal-row' });
        const thumb = el('div', { class: 'burning-modal-thumb' });
        if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
        if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
        if (!item.iconUrl && !item.frameUrl) thumb.appendChild(el('span', { class: 'burning-orb-fallback' }, item.name.slice(0, 2)));
        row.appendChild(thumb);
        row.appendChild(el('span', { class: 'burning-modal-name' }, item.name));
        row.appendChild(el('span', { class: 'burning-modal-count' }, 'x' + item.count));
        body.appendChild(row);
    });
    if (info.title) {
        const row = el('div', { class: 'burning-modal-row' });
        const thumb = el('div', { class: 'burning-modal-thumb title' });
        if (info.titleImageUrl) thumb.appendChild(el('img', { src: info.titleImageUrl, alt: info.title }));
        else thumb.appendChild(el('span', { class: 'burning-fire' }, '🔥'));
        row.appendChild(thumb);
        row.appendChild(el('span', { class: 'burning-modal-name' }, info.title + ' 칭호'));
        body.appendChild(row);
    }
    if (claimable) {
        const btn = el('button', { class: 'burning-modal-claim' }, '보상 받기');
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                const result = await postApi('/api/burning/claim', { track, level });
                if (result.profile) renderProfile(result.profile);
                closeModal();
                await loadBurning();
            } catch (e) { alert(e.message); btn.disabled = false; }
        };
        body.appendChild(btn);
    }
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

function openBurningUnlockModal(cost, pointIconUrl) {
    $('#modalTitle').textContent = '메가 버닝 해금';
    $('#modalSub').style.display = 'none';
    const costRow = el('div', { class: 'burning-unlock-cost' });
    if (pointIconUrl) costRow.appendChild(el('img', { src: pointIconUrl, alt: '포인트' }));
    costRow.appendChild(el('b', null, Number(cost).toLocaleString() + 'P'));
    costRow.appendChild(document.createTextNode(' 소모'));
    const btn = el('button', { class: 'burning-unlock-btn' }, '해금하기');
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            const result = await postApi('/api/burning/unlock-mega', {});
            if (result.profile) renderProfile(result.profile);
            closeModal();
            await loadBurning();
        } catch (e) { alert(e.message); btn.disabled = false; }
    };
    const body = el('div', { class: 'burning-unlock-modal' },
        el('div', { class: 'burning-unlock-icon' }, '🔥'),
        el('div', { class: 'burning-unlock-desc' }, '메가 버닝을 해금하시겠습니까?'),
        costRow, btn);
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

function burningMegaUnlockBtn(cost, pointIconUrl) {
    const btn = el('button', { class: 'burning-mega-btn' }, '메가 버닝 해금');
    btn.onclick = () => openBurningUnlockModal(cost, pointIconUrl);
    return btn;
}

function renderBurning(data) {
    const root = $('#burningRoot');
    if (!root) return;
    const pointIcon = data.pointIconUrl
        ? el('img', { class: 'burning-point-icon', src: data.pointIconUrl, alt: '포인트' })
        : null;
    const wrap = el('div', { class: 'burning-wrap' });
    wrap.appendChild(el('div', { class: 'burning-head' },
        el('div', null,
            el('div', { class: 'burning-title' }, '버닝 BURNING'),
            el('div', { class: 'burning-sub' }, '100레벨까지 메가 버닝! 9성 카드로 스타트!')),
        el('div', { class: 'burning-head-right' },
            el('div', { class: 'burning-points' }, pointIcon, el('b', null, Number(data.point || 0).toLocaleString())),
            data.megaUnlocked
                ? el('div', { class: 'burning-mega-on' }, '🔥 메가 버닝 해금됨')
                : burningMegaUnlockBtn(data.megaCost, data.pointIconUrl))));

    const normalCol = el('div', { class: 'burning-track normal' }, el('div', { class: 'burning-colhead-cell c-normal' }, '버닝'));
    const spineCol = el('div', { class: 'burning-spine' }, el('div', { class: 'burning-colhead-cell c-lv' }, '레벨'));
    const megaCol = el('div', { class: 'burning-track mega' }, el('div', { class: 'burning-colhead-cell c-mega' }, '메가 버닝'));
    (data.list || []).forEach(r => {
        normalCol.appendChild(burningCell(r.level, 'normal', r.normal, { unlocked: r.unlocked, megaLocked: false }));
        spineCol.appendChild(el('div', { class: 'burning-level-badge' }, el('span', null, String(r.level))));
        megaCol.appendChild(burningCell(r.level, 'mega', r.mega, { unlocked: r.unlocked, megaLocked: !data.megaUnlocked }));
    });
    wrap.appendChild(el('div', { class: 'burning-board' }, normalCol, spineCol, megaCol));
    root.replaceChildren(wrap);
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
            } else if (bc.label) {
                mini.style.fontSize = '18px';
                mini.textContent = bc.label;
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
            await loadShop();
            if (res.bundleGranted && res.bundleGranted.length > 0) openBundleGrantedModal(d.name, res.bundleGranted);
            else closeModal();
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

// 번들 상품 구매 시 즉시 수령한 구성품을 보여주는 전용 모달
function openBundleGrantedModal(name, rewards) {
    $('#modalTitle').textContent = name + ' 개봉 결과';
    $('#modalSub').textContent = '아래 아이템을 즉시 수령했습니다';
    $('#modalSub').style.display = '';
    const body = el('div', { class: 'lvreward-modal-body' });
    rewards.forEach(r => {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (r.iconUrl || r.frameUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            if (r.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: r.frameUrl, alt: '' }));
            if (r.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: r.iconUrl, alt: r.name }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, r.name));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, 'x' + comma(r.count)));
        body.appendChild(row);
    });
    $('#modalBody').replaceChildren(body);
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
REG_SLOT_SVGS.hat = REG_SLOT_SVGS.armor;
REG_SLOT_SVGS.pants = REG_SLOT_SVGS.armor;
REG_SLOT_SVGS.shoes = REG_SLOT_SVGS.armor;
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

$('#modalClose').onclick = () => { if (!modalLocked) closeModal(); };
$('#modalBg').onclick = e => { if (e.target.id === 'modalBg' && !modalLocked) closeModal(); };
$('#aucDetailBg').onclick = e => { if (e.target.id === 'aucDetailBg') closeDetail(); };
$('#aucRegBg').onclick = e => { if (e.target.id === 'aucRegBg') closeRegister(); };
$('#boDetailBg').onclick = e => { if (e.target.id === 'boDetailBg') closeBoDetail(); };
$('#boRegBg').onclick = e => { if (e.target.id === 'boRegBg') closeBoRegister(); };
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!modalLocked) closeModal();
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
            ...EQUIP_TYPE_ORDER.map(([k, label]) =>
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
    // activatePage('info')는 navigatePage에서 '다른 사람 보던 중 정보 탭 진입 시 내 정보로 복귀' 로직을 트리거한다.
    // 특정 프로필을 불러오는 중에는 그 복귀 로직을 막아, 클릭한 대상이 자기 자신으로 덮어쓰이지 않게 한다.
    suppressInfoSelfReset = true;
    activatePage('info');
    suppressInfoSelfReset = false;
    renderProfile(data);
}

// ===== 랭킹 =====
let rankingData = null;
let rankingTab = 'cp';

function rankTitleImg(title) {
    if (!title || !title.imageUrl) return null;
    return el('img', { src: title.imageUrl, class: 'rank-ttl', alt: title.name || '', title: title.name || '' });
}

function rankRow(entry, isMe, valueFormatter) {
    const rk = entry.rank;
    const rkClass = rk === 1 ? 'gold' : rk === 2 ? 'silver' : rk === 3 ? 'bronze' : '';
    const medal = rk === 1 ? '🥇' : rk === 2 ? '🥈' : rk === 3 ? '🥉' : rk + '위';
    return el('div', { class: 'rank-row ' + (isMe ? 'me' : ''), onclick: () => loadProfile(entry.name).catch(e => alert(e.message)) },
        el('div', { class: 'rk ' + rkClass }, medal),
        el('div', { class: 'ttl' }, rankTitleImg(entry.title)),
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
        meBox.appendChild(el('div', { class: 'ttl' }, rankTitleImg(me.title)));
        meBox.appendChild(el('div', { class: 'nm' }, me.name, el('span', { class: 'lv' }, 'Lv. ' + comma(me.level)), el('span', { class: 'total' }, ' / ' + comma(rankingTab === 'worldBoss' ? list.length : rankingData.total) + '명')));
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
let potentialDexData = null;
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
    applyRarityCardClass(card, entry.rarity);

    const head = el('div', { class: 'dex-head' });
    head.appendChild(dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️'));
    head.appendChild(el('div', null,
        el('div', { class: 'dex-name' }, entry.name),
        el('div', { class: 'dex-meta' },
            rarityTag(entry.rarity),
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

    if (entry.passive) {
        const block = el('div', { class: 'dex-passive' });
        block.appendChild(el('div', { class: 'dex-passive-label' }, '패시브 · ' + entry.passive.name));
        block.appendChild(el('div', { class: 'dex-passive-desc' }, entry.passive.desc));
        if (entry.passive.cooltime) {
            const ctMin = Math.round(entry.passive.cooltime / 60000);
            block.appendChild(el('div', { class: 'dex-passive-cd' }, '재사용 대기시간: ' + ctMin + '분'));
        }
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

    let view = '일반';

    // 일반/전직 토글 (전직이 있는 캐릭터만)
    let toggleBar = null;
    if (entry.hasJobClass) {
        toggleBar = el('div', { class: 'dex-char-toggle' });
        ['일반', '전직'].forEach(v => {
            const btn = el('button', { class: 'dex-char-toggle-btn' + (v === '일반' ? ' active' : ''), type: 'button' }, v);
            btn.onclick = () => {
                if (view === v) return;
                view = v;
                toggleBar.querySelectorAll('.dex-char-toggle-btn').forEach(b => b.classList.toggle('active', b.textContent === v));
                renderBody();
            };
            toggleBar.appendChild(btn);
        });
        card.appendChild(toggleBar);
    }

    const body = el('div', { style: { display: 'contents' } });
    card.appendChild(body);

    function renderSkills(skills) {
        if (!skills || !skills.length) return null;
        const det = el('details', { class: 'dex-collapse', open: true });
        det.appendChild(el('summary', null, '스킬'));
        const list = el('div', { class: 'dex-upgrade-list' });
        skills.forEach(skill => {
            list.appendChild(el('div', { class: 'dex-upgrade-row' },
                el('div', { class: 'lvl' }, skill.name),
                el('div', { class: 'lines' },
                    el('div', { style: { fontWeight: 800, color: '#f8fafc' } }, 'MP ' + comma(skill.mpCost) + ' · ' + skill.cooltimeText),
                    ...(skill.descLines || []).map(line => el('div', null, line))
                )
            ));
        });
        det.appendChild(list);
        return det;
    }

    function renderBody() {
        body.innerHTML = '';
        const isJob = view === '전직';
        const coverUrl = isJob ? entry.jobCoverUrl : entry.coverUrl;

        if (coverUrl) {
            body.appendChild(el('div', { style: { margin: '-14px -14px 0', aspectRatio: '16 / 9', borderRadius: '14px 14px 8px 8px', overflow: 'hidden', background: '#020617' } },
                el('img', { src: coverUrl, alt: entry.name, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
            ));
        }

        const head = el('div', { style: { display: 'grid', gap: '4px' } });
        head.appendChild(el('div', null,
            el('div', { class: 'dex-name' }, entry.name),
            el('div', { class: 'dex-meta' },
                el('span', { class: 'tag rarity' }, isJob ? '전직 카드' : (entry.typeLabel || '캐릭터 카드'))
            )
        ));
        body.appendChild(head);

        if (isJob && entry.jobClass) {
            const effs = entry.jobClass.slotEffects || [];
            if (effs.length) {
                const block = el('div', { class: 'dex-stat-block' });
                block.appendChild(el('div', { class: 'dex-stat-title' }, '카드 슬롯 효과 (전직)'));
                effs.forEach(eff => {
                    block.appendChild(el('div', null, eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)'));
                    if (eff.perLevelText && Number(String(eff.perLevelText).replace(/[^0-9.-]/g, '')) !== 0)
                        block.appendChild(el('div', null, '이후 등급마다 +' + eff.perLevelText));
                });
                body.appendChild(block);
            }
            const skillsDet = renderSkills(entry.jobClass.skills);
            if (skillsDet) body.appendChild(skillsDet);
        } else {
            if (entry.slotEffect) {
                const eff = entry.slotEffect;
                const block = el('div', { class: 'dex-stat-block' });
                block.appendChild(el('div', { class: 'dex-stat-title' }, '카드 슬롯 효과'));
                block.appendChild(el('div', null, eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)'));
                if (eff.perLevelText && Number(String(eff.perLevelText).replace(/[^0-9.-]/g, '')) !== 0)
                    block.appendChild(el('div', null, '이후 등급마다 ' + (String(eff.perLevelText).trim().startsWith('-') ? '' : '+') + eff.perLevelText));
                body.appendChild(block);
            }
            const skillsDet = renderSkills(entry.skills);
            if (skillsDet) body.appendChild(skillsDet);
        }
    }

    renderBody();
    return card;
}

let titlesData = null;

function dexTitleCard(entry) {
    const card = el('div', { class: 'dex-title-card' + (entry.unlocked ? '' : ' locked') + (entry.equipped ? ' equipped' : '') });
    const thumb = el('div', { class: 'dex-title-thumb' });
    thumb.appendChild(el('img', { src: entry.imageUrl, alt: entry.name, onerror: function () { this.style.display = 'none'; } }));
    card.appendChild(thumb);
    card.appendChild(el('div', { class: 'dex-title-name' }, entry.name));
    if (entry.statLines && entry.statLines.length) {
        const block = el('div', { class: 'dex-title-stats' });
        entry.statLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }
    card.appendChild(el('div', { class: 'dex-title-cond' }, '획득: ' + entry.description));
    if (!entry.unlocked) {
        const p = entry.progress || { current: 0, target: 0 };
        const pct = p.target > 0 ? Math.min(100, Math.round(p.current / p.target * 100)) : 0;
        const prog = el('div', { class: 'dex-title-prog' });
        const bar = el('div', { class: 'dex-title-prog-bar' }, el('div', { class: 'fill' }));
        bar.firstChild.style.width = pct + '%';
        prog.appendChild(bar);
        prog.appendChild(el('div', { class: 'dex-title-prog-text' }, '🔒 ' + comma(p.current) + ' / ' + comma(p.target) + ' (' + pct + '%)'));
        card.appendChild(prog);
    } else {
        const btn = el('button', { class: 'dex-title-btn' + (entry.equipped ? ' on' : ''), type: 'button' }, entry.equipped ? '✓ 장착 중 (해제)' : '장착');
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                await postApi('/api/titles/equip', { id: entry.equipped ? null : entry.id });
                titlesData = await api('/api/titles');
                renderDex();
            } catch (e) { alert(e.message); btn.disabled = false; }
        };
        card.appendChild(btn);
    }
    return card;
}

function dexPotentialCard(typeData) {
    const card = el('div', { class: 'dex-pot-card' });
    card.appendChild(el('div', { class: 'dex-pot-cardhead' }, typeData.label + ' 잠재능력'));
    const tbody = el('tbody');
    (typeData.grades || []).forEach(g => {
        const groups = g.groups || [];
        if (!groups.length) return;
        groups.forEach((group, gi) => {
            const tr = el('tr', { class: gi === 0 ? 'grade-start' : '' });
            if (gi === 0) tr.appendChild(el('td', { class: 'c-grade', rowSpan: groups.length },
                el('span', { class: 'pot-grade ' + g.grade }, g.gradeLabel)));
            tr.appendChild(el('td', { class: 'c-rate' }, el('span', { class: 'dex-rate-pill' }, group.percent + '%')));
            const optCell = el('td', { class: 'c-opt' });
            const opts = group.options || [];
            if (!opts.length) optCell.appendChild(el('span', { class: 'dex-opt-none' }, '없음'));
            else opts.forEach(o => optCell.appendChild(el('span', { class: 'dex-opt-chip' }, o)));
            tr.appendChild(optCell);
            tbody.appendChild(tr);
        });
    });
    const table = el('table', { class: 'dex-pot-table' },
        el('thead', null, el('tr', null,
            el('th', { class: 'c-grade' }, '등급'),
            el('th', { class: 'c-rate' }, '확률'),
            el('th', { class: 'c-opt' }, '옵션'))),
        tbody);
    card.appendChild(el('div', { class: 'dex-pot-tablewrap' }, table));
    return card;
}

function renderDex() {
    const grid = $('#dexList');
    if (dexTab === 'potential') {
        grid.className = 'dex-grid dex-pot-grid';
        if (!potentialDexData) return;
        grid.innerHTML = '';
        (potentialDexData.types || []).forEach(t => grid.appendChild(dexPotentialCard(t)));
        return;
    }
    if (dexTab === 'title') {
        if (!titlesData) return;
        grid.className = 'dex-grid dex-title-grid';
        grid.innerHTML = '';
        const list = titlesData.titles || [];
        if (!list.length) { grid.appendChild(el('div', { class: 'empty' }, '칭호가 없습니다.')); return; }
        list.forEach(entry => grid.appendChild(dexTitleCard(entry)));
        return;
    }
    grid.className = 'dex-grid';
    if (!dexData) return;
    const list = dexData[dexTab] || [];
    grid.innerHTML = '';
    if (!list.length) {
        grid.appendChild(el('div', { class: 'empty' }, '데이터가 없습니다.'));
        return;
    }
    list.forEach(entry => grid.appendChild(dexTab === 'character' ? dexCharacterCard(entry) : dexCard(entry)));
}

async function loadDex() {
    if (dexTab === 'potential') {
        if (!potentialDexData) {
            $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
            try { potentialDexData = await api('/api/dex/potential'); }
            catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
        }
        renderDex();
        return;
    }
    if (dexTab === 'title') {
        if (!titlesData) {
            $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
            try { titlesData = await api('/api/titles'); }
            catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
        }
        renderDex();
        return;
    }
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
    loadDex();
});

let patchnoteData = null;
let patchnoteAdmin = false;
let patchView = 'list';
let patchSelectedId = null;
let patchReplyActive = null;

function countReplies(replies) {
    let n = 0;
    (replies || []).forEach(r => { n += 1 + countReplies(r.replies); });
    return n;
}

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
            patchReplyActive = null;
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
        const isActive = patchReplyActive === reply.id;
        const head = el('div', { class: 'reply-head', onclick: () => {
            patchReplyActive = isActive ? null : reply.id;
            renderPatchnotes();
        } },
            el('div', { class: 'reply-meta' }, titleImg(reply.authorTitle), el('b', null, reply.authorName || '알 수 없음'), ' Lv. ' + comma(reply.authorLevel || 1) + ' · ' + formatDateTime(reply.date)),
            el('div', { class: 'reply-text' }, reply.textbody || ''),
            el('div', { class: 'reply-replybtn' }, isActive ? '답글 취소' : '답글 달기')
        );
        const item = el('div', { class: 'reply-item ' + (depth > 0 ? 'child ' : '') + (isActive ? 'active' : '') }, head);
        if (isActive) item.appendChild(replyForm(noteId, reply.id));
        if (reply.replies && reply.replies.length) item.appendChild(renderPatchReplies(noteId, reply.replies, depth + 1));
        wrap.appendChild(item);
    });
    return wrap;
}

function patchPostRow(note) {
    return el('div', { class: 'patch-post', onclick: () => {
        patchView = 'detail'; patchSelectedId = note.id; patchReplyActive = null;
        renderPatchnotes();
        const list = $('#patchList'); if (list) list.scrollIntoView({ block: 'start' });
    } },
        el('div', { class: 'pp-main' },
            el('div', { class: 'pp-title' }, note.title || '(제목 없음)'),
            el('div', { class: 'pp-date' }, formatDateTime(note.date))
        ),
        el('div', { class: 'pp-cmt' }, '댓글 ' + comma(countReplies(note.replies)))
    );
}

function renderPatchDetail(note) {
    const body = el('div', { class: 'markdown-body' });
    body.innerHTML = markdownToHtml(note.textbody || '');
    return el('div', { class: 'patch-detail' },
        el('button', { class: 'patch-back', onclick: () => {
            patchView = 'list'; patchSelectedId = null; patchReplyActive = null;
            renderPatchnotes();
        } }, '← 목록으로'),
        el('div', { class: 'patch-detail-head' },
            el('div', { class: 'patch-detail-title' }, note.title || '(제목 없음)'),
            el('div', { class: 'patch-detail-date' }, formatDateTime(note.date))
        ),
        body,
        el('div', { class: 'patch-comments' },
            el('div', { class: 'patch-comments-h' }, '댓글 ', el('span', null, comma(countReplies(note.replies)))),
            renderPatchReplies(note.id, note.replies || [], 0),
            replyForm(note.id, null)
        )
    );
}

function renderPatchnotes() {
    const list = $('#patchList');
    if (!list) return;
    list.innerHTML = '';
    const inDetail = patchView === 'detail' && patchSelectedId != null
        && patchnoteData && patchnoteData.some(n => n.id === patchSelectedId);
    if (!inDetail) { patchView = 'list'; patchSelectedId = null; }
    if ($('#patchNew')) $('#patchNew').style.display = (patchnoteAdmin && !inDetail) ? '' : 'none';
    if (inDetail && $('#patchEditor')) $('#patchEditor').classList.remove('active');
    if (!patchnoteData || patchnoteData.length === 0) {
        list.appendChild(el('div', { class: 'empty' }, '등록된 패치노트가 없습니다.'));
        return;
    }
    if (inDetail) {
        list.appendChild(renderPatchDetail(patchnoteData.find(n => n.id === patchSelectedId)));
        return;
    }
    const board = el('div', { class: 'patch-board' });
    patchnoteData.forEach(note => board.appendChild(patchPostRow(note)));
    list.appendChild(board);
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

// ===== 메일함 =====
function mailRelTime(ts) {
    const diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    const d = new Date(Number(ts));
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

// ----- 메일 전용 아이콘 / 모달 인프라 -----
const MAIL_SVG = {
    gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>`,
    item: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    equipment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    pet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`
};
function mailSvg(name, cls) { const n = svgIcon(MAIL_SVG[name]); if (n && cls) n.setAttribute('class', cls); return n; }

function mailModalClose() { const bg = $('#mailModalBg'); if (bg) bg.classList.remove('active'); const m = $('#mailModal'); if (m) m.replaceChildren(); }
if ($('#mailModalBg')) $('#mailModalBg').onclick = e => { if (e.target === $('#mailModalBg')) mailModalClose(); };

function mailModalOpen(contentNode, opts) {
    opts = opts || {};
    const modal = $('#mailModal');
    modal.className = 'mail-modal' + (opts.wide ? ' wide' : '');
    const parts = [];
    if (opts.title) parts.push(el('div', { class: 'mm-head' },
        el('div', { class: 'mm-titlewrap' },
            opts.icon ? el('span', { class: 'mm-headicon' }, mailSvg(opts.icon)) : null,
            el('div', { class: 'mm-title' }, opts.title)),
        el('button', { class: 'mm-close', type: 'button', onclick: mailModalClose }, mailSvg('close'))
    ));
    parts.push(el('div', { class: 'mm-body' }, contentNode));
    if (opts.footer && opts.footer.length) parts.push(el('div', { class: 'mm-foot' }, ...opts.footer));
    modal.replaceChildren(...parts);
    $('#mailModalBg').classList.add('active');
}

function mailConfirm(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const cancel = el('button', { class: 'mm-btn ghost', type: 'button', onclick: () => { mailModalClose(); resolve(false); } }, opts.cancelText || '취소');
        const ok = el('button', { class: 'mm-btn ' + (opts.danger ? 'danger' : 'primary'), type: 'button', onclick: () => { mailModalClose(); resolve(true); } }, opts.confirmText || '확인');
        mailModalOpen(el('div', { class: 'mm-message' }, opts.message || ''), { title: opts.title || '확인', icon: opts.icon, footer: [cancel, ok] });
    });
}

function mailInfo(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const ok = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => { mailModalClose(); resolve(); } }, opts.confirmText || '확인');
        const body = el('div', { class: 'mm-message' });
        if (opts.message) body.appendChild(el('div', { class: 'mm-msg-text' }, opts.message));
        if (opts.extra) body.appendChild(opts.extra);
        mailModalOpen(body, { title: opts.title || '알림', icon: opts.icon, footer: [ok] });
    });
}

// 선물 아이콘 썸네일 (frame + icon, 삽니다 모달 스타일)
function mailGiftThumb(g) {
    const wrap = el('div', { class: 'mail-gift-thumb' });
    if (g.frameUrl) wrap.appendChild(el('img', { class: 'mg-frame', src: g.frameUrl, alt: '' }));
    if (g.iconUrl) wrap.appendChild(el('img', { class: 'mg-icon', src: g.iconUrl, alt: '', onerror: e => e.currentTarget.remove() }));
    else if (!g.frameUrl) wrap.appendChild(el('span', { class: 'mg-fallback' }, mailSvg(g.type === 'equipment' ? 'equipment' : g.type === 'pet' ? 'pet' : g.type === 'card' ? 'gift' : 'item')));
    return wrap;
}
function mailGiftRow(g) { return el('div', { class: 'mail-gift-item' }, mailGiftThumb(g), el('span', { class: 'mg-label' }, g.label)); }

function updateMailBadge() {
    document.querySelectorAll('.mail-badge').forEach(b => b.remove());
    const n = mailState.unread;
    if (!n || n <= 0) return;
    const label = n > 99 ? '99+' : String(n);
    $$('.group-tab[data-group="me"], .bottom-tab[data-group="me"]').forEach(t => t.appendChild(el('span', { class: 'mail-badge' }, label)));
    $$('.subnav-tab[data-page="mail"]').forEach(t => t.appendChild(el('span', { class: 'mail-badge' }, label)));
}

function renderMailList() {
    const listEl = $('#mailList');
    if (!listEl) return;
    if (!mailState.mails.length) {
        listEl.replaceChildren(el('div', { class: 'mailbox-empty' }, '받은 메일이 없습니다.'));
        return;
    }
    listEl.replaceChildren(...mailState.mails.map(m => {
        const tags = [];
        if (m.hasGifts) tags.push(el('span', { class: 'mail-tag-gift' + (m.claimed ? ' claimed' : '') }, mailSvg(m.claimed ? 'check' : 'gift', 'mtg-icon'), m.claimed ? '수령완료' : '선물 ' + m.gifts.length));
        return el('div', { class: 'mail-row' + (m.read ? '' : ' unread') + (m.id === mailState.selectedId ? ' active' : ''), onclick: () => openMailDetail(m.id) },
            el('span', { class: 'mail-dot' + (m.read ? ' read' : '') }),
            el('div', { class: 'mail-row-main' },
                el('div', { class: 'mail-row-top' },
                    el('span', { class: 'mail-row-from' }, m.gm ? el('span', { class: 'gm-tag' }, 'GM') : null, m.from),
                    el('span', { class: 'mail-row-date' }, mailRelTime(m.createdAt))),
                el('div', { class: 'mail-row-subject' }, m.subject),
                tags.length ? el('div', { class: 'mail-row-tags' }, ...tags) : null
            )
        );
    }));
}

function renderMailDetail(m) {
    const children = [
        el('h2', { class: 'mail-detail-subject' }, m.subject),
        el('div', { class: 'mail-detail-meta' },
            el('span', null, '보낸 사람'), el('b', null, m.gm ? el('span', { class: 'gm-tag' }, 'GM') : null, m.from),
            el('span', { style: 'margin-left:auto' }, new Date(m.createdAt).toLocaleString('ko-KR'))),
        el('div', { class: 'mail-detail-body' }, m.body || '(내용 없음)')
    ];
    if (m.hasGifts) {
        const giftBox = el('div', { class: 'mail-gift-box' },
            el('div', { class: 'mail-gift-title' }, mailSvg('gift'), '첨부된 선물'),
            el('div', { class: 'mail-gift-list' }, ...m.gifts.map(mailGiftRow))
        );
        if (m.claimed) {
            giftBox.appendChild(el('div', { class: 'mail-claimed-badge' }, mailSvg('check'), '수령 완료'));
        } else {
            giftBox.appendChild(el('button', { class: 'primary mail-claim-btn', type: 'button', onclick: () => claimMail(m.id) }, mailSvg('gift'), '선물 받기'));
        }
        children.push(giftBox);
    }
    $('#mailDetail').replaceChildren(...children);
}

async function openMailDetail(id) {
    const m = mailState.mails.find(x => x.id === id);
    if (!m) return;
    mailState.selectedId = id;
    $('#mailbox').classList.add('show-detail');
    $('#mailDetailEmpty').style.display = 'none';
    $('#mailDetail').style.display = '';
    renderMailDetail(m);
    renderMailList();
    if (!m.read) {
        m.read = true;
        mailState.unread = Math.max(0, mailState.unread - 1);
        updateMailBadge();
        renderMailList();
        try { await postApi('/api/mail/read', { id }); } catch (_) { }
    }
}

async function claimMail(id) {
    const m = mailState.mails.find(x => x.id === id);
    if (!m) return;
    const ok = await mailConfirm({ title: '선물 받기', icon: 'gift', message: '첨부된 선물을 모두 수령하시겠습니까?', confirmText: '받기' });
    if (!ok) return;
    try {
        await postApi('/api/mail/claim', { id });
        m.claimed = true;
        renderMailDetail(m);
        renderMailList();
        await mailInfo({ title: '수령 완료', icon: 'check', message: '선물을 수령했습니다.', extra: el('div', { class: 'mail-gift-list', style: 'margin-top:12px' }, ...m.gifts.map(mailGiftRow)) });
    } catch (e) { mailInfo({ title: '오류', message: e.message }); }
}

function renderMailPager() {
    const pager = $('#mailPager');
    if (!pager) return;
    if (mailState.totalPages <= 1) { pager.style.display = 'none'; pager.replaceChildren(); return; }
    pager.style.display = '';
    pager.replaceChildren(
        el('button', { disabled: mailState.page <= 1, onclick: () => loadMail(mailState.page - 1) }, '‹ 이전'),
        el('span', { class: 'mail-page-info' }, mailState.page + ' / ' + mailState.totalPages),
        el('button', { disabled: mailState.page >= mailState.totalPages, onclick: () => loadMail(mailState.page + 1) }, '다음 ›')
    );
}

async function loadMail(page) {
    const listEl = $('#mailList');
    if (listEl) listEl.replaceChildren(el('div', { class: 'mailbox-empty' }, '불러오는 중...'));
    const composeBtn = $('#mailComposeBtn');
    if (composeBtn) composeBtn.onclick = openMailCompose;
    const backBtn = $('#mailBackBtn');
    if (backBtn) backBtn.onclick = () => { mailState.selectedId = null; $('#mailbox').classList.remove('show-detail'); renderMailList(); };
    try {
        const box = await api('/api/mail?page=' + (Number(page) || 1));
        mailState.mails = box.mails || [];
        mailState.unread = box.unread || 0;
        mailState.page = box.page || 1;
        mailState.totalPages = box.totalPages || 1;
        renderMailList();
        renderMailPager();
        updateMailBadge();
        if (mailState.selectedId && mailState.mails.some(m => m.id === mailState.selectedId)) {
            openMailDetail(mailState.selectedId);
        } else if (!mailState.selectedId) {
            $('#mailbox').classList.remove('show-detail');
            $('#mailDetail').style.display = 'none';
            $('#mailDetailEmpty').style.display = '';
        }
    } catch (e) {
        if (listEl) listEl.replaceChildren(el('div', { class: 'mailbox-empty err' }, e.message));
    }
}

async function refreshMailBadge() {
    try {
        const box = await api('/api/mail?page=1');
        mailState.unread = box.unread || 0;
        updateMailBadge();
    } catch (_) { }
}

// ----- 메일 작성 (전용 모던 모달) -----
async function openMailCompose() {
    let giftable;
    try { giftable = await api('/api/mail/giftable'); } catch (e) { return mailInfo({ title: '오류', message: e.message }); }
    const gifts = [];
    const toInput = el('input', { class: 'mc-input', placeholder: '받는 사람 닉네임', maxLength: 10 });
    const subjectInput = el('input', { class: 'mc-input', placeholder: '제목 (최대 50자)', maxLength: 50 });
    const bodyInput = el('textarea', { class: 'mc-textarea', placeholder: '내용을 입력하세요...', maxLength: 1000 });
    const slotsEl = el('div', { class: 'mc-gift-slots' });
    const feeNote = el('div', { class: 'mc-fee-note' });
    const composeErr = el('div', { class: 'mc-error' });

    function giftDisplay(g) {
        if (g.type === 'gold') return { type: 'gold', iconUrl: giftable.goldIconUrl, label: comma(g.amount) + ' 골드' };
        if (g.type === 'garnet') return { type: 'garnet', iconUrl: giftable.garnetIconUrl, label: comma(g.amount) + ' 가넷' };
        return { type: g.type, iconUrl: g._icon, frameUrl: g._frame, label: g._label };
    }

    function renderSlots() {
        if (!gifts.length) slotsEl.replaceChildren(el('div', { class: 'mc-gift-empty' }, '담은 선물이 없습니다.'));
        else slotsEl.replaceChildren(...gifts.map((g, i) => {
            const d = giftDisplay(g);
            return el('div', { class: 'mc-gift-slot' },
                mailGiftThumb(d),
                el('span', { class: 'mc-slot-label' }, d.label),
                el('button', { class: 'mc-slot-remove', type: 'button', onclick: () => { gifts.splice(i, 1); renderSlots(); } }, mailSvg('close')));
        }));
        let fee = 0;
        gifts.forEach(g => { if (g.type === 'gold' || g.type === 'garnet') fee += Math.max(giftable.feeMin, Math.floor(g.amount * giftable.feeRate)); });
        feeNote.textContent = fee > 0 ? '골드/가넷 수수료 합계 ' + comma(fee) + ' · 받는 사람은 수수료를 뺀 금액을 받습니다' : '';
    }

    function canAdd() {
        if (gifts.length >= giftable.maxGifts) { composeErr.textContent = '선물은 최대 ' + giftable.maxGifts + '개까지 담을 수 있습니다.'; return false; }
        composeErr.textContent = '';
        return true;
    }

    const field = (label, input) => el('div', { class: 'mc-field' }, el('label', { class: 'mc-label' }, label), input);
    const addBtn = (type, label, iconNode) => el('button', { class: 'mc-add-btn', type: 'button', onclick: () => { if (!canAdd()) return; if (type === 'gold' || type === 'garnet') viewCurrency(type); else viewPicker(type); } }, el('span', { class: 'mc-add-ic' }, iconNode), el('span', null, label));

    function viewCompose() {
        renderSlots();
        const content = el('div', { class: 'mc-view' },
            field('받는 사람', toInput),
            field('제목', subjectInput),
            field('내용', bodyInput),
            el('div', { class: 'mc-section-label' }, '선물 (최대 ' + giftable.maxGifts + '개)'),
            el('div', { class: 'mc-add-row' },
                addBtn('gold', '골드', giftable.goldIconUrl ? el('img', { class: 'mc-add-img', src: giftable.goldIconUrl, alt: '' }) : mailSvg('item')),
                addBtn('garnet', '가넷', giftable.garnetIconUrl ? el('img', { class: 'mc-add-img', src: giftable.garnetIconUrl, alt: '' }) : mailSvg('item')),
                addBtn('equipment', '장비', mailSvg('equipment')),
                addBtn('pet', '펫', mailSvg('pet')),
                addBtn('item', '아이템', mailSvg('item'))),
            slotsEl, feeNote, composeErr
        );
        const cancel = el('button', { class: 'mm-btn ghost', type: 'button', onclick: mailModalClose }, '닫기');
        const send = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => doSend(send) }, '보내기');
        mailModalOpen(content, { title: '메일 쓰기', icon: 'pencil', wide: true, footer: [cancel, send] });
    }

    function viewCurrency(type) {
        const name = type === 'gold' ? '골드' : '가넷';
        const max = type === 'gold' ? giftable.gold : giftable.garnet;
        const iconUrl = type === 'gold' ? giftable.goldIconUrl : giftable.garnetIconUrl;
        const input = el('input', { class: 'mc-input', type: 'text', inputmode: 'numeric', placeholder: '0' });
        const errEl = el('div', { class: 'mc-error' });
        const preview = el('div', { class: 'mc-preview' });
        input.addEventListener('input', () => {
            const a = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (a > 0) { const fee = Math.max(giftable.feeMin, Math.floor(a * giftable.feeRate)); preview.textContent = '수수료 ' + comma(fee) + ' · 받는 사람 ' + comma(Math.max(0, a - fee)) + ' 수령'; }
            else preview.textContent = '';
        });
        const content = el('div', { class: 'mc-view' },
            el('div', { class: 'mc-asset-head' }, iconUrl ? el('img', { class: 'mc-asset-img', src: iconUrl, alt: '' }) : null,
                el('div', null, el('div', { class: 'mc-asset-name' }, name), el('div', { class: 'mc-asset-bal' }, '보유 ' + comma(max)))),
            el('label', { class: 'mc-label' }, name + ' 수량'), input, preview, errEl);
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: viewCompose }, '뒤로');
        const add = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => {
            const amount = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (!(amount > 0)) { errEl.textContent = '수량을 입력하세요.'; return; }
            if (amount > max) { errEl.textContent = '보유량을 초과했습니다.'; return; }
            const fee = Math.max(giftable.feeMin, Math.floor(amount * giftable.feeRate));
            if (amount - fee < 1) { errEl.textContent = '수수료(' + comma(fee) + ') 이상이어야 합니다.'; return; }
            gifts.push({ type, amount });
            viewCompose();
        } }, '담기');
        mailModalOpen(content, { title: name + ' 담기', wide: true, footer: [back, add] });
        setTimeout(() => input.focus(), 60);
    }

    function viewPicker(kind) {
        const usedNums = new Set(gifts.filter(g => g.type === 'equipment').map(g => g.number));
        const usedIdx = new Set(gifts.filter(g => g.type === 'pet').map(g => g.index));
        let opts = kind === 'equipment' ? giftable.equipment : kind === 'pet' ? giftable.pets : giftable.items;
        if (kind === 'equipment') opts = opts.filter(o => !usedNums.has(o.number));
        else if (kind === 'pet') opts = opts.filter(o => !usedIdx.has(o.index));
        const title = kind === 'equipment' ? '장비 선택' : kind === 'pet' ? '펫 선택' : '아이템 선택';
        const list = el('div', { class: 'mc-pick-list' });
        if (!opts.length) list.appendChild(el('div', { class: 'mc-gift-empty' }, '보낼 수 있는 항목이 없습니다.'));
        else opts.forEach(o => {
            const sub = kind === 'item' ? ('보유 ' + comma(o.count)) : (o.rarity + (o.level > 0 ? ' · +' + o.level : ''));
            list.appendChild(el('div', { class: 'mc-pick-row', onclick: () => pickGift(kind, o) },
                mailGiftThumb({ type: kind, iconUrl: o.iconUrl, frameUrl: o.frameUrl }),
                el('div', { class: 'mc-pick-main' }, el('div', { class: 'mc-pick-name' }, o.name), el('div', { class: 'mc-pick-sub' }, sub))));
        });
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: viewCompose }, '뒤로');
        mailModalOpen(el('div', { class: 'mc-view' }, list), { title, wide: true, footer: [back] });
    }

    function pickGift(kind, o) {
        if (kind === 'equipment') { gifts.push({ type: 'equipment', number: o.number, _label: o.name + (o.level > 0 ? ' +' + o.level : ''), _icon: o.iconUrl, _frame: o.frameUrl }); viewCompose(); }
        else if (kind === 'pet') { gifts.push({ type: 'pet', index: o.index, _label: o.name + (o.level > 0 ? ' +' + o.level : ''), _icon: o.iconUrl, _frame: o.frameUrl }); viewCompose(); }
        else viewItemCount(o);
    }

    function viewItemCount(o) {
        const input = el('input', { class: 'mc-input', type: 'text', inputmode: 'numeric', value: '1' });
        const errEl = el('div', { class: 'mc-error' });
        const content = el('div', { class: 'mc-view' },
            el('div', { class: 'mc-asset-head' }, mailGiftThumb({ type: 'item', iconUrl: o.iconUrl, frameUrl: o.frameUrl }),
                el('div', null, el('div', { class: 'mc-asset-name' }, o.name), el('div', { class: 'mc-asset-bal' }, '보유 ' + comma(o.count)))),
            el('label', { class: 'mc-label' }, '보낼 수량'), input, errEl);
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: () => viewPicker('item') }, '뒤로');
        const add = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => {
            const count = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (!(count > 0) || count > o.count) { errEl.textContent = '수량이 올바르지 않습니다.'; return; }
            gifts.push({ type: 'item', id: o.id, count, _label: o.name + ' x' + comma(count), _icon: o.iconUrl, _frame: o.frameUrl });
            viewCompose();
        } }, '담기');
        mailModalOpen(content, { title: o.name, wide: true, footer: [back, add] });
        setTimeout(() => input.focus(), 60);
    }

    async function doSend(btn) {
        composeErr.textContent = '';
        const to = toInput.value.trim();
        if (!to) { composeErr.textContent = '받는 사람을 입력해주세요.'; return; }
        if (!subjectInput.value.trim() && !bodyInput.value.trim() && !gifts.length) { composeErr.textContent = '내용 또는 선물을 입력해주세요.'; return; }
        btn.disabled = true;
        try {
            const payload = gifts.map(g => { const c = {}; for (const k in g) if (k[0] !== '_') c[k] = g[k]; return c; });
            const r = await postApi('/api/mail/send', { to, subject: subjectInput.value.trim(), body: bodyInput.value.trim(), gifts: payload });
            mailModalClose();
            await mailInfo({ title: '발송 완료', icon: 'check', message: to + '님에게 메일을 보냈습니다.' + (r.fee ? '\n골드/가넷 수수료 ' + comma(r.fee) + ' 제외 후 전달됩니다.' : '') });
        } catch (e) { composeErr.textContent = e.message; btn.disabled = false; }
    }

    viewCompose();
}

(async () => {
    try {
        const me = await api('/api/me');
        myName = me.name;
        const profile = await api('/api/profile');
        renderProfile(profile);
        refreshMailBadge();
        const tab = new URLSearchParams(location.search).get('tab');
        const initialPage = (typeof window !== 'undefined' && window.__INITIAL_PAGE) || '';
        if (tab && GROUPS.some(g => g.pages.includes(tab))) activatePage(tab);
        else if (initialPage && GROUPS.some(g => g.pages.includes(initialPage))) activatePage(initialPage);
    } catch (e) {
        $('#app').replaceChildren(el('section', { class: 'panel' }, el('h2', null, '오류'), el('p', { class: 'err' }, e.message)));
    }
})();
