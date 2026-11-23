'use strict';

// Account records own shared resources. Character records retain the existing game shape.
const SHARED_FIELDS = new Set([
    'code', 'logged_in', 'logged_in_agent', 'otpSecret', 'otpPendingSecret', 'isAdmin',
    'gold', 'garnet', 'point', 'total_point', 'mileage', 'pointUsageOutbox',
    'usedCoupons', 'shopPurchases', 'lastAttendanceDate', 'blessings', 'prestige', 'jobPrestige',
    'unlockedTitles', 'titles', 'titleProgress', 'chuseok2026', 'personalDraw', 'pointMine', 'yut', 'yutEvent',
    'eventDiceDropDaily', 'songpyeonDropDaily', 'pointMineDropDaily', 'peperoDropDaily', 'peperoEvent', 'huntingGold'
]);
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function isAccountItem(item) {
    if (!item || item.name === '이벤트 리스트 종이') return false;
    if (item.accountScope !== undefined) return item.accountScope === 'account';
    return item.type === '이벤트' || /^\[이벤트\]/.test(item.name || '') || /이벤트.*(?:상자|주머니)$/.test(item.name || '')
        || ['출석 도장', '송편', '랜덤 빼빼로 1종 ×11'].includes(item.name)
        || /^26빼빼로데이\d패키지$/.test(item.name || '');
}

function splitInventory(inventory, items) {
    const own = clone(inventory || { card: [], equipment: [], pet: [], item: [] });
    const shared = [];
    own.item = (own.item || []).filter(entry => {
        if (!isAccountItem(items[entry.id])) return true;
        shared.push(entry);
        return false;
    });
    return { own, shared };
}

function hydrate(character, account) {
    if (!account) return clone(character);
    const result = clone(character);
    for (const key of SHARED_FIELDS) {
        if (account[key] === undefined) delete result[key];
        else result[key] = clone(account[key]);
    }
    result.inventory ||= { card: [], equipment: [], pet: [], item: [] };
    result.inventory.item = [...(result.inventory.item || []), ...clone(account.items || [])];
    result.boundItems = { ...(result.boundItems || {}), ...(account.boundItems || {}) };
    return result;
}

function normalizeSlots(user) {
    user.inventory ||= { card: [], equipment: [], pet: [], item: [] };
    user.inventory.card ||= [];
    user.inventory.card.push(...(user.card_slot || []));
    user.card_slot = [];
    user.slotCharacterLinks = Array.from({ length: 5 }, (_, index) => user.slotCharacterLinks?.[index] || null);
    for (const preset of user.presets || []) {
        if (preset) delete preset.slotCards;
    }
}

function resolveSlots(user, members, links = user.slotCharacterLinks) {
    const byId = new Map(members.map(member => [member.id, member])), seen = new Set();
    return Array.from({ length: 5 }, (_, index) => {
        const id = links?.[index] || null, member = byId.get(id), card = member?.main_card;
        let error = null;
        if (id) {
            if (!member || member.accountId !== user.accountId) error = '같은 계정의 캐릭터를 선택해주세요.';
            else if (member.id === user.id) error = '플레이 중인 캐릭터는 슬롯에 지정할 수 없습니다.';
            else if (!card || member.need_character_card_select) error = '먼저 해당 부캐의 메인 카드를 선택해주세요.';
            else if (Number(card.star || 0) < 4) error = '메인 카드가 5성 이상인 부캐를 선택해주세요.';
            else if (Number(card.id) === Number(user.main_card?.id) && (card.type || '일반') === (user.main_card.type || '일반')) error = '메인과 같은 캐릭터는 타입이 다를 때만 슬롯에 지정할 수 있습니다.';
            else if (seen.has(Number(card.id))) error = '슬롯끼리는 타입과 관계없이 같은 캐릭터를 중복 지정할 수 없습니다.';
            else seen.add(Number(card.id));
        }
        return { index, id, member: id && !error ? member : null, error };
    });
}

function migrate(user, items, shops = {}) {
    const character = clone(user);
    normalizeSlots(character);
    const account = { id: 'account:' + user.id, recordType: 'account', name: user.name,
        schemaVersion: 2, characterIds: [user.id], activeCharacterId: user.id, capacity: 6,
        selectionRevision: 0 };
    character.accountId = account.id;
    character.characterNumber = 1;
    for (const key of SHARED_FIELDS) {
        if (character[key] !== undefined) account[key] = character[key];
        delete character[key];
    }
    const catalog = require('./shop_catalog');
    for (const [shop, products] of Object.entries(shops)) {
        if (!Array.isArray(products)) continue;
        products.forEach((product, index) => {
            if (catalog.purchaseScope(product, items) !== 'character') return;
            const { group, key } = catalog.shopRecordAddress(product.shopId || catalog.legacyShopItemId(shop, index));
            const record = account.shopPurchases?.[group]?.[key];
            if (!record) return;
            character.characterShopPurchases ||= {};
            (character.characterShopPurchases[group] ||= {})[key] = record;
            delete account.shopPurchases[group][key];
            if (!Object.keys(account.shopPurchases[group]).length) delete account.shopPurchases[group];
        });
    }
    const { own, shared } = splitInventory(character.inventory, items);
    character.inventory = own;
    account.items = shared;
    account.boundItems = {};
    character.boundItems ||= {};
    for (const [id, count] of Object.entries(character.boundItems || {})) {
        if (isAccountItem(items[id])) { account.boundItems[id] = count; delete character.boundItems[id]; }
    }
    return { account, character };
}

function splitChanges(user, keys, items) {
    const own = {}, shared = {}, ownBefore = {}, sharedBefore = {};
    for (const key of keys) {
        if (['id', 'accountId', 'characterNumber', 'recordType'].includes(key)) continue;
        const before = user.__loaded?.[key] === undefined ? undefined : JSON.parse(user.__loaded[key]);
        const after = user[key];
        if (equal(before, after)) continue;
        if (key === 'inventory') {
            const prior = splitInventory(before, items), next = splitInventory(after, items);
            if (!equal(prior.own, next.own)) { own.inventory = next.own; ownBefore.inventory = prior.own; }
            if (!equal(prior.shared, next.shared)) { shared.items = next.shared; sharedBefore.items = prior.shared; }
        } else if (key === 'boundItems') {
            for (const [target, source] of [[ownBefore, before], [own, after], [sharedBefore, before], [shared, after]]) {
                const account = target === sharedBefore || target === shared;
                target.boundItems = Object.fromEntries(Object.entries(source || {}).filter(([id]) => isAccountItem(items[id]) === account));
            }
            if (equal(own.boundItems, ownBefore.boundItems)) { delete own.boundItems; delete ownBefore.boundItems; }
            if (equal(shared.boundItems, sharedBefore.boundItems)) { delete shared.boundItems; delete sharedBefore.boundItems; }
        } else {
            const target = SHARED_FIELDS.has(key) ? shared : own;
            const previous = SHARED_FIELDS.has(key) ? sharedBefore : ownBefore;
            target[key] = clone(after); previous[key] = clone(before);
        }
    }
    return [{ id: user.id, changes: own, before: ownBefore }, { id: user.accountId, changes: shared, before: sharedBefore }];
}

function updateInput(table, id, changes, before) {
    const names = {}, values = {}, sets = [], removes = [], conditions = ['attribute_exists(id)'];
    Object.entries(changes).forEach(([key, value], index) => {
        const alias = '#k' + index;
        names[alias] = key;
        if (value === undefined) removes.push(alias);
        else { sets.push(alias + ' = :v' + index); values[':v' + index] = clone(value); }
        if (before[key] === undefined) conditions.push('attribute_not_exists(' + alias + ')');
        else { conditions.push(alias + ' = :p' + index); values[':p' + index] = clone(before[key]); }
    });
    const clauses = [];
    if (sets.length) clauses.push('SET ' + sets.join(', '));
    if (removes.length) clauses.push('REMOVE ' + removes.join(', '));
    return { TableName: table, Key: { id }, UpdateExpression: clauses.join(' '),
        ConditionExpression: conditions.join(' AND '), ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}) };
}

function goldLimit(level) {
    if (level < 100) return 20000000;
    if (level < 200) return 40000000;
    if (level < 260) return 80000000 + Math.floor((level - 200) / 5) * 5000000;
    return 150000000 + Math.floor((Math.min(300, level) - 260) / 5) * 10000000;
}

module.exports = { SHARED_FIELDS, isAccountItem, splitInventory, hydrate, normalizeSlots, resolveSlots, migrate, splitChanges, updateInput, goldLimit };
