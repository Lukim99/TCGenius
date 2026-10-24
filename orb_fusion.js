'use strict';
const crypto = require('crypto');
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function prepareFusion(user, items, materialIds, random = crypto.randomInt) {
    if (!Array.isArray(materialIds) || materialIds.length !== 3 || materialIds.some(id => !Number.isSafeInteger(id) || id < 0 || items[id]?.use !== '보주')) fail('보주 3개를 선택해주세요.');
    const required = new Map();
    for (const id of materialIds) required.set(id, (required.get(id) || 0) + 1);
    const inventory = structuredClone(user.inventory), boundItems = structuredClone(user.boundItems || {});
    for (const [id, count] of required) {
        const entry = inventory?.item?.find(item => item.id === id);
        if (!entry || entry.count < count) fail('선택한 보주의 수량이 부족합니다. 다시 불러와주세요.');
    }
    const pool = items.flatMap((item, id) => item?.use === '보주' ? [id] : []);
    for (const [id, count] of required) {
        const entry = inventory.item.find(item => item.id === id);
        entry.count -= count;
        // 기존 아이템 사용과 같이 거래 가능한 수량부터 소모한다. 결과 지급 전 귀속 수량을 확정한다.
        const bound = Math.min(Number(boundItems[id] || 0), entry.count);
        if (bound > 0) boundItems[id] = bound; else delete boundItems[id];
    }
    inventory.item = inventory.item.filter(item => item.count > 0);
    const resultId = pool[random(pool.length)], existing = inventory.item.find(item => item.id === resultId);
    if (existing) existing.count++; else inventory.item.push({ id: resultId, count: 1 });
    return { inventory, boundItems, resultId };
}
module.exports = { prepareFusion };
