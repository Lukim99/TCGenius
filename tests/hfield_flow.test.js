const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');

// 실제 전투·저장 코드를 실행하되 자격증명, DB, S3와 네트워크를 테스트 안에 격리한다.
for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) process.env[key] = 'isolated-hfield-test';
const blockNetwork = () => { throw new Error('External network is disabled in hfield_flow.test.js'); };
require('node:net').Socket.prototype.connect = blockNetwork;
global.fetch = async () => blockNetwork();
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
const data = { Quest: [], Shop: {} };
for (const key of ['Item', 'Equipment', 'Bundle', 'Pack', 'Recipe', 'Pet']) {
    data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', key + '.json'), 'utf8'));
}
const accountId = 'hfield-flow-test', users = new Map(), writes = [], unexpectedCommands = [];
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, type = command.constructor.name;
    if (type === 'GetCommand' && input.TableName === 'rpgenius_data') return { Item: data[input.Key.key] === undefined ? undefined : { data: structuredClone(data[input.Key.key]) } };
    if (type === 'ScanCommand' && input.TableName === 'rpgenius_user') return { Items: [...users.values()].map(user => structuredClone(user)) };
    if (type === 'GetCommand' && input.TableName === 'rpgenius_user' && input.Key.id === accountId) return { Item: structuredClone(users.get(accountId)) };
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_user' && input.Key.id === accountId) {
        const user = users.get(accountId) || { id: accountId }, names = input.ExpressionAttributeNames || {}, values = input.ExpressionAttributeValues || {};
        for (const [, alias, value] of input.UpdateExpression.matchAll(/(#[a-zA-Z0-9_]+)\s*=\s*(:[a-zA-Z0-9_]+)/g)) user[names[alias]] = structuredClone(values[value]);
        for (const alias of (input.UpdateExpression.split('REMOVE ')[1] || '').split(',').filter(Boolean)) delete user[names[alias.trim()]];
        users.set(accountId, user); writes.push(structuredClone(input)); return {};
    }
    unexpectedCommands.push(type + '/' + input.TableName);
    throw new Error('Unexpected isolated DB command: ' + type + '/' + input.TableName);
};

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    const items = rpg.getDataCache('Item', []);
    const invitationId = items.findIndex(item => item && item.name === '헬 초대장');
    const recoveryId = items.findIndex(item => item && item.name === '하급 체력 포션');
    assert.ok(invitationId >= 0, '헬 초대장 데이터가 필요합니다.');
    assert.ok(recoveryId >= 0, '회복 소모품 데이터가 필요합니다.');

    const characterCards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'CharacterCards.json'), 'utf8'));
    const characterName = characterCards[0].name;
    assert.strictEqual(rpg.formatUserCard({ id: 0, star: 0, type: '일반' }), '[1성] ' + characterName);
    assert.strictEqual(rpg.formatUserCard({ id: 0, star: 8, type: '일반' }), '[9성] ' + characterName);
    assert.strictEqual(rpg.formatUserCard({ id: 0, star: 9, type: '일반' }), '[𝛧] ' + characterName);
    assert.strictEqual(rpg.formatUserCard({ id: 0, star: 10, type: '일반' }), '[𝛴] ' + characterName);
    assert.strictEqual(rpg.formatUserCard({ id: 0, star: 11, type: '전직' }), '[𝛀] 전직 ' + characterName);

    const user = new rpg.RPGUser('H필드흐름테스트', accountId);
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
    assert.strictEqual(writes.length, 1, '소모품 사용 저장은 메모리 DB에 한 번 반영되어야 합니다.');
    assert.deepStrictEqual(users.get(accountId).inventory, user.inventory);
    assert.strictEqual(users.get(accountId).hp, user.hp);

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
    assert.deepStrictEqual(unexpectedCommands, [], '허용되지 않은 DB 요청은 없어야 합니다.');
    assert.throws(() => new (require('node:net').Socket)().connect(443, 'blocked.invalid'), /External network is disabled/);
    await assert.rejects(fetch('https://blocked.invalid'), /External network is disabled/);

    console.log('hfield_flow.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
