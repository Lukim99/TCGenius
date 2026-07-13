const assert = require('assert');
const fs = require('fs');
const path = require('path');
const content = require('../transcend_equipment');

const allEntries = Object.entries(content.definitions)
    .flatMap(([type, list]) => list.map(data => ({ type, data })));

assert.strictEqual(allEntries.length, 106, '초월·신화 장비는 총 106종이어야 한다.');
assert.strictEqual(new Set(allEntries.map(entry => entry.data.name)).size, 106, '장비 이름은 중복되면 안 된다.');
assert.strictEqual(allEntries.filter(entry => entry.data.rarity === '신화').length, 14, '신화 장비는 14종이어야 한다.');
assert.strictEqual(allEntries.filter(entry => entry.data.rarity === '초월').length, 92, '초월 장비는 92종이어야 한다.');

for (const { type, data } of allEntries) {
    assert.ok(['초월', '신화'].includes(data.rarity), `${data.name}: 잘못된 등급`);
    assert.strictEqual(Boolean(data.no_trade), data.rarity === '신화', `${data.name}: 거래 제한 불일치`);
    if (type === 'accessory' || type === 'support') {
        assert.deepStrictEqual(data.upgrade, [], `${data.name}: 장신구·보조장비에는 강화가 없어야 한다.`);
    } else {
        assert.strictEqual(data.upgrade.length, 15, `${data.name}: 강화 단계는 15개여야 한다.`);
    }
    if (data.set) {
        assert.ok(data.setEffects && data.setEffects[2] && data.setEffects[4], `${data.name}: 2/4세트 설명이 필요하다.`);
    }
    const imagePath = path.join(__dirname, '..', 'DB', 'RPGenius', 'itemImage', '장비', `${data.rarity} ${data.name}.png`);
    assert.ok(fs.existsSync(imagePath), `${data.name}: 이미지가 없다.`);
}

assert.ok(allEntries.some(entry => entry.type === 'armor' && entry.data.name === '검은 잔향 갑옷'));
assert.ok(!allEntries.some(entry => entry.data.name === '검은 잔향 상의'));
assert.ok(allEntries.some(entry => entry.type === 'pants' && entry.data.name === '최후통첩 트라우저'));
assert.ok(allEntries.find(entry => entry.data.name === '심해의 모자').data.desc.includes('6초간 수속성 공격력 +8%'));
assert.ok(allEntries.find(entry => entry.data.name === '최후통첩 모자').data.desc.includes('쿨타임 12초'));
assert.ok(allEntries.find(entry => entry.data.name === '해류를 거스르는 신발').data.desc.includes('최대 MP의 3%'));
assert.ok(allEntries.find(entry => entry.data.name === '777 팔찌').data.desc.includes('방어 관통력 +7%'));

const baseItems = [{ name: '강화석', type: '재료' }];
const items = content.mergeItems(baseItems);
const itemByName = name => items.find(item => item && item.name === name);
assert.ok(itemByName('상급 강화석'));
assert.ok(!itemByName('상급 강화석').no_trade, '상급 강화석은 거래 가능해야 한다.');
for (const name of ['헬 초대장', '헬 도전장', '초월 조각', '초월 상자', '초월 업그레이드 키트']) {
    assert.strictEqual(itemByName(name).no_trade, true, `${name}: 거래 불가여야 한다.`);
}

const recipes = content.mergeRecipes([], items);
const advancedStoneRecipe = recipes.find(recipe => recipe.name === '상급 강화석');
const invitationRecipe = recipes.find(recipe => recipe.name === '헬 초대장');
assert.strictEqual(advancedStoneRecipe.materials[0].count, 1000);
assert.strictEqual(invitationRecipe.materials[0].count, 1);
assert.strictEqual(invitationRecipe.crafted[0].count, 1);

const shop = content.mergeShop({}, items).초월;
assert.deepStrictEqual(shop.map(entry => [items[entry.item_id].name, entry.count, entry.price.amount]), [
    ['헬 초대장', 30, 1],
    ['헬 도전장', 15, 1],
    ['초월 상자', 1, 20],
    ['초월 업그레이드 키트', 1, 200]
]);

console.log('transcend_equipment.test.js: OK');
