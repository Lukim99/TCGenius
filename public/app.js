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

$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
if ($('#adminLink')) $('#adminLink').onclick = () => location.href = '/admin';

function cardNode(card, compact) {
    if (!card || !card.name) return el('div', { class: 'empty-card' }, '카드 없음');
    return el('div', { class: 'card-tile ' + (compact ? 'compact' : '') },
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

function renderProfile(data) {
    $('#who').textContent = data.user.name;
    $('#level').textContent = 'Lv. ' + comma(data.user.level);
    $('#exp').textContent = comma(data.user.exp) + ' / ' + comma(data.user.maxExp);
    $('#hp').textContent = comma(data.user.hp) + ' / ' + comma(data.user.maxHp);
    $('#mp').textContent = comma(data.user.mp) + ' / ' + comma(data.user.maxMp);
    $('#goods').replaceChildren(
        kv('🪙 골드', comma(data.user.gold)),
        kv('💠 가넷', comma(data.user.garnet)),
        kv('💰 포인트', comma(data.user.point)),
        kv('Ⓜ️ 마일리지', comma(data.user.mileage))
    );
    $('#cp').replaceChildren(
        kv('총 전투력', comma(data.combatPower.total)),
        kv('공격', comma(data.combatPower.offense)),
        kv('방어', comma(data.combatPower.defense)),
        kv('유틸', comma(data.combatPower.utility))
    );
    $('#stats').replaceChildren(
        kv('공격력', comma(data.stats.atk)),
        kv('방어력', comma(data.stats.def)),
        kv('방어 관통력', comma(data.stats.pnt)),
        kv('치명타 확률', data.stats.critText),
        kv('치명타 피해량', data.stats.critMulText)
    );
    $('#mainCard').replaceChildren(cardNode(data.mainCard));
    $('#slotCards').replaceChildren(...data.cardSlots.map(card => cardNode(card, true)));
    $('#equipmentText').replaceChildren(...textLines(data.equipmentInfoText).map(line => el('div', { class: line.startsWith('〈') ? 'line head' : 'line' }, line)));
    if (data.user.isAdmin) $('#adminLink').style.display = '';
}

function itemRow(item) {
    return el('div', { class: 'inv-row' },
        el('div', null, el('b', null, item.name), el('span', { class: 'tag' }, item.type)),
        el('strong', null, 'x' + comma(item.count))
    );
}

function equipmentRow(eq) {
    return el('div', { class: 'inv-row equip' },
        el('div', null, el('b', null, eq.name), el('span', { class: 'tag rarity' }, eq.rarity), el('span', { class: 'tag' }, eq.typeLabel), eq.equipped ? el('span', { class: 'tag on' }, '장착') : null),
        el('strong', null, eq.level > 0 ? '+' + eq.level : '')
    );
}

async function loadInventory(kind) {
    $('#viewer').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    const data = await api('/api/inventory/' + kind);
    if (kind === 'items') {
        $('#viewerTitle').textContent = '인벤토리';
        $('#viewer').replaceChildren(...(data.items.length ? data.items.map(itemRow) : [el('div', { class: 'empty' }, '보유 아이템이 없습니다.')]));
    }
    if (kind === 'cards') {
        $('#viewerTitle').textContent = '보유 캐릭터 카드';
        $('#viewer').replaceChildren(data.cards.length ? el('div', { class: 'card-grid' }, data.cards.map(card => cardNode(card, true))) : el('div', { class: 'empty' }, '보유 카드가 없습니다.'));
    }
    if (kind === 'equipment') {
        $('#viewerTitle').textContent = '보유 장비';
        $('#viewer').replaceChildren(...(data.equipment.length ? data.equipment.map(equipmentRow) : [el('div', { class: 'empty' }, '보유 장비가 없습니다.')]));
    }
}

$$('.view-btn').forEach(btn => btn.onclick = () => loadInventory(btn.dataset.kind).catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message))));

api('/api/profile').then(renderProfile).then(() => loadInventory('items')).catch(e => {
    $('#app').replaceChildren(el('section', { class: 'panel' }, el('h2', null, '오류'), el('p', { class: 'err' }, e.message)));
});
