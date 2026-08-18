const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
for (const line of read('.env.local').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}
const server = read('server.js');
const app = read(path.join('public', 'app.js'));
const rpg = require('../rpgenius');

assert.ok(server.includes("server.post('/api/inventory/craft'"), '웹 인벤토리 제작 API가 필요합니다.');
assert.ok(server.includes('craftedItem'), '선택한 아이템을 결과로 만드는 제작식도 표시해야 합니다.');
assert.ok(server.includes('Number.isSafeInteger(times)'), '제작 횟수는 서버에서 정수로 검증해야 합니다.');
assert.ok(server.includes('inventoryCraftLocks'), '동시 제작 요청으로 재료가 중복 사용되지 않도록 막아야 합니다.');
assert.ok(app.includes("type: 'number'"), '제작 횟수 직접 입력란이 필요합니다.');
assert.ok(app.includes("'MAX'"), '최대 제작 횟수 지정 버튼이 필요합니다.');

(async () => {
    await rpg.initRpgeniusData();
    const recipe = rpg.getDataCache('Recipe', []).find(entry =>
        entry && entry.materials.some(material => material.type === '아이템') &&
        entry.materials.every(material => material.type === '아이템' || material.type === '골드') &&
        entry.crafted.some(output => output.type === '장신구')
    );
    assert.ok(recipe, '테스트할 제작식이 필요합니다.');

    const user = new rpg.RPGUser('웹제작테스트', 'web-inventory-craft-test');
    user.inventory.item = [];
    user.inventory.equipment = [];
    user.gold = 0;
    const times = 3;
    recipe.materials.forEach(material => {
        const unit = Number(material.count || 1);
        if (material.type === '아이템') rpg.addInventoryItem(user, material.item_id, unit * times);
        if (material.type === '골드') user.gold += unit * times;
    });

    const status = rpg.getCraftRecipeStatus(user, recipe.name, 1);
    assert.strictEqual(status.maxCraftable, times, '보유 재료로 가능한 최대 제작 횟수를 계산해야 합니다.');
    const result = rpg.craftRecipeByName(user, recipe.name, times);
    assert.ok(result.includes('제작에 성공했습니다.'), result);
    recipe.materials.filter(material => material.type === '아이템').forEach(material => {
        assert.strictEqual(rpg.getInventoryItemCount(user, material.item_id), 0, '지정한 횟수만큼 재료를 차감해야 합니다.');
    });
    assert.strictEqual(user.gold, 0, '지정한 횟수만큼 골드를 차감해야 합니다.');
    const output = recipe.crafted.find(entry => entry.type === '장신구');
    assert.strictEqual(user.inventory.equipment.filter(entry => entry.type === 'accessory' && Number(entry.id) === Number(output.accessory_id)).length, times, '지정한 횟수만큼 제작 결과를 지급해야 합니다.');

    const before = JSON.stringify(user.inventory);
    assert.ok(rpg.craftRecipeByName(user, recipe.name, 1).startsWith('❌'), '재료가 부족하면 제작을 거부해야 합니다.');
    assert.strictEqual(JSON.stringify(user.inventory), before, '실패한 제작은 인벤토리를 변경하지 않아야 합니다.');

    console.log('web_inventory_craft.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
