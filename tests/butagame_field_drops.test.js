const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Recipe', 'Bundle', 'Pack']) {
    data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', key + '.json'), 'utf8'));
}
for (const name of ['헬 초대장', '헬 도전장', '상급 강화석']) {
    if (!data.Item.some(item => item && item.name === name)) data.Item.push({ name, type: '재료' });
}
DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'ScanCommand' && command.input.TableName === 'rpgenius_user') return { Items: [] };
    assert.strictEqual(command.constructor.name, 'GetCommand', '테스트에서 DB 쓰기를 허용하지 않습니다.');
    assert.strictEqual(command.input.TableName, 'rpgenius_data');
    return { Item: { data: structuredClone(data[command.input.Key.key] || {}) } };
};

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    const fields = rpg.getRegularFieldDungeons();
    const butagame = fields.find(field => field.name === '부타게임');
    const seoul = fields.find(field => field.name === '서울오프라인');
    const intrigue = fields.find(field => field.name === '인트리그미션');
    const items = rpg.getDataCache('Item', []);
    const invitationId = items.findIndex(item => item && item.name === '헬 초대장');
    const challengeId = items.findIndex(item => item && item.name === '헬 도전장');
    const advancedStoneId = items.findIndex(item => item && item.name === '상급 강화석');
    assert.ok(invitationId >= 0 && challengeId >= 0 && advancedStoneId >= 0);

    const user = new rpg.RPGUser('부타게임필드드롭테스트', 'butagame-field-drop-test');
    const lines = [];
    const rolls = [.039999, 0, .024999, .999999, .014999];
    const granted = rpg.grantButagameFieldBonusDrops(user, butagame, 50, lines, () => rolls.shift());
    assert.deepStrictEqual(granted, { invitation: 1, challenge: 2, advancedStone: 1 });
    assert.strictEqual(rolls.length, 0, '여러 마리를 처치해도 각 보상은 공격당 한 번만 판정해야 한다.');
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 1);
    assert.strictEqual(rpg.getInventoryItemCount(user, challengeId), 2);
    assert.strictEqual(rpg.getInventoryItemCount(user, advancedStoneId), 1);

    const seoulRolls = [.039999, 0, .024999, .999999, .014999];
    const seoulGranted = rpg.grantButagameFieldBonusDrops(user, seoul, 50, [], () => seoulRolls.shift());
    assert.deepStrictEqual(seoulGranted, { invitation: 1, challenge: 2, advancedStone: 1 }, '서울오프라인에서도 필드 보너스 드랍이 판정되어야 한다.');
    assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), 2);
    assert.strictEqual(rpg.getInventoryItemCount(user, challengeId), 4);
    assert.strictEqual(rpg.getInventoryItemCount(user, advancedStoneId), 2);

    for (const field of [...fields.filter(field => field.requireLevel >= 161), { ...intrigue, name: '후속 필드 테스트', requireLevel: 171 }]) {
        const ticketRolls = [.069999, 0, .039999, .999999];
        const beforeInvitation = rpg.getInventoryItemCount(user, invitationId);
        const beforeChallenge = rpg.getInventoryItemCount(user, challengeId);
        assert.deepStrictEqual(
            rpg.grantButagameFieldBonusDrops(user, field, 50, [], () => ticketRolls.shift()),
            { invitation: 1, challenge: 2, advancedStone: 0 },
            field.name + '에서도 기존 확률과 수량으로 헬 티켓을 지급해야 한다.'
        );
        assert.strictEqual(ticketRolls.length, 0);
        assert.strictEqual(rpg.getInventoryItemCount(user, invitationId), beforeInvitation + 1);
        assert.strictEqual(rpg.getInventoryItemCount(user, challengeId), beforeChallenge + 2);
        const boundary = [.07, .04];
        assert.deepStrictEqual(rpg.grantButagameFieldBonusDrops(user, field, 1, [], () => boundary.shift()),
            { invitation: 0, challenge: 0, advancedStone: 0 });
    }

    for (const field of [...fields.filter(field => field.requireLevel < 141), rpg.getHellDungeon(), { ...intrigue, worldBoss: true }]) {
        assert.deepStrictEqual(rpg.grantButagameFieldBonusDrops(user, field, 1, [], () => {
            assert.fail(field.name + '에서는 일반 필드 헬 티켓을 추첨하면 안 된다.');
        }), { invitation: 0, challenge: 0, advancedStone: 0 });
    }

    const boundaryRolls = [.07, .04, .015];
    assert.deepStrictEqual(
        rpg.grantButagameFieldBonusDrops(user, butagame, 1, [], () => boundaryRolls.shift()),
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
        rpg.grantButagameFieldBonusDrops(user, butagame, 0, [], () => 0),
        { invitation: 0, challenge: 0, advancedStone: 0 },
        '처치 수가 0이면 판정하면 안 된다.'
    );

    for (const level of [161, 261]) {
        const hunter = new rpg.RPGUser('인트리그미션드롭테스트' + level, 'intrigue-drop-test-' + level);
        hunter.level = level;
        hunter.main_card = { id: 0, star: 6, type: '일반' };
        hunter.need_character_card_select = false;
        hunter.hp = 1000000000;
        hunter.mp = 1000000000;
        hunter.field = { name: intrigue.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} };
        const originalRandom = Math.random;
        let result;
        try {
            Math.random = () => 0;
            result = rpg.buildHuntResult(hunter, intrigue, intrigue.hp * 5, {
                hitCount: 1, disableCritical: true, disableEquipmentBonusDamage: true, isBotAutoAttack: true
            });
        } finally {
            Math.random = originalRandom;
            rpg.clearFieldRuntimeTimers(hunter.name);
        }
        assert.ok(hunter.field.killCount > 0, '실제 사냥에서 처치가 발생해야 한다.');
        const expected = level === 161 ? 1 : 0;
        assert.strictEqual(rpg.getInventoryItemCount(hunter, invitationId), expected, '사냥 보상에서 초대장을 지급하고 100레벨 차이 제한을 유지해야 한다.');
        assert.strictEqual(rpg.getInventoryItemCount(hunter, challengeId), expected, '사냥 보상에서 도전장을 지급하고 100레벨 차이 제한을 유지해야 한다.');
        if (expected) {
            assert.ok(result.includes('헬 초대장 x1') && result.includes('헬 도전장 x1'));
        }
    }

    console.log('butagame_field_drops.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
