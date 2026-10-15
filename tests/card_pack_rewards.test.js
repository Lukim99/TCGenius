'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// 기존 게임/HTTP 서버를 실행하고 외부 저장소만 메모리로 대체한다. 환경 파일은 읽지 않는다.
const read = key => {
    const file = path.join(__dirname, '../DB/RPGenius', key + '.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};
const seed = { id: 'card-reward-http', name: '즉시카드HTTP', code: 'CARD-TEST-ONLY', _get: 1,
    avatarMigrated: true, logged_in: [], logged_in_agent: [], need_character_card_select: false };
const mail = new Map();
const writes = [];
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName === 'rpgenius_data') return { Item: { key: input.Key.key, data: read(input.Key.key) } };
        if (input.TableName === 'rpgenius_mail') return { Item: mail.get(input.Key.id) };
        return {};
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(seed)] : [] };
    if (['PutCommand', 'UpdateCommand', 'TransactWriteCommand', 'DeleteCommand'].includes(command.constructor.name)) {
        writes.push(structuredClone(input)); return {};
    }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const party = require('../partyquest').__test;
const pvp = require('../pvp');
const startServer = require('../server');
let sequence = 0, server, base, cookie;
const itemId = name => rpg.getDataCache('Item').findIndex(item => item?.name === name);
function user(limit = 52) {
    const value = new rpg.RPGUser('즉시카드' + ++sequence, 'card-reward-' + sequence);
    value.avatarMigrated = true; value.maxCardLimit = limit;
    value.main_card = { id: 0, star: 6, type: '일반' }; value.need_character_card_select = false;
    value.hp = value.mp = 1000000000;
    return value;
}
async function fixed(value, run) {
    const original = Math.random; Math.random = () => value;
    try { return await run(); } finally { Math.random = original; }
}
async function post(endpoint, body) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
before(async () => {
    await rpg.initRpgeniusData();
    process.env.PORT = '0'; server = startServer();
    await new Promise(resolve => server.on('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: seed.name, code: seed.code }) });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0];
});
after(() => new Promise(resolve => server.close(resolve)));

test('일반·전직 카드팩은 운영 등급과 수량대로 즉시 카드가 되고 초과분은 버린다', async () => {
    for (const [name, type, star] of [['8성 카드팩', '일반', 7], ['9성 전직 카드팩', '전직', 8]]) {
        const value = user(2), id = itemId(name);
        const result = await fixed(0, () => rpg.grantItemReward(value, id, 5));
        assert.equal(result.converted, true); assert.equal(result.discarded, 3);
        assert.equal(value.inventory.card.length, 2);
        assert.ok(value.inventory.card.every(card => card.type === type && card.star === star));
        assert.equal(rpg.getInventoryItemCount(value, id), 0);
        assert.match(rpg.formatItemReward(result).join('\n'), /버려진.*x3/);
    }
});

test('카드팩 상자·카드박스·특정 캐릭터 팩을 재귀적으로 개봉하고 일반 상자는 보존한다', async () => {
    const packsBefore = structuredClone(rpg.getDataCache('Pack'));
    const bundlesBefore = structuredClone(rpg.getDataCache('Bundle'));
    for (const name of ['카드팩 상자', '카드박스I', '딜러장 카드팩', '[6월]패션 카드팩']) {
        const value = user(), id = itemId(name);
        const result = await fixed(0, () => rpg.grantItemReward(value, id, 1));
        assert.equal(result.converted, true, name);
        assert.ok(value.inventory.card.length > 0, name);
        assert.equal(value.inventory.item.length, 0, name);
    }
    const ordinary = user(), id = itemId('엘리트 토벌 상자');
    assert.equal(rpg.grantItemReward(ordinary, id, 1).converted, false);
    assert.equal(rpg.getInventoryItemCount(ordinary, id), 1);
    assert.deepEqual(rpg.getDataCache('Pack'), packsBefore);
    assert.deepEqual(rpg.getDataCache('Bundle'), bundlesBefore);
});

test('운영자가 지정한 중첩 구성·추첨 횟수·전직 등급을 그대로 사용한다', async () => {
    const items = rpg.getDataCache('Item'), packs = rpg.getDataCache('Pack'), bundles = rpg.getDataCache('Bundle');
    const job = items.push({ name: '운영 전직 카드팩', type: '가챠', pack: { type: '전직 캐릭터 카드팩', range: { min: 6, max: 6 } } }) - 1;
    const pack = packs.push([{ type: '아이템', item_id: job, count: 2, roll: 1 }]) - 1;
    const wrapper = items.push({ name: '운영 추첨', type: '가챠', pack, num: 3 }) - 1;
    const bundle = bundles.push([{ type: '아이템', item_id: wrapper, count: 2 }]) - 1;
    const container = items.push({ name: '운영 카드 꾸러미', type: '번들', pack: bundle }) - 1;
    const value = user(7);
    const result = await fixed(0, () => rpg.grantItemReward(value, container, 1));
    assert.equal(value.inventory.card.length, 7); assert.equal(result.discarded, 5);
    assert.ok(value.inventory.card.every(card => card.type === '전직' && card.star === 5));
    assert.equal(value.inventory.item.length, 0);
});

test('기존 카드팩 사용도 요청량 전체를 소비하고 카드 공간 초과분을 버린다', async () => {
    const value = user(1), id = itemId('5성 카드팩');
    rpg.addInventoryItem(value, id, 3);
    const message = await fixed(0, () => rpg.useItem(value, '5성 카드팩', 3));
    assert.equal(value.inventory.card.length, 1); assert.equal(rpg.getInventoryItemCount(value, id), 0);
    assert.match(message, /버려진.*x2/);
});

test('꾸러미·가챠 보상은 다른 구성품을 보존하고 카드팩만 즉시 지급한다', async () => {
    const value = user(1), summary = {};
    rpg.grantPackReward(value, { type: '아이템', item_id: itemId('5성 카드팩'), count: 3 }, summary);
    rpg.grantPackReward(value, { type: '아이템', item_id: itemId('강화석'), count: 17 }, summary);
    assert.equal(value.inventory.card.length, 1); assert.equal(summary.discardedCard.count, 2);
    assert.equal(rpg.getInventoryItemCount(value, itemId('강화석')), 17);
});

test('낚시는 카드팩을 살림망에 쌓지 않고 즉시 카드로 지급·초과 폐기한다', () => {
    const value = user(1);
    rpg.addFishingReward(value, itemId('6성 카드팩'));
    rpg.addFishingReward(value, itemId('6성 카드팩'));
    assert.equal(value.inventory.card.length, 1);
    assert.equal(value.fishingCards.length, 0);
    assert.equal(value.fishingNet[itemId('6성 카드팩')], undefined);
});

test('사냥과 일일 던전에서 카드팩을 남기지 않고 실제 카드를 지급한다', async () => {
    const value = user(), dungeon = rpg.getRegularFieldDungeons()[0];
    value.level = dungeon.requireLevel; value.field = { name: dungeon.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} };
    await fixed(0, () => rpg.buildHuntResult(value, dungeon, dungeon.hp * 2, { precalculatedDamage: true, disableEquipmentBonusDamage: true }));
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드팩 상자')), 0);
    assert.ok(value.inventory.card.length > 0);
    const daily = user(1); daily.level = 101;
    daily.field = { name: '마동', dailyDungeon: true, killCount: 5000 };
    const result = rpg.grantDailyDungeonClearReward(daily, rpg.findDailyDungeonByName('마동'), {}, {}, {}, () => 0);
    assert.equal(daily.inventory.card.length, 1);
    assert.equal(rpg.getInventoryItemCount(daily, itemId('5성 카드팩')), 0);
    assert.match(result.text, /버려진.*x1/);
});

test('레이드 아이템 보상은 기존 팩 이미지와 실제 카드·버림 수량을 반환한다', () => {
    const value = user(1), summary = {};
    const result = party.grantPartyQuestPackReward(value, { type: '아이템', item_id: itemId('8성 전직 카드팩'), count: 3 }, summary);
    assert.equal(result.kind, 'card'); assert.equal(result.discarded, 2);
    assert.equal(value.inventory.card.length, 1); assert.equal(summary.discardedCard.count, 2);
    assert.ok(result.iconUrl);
});

test('PVP 카드팩 상자 당첨은 실제 카드가 되고 가득 찼으면 버림 결과를 반환한다', async () => {
    const value = user(1);
    for (let i = 0; i < 2; i++) {
        const battle = { phase: 'fighting', opponent: seed.name, opp: { rating: 1000, userId: seed.id }, me: { name: value.name } };
        await fixed(0, () => pvp.finishBattle(value, battle, 'win', '검증', Date.now()));
        assert.equal(battle.result.reward.kind, 'card');
        assert.equal(battle.result.reward.discarded, i);
    }
    assert.equal(value.inventory.card.length, 1);
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드팩 상자')), 0);
});

test('퀘스트 카드팩 보상은 공간 초과분을 버리고 완료 기록으로 중복을 막는다', () => {
    const value = user(1);
    const id = 900001;
    rpg.getDataCache('Quest').push({ id, name: '즉시 카드 검증', enabled: true, minLevel: 1, maxLevel: 300,
        categories: ['일반'], unlock: { type: 'always' }, objectives: [], rewards: [{ type: '아이템', item_id: itemId('6성 카드팩'), count: 3 }] });
    const result = rpg.claimQuestReward(value, id);
    assert.equal(value.inventory.card.length, 1); assert.equal(result.rewardSummary.discardedCard.count, 2);
    const inventory = structuredClone(value.inventory);
    assert.ok(rpg.claimQuestReward(value, id).error);
    assert.deepEqual(value.inventory, inventory);
});

test('일반 상점 카드박스 구매는 즉시 카드 지급·초과 폐기 후 가격을 소비한다', async () => {
    const value = user(1); value.garnet = 10000;
    const shop = rpg.getDataCache('Shop')['가넷'];
    const index = shop.findIndex(entry => entry.item_id === itemId('카드박스I'));
    assert.ok(index >= 0);
    const cost = shop[index].price.amount, result = {};
    const message = await rpg.purchaseShopItem(value, '가넷', index + 1, 1, result);
    assert.match(message, /^✅/); assert.equal(value.garnet, 10000 - cost);
    assert.equal(value.inventory.card.length, 1); assert.equal(result.bundleGranted.discardedCard.count, 3);
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드박스I')), 0);
});

test('쿠폰과 우편 수령은 공간이 없어도 보상을 소비하며 재수령하지 않는다', async () => {
    const value = user(1); value.inventory.card.push({ id: 0, star: 0, type: '일반' });
    rpg.getDataCache('Coupon').push({ code: 'CARD-REWARD-TEST', reward: [{ type: '아이템', item_id: itemId('9성 카드팩'), count: 2 }] });
    assert.match(await rpg.useCoupon(value, 'CARD-REWARD-TEST'), /버려진.*x2/);
    assert.match(await rpg.useCoupon(value, 'CARD-REWARD-TEST'), /이미 사용/);
    mail.set('card-mail-test', { id: 'card-mail-test', gifts: [{ type: 'item', id: itemId('9성 카드팩'), count: 3 }] });
    value.mail = [{ id: 'card-mail-test' }];
    const claim = await rpg.claimMailGifts(value, 'card-mail-test');
    assert.equal(claim.ok, true); assert.match(claim.lines.join('\n'), /버려진.*x3/);
    assert.match((await rpg.claimMailGifts(value, 'card-mail-test')).error, /이미/);
    assert.equal(value.inventory.card.length, 1);
});

test('웹 선택권은 카드로 지급하고 같은 개봉 번호 재시도는 재추첨하지 않는다', async () => {
    const value = await rpg.getRPGUserByName(seed.name);
    value.maxCardLimit = 1; value.inventory = { card: [], item: [], equipment: [], pet: [] }; value.itemChoiceState = {};
    const items = rpg.getDataCache('Item');
    const pouch = items.push({ name: '즉시 카드 선택권', type: '사용', use: '아이템선택', choices: [{ id: itemId('9성 카드팩'), count: 3 }] }) - 1;
    rpg.addInventoryItem(value, pouch, 1); await value.save();
    const body = { itemId: itemId('9성 카드팩'), version: 0 };
    const first = await post('/api/inventory/items/' + pouch + '/choose', body);
    assert.equal(first.status, 200); assert.equal(first.data.reward.discarded, 2);
    const replay = await post('/api/inventory/items/' + pouch + '/choose', body);
    assert.deepEqual(replay.data.reward, first.data.reward);
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.inventory.card.length, 1); assert.equal(rpg.getInventoryItemCount(after, pouch), 0);
    assert.equal(rpg.getInventoryItemCount(after, body.itemId), 0);
});

test('레벨 보상 HTTP 수령은 카드로 지급하며 수령 기록으로 중복을 막는다', async () => {
    const value = await rpg.getRPGUserByName(seed.name);
    value.level = 10; value.maxCardLimit = 2; value.claimedLevelRewards = [];
    value.inventory = { card: [], item: [], equipment: [], pet: [] }; await value.save();
    const result = await post('/api/levelreward', { level: 10 });
    assert.equal(result.status, 200); assert.equal(result.data.discardedCards, 1);
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.inventory.card.length, 2);
    assert.equal(rpg.getInventoryItemCount(after, itemId('5성 카드팩')), 0);
    assert.equal((await post('/api/levelreward', { level: 10 })).status, 400);
});

test('반환용 원시 인벤토리 추가는 기존 카드팩을 자동 개봉하지 않는다', () => {
    const value = user(), id = itemId('9성 카드팩');
    rpg.addInventoryItem(value, id, 4);
    assert.equal(value.inventory.card.length, 0); assert.equal(rpg.getInventoryItemCount(value, id), 4);
    assert.ok(writes.length > 0);
});
