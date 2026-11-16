const assert = require('assert');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'GetCommand') return {};
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};

const rpg = require('../rpgenius');
const equipment = {
    plusStat: { bossDmg: 0.1, takenDamage: 0.1 },
    upgrade: [{ plusStat: { bossDmg: 0.05 } }]
};
const before = JSON.stringify(equipment);

const baseLines = rpg.formatEquipmentBaseStatLines(equipment, 0);
assert.ok(baseLines.includes('- 보스 몬스터에게 주는 피해 증가 +10%'), '도감 기본 능력치에 보스 피해 증가를 표시해야 한다.');
assert.ok(baseLines.includes('- 받는 피해 증가 +10%'), '기존 능력치도 유지해야 한다.');
assert.ok(rpg.formatEquipmentBaseStatLines(equipment, 1).includes('- 보스 몬스터에게 주는 피해 증가 +15%'), '도감 강화 능력치에 누적 보스 피해 증가를 표시해야 한다.');
assert.ok(rpg.formatEquipmentBaseStatLines({
    plusStat: { bossDmg: 0.1 },
    plusStatRange: { bossDmg: 0.05 }
}, 0).includes('- 보스 몬스터에게 주는 피해 증가 +10% ~ +15%'), '랜덤 옵션의 보스 피해 증가 범위도 표시해야 한다.');
assert.ok(rpg.formatEquipmentBaseStatLines({
    plusStatRange: { bossDmg: 0.05 }
}, 0).includes('- 보스 몬스터에게 주는 피해 증가 0% ~ +5%'), '기본값 없이 랜덤 옵션만 있어도 표시해야 한다.');
assert.strictEqual(JSON.stringify(equipment), before, '표시 과정에서 장비 데이터를 변경하지 않아야 한다.');

console.log('equipment_dex_stats.test.js: OK');
