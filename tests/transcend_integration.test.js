const assert = require('assert');
const fs = require('fs');

for (const line of fs.readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    const equipment = rpg.getDataCache('Equipment', {});
    const items = rpg.getDataCache('Item', []);
    const weaponId = equipment.weapon.findIndex(data => data && data.rarity === '초월');
    const mythicIds = Object.entries(equipment).flatMap(([type, list]) =>
        Array.isArray(list) ? list.map((data, id) => ({ type, id, data })).filter(entry => entry.data && entry.data.rarity === '신화') : []);
    assert.ok(weaponId >= 0);
    assert.strictEqual(mythicIds.length, 14);
    assert.strictEqual(rpg.formatStatValue('ultimateDamage%', .5), '+50%');
    assert.strictEqual(rpg.formatStatValue('elementalExtraDamage%', .1), '+10%');
    assert.strictEqual(rpg.formatStatValue('burnDamage%', .25), '+25%');
    assert.strictEqual(rpg.formatStatValue('lightFinalDamage%', .2), '+20%');

    const raisingSwordId = equipment.weapon.findIndex(data => data && data.name === '키우기 전용 검');
    const raisingSwordUser = new rpg.RPGUser('키우기전용검테스트', 'raising-sword-test');
    raisingSwordUser.main_card = { id: 11, star: 6, type: '일반' };
    raisingSwordUser.equipments = { weapon: { id: raisingSwordId, level: 0, transcendStage: 1 }, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    assert.strictEqual(rpg.getSkillCooldownRate(rpg.calculateUserStats(raisingSwordUser)), 1.6, '키우기 전용 검 1단계는 스킬 쿨타임을 60% 늘려야 한다.');
    raisingSwordUser.equipments.weapon.transcendStage = 3;
    assert.strictEqual(rpg.getSkillCooldownRate(rpg.calculateUserStats(raisingSwordUser)), 1.5, '키우기 전용 검 3단계는 스킬 쿨타임을 50% 늘려야 한다.');

    const advancedStoneId = items.findIndex(item => item && item.name === '상급 강화석');
    assert.ok(advancedStoneId >= 0);
    const costs = [
        [1, 100000], [2, 200000], [3, 300000], [4, 400000], [5, 500000],
        [6, 600000], [7, 700000], [8, 800000], [9, 1000000], [10, 1250000],
        [12, 1600000], [15, 1950000], [20, 2400000], [30, 2880000], [50, 3350000]
    ];
    costs.forEach(([stone, gold], level) => {
        assert.deepStrictEqual(rpg.getEquipmentUpgradeCost(equipment.weapon[weaponId], 'weapon', level), {
            stone, gold, stoneItemId: advancedStoneId, stoneName: '상급 강화석'
        });
    });

    const legendaryWeapons = equipment.weapon.filter(data => data && data.rarity === '레전더리');
    const legendaryArmor = equipment.armor.filter(data => data && data.rarity === '레전더리');
    const averageRatio = (list, key, level) => list.reduce((sum, data) => sum + Number(data.upgrade[level].stat[key] || 0) / Number(data.stat[key] || 1), 0) / list.length;
    for (const data of equipment.weapon.filter(data => data && data.rarity === '초월')) {
        for (let level = 0; level < 15; level++) assert.strictEqual(data.upgrade[level].stat.atk, Math.round(data.stat.atk * averageRatio(legendaryWeapons, 'atk', level)));
    }
    for (const type of ['hat', 'armor', 'pants', 'shoes']) {
        for (const data of equipment[type].filter(data => data && (data.rarity === '초월' || data.rarity === '신화'))) {
            for (let level = 0; level < 15; level++) {
                assert.strictEqual(data.upgrade[level].stat.def, Math.round(data.stat.def * averageRatio(legendaryArmor, 'def', level)));
                assert.strictEqual(data.upgrade[level].stat.hp, Math.round(data.stat.hp * averageRatio(legendaryArmor, 'hp', level)));
            }
        }
    }

    const braceletId = equipment.accessory.findIndex(data => data && data.name === '777 팔찌');
    const braceletUser = new rpg.RPGUser('777팔찌테스트', 'bracelet-test');
    braceletUser.main_card = { id: 0, star: 6, type: '일반' };
    braceletUser.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: { 0: { id: braceletId, level: 0, transcendStage: 3 } }, support: null, pet: [] };
    assert.ok(Math.abs(rpg.calculateUserStats(braceletUser).pntPercent - .21) < 1e-9, '777 팔찌 3단계의 7성 카드 방어 관통은 21%여야 한다.');

    const user = new rpg.RPGUser('초월통합테스트', 'test');
    user.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    user.inventory.equipment = [
        { type: 'weapon', id: weaponId, level: 9, transcendStage: 1, tradeCount: 1, potential: { rarity: '유니크', options: [{ key: 'atk', value: 77 }] }, customMarker: 'first' },
        { type: 'weapon', id: weaponId, level: 2, transcendStage: 1, tradeCount: 0, potential: { rarity: '레어', options: [] }, customMarker: 'second' }
    ];
    const preview = rpg.formatEquipmentSynthesisPreview(user, [1, 2]);
    assert.ok(preview.includes('초월 2단계'));
    const resultText = rpg.runEquipmentSynthesis(user);
    assert.ok(resultText.includes('초월 2단계'));
    assert.strictEqual(user.inventory.equipment.length, 1);
    const result = user.inventory.equipment[0];
    assert.strictEqual(result.transcendStage, 2);
    assert.strictEqual(result.level, 9);
    assert.strictEqual(result.tradeCount, 1);
    assert.strictEqual(result.customMarker, 'first');
    assert.deepStrictEqual(result.potential, { rarity: '유니크', options: [{ key: 'atk', value: 77 }] });

    user.inventory.equipment.push({ type: 'weapon', id: weaponId, level: 1, transcendStage: 1, customMarker: 'material' });
    assert.ok(rpg.formatEquipmentSynthesisPreview(user, [1, 2]).includes('초월 3단계'));
    assert.ok(rpg.runEquipmentSynthesis(user).includes('초월 3단계'));
    assert.strictEqual(user.inventory.equipment[0].transcendStage, 3);
    assert.strictEqual(user.inventory.equipment[0].level, 9);
    assert.strictEqual(user.inventory.equipment[0].customMarker, 'first');
    assert.deepStrictEqual(user.inventory.equipment[0].potential, { rarity: '유니크', options: [{ key: 'atk', value: 77 }] });

    const kitId = items.findIndex(item => item && item.name === '초월 업그레이드 키트');
    const kitUser = new rpg.RPGUser('초월키트테스트', 'kit-test');
    kitUser.inventory.equipment = [{ type: 'weapon', id: weaponId, level: 12, transcendStage: 2, potential: { marker: 'kept' }, customMarker: 'kept' }];
    rpg.addInventoryItem(kitUser, kitId, 1);
    assert.ok((await rpg.useItem(kitUser, '초월 업그레이드 키트', 1)).includes('업그레이드할 초월 장비'));
    assert.strictEqual(rpg.getInventoryItemCount(kitUser, kitId), 0);
    assert.ok(rpg.useTranscendUpgradeKit(kitUser, 1).includes('초월 3단계'));
    assert.deepStrictEqual(kitUser.inventory.equipment[0], { type: 'weapon', id: weaponId, level: 12, transcendStage: 3, potential: { marker: 'kept' }, customMarker: 'kept' });

    const tradeEquip = { type: 'weapon', id: weaponId, transcendStage: 1 };
    assert.deepStrictEqual(rpg.getEquipmentTradeLimitInfo(tradeEquip), { count: 0, max: 1, remaining: 1 });
    assert.strictEqual(rpg.getEquipmentTradeBlockReason(tradeEquip), null);
    rpg.markEquipmentTraded(tradeEquip);
    assert.deepStrictEqual(rpg.getEquipmentTradeLimitInfo(tradeEquip), { count: 1, max: 1, remaining: 0 });
    assert.ok(rpg.getEquipmentTradeBlockReason(tradeEquip).includes('1회'));

    const mythicUser = new rpg.RPGUser('신화장착테스트', 'mythic-test');
    mythicUser.main_card = { id: 0, star: 6, type: '일반' };
    mythicUser.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    const mythicHat = mythicIds.find(entry => entry.type === 'hat');
    const mythicShoes = mythicIds.find(entry => entry.type === 'shoes');
    const mythicAccessory = mythicIds.find(entry => entry.type === 'accessory');
    const mythicSupport = mythicIds.find(entry => entry.type === 'support');
    assert.ok(mythicHat && mythicShoes && mythicAccessory && mythicSupport);
    assert.ok(rpg.getEquipmentTradeBlockReason({ type: mythicHat.type, id: mythicHat.id }).includes('거래 불가'));
    mythicUser.inventory.equipment = [
        { type: mythicHat.type, id: mythicHat.id, level: 0 },
        { type: mythicShoes.type, id: mythicShoes.id, level: 0 }
    ];
    assert.ok(rpg.equipItemByNumber(mythicUser, 1).startsWith('✅'));
    assert.ok(rpg.equipItemByNumber(mythicUser, 1).includes('1개만 장착'));

    const mythicCrossSlotUser = new rpg.RPGUser('신화전체부위제한테스트', 'mythic-cross-slot-test');
    mythicCrossSlotUser.main_card = { id: 0, star: 6, type: '일반' };
    mythicCrossSlotUser.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: { 0: { id: mythicAccessory.id, level: 0 } }, support: null, pet: [] };
    mythicCrossSlotUser.inventory.equipment = [{ type: mythicSupport.type, id: mythicSupport.id, level: 0 }];
    assert.ok(rpg.equipItemByNumber(mythicCrossSlotUser, 1).includes('1개만 장착'), '장신구에 신화를 장착한 상태에서는 신화 보조장비도 장착할 수 없어야 한다.');

    const disassembleUser = new rpg.RPGUser('초월분해테스트', 'disassemble-test');
    disassembleUser.inventory.equipment = [1, 2, 3].map(stage => ({ type: 'weapon', id: weaponId, transcendStage: stage }));
    assert.ok(rpg.formatDisassemblePreview(disassembleUser, [1, 2, 3]).includes('초월 조각 6 ~ 22'));
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        assert.ok(rpg.runDisassemble(disassembleUser).includes('장비 3개를 분해'));
    } finally {
        Math.random = originalRandom;
    }
    assert.strictEqual(disassembleUser.inventory.equipment.length, 0);
    assert.strictEqual(rpg.getInventoryItemCount(disassembleUser, rpg.EQUIPMENT_STONE_ITEM_ID), 2250);
    const fragmentId = items.findIndex(item => item && item.name === '초월 조각');
    assert.strictEqual(rpg.getInventoryItemCount(disassembleUser, fragmentId), 6);

    const mythicDisassembleUser = new rpg.RPGUser('신화분해테스트', 'mythic-disassemble-test');
    mythicDisassembleUser.inventory.equipment = [{ type: mythicHat.type, id: mythicHat.id }];
    assert.ok(rpg.formatDisassemblePreview(mythicDisassembleUser, [1]).includes('분해할 수 없는 등급'));

    const hellUser = new rpg.RPGUser('헬던전테스트', 'hell-test');
    hellUser.main_card = { id: 1, star: 6, type: '일반' };
    hellUser.level = 141;
    const comboWeaponId = equipment.weapon.findIndex(data => data && data.name === '배민글러브');
    hellUser.equipments = { weapon: { id: comboWeaponId, level: 0, transcendStage: 1 }, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    hellUser.hp = 100000;
    const invitationId = items.findIndex(item => item && item.name === '헬 초대장');
    rpg.addInventoryItem(hellUser, invitationId, 30);
    assert.ok((await rpg.enterField(hellUser, '부타게임[H]', { confirmed: true })).includes('헬 초대장 x30 소모'));
    assert.strictEqual(rpg.getInventoryItemCount(hellUser, invitationId), 0);
    hellUser.field.phase = 'pillar';
    hellUser.field.elite = null;
    hellUser.field.pillarHp = 3;
    const beforeEquipmentCount = hellUser.inventory.equipment.length;
    const originalPillarRandom = Math.random;
    Math.random = () => 0;
    hellUser.field.nextActionAt = 0;
    const firstPillarText = rpg.useBasicAttackInField(hellUser);
    Math.random = originalPillarRandom;
    assert.ok(firstPillarText.includes('1 피해'));
    assert.strictEqual(hellUser.field.equipmentState.attackCount, 1, '기둥에서는 연격이 발동하지 않아 공격 순서가 1회만 진행되어야 한다.');
    for (let i = 1; i < 3; i++) {
        hellUser.field.nextActionAt = 0;
        const text = rpg.useBasicAttackInField(hellUser);
        if (i < 2) assert.ok(text.includes('1 피해'));
        else assert.ok(text.includes('자동으로 퇴장'));
    }
    assert.strictEqual(hellUser.field, null);
    assert.ok(hellUser.inventory.equipment.length === beforeEquipmentCount + 1 || hellUser.inventory.equipment.length === beforeEquipmentCount + 2);

    console.log('transcend_integration.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
