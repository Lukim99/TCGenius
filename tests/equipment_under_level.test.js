const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    const accessories = rpg.getDataCache('Equipment', {}).accessory || [];
    const equipmentId = accessories.findIndex(equipment => equipment && equipment.name === '중력지배');
    assert.ok(equipmentId >= 0, '최대 레벨 제한 장비가 있어야 한다.');
    assert.strictEqual(accessories[equipmentId].underLevel, 100);

    const user = new rpg.RPGUser('최대레벨장비테스트', 'equipment-under-level-test');
    user.level = 100;
    user.exp = 0;
    user.equipments.accessory['0'] = {
        type: 'accessory',
        id: equipmentId,
        level: 0,
        boundOwner: user.name
    };

    const requiredExp = rpg.getMaxExpForLevel(100);
    assert.ok(requiredExp > 0, '100레벨의 필요 경험치가 있어야 한다.');
    assert.strictEqual(rpg.addExperience(user, requiredExp - 1), 0);
    assert.ok(user.equipments.accessory['0'], '제한 레벨까지는 장비가 유지되어야 한다.');
    assert.strictEqual(user.inventory.equipment.length, 0);

    assert.strictEqual(rpg.addExperience(user, 1), 1);
    assert.strictEqual(user.level, 101);
    assert.strictEqual(user.equipments.accessory['0'], undefined, '제한 레벨을 넘으면 장비가 해제되어야 한다.');
    assert.deepStrictEqual(user.inventory.equipment, [{
        type: 'accessory',
        id: equipmentId,
        level: 0,
        boundOwner: user.name
    }], '해제된 장비는 기존 정보를 보존해 인벤토리로 돌아가야 한다.');

    const loadedUser = new rpg.RPGUser().load({
        id: 'equipment-under-level-load-test',
        name: '최대레벨장비로드테스트',
        level: 101,
        inventory: { card: [], item: [], equipment: [], pet: [] },
        equipments: {
            weapon: null,
            hat: null,
            armor: null,
            pants: null,
            shoes: null,
            accessory: {
                '0': { type: 'accessory', id: equipmentId, level: 0 }
            },
            support: null,
            pet: []
        }
    });
    assert.strictEqual(loadedUser.equipments.accessory['0'], undefined, '로드할 때도 이미 제한 레벨을 넘은 장비가 해제되어야 한다.');
    assert.deepStrictEqual(loadedUser.inventory.equipment, [{
        type: 'accessory',
        id: equipmentId,
        level: 0
    }], '로드 중 해제된 장비는 인벤토리로 돌아가야 한다.');

    console.log('equipment_under_level.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
