const { randomUUID, createHash } = require('crypto');

const ITEM_RECORDS = '@items';
const RESERVED_GROUPS = new Set([ITEM_RECORDS, '__proto__', 'constructor', 'prototype']);
const NEW_ID = /^shop_[0-9a-f]{32}$/;
const LEGACY_ID = /^legacy\.([A-Za-z0-9_-]+)\.(0|[1-9]\d*)$/;

function newShopItemId() { return 'shop_' + randomUUID().replace(/-/g, ''); }

// 기존 상품의 ID는 최초 저장 위치를 담는다. 이후 위치와 관계없이 같은 기록을 참조한다.
function legacyShopItemId(shopType, index) {
    return 'legacy.' + Buffer.from(shopType).toString('base64url') + '.' + index;
}

function shopRecordAddress(shopId) {
    if (typeof shopId != 'string') throw new Error('상품 ID가 없습니다. 상점을 다시 불러와주세요.');
    if (NEW_ID.test(shopId)) return { group: ITEM_RECORDS, key: shopId };
    const match = shopId.match(LEGACY_ID);
    if (match) {
        const group = Buffer.from(match[1], 'base64url').toString('utf8');
        if (group && !RESERVED_GROUPS.has(group) && legacyShopItemId(group, match[2]) == shopId) return { group, key: match[2] };
    }
    throw new Error('올바르지 않은 상품 ID입니다. 상점을 다시 불러와주세요.');
}

function validateShopCatalog(shops, previous) {
    if (!shops || typeof shops != 'object' || Array.isArray(shops)) throw new Error('Shop 데이터는 상점별 상품 목록이어야 합니다.');
    const knownIds = previous && new Set(Object.values(previous).flat().map(item => item.shopId));
    const seen = new Set();
    for (const [shopType, items] of Object.entries(shops)) {
        if (RESERVED_GROUPS.has(shopType) || !Array.isArray(items)) throw new Error('올바르지 않은 상점 목록: ' + shopType);
        for (const item of items) {
            if (!item || typeof item != 'object' || Array.isArray(item)) throw new Error('올바르지 않은 상점 상품입니다.');
            shopRecordAddress(item.shopId);
            if (seen.has(item.shopId)) throw new Error('상품 ID가 중복되었습니다. 새 상품에는 새로운 ID가 필요합니다.');
            if (knownIds && item.shopId.startsWith('legacy.') && !knownIds.has(item.shopId)) throw new Error('기존 상품 ID가 일치하지 않습니다. 상점을 다시 불러와주세요.');
            seen.add(item.shopId);
        }
    }
}

// 읽기 전용 호환 표현. 운영 DB나 원본 배열은 변경하지 않는다.
function readShopCatalog(source) {
    const shops = structuredClone(source);
    if (shops && typeof shops == 'object' && !Array.isArray(shops)) {
        for (const [shopType, items] of Object.entries(shops)) {
            if (!Array.isArray(items)) continue;
            items.forEach((item, index) => {
                if (item && typeof item == 'object' && item.shopId == null) item.shopId = legacyShopItemId(shopType, index);
            });
        }
    }
    validateShopCatalog(shops);
    return shops;
}

function shopCatalogRevision(shops) {
    const canonical = JSON.stringify(shops, (_, value) => value && typeof value == 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    return createHash('sha256').update(canonical).digest('hex');
}

function resetShopRecords(records, shopIds) {
    let changed = 0;
    for (const shopId of shopIds) {
        const { group, key } = shopRecordAddress(shopId);
        if (!Object.hasOwn(records, group) || !records[group] || !Object.hasOwn(records[group], key)) continue;
        delete records[group][key];
        if (Object.keys(records[group]).length == 0) delete records[group];
        changed++;
    }
    return changed;
}

module.exports = { newShopItemId, legacyShopItemId, shopRecordAddress, readShopCatalog, validateShopCatalog, shopCatalogRevision, resetShopRecords };
