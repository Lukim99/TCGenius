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
    const recoveryId = items.findIndex(item => item && item.name === '하급 체력 포션');
    assert.ok(invitationId >= 0, '헬 초대장 데이터가 필요합니다.');
    assert.ok(recoveryId >= 0, '회복 소모품 데이터가 필요합니다.');

    const user = new rpg.RPGUser('H필드흐름테스트', 'hfield-flow-test');
    user.level = 141;
    rpg.addInventoryItem(user, invitationId, rpg.HELL_INVITATION_COST);
    rpg.addInventoryItem(user, recoveryId, 1);
    user.hp = rpg.calculateUserStats(user).hp;

    const enterText = await rpg.enterField(user, '부타게임[H]', { confirmed: true });
    assert.ok(enterText.includes('입장했습니다'));
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 0, '입장 시 초대장 30장을 소모해야 합니다.');
    assert.strictEqual(user.field.phase, 'elite');

    const maxHp = rpg.calculateUserStats(user).hp;
    user.hp = Math.max(1, maxHp - 100);
    const beforeRecoveryHp = user.hp;
    const recoveryText = await rpg.useItem(user, '하급 체력 포션', 1);
    assert.ok(recoveryText.includes('HP +'), '필드 안에서 회복 소모품을 사용할 수 있어야 합니다.');
    assert.ok(user.hp > beforeRecoveryHp, '회복 소모품은 실제 HP를 회복해야 합니다.');
    assert.strictEqual(rpg.getInventoryItemCount(user, recoveryId), 0, '사용한 회복 소모품은 인벤토리에서 차감해야 합니다.');
    assert.strictEqual(user.field.name, '부타게임[H]', '소모품을 사용해도 진행 중인 H필드를 유지해야 합니다.');

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
