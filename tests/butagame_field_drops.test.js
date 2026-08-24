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
    const challengeId = items.findIndex(item => item && item.name === '헬 도전장');
    const advancedStoneId = items.findIndex(item => item && item.name === '상급 강화석');
    assert.ok(invitationId >= 0 && challengeId >= 0 && advancedStoneId >= 0);

    const user = new rpg.RPGUser('부타게임필드드롭테스트', 'butagame-field-drop-test');
    const lines = [];
    const rolls = [.039999, 0, .024999, .999999, .014999];
    const granted = rpg.grantButagameFieldBonusDrops(user, { name: '부타게임' }, 50, lines, () => rolls.shift());
    assert.deepStrictEqual(granted, { invitation: 1, challenge: 2, advancedStone: 1 });
    assert.strictEqual(rolls.length, 0, '여러 마리를 처치해도 각 보상은 공격당 한 번만 판정해야 한다.');
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 1);
    assert.strictEqual(rpg.getInventoryItemCount(user, challengeId), 2);
    assert.strictEqual(rpg.getInventoryItemCount(user, advancedStoneId), 1);

    const seoulRolls = [.039999, 0, .024999, .999999, .014999];
    const seoulGranted = rpg.grantButagameFieldBonusDrops(user, { name: '서울오프라인' }, 50, [], () => seoulRolls.shift());
    assert.deepStrictEqual(seoulGranted, { invitation: 1, challenge: 2, advancedStone: 1 }, '서울오프라인에서도 필드 보너스 드랍이 판정되어야 한다.');
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 2);
    assert.strictEqual(rpg.getInventoryItemCount(user, challengeId), 4);
    assert.strictEqual(rpg.getInventoryItemCount(user, advancedStoneId), 2);

    const boundaryRolls = [.07, .04, .015];
    assert.deepStrictEqual(
        rpg.grantButagameFieldBonusDrops(user, { name: '부타게임' }, 1, [], () => boundaryRolls.shift()),
        { invitation: 0, challenge: 0, advancedStone: 0 },
        '확률 경계값은 당첨에 포함되면 안 된다.'
    );

    let nonButaRolled = false;
    assert.deepStrictEqual(
        rpg.grantButagameFieldBonusDrops(user, { name: '부타게임[H]' }, 1, [], () => { nonButaRolled = true; return 0; }),
        { invitation: 0, challenge: 0, advancedStone: 0 }
    );
    assert.strictEqual(nonButaRolled, false, '헬 던전에는 일반 부타게임 필드 보상을 판정하면 안 된다.');

    assert.deepStrictEqual(
        rpg.grantButagameFieldBonusDrops(user, { name: '부타게임' }, 0, [], () => 0),
        { invitation: 0, challenge: 0, advancedStone: 0 },
        '처치 수가 0이면 판정하면 안 된다.'
    );

    console.log('butagame_field_drops.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
