const test = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { definition } = require('../scripts/init_songpyeon_item');
let writes = 0;
DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'GetCommand') return command.input.Key.key === 'Item' ? { Item: { data: [structuredClone(definition), { name: '윷', type: '이벤트' }] } } : {};
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    writes++;
    throw new Error('종료된 송편을 테스트할 때 저장하면 안 됩니다.');
};
const rpg = require('../rpgenius');
test('윷놀이 종료 후 송편 사용은 기존 보유량과 진행 기록을 보존한다', async () => {
    await rpg.initRpgeniusData();
    const user = new rpg.RPGUser('송편종료테스트');
    user.inventory.item = [{ id: 0, count: 5 }, { id: 1, count: 4 }];
    user.yutEvent = { position: 7, laps: 3, bonusRoll: true };
    const before = structuredClone({ inventory: user.inventory, yutEvent: user.yutEvent });
    for (const amount of [1, 5]) assert.match(await rpg.useItem(user, '송편', amount), /이벤트가 종료/);
    assert.deepEqual({ inventory: user.inventory, yutEvent: user.yutEvent }, before);
    assert.equal(writes, 0);
});
