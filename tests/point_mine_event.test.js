'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
const { KEY_NAME, KEY_DEFINITION, DEFAULT_CONFIG } = require('../point_mine_config');
const { validateConfig, oreDistribution } = require('../point_mine_event');
const { newShopItemId, legacyShopItemId } = require('../shop_catalog');

// 기존 서버와 RPGUser를 실행한다. AWS 경계만 메모리로 대체하며 환경 파일은 읽지 않는다.
AWS.S3 = class { listObjectsV2() { return { promise: async () => ({ Contents: [] }) }; } };
const fixture = { id: 'mine-test-id', name: '광산테스트', code: 'MINE-TEST-ONLY', _get: 1, avatarMigrated: true, logged_in: [], logged_in_agent: [], need_character_card_select: false };
const itemData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB/RPGenius/Item.json'), 'utf8'));
for (const item of [KEY_DEFINITION, ...DEFAULT_CONFIG.rewards.map(({ name }) => ({ name, type: '가챠' }))]) if (!itemData.some(entry => entry?.name === item.name)) itemData.push(item);
const keyId = itemData.findIndex(item => item?.name === KEY_NAME);
let failedWrites = false, writes = [], shopData = null;
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const key = input.Key.key;
        const file = path.join(__dirname, '..', 'DB/RPGenius', key + '.json');
        const data = key === 'Item' ? itemData : key === 'PointMine' ? DEFAULT_CONFIG : key === 'Shop' && shopData ? shopData : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        return { Item: { key, data: structuredClone(data) } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(fixture)] : [] };
    if (['UpdateCommand', 'PutCommand', 'TransactWriteCommand'].includes(command.constructor.name)) {
        if (failedWrites && input.TableName === 'rpgenius_user') throw new Error('isolated mine save failure');
        writes.push(structuredClone(input)); return {};
    }
    throw new Error('Unexpected isolated command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const startServer = require('../server');
let server, base, cookie;
const body = (revision, values = {}) => ({ requestId: crypto.randomUUID(), revision, ...values });
async function request(action, data, authenticated = true) {
    const response = await fetch(base + '/api/point-mine' + (action ? '/' + action : ''), { method: data ? 'POST' : 'GET', headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
}
async function forceDraw(value, callback) {
    const original = crypto.randomInt;
    crypto.randomInt = max => max === 0x100000000 ? Math.floor(value * max) : original(max);
    try { return await callback(); } finally { crypto.randomInt = original; }
}
async function setState(changes = {}) {
    const user = await rpg.getRPGUserByName(fixture.name);
    Object.assign(user, changes); await user.save(); return user;
}
before(async () => {
    await rpg.initRpgeniusData();
    process.env.PORT = '0'; server = startServer();
    await new Promise(resolve => server.on('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fixture.name, code: fixture.code }) });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
});
beforeEach(async () => {
    failedWrites = false;
    Object.assign(rpg.getDataCache('PointMine'), structuredClone(DEFAULT_CONFIG));
    await setState({ pointMine: null, pointMineDropDaily: null, songpyeonDropDaily: { date: '2026-10-10', count: 10 }, yutEvent: { position: 7, laps: 3, bonusRoll: true },
        main_card: { id: 0, star: 6, type: '일반' }, level: 1, hp: 1000000000, mp: 1000000000,
        inventory: { item: [{ id: keyId, count: 20 }], card: [], equipment: [], pet: [] } });
    writes = [];
});
after(() => new Promise(resolve => server.close(resolve)));

test('로그인 필수, 실제 이벤트 메뉴와 기존 윷놀이 API 종료', async () => {
    assert.equal((await request('', undefined, false)).status, 401);
    assert.equal((await request('open', body(0), false)).status, 401);
    assert.equal((await request('')).data.keyCount, 20);
    const html = await (await fetch(base + '/', { headers: { Cookie: cookie } })).text();
    assert.match(html, /data-page="포인트 광산"/);
    const userBefore = await rpg.getRPGUserByName(fixture.name);
    const snapshot = structuredClone({ inventory: userBefore.inventory, yutEvent: userBefore.yutEvent });
    for (const [endpoint, method] of [['/api/yut', 'GET'], ['/api/yut/roll', 'POST']]) assert.equal((await fetch(base + endpoint, { method, headers: { Cookie: cookie } })).status, 410);
    const userAfter = await rpg.getRPGUserByName(fixture.name);
    assert.deepEqual({ inventory: userAfter.inventory, yutEvent: userAfter.yutEvent }, snapshot);
    assert.equal(writes.length, 0);
});

test('상자 16종 추첨, 열쇠 정확한 차감·중복 요청·다른 창의 오래된 기록 차단', async () => {
    let prefix = 0;
    for (const [index, type] of DEFAULT_CONFIG.pickaxes.entries()) {
        const input = body(index);
        const result = await forceDraw((prefix + type.weight / 2) / 10000, () => request('open', input));
        assert.equal(result.status, 200);
        assert.equal(result.data.lastAction.result.pickaxe.id, type.id);
        assert.equal(result.data.lastAction.result.pickaxe.maxDurability, type.durability);
        assert.equal(result.data.keyCount, 19 - index);
        const replay = await request('open', input);
        assert.equal(replay.data.replayed, true); assert.equal(replay.data.pickaxes.length, index + 1);
        assert.equal((await request('open', body(index))).status, 409);
        prefix += type.weight;
    }
});

test('두 상자 동시 개봉은 같은 계정 큐에서 한 번만 차감', async () => {
    const responses = await Promise.all([request('open', body(0)), request('open', body(0))]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const state = (await request('')).data;
    assert.equal(state.keyCount, 19); assert.equal(state.pickaxes.length, 1);
});

test('채굴 → 내구도 소모 → 광물 수리 → 선택 판매 → 1회 보상 교환과 저장 복원', async () => {
    const opened = await forceDraw(.3, () => request('open', body(0)));
    assert.equal(opened.data.lastAction.result.pickaxe.id, 'stone');
    const uid = opened.data.equippedUid;
    const input = body(1);
    const mined = await forceDraw(0, () => request('mine', input));
    assert.equal(mined.status, 200); assert.equal(mined.data.lastAction.result.oreId, 'stone');
    assert.equal(mined.data.pickaxes[0].durability, 7);
    const replay = await request('mine', input);
    assert.equal(replay.data.totalMined, 1); assert.equal(replay.data.replayed, true);
    assert.equal((await request('mine', body(2))).status, 429);
    assert.equal((await request('repair', body(2, { uid, amount: 1 }))).status, 400);
    const current = await rpg.getRPGUserByName(fixture.name);
    current.pointMine.ores = { stone: 2902 }; await current.save();
    const repaired = await request('repair', body(2, { uid, amount: 1 }));
    assert.equal(repaired.status, 200); assert.equal(repaired.data.pickaxes[0].durability, 8);
    assert.equal(repaired.data.ores.find(ore => ore.id === 'stone').count, 2900);
    const sold = await request('sell', body(3, { ores: [{ id: 'stone', count: 2900 }] }));
    assert.equal(sold.status, 200); assert.equal(sold.data.points, 2900);
    const rewardInput = body(4, { rewardId: 'card9' });
    const exchanged = await request('exchange', rewardInput);
    assert.equal(exchanged.status, 200); assert.equal(exchanged.data.points, 0); assert.equal(exchanged.data.exchanges.card9, 1);
    const rewardReplay = await request('exchange', rewardInput);
    assert.equal(rewardReplay.data.exchanges.card9, 1);
    const user = await rpg.getRPGUserByName(fixture.name);
    const rewardId = rpg.getDataCache('Item').findIndex(item => item?.name === '9성 카드팩');
    assert.equal(rpg.getInventoryItemCount(user, rewardId), 1);
    assert.equal((await request('exchange', body(5, { rewardId: 'card9' }))).status, 400);
    assert.equal(user.yutEvent.laps, 3);
    assert.ok(writes.some(write => /#inventory/.test(write.UpdateExpression || '') && /#pointMine/.test(write.UpdateExpression || '')));
    assert.equal((await request('')).data.revision, 5);
});

test('내구도 0·나무 수리·수량 위조·없는 보상은 차감하지 않는다', async () => {
    const state = (await forceDraw(0, () => request('open', body(0)))).data;
    const user = await rpg.getRPGUserByName(fixture.name);
    user.pointMine.pickaxes[0].durability = 0; user.pointMine.ores = { stone: 3 }; user.pointMine.points = 10000; await user.save();
    const snapshot = structuredClone(user.pointMine);
    for (const [action, values] of [
        ['mine', {}], ['equip', { uid: state.equippedUid }], ['repair', { uid: state.equippedUid, amount: 1 }],
        ['sell', { ores: [{ id: 'stone', count: -1 }] }], ['sell', { ores: [{ id: 'stone', count: 1.5 }] }],
        ['sell', { ores: [{ id: 'stone', count: 4 }] }], ['sell', { ores: [{ id: 'stone', count: 1 }, { id: 'stone', count: 1 }] }],
        ['exchange', { rewardId: 'unknown' }]
    ]) assert.equal((await request(action, body(1, values))).status, 400);
    assert.deepEqual((await rpg.getRPGUserByName(fixture.name)).pointMine, snapshot);
    assert.equal((await request('open', { requestId: 'invalid', revision: 1 })).status, 400);
    await setState({ inventory: { item: [], card: [], equipment: [], pet: [] } });
    assert.equal((await request('open', body(1))).status, 400);
});

test('모든 변경 행동은 저장 실패 재시도에서도 재차감·재추첨·재지급하지 않는다', async () => {
    for (const [action, values] of [
        ['open', {}], ['equip', { uid: 'stone-tool' }], ['mine', {}], ['repair', { uid: 'stone-tool', amount: 1 }],
        ['sell', { ores: [{ id: 'stone', count: 10 }] }], ['exchange', { rewardId: 'genius-key' }]
    ]) {
        await setState({ pointMine: { revision: 0, pickaxes: [{ uid: 'stone-tool', id: 'stone', durability: 4, maxDurability: 8 }], equippedUid: 'stone-tool', ores: { stone: 30 }, points: 100, exchanges: {}, totalMined: 0, nextMineAt: 0, lastAction: null } });
        const input = body(0, values); failedWrites = true;
        const failure = await forceDraw(0, () => request(action, input));
        assert.equal(failure.status, 503, action); assert.equal(failure.data.retry, true);
        const changed = (await rpg.getRPGUserByName(fixture.name)).pointMine;
        assert.equal(changed.revision, 1);
        assert.equal((await request('open', body(1))).status, 503, '저장 실패를 새 행동으로 덮어쓸 수 없다');
        failedWrites = false;
        const replay = await forceDraw(.999, () => request(action, input));
        assert.equal(replay.status, 200, action); assert.equal(replay.data.replayed, true);
        assert.deepEqual((await rpg.getRPGUserByName(fixture.name)).pointMine, changed);
    }
});

test('반복 열쇠 보상과 운영 가격·수량을 사용하며 누락된 보상은 포인트를 보존', async () => {
    await forceDraw(.3, () => request('open', body(0)));
    const config = rpg.getDataCache('PointMine');
    config.rewards.find(reward => reward.id === 'genius-key').cost = 7;
    config.rewards.find(reward => reward.id === 'genius-key').count = 5;
    let user = await rpg.getRPGUserByName(fixture.name); user.pointMine.points = 14; await user.save();
    for (const revision of [1, 2]) assert.equal((await request('exchange', body(revision, { rewardId: 'genius-key' }))).status, 200);
    user = await rpg.getRPGUserByName(fixture.name);
    assert.equal(rpg.getInventoryItemCount(user, itemData.findIndex(item => item?.name === '지니어스의 열쇠')), 10);
    config.rewards.find(reward => reward.id === 'genius-key').name = '누락된 보상';
    user.pointMine.points = 100; await user.save();
    assert.equal((await request('exchange', body(3, { rewardId: 'genius-key' }))).status, 503);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).pointMine.points, 100);
    config.active = false;
    assert.equal((await request('open', body(3))).status, 410);
});

test('변경된 8종 보상의 가격·수량·1회/10회 한도와 기존 교환 기록을 지킨다', async () => {
    let state = (await forceDraw(.3, () => request('open', body(0)))).data;
    let user = await rpg.getRPGUserByName(fixture.name);
    user.pointMine.points = 60000;
    user.pointMine.exchanges = { protection: 1, card8: 1, job8: 1 };
    for (const name of ['8성 카드팩', '8성 전직 카드팩']) rpg.addInventoryItem(user, itemData.findIndex(item => item?.name === name), 1);
    await user.save(); state = (await request('')).data;
    const expected = [
        ['orb-choice', '보주 선택 상자', 10000, 1, 1], ['orb', '보주 상자', 3900, 1, 1],
        ['character-stone-pouch', '지정 캐릭터 변환석 주머니', 4900, 1, 1], ['zeta', '제타 카드팩', 3500, 1, 1],
        ['card9', '9성 카드팩', 2900, 1, 1], ['job8', '8성 전직 카드팩', 2000, 1, 10],
        ['card8', '8성 카드팩', 1000, 1, 10], ['genius-key', '지니어스의 열쇠', 100, 3, 0]
    ];
    assert.equal(state.rewards.length, expected.length);
    for (const [id, name, cost, count, limit] of expected) {
        const reward = state.rewards.find(reward => reward.id === id);
        assert.deepEqual([reward.name, reward.cost, reward.count, reward.limit], [name, cost, count, limit]);
        const itemId = itemData.findIndex(item => item?.name === name);
        const initial = state.exchanges[id] || 0;
        const rounds = limit ? limit - initial : 2;
        for (let i = 0; i < rounds; i++) {
            const points = state.points, inventoryCount = rpg.getInventoryItemCount(user, itemId);
            const input = body(state.revision, { rewardId: id });
            const result = await request('exchange', input);
            assert.equal(result.status, 200, id); state = result.data;
            user = await rpg.getRPGUserByName(fixture.name);
            assert.equal(state.points, points - cost);
            assert.equal(state.exchanges[id], initial + i + 1);
            assert.equal(rpg.getInventoryItemCount(user, itemId), inventoryCount + count);
            const replay = await request('exchange', input);
            assert.equal(replay.data.replayed, true);
            assert.equal(replay.data.points, state.points);
            user = await rpg.getRPGUserByName(fixture.name);
            assert.equal(rpg.getInventoryItemCount(user, itemId), inventoryCount + count);
        }
        if (limit) {
            assert.equal((await request('exchange', body(state.revision, { rewardId: id }))).status, 400);
            assert.equal(user.pointMine.points, state.points);
            assert.equal(user.pointMine.exchanges[id], limit);
        }
    }
    assert.equal(user.pointMine.exchanges.protection, 1);
    assert.equal((await request('exchange', body(state.revision, { rewardId: 'protection' }))).status, 400);
    assert.equal(rpg.getInventoryItemCount(user, itemData.findIndex(item => item?.name === '지니어스의 열쇠')), 6);
});

test('송편 상품의 기존 구매 기록·일일 1개 한도와 100포인트 열쇠 구매·상자 사용', async () => {
    const songId = itemData.findIndex(item => item?.name === '송편');
    const standard = { shopId: legacyShopItemId('일반', 10), type: '아이템', item_id: songId, count: 1, limits: { daily: 2 }, price: { goods: 'gold', amount: 100 } };
    const point = { shopId: newShopItemId(), type: '아이템', item_id: keyId, count: 1, limits: {}, price: { goods: 'point', amount: 100 } };
    shopData = { '일반': [standard], '포인트': [point] };
    const buy = async (shopType, shopId, count = 1) => {
        const response = await fetch(base + '/api/shop/buy', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ shopType, shopId, count }) });
        return { status: response.status, data: await response.json() };
    };
    const daily = { date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), count: 2 };
    try {
        await setState({ gold: 500, point: 300, shopPurchases: {}, pointMineDropDaily: daily });
        // 같은 상품 ID로 교체하므로 오늘 이미 송편을 구매했다면 추가 구매할 수 없다.
        assert.equal((await buy('일반', standard.shopId)).status, 200);
        standard.item_id = keyId; standard.limits.daily = 1;
        assert.equal((await buy('일반', standard.shopId)).status, 400);
        let user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(user.gold, 400); assert.equal(rpg.getInventoryItemCount(user, songId), 1);
        assert.equal(rpg.getInventoryItemCount(user, keyId), 20);
        const displayed = await (await fetch(base + '/api/shop', { headers: { Cookie: cookie } })).json();
        assert.equal(displayed.shop['일반'][0].soldOut, true);
        assert.equal(displayed.shop['일반'][0].limitInfo.remaining.daily, 0);
        assert.equal(displayed.shop['포인트'][0].display.name, KEY_NAME);
        assert.equal(displayed.shop['포인트'][0].count, 1);
        assert.equal(displayed.shop['포인트'][0].price.amount, 100);
        assert.equal((await buy('포인트', point.shopId, 2)).status, 200);
        assert.equal((await buy('포인트', point.shopId, 2)).status, 400);
        assert.equal((await buy('포인트', point.shopId)).status, 200);
        user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(user.point, 0); assert.equal(rpg.getInventoryItemCount(user, keyId), 23);
        assert.deepEqual(user.pointMineDropDaily, daily);
        // 구매 이력이 없는 계정은 일반 상점에서 열쇠 1개만 구매한다.
        user.shopPurchases = {}; await user.save();
        assert.equal((await buy('일반', standard.shopId)).status, 200);
        assert.equal((await buy('일반', standard.shopId)).status, 400);
        user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(user.gold, 300); assert.equal(rpg.getInventoryItemCount(user, keyId), 24);
        const opened = await forceDraw(.3, () => request('open', body(0)));
        assert.equal(opened.status, 200); assert.equal(opened.data.keyCount, 23);
        assert.equal(opened.data.pickaxes.length, 1);
        user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(rpg.getInventoryItemCount(user, songId), 1);
    } finally { shopData = null; }
});

test('필드에서 송편 대신 열쇠 지급, 하루 2개·기존 획득 보존·한국 자정 갱신·레벨 제한', async () => {
    const dungeon = rpg.getRegularFieldDungeons()[0];
    const user = await rpg.getRPGUserByName(fixture.name);
    user.level = dungeon.requireLevel || 1; user.inventory.item = [];
    user.field = { name: dungeon.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} };
    const legacy = structuredClone(user.songpyeonDropDaily);
    const original = Math.random; Math.random = () => 0;
    try {
        for (let i = 0; i < 6; i++) rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { hitCount: 1, disableCritical: true, disableEquipmentBonusDamage: true, isBotAutoAttack: true });
        assert.equal(rpg.getInventoryItemCount(user, keyId), 2);
        assert.equal(user.pointMineDropDaily.count, 2);
        assert.deepEqual(user.songpyeonDropDaily, legacy);
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        assert.equal(user.pointMineDropDaily.date, today);
        user.pointMineDropDaily.count = 5;
        rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { disableCritical: true, isBotAutoAttack: true });
        assert.equal(user.pointMineDropDaily.count, 5); assert.equal(rpg.getInventoryItemCount(user, keyId), 2);
        user.pointMineDropDaily.date = '2000-01-01';
        rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { disableCritical: true, isBotAutoAttack: true });
        assert.equal(user.pointMineDropDaily.count, 1); assert.equal(rpg.getInventoryItemCount(user, keyId), 3);
        rpg.getDataCache('PointMine').active = false;
        rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { disableCritical: true, isBotAutoAttack: true });
        assert.equal(rpg.getInventoryItemCount(user, keyId), 3);
        rpg.getDataCache('PointMine').active = true;
        user.level = dungeon.requireLevel + 100;
        rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { disableCritical: true, isBotAutoAttack: true });
        assert.equal(rpg.getInventoryItemCount(user, keyId), 3);
        const songId = itemData.findIndex(item => item?.name === '송편');
        if (songId >= 0) assert.equal(rpg.getInventoryItemCount(user, songId), 0);
    } finally { Math.random = original; }
});

test('원본의 전용 광물·황금 제한과 운영 설정 검증', () => {
    assert.equal(validateConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
    for (const type of DEFAULT_CONFIG.pickaxes) {
        const ores = oreDistribution(DEFAULT_CONFIG, type);
        assert.ok(ores.length > 0);
        assert.ok(ores.every(ore => !ore.exactPickaxe || ore.exactPickaxe === type.id));
        if (type.id === 'gold') assert.ok(!ores.some(ore => ore.id === 'jade'));
    }
    for (const edit of [config => { config.rewards[0].cost = -1; }, config => { config.pickaxes[1].repair[0].count = 0; }, config => { config.pickaxes[0].weight = 0; }]) {
        const config = structuredClone(DEFAULT_CONFIG); edit(config); assert.throws(() => validateConfig(config));
    }
});
