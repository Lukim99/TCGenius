const test = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { definition } = require('../scripts/init_songpyeon_item');
const { inventoryLocks } = require('../yut_event');
const items = [structuredClone(definition), { name: '윷', type: '이벤트' }, ...definition.choices.map(c => ({ name: c.name, type: '재료' }))];
let failWrites = false;
const writes = [];
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return input.TableName === 'rpgenius_data' && input.Key.key === 'Item' ? { Item: { data: items } } : {};
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [{
        _get: 1, id: 'songpyeon-test-id', name: 'songpyeon-test', code: 'SONGPYEON',
        logged_in: [], inventory: { item: [], card: [], equipment: [], pet: [] },
        avatarMigrated: true, need_character_card_select: false
    }] : [] };
    if (command.constructor.name === 'UpdateCommand' || command.constructor.name === 'PutCommand') {
        if (input.TableName === 'rpgenius_user') {
            if (failWrites) throw new Error('isolated write failure');
            writes.push(structuredClone(input));
        }
        return {};
    }
    throw new Error('Unexpected isolated command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
async function reset(count) {
    const user = await rpg.getRPGUserByName('songpyeon-test');
    user.inventory = { item: [{ id: 0, count }], card: [], equipment: [], pet: [] };
    await user.save(); writes.length = 0;
    return user;
}
async function withRolls(values, run) {
    const original = Math.random; let i = 0;
    Math.random = () => values[i++ % values.length];
    try { return await run(); } finally { Math.random = original; }
}

test('송편: 윷 수량 4가지 × 추가 보상 5가지 모두 정확하게 지급하고 한 번에 저장', async () => {
    for (let yut = 1; yut <= 4; yut++) for (let choice = 0; choice < 5; choice++) {
        const user = await reset(1);
        const message = await withRolls([(yut - 0.5) / 4, (choice + 0.5) / 5], () => rpg.useItem(user, '송편', 1));
        assert.match(message, /^✅/);
        assert.equal(rpg.getInventoryItemCount(user, 0), 0);
        assert.equal(rpg.getInventoryItemCount(user, 1), yut);
        assert.equal(rpg.getInventoryItemCount(user, choice + 2), definition.choices[choice].count);
        assert.equal(user.inventory.item.length, 2);
        assert.equal(writes.length, 1);
        const saved = await rpg.getRPGUserByName(user.name);
        assert.deepEqual(saved.inventory, user.inventory);
    }
});

test('송편: 여러 개 사용은 매번 독립 추첨하며 운영 보상 수량 변경을 그대로 사용', async () => {
    const user = await reset(3);
    const current = rpg.getDataCache('Item', [])[0];
    const original = current.choices[0].count;
    current.choices[0].count = 7;
    try {
        await withRolls([0, 0.1, 0.99, 0.3, 0.5, 0.9], () => rpg.useItem(user, '송편', 3));
        assert.equal(rpg.getInventoryItemCount(user, 1), 8);
        assert.equal(rpg.getInventoryItemCount(user, 2), 7);
        assert.equal(rpg.getInventoryItemCount(user, 3), 1);
        assert.equal(rpg.getInventoryItemCount(user, 6), 3);
        assert.equal(writes.length, 1);
    } finally { current.choices[0].count = original; }
});

test('송편: 잘못된 수량·부족한 보유량·누락된 보상은 차감하지 않음', async () => {
    const user = await reset(1), before = structuredClone(user.inventory);
    for (const count of [0, -1, 1.5, 2, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.match(await rpg.useItem(user, '송편', count), /^❌/);
    const current = rpg.getDataCache('Item', [])[0], choices = current.choices;
    try {
        current.choices = [{ name: '없는 아이템', count: 3 }];
        assert.match(await rpg.useItem(user, '송편', 1), /보상 정보/);
        current.choices = [];
        assert.match(await rpg.useItem(user, '송편', 1), /보상 정보/);
    } finally { current.choices = choices; }
    assert.deepEqual(user.inventory, before);
    assert.equal(writes.length, 0);
});

test('송편: 동시 사용과 윷 투척 잠금, 오래된 유저 인스턴스를 통한 초과 소비 차단', async () => {
    const user = await reset(1), stale = await rpg.getRPGUserByName(user.name);
    const results = await Promise.all([rpg.useItem(user, '송편', 1), rpg.useItem(stale, '송편', 1)]);
    assert.equal(results.filter(s => s.startsWith('✅')).length, 1);
    assert.match(await rpg.useItem(stale, '송편', 1), /부족/);
    await reset(1);
    inventoryLocks.add(user.name);
    try { assert.match(await rpg.useItem(user, '송편', 1), /처리하고/); }
    finally { inventoryLocks.delete(user.name); }
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(user.name), 0), 1);
});

test('송편: 저장 실패 재시도에서 추가 소모·재추첨 없음', async () => {
    const user = await reset(2);
    failWrites = true;
    try { assert.match(await withRolls([0.99, 0.1], () => rpg.useItem(user, '송편', 1)), /저장/); }
    finally { failWrites = false; }
    const retry = await rpg.getRPGUserByName(user.name);
    assert.equal(rpg.getInventoryItemCount(retry, 0), 1);
    const before = structuredClone(retry.inventory);
    assert.match(await withRolls([0, 0.9], () => rpg.useItem(retry, '송편', 1)), /^✅/);
    assert.deepEqual(retry.inventory, before);
    assert.equal(rpg.getInventoryItemCount(retry, 1), 4);
    assert.equal(rpg.getInventoryItemCount(retry, 2), 5);
    assert.equal(writes.length, 1);
});
