'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { START_AT, END_AT, REWARD_NAME, isChuseokDay, regularCardPackBaseChance, registerChuseokRoutes } = require('../chuseok_event');
const { inventoryLocks } = require('../yut_event');
const { SOURCE_NAME, createDefinition } = require('../scripts/init_chuseok_card_pack');
let time = START_AT, failWrites = false;
const writes = [];
const fixtures = ['a', 'b'].map(id => ({ id: 'chuseok-' + id, name: 'chuseok-' + id, _get: 1,
    avatarMigrated: true, logged_in: [], inventory: { item: [], card: [], equipment: [], pet: [] } }));
// AWS 경계만 격리. 실제 계정 큐, 캐시, 저장, 사냥 함수를 사용한다.
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone(fixtures) : [] };
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        if (input.Key.key === 'Item' && !data.some(item => item?.name === REWARD_NAME)) data.push(createDefinition(data));
        return { Item: { key: input.Key.key, data } };
    }
    if (command.constructor.name === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        if (failWrites) throw new Error('isolated save failure');
        writes.push(structuredClone(input)); return {};
    }
    if (command.constructor.name === 'PutCommand' && input.TableName === 'rpgenius_data' && input.Item.key === 'EliteState') return {};
    throw new Error('Unexpected isolated DB write: ' + command.constructor.name + ' ' + input.TableName);
};
const rpg = require('../rpgenius');
let server, base;
const user = name => rpg.getRPGUserByName(name || 'chuseok-a');
async function request(route = '', account = 'chuseok-a', body) {
    const response = await fetch(base + '/api/event/chuseok' + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(account ? { Authorization: account } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
async function reset() {
    failWrites = false; time = START_AT;
    for (const fixture of fixtures) {
        const value = await user(fixture.name); delete value.chuseok2026;
        value.inventory = structuredClone(fixture.inventory); await value.save();
    }
    writes.length = 0;
}
before(async () => {
    await rpg.initRpgeniusData();
    const app = express(); app.use(express.json());
    registerChuseokRoutes(app, { rpgenius: rpg, now: () => time, requireUser(req, res, next) {
        if (!req.headers.authorization) return res.status(401).json({ error: '로그인 필요' });
        req.session = { name: req.headers.authorization }; next();
    } });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));

test('KST 9월 25일 양쪽 자정과 연도를 정확하게 제한한다', async () => {
    for (const [at, active] of [[START_AT-1,false], [START_AT,true], [END_AT-1,true], [END_AT,false], [Date.parse('2027-09-25T12:00:00+09:00'),false]]) {
        assert.equal(isChuseokDay(at), active);
        assert.equal(regularCardPackBaseChance(at), active ? .05 : .03);
    }
    await reset();
    for (const at of [START_AT-1, END_AT]) {
        time = at; assert.equal((await request()).data.active, false);
        assert.equal((await request('/enter', 'chuseok-a', {})).status, 410);
        assert.equal((await request('/claim', 'chuseok-a', {})).status, 410);
    }
    assert.equal(writes.length, 0);
});
test('인증, 계정 존재 여부, 미진입 요청을 확인하며 조회만으로 방문 처리하지 않는다', async () => {
    await reset();
    assert.equal((await request('', '')).status, 401);
    assert.equal((await request('/claim', '', {})).status, 401);
    assert.equal((await request('', 'missing')).status, 404);
    assert.equal((await request()).data.seen, false);
    assert.equal((await request('/claim', 'chuseok-a', {})).status, 409);
    assert.equal(writes.length, 0);
});
test('동시 첫 진입은 한 번만 연출하고 계정마다 독립적으로 기록한다', async () => {
    await reset();
    const entries = await Promise.all(Array.from({ length: 4 }, () => request('/enter', 'chuseok-a', {})));
    assert.equal(entries.filter(entry => entry.data.showIntro).length, 1);
    assert.equal((await request()).data.seen, true);
    assert.equal((await request('/enter', 'chuseok-b', {})).data.showIntro, true);
});
test('중복 클릭과 재접속은 정확히 1개 지급, 수령 기록과 아이템은 한 번에 저장', async () => {
    await reset(); await request('/enter', 'chuseok-a', {}); writes.length = 0;
    const claims = await Promise.all(Array.from({ length: 5 }, () => request('/claim', 'chuseok-a', { name: 'chuseok-b', count: 999 })));
    assert.ok(claims.every(result => result.status === 200 && result.data.claimed));
    assert.equal(claims.filter(result => !result.data.replayed).length, 1);
    const id = rpg.getDataCache('Item', []).findIndex(item => item?.name === REWARD_NAME);
    assert.equal(rpg.getInventoryItemCount(await user(), id), 1);
    assert.equal(rpg.getInventoryItemCount(await user('chuseok-b'), id), 0);
    assert.equal(writes.length, 1);
    assert.ok(writes[0].ExpressionAttributeValues[':v_inventory']);
    assert.ok(writes[0].ExpressionAttributeValues[':v_chuseok2026'].claimedAt);
    assert.equal((await request('/enter', 'chuseok-a', {})).data.showIntro, false);
    time = END_AT;
    assert.equal((await request('/claim', 'chuseok-a', {})).data.replayed, true);
    assert.equal(rpg.getInventoryItemCount(await user(), id), 1);
});
test('누락된 운영 아이템과 윷/송편 처리 중에는 보상을 변경하지 않는다', async () => {
    await reset(); await request('/enter', 'chuseok-a', {});
    inventoryLocks.add('chuseok-a');
    try { assert.equal((await request('/claim', 'chuseok-a', {})).status, 409); }
    finally { inventoryLocks.delete('chuseok-a'); }
    const items = rpg.getDataCache('Item', []), id = items.findIndex(item => item?.name === REWARD_NAME), old = items[id];
    try {
        items[id] = null;
        assert.equal((await request('/claim', 'chuseok-a', {})).status, 503);
        assert.equal((await request()).data.claimed, false);
        assert.equal((await user()).inventory.item.length, 0);
    } finally { items[id] = old; }
});
test('추석 카드팩은 기존 운영 정의를 보존하며 같은 5성 전직 카드를 지급한다', async () => {
    await reset();
    const items = rpg.getDataCache('Item', []);
    const original = items.find(item => item?.name === SOURCE_NAME);
    const definition = createDefinition(items);
    assert.deepEqual(definition, { ...original, name: REWARD_NAME });
    assert.notEqual(definition.pack, original.pack);
    assert.throws(() => createDefinition([]));
    const oldRandom = Math.random;
    try {
        Math.random = () => .37;
        const results = [];
        for (const [account, name] of [['chuseok-a', SOURCE_NAME], ['chuseok-b', REWARD_NAME]]) {
            const value = await user(account);
            value.need_character_card_select = false;
            const id = items.findIndex(item => item?.name === name);
            rpg.addInventoryItem(value, id, 3);
            const result = await rpg.useItem(value, name, 3);
            assert.doesNotMatch(result, /^❌/);
            assert.equal(rpg.getInventoryItemCount(value, id), 0);
            assert.equal(value.inventory.card.length, 3);
            assert.ok(value.inventory.card.every(card => card.type === '전직' && card.star === 4));
            results.push(value.inventory.card);
        }
        assert.deepEqual(results[0], results[1]);
    } finally { Math.random = oldRandom; }
});
test('저장 실패 후 재시도는 보상을 추가하지 않고 저장을 재확인한다', async () => {
    await reset(); await request('/enter', 'chuseok-a', {});
    failWrites = true;
    assert.equal((await request('/claim', 'chuseok-a', {})).status, 503);
    failWrites = false;
    assert.equal((await request('/claim', 'chuseok-a', {})).data.replayed, true);
    const id = rpg.getDataCache('Item', []).findIndex(item => item?.name === REWARD_NAME);
    assert.equal(rpg.getInventoryItemCount(await user(), id), 1);
});
test('실제 일반 사냥에서 4% 난수는 당일 카드팩만 드랍하며 무처치/레벨 제한은 유지', async () => {
    const oldNow = Date.now, oldRandom = Math.random;
    const dungeon = rpg.getRegularFieldDungeons()[0];
    assert.ok(dungeon);
    function hunt(at, damage = 1e8, level = dungeon.requireLevel, dailyDungeon = false) {
        Date.now = () => at; Math.random = () => .04;
        const value = new rpg.RPGUser('hunt-test', 'hunt-test');
        value.level = Number(level); value.main_card = { id: 0, star: 0, type: '일반' };
        value.hp = 1e9; value.mp = 1e9;
        value.field = { name: dungeon.name, killCount: 0, nextActionAt: 0, equipmentState: {}, dailyDungeon };
        const text = rpg.buildHuntResult(value, dungeon, damage, { precalculatedDamage: true, hitCount: 1,
            disableCritical: true, disableEquipmentBonusDamage: true, summonAttack: true, isBotAutoAttack: true });
        return { text, value };
    }
    try {
        assert.doesNotMatch(hunt(START_AT-1).text, /카드팩 상자 획득/);
        const during = hunt(START_AT).text;
        assert.match(during, /카드팩 상자 획득/);
        assert.doesNotMatch(during, /📦 (장비 상자|중급 장비 상자|보조 장비 상자) 획득/);
        assert.doesNotMatch(hunt(END_AT).text, /카드팩 상자 획득/);
        assert.doesNotMatch(hunt(START_AT, 0).text, /카드팩 상자 획득/);
        assert.doesNotMatch(hunt(START_AT, 100, dungeon.requireLevel, true).text, /카드팩 상자 획득/);
        assert.doesNotMatch(hunt(START_AT, 1e8, Number(dungeon.requireLevel)+100).text, /카드팩 상자 획득/);
    } finally { Date.now = oldNow; Math.random = oldRandom; }
});
