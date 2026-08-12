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
    const items = rpg.getDataCache('Item', []);
    const invitationId = items.findIndex(item => item && item.name === '헬 초대장');
    assert.ok(invitationId >= 0, '헬 초대장 데이터가 필요합니다.');

    const user = new rpg.RPGUser('H필드흐름테스트', 'hfield-flow-test');
    user.level = 141;
    rpg.addInventoryItem(user, invitationId, rpg.HELL_INVITATION_COST);
    user.hp = rpg.calculateUserStats(user).hp;

    const enterText = await rpg.enterField(user, '부타게임[H]', { confirmed: true });
    assert.ok(enterText.includes('입장했습니다'));
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 0, '입장 시 초대장 30장을 소모해야 합니다.');
    assert.strictEqual(user.field.phase, 'elite');

    user.field.elite.hp = 1;
    user.field.nextActionAt = 0;
    const eliteText = await rpg.useBasicAttackInField(user);
    assert.ok(eliteText.includes('기둥이 나타났습니다'));
    assert.strictEqual(user.field.phase, 'pillar');

    user.field.nextActionAt = 0;
    await rpg.useBasicAttackInField(user);
    assert.strictEqual(user.field.pillarHp, 1, '기둥은 공격당 1의 피해만 받아야 합니다.');

    user.field.nextActionAt = 0;
    const clearText = await rpg.useBasicAttackInField(user);
    assert.ok(clearText.includes('보상 획득 후 자동으로 퇴장했습니다'));
    assert.strictEqual(user.field, null, '보상 지급 후 자동 퇴장해야 합니다.');

    console.log('hfield_flow.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
