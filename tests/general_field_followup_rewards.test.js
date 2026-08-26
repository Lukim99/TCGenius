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
    const dungeon = rpg.getRegularFieldDungeons()[0];
    assert.ok(dungeon && dungeon.reward, '일반 필드 보상 데이터가 필요합니다.');

    const user = new rpg.RPGUser('일반필드후속타보상테스트', 'general-field-followup-reward-test');
    user.level = Number(dungeon.requireLevel || 1);
    user.main_card = { id: 0, star: 6, type: '일반' };
    user.need_character_card_select = false;
    user.hp = 1000000000;
    user.mp = 1000000000;
    user.field = { name: dungeon.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} };

    const before = {
        level: user.level,
        exp: Number(user.exp || 0),
        gold: Number(user.gold || 0),
        items: (user.inventory.item || []).reduce((sum, item) => sum + Number(item.count || 0), 0)
    };
    const originalRandom = Math.random;
    let result;
    try {
        Math.random = () => 0;
        result = rpg.buildHuntResult(user, dungeon, Number(dungeon.hp || 1) * 5, {
            hitCount: 1,
            disableCritical: true,
            disableEquipmentBonusDamage: true,
            summonAttack: true,
            dotAttack: true,
            isBotAutoAttack: true,
            attackElement: '화'
        });
    } finally {
        Math.random = originalRandom;
    }

    const itemCount = (user.inventory.item || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
    assert.ok(Number(user.field && user.field.killCount || 0) > 0, '화상 같은 후속타 처치도 일반 필드 처치 수에 반영돼야 합니다.');
    assert.ok(Number(user.gold || 0) > before.gold, '후속타 처치 골드가 실제 사용자 데이터에 지급돼야 합니다.');
    assert.ok(user.level > before.level || Number(user.exp || 0) > before.exp, '후속타 처치 경험치가 실제 사용자 데이터에 지급돼야 합니다.');
    assert.ok(itemCount > before.items, '후속타 처치의 아이템 드롭도 실제 인벤토리에 지급돼야 합니다.');
    assert.ok(result.includes('[ 보상 ]') && /- XP\s+[\d,]+/.test(result) && /- 🪙\s+[\d,]+/.test(result), '후속타 결과에도 경험치와 골드 보상 내역이 남아야 합니다.');

    const source = fs.readFileSync(path.join(__dirname, '..', 'rpgenius.js'), 'utf8');
    const equipmentTick = source.slice(source.indexOf('async function runFieldEquipmentDotTick'), source.indexOf('function clearFieldRuntimeTimers'));
    assert.ok(equipmentTick.includes('buildHuntResult(user, effectContext.dungeon, effect.rawDamage, extra)'), '화상·겁화·천공·그림자 후속타는 일반 사냥 보상 로직을 그대로 사용해야 합니다.');
    assert.ok(equipmentTick.includes('await user.save()'), '후속타로 변경된 처치 수와 보상은 사용자 데이터에 저장돼야 합니다.');
    assert.ok(equipmentTick.includes('pushFieldTickEvent(userName') && source.includes('rewards: getFieldTickRewards(user, before, message)'), '후속타로 지급된 보상은 웹 필드 이벤트에도 보존돼야 합니다.');

    console.log('general_field_followup_rewards.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
