const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const shop = { 일반: [{ type: '아이템', item_id: 0, count: 7, price: { goods: 'gold', amount: 123 } }] };
const original = structuredClone(shop);
const writes = [];
DynamoDBDocumentClient.prototype.send = async function(command) {
    if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key.key;
        return { Item: { key, data: key === 'Shop' ? shop : key === 'Item'
            ? [{ name: '유생의 주사위' }, { name: '펀치기계 토큰' }] : [] } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    writes.push(command.constructor.name);
    throw new Error('Startup must not write');
};
const rpg = require('../rpgenius');
(async () => {
    await rpg.initRpgeniusData();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shop, original);
    assert.deepEqual(writes, []);
    assert.equal(await rpg.isRuntimeReady(), true);
    console.log('startup_preserves_shop.test.js: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
