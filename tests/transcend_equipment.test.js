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
    assert.strictEqual(Boolean(data.no_trade), false, `${data.name}: 착용 전 거래 가능 상태여야 한다.`);
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
assert.strictEqual(allEntries.find(entry => entry.data.name === '검은 잔향 갑옷').data.desc, '암속성 저항 +100, 암속성 저항의 20%(+10%) 수치만큼 암속성 강화.');
assert.strictEqual(allEntries.find(entry => entry.data.name === '검은 잔향 갑옷').data.stat.darkRes, 100);
assert.strictEqual(allEntries.find(entry => entry.data.name === '검은 잔향 신발').data.desc, '스킬 사용 시, 60초간 암속성 공격 시 추가 피해 +7%(+3%) (쿨타임 60초).');
assert.strictEqual(allEntries.find(entry => entry.data.name === '777 목걸이').data.desc, '추가 피해 +7%(+7%). 7성 카드 장착 시 추가 피해 +77%.');
assert.strictEqual(allEntries.find(entry => entry.data.name === '777 반지').data.desc, '치명타 확률 +7%, 치명타 피해 +7%(+7%). 7성 카드 착용 시 치명타 확률 +7%(+7%).');
assert.strictEqual(allEntries.find(entry => entry.data.name === '777 장갑').data.desc, '최종 공격력 +7%(+7%). 7성 카드 장착 시 공격력 +777(+77).');
assert.strictEqual(allEntries.find(entry => entry.data.name === '행운의 장갑').data.desc, '공격력 +77. 7성 카드 장착 시 공격력 +777, 최종 공격력 +77%.');

const staleEquipment = {
    armor: [{ name: '검은 잔향 갑옷', desc: '이전 설명', stat: { def: 230, hp: 2100 } }],
    shoes: [{ name: '검은 잔향 신발', desc: '이전 설명', stat: { def: 230, hp: 1500 } }],
    accessory: [{ name: '777 목걸이', desc: '이전 설명' }, { name: '777 반지', desc: '이전 설명' }],
    support: [{ name: '777 장갑', desc: '이전 설명' }, { name: '행운의 장갑', desc: '이전 설명' }]
};
content.applyEquipmentBalancePatch(staleEquipment);
assert.strictEqual(staleEquipment.armor[0].stat.darkRes, 100);
assert.strictEqual(staleEquipment.armor[0].desc, allEntries.find(entry => entry.data.name === '검은 잔향 갑옷').data.desc);
assert.strictEqual(staleEquipment.shoes[0].desc, allEntries.find(entry => entry.data.name === '검은 잔향 신발').data.desc);
assert.strictEqual(staleEquipment.accessory[0].desc, allEntries.find(entry => entry.data.name === '777 목걸이').data.desc);
assert.strictEqual(staleEquipment.accessory[1].desc, allEntries.find(entry => entry.data.name === '777 반지').data.desc);
assert.strictEqual(staleEquipment.support[0].desc, allEntries.find(entry => entry.data.name === '777 장갑').data.desc);
assert.strictEqual(staleEquipment.support[1].desc, allEntries.find(entry => entry.data.name === '행운의 장갑').data.desc);

const frameDir = path.join(__dirname, '..', 'DB', 'RPGenius', 'itemImage', '프레임');
const transcendFrame = fs.readFileSync(path.join(frameDir, '[장비]초월.png'));
const mythicFrame = fs.readFileSync(path.join(frameDir, '[장비]신화.png'));
const pngDimensions = buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
assert.deepStrictEqual(pngDimensions(transcendFrame), { width: 800, height: 800 });
assert.deepStrictEqual(pngDimensions(mythicFrame), { width: 800, height: 800 });
assert.notDeepStrictEqual(mythicFrame, transcendFrame, '신화 프레임은 초월 프레임과 별도 이미지여야 한다.');

console.log('transcend_equipment.test.js: OK');
